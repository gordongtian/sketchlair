/**
 * useLiquifySystem — Krita-style displacement mesh liquify tool.
 *
 * Owns all liquify state, refs, and the displacement field math.
 * The pointer down/move/up handlers live in PaintingApp but call the
 * functions exported here so the logic is co-located with the data.
 */

import { useEffect, useRef, useState } from "react";

// ─── Module-level displacement field buffers ─────────────────────────────────
// These must live at module scope so they survive re-renders without being
// recreated. They are reset whenever the canvas is resized via resetField().

let _liquifyDxDy: Float32Array | null = null;
let _liquifySnapshot: ImageData | null = null;
let _liquifySnapW = 0;
let _liquifySnapH = 0;
let _liquifyDirtyX0 = 0;
let _liquifyDirtyY0 = 0;
let _liquifyDirtyX1 = 0;
let _liquifyDirtyY1 = 0;
let _liquifyOutput: ImageData | null = null;

// ─── Exported getters/setters for module-level state ─────────────────────────
// PaintingApp's pointer handlers read/write these during the stroke.

export function getLiquifySnapshot(): ImageData | null {
  return _liquifySnapshot;
}
export function setLiquifySnapshot(v: ImageData | null) {
  _liquifySnapshot = v;
}
export function getLiquifySnapW(): number {
  return _liquifySnapW;
}
export function getLiquifySnapH(): number {
  return _liquifySnapH;
}
export function getLiquifyDxDy(): Float32Array | null {
  return _liquifyDxDy;
}

/** Called at pen-down to initialise the displacement field for a new stroke. */
export function initLiquifyField(
  snapData: ImageData,
  width: number,
  height: number,
): void {
  _liquifySnapshot = snapData;
  _liquifySnapW = width;
  _liquifySnapH = height;
  const needed = width * height * 2;
  if (!_liquifyDxDy || _liquifyDxDy.length !== needed) {
    _liquifyDxDy = new Float32Array(needed);
  } else {
    _liquifyDxDy.fill(0);
  }
  // Reset dirty rect to empty (nothing displaced yet)
  _liquifyDirtyX0 = width;
  _liquifyDirtyY0 = height;
  _liquifyDirtyX1 = 0;
  _liquifyDirtyY1 = 0;
}

/** Reset field after canvas resize so stale data is never used. */
export function resetLiquifyField(): void {
  _liquifyDxDy = null;
  _liquifySnapshot = null;
  _liquifyOutput = null;
  _liquifySnapW = 0;
  _liquifySnapH = 0;
}

// ─── Core displacement math ───────────────────────────────────────────────────

/**
 * Accumulate a push-mode displacement stamp at (cx, cy) with Gaussian-cosine
 * falloff. Strength is the raw slider value (0–1); the 0.6 rescale is applied
 * by the caller so this function stays pure.
 */
