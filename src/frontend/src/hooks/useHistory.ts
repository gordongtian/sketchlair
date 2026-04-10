import { useCallback, useEffect } from "react";
import type React from "react";
import type { Layer } from "../components/LayersPanel";
import type { SelectionSnapshot } from "../selectionTypes";
import type { LayerNode } from "../types";
import { removeNode } from "../utils/layerTree";
import type { WebGLBrushContext } from "../utils/webglBrush";
import { markCanvasDirty } from "./useCompositing";
import type { UndoEntry } from "./useLayerSystem";

// Module-level reusable canvas for thumbnail generation in history operations
// is now provided by thumbnailCache.ts (getThumbCanvas/getThumbCtx)

interface UseHistoryProps {
  // Props that are NOT in context (unique to useHistory or require special wiring)
  setUndoCount: React.Dispatch<React.SetStateAction<number>>;
  setRedoCount: React.Dispatch<React.SetStateAction<number>>;
  // Canvas/layer props
  canvasWidth: number;
  canvasHeight: number;
  layers: Layer[];
  setLayers: React.Dispatch<React.SetStateAction<Layer[]>>;
  setLayerTreeRef: React.MutableRefObject<
    React.Dispatch<React.SetStateAction<LayerNode[]>>
  >;
  setActiveLayerId: React.Dispatch<React.SetStateAction<string>>;
  updateNavigatorCanvas: () => void;
  composite: () => void;
  restoreSelectionSnapshot: (snap: SelectionSnapshot) => void;
  // Transform refs (to clear stale state on pixels undo/redo)
  moveFloatCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  xfStateRef: React.MutableRefObject<{
    x: number;
    y: number;
    w: number;
    h: number;
    rotation: number;
  } | null>;
  isDraggingFloatRef: React.MutableRefObject<boolean>;
  transformActiveRef: React.MutableRefObject<boolean>;
  transformPreSnapshotRef: React.MutableRefObject<ImageData | null>;
  transformPreCommitSnapshotRef: React.MutableRefObject<ImageData | null>;
  transformOrigFloatCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  setIsTransformActive: React.Dispatch<React.SetStateAction<boolean>>;
  setIsDraggingFloatState: React.Dispatch<React.SetStateAction<boolean>>;
  // Ref to revertTransform function (called before applying undo when transform is active)
  revertTransformRef: React.MutableRefObject<() => void>;
  // Canvas resize
  setCanvasWidth: (w: number) => void;
  setCanvasHeight: (h: number) => void;
  displayCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  rulerCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  webglBrushRef: React.MutableRefObject<WebGLBrushContext | null>;
  belowActiveCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  aboveActiveCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  snapshotCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  activePreviewCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  // Refs passed directly from PaintingApp (cannot use context — hook is called before provider)
  undoStackRef: React.MutableRefObject<UndoEntry[]>;
  redoStackRef: React.MutableRefObject<UndoEntry[]>;
  pendingLayerPixelsRef: React.MutableRefObject<Map<string, ImageData>>;
  layerCanvasesRef: React.MutableRefObject<Map<string, HTMLCanvasElement>>;
  selectionActiveRef: React.MutableRefObject<boolean>;
  selectionMaskRef: React.MutableRefObject<HTMLCanvasElement | null>;
  canvasWidthRef: React.MutableRefObject<number>;
  canvasHeightRef: React.MutableRefObject<number>;
  markLayerBitmapDirty: (id: string) => void;
  invalidateAllLayerBitmaps: () => void;
}

