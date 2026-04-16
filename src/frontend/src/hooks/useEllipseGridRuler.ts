// ============================================================
// RESERVED FOR FUTURE USE
// This ruler hook is not yet wired into PaintingApp event handlers.
// It is intentionally preserved for the upcoming perspective/ellipse
// ruler feature implementation. Do not delete.
// ============================================================

/**
 * useEllipseGridRuler — Ellipse (oval) and Grid ruler sub-system hook
 *
 * Step 4 of 4 — Ruler Extraction Sequence
 * ----------------------------------------
 * Contains ALL ellipse (oval) and grid ruler logic extracted from
 * PaintingApp.tsx: overlay drawing, snap-to-ruler, pointer-down /
 * pointer-move / pointer-up drag handling, and initial-placement logic.
 *
 * WIRING IS A SEPARATE STEP.
 * Do NOT wire this hook into PaintingApp.tsx yet — that is the next step
 * after all 4 ruler hook files exist.
 *
 * Refs still declared inside PaintingApp.tsx (until the wiring step):
 *   rulerOvalCenterDragRef, rulerOvalCenterOffsetRef,
 *   rulerOvalSlideDragRef, rulerOvalRotDragRef,
 *   rulerOvalSemiMinorDragRef, rulerOvalSemiMajorDragRef,
 *   rulerOvalPropDragRef, rulerOvalPropInitRef, rulerOvalDragPreStateRef,
 *   rulerGridCornerDragRef, rulerGridDragPreStateRef,
 *   gridSnapLineRef
 */

import { useCallback, useRef } from "react";
import type React from "react";
import type { Layer } from "../components/LayersPanel";
import type { ViewTransform } from "../types";
import type { UndoEntry } from "./useLayerSystem";

// ── Re-export ViewTransform so PaintingApp can import it from here during wiring ──
export type { ViewTransform };

// ── Shared point type ────────────────────────────────────────────────────────────
interface Point {
  x: number;
  y: number;
}

// ── Snap refs shared with PaintingApp (not owned by this hook) ───────────────────
/**
 * Subset of stroke-snap refs that this hook reads/writes.
 * Includes the grid-snap-line ref which is exclusive to the grid ruler.
 */
export interface EllipseGridSnapRefs {
  /**
   * Direction locked at warmup for the current stroke.
   * The oval ruler writes a {cos, sin, throughVP} payload (parallel-minor mode).
   * The grid ruler does NOT use strokeSnapDirRef — it uses gridSnapLineRef instead.
   */
  strokeSnapDirRef: React.MutableRefObject<{
    cos: number;
    sin: number;
    throughVP: boolean;
  } | null>;
  /** H/V axis lock (present for symmetry with other ruler hooks). */
  strokeHvAxisRef: React.MutableRefObject<"h" | "v" | null>;
  /** H/V pivot (present for symmetry with other ruler hooks). */
  strokeHvPivotRef: React.MutableRefObject<Point | null>;
  /** Origin of the current stroke (set on pen-down by PaintingApp). */
  strokeSnapOriginRef: React.MutableRefObject<Point | null>;
  /**
   * Grid-snap direction lock: the A–B endpoint pair of the best-matching grid line
   * locked at the start of a stroke.  Set by getGridSnapPosition and cleared on
   * pen-up / pen-down.
   */
  gridSnapLineRef: React.MutableRefObject<{
    ax: number;
    ay: number;
    bx: number;
    by: number;
  } | null>;
}

// ── Props ────────────────────────────────────────────────────────────────────────
export interface UseEllipseGridRulerProps {
  canvasWidthRef: React.MutableRefObject<number>;
  canvasHeightRef: React.MutableRefObject<number>;
  layersRef: React.MutableRefObject<Layer[]>;
  setLayers: React.Dispatch<React.SetStateAction<Layer[]>>;
  /** Push a single undo entry onto the undo stack. */
  pushHistory: (entry: UndoEntry) => void;
  /** Shared counter incremented after every ruler-edit undo push. */
  rulerEditHistoryDepthRef: React.MutableRefObject<number>;
  /** Schedule a ruler overlay redraw (RAF-debounced). */
  scheduleRulerOverlay: () => void;
  /** Whether the ruler tool is the active tool. */
  activeToolRef: React.MutableRefObject<string>;
  /** Shared snap refs owned by PaintingApp. */
  snapRefs: EllipseGridSnapRefs;
}

// ── Return type ──────────────────────────────────────────────────────────────────
export interface EllipseGridRulerHandles {
  // ── Oval drag refs ──────────────────────────────────────────────────────────
  rulerOvalCenterDragRef: React.MutableRefObject<boolean>;
  rulerOvalCenterOffsetRef: React.MutableRefObject<{ dx: number; dy: number }>;
  rulerOvalSlideDragRef: React.MutableRefObject<boolean>;
  rulerOvalRotDragRef: React.MutableRefObject<boolean>;
  rulerOvalSemiMinorDragRef: React.MutableRefObject<boolean>;
  rulerOvalSemiMajorDragRef: React.MutableRefObject<boolean>;
  rulerOvalPropDragRef: React.MutableRefObject<boolean>;
  rulerOvalPropInitRef: React.MutableRefObject<{
    dist: number;
    a: number;
    b: number;
  }>;
  rulerOvalDragPreStateRef: React.MutableRefObject<Record<
    string,
    unknown
  > | null>;

  // ── Grid drag refs ──────────────────────────────────────────────────────────
  /** -1 = none, 0-3 = corner TL/TR/BR/BL, 4-7 = edge midpoints top/right/bottom/left */
  rulerGridCornerDragRef: React.MutableRefObject<number>;
  rulerGridDragPreStateRef: React.MutableRefObject<Record<
    string,
    unknown
  > | null>;

  // ── Overlay drawing ─────────────────────────────────────────────────────────
  /** Draw the oval ruler overlay onto ctx (already in canvas-space). */
  drawOvalRulerOverlay: (ctx: CanvasRenderingContext2D, layer: Layer) => void;
  /** Draw the grid ruler overlay onto ctx (already in canvas-space). */
  drawGridRulerOverlay: (ctx: CanvasRenderingContext2D, layer: Layer) => void;

  // ── Snap ────────────────────────────────────────────────────────────────────
  /** Returns the snapped position for an oval ruler stroke. */
  getOvalSnapPosition: (rawPos: Point, origin: Point) => Point;
  /** Returns the snapped position for a grid ruler stroke. */
  getGridSnapPosition: (rawPos: Point, origin: Point) => Point;

  // ── Pointer events ──────────────────────────────────────────────────────────
  /**
   * Handle pointer-down for the oval ruler.
   * @returns true if the event was consumed.
   */
  handleOvalRulerPointerDown: (
    pos: Point,
    layer: Layer,
    handleRadius: number,
  ) => boolean;
  /**
   * Handle pointer-down for the grid ruler.
   * @returns true if the event was consumed.
   */
  handleGridRulerPointerDown: (
    pos: Point,
    layer: Layer,
    handleRadius: number,
  ) => boolean;
  /**
   * Handle pointer-move for all active oval drags.
   * @returns true if any oval drag was active.
   */
  handleOvalRulerPointerMove: (pos: Point, layer: Layer) => boolean;
  /**
   * Handle pointer-move for the active grid drag.
   * @returns true if the grid drag was active.
   */
  handleGridRulerPointerMove: (pos: Point, layer: Layer) => boolean;
  /**
   * Handle pointer-up for all active oval + grid drags.
   * Pushes undo entry and clears all drag refs.
   * @returns true if any drag was active.
   */
  handleEllipseGridRulerPointerUp: (layer: Layer) => boolean;