export function updateLiquifyDisplacementField(
  cx: number,
  cy: number,
  radius: number,
  strength: number,
  dxDir: number,
  dyDir: number,
): void {
  if (!_liquifyDxDy || !_liquifySnapshot) return;
  const W = _liquifySnapW;
  const H = _liquifySnapH;
  // Raised cosine falloff: exactly 1 at center, exactly 0 at boundary — no discontinuity ring.
  // The old Gaussian at sigma=radius/2 still had ~13.5% amplitude at dist=radius, which caused
  // a visible ring artifact for radially-symmetric modes like expand/pinch.
  // Per-stamp displacement step. Increased from 0.08 to 0.15 so push/expand travel a
  // visually convincing distance without needing many overlapping passes.
  const stepAmt = radius * 0.15 * strength;
  // Cap raised to radius*8 so content can travel far before hitting the hard limit.
  // The old cap of radius*3 was too small — users felt pushes "dropping" after a short distance.
  const maxDisp = radius * 8;
  const maxDisp2 = maxDisp * maxDisp;
  const x0 = Math.max(0, Math.floor(cx - radius));
  const y0 = Math.max(0, Math.floor(cy - radius));
  const x1 = Math.min(W, Math.ceil(cx + radius + 1));
  const y1 = Math.min(H, Math.ceil(cy + radius + 1));

  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      const offX = px - cx;
      const offY = py - cy;
      const dist = Math.sqrt(offX * offX + offY * offY);
      if (dist >= radius) continue;
      // cos²(dist/radius * π/2): exactly 1 at center, exactly 0 at boundary.
      const t = dist / radius;
      const cosVal = Math.cos(t * Math.PI * 0.5);
      const lambda = cosVal * cosVal;
      const i = (py * W + px) * 2;

      // Push: source pixel is pulled backward along stroke direction.
      // dxDir/dyDir are already normalised stroke direction components.
      _liquifyDxDy[i] -= lambda * dxDir * stepAmt;
      _liquifyDxDy[i + 1] -= lambda * dyDir * stepAmt;

      // Clamp total displacement so we never fold content catastrophically.
      // Skip sqrt unless cap actually triggers (avoid sqrt on most pixels).
      const dx = _liquifyDxDy[i];
      const dy = _liquifyDxDy[i + 1];
      const totalDisp2 = dx * dx + dy * dy;
      if (totalDisp2 > maxDisp2) {
        const totalDisp = Math.sqrt(totalDisp2);
        const s = maxDisp / totalDisp;
        _liquifyDxDy[i] = dx * s;
        _liquifyDxDy[i + 1] = dy * s;
      }
    }
  }

  // Expand dirty rect
  _liquifyDirtyX0 = Math.min(_liquifyDirtyX0, x0);
  _liquifyDirtyY0 = Math.min(_liquifyDirtyY0, y0);
  _liquifyDirtyX1 = Math.max(_liquifyDirtyX1, x1);
  _liquifyDirtyY1 = Math.max(_liquifyDirtyY1, y1);
}

/**
 * Apply the current displacement field to the layer canvas using bilinear
 * interpolation. Always renders the full cumulative dirty rect so that every
 * displaced pixel is redrawn — rendering only the current stamp footprint
 * caused oval/ring artifacts on earlier passes.
 */
