// ============================================================
// RESERVED FOR FUTURE USE
// This ruler hook is not yet wired into PaintingApp event handlers.
// It is intentionally preserved for the upcoming perspective/ellipse
// ruler feature implementation. Do not delete.
// ============================================================

/**
 * use1pt2ptPerspectiveRuler — 1-point and 2-point perspective ruler sub-system hook
 *
 * Step 2 of 4 — Ruler Extraction Sequence
 * ----------------------------------------
 * Contains ALL perspective-1pt and perspective-2pt ruler logic extracted from
 * PaintingApp.tsx: overlay drawing, snap-to-ruler, pointer-down / pointer-move /
 * pointer-up drag handling, and initial-placement logic.
 *
 * WIRING IS A SEPARATE STEP.
 * Do NOT wire this hook into PaintingApp.tsx yet — that comes after steps 3 and 4
 * are also written (3pt/5pt and ellipse/grid).
 *
 * Refs still declared inside PaintingApp.tsx (until the wiring step):
 *   rulerVPDragRef, rulerHorizonDragRef, rulerDragPreStateRef,
 *   rulerVP1DragRef, rulerVP2DragRef,
 *   ruler2ptCenterDragRef, ruler2ptCenterDragOffsetRef,
 *   ruler2ptRotDragRef, ruler2ptRotDragD1Ref, ruler2ptRotDragD2Ref,
 *   ruler2ptFocalLengthSqRef, ruler2ptDragPreStateRef,
 *   rulerGridADragRef, rulerGridBDragRef, rulerGridCDragRef,
 *   lastSingle2ptFamilyRef
 */

import { useCallback, useRef } from "react";
import type React from "react";
import type { Layer } from "../components/LayersPanel";
import type { ViewTransform } from "../types";
import type { UndoEntry } from "./useLayerSystem";

// ── Internal type (suppress unused-import warning) ──────────────────────────
// ViewTransform is exported so PaintingApp can import it from here during wiring.
export type { ViewTransform };

// ── Shared point type ────────────────────────────────────────────────────────
interface Point {
  x: number;
  y: number;
}

// ── Snap refs shared with PaintingApp (not owned by this hook) ───────────────
/**
 * Subset of stroke-snap refs that this hook reads/writes.
 * The same pattern used by useLineRuler for consistency.
 */
export interface Perspective1pt2ptSnapRefs {
  /** Direction locked at warmup for the current stroke. */
  strokeSnapDirRef: React.MutableRefObject<{
    cos: number;
    sin: number;
    throughVP: boolean;
    vpAnchorX?: number;
    vpAnchorY?: number;
  } | null>;
  /** H/V axis lock (not used by perspective rulers, but present for symmetry). */
  strokeHvAxisRef: React.MutableRefObject<"h" | "v" | null>;
  /** H/V pivot (not used by perspective rulers, present for symmetry). */
  strokeHvPivotRef: React.MutableRefObject<Point | null>;
  /** Origin of the current stroke (set on pen-down by PaintingApp). */
  strokeSnapOriginRef: React.MutableRefObject<Point | null>;
}

// ── Props ────────────────────────────────────────────────────────────────────
export interface Use1pt2ptPerspectiveRulerProps {
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
  snapRefs: Perspective1pt2ptSnapRefs;
}

// ── Return type ──────────────────────────────────────────────────────────────
export interface Perspective1pt2ptRulerHandles {
  // ── Drag refs — 1pt ────────────────────────────────────────────────────
  rulerVPDragRef: React.MutableRefObject<boolean>;
  rulerHorizonDragRef: React.MutableRefObject<boolean>;
  rulerDragPreStateRef: React.MutableRefObject<{
    vpX: number;
    vpY: number;
    horizonAngle: number;
    rulerColor: string;
  } | null>;

  // ── Drag refs — 2pt ────────────────────────────────────────────────────
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
  /** Tracks which 2pt VP family was last snapped to for single-VP-enabled mode. */
  lastSingle2ptFamilyRef: React.MutableRefObject<"vp1" | "vp2">;

  // ── Overlay drawing ────────────────────────────────────────────────────
  /** Draw the 1pt perspective ruler overlay onto ctx (already in canvas-space). */
  draw1ptRulerOverlay: (ctx: CanvasRenderingContext2D, layer: Layer) => void;
  /** Draw the 2pt perspective ruler overlay onto ctx (already in canvas-space). */
  draw2ptRulerOverlay: (ctx: CanvasRenderingContext2D, layer: Layer) => void;

  // ── Snap ───────────────────────────────────────────────────────────────
  /** Returns the snapped position for a 1pt perspective ruler stroke. */
  get1ptSnapPosition: (rawPos: Point, origin: Point) => Point;
  /** Returns the snapped position for a 2pt perspective ruler stroke. */
  get2ptSnapPosition: (rawPos: Point, origin: Point) => Point;

  // ── Pointer events ─────────────────────────────────────────────────────
  /**
   * Handle pointer-down for 1pt ruler.
   * @returns true if the event was consumed.
   */
  handle1ptRulerPointerDown: (
    pos: Point,
    layer: Layer,
    handleRadius: number,
  ) => boolean;
  /**
   * Handle pointer-down for 2pt ruler.
   * @returns true if the event was consumed.
   */
  handle2ptRulerPointerDown: (
    pos: Point,
    layer: Layer,
    handleRadius: number,
  ) => boolean;
  /**
   * Handle pointer-move for all active 1pt/2pt drags.
   * @returns true if any drag was active.
   */
  handle1pt2ptRulerPointerMove: (pos: Point, layer: Layer) => boolean;
  /**
   * Handle pointer-up for all active 1pt/2pt drags.
   * Pushes undo entry and clears all drag refs.
   * @returns true if any drag was active.
   */
  handle1pt2ptRulerPointerUp: (layer: Layer) => boolean;

  /** True if any 1pt/2pt drag ref is currently active. */
  is1pt2ptRulerDragging: () => boolean;
}

