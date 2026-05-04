import { useCallback, useEffect } from "react";
import type React from "react";
import type { Layer } from "../components/LayersPanel";
import type { SelectionSnapshot } from "../selectionTypes";
import type { LayerNode } from "../types";
import { applyCanvasResizeSideEffects } from "../utils/canvasResize";
import type { WebGLBrushContext } from "../utils/webglBrush";
import { evictLayerBitmap, markCanvasDirty } from "./useCompositing";
import type { LayerSystemEntry, UndoEntry } from "./useLayerSystem";

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
  // Layer system entry handlers — delegate pure layer-state undo/redo here
  // instead of duplicating the switch cases in this file.
  // Passed as refs so useHistory can be called before useLayerSystem in the
  // component body without violating hook ordering rules.
  applyLayerEntryRef: React.MutableRefObject<(entry: LayerSystemEntry) => void>;
  undoLayerEntryRef: React.MutableRefObject<(entry: LayerSystemEntry) => void>;
}

// ── Memory management helpers ──────────────────────────────────────────────────

/**
 * Explicitly nulls all ImageData fields on an undo entry so the GC can reclaim
 * the pixel buffers without waiting for the entry object itself to be collected.
 *
 * Call this ONLY on entries that have already been consumed (evicted from the
 * undo cap, cleared from the redo stack on new action, or cleared on doc close).
 * Never call on an entry that may still be used by undo/redo restore logic.
 *
 * The `type` field is intentionally preserved so any downstream code that
 * inspects entry type after eviction still works correctly.
 */
export function nullifyUndoEntry(entry: UndoEntry): void {
  switch (entry.type) {
    case "pixels": {
      const e = entry as { before: ImageData | null; after: ImageData | null };
      e.before = null as unknown as ImageData;
      e.after = null as unknown as ImageData;
      break;
    }
    case "layer-add-pixels": {
      const e = entry as {
        pixels: ImageData | null;
        srcBefore?: ImageData | null;
        srcAfter?: ImageData | null;
      };
      e.pixels = null as unknown as ImageData;
      if (e.srcBefore !== undefined) e.srcBefore = null;
      if (e.srcAfter !== undefined) e.srcAfter = null;
      break;
    }
    case "layer-delete": {
      const e = entry as { pixels: ImageData | null };
      e.pixels = null as unknown as ImageData;
      break;
    }
    case "layer-merge": {
      const e = entry as {
        activePixels: ImageData | null;
        belowPixelsBefore: ImageData | null;
        belowPixelsAfter: ImageData | null;
      };
      e.activePixels = null as unknown as ImageData;
      e.belowPixelsBefore = null as unknown as ImageData;
      e.belowPixelsAfter = null as unknown as ImageData;
      break;
    }
    case "canvas-resize": {
      const e = entry as {
        layerPixelsBefore: Map<string, ImageData | null>;
        layerPixelsAfter: Map<string, ImageData | null>;
      };
      for (const k of e.layerPixelsBefore.keys())
        e.layerPixelsBefore.set(k, null);
      for (const k of e.layerPixelsAfter.keys())
        e.layerPixelsAfter.set(k, null);
      break;
    }
    case "layer-group-delete": {
      const e = entry as {
        deletedCanvases: Map<string, ImageData | null>;
      };
      for (const k of e.deletedCanvases.keys()) e.deletedCanvases.set(k, null);
      break;
    }
    case "multi-layer-pixels": {
      const e = entry as {
        layers: Map<
          string,
          { before: ImageData | null; after: ImageData | null }
        >;
      };
      for (const v of e.layers.values()) {
        v.before = null as unknown as ImageData;
        v.after = null as unknown as ImageData;
      }
      break;
    }
    // These entry types contain no ImageData — nothing to null.
    case "layer-add":
    case "blend-mode":
    case "selection":
    case "ruler-edit":
    case "layers-clear-rulers":
    case "layer-group-create":
    case "layer-opacity-change":
    case "group-opacity-change":
    case "layer-visibility-change":
    case "alpha-lock-change":
    case "lock-layer-change":
    case "clipping-mask-change":
    case "layer-rename":
    case "layer-reorder":
      break;
    default:
      break;
  }
}

/**
 * Drains an entire undo/redo stack, nullifying ImageData on every entry and
 * clearing the array in-place. Safe to call on both the live ref stack and
 * any saved copy of a stack (e.g. doc.undoStack on document close).
 */
