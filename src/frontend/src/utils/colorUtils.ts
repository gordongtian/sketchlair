export interface HSVAColor {
  h: number; // 0-360
  s: number; // 0-1
  v: number; // 0-1
  a: number; // 0-1
}

export function hsvToRgb(
  h: number,
  s: number,
  v: number,
): [number, number, number] {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) {
    r = c;
    g = x;
    b = 0;
  } else if (h < 120) {
    r = x;
    g = c;
    b = 0;
  } else if (h < 180) {
    r = 0;
    g = c;
    b = x;
  } else if (h < 240) {
    r = 0;
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    g = 0;
    b = c;
  } else {
    r = c;
    g = 0;
    b = x;
  }
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

export function rgbToHsv(
  r: number,
  g: number,
  b: number,
): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === rn) {
      h = ((gn - bn) / delta) % 6;
    } else if (max === gn) {
      h = (bn - rn) / delta + 2;
    } else {
      h = (rn - gn) / delta + 4;
    }
    h = h * 60;
    if (h < 0) h += 360;
  }

  const s = max === 0 ? 0 : delta / max;
  const v = max;
  return [h, s, v];
}

export function rgbToHex(r: number, g: number, b: number): string {
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

export function hexToRgb(hex: string): [number, number, number] | null {
  const clean = hex.replace("#", "");
  if (clean.length !== 6) return null;
  const r = Number.parseInt(clean.substring(0, 2), 16);
  const g = Number.parseInt(clean.substring(2, 4), 16);
  const b = Number.parseInt(clean.substring(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
  return [r, g, b];
}

export function hsvaToCssColor(color: HSVAColor): string {
  const [r, g, b] = hsvToRgb(color.h, color.s, color.v);
  return `rgba(${r},${g},${b},${color.a})`;
}

export function hsvaToHex(color: HSVAColor): string {
  const [r, g, b] = hsvToRgb(color.h, color.s, color.v);
  return rgbToHex(r, g, b);
}

// ─── OKLCH <-> Hex Conversions ────────────────────────────────────────────────

function linearToSrgb(v: number): number {
  const clamped = Math.max(0, Math.min(1, v));
  return clamped <= 0.0031308
    ? 12.92 * clamped
    : 1.055 * clamped ** (1 / 2.4) - 0.055;
}

function srgbToLinear(v: number): number {
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/**
 * Convert OKLCH (L in [0,1], C >=0, H in degrees) to hex color string.
 */
export function oklchToHex(L: number, C: number, H: number): string {
  const hRad = (H * Math.PI) / 180;
  const a = C * Math.cos(hRad);
  const b = C * Math.sin(hRad);

  // OKLab -> LMS^(1/3)
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  // cube
  const lc = l_ * l_ * l_;
  const mc = m_ * m_ * m_;
  const sc = s_ * s_ * s_;

  // LMS -> linear sRGB
  const rLin = 4.0767416621 * lc - 3.3077115913 * mc + 0.2309699292 * sc;
  const gLin = -1.2684380046 * lc + 2.6097574011 * mc - 0.3413193965 * sc;
  const bLin = -0.0041960863 * lc - 0.7034186147 * mc + 1.707614701 * sc;

  const r = Math.round(linearToSrgb(rLin) * 255);
  const g = Math.round(linearToSrgb(gLin) * 255);
  const bv = Math.round(linearToSrgb(bLin) * 255);

  return rgbToHex(
    Math.max(0, Math.min(255, r)),
    Math.max(0, Math.min(255, g)),
    Math.max(0, Math.min(255, bv)),
  );
}

/**
 * Convert hex color string to OKLCH [L, C, H] where L in [0,1], C >=0, H in degrees.
 */
export function hexToOklch(hex: string): [number, number, number] {
  const rgb = hexToRgb(hex);
  if (!rgb) return [0.5, 0, 0];

  const [ri, gi, bi] = rgb;
  const rLin = srgbToLinear(ri / 255);
  const gLin = srgbToLinear(gi / 255);
  const bLin = srgbToLinear(bi / 255);

  // linear sRGB -> LMS^3
  const l3 = 0.4122214708 * rLin + 0.5363325363 * gLin + 0.0514459929 * bLin;
  const m3 = 0.2119034982 * rLin + 0.6806995451 * gLin + 0.1073969566 * bLin;
  const s3 = 0.0883024619 * rLin + 0.2817188376 * gLin + 0.6299787005 * bLin;

  // cube root (handle negatives)
  const cbrt = (x: number) => (x >= 0 ? x ** (1 / 3) : -((-x) ** (1 / 3)));
  const l_ = cbrt(l3);
  const m_ = cbrt(m3);
  const s_ = cbrt(s3);

  // LMS_ -> OKLab
  const Lv = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const Av = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const Bv = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;

  // OKLab -> OKLCH
  const Cv = Math.sqrt(Av * Av + Bv * Bv);
  let Hv = (Math.atan2(Bv, Av) * 180) / Math.PI;
  if (Hv < 0) Hv += 360;
  if (Cv < 0.0001) Hv = 0;

  return [Lv, Cv, Hv];
}

// ─── Layer Thumbnail Generation ──────────────────────────────────────────────
// Reusable scan canvas for content-bounding-box detection (avoids allocation per stroke)
const _scanCanvas = document.createElement("canvas");
_scanCanvas.width = 240;
_scanCanvas.height = 240;
const _scanCtx = _scanCanvas.getContext("2d", { willReadFrequently: true })!;

/**
 * Generates a thumbnail data URL of a layer canvas, sized to match thumbCanvas dimensions.
 * - Transparent pixels render as white
 * - Crops out transparent borders, showing the tightest bounding box around content
 * - Centers the cropped content within the thumbnail
 */
export function generateLayerThumbnail(
  layerCanvas: HTMLCanvasElement,
  thumbCanvas: HTMLCanvasElement,
  thumbCtx: CanvasRenderingContext2D,
): string {
  const THUMB_W = thumbCanvas.width;
  const THUMB_H = thumbCanvas.height;
  const SCAN = 240;

  // White background always
  thumbCtx.fillStyle = "#ffffff";
  thumbCtx.fillRect(0, 0, THUMB_W, THUMB_H);

  const lw = layerCanvas.width;
  const lh = layerCanvas.height;

  // Draw layer scaled to scan canvas to find content bounding box cheaply
  const scanAspect = lw / lh;
  let scanW = SCAN;
  let scanH = SCAN;
  if (scanAspect > 1) {
    scanH = Math.round(SCAN / scanAspect);
  } else {
    scanW = Math.round(SCAN * scanAspect);
  }
  _scanCanvas.width = scanW;
  _scanCanvas.height = scanH;
  _scanCtx.clearRect(0, 0, scanW, scanH);
  _scanCtx.drawImage(layerCanvas, 0, 0, scanW, scanH);

  const imgData = _scanCtx.getImageData(0, 0, scanW, scanH);
  const data = imgData.data;

  let minX = scanW;
  let minY = scanH;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < scanH; y++) {
    for (let x = 0; x < scanW; x++) {
      if (data[(y * scanW + x) * 4 + 3] > 4) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < 0) {
    // Layer is empty — all white
    return thumbCanvas.toDataURL("image/png");
  }

  // Map bounding box from scan coords back to original layer coords
  const scaleX = lw / scanW;
  const scaleY = lh / scanH;
  const srcX = Math.floor(minX * scaleX);
  const srcY = Math.floor(minY * scaleY);
  const srcW = Math.ceil((maxX - minX + 1) * scaleX);
  const srcH = Math.ceil((maxY - minY + 1) * scaleY);

  // Scale cropped region to fit within thumbnail dimensions, centered
  const scale = Math.min(THUMB_W / srcW, THUMB_H / srcH);
  const dw = srcW * scale;
  const dh = srcH * scale;
  const dx = (THUMB_W - dw) / 2;
  const dy = (THUMB_H - dh) / 2;

  thumbCtx.imageSmoothingEnabled = true;
  thumbCtx.imageSmoothingQuality = "high";
  thumbCtx.drawImage(layerCanvas, srcX, srcY, srcW, srcH, dx, dy, dw, dh);
  return thumbCanvas.toDataURL("image/png");
}

/**
 * BT.601 luminance from 8-bit RGB components.
 */
export function getLuminance(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}
