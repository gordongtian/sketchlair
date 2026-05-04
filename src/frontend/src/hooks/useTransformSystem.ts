import { useCallback, useEffect, useRef } from "react";
import type React from "react";
import type { LassoMode, Tool } from "../components/Toolbar";
import type { XfState } from "../context/PaintingContext";
import type { SelectionGeom } from "../selectionTypes";
import type { ViewTransform } from "../types";
import { inv3x3, solveHomography } from "../utils/homographyWarp";
import { computeMaskBounds } from "../utils/selectionUtils";
import { markCanvasDirty } from "./useCompositing";
import type { UndoEntry } from "./useLayerSystem";

const CANVAS_WIDTH_DEFAULT = 2560;
const CANVAS_HEIGHT_DEFAULT = 1440;

/**
 * Compute the four corner world positions from the current xfState.
 * Applies the full affine: translate(cx,cy) · rotate(rotation) · skew(skewX,skewY) · scale
 * Returns { tl, tr, bl, br } — world positions of top-left, top-right, bottom-left, bottom-right.
 */
export function getTransformCornersWorld(xf: {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  skewX?: number;
  skewY?: number;
}): {
  tl: { x: number; y: number };
  tr: { x: number; y: number };
  bl: { x: number; y: number };
  br: { x: number; y: number };
} {
  const cx = xf.x + xf.w / 2;
  const cy = xf.y + xf.h / 2;
  const rot = xf.rotation;
  const skX = xf.skewX ?? 0;
  const skY = xf.skewY ?? 0;
  const cosR = Math.cos(rot);
  const sinR = Math.sin(rot);
  const tanSkX = Math.tan(skX);
  const tanSkY = Math.tan(skY);

  // Transform a local point (lx, ly) relative to center using rotate then skew.
  // The skew matrix in canvas 2D is applied after rotation:
  //   ctx.rotate(rot) then ctx.transform(1, tanSkY, tanSkX, 1, 0, 0)
  // Combined:  world = rotate then skew
  //   After rotate: rx = lx*cosR - ly*sinR,  ry = lx*sinR + ly*cosR
  //   After skew:   wx = rx + tanSkX*ry,      wy = tanSkY*rx + ry
  function localToWorld(lx: number, ly: number): { x: number; y: number } {
    const rx = lx * cosR - ly * sinR;
    const ry = lx * sinR + ly * cosR;
    return {
      x: cx + rx + tanSkX * ry,
      y: cy + tanSkY * rx + ry,
    };
  }

  const hw = xf.w / 2;
  const hh = xf.h / 2;
  return {
    tl: localToWorld(-hw, -hh),
    tr: localToWorld(hw, -hh),
    bl: localToWorld(-hw, hh),
    br: localToWorld(hw, hh),
  };
}

interface UseTransformSystemParams {
  canvasWidth?: number;
  canvasHeight?: number;
  /** Stable refs that always hold the current canvas dimensions — avoids stale-closure issues
   * when the canvas is resized (e.g. by the crop tool) between renders. Used in extractFloat
   * and commitFloat so the float canvas is always created at the correct size. */
  canvasWidthRef?: React.MutableRefObject<number>;
  canvasHeightRef?: React.MutableRefObject<number>;
  setActiveTool: React.Dispatch<React.SetStateAction<Tool>>;
  setActiveSubpanel: React.Dispatch<React.SetStateAction<Tool | null>>;
  setSelectionActive: React.Dispatch<React.SetStateAction<boolean>>;
  setIsTransformActive: React.Dispatch<React.SetStateAction<boolean>>;
  setIsDraggingFloatState: React.Dispatch<React.SetStateAction<boolean>>;
  setUndoCount: React.Dispatch<React.SetStateAction<number>>;
  setRedoCount: React.Dispatch<React.SetStateAction<number>>;
  // Refs passed directly from PaintingApp (cannot use context — hook is called before provider)
  layerCanvasesRef: React.MutableRefObject<Map<string, HTMLCanvasElement>>;
  activeLayerIdRef: React.MutableRefObject<string>;
  /** Ref to the selected layer ids set — used for multi-layer transform */
  selectedLayerIdsRef?: React.MutableRefObject<Set<string>>;
  /** Ref to the flat layers array — used to expand group selections to leaf layers */
  layersRef?: React.MutableRefObject<
    import("../components/LayersPanel").Layer[]
  >;
  /** Ref to view transform — used to scale hit-test radius with zoom */
  viewTransformRef?: React.MutableRefObject<ViewTransform>;
  undoStackRef: React.MutableRefObject<UndoEntry[]>;
  redoStackRef: React.MutableRefObject<UndoEntry[]>;
  selectionActiveRef: React.MutableRefObject<boolean>;
  selectionMaskRef: React.MutableRefObject<HTMLCanvasElement | null>;
  selectionGeometryRef: React.MutableRefObject<SelectionGeom>;
  selectionShapesRef: React.MutableRefObject<NonNullable<SelectionGeom>[]>;
  selectionBoundaryPathRef: React.MutableRefObject<{
    segments: Array<[number, number, number, number]>;
    chains: Array<Array<[number, number]>>;
    generation: number;
    dirty: boolean;
    lastRebuildMs: number;
  }>;
  compositeRef: React.MutableRefObject<() => void>;
  rebuildChainsNowRef: React.MutableRefObject<
    (mask: HTMLCanvasElement) => void
  >;
  /** Stroke canvas cache key — incremented after commit so the next stroke
   *  rebuilds its below/above canvases instead of reusing the pre-move snapshot. */
  strokeCanvasCacheKeyRef?: React.MutableRefObject<number>;
  /** Called after multi-layer commit to invalidate stale ImageBitmap caches */
  markLayerBitmapDirtyRef?: React.MutableRefObject<(id: string) => void>;
  /** Set populated before any layer canvas pixels are cleared during extractFloat.
   *  The compositing loop skips drawing the raw canvas for layers in this set. */
  layersBeingExtractedRef?: React.MutableRefObject<Set<string>>;
}

