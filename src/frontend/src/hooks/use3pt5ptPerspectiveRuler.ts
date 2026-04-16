// ============================================================
// RESERVED FOR FUTURE USE
// This ruler hook is not yet wired into PaintingApp event handlers.
// It is intentionally preserved for the upcoming perspective/ellipse
// ruler feature implementation. Do not delete.
// ============================================================

/**
 * use3pt5ptPerspectiveRuler — 3-point and 5-point perspective ruler sub-system hook
 *
 * Step 3 of 4 — Ruler Extraction Sequence
 * ----------------------------------------
 * Contains ALL perspective-3pt and perspective-5pt ruler logic extracted from
 * PaintingApp.tsx: overlay drawing, snap-to-ruler, pointer-down / pointer-move /
 * pointer-up drag handling, and initial-placement logic.
 *
 * WIRING IS A SEPARATE STEP.
 * Do NOT wire this hook into PaintingApp.tsx yet — that comes after step 4
 * is also written (ellipse + grid).
 *
 * Refs still declared inside PaintingApp.tsx (until the wiring step):
 *   rulerGridDDragRef, rulerGridEDragRef,
 *   ruler5ptCenterDragRef, ruler5ptHandleADragRef, ruler5ptHandleBDragRef,
 *   ruler5ptHandleCDragRef, ruler5ptHandleCShiftDragRef, ruler5ptHandleDDragRef,
 *   ruler5ptPreStateRef, ruler5ptCenterOffsetRef, ruler5ptCInitDistRef,
 *   lastSingle5ptFamilyRef, lastSingle3ptFamilyRef
 *
 * The 3pt ruler shares VP1/VP2/center/horizon/grid-A/B/C/rotation drag refs with
 * the 2pt ruler (those are owned by use1pt2ptPerspectiveRuler).  This hook owns
 * only the 3pt-exclusive drag refs (D, E) and all 5pt drag refs.
 * During the wiring step PaintingApp will pass the shared 2pt drag refs in via
 * the props interface so 3pt pointer-down can set them.
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
 * The same pattern used by the other perspective ruler hooks.
 */
export interface Perspective3pt5ptSnapRefs {
  /** Direction locked at warmup for the current stroke. */
  strokeSnapDirRef: React.MutableRefObject<{
    cos: number;
    sin: number;
    throughVP: boolean;
    vpAnchorX?: number;
    vpAnchorY?: number;
  } | null>;
  /** H/V axis lock (present for symmetry with other ruler hooks). */
  strokeHvAxisRef: React.MutableRefObject<"h" | "v" | null>;
  /** H/V pivot (present for symmetry with other ruler hooks). */
  strokeHvPivotRef: React.MutableRefObject<Point | null>;
  /** Origin of the current stroke (set on pen-down by PaintingApp). */
  strokeSnapOriginRef: React.MutableRefObject<Point | null>;
}

// ── Shared 2pt drag refs passed in so 3pt pointer-down can set them ──────────────
/**
 * Refs owned by use1pt2ptPerspectiveRuler that the 3pt pointer-down handler also
 * sets (3pt re-uses VP1/VP2/center/rotation/grid-A/B/C drags from the 2pt system).
 */
export interface Shared2ptDragRefs {
  rulerVP1DragRef: React.MutableRefObject<boolean>;
  rulerVP2DragRef: React.MutableRefObject<boolean>;
  ruler2ptCenterDragRef: React.MutableRefObject<boolean>;
  ruler2ptCenterDragOffsetRef: React.MutableRefObject<{
    dx: number;
    dy: number;
  }>;
  ruler2ptRotDragRef: React.MutableRefObject<boolean>;
  ruler2ptRotDragD1Ref: React.MutableRefObject<number>;
  ruler2ptRotDragD2Ref: React.MutableRefObject<number>;
  ruler2ptFocalLengthSqRef: React.MutableRefObject<number>;
  ruler2ptDragPreStateRef: React.MutableRefObject<Record<
    string,
    unknown
  > | null>;
  rulerGridADragRef: React.MutableRefObject<boolean>;
  rulerGridBDragRef: React.MutableRefObject<boolean>;
  rulerGridCDragRef: React.MutableRefObject<boolean>;
}

// ── Props ────────────────────────────────────────────────────────────────────────
export interface Use3pt5ptPerspectiveRulerProps {
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
  snapRefs: Perspective3pt5ptSnapRefs;
  /**
   * Shared 2pt drag refs owned by use1pt2ptPerspectiveRuler.
   * The 3pt pointer-down handler writes these refs so the existing 2pt
   * pointer-move/up handlers in PaintingApp process 3pt drags correctly.
   */
  shared2ptDragRefs: Shared2ptDragRefs;
}

// ── Return type ──────────────────────────────────────────────────────────────────
export interface Perspective3pt5ptRulerHandles {
  // ── Drag refs — 3pt exclusive ──────────────────────────────────────────────
  /** D handle drag (VP3 through A→D line) */
  rulerGridDDragRef: React.MutableRefObject<boolean>;
  /** E handle drag (VP3 through C→E line) */
  rulerGridEDragRef: React.MutableRefObject<boolean>;

  // ── Drag refs — 5pt ────────────────────────────────────────────────────────
  ruler5ptCenterDragRef: React.MutableRefObject<boolean>;
  ruler5ptHandleADragRef: React.MutableRefObject<boolean>;
  ruler5ptHandleBDragRef: React.MutableRefObject<boolean>;
  ruler5ptHandleCDragRef: React.MutableRefObject<boolean>;
  ruler5ptHandleCShiftDragRef: React.MutableRefObject<boolean>;
  ruler5ptHandleDDragRef: React.MutableRefObject<boolean>;
  ruler5ptPreStateRef: React.MutableRefObject<Record<string, unknown>>;
  ruler5ptCenterOffsetRef: React.MutableRefObject<{ dx: number; dy: number }>;
  ruler5ptCInitDistRef: React.MutableRefObject<number>;
  /** Tracks which 5pt family was last snapped to in single-family mode. */
  lastSingle5ptFamilyRef: React.MutableRefObject<"central" | "lr" | "ud">;
  /** Tracks which 3pt VP family was last snapped to in single-family mode. */
  lastSingle3ptFamilyRef: React.MutableRefObject<"vp1" | "vp2" | "vp3">;

  // ── Overlay drawing ────────────────────────────────────────────────────────
  /** Draw the 3pt perspective ruler overlay onto ctx (already in canvas-space). */
  draw3ptRulerOverlay: (
    ctx: CanvasRenderingContext2D,
    layer: Layer,
    opacity: number,
  ) => void;
  /** Draw the 5pt perspective ruler overlay onto ctx (already in canvas-space). */
  draw5ptRulerOverlay: (
    ctx: CanvasRenderingContext2D,
    layer: Layer,
    opacity: number,
  ) => void;

  // ── Snap ───────────────────────────────────────────────────────────────────
  /** Returns the snapped position for a 3pt perspective ruler stroke. */
  get3ptSnapPosition: (rawPos: Point, origin: Point) => Point;
  /** Returns the snapped position for a 5pt perspective ruler stroke. */
  get5ptSnapPosition: (rawPos: Point, origin: Point) => Point;

  // ── Pointer events ─────────────────────────────────────────────────────────
  /**
   * Handle pointer-down for 3pt ruler.
   * @returns true if the event was consumed.
   */
  handle3ptRulerPointerDown: (
    pos: Point,
    layer: Layer,
    handleRadius: number,
    shiftHeld: boolean,
  ) => boolean;
  /**
   * Handle pointer-down for 5pt ruler.
   * @returns true if the event was consumed.
   */
  handle5ptRulerPointerDown: (
    pos: Point,
    layer: Layer,
    handleRadius: number,
    shiftHeld: boolean,
  ) => boolean;
  /**
   * Handle pointer-move for all active 3pt drag ops.
   * NOTE: 3pt reuses VP1/VP2/center/rotation/A/B/C drags from the 2pt system via
   * shared2ptDragRefs — those are handled by the 2pt hook's pointer-move.  This
   * function only handles the 3pt-exclusive D and E drag refs.
   * @returns true if any 3pt-exclusive drag was active.
   */
  handle3ptExclusivePointerMove: (pos: Point, layer: Layer) => boolean;
  /**
   * Handle pointer-move for all active 5pt drags.
   * @returns true if any 5pt drag was active.
   */
  handle5ptRulerPointerMove: (pos: Point, layer: Layer) => boolean;
  /**
   * Handle pointer-up for all active 3pt-exclusive + 5pt drags.
   * Pushes undo entry and clears all 3pt/5pt drag refs.
   * @returns true if any drag was active.
   */
  handle3pt5ptRulerPointerUp: (layer: Layer) => boolean;

  /** True if any 3pt-exclusive drag ref is currently active. */
  is3ptExclusiveDragging: () => boolean;
  /** True if any 5pt drag ref is currently active. */
  is5ptDragging: () => boolean;
}

// ── Helper ───────────────────────────────────────────────────────────────────────

/** Intersection of line through (p1x,p1y)→(p2x,p2y) with vertical x = vx. */
function lineIntersectVX(
  p1x: number,
  p1y: number,
  p2x: number,
  p2y: number,
  vx: number,
): { x: number; y: number } | null {
  const ddx = p2x - p1x;
  if (Math.abs(ddx) < 0.001) return null;
  const tt = (vx - p1x) / ddx;
  return { x: vx, y: p1y + tt * (p2y - p1y) };
}

