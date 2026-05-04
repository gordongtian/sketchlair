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
import { isIPad } from "../utils/constants";
import type { WebGLBrushContext } from "../utils/webglBrush";

// ─── Types ────────────────────────────────────────────────────────────────────
type Point = { x: number; y: number };
export type StrokePoint = {
  x: number;
  y: number;
  size: number;
  opacity: number;
  capAlpha?: number;
};

/** A single entry in the stroke-level path accumulation buffer.
 *  Exported so callers (usePaintingCanvasEvents) can type the reset/append ops.
 */
export type PathPoint = {
  x: number;
  y: number;
  opacity: number;
  size: number;
  capAlpha?: number;
};

// ─── Module-level smudge buffer ───────────────────────────────────────────────
export let _smudgeBufferData: Uint8ClampedArray | null = null;
export let _smudgeBufferDataCapacity = 0;
export let _smudgeBufferDataSize = 0;
export let _smudgeInitialized = false;
export let _smudgeCanvasMirror: Uint8ClampedArray | null = null;
export let _smudgeCanvasMirrorCapacity = 0;
export let _smudgeCanvasMirrorW = 0;
export let _smudgeCanvasMirrorH = 0;

// ─── Smear per-stroke working buffers ────────────────────────────────────────
// These are null between strokes (freed at stroke end). Allocated at stroke
// start via initSmearBuffers() to full canvas dimensions and nulled at stroke
// end via clearSmearBuffers(). Never keep a permanent allocation.
let _smearPatchData: Uint8ClampedArray | null = null;
let _smearSoftnessWeights: Float32Array | null = null;
let _smearPaintData: Uint8ClampedArray | null = null;
// _smearOutputImageData is a tiny per-stamp ImageData (only clampedW × clampedH)
// and is kept as a module-level reuse buffer to avoid allocating an ImageData per stamp.
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

/** Reset carried buffer to null at stroke end (pointer-up).
 *  The spec requires carriedBuffer = null between strokes. */
export function clearSmudgeBuffer(): void {
  _smudgeBufferData = null;
  _smudgeBufferDataCapacity = 0;
  _smudgeBufferDataSize = 0;
  _smudgeInitialized = false;
  _smudgeCanvasMirror = null;
  _smudgeCanvasMirrorCapacity = 0;
  _smudgeCanvasMirrorW = 0;
  _smudgeCanvasMirrorH = 0;
}

/**
 * Null all three smear working buffers.
 * Call at smear stroke end (pointer-up) and on tool switch away from smudge.
 * Allows GC to reclaim ~25 MB (2×4MB typed arrays + ~16.5MB weight map).
 */
export function clearSmearBuffers(): void {
  _smearPaintData = null;
  _smearPatchData = null;
  _smearSoftnessWeights = null;
  _smearSoftnessSize = 0;
  _smearTipCacheKey = "";
}

/**
 * Allocate all three smear working buffers at the current canvas dimensions
 * and populate _smearPaintData with the current layer pixel state.
 * Call at smear stroke start (pointer-down) before the first stamp.
 */
