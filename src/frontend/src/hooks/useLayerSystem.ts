import { useCallback, useEffect, useRef } from "react";
import type React from "react";
import type { Layer } from "../components/LayersPanel";
import type { SelectionSnapshot } from "../selectionTypes";
import type {
  Layer as FlatLayer,
  GroupHeader,
  PaintLayer,
  RulerFields,
} from "../types";
import {
  createGroupPair,
  generateGroupId,
  getGroupIdCounter,
  getGroupSlice,
  isFlatEndGroup,
  isFlatGroupHeader,
  isFlatLayer,
  setGroupIdCounter,
} from "../utils/groupUtils";
import { evictLayerBitmap, markCanvasDirty } from "./useCompositing";
import { useRefState } from "./useRefState";

// Module-level reusable canvas for thumbnail generation in layer ops
const _layerSysThumbCanvas = document.createElement("canvas");
_layerSysThumbCanvas.width = 144;
_layerSysThumbCanvas.height = 144;

// Module-level reusable canvases for merge-down clipping mask compositing
// (prevents per-merge allocation leaks at large canvas sizes)
const _mergeTmpCanvas = document.createElement("canvas");
_mergeTmpCanvas.width = 1;
_mergeTmpCanvas.height = 1;
const _mergeClipTmpCanvas = document.createElement("canvas");
_mergeClipTmpCanvas.width = 1;
_mergeClipTmpCanvas.height = 1;
const _layerSysThumbCtx = _layerSysThumbCanvas.getContext("2d", {
  willReadFrequently: true,
})!;
void _layerSysThumbCtx; // referenced for side-effects only

// Pre-computed white thumbnail data URL (avoids per-layer-add canvas allocation)
const _whiteThumbnailCanvas = document.createElement("canvas");
_whiteThumbnailCanvas.width = 144;
_whiteThumbnailCanvas.height = 144;
const _whiteThumbnailCtx = _whiteThumbnailCanvas.getContext("2d")!;
_whiteThumbnailCtx.fillStyle = "#ffffff";
_whiteThumbnailCtx.fillRect(0, 0, 144, 144);
const WHITE_THUMBNAIL = _whiteThumbnailCanvas.toDataURL();

export type RulerState = Omit<RulerFields, "isRuler" | "rulerActive">;

// ── History entry types ───────────────────────────────────────────────────────
//
// The canonical history entry for layer-state changes stores full flat-array
// snapshots.  Individual-property entries (blend-mode, opacity, etc.) are kept
// for lightweight changes that don't need a full snapshot, but group create/
// delete/reorder all use layersBefore/layersAfter.

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
      belowLayerIsClippingMaskBefore: boolean;
      belowLayerIsClippingMaskAfter: boolean;
      dirtyRect?: { x: number; y: number; w: number; h: number };
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
      /** Flat-array snapshot for group create (new architecture). */
      type: "layer-group-create";
      layersBefore: Layer[];
      layersAfter: Layer[];
      counterBefore?: number;
      counterAfter?: number;
      // Legacy tree fields kept for useHistory backward compat (unused here)
      treeBefore?: import("../types").LayerNode[];
      treeAfter?: import("../types").LayerNode[];
    }
  | {
      /** Flat-array snapshot for group delete (new architecture). */
      type: "layer-group-delete";
      layersBefore: Layer[];
      layersAfter: Layer[];
      deletedCanvases: Map<string, ImageData>;
      // Legacy tree fields kept for useHistory backward compat (unused here)
      treeBefore?: import("../types").LayerNode[];
      treeAfter?: import("../types").LayerNode[];
    }
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
      type: "lock-layer-change";
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
      layersBefore: Layer[];
      layersAfter: Layer[];
      // Legacy tree fields kept for useHistory backward compat (unused here)
      treeBefore?: import("../types").LayerNode[];
      treeAfter?: import("../types").LayerNode[];
    }
  | {
      type: "multi-layer-pixels";
      layers: Map<
        string,
        {
          before: ImageData;
          after: ImageData;
          dirtyRect?: { x: number; y: number; w: number; h: number };
        }
      >;
    };

// ── Entry handler types ───────────────────────────────────────────────────────

type LayerSystemEntry = Extract<
  UndoEntry,
  | { type: "blend-mode" }
  | { type: "layer-opacity-change" }
  | { type: "group-opacity-change" }
  | { type: "layer-visibility-change" }
  | { type: "alpha-lock-change" }
  | { type: "lock-layer-change" }
  | { type: "clipping-mask-change" }
  | { type: "layer-rename" }
  | { type: "layer-reorder" }
  | { type: "layer-group-create" }
  | { type: "layer-group-delete" }
>;

export type { LayerSystemEntry };

// ── Prop types ────────────────────────────────────────────────────────────────

// Convenience cast: convert FlatLayer[] (types.ts) → Layer[] (LayersPanel.tsx).
// These are identical at runtime — only TypeScript sees them as different types.
const asLegacyLayers = (arr: FlatLayer[]): Layer[] => arr as unknown as Layer[];

interface UseLayerSystemProps {
  layers: Layer[];
  setLayers: React.Dispatch<React.SetStateAction<Layer[]>>;
  setActiveLayerId: React.Dispatch<React.SetStateAction<string>>;
  composite: () => void;
  setUndoCount: (n: number) => void;
  newLayerFn: () => Layer;
  canvasWidth: number;
  canvasHeight: number;
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
    extractFloat: (
      fromSel: boolean,
      opts?: { fromToolActivation?: boolean },
    ) => void;
  }>;
  setLayerThumbnails: React.Dispatch<
    React.SetStateAction<Record<string, string>>
  >;
  markLayerBitmapDirty: (id: string) => void;
  selectedLayerIdsRef?: React.MutableRefObject<Set<string>>;
  onGroupDeleteConfirm?: (groupId: string, deleteChildren: boolean) => void;
  /**
   * Canvas integrity utility from PaintingApp — returns a correctly-sized
   * HTMLCanvasElement for the given layerId, creating or resizing it if needed.
   * Must be called immediately after any new layer object is inserted into the
   * layers array so the canvas exists before composite() or flushStrokeBuffer() runs.
   */
  getOrCreateLayerCanvas: (layerId: string) => HTMLCanvasElement;
}

