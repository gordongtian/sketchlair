import { useCallback, useEffect, useRef, useState } from "react";
import type React from "react";
import type { Layer } from "../components/LayersPanel";
import type { SelectionSnapshot } from "../selectionTypes";
import type { LayerNode, RulerFields } from "../types";
import { generateGroupId, groupNodes, ungroupNodes } from "../utils/layerTree";
import { markCanvasDirty } from "./useCompositing";

// Module-level reusable canvas for thumbnail generation in layer ops
const _layerSysThumbCanvas = document.createElement("canvas");
_layerSysThumbCanvas.width = 144;
_layerSysThumbCanvas.height = 144;
const _layerSysThumbCtx = _layerSysThumbCanvas.getContext("2d", {
  willReadFrequently: true,
})!;

// Pre-computed white thumbnail data URL (avoids per-layer-add canvas allocation)
const _whiteThumbnailCanvas = document.createElement("canvas");
_whiteThumbnailCanvas.width = 144;
_whiteThumbnailCanvas.height = 144;
const _whiteThumbnailCtx = _whiteThumbnailCanvas.getContext("2d")!;
_whiteThumbnailCtx.fillStyle = "#ffffff";
_whiteThumbnailCtx.fillRect(0, 0, 144, 144);
const WHITE_THUMBNAIL = _whiteThumbnailCanvas.toDataURL();

export type RulerState = Omit<RulerFields, "isRuler" | "rulerActive">;

export type UndoEntry =
  | {
      type: "pixels";
      layerId: string;
      before: ImageData;
      after: ImageData;
      dirtyRect?: { x: number; y: number; w: number; h: number };
    }
  | {
      type: "layer-add";
      layer: Layer;
      index: number;
      previousActiveLayerId?: string;
    }
  | {
      type: "layer-add-pixels";
      layer: Layer;
      index: number;
      pixels: ImageData;
      srcLayerId?: string;
      srcBefore?: ImageData;
      srcAfter?: ImageData;
    }
  | { type: "layer-delete"; layer: Layer; pixels: ImageData; index: number }
  | { type: "blend-mode"; layerId: string; before: string; after: string }
  | { type: "selection"; before: SelectionSnapshot; after: SelectionSnapshot }
  | {
      type: "ruler-edit";
      layerId: string;
      before: RulerState;
      after: RulerState;
    }
  | {
      type: "layer-merge";
      activeLayer: Layer;
      activeIndex: number;
      activePixels: ImageData;
      belowLayerId: string;
      belowPixelsBefore: ImageData;
      belowPixelsAfter: ImageData;
      /** isClippingMask value of the below layer before the merge (for undo) */
      belowLayerIsClippingMaskBefore: boolean;
      /** isClippingMask value of the below layer after the merge (for redo) */
      belowLayerIsClippingMaskAfter: boolean;
    }
  | {
      type: "canvas-resize";
      beforeWidth: number;
      beforeHeight: number;
      afterWidth: number;
      afterHeight: number;
      cropX: number;
      cropY: number;
      layerPixelsBefore: Map<string, ImageData>;
      layerPixelsAfter: Map<string, ImageData>;
      layersBefore: Layer[];
      layersAfter: Layer[];
    }
  | {
      type: "layers-clear-rulers";
      removedLayers: Array<{ layer: Layer; index: number }>;
    }
  | {
      type: "layer-group-create";
      /** Tree state before grouping (for undo) */
      treeBefore: LayerNode[];
      /** Tree state after grouping (for redo) */
      treeAfter: LayerNode[];
      /** Flat layers before grouping (for undo) */
      layersBefore: Layer[];
      /** Flat layers after grouping (for redo) */
      layersAfter: Layer[];
    }
  | {
      type: "layer-group-delete";
      /** Tree state before deletion (for undo) */
      treeBefore: LayerNode[];
      /** Tree state after deletion (for redo) */
      treeAfter: LayerNode[];
      /** Flat layers before deletion (for undo) */
      layersBefore: Layer[];
      /** Flat layers after deletion (for redo) */
      layersAfter: Layer[];
      /** Layer canvases that were deleted (only for deleteChildren=true) */
      deletedCanvases: Map<string, ImageData>;
    }
  // ── New history entry types for layer property changes ────────────────────
  | {
      type: "layer-opacity-change";
      layerId: string;
      before: number;
      after: number;
    }
  | {
      type: "group-opacity-change";
      groupId: string;
      before: number;
      after: number;
    }
  | {
      type: "layer-visibility-change";
      layerId: string;
      before: boolean;
      after: boolean;
    }
  | {
      type: "alpha-lock-change";
      layerId: string;
      before: boolean;
      after: boolean;
    }
  | {
      type: "clipping-mask-change";
      layerId: string;
      before: boolean;
      after: boolean;
    }
  | {
      type: "layer-rename";
      layerId: string;
      before: string;
      after: string;
    }
  | {
      type: "layer-reorder";
      /** Tree state before reorder */
      treeBefore: LayerNode[];
      /** Tree state after reorder */
      treeAfter: LayerNode[];
      /** Flat layers before reorder */
      layersBefore: Layer[];
      /** Flat layers after reorder */
      layersAfter: Layer[];
    }
  | {
      /**
       * Atomic multi-layer transform commit.
       * Stores before/after ImageData for every layer involved in a single
       * move/transform operation so undo/redo can restore ALL layers at once
       * with a single Ctrl+Z press.
       */
      type: "multi-layer-pixels";
      layers: Map<string, { before: ImageData; after: ImageData }>;
    };