export function initSmearBuffers(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
): void {
  const w = canvas.width;
  const h = canvas.height;
  const total = w * h * 4;
  _smearPaintData = new Uint8ClampedArray(total);
  _smearPatchData = new Uint8ClampedArray(total);
  _smearSoftnessWeights = new Float32Array(w * h);
  _smearSoftnessSize = 0; // force weight map recompute on first stamp
  _smearTipCacheKey = "";
  // Populate _smearPaintData from the current canvas state — this is the
  // working copy that accumulates smear results across stamps this stroke.
  const snap = ctx.getImageData(0, 0, w, h);
  _smearPaintData.set(snap.data);
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
  for (let i = 0; i < 32; i++) {
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
  /** Flat layers array ref — used to guard ruler layer writes */
  layersRef?: React.MutableRefObject<{ id: string; isRuler?: boolean }[]>;
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
  layersRef,
}: UseStrokeEngineParams) {
  // ── Path accumulation refs ────────────────────────────────────────────────
  /**
   * Accumulates ALL input points for the current stroke in timestamp order.
   * Cleared on stroke start (pointer-down). Used by renderBrushSegmentAlongPoints
   * to place stamps along the full accumulated path rather than per-segment,
   * eliminating banding artifacts caused by variable event-segment lengths.
   */
  const strokePathBufferRef = useRef<PathPoint[]>([]);
  /**
   * Index into strokePathBufferRef of the path point just PAST the position
   * where the last stamp was emitted. The stamp loop advances forward from this
   * position on every new point append.
   */
  const lastStampPathIdxRef = useRef<number>(0);

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
      // Ruler layer guard — silently abort; tool stays active but produces no output
      if (
        layersRef?.current.find((l) => l.id === activeLayerIdRef.current)
          ?.isRuler
      )
        return;
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
        // Create tinted stamp: fill with brush color, mask with tip alpha (fresh canvas per stamp)
        const tintCanvas = document.createElement("canvas");
        tintCanvas.width = tintCanvas.height = 128;
        const tintCtx = tintCanvas.getContext("2d", {
          willReadFrequently: true,
        })!;
        tintCtx.clearRect(0, 0, 128, 128);
        tintCtx.globalCompositeOperation = "source-over";
        tintCtx.fillStyle = ctx.fillStyle as string;
        tintCtx.fillRect(0, 0, 128, 128);
        tintCtx.globalCompositeOperation = "destination-in";
        tintCtx.drawImage(tipCanvas, 0, 0);
        tintCtx.globalCompositeOperation = "source-over";

        ctx.save();
        ctx.translate(x, y);
        if (angle !== 0) ctx.rotate(angle);
        ctx.drawImage(tintCanvas, -size / 2, -size / 2, size, size);
        ctx.restore();
        return;
      }

      // Default tip fallback: use preloaded circle tip or arc (fresh canvas per stamp)
      const defTip = defaultTipCanvasRef.current;
      if (defTip) {
        const tintCanvas = document.createElement("canvas");
        tintCanvas.width = tintCanvas.height = 128;
        const tintCtx = tintCanvas.getContext("2d", {
          willReadFrequently: true,
        })!;
        tintCtx.clearRect(0, 0, 128, 128);
        tintCtx.globalCompositeOperation = "source-over";
        tintCtx.filter =
          settings.softness > 0
            ? `blur(${Math.round(settings.softness * 20)}px)`
            : "none";
        tintCtx.fillStyle = ctx.fillStyle as string;
        tintCtx.fillRect(0, 0, 128, 128);
        tintCtx.globalCompositeOperation = "destination-in";
        tintCtx.drawImage(defTip, 0, 0);
        tintCtx.globalCompositeOperation = "source-over";
        tintCtx.filter = "none";
        ctx.save();
        ctx.translate(x, y);
        if (angle !== 0) ctx.rotate(angle);
        ctx.drawImage(tintCanvas, -size / 2, -size / 2, size, size);
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
      // Ruler layer guard — silently abort; tool stays active but produces no output
      if (
        layersRef?.current.find((l) => l.id === activeLayerIdRef.current)
          ?.isRuler
      )
        return;
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
        settings.minOpacity ?? 0,
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

      // ── Path accumulation: append new points to the stroke path buffer ─────
      // Each call adds the new tail point(s) to the buffer. The head point is
      // already present from the previous call (it was the tail of the last
      // segment). We dedup at the seam to avoid zero-length ghost segments.
      const buf = strokePathBufferRef.current;
      const fromPoint = points[0];
      const toPoint = points[points.length - 1];

      // Build the opacity/size for each new point based on caller-supplied range.
      // For the two-point [from, to] case (the common path), we interpolate
      // opacity and size linearly. For longer polylines the same logic applies.
      const totalNewSegs = points.length - 1;
      let newPointsAdded = 0;
      for (let pi = 0; pi < points.length; pi++) {
        const t = totalNewSegs > 0 ? pi / totalNewSegs : 1;
        const ptOpacity = opacityFrom + (opacityTo - opacityFrom) * t;
        const ptSize = sizeFrom + (sizeTo - sizeFrom) * t;
        const pt = points[pi];
        // Skip the head point if it exactly matches the last buffered point
        // (seam dedup) — but always add the tail and any intermediate points.
        if (pi === 0 && buf.length > 0) {
          const last = buf[buf.length - 1];
          if (
            Math.abs(last.x - pt.x) < 0.001 &&
            Math.abs(last.y - pt.y) < 0.001
          ) {
            continue;
          }
        }
        buf.push({
          x: pt.x,
          y: pt.y,
          opacity: ptOpacity,
          size: ptSize,
          capAlpha: _segCapAlpha,
        });
        newPointsAdded++;
      }
      // Nothing meaningful added — nothing to stamp.
      if (newPointsAdded === 0 || buf.length < 2) return;

      // ── Stamp loop: advance along accumulated path from last stamp position ─
      // idx is the index of the SECOND point of the current sub-segment we are
      // walking. lastStampPathIdxRef tracks where we currently are in the buffer.
      const _fillStyle = _tool !== "eraser" ? (ctx.fillStyle as string) : "";

      // Start walking from the segment that contains the last-stamp residual.
      let idx = lastStampPathIdxRef.current;
      // Clamp: idx must be at least 1 (we need a from/to pair).
      if (idx < 1) idx = 1;
      // If the buffer shrank (shouldn't happen, but guard) reset to start.
      if (idx >= buf.length) idx = 1;

      while (idx < buf.length) {
        const A = buf[idx - 1];
        const B = buf[idx];
        const dx = B.x - A.x;
        const dy = B.y - A.y;
        const segDist = Math.sqrt(dx * dx + dy * dy);
        const strokeAngle = Math.atan2(dy, dx);

        // Adaptive spacing (same formula as before, using A's opacity as base).
        const _asp_softness = settings.softness ?? 0;
        const _asp_flow = A.opacity;
        const _asp_softFactor =
          _asp_softness > 0.5
            ? 1.0 -
              (_asp_softness - 0.5) * 2.0 * (1.0 - Math.max(0.35, _asp_flow))
            : 1.0;
        const interpSize = (A.size + B.size) / 2;
        const spacingPixels = Math.max(
          1,
          ((settings.spacing / 100) * interpSize * _asp_softFactor) /
            (settings.count ?? 1),
        );

        // Walk this segment, placing stamps wherever distAccumRef reaches spacing.
        let distIntoSeg = 0;
        // How far along this segment until the first stamp lands.
        const distToFirstStamp = spacingPixels - distAccumRef.current;

        if (distToFirstStamp > segDist) {
          // No stamp fits in this segment — accumulate and move on.
          distAccumRef.current += segDist;
          idx++;
          continue;
        }

        // Place all stamps that fit in this segment.
        distIntoSeg = distToFirstStamp;
        while (distIntoSeg <= segDist + 1e-9) {
          const segT = segDist > 0 ? distIntoSeg / segDist : 0;
          const sx = A.x + dx * segT;
          const sy = A.y + dy * segT;
          // Pressure-interpolated opacity between the two path points.
          const stampOpacityBase = A.opacity + (B.opacity - A.opacity) * segT;
          // capAlpha from the nearer path point (use A's unless past midpoint).
          const stampCapAlpha = segT < 0.5 ? A.capAlpha : B.capAlpha;

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
              stampOpacityBase *
              (Math.random() - 0.5) *
              2;
            const _stampOpacity = Math.max(
              0,
              Math.min(1, stampOpacityBase + _flowJitterVal),
            );
            const _baseAngle =
              settings.rotateMode === "follow"
                ? strokeAngle
                : (settings.rotation * Math.PI) / 180;
            const _stampAngle = _baseAngle + _rotJitterRad;

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
                stampCapAlpha,
              );
            } else {
              const _jFill =
                _colorJitter > 0
                  ? _applyColorJitter(_fillStyle, _colorJitter)
                  : _fillStyle;
              stampWebGL(
                _stampX,
                _stampY,
                _stampSize,
                _stampOpacity,
                settings,
                _stampAngle,
                _jFill,
                _jFill,
                stampCapAlpha,
              );
            }
          }

          distIntoSeg += spacingPixels;
        }

        // Remainder after the last stamp in this segment.
        // distIntoSeg overshot segDist by (distIntoSeg - segDist - spacingPixels) beyond the last stamp.
        // The last stamp was at distIntoSeg - spacingPixels.
        const lastStampDistIntoSeg = distIntoSeg - spacingPixels;
        distAccumRef.current = segDist - lastStampDistIntoSeg;

        // Update lastStampPathIdx to point to this segment.
        lastStampPathIdxRef.current = idx;
        idx++;
      }

      // Suppress unused-variable warnings — fromPoint / toPoint only used for
      // documentation of the approach above.
      void fromPoint;
      void toPoint;
    },
    [stampWebGL],
  );

  // ── renderSmearAlongPoints ────────────────────────────────────────────────
  // Spec-compliant smudge: carries a pixel buffer across the stroke.
  // Per-stamp order: (1) sample canvas, (2) blend buffer, (3) deposit with tip mask.
  // Must call initSmudgeBuffer(lc, pos, size) at stroke start before first move.
  // biome-ignore lint/correctness/useExhaustiveDependencies: all refs are stable (useRef)
  const renderSmearAlongPoints = useCallback(
    (
      lc: HTMLCanvasElement,
      points: Point[],
      brushSizeVal: number,
      settings: BrushSettings,
      strength = 0.8,
      opacity = 1.0,
    ) => {
      // Ruler layer guard — silently abort; tool stays active but produces no output
      if (
        layersRef?.current.find((l) => l.id === activeLayerIdRef.current)
          ?.isRuler
      )
        return;
      const ctx = lc.getContext("2d", { willReadFrequently: !isIPad });
      if (!ctx || points.length < 2) return;

      // At strength=0: complete no-op — depositOpacity=0, nothing deposited.
      if (strength <= 0) return;

      const size = brushSizeVal;
      const radius = size / 2;
      const cw = lc.width;
      const ch = lc.height;
      const bufSize = Math.max(4, Math.round(size));
      const softness = settings.softness ?? 0;
      const scatter = settings.scatter ?? 0;
      const count = Math.max(1, settings.count ?? 1);
      const spacingPx = Math.max(1, ((settings.spacing ?? 5) / 100) * size);

      // absorbRate = 1 - strength
      // strength=1 → absorbRate=0 → buffer never changes (thick wet paint drag)
      // strength=0 → absorbRate=1 → buffer immediately becomes canvas (no-op: deposit=0)
      const absorbRate = 1.0 - strength;
      // depositOpacity scales with strength
      const depositOpacity = opacity * strength;

      // Ensure smudge buffer typed array is allocated and sized correctly.
      // initSmudgeBuffer() is called at stroke start; this is a safety-net fallback.
      if (!_smudgeInitialized || _smudgeBufferDataSize !== bufSize) {
        const needed = bufSize * bufSize * 4;
        if (!_smudgeBufferData || _smudgeBufferDataCapacity < needed) {
          _smudgeBufferData = new Uint8ClampedArray(needed);
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
              // Build tip alpha mask — cached on bufSize + tip image + softness.
              // This mask defines tipAlpha per pixel within the bufSize bounding box.
              // _smearSoftnessWeights is pre-allocated at stroke start (canvas.width * canvas.height
              // floats), which is always >= bufSize * bufSize, so no capacity check is needed.
              if (!_smearSoftnessWeights) continue; // safety guard: buffers must be init'd
              const maxBufPixels = bufSize * bufSize;
              const tipImg = settings.tipImageData;
              const hasTip = !!tipImg;
              const newTipKey = `${hasTip ? tipImg!.slice(0, 60) : "circle"}_${bufSize}_${softness}`;
              if (
                _smearSoftnessSize !== bufSize ||
                _smearTipCacheKey !== newTipKey
              ) {
                // Compute circular softness falloff (gaussian-style via hardness)
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

              // ── Step 1: Sample canvas BEFORE deposit ──────────────────────
              // Read canvas pixels at the stamp destination.
              // _smearPatchData is pre-allocated at stroke start to canvas.width * canvas.height * 4
              // bytes, which is always >= clampedW * clampedH * 4.
              const patchLen = clampedW * clampedH * 4;
              if (!_smearPatchData) continue; // safety guard
              const canvasPixels = _smearPatchData.subarray(0, patchLen);
              if (
                _smudgeCanvasMirror &&
                _smudgeCanvasMirrorW === cw &&
                _smudgeCanvasMirrorH === ch
              ) {
                for (let row = 0; row < clampedH; row++) {
                  const srcOff = ((clampedY + row) * cw + clampedX) * 4;
                  const dstOff = row * clampedW * 4;
                  canvasPixels.set(
                    _smudgeCanvasMirror.subarray(srcOff, srcOff + clampedW * 4),
                    dstOff,
                  );
                }
              } else {
                const fallback = ctx.getImageData(
                  clampedX,
                  clampedY,
                  clampedW,
                  clampedH,
                );
                canvasPixels.set(fallback.data);
              }

              // ── Step 2: Update carried buffer (blendBuffers) ──────────────
              // Premultiplied-alpha lerp to prevent black bleed when blending
              // into transparent canvas space (RGBA 0,0,0,0).
              // Straight-alpha lerp pulls RGB toward (0,0,0) because transparent
              // pixels have RGB=0. Premultiplied space naturally handles this:
              // a fully-transparent pixel has all premultiplied channels = 0,
              // so blending toward it fades color to transparent without tinting.
              //
              // absorbRate=0 → carried unchanged; absorbRate=1 → carried becomes canvas
              const bd = _smudgeBufferData!;
              if (absorbRate > 0) {
                let lpx2 = 0;
                let lpy2 = 0;
                for (let i = 0; i < canvasPixels.length; i += 4) {
                  const bufIdx =
                    ((lpy2 + swOffY) * bufSize + (lpx2 + swOffX)) * 4;

                  // Convert canvas sample to premultiplied alpha
                  const cA = canvasPixels[i + 3] / 255;
                  const cR_pre = canvasPixels[i] * cA;
                  const cG_pre = canvasPixels[i + 1] * cA;
                  const cB_pre = canvasPixels[i + 2] * cA;
                  const cA_pre = canvasPixels[i + 3];

                  // Convert carried buffer pixel to premultiplied alpha
                  const bA = bd[bufIdx + 3] / 255;
                  const bR_pre = bd[bufIdx] * bA;
                  const bG_pre = bd[bufIdx + 1] * bA;
                  const bB_pre = bd[bufIdx + 2] * bA;
                  const bA_pre = bd[bufIdx + 3];

                  // Lerp in premultiplied space
                  const rR_pre = bR_pre + (cR_pre - bR_pre) * absorbRate;
                  const rG_pre = bG_pre + (cG_pre - bG_pre) * absorbRate;
                  const rB_pre = bB_pre + (cB_pre - bB_pre) * absorbRate;
                  const rA_pre = bA_pre + (cA_pre - bA_pre) * absorbRate;

                  // Convert back to straight alpha
                  const rA_norm = rA_pre / 255;
                  bd[bufIdx + 3] = Math.round(rA_pre);
                  if (rA_norm > 0) {
                    bd[bufIdx] = Math.round(rR_pre / rA_norm);
                    bd[bufIdx + 1] = Math.round(rG_pre / rA_norm);
                    bd[bufIdx + 2] = Math.round(rB_pre / rA_norm);
                  } else {
                    // Fully transparent — RGB is irrelevant, zero it out cleanly
                    bd[bufIdx] = 0;
                    bd[bufIdx + 1] = 0;
                    bd[bufIdx + 2] = 0;
                  }

                  lpx2++;
                  if (lpx2 >= clampedW) {
                    lpx2 = 0;
                    lpy2++;
                  }
                }
              }

              // ── Step 3: Deposit carried buffer onto canvas with tip mask ──
              // For each pixel: source-over composite at depositOpacity × tipAlpha.
              // Read existing canvas pixels for source-over blending.
              // _smearPaintData is pre-allocated at stroke start to canvas.width * canvas.height * 4
              // bytes, which is always >= clampedW * clampedH * 4.
              if (!_smearPaintData) continue; // safety guard
              const outputPixels = _smearPaintData.subarray(0, patchLen);

              let lpx = 0;
              let lpy = 0;
              for (let i = 0; i < canvasPixels.length; i += 4) {
                const bufIdx = ((lpy + swOffY) * bufSize + (lpx + swOffX)) * 4;
                const tipAlpha = sw[(lpy + swOffY) * bufSize + (lpx + swOffX)];

                // Final source alpha = depositOpacity × tipAlpha × (carried alpha / 255)
                const srcA = (depositOpacity * tipAlpha * bd[bufIdx + 3]) / 255;

                if (srcA <= 0) {
                  // Tip mask = 0: pass canvas pixel through unchanged
                  outputPixels[i] = canvasPixels[i];
                  outputPixels[i + 1] = canvasPixels[i + 1];
                  outputPixels[i + 2] = canvasPixels[i + 2];
                  outputPixels[i + 3] = canvasPixels[i + 3];
                } else {
                  // Source-over composite (straight alpha):
                  // outA   = srcA + dstA*(1 - srcA)
                  // outRGB = (srcRGB*srcA + dstRGB*dstA*(1-srcA)) / outA
                  const dstA = canvasPixels[i + 3] / 255;
                  const outA = srcA + dstA * (1 - srcA);
                  if (outA > 0) {
                    const invSrcA = 1 - srcA;
                    const srcContrib = srcA / outA;
                    const dstContrib = (dstA * invSrcA) / outA;
                    outputPixels[i] = Math.min(
                      255,
                      Math.round(
                        bd[bufIdx] * srcContrib + canvasPixels[i] * dstContrib,
                      ),
                    );
                    outputPixels[i + 1] = Math.min(
                      255,
                      Math.round(
                        bd[bufIdx + 1] * srcContrib +
                          canvasPixels[i + 1] * dstContrib,
                      ),
                    );
                    outputPixels[i + 2] = Math.min(
                      255,
                      Math.round(
                        bd[bufIdx + 2] * srcContrib +
                          canvasPixels[i + 2] * dstContrib,
                      ),
                    );
                    outputPixels[i + 3] = Math.min(255, Math.round(outA * 255));
                  } else {
                    outputPixels[i] = 0;
                    outputPixels[i + 1] = 0;
                    outputPixels[i + 2] = 0;
                    outputPixels[i + 3] = 0;
                  }
                }

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
              _smearOutputImageData.data.set(outputPixels);
              ctx.putImageData(_smearOutputImageData, clampedX, clampedY);
              markLayerBitmapDirty(activeLayerIdRef.current);

              // Keep mirror in sync so subsequent stamps read the updated canvas
              if (
                _smudgeCanvasMirror &&
                _smudgeCanvasMirrorW === cw &&
                _smudgeCanvasMirrorH === ch
              ) {
                for (let row = 0; row < clampedH; row++) {
                  const dstOff = ((clampedY + row) * cw + clampedX) * 4;
                  const srcOff = row * clampedW * 4;
                  _smudgeCanvasMirror.set(
                    outputPixels.subarray(srcOff, srcOff + clampedW * 4),
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
        _smudgeBufferData = new Uint8ClampedArray(needed);
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
    // Path accumulation refs — must be reset at stroke start (pointer-down)
    strokePathBufferRef,
    lastStampPathIdxRef,
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
