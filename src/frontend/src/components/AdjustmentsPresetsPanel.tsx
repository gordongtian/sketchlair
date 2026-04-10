import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Activity,
  BarChart2,
  ChevronDown,
  ChevronRight,
  Sliders,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { getLuminance } from "../utils/colorUtils";

// ============================================================
// Color utilities
// ============================================================
function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  const s = max === 0 ? 0 : d / max;
  const v = max;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
    else if (max === gn) h = ((bn - rn) / d + 2) / 6;
    else h = ((rn - gn) / d + 4) / 6;
  }
  return [h * 360, s, v];
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const hn = ((h % 360) + 360) % 360;
  const i = Math.floor(hn / 60);
  const f = hn / 60 - i;
  const p = v * (1 - s);
  const q = v * (1 - s * f);
  const t = v * (1 - s * (1 - f));
  let r = 0;
  let g = 0;
  let b = 0;
  switch (i % 6) {
    case 0:
      r = v;
      g = t;
      b = p;
      break;
    case 1:
      r = q;
      g = v;
      b = p;
      break;
    case 2:
      r = p;
      g = v;
      b = t;
      break;
    case 3:
      r = p;
      g = q;
      b = v;
      break;
    case 4:
      r = t;
      g = p;
      b = v;
      break;
    case 5:
      r = v;
      g = p;
      b = q;
      break;
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

// HSL helpers for the Lightness slider
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return [h * 360, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hn = ((h % 360) + 360) % 360;
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  function hue2rgb(p: number, q: number, t: number) {
    const tv = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    if (tv < 1 / 6) return p + (q - p) * 6 * tv;
    if (tv < 1 / 2) return q;
    if (tv < 2 / 3) return p + (q - p) * (2 / 3 - tv) * 6;
    return p;
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const r = hue2rgb(p, q, hn / 360 + 1 / 3);
  const g = hue2rgb(p, q, hn / 360);
  const b = hue2rgb(p, q, hn / 360 - 1 / 3);
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

// ============================================================
// Pixel manipulation helpers
// ============================================================
export function applyHSLB(
  data: Uint8ClampedArray,
  hueOffset: number,
  satOffset: number,
  lightOffset: number,
  valOffset: number,
  selectionMask?: HTMLCanvasElement | null,
) {
  let maskData: Uint8ClampedArray | null = null;
  if (selectionMask) {
    const mCtx = selectionMask.getContext("2d");
    if (mCtx) {
      maskData = mCtx.getImageData(
        0,
        0,
        selectionMask.width,
        selectionMask.height,
      ).data;
    }
  }
  for (let i = 0; i < data.length; i += 4) {
    if (maskData) {
      const pxIdx = i / 4;
      if (maskData[pxIdx * 4 + 3] < 128) continue;
    }
    // Apply Brightness (V channel) via HSV
    const [h, s, v] = rgbToHsv(data[i], data[i + 1], data[i + 2]);
    const nh = h + hueOffset;
    const ns = clamp(s + satOffset / 100, 0, 1);
    const nv = clamp(v + valOffset / 100, 0, 1);
    let [r, g, b] = hsvToRgb(nh, ns, nv);
    // Apply Lightness (L channel) via HSL — shifts toward white/black
    if (lightOffset !== 0) {
      const [lh, ls, ll] = rgbToHsl(r, g, b);
      const nl = clamp(ll + lightOffset / 100, 0, 1);
      [r, g, b] = hslToRgb(lh, ls, nl);
    }
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  }
}
// Keep old name as alias for any external callers
export const applyHSV = applyHSLB;

export function applyLevels(
  data: Uint8ClampedArray,
  inBlack: number,
  inGamma: number,
  inWhite: number,
  outBlack: number,
  outWhite: number,
  selectionMask?: HTMLCanvasElement | null,
) {
  let maskData: Uint8ClampedArray | null = null;
  if (selectionMask) {
    const mCtx = selectionMask.getContext("2d");
    if (mCtx)
      maskData = mCtx.getImageData(
        0,
        0,
        selectionMask.width,
        selectionMask.height,
      ).data;
  }
  const lut: number[] = new Array(256);
  for (let c = 0; c < 256; c++) {
    let n = (c - inBlack) / Math.max(1, inWhite - inBlack);
    n = clamp(n, 0, 1);
    n = n ** (1 / inGamma);
    lut[c] = Math.round(outBlack + n * (outWhite - outBlack));
  }
  for (let i = 0; i < data.length; i += 4) {
    if (maskData) {
      const pxIdx = i / 4;
      if (maskData[pxIdx * 4 + 3] < 128) continue;
    }
    data[i] = lut[data[i]];
    data[i + 1] = lut[data[i + 1]];
    data[i + 2] = lut[data[i + 2]];
  }
}

type CurvePoint = { x: number; y: number };

function monotoneCubicLUT(points: CurvePoint[]): number[] {
  const sorted = [...points].sort((a, b) => a.x - b.x);
  const n = sorted.length;
  const lut = new Array(256).fill(0);
  if (n === 0) {
    for (let i = 0; i < 256; i++) lut[i] = i;
    return lut;
  }
  if (n === 1) {
    for (let i = 0; i < 256; i++)
      lut[i] = clamp(Math.round(sorted[0].y), 0, 255);
    return lut;
  }
  const dx = sorted.map((_, i) =>
    i < n - 1 ? sorted[i + 1].x - sorted[i].x : 0,
  );
  const dy = sorted.map((_, i) =>
    i < n - 1 ? sorted[i + 1].y - sorted[i].y : 0,
  );
  const m: number[] = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) {
    const slope = dx[i] > 0 ? dy[i] / dx[i] : 0;
    if (i === 0) {
      m[0] = slope;
    } else {
      m[i] = (slope + (dx[i - 1] > 0 ? dy[i - 1] / dx[i - 1] : 0)) / 2;
    }
  }
  m[n - 1] = dx[n - 2] > 0 ? dy[n - 2] / dx[n - 2] : 0;
  for (let i = 0; i < n - 1; i++) {
    const slope = dx[i] > 0 ? dy[i] / dx[i] : 0;
    if (Math.abs(slope) < 1e-10) {
      m[i] = 0;
      m[i + 1] = 0;
    } else {
      const a = m[i] / slope;
      const b = m[i + 1] / slope;
      const r = a * a + b * b;
      if (r > 9) {
        m[i] = ((3 * a) / Math.sqrt(r)) * slope;
        m[i + 1] = ((3 * b) / Math.sqrt(r)) * slope;
      }
    }
  }
  function interpolate(x: number): number {
    if (x <= sorted[0].x) return sorted[0].y;
    if (x >= sorted[n - 1].x) return sorted[n - 1].y;
    let lo = 0;
    for (let i = 0; i < n - 1; i++) {
      if (x >= sorted[i].x && x <= sorted[i + 1].x) {
        lo = i;
        break;
      }
    }
    const h = sorted[lo + 1].x - sorted[lo].x;
    if (h < 1e-10) return sorted[lo].y;
    const t = (x - sorted[lo].x) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      sorted[lo].y * (2 * t3 - 3 * t2 + 1) +
      m[lo] * h * (t3 - 2 * t2 + t) +
      sorted[lo + 1].y * (-2 * t3 + 3 * t2) +
      m[lo + 1] * h * (t3 - t2)
    );
  }
  for (let i = 0; i < 256; i++)
    lut[i] = clamp(Math.round(interpolate(i)), 0, 255);
  return lut;
}

export function applyCurves(
  data: Uint8ClampedArray,
  rgbPoints: CurvePoint[],
  rPoints: CurvePoint[],
  gPoints: CurvePoint[],
  bPoints: CurvePoint[],
  selectionMask?: HTMLCanvasElement | null,
) {
  let maskData: Uint8ClampedArray | null = null;
  if (selectionMask) {
    const mCtx = selectionMask.getContext("2d");
    if (mCtx)
      maskData = mCtx.getImageData(
        0,
        0,
        selectionMask.width,
        selectionMask.height,
      ).data;
  }
  const rgbLut = monotoneCubicLUT(rgbPoints);
  const rLut = monotoneCubicLUT(rPoints);
  const gLut = monotoneCubicLUT(gPoints);
  const bLut = monotoneCubicLUT(bPoints);
  for (let i = 0; i < data.length; i += 4) {
    if (maskData) {
      const pxIdx = i / 4;
      if (maskData[pxIdx * 4 + 3] < 128) continue;
    }
    data[i] = rLut[rgbLut[data[i]]];
    data[i + 1] = gLut[rgbLut[data[i + 1]]];
    data[i + 2] = bLut[rgbLut[data[i + 2]]];
  }
}

// ============================================================
// Props interface
// ============================================================
export interface AdjustmentsPanelProps {
  activeLayerId: string | null;
  activeLayerIsRuler: boolean;
  layerCanvasesRef: React.RefObject<Map<string, HTMLCanvasElement>>;
  selectionMaskRef: React.RefObject<HTMLCanvasElement | null>;
  selectionActive: boolean;
  onPushUndo: (layerId: string, before: ImageData, after: ImageData) => void;
  onPreview: () => void;
  onComposite: () => void;
  onThumbnailUpdate: (layerId: string) => void;
  onMarkLayerDirty?: (id: string) => void;
}

type AdjType = "hsv" | "levels" | "curves";

const DEFAULT_CURVE_POINTS: CurvePoint[] = [
  { x: 0, y: 0 },
  { x: 255, y: 255 },
];

// ============================================================
// HSV Panel
// ============================================================
function HSLBPanel({
  layerCanvas,
  selectionMaskRef,
  selectionActive,
  onApply,
  onCancel,
  onPreview,
  onOriginalCaptured,
}: {
  layerCanvas: HTMLCanvasElement;
  selectionMaskRef: React.RefObject<HTMLCanvasElement | null>;
  selectionActive: boolean;
  onApply: (before: ImageData, after: ImageData) => void;
  onCancel: () => void;
  onPreview: () => void;
  onOriginalCaptured: (orig: ImageData) => void;
}) {
  const [hue, setHue] = useState(0);
  const [sat, setSat] = useState(0);
  const [light, setLight] = useState(0);
  const [val, setVal] = useState(0);
  const originalRef = useRef<ImageData | null>(null);

  useEffect(() => {
    const ctx = layerCanvas.getContext("2d");
    if (ctx) {
      const snap = ctx.getImageData(
        0,
        0,
        layerCanvas.width,
        layerCanvas.height,
      );
      originalRef.current = snap;
      onOriginalCaptured(snap);
    }
  }, [layerCanvas, onOriginalCaptured]);

  const applyPreview = useCallback(
    (h: number, s: number, l: number, v: number) => {
      const orig = originalRef.current;
      if (!orig) return;
      const copy = new ImageData(
        new Uint8ClampedArray(orig.data),
        orig.width,
        orig.height,
      );
      applyHSLB(
        copy.data,
        h,
        s,
        l,
        v,
        selectionActive ? selectionMaskRef.current : null,
      );
      const ctx = layerCanvas.getContext("2d");
      if (ctx) ctx.putImageData(copy, 0, 0);
      onPreview();
    },
    [layerCanvas, selectionMaskRef, selectionActive, onPreview],
  );

  const handleApply = () => {
    const orig = originalRef.current;
    if (!orig) return;
    const after = new ImageData(
      new Uint8ClampedArray(orig.data),
      orig.width,
      orig.height,
    );
    applyHSLB(
      after.data,
      hue,
      sat,
      light,
      val,
      selectionActive ? selectionMaskRef.current : null,
    );
    const ctx = layerCanvas.getContext("2d");
    if (ctx) ctx.putImageData(after, 0, 0);
    onApply(orig, after);
  };

  const handleCancel = () => {
    const orig = originalRef.current;
    if (orig) {
      const ctx = layerCanvas.getContext("2d");
      if (ctx) ctx.putImageData(orig, 0, 0);
    }
    onCancel();
  };

  return (
    <div className="flex flex-col gap-3 p-3">
      <AdjSlider
        label="Hue"
        value={hue}
        min={-180}
        max={180}
        onChange={(v) => {
          setHue(v);
          applyPreview(v, sat, light, val);
        }}
      />
      <AdjSlider
        label="Saturation"
        value={sat}
        min={-100}
        max={100}
        onChange={(v) => {
          setSat(v);
          applyPreview(hue, v, light, val);
        }}
      />
      <AdjSlider
        label="Lightness"
        value={light}
        min={-100}
        max={100}
        onChange={(v) => {
          setLight(v);
          applyPreview(hue, sat, v, val);
        }}
      />
      <AdjSlider
        label="Brightness"
        value={val}
        min={-100}
        max={100}
        onChange={(v) => {
          setVal(v);
          applyPreview(hue, sat, light, v);
        }}
      />
      <AdjButtons onApply={handleApply} onCancel={handleCancel} />
    </div>
  );
}

// ============================================================
// Levels Panel — Photoshop-style with draggable triangle handles
// ============================================================

type LevelsDragTarget =
  | "inBlack"
  | "inGamma"
  | "inWhite"
  | "outBlack"
  | "outWhite"
  | null;

function LevelsTriangleTrack({
  width,
  handles,
  onDragStart,
}: {
  width: number;
  handles: { id: string; pos: number; color: string; border: string }[];
  onDragStart: (id: string, e: React.PointerEvent<SVGSVGElement>) => void;
}) {
  const H = 16;
  const TW = 11;
  const TH = 9;

  return (
    <svg
      width={width}
      height={H}
      style={{ display: "block", overflow: "visible", cursor: "default" }}
      role="img"
      aria-label="Levels handles"
      onPointerDown={(e) => {
        // Determine which handle was clicked by proximity
        const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
        const xRel = e.clientX - rect.left;
        let closest = handles[0];
        let closestDist = Number.POSITIVE_INFINITY;
        for (const h of handles) {
          const hx = (h.pos / 255) * width;
          const dist = Math.abs(xRel - hx);
          if (dist < closestDist) {
            closestDist = dist;
            closest = h;
          }
        }
        if (closestDist <= TW + 4) {
          onDragStart(closest.id, e);
        }
      }}
    >
      <title>Levels handles</title>
      {handles.map((h) => {
        const cx = (h.pos / 255) * width;
        // Upward-pointing triangle: tip at top, base at bottom
        const points = `${cx},${H - TH} ${cx - TW / 2},${H} ${cx + TW / 2},${H}`;
        return (
          <polygon
            key={h.id}
            points={points}
            fill={h.color}
            stroke={h.border}
            strokeWidth={1.5}
            style={{ cursor: "ew-resize" }}
          />
        );
      })}
    </svg>
  );
}

// Gamma <-> position helpers (module-level, pure functions)
function gammaToPos(gamma: number, ib: number, iw: number): number {
  // t = 0.5^gamma: the input fraction whose output is 0.5 (midpoint) at this gamma.
  // gamma>1 (brightening) → handle moves left; gamma<1 (darkening) → handle moves right.
  const t = 0.5 ** gamma;
  return ib + (iw - ib) * t;
}

function posToGamma(pos: number, ib: number, iw: number): number {
  const range = iw - ib;
  if (range <= 0) return 1.0;
  const t = (pos - ib) / range;
  const tc = clamp(t, 0.001, 0.999);
  // Inverse of t = 0.5^gamma: gamma = log(t)/log(0.5)
  const gamma = Math.log(tc) / Math.log(0.5);
  return clamp(gamma, 0.1, 9.99);
}

function LevelsPanel({
  layerCanvas,
  selectionMaskRef,
  selectionActive,
  onApply,
  onCancel,
  onPreview,
  onOriginalCaptured,
}: {
  layerCanvas: HTMLCanvasElement;
  selectionMaskRef: React.RefObject<HTMLCanvasElement | null>;
  selectionActive: boolean;
  onApply: (before: ImageData, after: ImageData) => void;
  onCancel: () => void;
  onPreview: () => void;
  onOriginalCaptured: (orig: ImageData) => void;
}) {
  const [inBlack, setInBlack] = useState(0);
  const [inGamma, setInGamma] = useState(1.0);
  const [inWhite, setInWhite] = useState(255);
  const [outBlack, setOutBlack] = useState(0);
  const [outWhite, setOutWhite] = useState(255);
  const originalRef = useRef<ImageData | null>(null);
  const histCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef<LevelsDragTarget>(null);
  const trackWidthRef = useRef(180);
  const previewRafRef = useRef<number | null>(null);

  // State refs so drag handlers can read current values without stale closure
  const stateRef = useRef({ inBlack, inGamma, inWhite, outBlack, outWhite });
  stateRef.current = { inBlack, inGamma, inWhite, outBlack, outWhite };

  useEffect(() => {
    const ctx = layerCanvas.getContext("2d");
    if (!ctx) return;
    const snap = ctx.getImageData(0, 0, layerCanvas.width, layerCanvas.height);
    originalRef.current = snap;
    onOriginalCaptured(snap);
    // Draw histogram
    const hc = histCanvasRef.current;
    if (!hc) return;
    const hCtx = hc.getContext("2d");
    if (!hCtx) return;
    const data = snap.data;
    const buckets = new Array(256).fill(0);
    for (let i = 0; i < data.length; i += 4) {
      const lum = Math.round(getLuminance(data[i], data[i + 1], data[i + 2]));
      buckets[lum]++;
    }
    const maxBucket = Math.max(...buckets);
    hCtx.clearRect(0, 0, hc.width, hc.height);
    hCtx.fillStyle = "#1a1a1a";
    hCtx.fillRect(0, 0, hc.width, hc.height);
    // Draw bars using logarithmic scale for better visual
    const logMax = Math.log(maxBucket + 1);
    for (let i = 0; i < 256; i++) {
      const barH =
        maxBucket > 0 ? (Math.log(buckets[i] + 1) / logMax) * hc.height : 0;
      const x = Math.round((i / 255) * (hc.width - 1));
      const w = Math.max(1, Math.ceil(hc.width / 256));
      const lightness = Math.round((i / 255) * 200 + 55);
      hCtx.fillStyle = `rgb(${lightness},${lightness},${lightness})`;
      hCtx.fillRect(x, hc.height - barH, w, barH);
    }
  }, [layerCanvas, onOriginalCaptured]);

  const doApplyPreview = useCallback(
    (ib: number, ig: number, iw: number, ob: number, ow: number) => {
      if (previewRafRef.current !== null) {
        cancelAnimationFrame(previewRafRef.current);
      }
      previewRafRef.current = requestAnimationFrame(() => {
        previewRafRef.current = null;
        const orig = originalRef.current;
        if (!orig) return;
        const copy = new ImageData(
          new Uint8ClampedArray(orig.data),
          orig.width,
          orig.height,
        );
        applyLevels(
          copy.data,
          ib,
          ig,
          iw,
          ob,
          ow,
          selectionActive ? selectionMaskRef.current : null,
        );
        const ctx = layerCanvas.getContext("2d");
        if (ctx) ctx.putImageData(copy, 0, 0);
        onPreview();
      });
    },
    [layerCanvas, selectionMaskRef, selectionActive, onPreview],
  );

  // Pointer drag handling — attached to window so we can drag outside the element
  const handleDragStart = useCallback(
    (target: LevelsDragTarget, e: React.PointerEvent<SVGSVGElement>) => {
      draggingRef.current = target;
      (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
    },
    [],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      const track = trackRef.current;
      if (!track) return;
      const rect = track.getBoundingClientRect();
      const xRel = e.clientX - rect.left;
      const w = rect.width;
      trackWidthRef.current = w;
      const rawVal = Math.round(clamp((xRel / w) * 255, 0, 255));
      const {
        inBlack: ib,
        inGamma: ig,
        inWhite: iw,
        outBlack: ob,
        outWhite: ow,
      } = stateRef.current;

      if (draggingRef.current === "inBlack") {
        const newIb = Math.min(rawVal, iw - 2);
        const newIg = posToGamma(gammaToPos(ig, newIb, iw), newIb, iw);
        setInBlack(newIb);
        setInGamma(newIg);
        doApplyPreview(newIb, newIg, iw, ob, ow);
      } else if (draggingRef.current === "inWhite") {
        const newIw = Math.max(rawVal, ib + 2);
        const newIg = posToGamma(gammaToPos(ig, ib, newIw), ib, newIw);
        setInWhite(newIw);
        setInGamma(newIg);
        doApplyPreview(ib, newIg, newIw, ob, ow);
      } else if (draggingRef.current === "inGamma") {
        const newIg = posToGamma(rawVal, ib, iw);
        setInGamma(newIg);
        doApplyPreview(ib, newIg, iw, ob, ow);
      } else if (draggingRef.current === "outBlack") {
        const newOb = Math.min(rawVal, ow - 2);
        setOutBlack(newOb);
        doApplyPreview(ib, ig, iw, newOb, ow);
      } else if (draggingRef.current === "outWhite") {
        const newOw = Math.max(rawVal, ob + 2);
        setOutWhite(newOw);
        doApplyPreview(ib, ig, iw, ob, newOw);
      }
    },
    [doApplyPreview],
  );

  const handlePointerUp = useCallback(() => {
    draggingRef.current = null;
  }, []);

  const handleApply = () => {
    const orig = originalRef.current;
    if (!orig) return;
    const after = new ImageData(
      new Uint8ClampedArray(orig.data),
      orig.width,
      orig.height,
    );
    applyLevels(
      after.data,
      inBlack,
      inGamma,
      inWhite,
      outBlack,
      outWhite,
      selectionActive ? selectionMaskRef.current : null,
    );
    const ctx = layerCanvas.getContext("2d");
    if (ctx) ctx.putImageData(after, 0, 0);
    onApply(orig, after);
  };

  const handleCancel = () => {
    const orig = originalRef.current;
    if (orig) {
      const ctx = layerCanvas.getContext("2d");
      if (ctx) ctx.putImageData(orig, 0, 0);
    }
    onCancel();
  };

  const gammaPos = gammaToPos(inGamma, inBlack, inWhite);

  const inputStyle: React.CSSProperties = {
    width: 48,
    background: "#1e1e1e",
    border: "1px solid #444",
    borderRadius: 3,
    color: "#e0e0e0",
    fontSize: 11,
    fontFamily: "monospace",
    textAlign: "center",
    padding: "2px 4px",
    outline: "none",
  };

  return (
    <div
      className="flex flex-col gap-2 p-3 select-none"
      style={{ touchAction: "none" }}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
      {/* Input Levels label */}
      <div style={{ fontSize: 11, color: "#aaa", marginBottom: 2 }}>
        Input Levels:
      </div>

      {/* Histogram */}
      <canvas
        ref={histCanvasRef}
        width={256}
        height={80}
        className="w-full"
        style={{
          display: "block",
          imageRendering: "pixelated",
          borderRadius: 2,
        }}
      />

      {/* Input triangle handles track */}
      <div
        ref={trackRef}
        className="w-full"
        style={{ position: "relative", height: 16 }}
      >
        <LevelsTriangleTrack
          width={trackWidthRef.current || 180}
          handles={[
            { id: "inBlack", pos: inBlack, color: "#000", border: "#fff" },
            { id: "inGamma", pos: gammaPos, color: "#888", border: "#fff" },
            { id: "inWhite", pos: inWhite, color: "#fff", border: "#000" },
          ]}
          onDragStart={(id, e) => handleDragStart(id as LevelsDragTarget, e)}
        />
      </div>

      {/* Input numeric fields */}
      <div className="flex justify-between" style={{ gap: 4 }}>
        <input
          type="number"
          min={0}
          max={253}
          value={inBlack}
          style={inputStyle}
          onChange={(e) => {
            const v = clamp(Number(e.target.value), 0, inWhite - 2);
            setInBlack(v);
            doApplyPreview(v, inGamma, inWhite, outBlack, outWhite);
          }}
          data-ocid="adjustments.levels_in_black_input"
        />
        <input
          type="number"
          min={0.1}
          max={9.99}
          step={0.01}
          value={inGamma.toFixed(2)}
          style={inputStyle}
          onChange={(e) => {
            const v = clamp(Number(e.target.value), 0.1, 9.99);
            setInGamma(v);
            doApplyPreview(inBlack, v, inWhite, outBlack, outWhite);
          }}
          data-ocid="adjustments.levels_gamma_input"
        />
        <input
          type="number"
          min={2}
          max={255}
          value={inWhite}
          style={inputStyle}
          onChange={(e) => {
            const v = clamp(Number(e.target.value), inBlack + 2, 255);
            setInWhite(v);
            doApplyPreview(inBlack, inGamma, v, outBlack, outWhite);
          }}
          data-ocid="adjustments.levels_in_white_input"
        />
      </div>

      {/* Output Levels label */}
      <div
        style={{ fontSize: 11, color: "#aaa", marginTop: 6, marginBottom: 2 }}
      >
        Output Levels:
      </div>

      {/* Output gradient bar */}
      <div
        className="w-full"
        style={{
          height: 16,
          background: "linear-gradient(to right, #000, #fff)",
          borderRadius: 2,
        }}
      />

      {/* Output triangle handles */}
      <div className="w-full" style={{ position: "relative", height: 16 }}>
        <LevelsTriangleTrack
          width={trackWidthRef.current || 180}
          handles={[
            { id: "outBlack", pos: outBlack, color: "#000", border: "#fff" },
            { id: "outWhite", pos: outWhite, color: "#fff", border: "#000" },
          ]}
          onDragStart={(id, e) => handleDragStart(id as LevelsDragTarget, e)}
        />
      </div>

      {/* Output numeric fields */}
      <div className="flex justify-between" style={{ gap: 4 }}>
        <input
          type="number"
          min={0}
          max={253}
          value={outBlack}
          style={inputStyle}
          onChange={(e) => {
            const v = clamp(Number(e.target.value), 0, outWhite - 2);
            setOutBlack(v);
            doApplyPreview(inBlack, inGamma, inWhite, v, outWhite);
          }}
          data-ocid="adjustments.levels_out_black_input"
        />
        <input
          type="number"
          min={2}
          max={255}
          value={outWhite}
          style={inputStyle}
          onChange={(e) => {
            const v = clamp(Number(e.target.value), outBlack + 2, 255);
            setOutWhite(v);
            doApplyPreview(inBlack, inGamma, inWhite, outBlack, v);
          }}
          data-ocid="adjustments.levels_out_white_input"
        />
      </div>

      <AdjButtons onApply={handleApply} onCancel={handleCancel} />
    </div>
  );
}

// ============================================================
// Curves Panel
// ============================================================
const CURVE_SIZE = 200;
const ANCHOR_RADIUS = 5;

function CurvesPanel({
  layerCanvas,
  selectionMaskRef,
  selectionActive,
  onApply,
  onCancel,
  onPreview,
  onOriginalCaptured,
}: {
  layerCanvas: HTMLCanvasElement;
  selectionMaskRef: React.RefObject<HTMLCanvasElement | null>;
  selectionActive: boolean;
  onApply: (before: ImageData, after: ImageData) => void;
  onCancel: () => void;
  onPreview: () => void;
  onOriginalCaptured: (orig: ImageData) => void;
}) {
  type Channel = "rgb" | "r" | "g" | "b";
  const [activeChannel, setActiveChannel] = useState<Channel>("rgb");
  const [pointsRGB, setPointsRGB] = useState<CurvePoint[]>([
    ...DEFAULT_CURVE_POINTS,
  ]);
  const [pointsR, setPointsR] = useState<CurvePoint[]>([
    ...DEFAULT_CURVE_POINTS,
  ]);
  const [pointsG, setPointsG] = useState<CurvePoint[]>([
    ...DEFAULT_CURVE_POINTS,
  ]);
  const [pointsB, setPointsB] = useState<CurvePoint[]>([
    ...DEFAULT_CURVE_POINTS,
  ]);
  const originalRef = useRef<ImageData | null>(null);
  const curveCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const draggingIdxRef = useRef<number | null>(null);
  const previewRafRef = useRef<number | null>(null);

  useEffect(() => {
    const ctx = layerCanvas.getContext("2d");
    if (ctx) {
      const snap = ctx.getImageData(
        0,
        0,
        layerCanvas.width,
        layerCanvas.height,
      );
      originalRef.current = snap;
      onOriginalCaptured(snap);
    }
  }, [layerCanvas, onOriginalCaptured]);

  const getPoints = useCallback(() => {
    if (activeChannel === "rgb") return pointsRGB;
    if (activeChannel === "r") return pointsR;
    if (activeChannel === "g") return pointsG;
    return pointsB;
  }, [activeChannel, pointsRGB, pointsR, pointsG, pointsB]);

  const setPoints = useCallback(
    (pts: CurvePoint[]) => {
      if (activeChannel === "rgb") setPointsRGB(pts);
      else if (activeChannel === "r") setPointsR(pts);
      else if (activeChannel === "g") setPointsG(pts);
      else setPointsB(pts);
    },
    [activeChannel],
  );

  const drawCurve = useCallback(() => {
    const hc = curveCanvasRef.current;
    if (!hc) return;
    const hCtx = hc.getContext("2d");
    if (!hCtx) return;
    const pts = getPoints();
    hCtx.clearRect(0, 0, hc.width, hc.height);

    // Background
    hCtx.fillStyle = "rgba(30,30,30,0.6)";
    hCtx.fillRect(0, 0, hc.width, hc.height);

    // Grid
    hCtx.strokeStyle = "rgba(255,255,255,0.07)";
    hCtx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const x = (i / 4) * hc.width;
      const y = (i / 4) * hc.height;
      hCtx.beginPath();
      hCtx.moveTo(x, 0);
      hCtx.lineTo(x, hc.height);
      hCtx.stroke();
      hCtx.beginPath();
      hCtx.moveTo(0, y);
      hCtx.lineTo(hc.width, y);
      hCtx.stroke();
    }

    // Identity line
    hCtx.strokeStyle = "rgba(255,255,255,0.15)";
    hCtx.lineWidth = 1;
    hCtx.beginPath();
    hCtx.moveTo(0, hc.height);
    hCtx.lineTo(hc.width, 0);
    hCtx.stroke();

    // Curve
    const lut = monotoneCubicLUT(pts);
    const CHANNEL_COLORS: Record<string, string> = {
      rgb: "#fff",
      r: "#f87171",
      g: "#4ade80",
      b: "#60a5fa",
    };
    hCtx.strokeStyle = CHANNEL_COLORS[activeChannel] ?? "#fff";
    hCtx.lineWidth = 1.5;
    hCtx.beginPath();
    for (let x = 0; x < 256; x++) {
      const cx = (x / 255) * hc.width;
      const cy = hc.height - (lut[x] / 255) * hc.height;
      if (x === 0) hCtx.moveTo(cx, cy);
      else hCtx.lineTo(cx, cy);
    }
    hCtx.stroke();

    // Control points
    const sorted = [...pts].sort((a, b) => a.x - b.x);
    for (const pt of sorted) {
      const cx = (pt.x / 255) * hc.width;
      const cy = hc.height - (pt.y / 255) * hc.height;
      hCtx.beginPath();
      hCtx.arc(cx, cy, ANCHOR_RADIUS, 0, Math.PI * 2);
      hCtx.fillStyle = CHANNEL_COLORS[activeChannel] ?? "#fff";
      hCtx.fill();
      hCtx.strokeStyle = "rgba(0,0,0,0.6)";
      hCtx.lineWidth = 1;
      hCtx.stroke();
    }
  }, [getPoints, activeChannel]);

  useEffect(() => {
    drawCurve();
  }, [drawCurve]);

  const applyPreview = useCallback(
    (rgb: CurvePoint[], r: CurvePoint[], g: CurvePoint[], b: CurvePoint[]) => {
      if (previewRafRef.current !== null) {
        cancelAnimationFrame(previewRafRef.current);
      }
      previewRafRef.current = requestAnimationFrame(() => {
        previewRafRef.current = null;
        const orig = originalRef.current;
        if (!orig) return;
        const copy = new ImageData(
          new Uint8ClampedArray(orig.data),
          orig.width,
          orig.height,
        );
        applyCurves(
          copy.data,
          rgb,
          r,
          g,
          b,
          selectionActive ? selectionMaskRef.current : null,
        );
        const ctx = layerCanvas.getContext("2d");
        if (ctx) ctx.putImageData(copy, 0, 0);
        onPreview();
      });
    },
    [layerCanvas, selectionMaskRef, selectionActive, onPreview],
  );

  const ptFromEvent = (
    e: React.PointerEvent<HTMLCanvasElement>,
  ): CurvePoint => {
    const hc = curveCanvasRef.current!;
    const rect = hc.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = 1 - (e.clientY - rect.top) / rect.height;
    return {
      x: clamp(Math.round(px * 255), 0, 255),
      y: clamp(Math.round(py * 255), 0, 255),
    };
  };

  const hitTest = (pt: CurvePoint, pts: CurvePoint[]): number => {
    const hc = curveCanvasRef.current!;
    const bW = hc.getBoundingClientRect().width;
    const bH = hc.getBoundingClientRect().height;
    for (let i = 0; i < pts.length; i++) {
      const cx = (pts[i].x / 255) * bW;
      const cy = (1 - pts[i].y / 255) * bH;
      const dx = (pt.x / 255) * bW - cx;
      const dy = (1 - pt.y / 255) * bH - cy;
      if (Math.sqrt(dx * dx + dy * dy) <= ANCHOR_RADIUS * 2) return i;
    }
    return -1;
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const pt = ptFromEvent(e);
    const pts = getPoints();
    const idx = hitTest(pt, pts);
    if (idx >= 0) {
      draggingIdxRef.current = idx;
    } else {
      const newPts = [...pts, pt];
      setPoints(newPts);
      draggingIdxRef.current = newPts.length - 1;
      const sorted = [...newPts].sort((a, b) => a.x - b.x);
      const newRgb = activeChannel === "rgb" ? sorted : pointsRGB;
      const newR = activeChannel === "r" ? sorted : pointsR;
      const newG = activeChannel === "g" ? sorted : pointsG;
      const newB = activeChannel === "b" ? sorted : pointsB;
      applyPreview(newRgb, newR, newG, newB);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (draggingIdxRef.current === null) return;
    const pt = ptFromEvent(e);
    const pts = getPoints();
    const newPts = pts.map((p, i) => {
      if (i !== draggingIdxRef.current) return p;
      const isAnchor = p.x === 0 || p.x === 255;
      return isAnchor ? { x: p.x, y: pt.y } : { x: pt.x, y: pt.y };
    });
    setPoints(newPts);
    const newRgb = activeChannel === "rgb" ? newPts : pointsRGB;
    const newR = activeChannel === "r" ? newPts : pointsR;
    const newG = activeChannel === "g" ? newPts : pointsG;
    const newB = activeChannel === "b" ? newPts : pointsB;
    applyPreview(newRgb, newR, newG, newB);
  };

  const handlePointerUp = () => {
    draggingIdxRef.current = null;
  };

  const handleContextMenu = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const pt = ptFromEvent(
      e as unknown as React.PointerEvent<HTMLCanvasElement>,
    );
    const pts = getPoints();
    const idx = hitTest(pt, pts);
    if (idx >= 0 && pts[idx].x !== 0 && pts[idx].x !== 255) {
      const newPts = pts.filter((_, i) => i !== idx);
      setPoints(newPts);
      const newRgb = activeChannel === "rgb" ? newPts : pointsRGB;
      const newR = activeChannel === "r" ? newPts : pointsR;
      const newG = activeChannel === "g" ? newPts : pointsG;
      const newB = activeChannel === "b" ? newPts : pointsB;
      applyPreview(newRgb, newR, newG, newB);
    }
  };

  const handleApply = () => {
    const orig = originalRef.current;
    if (!orig) return;
    const after = new ImageData(
      new Uint8ClampedArray(orig.data),
      orig.width,
      orig.height,
    );
    applyCurves(
      after.data,
      pointsRGB,
      pointsR,
      pointsG,
      pointsB,
      selectionActive ? selectionMaskRef.current : null,
    );
    const ctx = layerCanvas.getContext("2d");
    if (ctx) ctx.putImageData(after, 0, 0);
    onApply(orig, after);
  };

  const handleCancel = () => {
    const orig = originalRef.current;
    if (orig) {
      const ctx = layerCanvas.getContext("2d");
      if (ctx) ctx.putImageData(orig, 0, 0);
    }
    onCancel();
  };

  const channels: { id: Channel; label: string }[] = [
    { id: "rgb", label: "RGB" },
    { id: "r", label: "R" },
    { id: "g", label: "G" },
    { id: "b", label: "B" },
  ];

  return (
    <div className="flex flex-col gap-2 p-3">
      {/* Channel tabs */}
      <div className="flex gap-1">
        {channels.map((ch) => (
          <button
            key={ch.id}
            type="button"
            data-ocid={`adjustments.curves_${ch.id}_tab`}
            onClick={() => setActiveChannel(ch.id)}
            className={`flex-1 text-xs py-1 rounded transition-colors ${
              activeChannel === ch.id
                ? "bg-primary text-primary-foreground"
                : "bg-muted/50 text-muted-foreground hover:bg-muted"
            }`}
          >
            {ch.label}
          </button>
        ))}
      </div>

      {/* Curve canvas */}
      <canvas
        ref={curveCanvasRef}
        width={CURVE_SIZE}
        height={CURVE_SIZE}
        className="w-full rounded border border-border cursor-crosshair"
        style={{ touchAction: "none" }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onContextMenu={handleContextMenu}
        data-ocid="adjustments.curves_canvas"
      />
      <p className="text-xs text-muted-foreground">
        Click to add points · Right-click to remove
      </p>
      <AdjButtons onApply={handleApply} onCancel={handleCancel} />
    </div>
  );
}

// ============================================================
// Shared sub-components
// ============================================================
function AdjSlider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="text-foreground font-mono">
          {typeof step === "number" && step < 1 ? value.toFixed(2) : value}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1 rounded appearance-none cursor-pointer"
        style={
          {
            "--fill-pct": `${((value - min) / (max - min)) * 100}%`,
          } as React.CSSProperties
        }
        data-ocid={`adjustments.${label.toLowerCase().replace(/\s+/g, "_")}_input`}
      />
    </div>
  );
}

