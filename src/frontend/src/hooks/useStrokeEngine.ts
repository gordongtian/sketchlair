/**
 * useStrokeEngine — extracted from PaintingApp.tsx
 *
 * Owns:
 *  - Module-level smudge / smear buffer globals
 *  - Module-level stamp color-parse cache globals
 *  - stampDot()                    — 2D canvas fallback stamp (image/circle tip)
 *  - stampWebGL()                  — GPU-accelerated stamp via WebGL brush context
 *  - renderBrushSegmentAlongPoints() — place stamps along a polyline at correct spacing
 *  - renderSmearAlongPoints()       — HeavyPaint-style smudge/smear
 *  - initSmudgeBuffer()             — initializes smudge buffer at stroke start
 *
 * Stroke lifecycle refs (owned here, used by PaintingApp pointer handlers):
 *  - tailRafIdRef      — rAF handle for the spring-tail animation
 *  - tailDoCommitRef   — deferred commit callback for the tail path
 *  - strokeStartSnapshotRef  — full-canvas ImageData captured at pen-down
 *  - strokeDirtyRectRef      — bounding box of stamps placed so far
 *  - strokeSnapLayerRef      — the layer canvas at stroke start
 *  - strokeSnapshotPendingRef
 *  - strokeStampsPlacedRef
 *  - strokeWarmRawDistRef
 *
 * All external refs (webglBrushRef, etc.) are OWNED by PaintingApp and passed as params.
 */

import type { BrushSettings } from "@/components/BrushSettingsPanel";
import type { Tool } from "@/components/Toolbar";
import { hsvToRgb, rgbToHsv } from "@/utils/colorUtils";
import { useCallback, useRef } from "react";
import type { WebGLBrushContext } from "../utils/webglBrush";

// ─── isIPad (duplicated so this module is self-contained) ────────────────────
const isIPad =
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

// ─── Types ────────────────────────────────────────────────────────────────────
type Point = { x: number; y: number };
export type StrokePoint = {
  x: number;
  y: number;
  size: number;
  opacity: number;
  capAlpha?: number;
};

// ─── Module-level tint canvas (avoids per-stamp canvas allocation) ────────────
const _tintCanvas = document.createElement("canvas");
_tintCanvas.width = _tintCanvas.height = 128;
const _tintCtx = _tintCanvas.getContext("2d", { willReadFrequently: !isIPad })!;

// ─── Module-level smudge buffer ───────────────────────────────────────────────
export let _smudgeBufferData: Uint8ClampedArray | null = null;
export let _smudgeBufferDataCapacity = 0;
export let _smudgeBufferDataSize = 0;
export let _smudgeInitialized = false;
export let _smudgeCanvasMirror: Uint8ClampedArray | null = null;
export let _smudgeCanvasMirrorCapacity = 0;
export let _smudgeCanvasMirrorW = 0;
export let _smudgeCanvasMirrorH = 0;
let _smearPatchData: Uint8ClampedArray | null = null;
let _smearPatchDataCapacity = 0;

// ─── Smear pre-allocated buffers ─────────────────────────────────────────────
const SMEAR_BUF_SIZE = 1200 * 900 * 4;
let _smearSoftnessWeights: Float32Array | null = null;
let _smearPaintData: Uint8ClampedArray | null = null;
let _smearOutputImageData: ImageData | null = null;
let _smearSoftnessSize = 0;
let _smearTipCacheKey = "";

// ─── Stamp color parse cache ─────────────────────────────────────────────────
let _cachedFillStyle = "";
let _cachedR = 0;
let _cachedG = 0;
let _cachedB = 0;
let _cachedDualFillStyle = "";
let _cachedDualR = 0;
let _cachedDualG = 0;
let _cachedDualB = 0;