export function useTransformSystem({
  canvasWidth = CANVAS_WIDTH_DEFAULT,
  canvasHeight = CANVAS_HEIGHT_DEFAULT,
  canvasWidthRef,
  canvasHeightRef,
  setActiveTool,
  setActiveSubpanel,
  setSelectionActive,
  setIsTransformActive,
  setIsDraggingFloatState,
  setUndoCount,
  setRedoCount,
  layerCanvasesRef,
  activeLayerIdRef,
  layersRef,
  viewTransformRef,
  selectedLayerIdsRef,
  undoStackRef,
  redoStackRef,
  selectionActiveRef,
  selectionMaskRef,
  selectionGeometryRef,
  selectionShapesRef,
  selectionBoundaryPathRef,
  compositeRef,
  rebuildChainsNowRef,
  markLayerBitmapDirtyRef,
  layersBeingExtractedRef,
  strokeCanvasCacheKeyRef,
}: UseTransformSystemParams) {
  // ---- Transform refs ----
  const moveFloatCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const moveFloatOriginBoundsRef = useRef<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);
  const isDraggingFloatRef = useRef(false);
  const floatDragStartRef = useRef<{
    px: number;
    py: number;
    fx: number;
    fy: number;
    origBounds?: { x: number; y: number; w: number; h: number };
    initRotation?: number;
    /** For scale handle drags: the canvas-space pivot point (opposite handle's position at drag start) */
    pivotX?: number;
    pivotY?: number;
    /** Skew values captured at drag start — skew accumulates from these */
    skewXAtDragStart?: number;
    skewYAtDragStart?: number;
    /** For free-corner drag (corner handle + Ctrl): the four corner world positions at drag start */
    dragStartCorners?: {
      tl: { x: number; y: number };
      tr: { x: number; y: number };
      bl: { x: number; y: number };
      br: { x: number; y: number };
    };
  } | null>(null);
  const xfStateRef = useRef<XfState | null>(null);
  const transformPreSnapshotRef = useRef<ImageData | null>(null);
  const transformPreCommitSnapshotRef = useRef<ImageData | null>(null);
  const transformOrigFloatCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const transformActiveRef = useRef(false);
  const transformHandleRef = useRef<string | null>(null);
  const lastToolBeforeTransformRef = useRef<Tool | null>(null);

  /**
   * PER-LAYER FLOAT DESIGN (multi-layer transform):
   *
   * Instead of flattening all layers into a composite, each selected layer gets
   * its OWN float canvas containing ONLY its pixels. During transform preview,
   * the compositing loop renders each float in layer stack order. On commit,
   * each float is written back to its own layer canvas — NO masking, NO cross-layer
   * contamination, NO pixel bleeding.
   *
   * multiFloatCanvasesRef: Map<layerId, floatCanvas> — per-layer float canvases
   * multiLayerPreSnapshotsRef: Map<layerId, ImageData> — pre-extract snapshots (for revert)
   * multiLayerResolvedIdsRef: string[] — ordered list of resolved layer IDs (stack order,
   *   bottom-to-top so index 0 = bottommost in panel order, last = topmost)
   *
   * The shared transform state (xfStateRef, moveFloatOriginBoundsRef) applies to ALL floats.
   * moveFloatCanvasRef is kept for single-layer compat; it is null during multi-layer transforms.
   */
  const multiFloatCanvasesRef = useRef<Map<string, HTMLCanvasElement>>(
    new Map(),
  );
  /** Per-layer pixel snapshots captured BEFORE clearing — used for revert (Escape). */
  const multiLayerPreSnapshotsRef = useRef<Map<string, ImageData>>(new Map());
  /** Ordered array of resolved paintable layer IDs (bottom-to-top in layer stack). */
  const multiLayerResolvedIdsRef = useRef<string[]>([]);

  /**
   * Free-corner mode state — set when user Ctrl+drags a corner handle.
   * Holds the four current corner world positions (one moves, three fixed)
   * and which corner is being dragged. null when not in free-corner mode.
   */
  const freeCornerStateRef = useRef<{
    corners: {
      tl: { x: number; y: number };
      tr: { x: number; y: number };
      bl: { x: number; y: number };
      br: { x: number; y: number };
    };
    draggedCorner: "tl" | "tr" | "bl" | "br";
    /** Original content rectangle (canvas space) before ANY transform this session */
    origRect: { x: number; y: number; w: number; h: number };
  } | null>(null);

  // Actions ref — populated by the useEffect blocks below
  const transformActionsRef = useRef({
    extractFloat: (
      _fromSel: boolean,
      _opts?: { fromToolActivation?: boolean },
    ) => {},
    commitFloat: (_opts?: { keepSelection?: boolean }) => {},
    revertTransform: () => {},
    getTransformHandles: () =>
      null as ReturnType<typeof getTransformHandles> | null,
    hitTestTransformHandle: (_px: number, _py: number): string | null => null,
  });

  /** Push an entry onto the undo stack and clear the redo stack. */
  const pushHistory = useCallback(
    (entry: UndoEntry) => {
      (undoStackRef.current as UndoEntry[]).push(entry);
      if (undoStackRef.current.length > 50) undoStackRef.current.shift();
      redoStackRef.current = [];
      setUndoCount(undoStackRef.current.length);
      setRedoCount(0);
    },
    [undoStackRef, redoStackRef, setUndoCount, setRedoCount],
  );

  /**
   * Resolve selectedLayerIds to a flat list of paintable layer IDs with their canvases.
   *
   * Uses the flat layers array (layersRef) to expand group selections to their
   * constituent paintable layers. Falls back to direct canvas lookup for any IDs
   * not resolved through group expansion.
   *
   * Returns layers in BOTTOM-TO-TOP visual order (index 0 = bottommost in the layer panel,
   * last entry = topmost). This matches the compositing order used by the flat array.
   */
  function _resolveSelectedLayers(): Array<{
    id: string;
    lc: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
  }> {
    const selectedIds = selectedLayerIdsRef?.current ?? new Set<string>();
    const flatLayers = layersRef?.current ?? [];

    const resolvedLayers: Array<{
      id: string;
      lc: HTMLCanvasElement;
      ctx: CanvasRenderingContext2D;
    }> = [];
    const resolvedSet = new Set<string>();

    // Determine whether any selected IDs are group headers (not in layerCanvasesRef)
    const hasGroupInSelection = [...selectedIds].some(
      (id) => !layerCanvasesRef.current.has(id),
    );

    if (hasGroupInSelection && flatLayers.length > 0) {
      // Expand group selections using the flat array: for each group header ID in
      // selectedIds, collect all paintable layers that fall between the group header
      // and its matching end_group marker.
      for (const entry of flatLayers) {
        const entryId = (entry as { id?: string }).id ?? "";
        if (!entryId) continue;
        // Only add paintable layers (not group headers or end_group markers)
        const entryType = (entry as { type?: string }).type;
        if (entryType === "group" || entryType === "end_group") continue;

        // Check if this layer belongs to a selected group or is directly selected
        const isDirectlySelected = selectedIds.has(entryId);
        const isInSelectedGroup = (() => {
          // Walk backwards through flatLayers to find the nearest enclosing group header
          const idx = flatLayers.indexOf(entry);
          let skipDepth = 0;
          for (let i = idx - 1; i >= 0; i--) {
            const e = flatLayers[i] as { type?: string; id?: string };
            if (e.type === "end_group") {
              skipDepth++;
            } else if (e.type === "group") {
              if (skipDepth > 0) {
                skipDepth--;
              } else {
                // This is the nearest enclosing group
                return selectedIds.has(e.id ?? "");
              }
            }
          }
          return false;
        })();

        if (isDirectlySelected || isInSelectedGroup) {
          const lc = layerCanvasesRef.current.get(entryId);
          if (!lc) continue;
          const ctx = lc.getContext("2d", { willReadFrequently: true });
          if (!ctx) continue;
          // Ruler layer guard — silently exclude ruler layers from transform
          if ((entry as { isRuler?: boolean }).isRuler) continue;
          if (!resolvedSet.has(entryId)) {
            resolvedSet.add(entryId);
            resolvedLayers.push({ id: entryId, lc, ctx });
          }
        }
      }
    }

    // Unconditionally cross-check every directly-selected paintable ID — ensures
    // no layer is silently dropped due to a stale layers ref or partial expansion.
    for (const id of selectedIds) {
      if (resolvedSet.has(id)) continue;
      const lc = layerCanvasesRef.current.get(id);
      if (!lc) continue;
      const ctx = lc.getContext("2d", { willReadFrequently: true });
      if (!ctx) continue;
      // Ruler layer guard — silently exclude ruler layers from transform
      const layerEntry = flatLayers.find(
        (l) => (l as { id?: string }).id === id,
      );
      if ((layerEntry as { isRuler?: boolean } | undefined)?.isRuler) continue;
      resolvedSet.add(id);
      resolvedLayers.push({ id, lc, ctx });
    }

    // Final safety net: force-add any directly-selected paintable ID still missing
    {
      const expectedCount = [...selectedIds].filter((id) => {
        if (!layerCanvasesRef.current.has(id)) return false;
        // Exclude ruler layers from the expected count
        const entry = flatLayers.find((l) => (l as { id?: string }).id === id);
        return !(entry as { isRuler?: boolean } | undefined)?.isRuler;
      }).length;
      if (resolvedLayers.length < expectedCount) {
        for (const id of selectedIds) {
          if (resolvedSet.has(id)) continue;
          const lc = layerCanvasesRef.current.get(id);
          if (!lc) continue;
          const ctx = lc.getContext("2d", { willReadFrequently: true });
          if (!ctx) continue;
          // Ruler layer guard
          const entry2 = flatLayers.find(
            (l) => (l as { id?: string }).id === id,
          );
          if ((entry2 as { isRuler?: boolean } | undefined)?.isRuler) continue;
          resolvedSet.add(id);
          resolvedLayers.push({ id, lc, ctx });
        }
      }
    }

    return resolvedLayers;
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: setIsTransformActive is a stable React setter
  const extractFloat = useCallback(
    (fromSelection: boolean, opts?: { fromToolActivation?: boolean }) => {
      const selectedIds = selectedLayerIdsRef?.current ?? new Set<string>();

      // Count the number of paintable layers actually selected
      const paintableSelectedCount = [...selectedIds].filter((id) =>
        layerCanvasesRef.current.has(id),
      ).length;
      // Also check for group IDs (which expand to multiple children)
      const hasGroupInSelection = [...selectedIds].some(
        (id) => !layerCanvasesRef.current.has(id),
      );
      const isMultiLayer =
        paintableSelectedCount > 1 ||
        (hasGroupInSelection && selectedIds.size > 0);

      // ── Multi-layer per-float path ────────────────────────────────────────
      if (isMultiLayer) {
        const resolvedLayers = _resolveSelectedLayers();
        if (resolvedLayers.length === 0) {
          // Fallback to single-layer if resolution fails
          return _extractSingleLayer(fromSelection, opts);
        }

        // Use the active layer to determine canvas size (authoritative post-crop)
        const refLc = layerCanvasesRef.current.get(activeLayerIdRef.current);
        const currentW = refLc?.width ?? canvasWidthRef?.current ?? canvasWidth;
        const currentH =
          refLc?.height ?? canvasHeightRef?.current ?? canvasHeight;

        // Invalidate stale pre-commit snapshot
        transformPreCommitSnapshotRef.current = null;
        // Clear stale boundary data
        selectionBoundaryPathRef.current.chains = [];
        selectionBoundaryPathRef.current.segments = [];
        selectionBoundaryPathRef.current.dirty = true;

        // Step 1 — Capture per-layer pre-snapshots AND create per-layer float canvases.
        // Each float canvas contains ONLY that layer's pixels (or the selection-masked
        // portion of that layer's pixels if fromSelection is true).
        const preSnapshots = new Map<string, ImageData>();
        const perLayerFloats = new Map<string, HTMLCanvasElement>();

        for (const { id: lid, lc, ctx } of resolvedLayers) {
          // Snapshot BEFORE any clearing
          preSnapshots.set(lid, ctx.getImageData(0, 0, lc.width, lc.height));

          // Create a float canvas for this layer containing only its own pixels
          const floatCanvas = document.createElement("canvas");
          floatCanvas.width = currentW;
          floatCanvas.height = currentH;
          const floatCtx = floatCanvas.getContext("2d", {
            willReadFrequently: true,
          })!;

          if (
            fromSelection &&
            selectionActiveRef.current &&
            selectionMaskRef.current
          ) {
            // Draw only the selection-masked portion of this layer
            floatCtx.drawImage(lc, 0, 0);
            floatCtx.globalCompositeOperation = "destination-in";
            floatCtx.drawImage(selectionMaskRef.current, 0, 0);
            floatCtx.globalCompositeOperation = "source-over";
          } else {
            // Copy all pixels from this layer
            floatCtx.drawImage(lc, 0, 0);
          }

          perLayerFloats.set(lid, floatCanvas);
        }

        // Step 2 — Compute tight bounding box from EACH layer independently,
        // then take the UNION. This is the correct bounding box covering all content.
        let bounds: { x: number; y: number; w: number; h: number };

        if (
          fromSelection &&
          selectionActiveRef.current &&
          selectionMaskRef.current
        ) {
          const geom = selectionGeometryRef.current;
          if (
            geom &&
            (geom.type === "rect" || geom.type === "ellipse") &&
            geom.w !== undefined
          ) {
            const x = geom.w < 0 ? geom.x! + geom.w : geom.x!;
            const y = geom.h! < 0 ? geom.y! + geom.h! : geom.y!;
            bounds = { x, y, w: Math.abs(geom.w), h: Math.abs(geom.h!) };
          } else if (geom?.points && geom.points.length > 0) {
            const xs = geom.points.map((pt) => pt.x);
            const ys = geom.points.map((pt) => pt.y);
            bounds = {
              x: Math.min(...xs),
              y: Math.min(...ys),
              w: Math.max(...xs) - Math.min(...xs),
              h: Math.max(...ys) - Math.min(...ys),
            };
          } else {
            const mb = computeMaskBounds(selectionMaskRef.current);
            bounds = mb ?? {
              x: currentW / 2 - 32,
              y: currentH / 2 - 32,
              w: 64,
              h: 64,
            };
          }
        } else {
          // Scan each layer's pixel data independently and take the union of bounds
          let unionMinX = Number.POSITIVE_INFINITY;
          let unionMinY = Number.POSITIVE_INFINITY;
          let unionMaxX = Number.NEGATIVE_INFINITY;
          let unionMaxY = Number.NEGATIVE_INFINITY;
          let anyLayerHasContent = false;

          for (const { lc, ctx } of resolvedLayers) {
            const layerW = lc.width;
            const layerH = lc.height;
            const imgData = ctx.getImageData(0, 0, layerW, layerH);
            const data = imgData.data;
            let layerMinX = Number.POSITIVE_INFINITY;
            let layerMinY = Number.POSITIVE_INFINITY;
            let layerMaxX = Number.NEGATIVE_INFINITY;
            let layerMaxY = Number.NEGATIVE_INFINITY;
            let layerHasContent = false;

            for (let i = 3; i < data.length; i += 4) {
              if (data[i] > 0) {
                const pixelIdx = (i - 3) / 4;
                const px = pixelIdx % layerW;
                const py = Math.floor(pixelIdx / layerW);
                if (px < layerMinX) layerMinX = px;
                if (px + 1 > layerMaxX) layerMaxX = px + 1;
                if (py < layerMinY) layerMinY = py;
                if (py + 1 > layerMaxY) layerMaxY = py + 1;
                layerHasContent = true;
              }
            }

            if (layerHasContent) {
              anyLayerHasContent = true;
              if (layerMinX < unionMinX) unionMinX = layerMinX;
              if (layerMaxX > unionMaxX) unionMaxX = layerMaxX;
              if (layerMinY < unionMinY) unionMinY = layerMinY;
              if (layerMaxY > unionMaxY) unionMaxY = layerMaxY;
            }
          }

          if (
            anyLayerHasContent &&
            unionMaxX > unionMinX &&
            unionMaxY > unionMinY
          ) {
            bounds = {
              x: unionMinX,
              y: unionMinY,
              w: unionMaxX - unionMinX,
              h: unionMaxY - unionMinY,
            };
          } else {
            // All layers empty — skip bounding box when called from tool activation;
            // fall back to a small centered box only when triggered by pointer-down.
            if (opts?.fromToolActivation) return;
            const fallbackSize = Math.min(64, currentW / 4, currentH / 4);
            bounds = {
              x: currentW / 2 - fallbackSize / 2,
              y: currentH / 2 - fallbackSize / 2,
              w: fallbackSize,
              h: fallbackSize,
            };
          }
        }

        // Step 3 — Mark all resolved layers as "being extracted" BEFORE clearing pixels
        // so the compositing loop renders their per-layer floats instead of stale cached bitmaps
        if (layersBeingExtractedRef) {
          layersBeingExtractedRef.current = new Set(
            resolvedLayers.map((r) => r.id),
          );
        }

        // Step 4 — Clear each source layer canvas and invalidate its bitmap cache
        for (const { id: lid, lc, ctx } of resolvedLayers) {
          if (
            fromSelection &&
            selectionActiveRef.current &&
            selectionMaskRef.current
          ) {
            // Only erase the selected pixels
            ctx.save();
            ctx.globalCompositeOperation = "destination-out";
            ctx.drawImage(selectionMaskRef.current, 0, 0);
            ctx.restore();
          } else {
            ctx.clearRect(0, 0, lc.width, lc.height);
          }
          // Invalidate bitmap cache immediately — prevents ghost from stale ImageBitmap
          markLayerBitmapDirtyRef?.current(lid);
        }

        // Step 5 — Store the per-layer float canvases and transform state
        multiLayerPreSnapshotsRef.current = preSnapshots;
        multiLayerResolvedIdsRef.current = resolvedLayers.map((r) => r.id);
        multiFloatCanvasesRef.current = perLayerFloats;

        // moveFloatCanvasRef is null during multi-layer transforms —
        // the compositing loop uses multiFloatCanvasesRef instead.
        moveFloatCanvasRef.current = null;
        moveFloatOriginBoundsRef.current = bounds;
        isDraggingFloatRef.current = true;
        setIsDraggingFloatState(true);
        xfStateRef.current = {
          x: bounds.x,
          y: bounds.y,
          w: bounds.w,
          h: bounds.h,
          rotation: 0,
          skewX: 0,
          skewY: 0,
        };
        transformActiveRef.current = true;
        setIsTransformActive(true);
        transformPreSnapshotRef.current = null; // multi-layer revert uses multiLayerPreSnapshotsRef
        transformOrigFloatCanvasRef.current = null; // not used in per-layer design

        // Fire composite — per-layer floats are now live
        compositeRef.current();

        // Clear the extraction guard after composite has fired
        if (layersBeingExtractedRef) {
          layersBeingExtractedRef.current.clear();
        }
        return;
      }

      // ── Single-layer path (unchanged) ────────────────────────────────────
      _extractSingleLayer(fromSelection, opts);
    },
    [
      compositeRef,
      canvasWidthRef,
      canvasHeightRef,
      activeLayerIdRef,
      layerCanvasesRef,
      layersRef,
      selectedLayerIdsRef,
      selectionActiveRef,
      selectionMaskRef,
      selectionGeometryRef,
      selectionBoundaryPathRef,
      setIsDraggingFloatState,
    ],
  );

  /**
   * Single-layer float extraction — called when only one layer is active.
   * This path is UNCHANGED from the original implementation.
   */
  function _extractSingleLayer(
    fromSelection: boolean,
    opts?: { fromToolActivation?: boolean },
  ) {
    // Clear multi-layer state from any prior session
    multiFloatCanvasesRef.current.clear();
    multiLayerPreSnapshotsRef.current.clear();
    multiLayerResolvedIdsRef.current = [];

    const layerId = activeLayerIdRef.current;
    const lc = layerCanvasesRef.current.get(layerId!);
    if (!lc) return;
    const ctx = lc.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    // Ruler layer guard — silently abort; the transform has no effect on ruler layers
    const activeLayerEntry = layersRef?.current.find(
      (l) => (l as { id?: string }).id === layerId,
    );
    if ((activeLayerEntry as { isRuler?: boolean } | undefined)?.isRuler)
      return;

    const currentW = canvasWidthRef?.current ?? canvasWidth;
    const currentH = canvasHeightRef?.current ?? canvasHeight;

    // Invalidate any stale pre-commit snapshot from a prior session.
    transformPreCommitSnapshotRef.current = null;

    // Clear any stale boundary data from a previous transform session.
    selectionBoundaryPathRef.current.chains = [];
    selectionBoundaryPathRef.current.segments = [];
    selectionBoundaryPathRef.current.dirty = true;

    let bounds = { x: 0, y: 0, w: currentW, h: currentH };

    // Capture snapshot BEFORE any clearing (for transform revert)
    const layerSnapshot = ctx.getImageData(0, 0, lc.width, lc.height);

    const fc = document.createElement("canvas");
    fc.width = currentW;
    fc.height = currentH;
    const fCtx = fc.getContext("2d", { willReadFrequently: true })!;

    if (
      fromSelection &&
      selectionActiveRef.current &&
      selectionMaskRef.current
    ) {
      const geom = selectionGeometryRef.current;
      if (
        geom &&
        (geom.type === "rect" || geom.type === "ellipse") &&
        geom.w !== undefined
      ) {
        const x = geom.w < 0 ? geom.x! + geom.w : geom.x!;
        const y = geom.h! < 0 ? geom.y! + geom.h! : geom.y!;
        bounds = { x, y, w: Math.abs(geom.w), h: Math.abs(geom.h!) };
      } else if (geom?.points && geom.points.length > 0) {
        const xs = geom.points.map((p) => p.x);
        const ys = geom.points.map((p) => p.y);
        bounds = {
          x: Math.min(...xs),
          y: Math.min(...ys),
          w: Math.max(...xs) - Math.min(...xs),
          h: Math.max(...ys) - Math.min(...ys),
        };
      } else if (selectionMaskRef.current) {
        const mb = computeMaskBounds(selectionMaskRef.current);
        if (mb) bounds = mb;
      }
      fCtx.drawImage(lc, 0, 0);
      fCtx.globalCompositeOperation = "destination-in";
      fCtx.drawImage(selectionMaskRef.current, 0, 0);
      fCtx.globalCompositeOperation = "source-over";
      const beforeClear = ctx.getImageData(0, 0, lc.width, lc.height);
      ctx.save();
      ctx.globalCompositeOperation = "destination-out";
      ctx.drawImage(selectionMaskRef.current, 0, 0);
      ctx.restore();
      transformPreCommitSnapshotRef.current = beforeClear;
    } else {
      fCtx.drawImage(lc, 0, 0);
      const beforeClear = ctx.getImageData(0, 0, lc.width, lc.height);
      ctx.clearRect(0, 0, lc.width, lc.height);
      transformPreCommitSnapshotRef.current = beforeClear;

      // Scan pixel data to compute tight content bounds for the single-layer path.
      // Without this scan, bounds defaults to full canvas even when the layer has
      // a small brushstroke in the corner.
      const scanData = beforeClear.data;
      const scanW = beforeClear.width;
      let scanMinX = Number.POSITIVE_INFINITY;
      let scanMinY = Number.POSITIVE_INFINITY;
      let scanMaxX = Number.NEGATIVE_INFINITY;
      let scanMaxY = Number.NEGATIVE_INFINITY;
      let scanHasContent = false;
      for (let i = 3; i < scanData.length; i += 4) {
        if (scanData[i] > 0) {
          const pixelIdx = (i - 3) / 4;
          const px = pixelIdx % scanW;
          const py = Math.floor(pixelIdx / scanW);
          if (px < scanMinX) scanMinX = px;
          if (px + 1 > scanMaxX) scanMaxX = px + 1;
          if (py < scanMinY) scanMinY = py;
          if (py + 1 > scanMaxY) scanMaxY = py + 1;
          scanHasContent = true;
        }
      }
      if (scanHasContent && scanMaxX > scanMinX && scanMaxY > scanMinY) {
        bounds = {
          x: scanMinX,
          y: scanMinY,
          w: scanMaxX - scanMinX,
          h: scanMaxY - scanMinY,
        };
      } else if (opts?.fromToolActivation) {
        // Empty layer and called from tool activation — restore the layer canvas
        // and bail without showing a degenerate bounding box.
        ctx.putImageData(beforeClear, 0, 0);
        return;
      }
      // If no content found and called from pointer-down, fall back to full canvas (bounds already set above).
    }

    moveFloatCanvasRef.current = fc;
    moveFloatOriginBoundsRef.current = bounds;
    isDraggingFloatRef.current = true;
    setIsDraggingFloatState(true);
    xfStateRef.current = {
      x: bounds.x,
      y: bounds.y,
      w: bounds.w,
      h: bounds.h,
      rotation: 0,
      skewX: 0,
      skewY: 0,
    };
    transformActiveRef.current = true;
    setIsTransformActive(true);
    transformPreSnapshotRef.current = layerSnapshot;
    const origCopy = document.createElement("canvas");
    origCopy.width = fc.width;
    origCopy.height = fc.height;
    origCopy
      .getContext("2d", { willReadFrequently: true })!
      .drawImage(fc, 0, 0);
    transformOrigFloatCanvasRef.current = origCopy;
    compositeRef.current();
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: selection refs from hook are stable
  const commitFloat = useCallback(
    (opts?: { keepSelection?: boolean }) => {
      // ── Free-corner homography commit path ───────────────────────────────
      // When the user Ctrl+dragged a corner handle, freeCornerStateRef is set.
      // A standard affine (2×3) cannot represent a general quadrilateral warp —
      // we must use a homography (3×3 perspective matrix) solved from the four
      // point correspondences: original rect corners → current quad corners.
      if (freeCornerStateRef.current) {
        const fcState = freeCornerStateRef.current;
        const fc = moveFloatCanvasRef.current;
        const obCommit = moveFloatOriginBoundsRef.current;
        const origFloat = transformOrigFloatCanvasRef.current || fc;
        if (!fc || !obCommit || !origFloat) {
          freeCornerStateRef.current = null;
          // Fall through to normal path
        } else {
          const layerId = activeLayerIdRef.current;
          const lc = layerCanvasesRef.current.get(layerId!);
          if (!lc) {
            freeCornerStateRef.current = null;
            return;
          }
          const ctx = lc.getContext("2d", { willReadFrequently: true });
          if (!ctx) {
            freeCornerStateRef.current = null;
            return;
          }

          const before =
            transformPreCommitSnapshotRef.current ??
            ctx.getImageData(0, 0, lc.width, lc.height);

          // Source rectangle corners (in the origFloat canvas coordinate space).
          // These are the four corners of the content as it was when extracted.
          const srcX = obCommit.x;
          const srcY = obCommit.y;
          const srcW = obCommit.w;
          const srcH = obCommit.h;
          // Source points: TL, TR, BL, BR of the original content rect
          const src = [
            { x: srcX, y: srcY }, // TL
            { x: srcX + srcW, y: srcY }, // TR
            { x: srcX, y: srcY + srcH }, // BL
            { x: srcX + srcW, y: srcY + srcH }, // BR
          ];
          // Destination points: the four corners in world (canvas) space
          const dst = [
            fcState.corners.tl,
            fcState.corners.tr,
            fcState.corners.bl,
            fcState.corners.br,
          ];

          // Compute destination bounding box
          const dstAllX = dst.map((p) => p.x);
          const dstAllY = dst.map((p) => p.y);
          const dstMinX = Math.floor(Math.min(...dstAllX));
          const dstMinY = Math.floor(Math.min(...dstAllY));
          const dstMaxX = Math.ceil(Math.max(...dstAllX));
          const dstMaxY = Math.ceil(Math.max(...dstAllY));
          const dstW = dstMaxX - dstMinX;
          const dstH = dstMaxY - dstMinY;
          if (dstW <= 0 || dstH <= 0) {
            freeCornerStateRef.current = null;
            return;
          }

          // Solve 3×3 homography H such that H * [src_x, src_y, 1]^T ∝ [dst_x, dst_y, 1]^T
          // Using the Direct Linear Transform (DLT) — shared implementation in homographyWarp.ts
          // so both the preview path (useCompositing) and commit path use identical code.

          const hVec = solveHomography(src, dst);
          if (!hVec) {
            freeCornerStateRef.current = null;
            return;
          }
          // H = [[h00,h01,h02],[h10,h11,h12],[h20,h21,1]]
          const [h00, h01, h02, h10, h11, h12, h20, h21] = hVec;

          // Compute inverse homography H_inv for backward mapping
          // (shared implementation in homographyWarp.ts)
          const hinv = inv3x3([h00, h01, h02, h10, h11, h12, h20, h21, 1]);
          if (!hinv) {
            freeCornerStateRef.current = null;
            return;
          }
          const [i00, i01, i02, i10, i11, i12, i20, i21, i22] = hinv;

          // Read source pixels
          const srcCanvas = origFloat;
          const srcCtx = srcCanvas.getContext("2d", {
            willReadFrequently: true,
          });
          if (!srcCtx) {
            freeCornerStateRef.current = null;
            return;
          }
          const srcData = srcCtx.getImageData(
            0,
            0,
            srcCanvas.width,
            srcCanvas.height,
          );

          // Create destination canvas at the bounding box of the quad
          const destCanvas = document.createElement("canvas");
          destCanvas.width = dstW;
          destCanvas.height = dstH;
          const destCtx = destCanvas.getContext("2d", {
            willReadFrequently: true,
          })!;
          const destData = destCtx.createImageData(dstW, dstH);
          const destPixels = destData.data;
          const srcPixels = srcData.data;
          const sw = srcCanvas.width;
          const sh = srcCanvas.height;

          // Backward mapping: for each dest pixel, compute source pixel via H_inv
          for (let dy = 0; dy < dstH; dy++) {
            for (let dx2 = 0; dx2 < dstW; dx2++) {
              // World coordinates of this destination pixel
              const wx = dx2 + dstMinX;
              const wy = dy + dstMinY;
              // Apply inverse homography
              const wh = i20 * wx + i21 * wy + i22;
              if (Math.abs(wh) < 1e-10) continue;
              const sxRaw = (i00 * wx + i01 * wy + i02) / wh;
              const syRaw = (i10 * wx + i11 * wy + i12) / wh;
              // Bilinear interpolation
              const sxF = Math.floor(sxRaw);
              const syF = Math.floor(syRaw);
              const tx2 = sxRaw - sxF;
              const ty2 = syRaw - syF;
              // Clamp source coordinates to canvas bounds
              if (sxF < 0 || syF < 0 || sxF >= sw || syF >= sh) continue;
              const x1 = Math.min(sxF + 1, sw - 1);
              const y1 = Math.min(syF + 1, sh - 1);
              const i00px = (syF * sw + sxF) * 4;
              const i01px = (syF * sw + x1) * 4;
              const i10px = (y1 * sw + sxF) * 4;
              const i11px = (y1 * sw + x1) * 4;
              const destIdx = (dy * dstW + dx2) * 4;
              for (let ch = 0; ch < 4; ch++) {
                // Bilinear blend
                const val =
                  srcPixels[i00px + ch] * (1 - tx2) * (1 - ty2) +
                  srcPixels[i01px + ch] * tx2 * (1 - ty2) +
                  srcPixels[i10px + ch] * (1 - tx2) * ty2 +
                  srcPixels[i11px + ch] * tx2 * ty2;
                destPixels[destIdx + ch] = Math.round(val);
              }
            }
          }
          destCtx.putImageData(destData, 0, 0);

          // Write result to the layer canvas
          ctx.globalCompositeOperation = "source-over";
          ctx.globalAlpha = 1;
          ctx.drawImage(destCanvas, dstMinX, dstMinY);
          ctx.globalCompositeOperation = "source-over";
          ctx.globalAlpha = 1;

          const after = ctx.getImageData(0, 0, lc.width, lc.height);
          // Compute dirty rect: union of source content area and destination bounding box,
          // clamped to canvas, padded by 4px. Both regions changed (erase + draw).
          const _fcDrPad = 4;
          const _fcUMinX = Math.max(0, Math.min(srcX, dstMinX) - _fcDrPad);
          const _fcUMinY = Math.max(0, Math.min(srcY, dstMinY) - _fcDrPad);
          const _fcUMaxX = Math.min(
            lc.width,
            Math.max(srcX + srcW, dstMaxX) + _fcDrPad,
          );
          const _fcUMaxY = Math.min(
            lc.height,
            Math.max(srcY + srcH, dstMaxY) + _fcDrPad,
          );
          const _fcDrW = _fcUMaxX - _fcUMinX;
          const _fcDrH = _fcUMaxY - _fcUMinY;
          if (
            _fcDrW > 0 &&
            _fcDrH > 0 &&
            _fcDrW * _fcDrH < lc.width * lc.height * 0.5
          ) {
            // Crop before-snapshot to the dirty region
            const _fcTmp = document.createElement("canvas");
            _fcTmp.width = _fcDrW;
            _fcTmp.height = _fcDrH;
            const _fcTmpCtx = _fcTmp.getContext("2d", {
              willReadFrequently: true,
            });
            if (_fcTmpCtx) {
              _fcTmpCtx.putImageData(before, -_fcUMinX, -_fcUMinY);
              const _fcCroppedBefore = _fcTmpCtx.getImageData(
                0,
                0,
                _fcDrW,
                _fcDrH,
              );
              const _fcCroppedAfter = ctx.getImageData(
                _fcUMinX,
                _fcUMinY,
                _fcDrW,
                _fcDrH,
              );
              const _fcDirtyRect = {
                x: _fcUMinX,
                y: _fcUMinY,
                w: _fcDrW,
                h: _fcDrH,
              };
              pushHistory({
                type: "pixels",
                layerId,
                dirtyRect: _fcDirtyRect,
                before: _fcCroppedBefore,
                after: _fcCroppedAfter,
              });
            } else {
              pushHistory({
                type: "pixels",
                layerId,
                dirtyRect: { x: 0, y: 0, w: lc.width, h: lc.height },
                before,
                after,
              });
            }
          } else {
            pushHistory({
              type: "pixels",
              layerId,
              dirtyRect: { x: 0, y: 0, w: lc.width, h: lc.height },
              before,
              after,
            });
          }
          markLayerBitmapDirtyRef?.current(layerId);

          freeCornerStateRef.current = null;
          _updateSelectionAfterCommit(xfStateRef.current, obCommit, opts, lc);
          _cleanupTransformState();
          if (strokeCanvasCacheKeyRef) strokeCanvasCacheKeyRef.current++;
          compositeRef.current();
          markCanvasDirty();
          return;
        }
      }

      // ── Multi-layer per-float commit path ────────────────────────────────
      const isMultiCommit = multiLayerResolvedIdsRef.current.length > 1;
      if (isMultiCommit) {
        const resolvedIds = multiLayerResolvedIdsRef.current;
        const preSnapshots = multiLayerPreSnapshotsRef.current;
        const perLayerFloats = multiFloatCanvasesRef.current;

        const xfCommit = xfStateRef.current;
        const obCommit = moveFloatOriginBoundsRef.current;

        const historyLayers = new Map<
          string,
          { before: ImageData; after: ImageData }
        >();

        for (const lid of resolvedIds) {
          const lc = layerCanvasesRef.current.get(lid);
          if (!lc) continue;
          const ctx = lc.getContext("2d", { willReadFrequently: true });
          if (!ctx) continue;

          const preSnapshot = preSnapshots.get(lid);
          if (!preSnapshot) continue;

          const floatCanvas = perLayerFloats.get(lid);
          if (!floatCanvas) continue;

          // Write this layer's float canvas back to its own source canvas.
          // Since the float contains ONLY this layer's pixels, no masking is needed —
          // simply apply the same transform that was applied during preview.
          //
          // LASSO COMMIT FIX: Explicitly reset composite operation and alpha before
          // every write-back. The layer canvas context is persistent and may retain
          // "destination-out" or "destination-in" from the extraction-phase clearing
          // step (which uses save/restore, but the base state could be dirty from a
          // prior operation). Without this reset, drawImage would erase instead of draw.
          ctx.globalCompositeOperation = "source-over";
          ctx.globalAlpha = 1;
          if (xfCommit && obCommit) {
            const cx = xfCommit.x + xfCommit.w / 2;
            const cy = xfCommit.y + xfCommit.h / 2;
            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate(xfCommit.rotation);
            // Apply skew in the rotated coordinate frame
            const skX = xfCommit.skewX ?? 0;
            const skY = xfCommit.skewY ?? 0;
            if (skX !== 0 || skY !== 0) {
              ctx.transform(1, Math.tan(skY), Math.tan(skX), 1, 0, 0);
            }
            ctx.drawImage(
              floatCanvas,
              obCommit.x,
              obCommit.y,
              obCommit.w,
              obCommit.h,
              -xfCommit.w / 2,
              -xfCommit.h / 2,
              xfCommit.w,
              xfCommit.h,
            );
            ctx.restore();
          } else if (xfCommit) {
            // Translation only (no scale/rotate) — use putImageData-style positioning
            ctx.drawImage(
              floatCanvas,
              xfCommit.x - (obCommit?.x ?? 0),
              xfCommit.y - (obCommit?.y ?? 0),
            );
          } else {
            // Identity transform — write float back at its original position
            ctx.drawImage(floatCanvas, 0, 0);
          }
          // Ensure context is clean after the write-back — leave no composite state
          // that could affect subsequent operations (e.g. thumbnail generation).
          ctx.globalCompositeOperation = "source-over";
          ctx.globalAlpha = 1;

          // Capture after-state for history
          const after = ctx.getImageData(0, 0, lc.width, lc.height);
          historyLayers.set(lid, { before: preSnapshot, after });

          // Invalidate stale bitmap cache
          markLayerBitmapDirtyRef?.current(lid);

          // Discard the per-layer float canvas to free memory
          floatCanvas.width = 0;
          floatCanvas.height = 0;
        }

        // Push ONE atomic history entry covering ALL layers
        pushHistory({ type: "multi-layer-pixels", layers: historyLayers });

        // Update selection mask geometry
        _updateSelectionAfterCommit(
          xfCommit,
          obCommit,
          opts,
          layerCanvasesRef.current.get(activeLayerIdRef.current) ?? null,
        );

        // Clear stale transform state BEFORE composite so no RAF or async path
        // can read the old pre-move bounds from xfStateRef (Symptom 2 fix).
        _cleanupTransformState();
        // Invalidate stroke canvas cache so the next stroke rebuilds its
        // below/above canvases instead of reusing the pre-move snapshot (Fix 4).
        if (strokeCanvasCacheKeyRef) strokeCanvasCacheKeyRef.current++;
        compositeRef.current();
        markCanvasDirty();
        return;
      }

      // ── Single-layer commit path (unchanged) ─────────────────────────────
      const fc = moveFloatCanvasRef.current;
      if (!fc) return;

      const xfCommit = xfStateRef.current;
      const obCommit = moveFloatOriginBoundsRef.current;
      const origFloatCommit = transformOrigFloatCanvasRef.current || fc;

      const layerId = activeLayerIdRef.current;
      const lc = layerCanvasesRef.current.get(layerId!);
      if (!lc) return;
      const ctx = lc.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;

      const before =
        transformPreCommitSnapshotRef.current ??
        ctx.getImageData(0, 0, lc.width, lc.height);

      // LASSO COMMIT FIX: Explicitly reset composite operation and alpha before
      // the write-back. The layer canvas context is persistent and may retain
      // "destination-out" or "destination-in" from the extraction-phase clearing
      // step (which uses save/restore, but the base state could be dirty from a
      // prior operation). Without this reset, drawImage would erase instead of draw.
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
      if (xfCommit && obCommit) {
        const cx = xfCommit.x + xfCommit.w / 2;
        const cy = xfCommit.y + xfCommit.h / 2;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(xfCommit.rotation);
        // Apply skew in the rotated coordinate frame
        const skXSingle = xfCommit.skewX ?? 0;
        const skYSingle = xfCommit.skewY ?? 0;
        if (skXSingle !== 0 || skYSingle !== 0) {
          ctx.transform(1, Math.tan(skYSingle), Math.tan(skXSingle), 1, 0, 0);
        }
        ctx.drawImage(
          origFloatCommit,
          obCommit.x,
          obCommit.y,
          obCommit.w,
          obCommit.h,
          -xfCommit.w / 2,
          -xfCommit.h / 2,
          xfCommit.w,
          xfCommit.h,
        );
        ctx.restore();
      } else if (xfCommit) {
        ctx.drawImage(fc, xfCommit.x, xfCommit.y);
      } else {
        ctx.drawImage(fc, 0, 0);
      }
      // Ensure context is clean after the write-back — leave no composite state
      // that could affect subsequent operations (e.g. thumbnail generation).
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
      const after = ctx.getImageData(0, 0, lc.width, lc.height);
      // Compute dirty rect: union of original content area (obCommit) and destination
      // area (xfCommit), padded and clamped to canvas. Both regions change.
      const _xfObX = obCommit?.x ?? 0;
      const _xfObY = obCommit?.y ?? 0;
      const _xfObW = obCommit?.w ?? lc.width;
      const _xfObH = obCommit?.h ?? lc.height;
      const _xfDstX = xfCommit?.x ?? 0;
      const _xfDstY = xfCommit?.y ?? 0;
      const _xfDstW = xfCommit?.w ?? lc.width;
      const _xfDstH = xfCommit?.h ?? lc.height;
      const _xfPad = 4;
      const _xfUMinX = Math.max(0, Math.min(_xfObX, _xfDstX) - _xfPad);
      const _xfUMinY = Math.max(0, Math.min(_xfObY, _xfDstY) - _xfPad);
      const _xfUMaxX = Math.min(
        lc.width,
        Math.max(_xfObX + _xfObW, _xfDstX + _xfDstW) + _xfPad,
      );
      const _xfUMaxY = Math.min(
        lc.height,
        Math.max(_xfObY + _xfObH, _xfDstY + _xfDstH) + _xfPad,
      );
      const _xfDrW = _xfUMaxX - _xfUMinX;
      const _xfDrH = _xfUMaxY - _xfUMinY;
      if (
        _xfDrW > 0 &&
        _xfDrH > 0 &&
        _xfDrW * _xfDrH < lc.width * lc.height * 0.5
      ) {
        const _xfTmp = document.createElement("canvas");
        _xfTmp.width = _xfDrW;
        _xfTmp.height = _xfDrH;
        const _xfTmpCtx = _xfTmp.getContext("2d", { willReadFrequently: true });
        if (_xfTmpCtx) {
          _xfTmpCtx.putImageData(before, -_xfUMinX, -_xfUMinY);
          const _xfCroppedBefore = _xfTmpCtx.getImageData(0, 0, _xfDrW, _xfDrH);
          const _xfCroppedAfter = ctx.getImageData(
            _xfUMinX,
            _xfUMinY,
            _xfDrW,
            _xfDrH,
          );
          const _xfDirtyRect = {
            x: _xfUMinX,
            y: _xfUMinY,
            w: _xfDrW,
            h: _xfDrH,
          };
          pushHistory({
            type: "pixels",
            layerId,
            dirtyRect: _xfDirtyRect,
            before: _xfCroppedBefore,
            after: _xfCroppedAfter,
          });
        } else {
          pushHistory({
            type: "pixels",
            layerId,
            dirtyRect: { x: 0, y: 0, w: lc.width, h: lc.height },
            before,
            after,
          });
        }
      } else {
        pushHistory({
          type: "pixels",
          layerId,
          dirtyRect: { x: 0, y: 0, w: lc.width, h: lc.height },
          before,
          after,
        });
      }
      markLayerBitmapDirtyRef?.current(layerId);

      _updateSelectionAfterCommit(xfCommit, obCommit, opts, lc);
      // Clear stale transform state BEFORE composite so no RAF or async path
      // can read the old pre-move bounds from xfStateRef (Symptom 2 fix).
      _cleanupTransformState();
      // Invalidate stroke canvas cache so the next stroke rebuilds its
      // below/above canvases instead of reusing the pre-move snapshot (Fix 4).
      if (strokeCanvasCacheKeyRef) strokeCanvasCacheKeyRef.current++;
      compositeRef.current();
      markCanvasDirty();
    },
    [compositeRef, pushHistory, setIsDraggingFloatState, setIsTransformActive],
  );

  /**
   * Shared helper: update selection geometry/mask to reflect the committed
   * transform, then either clear or keep the selection per opts.
   */
  function _updateSelectionAfterCommit(
    xfCommit: {
      x: number;
      y: number;
      w: number;
      h: number;
      rotation: number;
    } | null,
    obCommit: { x: number; y: number; w: number; h: number } | null,
    opts: { keepSelection?: boolean } | undefined,
    lcForMask: HTMLCanvasElement | null,
  ) {
    const geom = selectionGeometryRef.current;
    if (geom && xfCommit && obCommit) {
      const rot = xfCommit.rotation;
      const newCx = xfCommit.x + xfCommit.w / 2;
      const newCy = xfCommit.y + xfCommit.h / 2;
      const cosR = Math.cos(rot);
      const sinR = Math.sin(rot);
      const rotPt = (px: number, py: number) => {
        const dx = px - newCx;
        const dy = py - newCy;
        return {
          x: newCx + dx * cosR - dy * sinR,
          y: newCy + dx * sinR + dy * cosR,
        };
      };
      if (geom.type === "rect" || geom.type === "ellipse") {
        if (Math.abs(rot) > 0.001) {
          const hw = xfCommit.w / 2;
          const hh = xfCommit.h / 2;
          const corners = [
            rotPt(newCx - hw, newCy - hh),
            rotPt(newCx + hw, newCy - hh),
            rotPt(newCx + hw, newCy + hh),
            rotPt(newCx - hw, newCy + hh),
          ];
          (
            geom as {
              type: string;
              points?: { x: number; y: number }[];
              x?: number;
              y?: number;
              w?: number;
              h?: number;
            }
          ).type = "poly";
          geom.points = corners;
          geom.x = undefined;
          geom.y = undefined;
          geom.w = undefined;
          geom.h = undefined;
        } else {
          geom.x = xfCommit.x;
          geom.y = xfCommit.y;
          geom.w = xfCommit.w;
          geom.h = xfCommit.h;
        }
      } else if (geom.points && geom.points.length > 0) {
        const origCx = obCommit.x + obCommit.w / 2;
        const origCy = obCommit.y + obCommit.h / 2;
        const scaleX = obCommit.w > 0 ? xfCommit.w / obCommit.w : 1;
        const scaleY = obCommit.h > 0 ? xfCommit.h / obCommit.h : 1;
        const transDx = newCx - origCx;
        const transDy = newCy - origCy;
        geom.points = geom.points.map((p) => {
          const sx = origCx + (p.x - origCx) * scaleX;
          const sy = origCy + (p.y - origCy) * scaleY;
          const tx = sx + transDx;
          const ty = sy + transDy;
          return rotPt(tx, ty);
        });
      }
      if (selectionMaskRef.current && lcForMask) {
        const newMask = document.createElement("canvas");
        newMask.width = lcForMask.width;
        newMask.height = lcForMask.height;
        const newMaskCtx = newMask.getContext("2d", {
          willReadFrequently: true,
        })!;
        const origMask = selectionMaskRef.current;
        const mcx = xfCommit.x + xfCommit.w / 2;
        const mcy = xfCommit.y + xfCommit.h / 2;
        newMaskCtx.save();
        newMaskCtx.translate(mcx, mcy);
        newMaskCtx.rotate(xfCommit.rotation);
        if (obCommit.w > 0 && obCommit.h > 0) {
          newMaskCtx.drawImage(
            origMask,
            obCommit.x,
            obCommit.y,
            obCommit.w,
            obCommit.h,
            -xfCommit.w / 2,
            -xfCommit.h / 2,
            xfCommit.w,
            xfCommit.h,
          );
        } else {
          newMaskCtx.drawImage(
            origMask,
            xfCommit.x - obCommit.x,
            xfCommit.y - obCommit.y,
          );
        }
        newMaskCtx.restore();
        selectionMaskRef.current = newMask;
      }
    }

    if (!opts?.keepSelection) {
      selectionGeometryRef.current = null;
      selectionShapesRef.current = [];
      selectionBoundaryPathRef.current.dirty = true;
      selectionBoundaryPathRef.current.chains = [];
      selectionBoundaryPathRef.current.segments = [];
      selectionMaskRef.current = null;
      selectionActiveRef.current = false;
      setSelectionActive(false);
    } else {
      selectionGeometryRef.current = { type: "mask" as LassoMode };
      selectionShapesRef.current = [];
      selectionBoundaryPathRef.current.dirty = true;
      selectionBoundaryPathRef.current.chains = [];
      selectionBoundaryPathRef.current.segments = [];
      if (selectionMaskRef.current) {
        rebuildChainsNowRef.current(selectionMaskRef.current);
      }
      setSelectionActive(true);
    }

    // Restore tool that was active before transform
    if (lastToolBeforeTransformRef.current) {
      const restoredTool = lastToolBeforeTransformRef.current;
      setActiveTool(restoredTool);
      if (
        restoredTool === "brush" ||
        restoredTool === "smudge" ||
        restoredTool === "eraser"
      ) {
        setActiveSubpanel(restoredTool);
      } else if (restoredTool === "lasso") {
        setActiveSubpanel("lasso");
      } else if (restoredTool === "fill") {
        setActiveSubpanel("fill");
      } else if (restoredTool === "adjustments") {
        setActiveSubpanel("adjustments");
      }
      lastToolBeforeTransformRef.current = null;
    }
  }

  /** Reset all transform-related mutable refs to their idle state. */
  function _cleanupTransformState() {
    moveFloatCanvasRef.current = null;
    xfStateRef.current = null;
    moveFloatOriginBoundsRef.current = null;
    isDraggingFloatRef.current = false;
    setIsDraggingFloatState(false);
    transformActiveRef.current = false;
    setIsTransformActive(false);
    transformPreSnapshotRef.current = null;
    transformPreCommitSnapshotRef.current = null;
    transformOrigFloatCanvasRef.current = null;
    floatDragStartRef.current = null;
    freeCornerStateRef.current = null;
    // Free per-layer float canvases
    for (const fc of multiFloatCanvasesRef.current.values()) {
      fc.width = 0;
      fc.height = 0;
    }
    multiFloatCanvasesRef.current.clear();
    multiLayerPreSnapshotsRef.current.clear();
    multiLayerResolvedIdsRef.current = [];
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: markLayerBitmapDirtyRef is a stable ref
  const revertTransform = useCallback(() => {
    // Multi-layer revert: restore each layer from its pre-extract snapshot
    if (multiLayerResolvedIdsRef.current.length > 1) {
      for (const lid of multiLayerResolvedIdsRef.current) {
        const snap = multiLayerPreSnapshotsRef.current.get(lid);
        const lc = layerCanvasesRef.current.get(lid);
        if (lc && snap) {
          const ctx = lc.getContext("2d", { willReadFrequently: true });
          if (ctx) ctx.putImageData(snap, 0, 0);
          markLayerBitmapDirtyRef?.current(lid);
        }
      }
    } else {
      // Single-layer revert
      const snap = transformPreSnapshotRef.current;
      const layerId = activeLayerIdRef.current;
      if (snap) {
        const lc = layerCanvasesRef.current.get(layerId!);
        if (lc) {
          const ctx = lc.getContext("2d", { willReadFrequently: true });
          if (ctx) ctx.putImageData(snap, 0, 0);
        }
      }
    }

    // Free per-layer float canvases
    for (const fc of multiFloatCanvasesRef.current.values()) {
      fc.width = 0;
      fc.height = 0;
    }

    moveFloatCanvasRef.current = null;
    xfStateRef.current = null;
    moveFloatOriginBoundsRef.current = null;
    isDraggingFloatRef.current = false;
    setIsDraggingFloatState(false);
    transformActiveRef.current = false;
    setIsTransformActive(false);
    transformPreSnapshotRef.current = null;
    transformPreCommitSnapshotRef.current = null;
    transformOrigFloatCanvasRef.current = null;
    floatDragStartRef.current = null;
    freeCornerStateRef.current = null;
    multiFloatCanvasesRef.current.clear();
    multiLayerPreSnapshotsRef.current.clear();
    multiLayerResolvedIdsRef.current = [];
    // Clear stale boundary data
    selectionBoundaryPathRef.current.chains = [];
    selectionBoundaryPathRef.current.segments = [];
    selectionBoundaryPathRef.current.dirty = true;
    // Restore tool that was active before transform
    if (lastToolBeforeTransformRef.current) {
      const restoredTool = lastToolBeforeTransformRef.current;
      setActiveTool(restoredTool);
      if (
        restoredTool === "brush" ||
        restoredTool === "smudge" ||
        restoredTool === "eraser"
      ) {
        setActiveSubpanel(restoredTool);
      } else if (restoredTool === "lasso") {
        setActiveSubpanel("lasso");
      } else if (restoredTool === "fill") {
        setActiveSubpanel("fill");
      } else if (restoredTool === "adjustments") {
        setActiveSubpanel("adjustments");
      }
      lastToolBeforeTransformRef.current = null;
    }
    compositeRef.current();
    // biome-ignore lint/correctness/useExhaustiveDependencies: markLayerBitmapDirtyRef is a stable ref
  }, [
    compositeRef,
    activeLayerIdRef,
    layerCanvasesRef,
    selectionBoundaryPathRef,
    setActiveTool,
    setActiveSubpanel,
    setIsDraggingFloatState,
    setIsTransformActive,
  ]);

  // Get the 9 transform handle positions (8 + rotation) based on the current
  // transformed corner world positions — correctly accounts for skew.
  // In free-corner mode, uses freeCornerStateRef corners directly instead of xfState.
  const getTransformHandles = useCallback(() => {
    // Free-corner mode: derive handles directly from the four stored corner positions
    if (freeCornerStateRef.current) {
      const fc = freeCornerStateRef.current;
      const { tl, tr, bl, br } = fc.corners;
      const n = { x: (tl.x + tr.x) / 2, y: (tl.y + tr.y) / 2 };
      const s = { x: (bl.x + br.x) / 2, y: (bl.y + br.y) / 2 };
      const w = { x: (tl.x + bl.x) / 2, y: (tl.y + bl.y) / 2 };
      const e = { x: (tr.x + br.x) / 2, y: (tr.y + br.y) / 2 };
      const topEdgeDx = tr.x - tl.x;
      const topEdgeDy = tr.y - tl.y;
      const topEdgeLen =
        Math.sqrt(topEdgeDx * topEdgeDx + topEdgeDy * topEdgeDy) || 1;
      const perpX = topEdgeDy / topEdgeLen;
      const perpY = -topEdgeDx / topEdgeLen;
      const rot = { x: n.x + perpX * 24, y: n.y + perpY * 24 };
      // Compute axis-aligned bounds for compatibility with "bounds" consumers
      const allX = [tl.x, tr.x, bl.x, br.x];
      const allY = [tl.y, tr.y, bl.y, br.y];
      const minX = Math.min(...allX);
      const maxX = Math.max(...allX);
      const minY = Math.min(...allY);
      const maxY = Math.max(...allY);
      return {
        nw: tl,
        n,
        ne: tr,
        w,
        e,
        sw: bl,
        s,
        se: br,
        rot,
        bounds: { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
        corners: fc.corners,
      };
    }
    const xfH = xfStateRef.current;
    if (!xfH) return null;
    const corners = getTransformCornersWorld(xfH);
    const { tl, tr, bl, br } = corners;
    // Edge midpoints
    const n = { x: (tl.x + tr.x) / 2, y: (tl.y + tr.y) / 2 };
    const s = { x: (bl.x + br.x) / 2, y: (bl.y + br.y) / 2 };
    const w = { x: (tl.x + bl.x) / 2, y: (tl.y + bl.y) / 2 };
    const e = { x: (tr.x + br.x) / 2, y: (tr.y + br.y) / 2 };
    // Rotation handle: offset along the "up" direction (outward from top edge)
    const topEdgeDx = tr.x - tl.x;
    const topEdgeDy = tr.y - tl.y;
    const topEdgeLen =
      Math.sqrt(topEdgeDx * topEdgeDx + topEdgeDy * topEdgeDy) || 1;
    // Perpendicular to top edge pointing outward (upward in local space)
    const perpX = topEdgeDy / topEdgeLen;
    const perpY = -topEdgeDx / topEdgeLen;
    const rot = {
      x: n.x + perpX * 24,
      y: n.y + perpY * 24,
    };
    return {
      nw: tl,
      n,
      ne: tr,
      w,
      e,
      sw: bl,
      s,
      se: br,
      rot,
      // Store the original x,y,w,h bounds for scale operations (unchanged from xfState)
      bounds: { x: xfH.x, y: xfH.y, w: xfH.w, h: xfH.h },
      // Also expose corners for use in free-corner drag
      corners,
    };
  }, []);

  const hitTestTransformHandle = useCallback(
    (px: number, py: number): string | null => {
      const handles = getTransformHandles();
      if (!handles) return null;
      const xfHit = xfStateRef.current;
      if (!xfHit) return null;

      // Scale hit radius inversely with zoom so handles stay grabbable when zoomed out.
      const zoom = viewTransformRef?.current?.zoom ?? 1;
      const R = Math.max(8, 8 / zoom);

      // Test each named handle point using direct world-space distance (no inverse rotation needed —
      // the handle positions are already in world space from getTransformCornersWorld).
      const namedHandles = [
        "nw",
        "n",
        "ne",
        "w",
        "e",
        "sw",
        "s",
        "se",
        "rot",
      ] as const;
      for (const key of namedHandles) {
        const pt = handles[key] as { x: number; y: number };
        const dx = px - pt.x;
        const dy = py - pt.y;
        if (Math.sqrt(dx * dx + dy * dy) <= R) return key;
      }

      // Check if inside the parallelogram (skewed bounding box) = "move"
      // Use a barycentric / cross-product test against the four corners.
      const { tl, tr, bl, br } = handles.corners;
      function _cross(ax: number, ay: number, bx: number, by: number): number {
        return ax * by - ay * bx;
      }
      function _insideQuad(qx: number, qy: number): boolean {
        // Test point (qx,qy) inside quad tl→tr→br→bl using sign-consistent cross products
        const d1 = _cross(tr.x - tl.x, tr.y - tl.y, qx - tl.x, qy - tl.y);
        const d2 = _cross(br.x - tr.x, br.y - tr.y, qx - tr.x, qy - tr.y);
        const d3 = _cross(bl.x - br.x, bl.y - br.y, qx - br.x, qy - br.y);
        const d4 = _cross(tl.x - bl.x, tl.y - bl.y, qx - bl.x, qy - bl.y);
        const hasNeg = d1 < 0 || d2 < 0 || d3 < 0 || d4 < 0;
        const hasPos = d1 > 0 || d2 > 0 || d3 > 0 || d4 > 0;
        return !(hasNeg && hasPos);
      }
      if (_insideQuad(px, py)) return "move";

      // Outside-bbox: check if within ROT_ZONE of the quad edges = rotation
      const ROT_ZONE = Math.max(30, 30 / zoom);
      // Expand the quad outward by ROT_ZONE in all directions for the rotation zone test.
      // Approximate: check axis-aligned bounding rect of corners extended by ROT_ZONE.
      const allX = [tl.x, tr.x, bl.x, br.x];
      const allY = [tl.y, tr.y, bl.y, br.y];
      const minX = Math.min(...allX) - ROT_ZONE;
      const maxX = Math.max(...allX) + ROT_ZONE;
      const minY = Math.min(...allY) - ROT_ZONE;
      const maxY = Math.max(...allY) + ROT_ZONE;
      if (
        px >= minX &&
        px <= maxX &&
        py >= minY &&
        py <= maxY &&
        !_insideQuad(px, py)
      ) {
        return "rot";
      }
      return null;
    },
    [getTransformHandles, viewTransformRef],
  );

  // Wire functions into actions ref
  useEffect(() => {
    transformActionsRef.current.extractFloat = extractFloat;
  }, [extractFloat]);

  useEffect(() => {
    transformActionsRef.current.commitFloat = commitFloat;
  }, [commitFloat]);

  useEffect(() => {
    transformActionsRef.current.revertTransform = revertTransform;
  }, [revertTransform]);

  useEffect(() => {
    transformActionsRef.current.getTransformHandles = getTransformHandles;
  }, [getTransformHandles]);

  useEffect(() => {
    transformActionsRef.current.hitTestTransformHandle = hitTestTransformHandle;
  }, [hitTestTransformHandle]);

  return {
    // Refs
    moveFloatCanvasRef,
    moveFloatOriginBoundsRef,
    isDraggingFloatRef,
    floatDragStartRef,
    xfStateRef,
    transformPreSnapshotRef,
    transformPreCommitSnapshotRef,
    transformOrigFloatCanvasRef,
    transformActiveRef,
    transformHandleRef,
    lastToolBeforeTransformRef,
    // Multi-layer floats — now the primary multi-layer data structure
    multiFloatCanvasesRef,
    // Ordered layer IDs for multi-layer transform (used by compositing loop)
    multiLayerResolvedIdsRef,
    // Free-corner mode state (Ctrl+corner handle drag)
    freeCornerStateRef,
    // Actions
    transformActionsRef,
  };
}