export function renderLiquifyFromSnapshot(ctx: CanvasRenderingContext2D): void {
  if (!_liquifyDxDy || !_liquifySnapshot) return;
  const W = _liquifySnapW;
  const H = _liquifySnapH;
  const rx0 = _liquifyDirtyX0;
  const ry0 = _liquifyDirtyY0;
  const rx1 = _liquifyDirtyX1;
  const ry1 = _liquifyDirtyY1;
  const rw = rx1 - rx0;
  const rh = ry1 - ry0;
  if (rw <= 0 || rh <= 0) return;

  if (
    !_liquifyOutput ||
    _liquifyOutput.width !== rw ||
    _liquifyOutput.height !== rh
  ) {
    _liquifyOutput = new ImageData(rw, rh);
  }
  const out = _liquifyOutput.data;
  const src = _liquifySnapshot.data;

  for (let py = ry0; py < ry1; py++) {
    for (let px = rx0; px < rx1; px++) {
      const di = (py * W + px) * 2;
      const srcX = px + _liquifyDxDy[di];
      const srcY = py + _liquifyDxDy[di + 1];
      const oi = ((py - ry0) * rw + (px - rx0)) * 4;

      if (srcX < 0 || srcX >= W - 1 || srcY < 0 || srcY >= H - 1) {
        const cx2 = Math.max(0, Math.min(W - 1, Math.round(srcX)));
        const cy2 = Math.max(0, Math.min(H - 1, Math.round(srcY)));
        const si = (cy2 * W + cx2) * 4;
        out[oi] = src[si];
        out[oi + 1] = src[si + 1];
        out[oi + 2] = src[si + 2];
        out[oi + 3] = src[si + 3];
        continue;
      }

      const sx = Math.floor(srcX);
      const sy = Math.floor(srcY);
      const fx = srcX - sx;
      const fy = srcY - sy;
      const i00 = (sy * W + sx) * 4;
      const i10 = (sy * W + sx + 1) * 4;
      const i01 = ((sy + 1) * W + sx) * 4;
      const i11 = ((sy + 1) * W + sx + 1) * 4;
      const w00 = (1 - fx) * (1 - fy);
      const w10 = fx * (1 - fy);
      const w01 = (1 - fx) * fy;
      const w11 = fx * fy;
      out[oi] =
        src[i00] * w00 + src[i10] * w10 + src[i01] * w01 + src[i11] * w11;
      out[oi + 1] =
        src[i00 + 1] * w00 +
        src[i10 + 1] * w10 +
        src[i01 + 1] * w01 +
        src[i11 + 1] * w11;
      out[oi + 2] =
        src[i00 + 2] * w00 +
        src[i10 + 2] * w10 +
        src[i01 + 2] * w01 +
        src[i11 + 2] * w11;
      out[oi + 3] =
        src[i00 + 3] * w00 +
        src[i10 + 3] * w10 +
        src[i01 + 3] * w01 +
        src[i11 + 3] * w11;
    }
  }

  ctx.putImageData(_liquifyOutput, rx0, ry0);
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface LiquifySystemReturn {
  // React state (for UI)
  liquifySize: number;
  liquifyStrength: number;
  liquifyScope: "active" | "all-visible";
  setLiquifySize: React.Dispatch<React.SetStateAction<number>>;
  setLiquifyStrength: React.Dispatch<React.SetStateAction<number>>;
  setLiquifyScope: React.Dispatch<
    React.SetStateAction<"active" | "all-visible">
  >;

  // Refs (for hot-path pointer handlers)
  liquifySizeRef: React.MutableRefObject<number>;
  liquifyStrengthRef: React.MutableRefObject<number>;
  liquifyScopeRef: React.MutableRefObject<"active" | "all-visible">;
  liquifyBeforeSnapshotRef: React.MutableRefObject<ImageData | null>;
  liquifyMultiBeforeSnapshotsRef: React.MutableRefObject<
    Map<string, ImageData>
  >;
  liquifyHoldIntervalRef: React.MutableRefObject<ReturnType<
    typeof setInterval
  > | null>;
}

export function useLiquifySystem(): LiquifySystemReturn {
  const [liquifySize, setLiquifySize] = useState(80);
  const [liquifyStrength, setLiquifyStrength] = useState(1.0);
  const [liquifyScope, setLiquifyScope] = useState<"active" | "all-visible">(
    "active",
  );

  const liquifySizeRef = useRef(80);
  const liquifyStrengthRef = useRef(1.0);
  const liquifyScopeRef = useRef<"active" | "all-visible">("active");
  const liquifyBeforeSnapshotRef = useRef<ImageData | null>(null);
  /** Multi-layer liquify: per-layer before-snapshots for undo. */
  const liquifyMultiBeforeSnapshotsRef = useRef<Map<string, ImageData>>(
    new Map(),
  );
  const liquifyHoldIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );

  // Keep refs in sync with state
  useEffect(() => {
    liquifySizeRef.current = liquifySize;
  }, [liquifySize]);
  useEffect(() => {
    liquifyStrengthRef.current = liquifyStrength;
  }, [liquifyStrength]);
  useEffect(() => {
    liquifyScopeRef.current = liquifyScope;
  }, [liquifyScope]);

  return {
    liquifySize,
    liquifyStrength,
    liquifyScope,
    setLiquifySize,
    setLiquifyStrength,
    setLiquifyScope,
    liquifySizeRef,
    liquifyStrengthRef,
    liquifyScopeRef,
    liquifyBeforeSnapshotRef,
    liquifyMultiBeforeSnapshotsRef,
    liquifyHoldIntervalRef,
  };
}