/** Reset the smudge initialized flag at stroke start */
export function resetSmudgeInitialized(): void {
  _smudgeInitialized = false;
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────
function _ptDist(a: Point, b: Point) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function _applyColorJitter(fillStyle: string, colorJitter: number): string {
  const m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(fillStyle);
  if (!m) return fillStyle;
  const [h0, s0, v0] = rgbToHsv(
    Number.parseInt(m[1]),
    Number.parseInt(m[2]),
    Number.parseInt(m[3]),
  );
  const jitterFactor = colorJitter / 100;
  const h = (h0 + (Math.random() - 0.5) * 2 * jitterFactor * 180 + 360) % 360;
  const s = Math.max(
    0,
    Math.min(1, s0 + (Math.random() - 0.5) * 2 * jitterFactor * 0.3),
  );
  const [r, g, b] = hsvToRgb(h, s, v0);
  return `rgb(${r},${g},${b})`;
}

// ─── Pressure smoothing constant ─────────────────────────────────────────────
/** EMA factor for pressure smoothing across coalesced events. */
export const PRESSURE_SMOOTHING = 0.3;

// ─── Pressure curve evaluator ─────────────────────────────────────────────────
/**
 * Evaluate a cubic Bézier pressure curve at the given raw pressure value.
 * cp = [p1x, p1y, p2x, p2y] — same convention as CSS cubic-bezier().
 */
export function evalPressureCurve(
  pressure: number,
  cp: [number, number, number, number],
): number {
  const [p1x, p1y, p2x, p2y] = cp;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 20; i++) {
    const t = (lo + hi) / 2;
    const x =
      3 * t * (1 - t) * (1 - t) * p1x + 3 * t * t * (1 - t) * p2x + t * t * t;
    if (x < pressure) lo = t;
    else hi = t;
  }
  const t = (lo + hi) / 2;
  return Math.max(
    0,
    Math.min(
      1,
      3 * t * (1 - t) * (1 - t) * p1y + 3 * t * t * (1 - t) * p2y + t * t * t,
    ),
  );
}

// Re-export color jitter helper under the public name used by PaintingApp
export { _applyColorJitter as applyColorJitter };

// ─── Hook params ─────────────────────────────────────────────────────────────

