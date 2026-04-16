// ── DocumentTypes ─────────────────────────────────────────────────────────────
//
// Defines per-document state for multi-document support.
// Uses any[] for Layer[] and UndoEntry[] to avoid circular imports with
// useLayerSystem.ts and useHistory.ts.

export interface DocumentViewTransform {
  zoom: number;
  panX: number;
  panY: number;
  rotation: number;
}

/**
 * Pixel data snapshot for a single paint layer.
 * Stored as ImageData — pure data, never a canvas reference.
 * Cannot be cleared by a DOM event or React re-render.
 */
export interface LayerPixelSnapshot {
  id: string;
  type: "paint" | "ruler" | "group" | "end_group";
  name: string;
  visible: boolean;
  opacity: number;
  blendMode: string;
  alphaLock: boolean;
  clippingMask: boolean;
  /** Captured pixel data for paint layers (null for ruler/group/end_group). */
  pixelData: ImageData | null;
  /** Canvas width at time of capture — needed to size the layer canvas on restore. */
  width: number;
  /** Canvas height at time of capture. */
  height: number;
  /** All other layer-specific fields (ruler parameters, group children, etc.) */
  [key: string]: unknown;
}

/**
 * All per-document state that gets snapshotted and restored when switching tabs.
 *
 * Option B architecture: each document OWNS its layer canvases.
 * layerCanvasesRef in PaintingApp is a POINTER to the active document's canvas map.
 * Switching tabs = update the pointer + composite(). No getImageData, no putImageData.
 */
export interface DocumentState {
  // Identity
  id: string;
  filename: string;
  isDirty: boolean;

  // Canvas dimensions
  canvasWidth: number;
  canvasHeight: number;

  // View state
  viewTransform: DocumentViewTransform;
  isFlipped: boolean;

  // Per-document layer canvases (Option B).
  // Each paint layer's canvas lives here — never in a shared global map.
  // Non-serializable (canvases can't be JSON-serialized); used only in memory.
  // File save/load still uses pixelData on layers for disk I/O.
  layerCanvases: Map<string, HTMLCanvasElement>;

  // Layer state (flat-array architecture — layers stored as any[] to avoid circular imports)
  layers: any[];
  activeLayerId: string;
  layerThumbnails: Record<string, string>;
  navigatorVersion: number;

  // History (undo/redo — scoped to this document, always deep-copied via structuredClone)
  undoStack: any[];
  redoStack: any[];

  // Tool state (per-document)
  activeTool: string;
  brushSettings: any;
  brushSizes: { brush: number; eraser: number };
  brushBlendMode: string;
  color: any;
  recentColors: string[];
  lassoMode: string;

  // UI state (per-document, preserved when switching tabs)
  activeRulerPresetType: string;
  wandTolerance: number;
  wandContiguous: boolean;
  activeSubpanel: string | null;
}

/**
 * Lightweight summary of a document for the tab bar UI.
 * Contains only what the tab bar needs to render — avoids passing the full
 * DocumentState through props.
 */
export interface DocumentTab {
  id: string;
  filename: string;
  isDirty: boolean;
}
