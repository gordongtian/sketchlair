import { useCallback, useEffect, useRef, useState } from "react";
import type React from "react";
import type { Layer } from "../components/LayersPanel";
import type { LassoMode, Tool } from "../components/Toolbar";
import type { SelectionGeom, SelectionSnapshot } from "../selectionTypes";
import { computeMaskBounds } from "../utils/selectionUtils";
import { markCanvasDirty } from "./useCompositing";

const CANVAS_WIDTH_DEFAULT = 2560;
const CANVAS_HEIGHT_DEFAULT = 1440;

interface UseSelectionSystemParams {
  canvasWidth?: number;
  canvasHeight?: number;
  /** Stable refs that always hold the current canvas dimensions — avoids stale-closure
   * issues when the canvas is resized (e.g. by the crop tool) between renders. Used in
   * rasterizeSelectionMask and handleCtrlClickLayer so mask canvases are always created
   * at the correct size even if React state hasn't flushed yet. */
  canvasWidthRef?: React.MutableRefObject<number>;
  canvasHeightRef?: React.MutableRefObject<number>;
  layersRef: React.RefObject<Layer[]>;
  newLayerFn: () => Layer;
  pushHistory: (entry: unknown) => void;
  // Refs/callbacks passed directly from PaintingApp (cannot use context — hooks are called before provider)
  layerCanvasesRef: React.MutableRefObject<Map<string, HTMLCanvasElement>>;
  activeLayerIdRef: React.MutableRefObject<string>;
  pendingLayerPixelsRef: React.MutableRefObject<Map<string, ImageData>>;
  setLayers: React.Dispatch<React.SetStateAction<Layer[]>>;
  setActiveLayerId: React.Dispatch<React.SetStateAction<string>>;
  setActiveTool: React.Dispatch<React.SetStateAction<Tool>>;
  selectionOverlayCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  compositeRef: React.MutableRefObject<() => void>;
  markLayerBitmapDirty: (id: string) => void;
  rebuildChainsNowRef: React.MutableRefObject<
    (mask: HTMLCanvasElement) => void
  >;
  /** Stable ref to setLayerTree — used to synchronize the tree after cut/copy-to-layer
   *  inserts a new layer into the flat array. Without this the tree is stale and the new
   *  layer cannot be found during a subsequent move operation (causes ghost layers). */
  setLayerTreeRef?: React.MutableRefObject<
    React.Dispatch<React.SetStateAction<import("../types").LayerNode[]>>
  >;
}