export interface UseStrokeEngineParams {
  webglBrushRef: React.MutableRefObject<WebGLBrushContext | null>;
  strokeBufferRef: React.MutableRefObject<HTMLCanvasElement | null>;
  defaultTipCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  tipCanvasCacheRef: React.MutableRefObject<Map<string, HTMLCanvasElement>>;
  activeLayerIdRef: React.MutableRefObject<string>;
  distAccumRef: React.MutableRefObject<number>;
  dualDistAccumRef: React.MutableRefObject<number>;
  markLayerBitmapDirty: (id: string) => void;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useStrokeEngine({
  webglBrushRef,
  defaultTipCanvasRef,
  tipCanvasCacheRef,
  activeLayerIdRef,
  distAccumRef,
  dualDistAccumRef,
  markLayerBitmapDirty,
}: UseStrokeEngineParams) {
  // ── Stroke lifecycle refs ─────────────────────────────────────────────────
  const tailRafIdRef = useRef<number | null>(null);
  const tailDoCommitRef = useRef<(() => void) | null>(null);
  const strokeStartSnapshotRef = useRef<{
    pixels: ImageData;
    x: number;
    y: number;
  } | null>(null);
  const strokeDirtyRectRef = useRef<{
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  } | null>(null);
  const strokeSnapLayerRef = useRef<HTMLCanvasElement | null>(null);
  const strokeSnapshotPendingRef = useRef(false);
  const strokeStampsPlacedRef = useRef(0);
  const strokeWarmRawDistRef = useRef(0);

  // ── Pressure tracking refs ────────────────────────────────────────────────
  /** EMA-smoothed pressure value (updated every coalesced event). */
  const smoothedPressureRef = useRef(0.5);
  /** The primary event's pressure value at the previous pointermove frame, used
   *  to interpolate across coalesced events. */
  const prevPrimaryPressureRef = useRef<number>(0.5);
  /** Composite opacity multiplier for the current stroke (1.0 when
   *  pressure→opacity mask path is active, baseOpacity otherwise). */
  const lastCompositeOpacityRef = useRef(1.0);
  /** Cap passed to WebGL flushDisplay: baseOpacity for the pressure→opacity mask
   *  path, 1.0 when the composite globalAlpha handles opacity instead. */
  const flushDisplayCapRef = useRef(1.0);
  /** Opacity slider value captured at stroke start — used by commit / tail. */
  const strokeCommitOpacityRef = useRef(1.0);

  // ── Stabilizer state refs ─────────────────────────────────────────────────
  /** Current stabilised brush position (the lagging point that stamps follow). */
  const stabBrushPosRef = useRef<{
    x: number;
    y: number;
    size: number;
    opacity: number;
    capAlpha?: number;
  } | null>(null);
  /** Circular buffer of recent positions for S-Queue (Smooth) stabiliser. */
  const smoothBufferRef = useRef<
    Array<{
      x: number;
      y: number;
      size: number;
      opacity: number;
      capAlpha?: number;
    }>
  >([]);
  /** Current spring position for Elastic / Smooth+Elastic stabiliser. */
  const elasticPosRef = useRef<{ x: number; y: number } | null>(null);
  /** Spring velocity for Elastic / Smooth+Elastic stabiliser. */
  const elasticVelRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  /** Previous raw stylus position for the Elastic spring target interpolation. */
  const elasticRawPrevRef = useRef<{ x: number; y: number } | null>(null);

  // ── Glide-to-finish / smear RAF refs ─────────────────────────────────────
  /** Most-recent raw stylus position (used as glide target on pen-lift). */
  const rawStylusPosRef = useRef<{
    x: number;
    y: number;
    size: number;
    opacity: number;
    capAlpha?: number;
  } | null>(null);
  /** Set true when a smear stamp has been placed; cleared by the smear RAF. */
  const smearDirtyRef = useRef(false);
  /** rAF handle for the smear composite throttle. */
  const smearRafRef = useRef<number | null>(null);
  /** rAF handle for stroke preview (brush/eraser). */
  const strokePreviewRafRef = useRef<number | null>(null);
  /** True when a preview composite is queued but has not yet fired. */
  const strokePreviewPendingWorkRef = useRef(false);

  // ── stampDot ──────────────────────────────────────────────────────────────
  // biome-ignore lint/correctness/useExhaustiveDependencies: all refs are stable (useRef)
  const stampDot = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      x: number,
      y: number,
      size: number,
      settings: BrushSettings,
      strokeAngle: number,
    ) => {
      const r = size / 2;
      const angle =
        settings.rotateMode === "follow"
          ? strokeAngle
          : (settings.rotation * Math.PI) / 180;

      // Image-based brush tip
      if (settings.tipImageData) {
        const cacheKey = settings.tipImageData.slice(0, 100);
        const tipCanvas = tipCanvasCacheRef.current.get(cacheKey);

        if (!tipCanvas) {
          // Tip not loaded yet — skip this stamp entirely (no circle fallback)
          return;
        }
        // Create tinted stamp: fill with brush color, mask with tip alpha (reuse module-level canvas)
        _tintCtx.clearRect(0, 0, 128, 128);
        _tintCtx.globalCompositeOperation = "source-over";
        _tintCtx.fillStyle = ctx.fillStyle as string;
        _tintCtx.fillRect(0, 0, 128, 128);
        _tintCtx.globalCompositeOperation = "destination-in";
        _tintCtx.drawImage(tipCanvas, 0, 0);
        _tintCtx.globalCompositeOperation = "source-over";

        ctx.save();
        ctx.translate(x, y);
        if (angle !== 0) ctx.rotate(angle);
        ctx.drawImage(_tintCanvas, -size / 2, -size / 2, size, size);
        ctx.restore();
        return;
      }

      // Default tip fallback: use preloaded circle tip or arc (reuse module-level tint canvas)
      const defTip = defaultTipCanvasRef.current;
      if (defTip) {
        _tintCtx.clearRect(0, 0, 128, 128);
        _tintCtx.globalCompositeOperation = "source-over";
        _tintCtx.filter =
          settings.softness > 0
            ? `blur(${Math.round(settings.softness * 20)}px)`
            : "none";
        _tintCtx.fillStyle = ctx.fillStyle as string;
        _tintCtx.fillRect(0, 0, 128, 128);
        _tintCtx.globalCompositeOperation = "destination-in";
        _tintCtx.drawImage(defTip, 0, 0);
        _tintCtx.globalCompositeOperation = "source-over";
        _tintCtx.filter = "none";
        ctx.save();
        ctx.translate(x, y);
        if (angle !== 0) ctx.rotate(angle);
        ctx.drawImage(_tintCanvas, -size / 2, -size / 2, size, size);
        ctx.restore();
      } else {
        ctx.save();
        ctx.translate(x, y);
        if (angle !== 0) ctx.rotate(angle);
        if (settings.softness > 0) {
          ctx.shadowBlur = settings.softness * size * 0.5;
          ctx.shadowColor = ctx.fillStyle as string;
        }
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.restore();
      }
    },
    [],
  );

  // ── stampWebGL ────────────────────────────────────────────────────────────
  // GPU-accelerated stamp using the WebGL brush context
  // biome-ignore lint/correctness/useExhaustiveDependencies: all refs are stable (useRef)
  const stampWebGL = useCallback(
    (
      sx: number,
      sy: number,
      stampSize: number,
      stampOpacity: number,
      settings: BrushSettings,
      angle: number,
      fillStyle: string,
      dualFillStyle?: string,
      capAlpha?: number,
    ) => {
      const glBrush = webglBrushRef.current;
      if (!glBrush) return;
      if (fillStyle !== _cachedFillStyle) {
        const m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(fillStyle);
        _cachedR = m ? Number.parseInt(m[1]) / 255 : 0;
        _cachedG = m ? Number.parseInt(m[2]) / 255 : 0;
        _cachedB = m ? Number.parseInt(m[3]) / 255 : 0;
        _cachedFillStyle = fillStyle;
      }
      const r = _cachedR;
      const g = _cachedG;
      const b = _cachedB;
      let dualR: number | undefined;
      let dualG: number | undefined;
      let dualB: number | undefined;
      if (dualFillStyle && dualFillStyle !== fillStyle) {
        if (dualFillStyle !== _cachedDualFillStyle) {
          const md = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(dualFillStyle);
          if (md) {
            _cachedDualR = Number.parseInt(md[1]) / 255;
            _cachedDualG = Number.parseInt(md[2]) / 255;
            _cachedDualB = Number.parseInt(md[3]) / 255;
          }
          _cachedDualFillStyle = dualFillStyle;
        }
        dualR = _cachedDualR;
        dualG = _cachedDualG;
        dualB = _cachedDualB;
      }
      // Per-stamp dual tip jitter/scatter using dualDistAccumRef
      const _dualSpacingPx = Math.max(
        1,
        ((settings.dualTipSpacing ?? 5) / 100) * stampSize,
      );
      dualDistAccumRef.current +=
        stampSize * ((settings.dualTipSpacing ?? 5) / 100);
      const _emitDual =
        settings.dualTipEnabled && dualDistAccumRef.current >= _dualSpacingPx;
      if (_emitDual) dualDistAccumRef.current -= _dualSpacingPx;
      // Divide by stampSize to convert px scatter into normalized UV offset (shader expects UV units)
      const _dualScatterX = _emitDual
        ? ((Math.random() - 0.5) * 2 * (settings.dualTipScatter ?? 0)) /
          Math.max(stampSize, 1)
        : 0;
      const _dualScatterY = _emitDual
        ? ((Math.random() - 0.5) * 2 * (settings.dualTipScatter ?? 0)) /
          Math.max(stampSize, 1)
        : 0;
      const _dualSize2Scale = _emitDual
        ? 1 + (Math.random() - 0.5) * (settings.dualTipSizeJitter ?? 0)
        : 1;
      const _dualAngle2 = _emitDual
        ? angle +
          (Math.random() - 0.5) *
            (settings.dualTipRotationJitter ?? 0) *
            (Math.PI / 180)
        : angle;
      glBrush.stamp(
        sx,
        sy,
        stampSize,
        stampOpacity,
        r,
        g,
        b,
        settings.tipImageData ?? null,
        angle,
        defaultTipCanvasRef.current,
        settings.softness,
        _emitDual,
        _emitDual ? (settings.dualTipImageData ?? null) : null,
        settings.dualTipBlendMode,
        dualR,
        dualG,
        dualB,
        _dualScatterX,
        _dualScatterY,
        _dualSize2Scale,
        _dualAngle2,
        capAlpha,
      );
      // Dirty rect tracking (snapshot is taken once at pen-down, not lazily per-stamp).
      const _halfSize = stampSize / 2;
      const _dr = strokeDirtyRectRef.current;
      if (_dr) {
        // Expand dirty rect to cover this stamp
        if (sx - _halfSize < _dr.minX) _dr.minX = sx - _halfSize;
        if (sy - _halfSize < _dr.minY) _dr.minY = sy - _halfSize;
        if (sx + _halfSize > _dr.maxX) _dr.maxX = sx + _halfSize;
        if (sy + _halfSize > _dr.maxY) _dr.maxY = sy + _halfSize;
      } else {
        // First stamp: initialize dirty rect
        strokeDirtyRectRef.current = {
          minX: sx - _halfSize,
          minY: sy - _halfSize,
          maxX: sx + _halfSize,
          maxY: sy + _halfSize,
        };
      }
    },
    [],
  );

  // ── renderBrushSegmentAlongPoints ─────────────────────────────────────────
  // biome-ignore lint/correctness/useExhaustiveDependencies: all refs are stable (useRef)
  const renderBrushSegmentAlongPoints = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      points: Point[],
      sizeFrom: number,
      sizeTo: number,
      opacityFrom: number,
      opacityTo: number,
      settings: BrushSettings,
      _tool: Tool,
      _applyOpacityPerStamp = false,
      _segCapAlpha?: number,
    ) => {
      if (points.length < 2) return;
      const avgSize = (sizeFrom + sizeTo) / 2;
      const _fillStyle = _tool !== "eraser" ? (ctx.fillStyle as string) : "";
      let totalSegDist = 0;
      for (let i = 1; i < points.length; i++) {
        totalSegDist += _ptDist(points[i - 1], points[i]);
      }
      let distFromSegStart = 0;
      for (let i = 1; i < points.length; i++) {
        const from = points[i - 1];
        const to = points[i];
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const segDist = Math.sqrt(dx * dx + dy * dy);
        const strokeAngle = Math.atan2(dy, dx);
        let accdist = distAccumRef.current + segDist;
        let stampsPlaced = 0;
        while (true) {
          const globalT =
            totalSegDist > 0
              ? (distFromSegStart +
                  (stampsPlaced + 1) *
                    Math.max(1, (settings.spacing / 100) * avgSize) -
                  distAccumRef.current) /
                totalSegDist
              : 0;
          const clampedT = Math.min(1, Math.max(0, globalT));
          const interpSize = sizeFrom + (sizeTo - sizeFrom) * clampedT;
          // Adaptive spacing for soft/airbrush tips at low flow
          const _asp_softness = settings.softness ?? 0;
          const _asp_flow = opacityFrom; // use base flow as representative value for spacing calc
          const _asp_softFactor =
            _asp_softness > 0.5
              ? 1.0 -
                (_asp_softness - 0.5) * 2.0 * (1.0 - Math.max(0.35, _asp_flow))
              : 1.0;
          const spacingPixels = Math.max(
            1,
            ((settings.spacing / 100) * interpSize * _asp_softFactor) /
              (settings.count ?? 1),
          );
          if (accdist < spacingPixels) break;
          const distFromPrev =
            (stampsPlaced + 1) * spacingPixels - distAccumRef.current;
          const segT = segDist > 0 ? distFromPrev / segDist : 0;
          const sx = from.x + dx * segT;
          const sy = from.y + dy * segT;
          const _interpOpacity =
            opacityFrom + (opacityTo - opacityFrom) * clampedT;
          {
            const _countA = settings.count ?? 1;
            for (let _ci = 0; _ci < _countA; _ci++) {
              const _scatter = settings.scatter ?? 0;
              const _sizeJitter = settings.sizeJitter ?? 0;
              const _colorJitter = settings.colorJitter ?? 0;
              const _rotationJitter = settings.rotationJitter ?? 0;
              const _flowJitter = settings.flowJitter ?? 0;
              const _stampX = sx + (Math.random() - 0.5) * 2 * _scatter;
              const _stampY = sy + (Math.random() - 0.5) * 2 * _scatter;
              const _stampSize =
                interpSize * (1 + (Math.random() - 0.5) * _sizeJitter);
              const _rotJitterRad =
                (_rotationJitter / 2) *
                (Math.PI / 180) *
                (Math.random() - 0.5) *
                2;
              const _flowJitterVal =
                (_flowJitter / 100) *
                _interpOpacity *
                (Math.random() - 0.5) *
                2;
              const _stampOpacity = Math.max(
                0,
                Math.min(1, _interpOpacity + _flowJitterVal),
              );
              const _baseAngle =
                settings.rotateMode === "follow"
                  ? strokeAngle
                  : (settings.rotation * Math.PI) / 180;
              const _stampAngle = _baseAngle + _rotJitterRad;
              // Dual tip color (no color jitter for texture)
              if (_tool === "eraser") {
                stampWebGL(
                  _stampX,
                  _stampY,
                  _stampSize,
                  _stampOpacity,
                  settings,
                  _stampAngle,
                  "rgb(255,255,255)",
                  undefined,
                  _segCapAlpha,
                );
              } else {
                const _jFill =
                  _colorJitter > 0
                    ? _applyColorJitter(_fillStyle, _colorJitter)
                    : _fillStyle;
                const _dualJFill = _jFill;
                stampWebGL(
                  _stampX,
                  _stampY,
                  _stampSize,
                  _stampOpacity,
                  settings,
                  _stampAngle,
                  _jFill,
                  _dualJFill,
                  _segCapAlpha,
                );
              }
            }
          }
          stampsPlaced++;
          accdist -= spacingPixels;
        }
        distAccumRef.current = accdist;
        distFromSegStart += segDist;
      }
    },
    [stampWebGL],
  );

  // ── renderSmearAlongPoints ────────────────────────────────────────────────
  // HeavyPaint-style smudge: samples paint at stroke start, drags it forward blending with canvas.
  // Must call initSmudgeBuffer(lc, pos, size) at stroke start before first move.
  // biome-ignore lint/correctness/useExhaustiveDependencies: all refs are stable (useRef)
  const renderSmearAlongPoints = useCallback(
    (
      lc: HTMLCanvasElement,
      points: Point[],
      brushSizeVal: number,
      settings: BrushSettings,
      strength = 0.8,
    ) => {
      const ctx = lc.getContext("2d", { willReadFrequently: !isIPad });
      if (!ctx || points.length < 2) return;
      const size = brushSizeVal;
      const radius = size / 2;
      const cw = lc.width;
      const ch = lc.height;
      const bufSize = Math.max(4, Math.round(size));
      const softness = settings.softness ?? 0;
      const scatter = settings.scatter ?? 0;
      const count = Math.max(1, settings.count ?? 1);
      const spacingPx = Math.max(1, ((settings.spacing ?? 5) / 100) * size);

      // Ensure smudge buffer typed array is allocated and sized correctly.
      // initSmudgeBuffer() is called at stroke start; this is a safety-net fallback.
      if (!_smudgeInitialized || _smudgeBufferDataSize !== bufSize) {
        const needed = bufSize * bufSize * 4;
        if (!_smudgeBufferData || _smudgeBufferDataCapacity < needed) {
          _smudgeBufferData = new Uint8ClampedArray(
            Math.max(needed, SMEAR_BUF_SIZE),
          );
          _smudgeBufferDataCapacity = _smudgeBufferData.length;
        }
        _smudgeBufferDataSize = bufSize;
        const ix = Math.max(
          0,
          Math.min(cw - bufSize, Math.round(points[0].x - radius)),
        );
        const iy = Math.max(
          0,
          Math.min(ch - bufSize, Math.round(points[0].y - radius)),
        );
        const initCtx = lc.getContext("2d", { willReadFrequently: !isIPad });
        if (initCtx) {
          const actualW = Math.min(bufSize, cw - ix);
          const actualH = Math.min(bufSize, ch - iy);
          const patch = initCtx.getImageData(ix, iy, actualW, actualH);
          if (actualW === bufSize && actualH === bufSize) {
            _smudgeBufferData.set(patch.data, 0);
          } else {
            _smudgeBufferData.fill(0, 0, needed);
            for (let row = 0; row < actualH; row++) {
              _smudgeBufferData.set(
                patch.data.subarray(row * actualW * 4, (row + 1) * actualW * 4),
                row * bufSize * 4,
              );
            }
          }
        }
        _smudgeInitialized = true;
      }

      // Distance-accumulator loop — same pattern as brush engine
      for (let segI = 1; segI < points.length; segI++) {
        const from = points[segI - 1];
        const to = points[segI];
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const segDist = Math.sqrt(dx * dx + dy * dy);
        if (segDist === 0) continue;
        let accdist = distAccumRef.current + segDist;
        let stampsPlaced = 0;
        while (accdist >= spacingPx) {
          const t =
            ((stampsPlaced + 1) * spacingPx - distAccumRef.current) / segDist;
          const baseSx = from.x + dx * t;
          const baseSy = from.y + dy * t;
          stampsPlaced++;
          accdist -= spacingPx;

          // Emit `count` stamps per spacing step (for multi-count brushes)
          for (let c = 0; c < count; c++) {
            const sx = baseSx + (Math.random() - 0.5) * 2 * scatter;
            const sy = baseSy + (Math.random() - 0.5) * 2 * scatter;

            const destX = Math.round(sx - radius);
            const destY = Math.round(sy - radius);
            const clampedX = Math.max(0, destX);
            const clampedY = Math.max(0, destY);
            const clampedW = Math.min(bufSize, cw - clampedX);
            const clampedH = Math.min(bufSize, ch - clampedY);
            if (clampedW <= 0 || clampedH <= 0) continue;

            try {
              // Build softness weight mask — cached on bufSize + tip image (not clampedW/H)
              const maxBufPixels = bufSize * bufSize;
              if (
                !_smearSoftnessWeights ||
                _smearSoftnessWeights.length < maxBufPixels
              ) {
                _smearSoftnessWeights = new Float32Array(
                  Math.max(maxBufPixels, SMEAR_BUF_SIZE),
                );
                _smearSoftnessSize = 0; // force recompute
              }
              const tipImg = settings.tipImageData;
              const hasTip = !!tipImg;
              const newTipKey = `${hasTip ? tipImg!.slice(0, 60) : "circle"}_${bufSize}_${softness}`;
              if (
                _smearSoftnessSize !== bufSize ||
                _smearTipCacheKey !== newTipKey
              ) {
                // Compute circular softness falloff
                const cx2 = bufSize / 2;
                const cy2 = bufSize / 2;
                const r = bufSize / 2;
                const innerR = r * (1 - softness);
                const rRange = r - innerR;
                for (let py = 0; py < bufSize; py++) {
                  for (let px2 = 0; px2 < bufSize; px2++) {
                    const dist = Math.sqrt((px2 - cx2) ** 2 + (py - cy2) ** 2);
                    const circleFalloff =
                      softness > 0
                        ? rRange > 0
                          ? Math.min(1, Math.max(0, (r - dist) / rRange))
                          : dist <= r
                            ? 1
                            : 0
                        : dist <= r
                          ? 1
                          : 0;
                    _smearSoftnessWeights![py * bufSize + px2] = circleFalloff;
                  }
                }
                // If a custom tip image is set, multiply in its alpha channel
                if (hasTip) {
                  const tc = tipCanvasCacheRef.current.get(
                    tipImg!.slice(0, 100),
                  );
                  if (tc) {
                    const tipScratch = document.createElement("canvas");
                    tipScratch.width = tipScratch.height = bufSize;
                    const tipCtx = tipScratch.getContext("2d")!;
                    tipCtx.drawImage(tc, 0, 0, bufSize, bufSize);
                    const tipPx = tipCtx.getImageData(
                      0,
                      0,
                      bufSize,
                      bufSize,
                    ).data;
                    for (let i = 0; i < maxBufPixels; i++) {
                      _smearSoftnessWeights![i] *= tipPx[i * 4 + 3] / 255;
                    }
                  }
                }
                _smearSoftnessSize = bufSize;
                _smearTipCacheKey = newTipKey;
              }
              const sw = _smearSoftnessWeights;
              // Offset into the full bufSize mask for edge-clamped stamps
              const swOffX = Math.max(0, -destX);
              const swOffY = Math.max(0, -destY);

              // Read canvas pixels at the stamp destination (1 getImageData per stamp).
              const patchLen = clampedW * clampedH * 4;
              if (!_smearPatchData || _smearPatchDataCapacity < patchLen) {
                _smearPatchData = new Uint8ClampedArray(
                  Math.max(patchLen, SMEAR_BUF_SIZE),
                );
                _smearPatchDataCapacity = _smearPatchData.length;
              }
              const ocd = _smearPatchData.subarray(0, patchLen);
              if (
                _smudgeCanvasMirror &&
                _smudgeCanvasMirrorW === cw &&
                _smudgeCanvasMirrorH === ch
              ) {
                for (let row = 0; row < clampedH; row++) {
                  const srcOff = ((clampedY + row) * cw + clampedX) * 4;
                  const dstOff = row * clampedW * 4;
                  ocd.set(
                    _smudgeCanvasMirror.subarray(srcOff, srcOff + clampedW * 4),
                    dstOff,
                  );
                }
              } else {
                // Fallback: mirror not available, use getImageData
                const fallback = ctx.getImageData(
                  clampedX,
                  clampedY,
                  clampedW,
                  clampedH,
                );
                ocd.set(fallback.data);
              }

              // Ensure paint output array is large enough
              if (!_smearPaintData || _smearPaintData.length < patchLen) {
                _smearPaintData = new Uint8ClampedArray(
                  Math.max(patchLen, SMEAR_BUF_SIZE),
                );
              }
              const paintData = _smearPaintData.subarray(0, patchLen);

              // getImageData/putImageData use STRAIGHT (un-premultiplied) alpha.
              let lpx = 0;
              let lpy = 0;
              const bd = _smudgeBufferData!;
              for (let i = 0; i < ocd.length; i += 4) {
                const bufIdx = ((lpy + swOffY) * bufSize + (lpx + swOffX)) * 4;
                const sWeight = sw[(lpy + swOffY) * bufSize + (lpx + swOffX)];

                const bR = bd[bufIdx];
                const bG = bd[bufIdx + 1];
                const bB = bd[bufIdx + 2];
                const bA = bd[bufIdx + 3];

                const oA = ocd[i + 3];
                const oR = oA > 0 ? ocd[i] : bR;
                const oG = oA > 0 ? ocd[i + 1] : bG;
                const oB = oA > 0 ? ocd[i + 2] : bB;

                const blendFactor = sWeight * strength;
                paintData[i] = oR + (bR - oR) * blendFactor;
                paintData[i + 1] = oG + (bG - oG) * blendFactor;
                paintData[i + 2] = oB + (bB - oB) * blendFactor;
                paintData[i + 3] = oA + (bA - oA) * blendFactor;

                bd[bufIdx] = oR + (bR - oR) * strength;
                bd[bufIdx + 1] = oG + (bG - oG) * strength;
                bd[bufIdx + 2] = oB + (bB - oB) * strength;
                bd[bufIdx + 3] = oA + (bA - oA) * strength;

                lpx++;
                if (lpx >= clampedW) {
                  lpx = 0;
                  lpy++;
                }
              }

              if (
                !_smearOutputImageData ||
                _smearOutputImageData.width !== clampedW ||
                _smearOutputImageData.height !== clampedH
              ) {
                _smearOutputImageData = new ImageData(clampedW, clampedH);
              }
              _smearOutputImageData.data.set(paintData);
              ctx.putImageData(_smearOutputImageData, clampedX, clampedY);
              markLayerBitmapDirty(activeLayerIdRef.current);

              // Keep mirror in sync so subsequent stamps see updated pixels
              if (
                _smudgeCanvasMirror &&
                _smudgeCanvasMirrorW === cw &&
                _smudgeCanvasMirrorH === ch
              ) {
                for (let row = 0; row < clampedH; row++) {
                  const dstOff = ((clampedY + row) * cw + clampedX) * 4;
                  const srcOff = row * clampedW * 4;
                  _smudgeCanvasMirror.set(
                    paintData.subarray(srcOff, srcOff + clampedW * 4),
                    dstOff,
                  );
                }
              }
            } catch {
              // Ignore cross-origin or out-of-bounds errors
            }
          }
          distAccumRef.current = accdist;
        }
      }
    },
    [],
  );

  // ── initSmudgeBuffer ──────────────────────────────────────────────────────
  const initSmudgeBuffer = useCallback(
    (lc: HTMLCanvasElement, startPos: Point, brushSize: number) => {
      const size = Math.max(4, Math.round(brushSize));
      const cw = lc.width;
      const ch = lc.height;
      const ix = Math.max(
        0,
        Math.min(cw - size, Math.round(startPos.x - size / 2)),
      );
      const iy = Math.max(
        0,
        Math.min(ch - size, Math.round(startPos.y - size / 2)),
      );
      const needed = size * size * 4;
      if (!_smudgeBufferData || _smudgeBufferDataCapacity < needed) {
        _smudgeBufferData = new Uint8ClampedArray(
          Math.max(needed, SMEAR_BUF_SIZE),
        );
        _smudgeBufferDataCapacity = _smudgeBufferData.length;
      }
      _smudgeBufferDataSize = size;
      // Sample the canvas region into the typed array (one small getImageData at stroke start)
      const initCtx = lc.getContext("2d", { willReadFrequently: !isIPad });
      if (initCtx) {
        const actualW = Math.min(size, cw - ix);
        const actualH = Math.min(size, ch - iy);
        const patch = initCtx.getImageData(ix, iy, actualW, actualH);
        if (actualW === size && actualH === size) {
          _smudgeBufferData.set(patch.data, 0);
        } else {
          _smudgeBufferData.fill(0, 0, needed);
          for (let row = 0; row < actualH; row++) {
            _smudgeBufferData.set(
              patch.data.subarray(row * actualW * 4, (row + 1) * actualW * 4),
              row * size * 4,
            );
          }
        }
      }
      _smudgeInitialized = true;
      // Populate the CPU mirror from the stroke-start snapshot (no extra getImageData)
      const snap = strokeStartSnapshotRef.current;
      if (snap) {
        // snap.pixels is the full-canvas ImageData for smear (captured at pointerdown)
        const needed2 = snap.pixels.data.length;
        if (!_smudgeCanvasMirror || _smudgeCanvasMirrorCapacity < needed2) {
          _smudgeCanvasMirror = new Uint8ClampedArray(needed2);
          _smudgeCanvasMirrorCapacity = needed2;
        }
        _smudgeCanvasMirror.set(snap.pixels.data);
        _smudgeCanvasMirrorW = snap.pixels.width;
        _smudgeCanvasMirrorH = snap.pixels.height;
      }
    },
    [],
  );

  return {
    // Stroke lifecycle refs
    tailRafIdRef,
    tailDoCommitRef,
    strokeStartSnapshotRef,
    strokeDirtyRectRef,
    strokeSnapLayerRef,
    strokeSnapshotPendingRef,
    strokeStampsPlacedRef,
    strokeWarmRawDistRef,
    // Pressure tracking refs
    smoothedPressureRef,
    prevPrimaryPressureRef,
    lastCompositeOpacityRef,
    flushDisplayCapRef,
    strokeCommitOpacityRef,
    // Stabilizer state refs
    stabBrushPosRef,
    smoothBufferRef,
    elasticPosRef,
    elasticVelRef,
    elasticRawPrevRef,
    // Glide-to-finish / smear / preview RAF refs
    rawStylusPosRef,
    smearDirtyRef,
    smearRafRef,
    strokePreviewRafRef,
    strokePreviewPendingWorkRef,
    // Stroke functions
    stampDot,
    stampWebGL,
    renderBrushSegmentAlongPoints,
    renderSmearAlongPoints,
    initSmudgeBuffer,
  };
}
