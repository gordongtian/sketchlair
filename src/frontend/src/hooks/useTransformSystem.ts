import { useCallback, useEffect, useRef } from "react";
import type React from "react";
import type { LassoMode, Tool } from "../components/Toolbar";
import type { SelectionGeom } from "../selectionTypes";
import type { LayerNode } from "../types";
import { getEffectivelySelectedLayers } from "../utils/layerTree";
import { computeMaskBounds } from "../utils/selectionUtils";
import { markCanvasDirty } from "./useCompositing";
import type { UndoEntry } from "./useLayerSystem";

const CANVAS_WIDTH_DEFAULT = 2560;
const CANVAS_HEIGHT_DEFAULT = 1440;

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
  /** Ref to the full layer tree — used to resolve multi-select groups to their leaf layers */
  layerTreeRef?: React.MutableRefObject<LayerNode[]>;
  /** Ref to the selected layer ids set — used for multi-layer transform */
  selectedLayerIdsRef?: React.MutableRefObject<Set<string>>;
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
  layerTreeRef,
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
  } | null>(null);
  const xfStateRef = useRef<{
    x: number;
    y: number;
    w: number;
    h: number;
    rotation: number;
  } | null>(null);
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

  // Actions ref — populated by the useEffect blocks below
  const transformActionsRef = useRef({
    extractFloat: (_fromSel: boolean) => {},
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
   * Uses the live layerCanvasesRef as the authoritative source — never relies solely on
   * layerTreeRef which can be one render cycle stale.
   *
   * Returns layers in BOTTOM-TO-TOP visual order (index 0 = bottommost in the layer panel,
   * last entry = topmost). This matches the compositing order used by flattenTree().
   */
  function _resolveSelectedLayers(): Array<{
    id: string;
    lc: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
  }> {
    const tree = layerTreeRef?.current ?? [];
    const selectedIds = selectedLayerIdsRef?.current ?? new Set<string>();

    // Determine whether any selected IDs are group nodes (not in layerCanvasesRef)
    const hasGroupInSelection = [...selectedIds].some(
      (id) => !layerCanvasesRef.current.has(id),
    );

    let effectivelySelected: ReturnType<typeof getEffectivelySelectedLayers>;
    if (hasGroupInSelection) {
      effectivelySelected = getEffectivelySelectedLayers(tree, selectedIds);
    } else {
      // All selected IDs are paintable layers — bypass stale tree ref
      effectivelySelected = [...selectedIds]
        .filter((id) => layerCanvasesRef.current.has(id))
        .map((id) => ({
          kind: "layer" as const,
          id,
          layer: { id } as import("../components/LayersPanel").Layer,
        }));
    }

    const resolvedLayers: Array<{
      id: string;
      lc: HTMLCanvasElement;
      ctx: CanvasRenderingContext2D;
    }> = [];
    const resolvedSet = new Set<string>();

    for (const layerItem of effectivelySelected) {
      const lid = layerItem.id;
      const lc = layerCanvasesRef.current.get(lid);
      if (!lc) continue;
      const ctx = lc.getContext("2d", { willReadFrequently: true });
      if (!ctx) continue;
      if (!resolvedSet.has(lid)) {
        resolvedSet.add(lid);
        resolvedLayers.push({ id: lid, lc, ctx });
      }
    }

    // Unconditionally cross-check every directly-selected paintable ID — ensures
    // no layer is silently dropped due to a stale tree or partial expansion.
    for (const id of selectedIds) {
      if (resolvedSet.has(id)) continue;
      const lc = layerCanvasesRef.current.get(id);
      if (!lc) continue;
      const ctx = lc.getContext("2d", { willReadFrequently: true });
      if (!ctx) continue;
      resolvedSet.add(id);
      resolvedLayers.push({ id, lc, ctx });
    }

    // Final safety net: force-add any directly-selected paintable ID still missing
    {
      const expectedCount = [...selectedIds].filter((id) =>
        layerCanvasesRef.current.has(id),
      ).length;
      if (resolvedLayers.length < expectedCount) {
        for (const id of selectedIds) {
          if (resolvedSet.has(id)) continue;
          const lc = layerCanvasesRef.current.get(id);
          if (!lc) continue;
          const ctx = lc.getContext("2d", { willReadFrequently: true });
          if (!ctx) continue;
          resolvedSet.add(id);
          resolvedLayers.push({ id, lc, ctx });
        }
      }
    }

    return resolvedLayers;
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: setIsTransformActive is a stable React setter
  const extractFloat = useCallback(
    (fromSelection: boolean) => {
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
          return _extractSingleLayer(fromSelection);
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
            // All layers empty — small centered fallback
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
      _extractSingleLayer(fromSelection);
    },
    [
      compositeRef,
      canvasWidthRef,
      canvasHeightRef,
      activeLayerIdRef,
      layerCanvasesRef,
      layerTreeRef,
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
  function _extractSingleLayer(fromSelection: boolean) {
    // Clear multi-layer state from any prior session
    multiFloatCanvasesRef.current.clear();
    multiLayerPreSnapshotsRef.current.clear();
    multiLayerResolvedIdsRef.current = [];

    const layerId = activeLayerIdRef.current;
    const lc = layerCanvasesRef.current.get(layerId!);
    if (!lc) return;
    const ctx = lc.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

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
      }
      // If no content found, fall back to full canvas (bounds already set above).
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
          if (xfCommit && obCommit) {
            const cx = xfCommit.x + xfCommit.w / 2;
            const cy = xfCommit.y + xfCommit.h / 2;
            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate(xfCommit.rotation);
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

        _cleanupTransformState();
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

      if (xfCommit && obCommit) {
        const cx = xfCommit.x + xfCommit.w / 2;
        const cy = xfCommit.y + xfCommit.h / 2;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(xfCommit.rotation);
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
      const after = ctx.getImageData(0, 0, lc.width, lc.height);
      pushHistory({ type: "pixels", layerId, before, after });
      markLayerBitmapDirtyRef?.current(layerId);

      _updateSelectionAfterCommit(xfCommit, obCommit, opts, lc);
      _cleanupTransformState();
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

  // Get the 9 transform handle positions (8 + rotation) based on float position and original bounds
  const getTransformHandles = useCallback(() => {
    const xfH = xfStateRef.current;
    if (!xfH) return null;
    const { x, y, w, h } = xfH;
    const hw = w / 2;
    const hh = h / 2;
    return {
      nw: { x, y },
      n: { x: x + hw, y },
      ne: { x: x + w, y },
      w: { x, y: y + hh },
      e: { x: x + w, y: y + hh },
      sw: { x, y: y + h },
      s: { x: x + hw, y: y + h },
      se: { x: x + w, y: y + h },
      rot: { x: x + hw, y: y - 24 },
      bounds: { x, y, w, h },
    };
  }, []);

  const hitTestTransformHandle = useCallback(
    (px: number, py: number): string | null => {
      const handles = getTransformHandles();
      if (!handles) return null;
      const xfHit = xfStateRef.current;
      const rot = xfHit ? xfHit.rotation : 0;
      let testX = px;
      let testY = py;
      if (rot !== 0) {
        // Inverse-rotate px, py around the visual center of the bounding box
        const { x, y, w, h } = handles.bounds;
        const cx = x + w / 2;
        const cy = y + h / 2;
        const cos = Math.cos(-rot);
        const sin = Math.sin(-rot);
        const dx = px - cx;
        const dy = py - cy;
        testX = cx + dx * cos - dy * sin;
        testY = cy + dx * sin + dy * cos;
      }
      const R = 8;
      for (const [key, pt] of Object.entries(handles)) {
        if (key === "bounds") continue;
        const dx = testX - (pt as { x: number; y: number }).x;
        const dy = testY - (pt as { x: number; y: number }).y;
        if (Math.sqrt(dx * dx + dy * dy) <= R) return key;
      }
      // Check if inside bounds = drag entire float
      const { x, y, w, h } = handles.bounds;
      if (testX >= x && testX <= x + w && testY >= y && testY <= y + h)
        return "move";
      // Outside-bbox: check if within 30px of any edge = rotation
      const ROT_ZONE = 30;
      if (
        testX >= x - ROT_ZONE &&
        testX <= x + w + ROT_ZONE &&
        testY >= y - ROT_ZONE &&
        testY <= y + h + ROT_ZONE
      ) {
        return "rot";
      }
      return null;
    },
    [getTransformHandles],
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
    // Actions
    transformActionsRef,
  };
}
