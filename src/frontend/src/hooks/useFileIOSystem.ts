import type { Layer } from "@/components/LayersPanel";
import { invalidateAllLayerBitmaps } from "@/hooks/useCompositing";
import type { UndoEntry } from "@/hooks/useLayerSystem";
import type { LayerNode } from "@/types";
import { resetGroupIdCounterFromFlat } from "@/utils/groupUtils";
import { deserializeSktch, serializeSktch } from "@/utils/sktchFile";
import type { WebGLBrushContext } from "@/utils/webglBrush";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

export interface UseFileIOSystemProps {
  // Stable refs to canvas/layer state
  layersRef: React.MutableRefObject<Layer[]>;
  layerCanvasesRef: React.MutableRefObject<Map<string, HTMLCanvasElement>>;
  activeLayerIdRef: React.MutableRefObject<string>;
  canvasWidthRef: React.MutableRefObject<number>;
  canvasHeightRef: React.MutableRefObject<number>;
  undoStackRef: React.MutableRefObject<UndoEntry[]>;
  redoStackRef: React.MutableRefObject<UndoEntry[]>;
  pendingLayerPixelsRef: React.MutableRefObject<Map<string, ImageData>>;
  transformActiveRef: React.MutableRefObject<boolean>;
  selectionActionsRef: React.MutableRefObject<{ commitFloat: () => void }>;
  displayCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  rulerCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  webglBrushRef: React.MutableRefObject<WebGLBrushContext | null>;
  belowActiveCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  aboveActiveCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  snapshotCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  activePreviewCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  /** @deprecated Flat architecture — no longer used for saves; retained for interface compatibility */
  layerTreeRef: React.MutableRefObject<LayerNode[]>;
  /** @deprecated Flat architecture — no longer used for saves; called on load with empty array */
  setLayerTreeRef: React.MutableRefObject<
    React.Dispatch<React.SetStateAction<LayerNode[]>>
  >;
  // Stable setters
  setCanvasWidth: (w: number) => void;
  setCanvasHeight: (h: number) => void;
  setLayers: (layers: Layer[]) => void;
  setActiveLayerId: (id: string) => void;
  setUndoCount: (n: number) => void;
  setRedoCount: (n: number) => void;
  clearSelection: () => void;
  // Optional cloud registration callbacks
  registerGetSktchBlob?: (fn: () => Promise<Blob>) => void;
  registerLoadFile?: (fn: (file: File) => Promise<void>) => void;
}

export interface UseFileIOSystemReturn {
  /** Whether the canvas has unsaved changes since the last save */
  hasUnsavedChanges: boolean;
  setHasUnsavedChanges: (v: boolean) => void;
  /** Ref version of the dirty flag — safe to read in callbacks/effects */
  isDirtyRef: React.MutableRefObject<boolean>;
  /** Ref to <input type="file"> used for the load-file picker */
  fileLoadInputRef: React.RefObject<HTMLInputElement | null>;
  /** Save As — always prompts the user (Ctrl+Shift+S) */
  handleSaveFile: () => Promise<void>;
  /** Silent save — overwrites current file handle, or falls back to Save As */
  handleSilentSave: () => Promise<void>;
  /** Load a .sktch file and replace the current canvas */
  handleLoadFile: (file: File) => Promise<void>;
}

/**
 * Writes a Blob to a FileSystemWritableFileStream as efficiently as possible.
 * Uses the Blob write path when available (more memory-efficient for large files),
 * otherwise falls back to writing the raw Blob directly.
 */
async function writeBlobToStream(
  writable: FileSystemWritableFileStream,
  blob: Blob,
): Promise<void> {
  // The File System Access API supports writing Blobs directly,
  // which allows the browser to stream rather than stringify to a giant string.
  await writable.write(blob);
}

/**
 * Owns all file I/O concerns for SketchLair:
 * - File handle tracking (for silent overwrite)
 * - Filename / document.title management
 * - Dirty flag
 * - handleSaveFile (Save As), handleSilentSave (Ctrl+S), handleLoadFile
 * - Cloud registration callbacks
 */
