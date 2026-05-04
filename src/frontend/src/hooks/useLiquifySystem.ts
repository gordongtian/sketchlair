/**
 * useLiquifySystem — GPU single-pass backward-mapping warp.
 *
 * Holds UI state (size, strength, hardness, stretch) and exports the
 * stroke lifecycle functions called by usePaintingCanvasEvents.
 *
 * The actual warp is computed in a fragment shader via WebGLBrushContext
 * (initLiquifyGPU / renderLiquifyFrame / blitLiquifyPreview / commitLiquify).
 * This module retains the CPU bilinear helper for use by the multi-layer
 * CPU fallback path (_liquifyApplyWarpToLayer in usePaintingCanvasEvents.ts).
 */

import { useEffect, useRef, useState } from "react";

// ─── Named constants ──────────────────────────────────────────────────────────
/** Maximum displacement per frame as a fraction of radius. */
export const LIQUIFY_MAX_DISP_SCALE = 1.5;

// ─── Stroke-active flag ───────────────────────────────────────────────────────
// Checked by the compositing system to suppress pre-warp composites mid-stroke.
let _liquifyStrokeActive = false;

export function getLiquifyStrokeActive(): boolean {
  return _liquifyStrokeActive;
}
export function setLiquifyStrokeActive(v: boolean): void {
  _liquifyStrokeActive = v;
}

// ─── Module-level stroke state ────────────────────────────────────────────────
// Frozen source snapshot captured at pointer-down — kept for undo "before" state.
// Freed at pointer-up / cancel / tool-switch.
let _liqSource: ImageData | null = null;
let _liqW = 0;
let _liqH = 0;
let _liqPrevX = 0;
let _liqPrevY = 0;

// ─── Stroke lifecycle ─────────────────────────────────────────────────────────

/**
 * Capture the frozen source snapshot at pointer-down.
 * Called once per stroke; the snapshot is used as the undo "before" state.
 */
export function liquifyPointerDown(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  _layerId = "",
): void {
  const canvas = ctx.canvas;
  _liqW = canvas.width;
  _liqH = canvas.height;
  _liqSource = ctx.getImageData(0, 0, _liqW, _liqH);
  _liqPrevX = cx;
  _liqPrevY = cy;
}

/** Update previous cursor position. Called after each renderLiquifyFrame. */
export function liquifyUpdatePrev(cx: number, cy: number): void {
  _liqPrevX = cx;
  _liqPrevY = cy;
}

/** Current previous cursor X. */
export function liquifyPrevX(): number {
  return _liqPrevX;
}
/** Current previous cursor Y. */
export function liquifyPrevY(): number {
  return _liqPrevY;
}

/**
 * Returns undo data at pointer-up (the frozen source as "before", the current
 * canvas state as "after"), then frees all stroke state.
 *
 * The caller is responsible for writing the final warped result to the layer
 * canvas BEFORE calling this (via webglBrushRef.current.commitLiquify).
 */
export function liquifyPointerUp(ctx: CanvasRenderingContext2D): {
  before: ImageData;
  after: ImageData;
  dirtyRect: { x: number; y: number; width: number; height: number };
} | null {
  if (!_liqSource) return null;

  const before = _liqSource;
  const W = _liqW;
  const H = _liqH;

  // after is read from the layer canvas — caller must have committed to it already
  const after = ctx.getImageData(0, 0, W, H);

  _liqSource = null;

  return {
    before,
    after,
    dirtyRect: { x: 0, y: 0, width: W, height: H },
  };
}

/**
 * Free all liquify stroke state without committing.
 * Call on pointer-cancel and tool-switch away from liquify mid-stroke.
 */
export function liquifyFreeState(): void {
  _liqSource = null;
}

/** Returns true if a liquify stroke is currently in progress. */
export function liquifyIsActive(): boolean {
  return _liqSource !== null;
}

// ─── Internal helpers (CPU path for multi-layer fallback) ─────────────────────