export function drainUndoStack(stack: UndoEntry[]): void {
  for (const entry of stack) {
    nullifyUndoEntry(entry);
  }
  stack.length = 0;
}

// ── Type guard ────────────────────────────────────────────────────────────────

/** Returns true if the entry's undo/redo logic lives in useLayerSystem. */
function isLayerSystemEntry(entry: UndoEntry): entry is LayerSystemEntry {
  return (
    entry.type === "blend-mode" ||
    entry.type === "layer-opacity-change" ||
    entry.type === "group-opacity-change" ||
    entry.type === "layer-visibility-change" ||
    entry.type === "alpha-lock-change" ||
    entry.type === "clipping-mask-change" ||
    entry.type === "layer-rename" ||
    entry.type === "layer-reorder" ||
    entry.type === "layer-group-create" ||
    entry.type === "layer-group-delete"
  );
}

// ── Named constants for undo memory limits ────────────────────────────────────

/** Hard maximum undo entry count (the user-configurable per-doc cap is separate and lower). */
const MAX_UNDO_ENTRIES = 50;

/**
 * Total memory budget for the undo history in MB (both undo and redo stacks combined).
 * 500 MB accommodates large canvases and multi-layer transforms without being too restrictive.
 */
const MAX_UNDO_MEMORY_MB = 500;

// Module-level cap ref — shared across all useHistory instances (one per document session).
// Using a module-level ref means setHistoryCap works without needing React context.
const _historyCapRef = { current: 20 };

/**
 * Update the undo history cap at runtime.
 * - Updates the module-level cap.
 * - Trims the provided undo stack to the new cap (oldest entries first), nullifying evicted entries.
 * - Does NOT affect the redo stack.
 */
export function setHistoryCap(
  n: number,
  undoStackRef?: React.MutableRefObject<UndoEntry[]>,
): void {
  _historyCapRef.current = n;
  if (!undoStackRef) return;
  while (undoStackRef.current.length > n) {
    const evicted = undoStackRef.current.shift();
    if (evicted) nullifyUndoEntry(evicted);
  }
}

