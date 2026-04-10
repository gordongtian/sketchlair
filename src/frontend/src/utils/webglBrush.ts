// ============================================================
// webglBrush.ts — Stamp-based WebGL brush engine
//
// Three-buffer model (matches Krita/Photoshop):
//   • shapeFBO (stamp shape): written once per stamp with the raw tip alpha.
//     Both paintFBO (strokeFBO) and opacityFBO read from this.
//   • strokeFBO (wet layer): stamps accumulate here at full flow via
//     premultiplied source-over. No per-stamp opacity cap is baked in.
//   • opacityFBO (opacity ceiling): always present. Each stamp writes
//     tipAlpha*capAlpha into this FBO using MAX blend so pixels can only rise,
//     never fall. capAlpha = pressure*opacitySlider when pressure→opacity is on,
//     = opacitySlider otherwise.
//   • snapshotCanvasRef (dry layer): committed canvas state before stroke start.
//   • displayCanvasRef (display): dry + wet composited each frame.
//
//   Flush always uses FLUSH_MASK_FRAG: min(strokeFBO, opacityFBO).
// ============================================================

import { getLuminance } from "./colorUtils";

export interface WebGLBrushContext {
  canvas: HTMLCanvasElement;
  clear(): void;
  resize(width: number, height: number): void;
  stamp(
    x: number,
    y: number,
    size: number,
    opacity: number,
    r: number,
    g: number,
    b: number,
    tipImageData: string | null,
    angle: number,
    defaultTipCanvas: HTMLCanvasElement | null,
    softness: number,
    dualTipEnabled?: boolean,
    dualTipImageData?: string | null,
    dualTipBlendMode?: string,
    dualR?: number,
    dualG?: number,
    dualB?: number,
    dualScatterX?: number,
    dualScatterY?: number,
    dualSize2Scale?: number,
    dualAngle2?: number,
    capAlpha?: number,
  ): void;
  flushDisplay(opacityCap: number): void;
  clearMask(): void;
  hasMaskData(): boolean;
  isWebGL2: boolean;
  dispose(): void;
  preloadTipTexture(tipImageData: string): void;
}

// ----- Shader sources -----

const STAMP_VERT = `
attribute vec2 a_position;
attribute vec2 a_texCoord;
uniform vec2 u_resolution;
uniform vec2 u_center;
uniform float u_size;
uniform float u_renderSize;
uniform float u_angle;
varying vec2 v_texCoord;
void main() {
  float c = cos(u_angle);
  float s = sin(u_angle);
  vec2 rotated = vec2(
    a_position.x * c - a_position.y * s,
    a_position.x * s + a_position.y * c
  );
  vec2 pos = rotated * u_renderSize * 0.5 + u_center;
  vec2 clipSpace = (pos / u_resolution.y) * 2.0 - 1.0;
  clipSpace.x -= (u_resolution.x / u_resolution.y) - 1.0;
  gl_Position = vec4(clipSpace * vec2(1.0, -1.0), 0.0, 1.0);
  v_texCoord = a_texCoord;
}
`;

// Shape stamp shader: writes raw tip alpha into shapeFBO.
// This is the sole shape authority — both STAMP_FRAG and MASK_STAMP_FRAG
// read from shapeFBO via u_shape, never sampling u_tip directly.
const SHAPE_STAMP_FRAG = `
precision highp float;
uniform sampler2D u_tip;
uniform float u_softness;
uniform float u_sizeScale;
uniform float u_renderSize;
varying vec2 v_texCoord;
void main() {
  vec2 uv = v_texCoord;
  vec2 centered = (uv * 2.0 - 1.0) * u_sizeScale;
  float dist = length(centered);

  float aaWidth = u_sizeScale / (u_renderSize * 0.5);
  float halfAA = aaWidth * 0.5;
  float upper = 1.0 + halfAA;

  // Image-based tip: perceptual luminance drives alpha (dark = opaque).
  vec2 scaledUv = (uv - 0.5) * u_sizeScale + 0.5;
  vec3 tipRGB = texture2D(u_tip, scaledUv).rgb;
  float lum = dot(tipRGB, vec3(0.299, 0.587, 0.114));
  float tipAlpha = 1.0 - lum;

  // Hard boundary clip only
  float hardLower = max(0.0, 1.0 - halfAA);
  float edgeFactor = 1.0 - smoothstep(hardLower, upper, dist);
  tipAlpha *= edgeFactor;

  // Output raw tip alpha into all channels — both paint and opacity FBOs read .r
  gl_FragColor = vec4(tipAlpha, tipAlpha, tipAlpha, tipAlpha);
}
`;

// Stamp shader: reads tipAlpha from shapeFBO via u_shape.
// Outputs premultiplied RGBA so each stamp carries its own color.
const STAMP_FRAG = `
precision highp float;
uniform sampler2D u_shape;
uniform float u_flow;
uniform float u_softness;
uniform float u_sizeScale;
uniform float u_renderSize;
uniform vec3 u_color;
varying vec2 v_texCoord;
void main() {
  vec2 uv = v_texCoord;
  float tipAlpha = texture2D(u_shape, uv).r;

  float alpha = tipAlpha * u_flow;
  // Write premultiplied RGBA so each stamp carries its own color.
  gl_FragColor = vec4(u_color * alpha, alpha);
}
`;

const DUAL_STAMP_FRAG = `
precision highp float;
uniform sampler2D u_tip1;
uniform sampler2D u_tip2;
uniform float u_flow;
uniform float u_softness;
uniform float u_sizeScale;
uniform float u_renderSize;
uniform int u_blendMode;
uniform vec3 u_color;
uniform vec3 u_color2;
uniform vec2 u_scatter2;
uniform float u_size2scale;
uniform float u_angle2;
varying vec2 v_texCoord;
void main() {
  vec2 uv = v_texCoord;
  vec2 centered = (uv * 2.0 - 1.0) * u_sizeScale;
  float dist = length(centered);

  float aaWidth_d = u_sizeScale / (u_renderSize * 0.5);
  float halfAA_d = aaWidth_d * 0.5;
  float upper_d = 1.0 + halfAA_d;

  vec2 scaledUv = (uv - 0.5) * u_sizeScale + 0.5;
  vec3 tipRGB1 = texture2D(u_tip1, scaledUv).rgb;
  float lum1 = dot(tipRGB1, vec3(0.299, 0.587, 0.114));
  float a1 = 1.0 - lum1;

  // Tip2 UV transform: scatter (normalized UV units), rotation, size jitter.
  // u_scatter2 is pre-divided by stampSize on the CPU, so it's already in UV space.
  vec2 tip2_centered = (uv - 0.5) * u_sizeScale - u_scatter2;

  // Apply rotation jitter for tip2 (cos2/sin2 were previously computed but never used)
  float c2 = cos(u_angle2);
  float s2 = sin(u_angle2);
  vec2 tip2_rotated = vec2(
    tip2_centered.x * c2 - tip2_centered.y * s2,
    tip2_centered.x * s2 + tip2_centered.y * c2
  );

  // Apply size jitter: size2scale > 1.0 = larger tip = divide UV to zoom in on texture
  // Previous code multiplied (wrong direction), this divides (correct)
  vec2 tip2_uv = tip2_rotated / max(u_size2scale, 0.01) + 0.5;
  tip2_uv = clamp(tip2_uv, 0.0, 1.0);
  vec3 tipRGB2 = texture2D(u_tip2, tip2_uv).rgb;
  float lum2 = dot(tipRGB2, vec3(0.299, 0.587, 0.114));
  float a2 = 1.0 - lum2;

  // Apply hard boundary clip (image tip — gradient controls its own softness).
  float hardLower_e = max(0.0, 1.0 - halfAA_d);
  float edgeFactor_e = 1.0 - smoothstep(hardLower_e, upper_d, dist);
  a1 *= edgeFactor_e;
  a2 *= edgeFactor_e;
  float combined;
  if (u_blendMode == 1) {
    combined = a1 + a2 - a1 * a2;
  } else if (u_blendMode == 2) {
    combined = (a1 < 0.5) ? (2.0 * a1 * a2) : (1.0 - 2.0 * (1.0 - a1) * (1.0 - a2));
  } else if (u_blendMode == 3) {
    combined = min(a1, a2);
  } else if (u_blendMode == 4) {
    combined = max(a1, a2);
  } else {
    combined = a1 * a2;
  }
  // Clamp combined alpha to main tip's alpha so dual tip cannot leak outside main brush footprint
  combined = min(combined, a1);
  float alpha = combined * u_flow;
  gl_FragColor = vec4(u_color2 * alpha, alpha);
}
`;

