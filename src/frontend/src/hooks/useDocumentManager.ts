import type { DocumentState } from "@/types/DocumentTypes";
import { DEFAULT_PRESETS } from "@/utils/toolPresets";
import { useCallback, useRef, useState } from "react";

// ── DocumentManagerResult ─────────────────────────────────────────────────────

export interface DocumentManagerResult {
  /** All open documents in the order they were opened. */
  documents: DocumentState[];

  /** ID of the currently active document, or null if none open. */
  activeDocumentId: string | null;

  /** The currently active DocumentState, or null if none open. */
  activeDocument: DocumentState | null;

  /**
   * ID of the document currently being swapped TO, or null if no swap is in
   * progress. Used by DocumentTabBar to show a loading spinner on the
   * destination tab during the synchronous three-phase swap.
   */
  swappingToId: string | null;

  /** Add a new document and immediately switch to it. */
  addDocument: (state: DocumentState) => void;

  /** Remove a document from memory. If it was active, switches to the last remaining doc. */
  removeDocument: (id: string) => void;

  /** Switch the active document without modifying any state. */
  switchDocument: (id: string) => void;

  /** Merge a partial patch into an existing document's state. */
  updateDocument: (id: string, patch: Partial<DocumentState>) => void;

  /** Convenience wrapper: mark a document as dirty or clean. */
  setDirty: (id: string, dirty: boolean) => void;

  /**
   * Returns the next available "Untitled-N" index by scanning existing
   * document filenames. Returns max+1 (or 1 if no untitled documents exist).
   */
  getNextUntitledIndex: () => number;

  /**
   * Called by PaintingApp on mount to register its three-phase swap function.
   * DocumentManager calls this fn when the user switches tabs.
   * fn(fromDoc, toDoc): Phase 1 saves fromDoc pixels, Phase 2 restores toDoc
   * synchronously, Phase 3 fires React state setters after composite().
   */
  registerSwapFn: (
    fn: (fromDoc: DocumentState, toDoc: DocumentState) => void,
  ) => void;

  /**
   * Register a synchronous flush callback that PaintingApp provides.
   * Called by DocumentManager immediately before a document is discarded,
   * so all pixel data is cleared before any new document initializes.
   * fn(doc, isActiveDoc): clears layerCanvases, display canvas, and WebGL FBOs.
   */
  registerDiscardFlushFn: (
    fn: (doc: DocumentState, isActiveDoc: boolean) => void,
  ) => void;

  /**
   * Create a blank document with the given dimensions, add it to the store,
   * and queue a three-phase swap into it. Returns the new document id.
   */
  createDocument: (
    width: number,
    height: number,
    filename?: string,
    brushSizes?: { brush: number; eraser: number },
  ) => string;

  /**
   * Register a callback that DocumentManager will call to load a .sktch file
   * into PaintingApp. PaintingApp registers this on mount.
   */
  registerLoadFileFn: (fn: (file: File) => Promise<void>) => void;

  /**
   * Open a .sktch file as a new document. Creates a blank placeholder doc,
   * then loads the file into it once PaintingApp has swapped to it.
   */
  openFileAsDocument: (file: File) => void;

  /**
   * Register a callback that returns the current canvas as a .sktch Blob.
   * PaintingApp registers this on mount.
   */
  registerGetSktchBlobFn: (fn: () => Promise<Blob>) => void;

  /**
   * Get the registered getSktchBlob function (used when saving before close).
   */
  getSktchBlob: (() => Promise<Blob>) | null;