// ── Hook ─────────────────────────────────────────────────────────────────────────
export function use3pt5ptPerspectiveRuler({
  canvasWidthRef,
  canvasHeightRef,
  layersRef,
  setLayers,
  pushHistory,
  rulerEditHistoryDepthRef,
  scheduleRulerOverlay,
  activeToolRef,
  snapRefs,
  shared2ptDragRefs,
}: Use3pt5ptPerspectiveRulerProps): Perspective3pt5ptRulerHandles {
  // ── 3pt exclusive drag refs ───────────────────────────────────────────────
  const rulerGridDDragRef = useRef(false);
  const rulerGridEDragRef = useRef(false);

  // ── 5pt drag refs ─────────────────────────────────────────────────────────
  const ruler5ptCenterDragRef = useRef(false);
  const ruler5ptHandleADragRef = useRef(false);
  const ruler5ptHandleBDragRef = useRef(false);
  const ruler5ptHandleCDragRef = useRef(false);
  const ruler5ptHandleCShiftDragRef = useRef(false);
  const ruler5ptHandleDDragRef = useRef(false);
  const ruler5ptPreStateRef = useRef<Record<string, unknown>>({});
  const ruler5ptCenterOffsetRef = useRef({ dx: 0, dy: 0 });
  const ruler5ptCInitDistRef = useRef(1);
  const lastSingle5ptFamilyRef = useRef<"central" | "lr" | "ud">("central");
  const lastSingle3ptFamilyRef = useRef<"vp1" | "vp2" | "vp3">("vp1");

  // ── Shared helper: update layer state in both setLayers and layersRef ──────
  const makeUpdater = useCallback(
    (layerId: string) => (patch: Partial<Layer>) => {
      const fn = (l: Layer) => (l.id === layerId ? { ...l, ...patch } : l);
      setLayers((prev) => prev.map(fn));
      layersRef.current = layersRef.current.map(fn);
    },
    [layersRef, setLayers],
  );

  // ── draw3ptRulerOverlay ───────────────────────────────────────────────────
  const draw3ptRulerOverlay = useCallback(
    (ctx: CanvasRenderingContext2D, layer: Layer, opacity: number) => {
      if (
        layer.horizonCenterX === undefined ||
        layer.horizonCenterY === undefined
      ) {
        return;
      }

      const pcX = layer.horizonCenterX;
      const pcY = layer.horizonCenterY;
      const hAngle3 = layer.horizonAngle ?? 0;
      const hRad3 = (hAngle3 * Math.PI) / 180;
      const hDirX3 = Math.cos(hRad3);
      const hDirY3 = Math.sin(hRad3);
      const maxDist3 =
        Math.max(canvasWidthRef.current, canvasHeightRef.current) * 2;
      const vp1X3 = layer.vp1X ?? pcX - canvasWidthRef.current * 0.25;
      const vp1Y3 = layer.vp1Y ?? pcY;
      const vp2X3 = layer.vp2X ?? pcX + canvasWidthRef.current * 0.25;
      const vp2Y3 = layer.vp2Y ?? pcY;

      const vp1Color = layer.vp1Color ?? "#ff0000";
      const vp2Color = layer.vp2Color ?? "#0000ff";
      const vp3Color = layer.vp3Color ?? "#00ff00";
      const color = layer.rulerColor ?? "#9333ea";

      // Compute grid handle positions (same as 2pt)
      const bX3 = layer.rulerGridBX ?? pcX;
      const bY3 = layer.rulerGridBY ?? pcY + 120;
      const aX3 = vp1X3 + 0.5 * (bX3 - vp1X3);
      const aY3 = vp1Y3 + 0.5 * (bY3 - vp1Y3);
      const cX3 = vp2X3 + 0.5 * (bX3 - vp2X3);
      const cY3 = vp2Y3 + 0.5 * (bY3 - vp2Y3);

      // D handle position (user-draggable, on line A→VP3)
      const fallbackVP3Y = layer.rulerVP3Y ?? pcY - 200;
      const dX3 =
        layer.rulerHandleDX !== undefined
          ? layer.rulerHandleDX
          : (aX3 + pcX) / 2;
      const dY3 =
        layer.rulerHandleDY !== undefined
          ? layer.rulerHandleDY
          : (aY3 + fallbackVP3Y) / 2;

      // VP3 = intersection of line(A, D) with vertical through P
      const vp3Res3 = lineIntersectVX(aX3, aY3, dX3, dY3, pcX);
      const vp3X3 = pcX;
      const vp3Y3 = vp3Res3 ? vp3Res3.y : fallbackVP3Y;

      // E handle = midpoint of C→VP3
      const eX3 = (cX3 + vp3X3) / 2;
      const eY3 = (cY3 + vp3Y3) / 2;

      // Draw 24 radial lines from VP1
      ctx.strokeStyle = vp1Color;
      ctx.lineWidth = 0.8;
      ctx.setLineDash([4, 6]);
      if (layer.threePtEnableVP1 === false) ctx.globalAlpha = opacity * 0.25;
      for (let i = 0; i < 24; i++) {
        const angle = (i * 15 * Math.PI) / 180;
        ctx.beginPath();
        ctx.moveTo(vp1X3, vp1Y3);
        ctx.lineTo(
          vp1X3 + Math.cos(angle) * maxDist3,
          vp1Y3 + Math.sin(angle) * maxDist3,
        );
        ctx.stroke();
      }
      ctx.globalAlpha = opacity;

      // Draw 24 radial lines from VP2
      ctx.strokeStyle = vp2Color;
      if (layer.threePtEnableVP2 === false) ctx.globalAlpha = opacity * 0.25;
      for (let i = 0; i < 24; i++) {
        const angle = (i * 15 * Math.PI) / 180;
        ctx.beginPath();
        ctx.moveTo(vp2X3, vp2Y3);
        ctx.lineTo(
          vp2X3 + Math.cos(angle) * maxDist3,
          vp2Y3 + Math.sin(angle) * maxDist3,
        );
        ctx.stroke();
      }
      ctx.globalAlpha = opacity;

      // Draw 24 radial lines from VP3 (replaces perpendicular lines)
      ctx.strokeStyle = vp3Color;
      if (layer.threePtEnableVP3 === false) ctx.globalAlpha = opacity * 0.25;
      for (let i = 0; i < 24; i++) {
        const angle = (i * 15 * Math.PI) / 180;
        ctx.beginPath();
        ctx.moveTo(vp3X3, vp3Y3);
        ctx.lineTo(
          vp3X3 + Math.cos(angle) * maxDist3,
          vp3Y3 + Math.sin(angle) * maxDist3,
        );
        ctx.stroke();
      }
      ctx.globalAlpha = opacity;
      ctx.setLineDash([]);

      // Draw horizon line
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(pcX - hDirX3 * maxDist3, pcY - hDirY3 * maxDist3);
      ctx.lineTo(pcX + hDirX3 * maxDist3, pcY + hDirY3 * maxDist3);
      ctx.stroke();

      // Draw infinite construction lines through D→VP3 and E→VP3
      ctx.globalAlpha = opacity * 0.5;
      ctx.strokeStyle = vp3Color;
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      // Line through A and D (extending through VP3 and beyond)
      const adDirX = dX3 - aX3;
      const adDirY = dY3 - aY3;
      const adLen = Math.sqrt(adDirX * adDirX + adDirY * adDirY);
      if (adLen > 0.1) {
        const adNx = adDirX / adLen;
        const adNy = adDirY / adLen;
        ctx.beginPath();
        ctx.moveTo(aX3 - adNx * maxDist3, aY3 - adNy * maxDist3);
        ctx.lineTo(aX3 + adNx * maxDist3, aY3 + adNy * maxDist3);
        ctx.stroke();
      }
      // Line through C and E (extending through VP3 and beyond)
      const ceDirX = eX3 - cX3;
      const ceDirY = eY3 - cY3;
      const ceLen = Math.sqrt(ceDirX * ceDirX + ceDirY * ceDirY);
      if (ceLen > 0.1) {
        const ceNx = ceDirX / ceLen;
        const ceNy = ceDirY / ceLen;
        ctx.beginPath();
        ctx.moveTo(cX3 - ceNx * maxDist3, cY3 - ceNy * maxDist3);
        ctx.lineTo(cX3 + ceNx * maxDist3, cY3 + ceNy * maxDist3);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.globalAlpha = opacity;

      // Draw VP1 dot + label
      ctx.fillStyle = vp1Color;
      ctx.beginPath();
      ctx.arc(vp1X3, vp1Y3, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = "bold 9px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText("VP1", vp1X3, vp1Y3 - 6);

      // Draw VP2 dot + label
      ctx.fillStyle = vp2Color;
      ctx.beginPath();
      ctx.arc(vp2X3, vp2Y3, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillText("VP2", vp2X3, vp2Y3 - 6);

      // Draw VP3 dot + label
      ctx.fillStyle = vp3Color;
      ctx.beginPath();
      ctx.arc(vp3X3, vp3Y3, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.textBaseline = "bottom";
      ctx.fillText("VP3", vp3X3, vp3Y3 - 6);

      // Draw center handle (P)
      ctx.beginPath();
      ctx.arc(pcX, pcY, 5, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Draw handles when ruler tool is active
      if (activeToolRef.current === "ruler") {
        const hHandleX3 = pcX + hDirX3 * 40;
        const hHandleY3 = pcY + hDirY3 * 40;
        ctx.beginPath();
        ctx.arc(hHandleX3, hHandleY3, 6, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(0,0,0,0.6)";
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.font = "bold 8px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("H", hHandleX3, hHandleY3);

        // A handle (midpoint VP1→B)
        const aX3h = vp1X3 + 0.5 * (bX3 - vp1X3);
        const aY3h = vp1Y3 + 0.5 * (bY3 - vp1Y3);
        ctx.beginPath();
        ctx.arc(aX3h, aY3h, 5, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(0,0,0,0.6)";
        ctx.fill();
        ctx.strokeStyle = vp1Color;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = vp1Color;
        ctx.font = "bold 8px sans-serif";
        ctx.fillText("A", aX3h, aY3h);

        // C handle (midpoint VP2→B)
        ctx.beginPath();
        ctx.arc(cX3, cY3, 5, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(0,0,0,0.6)";
        ctx.fill();
        ctx.strokeStyle = vp2Color;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = vp2Color;
        ctx.fillText("C", cX3, cY3);

        // B handle
        ctx.beginPath();
        ctx.arc(bX3, bY3, 6, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(0,0,0,0.6)";
        ctx.fill();
        ctx.strokeStyle = vp2Color;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = vp2Color;
        ctx.fillText("B", bX3, bY3);

        // D handle (on line A→VP3)
        ctx.beginPath();
        ctx.arc(dX3, dY3, 5, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(0,0,0,0.6)";
        ctx.fill();
        ctx.strokeStyle = vp3Color;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = vp3Color;
        ctx.fillText("D", dX3, dY3);

        // E handle (on line C→VP3)
        ctx.beginPath();
        ctx.arc(eX3, eY3, 5, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(0,0,0,0.6)";
        ctx.fill();
        ctx.strokeStyle = vp3Color;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = vp3Color;
        ctx.fillText("E", eX3, eY3);
      }

      // Draw full-canvas guide lines VP1→B and VP2→B
      ctx.lineWidth = 0.8;
      ctx.setLineDash([4, 6]);
      ctx.strokeStyle = vp1Color;
      const d1x3 = bX3 - vp1X3;
      const d1y3 = bY3 - vp1Y3;
      const l1_3 = Math.sqrt(d1x3 * d1x3 + d1y3 * d1y3);
      if (l1_3 > 0.1) {
        const n1x3 = d1x3 / l1_3;
        const n1y3 = d1y3 / l1_3;
        ctx.beginPath();
        ctx.moveTo(vp1X3 - n1x3 * maxDist3, vp1Y3 - n1y3 * maxDist3);
        ctx.lineTo(vp1X3 + n1x3 * maxDist3, vp1Y3 + n1y3 * maxDist3);
        ctx.stroke();
      }
      ctx.strokeStyle = vp2Color;
      const d2x3 = bX3 - vp2X3;
      const d2y3 = bY3 - vp2Y3;
      const l2_3 = Math.sqrt(d2x3 * d2x3 + d2y3 * d2y3);
      if (l2_3 > 0.1) {
        const n2x3 = d2x3 / l2_3;
        const n2y3 = d2y3 / l2_3;
        ctx.beginPath();
        ctx.moveTo(vp2X3 - n2x3 * maxDist3, vp2Y3 - n2y3 * maxDist3);
        ctx.lineTo(vp2X3 + n2x3 * maxDist3, vp2Y3 + n2y3 * maxDist3);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      // Solid line segments AB (VP1 color) and BC (VP2 color)
      if (activeToolRef.current === "ruler") {
        ctx.setLineDash([]);
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = opacity * 0.8;
        // A→B (VP1 color)
        ctx.strokeStyle = vp1Color;
        ctx.beginPath();
        ctx.moveTo(aX3, aY3);
        ctx.lineTo(bX3, bY3);
        ctx.stroke();
        // B→C (VP2 color)
        ctx.strokeStyle = vp2Color;
        ctx.beginPath();
        ctx.moveTo(bX3, bY3);
        ctx.lineTo(cX3, cY3);
        ctx.stroke();
        ctx.globalAlpha = opacity;
      }
    },
    [canvasWidthRef, canvasHeightRef, activeToolRef],
  );

  // ── draw5ptRulerOverlay ───────────────────────────────────────────────────
  const draw5ptRulerOverlay = useCallback(
    (ctx: CanvasRenderingContext2D, layer: Layer, opacity: number) => {
      const cx5 = layer.fivePtCenterX;
      const cy5 = layer.fivePtCenterY;
      if (cx5 === undefined || cy5 === undefined) return;

      const aDistRaw = layer.fivePtHandleADist ?? 40;
      const bDistRaw = layer.fivePtHandleBDist ?? 40;
      const rot5 = layer.fivePtRotation ?? 0;
      const c5Center = layer.fivePtCenterColor ?? "#9333ea";
      const c5LR = layer.fivePtLRColor ?? "#ff0000";
      const c5UD = layer.fivePtUDColor ?? "#0000ff";
      const color = layer.rulerColor ?? "#9333ea";

      const parabolic5 = (h: number) => 4 * h + 0.05 * h * h;
      const vpLRDist = parabolic5(bDistRaw);
      const vpUDDist = parabolic5(aDistRaw);

      const rotX5 = (lx: number, ly: number) =>
        cx5 + Math.cos(rot5) * lx - Math.sin(rot5) * ly;
      const rotY5 = (lx: number, ly: number) =>
        cy5 + Math.sin(rot5) * lx + Math.cos(rot5) * ly;

      const vpLeft = { x: rotX5(-vpLRDist, 0), y: rotY5(-vpLRDist, 0) };
      const vpRight = { x: rotX5(vpLRDist, 0), y: rotY5(vpLRDist, 0) };
      const vpTop = { x: rotX5(0, -vpUDDist), y: rotY5(0, -vpUDDist) };
      const vpBottom = { x: rotX5(0, vpUDDist), y: rotY5(0, vpUDDist) };
      const handleA5 = { x: rotX5(0, aDistRaw), y: rotY5(0, aDistRaw) };
      const handleB5 = { x: rotX5(-bDistRaw, 0), y: rotY5(-bDistRaw, 0) };
      const handleC5 = {
        x: rotX5(bDistRaw, -aDistRaw),
        y: rotY5(bDistRaw, -aDistRaw),
      };
      const handleD5 = {
        x: rotX5(bDistRaw + 30, 0),
        y: rotY5(bDistRaw + 30, 0),
      };

      const canvasW5 = canvasWidthRef.current;
      const canvasH5 = canvasHeightRef.current;

      const extendLineToBounds5 = (
        px: number,
        py: number,
        qx: number,
        qy: number,
      ): [number, number, number, number] | null => {
        const dx = qx - px;
        const dy = qy - py;
        if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return null;
        const ts: number[] = [];
        if (Math.abs(dx) > 0.001) {
          ts.push(-px / dx);
          ts.push((canvasW5 - px) / dx);
        }
        if (Math.abs(dy) > 0.001) {
          ts.push(-py / dy);
          ts.push((canvasH5 - py) / dy);
        }
        ts.sort((a, b) => a - b);
        const valid = ts.filter((t) => {
          const x = px + t * dx;
          const y = py + t * dy;
          return x >= -1 && x <= canvasW5 + 1 && y >= -1 && y <= canvasH5 + 1;
        });
        if (valid.length < 2) return null;
        return [
          px + valid[0] * dx,
          py + valid[0] * dy,
          px + valid[valid.length - 1] * dx,
          py + valid[valid.length - 1] * dy,
        ];
      };

      ctx.lineWidth = 1;
      const enable5CenterDraw = layer.fivePtEnableCenter !== false;
      const enable5LRDraw = layer.fivePtEnableLR !== false;
      const enable5UDDraw = layer.fivePtEnableUD !== false;

      // Center radial lines
      ctx.strokeStyle = c5Center;
      if (!enable5CenterDraw) ctx.globalAlpha = opacity * 0.25;
      const N_CENTER5 = 36;
      for (let i = 0; i < N_CENTER5; i++) {
        const angle5 = (i / N_CENTER5) * Math.PI * 2 + rot5;
        const line5 = extendLineToBounds5(
          cx5,
          cy5,
          cx5 + Math.cos(angle5),
          cy5 + Math.sin(angle5),
        );
        if (!line5) continue;
        ctx.beginPath();
        ctx.moveTo(line5[0], line5[1]);
        ctx.lineTo(line5[2], line5[3]);
        ctx.stroke();
      }
      ctx.globalAlpha = opacity;

      // Normalize helper (to [0, 2π))
      const normalize5 = (a: number) =>
        ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);

      // LR arcs
      const N_ARCS5 = 20;
      ctx.strokeStyle = c5LR;
      if (!enable5LRDraw) ctx.globalAlpha = opacity * 0.25;
      for (let i = -N_ARCS5; i <= N_ARCS5; i++) {
        if (i === 0) {
          const line5 = extendLineToBounds5(
            vpLeft.x,
            vpLeft.y,
            vpRight.x,
            vpRight.y,
          );
          if (line5) {
            ctx.beginPath();
            ctx.moveTo(line5[0], line5[1]);
            ctx.lineTo(line5[2], line5[3]);
            ctx.stroke();
          }
          continue;
        }
        const h_local = (i / N_ARCS5) * vpUDDist;
        const k_local =
          (h_local * h_local - vpLRDist * vpLRDist) / (2 * h_local);
        const r5lr = Math.sqrt(vpLRDist * vpLRDist + k_local * k_local);
        const ccx5lr = rotX5(0, k_local);
        const ccy5lr = rotY5(0, k_local);
        const a1lr = Math.atan2(vpLeft.y - ccy5lr, vpLeft.x - ccx5lr);
        const a2lr = Math.atan2(vpRight.y - ccy5lr, vpRight.x - ccx5lr);
        const ipt5lr = { x: rotX5(0, h_local), y: rotY5(0, h_local) };
        const aMidlr = Math.atan2(ipt5lr.y - ccy5lr, ipt5lr.x - ccx5lr);
        const a1lrn = normalize5(a1lr);
        const a2lrn = normalize5(a2lr);
        const aMidlrn = normalize5(aMidlr);
        const cwSweeplr = normalize5(a2lrn - a1lrn);
        const cwToMidlr = normalize5(aMidlrn - a1lrn);
        const acwlr = cwToMidlr > cwSweeplr;
        ctx.beginPath();
        ctx.arc(ccx5lr, ccy5lr, r5lr, a1lr, a2lr, acwlr);
        ctx.stroke();
      }
      ctx.globalAlpha = opacity;

      // UD arcs
      ctx.strokeStyle = c5UD;
      if (!enable5UDDraw) ctx.globalAlpha = opacity * 0.25;
      for (let i = -N_ARCS5; i <= N_ARCS5; i++) {
        if (i === 0) {
          const line5 = extendLineToBounds5(
            vpTop.x,
            vpTop.y,
            vpBottom.x,
            vpBottom.y,
          );
          if (line5) {
            ctx.beginPath();
            ctx.moveTo(line5[0], line5[1]);
            ctx.lineTo(line5[2], line5[3]);
            ctx.stroke();
          }
          continue;
        }
        const h_local_ud = (i / N_ARCS5) * vpLRDist;
        const k_local_ud =
          (h_local_ud * h_local_ud - vpUDDist * vpUDDist) / (2 * h_local_ud);
        const r5ud = Math.sqrt(vpUDDist * vpUDDist + k_local_ud * k_local_ud);
        const ccx5ud = rotX5(k_local_ud, 0);
        const ccy5ud = rotY5(k_local_ud, 0);
        const a1ud = Math.atan2(vpTop.y - ccy5ud, vpTop.x - ccx5ud);
        const a2ud = Math.atan2(vpBottom.y - ccy5ud, vpBottom.x - ccx5ud);
        const ipt5ud = { x: rotX5(h_local_ud, 0), y: rotY5(h_local_ud, 0) };
        const aMidud = Math.atan2(ipt5ud.y - ccy5ud, ipt5ud.x - ccx5ud);
        const a1udn = normalize5(a1ud);
        const a2udn = normalize5(a2ud);
        const aMidudn = normalize5(aMidud);
        const cwSweepud = normalize5(a2udn - a1udn);
        const cwToMidud = normalize5(aMidudn - a1udn);
        const acwud = cwToMidud > cwSweepud;
        ctx.beginPath();
        ctx.arc(ccx5ud, ccy5ud, r5ud, a1ud, a2ud, acwud);
        ctx.stroke();
      }
      ctx.globalAlpha = opacity;

      // Handle connector lines and handles (only when ruler tool is active)
      if (activeToolRef.current === "ruler") {
        ctx.strokeStyle = c5LR;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(handleA5.x, handleA5.y);
        ctx.lineTo(cx5, cy5);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx5, cy5);
        ctx.lineTo(handleC5.x, handleC5.y);
        ctx.stroke();
        ctx.strokeStyle = c5UD;
        ctx.beginPath();
        ctx.moveTo(handleB5.x, handleB5.y);
        ctx.lineTo(cx5, cy5);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx5, cy5);
        ctx.lineTo(handleC5.x, handleC5.y);
        ctx.stroke();
        ctx.lineWidth = 1;

        const drawHandle5 = (
          hx: number,
          hy: number,
          hcolor: string,
          label: string,
        ) => {
          ctx.fillStyle = hcolor;
          ctx.strokeStyle = "#fff";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(hx, hy, 6, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = "#fff";
          ctx.font = "9px sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(label, hx, hy);
          ctx.lineWidth = 1;
        };

        drawHandle5(handleA5.x, handleA5.y, c5LR, "A");
        drawHandle5(handleB5.x, handleB5.y, c5UD, "B");
        drawHandle5(handleC5.x, handleC5.y, color, "C");
        drawHandle5(handleD5.x, handleD5.y, "#888888", "D");

        // VP1 center dot
        ctx.fillStyle = "#ffffff";
        ctx.strokeStyle = "#333";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(cx5, cy5, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // VP dots
        const drawVPDot5 = (vx: number, vy: number) => {
          ctx.fillStyle = "#333";
          ctx.beginPath();
          ctx.arc(vx, vy, 4, 0, Math.PI * 2);
          ctx.fill();
        };
        drawVPDot5(vpLeft.x, vpLeft.y);
        drawVPDot5(vpRight.x, vpRight.y);
        drawVPDot5(vpTop.x, vpTop.y);
        drawVPDot5(vpBottom.x, vpBottom.y);
      }
    },
    [canvasWidthRef, canvasHeightRef, activeToolRef],
  );

  // ── get3ptSnapPosition ────────────────────────────────────────────────────
  const get3ptSnapPosition = useCallback(
    (rawPos: Point, origin: Point): Point => {
      const rulerLayer = layersRef.current.find((l) => l.isRuler);
      if (!rulerLayer) return rawPos;
      if (rulerLayer.horizonCenterX === undefined) return rawPos;

      const pcX3s = rulerLayer.horizonCenterX;
      const pcY3s = rulerLayer.horizonCenterY!;
      const hAngleSnap3 = rulerLayer.horizonAngle ?? 0;
      const hRadSnap3 = (hAngleSnap3 * Math.PI) / 180;
      const snap3vp1X =
        rulerLayer.vp1X ?? pcX3s - canvasWidthRef.current * 0.25;
      const snap3vp1Y = rulerLayer.vp1Y ?? pcY3s;
      const snap3vp2X =
        rulerLayer.vp2X ?? pcX3s + canvasWidthRef.current * 0.25;
      const snap3vp2Y = rulerLayer.vp2Y ?? pcY3s;

      // Compute VP3 from line(A, D) intersecting vertical through P
      const snap3bX = rulerLayer.rulerGridBX ?? pcX3s;
      const snap3bY = rulerLayer.rulerGridBY ?? pcY3s + 120;
      const snap3aX = snap3vp1X + 0.5 * (snap3bX - snap3vp1X);
      const snap3aY = snap3vp1Y + 0.5 * (snap3bY - snap3vp1Y);
      const fallbackVP3Ys = rulerLayer.rulerVP3Y ?? pcY3s - 200;
      const snap3dX =
        rulerLayer.rulerHandleDX !== undefined
          ? rulerLayer.rulerHandleDX
          : (snap3aX + pcX3s) / 2;
      const snap3dY =
        rulerLayer.rulerHandleDY !== undefined
          ? rulerLayer.rulerHandleDY
          : (snap3aY + fallbackVP3Ys) / 2;
      const snap3dx = snap3dX - snap3aX;
      const snap3dy = snap3dY - snap3aY;
      let snap3vp3YCalc = fallbackVP3Ys;
      if (Math.abs(snap3dx) > 0.001) {
        const snap3t = (pcX3s - snap3aX) / snap3dx;
        snap3vp3YCalc = snap3aY + snap3t * snap3dy;
      }
      const snap3vp3X = pcX3s;
      const snap3vp3Y = snap3vp3YCalc;

      const { strokeSnapDirRef } = snapRefs;

      const norm3 = (a: number) => {
        let r = a % (Math.PI * 2);
        if (r > Math.PI) r -= Math.PI * 2;
        if (r < -Math.PI) r += Math.PI * 2;
        return r;
      };

      // Direction already locked for this stroke
      if (strokeSnapDirRef.current) {
        const sd3 = strokeSnapDirRef.current as unknown as {
          cos: number;
          sin: number;
          throughVP: boolean;
          vpAnchorX: number;
          vpAnchorY: number;
        };
        if (sd3.throughVP) {
          const dpx = rawPos.x - sd3.vpAnchorX;
          const dpy = rawPos.y - sd3.vpAnchorY;
          const proj = dpx * sd3.cos + dpy * sd3.sin;
          return {
            x: sd3.vpAnchorX + sd3.cos * proj,
            y: sd3.vpAnchorY + sd3.sin * proj,
          };
        }
        const dpx = rawPos.x - origin.x;
        const dpy = rawPos.y - origin.y;
        const proj = dpx * sd3.cos + dpy * sd3.sin;
        return { x: origin.x + sd3.cos * proj, y: origin.y + sd3.sin * proj };
      }

      const dx3s = rawPos.x - origin.x;
      const dy3s = rawPos.y - origin.y;
      const warmup3 = rulerLayer.rulerWarmupDist ?? 10;
      if (Math.sqrt(dx3s * dx3s + dy3s * dy3s) < warmup3) return origin;

      const strokeAngle3 = Math.atan2(dy3s, dx3s);

      const distVP1_3 = Math.sqrt(
        (origin.x - snap3vp1X) ** 2 + (origin.y - snap3vp1Y) ** 2,
      );
      const vp1Angle3 =
        distVP1_3 < 5
          ? hRadSnap3
          : Math.atan2(origin.y - snap3vp1Y, origin.x - snap3vp1X);

      const distVP2_3 = Math.sqrt(
        (origin.x - snap3vp2X) ** 2 + (origin.y - snap3vp2Y) ** 2,
      );
      const vp2Angle3 =
        distVP2_3 < 5
          ? hRadSnap3
          : Math.atan2(origin.y - snap3vp2Y, origin.x - snap3vp2X);

      const distVP3_3 = Math.sqrt(
        (origin.x - snap3vp3X) ** 2 + (origin.y - snap3vp3Y) ** 2,
      );
      const vp3Angle3 =
        distVP3_3 < 5
          ? Math.PI / 2
          : Math.atan2(origin.y - snap3vp3Y, origin.x - snap3vp3X);

      const candidates3: {
        angle: number;
        throughVP: boolean;
        vpAnchorX: number;
        vpAnchorY: number;
      }[] = [
        {
          angle: vp1Angle3,
          throughVP: true,
          vpAnchorX: snap3vp1X,
          vpAnchorY: snap3vp1Y,
        },
        {
          angle: vp1Angle3 + Math.PI,
          throughVP: true,
          vpAnchorX: snap3vp1X,
          vpAnchorY: snap3vp1Y,
        },
        {
          angle: vp2Angle3,
          throughVP: true,
          vpAnchorX: snap3vp2X,
          vpAnchorY: snap3vp2Y,
        },
        {
          angle: vp2Angle3 + Math.PI,
          throughVP: true,
          vpAnchorX: snap3vp2X,
          vpAnchorY: snap3vp2Y,
        },
        {
          angle: vp3Angle3,
          throughVP: true,
          vpAnchorX: snap3vp3X,
          vpAnchorY: snap3vp3Y,
        },
        {
          angle: vp3Angle3 + Math.PI,
          throughVP: true,
          vpAnchorX: snap3vp3X,
          vpAnchorY: snap3vp3Y,
        },
      ];

      const enable3ptVP1 = rulerLayer.threePtEnableVP1 !== false;
      const enable3ptVP2 = rulerLayer.threePtEnableVP2 !== false;
      const enable3ptVP3 = rulerLayer.threePtEnableVP3 !== false;
      const filteredCandidates3 = candidates3.filter((cc) => {
        if (cc.throughVP) {
          if (cc.vpAnchorX === snap3vp1X && cc.vpAnchorY === snap3vp1Y) {
            return enable3ptVP1;
          }
          if (cc.vpAnchorX === snap3vp2X && cc.vpAnchorY === snap3vp2Y) {
            return enable3ptVP2;
          }
          if (cc.vpAnchorX === snap3vp3X && cc.vpAnchorY === snap3vp3Y) {
            return enable3ptVP3;
          }
        }
        return true;
      });

      if (filteredCandidates3.length === 0) return origin;

      let best3 = filteredCandidates3[0];
      let bestDiff3 = Number.POSITIVE_INFINITY;
      for (const c of filteredCandidates3) {
        const diff = Math.abs(norm3(strokeAngle3 - c.angle));
        if (diff < bestDiff3) {
          bestDiff3 = diff;
          best3 = c;
        }
      }

      (strokeSnapDirRef as React.MutableRefObject<unknown>).current = {
        cos: Math.cos(best3.angle),
        sin: Math.sin(best3.angle),
        throughVP: best3.throughVP,
        vpAnchorX: best3.vpAnchorX,
        vpAnchorY: best3.vpAnchorY,
      };

      if (best3.throughVP) {
        const dpx = rawPos.x - best3.vpAnchorX;
        const dpy = rawPos.y - best3.vpAnchorY;
        const proj = dpx * Math.cos(best3.angle) + dpy * Math.sin(best3.angle);
        return {
          x: best3.vpAnchorX + Math.cos(best3.angle) * proj,
          y: best3.vpAnchorY + Math.sin(best3.angle) * proj,
        };
      }
      const dpx = rawPos.x - origin.x;
      const dpy = rawPos.y - origin.y;
      const proj = dpx * Math.cos(best3.angle) + dpy * Math.sin(best3.angle);
      return {
        x: origin.x + Math.cos(best3.angle) * proj,
        y: origin.y + Math.sin(best3.angle) * proj,
      };
    },
    [layersRef, canvasWidthRef, snapRefs],
  );

  // ── get5ptSnapPosition ────────────────────────────────────────────────────
  const get5ptSnapPosition = useCallback(
    (rawPos: Point, origin: Point): Point => {
      const rulerLayer = layersRef.current.find((l) => l.isRuler);
      if (!rulerLayer) return rawPos;

      const cx5s = rulerLayer.fivePtCenterX;
      const cy5s = rulerLayer.fivePtCenterY;
      if (cx5s === undefined || cy5s === undefined) return rawPos;

      const aDistRaw5s = rulerLayer.fivePtHandleADist ?? 40;
      const bDistRaw5s = rulerLayer.fivePtHandleBDist ?? 40;
      const rot5s = rulerLayer.fivePtRotation ?? 0;
      const parab5s = (h: number) => 4 * h + 0.05 * h * h;
      const vpLRDist5s = parab5s(bDistRaw5s);
      const vpUDDist5s = parab5s(aDistRaw5s);
      const warmup5s = rulerLayer.rulerWarmupDist ?? 10;

      const dx5s = rawPos.x - origin.x;
      const dy5s = rawPos.y - origin.y;
      const dist5s = Math.sqrt(dx5s * dx5s + dy5s * dy5s);

      const { strokeSnapDirRef } = snapRefs;

      // Direction already locked
      if (strokeSnapDirRef.current) {
        const sd5 = strokeSnapDirRef.current as unknown as {
          type: "center" | "lr-arc" | "ud-arc";
          angle?: number;
          k?: number;
          r?: number;
          arcCenterX?: number;
          arcCenterY?: number;
          isLine?: boolean;
          lineDir?: { x: number; y: number };
          lineThroughX?: number;
          lineThroughY?: number;
        };
        if (sd5.type === "center" && sd5.angle !== undefined) {
          const dpx5c = rawPos.x - cx5s;
          const dpy5c = rawPos.y - cy5s;
          const proj5c =
            dpx5c * Math.cos(sd5.angle) + dpy5c * Math.sin(sd5.angle);
          return {
            x: cx5s + Math.cos(sd5.angle) * proj5c,
            y: cy5s + Math.sin(sd5.angle) * proj5c,
          };
        }
        if (sd5.type === "lr-arc") {
          if (sd5.isLine) {
            const dir = sd5.lineDir!;
            const thruX = sd5.lineThroughX!;
            const thruY = sd5.lineThroughY!;
            const dpx5 = rawPos.x - thruX;
            const dpy5 = rawPos.y - thruY;
            const proj5 = dpx5 * dir.x + dpy5 * dir.y;
            return { x: thruX + dir.x * proj5, y: thruY + dir.y * proj5 };
          }
          const ndx5lr = rawPos.x - sd5.arcCenterX!;
          const ndy5lr = rawPos.y - sd5.arcCenterY!;
          const nd5lr = Math.sqrt(ndx5lr * ndx5lr + ndy5lr * ndy5lr);
          if (nd5lr < 0.001) return rawPos;
          return {
            x: sd5.arcCenterX! + (ndx5lr / nd5lr) * sd5.r!,
            y: sd5.arcCenterY! + (ndy5lr / nd5lr) * sd5.r!,
          };
        }
        if (sd5.type === "ud-arc") {
          if (sd5.isLine) {
            const dir = sd5.lineDir!;
            const thruX = sd5.lineThroughX!;
            const thruY = sd5.lineThroughY!;
            const dpx5 = rawPos.x - thruX;
            const dpy5 = rawPos.y - thruY;
            const proj5 = dpx5 * dir.x + dpy5 * dir.y;
            return { x: thruX + dir.x * proj5, y: thruY + dir.y * proj5 };
          }
          const ndx5ud = rawPos.x - sd5.arcCenterX!;
          const ndy5ud = rawPos.y - sd5.arcCenterY!;
          const nd5ud = Math.sqrt(ndx5ud * ndx5ud + ndy5ud * ndy5ud);
          if (nd5ud < 0.001) return rawPos;
          return {
            x: sd5.arcCenterX! + (ndx5ud / nd5ud) * sd5.r!,
            y: sd5.arcCenterY! + (ndy5ud / nd5ud) * sd5.r!,
          };
        }
        return rawPos;
      }

      const enable5Center = rulerLayer.fivePtEnableCenter !== false;
      const enable5LR = rulerLayer.fivePtEnableLR !== false;
      const enable5UD = rulerLayer.fivePtEnableUD !== false;

      const enabledFamilies = (
        [
          enable5Center && "center",
          enable5LR && "lr-arc",
          enable5UD && "ud-arc",
        ] as Array<"center" | "lr-arc" | "ud-arc" | false>
      ).filter(Boolean) as Array<"center" | "lr-arc" | "ud-arc">;

      const singleFamily =
        enabledFamilies.length === 1 ? enabledFamilies[0] : null;

      if (enabledFamilies.length === 0) return rawPos;
      if (!singleFamily && dist5s < warmup5s) return origin;

      const strokeAngle5 = Math.atan2(dy5s, dx5s);
      const lx5s = Math.cos(rot5s) * dx5s + Math.sin(rot5s) * dy5s;
      const ly5s = -Math.sin(rot5s) * dx5s + Math.cos(rot5s) * dy5s;

      let snapFamily: "center" | "lr-arc" | "ud-arc";
      if (singleFamily) {
        snapFamily = singleFamily;
      } else {
        const dxToVP1 = cx5s - origin.x;
        const dyToVP1 = cy5s - origin.y;
        const angleToVP1 = Math.atan2(dyToVP1, dxToVP1);
        const diffToVP1 = Math.abs(
          ((strokeAngle5 - angleToVP1 + Math.PI * 3) % (Math.PI * 2)) - Math.PI,
        );

        if (diffToVP1 < Math.PI / 6) {
          snapFamily = "center";
        } else if (Math.abs(lx5s) >= Math.abs(ly5s)) {
          snapFamily = "lr-arc";
        } else {
          snapFamily = "ud-arc";
        }

        if (
          (snapFamily === "center" && !enable5Center) ||
          (snapFamily === "lr-arc" && !enable5LR) ||
          (snapFamily === "ud-arc" && !enable5UD)
        ) {
          snapFamily = enabledFamilies[0];
        }
      }

      if (snapFamily === "center") {
        const exactAngle5c = Math.atan2(rawPos.y - cy5s, rawPos.x - cx5s);
        (strokeSnapDirRef as React.MutableRefObject<unknown>).current = {
          type: "center",
          angle: exactAngle5c,
        };
        const dpx5c = rawPos.x - cx5s;
        const dpy5c = rawPos.y - cy5s;
        const proj5c =
          dpx5c * Math.cos(exactAngle5c) + dpy5c * Math.sin(exactAngle5c);
        return {
          x: cx5s + Math.cos(exactAngle5c) * proj5c,
          y: cy5s + Math.sin(exactAngle5c) * proj5c,
        };
      }

      if (snapFamily === "lr-arc") {
        const lrLx =
          Math.cos(rot5s) * (rawPos.x - cx5s) +
          Math.sin(rot5s) * (rawPos.y - cy5s);
        const lrLy =
          -Math.sin(rot5s) * (rawPos.x - cx5s) +
          Math.cos(rot5s) * (rawPos.y - cy5s);
        if (Math.abs(lrLy) < 0.5) {
          const lrLineDir = { x: Math.cos(rot5s), y: Math.sin(rot5s) };
          (strokeSnapDirRef as React.MutableRefObject<unknown>).current = {
            type: "lr-arc",
            isLine: true,
            lineDir: lrLineDir,
            lineThroughX: rawPos.x,
            lineThroughY: rawPos.y,
          };
          return rawPos;
        }
        const k5lr2 =
          (lrLx * lrLx + lrLy * lrLy - vpLRDist5s * vpLRDist5s) / (2 * lrLy);
        const r5lr2 = Math.sqrt(vpLRDist5s * vpLRDist5s + k5lr2 * k5lr2);
        const cccx5lr2 = cx5s + Math.cos(rot5s) * 0 - Math.sin(rot5s) * k5lr2;
        const cccy5lr2 = cy5s + Math.sin(rot5s) * 0 + Math.cos(rot5s) * k5lr2;
        (strokeSnapDirRef as React.MutableRefObject<unknown>).current = {
          type: "lr-arc",
          k: k5lr2,
          r: r5lr2,
          arcCenterX: cccx5lr2,
          arcCenterY: cccy5lr2,
        };
        const ndx5lr2 = rawPos.x - cccx5lr2;
        const ndy5lr2 = rawPos.y - cccy5lr2;
        const nd5lr2 = Math.sqrt(ndx5lr2 * ndx5lr2 + ndy5lr2 * ndy5lr2);
        if (nd5lr2 < 0.001) return rawPos;
        return {
          x: cccx5lr2 + (ndx5lr2 / nd5lr2) * r5lr2,
          y: cccy5lr2 + (ndy5lr2 / nd5lr2) * r5lr2,
        };
      }

      // ud-arc family
      const udLx =
        Math.cos(rot5s) * (rawPos.x - cx5s) +
        Math.sin(rot5s) * (rawPos.y - cy5s);
      const udLy =
        -Math.sin(rot5s) * (rawPos.x - cx5s) +
        Math.cos(rot5s) * (rawPos.y - cy5s);
      if (Math.abs(udLx) < 0.5) {
        const udLineDir = { x: -Math.sin(rot5s), y: Math.cos(rot5s) };
        (strokeSnapDirRef as React.MutableRefObject<unknown>).current = {
          type: "ud-arc",
          isLine: true,
          lineDir: udLineDir,
          lineThroughX: rawPos.x,
          lineThroughY: rawPos.y,
        };
        return rawPos;
      }
      const k5ud2 =
        (udLx * udLx + udLy * udLy - vpUDDist5s * vpUDDist5s) / (2 * udLx);
      const r5ud2 = Math.sqrt(vpUDDist5s * vpUDDist5s + k5ud2 * k5ud2);
      const cccx5ud2 = cx5s + Math.cos(rot5s) * k5ud2 - Math.sin(rot5s) * 0;
      const cccy5ud2 = cy5s + Math.sin(rot5s) * k5ud2 + Math.cos(rot5s) * 0;
      (strokeSnapDirRef as React.MutableRefObject<unknown>).current = {
        type: "ud-arc",
        k: k5ud2,
        r: r5ud2,
        arcCenterX: cccx5ud2,
        arcCenterY: cccy5ud2,
      };
      const ndx5ud2 = rawPos.x - cccx5ud2;
      const ndy5ud2 = rawPos.y - cccy5ud2;
      const nd5ud2 = Math.sqrt(ndx5ud2 * ndx5ud2 + ndy5ud2 * ndy5ud2);
      if (nd5ud2 < 0.001) return rawPos;
      return {
        x: cccx5ud2 + (ndx5ud2 / nd5ud2) * r5ud2,
        y: cccy5ud2 + (ndy5ud2 / nd5ud2) * r5ud2,
      };
    },
    [layersRef, snapRefs],
  );

  // ── handle3ptRulerPointerDown ─────────────────────────────────────────────
  /**
   * 3pt pointer-down: hit-tests all 3pt handles.
   * The VP1/VP2/center/rotation/A/B/C drag refs are shared with the 2pt system;
   * only D and E are exclusive to 3pt.  Writing into shared2ptDragRefs means the
   * 2pt pointer-move/up handlers will process those drags correctly.
   */
  const handle3ptRulerPointerDown = useCallback(
    (
      pos: Point,
      layer: Layer,
      handleRadius: number,
      _shiftHeld: boolean,
    ): boolean => {
      const upd = makeUpdater(layer.id);
      const pcX3 = layer.horizonCenterX;
      const pcY3 = layer.horizonCenterY;
      const vp1X3 = layer.vp1X;
      const vp1Y3 = layer.vp1Y;
      const vp2X3 = layer.vp2X;
      const vp2Y3 = layer.vp2Y;

      const {
        rulerVP1DragRef,
        rulerVP2DragRef,
        ruler2ptCenterDragRef,
        ruler2ptCenterDragOffsetRef,
        ruler2ptRotDragRef,
        ruler2ptRotDragD1Ref,
        ruler2ptRotDragD2Ref,
        ruler2ptFocalLengthSqRef,
        ruler2ptDragPreStateRef,
        rulerGridADragRef,
        rulerGridBDragRef,
        rulerGridCDragRef,
      } = shared2ptDragRefs;

      if (
        pcX3 !== undefined &&
        pcY3 !== undefined &&
        vp1X3 !== undefined &&
        vp1Y3 !== undefined &&
        vp2X3 !== undefined &&
        vp2Y3 !== undefined
      ) {
        const hRad3pt = ((layer.horizonAngle ?? 0) * Math.PI) / 180;
        const hHandleX3 = pcX3 + Math.cos(hRad3pt) * 40;
        const hHandleY3 = pcY3 + Math.sin(hRad3pt) * 40;

        const dVP1_3 = Math.sqrt((pos.x - vp1X3) ** 2 + (pos.y - vp1Y3) ** 2);
        const dVP2_3 = Math.sqrt((pos.x - vp2X3) ** 2 + (pos.y - vp2Y3) ** 2);
        const dCenter3 = Math.sqrt((pos.x - pcX3) ** 2 + (pos.y - pcY3) ** 2);
        const dH3 = Math.sqrt(
          (pos.x - hHandleX3) ** 2 + (pos.y - hHandleY3) ** 2,
        );

        const bX3pt = layer.rulerGridBX ?? pcX3;
        const bY3pt = layer.rulerGridBY ?? pcY3 + 120;
        const cX3pt = vp2X3 + 0.5 * (bX3pt - vp2X3);
        const cY3pt = vp2Y3 + 0.5 * (bY3pt - vp2Y3);
        const aX3pt = vp1X3 + 0.5 * (bX3pt - vp1X3);
        const aY3pt = vp1Y3 + 0.5 * (bY3pt - vp1Y3);

        const fallbackVP3Yp = layer.rulerVP3Y ?? pcY3 - 200;
        const dX3pt =
          layer.rulerHandleDX !== undefined
            ? layer.rulerHandleDX
            : (aX3pt + pcX3) / 2;
        const dY3pt =
          layer.rulerHandleDY !== undefined
            ? layer.rulerHandleDY
            : (aY3pt + fallbackVP3Yp) / 2;

        const vp3R3pt = lineIntersectVX(aX3pt, aY3pt, dX3pt, dY3pt, pcX3);
        const vp3Y3pt = vp3R3pt ? vp3R3pt.y : fallbackVP3Yp;
        const eX3pt = (cX3pt + pcX3) / 2;
        const eY3pt = (cY3pt + vp3Y3pt) / 2;

        const dGridA3 = Math.sqrt((pos.x - aX3pt) ** 2 + (pos.y - aY3pt) ** 2);
        const dGridB3 = Math.sqrt((pos.x - bX3pt) ** 2 + (pos.y - bY3pt) ** 2);
        const dGridC3 = Math.sqrt((pos.x - cX3pt) ** 2 + (pos.y - cY3pt) ** 2);
        const dGridD3 = Math.sqrt((pos.x - dX3pt) ** 2 + (pos.y - dY3pt) ** 2);
        const dGridE3 = Math.sqrt((pos.x - eX3pt) ** 2 + (pos.y - eY3pt) ** 2);

        const pre3ptState = {
          horizonCenterX: pcX3,
          horizonCenterY: pcY3,
          horizonAngle: layer.horizonAngle ?? 0,
          vp1X: vp1X3,
          vp1Y: vp1Y3,
          vp2X: vp2X3,
          vp2Y: vp2Y3,
          rulerGridBX: layer.rulerGridBX,
          rulerGridBY: layer.rulerGridBY,
          rulerVP3Y: layer.rulerVP3Y,
          rulerHandleDX: layer.rulerHandleDX,
          rulerHandleDY: layer.rulerHandleDY,
        };

        const getSignedDist3 = (vpx: number, vpy: number) => {
          const dx = vpx - pcX3;
          const dy = vpy - pcY3;
          return dx * Math.cos(hRad3pt) + dy * Math.sin(hRad3pt);
        };

        if (dGridD3 <= handleRadius) {
          rulerGridDDragRef.current = true;
          ruler2ptDragPreStateRef.current = pre3ptState;
          return true;
        }
        if (dGridE3 <= handleRadius) {
          rulerGridEDragRef.current = true;
          ruler2ptDragPreStateRef.current = pre3ptState;
          return true;
        }
        if (dGridB3 <= handleRadius) {
          rulerGridBDragRef.current = true;
          ruler2ptDragPreStateRef.current = pre3ptState;
          return true;
        }
        if (dGridA3 <= handleRadius) {
          rulerGridADragRef.current = true;
          ruler2ptDragPreStateRef.current = pre3ptState;
          ruler2ptFocalLengthSqRef.current = Math.abs(
            getSignedDist3(vp1X3, vp1Y3) * getSignedDist3(vp2X3, vp2Y3),
          );
          return true;
        }
        if (dGridC3 <= handleRadius) {
          rulerGridCDragRef.current = true;
          ruler2ptDragPreStateRef.current = pre3ptState;
          ruler2ptFocalLengthSqRef.current = Math.abs(
            getSignedDist3(vp1X3, vp1Y3) * getSignedDist3(vp2X3, vp2Y3),
          );
          return true;
        }
        if (dVP1_3 <= handleRadius) {
          rulerVP1DragRef.current = true;
          ruler2ptDragPreStateRef.current = pre3ptState;
          ruler2ptFocalLengthSqRef.current = Math.abs(
            getSignedDist3(vp1X3, vp1Y3) * getSignedDist3(vp2X3, vp2Y3),
          );
          return true;
        }
        if (dVP2_3 <= handleRadius) {
          rulerVP2DragRef.current = true;
          ruler2ptDragPreStateRef.current = pre3ptState;
          ruler2ptFocalLengthSqRef.current = Math.abs(
            getSignedDist3(vp1X3, vp1Y3) * getSignedDist3(vp2X3, vp2Y3),
          );
          return true;
        }
        if (dCenter3 <= handleRadius) {
          ruler2ptCenterDragRef.current = true;
          ruler2ptCenterDragOffsetRef.current = {
            dx: pos.x - pcX3,
            dy: pos.y - pcY3,
          };
          ruler2ptDragPreStateRef.current = pre3ptState;
          return true;
        }
        if (dH3 <= handleRadius + 2) {
          ruler2ptRotDragRef.current = true;
          ruler2ptDragPreStateRef.current = pre3ptState;
          ruler2ptRotDragD1Ref.current = getSignedDist3(vp1X3, vp1Y3);
          ruler2ptRotDragD2Ref.current = getSignedDist3(vp2X3, vp2Y3);
          return true;
        }
        // No handle hit
        return false;
      }

      // Initial placement for 3pt
      const spread3 = canvasWidthRef.current * 0.25;
      const initBX3 = pos.x;
      const initBY3 = pos.y + 120;
      const initVP1X3 = pos.x - spread3;
      const initVP1Y3 = pos.y;
      const initAX3 = initVP1X3 + 0.5 * (initBX3 - initVP1X3);
      const initAY3 = initVP1Y3 + 0.5 * (initBY3 - initVP1Y3);
      const initVP3Y3 = pos.y - 200;
      const initDX3 = (initAX3 + pos.x) / 2;
      const initDY3 = (initAY3 + initVP3Y3) / 2;
      const newState3 = {
        horizonCenterX: pos.x,
        horizonCenterY: pos.y,
        horizonAngle: 0,
        vp1X: pos.x - spread3,
        vp1Y: pos.y,
        vp2X: pos.x + spread3,
        vp2Y: pos.y,
        rulerGridBX: initBX3,
        rulerGridBY: initBY3,
        rulerVP3Y: initVP3Y3,
        rulerHandleDX: initDX3,
        rulerHandleDY: initDY3,
      };
      upd(newState3);
      pushHistory({
        type: "ruler-edit",
        layerId: layer.id,
        before: {},
        after: newState3,
      });
      rulerEditHistoryDepthRef.current++;
      scheduleRulerOverlay();
      return true;
    },
    [
      canvasWidthRef,
      makeUpdater,
      pushHistory,
      rulerEditHistoryDepthRef,
      scheduleRulerOverlay,
      shared2ptDragRefs,
    ],
  );

  // ── handle5ptRulerPointerDown ─────────────────────────────────────────────
  const handle5ptRulerPointerDown = useCallback(
    (
      pos: Point,
      layer: Layer,
      handleRadius: number,
      shiftHeld: boolean,
    ): boolean => {
      const upd = makeUpdater(layer.id);

      const cx5pd = layer.fivePtCenterX;
      const cy5pd = layer.fivePtCenterY;

      if (cx5pd !== undefined && cy5pd !== undefined) {
        const aD5pd = layer.fivePtHandleADist ?? 40;
        const bD5pd = layer.fivePtHandleBDist ?? 40;
        const rot5pd = layer.fivePtRotation ?? 0;
        const rotX5pd = (lx: number, ly: number) =>
          cx5pd + Math.cos(rot5pd) * lx - Math.sin(rot5pd) * ly;
        const rotY5pd = (lx: number, ly: number) =>
          cy5pd + Math.sin(rot5pd) * lx + Math.cos(rot5pd) * ly;

        const hA5 = { x: rotX5pd(0, aD5pd), y: rotY5pd(0, aD5pd) };
        const hB5 = { x: rotX5pd(-bD5pd, 0), y: rotY5pd(-bD5pd, 0) };
        const hC5 = {
          x: rotX5pd(bD5pd, -aD5pd),
          y: rotY5pd(bD5pd, -aD5pd),
        };
        const hD5 = {
          x: rotX5pd(bD5pd + 30, 0),
          y: rotY5pd(bD5pd + 30, 0),
        };

        const dCenter5 = Math.sqrt((pos.x - cx5pd) ** 2 + (pos.y - cy5pd) ** 2);
        const dA5 = Math.sqrt((pos.x - hA5.x) ** 2 + (pos.y - hA5.y) ** 2);
        const dB5 = Math.sqrt((pos.x - hB5.x) ** 2 + (pos.y - hB5.y) ** 2);
        const dC5 = Math.sqrt((pos.x - hC5.x) ** 2 + (pos.y - hC5.y) ** 2);
        const dD5 = Math.sqrt((pos.x - hD5.x) ** 2 + (pos.y - hD5.y) ** 2);

        const pre5State = {
          fivePtCenterX: cx5pd,
          fivePtCenterY: cy5pd,
          fivePtHandleADist: aD5pd,
          fivePtHandleBDist: bD5pd,
          fivePtRotation: rot5pd,
        };
        ruler5ptPreStateRef.current = pre5State;

        if (dA5 <= handleRadius) {
          ruler5ptHandleADragRef.current = true;
          return true;
        }
        if (dB5 <= handleRadius) {
          ruler5ptHandleBDragRef.current = true;
          return true;
        }
        if (dC5 <= handleRadius) {
          if (shiftHeld) {
            ruler5ptHandleCShiftDragRef.current = true;
            const oldCDist = Math.sqrt(
              (hC5.x - cx5pd) ** 2 + (hC5.y - cy5pd) ** 2,
            );
            ruler5ptCInitDistRef.current = oldCDist > 0.001 ? oldCDist : 1;
          } else {
            ruler5ptHandleCDragRef.current = true;
          }
          return true;
        }
        if (dD5 <= handleRadius) {
          ruler5ptHandleDDragRef.current = true;
          return true;
        }
        if (dCenter5 <= handleRadius + 4) {
          ruler5ptCenterDragRef.current = true;
          ruler5ptCenterOffsetRef.current = {
            dx: pos.x - cx5pd,
            dy: pos.y - cy5pd,
          };
          return true;
        }
        // No handle hit
        return false;
      }

      // Initial placement
      const new5State = {
        fivePtCenterX: pos.x,
        fivePtCenterY: pos.y,
        fivePtHandleADist: 40,
        fivePtHandleBDist: 40,
        fivePtRotation: 0,
      };
      upd(new5State);
      pushHistory({
        type: "ruler-edit",
        layerId: layer.id,
        before: {},
        after: new5State,
      });
      rulerEditHistoryDepthRef.current++;
      scheduleRulerOverlay();
      return true;
    },
    [makeUpdater, pushHistory, rulerEditHistoryDepthRef, scheduleRulerOverlay],
  );

  // ── handle3ptExclusivePointerMove ─────────────────────────────────────────
  /**
   * Handles the 3pt-exclusive D and E drag handles.
   * VP1/VP2/center/rotation/A/B/C are handled by the existing 2pt pointer-move
   * logic inside PaintingApp (they share the same drag refs).  This function only
   * handles the 3pt-exclusive D and E drag refs.
   * D and E are non-VP handles — their positions are clamped to canvas bounds.
   */
  const handle3ptExclusivePointerMove = useCallback(
    (pos: Point, layer: Layer): boolean => {
      if (!rulerGridDDragRef.current && !rulerGridEDragRef.current) {
        return false;
      }
      const upd = makeUpdater(layer.id);

      // Clamp a point to canvas bounds (used for all non-VP handles)
      const cW = canvasWidthRef.current;
      const cH = canvasHeightRef.current;
      const clampX = (x: number) => Math.max(0, Math.min(cW, x));
      const clampY = (y: number) => Math.max(0, Math.min(cH, y));

      if (rulerGridDDragRef.current) {
        // D handle: VP3 = lineIntersect(A, D_new, P.x); constrain D.x <= P.x
        const pcXd = layer.horizonCenterX ?? 0;
        const pcYd = layer.horizonCenterY ?? 0;
        const vp1Xd = layer.vp1X ?? pcXd - 200;
        const vp1Yd = layer.vp1Y ?? pcYd;
        const bXd = layer.rulerGridBX ?? pcXd;
        const bYd = layer.rulerGridBY ?? pcYd + 120;
        const aXd = vp1Xd + 0.5 * (bXd - vp1Xd);
        const aYd = vp1Yd + 0.5 * (bYd - vp1Yd);
        // Clamp to canvas then also enforce D.x <= P.x - 1
        const newDx = Math.min(clampX(pos.x), pcXd - 1);
        const newDy = clampY(pos.y);
        const dxDd = newDx - aXd;
        const dyDd = newDy - aYd;
        let newVP3Yd = pcYd - 200;
        if (Math.abs(dxDd) > 0.001) {
          const td = (pcXd - aXd) / dxDd;
          newVP3Yd = aYd + td * dyDd;
        }
        upd({
          rulerHandleDX: newDx,
          rulerHandleDY: newDy,
          rulerVP3Y: newVP3Yd,
        });
        scheduleRulerOverlay();
        return true;
      }

      // rulerGridEDragRef: E handle: VP3 = lineIntersect(C, E_new, P.x)
      const pcXe = layer.horizonCenterX ?? 0;
      const pcYe = layer.horizonCenterY ?? 0;
      const vp1Xe = layer.vp1X ?? pcXe - 200;
      const vp1Ye = layer.vp1Y ?? pcYe;
      const vp2Xe = layer.vp2X ?? pcXe + 200;
      const vp2Ye = layer.vp2Y ?? pcYe;
      const bXe = layer.rulerGridBX ?? pcXe;
      const bYe = layer.rulerGridBY ?? pcYe + 120;
      const aXe = vp1Xe + 0.5 * (bXe - vp1Xe);
      const aYe = vp1Ye + 0.5 * (bYe - vp1Ye);
      const cXe = vp2Xe + 0.5 * (bXe - vp2Xe);
      const cYe = vp2Ye + 0.5 * (bYe - vp2Ye);
      // Clamp to canvas then also enforce E.x >= P.x + 1
      const newEx = Math.max(clampX(pos.x), pcXe + 1);
      const newEy = clampY(pos.y);
      const dxEe = newEx - cXe;
      const dyEe = newEy - cYe;
      let newVP3Ye = pcYe - 200;
      if (Math.abs(dxEe) > 0.001) {
        const te = (pcXe - cXe) / dxEe;
        newVP3Ye = cYe + te * dyEe;
      }
      const oldDx =
        layer.rulerHandleDX !== undefined
          ? layer.rulerHandleDX
          : (aXe + pcXe) / 2;
      const oldDy =
        layer.rulerHandleDY !== undefined
          ? layer.rulerHandleDY
          : (aYe + newVP3Ye) / 2;
      const oldVP3Ye = layer.rulerVP3Y ?? pcYe - 200;
      const oldDistA = Math.sqrt((oldDx - aXe) ** 2 + (oldDy - aYe) ** 2);
      const oldDistAVP3 = Math.sqrt((pcXe - aXe) ** 2 + (oldVP3Ye - aYe) ** 2);
      const ratioD = oldDistAVP3 > 0.001 ? oldDistA / oldDistAVP3 : 0.5;
      const newDistAVP3 = Math.sqrt((pcXe - aXe) ** 2 + (newVP3Ye - aYe) ** 2);
      const avDx = pcXe - aXe;
      const avDy = newVP3Ye - aYe;
      const avLen = Math.sqrt(avDx * avDx + avDy * avDy);
      const newDxFinal =
        avLen > 0.001
          ? aXe + (avDx / avLen) * ratioD * newDistAVP3
          : (aXe + pcXe) / 2;
      const newDyFinal =
        avLen > 0.001
          ? aYe + (avDy / avLen) * ratioD * newDistAVP3
          : (aYe + newVP3Ye) / 2;
      upd({
        rulerHandleDX: newDxFinal,
        rulerHandleDY: newDyFinal,
        rulerVP3Y: newVP3Ye,
      });
      scheduleRulerOverlay();
      return true;
    },
    [makeUpdater, scheduleRulerOverlay, canvasWidthRef, canvasHeightRef],
  );

  // ── handle5ptRulerPointerMove ─────────────────────────────────────────────
  const handle5ptRulerPointerMove = useCallback(
    (pos: Point, layer: Layer): boolean => {
      if (
        !ruler5ptCenterDragRef.current &&
        !ruler5ptHandleADragRef.current &&
        !ruler5ptHandleBDragRef.current &&
        !ruler5ptHandleCDragRef.current &&
        !ruler5ptHandleCShiftDragRef.current &&
        !ruler5ptHandleDDragRef.current
      ) {
        return false;
      }

      const upd = makeUpdater(layer.id);

      // All 5pt handles are non-VP — clamp to canvas bounds
      const cW = canvasWidthRef.current;
      const cH = canvasHeightRef.current;
      const cx = Math.max(0, Math.min(cW, pos.x));
      const cy = Math.max(0, Math.min(cH, pos.y));
      const clampedPos: Point = { x: cx, y: cy };

      if (ruler5ptCenterDragRef.current) {
        const off5c = ruler5ptCenterOffsetRef.current;
        upd({
          fivePtCenterX: Math.max(0, Math.min(cW, clampedPos.x - off5c.dx)),
          fivePtCenterY: Math.max(0, Math.min(cH, clampedPos.y - off5c.dy)),
        });
        scheduleRulerOverlay();
        return true;
      }

      if (ruler5ptHandleADragRef.current) {
        const cx5m = layer.fivePtCenterX ?? 0;
        const cy5m = layer.fivePtCenterY ?? 0;
        const rot5m = layer.fivePtRotation ?? 0;
        const downDX5 = -Math.sin(rot5m);
        const downDY5 = Math.cos(rot5m);
        const aDistNew5 = Math.max(
          10,
          (clampedPos.x - cx5m) * downDX5 + (clampedPos.y - cy5m) * downDY5,
        );
        upd({ fivePtHandleADist: aDistNew5 });
        scheduleRulerOverlay();
        return true;
      }

      if (ruler5ptHandleBDragRef.current) {
        const cx5m = layer.fivePtCenterX ?? 0;
        const cy5m = layer.fivePtCenterY ?? 0;
        const rot5m = layer.fivePtRotation ?? 0;
        const bDistNew5 = Math.max(
          10,
          -(
            (clampedPos.x - cx5m) * Math.cos(rot5m) +
            (clampedPos.y - cy5m) * Math.sin(rot5m)
          ),
        );
        upd({ fivePtHandleBDist: bDistNew5 });
        scheduleRulerOverlay();
        return true;
      }

      if (ruler5ptHandleCDragRef.current) {
        const cx5m = layer.fivePtCenterX ?? 0;
        const cy5m = layer.fivePtCenterY ?? 0;
        const rot5m = layer.fivePtRotation ?? 0;
        const localX5c =
          Math.cos(rot5m) * (clampedPos.x - cx5m) +
          Math.sin(rot5m) * (clampedPos.y - cy5m);
        const localY5c =
          -Math.sin(rot5m) * (clampedPos.x - cx5m) +
          Math.cos(rot5m) * (clampedPos.y - cy5m);
        const aNew5c = Math.max(10, -localY5c);
        const bNew5c = Math.max(10, localX5c);
        upd({ fivePtHandleADist: aNew5c, fivePtHandleBDist: bNew5c });
        scheduleRulerOverlay();
        return true;
      }

      if (ruler5ptHandleCShiftDragRef.current) {
        const cx5m = layer.fivePtCenterX ?? 0;
        const cy5m = layer.fivePtCenterY ?? 0;
        const aD5m = layer.fivePtHandleADist ?? 40;
        const bD5m = layer.fivePtHandleBDist ?? 40;
        const rot5m = layer.fivePtRotation ?? 0;
        const newDist5c = Math.sqrt(
          (clampedPos.x - cx5m) ** 2 + (clampedPos.y - cy5m) ** 2,
        );
        const initDist5c = ruler5ptCInitDistRef.current;
        const scale5c = newDist5c / initDist5c;
        upd({
          fivePtHandleADist: Math.max(10, aD5m * scale5c),
          fivePtHandleBDist: Math.max(10, bD5m * scale5c),
          fivePtRotation: rot5m,
        });
        scheduleRulerOverlay();
        return true;
      }

      if (ruler5ptHandleDDragRef.current) {
        const cx5m = layer.fivePtCenterX ?? 0;
        const cy5m = layer.fivePtCenterY ?? 0;
        const newRot5 = Math.atan2(clampedPos.y - cy5m, clampedPos.x - cx5m);
        upd({ fivePtRotation: newRot5 });
        scheduleRulerOverlay();
        return true;
      }

      return false;
    },
    [makeUpdater, scheduleRulerOverlay, canvasWidthRef, canvasHeightRef],
  );

  // ── handle3pt5ptRulerPointerUp ────────────────────────────────────────────
  const handle3pt5ptRulerPointerUp = useCallback(
    (layer: Layer): boolean => {
      const any3ptExclusive =
        rulerGridDDragRef.current || rulerGridEDragRef.current;
      const any5pt =
        ruler5ptCenterDragRef.current ||
        ruler5ptHandleADragRef.current ||
        ruler5ptHandleBDragRef.current ||
        ruler5ptHandleCDragRef.current ||
        ruler5ptHandleCShiftDragRef.current ||
        ruler5ptHandleDDragRef.current;

      if (!any3ptExclusive && !any5pt) return false;

      // Fix 2: Clamp non-VP position handles to canvas bounds on pointer-up.
      const W = canvasWidthRef.current;
      const H = canvasHeightRef.current;
      const cx = (v: number | undefined) =>
        v !== undefined ? Math.max(0, Math.min(W, v)) : v;
      const cy = (v: number | undefined) =>
        v !== undefined ? Math.max(0, Math.min(H, v)) : v;

      let afterState: Record<string, unknown>;
      let preState: Record<string, unknown> | null = null;

      if (any3ptExclusive) {
        // rulerHandleDX/DY are non-VP position handles — clamp them.
        const clampedDX = cx(layer.rulerHandleDX);
        const clampedDY = cy(layer.rulerHandleDY);
        const needsClamp3pt =
          clampedDX !== layer.rulerHandleDX ||
          clampedDY !== layer.rulerHandleDY;
        if (needsClamp3pt) {
          const patch3pt: Partial<Layer> = {};
          if (clampedDX !== undefined) patch3pt.rulerHandleDX = clampedDX;
          if (clampedDY !== undefined) patch3pt.rulerHandleDY = clampedDY;
          const fn3pt = (l: Layer) =>
            l.id === layer.id ? { ...l, ...patch3pt } : l;
          setLayers((prev) => prev.map(fn3pt));
          layersRef.current = layersRef.current.map(fn3pt);
        }
        const refreshed3pt =
          layersRef.current.find((l) => l.id === layer.id) ?? layer;
        afterState = {
          horizonCenterX: refreshed3pt.horizonCenterX,
          horizonCenterY: refreshed3pt.horizonCenterY,
          horizonAngle: refreshed3pt.horizonAngle ?? 0,
          vp1X: refreshed3pt.vp1X,
          vp1Y: refreshed3pt.vp1Y,
          vp2X: refreshed3pt.vp2X,
          vp2Y: refreshed3pt.vp2Y,
          rulerGridBX: refreshed3pt.rulerGridBX,
          rulerGridBY: refreshed3pt.rulerGridBY,
          rulerVP3Y: refreshed3pt.rulerVP3Y,
          rulerHandleDX: refreshed3pt.rulerHandleDX,
          rulerHandleDY: refreshed3pt.rulerHandleDY,
        };
        preState =
          shared2ptDragRefs.ruler2ptDragPreStateRef.current ?? preState;
      } else {
        // 5pt: fivePtCenterX/Y is a position handle — clamp it.
        const clampedCX5 = cx(layer.fivePtCenterX);
        const clampedCY5 = cy(layer.fivePtCenterY);
        const needsClamp5pt =
          clampedCX5 !== layer.fivePtCenterX ||
          clampedCY5 !== layer.fivePtCenterY;
        if (needsClamp5pt) {
          const patch5pt: Partial<Layer> = {};
          if (clampedCX5 !== undefined) patch5pt.fivePtCenterX = clampedCX5;
          if (clampedCY5 !== undefined) patch5pt.fivePtCenterY = clampedCY5;
          const fn5pt = (l: Layer) =>
            l.id === layer.id ? { ...l, ...patch5pt } : l;
          setLayers((prev) => prev.map(fn5pt));
          layersRef.current = layersRef.current.map(fn5pt);
        }
        const refreshed5pt =
          layersRef.current.find((l) => l.id === layer.id) ?? layer;
        afterState = {
          fivePtCenterX: refreshed5pt.fivePtCenterX,
          fivePtCenterY: refreshed5pt.fivePtCenterY,
          fivePtHandleADist: refreshed5pt.fivePtHandleADist,
          fivePtHandleBDist: refreshed5pt.fivePtHandleBDist,
          fivePtRotation: refreshed5pt.fivePtRotation,
        };
        preState =
          Object.keys(ruler5ptPreStateRef.current).length > 0
            ? ruler5ptPreStateRef.current
            : null;
      }

      if (preState) {
        pushHistory({
          type: "ruler-edit",
          layerId: layer.id,
          before: preState,
          after: afterState,
        });
        rulerEditHistoryDepthRef.current++;
      }

      // Reset 3pt exclusive drag refs
      rulerGridDDragRef.current = false;
      rulerGridEDragRef.current = false;

      // Reset 5pt drag refs
      ruler5ptCenterDragRef.current = false;
      ruler5ptHandleADragRef.current = false;
      ruler5ptHandleBDragRef.current = false;
      ruler5ptHandleCDragRef.current = false;
      ruler5ptHandleCShiftDragRef.current = false;
      ruler5ptHandleDDragRef.current = false;
      ruler5ptPreStateRef.current = {};

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
      shared2ptDragRefs,
    ],
  );

  // ── is3ptExclusiveDragging ────────────────────────────────────────────────
  const is3ptExclusiveDragging = useCallback((): boolean => {
    return rulerGridDDragRef.current || rulerGridEDragRef.current;
  }, []);

  // ── is5ptDragging ─────────────────────────────────────────────────────────
  const is5ptDragging = useCallback((): boolean => {
    return (
      ruler5ptCenterDragRef.current ||
      ruler5ptHandleADragRef.current ||
      ruler5ptHandleBDragRef.current ||
      ruler5ptHandleCDragRef.current ||
      ruler5ptHandleCShiftDragRef.current ||
      ruler5ptHandleDDragRef.current
    );
  }, []);

  // ── Return ────────────────────────────────────────────────────────────────
  return {
    // 3pt exclusive drag refs
    rulerGridDDragRef,
    rulerGridEDragRef,
    // 5pt drag refs
    ruler5ptCenterDragRef,
    ruler5ptHandleADragRef,
    ruler5ptHandleBDragRef,
    ruler5ptHandleCDragRef,
    ruler5ptHandleCShiftDragRef,
    ruler5ptHandleDDragRef,
    ruler5ptPreStateRef,
    ruler5ptCenterOffsetRef,
    ruler5ptCInitDistRef,
    lastSingle5ptFamilyRef,
    lastSingle3ptFamilyRef,
    // Overlay drawing
    draw3ptRulerOverlay,
    draw5ptRulerOverlay,
    // Snap
    get3ptSnapPosition,
    get5ptSnapPosition,
    // Pointer events
    handle3ptRulerPointerDown,
    handle5ptRulerPointerDown,
    handle3ptExclusivePointerMove,
    handle5ptRulerPointerMove,
    handle3pt5ptRulerPointerUp,
    // State queries
    is3ptExclusiveDragging,
    is5ptDragging,
  };
}

export default use3pt5ptPerspectiveRuler;
