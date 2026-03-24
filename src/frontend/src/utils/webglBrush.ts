// ============================================================
// webglBrush.ts — Stamp-based WebGL brush engine
//
// Model:
//   • Each stamp writes ONLY its alpha mask (tipAlpha × flow × softness)
//     into the stroke FBO via source-over blending.
//     The brush color is NOT premultiplied into the stroke FBO.
//     Source-over accumulation: out.a = src.a + dst.a × (1 − src.a).
//     This produces a smooth, continuous alpha surface — alpha asymptotes
//     to 1.0 without hard clipping at crossings. When a soft stamp edge
//     (alpha=0.2) lands on existing paint (alpha=0.8):
//       out = 0.2 + 0.8 × (1−0.2) = 0.84  ← smooth transition, no seam.
//     With additive blending the same scenario would clamp: 0.2 + 0.8 = 1.0,
//     creating a hard visible step at the crossing boundary.
//   • flushDisplay() reads the accumulated alpha from the stroke FBO,
//     multiplies by the opacity cap (NOT min), then outputs vec4(brushColor, scaledAlpha).
//     Multiplication avoids the hard threshold that min() creates at the cap boundary.
//   • Pressure → Opacity uses a cap FBO (MAX blend) tracking the
//     highest pressure-weighted alpha envelope per pixel.
// ============================================================

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
    capAlpha?: number,
    dualTipEnabled?: boolean,
    dualTipImageData?: string | null,
    dualTipBlendMode?: string,
    dualR?: number,
    dualG?: number,
    dualB?: number,
  ): void;
  flushDisplay(opacityCap: number): void;
  setMaxAlphaMode(enabled: boolean): void;
  setCapMode(enabled: boolean): void;
  dispose(): void;
}

// ----- Shader sources -----

const STAMP_VERT = `
attribute vec2 a_position;
attribute vec2 a_texCoord;
uniform vec2 u_resolution;
uniform vec2 u_center;
uniform float u_size;
uniform float u_angle;
varying vec2 v_texCoord;
void main() {
  float c = cos(u_angle);
  float s = sin(u_angle);
  vec2 rotated = vec2(
    a_position.x * c - a_position.y * s,
    a_position.x * s + a_position.y * c
  );
  vec2 pos = rotated * u_size * 0.5 + u_center;
  vec2 clipSpace = (pos / u_resolution) * 2.0 - 1.0;
  gl_Position = vec4(clipSpace * vec2(1.0, -1.0), 0.0, 1.0);
  v_texCoord = a_texCoord;
}
`;

// Stamp shader: outputs ONLY the alpha mask.
// The brush color is not stored here; it is applied in the composite shader.
// This prevents RGB channel saturation (white halos) at stroke crossings.
const STAMP_FRAG = `
precision mediump float;
uniform sampler2D u_tip;
uniform float u_flow;
uniform float u_softness;
uniform vec3 u_color;
varying vec2 v_texCoord;
void main() {
  vec2 uv = v_texCoord;
  // tip texture: R=0 (black) = fully opaque, R=1 (white) = fully transparent
  float tipAlpha = 1.0 - texture2D(u_tip, uv).r;

  if (u_softness > 0.0) {
    vec2 centered = uv * 2.0 - 1.0;
    float dist = length(centered);
    float sigma = 1.0 - u_softness * 0.85;
    float gaussian = exp(-dist * dist / (2.0 * sigma * sigma));
    tipAlpha *= gaussian;
  }

  float alpha = tipAlpha * u_flow;
  // Write premultiplied RGBA so each stamp carries its own color.
  gl_FragColor = vec4(u_color * alpha, alpha);
}
`;
const DUAL_STAMP_FRAG = `
precision mediump float;
uniform sampler2D u_tip1;
uniform sampler2D u_tip2;
uniform float u_flow;
uniform float u_softness;
uniform int u_blendMode;
uniform vec3 u_color;
uniform vec3 u_color2;
varying vec2 v_texCoord;
void main() {
  vec2 uv = v_texCoord;
  float a1 = 1.0 - texture2D(u_tip1, uv).r;
  float a2 = 1.0 - texture2D(u_tip2, uv).r;
  if (u_softness > 0.0) {
    vec2 centered = uv * 2.0 - 1.0;
    float dist = length(centered);
    float sigma = 1.0 - u_softness * 0.85;
    float gaussian = exp(-dist * dist / (2.0 * sigma * sigma));
    a1 *= gaussian;
    a2 *= gaussian;
  }
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

// Dual-FBO composite: pressure-variable opacity cap per pixel.
// Applies brush color fresh from u_color — no premultiplied RGB in stroke FBO.
// Uses multiplication instead of min() to avoid seams at the cap threshold.
const DUAL_CAP_FRAG = `
precision mediump float;
uniform sampler2D u_stroke;
uniform sampler2D u_cap;
varying vec2 v_uv;
void main() {
  vec4 strokeSample = texture2D(u_stroke, v_uv);
  float accAlpha = strokeSample.a;
  vec3 premultRGB = strokeSample.rgb;
  float capAlpha = texture2D(u_cap, v_uv).a;
  float scaledAlpha = accAlpha * capAlpha;
  vec3 color = accAlpha > 0.001 ? premultRGB / accAlpha : vec3(0.0);
  gl_FragColor = vec4(color, scaledAlpha);
}
`;

// Flat-cap composite: uniform opacity cap for the whole stroke.
// Applies brush color fresh from u_color.
// Uses multiplication instead of min() to avoid seams at the cap threshold.
// With accAlpha approaching 1.0 in fully-painted areas, the result at full
// coverage is exactly u_cap, matching the expected opacity ceiling.
const FLAT_CAP_FRAG = `
precision mediump float;
uniform sampler2D u_stroke;
uniform float u_cap;
varying vec2 v_uv;
void main() {
  vec4 strokeSample = texture2D(u_stroke, v_uv);
  float accAlpha = strokeSample.a;
  vec3 premultRGB = strokeSample.rgb;
  float scaledAlpha = accAlpha * u_cap;
  vec3 color = accAlpha > 0.001 ? premultRGB / accAlpha : vec3(0.0);
  gl_FragColor = vec4(color, scaledAlpha);
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
): { fbo: WebGLFramebuffer; tex: WebGLTexture } | null {
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
    null,
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
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
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { fbo, tex };
}