interface UseLayerSystemProps {
  layers: Layer[];
  setLayers: React.Dispatch<React.SetStateAction<Layer[]>>;
  setActiveLayerId: React.Dispatch<React.SetStateAction<string>>;
  composite: () => void;
  setUndoCount: (n: number) => void;
  newLayerFn: () => Layer;
  canvasWidth: number;
  canvasHeight: number;
  // Refs passed directly from PaintingApp (cannot use context — hook is called before provider)
  activeLayerIdRef: React.MutableRefObject<string>;
  layerCanvasesRef: React.MutableRefObject<Map<string, HTMLCanvasElement>>;
  undoStackRef: React.MutableRefObject<UndoEntry[]>;
  redoStackRef: React.MutableRefObject<UndoEntry[]>;
  transformActiveRef: React.MutableRefObject<boolean>;
  isDraggingFloatRef: React.MutableRefObject<boolean>;
  selectionActionsRef: React.MutableRefObject<{
    clearSelection: () => void;
    deleteSelection: () => void;
    cutOrCopyToLayer: (cut: boolean) => void;
    commitFloat: (opts?: { keepSelection?: boolean }) => void;
    revertTransform: () => void;
    rasterizeSelectionMask: () => void;
    extractFloat: (fromSel: boolean) => void;
  }>;
  setLayerThumbnails: React.Dispatch<
    React.SetStateAction<Record<string, string>>
  >;
  markLayerBitmapDirty: (id: string) => void;
  /** Stable ref that mirrors selectedLayerIds — updated synchronously here so
   *  useTransformSystem.extractFloat always reads the current selection even on
   *  the first render cycle after a selection change. */
  selectedLayerIdsRef?: React.MutableRefObject<Set<string>>;
  /** Optional: callback for confirming group deletion (set by consumer) */
  onGroupDeleteConfirm?: (groupId: string, deleteChildren: boolean) => void;
}