  /** True if any oval drag ref is currently active. */
  isOvalDragging: () => boolean;
  /** True if a grid drag ref is currently active. */
  isGridDragging: () => boolean;
}

// ── Hook ─────────────────────────────────────────────────────────────────────────
export function useEllipseGridRuler({
  canvasWidthRef,
  canvasHeightRef,
  layersRef,
  setLayers,
  pushHistory,
  rulerEditHistoryDepthRef,
  scheduleRulerOverlay,
  activeToolRef,
  snapRefs,
}: UseEllipseGridRulerProps): EllipseGridRulerHandles {
  // ── Oval drag refs ─────────────────────────────────────────────────────────
  const rulerOvalCenterDragRef = useRef(false);
  const rulerOvalCenterOffsetRef = useRef<{ dx: number; dy: number }>({
    dx: 0,
    dy: 0,
  });
  const rulerOvalSlideDragRef = useRef(false);
  const rulerOvalRotDragRef = useRef(false);
  const rulerOvalSemiMinorDragRef = useRef(false);
  const rulerOvalSemiMajorDragRef = useRef(false);
  const rulerOvalPropDragRef = useRef(false);
  const rulerOvalPropInitRef = useRef<{ dist: number; a: number; b: number }>({
    dist: 1,
    a: 120,
    b: 60,
  });
  const rulerOvalDragPreStateRef = useRef<Record<string, unknown> | null>(null);

  // ── Grid drag refs ─────────────────────────────────────────────────────────
  const rulerGridCornerDragRef = useRef<number>(-1);
  const rulerGridDragPreStateRef = useRef<Record<string, unknown> | null>(null);

  // ── Shared helper: update layer state in both setLayers and layersRef ──────
  const makeUpdater = useCallback(
    (layerId: string) => (patch: Partial<Layer>) => {
      const fn = (l: Layer) => (l.id === layerId ? { ...l, ...patch } : l);
      setLayers((prev) => prev.map(fn));
      layersRef.current = layersRef.current.map(fn);
    },
    [layersRef, setLayers],
  );

  // ── drawOvalRulerOverlay ──────────────────────────────────────────────────
  const drawOvalRulerOverlay = useCallback(
    (ctx: CanvasRenderingContext2D, layer: Layer) => {
      const cx = layer.ovalCenterX;
      const cy = layer.ovalCenterY;
      if (cx === undefined || cy === undefined) return;

      const angle = layer.ovalAngle ?? 0;
      const a = layer.ovalSemiMajor ?? 120;
      const b = layer.ovalSemiMinor ?? 60;
      const theta = (angle * Math.PI) / 180;
      const majDX = Math.cos(theta);
      const majDY = Math.sin(theta);
      const minDX = Math.sin(theta);
      const minDY = -Math.cos(theta);
      const color = layer.rulerColor ?? "#9333ea";
      const maxDist =
        Math.max(canvasWidthRef.current, canvasHeightRef.current) * 2;

      // Infinite minor axis line (dashed)
      ctx.strokeStyle = color;
      ctx.lineWidth = 0.8;
      ctx.setLineDash([4, 6]);
      ctx.beginPath();
      ctx.moveTo(cx - minDX * maxDist, cy - minDY * maxDist);
      ctx.lineTo(cx + minDX * maxDist, cy + minDY * maxDist);
      ctx.stroke();
      ctx.setLineDash([]);

      // Ellipse curve
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(cx, cy, a, b, theta, 0, Math.PI * 2);
      ctx.stroke();

      // Handle positions
      const rotHX = cx + minDX * (b + 35);
      const rotHY = cy + minDY * (b + 35);
      const slideHX = cx - majDX * 40;
      const slideHY = cy - majDY * 40;
      const semiMinHX = cx + minDX * b;
      const semiMinHY = cy + minDY * b;
      const semiMajHX = cx + majDX * a;
      const semiMajHY = cy + majDY * a;

      // Center handle (filled square / diamond)
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      const hs = 5;
      ctx.beginPath();
      ctx.rect(-hs, -hs, hs * 2, hs * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      if (activeToolRef.current !== "ruler") return;

      // Rotation handle
      ctx.beginPath();
      ctx.arc(rotHX, rotHY, 6, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.font = "bold 8px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("R", rotHX, rotHY);

      // Slide handle
      ctx.beginPath();
      ctx.arc(slideHX, slideHY, 5, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.fillText("S", slideHX, slideHY);

      // Semi-minor handle
      ctx.beginPath();
      ctx.arc(semiMinHX, semiMinHY, 5, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.fillText("b", semiMinHX, semiMinHY);

      // Semi-major handle
      ctx.beginPath();
      ctx.arc(semiMajHX, semiMajHY, 5, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.fillText("a", semiMajHX, semiMajHY);

      // Proportional scale handle (P) at 45° diagonal
      const INV_SQRT2 = 1 / Math.sqrt(2);
      const propHX = cx + a * INV_SQRT2 * majDX - b * INV_SQRT2 * minDX;
      const propHY = cy + a * INV_SQRT2 * majDY - b * INV_SQRT2 * minDY;
      ctx.beginPath();
      ctx.arc(propHX, propHY, 5, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.fillText("P", propHX, propHY);
    },
    [canvasWidthRef, canvasHeightRef, activeToolRef],
  );

  // ── drawGridRulerOverlay ──────────────────────────────────────────────────
  const drawGridRulerOverlay = useCallback(
    (ctx: CanvasRenderingContext2D, layer: Layer) => {
      const corners = layer.gridCorners;
      if (!corners) return;

      const [tl, tr, br, bl] = corners;
      const color = layer.rulerColor ?? "#9333ea";
      const mode = layer.gridMode ?? "subdivide";
      const vSegs = layer.gridVertSegments ?? 4;
      const hSegs = layer.gridHorizSegments ?? 4;
      const persp = layer.gridPerspective ?? true;

      // Helper: line-line intersection (returns null if parallel)
      const lineIntersect = (
        p1: Point,
        p2: Point,
        p3: Point,
        p4: Point,
      ): Point | null => {
        const d1x = p2.x - p1.x;
        const d1y = p2.y - p1.y;
        const d2x = p4.x - p3.x;
        const d2y = p4.y - p3.y;
        const denom = d1x * d2y - d1y * d2x;
        if (Math.abs(denom) < 0.0001) return null;
        const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / denom;
        return { x: p1.x + t * d1x, y: p1.y + t * d1y };
      };

      // Clip a line to canvas rect, returns [ax, ay, bx, by] or null
      const clipLine = (
        ax: number,
        ay: number,
        bx: number,
        by: number,
      ): [number, number, number, number] | null => {
        const cw = canvasWidthRef.current;
        const ch = canvasHeightRef.current;
        let t0 = 0;
        let t1 = 1;
        const dx = bx - ax;
        const dy = by - ay;
        const clip = (p: number, q: number) => {
          if (Math.abs(p) < 1e-9) {
            if (q < 0) return false;
            return true;
          }
          const r = q / p;
          if (p < 0) {
            if (r > t1) return false;
            if (r > t0) t0 = r;
          } else {
            if (r < t0) return false;
            if (r < t1) t1 = r;
          }
          return true;
        };
        if (!clip(-dx, ax)) return null;
        if (!clip(dx, cw - ax)) return null;
        if (!clip(-dy, ay)) return null;
        if (!clip(dy, ch - ay)) return null;
        if (t0 > t1) return null;
        return [ax + t0 * dx, ay + t0 * dy, ax + t1 * dx, ay + t1 * dy];
      };

      // Unused but left for completeness (VP info may be used in future)
      void lineIntersect(tl, bl, tr, br);
      void lineIntersect(tl, tr, bl, br);

      // Lerp
      const lerp = (a: Point, b: Point, t: number) => ({
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
      });

      if (mode === "subdivide") {
        // Draw quad outline
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(tl.x, tl.y);
        ctx.lineTo(tr.x, tr.y);
        ctx.lineTo(br.x, br.y);
        ctx.lineTo(bl.x, bl.y);
        ctx.closePath();
        ctx.stroke();

        // Clip to quad region
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(tl.x, tl.y);
        ctx.lineTo(tr.x, tr.y);
        ctx.lineTo(br.x, br.y);
        ctx.lineTo(bl.x, bl.y);
        ctx.closePath();
        ctx.clip();

        ctx.strokeStyle = color;
        ctx.lineWidth = 0.8;
        ctx.setLineDash([]);

        if (persp) {
          // Perspective subdivision using homography: (0,0)->tl,(1,0)->tr,(0,1)->bl,(1,1)->br
          const dx1 = tr.x - br.x;
          const dx2 = bl.x - br.x;
          const dx3 = tl.x - tr.x - bl.x + br.x;
          const dy1 = tr.y - br.y;
          const dy2 = bl.y - br.y;
          const dy3 = tl.y - tr.y - bl.y + br.y;
          const hDenom = dx1 * dy2 - dy1 * dx2;
          const hh20 = (dx3 * dy2 - dy3 * dx2) / hDenom;
          const hh21 = (dx1 * dy3 - dy1 * dx3) / hDenom;
          const hh00 = tr.x - tl.x + hh20 * tr.x;
          const hh10 = tr.y - tl.y + hh20 * tr.y;
          const hh01 = bl.x - tl.x + hh21 * bl.x;
          const hh11 = bl.y - tl.y + hh21 * bl.y;
          const hh02 = tl.x;
          const hh12 = tl.y;
          const applyH = (u: number, v: number) => {
            const w = hh20 * u + hh21 * v + 1;
            return {
              x: (hh00 * u + hh01 * v + hh02) / w,
              y: (hh10 * u + hh11 * v + hh12) / w,
            };
          };
          // Horizontal lines: constant v
          for (let i = 1; i < hSegs; i++) {
            const v = i / hSegs;
            const p0 = applyH(0, v);
            const p1 = applyH(1, v);
            ctx.beginPath();
            ctx.moveTo(p0.x, p0.y);
            ctx.lineTo(p1.x, p1.y);
            ctx.stroke();
          }
          // Vertical lines: constant u
          for (let i = 1; i < vSegs; i++) {
            const u = i / vSegs;
            const p0 = applyH(u, 0);
            const p1 = applyH(u, 1);
            ctx.beginPath();
            ctx.moveTo(p0.x, p0.y);
            ctx.lineTo(p1.x, p1.y);
            ctx.stroke();
          }
        } else {
          // Non-perspective: linear interpolation
          for (let i = 1; i < hSegs; i++) {
            const t = i / hSegs;
            const pLeft = lerp(tl, bl, t);
            const pRight = lerp(tr, br, t);
            ctx.beginPath();
            ctx.moveTo(pLeft.x, pLeft.y);
            ctx.lineTo(pRight.x, pRight.y);
            ctx.stroke();
          }
          for (let i = 1; i < vSegs; i++) {
            const t = i / vSegs;
            const pTop = lerp(tl, tr, t);
            const pBot = lerp(bl, br, t);
            ctx.beginPath();
            ctx.moveTo(pTop.x, pTop.y);
            ctx.lineTo(pBot.x, pBot.y);
            ctx.stroke();
          }
        }
        ctx.restore();
      } else {
        // Extrude mode: perspective tiling — the quad is the seed cell
        ctx.strokeStyle = color;
        ctx.lineWidth = 0.8;
        ctx.setLineDash([]);

        if (persp) {
          // Build homography from quad corners
          const edx1 = tr.x - br.x;
          const edx2 = bl.x - br.x;
          const edx3 = tl.x - tr.x - bl.x + br.x;
          const edy1 = tr.y - br.y;
          const edy2 = bl.y - br.y;
          const edy3 = tl.y - tr.y - bl.y + br.y;
          const ehDenom = edx1 * edy2 - edy1 * edx2;
          const eh20 = (edx3 * edy2 - edy3 * edx2) / ehDenom;
          const eh21 = (edx1 * edy3 - edy1 * edx3) / ehDenom;
          const eh00 = tr.x - tl.x + eh20 * tr.x;
          const eh10 = tr.y - tl.y + eh20 * tr.y;
          const eh01 = bl.x - tl.x + eh21 * bl.x;
          const eh11 = bl.y - tl.y + eh21 * bl.y;
          const eh02 = tl.x;
          const eh12 = tl.y;
          const applyEH = (u: number, v: number) => {
            const w = eh20 * u + eh21 * v + 1;
            return {
              x: (eh00 * u + eh01 * v + eh02) / w,
              y: (eh10 * u + eh11 * v + eh12) / w,
            };
          };
          const TILE_RANGE = 40;
          for (let i = -TILE_RANGE; i <= TILE_RANGE + 1; i++) {
            const p0 = applyEH(0, i);
            const p1 = applyEH(1, i);
            const seg = clipLine(
              p0.x - (p1.x - p0.x) * 9999,
              p0.y - (p1.y - p0.y) * 9999,
              p0.x + (p1.x - p0.x) * 9999,
              p0.y + (p1.y - p0.y) * 9999,
            );
            if (seg) {
              ctx.beginPath();
              ctx.moveTo(seg[0], seg[1]);
              ctx.lineTo(seg[2], seg[3]);
              ctx.stroke();
            }
          }
          for (let i = -TILE_RANGE; i <= TILE_RANGE + 1; i++) {
            const p0 = applyEH(i, 0);
            const p1 = applyEH(i, 1);
            const seg = clipLine(
              p0.x - (p1.x - p0.x) * 9999,
              p0.y - (p1.y - p0.y) * 9999,
              p0.x + (p1.x - p0.x) * 9999,
              p0.y + (p1.y - p0.y) * 9999,
            );
            if (seg) {
              ctx.beginPath();
              ctx.moveTo(seg[0], seg[1]);
              ctx.lineTo(seg[2], seg[3]);
              ctx.stroke();
            }
          }
        } else {
          // Linear tiling
          const TILE_RANGE = 40;
          for (let i = -TILE_RANGE; i <= TILE_RANGE + 1; i++) {
            const vt = i;
            const pLeft = {
              x: tl.x + (bl.x - tl.x) * vt,
              y: tl.y + (bl.y - tl.y) * vt,
            };
            const pRight = {
              x: tr.x + (br.x - tr.x) * vt,
              y: tr.y + (br.y - tr.y) * vt,
            };
            const seg = clipLine(
              pLeft.x - (pRight.x - pLeft.x) * 9999,
              pLeft.y - (pRight.y - pLeft.y) * 9999,
              pLeft.x + (pRight.x - pLeft.x) * 9999,
              pLeft.y + (pRight.y - pLeft.y) * 9999,
            );
            if (seg) {
              ctx.beginPath();
              ctx.moveTo(seg[0], seg[1]);
              ctx.lineTo(seg[2], seg[3]);
              ctx.stroke();
            }
          }
          for (let i = -TILE_RANGE; i <= TILE_RANGE + 1; i++) {
            const ut = i;
            const pTop = {
              x: tl.x + (tr.x - tl.x) * ut,
              y: tl.y + (tr.y - tl.y) * ut,
            };
            const pBot = {
              x: bl.x + (br.x - bl.x) * ut,
              y: bl.y + (br.y - bl.y) * ut,
            };
            const seg = clipLine(
              pTop.x - (pBot.x - pTop.x) * 9999,
              pTop.y - (pBot.y - pTop.y) * 9999,
              pTop.x + (pBot.x - pTop.x) * 9999,
              pTop.y + (pBot.y - pTop.y) * 9999,
            );
            if (seg) {
              ctx.beginPath();
              ctx.moveTo(seg[0], seg[1]);
              ctx.lineTo(seg[2], seg[3]);
              ctx.stroke();
            }
          }
        }

        // Draw quad outline bold on top
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(tl.x, tl.y);
        ctx.lineTo(tr.x, tr.y);
        ctx.lineTo(br.x, br.y);
        ctx.lineTo(bl.x, bl.y);
        ctx.closePath();
        ctx.stroke();
      }

      if (activeToolRef.current !== "ruler") return;

      // Draw 8 handles (4 corners + 4 edge midpoints)
      const lerp2 = (a: Point, b: Point, t: number) => ({
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
      });
      const midTop = lerp2(tl, tr, 0.5);
      const midRight = lerp2(tr, br, 0.5);
      const midBottom = lerp2(br, bl, 0.5);
      const midLeft = lerp2(bl, tl, 0.5);
      const handles = [tl, tr, br, bl, midTop, midRight, midBottom, midLeft];
      const labels = ["TL", "TR", "BR", "BL", "", "", "", ""];
      handles.forEach((h, i) => {
        ctx.beginPath();
        ctx.arc(h.x, h.y, 6, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(0,0,0,0.6)";
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        if (labels[i]) {
          ctx.fillStyle = color;
          ctx.font = "bold 7px sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(labels[i], h.x, h.y);
        }
      });
    },
    [canvasWidthRef, canvasHeightRef, activeToolRef],
  );

  // ── getOvalSnapPosition ───────────────────────────────────────────────────
  /**
   * Reproduced from PaintingApp.tsx lines 5407–5453.
   * Two snap modes:
   *   "ellipse"        — projects cursor onto the nearest point on the ellipse
   *   "parallel-minor" — constrains stroke to the minor-axis direction
   */
  const getOvalSnapPosition = useCallback(
    (rawPos: Point, origin: Point): Point => {
      const rulerLayer = layersRef.current.find((l) => l.isRuler);
      if (!rulerLayer) return rawPos;

      const ocx = rulerLayer.ovalCenterX;
      const ocy = rulerLayer.ovalCenterY;
      if (ocx === undefined || ocy === undefined) return rawPos;

      const oAngle = rulerLayer.ovalAngle ?? 0;
      const oa = rulerLayer.ovalSemiMajor ?? 120;
      const ob = rulerLayer.ovalSemiMinor ?? 60;
      const ovalSnapMode = rulerLayer.ovalSnapMode ?? "ellipse";
      const { strokeSnapDirRef } = snapRefs;

      if (ovalSnapMode === "parallel-minor") {
        const oTheta2 = (oAngle * Math.PI) / 180;
        const minDXp = -Math.sin(oTheta2);
        const minDYp = -Math.cos(oTheta2);
        if (!strokeSnapDirRef.current) {
          const dx2 = rawPos.x - origin.x;
          const dy2 = rawPos.y - origin.y;
          if (Math.sqrt(dx2 * dx2 + dy2 * dy2) < 4) return origin;
          (
            strokeSnapDirRef as React.MutableRefObject<{
              cos: number;
              sin: number;
              throughVP: boolean;
            } | null>
          ).current = { cos: minDXp, sin: minDYp, throughVP: false };
        }
        const dpx2 = rawPos.x - origin.x;
        const dpy2 = rawPos.y - origin.y;
        const proj2 = dpx2 * minDXp + dpy2 * minDYp;
        return { x: origin.x + minDXp * proj2, y: origin.y + minDYp * proj2 };
      }

      // Ellipse snap: transform to local ellipse coords, find nearest point
      const oTheta = (oAngle * Math.PI) / 180;
      const dx = rawPos.x - ocx;
      const dy = rawPos.y - ocy;
      const lx = dx * Math.cos(oTheta) + dy * Math.sin(oTheta);
      const ly = -dx * Math.sin(oTheta) + dy * Math.cos(oTheta);
      const nx = lx / oa;
      const ny = ly / ob;
      const len = Math.sqrt(nx * nx + ny * ny);
      if (len < 0.0001) return rawPos; // at center, cannot snap
      const ex = oa * (nx / len);
      const ey = ob * (ny / len);
      return {
        x: ocx + ex * Math.cos(oTheta) - ey * Math.sin(oTheta),
        y: ocy + ex * Math.sin(oTheta) + ey * Math.cos(oTheta),
      };
    },
    [layersRef, snapRefs],
  );

  // ── getGridSnapPosition ───────────────────────────────────────────────────
  /**
   * Reproduced from PaintingApp.tsx lines 5456–5653.
   * Finds the nearest grid line to rawPos and locks onto it for the stroke.
   * Uses gridSnapLineRef (in snapRefs) rather than strokeSnapDirRef.
   */
  const getGridSnapPosition = useCallback(
    (rawPos: Point, origin: Point): Point => {
      const rulerLayer = layersRef.current.find((l) => l.isRuler);
      if (!rulerLayer) return rawPos;

      const gCorners = rulerLayer.gridCorners;
      if (!gCorners) return rawPos;

      const [gtl, gtr, gbr, gbl] = gCorners;
      const gMode = rulerLayer.gridMode ?? "subdivide";
      const gVSegs = rulerLayer.gridVertSegments ?? 4;
      const gHSegs = rulerLayer.gridHorizSegments ?? 4;
      const { gridSnapLineRef } = snapRefs;

      const gLerp = (a: Point, b: Point, t: number) => ({
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
      });

      // Closest point on infinite line through a→b
      const closestOnLine = (
        px: number,
        py: number,
        ax: number,
        ay: number,
        bx: number,
        by: number,
      ) => {
        const dx = bx - ax;
        const dy = by - ay;
        const len2 = dx * dx + dy * dy;
        if (len2 < 0.0001)
          return { x: ax, y: ay, d2: (px - ax) ** 2 + (py - ay) ** 2 };
        const t = ((px - ax) * dx + (py - ay) * dy) / len2;
        return {
          x: ax + t * dx,
          y: ay + t * dy,
          d2: (px - (ax + t * dx)) ** 2 + (py - (ay + t * dy)) ** 2,
        };
      };

      // If a grid line is already locked for this stroke, follow it
      if (gridSnapLineRef.current) {
        const { ax, ay, bx, by } = gridSnapLineRef.current;
        const gdx = bx - ax;
        const gdy = by - ay;
        const glen = Math.sqrt(gdx * gdx + gdy * gdy);
        if (glen < 0.0001) return origin;
        const gc = gdx / glen;
        const gs = gdy / glen;
        const dpx = rawPos.x - origin.x;
        const dpy = rawPos.y - origin.y;
        const proj = dpx * gc + dpy * gs;
        return { x: origin.x + gc * proj, y: origin.y + gs * proj };
      }

      // Warmup: don't lock direction until we've moved enough
      const gridWarmup = rulerLayer.rulerWarmupDist ?? 10;
      {
        const dwx = rawPos.x - origin.x;
        const dwy = rawPos.y - origin.y;
        if (Math.sqrt(dwx * dwx + dwy * dwy) < gridWarmup) return rawPos;
      }

      // Find the nearest grid line
      let bestDist2 = Number.POSITIVE_INFINITY;
      let bestA: Point = gtl;
      let bestB: Point = gtr;

      const testLine = (a: Point, b: Point) => {
        const res = closestOnLine(rawPos.x, rawPos.y, a.x, a.y, b.x, b.y);
        if (res.d2 < bestDist2) {
          bestDist2 = res.d2;
          bestA = a;
          bestB = b;
        }
      };

      if (gMode === "extrude") {
        const gPersp = rulerLayer.gridPerspective ?? true;
        if (gPersp) {
          const esdx1 = gtr.x - gbr.x;
          const esdx2 = gbl.x - gbr.x;
          const esdx3 = gtl.x - gtr.x - gbl.x + gbr.x;
          const esdy1 = gtr.y - gbr.y;
          const esdy2 = gbl.y - gbr.y;
          const esdy3 = gtl.y - gtr.y - gbl.y + gbr.y;
          const eshDenom = esdx1 * esdy2 - esdy1 * esdx2;
          const esh20 = (esdx3 * esdy2 - esdy3 * esdx2) / eshDenom;
          const esh21 = (esdx1 * esdy3 - esdy1 * esdx3) / eshDenom;
          const esh00 = gtr.x - gtl.x + esh20 * gtr.x;
          const esh10 = gtr.y - gtl.y + esh20 * gtr.y;
          const esh01 = gbl.x - gtl.x + esh21 * gbl.x;
          const esh11 = gbl.y - gtl.y + esh21 * gbl.y;
          const esh02 = gtl.x;
          const esh12 = gtl.y;
          const esApplyH = (u: number, v: number) => {
            const w = esh20 * u + esh21 * v + 1;
            return {
              x: (esh00 * u + esh01 * v + esh02) / w,
              y: (esh10 * u + esh11 * v + esh12) / w,
            };
          };
          for (let i = -40; i <= 41; i++) {
            testLine(esApplyH(0, i), esApplyH(1, i));
          }
          for (let i = -40; i <= 41; i++) {
            testLine(esApplyH(i, 0), esApplyH(i, 1));
          }
        } else {
          for (let i = -40; i <= 41; i++) {
            testLine(
              {
                x: gtl.x + (gbl.x - gtl.x) * i,
                y: gtl.y + (gbl.y - gtl.y) * i,
              },
              {
                x: gtr.x + (gbr.x - gtr.x) * i,
                y: gtr.y + (gbr.y - gtr.y) * i,
              },
            );
          }
          for (let i = -40; i <= 41; i++) {
            testLine(
              {
                x: gtl.x + (gtr.x - gtl.x) * i,
                y: gtl.y + (gtr.y - gtl.y) * i,
              },
              {
                x: gbl.x + (gbr.x - gbl.x) * i,
                y: gbl.y + (gbr.y - gbl.y) * i,
              },
            );
          }
        }
      } else {
        // Subdivide mode
        const gPersp = rulerLayer.gridPerspective ?? true;
        if (gPersp) {
          const sdx1 = gtr.x - gbr.x;
          const sdx2 = gbl.x - gbr.x;
          const sdx3 = gtl.x - gtr.x - gbl.x + gbr.x;
          const sdy1 = gtr.y - gbr.y;
          const sdy2 = gbl.y - gbr.y;
          const sdy3 = gtl.y - gtr.y - gbl.y + gbr.y;
          const shDenom = sdx1 * sdy2 - sdy1 * sdx2;
          const sh20 = (sdx3 * sdy2 - sdy3 * sdx2) / shDenom;
          const sh21 = (sdx1 * sdy3 - sdy1 * sdx3) / shDenom;
          const sh00 = gtr.x - gtl.x + sh20 * gtr.x;
          const sh10 = gtr.y - gtl.y + sh20 * gtr.y;
          const sh01 = gbl.x - gtl.x + sh21 * gbl.x;
          const sh11 = gbl.y - gtl.y + sh21 * gbl.y;
          const sh02 = gtl.x;
          const sh12 = gtl.y;
          const gApplyH = (u: number, v: number) => {
            const w = sh20 * u + sh21 * v + 1;
            return {
              x: (sh00 * u + sh01 * v + sh02) / w,
              y: (sh10 * u + sh11 * v + sh12) / w,
            };
          };
          for (let i = 0; i <= gHSegs; i++) {
            const v = i / gHSegs;
            testLine(gApplyH(0, v), gApplyH(1, v));
          }
          for (let i = 0; i <= gVSegs; i++) {
            const u = i / gVSegs;
            testLine(gApplyH(u, 0), gApplyH(u, 1));
          }
        } else {
          for (let i = 0; i <= gHSegs; i++) {
            const t = i / gHSegs;
            testLine(gLerp(gtl, gbl, t), gLerp(gtr, gbr, t));
          }
          for (let i = 0; i <= gVSegs; i++) {
            const t = i / gVSegs;
            testLine(gLerp(gtl, gtr, t), gLerp(gbl, gbr, t));
          }
        }
      }

      // Lock this grid line direction for the rest of the stroke
      gridSnapLineRef.current = {
        ax: bestA.x,
        ay: bestA.y,
        bx: bestB.x,
        by: bestB.y,
      };
      {
        const gdx = bestB.x - bestA.x;
        const gdy = bestB.y - bestA.y;
        const glen = Math.sqrt(gdx * gdx + gdy * gdy);
        if (glen < 0.0001) return origin;
        const gc = gdx / glen;
        const gs = gdy / glen;
        const dpx = rawPos.x - origin.x;
        const dpy = rawPos.y - origin.y;
        const proj = dpx * gc + dpy * gs;
        return { x: origin.x + gc * proj, y: origin.y + gs * proj };
      }
    },
    [layersRef, snapRefs],
  );

  // ── handleOvalRulerPointerDown ────────────────────────────────────────────
  /**
   * Reproduced from PaintingApp.tsx lines 6387–6493.
   * Hit-tests all 6 oval handles (R, b, P, a, S, center).
   * If oval not yet placed, creates it at the click position.
   */
  const handleOvalRulerPointerDown = useCallback(
    (pos: Point, layer: Layer, handleRadius: number): boolean => {
      const upd = makeUpdater(layer.id);
      const ocx = layer.ovalCenterX;
      const ocy = layer.ovalCenterY;

      if (ocx !== undefined && ocy !== undefined) {
        const oAngle = layer.ovalAngle ?? 0;
        const oa = layer.ovalSemiMajor ?? 120;
        const ob = layer.ovalSemiMinor ?? 60;
        const oTheta = (oAngle * Math.PI) / 180;
        const majDX = Math.cos(oTheta);
        const majDY = Math.sin(oTheta);
        const minDX = Math.sin(oTheta);
        const minDY = -Math.cos(oTheta);

        const rotHX = ocx + minDX * (ob + 35);
        const rotHY = ocy + minDY * (ob + 35);
        const slideHX = ocx - majDX * 40;
        const slideHY = ocy - majDY * 40;
        const semiMinHX = ocx + minDX * ob;
        const semiMinHY = ocy + minDY * ob;
        const semiMajHX = ocx + majDX * oa;
        const semiMajHY = ocy + majDY * oa;

        const dCenter = Math.sqrt((pos.x - ocx) ** 2 + (pos.y - ocy) ** 2);
        const dRot = Math.sqrt((pos.x - rotHX) ** 2 + (pos.y - rotHY) ** 2);
        const dSlide = Math.sqrt(
          (pos.x - slideHX) ** 2 + (pos.y - slideHY) ** 2,
        );
        const dSemiMin = Math.sqrt(
          (pos.x - semiMinHX) ** 2 + (pos.y - semiMinHY) ** 2,
        );
        const dSemiMaj = Math.sqrt(
          (pos.x - semiMajHX) ** 2 + (pos.y - semiMajHY) ** 2,
        );
        const INV_SQRT2_HIT = 1 / Math.sqrt(2);
        const propHX_hit =
          ocx + oa * INV_SQRT2_HIT * majDX - ob * INV_SQRT2_HIT * minDX;
        const propHY_hit =
          ocy + oa * INV_SQRT2_HIT * majDY - ob * INV_SQRT2_HIT * minDY;
        const dProp = Math.sqrt(
          (pos.x - propHX_hit) ** 2 + (pos.y - propHY_hit) ** 2,
        );

        const preOvalState = {
          ovalCenterX: ocx,
          ovalCenterY: ocy,
          ovalAngle: oAngle,
          ovalSemiMajor: oa,
          ovalSemiMinor: ob,
        };

        if (dRot <= handleRadius) {
          rulerOvalRotDragRef.current = true;
          rulerOvalDragPreStateRef.current = preOvalState;
          return true;
        }
        if (dSemiMin <= handleRadius) {
          rulerOvalSemiMinorDragRef.current = true;
          rulerOvalDragPreStateRef.current = preOvalState;
          return true;
        }
        if (dProp <= handleRadius) {
          rulerOvalPropDragRef.current = true;
          rulerOvalDragPreStateRef.current = preOvalState;
          rulerOvalPropInitRef.current = {
            dist: Math.sqrt((propHX_hit - ocx) ** 2 + (propHY_hit - ocy) ** 2),
            a: oa,
            b: ob,
          };
          return true;
        }
        if (dSemiMaj <= handleRadius) {
          rulerOvalSemiMajorDragRef.current = true;
          rulerOvalDragPreStateRef.current = preOvalState;
          return true;
        }
        if (dSlide <= handleRadius) {
          rulerOvalSlideDragRef.current = true;
          rulerOvalDragPreStateRef.current = preOvalState;
          return true;
        }
        if (dCenter <= handleRadius + 4) {
          rulerOvalCenterDragRef.current = true;
          rulerOvalCenterOffsetRef.current = {
            dx: pos.x - ocx,
            dy: pos.y - ocy,
          };
          rulerOvalDragPreStateRef.current = preOvalState;
          return true;
        }
        // No handle hit — do nothing
        return false;
      }

      // Initial placement
      const newOvalState = {
        ovalCenterX: pos.x,
        ovalCenterY: pos.y,
        ovalAngle: 0,
        ovalSemiMajor: 120,
        ovalSemiMinor: 60,
      };
      upd(newOvalState);
      pushHistory({
        type: "ruler-edit",
        layerId: layer.id,
        before: {},
        after: newOvalState,
      });
      rulerEditHistoryDepthRef.current++;
      scheduleRulerOverlay();
      return true;
    },
    [makeUpdater, pushHistory, rulerEditHistoryDepthRef, scheduleRulerOverlay],
  );

  // ── handleGridRulerPointerDown ────────────────────────────────────────────
  /**
   * Reproduced from PaintingApp.tsx lines 6494–6561.
   * Hit-tests all 8 grid handles (4 corners + 4 edge midpoints).
   * If grid not yet placed, creates a default grid centered on the canvas.
   */
  const handleGridRulerPointerDown = useCallback(
    (pos: Point, layer: Layer, handleRadius: number): boolean => {
      const upd = makeUpdater(layer.id);
      const gc = layer.gridCorners;

      if (gc) {
        const [gtl2, gtr2, gbr2, gbl2] = gc;
        const gLerp2 = (a: Point, b: Point, t: number) => ({
          x: a.x + (b.x - a.x) * t,
          y: a.y + (b.y - a.y) * t,
        });
        const gridHandles2 = [
          gtl2,
          gtr2,
          gbr2,
          gbl2,
          gLerp2(gtl2, gtr2, 0.5),
          gLerp2(gtr2, gbr2, 0.5),
          gLerp2(gbr2, gbl2, 0.5),
          gLerp2(gbl2, gtl2, 0.5),
        ];
        const preGridState = { gridCorners: gc };
        let hit = -1;
        for (let gi = 0; gi < gridHandles2.length; gi++) {
          const d = Math.sqrt(
            (pos.x - gridHandles2[gi].x) ** 2 +
              (pos.y - gridHandles2[gi].y) ** 2,
          );
          if (d <= handleRadius + 4) {
            hit = gi;
            break;
          }
        }
        if (hit >= 0) {
          rulerGridCornerDragRef.current = hit;
          rulerGridDragPreStateRef.current = preGridState;
          return true;
        }
        // No handle hit
        return false;
      }

      // Initial placement: create default grid centered on canvas
      const half = 150;
      const cx2 = canvasWidthRef.current / 2;
      const cy2 = canvasHeightRef.current / 2;
      const newGridCorners: [
        { x: number; y: number },
        { x: number; y: number },
        { x: number; y: number },
        { x: number; y: number },
      ] = [
        { x: cx2 - half, y: cy2 - half },
        { x: cx2 + half, y: cy2 - half },
        { x: cx2 + half, y: cy2 + half },
        { x: cx2 - half, y: cy2 + half },
      ];
      const newGridState = {
        gridCorners: newGridCorners,
        gridMode: "subdivide" as const,
      };
      upd(newGridState);
      pushHistory({
        type: "ruler-edit",
        layerId: layer.id,
        before: {},
        after: newGridState,
      });
      rulerEditHistoryDepthRef.current++;
      scheduleRulerOverlay();
      return true;
    },
    [
      canvasWidthRef,
      canvasHeightRef,
      makeUpdater,
      pushHistory,
      rulerEditHistoryDepthRef,
      scheduleRulerOverlay,
    ],
  );

  // ── handleOvalRulerPointerMove ────────────────────────────────────────────
  /**
   * Reproduced from PaintingApp.tsx lines 8152–8220.
   * Handles all active oval drag ops.
   */
  const handleOvalRulerPointerMove = useCallback(
    (pos: Point, layer: Layer): boolean => {
      if (
        !rulerOvalCenterDragRef.current &&
        !rulerOvalSlideDragRef.current &&
        !rulerOvalRotDragRef.current &&
        !rulerOvalSemiMinorDragRef.current &&
        !rulerOvalSemiMajorDragRef.current &&
        !rulerOvalPropDragRef.current
      ) {
        return false;
      }

      const upd = makeUpdater(layer.id);

      if (rulerOvalCenterDragRef.current) {
        const off = rulerOvalCenterOffsetRef.current;
        upd({
          ovalCenterX: pos.x - off.dx,
          ovalCenterY: pos.y - off.dy,
        });
        scheduleRulerOverlay();
        return true;
      }

      if (rulerOvalSlideDragRef.current) {
        const ocx = layer.ovalCenterX ?? 0;
        const ocy = layer.ovalCenterY ?? 0;
        const oAngle = layer.ovalAngle ?? 0;
        const oTheta = (oAngle * Math.PI) / 180;
        const minDX = Math.sin(oTheta);
        const minDY = -Math.cos(oTheta);
        // Project drag position onto minor axis
        const dx = pos.x - ocx;
        const dy = pos.y - ocy;
        const proj = dx * minDX + dy * minDY;
        upd({
          ovalCenterX: ocx + minDX * proj,
          ovalCenterY: ocy + minDY * proj,
        });
        scheduleRulerOverlay();
        return true;
      }

      if (rulerOvalRotDragRef.current) {
        const ocx = layer.ovalCenterX ?? 0;
        const ocy = layer.ovalCenterY ?? 0;
        const dx = pos.x - ocx;
        const dy = pos.y - ocy;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len > 2) {
          const nx = dx / len;
          const ny = dy / len;
          // Rotation handle is at minorUp direction: minorUp = (-sinθ, -cosθ)
          const newTheta = Math.atan2(nx, -ny);
          const newAngleDeg = (newTheta * 180) / Math.PI;
          upd({ ovalAngle: newAngleDeg });
        }
        scheduleRulerOverlay();
        return true;
      }

      if (rulerOvalSemiMinorDragRef.current) {
        const ocx = layer.ovalCenterX ?? 0;
        const ocy = layer.ovalCenterY ?? 0;
        const oAngle = layer.ovalAngle ?? 0;
        const oTheta = (oAngle * Math.PI) / 180;
        const minDX = Math.sin(oTheta);
        const minDY = -Math.cos(oTheta);
        const dx = pos.x - ocx;
        const dy = pos.y - ocy;
        const proj = Math.abs(dx * minDX + dy * minDY);
        upd({ ovalSemiMinor: Math.max(5, proj) });
        scheduleRulerOverlay();
        return true;
      }

      if (rulerOvalPropDragRef.current) {
        const ocx = layer.ovalCenterX ?? 0;
        const ocy = layer.ovalCenterY ?? 0;
        const dx = pos.x - ocx;
        const dy = pos.y - ocy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const init = rulerOvalPropInitRef.current;
        const scale = dist / init.dist;
        upd({
          ovalSemiMajor: Math.max(5, init.a * scale),
          ovalSemiMinor: Math.max(5, init.b * scale),
        });
        scheduleRulerOverlay();
        return true;
      }

      if (rulerOvalSemiMajorDragRef.current) {
        const ocx = layer.ovalCenterX ?? 0;
        const ocy = layer.ovalCenterY ?? 0;
        const oAngle = layer.ovalAngle ?? 0;
        const oTheta = (oAngle * Math.PI) / 180;
        const majDX = Math.cos(oTheta);
        const majDY = Math.sin(oTheta);
        const dx = pos.x - ocx;
        const dy = pos.y - ocy;
        const proj = Math.abs(dx * majDX + dy * majDY);
        upd({ ovalSemiMajor: Math.max(5, proj) });
        scheduleRulerOverlay();
        return true;
      }

      return false;
    },
    [makeUpdater, scheduleRulerOverlay],
  );

  // ── handleGridRulerPointerMove ────────────────────────────────────────────
  /**
   * Reproduced from PaintingApp.tsx lines 8221–8299.
   * Handles the active grid corner/edge-midpoint drag.
   */
  const handleGridRulerPointerMove = useCallback(
    (pos: Point, layer: Layer): boolean => {
      if (rulerGridCornerDragRef.current < 0) return false;

      const upd = makeUpdater(layer.id);
      const gc2 = layer.gridCorners;
      if (!gc2) return false;

      const hi = rulerGridCornerDragRef.current;
      const newCorners: [
        { x: number; y: number },
        { x: number; y: number },
        { x: number; y: number },
        { x: number; y: number },
      ] = [{ ...gc2[0] }, { ...gc2[1] }, { ...gc2[2] }, { ...gc2[3] }];

      const corners = [gc2[0], gc2[1], gc2[2], gc2[3]];
      const mids = [
        {
          x: (corners[0].x + corners[1].x) / 2,
          y: (corners[0].y + corners[1].y) / 2,
        },
        {
          x: (corners[1].x + corners[2].x) / 2,
          y: (corners[1].y + corners[2].y) / 2,
        },
        {
          x: (corners[2].x + corners[3].x) / 2,
          y: (corners[2].y + corners[3].y) / 2,
        },
        {
          x: (corners[3].x + corners[0].x) / 2,
          y: (corners[3].y + corners[0].y) / 2,
        },
      ];
      const prevX = hi < 4 ? gc2[hi].x : mids[hi - 4].x;
      const prevY = hi < 4 ? gc2[hi].y : mids[hi - 4].y;
      const dxD = pos.x - prevX;
      const dyD = pos.y - prevY;

      if (hi < 4) {
        // Corner handle: move this corner
        newCorners[hi] = { x: pos.x, y: pos.y };
      } else {
        // Edge midpoint handle: move both corners of that edge
        const edgeMap: [number, number][] = [
          [0, 1],
          [1, 2],
          [2, 3],
          [3, 0],
        ];
        const [c1, c2] = edgeMap[hi - 4];
        newCorners[c1] = { x: gc2[c1].x + dxD, y: gc2[c1].y + dyD };
        newCorners[c2] = { x: gc2[c2].x + dxD, y: gc2[c2].y + dyD };
      }

      upd({ gridCorners: newCorners });
      scheduleRulerOverlay();
      return true;
    },
    [makeUpdater, scheduleRulerOverlay],
  );

  // ── handleEllipseGridRulerPointerUp ───────────────────────────────────────
  /**
   * Reproduced from PaintingApp.tsx lines 9386–9531 (oval + grid sections).
   * Builds afterState, pushes undo, and clears all oval and grid drag refs.
   */
  const handleEllipseGridRulerPointerUp = useCallback(
    (layer: Layer): boolean => {
      const anyOval =
        rulerOvalCenterDragRef.current ||
        rulerOvalSlideDragRef.current ||
        rulerOvalRotDragRef.current ||
        rulerOvalSemiMinorDragRef.current ||
        rulerOvalSemiMajorDragRef.current ||
        rulerOvalPropDragRef.current;
      const anyGrid = rulerGridCornerDragRef.current >= 0;

      if (!anyOval && !anyGrid) return false;

      // Fix 2: Clamp non-VP position handles to canvas bounds on pointer-up.
      const W = canvasWidthRef.current;
      const H = canvasHeightRef.current;
      const cx = (v: number | undefined) =>
        v !== undefined ? Math.max(0, Math.min(W, v)) : v;
      const cy = (v: number | undefined) =>
        v !== undefined ? Math.max(0, Math.min(H, v)) : v;

      let afterState: Record<string, unknown>;

      if (anyOval) {
        // Clamp ovalCenter position. ovalAngle and semi-axes are not positions.
        const clampedOvalCX = cx(layer.ovalCenterX);
        const clampedOvalCY = cy(layer.ovalCenterY);
        const needsClampOval =
          clampedOvalCX !== layer.ovalCenterX ||
          clampedOvalCY !== layer.ovalCenterY;
        if (needsClampOval) {
          const patchOval: Partial<Layer> = {};
          if (clampedOvalCX !== undefined)
            patchOval.ovalCenterX = clampedOvalCX;
          if (clampedOvalCY !== undefined)
            patchOval.ovalCenterY = clampedOvalCY;
          const fnOval = (l: Layer) =>
            l.id === layer.id ? { ...l, ...patchOval } : l;
          setLayers((prev) => prev.map(fnOval));
          layersRef.current = layersRef.current.map(fnOval);
        }
        const refreshedOval =
          layersRef.current.find((l) => l.id === layer.id) ?? layer;
        afterState = {
          ovalCenterX: refreshedOval.ovalCenterX,
          ovalCenterY: refreshedOval.ovalCenterY,
          ovalAngle: refreshedOval.ovalAngle ?? 0,
          ovalSemiMajor: refreshedOval.ovalSemiMajor ?? 120,
          ovalSemiMinor: refreshedOval.ovalSemiMinor ?? 60,
        };
      } else {
        // Grid: clamp each corner to canvas bounds.
        const gc = layer.gridCorners;
        if (gc) {
          const clampedCorners = gc.map((pt) => ({
            x: Math.max(0, Math.min(W, pt.x)),
            y: Math.max(0, Math.min(H, pt.y)),
          })) as typeof gc;
          const needsClampGrid = clampedCorners.some(
            (pt, i) => pt.x !== gc[i].x || pt.y !== gc[i].y,
          );
          if (needsClampGrid) {
            const fnGrid = (l: Layer) =>
              l.id === layer.id ? { ...l, gridCorners: clampedCorners } : l;
            setLayers((prev) => prev.map(fnGrid));
            layersRef.current = layersRef.current.map(fnGrid);
          }
        }
        const refreshedGrid =
          layersRef.current.find((l) => l.id === layer.id) ?? layer;
        afterState = { gridCorners: refreshedGrid.gridCorners };
      }

      const preState =
        rulerOvalDragPreStateRef.current ?? rulerGridDragPreStateRef.current;
      if (preState) {
        pushHistory({
          type: "ruler-edit",
          layerId: layer.id,
          before: preState,
          after: afterState,
        });
        rulerEditHistoryDepthRef.current++;
      }

      // Reset all oval drag refs
      rulerOvalCenterDragRef.current = false;
      rulerOvalSlideDragRef.current = false;
      rulerOvalRotDragRef.current = false;
      rulerOvalSemiMinorDragRef.current = false;
      rulerOvalSemiMajorDragRef.current = false;
      rulerOvalPropDragRef.current = false;
      rulerOvalDragPreStateRef.current = null;

      // Reset grid drag refs
      rulerGridCornerDragRef.current = -1;
      rulerGridDragPreStateRef.current = null;

      scheduleRulerOverlay();
      return true;
    },
    [
      canvasWidthRef,
      canvasHeightRef,
      layersRef,
      setLayers,
      pushHistory,
      rulerEditHistoryDepthRef,
      scheduleRulerOverlay,
    ],
  );

  // ── isOvalDragging ────────────────────────────────────────────────────────

  const isOvalDragging = useCallback((): boolean => {
    return (
      rulerOvalCenterDragRef.current ||
      rulerOvalSlideDragRef.current ||
      rulerOvalRotDragRef.current ||
      rulerOvalSemiMinorDragRef.current ||
      rulerOvalSemiMajorDragRef.current ||
      rulerOvalPropDragRef.current
    );
  }, []);

  // ── isGridDragging ────────────────────────────────────────────────────────

  const isGridDragging = useCallback((): boolean => {
    return rulerGridCornerDragRef.current >= 0;
  }, []);

  // ── Return ───────────────────────────────────────────────────────────────

  return {
    rulerOvalCenterDragRef,
    rulerOvalCenterOffsetRef,
    rulerOvalSlideDragRef,
    rulerOvalRotDragRef,
    rulerOvalSemiMinorDragRef,
    rulerOvalSemiMajorDragRef,
    rulerOvalPropDragRef,
    rulerOvalPropInitRef,
    rulerOvalDragPreStateRef,
    rulerGridCornerDragRef,
    rulerGridDragPreStateRef,
    drawOvalRulerOverlay,
    drawGridRulerOverlay,
    getOvalSnapPosition,
    getGridSnapPosition,
    handleOvalRulerPointerDown,
    handleGridRulerPointerDown,
    handleOvalRulerPointerMove,
    handleGridRulerPointerMove,
    handleEllipseGridRulerPointerUp,
    isOvalDragging,
    isGridDragging,
  };
}

export default useEllipseGridRuler;