const QUAD_VERT = `
attribute vec2 a_position;
varying vec2 v_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

// Pressure-mask stamp shader: reads tipAlpha from shapeFBO via u_shape,
// writes tipAlpha * u_capAlpha into opacityFBO using MAX blend.
// Output is single-channel (written to all RGBA for MAX blend compatibility).
const MASK_STAMP_FRAG = `
precision highp float;
uniform sampler2D u_shape;
uniform float u_capAlpha;
uniform float u_sizeScale;
uniform float u_renderSize;
varying vec2 v_texCoord;
void main() {
  vec2 uv = v_texCoord;
  float tipAlpha = texture2D(u_shape, uv).r;

  float maskVal = tipAlpha * u_capAlpha;
  gl_FragColor = vec4(maskVal, maskVal, maskVal, maskVal);
}
`;

// Flush-with-mask shader: min(strokeFBO, opacityFBO) for all strokes.
// strokeFBO provides the accumulated color (premultiplied RGB from stamps, source-over).
// opacityFBO provides the opacity envelope (alpha ceiling, MAX blend).
// finalAlpha = min(strokeAlpha, maskAlpha) — stroke is clamped to the opacity ceiling.
// Per-stamp color jitter is preserved: RGB is read from strokeFBO (not a flat uniform).
// Dithering applied to break up 8-bit alpha quantization at stroke edges.
const FLUSH_MASK_FRAG = `
precision highp float;
uniform sampler2D u_stroke;
uniform sampler2D u_mask;
uniform float u_dither;
uniform float u_opacityCap;
varying vec2 v_uv;
void main() {
  vec4 strokeSample = texture2D(u_stroke, v_uv);
  float strokeAlpha = strokeSample.a;
  float maskAlpha = texture2D(u_mask, v_uv).r;

  // min: stroke can never exceed opacity ceiling; hard slider cap applied after.
  float finalAlpha = min(strokeAlpha, maskAlpha);
  finalAlpha = min(finalAlpha, u_opacityCap);

  // Apply dithering at display output only
  if (u_dither > 0.5) {
    float dither = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
    finalAlpha = clamp(finalAlpha + dither / 255.0, 0.0, 1.0);
  }

  // Recover straight RGB from premultiplied strokeFBO, then re-premultiply with finalAlpha.
  // This preserves per-stamp color jitter stored in the stroke FBO's RGB channels.
  vec3 straightColor = strokeAlpha > 0.0001 ? strokeSample.rgb / strokeAlpha : vec3(0.0);
  gl_FragColor = vec4(straightColor * finalAlpha, finalAlpha);
}
`;

// Flat-cap composite: uniform opacity cap for the whole stroke.
// Kept as dead code — FLUSH_MASK_FRAG is now always used.
// Outputs premultiplied RGBA for correct source-over compositing via drawImage.
const FLAT_CAP_FRAG = `
precision highp float;
uniform sampler2D u_stroke;
uniform float u_cap;
uniform float u_dither;
varying vec2 v_uv;
void main() {
  vec4 strokeSample = texture2D(u_stroke, v_uv);
  float accAlpha = strokeSample.a;
  vec3 premultRGB = strokeSample.rgb;
  float scaledAlpha = min(accAlpha, u_cap);
  vec3 color = accAlpha > 0.0001 ? premultRGB / accAlpha : vec3(0.0);
  if (u_dither > 0.5) {
    float dither = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
    scaledAlpha = clamp(scaledAlpha + dither / 255.0, 0.0, 1.0);
  }
  gl_FragColor = vec4(color * scaledAlpha, scaledAlpha);
}
`;

// ----- GL helpers -----

function compileShader(
  gl: WebGLRenderingContext,
  type: number,
  src: string,
): WebGLShader | null {
  const s = gl.createShader(type);
  if (!s) return null;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.error("Shader error:", gl.getShaderInfoLog(s));
    gl.deleteShader(s);
    return null;
  }
  return s;
}

function linkProgram(
  gl: WebGLRenderingContext,
  vertSrc: string,
  fragSrc: string,
): WebGLProgram | null {
  const vert = compileShader(gl, gl.VERTEX_SHADER, vertSrc);
  const frag = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc);
  if (!vert || !frag) return null;
  const prog = gl.createProgram();
  if (!prog) return null;
  gl.attachShader(prog, vert);
  gl.attachShader(prog, frag);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error("Program link error:", gl.getProgramInfoLog(prog));
    gl.deleteProgram(prog);
    return null;
  }
  return prog;
}

function makeFBO(
  gl: WebGLRenderingContext,
  w: number,
  h: number,
  internalFormat: number = gl.RGBA,
  pixelType: number = gl.UNSIGNED_BYTE,
): { fbo: WebGLFramebuffer; tex: WebGLTexture } | null {
  const tex = gl.createTexture();
  if (!tex) return null;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    internalFormat,
    w,
    h,
    0,
    gl.RGBA,
    pixelType,
    null,
  );
  // NEAREST required for float textures (LINEAR requires OES_texture_float_linear on WebGL1)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindTexture(gl.TEXTURE_2D, null);
  const fbo = gl.createFramebuffer();
  if (!fbo) {
    gl.deleteTexture(tex);
    return null;
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    tex,
    0,
  );
  // Verify completeness — float FBOs may not be renderable on all drivers
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    gl.deleteFramebuffer(fbo);
    gl.deleteTexture(tex);
    return null;
  }
  return { fbo, tex };
}

function resizeFBOTex(
  gl: WebGLRenderingContext,
  tex: WebGLTexture,
  w: number,
  h: number,
  internalFormat: number = gl.RGBA,
  pixelType: number = gl.UNSIGNED_BYTE,
) {
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    internalFormat,
    w,
    h,
    0,
    gl.RGBA,
    pixelType,
    null,
  );
  gl.bindTexture(gl.TEXTURE_2D, null);
}

// Build tip texture: stores grayscale luminance in the RED channel.
// R=0 (black) = fully opaque, R=255 (white) = fully transparent.
function buildTipTexture(
  gl: WebGLRenderingContext,
  tipCanvas: HTMLCanvasElement,
): WebGLTexture | null {
  const ctx = tipCanvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  const w = tipCanvas.width;
  const h = tipCanvas.height;
  const imgData = ctx.getImageData(0, 0, w, h);
  const d = imgData.data;
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const lum = getLuminance(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);
    const srcAlpha = d[i * 4 + 3] / 255;
    // Blend luminance with white for transparent areas
    const r = Math.round(lum * srcAlpha + 255 * (1 - srcAlpha));
    rgba[i * 4 + 0] = r;
    rgba[i * 4 + 1] = r;
    rgba[i * 4 + 2] = r;
    rgba[i * 4 + 3] = 255;
  }
  const tex = gl.createTexture();
  if (!tex) return null;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    w,
    h,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    rgba,
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return tex;
}

// Module-level pooled canvas for tip texture loading.
// Re-using a single canvas avoids a document.createElement("canvas") + GC cycle
// on every async tip texture load — important when users switch brushes quickly.
const _tipLoadCanvas = document.createElement("canvas");
_tipLoadCanvas.width = _tipLoadCanvas.height = 128;
const _tipLoadCtx = _tipLoadCanvas.getContext("2d", {
  willReadFrequently: true,
});

function buildTipTextureFromDataUrl(
  gl: WebGLRenderingContext,
  dataUrl: string,
  cache: Map<string, WebGLTexture>,
  cacheKey: string,
): void {
  const img = new Image();
  img.onload = () => {
    const SIZE = 128;
    // Reuse the pooled canvas instead of allocating a new one each time
    const ctx2 = _tipLoadCtx;
    if (!ctx2) return;
    ctx2.clearRect(0, 0, SIZE, SIZE);
    ctx2.drawImage(img, 0, 0, SIZE, SIZE);
    const imgData = ctx2.getImageData(0, 0, SIZE, SIZE);
    const d = imgData.data;
    const rgba = new Uint8Array(SIZE * SIZE * 4);
    for (let i = 0; i < SIZE * SIZE; i++) {
      const lum = getLuminance(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);
      const srcAlpha = d[i * 4 + 3] / 255;
      const r = Math.round(lum * srcAlpha + 255 * (1 - srcAlpha));
      rgba[i * 4 + 0] = r;
      rgba[i * 4 + 1] = r;
      rgba[i * 4 + 2] = r;
      rgba[i * 4 + 3] = 255;
    }
    const tex = gl.createTexture();
    if (!tex) return;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      SIZE,
      SIZE,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      rgba,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    cache.set(cacheKey, tex);
  };
  img.src = dataUrl;
}

function buildDefaultCircleTexture(
  gl: WebGLRenderingContext,
): WebGLTexture | null {
  const SIZE = 128;
  const rgba = new Uint8Array(SIZE * SIZE * 4);
  const center = (SIZE - 1) / 2;
  const AA = 1.5 / center; // ~1.5 pixel anti-aliasing band at the edge
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = (x - center) / center;
      const dy = (y - center) / center;
      const dist = Math.sqrt(dx * dx + dy * dy);
      // Hard circle with a thin anti-aliasing band — shader controls softness
      const opaque = Math.max(0, Math.min(1, (1 - dist) / AA));
      const lum = Math.round(255 * (1 - opaque));
      const i = (y * SIZE + x) * 4;
      rgba[i + 0] = lum;
      rgba[i + 1] = lum;
      rgba[i + 2] = lum;
      rgba[i + 3] = 255;
    }
  }
  const tex = gl.createTexture();
  if (!tex) return null;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    SIZE,
    SIZE,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    rgba,
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return tex;
}

// ----- Factory -----

export function createWebGLBrushContext(
  width: number,
  height: number,
): WebGLBrushContext | null {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  // premultipliedAlpha: true so drawImage into 2D canvas composites correctly.
  // The cap shaders output premultiplied RGBA to match.
  // Try WebGL2 first, fall back to WebGL1
  const contextAttribs = {
    premultipliedAlpha: true,
    alpha: true,
    antialias: false,
    preserveDrawingBuffer: true,
  };
  let isWebGL2 = false;
  let glMaybe: WebGLRenderingContext | null = null;
  const gl2attempt = canvas.getContext(
    "webgl2",
    contextAttribs,
  ) as WebGL2RenderingContext | null;
  if (gl2attempt) {
    isWebGL2 = true;
    glMaybe = gl2attempt as unknown as WebGLRenderingContext;
  } else {
    glMaybe = canvas.getContext(
      "webgl",
      contextAttribs,
    ) as WebGLRenderingContext | null;
  }
  if (!glMaybe) return null;
  const gl: WebGLRenderingContext = glMaybe;

  // ---- Shader programs ----
  const shapeStampProg = linkProgram(gl, STAMP_VERT, SHAPE_STAMP_FRAG);
  if (!shapeStampProg) return null;
  const stampProg = linkProgram(gl, STAMP_VERT, STAMP_FRAG);
  if (!stampProg) return null;
  const flatCapProg = linkProgram(gl, QUAD_VERT, FLAT_CAP_FRAG);
  const dualStampProg = linkProgram(gl, STAMP_VERT, DUAL_STAMP_FRAG);
  // Opacity mask programs
  const maskStampProg = linkProgram(gl, STAMP_VERT, MASK_STAMP_FRAG);
  const flushMaskProg = linkProgram(gl, QUAD_VERT, FLUSH_MASK_FRAG);

  // ---- Shape stamp program locations ----
  const shapeAPos = gl.getAttribLocation(shapeStampProg, "a_position");
  const shapeATexCoord = gl.getAttribLocation(shapeStampProg, "a_texCoord");
  const shapeUResolution = gl.getUniformLocation(
    shapeStampProg,
    "u_resolution",
  );
  const shapeUCenter = gl.getUniformLocation(shapeStampProg, "u_center");
  const shapeUSize = gl.getUniformLocation(shapeStampProg, "u_size");
  const shapeURenderSize = gl.getUniformLocation(
    shapeStampProg,
    "u_renderSize",
  );
  const shapeUSizeScale = gl.getUniformLocation(shapeStampProg, "u_sizeScale");
  const shapeUAngle = gl.getUniformLocation(shapeStampProg, "u_angle");
  const shapeUTip = gl.getUniformLocation(shapeStampProg, "u_tip");
  const shapeUSoftness = gl.getUniformLocation(shapeStampProg, "u_softness");

  // ---- Stamp program locations ----
  const aPos = gl.getAttribLocation(stampProg, "a_position");
  const aTexCoord = gl.getAttribLocation(stampProg, "a_texCoord");
  const uResolution = gl.getUniformLocation(stampProg, "u_resolution");
  const uCenter = gl.getUniformLocation(stampProg, "u_center");
  const uSize = gl.getUniformLocation(stampProg, "u_size");
  const uRenderSize = gl.getUniformLocation(stampProg, "u_renderSize");
  const uSizeScale = gl.getUniformLocation(stampProg, "u_sizeScale");
  const uAngle = gl.getUniformLocation(stampProg, "u_angle");
  const uShape = gl.getUniformLocation(stampProg, "u_shape");
  const uFlow = gl.getUniformLocation(stampProg, "u_flow");
  const uSoftness = gl.getUniformLocation(stampProg, "u_softness");
  const uColor = gl.getUniformLocation(stampProg, "u_color");
  // ---- Flat-cap program locations ----
  let flatCapAPos = -1;
  let flatCapUStroke: WebGLUniformLocation | null = null;
  let flatCapUCap: WebGLUniformLocation | null = null;
  let flatCapUDither: WebGLUniformLocation | null = null;
  if (flatCapProg) {
    flatCapAPos = gl.getAttribLocation(flatCapProg, "a_position");
    flatCapUStroke = gl.getUniformLocation(flatCapProg, "u_stroke");
    flatCapUCap = gl.getUniformLocation(flatCapProg, "u_cap");
    flatCapUDither = gl.getUniformLocation(flatCapProg, "u_dither");
  }

  // ---- Dual-stamp program locations ----
  let dualStampAPos = -1;
  let dualStampATexCoord = -1;
  let dualStampUResolution: WebGLUniformLocation | null = null;
  let dualStampUCenter: WebGLUniformLocation | null = null;
  let dualStampUSize: WebGLUniformLocation | null = null;
  let dualStampURenderSize: WebGLUniformLocation | null = null;
  let dualStampUSizeScale: WebGLUniformLocation | null = null;
  let dualStampUAngle: WebGLUniformLocation | null = null;
  let dualStampUTip1: WebGLUniformLocation | null = null;
  let dualStampUTip2: WebGLUniformLocation | null = null;
  let dualStampUFlow: WebGLUniformLocation | null = null;
  let dualStampUSoftness: WebGLUniformLocation | null = null;
  let dualStampUBlendMode: WebGLUniformLocation | null = null;
  let dualStampUColor: WebGLUniformLocation | null = null;
  let dualStampUColor2: WebGLUniformLocation | null = null;
  let dualStampUScatter2: WebGLUniformLocation | null = null;
  let dualStampUSize2Scale: WebGLUniformLocation | null = null;
  let dualStampUAngle2: WebGLUniformLocation | null = null;
  if (dualStampProg) {
    dualStampAPos = gl.getAttribLocation(dualStampProg, "a_position");
    dualStampATexCoord = gl.getAttribLocation(dualStampProg, "a_texCoord");
    dualStampUResolution = gl.getUniformLocation(dualStampProg, "u_resolution");
    dualStampUCenter = gl.getUniformLocation(dualStampProg, "u_center");
    dualStampUSize = gl.getUniformLocation(dualStampProg, "u_size");
    dualStampURenderSize = gl.getUniformLocation(dualStampProg, "u_renderSize");
    dualStampUSizeScale = gl.getUniformLocation(dualStampProg, "u_sizeScale");
    dualStampUAngle = gl.getUniformLocation(dualStampProg, "u_angle");
    dualStampUTip1 = gl.getUniformLocation(dualStampProg, "u_tip1");
    dualStampUTip2 = gl.getUniformLocation(dualStampProg, "u_tip2");
    dualStampUFlow = gl.getUniformLocation(dualStampProg, "u_flow");
    dualStampUSoftness = gl.getUniformLocation(dualStampProg, "u_softness");
    dualStampUBlendMode = gl.getUniformLocation(dualStampProg, "u_blendMode");
    dualStampUColor = gl.getUniformLocation(dualStampProg, "u_color");
    dualStampUColor2 = gl.getUniformLocation(dualStampProg, "u_color2");
    dualStampUScatter2 = gl.getUniformLocation(dualStampProg, "u_scatter2");
    dualStampUSize2Scale = gl.getUniformLocation(dualStampProg, "u_size2scale");
    dualStampUAngle2 = gl.getUniformLocation(dualStampProg, "u_angle2");
  }

  // ---- Mask-stamp program locations ----
  let msAPos = -1;
  let msATexCoord = -1;
  let msUResolution: WebGLUniformLocation | null = null;
  let msUCenter: WebGLUniformLocation | null = null;
  let msUSize: WebGLUniformLocation | null = null;
  let msURenderSize: WebGLUniformLocation | null = null;
  let msUSizeScale: WebGLUniformLocation | null = null;
  let msUAngle: WebGLUniformLocation | null = null;
  let msUShape: WebGLUniformLocation | null = null;
  let msUCapAlpha: WebGLUniformLocation | null = null;
  if (maskStampProg) {
    msAPos = gl.getAttribLocation(maskStampProg, "a_position");
    msATexCoord = gl.getAttribLocation(maskStampProg, "a_texCoord");
    msUResolution = gl.getUniformLocation(maskStampProg, "u_resolution");
    msUCenter = gl.getUniformLocation(maskStampProg, "u_center");
    msUSize = gl.getUniformLocation(maskStampProg, "u_size");
    msURenderSize = gl.getUniformLocation(maskStampProg, "u_renderSize");
    msUSizeScale = gl.getUniformLocation(maskStampProg, "u_sizeScale");
    msUAngle = gl.getUniformLocation(maskStampProg, "u_angle");
    msUShape = gl.getUniformLocation(maskStampProg, "u_shape");
    msUCapAlpha = gl.getUniformLocation(maskStampProg, "u_capAlpha");
  }

  // ---- Flush-mask program locations ----
  let fmAPos = -1;
  let fmUMask: WebGLUniformLocation | null = null;
  let fmUStroke: WebGLUniformLocation | null = null;
  let fmUDither: WebGLUniformLocation | null = null;
  let fmUOpacityCap: WebGLUniformLocation | null = null;
  if (flushMaskProg) {
    fmAPos = gl.getAttribLocation(flushMaskProg, "a_position");
    fmUMask = gl.getUniformLocation(flushMaskProg, "u_mask");
    fmUStroke = gl.getUniformLocation(flushMaskProg, "u_stroke");
    fmUDither = gl.getUniformLocation(flushMaskProg, "u_dither");
    fmUOpacityCap = gl.getUniformLocation(flushMaskProg, "u_opacityCap");
  }

  // ---- Geometry buffers ----
  const stampVbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, stampVbo);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 0, 1, 1, -1, 1, 1, -1, 1, 0, 0, 1, 1, 1, 0]),
    gl.STATIC_DRAW,
  );
  gl.bindBuffer(gl.ARRAY_BUFFER, null);

  const quadVbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadVbo);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    gl.STATIC_DRAW,
  );
  gl.bindBuffer(gl.ARRAY_BUFFER, null);

  // ---- Float FBO format constants ----
  // WebGL2: RGBA16F natively. WebGL1: RGBA/UNSIGNED_BYTE (8-bit fallback)
  const FLOAT_INTERNAL_FORMAT: number = isWebGL2 ? 0x881a : gl.RGBA; // 0x881A = RGBA16F
  const FLOAT_TYPE: number = isWebGL2 ? 0x140b : gl.UNSIGNED_BYTE; // 0x140B = HALF_FLOAT

  // ---- MAX blend constant ----
  // WebGL2: MAX is natively available (0x8008). WebGL1: requires EXT_blend_minmax.
  let MAX_BLEND: number;
  if (isWebGL2) {
    MAX_BLEND = 0x8008; // gl.MAX, native in WebGL2
  } else {
    const extMinMax = gl.getExtension("EXT_blend_minmax");
    MAX_BLEND = extMinMax ? extMinMax.MAX_EXT : 0x8008;
  }

  // ---- FBOs ----
  let usingFloatFBO = false;
  let strokeFBO = makeFBO(gl, width, height, FLOAT_INTERNAL_FORMAT, FLOAT_TYPE);
  if (!strokeFBO) {
    strokeFBO = makeFBO(gl, width, height);
  } else {
    usingFloatFBO = true;
  }

  // Shape FBO: written once per stamp with raw tip alpha (no flow, no color, no opacity).
  // Both strokeFBO and opacityFBO read from this via u_shape.
  let shapeFBO = usingFloatFBO
    ? makeFBO(gl, width, height, FLOAT_INTERNAL_FORMAT, FLOAT_TYPE)
    : makeFBO(gl, width, height);

  // Opacity FBO: always present. Accumulates tip-shaped opacity envelope via MAX blend.
  // capAlpha = pressure*opacitySlider when pressure→opacity is on, = opacitySlider otherwise.
  let opacityFBO = usingFloatFBO
    ? makeFBO(gl, width, height, FLOAT_INTERNAL_FORMAT, FLOAT_TYPE)
    : makeFBO(gl, width, height);

  // _maskHasData is always true after the first stamp — FLUSH_MASK_FRAG is always used.
  let _maskHasData = false;

  // ---- State ----
  const texCache = new Map<string, WebGLTexture>();
  let lastCustomTipKey: string | null = null;

  // Blend state cache
  type BlendMode =
    | "additive"
    | "max"
    | "none"
    | "source_over"
    | "source_over_max_alpha";
  let currentBlend: BlendMode = "none";

  function setBlend(mode: BlendMode) {
    if (mode === currentBlend) return;
    if (mode === "none") {
      gl.disable(gl.BLEND);
    } else {
      if (currentBlend === "none") gl.enable(gl.BLEND);
      if (mode === "additive") {
        gl.blendEquationSeparate(gl.FUNC_ADD, gl.FUNC_ADD);
        gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ONE, gl.ONE);
      } else if (mode === "source_over") {
        gl.blendEquationSeparate(gl.FUNC_ADD, gl.FUNC_ADD);
        gl.blendFuncSeparate(
          gl.ONE,
          gl.ONE_MINUS_SRC_ALPHA,
          gl.ONE,
          gl.ONE_MINUS_SRC_ALPHA,
        );
      } else if (mode === "source_over_max_alpha") {
        // RGB: standard premultiplied source-over (color accumulates correctly)
        // Alpha: MAX — alpha can only ever increase, prevents light slivers at crossings
        gl.blendEquationSeparate(gl.FUNC_ADD, MAX_BLEND);
        gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE);
      } else {
        // max blend
        gl.blendEquationSeparate(MAX_BLEND, MAX_BLEND);
        gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ONE, gl.ONE);
      }
    }
    currentBlend = mode;
  }

  // Uniform caches
  let _resW = -1;
  let _resH = -1;
  let _softness = -1;
  let _flow = -1;
  let _size = -1;
  let _renderSize = -1;
  let _sizeScale = -1;
  let _angle = -999;
  let _activeTex: WebGLTexture | null = null;
  let _stampProgSetup = false;

  // Shape stamp uniform caches
  let _shapeProgSetup = false;
  let _shapeResW = -1;
  let _shapeResH = -1;
  let _shapeSize = -1;
  let _shapeRenderSize = -1;
  let _shapeSizeScale = -1;
  let _shapeAngle = -999;
  let _shapeActiveTex: WebGLTexture | null = null;

  // Dual stamp uniform caches
  let _dResW = -1;
  let _dResH = -1;
  let _dSize = -1;
  let _dRenderSize = -1;
  let _dSizeScale = -1;
  let _dAngle = -999;
  let _dFlow = -1;
  let _dSoftness = -1;
  let _dBlendMode = -1;
  let _dActiveTex1: WebGLTexture | null = null;
  let _dActiveTex2: WebGLTexture | null = null;

  // Capped stamp uniform caches

  let _csAngle = -999;
  let _csFlow = -1;
  let _csSoftness = -1;
  let _csActiveTex: WebGLTexture | null = null;

  // Capped dual-stamp uniform caches
  let _cdResW = -1;
  let _cdResH = -1;
  let _cdSize = -1;
  let _cdRenderSize = -1;
  let _cdSizeScale = -1;
  let _cdAngle = -999;
  let _cdFlow = -1;
  let _cdSoftness = -1;
  let _cdActiveTex1: WebGLTexture | null = null;
  let _cdActiveTex2: WebGLTexture | null = null;

  // Mask-stamp uniform caches
  let _msProgSetup = false;
  let _msResW = -1;
  let _msResH = -1;
  let _msSize = -1;
  let _msRenderSize = -1;
  let _msSizeScale = -1;
  let _msAngle = -999;
  let _msActiveShape: WebGLTexture | null = null;

  // Writes raw tip alpha into shapeFBO. Uses "none" blend — overwritten each stamp.
  // This is the sole shape authority for both doStamp and doMaskStamp.
  function doShapeStamp(
    x: number,
    y: number,
    size: number,
    tex: WebGLTexture,
    angle: number,
    softness: number,
  ) {
    if (!shapeFBO || !shapeStampProg) return;

    if (!_shapeProgSetup) {
      // biome-ignore lint/correctness/useHookAtTopLevel: WebGL API, not React
      gl.useProgram(shapeStampProg);
      gl.bindBuffer(gl.ARRAY_BUFFER, stampVbo);
      const stride = 4 * 4;
      gl.enableVertexAttribArray(shapeAPos);
      gl.vertexAttribPointer(shapeAPos, 2, gl.FLOAT, false, stride, 0);
      gl.enableVertexAttribArray(shapeATexCoord);
      gl.vertexAttribPointer(shapeATexCoord, 2, gl.FLOAT, false, stride, 8);
      _shapeProgSetup = true;
    }

    if (canvas.width !== _shapeResW || canvas.height !== _shapeResH) {
      gl.uniform2f(shapeUResolution, canvas.width, canvas.height);
      _shapeResW = canvas.width;
      _shapeResH = canvas.height;
    }
    gl.uniform2f(shapeUCenter, x, y);
    if (size !== _shapeSize) {
      gl.uniform1f(shapeUSize, size);
      _shapeSize = size;
    }
    const renderSize = Math.max(size, 2.0);
    const sizeScale = renderSize / size;
    if (renderSize !== _shapeRenderSize) {
      gl.uniform1f(shapeURenderSize, renderSize);
      _shapeRenderSize = renderSize;
    }
    if (sizeScale !== _shapeSizeScale) {
      gl.uniform1f(shapeUSizeScale, sizeScale);
      _shapeSizeScale = sizeScale;
    }
    if (angle !== _shapeAngle) {
      gl.uniform1f(shapeUAngle, angle);
      _shapeAngle = angle;
    }
    if (softness !== _softness) {
      gl.uniform1f(shapeUSoftness, softness);
      // Note: _softness is shared — we update it here so the stamp prog cache stays valid
      _softness = softness;
    }
    if (tex !== _shapeActiveTex) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(shapeUTip, 0);
      _shapeActiveTex = tex;
    }

    // Write unconditionally — shapeFBO is overwritten each stamp, not accumulated
    gl.bindFramebuffer(gl.FRAMEBUFFER, shapeFBO.fbo);
    setBlend("none");
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    // Use additive for the actual draw so we get the full tip alpha written
    setBlend("additive");
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.activeTexture(gl.TEXTURE0);

    // Reset setup flags so next stamp re-binds correctly
    _shapeProgSetup = false;
    _stampProgSetup = false;
    _msProgSetup = false;
    _dualStampProgSetup = false;
  }

  // Stamps tipAlpha * capAlpha into opacityFBO using MAX blend.
  // Reads tip shape from shapeFBO (u_shape) — does NOT re-sample u_tip.
  // capAlpha = pressure*opacitySlider when pressure→opacity is on, = opacitySlider otherwise.
  function doMaskStamp(
    x: number,
    y: number,
    size: number,
    capAlpha: number,
    angle: number,
  ) {
    if (!maskStampProg || !opacityFBO || !shapeFBO) return;

    if (!_msProgSetup) {
      // biome-ignore lint/correctness/useHookAtTopLevel: WebGL API, not React
      gl.useProgram(maskStampProg);
      gl.bindBuffer(gl.ARRAY_BUFFER, stampVbo);
      const stride = 4 * 4;
      gl.enableVertexAttribArray(msAPos);
      gl.vertexAttribPointer(msAPos, 2, gl.FLOAT, false, stride, 0);
      gl.enableVertexAttribArray(msATexCoord);
      gl.vertexAttribPointer(msATexCoord, 2, gl.FLOAT, false, stride, 8);
      _msProgSetup = true;
    }

    if (canvas.width !== _msResW || canvas.height !== _msResH) {
      gl.uniform2f(msUResolution, canvas.width, canvas.height);
      _msResW = canvas.width;
      _msResH = canvas.height;
    }
    gl.uniform2f(msUCenter, x, y);
    if (size !== _msSize) {
      gl.uniform1f(msUSize, size);
      _msSize = size;
    }
    const renderSize = Math.max(size, 2.0);
    const sizeScale = renderSize / size;
    if (renderSize !== _msRenderSize) {
      gl.uniform1f(msURenderSize, renderSize);
      _msRenderSize = renderSize;
    }
    if (sizeScale !== _msSizeScale) {
      gl.uniform1f(msUSizeScale, sizeScale);
      _msSizeScale = sizeScale;
    }
    if (angle !== _msAngle) {
      gl.uniform1f(msUAngle, angle);
      _msAngle = angle;
    }
    gl.uniform1f(msUCapAlpha, capAlpha);

    // Bind shapeFBO texture to TEXTURE1 for u_shape
    if (shapeFBO.tex !== _msActiveShape) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, shapeFBO.tex);
      gl.uniform1i(msUShape, 1);
      _msActiveShape = shapeFBO.tex;
    }

    // Render into opacityFBO using MAX blend — each pixel holds the highest
    // capAlpha ever written there across the stroke.
    gl.bindFramebuffer(gl.FRAMEBUFFER, opacityFBO.fbo);
    setBlend("max");
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // Restore state
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);

    // Mark mask as having data this stroke
    _maskHasData = true;

    // Reset setup flags so next stamp re-binds correctly
    _msProgSetup = false;
    _stampProgSetup = false;
    _dualStampProgSetup = false;
  }

  function setupStampProg() {
    if (_stampProgSetup) return;
    // biome-ignore lint/correctness/useHookAtTopLevel: WebGL API, not React
    gl.useProgram(stampProg);
    gl.bindBuffer(gl.ARRAY_BUFFER, stampVbo);
    const stride = 4 * 4;
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(aTexCoord);
    gl.vertexAttribPointer(aTexCoord, 2, gl.FLOAT, false, stride, 8);
    _stampProgSetup = true;
  }

  function doStamp(
    x: number,
    y: number,
    size: number,
    flow: number,
    angle: number,
    softness: number,
    r: number,
    g: number,
    b: number,
  ) {
    setupStampProg();
    if (canvas.width !== _resW || canvas.height !== _resH) {
      gl.uniform2f(uResolution, canvas.width, canvas.height);
      _resW = canvas.width;
      _resH = canvas.height;
    }
    gl.uniform2f(uCenter, x, y);
    if (size !== _size) {
      gl.uniform1f(uSize, size);
      _size = size;
    }
    // Ensure the quad is at least 2px so it reliably covers pixel centers.
    const renderSize = Math.max(size, 2.0);
    const sizeScale = renderSize / size;
    if (renderSize !== _renderSize) {
      gl.uniform1f(uRenderSize, renderSize);
      _renderSize = renderSize;
    }
    if (sizeScale !== _sizeScale) {
      gl.uniform1f(uSizeScale, sizeScale);
      _sizeScale = sizeScale;
    }
    if (angle !== _angle) {
      gl.uniform1f(uAngle, angle);
      _angle = angle;
    }
    if (flow !== _flow) {
      gl.uniform1f(uFlow, flow);
      _flow = flow;
    }
    if (softness !== _softness) {
      gl.uniform1f(uSoftness, softness);
      _softness = softness;
    }
    gl.uniform3f(uColor, r, g, b);

    // Bind shapeFBO texture to TEXTURE1 for u_shape
    if (shapeFBO && shapeFBO.tex !== _activeTex) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, shapeFBO.tex);
      gl.uniform1i(uShape, 1);
      _activeTex = shapeFBO.tex;
    }

    gl.activeTexture(gl.TEXTURE0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // Unbind TEXTURE1
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
  }

  let _dualStampProgSetup = false;

  function setupDualStampProg() {
    if (_dualStampProgSetup || !dualStampProg) return;
    // biome-ignore lint/correctness/useHookAtTopLevel: WebGL API, not React
    gl.useProgram(dualStampProg);
    gl.bindBuffer(gl.ARRAY_BUFFER, stampVbo);
    const stride = 4 * 4;
    gl.enableVertexAttribArray(dualStampAPos);
    gl.vertexAttribPointer(dualStampAPos, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(dualStampATexCoord);
    gl.vertexAttribPointer(dualStampATexCoord, 2, gl.FLOAT, false, stride, 8);
    _dualStampProgSetup = true;
  }

  function doDualStamp(
    x: number,
    y: number,
    size: number,
    flow: number,
    tex1: WebGLTexture,
    tex2: WebGLTexture,
    angle: number,
    softness: number,
    blendModeInt: number,
    r: number,
    g: number,
    b: number,
    r2?: number,
    g2?: number,
    b2?: number,
    scatter2: [number, number] = [0, 0],
    size2scale = 1.0,
    angle2 = 0.0,
  ) {
    if (!dualStampProg) return;
    setupDualStampProg();
    if (canvas.width !== _dResW || canvas.height !== _dResH) {
      gl.uniform2f(dualStampUResolution, canvas.width, canvas.height);
      _dResW = canvas.width;
      _dResH = canvas.height;
    }
    gl.uniform2f(dualStampUCenter, x, y); // always update: changes every stamp
    if (size !== _dSize) {
      gl.uniform1f(dualStampUSize, size);
      _dSize = size;
    }
    // Same sub-pixel fix as doStamp: enlarge quad to 2px minimum.
    const dRenderSize = Math.max(size, 2.0);
    const dSizeScale = dRenderSize / size;
    if (dRenderSize !== _dRenderSize) {
      gl.uniform1f(dualStampURenderSize, dRenderSize);
      _dRenderSize = dRenderSize;
    }
    if (dSizeScale !== _dSizeScale) {
      gl.uniform1f(dualStampUSizeScale, dSizeScale);
      _dSizeScale = dSizeScale;
    }
    if (angle !== _dAngle) {
      gl.uniform1f(dualStampUAngle, angle);
      _dAngle = angle;
    }
    if (flow !== _dFlow) {
      gl.uniform1f(dualStampUFlow, flow);
      _dFlow = flow;
    }
    if (softness !== _dSoftness) {
      gl.uniform1f(dualStampUSoftness, softness);
      _dSoftness = softness;
    }
    if (blendModeInt !== _dBlendMode) {
      gl.uniform1i(dualStampUBlendMode, blendModeInt);
      _dBlendMode = blendModeInt;
    }
    gl.uniform3f(dualStampUColor, r, g, b); // per-stamp color jitter
    gl.uniform3f(dualStampUColor2, r2 ?? r, g2 ?? g, b2 ?? b);
    if (tex1 !== _dActiveTex1) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex1);
      gl.uniform1i(dualStampUTip1, 0);
      _dActiveTex1 = tex1;
    }
    if (tex2 !== _dActiveTex2) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, tex2);
      gl.uniform1i(dualStampUTip2, 1);
      _dActiveTex2 = tex2;
    }
    // Per-stamp dual tip scatter, size, angle uniforms
    if (dualStampUScatter2)
      gl.uniform2f(dualStampUScatter2, scatter2[0], scatter2[1]);
    if (dualStampUSize2Scale) gl.uniform1f(dualStampUSize2Scale, size2scale);
    if (dualStampUAngle2) gl.uniform1f(dualStampUAngle2, angle2);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
  }

  function getOrBuildTexture(
    tipImageData: string | null,
    defaultTipCanvas: HTMLCanvasElement | null,
  ): WebGLTexture | null {
    const key = tipImageData ? tipImageData : "default";
    if (texCache.has(key)) return texCache.get(key)!;
    if (tipImageData) {
      buildTipTextureFromDataUrl(gl, tipImageData, texCache, key);
      return null;
    }
    if (defaultTipCanvas) {
      const t = buildTipTexture(gl, defaultTipCanvas);
      if (t) {
        texCache.set("default", t);
        return t;
      }
    }
    const t = buildDefaultCircleTexture(gl);
    if (t) texCache.set("default", t);
    return t;
  }

  // Flat cap texture: solid disc for cap FBO stamping (no tip-edge interference)
  // ---- Init ----
  gl.viewport(0, 0, width, height);
  gl.enable(gl.BLEND);
  gl.blendEquationSeparate(gl.FUNC_ADD, gl.FUNC_ADD);
  gl.blendFuncSeparate(
    gl.ONE,
    gl.ONE_MINUS_SRC_ALPHA,
    gl.ONE,
    gl.ONE_MINUS_SRC_ALPHA,
  );
  currentBlend = "source_over";
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);

  return {
    canvas,
    isWebGL2,

    clear() {
      if (strokeFBO) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, strokeFBO.fbo);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
      if (opacityFBO) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, opacityFBO.fbo);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
      if (shapeFBO) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, shapeFBO.fbo);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
      // opacityFBO is always populated — mark data as present from stroke start
      _maskHasData = true;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    },

    clearMask() {
      // Clear the opacity mask FBO after stroke commit.
      // Must be called after flushStrokeBuffer to avoid clearing before final display.
      // Do NOT clear shapeFBO here — it is overwritten per-stamp anyway.
      if (opacityFBO) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, opacityFBO.fbo);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      }
      _maskHasData = false;
    },

    hasMaskData(): boolean {
      return _maskHasData;
    },

    resize(w: number, h: number) {
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
      _resW = -1;
      _resH = -1;
      _size = -1;
      _renderSize = -1;
      _sizeScale = -1;
      _dResW = -1;
      _dResH = -1;
      _dSize = -1;
      _dRenderSize = -1;
      _dSizeScale = -1;
      _msResW = -1;
      _msResH = -1;
      _msSize = -1;
      _msRenderSize = -1;
      _msSizeScale = -1;
      _shapeResW = -1;
      _shapeResH = -1;
      _shapeSize = -1;
      _shapeRenderSize = -1;
      _shapeSizeScale = -1;
      const fboIF = usingFloatFBO ? FLOAT_INTERNAL_FORMAT : gl.RGBA;
      const fboType = usingFloatFBO ? FLOAT_TYPE : gl.UNSIGNED_BYTE;
      if (strokeFBO) resizeFBOTex(gl, strokeFBO.tex, w, h, fboIF, fboType);
      if (opacityFBO) resizeFBOTex(gl, opacityFBO.tex, w, h, fboIF, fboType);
      if (shapeFBO) resizeFBOTex(gl, shapeFBO.tex, w, h, fboIF, fboType);
      // Clear each FBO after resize — resizeFBOTex reallocates texture storage with
      // undefined content. Leaving FBOs dirty causes GL errors and visual glitches
      // when a stroke is started immediately after resize.
      gl.clearColor(0, 0, 0, 0);
      if (strokeFBO) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, strokeFBO.fbo);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
      if (opacityFBO) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, opacityFBO.fbo);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
      if (shapeFBO) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, shapeFBO.fbo);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
      _maskHasData = false;
      _activeTex = null;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.clear(gl.COLOR_BUFFER_BIT);
      // Re-apply viewport after all FBO work — some drivers reset it on FBO bind
      gl.viewport(0, 0, w, h);
    },

    stamp(
      x,
      y,
      size,
      opacity, // = flow (per-stamp alpha) — unconditionally used, no pressure gating
      r,
      g,
      b, // brush color — cached for composite shader
      tipImageData,
      angle,
      defaultTipCanvas,
      softness,
      dualTipEnabled,
      dualTipImageData,
      dualTipBlendMode,
      dualR,
      dualG,
      dualB,
      dualScatterX = 0,
      dualScatterY = 0,
      dualSize2Scale = 1.0,
      dualAngle2 = 0.0,
      capAlpha = undefined as number | undefined,
    ) {
      if (!strokeFBO) return;
      const tex = getOrBuildTexture(tipImageData, defaultTipCanvas);
      if (!tex) return;

      // STEP 5: stampFlow is always the opacity parameter — no gating on capAlpha.
      // Flow is independent of pressure mode. The opacity ceiling is handled by opacityFBO.
      const stampFlow = opacity;

      // STEP 3g: doShapeStamp FIRST — writes raw tip alpha into shapeFBO.
      // Both doStamp and doMaskStamp read from shapeFBO, so shape is computed once.
      doShapeStamp(x, y, size, tex, angle, softness);

      // STEP 2d: doMaskStamp always fires. capAlpha is always a numeric value:
      //   - When capAlpha is provided (pressure→opacity on): use it directly
      //   - When capAlpha is undefined (pressure→opacity off): use opacity as ceiling
      // This ensures opacityFBO always has a valid ceiling regardless of pressure mode.
      const maskCapAlpha = capAlpha !== undefined ? capAlpha : opacity;
      doMaskStamp(x, y, size, maskCapAlpha, angle);

      // Draw stamp into stroke FBO using source-over blend (always).
      // source-over allows stamps to accumulate — flow controls per-stamp deposit rate.
      gl.bindFramebuffer(gl.FRAMEBUFFER, strokeFBO.fbo);
      setBlend("source_over");

      if (dualTipEnabled && dualTipImageData && dualStampProg) {
        const tex2 = getOrBuildTexture(dualTipImageData, null);
        if (tex2) {
          const blendModeMap: Record<string, number> = {
            multiply: 0,
            screen: 1,
            overlay: 2,
            darken: 3,
            lighten: 4,
          };
          const blendModeInt =
            blendModeMap[dualTipBlendMode ?? "multiply"] ?? 0;
          doDualStamp(
            x,
            y,
            size,
            stampFlow,
            tex,
            tex2,
            angle,
            softness,
            blendModeInt,
            r,
            g,
            b,
            dualR,
            dualG,
            dualB,
            [dualScatterX, dualScatterY],
            dualSize2Scale,
            dualAngle2,
          );
          // After using dualStampProg, reset both setup flags so the next stamp
          // (whether regular or dual) will re-bind its attribute arrays correctly.
          _stampProgSetup = false;
          _dualStampProgSetup = false;
        } else {
          doStamp(x, y, size, stampFlow, angle, softness, r, g, b);
        }
      } else {
        doStamp(x, y, size, stampFlow, angle, softness, r, g, b);
      }

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    },

    flushDisplay(opacityCap: number) {
      if (!strokeFBO) return;

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      setBlend("none");
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      _stampProgSetup = false;
      _dualStampProgSetup = false;
      _msProgSetup = false;
      _shapeProgSetup = false;
      _renderSize = -1;
      _sizeScale = -1;
      _dActiveTex1 = null;
      _dActiveTex2 = null;
      _msActiveShape = null;

      // Always use FLUSH_MASK_FRAG path — opacityFBO is always populated.
      // min(strokeFBO, opacityFBO) gives the opacity-capped result for all modes.
      if (_maskHasData && flushMaskProg && opacityFBO) {
        // biome-ignore lint/correctness/useHookAtTopLevel: WebGL API, not React
        gl.useProgram(flushMaskProg);
        gl.bindBuffer(gl.ARRAY_BUFFER, quadVbo);
        gl.enableVertexAttribArray(fmAPos);
        gl.vertexAttribPointer(fmAPos, 2, gl.FLOAT, false, 0, 0);

        // Opacity FBO (ceiling) on TEXTURE0, stroke FBO (color + coverage) on TEXTURE1.
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, opacityFBO.tex);
        gl.uniform1i(fmUMask, 0);

        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, strokeFBO.tex);
        gl.uniform1i(fmUStroke, 1);

        // Hard ceiling: clamps final alpha to the opacity slider value in the shader.
        gl.uniform1f(fmUOpacityCap, opacityCap);
        gl.uniform1f(fmUDither, 1.0);

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        // Unbind texture units
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, null);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, null);
      } else if (flatCapProg) {
        // Fallback path (dead code in practice — _maskHasData is always true after first stamp)
        // biome-ignore lint/correctness/useHookAtTopLevel: WebGL API, not React
        gl.useProgram(flatCapProg);
        gl.bindBuffer(gl.ARRAY_BUFFER, quadVbo);
        gl.enableVertexAttribArray(flatCapAPos);
        gl.vertexAttribPointer(flatCapAPos, 2, gl.FLOAT, false, 0, 0);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, strokeFBO.tex);
        gl.uniform1i(flatCapUStroke, 0);
        gl.uniform1f(flatCapUCap, opacityCap);
        gl.uniform1f(flatCapUDither, 1.0);

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, null);
      }

      _activeTex = null;
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      setBlend("source_over");
      gl.flush(); // submit GPU commands immediately (reduces latency on iOS Safari)
    },

    preloadTipTexture(tipImageData: string) {
      const key = tipImageData;
      if (lastCustomTipKey !== null && lastCustomTipKey !== key) {
        const oldTex = texCache.get(lastCustomTipKey);
        if (oldTex) gl.deleteTexture(oldTex);
        texCache.delete(lastCustomTipKey);
      }
      if (!texCache.has(key)) {
        buildTipTextureFromDataUrl(gl, tipImageData, texCache, key);
      }
      lastCustomTipKey = key;
    },
    dispose() {
      for (const t of texCache.values()) gl.deleteTexture(t);
      texCache.clear();
      if (strokeFBO) {
        gl.deleteFramebuffer(strokeFBO.fbo);
        gl.deleteTexture(strokeFBO.tex);
        strokeFBO = null;
      }
      if (opacityFBO) {
        gl.deleteFramebuffer(opacityFBO.fbo);
        gl.deleteTexture(opacityFBO.tex);
        opacityFBO = null;
      }
      if (shapeFBO) {
        gl.deleteFramebuffer(shapeFBO.fbo);
        gl.deleteTexture(shapeFBO.tex);
        shapeFBO = null;
      }
      if (stampVbo) gl.deleteBuffer(stampVbo);
      if (quadVbo) gl.deleteBuffer(quadVbo);
      if (shapeStampProg) gl.deleteProgram(shapeStampProg);
      if (stampProg) gl.deleteProgram(stampProg);
      if (flatCapProg) gl.deleteProgram(flatCapProg);
      if (dualStampProg) gl.deleteProgram(dualStampProg);
      if (maskStampProg) gl.deleteProgram(maskStampProg);
      if (flushMaskProg) gl.deleteProgram(flushMaskProg);
    },
  };
}