  /**
   * Switch to a different document by ID, executing the full three-phase swap.
   * This is the correct entry point for the tab bar's onSwitchDocument.
   * Equivalent to performSwap — exposed so App.tsx doesn't need to duplicate the logic.
   */
  handleSwitchDocument: (id: string) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeId(): string {
  // Use crypto.randomUUID() for ~122 bits of entropy — avoids collisions when
  // two documents are created within the same millisecond (BUG-002 fix).
  return `doc-${crypto.randomUUID()}`;
}

export function buildBlankDocState(
  id: string,
  filename: string,
  canvasWidth: number,
  canvasHeight: number,
  brushSizes?: { brush: number; eraser: number },
): DocumentState {
  // Default brush sizes match the active preset's defaultSize so new documents
  // always open at the preset's intended size rather than a hardcoded fallback.
  const defaultBrushSizes = {
    brush: DEFAULT_PRESETS.brush[0]?.defaultSize ?? 24,
    eraser: DEFAULT_PRESETS.eraser[0]?.defaultSize ?? 24,
  };
  return {
    id,
    filename,
    isDirty: false,
    canvasWidth,
    canvasHeight,
    viewTransform: { zoom: 1, panX: 0, panY: 0, rotation: 0 },
    isFlipped: false,
    // Option B: each document owns its layer canvases.
    // PaintingApp will populate this map when the document becomes active.
    layerCanvases: new Map(),
    layers: [],
    activeLayerId: "",
    layerThumbnails: {},
    navigatorVersion: 0,
    undoStack: [],
    redoStack: [],
    activeTool: "brush",
    brushSettings: null,
    brushSizes: brushSizes ?? defaultBrushSizes,
    brushBlendMode: "normal",
    color: null,
    recentColors: [],
    lassoMode: "freehand",
    activeRulerPresetType: "none",
    wandTolerance: 32,
    wandContiguous: true,
    activeSubpanel: "brush",
  };
}

// ── useDocumentManager ────────────────────────────────────────────────────────

/**
 * Manages the collection of open documents in memory.
 * This is the single source of truth for which .sktch files are open and which
 * is currently being edited.
 *
 * Also owns the coordination of three-phase document swaps — PaintingApp
 * registers its swap function here via registerSwapFn(), and DocumentManager
 * calls it when the user switches tabs.
 */
export function useDocumentManager(): DocumentManagerResult {
  const [documents, setDocuments] = useState<DocumentState[]>([]);
  const [activeDocumentId, setActiveDocumentId] = useState<string | null>(null);
  const [swappingToId, setSwappingToId] = useState<string | null>(null);

  // Derived: active document
  const activeDocument =
    documents.find((d) => d.id === activeDocumentId) ?? null;

  // ── Refs to PaintingApp's imperative functions ────────────────────────────
  // Registered by PaintingApp on mount. Stable refs so callbacks never go stale.
  const swapFnRef = useRef<
    ((fromDoc: DocumentState, toDoc: DocumentState) => void) | null
  >(null);
  const loadFileFnRef = useRef<((file: File) => Promise<void>) | null>(null);
  const getSktchBlobFnRef = useRef<(() => Promise<Blob>) | null>(null);
  /** Registered by PaintingApp — synchronously flushes a discarded document's pixel data. */
  const discardFlushFnRef = useRef<
    ((doc: DocumentState, isActiveDoc: boolean) => void) | null
  >(null);

  // Track which document is currently loaded into PaintingApp
  const loadedDocIdRef = useRef<string | null>(null);

  // Keep documents accessible in callbacks without re-creating them
  const documentsRef = useRef(documents);
  documentsRef.current = documents;

  // Pending file to load after a new tab is set up
  const pendingFileRef = useRef<File | null>(null);

  // ── Core document operations ──────────────────────────────────────────────

  const addDocument = useCallback((state: DocumentState) => {
    setDocuments((prev) => {
      // Avoid duplicates (guard against double-add during strict mode re-renders)
      if (prev.some((d) => d.id === state.id)) return prev;
      return [...prev, state];
    });
    setActiveDocumentId(state.id);
  }, []);

  const removeDocument = useCallback((id: string) => {
    setDocuments((prev) => {
      // Find the document being removed so we can flush its pixel data before removal.
      let discardedDoc = prev.find((d) => d.id === id);

      // Synchronously flush all pixel data from the discarded document BEFORE
      // filtering it from the array and BEFORE any new document initializes.
      // This prevents stale pixel data from appearing on a subsequently-created canvas.
      // The flush must be synchronous — no setTimeout/rAF between flush and removal.
      if (discardedDoc && discardFlushFnRef.current) {
        const isActiveDoc = discardedDoc.id === loadedDocIdRef.current;
        discardFlushFnRef.current(discardedDoc, isActiveDoc);
      }

      // Sever the local reference after the flush so this updater closure
      // does not retain the DocumentState object (and its large properties)
      // any longer than necessary. The flush callback already nulled out all
      // large properties on the doc, but dropping the pointer here lets the
      // JS engine reclaim the shell object too.
      discardedDoc = undefined;

      const next = prev.filter((d) => d.id !== id);

      // If the removed doc was active, switch to the last remaining one
      setActiveDocumentId((currentActive) => {
        if (currentActive !== id) return currentActive;
        return next.length > 0 ? next[next.length - 1].id : null;
      });

      return next;
    });
  }, []);

  const switchDocument = useCallback((id: string) => {
    setActiveDocumentId(id);
  }, []);

  const updateDocument = useCallback(
    (id: string, patch: Partial<DocumentState>) => {
      setDocuments((prev) =>
        prev.map((d) => (d.id === id ? { ...d, ...patch } : d)),
      );
    },
    [],
  );

  const setDirty = useCallback(
    (id: string, dirty: boolean) => {
      updateDocument(id, { isDirty: dirty });
    },
    [updateDocument],
  );

  const getNextUntitledIndex = useCallback(() => {
    // Match filenames like "Untitled-1.sktch", "Untitled-42.sktch"
    const untitledPattern = /^Untitled-(\d+)\.sktch$/;
    let max = 0;
    for (const doc of documentsRef.current) {
      const match = untitledPattern.exec(doc.filename);
      if (match) {
        const n = Number.parseInt(match[1], 10);
        if (n > max) max = n;
      }
    }
    return max + 1;
  }, []);

  // ── Swap coordination ─────────────────────────────────────────────────────

  /**
   * Execute the document swap from the currently loaded document to newId.
   * Option B: canvases are owned per-document, so no save/restore of pixel data is needed.
   * PaintingApp's swapDocument function just re-points layerCanvasesRef at toDoc.layerCanvases.
   */
  const performSwap = useCallback(
    (newId: string) => {
      // Skip if PaintingApp already has this document loaded
      if (newId === loadedDocIdRef.current) return;

      const fromDoc = documentsRef.current.find(
        (d) => d.id === loadedDocIdRef.current,
      );
      const toDoc = documentsRef.current.find((d) => d.id === newId);

      if (!toDoc) return;

      // Show spinner on the destination tab for the duration of the swap
      setSwappingToId(newId);

      if (fromDoc && swapFnRef.current) {
        // Option B swap: PaintingApp saves non-pixel metadata into fromDoc, then
        // re-points layerCanvasesRef at toDoc.layerCanvases.
        swapFnRef.current(fromDoc, toDoc);

        // Persist fromDoc metadata (layers, undo/redo, view state, tool state).
        // Pixel data does not need to be saved — it lives in fromDoc.layerCanvases.
        updateDocument(fromDoc.id, {
          layers: fromDoc.layers,
          activeLayerId: fromDoc.activeLayerId,
          undoStack: fromDoc.undoStack,
          redoStack: fromDoc.redoStack,
          viewTransform: fromDoc.viewTransform,
          isFlipped: fromDoc.isFlipped,
          isDirty: fromDoc.isDirty,
          canvasWidth: fromDoc.canvasWidth,
          canvasHeight: fromDoc.canvasHeight,
          activeTool: fromDoc.activeTool,
          brushSettings: fromDoc.brushSettings,
          brushSizes: fromDoc.brushSizes,
          brushBlendMode: fromDoc.brushBlendMode,
          color: fromDoc.color,
          recentColors: fromDoc.recentColors,
          lassoMode: fromDoc.lassoMode,
          activeRulerPresetType: fromDoc.activeRulerPresetType,
          wandTolerance: fromDoc.wandTolerance,
          wandContiguous: fromDoc.wandContiguous,
          activeSubpanel: fromDoc.activeSubpanel,
          layerThumbnails: fromDoc.layerThumbnails,
          // layerCanvases is NOT spread here — it's a live Map and already
          // up-to-date since canvases are owned by the document.
        });
      } else if (!fromDoc && swapFnRef.current) {
        // First document ever — no fromDoc exists. Swap into toDoc directly.
        const emptyFrom = buildBlankDocState("__empty__", "", 0, 0);
        swapFnRef.current(emptyFrom, toDoc);
      }

      loadedDocIdRef.current = newId;
      switchDocument(newId);

      // Clear the spinner after the swap settles
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setSwappingToId(null);
        });
      });
    },
    [updateDocument, switchDocument],
  );

  const registerSwapFn = useCallback(
    (fn: (fromDoc: DocumentState, toDoc: DocumentState) => void) => {
      swapFnRef.current = fn;
    },
    [],
  );

  const registerDiscardFlushFn = useCallback(
    (fn: (doc: DocumentState, isActiveDoc: boolean) => void) => {
      discardFlushFnRef.current = fn;
    },
    [],
  );

  const registerLoadFileFn = useCallback(
    (fn: (file: File) => Promise<void>) => {
      loadFileFnRef.current = fn;

      // If there's a pending file waiting for PaintingApp to be ready, load it now
      if (pendingFileRef.current) {
        const file = pendingFileRef.current;
        pendingFileRef.current = null;
        requestAnimationFrame(() => {
          fn(file);
        });
      }
    },
    [],
  );

  const registerGetSktchBlobFn = useCallback((fn: () => Promise<Blob>) => {
    getSktchBlobFnRef.current = fn;
  }, []);

  // ── High-level document operations ───────────────────────────────────────

  /**
   * Create a blank document with the given dimensions.
   * Adds it to the store and queues a three-phase swap into it.
   * Returns the new document id.
   */
  const createDocument = useCallback(
    (
      width: number,
      height: number,
      filename?: string,
      brushSizes?: { brush: number; eraser: number },
    ): string => {
      const idx = getNextUntitledIndex();
      const id = makeId();
      const name = filename ?? `Untitled-${idx}.sktch`;
      const newDoc = buildBlankDocState(id, name, width, height, brushSizes);
      addDocument(newDoc);

      // Queue the swap after React has committed the new document to state.
      // rAF ensures addDocument's state update has settled before we read
      // documentsRef.current in performSwap.
      requestAnimationFrame(() => {
        performSwap(id);
      });

      return id;
    },
    [getNextUntitledIndex, addDocument, performSwap],
  );

  /**
   * Open a .sktch file as a new document.
   *
   * BUG-003 FIX: Read the file's canvasWidth/canvasHeight from its JSON header
   * BEFORE creating the placeholder document so the placeholder is sized correctly
   * from the start. If the read fails (async error, malformed file, missing fields),
   * falls back to 1920×1080 with a console warning — never blocks or throws.
   */
  const openFileAsDocument = useCallback(
    (file: File) => {
      const id = makeId();

      /**
       * Attempt to extract canvas dimensions from the .sktch JSON header.
       * Returns [width, height] on success, or [1920, 1080] on any failure.
       * Safe: never throws, always resolves.
       */
      const readFileDimensions = async (): Promise<[number, number]> => {
        try {
          const text = await file.text();
          const parsed = JSON.parse(text) as Record<string, unknown>;
          const w =
            typeof parsed.canvasWidth === "number" ? parsed.canvasWidth : 0;
          const h =
            typeof parsed.canvasHeight === "number" ? parsed.canvasHeight : 0;
          if (w > 0 && h > 0) {
            return [w, h];
          }
          console.warn(
            `[openFileAsDocument] File "${file.name}" has missing or invalid canvas dimensions (${w}×${h}) — falling back to 1920×1080`,
          );
          return [1920, 1080];
        } catch (err) {
          console.warn(
            `[openFileAsDocument] Could not read canvas dimensions from "${file.name}" — falling back to 1920×1080:`,
            err,
          );
          return [1920, 1080];
        }
      };

      // Read dimensions first, then create the placeholder at the correct size.
      // All subsequent work (swap + load) happens after the async read resolves
      // so there is no window where the placeholder sits at wrong dimensions.
      readFileDimensions().then(([w, h]) => {
        addDocument(buildBlankDocState(id, file.name, w, h));

        if (loadFileFnRef.current) {
          // PaintingApp is already mounted — swap then load
          requestAnimationFrame(() => {
            performSwap(id);
            requestAnimationFrame(() => {
              loadFileFnRef.current?.(file);
            });
          });
        } else {
          // PaintingApp not yet mounted — store file for when registerLoadFileFn fires
          pendingFileRef.current = file;
          requestAnimationFrame(() => {
            performSwap(id);
          });
        }
      });
    },
    [addDocument, performSwap],
  );

  return {
    documents,
    activeDocumentId,
    activeDocument,
    swappingToId,
    addDocument,
    removeDocument,
    switchDocument,
    updateDocument,
    setDirty,
    getNextUntitledIndex,
    registerSwapFn,
    registerDiscardFlushFn,
    createDocument,
    registerLoadFileFn,
    openFileAsDocument,
    registerGetSktchBlobFn,
    getSktchBlob: getSktchBlobFnRef.current,
    handleSwitchDocument: performSwap,
  };
}
