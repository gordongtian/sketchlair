/**
 * useLineRuler — Line ruler sub-system hook
 *
 * TODO (Step 1 of 4 — Ruler Extraction Sequence)
 * ------------------------------------------------
 * This file contains ALL line-ruler logic extracted verbatim from
 * PaintingApp.tsx (drawing, snapping, pointer-down/move/up, and
 * setLineSnapMode).
 *
 * WIRING IS A SEPARATE STEP.
 * Do NOT wire this hook into PaintingApp.tsx yet — that is Step 2.
 * This file exists so Step 2 can be a small, targeted edit rather than a
 * large extraction that risks timeout.
 *
 * Refs still declared inside PaintingApp.tsx (until Step 2):
 *   rulerLineP1DragRef, rulerLineP2DragRef, rulerLineMidDragRef,
 *   rulerLineMidOffsetRef, rulerLineDragPreStateRef
 *
 * Once Step 2 is complete those refs will live here instead.
 */

import { useCallback, useRef } from "react";
import type React from "react";
import type { Layer } from "../components/LayersPanel";
import type { ViewTransform } from "../types";
import type { UndoEntry } from "./useLayerSystem";

// ── Types ─────────────────────────────────────────────────────────────────────

/** Canvas-space 2-D point */
interface Point {
  x: number;
  y: number;
}

/**
 * Stroke snap state refs that live in PaintingApp and are shared with all
 * ruler subtypes.  The line-ruler hook reads/writes them during getSnapPosition
 * but does NOT own them.
 */
export interface LineRulerSnapRefs {
  /** Direction locked at warmup (parallel mode only). */
  strokeSnapDirRef: React.MutableRefObject<{
    cos: number;
    sin: number;
    throughVP: boolean;
  } | null>;
  /** H/V axis lock ("h" | "v" | null). */
  strokeHvAxisRef: React.MutableRefObject<"h" | "v" | null>;
  /** Pivot point for H/V axis lock. */
  strokeHvPivotRef: React.MutableRefObject<Point | null>;
  /** Origin of the current stroke (set on pen-down). */
  strokeSnapOriginRef: React.MutableRefObject<Point | null>;
}

/**
 * Minimum set of refs that useLineRuler needs from PaintingApp.
 * All refs are passed in; the hook owns nothing except its drag refs.
 */
export interface UseLineRulerProps {
  canvasWidthRef: React.MutableRefObject<number>;
  canvasHeightRef: React.MutableRefObject<number>;
  layersRef: React.MutableRefObject<Layer[]>;
  setLayers: React.Dispatch<React.SetStateAction<Layer[]>>;
  /** Push a single undo entry onto the undo stack. */
  pushHistory: (entry: UndoEntry) => void;
  /** Increment after every ruler-edit undo push (same ref used in PaintingApp). */
  rulerEditHistoryDepthRef: React.MutableRefObject<number>;
  /** Schedule a ruler overlay redraw (RAF-debounced). */
  scheduleRulerOverlay: () => void;
  /** Whether the ruler tool is the active tool. */
  activeToolRef: React.MutableRefObject<string>;
  /** Shared snap refs owned by PaintingApp. */
  snapRefs: LineRulerSnapRefs;
  /** View flip state for coordinate conversion. */
  isFlippedRef: React.MutableRefObject<boolean>;
}

/** Return value of useLineRuler. */
export interface LineRulerHandles {
  // ── Drag refs (exposed so PaintingApp can check them in its own guards) ──
  rulerLineP1DragRef: React.MutableRefObject<boolean>;
  rulerLineP2DragRef: React.MutableRefObject<boolean>;
  rulerLineMidDragRef: React.MutableRefObject<boolean>;
  rulerLineDragPreStateRef: React.MutableRefObject<Record<
    string,
    unknown
  > | null>;

  // ── Actions ──────────────────────────────────────────────────────────────
  /**
   * Draw the line ruler overlay onto `ctx`.
   * ctx is in canvas-space (already transformed by the caller).
   */
  drawLineRulerOverlay: (ctx: CanvasRenderingContext2D, layer: Layer) => void;

  /**
   * Returns the snapped canvas-space point for "line" or "parallel" snap
   * modes, or `rawPos` unchanged if the ruler is inactive / has no geometry.
   *
   * @param rawPos   Raw canvas-space cursor position.
   * @param origin   Stroke origin (pen-down position in canvas space).
   */
  getLineSnapPosition: (rawPos: Point, origin: Point) => Point;

  /**
   * Hit-test P1, P2, and midpoint.  Saves undo pre-state and sets the
   * appropriate drag ref.  Creates the initial line if none exists.
   * Returns true if the event was consumed.
   *
   * @param pos          Canvas-space cursor position.
   * @param layer        The ruler layer.
   * @param handleRadius Zoom-adjusted handle hit radius.
   */
  handleLineRulerPointerDown: (
    pos: Point,
    layer: Layer,
    handleRadius: number,
  ) => boolean;