export function useHistory({
  setUndoCount,
  setRedoCount,
  canvasWidth,
  canvasHeight,
  layers,
  setLayers,
  setLayerTreeRef: _setLayerTreeRef,
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
  applyLayerEntryRef,
  undoLayerEntryRef,
}: UseHistoryProps) {
  /** Push an entry and clear the redo stack. Call this whenever a canvas change is committed. */
  const pushHistory = useCallback(
    (entry: UndoEntry) => {
      undoStackRef.current.push(entry);
      // Enforce the user-configurable entry count cap (max MAX_UNDO_ENTRIES)
      const effectiveCap = Math.min(_historyCapRef.current, MAX_UNDO_ENTRIES);
      while (undoStackRef.current.length > effectiveCap) {
        const evicted = undoStackRef.current.shift();
        if (evicted) nullifyUndoEntry(evicted);
      }
      // Enforce the memory budget — evict oldest entries if total pixel data
      // across both stacks exceeds MAX_UNDO_MEMORY_MB.
      const calcStackBytes = (stack: UndoEntry[]): number =>
        stack.reduce((sum, e) => {
          if (e.type === "pixels") {
            return (
              sum +
              (e.before ? e.before.data.byteLength : 0) +
              (e.after ? e.after.data.byteLength : 0)
            );
          }
          if (e.type === "multi-layer-pixels") {
            let total = 0;
            for (const l of e.layers.values()) {
              total +=
                (l.before ? l.before.data.byteLength : 0) +
                (l.after ? l.after.data.byteLength : 0);
            }
            return sum + total;
          }
          if (e.type === "layer-merge") {
            return (
              sum +
              (e.activePixels ? e.activePixels.data.byteLength : 0) +
              (e.belowPixelsBefore ? e.belowPixelsBefore.data.byteLength : 0) +
              (e.belowPixelsAfter ? e.belowPixelsAfter.data.byteLength : 0)
            );
          }
          return sum;
        }, 0);
      const budgetBytes = MAX_UNDO_MEMORY_MB * 1024 * 1024;
      while (
        undoStackRef.current.length > 0 &&
        calcStackBytes(undoStackRef.current) +
          calcStackBytes(redoStackRef.current) >
          budgetBytes
      ) {
        const evicted = undoStackRef.current.shift();
        if (evicted) nullifyUndoEntry(evicted);
      }
      // Null all redo entries being discarded before clearing the stack
      for (const old of redoStackRef.current) nullifyUndoEntry(old);
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
    // Collect IDs that receive pixel writes so we can schedule their thumbnails
    // AFTER composite() — not before. Generating thumbnails before composite means
    // the thumbnail may read from a canvas that is still in an intermediate state
    // (e.g. source layer bitmap cache stale, or new layer pixels not yet composited).
    const flushedIds: string[] = [];
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
          // Invalidate the bitmap cache immediately after the pixel write so that
          // composite() reads the fresh canvas, not the stale ImageBitmap.
          markLayerBitmapDirty(id);
          flushedIds.push(id);
        }
        pendingLayerPixelsRef.current.delete(id);
      }
    }
    // Run composite() BEFORE scheduling thumbnails. This ensures:
    // 1. The display canvas is updated with fresh pixel data for all layers.
    // 2. Thumbnail generation (triggered by markCanvasDirty below) fires 80 ms later
    //    from already-committed canvas state — not from a partial/pre-composite state.
    composite();
    updateNavigatorCanvas();
    // Schedule thumbnail regeneration for all layers that received new pixel data.
    // Called after composite() so the 80 ms debounce window always expires against
    // fully-committed canvas state. Previously markCanvasDirty was called before
    // composite(), which could allow the debounced flush to fire between the pixel
    // write and composite(), capturing stale or mismatched content.
    for (const id of flushedIds) {
      markCanvasDirty(id);
    }
  }, [layers, composite, updateNavigatorCanvas]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: restoreSelectionSnapshot and clearTransformState are stable
  const handleUndo = useCallback(() => {
    const entry = undoStackRef.current.pop();
    if (!entry) return;

    // ── Layer-system entries: delegate to useLayerSystem ─────────────────────
    // These entries only touch layer state (setLayers / setLayerTree) and have
    // no canvas pixel ops, transform refs, or selection state. All their logic
    // lives co-located with their entry-type definitions in useLayerSystem.
    if (isLayerSystemEntry(entry)) {
      // layer-group-delete undo also needs to recreate canvases for deleted layers
      if (entry.type === "layer-group-delete") {
        for (const [layerId, pixels] of entry.deletedCanvases) {
          const rc = document.createElement("canvas");
          rc.width = canvasWidth;
          rc.height = canvasHeight;
          layerCanvasesRef.current.set(layerId, rc);
          pendingLayerPixelsRef.current.set(layerId, pixels);
        }
      }
      undoLayerEntryRef.current(entry);
    } else if (entry.type === "pixels") {
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
      evictLayerBitmap(entry.layer.id);
      // Restore the active layer to whatever was active before the layer was added.
      // Without this, the active layer ID would point to the just-deleted layer.
      if (entry.previousActiveLayerId) {
        setActiveLayerId(entry.previousActiveLayerId);
      }
    } else if (entry.type === "layer-add-pixels") {
      layerCanvasesRef.current.delete(entry.layer.id);
      evictLayerBitmap(entry.layer.id);
      setLayers((prev) => prev.filter((l) => l.id !== entry.layer.id));
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
      setActiveLayerId(entry.layer.id);
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
          ctx.putImageData(
            entry.belowPixelsBefore,
            entry.dirtyRect?.x ?? 0,
            entry.dirtyRect?.y ?? 0,
          );
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
      setActiveLayerId(entry.activeLayer.id);
    } else if (entry.type === "canvas-resize") {
      // Route all common canvas resize side effects through the central coordinator.
      applyCanvasResizeSideEffects(entry.beforeWidth, entry.beforeHeight, {
        displayCanvasRef,
        rulerCanvasRef,
        webglBrushRef,
        belowActiveCanvasRef,
        aboveActiveCanvasRef,
        snapshotCanvasRef,
        activePreviewCanvasRef,
      });
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
    } else if (entry.type === "multi-layer-pixels") {
      // Undo: atomically restore ALL layers involved in the multi-layer transform.
      // A single Ctrl+Z reverts every layer at once — no partial state possible.
      if (transformActiveRef.current) {
        revertTransformRef.current();
      }
      const dirtyIds: string[] = [];
      for (const [layerId, layerEntry] of entry.layers) {
        const lc = layerCanvasesRef.current.get(layerId);
        if (lc) {
          const ctx = lc.getContext("2d", { willReadFrequently: true });
          if (ctx) {
            if (layerEntry.dirtyRect) {
              ctx.putImageData(
                layerEntry.before,
                layerEntry.dirtyRect.x,
                layerEntry.dirtyRect.y,
              );
            } else {
              ctx.putImageData(layerEntry.before, 0, 0);
            }
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
    if (redoStackRef.current.length > _historyCapRef.current) {
      const evicted = redoStackRef.current.shift();
      if (evicted) nullifyUndoEntry(evicted);
    }
    composite();
    updateNavigator();
    setUndoCount(undoStackRef.current.length);
    setRedoCount(redoStackRef.current.length);
  }, [composite, updateNavigator, clearTransformState, undoLayerEntryRef]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: restoreSelectionSnapshot and clearTransformState are stable
  const handleRedo = useCallback(() => {
    const entry = redoStackRef.current.pop();
    if (!entry) return;

    // ── Layer-system entries: delegate to useLayerSystem ─────────────────────
    if (isLayerSystemEntry(entry)) {
      // layer-group-delete redo also needs to remove deleted canvases
      if (entry.type === "layer-group-delete") {
        for (const layerId of entry.deletedCanvases.keys()) {
          layerCanvasesRef.current.delete(layerId);
          evictLayerBitmap(layerId);
        }
      }
      applyLayerEntryRef.current(entry);
    } else if (entry.type === "pixels") {
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
    } else if (entry.type === "layer-add-pixels") {
      if (entry.pixels) {
        pendingLayerPixelsRef.current.set(entry.layer.id, entry.pixels);
      }
      setLayers((prev) => {
        const next = [...prev];
        next.splice(entry.index, 0, entry.layer);
        return next;
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
      evictLayerBitmap(entry.layer.id);
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
          ctx.putImageData(
            entry.belowPixelsAfter,
            entry.dirtyRect?.x ?? 0,
            entry.dirtyRect?.y ?? 0,
          );
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
      setActiveLayerId(entry.belowLayerId);
    } else if (entry.type === "canvas-resize") {
      // Route all common canvas resize side effects through the central coordinator.
      applyCanvasResizeSideEffects(entry.afterWidth, entry.afterHeight, {
        displayCanvasRef,
        rulerCanvasRef,
        webglBrushRef,
        belowActiveCanvasRef,
        aboveActiveCanvasRef,
        snapshotCanvasRef,
        activePreviewCanvasRef,
      });
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
      // Dimensions changed — all cached bitmaps are now stale
      invalidateAllLayerBitmaps();
    } else if (entry.type === "layers-clear-rulers") {
      // Redo: remove all ruler layers again
      const ids = new Set(entry.removedLayers.map((r) => r.layer.id));
      setLayers((prev) => prev.filter((l) => !ids.has(l.id)));
      for (const { layer } of entry.removedLayers) {
        layerCanvasesRef.current.delete(layer.id);
        evictLayerBitmap(layer.id);
      }
    } else if (entry.type === "multi-layer-pixels") {
      // Redo: atomically re-apply ALL layers involved in the multi-layer transform.
      const dirtyIds: string[] = [];
      for (const [layerId, layerEntry] of entry.layers) {
        const lc = layerCanvasesRef.current.get(layerId);
        if (lc) {
          const ctx = lc.getContext("2d", { willReadFrequently: true });
          if (ctx) {
            if (layerEntry.dirtyRect) {
              ctx.putImageData(
                layerEntry.after,
                layerEntry.dirtyRect.x,
                layerEntry.dirtyRect.y,
              );
            } else {
              ctx.putImageData(layerEntry.after, 0, 0);
            }
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
    if (undoStackRef.current.length > _historyCapRef.current) {
      const evicted = undoStackRef.current.shift();
      if (evicted) nullifyUndoEntry(evicted);
    }
    composite();
    updateNavigator();
    setUndoCount(undoStackRef.current.length);
    setRedoCount(redoStackRef.current.length);
  }, [composite, updateNavigator, clearTransformState, applyLayerEntryRef]);

  return {
    pushHistory,
    handleUndo,
    handleRedo,
  };
}