// ── useLayerSystem ────────────────────────────────────────────────────────────

export function useLayerSystem({
  layers: _layers,
  setLayers: _setLayers,
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
  getOrCreateLayerCanvas,
}: UseLayerSystemProps) {
  // Cast to the new discriminated-union type internally.
  // At runtime these are the same objects — the legacy Layer type from
  // LayersPanel simply lacks the `type` discriminant in its TypeScript definition.
  const layers = _layers as FlatLayer[];
  // Wrapper that accepts FlatLayer[] and forwards to the original dispatch.
  // Using a stable ref ensures useCallback deps don't flag this as unstable.
  const setLayersRef = useRef(_setLayers);
  setLayersRef.current = _setLayers;
  const setLayers = useCallback(
    (arg: FlatLayer[] | Layer[] | ((prev: FlatLayer[]) => FlatLayer[])) => {
      if (typeof arg === "function") {
        setLayersRef.current(
          (prev) => arg(prev as FlatLayer[]) as unknown as Layer[],
        );
      } else {
        setLayersRef.current(arg as unknown as Layer[]);
      }
    },
    [],
  );
  // ── Multi-select state ────────────────────────────────────────────────────
  const [selectedLayerIds, _selectedLayerIdsRef, setSelectedLayerIds] =
    useRefState<Set<string>>(new Set<string>());

  // biome-ignore lint/correctness/useExhaustiveDependencies: _selectedLayerIdsRef is a stable ref object
  useEffect(() => {
    if (selectedLayerIdsRef) {
      selectedLayerIdsRef.current = _selectedLayerIdsRef.current;
    }
  }, [selectedLayerIds, selectedLayerIdsRef]);

  // ── History helpers ───────────────────────────────────────────────────────
  const pushHistory = useCallback(
    (entry: UndoEntry) => {
      undoStackRef.current.push(entry);
      if (undoStackRef.current.length > 50) undoStackRef.current.shift();
      redoStackRef.current = [];
      setUndoCount(undoStackRef.current.length);
    },
    [undoStackRef, redoStackRef, setUndoCount],
  );

  // ── applyLayerEntry / undoLayerEntry ─────────────────────────────────────
  // These own undo/redo logic for pure layer-state entry types.

  const undoLayerEntry = useCallback(
    (entry: LayerSystemEntry) => {
      switch (entry.type) {
        case "blend-mode":
          setLayers((prev) =>
            prev.map((l) =>
              l.id === entry.layerId ? { ...l, blendMode: entry.before } : l,
            ),
          );
          break;

        case "layer-opacity-change":
          setLayers((prev) =>
            prev.map((l) =>
              l.id === entry.layerId ? { ...l, opacity: entry.before } : l,
            ),
          );
          break;

        case "group-opacity-change":
          setLayers((prev) =>
            prev.map((l) =>
              l.id === entry.groupId && l.type === "group"
                ? { ...l, opacity: entry.before }
                : l,
            ),
          );
          break;

        case "layer-visibility-change":
          setLayers((prev) =>
            prev.map((l) =>
              l.id === entry.layerId ? { ...l, visible: entry.before } : l,
            ),
          );
          break;

        case "alpha-lock-change":
          setLayers((prev) =>
            prev.map((l) =>
              l.id === entry.layerId ? { ...l, alphaLock: entry.before } : l,
            ),
          );
          break;

        case "lock-layer-change":
          setLayers((prev) =>
            prev.map((l) =>
              l.id === entry.layerId ? { ...l, isLocked: entry.before } : l,
            ),
          );
          break;

        case "clipping-mask-change":
          setLayers((prev) =>
            prev.map((l) =>
              l.id === entry.layerId
                ? { ...l, isClippingMask: entry.before }
                : l,
            ),
          );
          break;

        case "layer-rename":
          setLayers((prev) =>
            prev.map((l) =>
              l.id === entry.layerId ? { ...l, name: entry.before } : l,
            ),
          );
          break;

        case "layer-reorder":
          setLayers(entry.layersBefore);
          break;

        case "layer-group-create":
          if (entry.counterBefore !== undefined) {
            setGroupIdCounter(entry.counterBefore);
          }
          setLayers(entry.layersBefore);
          break;

        case "layer-group-delete":
          setLayers(entry.layersBefore);
          break;
      }
    },
    [setLayers],
  );

  const applyLayerEntry = useCallback(
    (entry: LayerSystemEntry) => {
      switch (entry.type) {
        case "blend-mode":
          setLayers((prev) =>
            prev.map((l) =>
              l.id === entry.layerId ? { ...l, blendMode: entry.after } : l,
            ),
          );
          break;

        case "layer-opacity-change":
          setLayers((prev) =>
            prev.map((l) =>
              l.id === entry.layerId ? { ...l, opacity: entry.after } : l,
            ),
          );
          break;

        case "group-opacity-change":
          setLayers((prev) =>
            prev.map((l) =>
              l.id === entry.groupId && l.type === "group"
                ? { ...l, opacity: entry.after }
                : l,
            ),
          );
          break;

        case "layer-visibility-change":
          setLayers((prev) =>
            prev.map((l) =>
              l.id === entry.layerId ? { ...l, visible: entry.after } : l,
            ),
          );
          break;

        case "alpha-lock-change":
          setLayers((prev) =>
            prev.map((l) =>
              l.id === entry.layerId ? { ...l, alphaLock: entry.after } : l,
            ),
          );
          break;

        case "lock-layer-change":
          setLayers((prev) =>
            prev.map((l) =>
              l.id === entry.layerId ? { ...l, isLocked: entry.after } : l,
            ),
          );
          break;

        case "clipping-mask-change":
          setLayers((prev) =>
            prev.map((l) =>
              l.id === entry.layerId
                ? { ...l, isClippingMask: entry.after }
                : l,
            ),
          );
          break;

        case "layer-rename":
          setLayers((prev) =>
            prev.map((l) =>
              l.id === entry.layerId ? { ...l, name: entry.after } : l,
            ),
          );
          break;

        case "layer-reorder":
          setLayers(entry.layersAfter);
          break;

        case "layer-group-create":
          if (entry.counterAfter !== undefined) {
            setGroupIdCounter(entry.counterAfter);
          }
          setLayers(entry.layersAfter);
          break;

        case "layer-group-delete":
          setLayers(entry.layersAfter);
          break;
      }
    },
    [setLayers],
  );

  // ── Multi-select toggle ───────────────────────────────────────────────────
  // biome-ignore lint/correctness/useExhaustiveDependencies: setSelectedLayerIds from useRefState is stable
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
          if (selectedLayerIdsRef) {
            selectedLayerIdsRef.current = next;
          }
          return next;
        });
      } else {
        const next = new Set([id]);
        setSelectedLayerIds(next);
        setActiveLayerId(id);
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
    const activeIdx = layers.findIndex((l) => l.id === activeId);
    const insertIdx = activeIdx >= 0 ? activeIdx : 0;

    // FIX 1: Create the canvas BEFORE any React state update so flushStrokeBuffer
    // and composite() never see this layer as missing.
    getOrCreateLayerCanvas(layer.id);

    setLayers((prev) => {
      const ai = prev.findIndex((l) => l.id === activeId);
      // Clamp so we never insert inside an end_group
      let ii = ai >= 0 ? ai : 0;
      // Walk backwards past any group headers at this position to stay inside the same group
      while (ii > 0 && prev[ii]?.type === "end_group") ii--;
      const next = [...prev];
      next.splice(ii, 0, layer as unknown as FlatLayer);
      return next;
    });

    setActiveLayerId(layer.id);
    const newLayerSet = new Set([layer.id]);
    setSelectedLayerIds(newLayerSet);
    if (selectedLayerIdsRef) {
      selectedLayerIdsRef.current = newLayerSet;
    }
    setLayerThumbnails((prev) => ({ ...prev, [layer.id]: WHITE_THUMBNAIL }));

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
    getOrCreateLayerCanvas,
  ]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: setSelectedLayerIds from useRefState is stable
  const handleDeleteLayer = useCallback(
    (id: string) => {
      // end_group entries cannot be deleted directly
      const target = layers.find((l) => l.id === id);
      if (!target || target.type === "end_group") return;

      // If it's a group header, remove the entire slice (header + children + end_group)
      if (target.type === "group") {
        const flatLayers = layers as import("../utils/groupUtils").FlatEntry[];
        const slice = getGroupSlice(flatLayers, id);
        if (slice) {
          const layersBefore = layers.slice();
          // Collect deleted canvases for undo, then immediately release them from
          // layerCanvasesRef and the GPU bitmap cache so GC can reclaim the memory.
          // Previously this path only read the canvas pixels but never removed the canvas
          // from the map, causing all child canvases to leak for the lifetime of the document.
          const deletedCanvases = new Map<string, ImageData>();
          for (const entry of slice.entries) {
            if (isFlatLayer(entry)) {
              const lc = layerCanvasesRef.current.get(entry.id);
              if (lc) {
                const ctx = lc.getContext("2d", { willReadFrequently: true });
                if (ctx)
                  deletedCanvases.set(
                    entry.id,
                    ctx.getImageData(0, 0, lc.width, lc.height),
                  );
                // Release canvas and GPU bitmap so GC can reclaim memory immediately.
                layerCanvasesRef.current.delete(entry.id);
                evictLayerBitmap(entry.id);
              }
            }
          }
          const layersAfter = [
            ...layers.slice(0, slice.startIndex),
            ...layers.slice(slice.endIndex + 1),
          ];
          setLayers(layersAfter);
          setActiveLayerId((prev) => {
            const remaining = layersAfter.filter(
              (l) => l.type !== "group" && l.type !== "end_group",
            );
            if (remaining.find((l) => l.id === prev)) return prev;
            return remaining[0]?.id ?? "";
          });
          setSelectedLayerIds((prev) => {
            const next = new Set(prev);
            next.delete(id);
            if (selectedLayerIdsRef) selectedLayerIdsRef.current = next;
            return next;
          });
          pushHistory({
            type: "layer-group-delete",
            layersBefore: asLegacyLayers(layersBefore),
            layersAfter: asLegacyLayers(layersAfter),
            deletedCanvases,
          });
          composite();
          markCanvasDirty();
        }
        return;
      }

      // Regular paint layer
      const indexToDelete = layers.findIndex((l) => l.id === id);
      const lcToDelete = layerCanvasesRef.current.get(id);
      if (target && indexToDelete !== -1 && lcToDelete) {
        const lcCtx = lcToDelete.getContext("2d", { willReadFrequently: true });
        const pixelsToDelete = lcCtx
          ? lcCtx.getImageData(0, 0, lcToDelete.width, lcToDelete.height)
          : new ImageData(canvasWidth, canvasHeight);
        pushHistory({
          type: "layer-delete",
          layer: target as Layer,
          pixels: pixelsToDelete,
          index: indexToDelete,
        });
      }

      setLayers((prev) => {
        if (
          prev.filter((l) => l.type !== "group" && l.type !== "end_group")
            .length <= 1
        )
          return prev;
        return prev.filter((l) => l.id !== id);
      });
      setActiveLayerId((prev) => {
        if (prev === id) {
          const remaining = layers.filter(
            (l) => l.id !== id && l.type !== "group" && l.type !== "end_group",
          );
          return remaining[0]?.id ?? "";
        }
        return prev;
      });
      setSelectedLayerIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        if (selectedLayerIdsRef) {
          selectedLayerIdsRef.current = next;
        }
        return next;
      });
      layerCanvasesRef.current.delete(id);
      evictLayerBitmap(id);
      composite();
      markCanvasDirty();
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
      if (!layer || layer.type === "end_group") return;
      const currentVisible =
        layer.type === "group"
          ? (layer as GroupHeader).visible
          : (layer as PaintLayer).visible !== false;
      pushHistory({
        type: "layer-visibility-change",
        layerId: id,
        before: currentVisible,
        after: !currentVisible,
      });
      setLayers((prev) =>
        prev.map((l) => (l.id === id ? { ...l, visible: !currentVisible } : l)),
      );
      setTimeout(() => composite(), 0);
    },
    [layers, pushHistory, setLayers, composite],
  );

  const handleRenameLayer = useCallback(
    (id: string, newName: string) => {
      const layer = layers.find((l) => l.id === id);
      if (!layer || layer.type === "end_group") return;
      const oldName = (layer as PaintLayer | GroupHeader).name;
      pushHistory({
        type: "layer-rename",
        layerId: id,
        before: oldName,
        after: newName,
      });
      setLayers((prev) =>
        prev.map((l) => (l.id === id ? { ...l, name: newName } : l)),
      );
    },
    [layers, pushHistory, setLayers],
  );

  const handleToggleAlphaLock = useCallback(
    (id: string) => {
      const layer = layers.find((l) => l.id === id);
      if (!layer || layer.type === "group" || layer.type === "end_group")
        return;
      const pl = layer as PaintLayer;
      pushHistory({
        type: "alpha-lock-change",
        layerId: id,
        before: !!pl.alphaLock,
        after: !pl.alphaLock,
      });
      setLayers((prev) =>
        prev.map((l) => (l.id === id ? { ...l, alphaLock: !pl.alphaLock } : l)),
      );
    },
    [layers, pushHistory, setLayers],
  );

  const handleToggleLockLayer = useCallback(
    (id: string) => {
      const layer = layers.find((l) => l.id === id);
      if (!layer || layer.type === "group" || layer.type === "end_group")
        return;
      const pl = layer as PaintLayer;
      const before = !!pl.isLocked;
      const after = !before;
      pushHistory({
        type: "lock-layer-change",
        layerId: id,
        before,
        after,
      });
      setLayers((prev) =>
        prev.map((l) => (l.id === id ? { ...l, isLocked: after } : l)),
      );
    },
    [layers, pushHistory, setLayers],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: setSelectedLayerIds from useRefState is stable
  const handleDuplicateLayer = useCallback(() => {
    const activeId = activeLayerIdRef.current;
    const sourceLayer = layers.find((l) => l.id === activeId);
    if (!sourceLayer || sourceLayer.type === "end_group") return;

    // Create a new layer object cloned from source
    const newId = `layer_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const sourcePl = sourceLayer as PaintLayer;
    const duplicateLayer: PaintLayer = {
      ...sourcePl,
      id: newId,
      name: `${sourcePl.name} copy`,
      isLocked: false, // duplicates are unlocked by default
    };

    // Create the canvas and copy pixel data
    const sourceCanvas = getOrCreateLayerCanvas(activeId);
    const newCanvas = getOrCreateLayerCanvas(newId);
    const newCtx = newCanvas.getContext("2d");
    if (newCtx) {
      newCtx.drawImage(sourceCanvas, 0, 0);
    }

    const activeIdx = layers.findIndex((l) => l.id === activeId);
    const insertIdx = activeIdx >= 0 ? activeIdx : 0;

    setLayers((prev) => {
      const ai = prev.findIndex((l) => l.id === activeId);
      const ii = ai >= 0 ? ai : 0;
      const next = [...prev];
      next.splice(ii, 0, duplicateLayer as unknown as FlatLayer);
      return next;
    });

    setActiveLayerId(newId);
    const newLayerSet = new Set([newId]);
    setSelectedLayerIds(newLayerSet);
    if (selectedLayerIdsRef) {
      selectedLayerIdsRef.current = newLayerSet;
    }
    setLayerThumbnails((prev) => {
      const sourceThumbnail = prev[activeId] ?? WHITE_THUMBNAIL;
      return { ...prev, [newId]: sourceThumbnail };
    });

    pushHistory({
      type: "layer-add",
      layer: duplicateLayer as unknown as Layer,
      index: insertIdx,
      previousActiveLayerId: activeId,
    });
    markLayerBitmapDirty(newId);
    setTimeout(() => composite(), 0);
    markCanvasDirty(newId);
  }, [
    layers,
    setLayers,
    setActiveLayerId,
    activeLayerIdRef,
    pushHistory,
    setLayerThumbnails,
    getOrCreateLayerCanvas,
    markLayerBitmapDirty,
    composite,
    selectedLayerIdsRef,
  ]);

  /** Cut selected pixels to a new layer directly above the active layer. */
  const handleCutToNewLayer = useCallback(() => {
    if (!selectionActionsRef.current) return;
    selectionActionsRef.current.cutOrCopyToLayer(true);
  }, [selectionActionsRef]);

  /** Copy selected pixels to a new layer directly above the active layer. */
  const handleCopyToNewLayer = useCallback(() => {
    if (!selectionActionsRef.current) return;
    selectionActionsRef.current.cutOrCopyToLayer(false);
  }, [selectionActionsRef]);

  const handleSetOpacity = useCallback(
    (id: string, opacity: number) => {
      const layer = layers.find((l) => l.id === id);
      if (!layer || layer.type === "end_group") return;
      const currentOpacity =
        layer.type === "group"
          ? (layer as GroupHeader).opacity
          : (layer as PaintLayer).opacity;
      if (currentOpacity !== opacity) {
        pushHistory({
          type: "layer-opacity-change",
          layerId: id,
          before: currentOpacity,
          after: opacity,
        });
      }
      setLayers((prev) =>
        prev.map((l) => (l.id === id ? { ...l, opacity } : l)),
      );
      setTimeout(() => composite(), 0);
    },
    [layers, pushHistory, setLayers, composite],
  );

  /** Live opacity update during drag — updates state and composites but does NOT write history. */
  const handleSetOpacityLive = useCallback(
    (id: string, opacity: number) => {
      setLayers((prev) =>
        prev.map((l) => (l.id === id ? { ...l, opacity } : l)),
      );
      setTimeout(() => composite(), 0);
    },
    [setLayers, composite],
  );

  /** Commit opacity change on pointer-up — writes exactly one history entry with before/after values. */
  const handleSetOpacityCommit = useCallback(
    (id: string, beforeOpacity: number, afterOpacity: number) => {
      if (beforeOpacity !== afterOpacity) {
        pushHistory({
          type: "layer-opacity-change",
          layerId: id,
          before: beforeOpacity,
          after: afterOpacity,
        });
      }
      setLayers((prev) =>
        prev.map((l) => (l.id === id ? { ...l, opacity: afterOpacity } : l)),
      );
      setTimeout(() => composite(), 0);
    },
    [pushHistory, setLayers, composite],
  );

  const handleMergeLayers = useCallback(() => {
    const activeLayerCheck = layers.find(
      (l) => l.id === activeLayerIdRef.current,
    );
    if (
      !activeLayerCheck ||
      activeLayerCheck.type === "group" ||
      activeLayerCheck.type === "end_group"
    )
      return;
    const activeLayer = activeLayerCheck as PaintLayer;
    if (activeLayer.isRuler) return;

    const activeId = activeLayerIdRef.current;
    const activeIdx = layers.findIndex((l) => l.id === activeId);
    if (activeIdx < 0) return;

    // Find the layer below (skipping end_group and group entries)
    let belowIdx = activeIdx + 1;
    while (
      belowIdx < layers.length &&
      (layers[belowIdx].type === "end_group" ||
        layers[belowIdx].type === "group")
    ) {
      belowIdx++;
    }
    const belowLayer = layers[belowIdx] as FlatLayer | undefined;
    if (
      !belowLayer ||
      (belowLayer as FlatLayer).type === "group" ||
      (belowLayer as FlatLayer).type === "end_group"
    )
      return;
    // Ruler layers cannot be merge destinations — skip silently
    if ((belowLayer as PaintLayer).isRuler) return;

    // FIX 2d: Validate source canvases before reading from them in the merge.
    // getOrCreateLayerCanvas ensures both canvases exist and are correctly sized.
    const activeLc = getOrCreateLayerCanvas(activeId);
    const belowLc = getOrCreateLayerCanvas(belowLayer.id);

    const bCtx = belowLc.getContext("2d", { willReadFrequently: true });
    const aCtx = activeLc.getContext("2d", { willReadFrequently: true });
    if (!bCtx || !aCtx) return;

    // Compute the dirty rect as the union of non-transparent pixel bounding boxes
    // on the active layer and the below layer. Only that region is affected by the merge.
    // This avoids storing three full-canvas 4MB snapshots per merge operation.
    const _mergeW = canvasWidth;
    const _mergeH = canvasHeight;
    const _computeContentBounds = (
      pixelData: Uint8ClampedArray,
      pw: number,
      ph: number,
    ) => {
      let minX = pw;
      let minY = ph;
      let maxX = 0;
      let maxY = 0;
      let hasContent = false;
      for (let i = 3; i < pixelData.length; i += 4) {
        if (pixelData[i] > 0) {
          const px = ((i - 3) / 4) % pw;
          const py = Math.floor((i - 3) / 4 / pw);
          if (px < minX) minX = px;
          if (px + 1 > maxX) maxX = px + 1;
          if (py < minY) minY = py;
          if (py + 1 > maxY) maxY = py + 1;
          hasContent = true;
        }
      }
      return hasContent ? { minX, minY, maxX, maxY } : null;
    };
    // Scan both layers to find their content bounding boxes
    const _aFullData = aCtx.getImageData(0, 0, _mergeW, _mergeH);
    const _bFullData = bCtx.getImageData(0, 0, _mergeW, _mergeH);
    const _aBounds = _computeContentBounds(_aFullData.data, _mergeW, _mergeH);
    const _bBounds = _computeContentBounds(_bFullData.data, _mergeW, _mergeH);
    // Union the two bounding boxes, expand by 4px, clamp to canvas bounds
    const mergeDirtyRect:
      | { x: number; y: number; w: number; h: number }
      | undefined = (() => {
      if (!_aBounds && !_bBounds) return undefined;
      const uMinX = Math.min(
        _aBounds?.minX ?? _mergeW,
        _bBounds?.minX ?? _mergeW,
      );
      const uMinY = Math.min(
        _aBounds?.minY ?? _mergeH,
        _bBounds?.minY ?? _mergeH,
      );
      const uMaxX = Math.max(_aBounds?.maxX ?? 0, _bBounds?.maxX ?? 0);
      const uMaxY = Math.max(_aBounds?.maxY ?? 0, _bBounds?.maxY ?? 0);
      const pad = 4;
      const rx = Math.max(0, uMinX - pad);
      const ry = Math.max(0, uMinY - pad);
      const rx2 = Math.min(_mergeW, uMaxX + pad);
      const ry2 = Math.min(_mergeH, uMaxY + pad);
      const rw = rx2 - rx;
      const rh = ry2 - ry;
      return rw > 0 && rh > 0 ? { x: rx, y: ry, w: rw, h: rh } : undefined;
    })();

    // Capture before-snapshots using the dirty rect (or full canvas as fallback).
    // NOTE: activePixels is always captured at full canvas because it is used to
    // repopulate a freshly-created canvas when the layer is restored via undo
    // (pendingLayerPixelsRef writes at offset 0,0 into a blank canvas). Only the
    // below-layer snapshots can safely use the dirty rect since they write back
    // into an existing canvas via putImageData at (dirtyRect.x, dirtyRect.y).
    const activePixels = _aFullData;
    const belowPixelsBefore = mergeDirtyRect
      ? bCtx.getImageData(
          mergeDirtyRect.x,
          mergeDirtyRect.y,
          mergeDirtyRect.w,
          mergeDirtyRect.h,
        )
      : _bFullData;

    const activeIsClip = !!activeLayer.isClippingMask;
    const belowIsClip = !!(belowLayer as PaintLayer).isClippingMask;

    if (activeIsClip && !belowIsClip) {
      // Resize module-level canvases to match current canvas dimensions.
      // Assigning .width/.height also clears pixel data — no clearRect needed.
      _mergeTmpCanvas.width = canvasWidth;
      _mergeTmpCanvas.height = canvasHeight;
      _mergeClipTmpCanvas.width = canvasWidth;
      _mergeClipTmpCanvas.height = canvasHeight;

      const tmpCtx = _mergeTmpCanvas.getContext("2d")!;

      tmpCtx.globalAlpha = 1;
      tmpCtx.globalCompositeOperation = "source-over";
      tmpCtx.drawImage(belowLc, 0, 0);

      const clipCtx = _mergeClipTmpCanvas.getContext("2d")!;
      clipCtx.globalAlpha = activeLayer.opacity;
      clipCtx.globalCompositeOperation = "source-over";
      clipCtx.drawImage(activeLc, 0, 0);
      clipCtx.globalCompositeOperation = "destination-in";
      clipCtx.drawImage(belowLc, 0, 0);
      clipCtx.globalCompositeOperation = "source-over";

      tmpCtx.globalAlpha = 1;
      tmpCtx.globalCompositeOperation = (activeLayer.blendMode ||
        "source-over") as GlobalCompositeOperation;
      tmpCtx.drawImage(_mergeClipTmpCanvas, 0, 0);
      tmpCtx.globalCompositeOperation = "source-over";

      bCtx.clearRect(0, 0, canvasWidth, canvasHeight);
      bCtx.drawImage(_mergeTmpCanvas, 0, 0);
      markLayerBitmapDirty(belowLayer.id);

      // Release pixel data immediately by shrinking back to 1×1
      _mergeTmpCanvas.width = 1;
      _mergeTmpCanvas.height = 1;
      _mergeClipTmpCanvas.width = 1;
      _mergeClipTmpCanvas.height = 1;
    } else {
      bCtx.globalAlpha = activeLayer.opacity;
      bCtx.globalCompositeOperation = (activeLayer.blendMode ||
        "source-over") as GlobalCompositeOperation;
      bCtx.drawImage(activeLc, 0, 0);
      bCtx.globalAlpha = 1;
      bCtx.globalCompositeOperation = "source-over";
      markLayerBitmapDirty(belowLayer.id);
    }

    const belowPixelsAfter = mergeDirtyRect
      ? bCtx.getImageData(
          mergeDirtyRect.x,
          mergeDirtyRect.y,
          mergeDirtyRect.w,
          mergeDirtyRect.h,
        )
      : bCtx.getImageData(0, 0, canvasWidth, canvasHeight);
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
      activeLayer: activeLayer as unknown as Layer,
      activeIndex: activeIdx,
      activePixels,
      belowLayerId: belowLayer.id,
      belowPixelsBefore,
      belowPixelsAfter,
      belowLayerIsClippingMaskBefore: belowIsClip,
      belowLayerIsClippingMaskAfter,
      dirtyRect: mergeDirtyRect ?? {
        x: 0,
        y: 0,
        w: canvasWidth,
        h: canvasHeight,
      },
    });

    markCanvasDirty(belowLayer.id);
    setLayers((prev) => prev.filter((l) => l.id !== activeId));
    setActiveLayerId(belowLayer.id);
    layerCanvasesRef.current.delete(activeId);
    evictLayerBitmap(activeId);
    setTimeout(() => composite(), 0);
    markCanvasDirty();
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
    getOrCreateLayerCanvas,
  ]);

  const handleMergeLayersRef = useRef(handleMergeLayers);
  useEffect(() => {
    handleMergeLayersRef.current = handleMergeLayers;
  }, [handleMergeLayers]);

  const handleToggleClippingMask = useCallback(() => {
    const activeId = activeLayerIdRef.current;
    const layer = layers.find((l) => l.id === activeId);
    if (!layer || layer.type === "group" || layer.type === "end_group") return;
    const pl = layer as PaintLayer;

    // Ruler layers cannot be clip sources — block silently
    if (pl.isRuler) return;

    // If toggling ON, also check that the layer below is not a ruler (cannot be clip target)
    const isTogglingOn = !pl.isClippingMask;
    if (isTogglingOn) {
      const activeIdx = layers.findIndex((l) => l.id === activeId);
      // Find the next non-end_group, non-group layer below
      let belowIdx = activeIdx + 1;
      while (
        belowIdx < layers.length &&
        (layers[belowIdx].type === "end_group" ||
          layers[belowIdx].type === "group")
      ) {
        belowIdx++;
      }
      const belowLayer = layers[belowIdx] as PaintLayer | undefined;
      if (belowLayer?.isRuler) return;
    }

    pushHistory({
      type: "clipping-mask-change",
      layerId: activeId,
      before: !!pl.isClippingMask,
      after: !pl.isClippingMask,
    });
    setLayers((prev) =>
      prev.map((l) =>
        l.id === activeId ? { ...l, isClippingMask: !pl.isClippingMask } : l,
      ),
    );
    setTimeout(() => composite(), 0);
  }, [layers, pushHistory, setLayers, activeLayerIdRef, composite]);

  const handleToggleClippingMaskRef = useRef(handleToggleClippingMask);
  useEffect(() => {
    handleToggleClippingMaskRef.current = handleToggleClippingMask;
  }, [handleToggleClippingMask]);

  // ── Reorder ───────────────────────────────────────────────────────────────

  const handleReorderLayers = useCallback(
    (ids: string[]) => {
      const layersBefore = layers.slice();
      const map = new Map(layers.map((l) => [l.id, l]));
      const layersAfter = ids.map((id) => map.get(id)!).filter(Boolean);

      setLayers(layersAfter);

      pushHistory({
        type: "layer-reorder",
        layersBefore: asLegacyLayers(layersBefore),
        layersAfter: asLegacyLayers(layersAfter),
      });

      setTimeout(() => composite(), 0);
    },
    [layers, setLayers, composite, pushHistory],
  );

  /**
   * Replace the entire flat layers array (used for drag-and-drop).
   * The `newTree` parameter name is kept for call-site backward compat;
   * it is treated as Layer[] in the new architecture.
   */
  const handleReorderTree = useCallback(
    // Accept LayerNode[] for backward compat with LayersPanel which still passes tree arrays.
    // At runtime, both contain the same flat layer objects.
    (newLayers: Layer[] | import("../types").LayerNode[]) => {
      const layersBefore = layers.slice();
      setLayers(newLayers as Layer[]);
      pushHistory({
        type: "layer-reorder",
        layersBefore: asLegacyLayers(layersBefore),
        layersAfter: newLayers as Layer[],
      });
      setTimeout(() => composite(), 0);
    },
    [layers, setLayers, composite, pushHistory],
  );

  /** Same as handleReorderTree but no history entry (used for live drag-over). */
  const handleReorderTreeSilent = useCallback(
    (newLayers: Layer[] | import("../types").LayerNode[]) => {
      setLayers(newLayers as Layer[]);
      setTimeout(() => composite(), 0);
    },
    [setLayers, composite],
  );

  /** Same as handleReorderLayers but no history entry. */
  const handleReorderLayersSilent = useCallback(
    (ids: string[]) => {
      setLayers((prev) => {
        const map = new Map(prev.map((l) => [l.id, l]));
        return ids.map((id) => map.get(id)!).filter(Boolean);
      });
      setTimeout(() => composite(), 0);
    },
    [setLayers, composite],
  );

  /**
   * Push a single reorder history entry with explicit before/after snapshots.
   * Signature accepts legacy LayerNode[] params but treats them as Layer[] arrays.
   */
  const handleCommitReorderHistory = useCallback(
    (
      _treeBefore: unknown,
      _treeAfter: unknown,
      layersBefore: Layer[],
      layersAfter: Layer[],
    ) => {
      pushHistory({
        type: "layer-reorder",
        layersBefore,
        layersAfter,
      });
    },
    [pushHistory],
  );

  // ── Blend mode ────────────────────────────────────────────────────────────

  const handleSetLayerBlendMode = useCallback(
    (id: string, blendMode: string) => {
      const currentLayer = layers.find((l) => l.id === id);
      if (currentLayer && currentLayer.type !== "end_group") {
        const current =
          (currentLayer as PaintLayer | GroupHeader).blendMode || "source-over";
        pushHistory({
          type: "blend-mode",
          layerId: id,
          before: current,
          after: blendMode,
        });
      }
      setLayers((prev) =>
        prev.map((l) => (l.id === id ? { ...l, blendMode } : l)),
      );
      setTimeout(() => composite(), 0);
    },
    [layers, pushHistory, setLayers, composite],
  );

  // ── Group handlers ────────────────────────────────────────────────────────

  // biome-ignore lint/correctness/useExhaustiveDependencies: setSelectedLayerIds from useRefState is stable
  const handleCreateGroup = useCallback(() => {
    const selectedIds = Array.from(selectedLayerIds);
    const layersBefore = layers.slice();
    const counterBefore = getGroupIdCounter();

    // Name uses counterBefore + 1 since createGroupPair increments the counter
    const groupName = `Layer Group ${counterBefore + 1}`;
    const [header, endMarker] = createGroupPair(groupName);
    const counterAfter = getGroupIdCounter();
    const groupId = header.id;

    let newLayers: FlatLayer[];

    if (selectedIds.length === 0) {
      // Insert an empty group at the top
      newLayers = [header, endMarker, ...layers] as FlatLayer[];
    } else {
      // Find contiguous range: first and last selected indices in the flat array
      const selectedSet = new Set(selectedIds);
      let firstIdx = layers.length;
      let lastIdx = -1;
      for (let i = 0; i < layers.length; i++) {
        if (selectedSet.has(layers[i].id)) {
          if (i < firstIdx) firstIdx = i;
          if (i > lastIdx) lastIdx = i;
        }
      }

      if (firstIdx > lastIdx) {
        // No valid selection found — insert empty group at top
        newLayers = [header, endMarker, ...layers] as FlatLayer[];
      } else {
        // Insert header before firstIdx, endMarker after lastIdx
        newLayers = [
          ...layers.slice(0, firstIdx),
          header,
          ...layers.slice(firstIdx, lastIdx + 1),
          endMarker,
          ...layers.slice(lastIdx + 1),
        ] as FlatLayer[];
      }
    }

    setLayers(newLayers as Layer[]);
    setSelectedLayerIds(new Set([groupId]));

    // Set active layer to the first paint layer inside the new group (if any)
    const flatEntries = newLayers as import("../utils/groupUtils").FlatEntry[];
    const slice = getGroupSlice(flatEntries, groupId);
    if (slice) {
      const firstPaintLayer = slice.entries.find(
        (e) => isFlatLayer(e) && !isFlatGroupHeader(e) && !isFlatEndGroup(e),
      );
      if (firstPaintLayer) {
        setActiveLayerId(firstPaintLayer.id);
      }
    }

    setTimeout(() => composite(), 0);

    pushHistory({
      type: "layer-group-create",
      layersBefore: asLegacyLayers(layersBefore),
      layersAfter: asLegacyLayers(newLayers),
      counterBefore,
      counterAfter,
    });
  }, [
    selectedLayerIds,
    layers,
    setLayers,
    setActiveLayerId,
    composite,
    pushHistory,
  ]);

  /** Toggle a group's collapsed state (UI-only, no undo). */
  const handleToggleGroupCollapse = useCallback(
    (groupId: string) => {
      setLayers((prev) =>
        prev.map((l) =>
          l.id === groupId && l.type === "group"
            ? { ...l, collapsed: !(l as GroupHeader).collapsed }
            : l,
        ),
      );
    },
    [setLayers],
  );

  /** Rename a group. */
  const handleRenameGroup = useCallback(
    (groupId: string, name: string) => {
      setLayers((prev) =>
        prev.map((l) =>
          l.id === groupId && l.type === "group" ? { ...l, name } : l,
        ),
      );
    },
    [setLayers],
  );

  /** Set opacity on a group header. */
  const handleSetGroupOpacity = useCallback(
    (groupId: string, opacity: number) => {
      const group = layers.find(
        (l) => l.id === groupId && l.type === "group",
      ) as GroupHeader | undefined;
      const prevOpacity = group?.opacity ?? 1;
      if (prevOpacity !== opacity) {
        pushHistory({
          type: "group-opacity-change",
          groupId,
          before: prevOpacity,
          after: opacity,
        });
      }
      setLayers((prev) =>
        prev.map((l) =>
          l.id === groupId && l.type === "group" ? { ...l, opacity } : l,
        ),
      );
      setTimeout(() => composite(), 0);
    },
    [layers, pushHistory, setLayers, composite],
  );

  /** Live group opacity update during drag — updates state and composites but does NOT write history. */
  const handleSetGroupOpacityLive = useCallback(
    (groupId: string, opacity: number) => {
      setLayers((prev) =>
        prev.map((l) =>
          l.id === groupId && l.type === "group" ? { ...l, opacity } : l,
        ),
      );
      setTimeout(() => composite(), 0);
    },
    [setLayers, composite],
  );

  /** Commit group opacity change on pointer-up — writes exactly one history entry with before/after values. */
  const handleSetGroupOpacityCommit = useCallback(
    (groupId: string, beforeOpacity: number, afterOpacity: number) => {
      if (beforeOpacity !== afterOpacity) {
        pushHistory({
          type: "group-opacity-change",
          groupId,
          before: beforeOpacity,
          after: afterOpacity,
        });
      }
      setLayers((prev) =>
        prev.map((l) =>
          l.id === groupId && l.type === "group"
            ? { ...l, opacity: afterOpacity }
            : l,
        ),
      );
      setTimeout(() => composite(), 0);
    },
    [pushHistory, setLayers, composite],
  );

  /** Toggle visibility on a group header. */
  const handleToggleGroupVisible = useCallback(
    (groupId: string) => {
      setLayers((prev) =>
        prev.map((l) =>
          l.id === groupId && l.type === "group"
            ? { ...l, visible: !(l as GroupHeader).visible }
            : l,
        ),
      );
      setTimeout(() => composite(), 0);
    },
    [setLayers, composite],
  );

  /**
   * Delete a group.
   * @param deleteChildren — if true, delete all layers inside; if false, promote them.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: setSelectedLayerIds from useRefState is stable
  const handleDeleteGroup = useCallback(
    (groupId: string, deleteChildren: boolean) => {
      const layersBefore = layers.slice();
      const flatEntries = layers as import("../utils/groupUtils").FlatEntry[];
      const slice = getGroupSlice(flatEntries, groupId);
      if (!slice) return;

      const deletedCanvases = new Map<string, ImageData>();
      let layersAfter: FlatLayer[];

      if (deleteChildren) {
        // Collect pixel data for all paint layers inside the slice
        for (const entry of slice.entries) {
          if (isFlatLayer(entry)) {
            const lc = layerCanvasesRef.current.get(entry.id);
            if (lc) {
              const ctx = lc.getContext("2d", { willReadFrequently: true });
              if (ctx) {
                deletedCanvases.set(
                  entry.id,
                  ctx.getImageData(0, 0, lc.width, lc.height),
                );
              }
              layerCanvasesRef.current.delete(entry.id);
              evictLayerBitmap(entry.id);
            }
          }
        }
        // Remove the entire slice
        layersAfter = [
          ...layers.slice(0, slice.startIndex),
          ...layers.slice(slice.endIndex + 1),
        ];
      } else {
        // Promote: remove only the header and end_group, keep children in place
        layersAfter = layers.filter(
          (_l, i) => i !== slice.startIndex && i !== slice.endIndex,
        );
      }

      setLayers(layersAfter);
      setSelectedLayerIds((prev) => {
        const next = new Set(prev);
        next.delete(groupId);
        return next;
      });

      pushHistory({
        type: "layer-group-delete",
        layersBefore: asLegacyLayers(layersBefore),
        layersAfter: asLegacyLayers(layersAfter),
        deletedCanvases,
      });

      setTimeout(() => composite(), 0);
    },
    [layers, layerCanvasesRef, setLayers, composite, pushHistory],
  );

  /**
   * Move a node (layer or group) into a target group.
   * Flat-array equivalent: remove the entry from its current position and
   * insert it just after the target group header.
   */
  const handleMoveNodeIntoGroup = useCallback(
    (nodeId: string, targetGroupId: string) => {
      setLayers((prev) => {
        const srcIdx = prev.findIndex((l) => l.id === nodeId);
        const tgtIdx = prev.findIndex(
          (l) => l.id === targetGroupId && l.type === "group",
        );
        if (srcIdx === -1 || tgtIdx === -1) return prev;

        const entry = prev[srcIdx];
        const without = prev.filter((_, i) => i !== srcIdx);
        // Re-find target after removal
        const newTgtIdx = without.findIndex(
          (l) => l.id === targetGroupId && l.type === "group",
        );
        if (newTgtIdx === -1) return prev;

        return [
          ...without.slice(0, newTgtIdx + 1),
          entry,
          ...without.slice(newTgtIdx + 1),
        ];
      });
      setTimeout(() => composite(), 0);
    },
    [setLayers, composite],
  );

  // Keep a stable ref to generateGroupId for external use
  const generateGroupIdFn = useCallback(() => generateGroupId(), []);

  // ── Stub: layerTree (empty — flat array is the only structure now) ─────────
  // Many consumers destructure `layerTree` and `setLayerTree` from this hook.
  // Provide empty stubs so those call sites don't break until they're migrated.
  const _emptyTree: import("../types").LayerNode[] = [];
  const _setLayerTree = useCallback((..._args: unknown[]) => {
    // no-op: flat array is the single source of truth
  }, []);

  return {
    // Layer CRUD
    handleAddLayer,
    handleDeleteLayer,
    handleToggleVisible,
    handleRenameLayer,
    handleToggleAlphaLock,
    handleToggleLockLayer,
    handleDuplicateLayer,
    handleCutToNewLayer,
    handleCopyToNewLayer,
    handleSetOpacity,
    handleSetOpacityLive,
    handleSetOpacityCommit,
    handleMergeLayers,
    handleMergeLayersRef,
    handleToggleClippingMask,
    handleToggleClippingMaskRef,
    handleReorderLayers,
    handleSetLayerBlendMode,
    // Tree-aware handlers (now flat-array)
    handleReorderTree,
    handleReorderTreeSilent,
    handleReorderLayersSilent,
    handleCommitReorderHistory,
    // Group handlers
    handleCreateGroup,
    handleDeleteGroup,
    handleToggleGroupCollapse,
    handleRenameGroup,
    handleSetGroupOpacity,
    handleSetGroupOpacityLive,
    handleSetGroupOpacityCommit,
    handleToggleGroupVisible,
    handleMoveNodeIntoGroup,
    // Multi-select
    selectedLayerIds,
    setSelectedLayerIds,
    handleToggleLayerSelection,
    // Legacy tree state stubs (no-op — flat array is single source of truth)
    layerTree: _emptyTree,
    setLayerTree: _setLayerTree,
    // Utility
    generateGroupId: generateGroupIdFn,
    // History entry handlers
    applyLayerEntry,
    undoLayerEntry,
  };
}