export function useLayerSystem({
  layers,
  setLayers,
  setActiveLayerId,
  composite,
  setUndoCount,
  newLayerFn,
  canvasWidth,
  canvasHeight,
  activeLayerIdRef,
  layerCanvasesRef,
  undoStackRef,
  redoStackRef,
  transformActiveRef,
  isDraggingFloatRef,
  selectionActionsRef,
  setLayerThumbnails,
  markLayerBitmapDirty,
  selectedLayerIdsRef,
}: UseLayerSystemProps) {
  // ── Multi-select state ────────────────────────────────────────────────────
  const [selectedLayerIds, setSelectedLayerIds] = useState<Set<string>>(
    () => new Set<string>(),
  );

  // ── Layer tree state ──────────────────────────────────────────────────────
  // The layer tree represents the full hierarchy (groups + layers).
  // For backward compat, the flat `layers` array is still the source of truth
  // for compositing; the tree state is maintained in parallel.
  const [layerTree, setLayerTree] = useState<LayerNode[]>(() =>
    layers.map((layer) => ({ kind: "layer" as const, id: layer.id, layer })),
  );

  // ── History helpers ───────────────────────────────────────────────────────
  /** Push an entry onto the undo stack and clear the redo stack. */
  const pushHistory = useCallback(
    (entry: UndoEntry) => {
      undoStackRef.current.push(entry);
      if (undoStackRef.current.length > 50) undoStackRef.current.shift();
      redoStackRef.current = [];
      setUndoCount(undoStackRef.current.length);
    },
    [undoStackRef, redoStackRef, setUndoCount],
  );

  // ── Multi-select toggle ───────────────────────────────────────────────────
  const handleToggleLayerSelection = useCallback(
    (id: string, shiftHeld: boolean) => {
      if (shiftHeld) {
        setSelectedLayerIds((prev) => {
          const next = new Set(prev);
          if (next.has(id)) {
            next.delete(id);
          } else {
            next.add(id);
          }
          // FIX: Keep the stable ref in sync synchronously so that
          // useTransformSystem.extractFloat always reads the current selection
          // even if it is called in the same event-loop tick as this click
          // (before the useEffect that mirrors state→ref has a chance to fire).
          if (selectedLayerIdsRef) {
            selectedLayerIdsRef.current = next;
          }
          return next;
        });
      } else {
        // Single select — also sets active layer
        const next = new Set([id]);
        setSelectedLayerIds(next);
        setActiveLayerId(id);
        // FIX: sync ref synchronously for single-select as well
        if (selectedLayerIdsRef) {
          selectedLayerIdsRef.current = next;
        }
      }
    },
    [setActiveLayerId, selectedLayerIdsRef],
  );

  // ── Layer CRUD ────────────────────────────────────────────────────────────

  // biome-ignore lint/correctness/useExhaustiveDependencies: selection refs from hook are stable
  const handleAddLayer = useCallback(() => {
    if (transformActiveRef.current || isDraggingFloatRef.current) {
      selectionActionsRef.current.commitFloat({ keepSelection: true });
    }
    const layer = newLayerFn();
    const activeId = activeLayerIdRef.current;
    // Compute the insertion index synchronously from the current layers array so
    // the history entry records the correct index. The setLayers updater uses the
    // same logic against `prev`, which will be the same array in the common case.
    const activeIdx = layers.findIndex((l) => l.id === activeId);
    const insertIdx = activeIdx >= 0 ? activeIdx : 0;
    setLayers((prev) => {
      const ai = prev.findIndex((l) => l.id === activeId);
      const ii = ai >= 0 ? ai : 0;
      const next = [...prev];
      next.splice(ii, 0, layer);
      return next;
    });
    setActiveLayerId(layer.id);
    const newLayerSet = new Set([layer.id]);
    setSelectedLayerIds(newLayerSet);
    // Sync ref synchronously so any code that runs before the next render
    // (e.g. a tool switch immediately after layer add) reads the correct value.
    if (selectedLayerIdsRef) {
      selectedLayerIdsRef.current = newLayerSet;
    }
    setLayerThumbnails((prev) => ({ ...prev, [layer.id]: WHITE_THUMBNAIL }));
    // Also update layer tree (insert at same position)
    setLayerTree((prev) => {
      const newNode = { kind: "layer" as const, id: layer.id, layer };
      const next = [...prev];
      const treeIdx = prev.findIndex(
        (n) => n.kind === "layer" && n.layer.id === activeId,
      );
      const ii = treeIdx >= 0 ? treeIdx : 0;
      next.splice(ii, 0, newNode);
      return next;
    });
    // Use the synchronously-computed insertIdx so undo/redo restores the layer
    // at the correct position. Previously this was hardcoded to 0, which caused
    // redo to insert the layer at the wrong index when the active layer was not
    // at the top of the stack.
    pushHistory({
      type: "layer-add",
      layer,
      index: insertIdx,
      previousActiveLayerId: activeId,
    });
  }, [
    layers,
    newLayerFn,
    setLayers,
    setActiveLayerId,
    activeLayerIdRef,
    pushHistory,
    setLayerThumbnails,
  ]);

  const handleDeleteLayer = useCallback(
    (id: string) => {
      const layerToDelete = layers.find((l) => l.id === id);
      const indexToDelete = layers.findIndex((l) => l.id === id);
      const lcToDelete = layerCanvasesRef.current.get(id);
      if (layerToDelete && indexToDelete !== -1 && lcToDelete) {
        const lcCtx = lcToDelete.getContext("2d", { willReadFrequently: true });
        const pixelsToDelete = lcCtx
          ? lcCtx.getImageData(0, 0, lcToDelete.width, lcToDelete.height)
          : new ImageData(canvasWidth, canvasHeight);
        pushHistory({
          type: "layer-delete",
          layer: layerToDelete,
          pixels: pixelsToDelete,
          index: indexToDelete,
        });
      }
      setLayers((prev) => {
        if (prev.length <= 1) return prev;
        return prev.filter((l) => l.id !== id);
      });
      setActiveLayerId((prev) => {
        if (prev === id) {
          const remaining = layers.filter((l) => l.id !== id);
          return remaining[0]?.id ?? "";
        }
        return prev;
      });
      setSelectedLayerIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        // Sync ref synchronously so callers that read the ref in the same tick
        // (e.g. transform tool) always see the current selection.
        if (selectedLayerIdsRef) {
          selectedLayerIdsRef.current = next;
        }
        return next;
      });
      // Remove from tree
      setLayerTree((prev) => {
        function removeFromTree(nodes: LayerNode[]): LayerNode[] {
          const result: LayerNode[] = [];
          for (const node of nodes) {
            if (node.kind === "layer" && node.layer.id === id) continue;
            if (node.kind === "group") {
              result.push({
                ...node,
                children: removeFromTree(node.children ?? []),
              });
            } else {
              result.push(node);
            }
          }
          return result;
        }
        return removeFromTree(prev);
      });
      layerCanvasesRef.current.delete(id);
      composite();
      markCanvasDirty(); // triggers navigator update
    },
    [
      layers,
      layerCanvasesRef,
      pushHistory,
      setLayers,
      setActiveLayerId,
      composite,
      canvasWidth,
      canvasHeight,
      selectedLayerIdsRef,
    ],
  );

  const handleToggleVisible = useCallback(
    (id: string) => {
      const layer = layers.find((l) => l.id === id);
      if (layer) {
        pushHistory({
          type: "layer-visibility-change",
          layerId: id,
          before: layer.visible !== false,
          after: !(layer.visible !== false),
        });
      }
      setLayers((prev) =>
        prev.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l)),
      );
      setLayerTree((prev) => {
        function updateTree(nodes: LayerNode[]): LayerNode[] {
          return nodes.map((node) => {
            if (node.kind === "layer" && node.layer.id === id) {
              return {
                ...node,
                layer: { ...node.layer, visible: !node.layer.visible },
              };
            }
            if (node.kind === "group") {
              return { ...node, children: updateTree(node.children ?? []) };
            }
            return node;
          });
        }
        return updateTree(prev);
      });
      setTimeout(() => composite(), 0);
    },
    [layers, pushHistory, setLayers, composite],
  );

  const handleRenameLayer = useCallback(
    (id: string, newName: string) => {
      const layer = layers.find((l) => l.id === id);
      if (layer) {
        pushHistory({
          type: "layer-rename",
          layerId: id,
          before: layer.name,
          after: newName,
        });
      }
      setLayers((prev) =>
        prev.map((l) => (l.id === id ? { ...l, name: newName } : l)),
      );
      setLayerTree((prev) => {
        function updateTree(nodes: LayerNode[]): LayerNode[] {
          return nodes.map((node) => {
            if (node.kind === "layer" && node.layer.id === id) {
              return { ...node, layer: { ...node.layer, name: newName } };
            }
            if (node.kind === "group") {
              return { ...node, children: updateTree(node.children ?? []) };
            }
            return node;
          });
        }
        return updateTree(prev);
      });
    },
    [layers, pushHistory, setLayers],
  );

  const handleToggleAlphaLock = useCallback(
    (id: string) => {
      const layer = layers.find((l) => l.id === id);
      if (layer) {
        pushHistory({
          type: "alpha-lock-change",
          layerId: id,
          before: !!layer.alphaLock,
          after: !layer.alphaLock,
        });
      }
      setLayers((prev) =>
        prev.map((l) => (l.id === id ? { ...l, alphaLock: !l.alphaLock } : l)),
      );
      setLayerTree((prev) => {
        function updateTree(nodes: LayerNode[]): LayerNode[] {
          return nodes.map((node) => {
            if (node.kind === "layer" && node.layer.id === id) {
              return {
                ...node,
                layer: { ...node.layer, alphaLock: !node.layer.alphaLock },
              };
            }
            if (node.kind === "group") {
              return { ...node, children: updateTree(node.children ?? []) };
            }
            return node;
          });
        }
        return updateTree(prev);
      });
    },
    [layers, pushHistory, setLayers],
  );

  const handleSetOpacity = useCallback(
    (id: string, opacity: number) => {
      const layer = layers.find((l) => l.id === id);
      if (layer && layer.opacity !== opacity) {
        pushHistory({
          type: "layer-opacity-change",
          layerId: id,
          before: layer.opacity,
          after: opacity,
        });
      }
      setLayers((prev) =>
        prev.map((l) => (l.id === id ? { ...l, opacity } : l)),
      );
      setLayerTree((prev) => {
        function updateTree(nodes: LayerNode[]): LayerNode[] {
          return nodes.map((node) => {
            if (node.kind === "layer" && node.layer.id === id) {
              return { ...node, layer: { ...node.layer, opacity } };
            }
            if (node.kind === "group") {
              return { ...node, children: updateTree(node.children ?? []) };
            }
            return node;
          });
        }
        return updateTree(prev);
      });
      setTimeout(() => composite(), 0);
    },
    [layers, pushHistory, setLayers, composite],
  );

  const handleMergeLayers = useCallback(() => {
    // Ruler layers cannot be merged
    const activeLayerCheck = layers.find(
      (l) => l.id === activeLayerIdRef.current,
    );
    if (activeLayerCheck?.isRuler) return;

    const activeId = activeLayerIdRef.current;
    const activeIdx = layers.findIndex((l) => l.id === activeId);
    if (activeIdx < 0) return;
    const belowLayer = layers[activeIdx + 1];
    if (!belowLayer) return;

    const activeLc = layerCanvasesRef.current.get(activeId);
    const belowLc = layerCanvasesRef.current.get(belowLayer.id);
    if (!activeLc || !belowLc) return;

    const bCtx = belowLc.getContext("2d", { willReadFrequently: true });
    const aCtx = activeLc.getContext("2d", { willReadFrequently: true });
    if (!bCtx || !aCtx) return;

    // Capture before states for history
    const activeLayer = layers[activeIdx];
    const activePixels = aCtx.getImageData(0, 0, canvasWidth, canvasHeight);
    const belowPixelsBefore = bCtx.getImageData(
      0,
      0,
      canvasWidth,
      canvasHeight,
    );

    const activeIsClip = !!activeLayer.isClippingMask;
    const belowIsClip = !!belowLayer.isClippingMask;

    if (activeIsClip && !belowIsClip) {
      // Case: clipping mask merging into its base layer.
      const tmpCanvas = document.createElement("canvas");
      tmpCanvas.width = canvasWidth;
      tmpCanvas.height = canvasHeight;
      const tmpCtx = tmpCanvas.getContext("2d")!;

      tmpCtx.globalAlpha = 1;
      tmpCtx.globalCompositeOperation = "source-over";
      tmpCtx.drawImage(belowLc, 0, 0);

      const clipTmp = document.createElement("canvas");
      clipTmp.width = canvasWidth;
      clipTmp.height = canvasHeight;
      const clipCtx = clipTmp.getContext("2d")!;
      clipCtx.globalAlpha = activeLayer.opacity;
      clipCtx.globalCompositeOperation = "source-over";
      clipCtx.drawImage(activeLc, 0, 0);
      clipCtx.globalCompositeOperation = "destination-in";
      clipCtx.drawImage(belowLc, 0, 0);
      clipCtx.globalCompositeOperation = "source-over";

      tmpCtx.globalAlpha = 1;
      tmpCtx.globalCompositeOperation = (activeLayer.blendMode ||
        "source-over") as GlobalCompositeOperation;
      tmpCtx.drawImage(clipTmp, 0, 0);
      tmpCtx.globalCompositeOperation = "source-over";

      bCtx.clearRect(0, 0, canvasWidth, canvasHeight);
      bCtx.drawImage(tmpCanvas, 0, 0);
      markLayerBitmapDirty(belowLayer.id);
    } else {
      bCtx.globalAlpha = activeLayer.opacity;
      bCtx.globalCompositeOperation = (activeLayer.blendMode ||
        "source-over") as GlobalCompositeOperation;
      bCtx.drawImage(activeLc, 0, 0);
      bCtx.globalAlpha = 1;
      bCtx.globalCompositeOperation = "source-over";
      markLayerBitmapDirty(belowLayer.id);
    }

    const belowPixelsAfter = bCtx.getImageData(0, 0, canvasWidth, canvasHeight);

    const belowLayerIsClippingMaskAfter = activeIsClip && belowIsClip;

    if (belowLayerIsClippingMaskAfter !== belowIsClip) {
      setLayers((prev) =>
        prev.map((l) =>
          l.id === belowLayer.id
            ? { ...l, isClippingMask: belowLayerIsClippingMaskAfter }
            : l,
        ),
      );
    }

    pushHistory({
      type: "layer-merge",
      activeLayer,
      activeIndex: activeIdx,
      activePixels,
      belowLayerId: belowLayer.id,
      belowPixelsBefore,
      belowPixelsAfter,
      belowLayerIsClippingMaskBefore: belowIsClip,
      belowLayerIsClippingMaskAfter,
    });

    markCanvasDirty(belowLayer.id);

    setLayers((prev) => prev.filter((l) => l.id !== activeId));
    setLayerTree((prev) => {
      function removeFromTree(nodes: LayerNode[]): LayerNode[] {
        const result: LayerNode[] = [];
        for (const node of nodes) {
          if (node.kind === "layer" && node.layer.id === activeId) continue;
          if (node.kind === "group") {
            result.push({
              ...node,
              children: removeFromTree(node.children ?? []),
            });
          } else {
            result.push(node);
          }
        }
        return result;
      }
      return removeFromTree(prev);
    });
    setActiveLayerId(belowLayer.id);
    layerCanvasesRef.current.delete(activeId);
    setTimeout(() => composite(), 0);
    markCanvasDirty(); // navigator update
  }, [
    layers,
    setLayers,
    activeLayerIdRef,
    layerCanvasesRef,
    setActiveLayerId,
    composite,
    pushHistory,
    canvasWidth,
    canvasHeight,
    markLayerBitmapDirty,
  ]);

  const handleMergeLayersRef = useRef(handleMergeLayers);
  useEffect(() => {
    handleMergeLayersRef.current = handleMergeLayers;
  }, [handleMergeLayers]);

  const handleToggleClippingMask = useCallback(() => {
    const activeId = activeLayerIdRef.current;
    const layer = layers.find((l) => l.id === activeId);
    if (layer) {
      pushHistory({
        type: "clipping-mask-change",
        layerId: activeId,
        before: !!layer.isClippingMask,
        after: !layer.isClippingMask,
      });
    }
    setLayers((prev) =>
      prev.map((l) =>
        l.id === activeId ? { ...l, isClippingMask: !l.isClippingMask } : l,
      ),
    );
    setLayerTree((prev) => {
      function updateTree(nodes: LayerNode[]): LayerNode[] {
        return nodes.map((node) => {
          if (node.kind === "layer" && node.layer.id === activeId) {
            return {
              ...node,
              layer: {
                ...node.layer,
                isClippingMask: !node.layer.isClippingMask,
              },
            };
          }
          if (node.kind === "group") {
            return { ...node, children: updateTree(node.children ?? []) };
          }
          return node;
        });
      }
      return updateTree(prev);
    });
    setTimeout(() => composite(), 0);
  }, [layers, pushHistory, setLayers, activeLayerIdRef, composite]);

  const handleToggleClippingMaskRef = useRef(handleToggleClippingMask);
  useEffect(() => {
    handleToggleClippingMaskRef.current = handleToggleClippingMask;
  }, [handleToggleClippingMask]);

  const handleReorderLayers = useCallback(
    (ids: string[]) => {
      setLayers((prev) => {
        const map = new Map(prev.map((l) => [l.id, l]));
        return ids.map((id) => map.get(id)!).filter(Boolean);
      });
      setTimeout(() => composite(), 0);
    },
    [setLayers, composite],
  );

  /** Replace the entire layer tree (used for drag-and-drop reordering with groups) */
  const handleReorderTree = useCallback(
    (newTree: LayerNode[]) => {
      // Capture before state for undo
      const treeBefore = layerTree;
      const layersBefore = layers.slice();

      setLayerTree(newTree);
      // Sync flat layers array from tree
      const flat: Layer[] = [];
      function collectLayers(nodes: LayerNode[]) {
        for (const node of nodes) {
          if (node.kind === "layer") {
            flat.push(node.layer);
          } else {
            collectLayers(node.children ?? []);
          }
        }
      }
      collectLayers(newTree);
      setLayers(flat);

      pushHistory({
        type: "layer-reorder",
        treeBefore,
        treeAfter: newTree,
        layersBefore,
        layersAfter: flat,
      });

      setTimeout(() => composite(), 0);
    },
    [layerTree, layers, setLayers, composite, pushHistory],
  );

  const handleSetLayerBlendMode = useCallback(
    (id: string, blendMode: string) => {
      const currentLayer = layers.find((l) => l.id === id);
      if (currentLayer) {
        const currentBlendMode = currentLayer.blendMode || "source-over";
        pushHistory({
          type: "blend-mode",
          layerId: id,
          before: currentBlendMode,
          after: blendMode,
        });
      }
      setLayers((prev) =>
        prev.map((l) => (l.id === id ? { ...l, blendMode } : l)),
      );
      setLayerTree((prev) => {
        function updateTree(nodes: LayerNode[]): LayerNode[] {
          return nodes.map((node) => {
            if (node.kind === "layer" && node.layer.id === id) {
              return { ...node, layer: { ...node.layer, blendMode } };
            }
            if (node.kind === "group") {
              return { ...node, children: updateTree(node.children ?? []) };
            }
            return node;
          });
        }
        return updateTree(prev);
      });
      setTimeout(() => composite(), 0);
    },
    [layers, pushHistory, setLayers, composite],
  );

  // ── Group handlers ────────────────────────────────────────────────────────

  /**
   * Create a layer group from the currently selected layers.
   * If nothing is selected, creates an empty group at the top.
   */
  const handleCreateGroup = useCallback(() => {
    const selectedIds = Array.from(selectedLayerIds);
    const groupName = `Group ${Date.now().toString().slice(-4)}`;

    // Capture state before grouping for undo
    const treeBefore = layerTree;
    const layersBefore = layers.slice();

    const { tree, groupId } = groupNodes(layerTree, selectedIds, groupName);
    setLayerTree(tree);
    // Sync flat layers
    const flat: Layer[] = [];
    function collectLayers(nodes: LayerNode[]) {
      for (const node of nodes) {
        if (node.kind === "layer") flat.push(node.layer);
        else collectLayers(node.children ?? []);
      }
    }
    collectLayers(tree);
    setLayers(flat);
    // Select the new group
    setSelectedLayerIds(new Set([groupId]));

    // BUG_1 FIX: Set the active layer to the first paintable child of the new group.
    // Without this, activeLayerId stays pointing at whatever it was before grouping,
    // which may be a group ID (no canvas) and will silently break painting tools.
    function findFirstChildLayer(nodes: LayerNode[]): string | null {
      for (const node of nodes) {
        if (node.id === groupId && node.kind === "group") {
          // Found the group — walk its children to find the first paintable layer
          function firstLeaf(ns: LayerNode[]): string | null {
            for (const n of ns) {
              if (n.kind === "layer") return n.layer.id;
              const found = firstLeaf(n.children ?? []);
              if (found) return found;
            }
            return null;
          }
          return firstLeaf(node.children ?? []);
        }
        if (node.kind === "group") {
          const found = findFirstChildLayer(node.children ?? []);
          if (found) return found;
        }
      }
      return null;
    }
    const firstChildId = findFirstChildLayer(tree);
    if (firstChildId) {
      setActiveLayerId(firstChildId);
    }

    setTimeout(() => composite(), 0);

    // Push undo entry
    pushHistory({
      type: "layer-group-create",
      treeBefore,
      treeAfter: tree,
      layersBefore,
      layersAfter: flat,
    });
  }, [
    selectedLayerIds,
    layerTree,
    layers,
    setLayers,
    setActiveLayerId,
    composite,
    pushHistory,
  ]);

  /**
   * Toggle a group's collapsed state.
   */
  const handleToggleGroupCollapse = useCallback((groupId: string) => {
    setLayerTree((prev) => {
      function updateTree(nodes: LayerNode[]): LayerNode[] {
        return nodes.map((node) => {
          if (node.kind === "group" && node.id === groupId) {
            return { ...node, collapsed: !node.collapsed };
          }
          if (node.kind === "group") {
            return { ...node, children: updateTree(node.children ?? []) };
          }
          return node;
        });
      }
      return updateTree(prev);
    });
  }, []);

  /**
   * Rename a group.
   */
  const handleRenameGroup = useCallback((groupId: string, name: string) => {
    setLayerTree((prev) => {
      function updateTree(nodes: LayerNode[]): LayerNode[] {
        return nodes.map((node) => {
          if (node.kind === "group" && node.id === groupId) {
            return { ...node, name };
          }
          if (node.kind === "group") {
            return { ...node, children: updateTree(node.children ?? []) };
          }
          return node;
        });
      }
      return updateTree(prev);
    });
  }, []);

  /**
   * Set opacity on a group (cascades to all children during compositing).
   */
  const handleSetGroupOpacity = useCallback(
    (groupId: string, opacity: number) => {
      // Find current group opacity for history
      function findGroupOpacity(nodes: LayerNode[]): number | null {
        for (const node of nodes) {
          if (node.kind === "group" && node.id === groupId) {
            return node.opacity ?? 1;
          }
          if (node.kind === "group") {
            const found = findGroupOpacity(node.children ?? []);
            if (found !== null) return found;
          }
        }
        return null;
      }
      const prevOpacity = findGroupOpacity(layerTree);
      if (prevOpacity !== null && prevOpacity !== opacity) {
        pushHistory({
          type: "group-opacity-change",
          groupId,
          before: prevOpacity,
          after: opacity,
        });
      }
      setLayerTree((prev) => {
        function updateTree(nodes: LayerNode[]): LayerNode[] {
          return nodes.map((node) => {
            if (node.kind === "group" && node.id === groupId) {
              return { ...node, opacity };
            }
            if (node.kind === "group") {
              return { ...node, children: updateTree(node.children ?? []) };
            }
            return node;
          });
        }
        return updateTree(prev);
      });
      setTimeout(() => composite(), 0);
    },
    [layerTree, pushHistory, composite],
  );

  /**
   * Toggle visibility on a group (does NOT change children.visible).
   */
  const handleToggleGroupVisible = useCallback(
    (groupId: string) => {
      setLayerTree((prev) => {
        function updateTree(nodes: LayerNode[]): LayerNode[] {
          return nodes.map((node) => {
            if (node.kind === "group" && node.id === groupId) {
              return { ...node, visible: !node.visible };
            }
            if (node.kind === "group") {
              return { ...node, children: updateTree(node.children ?? []) };
            }
            return node;
          });
        }
        return updateTree(prev);
      });
      setTimeout(() => composite(), 0);
    },
    [composite],
  );

  /**
   * Delete a group.
   * @param deleteChildren — if true, also delete all layer canvases/data inside.
   *                         if false, release layers from the group (ungroup them).
   */
  const handleDeleteGroup = useCallback(
    (groupId: string, deleteChildren: boolean) => {
      // Capture before state for undo
      const treeBefore = layerTree;
      const layersBefore = layers.slice();

      function collectFlat(nodes: LayerNode[]): Layer[] {
        const flat: Layer[] = [];
        function recurse(ns: LayerNode[]) {
          for (const node of ns) {
            if (node.kind === "layer") flat.push(node.layer);
            else recurse(node.children ?? []);
          }
        }
        recurse(nodes);
        return flat;
      }

      let newTree: LayerNode[];
      let deletedCanvases: Map<string, ImageData> = new Map();

      if (deleteChildren) {
        // Collect canvas data for deleted layers before removing them
        function collectGroupLayerIds(nodes: LayerNode[]): string[] {
          const ids: string[] = [];
          for (const node of nodes) {
            if (node.id === groupId && node.kind === "group") {
              function gatherIds(ns: LayerNode[]) {
                for (const n of ns) {
                  if (n.kind === "layer") ids.push(n.layer.id);
                  else gatherIds(n.children ?? []);
                }
              }
              gatherIds(node.children ?? []);
            } else if (node.kind === "group") {
              ids.push(...collectGroupLayerIds(node.children ?? []));
            }
          }
          return ids;
        }
        for (const layerId of collectGroupLayerIds(layerTree)) {
          const lc = layerCanvasesRef.current.get(layerId);
          if (lc) {
            const ctx = lc.getContext("2d", { willReadFrequently: true });
            if (ctx) {
              deletedCanvases.set(
                layerId,
                ctx.getImageData(0, 0, lc.width, lc.height),
              );
            }
          }
        }

        // Remove group and all children
        function removeGroupAndChildren(nodes: LayerNode[]): LayerNode[] {
          const result: LayerNode[] = [];
          for (const node of nodes) {
            if (node.id === groupId) continue; // skip entire subtree
            if (node.kind === "group") {
              result.push({
                ...node,
                children: removeGroupAndChildren(node.children ?? []),
              });
            } else {
              result.push(node);
            }
          }
          return result;
        }
        newTree = removeGroupAndChildren(layerTree);
      } else {
        // Ungroup: release children in place
        newTree = ungroupNodes(layerTree, groupId);
      }

      const layersAfter = collectFlat(newTree);

      setLayerTree(newTree);
      setLayers(layersAfter);
      setTimeout(() => composite(), 0);

      setSelectedLayerIds((prev) => {
        const next = new Set(prev);
        next.delete(groupId);
        return next;
      });

      // Push undo entry
      pushHistory({
        type: "layer-group-delete",
        treeBefore,
        treeAfter: newTree,
        layersBefore,
        layersAfter,
        deletedCanvases,
      });
    },
    [layerTree, layers, layerCanvasesRef, setLayers, composite, pushHistory],
  );

  /**
   * Move a node (layer or group) into a target group as its first child.
   */
  const handleMoveNodeIntoGroup = useCallback(
    (nodeId: string, groupId: string) => {
      setLayerTree((prev) => {
        // Find the node being moved
        function findAndRemove(
          nodes: LayerNode[],
        ): [LayerNode | null, LayerNode[]] {
          let found: LayerNode | null = null;
          const result: LayerNode[] = [];
          for (const node of nodes) {
            if (node.id === nodeId) {
              found = node;
              continue;
            }
            if (node.kind === "group") {
              const [f, children] = findAndRemove(node.children ?? []);
              if (f) found = f;
              result.push({ ...node, children });
            } else {
              result.push(node);
            }
          }
          return [found, result];
        }
        const [movingNode, withoutNode] = findAndRemove(prev);
        if (!movingNode) return prev;

        function insertIntoGroup(nodes: LayerNode[]): LayerNode[] {
          return nodes.map((node) => {
            if (node.kind === "group" && node.id === groupId) {
              return {
                ...node,
                children: [movingNode!, ...(node.children ?? [])],
              };
            }
            if (node.kind === "group") {
              return {
                ...node,
                children: insertIntoGroup(node.children ?? []),
              };
            }
            return node;
          });
        }
        const newTree = insertIntoGroup(withoutNode);
        // Sync flat layers
        const flat: Layer[] = [];
        function collectLayers(nodes: LayerNode[]) {
          for (const node of nodes) {
            if (node.kind === "layer") flat.push(node.layer);
            else collectLayers(node.children ?? []);
          }
        }
        collectLayers(newTree);
        setLayers(flat);
        return newTree;
      });
      setTimeout(() => composite(), 0);
    },
    [setLayers, composite],
  );

  // Keep a stable ref to generateGroupId for external use
  const generateGroupIdFn = useCallback(() => generateGroupId(), []);

  return {
    // Existing handlers (backward compat)
    handleAddLayer,
    handleDeleteLayer,
    handleToggleVisible,
    handleRenameLayer,
    handleToggleAlphaLock,
    handleSetOpacity,
    handleMergeLayers,
    handleMergeLayersRef,
    handleToggleClippingMask,
    handleToggleClippingMaskRef,
    handleReorderLayers,
    handleSetLayerBlendMode,
    // New tree-aware handlers
    handleReorderTree,
    // Group handlers
    handleCreateGroup,
    handleDeleteGroup,
    handleToggleGroupCollapse,
    handleRenameGroup,
    handleSetGroupOpacity,
    handleToggleGroupVisible,
    handleMoveNodeIntoGroup,
    // Multi-select
    selectedLayerIds,
    setSelectedLayerIds,
    handleToggleLayerSelection,
    // Tree state
    layerTree,
    setLayerTree,
    // Utility
    generateGroupId: generateGroupIdFn,
  };
}