export function _bilinearSample(
  src: ImageData,
  sxRaw: number,
  syRaw: number,
  w: number,
  h: number,
): { r: number; g: number; b: number; a: number } {
  const sx = Math.max(0, Math.min(w - 1, sxRaw));
  const sy = Math.max(0, Math.min(h - 1, syRaw));

  const x0 = Math.floor(sx);
  const x1 = Math.min(x0 + 1, w - 1);
  const y0 = Math.floor(sy);
  const y1 = Math.min(y0 + 1, h - 1);
  const fx = sx - x0;
  const fy = sy - y0;

  const d = src.data;
  const i00 = (y0 * w + x0) * 4;
  const i10 = (y0 * w + x1) * 4;
  const i01 = (y1 * w + x0) * 4;
  const i11 = (y1 * w + x1) * 4;

  const w00 = (1 - fx) * (1 - fy);
  const w10 = fx * (1 - fy);
  const w01 = (1 - fx) * fy;
  const w11 = fx * fy;

  return {
    r: d[i00] * w00 + d[i10] * w10 + d[i01] * w01 + d[i11] * w11,
    g:
      d[i00 + 1] * w00 + d[i10 + 1] * w10 + d[i01 + 1] * w01 + d[i11 + 1] * w11,
    b:
      d[i00 + 2] * w00 + d[i10 + 2] * w10 + d[i01 + 2] * w01 + d[i11 + 2] * w11,
    a:
      d[i00 + 3] * w00 + d[i10 + 3] * w10 + d[i01 + 3] * w01 + d[i11 + 3] * w11,
  };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface LiquifySystemReturn {
  // React state (for UI sliders)
  liquifySize: number;
  liquifyStrength: number;
  liquifyHardness: number;
  liquifyStretch: number;
  liquifyScope: "active" | "all-visible";
  setLiquifySize: React.Dispatch<React.SetStateAction<number>>;
  setLiquifyStrength: React.Dispatch<React.SetStateAction<number>>;
  setLiquifyHardness: React.Dispatch<React.SetStateAction<number>>;
  setLiquifyStretch: React.Dispatch<React.SetStateAction<number>>;
  setLiquifyScope: React.Dispatch<
    React.SetStateAction<"active" | "all-visible">
  >;

  // Refs (for hot-path pointer handlers)
  liquifySizeRef: React.MutableRefObject<number>;
  liquifyStrengthRef: React.MutableRefObject<number>;
  liquifyHardnessRef: React.MutableRefObject<number>;
  liquifyStretchRef: React.MutableRefObject<number>;
  liquifyScopeRef: React.MutableRefObject<"active" | "all-visible">;

  // Legacy refs retained so usePaintingCanvasEvents destructuring still works
  liquifyBeforeSnapshotRef: React.MutableRefObject<ImageData | null>;
  liquifyMultiBeforeSnapshotsRef: React.MutableRefObject<
    Map<string, ImageData>
  >;
}

export function useLiquifySystem(): LiquifySystemReturn {
  const [liquifySize, setLiquifySize] = useState(80);
  const [liquifyStrength, setLiquifyStrength] = useState(1.0);
  const [liquifyHardness, setLiquifyHardness] = useState(0);
  const [liquifyStretch, setLiquifyStretch] = useState(1.0);
  const [liquifyScope, setLiquifyScope] = useState<"active" | "all-visible">(
    "active",
  );

  const liquifySizeRef = useRef(80);
  const liquifyStrengthRef = useRef(1.0);
  const liquifyHardnessRef = useRef(0);
  const liquifyStretchRef = useRef(1.0);
  const liquifyScopeRef = useRef<"active" | "all-visible">("active");

  // Legacy refs — kept so the destructuring in usePaintingCanvasEvents compiles
  const liquifyBeforeSnapshotRef = useRef<ImageData | null>(null);
  const liquifyMultiBeforeSnapshotsRef = useRef<Map<string, ImageData>>(
    new Map(),
  );

  useEffect(() => {
    liquifySizeRef.current = liquifySize;
  }, [liquifySize]);
  useEffect(() => {
    liquifyStrengthRef.current = liquifyStrength;
  }, [liquifyStrength]);
  useEffect(() => {
    liquifyHardnessRef.current = liquifyHardness;
  }, [liquifyHardness]);
  useEffect(() => {
    liquifyStretchRef.current = liquifyStretch;
  }, [liquifyStretch]);
  useEffect(() => {
    liquifyScopeRef.current = liquifyScope;
  }, [liquifyScope]);

  return {
    liquifySize,
    liquifyStrength,
    liquifyHardness,
    liquifyStretch,
    liquifyScope,
    setLiquifySize,
    setLiquifyStrength,
    setLiquifyHardness,
    setLiquifyStretch,
    setLiquifyScope,
    liquifySizeRef,
    liquifyStrengthRef,
    liquifyHardnessRef,
    liquifyStretchRef,
    liquifyScopeRef,
    liquifyBeforeSnapshotRef,
    liquifyMultiBeforeSnapshotsRef,
  };
}