function resizeFBOTex(
  gl: WebGLRenderingContext,
  tex: WebGLTexture,
  w: number,
  h: number,
) {
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
    const lum = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
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

function buildTipTextureFromDataUrl(
  gl: WebGLRenderingContext,
  dataUrl: string,
  cache: Map<string, WebGLTexture>,
  cacheKey: string,
): void {
  const img = new Image();
  img.onload = () => {
    const SIZE = 128;
    const tmp = document.createElement("canvas");
    tmp.width = tmp.height = SIZE;
    const ctx2 = tmp.getContext("2d", { willReadFrequently: true });
    if (!ctx2) return;
    ctx2.drawImage(img, 0, 0, SIZE, SIZE);
    const imgData = ctx2.getImageData(0, 0, SIZE, SIZE);
    const d = imgData.data;
    const rgba = new Uint8Array(SIZE * SIZE * 4);
    for (let i = 0; i < SIZE * SIZE; i++) {
      const lum =
        0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
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
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = (x - center) / center;
      const dy = (y - center) / center;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const opaque = dist <= 1.0 ? Math.max(0, 1 - dist) : 0;
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

  const glMaybe = canvas.getContext("webgl", {
    premultipliedAlpha: false,
    alpha: true,
    antialias: false,
    preserveDrawingBuffer: true,
  }) as WebGLRenderingContext | null;
  if (!glMaybe) return null;
  const gl: WebGLRenderingContext = glMaybe;

  // ---- Shader programs ----
  const stampProg = linkProgram(gl, STAMP_VERT, STAMP_FRAG);
  if (!stampProg) return null;
  const dualCapProg = linkProgram(gl, QUAD_VERT, DUAL_CAP_FRAG);
  const flatCapProg = linkProgram(gl, QUAD_VERT, FLAT_CAP_FRAG);
  const dualStampProg = linkProgram(gl, STAMP_VERT, DUAL_STAMP_FRAG);

  // ---- Stamp program locations ----
  const aPos = gl.getAttribLocation(stampProg, "a_position");
  const aTexCoord = gl.getAttribLocation(stampProg, "a_texCoord");
  const uResolution = gl.getUniformLocation(stampProg, "u_resolution");
  const uCenter = gl.getUniformLocation(stampProg, "u_center");
  const uSize = gl.getUniformLocation(stampProg, "u_size");
  const uAngle = gl.getUniformLocation(stampProg, "u_angle");
  const uTip = gl.getUniformLocation(stampProg, "u_tip");
  const uFlow = gl.getUniformLocation(stampProg, "u_flow");
  const uSoftness = gl.getUniformLocation(stampProg, "u_softness");
  const uColor = gl.getUniformLocation(stampProg, "u_color");

  // ---- Dual-cap program locations ----
  let dualCapAPos = -1;
  let dualCapUStroke: WebGLUniformLocation | null = null;
  let dualCapUCap: WebGLUniformLocation | null = null;
  if (dualCapProg) {
    dualCapAPos = gl.getAttribLocation(dualCapProg, "a_position");
    dualCapUStroke = gl.getUniformLocation(dualCapProg, "u_stroke");
    dualCapUCap = gl.getUniformLocation(dualCapProg, "u_cap");
  }

  // ---- Flat-cap program locations ----
  let flatCapAPos = -1;
  let flatCapUStroke: WebGLUniformLocation | null = null;
  let flatCapUCap: WebGLUniformLocation | null = null;
  if (flatCapProg) {
    flatCapAPos = gl.getAttribLocation(flatCapProg, "a_position");
    flatCapUStroke = gl.getUniformLocation(flatCapProg, "u_stroke");
    flatCapUCap = gl.getUniformLocation(flatCapProg, "u_cap");
  }

  // ---- Dual-stamp program locations ----
  let dualStampAPos = -1;
  let dualStampATexCoord = -1;
  let dualStampUResolution: WebGLUniformLocation | null = null;
  let dualStampUCenter: WebGLUniformLocation | null = null;
  let dualStampUSize: WebGLUniformLocation | null = null;
  let dualStampUAngle: WebGLUniformLocation | null = null;
  let dualStampUTip1: WebGLUniformLocation | null = null;
  let dualStampUTip2: WebGLUniformLocation | null = null;
  let dualStampUFlow: WebGLUniformLocation | null = null;
  let dualStampUSoftness: WebGLUniformLocation | null = null;
  let dualStampUBlendMode: WebGLUniformLocation | null = null;
  let dualStampUColor: WebGLUniformLocation | null = null;
  let dualStampUColor2: WebGLUniformLocation | null = null;
  if (dualStampProg) {
    dualStampAPos = gl.getAttribLocation(dualStampProg, "a_position");
    dualStampATexCoord = gl.getAttribLocation(dualStampProg, "a_texCoord");
    dualStampUResolution = gl.getUniformLocation(dualStampProg, "u_resolution");
    dualStampUCenter = gl.getUniformLocation(dualStampProg, "u_center");
    dualStampUSize = gl.getUniformLocation(dualStampProg, "u_size");
    dualStampUAngle = gl.getUniformLocation(dualStampProg, "u_angle");
    dualStampUTip1 = gl.getUniformLocation(dualStampProg, "u_tip1");
    dualStampUTip2 = gl.getUniformLocation(dualStampProg, "u_tip2");
    dualStampUFlow = gl.getUniformLocation(dualStampProg, "u_flow");
    dualStampUSoftness = gl.getUniformLocation(dualStampProg, "u_softness");
    dualStampUBlendMode = gl.getUniformLocation(dualStampProg, "u_blendMode");
    dualStampUColor = gl.getUniformLocation(dualStampProg, "u_color");
    dualStampUColor2 = gl.getUniformLocation(dualStampProg, "u_color2");
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

  // ---- FBOs ----
  let strokeFBO = makeFBO(gl, width, height);
  let capFBO = makeFBO(gl, width, height);

  // ---- EXT_blend_minmax for MAX blend (cap FBO) ----
  const extMinMax = gl.getExtension("EXT_blend_minmax");
  const MAX_EXT = extMinMax ? extMinMax.MAX_EXT : 0x8008;

  // ---- State ----
  let capModeEnabled = false;
  const texCache = new Map<string, WebGLTexture>();

  // Cached brush color for composite shader (updated each stamp call)
  let _lastR = 0;
  let _lastG = 0;
  let _lastB = 0;

  // Blend state cache
  type BlendMode = "additive" | "max" | "none" | "source_over";
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
      } else {
        // max blend
        gl.blendEquationSeparate(MAX_EXT, MAX_EXT);
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
  let _angle = -999;
  let _activeTex: WebGLTexture | null = null;
  let _stampProgSetup = false;

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
    tex: WebGLTexture,
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
    if (tex !== _activeTex) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(uTip, 0);
      _activeTex = tex;
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
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
  ) {
    if (!dualStampProg) return;
    setupDualStampProg();
    gl.uniform2f(dualStampUResolution, canvas.width, canvas.height);
    gl.uniform2f(dualStampUCenter, x, y);
    gl.uniform1f(dualStampUSize, size);
    gl.uniform1f(dualStampUAngle, angle);
    gl.uniform1f(dualStampUFlow, flow);
    gl.uniform1f(dualStampUSoftness, softness);
    gl.uniform1i(dualStampUBlendMode, blendModeInt);
    gl.uniform3f(dualStampUColor, r, g, b);
    gl.uniform3f(dualStampUColor2, r2 ?? r, g2 ?? g, b2 ?? b);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex1);
    gl.uniform1i(dualStampUTip1, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, tex2);
    gl.uniform1i(dualStampUTip2, 1);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
  }

  function getOrBuildTexture(
    tipImageData: string | null,
    defaultTipCanvas: HTMLCanvasElement | null,
  ): WebGLTexture | null {
    const key = tipImageData ? tipImageData.slice(0, 100) : "default";
    if (texCache.has(key)) return texCache.get(key)!;
    if (tipImageData) {
      buildTipTextureFromDataUrl(gl, tipImageData, texCache, key);
      return texCache.get("default") ?? null;
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

    clear() {
      if (strokeFBO) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, strokeFBO.fbo);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
      if (capFBO) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, capFBO.fbo);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    },

    resize(w: number, h: number) {
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
      _resW = -1;
      _resH = -1;
      if (strokeFBO) resizeFBOTex(gl, strokeFBO.tex, w, h);
      if (capFBO) resizeFBOTex(gl, capFBO.tex, w, h);
      _activeTex = null;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    },

    stamp(
      x,
      y,
      size,
      opacity, // = flow (per-stamp alpha)
      r,
      g,
      b, // brush color — cached for composite shader
      tipImageData,
      angle,
      defaultTipCanvas,
      softness,
      capAlpha,
      dualTipEnabled,
      dualTipImageData,
      dualTipBlendMode,
      dualR,
      dualG,
      dualB,
    ) {
      if (!strokeFBO) return;
      const tex = getOrBuildTexture(tipImageData, defaultTipCanvas);
      if (!tex) return;

      // Cache brush color for composite step
      _lastR = r;
      _lastG = g;
      _lastB = b;

      // 1. Draw alpha mask into stroke FBO using source-over accumulation.
      //    out.a = src.a + dst.a × (1 − src.a) — smooth, continuous surface,
      //    no hard clamping at crossings. Transparent stamp edges (low src.a)
      //    over existing paint (high dst.a) produce a gentle increase rather
      //    than a hard boundary, eliminating the seam artifact.
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
            opacity,
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
          );
          _stampProgSetup = false;
        } else {
          doStamp(x, y, size, opacity, tex, angle, softness, r, g, b);
        }
      } else {
        doStamp(x, y, size, opacity, tex, angle, softness, r, g, b);
      }

      // 2. Update cap FBO (MAX — tracks highest pressure-weighted alpha per pixel)
      if (capModeEnabled && capFBO && capAlpha !== undefined) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, capFBO.fbo);
        setBlend("max");
        doStamp(x, y, size, capAlpha, tex, angle, softness, r, g, b);
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

      if (capModeEnabled && capFBO && dualCapProg) {
        // biome-ignore lint/correctness/useHookAtTopLevel: WebGL API, not React
        gl.useProgram(dualCapProg);
        gl.bindBuffer(gl.ARRAY_BUFFER, quadVbo);
        gl.enableVertexAttribArray(dualCapAPos);
        gl.vertexAttribPointer(dualCapAPos, 2, gl.FLOAT, false, 0, 0);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, strokeFBO.tex);
        gl.uniform1i(dualCapUStroke, 0);

        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, capFBO.tex);
        gl.uniform1i(dualCapUCap, 1);

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, null);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, null);
      } else if (flatCapProg) {
        // biome-ignore lint/correctness/useHookAtTopLevel: WebGL API, not React
        gl.useProgram(flatCapProg);
        gl.bindBuffer(gl.ARRAY_BUFFER, quadVbo);
        gl.enableVertexAttribArray(flatCapAPos);
        gl.vertexAttribPointer(flatCapAPos, 2, gl.FLOAT, false, 0, 0);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, strokeFBO.tex);
        gl.uniform1i(flatCapUStroke, 0);
        gl.uniform1f(flatCapUCap, opacityCap);

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, null);
      }

      _activeTex = null;
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      setBlend("source_over");
    },

    setMaxAlphaMode(_enabled: boolean) {
      // No-op: kept for backward compat
    },

    setCapMode(enabled: boolean) {
      capModeEnabled = enabled;
    },

    dispose() {
      for (const t of texCache.values()) gl.deleteTexture(t);
      texCache.clear();
      if (strokeFBO) {
        gl.deleteFramebuffer(strokeFBO.fbo);
        gl.deleteTexture(strokeFBO.tex);
        strokeFBO = null;
      }
      if (capFBO) {
        gl.deleteFramebuffer(capFBO.fbo);
        gl.deleteTexture(capFBO.tex);
        capFBO = null;
      }
      if (stampVbo) gl.deleteBuffer(stampVbo);
      if (quadVbo) gl.deleteBuffer(quadVbo);
      if (stampProg) gl.deleteProgram(stampProg);
      if (dualCapProg) gl.deleteProgram(dualCapProg);
      if (flatCapProg) gl.deleteProgram(flatCapProg);
      if (dualStampProg) gl.deleteProgram(dualStampProg);
    },
  };
}