function AdjButtons({
  onApply,
  onCancel,
}: {
  onApply: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex gap-2 mt-2">
      <button
        type="button"
        data-ocid="adjustments.cancel_button"
        onClick={onCancel}
        className="flex-1 text-xs py-1.5 rounded border border-border bg-muted/50 text-muted-foreground hover:bg-muted transition-colors"
      >
        Cancel
      </button>
      <button
        type="button"
        data-ocid="adjustments.apply_button"
        onClick={onApply}
        className="flex-1 text-xs py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
      >
        Apply
      </button>
    </div>
  );
}

// ============================================================
// Main AdjustmentsPresetsPanel
// ============================================================
const ADJ_TOOLS: { id: AdjType; label: string; icon: React.ReactNode }[] = [
  { id: "hsv", label: "HSLB", icon: <Sliders size={14} /> },
  { id: "levels", label: "Levels", icon: <BarChart2 size={14} /> },
  { id: "curves", label: "Curves", icon: <Activity size={14} /> },
];

export function AdjustmentsPresetsPanel({
  activeLayerId,
  activeLayerIsRuler,
  layerCanvasesRef,
  selectionMaskRef,
  selectionActive,
  onPushUndo,
  onPreview,
  onComposite,
  onThumbnailUpdate,
  onMarkLayerDirty,
}: AdjustmentsPanelProps) {
  const [openAdj, setOpenAdj] = useState<AdjType | null>(null);
  // Bug 1 fix: hold a snapshot of the layer pixels at the moment any sub-panel opens,
  // so we can restore it before switching panels (avoiding corrupted originalRef).
  const outerOriginalRef = useRef<ImageData | null>(null);

  const layerCanvas = activeLayerId
    ? (layerCanvasesRef.current?.get(activeLayerId) ?? null)
    : null;

  // Bug 1: restore pixels before switching away from an open panel
  const handleOpenAdj = (next: AdjType | null) => {
    if (
      openAdj !== null &&
      openAdj !== next &&
      outerOriginalRef.current &&
      layerCanvas
    ) {
      const ctx = layerCanvas.getContext("2d");
      if (ctx) ctx.putImageData(outerOriginalRef.current, 0, 0);
      onPreview();
    }
    outerOriginalRef.current = null;
    setOpenAdj(next);
  };

  // Called by sub-panels once their originalRef is captured
  const handleOriginalCaptured = useCallback((orig: ImageData) => {
    outerOriginalRef.current = orig;
  }, []);

  const handleApply = (before: ImageData, after: ImageData) => {
    if (!activeLayerId) return;
    onMarkLayerDirty?.(activeLayerId);
    onPushUndo(activeLayerId, before, after);
    outerOriginalRef.current = null;
    setOpenAdj(null);
    // Bug 2 fix: update the layer thumbnail after applying an adjustment
    onThumbnailUpdate(activeLayerId);
    onComposite();
  };

  const handleCancel = () => {
    outerOriginalRef.current = null;
    setOpenAdj(null);
    onComposite();
  };

  return (
    <div
      className="flex flex-col border-r border-border bg-card h-full"
      style={{ width: "100%", minWidth: 0 }}
    >
      {/* Header */}
      <div className="flex items-center px-3 py-2.5 border-b border-border shrink-0">
        <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Adjustments
        </span>
      </div>

      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-1 p-2">
          {ADJ_TOOLS.map((adj, idx) => {
            const isOpen = openAdj === adj.id;
            const canApply =
              layerCanvas !== null &&
              activeLayerId !== "layer-background" &&
              !activeLayerIsRuler;
            return (
              <div key={adj.id} className="flex flex-col">
                <button
                  type="button"
                  data-ocid={`adjustments.tool.item.${idx + 1}`}
                  onClick={() => {
                    if (!canApply) return;
                    handleOpenAdj(isOpen ? null : adj.id);
                  }}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-md text-xs font-medium w-full text-left transition-all duration-100 ${
                    isOpen
                      ? "bg-primary/10 border border-primary text-primary"
                      : canApply
                        ? "border border-border bg-muted/30 hover:bg-muted/60 text-foreground"
                        : "border border-border bg-muted/10 text-muted-foreground/40 cursor-not-allowed"
                  }`}
                  disabled={!canApply}
                >
                  <span
                    className={
                      isOpen ? "text-primary" : "text-muted-foreground"
                    }
                  >
                    {adj.icon}
                  </span>
                  <span className="flex-1">{adj.label}</span>
                  <span className="text-muted-foreground">
                    {isOpen ? (
                      <ChevronDown size={12} />
                    ) : (
                      <ChevronRight size={12} />
                    )}
                  </span>
                </button>

                {/* Inline panel */}
                {isOpen && layerCanvas && (
                  <div className="mt-1 rounded-md border border-border bg-card/60 overflow-hidden">
                    {adj.id === "hsv" && (
                      <HSLBPanel
                        key={`hslb-${activeLayerId}`}
                        layerCanvas={layerCanvas}
                        selectionMaskRef={selectionMaskRef}
                        selectionActive={selectionActive}
                        onApply={handleApply}
                        onCancel={handleCancel}
                        onPreview={onPreview}
                        onOriginalCaptured={handleOriginalCaptured}
                      />
                    )}
                    {adj.id === "levels" && (
                      <LevelsPanel
                        key={`levels-${activeLayerId}`}
                        layerCanvas={layerCanvas}
                        selectionMaskRef={selectionMaskRef}
                        selectionActive={selectionActive}
                        onApply={handleApply}
                        onCancel={handleCancel}
                        onPreview={onPreview}
                        onOriginalCaptured={handleOriginalCaptured}
                      />
                    )}
                    {adj.id === "curves" && (
                      <CurvesPanel
                        key={`curves-${activeLayerId}`}
                        layerCanvas={layerCanvas}
                        selectionMaskRef={selectionMaskRef}
                        selectionActive={selectionActive}
                        onApply={handleApply}
                        onCancel={handleCancel}
                        onPreview={onPreview}
                        onOriginalCaptured={handleOriginalCaptured}
                      />
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {(activeLayerId === "layer-background" || activeLayerIsRuler) && (
            <div className="px-3 py-4 text-xs text-muted-foreground text-center">
              Adjustments cannot be applied to this layer.
            </div>
          )}

          {!activeLayerId && (
            <div className="px-3 py-4 text-xs text-muted-foreground text-center">
              Select a layer to apply adjustments.
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