  /**
   * Apply the current drag (P1, P2, or midpoint) to the layer state.
   * Returns true if the event was consumed.
   *
   * @param pos    Canvas-space cursor position.
   * @param layer  Current ruler layer from layersRef.
   */
  handleLineRulerPointerMove: (pos: Point, layer: Layer) => boolean;

  /**
   * Finalise the drag: build afterState, push undo, clear all drag flags.
   * Returns true if the event was consumed (i.e. a line drag was active).
   *
   * @param layer  Current ruler layer from layersRef (post-move).
   */
  handleLineRulerPointerUp: (layer: Layer) => boolean;

  /** True if any line-ruler drag ref is currently active. */
  isLineRulerDragging: () => boolean;

  /**
   * Update the lineSnapMode field on every ruler layer.
   *
   * NOTE: The caller is responsible for also scheduling a ruler overlay
   * redraw after calling this, because useLineRuler does not hold the
   * scheduleRulerOverlay ref (it is passed through the hook but consumed
   * here automatically).
   */
  setLineSnapMode: (mode: "line" | "parallel") => void;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useLineRuler({
  canvasWidthRef,
  canvasHeightRef,
  layersRef,
  setLayers,
  pushHistory,
  rulerEditHistoryDepthRef,
  scheduleRulerOverlay,
  activeToolRef,
  snapRefs,
}: UseLineRulerProps): LineRulerHandles {
  // ── Drag refs (owned by this hook) ───────────────────────────────────────
  const rulerLineP1DragRef = useRef(false);
  const rulerLineP2DragRef = useRef(false);
  const rulerLineMidDragRef = useRef(false);
  const rulerLineMidOffsetRef = useRef<{ dx: number; dy: number }>({
    dx: 0,
    dy: 0,
  });
  const rulerLineDragPreStateRef = useRef<Record<string, unknown> | null>(null);

  // ── drawLineRulerOverlay ─────────────────────────────────────────────────

  const drawLineRulerOverlay = useCallback(
    (ctx: CanvasRenderingContext2D, layer: Layer) => {
      const x1 = layer.lineX1;
      const y1 = layer.lineY1;
      const x2 = layer.lineX2;
      const y2 = layer.lineY2;
      if (
        x1 === undefined ||
        y1 === undefined ||
        x2 === undefined ||
        y2 === undefined
      ) {
        return;
      }

      const color = layer.rulerColor ?? "#9333ea";
      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2;

      // Extend line to canvas edges for visual guidance
      const maxDist =
        Math.max(canvasWidthRef.current, canvasHeightRef.current) * 2;
      const ldx = x2 - x1;
      const ldy = y2 - y1;
      const lineLen = Math.sqrt(ldx * ldx + ldy * ldy);
      if (lineLen > 0) {
        const lc = ldx / lineLen;
        const ls = ldy / lineLen;
        ctx.strokeStyle = color;
        ctx.lineWidth = 0.8;
        ctx.setLineDash([4, 6]);
        ctx.beginPath();
        ctx.moveTo(mx - lc * maxDist, my - ls * maxDist);
        ctx.lineTo(mx + lc * maxDist, my + ls * maxDist);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Draw the actual line segment between endpoints (solid)
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      // Draw endpoint handles
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x1, y1, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x2, y2, 5, 0, Math.PI * 2);
      ctx.fill();

      // Draw midpoint handle (diamond shape) — only when ruler tool is active
      if (activeToolRef.current === "ruler") {
        ctx.save();
        ctx.translate(mx, my);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = "rgba(0,0,0,0.6)";
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        const s = 5;
        ctx.beginPath();
        ctx.rect(-s, -s, s * 2, s * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    },
    [canvasWidthRef, canvasHeightRef, activeToolRef],
  );

  // ── getLineSnapPosition ──────────────────────────────────────────────────

  /**
   * Reproduced verbatim from PaintingApp.tsx lines 4754–4803.
   * The caller is responsible for the surrounding ruler-active / preset-type
   * guards; this function assumes it is only called for a "line" preset ruler.
   */
  const getLineSnapPosition = useCallback(
    (rawPos: Point, origin: Point): Point => {
      const rulerLayer = layersRef.current.find((l) => l.isRuler);
      if (!rulerLayer) return rawPos;

      const x1 = rulerLayer.lineX1;
      const y1 = rulerLayer.lineY1;
      const x2 = rulerLayer.lineX2;
      const y2 = rulerLayer.lineY2;
      if (
        x1 === undefined ||
        y1 === undefined ||
        x2 === undefined ||
        y2 === undefined
      )
        return rawPos;

      const ldx = x2 - x1;
      const ldy = y2 - y1;
      const lineLen = Math.sqrt(ldx * ldx + ldy * ldy);
      if (lineLen < 1) return rawPos;

      const lc = ldx / lineLen;
      const ls = ldy / lineLen;
      const snapMode = rulerLayer.lineSnapMode ?? "line";

      if (snapMode === "line") {
        // Project rawPos onto the ruler line (nearest point on the infinite line
        // through p1–p2).  We use p1 as the anchor so the stroke starts cleanly
        // on the ruler.
        const dpx = rawPos.x - x1;
        const dpy = rawPos.y - y1;
        const proj = dpx * lc + dpy * ls;
        return { x: x1 + lc * proj, y: y1 + ls * proj };
      }

      // Parallel: project onto a line of same direction through origin.
      // Lock direction on first significant move (no warmup needed for parallel
      // — direction is fixed).
      const { strokeSnapDirRef } = snapRefs;
      if (!strokeSnapDirRef.current) {
        const dx = rawPos.x - origin.x;
        const dy = rawPos.y - origin.y;
        if (Math.sqrt(dx * dx + dy * dy) < 4) return origin;
        (
          strokeSnapDirRef as React.MutableRefObject<{
            cos: number;
            sin: number;
            throughVP: boolean;
          } | null>
        ).current = {
          cos: lc,
          sin: ls,
          throughVP: false,
        };
      }
      const dpx = rawPos.x - origin.x;
      const dpy = rawPos.y - origin.y;
      const proj = dpx * lc + dpy * ls;
      return { x: origin.x + lc * proj, y: origin.y + ls * proj };
    },
    [layersRef, snapRefs],
  );

  // ── handleLineRulerPointerDown ───────────────────────────────────────────

  /**
   * Reproduced verbatim from PaintingApp.tsx lines 5995–6057.
   *
   * Hit-tests P1, P2, and midpoint.  If no line exists yet, places the
   * initial line centred on the click position and immediately pushes an
   * undo entry (matching the original behaviour).
   */
  const handleLineRulerPointerDown = useCallback(
    (pos: Point, layer: Layer, handleRadius: number): boolean => {
      const x1 = layer.lineX1;
      const y1 = layer.lineY1;
      const x2 = layer.lineX2;
      const y2 = layer.lineY2;

      const hasLine =
        x1 !== undefined &&
        y1 !== undefined &&
        x2 !== undefined &&
        y2 !== undefined;

      if (!hasLine) {
        // No line placed yet — place initial line centred on click
        const half =
          Math.min(canvasWidthRef.current, canvasHeightRef.current) * 0.15;
        const prevState: Record<string, unknown> = {};
        const newState = {
          lineX1: pos.x - half,
          lineY1: pos.y,
          lineX2: pos.x + half,
          lineY2: pos.y,
        };
        const updated = (l: Layer) =>
          l.id === layer.id ? { ...l, ...newState } : l;
        setLayers((prev) => prev.map(updated));
        layersRef.current = layersRef.current.map(updated);
        pushHistory({
          type: "ruler-edit",
          layerId: layer.id,
          before: prevState,
          after: newState,
        });
        rulerEditHistoryDepthRef.current++;
        scheduleRulerOverlay();
        return true;
      }

      // Line exists — hit-test handles
      const mx = (x1! + x2!) / 2;
      const my = (y1! + y2!) / 2;
      const dP1 = Math.sqrt((pos.x - x1!) ** 2 + (pos.y - y1!) ** 2);
      const dP2 = Math.sqrt((pos.x - x2!) ** 2 + (pos.y - y2!) ** 2);
      const dMid = Math.sqrt((pos.x - mx) ** 2 + (pos.y - my) ** 2);
      const preState: Record<string, unknown> = {
        lineX1: x1,
        lineY1: y1,
        lineX2: x2,
        lineY2: y2,
      };
      if (dP1 <= handleRadius) {
        rulerLineP1DragRef.current = true;
        rulerLineDragPreStateRef.current = preState;
        return true;
      }
      if (dP2 <= handleRadius) {
        rulerLineP2DragRef.current = true;
        rulerLineDragPreStateRef.current = preState;
        return true;
      }
      if (dMid <= handleRadius + 4) {
        rulerLineMidDragRef.current = true;
        rulerLineMidOffsetRef.current = {
          dx: pos.x - mx,
          dy: pos.y - my,
        };
        rulerLineDragPreStateRef.current = preState;
        return true;
      }
      // No handle hit — do nothing; user must use handles
      return false;
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

  // ── handleLineRulerPointerMove ───────────────────────────────────────────

  /**
   * Reproduced verbatim from PaintingApp.tsx lines 7762–7781.
   *
   * Applies the active drag (P1, P2, or midpoint) to the layer state.
   * The caller must supply the current ruler layer from layersRef (after
   * obtaining the canvas-space position for this pointer event).
   */
  const handleLineRulerPointerMove = useCallback(
    (pos: Point, layer: Layer): boolean => {
      if (
        !rulerLineP1DragRef.current &&
        !rulerLineP2DragRef.current &&
        !rulerLineMidDragRef.current
      ) {
        return false;
      }

      const upd = (patch: Partial<Layer>) => {
        const fn = (l: Layer) => (l.id === layer.id ? { ...l, ...patch } : l);
        setLayers((prev) => prev.map(fn));
        layersRef.current = layersRef.current.map(fn);
      };

      if (rulerLineP1DragRef.current) {
        upd({ lineX1: pos.x, lineY1: pos.y });
        return true;
      }
      if (rulerLineP2DragRef.current) {
        upd({ lineX2: pos.x, lineY2: pos.y });
        return true;
      }
      if (rulerLineMidDragRef.current) {
        const off = rulerLineMidOffsetRef.current;
        const x1 = layer.lineX1 ?? 0;
        const y1 = layer.lineY1 ?? 0;
        const x2 = layer.lineX2 ?? 0;
        const y2 = layer.lineY2 ?? 0;
        const lw = x2 - x1;
        const lh = y2 - y1;
        const newMx = pos.x - off.dx;
        const newMy = pos.y - off.dy;
        upd({
          lineX1: newMx - lw / 2,
          lineY1: newMy - lh / 2,
          lineX2: newMx + lw / 2,
          lineY2: newMy + lh / 2,
        });
        return true;
      }
      return false;
    },
    [layersRef, setLayers],
  );

  // ── handleLineRulerPointerUp ─────────────────────────────────────────────

  /**
   * Reproduced verbatim from PaintingApp.tsx lines 9404–9414 / 9479–9502.
   *
   * Builds afterState from the current layer geometry, pushes the undo entry
   * (if a preState was saved), and resets all line-ruler drag flags.
   */
  const handleLineRulerPointerUp = useCallback(
    (layer: Layer): boolean => {
      if (
        !rulerLineP1DragRef.current &&
        !rulerLineP2DragRef.current &&
        !rulerLineMidDragRef.current
      ) {
        return false;
      }

      const afterState: Record<string, unknown> = {
        lineX1: layer.lineX1,
        lineY1: layer.lineY1,
        lineX2: layer.lineX2,
        lineY2: layer.lineY2,
      };

      const preState = rulerLineDragPreStateRef.current;
      if (preState) {
        pushHistory({
          type: "ruler-edit",
          layerId: layer.id,
          before: preState,
          after: afterState,
        });
        rulerEditHistoryDepthRef.current++;
      }

      // Reset all line drag refs
      rulerLineP1DragRef.current = false;
      rulerLineP2DragRef.current = false;
      rulerLineMidDragRef.current = false;
      rulerLineDragPreStateRef.current = null;

      scheduleRulerOverlay();
      return true;
    },
    [pushHistory, rulerEditHistoryDepthRef, scheduleRulerOverlay],
  );

  // ── isLineRulerDragging ──────────────────────────────────────────────────

  const isLineRulerDragging = useCallback((): boolean => {
    return (
      rulerLineP1DragRef.current ||
      rulerLineP2DragRef.current ||
      rulerLineMidDragRef.current
    );
  }, []);

  // ── setLineSnapMode ──────────────────────────────────────────────────────

  /**
   * Reproduced verbatim from PaintingApp.tsx lines 12581–12591.
   *
   * Updates the lineSnapMode field on every ruler layer and schedules an
   * overlay redraw.
   */
  const setLineSnapMode = useCallback(
    (mode: "line" | "parallel") => {
      setLayers((prev) =>
        prev.map((l) => (l.isRuler ? { ...l, lineSnapMode: mode } : l)),
      );
      layersRef.current = layersRef.current.map((l) =>
        l.isRuler ? { ...l, lineSnapMode: mode } : l,
      );
      scheduleRulerOverlay();
    },
    [setLayers, layersRef, scheduleRulerOverlay],
  );

  // ── Return ───────────────────────────────────────────────────────────────

  return {
    rulerLineP1DragRef,
    rulerLineP2DragRef,
    rulerLineMidDragRef,
    rulerLineDragPreStateRef,
    drawLineRulerOverlay,
    getLineSnapPosition,
    handleLineRulerPointerDown,
    handleLineRulerPointerMove,
    handleLineRulerPointerUp,
    isLineRulerDragging,
    setLineSnapMode,
  };
}