export function useHistory({
  setUndoCount,
  setRedoCount,
  canvasWidth,
  canvasHeight,
  layers,
  setLayers,
  setLayerTreeRef,
  setActiveLayerId,
  updateNavigatorCanvas,
  composite,
  restoreSelectionSnapshot,
  moveFloatCanvasRef,
  xfStateRef,
  isDraggingFloatRef,
  transformActiveRef,
  transformPreSnapshotRef,
  transformPreCommitSnapshotRef,
  transformOrigFloatCanvasRef,
  setIsTransformActive,
  setIsDraggingFloatState,
  revertTransformRef,
  setCanvasWidth,
  setCanvasHeight,
  displayCanvasRef,
  rulerCanvasRef,
  webglBrushRef,
  belowActiveCanvasRef,
  aboveActiveCanvasRef,
  snapshotCanvasRef,
  activePreviewCanvasRef,
  undoStackRef,
  redoStackRef,
  pendingLayerPixelsRef,
  layerCanvasesRef,
  selectionActiveRef,
  selectionMaskRef,
  canvasWidthRef,
  canvasHeightRef,
  markLayerBitmapDirty,
  invalidateAllLayerBitmaps,
}: UseHistoryProps) {
  /** Push an entry and clear the redo stack. Call this whenever a canvas change is committed. */
  const pushHistory = useCallback(
    (entry: UndoEntry) => {
      undoStackRef.current.push(entry);
      if (undoStackRef.current.length > 50) undoStackRef.current.shift();
      redoStackRef.current = [];
      setUndoCount(undoStackRef.current.length);
      setRedoCount(0);
    },
    [undoStackRef, redoStackRef, setUndoCount, setRedoCount],
  );

  /** Update the navigator thumbnail from the current display canvas. */
  const updateNavigator = useCallback(() => {
    updateNavigatorCanvas();
  }, [updateNavigatorCanvas]);

  /** Clear all active transform state -- used when pixels are restored via undo/redo. */
  const clearTransformState = useCallback(() => {
    const wasTransformActive = transformActiveRef.current;
    moveFloatCanvasRef.current = null;
    xfStateRef.current = null;
    isDraggingFloatRef.current = false;
    setIsDraggingFloatState(false);
    transformActiveRef.current = false;
    setIsTransformActive(false);
    transformPreSnapshotRef.current = null;
    transformPreCommitSnapshotRef.current = null;
    transformOrigFloatCanvasRef.current = null;
    // Only clear selection state if a transform was actually active.
    // Clearing unconditionally would wipe the selection when undoing a stroke.
    if (wasTransformActive) {
      selectionActiveRef.current = false;
      selectionMaskRef.current = null;
    }
  }, [
    moveFloatCanvasRef,
    xfStateRef,
    isDraggingFloatRef,
    transformActiveRef,
    setIsTransformActive,
    setIsDraggingFloatState,
    transformPreSnapshotRef,
    transformPreCommitSnapshotRef,
    transformOrigFloatCanvasRef,
    selectionActiveRef,
    selectionMaskRef,
  ]);

  // Flush pending layer pixels after React renders new layer canvases (used by cut/copy to layer and redo).
  // biome-ignore lint/correctness/useExhaustiveDependencies: layers triggers re-run
  useEffect(() => {
    for (const [id, lc] of layerCanvasesRef.current) {
      if (lc.width !== canvasWidth || lc.height !== canvasHeight) {
        lc.width = canvasWidth;
        lc.height = canvasHeight;
      }
      const pending = pendingLayerPixelsRef.current.get(id);
      if (pending) {
        const ctx = lc.getContext("2d", { willReadFrequently: true });
        if (ctx) {
          ctx.putImageData(pending, 0, 0);
          markLayerBitmapDirty(id);
          markCanvasDirty(id);
        }
        pendingLayerPixelsRef.current.delete(id);
      }
    }
    composite();
    updateNavigatorCanvas();
  }, [layers, composite, updateNavigatorCanvas]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: restoreSelectionSnapshot and clearTransformState are stable
  const handleUndo = useCallback(() => {
    const entry = undoStackRef.current.pop();
    if (!entry) return;

    if (entry.type === "pixels") {
      // If a transform is active, revert it first so the layer is in a clean non-floating state
      if (transformActiveRef.current) {
        revertTransformRef.current();
      }
      const lc = layerCanvasesRef.current.get(entry.layerId);
      if (lc) {
        const ctx = lc.getContext("2d", { willReadFrequently: true });
        if (ctx) {
          if (entry.dirtyRect) {
            ctx.putImageData(
              entry.before,
              entry.dirtyRect.x,
              entry.dirtyRect.y,
            );
          } else {
            ctx.putImageData(entry.before, 0, 0);
          }
          markLayerBitmapDirty(entry.layerId);
        }
        markCanvasDirty(entry.layerId);
      }
      clearTransformState();
    } else if (entry.type === "layer-add") {
      setLayers((prev) => prev.filter((l) => l.id !== entry.layer.id));
      layerCanvasesRef.current.delete(entry.layer.id);
      // Keep layerTree in sync: remove the node for this layer
      setLayerTreeRef.current((prev) => removeNode(prev, entry.layer.id));
      // Restore the active layer to whatever was active before the layer was added.
      // Without this, the active layer ID would point to the just-deleted layer.
      if (entry.previousActiveLayerId) {
        setActiveLayerId(entry.previousActiveLayerId);
      }
    } else if (entry.type === "layer-add-pixels") {
      layerCanvasesRef.current.delete(entry.layer.id);
      setLayers((prev) => prev.filter((l) => l.id !== entry.layer.id));
      // Keep layerTree in sync: remove the node for this layer
      setLayerTreeRef.current((prev) => removeNode(prev, entry.layer.id));
      if (entry.srcLayerId && entry.srcBefore) {
        const srcId = entry.srcLayerId;
        const srcLc = layerCanvasesRef.current.get(srcId);
        if (srcLc) {
          const ctx = srcLc.getContext("2d", { willReadFrequently: true });
          if (ctx) {
            ctx.putImageData(entry.srcBefore, 0, 0);
            markLayerBitmapDirty(srcId);
          }
          markCanvasDirty(srcId);
        }
      }
    } else if (entry.type === "layer-delete") {
      pendingLayerPixelsRef.current.set(entry.layer.id, entry.pixels);
      setLayers((prev) => {
        const next = [...prev];
        next.splice(entry.index, 0, entry.layer);
        return next;
      });
      // Keep layerTree in sync: re-insert the node at the recorded index
      setLayerTreeRef.current((prev) => {
        const newNode: LayerNode = {
          kind: "layer",
          id: entry.layer.id,
          layer: entry.layer,
        };
        const insertAt = Math.min(entry.index, prev.length);
        return [...prev.slice(0, insertAt), newNode, ...prev.slice(insertAt)];
      });
      setActiveLayerId(entry.layer.id);
    } else if (entry.type === "blend-mode") {
      setLayers((prev) =>
        prev.map((l) =>
          l.id === entry.layerId ? { ...l, blendMode: entry.before } : l,
        ),
      );
    } else if (entry.type === "selection") {
      restoreSelectionSnapshot(entry.before);
    } else if (entry.type === "ruler-edit") {
      setLayers((prev) =>
        prev.map((l) =>
          l.id === entry.layerId ? { ...l, ...entry.before } : l,
        ),
      );
    } else if (entry.type === "layer-merge") {
      // Restore below layer to pre-merge pixels and its original isClippingMask state
      const belowLc = layerCanvasesRef.current.get(entry.belowLayerId);
      if (belowLc) {
        const ctx = belowLc.getContext("2d", { willReadFrequently: true });
        if (ctx) {
          ctx.putImageData(entry.belowPixelsBefore, 0, 0);
          markLayerBitmapDirty(entry.belowLayerId);
        }
        markCanvasDirty(entry.belowLayerId);
      }
      // Restore the below layer's isClippingMask to what it was before the merge
      setLayers((prev) =>
        prev.map((l) =>
          l.id === entry.belowLayerId
            ? { ...l, isClippingMask: entry.belowLayerIsClippingMaskBefore }
            : l,
        ),
      );
      // Re-add the merged layer with its original pixels
      pendingLayerPixelsRef.current.set(
        entry.activeLayer.id,
        entry.activePixels,
      );
      setLayers((prev) => {
        const next = [...prev];
        next.splice(entry.activeIndex, 0, entry.activeLayer);
        return next;
      });
      // Keep layerTree in sync: re-insert the active layer's node
      setLayerTreeRef.current((prev) => {
        const newNode: LayerNode = {
          kind: "layer",
          id: entry.activeLayer.id,
          layer: entry.activeLayer,
        };
        const insertAt = Math.min(entry.activeIndex, prev.length);
        return [...prev.slice(0, insertAt), newNode, ...prev.slice(insertAt)];
      });
      setActiveLayerId(entry.activeLayer.id);
    } else if (entry.type === "canvas-resize") {
      if (displayCanvasRef.current) {
        displayCanvasRef.current.width = entry.beforeWidth;
        displayCanvasRef.current.height = entry.beforeHeight;
      }
      if (rulerCanvasRef.current) {
        rulerCanvasRef.current.width = entry.beforeWidth;
        rulerCanvasRef.current.height = entry.beforeHeight;
      }
      for (const [layerId, beforePixels] of entry.layerPixelsBefore) {
        const lc = layerCanvasesRef.current.get(layerId);
        if (lc) {
          lc.width = entry.beforeWidth;
          lc.height = entry.beforeHeight;
          const ctx = lc.getContext("2d", { willReadFrequently: true });
          if (ctx) {
            ctx.putImageData(beforePixels, 0, 0);
            markCanvasDirty(layerId);
          }
        }
      }
      setLayers(entry.layersBefore);
      setCanvasWidth(entry.beforeWidth);
      setCanvasHeight(entry.beforeHeight);
      // Keep refs in sync — hotpath code (rotate drag, compositing) reads these directly
      canvasWidthRef.current = entry.beforeWidth;
      canvasHeightRef.current = entry.beforeHeight;
      // Resize WebGL stroke buffer and offscreen compositing canvases to match
      if (webglBrushRef.current)
        webglBrushRef.current.resize(entry.beforeWidth, entry.beforeHeight);
      for (const canvasRef of [
        belowActiveCanvasRef,
        aboveActiveCanvasRef,
        snapshotCanvasRef,
        activePreviewCanvasRef,
      ]) {
        if (canvasRef.current) {
          canvasRef.current.width = entry.beforeWidth;
          canvasRef.current.height = entry.beforeHeight;
        }
      }
      // Dimensions changed — all cached bitmaps are now stale
      invalidateAllLayerBitmaps();
    } else if (entry.type === "layers-clear-rulers") {
      // Undo: re-add all ruler layers
      for (const { layer } of entry.removedLayers) {
        const rc = document.createElement("canvas");
        rc.width = canvasWidth;
        rc.height = canvasHeight;
        layerCanvasesRef.current.set(layer.id, rc);
      }
      setLayers((prev) => {
        const next = [...prev];
        const sorted = [...entry.removedLayers].sort(
          (a, b) => a.index - b.index,
        );
        for (const { layer, index } of sorted) {
          next.splice(index, 0, layer);
        }
        return next;
      });
    } else if (entry.type === "layer-group-create") {
      // Undo: restore tree and flat layers to pre-group state
      setLayerTreeRef.current(entry.treeBefore);
      setLayers(entry.layersBefore);
    } else if (entry.type === "layer-group-delete") {
      // Undo: restore tree and flat layers to pre-delete state
      // Re-create canvases for deleted layers
      for (const [layerId, pixels] of entry.deletedCanvases) {
        const rc = document.createElement("canvas");
        rc.width = canvasWidth;
        rc.height = canvasHeight;
        layerCanvasesRef.current.set(layerId, rc);
        pendingLayerPixelsRef.current.set(layerId, pixels);
      }
      setLayerTreeRef.current(entry.treeBefore);
      setLayers(entry.layersBefore);
    } else if (entry.type === "layer-opacity-change") {
      // Undo: restore previous opacity
      const opacityLayerId = entry.layerId;
      const opacityBefore = entry.before;
      setLayers((prev) =>
        prev.map((l) =>
          l.id === opacityLayerId ? { ...l, opacity: opacityBefore } : l,
        ),
      );
      setLayerTreeRef.current((prev) => {
        function updateTree(nodes: LayerNode[]): LayerNode[] {
          return nodes.map((node) => {
            if (node.kind === "layer" && node.layer.id === opacityLayerId) {
              return {
                ...node,
                layer: { ...node.layer, opacity: opacityBefore },
              };
            }
            if (node.kind === "group")
              return { ...node, children: updateTree(node.children ?? []) };
            return node;
          });
        }
        return updateTree(prev);
      });
    } else if (entry.type === "group-opacity-change") {
      // Undo: restore previous group opacity
      const groupOpacityId = entry.groupId;
      const groupOpacityBefore = entry.before;
      setLayerTreeRef.current((prev) => {
        function updateTree(nodes: LayerNode[]): LayerNode[] {
          return nodes.map((node) => {
            if (node.kind === "group" && node.id === groupOpacityId) {
              return { ...node, opacity: groupOpacityBefore };
            }
            if (node.kind === "group")
              return { ...node, children: updateTree(node.children ?? []) };
            return node;
          });
        }
        return updateTree(prev);
      });
    } else if (entry.type === "layer-visibility-change") {
      // Undo: restore previous visibility
      const visLayerId = entry.layerId;
      const visBefore = entry.before;
      setLayers((prev) =>
        prev.map((l) =>
          l.id === visLayerId ? { ...l, visible: visBefore } : l,
        ),
      );
      setLayerTreeRef.current((prev) => {
        function updateTree(nodes: LayerNode[]): LayerNode[] {
          return nodes.map((node) => {
            if (node.kind === "layer" && node.layer.id === visLayerId) {
              return { ...node, layer: { ...node.layer, visible: visBefore } };
            }
            if (node.kind === "group")
              return { ...node, children: updateTree(node.children ?? []) };
            return node;
          });
        }
        return updateTree(prev);
      });
    } else if (entry.type === "alpha-lock-change") {
      // Undo: restore previous alpha lock
      const alphaLayerId = entry.layerId;
      const alphaBefore = entry.before;
      setLayers((prev) =>
        prev.map((l) =>
          l.id === alphaLayerId ? { ...l, alphaLock: alphaBefore } : l,
        ),
      );
      setLayerTreeRef.current((prev) => {
        function updateTree(nodes: LayerNode[]): LayerNode[] {
          return nodes.map((node) => {
            if (node.kind === "layer" && node.layer.id === alphaLayerId) {
              return {
                ...node,
                layer: { ...node.layer, alphaLock: alphaBefore },
              };
            }
            if (node.kind === "group")
              return { ...node, children: updateTree(node.children ?? []) };
            return node;
          });
        }
        return updateTree(prev);
      });
    } else if (entry.type === "clipping-mask-change") {
      // Undo: restore previous clipping mask state
      const clipLayerId = entry.layerId;
      const clipBefore = entry.before;
      setLayers((prev) =>
        prev.map((l) =>
          l.id === clipLayerId ? { ...l, isClippingMask: clipBefore } : l,
        ),
      );
      setLayerTreeRef.current((prev) => {
        function updateTree(nodes: LayerNode[]): LayerNode[] {
          return nodes.map((node) => {
            if (node.kind === "layer" && node.layer.id === clipLayerId) {
              return {
                ...node,
                layer: { ...node.layer, isClippingMask: clipBefore },
              };
            }
            if (node.kind === "group")
              return { ...node, children: updateTree(node.children ?? []) };
            return node;
          });
        }
        return updateTree(prev);
      });
    } else if (entry.type === "layer-rename") {
      // Undo: restore previous name
      const renameLayerId = entry.layerId;
      const renameBefore = entry.before;
      setLayers((prev) =>
        prev.map((l) =>
          l.id === renameLayerId ? { ...l, name: renameBefore } : l,
        ),
      );
      setLayerTreeRef.current((prev) => {
        function updateTree(nodes: LayerNode[]): LayerNode[] {
          return nodes.map((node) => {
            if (node.kind === "layer" && node.layer.id === renameLayerId) {
              return { ...node, layer: { ...node.layer, name: renameBefore } };
            }
            if (node.kind === "group")
              return { ...node, children: updateTree(node.children ?? []) };
            return node;
          });
        }
        return updateTree(prev);
      });
    } else if (entry.type === "layer-reorder") {
      // Undo: restore tree and flat layers to pre-reorder state
      setLayerTreeRef.current(entry.treeBefore);
      setLayers(entry.layersBefore);
    } else if (entry.type === "multi-layer-pixels") {
      // Undo: atomically restore ALL layers involved in the multi-layer transform.
      // A single Ctrl+Z reverts every layer at once — no partial state possible.
      if (transformActiveRef.current) {
        revertTransformRef.current();
      }
      const dirtyIds: string[] = [];
      for (const [layerId, { before }] of entry.layers) {
        const lc = layerCanvasesRef.current.get(layerId);
        if (lc) {
          const ctx = lc.getContext("2d", { willReadFrequently: true });
          if (ctx) {
            ctx.putImageData(before, 0, 0);
            dirtyIds.push(layerId);
          }
          markCanvasDirty(layerId);
        }
      }
      // Invalidate all bitmap caches BEFORE composite fires
      for (const lid of dirtyIds) {
        markLayerBitmapDirty(lid);
      }
      clearTransformState();
    }

    redoStackRef.current.push(entry);
    if (redoStackRef.current.length > 50) redoStackRef.current.shift();
    composite();
    updateNavigator();
    setUndoCount(undoStackRef.current.length);
    setRedoCount(redoStackRef.current.length);
  }, [composite, updateNavigator, clearTransformState]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: restoreSelectionSnapshot and clearTransformState are stable
  const handleRedo = useCallback(() => {
    const entry = redoStackRef.current.pop();
    if (!entry) return;

    if (entry.type === "pixels") {
      const lc = layerCanvasesRef.current.get(entry.layerId);
      if (lc) {
        const ctx = lc.getContext("2d", { willReadFrequently: true });
        if (ctx) {
          if (entry.dirtyRect) {
            ctx.putImageData(entry.after, entry.dirtyRect.x, entry.dirtyRect.y);
          } else {
            ctx.putImageData(entry.after, 0, 0);
          }
          markLayerBitmapDirty(entry.layerId);
        }
        markCanvasDirty(entry.layerId);
      }
      clearTransformState();
    } else if (entry.type === "layer-add") {
      const restoredCanvas = document.createElement("canvas");
      restoredCanvas.width = canvasWidth;
      restoredCanvas.height = canvasHeight;
      layerCanvasesRef.current.set(entry.layer.id, restoredCanvas);
      setLayers((prev) => {
        const next = [...prev];
        next.splice(entry.index, 0, entry.layer);
        return next;
      });
      // Keep layerTree in sync: re-insert the node at the recorded index
      setLayerTreeRef.current((prev) => {
        const newNode: LayerNode = {
          kind: "layer",
          id: entry.layer.id,
          layer: entry.layer,
        };
        const insertAt = Math.min(entry.index, prev.length);
        return [...prev.slice(0, insertAt), newNode, ...prev.slice(insertAt)];
      });
    } else if (entry.type === "layer-add-pixels") {
      if (entry.pixels) {
        pendingLayerPixelsRef.current.set(entry.layer.id, entry.pixels);
      }
      setLayers((prev) => {
        const next = [...prev];
        next.splice(entry.index, 0, entry.layer);
        return next;
      });
      // Keep layerTree in sync: re-insert the node at the recorded index
      setLayerTreeRef.current((prev) => {
        const newNode: LayerNode = {
          kind: "layer",
          id: entry.layer.id,
          layer: entry.layer,
        };
        const insertAt = Math.min(entry.index, prev.length);
        return [...prev.slice(0, insertAt), newNode, ...prev.slice(insertAt)];
      });
      if (entry.srcLayerId && entry.srcAfter) {
        const srcId = entry.srcLayerId;
        const srcLc = layerCanvasesRef.current.get(srcId);
        if (srcLc) {
          const ctx = srcLc.getContext("2d", { willReadFrequently: true });
          if (ctx) {
            ctx.putImageData(entry.srcAfter, 0, 0);
            markLayerBitmapDirty(srcId);
          }
          markCanvasDirty(srcId);
        }
      }
    } else if (entry.type === "layer-delete") {
      setLayers((prev) => prev.filter((l) => l.id !== entry.layer.id));
      layerCanvasesRef.current.delete(entry.layer.id);
      // Keep layerTree in sync: remove the node for this layer
      setLayerTreeRef.current((prev) => removeNode(prev, entry.layer.id));
    } else if (entry.type === "blend-mode") {
      setLayers((prev) =>
        prev.map((l) =>
          l.id === entry.layerId ? { ...l, blendMode: entry.after } : l,
        ),
      );
    } else if (entry.type === "selection") {
      restoreSelectionSnapshot(entry.after);
    } else if (entry.type === "ruler-edit") {
      setLayers((prev) =>
        prev.map((l) =>
          l.id === entry.layerId ? { ...l, ...entry.after } : l,
        ),
      );
    } else if (entry.type === "layer-merge") {
      // Re-apply the merge: restore below layer to post-merge pixels and isClippingMask state
      const belowLc2 = layerCanvasesRef.current.get(entry.belowLayerId);
      if (belowLc2) {
        const ctx = belowLc2.getContext("2d", { willReadFrequently: true });
        if (ctx) {
          ctx.putImageData(entry.belowPixelsAfter, 0, 0);
          markLayerBitmapDirty(entry.belowLayerId);
        }
        markCanvasDirty(entry.belowLayerId);
      }
      // Restore the below layer's isClippingMask to the post-merge value
      setLayers((prev) =>
        prev.map((l) =>
          l.id === entry.belowLayerId
            ? { ...l, isClippingMask: entry.belowLayerIsClippingMaskAfter }
            : l,
        ),
      );
      layerCanvasesRef.current.delete(entry.activeLayer.id);
      setLayers((prev) => prev.filter((l) => l.id !== entry.activeLayer.id));
      // Keep layerTree in sync: remove the merged layer's node
      setLayerTreeRef.current((prev) => removeNode(prev, entry.activeLayer.id));
      setActiveLayerId(entry.belowLayerId);
    } else if (entry.type === "canvas-resize") {
      if (displayCanvasRef.current) {
        displayCanvasRef.current.width = entry.afterWidth;
        displayCanvasRef.current.height = entry.afterHeight;
      }
      if (rulerCanvasRef.current) {
        rulerCanvasRef.current.width = entry.afterWidth;
        rulerCanvasRef.current.height = entry.afterHeight;
      }
      for (const [layerId, afterPixels] of entry.layerPixelsAfter) {
        const lc = layerCanvasesRef.current.get(layerId);
        if (lc) {
          lc.width = entry.afterWidth;
          lc.height = entry.afterHeight;
          const ctx = lc.getContext("2d", { willReadFrequently: true });
          if (ctx) {
            ctx.putImageData(afterPixels, 0, 0);
            markCanvasDirty(layerId);
          }
        }
      }
      setLayers(entry.layersAfter);
      setCanvasWidth(entry.afterWidth);
      setCanvasHeight(entry.afterHeight);
      // Keep refs in sync — hotpath code (rotate drag, compositing) reads these directly
      canvasWidthRef.current = entry.afterWidth;
      canvasHeightRef.current = entry.afterHeight;
      // Resize WebGL stroke buffer and offscreen compositing canvases to match
      if (webglBrushRef.current)
        webglBrushRef.current.resize(entry.afterWidth, entry.afterHeight);
      for (const canvasRef of [
        belowActiveCanvasRef,
        aboveActiveCanvasRef,
        snapshotCanvasRef,
        activePreviewCanvasRef,
      ]) {
        if (canvasRef.current) {
          canvasRef.current.width = entry.afterWidth;
          canvasRef.current.height = entry.afterHeight;
        }
      }
      // Dimensions changed — all cached bitmaps are now stale
      invalidateAllLayerBitmaps();
    } else if (entry.type === "layers-clear-rulers") {
      // Redo: remove all ruler layers again
      const ids = new Set(entry.removedLayers.map((r) => r.layer.id));
      setLayers((prev) => prev.filter((l) => !ids.has(l.id)));
      for (const { layer } of entry.removedLayers) {
        layerCanvasesRef.current.delete(layer.id);
      }
    } else if (entry.type === "layer-group-create") {
      // Redo: restore tree and flat layers to post-group state
      setLayerTreeRef.current(entry.treeAfter);
      setLayers(entry.layersAfter);
    } else if (entry.type === "layer-group-delete") {
      // Redo: restore tree and flat layers to post-delete state; remove deleted canvases
      for (const layerId of entry.deletedCanvases.keys()) {
        layerCanvasesRef.current.delete(layerId);
      }
      setLayerTreeRef.current(entry.treeAfter);
      setLayers(entry.layersAfter);
    } else if (entry.type === "layer-opacity-change") {
      const opacityLayerIdR = entry.layerId;
      const opacityAfter = entry.after;
      setLayers((prev) =>
        prev.map((l) =>
          l.id === opacityLayerIdR ? { ...l, opacity: opacityAfter } : l,
        ),
      );
      setLayerTreeRef.current((prev) => {
        function updateTree(nodes: LayerNode[]): LayerNode[] {
          return nodes.map((node) => {
            if (node.kind === "layer" && node.layer.id === opacityLayerIdR) {
              return {
                ...node,
                layer: { ...node.layer, opacity: opacityAfter },
              };
            }
            if (node.kind === "group")
              return { ...node, children: updateTree(node.children ?? []) };
            return node;
          });
        }
        return updateTree(prev);
      });
    } else if (entry.type === "group-opacity-change") {
      const groupOpacityIdR = entry.groupId;
      const groupOpacityAfter = entry.after;
      setLayerTreeRef.current((prev) => {
        function updateTree(nodes: LayerNode[]): LayerNode[] {
          return nodes.map((node) => {
            if (node.kind === "group" && node.id === groupOpacityIdR) {
              return { ...node, opacity: groupOpacityAfter };
            }
            if (node.kind === "group")
              return { ...node, children: updateTree(node.children ?? []) };
            return node;
          });
        }
        return updateTree(prev);
      });
    } else if (entry.type === "layer-visibility-change") {
      const visLayerIdR = entry.layerId;
      const visAfter = entry.after;
      setLayers((prev) =>
        prev.map((l) =>
          l.id === visLayerIdR ? { ...l, visible: visAfter } : l,
        ),
      );
      setLayerTreeRef.current((prev) => {
        function updateTree(nodes: LayerNode[]): LayerNode[] {
          return nodes.map((node) => {
            if (node.kind === "layer" && node.layer.id === visLayerIdR) {
              return { ...node, layer: { ...node.layer, visible: visAfter } };
            }
            if (node.kind === "group")
              return { ...node, children: updateTree(node.children ?? []) };
            return node;
          });
        }
        return updateTree(prev);
      });
    } else if (entry.type === "alpha-lock-change") {
      const alphaLayerIdR = entry.layerId;
      const alphaAfter = entry.after;
      setLayers((prev) =>
        prev.map((l) =>
          l.id === alphaLayerIdR ? { ...l, alphaLock: alphaAfter } : l,
        ),
      );
      setLayerTreeRef.current((prev) => {
        function updateTree(nodes: LayerNode[]): LayerNode[] {
          return nodes.map((node) => {
            if (node.kind === "layer" && node.layer.id === alphaLayerIdR) {
              return {
                ...node,
                layer: { ...node.layer, alphaLock: alphaAfter },
              };
            }
            if (node.kind === "group")
              return { ...node, children: updateTree(node.children ?? []) };
            return node;
          });
        }
        return updateTree(prev);
      });
    } else if (entry.type === "clipping-mask-change") {
      const clipLayerIdR = entry.layerId;
      const clipAfter = entry.after;
      setLayers((prev) =>
        prev.map((l) =>
          l.id === clipLayerIdR ? { ...l, isClippingMask: clipAfter } : l,
        ),
      );
      setLayerTreeRef.current((prev) => {
        function updateTree(nodes: LayerNode[]): LayerNode[] {
          return nodes.map((node) => {
            if (node.kind === "layer" && node.layer.id === clipLayerIdR) {
              return {
                ...node,
                layer: { ...node.layer, isClippingMask: clipAfter },
              };
            }
            if (node.kind === "group")
              return { ...node, children: updateTree(node.children ?? []) };
            return node;
          });
        }
        return updateTree(prev);
      });
    } else if (entry.type === "layer-rename") {
      const renameLayerIdR = entry.layerId;
      const renameAfter = entry.after;
      setLayers((prev) =>
        prev.map((l) =>
          l.id === renameLayerIdR ? { ...l, name: renameAfter } : l,
        ),
      );
      setLayerTreeRef.current((prev) => {
        function updateTree(nodes: LayerNode[]): LayerNode[] {
          return nodes.map((node) => {
            if (node.kind === "layer" && node.layer.id === renameLayerIdR) {
              return { ...node, layer: { ...node.layer, name: renameAfter } };
            }
            if (node.kind === "group")
              return { ...node, children: updateTree(node.children ?? []) };
            return node;
          });
        }
        return updateTree(prev);
      });
    } else if (entry.type === "layer-reorder") {
      setLayerTreeRef.current(entry.treeAfter);
      setLayers(entry.layersAfter);
    } else if (entry.type === "multi-layer-pixels") {
      // Redo: atomically re-apply ALL layers involved in the multi-layer transform.
      const dirtyIds: string[] = [];
      for (const [layerId, { after }] of entry.layers) {
        const lc = layerCanvasesRef.current.get(layerId);
        if (lc) {
          const ctx = lc.getContext("2d", { willReadFrequently: true });
          if (ctx) {
            ctx.putImageData(after, 0, 0);
            dirtyIds.push(layerId);
          }
          markCanvasDirty(layerId);
        }
      }
      // Invalidate all bitmap caches BEFORE composite fires
      for (const lid of dirtyIds) {
        markLayerBitmapDirty(lid);
      }
      clearTransformState();
    }

    undoStackRef.current.push(entry);
    if (undoStackRef.current.length > 50) undoStackRef.current.shift();
    composite();
    updateNavigator();
    setUndoCount(undoStackRef.current.length);
    setRedoCount(redoStackRef.current.length);
  }, [composite, updateNavigator, clearTransformState]);

  return {
    pushHistory,
    handleUndo,
    handleRedo,
  };
}
