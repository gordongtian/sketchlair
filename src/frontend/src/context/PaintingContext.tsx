/**
 * PaintingContext — distributes shared canvas refs and callbacks to the
 * painting subsystem hooks (useSelectionSystem, useTransformSystem,
 * useHistory, useLayerSystem) without prop-drilling.
 *
 * OWNERSHIP: All refs are still OWNED by PaintingApp. This context only
 * provides read access. Hooks must never replace .current on a ref they
 * did not create — they may only mutate the value stored there.
 */
import { createContext, useContext } from "react";
import type React from "react";
import type { Layer } from "../components/LayersPanel";
import type { Tool } from "../components/Toolbar";
import type { UndoEntry } from "../hooks/useLayerSystem";
import type { SelectionGeom } from "../selectionTypes";

// The shape stored in selectionBoundaryPathRef
export interface SelectionBoundaryPath {
  segments: Array<[number, number, number, number]>;
  chains: Array<Array<[number, number]>>;
  generation: number;
  dirty: boolean;
  lastRebuildMs: number;
}

// The shape stored in xfStateRef
export interface XfState {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
}

// Minimal shape of selectionActionsRef that context consumers need
export interface SelectionActions {
  clearSelection: () => void;
  deleteSelection: () => void;
  cutOrCopyToLayer: (cut: boolean) => void;
  commitFloat: (opts?: { keepSelection?: boolean }) => void;
  revertTransform: () => void;
  rasterizeSelectionMask: () => void;
  extractFloat: (fromSel: boolean) => void;
}

export interface PaintingContextValue {
  // ---- Canvas dimensions ----
  /** React state — use in effect deps / JSX. For hot-path code use canvasWidthRef. */
  canvasWidth: number;
  /** React state — use in effect deps / JSX. For hot-path code use canvasHeightRef. */
  canvasHeight: number;
  /** Stable ref — always current, even between renders. Preferred in callbacks/hooks. */
  canvasWidthRef: React.MutableRefObject<number>;
  canvasHeightRef: React.MutableRefObject<number>;

  // ---- Layer canvases ----
  layerCanvasesRef: React.MutableRefObject<Map<string, HTMLCanvasElement>>;
  activeLayerIdRef: React.MutableRefObject<string>;
  layersRef: React.MutableRefObject<Layer[]>;
  pendingLayerPixelsRef: React.MutableRefObject<Map<string, ImageData>>;

  // ---- Layer state ----
  /** Ref that mirrors the selectedLayerIds Set state. */
  selectedLayerIdsRef: React.MutableRefObject<Set<string>>;
  /** Dispatcher for selectedLayerIds state (for external selection changes). */
  setSelectedLayerIds: React.Dispatch<React.SetStateAction<Set<string>>>;

  // ---- History stacks ----
  undoStackRef: React.MutableRefObject<UndoEntry[]>;
  redoStackRef: React.MutableRefObject<UndoEntry[]>;

  // ---- Selection state refs ----
  selectionActiveRef: React.MutableRefObject<boolean>;
  selectionMaskRef: React.MutableRefObject<HTMLCanvasElement | null>;
  selectionGeometryRef: React.MutableRefObject<SelectionGeom>;
  selectionBoundaryPathRef: React.MutableRefObject<SelectionBoundaryPath>;
  selectionShapesRef: React.MutableRefObject<NonNullable<SelectionGeom>[]>;
  selectionActionsRef: React.MutableRefObject<SelectionActions>;
  selectionOverlayCanvasRef: React.RefObject<HTMLCanvasElement | null>;

  // ---- Transform state refs ----
  transformActiveRef: React.MutableRefObject<boolean>;
  isDraggingFloatRef: React.MutableRefObject<boolean>;
  moveFloatCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  xfStateRef: React.MutableRefObject<XfState | null>;

  // ---- Composite / navigator callbacks ----
  compositeRef: React.MutableRefObject<() => void>;
  updateNavigatorCanvasRef: React.MutableRefObject<() => void>;

  // ---- Chain rebuild ----
  rebuildChainsNowRef: React.MutableRefObject<
    (mask: HTMLCanvasElement) => void
  >;

  // ---- Layer thumbnail state ----
  setLayerThumbnails: React.Dispatch<
    React.SetStateAction<Record<string, string>>
  >;

  // ---- Setters shared across hooks ----
  setActiveTool: React.Dispatch<React.SetStateAction<Tool>>;
  setActiveLayerId: React.Dispatch<React.SetStateAction<string>>;
  setLayers: React.Dispatch<React.SetStateAction<Layer[]>>;
  setUndoCount: React.Dispatch<React.SetStateAction<number>>;
  setRedoCount: React.Dispatch<React.SetStateAction<number>>;

  // ---- Bitmap cache helpers ----
  markLayerBitmapDirty: (id: string) => void;
  invalidateAllLayerBitmaps: () => void;
}

const PaintingContext = createContext<PaintingContextValue | null>(null);

/**
 * Hook to consume PaintingContext. Throws if used outside the provider so
 * missing wraps produce an obvious error rather than a silent null crash.
 */
export function usePaintingContext(): PaintingContextValue {
  const ctx = useContext(PaintingContext);
  if (!ctx) {
    throw new Error(
      "usePaintingContext must be used within a PaintingContextProvider",
    );
  }
  return ctx;
}

interface PaintingContextProviderProps extends PaintingContextValue {
  children: React.ReactNode;
}

/**
 * PaintingContextProvider wraps the painting canvas area and distributes
 * shared refs/callbacks. Place it AFTER all refs are declared in PaintingApp.
 */
export function PaintingContextProvider({
  children,
  ...value
}: PaintingContextProviderProps) {
  return (
    <PaintingContext.Provider value={value}>
      {children}
    </PaintingContext.Provider>
  );
}