// ── Hook ─────────────────────────────────────────────────────────────────────
export function use1pt2ptPerspectiveRuler({
  canvasWidthRef,
  canvasHeightRef,
  layersRef,
  setLayers,
  pushHistory,
  rulerEditHistoryDepthRef,
  scheduleRulerOverlay,
  activeToolRef,
  snapRefs,
}: Use1pt2ptPerspectiveRulerProps): Perspective1pt2ptRulerHandles {
  // ── 1pt drag refs ─────────────────────────────────────────────────────────
  const rulerVPDragRef = useRef(false);
  const rulerHorizonDragRef = useRef(false);
  const rulerDragPreStateRef = useRef<{
    vpX: number;
    vpY: number;
    horizonAngle: number;
    rulerColor: string;
  } | null>(null);

  // ── 2pt drag refs ─────────────────────────────────────────────────────────
  const rulerVP1DragRef = useRef(false);
  const rulerVP2DragRef = useRef(false);
  const ruler2ptCenterDragRef = useRef(false);
  const ruler2ptCenterDragOffsetRef = useRef<{ dx: number; dy: number }>({
    dx: 0,
    dy: 0,
  });
  const ruler2ptRotDragRef = useRef(false);
  const ruler2ptRotDragD1Ref = useRef(0);
  const ruler2ptRotDragD2Ref = useRef(0);
  const ruler2ptFocalLengthSqRef = useRef(0);
  const ruler2ptDragPreStateRef = useRef<Record<string, unknown> | null>(null);
  const rulerGridADragRef = useRef(false);
  const rulerGridBDragRef = useRef(false);
  const rulerGridCDragRef = useRef(false);
  const lastSingle2ptFamilyRef = useRef<"vp1" | "vp2">("vp1");

  // ── Shared helper: update layer state in both setLayers and layersRef ──────
  const makeUpdater = useCallback(
    (layerId: string) => (patch: Partial<Layer>) => {
      const fn = (l: Layer) => (l.id === layerId ? { ...l, ...patch } : l);
      setLayers((prev) => prev.map(fn));
      layersRef.current = layersRef.current.map(fn);
    },
    [layersRef, setLayers],
  );

  // ── draw1ptRulerOverlay ────────────────────────────────────────────────────
  const draw1ptRulerOverlay = useCallback(
    (ctx: CanvasRenderingContext2D, layer: Layer) => {
      if (layer.vpX === undefined || layer.vpY === undefined) return;

      const vpX = layer.vpX;
      const vpY = layer.vpY;
      const horizonAngle = layer.horizonAngle ?? 0;
      const hRad = (horizonAngle * Math.PI) / 180;
      const color = layer.rulerColor ?? "#9333ea";
      const maxDist =
        Math.max(canvasWidthRef.current, canvasHeightRef.current) * 2;

      // Draw 24 radial lines from VP
      ctx.strokeStyle = color;
      ctx.lineWidth = 0.8;
      ctx.setLineDash([4, 6]);
      for (let i = 0; i < 24; i++) {
        const angle = (i * 15 * Math.PI) / 180;
        ctx.beginPath();
        ctx.moveTo(vpX, vpY);
        ctx.lineTo(
          vpX + Math.cos(angle) * maxDist,
          vpY + Math.sin(angle) * maxDist,
        );
        ctx.stroke();
      }
      ctx.setLineDash([]);

      // Horizon line (solid, thicker)
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(
        vpX - Math.cos(hRad) * maxDist,
        vpY - Math.sin(hRad) * maxDist,
      );
      ctx.lineTo(
        vpX + Math.cos(hRad) * maxDist,
        vpY + Math.sin(hRad) * maxDist,
      );
      ctx.stroke();

      // Perpendicular-to-horizon line (thinner, dashed)
      const perpRad = hRad + Math.PI / 2;
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(
        vpX - Math.cos(perpRad) * maxDist,
        vpY - Math.sin(perpRad) * maxDist,
      );
      ctx.lineTo(
        vpX + Math.cos(perpRad) * maxDist,
        vpY + Math.sin(perpRad) * maxDist,
      );
      ctx.stroke();
      ctx.setLineDash([]);

      // VP circle
      ctx.fillStyle = color;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(vpX, vpY, 4, 0, Math.PI * 2);
      ctx.fill();

      // Editing handles (only when ruler tool is active)
      if (activeToolRef.current === "ruler") {
        const hHandleX = vpX + Math.cos(hRad) * 40;
        const hHandleY = vpY + Math.sin(hRad) * 40;
        ctx.beginPath();
        ctx.arc(hHandleX, hHandleY, 6, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(0,0,0,0.6)";
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.font = "bold 8px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("H", hHandleX, hHandleY);
      }
    },
    [canvasWidthRef, canvasHeightRef, activeToolRef], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // ── draw2ptRulerOverlay ────────────────────────────────────────────────────
  const draw2ptRulerOverlay = useCallback(
    (ctx: CanvasRenderingContext2D, layer: Layer) => {
      if (
        layer.horizonCenterX === undefined ||
        layer.horizonCenterY === undefined
      ) {
        return;
      }

      const pcX = layer.horizonCenterX;
      const pcY = layer.horizonCenterY;
      const hAngle2 = layer.horizonAngle ?? 0;
      const hRad2 = (hAngle2 * Math.PI) / 180;
      const hDirX = Math.cos(hRad2);
      const hDirY = Math.sin(hRad2);
      const maxDist2 =
        Math.max(canvasWidthRef.current, canvasHeightRef.current) * 2;

      const vp1Color = layer.vp1Color ?? "#ff0000";
      const vp2Color = layer.vp2Color ?? "#0000ff";
      const color = layer.rulerColor ?? "#9333ea";

      const vp1X = layer.vp1X ?? pcX - canvasWidthRef.current * 0.25;
      const vp1Y = layer.vp1Y ?? pcY;
      const vp2X = layer.vp2X ?? pcX + canvasWidthRef.current * 0.25;
      const vp2Y = layer.vp2Y ?? pcY;

      // 24 radial lines from VP1
      ctx.strokeStyle = vp1Color;
      ctx.lineWidth = 0.8;
      ctx.setLineDash([4, 6]);
      if (layer.twoPtEnableVP1 === false) ctx.globalAlpha = 0.25;
      for (let i = 0; i < 24; i++) {
        const angle = (i * 15 * Math.PI) / 180;
        ctx.beginPath();
        ctx.moveTo(vp1X, vp1Y);
        ctx.lineTo(
          vp1X + Math.cos(angle) * maxDist2,
          vp1Y + Math.sin(angle) * maxDist2,
        );
        ctx.stroke();
      }
      ctx.globalAlpha = 1.0;

      // 24 radial lines from VP2
      ctx.strokeStyle = vp2Color;
      if (layer.twoPtEnableVP2 === false) ctx.globalAlpha = 0.25;
      for (let i = 0; i < 24; i++) {
        const angle = (i * 15 * Math.PI) / 180;
        ctx.beginPath();
        ctx.moveTo(vp2X, vp2Y);
        ctx.lineTo(
          vp2X + Math.cos(angle) * maxDist2,
          vp2Y + Math.sin(angle) * maxDist2,
        );
        ctx.stroke();
      }
      ctx.globalAlpha = 1.0;
      ctx.setLineDash([]);

      // Horizon line (solid, thicker)
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(pcX - hDirX * maxDist2, pcY - hDirY * maxDist2);
      ctx.lineTo(pcX + hDirX * maxDist2, pcY + hDirY * maxDist2);
      ctx.stroke();

      // Perpendicular to horizon (dashed)
      const perpRad2 = hRad2 + Math.PI / 2;
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(
        pcX - Math.cos(perpRad2) * maxDist2,
        pcY - Math.sin(perpRad2) * maxDist2,
      );
      ctx.lineTo(
        pcX + Math.cos(perpRad2) * maxDist2,
        pcY + Math.sin(perpRad2) * maxDist2,
      );
      ctx.stroke();
      ctx.setLineDash([]);

      // VP1 circle + label
      ctx.fillStyle = vp1Color;
      ctx.beginPath();
      ctx.arc(vp1X, vp1Y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = "bold 9px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText("VP1", vp1X, vp1Y - 6);

      // VP2 circle + label
      ctx.fillStyle = vp2Color;
      ctx.beginPath();
      ctx.arc(vp2X, vp2Y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.textBaseline = "bottom";
      ctx.fillText("VP2", vp2X, vp2Y - 6);

      // Center handle (P)
      ctx.beginPath();
      ctx.arc(pcX, pcY, 5, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Editing handles (only when ruler tool is active)
      if (activeToolRef.current === "ruler") {
        const hHandleX2 = pcX + hDirX * 40;
        const hHandleY2 = pcY + hDirY * 40;
        ctx.beginPath();
        ctx.arc(hHandleX2, hHandleY2, 6, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(0,0,0,0.6)";
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.font = "bold 8px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("H", hHandleX2, hHandleY2);

        // A, B, C grid handles
        const bXh = layer.rulerGridBX ?? pcX;
        const bYh = layer.rulerGridBY ?? pcY + 120;
        const aXh = vp1X + 0.5 * (bXh - vp1X);
        const aYh = vp1Y + 0.5 * (bYh - vp1Y);
        const cXh = vp2X + 0.5 * (bXh - vp2X);
        const cYh = vp2Y + 0.5 * (bYh - vp2Y);

        ctx.beginPath();
        ctx.arc(aXh, aYh, 5, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(0,0,0,0.6)";
        ctx.fill();
        ctx.strokeStyle = vp1Color;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = vp1Color;
        ctx.font = "bold 8px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("A", aXh, aYh);

        ctx.beginPath();
        ctx.arc(cXh, cYh, 5, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(0,0,0,0.6)";
        ctx.fill();
        ctx.strokeStyle = vp2Color;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = vp2Color;
        ctx.fillText("C", cXh, cYh);

        ctx.beginPath();
        ctx.arc(bXh, bYh, 6, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(0,0,0,0.6)";
        ctx.fill();
        ctx.strokeStyle = vp2Color;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = vp2Color;
        ctx.fillText("B", bXh, bYh);

        // Solid AB (VP1 color) and BC (VP2 color)
        ctx.setLineDash([]);
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = 0.8;
        ctx.strokeStyle = vp1Color;
        ctx.beginPath();
        ctx.moveTo(aXh, aYh);
        ctx.lineTo(bXh, bYh);
        ctx.stroke();
        ctx.strokeStyle = vp2Color;
        ctx.beginPath();
        ctx.moveTo(bXh, bYh);
        ctx.lineTo(cXh, cYh);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // Full-canvas guide lines through VP1→B and VP2→B
      const bXgl = layer.rulerGridBX ?? pcX;
      const bYgl = layer.rulerGridBY ?? pcY + 120;
      ctx.lineWidth = 0.8;
      ctx.setLineDash([4, 6]);

      ctx.strokeStyle = vp1Color;
      const dir1x = bXgl - vp1X;
      const dir1y = bYgl - vp1Y;
      const len1 = Math.sqrt(dir1x * dir1x + dir1y * dir1y);
      if (len1 > 0.1) {
        const nd1x = dir1x / len1;
        const nd1y = dir1y / len1;
        ctx.beginPath();
        ctx.moveTo(vp1X - nd1x * maxDist2, vp1Y - nd1y * maxDist2);
        ctx.lineTo(vp1X + nd1x * maxDist2, vp1Y + nd1y * maxDist2);
        ctx.stroke();
      }

      ctx.strokeStyle = vp2Color;
      const dir2x = bXgl - vp2X;
      const dir2y = bYgl - vp2Y;
      const len2 = Math.sqrt(dir2x * dir2x + dir2y * dir2y);
      if (len2 > 0.1) {
        const nd2x = dir2x / len2;
        const nd2y = dir2y / len2;
        ctx.beginPath();
        ctx.moveTo(vp2X - nd2x * maxDist2, vp2Y - nd2y * maxDist2);
        ctx.lineTo(vp2X + nd2x * maxDist2, vp2Y + nd2y * maxDist2);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    },
    [canvasWidthRef, canvasHeightRef, activeToolRef],
  );

  // ── get1ptSnapPosition ────────────────────────────────────────────────────
  /**
   * Reproduced from PaintingApp.tsx lines 5656–5762.
   * Projects the raw cursor position onto one of three 1pt lines:
   *   • horizon (through VP)
   *   • perpendicular-to-horizon (through VP)
   *   • VP-radial (converges at VP)
   * Direction is locked after the warmup distance and remains fixed for the stroke.
   */
  const get1ptSnapPosition = useCallback(
    (rawPos: Point, origin: Point): Point => {
      const rulerLayer = layersRef.current.find((l) => l.isRuler);
      if (!rulerLayer) return rawPos;
      if (rulerLayer.vpX === undefined || rulerLayer.vpY === undefined) {
        return rawPos;
      }

      const vpX = rulerLayer.vpX;
      const vpY = rulerLayer.vpY;
      const { strokeSnapDirRef } = snapRefs;

      // Normalise angle to [-π, π]
      const norm = (a: number) => {
        let r = a % (Math.PI * 2);
        if (r > Math.PI) r -= Math.PI * 2;
        if (r < -Math.PI) r += Math.PI * 2;
        return r;
      };

      // Direction already locked for this stroke
      if (strokeSnapDirRef.current) {
        const {
          cos: sc,
          sin: ss,
          throughVP,
        } = strokeSnapDirRef.current as {
          cos: number;
          sin: number;
          throughVP: boolean;
        };
        if (throughVP) {
          const dpx = rawPos.x - vpX;
          const dpy = rawPos.y - vpY;
          const proj = dpx * sc + dpy * ss;
          return { x: vpX + sc * proj, y: vpY + ss * proj };
        }
        const dpx = rawPos.x - origin.x;
        const dpy = rawPos.y - origin.y;
        const proj = dpx * sc + dpy * ss;
        return { x: origin.x + sc * proj, y: origin.y + ss * proj };
      }

      // Wait for warmup distance
      const dx = rawPos.x - origin.x;
      const dy = rawPos.y - origin.y;
      const warmupDist = rulerLayer.rulerWarmupDist ?? 10;
      if (Math.sqrt(dx * dx + dy * dy) < warmupDist) return origin;

      const strokeAngle = Math.atan2(dy, dx);
      const horizonAngle = rulerLayer.horizonAngle ?? 0;
      const hRad = (horizonAngle * Math.PI) / 180;

      const dxVP = origin.x - vpX;
      const dyVP = origin.y - vpY;
      const distToVP = Math.sqrt(dxVP * dxVP + dyVP * dyVP);
      const vpRadialAngle = distToVP < 5 ? hRad : Math.atan2(dyVP, dxVP);

      // Candidates: horizon ×2, perpendicular ×2, VP-radial ×2
      const candidates: { angle: number; throughVP: boolean }[] = [
        { angle: hRad, throughVP: false },
        { angle: hRad + Math.PI, throughVP: false },
        { angle: hRad + Math.PI / 2, throughVP: false },
        { angle: hRad - Math.PI / 2, throughVP: false },
        { angle: vpRadialAngle, throughVP: true },
        { angle: vpRadialAngle + Math.PI, throughVP: true },
      ];

      let bestAngle = vpRadialAngle;
      let bestThroughVP = true;
      let bestDiff = Number.POSITIVE_INFINITY;

      for (const c of candidates) {
        const diff = Math.abs(norm(strokeAngle - c.angle));
        if (diff < bestDiff) {
          bestDiff = diff;
          bestAngle = c.angle;
          bestThroughVP = c.throughVP;
        }
      }

      // Lock direction for the rest of this stroke
      (
        strokeSnapDirRef as React.MutableRefObject<{
          cos: number;
          sin: number;
          throughVP: boolean;
        } | null>
      ).current = {
        cos: Math.cos(bestAngle),
        sin: Math.sin(bestAngle),
        throughVP: bestThroughVP,
      };

      const snapped = strokeSnapDirRef.current as unknown as {
        cos: number;
        sin: number;
        throughVP: boolean;
      };
      const { cos: sc, sin: ss, throughVP } = snapped;
      if (throughVP) {
        const dpx = rawPos.x - vpX;
        const dpy = rawPos.y - vpY;
        const proj = dpx * sc + dpy * ss;
        return { x: vpX + sc * proj, y: vpY + ss * proj };
      }
      const dpx = rawPos.x - origin.x;
      const dpy = rawPos.y - origin.y;
      const proj = dpx * sc + dpy * ss;
      return { x: origin.x + sc * proj, y: origin.y + ss * proj };
    },
    [layersRef, snapRefs],
  );

  // ── get2ptSnapPosition ────────────────────────────────────────────────────
  /**
   * Reproduced from PaintingApp.tsx lines 4806–4960.
   * Projects the raw cursor position onto the best-matching 2pt direction:
   *   • vertical (perpendicular to horizon) ×2
   *   • VP1-radial ×2
   *   • VP2-radial ×2
   * Direction is locked after the warmup distance and remains fixed for the stroke.
   */
  const get2ptSnapPosition = useCallback(
    (rawPos: Point, origin: Point): Point => {
      const rulerLayer = layersRef.current.find((l) => l.isRuler);
      if (!rulerLayer) return rawPos;
      if (rulerLayer.horizonCenterX === undefined) return rawPos;

      const pcX2 = rulerLayer.horizonCenterX;
      const pcY2 = rulerLayer.horizonCenterY!;
      const hAngleSnap = rulerLayer.horizonAngle ?? 0;
      const hRadSnap = (hAngleSnap * Math.PI) / 180;
      const snap2vp1X = rulerLayer.vp1X ?? pcX2 - canvasWidthRef.current * 0.25;
      const snap2vp1Y = rulerLayer.vp1Y ?? pcY2;
      const snap2vp2X = rulerLayer.vp2X ?? pcX2 + canvasWidthRef.current * 0.25;
      const snap2vp2Y = rulerLayer.vp2Y ?? pcY2;

      const { strokeSnapDirRef } = snapRefs;

      // Normalise angle to [-π, π]
      const norm2 = (a: number) => {
        let r = a % (Math.PI * 2);
        if (r > Math.PI) r -= Math.PI * 2;
        if (r < -Math.PI) r += Math.PI * 2;
        return r;
      };

      // Direction already locked
      if (strokeSnapDirRef.current) {
        const sd = strokeSnapDirRef.current as unknown as {
          cos: number;
          sin: number;
          throughVP: boolean;
          vpAnchorX: number;
          vpAnchorY: number;
        };
        if (sd.throughVP) {
          const dpx = rawPos.x - sd.vpAnchorX;
          const dpy = rawPos.y - sd.vpAnchorY;
          const proj = dpx * sd.cos + dpy * sd.sin;
          return {
            x: sd.vpAnchorX + sd.cos * proj,
            y: sd.vpAnchorY + sd.sin * proj,
          };
        }
        const dpx = rawPos.x - origin.x;
        const dpy = rawPos.y - origin.y;
        const proj = dpx * sd.cos + dpy * sd.sin;
        return { x: origin.x + sd.cos * proj, y: origin.y + sd.sin * proj };
      }

      const dx2 = rawPos.x - origin.x;
      const dy2 = rawPos.y - origin.y;
      const warmup2 = rulerLayer.rulerWarmupDist ?? 10;
      if (Math.sqrt(dx2 * dx2 + dy2 * dy2) < warmup2) return origin;

      const strokeAngle2 = Math.atan2(dy2, dx2);

      const distVP1 = Math.sqrt(
        (origin.x - snap2vp1X) ** 2 + (origin.y - snap2vp1Y) ** 2,
      );
      const vp1Angle =
        distVP1 < 5
          ? hRadSnap
          : Math.atan2(origin.y - snap2vp1Y, origin.x - snap2vp1X);

      const distVP2 = Math.sqrt(
        (origin.x - snap2vp2X) ** 2 + (origin.y - snap2vp2Y) ** 2,
      );
      const vp2Angle =
        distVP2 < 5
          ? hRadSnap
          : Math.atan2(origin.y - snap2vp2Y, origin.x - snap2vp2X);

      const candidates2: {
        angle: number;
        throughVP: boolean;
        vpAnchorX: number;
        vpAnchorY: number;
      }[] = [
        {
          angle: hRadSnap + Math.PI / 2,
          throughVP: false,
          vpAnchorX: 0,
          vpAnchorY: 0,
        },
        {
          angle: hRadSnap - Math.PI / 2,
          throughVP: false,
          vpAnchorX: 0,
          vpAnchorY: 0,
        },
        {
          angle: vp1Angle,
          throughVP: true,
          vpAnchorX: snap2vp1X,
          vpAnchorY: snap2vp1Y,
        },
        {
          angle: vp1Angle + Math.PI,
          throughVP: true,
          vpAnchorX: snap2vp1X,
          vpAnchorY: snap2vp1Y,
        },
        {
          angle: vp2Angle,
          throughVP: true,
          vpAnchorX: snap2vp2X,
          vpAnchorY: snap2vp2Y,
        },
        {
          angle: vp2Angle + Math.PI,
          throughVP: true,
          vpAnchorX: snap2vp2X,
          vpAnchorY: snap2vp2Y,
        },
      ];

      const enable2ptVP1 = rulerLayer.twoPtEnableVP1 !== false;
      const enable2ptVP2 = rulerLayer.twoPtEnableVP2 !== false;
      const filteredCandidates2 = candidates2.filter((cc) => {
        if (cc.throughVP) {
          if (cc.vpAnchorX === snap2vp1X && cc.vpAnchorY === snap2vp1Y) {
            return enable2ptVP1;
          }
          if (cc.vpAnchorX === snap2vp2X && cc.vpAnchorY === snap2vp2Y) {
            return enable2ptVP2;
          }
        }
        return true;
      });

      if (filteredCandidates2.length === 0) return origin;

      let best2 = filteredCandidates2[0];
      let bestDiff2 = Number.POSITIVE_INFINITY;
      for (const c of filteredCandidates2) {
        const diff = Math.abs(norm2(strokeAngle2 - c.angle));
        if (diff < bestDiff2) {
          bestDiff2 = diff;
          best2 = c;
        }
      }

      // Lock direction
      (strokeSnapDirRef as React.MutableRefObject<unknown>).current = {
        cos: Math.cos(best2.angle),
        sin: Math.sin(best2.angle),
        throughVP: best2.throughVP,
        vpAnchorX: best2.vpAnchorX,
        vpAnchorY: best2.vpAnchorY,
      };

      if (best2.throughVP) {
        const dpx = rawPos.x - best2.vpAnchorX;
        const dpy = rawPos.y - best2.vpAnchorY;
        const proj = dpx * Math.cos(best2.angle) + dpy * Math.sin(best2.angle);
        return {
          x: best2.vpAnchorX + Math.cos(best2.angle) * proj,
          y: best2.vpAnchorY + Math.sin(best2.angle) * proj,
        };
      }
      const dpx = rawPos.x - origin.x;
      const dpy = rawPos.y - origin.y;
      const proj = dpx * Math.cos(best2.angle) + dpy * Math.sin(best2.angle);
      return {
        x: origin.x + Math.cos(best2.angle) * proj,
        y: origin.y + Math.sin(best2.angle) * proj,
      };
    },
    [layersRef, canvasWidthRef, snapRefs],
  );

  // ── handle1ptRulerPointerDown ─────────────────────────────────────────────
  /**
   * Reproduced from PaintingApp.tsx lines 6652–6704.
   * Hit-tests the VP handle and the horizon-rotation handle.
   * If VP not yet placed, places it at the click position.
   */
  const handle1ptRulerPointerDown = useCallback(
    (pos: Point, layer: Layer, handleRadius: number): boolean => {
      const upd = makeUpdater(layer.id);

      if (layer.vpX !== undefined && layer.vpY !== undefined) {
        const vpX = layer.vpX;
        const vpY = layer.vpY;
        const hRad = ((layer.horizonAngle ?? 0) * Math.PI) / 180;
        const hHandleX = vpX + Math.cos(hRad) * 40;
        const hHandleY = vpY + Math.sin(hRad) * 40;
        const dVP = Math.sqrt((pos.x - vpX) ** 2 + (pos.y - vpY) ** 2);
        const dH = Math.sqrt((pos.x - hHandleX) ** 2 + (pos.y - hHandleY) ** 2);

        if (dVP <= handleRadius) {
          rulerVPDragRef.current = true;
          rulerDragPreStateRef.current = {
            vpX: layer.vpX,
            vpY: layer.vpY,
            horizonAngle: layer.horizonAngle ?? 0,
            rulerColor: layer.rulerColor ?? "#9333ea",
          };
          return true;
        }
        if (dH <= handleRadius) {
          rulerHorizonDragRef.current = true;
          rulerDragPreStateRef.current = {
            vpX: layer.vpX,
            vpY: layer.vpY,
            horizonAngle: layer.horizonAngle ?? 0,
            rulerColor: layer.rulerColor ?? "#9333ea",
          };
          return true;
        }
        // No handle hit — user must click a handle
        return false;
      }

      // VP not yet set — place it at the click position
      const newState = {
        vpX: pos.x,
        vpY: pos.y,
        horizonAngle: 0,
        rulerColor: layer.rulerColor ?? "#9333ea",
      };
      upd(newState);
      pushHistory({
        type: "ruler-edit",
        layerId: layer.id,
        before: {},
        after: newState,
      });
      rulerEditHistoryDepthRef.current++;
      scheduleRulerOverlay();
      return true;
    },
    [makeUpdater, pushHistory, rulerEditHistoryDepthRef, scheduleRulerOverlay],
  );

  // ── handle2ptRulerPointerDown ─────────────────────────────────────────────
  /**
   * Reproduced from PaintingApp.tsx lines 6058–6192.
   * Hit-tests VP1, VP2, center P, horizon-rotation handle H, and grid handles A/B/C.
   * If horizon center not yet placed, places it at the click position with symmetric VPs.
   */
  const handle2ptRulerPointerDown = useCallback(
    (pos: Point, layer: Layer, handleRadius: number): boolean => {
      const upd = makeUpdater(layer.id);

      const pcX = layer.horizonCenterX;
      const pcY = layer.horizonCenterY;
      const vp1X = layer.vp1X;
      const vp1Y = layer.vp1Y;
      const vp2X = layer.vp2X;
      const vp2Y = layer.vp2Y;

      if (
        pcX !== undefined &&
        pcY !== undefined &&
        vp1X !== undefined &&
        vp1Y !== undefined &&
        vp2X !== undefined &&
        vp2Y !== undefined
      ) {
        const hRad2pt = ((layer.horizonAngle ?? 0) * Math.PI) / 180;
        const hHandleX2 = pcX + Math.cos(hRad2pt) * 40;
        const hHandleY2 = pcY + Math.sin(hRad2pt) * 40;

        const dVP1 = Math.sqrt((pos.x - vp1X) ** 2 + (pos.y - vp1Y) ** 2);
        const dVP2 = Math.sqrt((pos.x - vp2X) ** 2 + (pos.y - vp2Y) ** 2);
        const dCenter = Math.sqrt((pos.x - pcX) ** 2 + (pos.y - pcY) ** 2);
        const dH2 = Math.sqrt(
          (pos.x - hHandleX2) ** 2 + (pos.y - hHandleY2) ** 2,
        );

        const pre2ptState = {
          horizonCenterX: pcX,
          horizonCenterY: pcY,
          horizonAngle: layer.horizonAngle ?? 0,
          vp1X,
          vp1Y,
          vp2X,
          vp2Y,
          rulerGridBX: layer.rulerGridBX,
          rulerGridBY: layer.rulerGridBY,
        };

        // Signed distance from P to VP along horizon (for focal-length lock)
        const getSignedDist = (vpx: number, vpy: number) => {
          const ddx = vpx - pcX;
          const ddy = vpy - pcY;
          return ddx * Math.cos(hRad2pt) + ddy * Math.sin(hRad2pt);
        };

        // Grid handle positions
        const bX2pt = layer.rulerGridBX ?? pcX;
        const bY2pt = layer.rulerGridBY ?? pcY + 120;
        const aX2pt = vp1X + 0.5 * (bX2pt - vp1X);
        const aY2pt = vp1Y + 0.5 * (bY2pt - vp1Y);
        const cX2pt = vp2X + 0.5 * (bX2pt - vp2X);
        const cY2pt = vp2Y + 0.5 * (bY2pt - vp2Y);

        const dGridA = Math.sqrt((pos.x - aX2pt) ** 2 + (pos.y - aY2pt) ** 2);
        const dGridB = Math.sqrt((pos.x - bX2pt) ** 2 + (pos.y - bY2pt) ** 2);
        const dGridC = Math.sqrt((pos.x - cX2pt) ** 2 + (pos.y - cY2pt) ** 2);

        if (dGridB <= handleRadius) {
          rulerGridBDragRef.current = true;
          ruler2ptDragPreStateRef.current = pre2ptState;
          return true;
        }
        if (dGridA <= handleRadius) {
          rulerGridADragRef.current = true;
          ruler2ptDragPreStateRef.current = pre2ptState;
          const d1 = getSignedDist(vp1X, vp1Y);
          const d2 = getSignedDist(vp2X, vp2Y);
          ruler2ptFocalLengthSqRef.current = Math.abs(d1 * d2);
          return true;
        }
        if (dGridC <= handleRadius) {
          rulerGridCDragRef.current = true;
          ruler2ptDragPreStateRef.current = pre2ptState;
          const d1 = getSignedDist(vp1X, vp1Y);
          const d2 = getSignedDist(vp2X, vp2Y);
          ruler2ptFocalLengthSqRef.current = Math.abs(d1 * d2);
          return true;
        }
        if (dVP1 <= handleRadius) {
          rulerVP1DragRef.current = true;
          ruler2ptDragPreStateRef.current = pre2ptState;
          const d1 = getSignedDist(vp1X, vp1Y);
          const d2 = getSignedDist(vp2X, vp2Y);
          ruler2ptFocalLengthSqRef.current = Math.abs(d1 * d2);
          return true;
        }
        if (dVP2 <= handleRadius) {
          rulerVP2DragRef.current = true;
          ruler2ptDragPreStateRef.current = pre2ptState;
          const d1 = getSignedDist(vp1X, vp1Y);
          const d2 = getSignedDist(vp2X, vp2Y);
          ruler2ptFocalLengthSqRef.current = Math.abs(d1 * d2);
          return true;
        }
        if (dCenter <= handleRadius) {
          ruler2ptCenterDragRef.current = true;
          ruler2ptCenterDragOffsetRef.current = {
            dx: pos.x - pcX,
            dy: pos.y - pcY,
          };
          ruler2ptDragPreStateRef.current = pre2ptState;
          return true;
        }
        if (dH2 <= handleRadius + 2) {
          ruler2ptRotDragRef.current = true;
          ruler2ptDragPreStateRef.current = pre2ptState;
          ruler2ptRotDragD1Ref.current = getSignedDist(vp1X, vp1Y);
          ruler2ptRotDragD2Ref.current = getSignedDist(vp2X, vp2Y);
          return true;
        }
        // No handle hit
        return false;
      }

      // Initial placement: click places horizon center, VPs placed symmetrically
      const spread = canvasWidthRef.current * 0.25;
      const newState = {
        horizonCenterX: pos.x,
        horizonCenterY: pos.y,
        horizonAngle: 0,
        vp1X: pos.x - spread,
        vp1Y: pos.y,
        vp2X: pos.x + spread,
        vp2Y: pos.y,
        rulerGridBX: pos.x,
        rulerGridBY: pos.y + 120,
      };
      upd(newState);
      pushHistory({
        type: "ruler-edit",
        layerId: layer.id,
        before: {},
        after: newState,
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
    ],
  );

  // ── handle1pt2ptRulerPointerMove ──────────────────────────────────────────
  /**
   * Reproduced from PaintingApp.tsx lines 7751–8151.
   * Handles all active 1pt and 2pt drag ops:
   *   1pt: VP drag (exempt from canvas clamp — VP), horizon-angle drag (clamp)
   *   2pt: VP1/VP2 drag (exempt — VPs), center translate (clamp), rotation (clamp),
   *        grid-B translate (clamp), grid-A/C VP drag (clamp)
   * Non-VP handles are clamped to canvas bounds on every move event.
   */
  const handle1pt2ptRulerPointerMove = useCallback(
    (pos: Point, layer: Layer): boolean => {
      if (
        !rulerVPDragRef.current &&
        !rulerHorizonDragRef.current &&
        !rulerVP1DragRef.current &&
        !rulerVP2DragRef.current &&
        !ruler2ptCenterDragRef.current &&
        !ruler2ptRotDragRef.current &&
        !rulerGridADragRef.current &&
        !rulerGridBDragRef.current &&
        !rulerGridCDragRef.current
      ) {
        return false;
      }

      const upd = makeUpdater(layer.id);

      // Canvas-clamped position for non-VP handles
      const cW = canvasWidthRef.current;
      const cH = canvasHeightRef.current;
      const clampedPos: Point = {
        x: Math.max(0, Math.min(cW, pos.x)),
        y: Math.max(0, Math.min(cH, pos.y)),
      };

      // ── 1pt: VP drag — EXEMPT from clamping (vanishing point) ───────────
      if (rulerVPDragRef.current && layer.vpX !== undefined) {
        upd({ vpX: pos.x, vpY: pos.y });
        scheduleRulerOverlay();
        return true;
      }

      // ── 1pt: horizon-angle drag (non-VP handle H — clamp to canvas) ──────
      if (rulerHorizonDragRef.current && layer.vpX !== undefined) {
        const dvx = clampedPos.x - layer.vpX;
        const dvy = clampedPos.y - layer.vpY!;
        let angleDeg = (Math.atan2(dvy, dvx) * 180) / Math.PI;
        angleDeg = Math.round(angleDeg / 5) * 5;
        upd({ horizonAngle: angleDeg });
        scheduleRulerOverlay();
        return true;
      }

      // ── 2pt: VP1 / VP2 drag — EXEMPT from clamping (vanishing points) ───
      if (rulerVP1DragRef.current || rulerVP2DragRef.current) {
        const pcX2d = layer.horizonCenterX ?? 0;
        const pcY2d = layer.horizonCenterY ?? 0;
        const hRad2d = ((layer.horizonAngle ?? 0) * Math.PI) / 180;
        const hcx = Math.cos(hRad2d);
        const hcy = Math.sin(hRad2d);

        // Project drag position onto the horizon line through P (use raw pos — VP is exempt)
        const dpxH = pos.x - pcX2d;
        const dpyH = pos.y - pcY2d;
        const d = dpxH * hcx + dpyH * hcy; // signed distance from P

        const lockFL = layer.lockFocalLength ?? false;
        const fSq = ruler2ptFocalLengthSqRef.current;
        const VP_DEAD_ZONE = 10;

        const enforceVPOrder = (patch: {
          vp1X: number;
          vp1Y: number;
          vp2X: number;
          vp2Y: number;
        }) => {
          const d1 = (patch.vp1X - pcX2d) * hcx + (patch.vp1Y - pcY2d) * hcy;
          const d2 = (patch.vp2X - pcX2d) * hcx + (patch.vp2Y - pcY2d) * hcy;
          if (d1 > d2) {
            return {
              vp1X: patch.vp2X,
              vp1Y: patch.vp2Y,
              vp2X: patch.vp1X,
              vp2Y: patch.vp1Y,
            };
          }
          return patch;
        };

        if (rulerVP1DragRef.current) {
          const clampedD1 = Math.min(d, -VP_DEAD_ZONE);
          if (lockFL && Math.abs(clampedD1) > 1) {
            const d2new = -fSq / clampedD1;
            upd(
              enforceVPOrder({
                vp1X: pcX2d + hcx * clampedD1,
                vp1Y: pcY2d + hcy * clampedD1,
                vp2X: pcX2d + hcx * d2new,
                vp2Y: pcY2d + hcy * d2new,
              }),
            );
          } else {
            const cur2X = layer.vp2X ?? pcX2d + hcx * 200;
            const cur2Y = layer.vp2Y ?? pcY2d + hcy * 200;
            upd(
              enforceVPOrder({
                vp1X: pcX2d + hcx * clampedD1,
                vp1Y: pcY2d + hcy * clampedD1,
                vp2X: cur2X,
                vp2Y: cur2Y,
              }),
            );
          }
        } else {
          const clampedD2 = Math.max(d, VP_DEAD_ZONE);
          if (lockFL && Math.abs(clampedD2) > 1) {
            const d1new = -fSq / clampedD2;
            upd(
              enforceVPOrder({
                vp2X: pcX2d + hcx * clampedD2,
                vp2Y: pcY2d + hcy * clampedD2,
                vp1X: pcX2d + hcx * d1new,
                vp1Y: pcY2d + hcy * d1new,
              }),
            );
          } else {
            const cur1X = layer.vp1X ?? pcX2d - hcx * 200;
            const cur1Y = layer.vp1Y ?? pcY2d - hcy * 200;
            upd(
              enforceVPOrder({
                vp2X: pcX2d + hcx * clampedD2,
                vp2Y: pcY2d + hcy * clampedD2,
                vp1X: cur1X,
                vp1Y: cur1Y,
              }),
            );
          }
        }
        scheduleRulerOverlay();
        return true;
      }

      // ── 2pt: center translate (non-VP — clamp to canvas) ────────────────
      if (ruler2ptCenterDragRef.current) {
        const off2 = ruler2ptCenterDragOffsetRef.current;
        const newPcX = Math.max(0, Math.min(cW, clampedPos.x - off2.dx));
        const newPcY = Math.max(0, Math.min(cH, clampedPos.y - off2.dy));
        const dxShift = newPcX - (layer.horizonCenterX ?? 0);
        const dyShift = newPcY - (layer.horizonCenterY ?? 0);
        upd({
          horizonCenterX: newPcX,
          horizonCenterY: newPcY,
          vp1X: (layer.vp1X ?? 0) + dxShift,
          vp1Y: (layer.vp1Y ?? 0) + dyShift,
          vp2X: (layer.vp2X ?? 0) + dxShift,
          vp2Y: (layer.vp2Y ?? 0) + dyShift,
          rulerGridBX:
            (layer.rulerGridBX ?? layer.horizonCenterX ?? 0) + dxShift,
          rulerGridBY:
            (layer.rulerGridBY ?? (layer.horizonCenterY ?? 0) + 120) + dyShift,
          ...(layer.rulerVP3Y !== undefined
            ? { rulerVP3Y: layer.rulerVP3Y + dyShift }
            : {}),
          ...(layer.rulerHandleDX !== undefined
            ? {
                rulerHandleDX: layer.rulerHandleDX + dxShift,
                rulerHandleDY: (layer.rulerHandleDY ?? 0) + dyShift,
              }
            : {}),
        });
        scheduleRulerOverlay();
        return true;
      }

      // ── 2pt: horizon rotation (non-VP handle H — clamp to canvas) ────────
      if (ruler2ptRotDragRef.current) {
        const pcXr = layer.horizonCenterX ?? 0;
        const pcYr = layer.horizonCenterY ?? 0;
        const dvxr = clampedPos.x - pcXr;
        const dvyr = clampedPos.y - pcYr;
        let newAngleDeg = (Math.atan2(dvyr, dvxr) * 180) / Math.PI;
        newAngleDeg = Math.round(newAngleDeg / 5) * 5;
        const newHRadR = (newAngleDeg * Math.PI) / 180;
        const d1r = ruler2ptRotDragD1Ref.current;
        const d2r = ruler2ptRotDragD2Ref.current;

        // Rotate B around P by the same delta angle
        const preStateRot = ruler2ptDragPreStateRef.current;
        const origBXr =
          (preStateRot?.rulerGridBX as number | undefined) ?? pcXr;
        const origBYr =
          (preStateRot?.rulerGridBY as number | undefined) ?? pcYr + 120;
        const origAngleRad =
          (((preStateRot?.horizonAngle as number | undefined) ?? 0) * Math.PI) /
          180;
        const deltaAngleR = newHRadR - origAngleRad;
        const bRelXr = origBXr - pcXr;
        const bRelYr = origBYr - pcYr;
        const newBXr =
          pcXr +
          bRelXr * Math.cos(deltaAngleR) -
          bRelYr * Math.sin(deltaAngleR);
        const newBYr =
          pcYr +
          bRelXr * Math.sin(deltaAngleR) +
          bRelYr * Math.cos(deltaAngleR);

        // Rotate VP3 and D handle around P if they exist (3pt ruler shares rot logic)
        const origVP3Yr = preStateRot?.rulerVP3Y as number | undefined;
        const origDXr = (preStateRot as Record<string, unknown>)
          ?.rulerHandleDX as number | undefined;
        const origDYr = (preStateRot as Record<string, unknown>)
          ?.rulerHandleDY as number | undefined;
        const dRotPatch: Record<string, number> = {};
        if (origVP3Yr !== undefined) {
          const vp3RelY = origVP3Yr - pcYr;
          dRotPatch.rulerVP3Y = pcYr + vp3RelY * Math.cos(deltaAngleR);
        }
        if (origDXr !== undefined && origDYr !== undefined) {
          const dRelX = origDXr - pcXr;
          const dRelY = origDYr - pcYr;
          dRotPatch.rulerHandleDX =
            pcXr +
            dRelX * Math.cos(deltaAngleR) -
            dRelY * Math.sin(deltaAngleR);
          dRotPatch.rulerHandleDY =
            pcYr +
            dRelX * Math.sin(deltaAngleR) +
            dRelY * Math.cos(deltaAngleR);
        }

        upd({
          horizonAngle: newAngleDeg,
          vp1X: pcXr + Math.cos(newHRadR) * d1r,
          vp1Y: pcYr + Math.sin(newHRadR) * d1r,
          vp2X: pcXr + Math.cos(newHRadR) * d2r,
          vp2Y: pcYr + Math.sin(newHRadR) * d2r,
          rulerGridBX: newBXr,
          rulerGridBY: newBYr,
          ...dRotPatch,
        });
        scheduleRulerOverlay();
        return true;
      }

      // ── 2pt: grid-B translate (non-VP — clamp to canvas) ────────────────
      if (rulerGridBDragRef.current) {
        upd({ rulerGridBX: clampedPos.x, rulerGridBY: clampedPos.y });
        scheduleRulerOverlay();
        return true;
      }

      // ── 2pt: grid-A or grid-C (moves VP1 or VP2 indirectly via A/C position)
      // A and C handles are non-VP, clamped. VP positions are computed from them.
      if (rulerGridADragRef.current || rulerGridCDragRef.current) {
        const pcX2d = layer.horizonCenterX ?? 0;
        const pcY2d = layer.horizonCenterY ?? 0;
        const hRad2d = ((layer.horizonAngle ?? 0) * Math.PI) / 180;
        const hcx = Math.cos(hRad2d);
        const hcy = Math.sin(hRad2d);
        const bGX2 = layer.rulerGridBX ?? pcX2d;
        const bGY2 = layer.rulerGridBY ?? pcY2d + 120;
        const VP_DEAD_ZONE_G = 10;
        const lockFLg = layer.lockFocalLength ?? false;
        const fSqg = ruler2ptFocalLengthSqRef.current;

        const enforceVPOrderG = (patch: {
          vp1X: number;
          vp1Y: number;
          vp2X: number;
          vp2Y: number;
        }) => {
          const d1g = (patch.vp1X - pcX2d) * hcx + (patch.vp1Y - pcY2d) * hcy;
          const d2g = (patch.vp2X - pcX2d) * hcx + (patch.vp2Y - pcY2d) * hcy;
          if (d1g > d2g) {
            return {
              vp1X: patch.vp2X,
              vp1Y: patch.vp2Y,
              vp2X: patch.vp1X,
              vp2Y: patch.vp1Y,
            };
          }
          return patch;
        };

        if (rulerGridADragRef.current) {
          // A moves VP1: new VP1 = 2*clampedPos - B, projected onto horizon
          const newVP1x = 2 * clampedPos.x - bGX2;
          const newVP1y = 2 * clampedPos.y - bGY2;
          const dpx1 = newVP1x - pcX2d;
          const dpy1 = newVP1y - pcY2d;
          const proj1 = dpx1 * hcx + dpy1 * hcy;
          const clampedD1 = Math.min(proj1, -VP_DEAD_ZONE_G);
          if (lockFLg && Math.abs(clampedD1) > 1) {
            const d2new = -fSqg / clampedD1;
            upd(
              enforceVPOrderG({
                vp1X: pcX2d + hcx * clampedD1,
                vp1Y: pcY2d + hcy * clampedD1,
                vp2X: pcX2d + hcx * d2new,
                vp2Y: pcY2d + hcy * d2new,
              }),
            );
          } else {
            const cur2X = layer.vp2X ?? pcX2d + hcx * 200;
            const cur2Y = layer.vp2Y ?? pcY2d + hcy * 200;
            upd(
              enforceVPOrderG({
                vp1X: pcX2d + hcx * clampedD1,
                vp1Y: pcY2d + hcy * clampedD1,
                vp2X: cur2X,
                vp2Y: cur2Y,
              }),
            );
          }
        } else {
          // C moves VP2: new VP2 = 2*clampedPos - B, projected onto horizon
          const newVP2x = 2 * clampedPos.x - bGX2;
          const newVP2y = 2 * clampedPos.y - bGY2;
          const dpx2 = newVP2x - pcX2d;
          const dpy2 = newVP2y - pcY2d;
          const proj2 = dpx2 * hcx + dpy2 * hcy;
          const clampedD2 = Math.max(proj2, VP_DEAD_ZONE_G);
          if (lockFLg && Math.abs(clampedD2) > 1) {
            const d1new = -fSqg / clampedD2;
            upd(
              enforceVPOrderG({
                vp2X: pcX2d + hcx * clampedD2,
                vp2Y: pcY2d + hcy * clampedD2,
                vp1X: pcX2d + hcx * d1new,
                vp1Y: pcY2d + hcy * d1new,
              }),
            );
          } else {
            const cur1X = layer.vp1X ?? pcX2d - hcx * 200;
            const cur1Y = layer.vp1Y ?? pcY2d - hcy * 200;
            upd(
              enforceVPOrderG({
                vp2X: pcX2d + hcx * clampedD2,
                vp2Y: pcY2d + hcy * clampedD2,
                vp1X: cur1X,
                vp1Y: cur1Y,
              }),
            );
          }
        }
        scheduleRulerOverlay();
        return true;
      }

      return false;
    },
    [makeUpdater, scheduleRulerOverlay, canvasWidthRef, canvasHeightRef],
  );

  // ── handle1pt2ptRulerPointerUp ────────────────────────────────────────────
  /**
   * Reproduced from PaintingApp.tsx lines 9371–9532 (1pt/2pt branches only).
   * Builds afterState, pushes undo entry (if a preState was saved), and
   * resets all 1pt/2pt drag flags.
   */
  const handle1pt2ptRulerPointerUp = useCallback(
    (layer: Layer): boolean => {
      const any1pt = rulerVPDragRef.current || rulerHorizonDragRef.current;
      const any2pt =
        rulerVP1DragRef.current ||
        rulerVP2DragRef.current ||
        ruler2ptCenterDragRef.current ||
        ruler2ptRotDragRef.current ||
        rulerGridADragRef.current ||
        rulerGridBDragRef.current ||
        rulerGridCDragRef.current;

      if (!any1pt && !any2pt) return false;

      // Fix 2: Clamp non-VP position handles to canvas bounds on pointer-up.
      const W = canvasWidthRef.current;
      const H = canvasHeightRef.current;
      const cx = (v: number | undefined) =>
        v !== undefined ? Math.max(0, Math.min(W, v)) : v;
      const cy = (v: number | undefined) =>
        v !== undefined ? Math.max(0, Math.min(H, v)) : v;

      let afterState: Record<string, unknown>;

      if (any2pt) {
        // Clamp non-VP 2pt handles: center P and grid B.
        // VP1/VP2 are vanishing points — exempt from clamping.
        const clampedCenterX =
          ruler2ptCenterDragRef.current ||
          rulerGridADragRef.current ||
          rulerGridBDragRef.current ||
          rulerGridCDragRef.current
            ? cx(layer.horizonCenterX)
            : layer.horizonCenterX;
        const clampedCenterY =
          ruler2ptCenterDragRef.current ||
          rulerGridADragRef.current ||
          rulerGridBDragRef.current ||
          rulerGridCDragRef.current
            ? cy(layer.horizonCenterY)
            : layer.horizonCenterY;
        const clampedGridBX =
          layer.rulerGridBX !== undefined
            ? cx(layer.rulerGridBX)
            : layer.rulerGridBX;
        const clampedGridBY =
          layer.rulerGridBY !== undefined
            ? cy(layer.rulerGridBY)
            : layer.rulerGridBY;

        const needsClamp2pt =
          clampedCenterX !== layer.horizonCenterX ||
          clampedCenterY !== layer.horizonCenterY ||
          clampedGridBX !== layer.rulerGridBX ||
          clampedGridBY !== layer.rulerGridBY;

        if (needsClamp2pt) {
          const patch2pt: Partial<Layer> = {};
          if (clampedCenterX !== undefined)
            patch2pt.horizonCenterX = clampedCenterX;
          if (clampedCenterY !== undefined)
            patch2pt.horizonCenterY = clampedCenterY;
          if (clampedGridBX !== undefined) patch2pt.rulerGridBX = clampedGridBX;
          if (clampedGridBY !== undefined) patch2pt.rulerGridBY = clampedGridBY;
          const fn2pt = (l: Layer) =>
            l.id === layer.id ? { ...l, ...patch2pt } : l;
          setLayers((prev) => prev.map(fn2pt));
          layersRef.current = layersRef.current.map(fn2pt);
          // Refresh local layer reference for afterState
          const refreshed2pt =
            layersRef.current.find((l) => l.id === layer.id) ?? layer;
          afterState = {
            horizonCenterX: refreshed2pt.horizonCenterX,
            horizonCenterY: refreshed2pt.horizonCenterY,
            horizonAngle: refreshed2pt.horizonAngle ?? 0,
            vp1X: refreshed2pt.vp1X,
            vp1Y: refreshed2pt.vp1Y,
            vp2X: refreshed2pt.vp2X,
            vp2Y: refreshed2pt.vp2Y,
            rulerGridBX: refreshed2pt.rulerGridBX,
            rulerGridBY: refreshed2pt.rulerGridBY,
            rulerVP3Y: refreshed2pt.rulerVP3Y,
            rulerHandleDX: refreshed2pt.rulerHandleDX,
            rulerHandleDY: refreshed2pt.rulerHandleDY,
          };
        } else {
          afterState = {
            horizonCenterX: layer.horizonCenterX,
            horizonCenterY: layer.horizonCenterY,
            horizonAngle: layer.horizonAngle ?? 0,
            vp1X: layer.vp1X,
            vp1Y: layer.vp1Y,
            vp2X: layer.vp2X,
            vp2Y: layer.vp2Y,
            rulerGridBX: layer.rulerGridBX,
            rulerGridBY: layer.rulerGridBY,
            rulerVP3Y: layer.rulerVP3Y,
            rulerHandleDX: layer.rulerHandleDX,
            rulerHandleDY: layer.rulerHandleDY,
          };
        }
      } else {
        // 1pt: horizonAngle is an angle (not a position), VP is exempt.
        // Nothing to clamp here.
        afterState = {
          vpX: layer.vpX ?? 0,
          vpY: layer.vpY ?? 0,
          horizonAngle: layer.horizonAngle ?? 0,
          rulerColor: layer.rulerColor ?? "#9333ea",
        };
      }

      const preState = any2pt
        ? ruler2ptDragPreStateRef.current
        : rulerDragPreStateRef.current;

      if (preState) {
        pushHistory({
          type: "ruler-edit",
          layerId: layer.id,
          before: preState,
          after: afterState,
        });
        rulerEditHistoryDepthRef.current++;
      }

      // Reset all 1pt/2pt drag flags
      rulerVPDragRef.current = false;
      rulerHorizonDragRef.current = false;
      rulerDragPreStateRef.current = null;
      rulerVP1DragRef.current = false;
      rulerVP2DragRef.current = false;
      ruler2ptCenterDragRef.current = false;
      ruler2ptRotDragRef.current = false;
      rulerGridADragRef.current = false;
      rulerGridBDragRef.current = false;
      rulerGridCDragRef.current = false;
      ruler2ptDragPreStateRef.current = null;

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

  // ── is1pt2ptRulerDragging ─────────────────────────────────────────────────
  const is1pt2ptRulerDragging = useCallback((): boolean => {
    return (
      rulerVPDragRef.current ||
      rulerHorizonDragRef.current ||
      rulerVP1DragRef.current ||
      rulerVP2DragRef.current ||
      ruler2ptCenterDragRef.current ||
      ruler2ptRotDragRef.current ||
      rulerGridADragRef.current ||
      rulerGridBDragRef.current ||
      rulerGridCDragRef.current
    );
  }, []);

  // ── Return ────────────────────────────────────────────────────────────────
  return {
    // 1pt drag refs
    rulerVPDragRef,
    rulerHorizonDragRef,
    rulerDragPreStateRef,
    // 2pt drag refs
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
    lastSingle2ptFamilyRef,
    // Overlay drawing
    draw1ptRulerOverlay,
    draw2ptRulerOverlay,
    // Snap
    get1ptSnapPosition,
    get2ptSnapPosition,
    // Pointer events
    handle1ptRulerPointerDown,
    handle2ptRulerPointerDown,
    handle1pt2ptRulerPointerMove,
    handle1pt2ptRulerPointerUp,
    is1pt2ptRulerDragging,
  };
}