export function useSelectionSystem({
  canvasWidth = CANVAS_WIDTH_DEFAULT,
  canvasHeight = CANVAS_HEIGHT_DEFAULT,
  canvasWidthRef,
  canvasHeightRef,
  layersRef,
  newLayerFn,
  pushHistory,
  layerCanvasesRef,
  activeLayerIdRef,
  pendingLayerPixelsRef,
  setLayers,
  setActiveLayerId,
  setActiveTool,
  selectionOverlayCanvasRef,
  compositeRef,
  markLayerBitmapDirty,
  rebuildChainsNowRef,
  setLayerTreeRef,
}: UseSelectionSystemParams) {
  // ---- Selection state & refs ----
  const [selectionActive, setSelectionActive] = useState(false);
  const selectionActiveRef = useRef(false);
  const selectionGeometryRef = useRef<{
    type: LassoMode;
    points?: { x: number; y: number }[];
    x?: number;
    y?: number;
    w?: number;
    h?: number;
  } | null>(null);
  const selectionShapesRef = useRef<NonNullable<SelectionGeom>[]>([]);
  const selectionBoundaryPathRef = useRef<{
    segments: Array<[number, number, number, number]>;
    chains: Array<Array<[number, number]>>;
    generation: number;
    dirty: boolean;
    lastRebuildMs: number;
  }>({
    segments: [],
    chains: [],
    generation: 0,
    dirty: true,
    lastRebuildMs: 0,
  });
  const selectionMaskRef = useRef<HTMLCanvasElement | null>(null);
  // In-progress selection drawing
  const isDrawingSelectionRef = useRef(false);
  const selectionPolyClosingRef = useRef(false);
  const selectionDraftPointsRef = useRef<{ x: number; y: number }[]>([]);
  const selectionDraftCursorRef = useRef<{ x: number; y: number } | null>(null);
  const selectionDraftBoundsRef = useRef<{
    sx: number;
    sy: number;
    ex: number;
    ey: number;
  } | null>(null);
  // Captured at selection start for undo tracking
  const selectionBeforeRef = useRef<SelectionSnapshot | null>(null);

  // Sync selectionActive state → ref
  useEffect(() => {
    selectionActiveRef.current = selectionActive;
  }, [selectionActive]);

  // Actions ref to avoid forward-reference issues in keyboard handler
  // (commitFloat, revertTransform, extractFloat are populated by PaintingApp)
  const selectionActionsRef = useRef({
    clearSelection: () => {},
    deleteSelection: () => {},
    cutOrCopyToLayer: (_cut: boolean) => {},
    commitFloat: (_opts?: { keepSelection?: boolean }) => {},
    revertTransform: () => {},
    rasterizeSelectionMask: () => {},
    extractFloat: (
      _fromSel: boolean,
      _opts?: { fromToolActivation?: boolean },
    ) => {},
  });

  // Wired by PaintingApp to atomically reset _boundaryRebuildPending.
  // Called at the top of clearSelection so no stale idle rebuild can fire after deselect.
  const cancelBoundaryRebuildRef = useRef<() => void>(() => {});

  // Helper: snapshot current selection state for undo
  const snapshotSelection = useCallback((): SelectionSnapshot => {
    const mc = selectionMaskRef.current;
    let maskDataURL: string | null = null;
    if (mc) {
      maskDataURL = mc.toDataURL();
    }
    const geom = selectionGeometryRef.current;
    return {
      geometry: geom
        ? { ...geom, points: geom.points ? [...geom.points] : undefined }
        : null,
      maskDataURL,
      active: selectionActiveRef.current,
      shapes: selectionShapesRef.current.map((s) => ({
        ...s,
        points: s.points ? [...s.points] : undefined,
      })),
    };
  }, []);

  // When the canvas is resized (e.g. by the crop tool), expand the selection mask canvas to
  // match. Without this the mask canvas stays at the original canvas size, meaning selections
  // are silently capped to that size and fill/transform tools behave incorrectly on the new areas.
  useEffect(() => {
    const mc = selectionMaskRef.current;
    if (!mc) return;
    if (mc.width === canvasWidth && mc.height === canvasHeight) return;
    // Grow the mask canvas to the new size, preserving existing mask content
    const oldW = mc.width;
    const oldH = mc.height;
    const tmpCanvas = document.createElement("canvas");
    tmpCanvas.width = oldW;
    tmpCanvas.height = oldH;
    const tmpCtx = tmpCanvas.getContext("2d", { willReadFrequently: true });
    if (tmpCtx) {
      tmpCtx.drawImage(mc, 0, 0);
    }
    mc.width = canvasWidth;
    mc.height = canvasHeight;
    const mctx = mc.getContext("2d", { willReadFrequently: true });
    if (mctx && tmpCtx) {
      mctx.clearRect(0, 0, canvasWidth, canvasHeight);
      mctx.drawImage(tmpCanvas, 0, 0);
    }
    // Fix 3: also clear stale chains/segments when the canvas is resized so the
    // ant loop never renders outlines sized for the old canvas dimensions.
    selectionBoundaryPathRef.current.dirty = true;
    selectionBoundaryPathRef.current.chains = [];
    selectionBoundaryPathRef.current.segments = [];
  }, [canvasWidth, canvasHeight]);

  // Helper: restore selection snapshot
  const restoreSelectionSnapshot = useCallback(
    (snap: SelectionSnapshot) => {
      selectionGeometryRef.current = snap.geometry;
      selectionShapesRef.current = snap.shapes ?? [];
      // Fix 2: clear stale chains/segments immediately when marking dirty so the ant
      // loop never renders outlines from the snapshot being replaced.
      selectionBoundaryPathRef.current.dirty = true;
      selectionBoundaryPathRef.current.chains = [];
      selectionBoundaryPathRef.current.segments = [];
      if (snap.maskDataURL) {
        const mc = document.createElement("canvas");
        mc.width = canvasWidth;
        mc.height = canvasHeight;
        const mctx = mc.getContext("2d", { willReadFrequently: true })!;
        const img = new Image();
        img.onload = () => {
          mctx.clearRect(0, 0, canvasWidth, canvasHeight);
          mctx.drawImage(img, 0, 0);
          // Synchronously rebuild chains after the mask image loads so the ant
          // loop has fresh chain data immediately rather than waiting for idle.
          if (rebuildChainsNowRef?.current) {
            rebuildChainsNowRef.current(mc);
          }
        };
        img.src = snap.maskDataURL;
        selectionMaskRef.current = mc;
      } else {
        selectionMaskRef.current = null;
      }
      selectionActiveRef.current = snap.active;
      setSelectionActive(snap.active);
    },
    [canvasWidth, canvasHeight, rebuildChainsNowRef],
  );

  const rasterizeSelectionMask = useCallback(() => {
    const geom = selectionGeometryRef.current;
    if (!geom) return;
    // Use the live ref dimensions if available — they are updated synchronously when the
    // canvas is resized (e.g. by the crop tool), whereas the closed-over canvasWidth/Height
    // React state values may lag behind by one render cycle.
    const cw = canvasWidthRef?.current ?? canvasWidth;
    const ch = canvasHeightRef?.current ?? canvasHeight;
    if (!selectionMaskRef.current) {
      const mc = document.createElement("canvas");
      mc.width = cw;
      mc.height = ch;
      selectionMaskRef.current = mc;
    }
    const mc = selectionMaskRef.current;
    mc.width = cw;
    mc.height = ch;
    const mctx = mc.getContext("2d", { willReadFrequently: true })!;
    mctx.clearRect(0, 0, cw, ch);
    mctx.fillStyle = "white";
    if (geom.type === "rect" && geom.w !== undefined && geom.h !== undefined) {
      const x = geom.w! < 0 ? geom.x! + geom.w! : geom.x!;
      const y = geom.h! < 0 ? geom.y! + geom.h! : geom.y!;
      const w = Math.abs(geom.w!);
      const h = Math.abs(geom.h!);
      mctx.fillRect(x, y, w, h);
    } else if (
      geom.type === "ellipse" &&
      geom.w !== undefined &&
      geom.h !== undefined
    ) {
      const cx = geom.x! + geom.w! / 2;
      const cy = geom.y! + geom.h! / 2;
      const rx = Math.abs(geom.w! / 2);
      const ry = Math.abs(geom.h! / 2);
      mctx.beginPath();
      mctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      mctx.fill();
    } else if (
      (geom.type === "free" || geom.type === "poly") &&
      geom.points &&
      geom.points.length > 2
    ) {
      mctx.beginPath();
      mctx.moveTo(geom.points[0].x, geom.points[0].y);
      for (let i = 1; i < geom.points.length; i++) {
        mctx.lineTo(geom.points[i].x, geom.points[i].y);
      }
      mctx.closePath();
      mctx.fill();
    }
  }, [canvasWidth, canvasHeight, canvasWidthRef, canvasHeightRef]);

  // Sync to actions ref
  useEffect(() => {
    selectionActionsRef.current.rasterizeSelectionMask = rasterizeSelectionMask;
  }, [rasterizeSelectionMask]);

  const handleCtrlClickLayer = useCallback(
    (id: string) => {
      const lc = layerCanvasesRef.current.get(id);
      if (!lc) return;
      const ctx = lc.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      // Use the layer canvas dimensions directly — they are the ground truth after a crop.
      // The closed-over canvasWidth/Height React state may be one render cycle behind.
      const cw = lc.width;
      const ch = lc.height;
      const imgData = ctx.getImageData(0, 0, cw, ch);
      const data = imgData.data;
      const maskCanvas = document.createElement("canvas");
      maskCanvas.width = cw;
      maskCanvas.height = ch;
      const mCtx = maskCanvas.getContext("2d", { willReadFrequently: true })!;
      const maskImgData = mCtx.createImageData(cw, ch);
      const md = maskImgData.data;
      let hasPixels = false;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] > 0) {
          md[i] = 255;
          md[i + 1] = 255;
          md[i + 2] = 255;
          md[i + 3] = 255;
          hasPixels = true;
        }
      }
      if (!hasPixels) return;
      mCtx.putImageData(maskImgData, 0, 0);
      selectionMaskRef.current = maskCanvas;
      // Purely mask-based selection — no stale geometry needed
      selectionGeometryRef.current = { type: "mask" as LassoMode };
      selectionShapesRef.current = [];
      selectionBoundaryPathRef.current.dirty = true;
      // Synchronously rebuild chains so the ant loop has correct data immediately.
      rebuildChainsNowRef?.current?.(maskCanvas);
      setActiveTool("lasso");
      setSelectionActive(true);
    },
    [layerCanvasesRef, setActiveTool, rebuildChainsNowRef],
  );

  const clearSelection = useCallback(() => {
    // Null geometry and mask FIRST so that if a RAF frame fires between here and
    // cancelBoundaryRebuildRef, buildGeomPath sees geom=null and draws nothing.
    selectionGeometryRef.current = null;
    selectionShapesRef.current = [];
    selectionMaskRef.current = null;
    // Cancel any pending idle boundary rebuild AFTER nulling geometry/mask, so the
    // idle callback can never write chains back for a now-dead session.
    cancelBoundaryRebuildRef.current();
    selectionBoundaryPathRef.current.dirty = true;
    selectionBoundaryPathRef.current.chains = [];
    selectionBoundaryPathRef.current.segments = [];
    isDrawingSelectionRef.current = false;
    selectionDraftPointsRef.current = [];
    selectionDraftCursorRef.current = null;
    selectionDraftBoundsRef.current = null;
    selectionActiveRef.current = false;
    setSelectionActive(false);
    // Clear overlay
    const overlay = selectionOverlayCanvasRef.current;
    if (overlay) {
      const ctx = overlay.getContext("2d", { willReadFrequently: true });
      if (ctx) ctx.clearRect(0, 0, overlay.width, overlay.height);
    }
  }, [selectionOverlayCanvasRef]);

  useEffect(() => {
    selectionActionsRef.current.clearSelection = clearSelection;
  }, [clearSelection]);

  const deleteSelection = useCallback(() => {
    if (!selectionActiveRef.current || !selectionMaskRef.current) return;
    const layerId = activeLayerIdRef.current;
    const lc = layerCanvasesRef.current.get(layerId!);
    if (!lc) return;
    const ctx = lc.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    const W = lc.width;
    const H = lc.height;
    const before = ctx.getImageData(0, 0, W, H);

    // Read float weights from the selection mask canvas.
    // The mask stores float weights as: alpha channel = weight × 255.
    const maskCtx = selectionMaskRef.current.getContext("2d", {
      willReadFrequently: true,
    });
    if (!maskCtx) return;
    const maskData = maskCtx.getImageData(0, 0, W, H).data;

    // Apply weighted erase: multiply each pixel's alpha by (1 - weight)
    // so partial-weight pixels are only partially erased.
    const imgData = ctx.getImageData(0, 0, W, H);
    const d = imgData.data;
    for (let i = 0; i < W * H; i++) {
      const weight = maskData[i * 4 + 3] / 255; // 0.0–1.0
      if (weight <= 0) continue;
      if (weight >= 1) {
        d[i * 4 + 3] = 0;
      } else {
        d[i * 4 + 3] = Math.round(d[i * 4 + 3] * (1 - weight));
      }
    }
    ctx.putImageData(imgData, 0, 0);

    // Use selection bounding box as the dirty rect — only that region changed.
    const _delBounds = computeMaskBounds(selectionMaskRef.current);
    if (_delBounds && _delBounds.w > 0 && _delBounds.h > 0) {
      const _delDr = {
        x: _delBounds.x,
        y: _delBounds.y,
        w: _delBounds.w,
        h: _delBounds.h,
      };
      const _delTmp = document.createElement("canvas");
      _delTmp.width = _delDr.w;
      _delTmp.height = _delDr.h;
      const _delTmpCtx = _delTmp.getContext("2d", { willReadFrequently: true });
      if (_delTmpCtx) {
        _delTmpCtx.putImageData(before, -_delDr.x, -_delDr.y);
        const _croppedBefore = _delTmpCtx.getImageData(
          0,
          0,
          _delDr.w,
          _delDr.h,
        );
        const after = ctx.getImageData(_delDr.x, _delDr.y, _delDr.w, _delDr.h);
        pushHistory({
          type: "pixels",
          layerId,
          dirtyRect: _delDr,
          before: _croppedBefore,
          after,
        });
      } else {
        const after = ctx.getImageData(0, 0, W, H);
        pushHistory({
          type: "pixels",
          layerId,
          dirtyRect: { x: 0, y: 0, w: W, h: H },
          before,
          after,
        });
      }
    } else {
      const after = ctx.getImageData(0, 0, W, H);
      pushHistory({
        type: "pixels",
        layerId,
        dirtyRect: { x: 0, y: 0, w: W, h: H },
        before,
        after,
      });
    }
    compositeRef.current();
  }, [activeLayerIdRef, layerCanvasesRef, pushHistory, compositeRef]);

  useEffect(() => {
    selectionActionsRef.current.deleteSelection = deleteSelection;
  }, [deleteSelection]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: setLayerTreeRef is a stable ref
  const cutOrCopyToLayer = useCallback(
    (cut: boolean) => {
      const layerId = activeLayerIdRef.current;
      const lc = layerCanvasesRef.current.get(layerId!);
      if (!lc) return;

      // No selection: only copy (not cut) duplicates the whole layer
      if (!selectionActiveRef.current || !selectionMaskRef.current) {
        if (cut) return;
        const dupLayerData = newLayerFn();
        dupLayerData.name = `${
          layersRef.current.find((l) => l.id === layerId)?.name ?? "Layer"
        } copy`;
        const dupCanvas = document.createElement("canvas");
        dupCanvas.width = canvasWidth;
        dupCanvas.height = canvasHeight;
        const dupCtx = dupCanvas.getContext("2d", {
          willReadFrequently: true,
        })!;
        dupCtx.drawImage(lc, 0, 0);
        const srcIdx = layersRef.current.findIndex((l) => l.id === layerId);
        const insertIdx = Math.max(0, srcIdx);
        const newLayers = [...layersRef.current];
        newLayers.splice(insertIdx, 0, dupLayerData);
        layersRef.current = newLayers;

        const pixels = dupCtx.getImageData(0, 0, canvasWidth, canvasHeight);
        pendingLayerPixelsRef.current.set(dupLayerData.id, pixels);
        setLayers(newLayers);
        // Synchronize layerTree so the new layer is immediately visible to the
        // move/transform system — without this the tree is stale and the layer
        // appears as an undeletable ghost after a subsequent move.
        setLayerTreeRef?.current((prev) => {
          const newNode = {
            kind: "layer" as const,
            id: dupLayerData.id,
            layer: dupLayerData as unknown as import("../types").Layer,
          };
          const treeIdx = prev.findIndex(
            (n) => n.kind === "layer" && n.layer.id === layerId,
          );
          const ii = treeIdx >= 0 ? treeIdx : 0;
          const next = [...prev];
          next.splice(ii, 0, newNode);
          return next;
        });
        setActiveLayerId(dupLayerData.id);

        pushHistory({
          type: "layer-add-pixels",
          layer: dupLayerData,
          index: insertIdx,
          pixels,
        });

        // toast called from PaintingApp via effect if needed — skip here to avoid import
        return;
      }

      const srcCtx = lc.getContext("2d", { willReadFrequently: true });
      if (!srcCtx) return;

      const W = canvasWidth;
      const H = canvasHeight;

      // Read float weights from the selection mask canvas.
      // The mask stores weights as alpha channel: alpha = weight × 255.
      const maskCtx = selectionMaskRef.current!.getContext("2d", {
        willReadFrequently: true,
      });
      if (!maskCtx) return;
      const maskData = maskCtx.getImageData(0, 0, W, H).data;

      // Capture source before state (for cut undo)
      const srcBefore = cut ? srcCtx.getImageData(0, 0, W, H) : undefined;

      // Create new layer canvas with selected pixels weighted by selection mask
      const newLayerData = newLayerFn();
      const nl = document.createElement("canvas");
      nl.width = W;
      nl.height = H;
      const nlCtx = nl.getContext("2d", { willReadFrequently: true })!;

      // Copy source pixels to new layer with float-weighted alpha
      const srcPixels = srcCtx.getImageData(0, 0, W, H);
      const nlImgData = nlCtx.createImageData(W, H);
      const sd = srcPixels.data;
      const nd = nlImgData.data;
      for (let i = 0; i < W * H; i++) {
        const weight = maskData[i * 4 + 3] / 255; // 0.0–1.0
        if (weight <= 0) continue;
        const pi = i * 4;
        nd[pi] = sd[pi];
        nd[pi + 1] = sd[pi + 1];
        nd[pi + 2] = sd[pi + 2];
        nd[pi + 3] = weight >= 1 ? sd[pi + 3] : Math.round(sd[pi + 3] * weight);
      }
      nlCtx.putImageData(nlImgData, 0, 0);
      const newLayerPixels = nlCtx.getImageData(0, 0, W, H);

      let srcAfter: ImageData | undefined;
      if (cut) {
        // Weighted erase from source: multiply each pixel's alpha by (1 - weight)
        const eraseData = srcCtx.getImageData(0, 0, W, H);
        const ed = eraseData.data;
        for (let i = 0; i < W * H; i++) {
          const weight = maskData[i * 4 + 3] / 255;
          if (weight <= 0) continue;
          if (weight >= 1) {
            ed[i * 4 + 3] = 0;
          } else {
            ed[i * 4 + 3] = Math.round(ed[i * 4 + 3] * (1 - weight));
          }
        }
        srcCtx.putImageData(eraseData, 0, 0);
        srcAfter = srcCtx.getImageData(0, 0, W, H);
        // Invalidate the source layer's bitmap cache AFTER the pixel write so that
        // composite() and thumbnail generation both see the post-cut canvas content,
        // not the stale cached ImageBitmap from before the cut.
        markLayerBitmapDirty?.(layerId!);
        // Schedule a thumbnail refresh for the source layer so its panel thumb
        // reflects the cut region being cleared. markCanvasDirty is debounced 80 ms —
        // it fires after the useHistory useEffect has called composite(), so the thumb
        // is generated from correct data.
        markCanvasDirty(layerId!);
      }

      // Insert new layer above active (sync ref before composite)
      const srcIdx = layersRef.current.findIndex((l) => l.id === layerId);
      const insertIdx = Math.max(0, srcIdx);
      const newLayers = [...layersRef.current];
      newLayers.splice(insertIdx, 0, newLayerData);
      layersRef.current = newLayers;
      pendingLayerPixelsRef.current.set(newLayerData.id, newLayerPixels);
      setLayers(newLayers);
      // Synchronize layerTree so the new layer is immediately visible to the
      // move/transform system — without this the tree is stale and the layer
      // appears as an undeletable ghost after a subsequent move.
      setLayerTreeRef?.current((prev) => {
        const newNode = {
          kind: "layer" as const,
          id: newLayerData.id,
          layer: newLayerData as unknown as import("../types").Layer,
        };
        const treeIdx = prev.findIndex(
          (n) => n.kind === "layer" && n.layer.id === layerId,
        );
        const ii = treeIdx >= 0 ? treeIdx : 0;
        const next = [...prev];
        next.splice(ii, 0, newNode);
        return next;
      });
      setActiveLayerId(newLayerData.id);

      // Push single atomic history entry
      pushHistory({
        type: "layer-add-pixels",
        layer: newLayerData,
        index: insertIdx,
        pixels: newLayerPixels,
        ...(cut ? { srcLayerId: layerId, srcBefore, srcAfter } : {}),
      });

      // Defer composite by one macrotask so React has time to flush
      // setLayers/setLayerTree before composite() runs — replicates the
      // exact pattern used by handleSetOpacity and handleToggleVisible.
      // A synchronous call fires before React state is applied, causing
      // the new layer to be absent from the layer list during composite.
      setTimeout(() => compositeRef.current(), 0);
    },
    [
      activeLayerIdRef,
      layerCanvasesRef,
      layersRef,
      pushHistory,
      pendingLayerPixelsRef,
      setLayers,
      setActiveLayerId,
      canvasWidth,
      canvasHeight,
      newLayerFn,
      markLayerBitmapDirty,
      compositeRef,
    ],
  );

  useEffect(() => {
    selectionActionsRef.current.cutOrCopyToLayer = cutOrCopyToLayer;
  }, [cutOrCopyToLayer]);

  return {
    // State
    selectionActive,
    setSelectionActive,
    // Refs
    selectionActiveRef,
    selectionGeometryRef,
    selectionShapesRef,
    selectionBoundaryPathRef,
    selectionMaskRef,
    isDrawingSelectionRef,
    selectionPolyClosingRef,
    selectionDraftPointsRef,
    selectionDraftCursorRef,
    selectionDraftBoundsRef,
    selectionBeforeRef,
    selectionActionsRef,
    cancelBoundaryRebuildRef,
    // Functions
    snapshotSelection,
    restoreSelectionSnapshot,
    rasterizeSelectionMask,
    clearSelection,
    deleteSelection,
    cutOrCopyToLayer,
    handleCtrlClickLayer,
  };
}

export type { SelectionGeom, SelectionSnapshot };

// Re-export computeMaskBounds so callers can import from one place
export { computeMaskBounds } from "../utils/selectionUtils";