export function useFileIOSystem({
  layersRef,
  layerCanvasesRef,
  activeLayerIdRef,
  canvasWidthRef,
  canvasHeightRef,
  undoStackRef,
  redoStackRef,
  pendingLayerPixelsRef,
  transformActiveRef,
  selectionActionsRef,
  displayCanvasRef,
  rulerCanvasRef,
  webglBrushRef,
  belowActiveCanvasRef,
  aboveActiveCanvasRef,
  snapshotCanvasRef,
  activePreviewCanvasRef,
  layerTreeRef,
  setLayerTreeRef,
  setCanvasWidth,
  setCanvasHeight,
  setLayers,
  setActiveLayerId,
  setUndoCount,
  setRedoCount,
  clearSelection,
  registerGetSktchBlob,
  registerLoadFile,
}: UseFileIOSystemProps): UseFileIOSystemReturn {
  // Remembers the filename of the last loaded .sktch file so Save reuses it
  const loadedFileNameRef = useRef<string>("untitled.sktch");
  // File System Access API handle for silent overwrite (Ctrl+S after first save)
  const fileHandleRef = useRef<FileSystemFileHandle | null>(null);
  // Dirty flag — true whenever canvas has unsaved changes since last save
  const isDirtyRef = useRef(false);

  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const fileLoadInputRef = useRef<HTMLInputElement | null>(null);

  // Helper: update tab title / dirty state after a successful save
  const _applyFileSave = useCallback(async (_blob: Blob, filename: string) => {
    const baseName = filename.replace(/\.sktch$/i, "");
    loadedFileNameRef.current = `${baseName}.sktch`;
    document.title = baseName ? `${baseName} | SketchLair` : "SketchLair";
    isDirtyRef.current = false;
    setHasUnsavedChanges(false);
    // Mark that a session exists so Resume works next launch
    localStorage.setItem("sl_has_session", "1");
  }, []);

  // File save handler — Ctrl+Shift+S (Save As: always prompts)
  // biome-ignore lint/correctness/useExhaustiveDependencies: refs are stable
  const handleSaveFile = useCallback(async () => {
    const savingToastId = toast.loading("Saving…");
    try {
      const blob = await serializeSktch(
        layersRef.current,
        layerCanvasesRef.current,
        activeLayerIdRef.current,
        canvasWidthRef.current,
        canvasHeightRef.current,
        undoStackRef.current,
        redoStackRef.current,
        layerTreeRef.current,
      );

      if ("showSaveFilePicker" in window) {
        // File System Access API path
        try {
          const handle = await (
            window as Window & {
              showSaveFilePicker: (
                opts: unknown,
              ) => Promise<FileSystemFileHandle>;
            }
          ).showSaveFilePicker({
            suggestedName: loadedFileNameRef.current,
            types: [
              {
                description: "SketchLair File",
                accept: { "application/octet-stream": [".sktch"] },
              },
            ],
          });
          fileHandleRef.current = handle;
          const writable = await handle.createWritable();
          await writeBlobToStream(writable, blob);
          await writable.close();
          await _applyFileSave(blob, handle.name);
          toast.dismiss(savingToastId);
          toast.success("File saved");
        } catch (err) {
          toast.dismiss(savingToastId);
          // User cancelled the picker — don't show error
          if ((err as { name?: string }).name !== "AbortError") {
            const msg =
              err instanceof Error ? err.message : "Failed to save file";
            console.error("[SketchLair] Save failed:", err);
            toast.error(msg);
          }
        }
      } else {
        // Fallback: download link
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = loadedFileNameRef.current;
        a.style.display = "none";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        await _applyFileSave(blob, loadedFileNameRef.current);
        toast.dismiss(savingToastId);
        toast.success("File saved");
      }
    } catch (err) {
      toast.dismiss(savingToastId);
      const msg = err instanceof Error ? err.message : "Failed to save file";
      console.error("[SketchLair] Save failed:", err);
      toast.error(msg);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [_applyFileSave]);

  // Ctrl+S — silent overwrite if we have a handle, otherwise prompt (Save As)
  // biome-ignore lint/correctness/useExhaustiveDependencies: refs are stable
  const handleSilentSave = useCallback(async () => {
    if (!fileHandleRef.current) {
      // No handle yet — prompt (same as Ctrl+Shift+S), which shows its own toasts
      await handleSaveFile();
      return;
    }

    const savingToastId = toast.loading("Saving…");
    try {
      const blob = await serializeSktch(
        layersRef.current,
        layerCanvasesRef.current,
        activeLayerIdRef.current,
        canvasWidthRef.current,
        canvasHeightRef.current,
        undoStackRef.current,
        redoStackRef.current,
        layerTreeRef.current,
      );

      try {
        const writable = await fileHandleRef.current.createWritable();
        await writeBlobToStream(writable, blob);
        await writable.close();
        await _applyFileSave(blob, fileHandleRef.current.name);
        toast.dismiss(savingToastId);
        // No success toast for silent save — keep it quiet
      } catch (writeErr) {
        toast.dismiss(savingToastId);
        const msg =
          writeErr instanceof Error ? writeErr.message : "Failed to save file";
        console.error("[SketchLair] Silent save write failed:", writeErr);
        toast.error(msg);
      }
    } catch (err) {
      toast.dismiss(savingToastId);
      const msg = err instanceof Error ? err.message : "Failed to save file";
      console.error("[SketchLair] Silent save failed:", err);
      toast.error(msg);
    }
  }, [_applyFileSave, handleSaveFile]);

  // File load handler
  // biome-ignore lint/correctness/useExhaustiveDependencies: refs are stable
  const handleLoadFile = useCallback(
    async (file: File) => {
      try {
        // Auto-commit any active transform before loading — preserves a safe undo checkpoint
        if (transformActiveRef.current) {
          selectionActionsRef.current.commitFloat();
        }
        const result = await deserializeSktch(file);

        // Clear any active selection — its mask is sized to the old canvas
        clearSelection();
        // Release all cached bitmaps — pixel data is about to be replaced
        invalidateAllLayerBitmaps();

        // Option B: create HTMLCanvasElements for every loaded paint layer
        // and write pixel data directly into them, then store in layerCanvasesRef.
        // This populates the active document's canvas map so tab switches work correctly.
        layerCanvasesRef.current.clear();
        pendingLayerPixelsRef.current.clear();

        for (const layer of result.layers) {
          const isGroup =
            (layer as { type?: string }).type === "group" ||
            (layer as { type?: string }).type === "end_group";
          if (isGroup) continue;
          if ((layer as { isRuler?: boolean }).isRuler) continue;

          const layerCanvas = document.createElement("canvas");
          layerCanvas.width = result.canvasWidth;
          layerCanvas.height = result.canvasHeight;
          layerCanvasesRef.current.set(
            (layer as { id: string }).id,
            layerCanvas,
          );

          const pixels = result.layerPixels.get((layer as { id: string }).id);
          if (pixels) {
            const ctx = layerCanvas.getContext("2d", {
              willReadFrequently: true,
            });
            if (ctx) {
              ctx.putImageData(pixels, 0, 0);
            }
          } else if ((layer as { name?: string }).name === "Background") {
            // Legacy save: Background layer has no pixel data. Fill with opaque white
            // so the display canvas never shows the HTML page background through it.
            const ctx = layerCanvas.getContext("2d", {
              willReadFrequently: true,
            });
            if (ctx) {
              ctx.fillStyle = "#ffffff";
              ctx.fillRect(0, 0, result.canvasWidth, result.canvasHeight);
            }
          }
        }

        setCanvasWidth(result.canvasWidth);
        setCanvasHeight(result.canvasHeight);
        canvasWidthRef.current = result.canvasWidth;
        canvasHeightRef.current = result.canvasHeight;
        if (displayCanvasRef.current) {
          displayCanvasRef.current.width = result.canvasWidth;
          displayCanvasRef.current.height = result.canvasHeight;
        }
        if (rulerCanvasRef.current) {
          rulerCanvasRef.current.width = result.canvasWidth;
          rulerCanvasRef.current.height = result.canvasHeight;
        }

        // Resize WebGL FBOs and offscreen compositing canvases to match
        // the new canvas dimensions
        if (webglBrushRef.current) {
          webglBrushRef.current.resize(result.canvasWidth, result.canvasHeight);
        }
        for (const offscreen of [
          belowActiveCanvasRef,
          aboveActiveCanvasRef,
          snapshotCanvasRef,
          activePreviewCanvasRef,
        ]) {
          if (offscreen.current) {
            offscreen.current.width = result.canvasWidth;
            offscreen.current.height = result.canvasHeight;
          }
        }

        undoStackRef.current = result.undoStack;
        redoStackRef.current = result.redoStack;
        setUndoCount(result.undoStack.length);
        setRedoCount(result.redoStack.length);
        setLayers(result.layers);
        setActiveLayerId(result.activeLayerId);
        // Restore the full layer tree (with groups) — no-op in flat architecture
        // (result.layerTree is always empty; the actual layer data is in result.layers)
        setLayerTreeRef.current(result.layerTree as unknown as LayerNode[]);
        // BUG-006: Seed the group ID counter from the loaded flat array so new groups
        // never collide with or skip past existing group IDs from the file.
        // Covers both new flat-array format and legacy tree-to-flat migration — the
        // flat array is always populated by the time we reach this point.
        // Note: deserializeSktch also calls this as a belt-and-suspenders guard.
        resetGroupIdCounterFromFlat(
          result.layers as import("@/utils/groupUtils").FlatEntry[],
        );
        setHasUnsavedChanges(false);
        isDirtyRef.current = false;
        // Remember the filename so Save reuses it instead of "untitled.sktch"
        const baseName = file.name.replace(/\.sktch$/i, "");
        loadedFileNameRef.current = baseName
          ? `${baseName}.sktch`
          : "untitled.sktch";
        // Set document title to loaded filename
        document.title = baseName ? `${baseName} | SketchLair` : "SketchLair";
        // Mark session as existing so Resume works on next launch
        localStorage.setItem("sl_has_session", "1");
        // Composite and update navigator after layers have been set
        // (the useHistory effect handles composite after pendingLayerPixels flush,
        // but since we wrote pixels directly, trigger composite here)
        invalidateAllLayerBitmaps();
        toast.success("File loaded");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to load file";
        console.error("[SketchLair] Load failed:", err);
        toast.error(msg);
      }
    },
    [setLayers, setActiveLayerId, clearSelection], // refs are stable
  );

  // Register save/load functions with App for cloud operations
  // biome-ignore lint/correctness/useExhaustiveDependencies: refs are stable
  useEffect(() => {
    if (registerGetSktchBlob) {
      registerGetSktchBlob(async () => {
        return serializeSktch(
          layersRef.current,
          layerCanvasesRef.current,
          activeLayerIdRef.current,
          canvasWidthRef.current,
          canvasHeightRef.current,
          undoStackRef.current,
          redoStackRef.current,
          layerTreeRef.current,
        );
      });
    }
  }, [registerGetSktchBlob]);

  useEffect(() => {
    if (registerLoadFile) {
      registerLoadFile(handleLoadFile);
    }
  }, [registerLoadFile, handleLoadFile]);

  return {
    hasUnsavedChanges,
    setHasUnsavedChanges,
    isDirtyRef,
    fileLoadInputRef,
    handleSaveFile,
    handleSilentSave,
    handleLoadFile,
  };
}
