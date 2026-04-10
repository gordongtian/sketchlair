import { useCallback, useRef } from "react";
import type { Tool } from "../components/Toolbar";
import { markCanvasDirty } from "./useCompositing";
import type { UndoEntry } from "./useLayerSystem";

// ─── Parameters ───────────────────────────────────────────────────────────────

export interface UseAdjustmentsSystemParams {
  /** Current active subpanel ref (read-only, owned by PaintingApp) */
  activeSubpanelRef: React.RefObject<Tool | null>;
  /** Setter for the active subpanel state (owned by PaintingApp) */
  setActiveSubpanel: React.Dispatch<React.SetStateAction<Tool | null>>;
  /** Schedule a deferred composite redraw */
  scheduleComposite: () => void;
  /** Run a full composite immediately */
  composite: () => void;
  /** Mark a layer's cached ImageBitmap as dirty */
  markLayerBitmapDirty: (id: string) => void;
  /** Push an undo entry onto the history stack */
  pushHistory: (entry: UndoEntry) => void;
}

// ─── Return value ─────────────────────────────────────────────────────────────

export interface UseAdjustmentsSystemReturn {
  /**
   * Call when the user presses the "adjustments" toolbar button.
   * Toggles the adjustments subpanel — saves the current subpanel so it can
   * be restored when the adjustment is applied or cancelled.
   */
  handleAdjustmentsToggle: () => void;

  // ── Callbacks forwarded to <AdjustmentsPresetsPanel> ──────────────────────
  onAdjustmentsPreview: () => void;
  onAdjustmentsComposite: () => void;
  onAdjustmentsThumbnailUpdate: (layerId: string) => void;
  onAdjustmentsMarkLayerDirty: (id: string) => void;
  onAdjustmentsPushUndo: (
    layerId: string,
    before: ImageData,
    after: ImageData,
  ) => void;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Encapsulates the adjustments-panel toggle state and the set of callbacks
 * forwarded to <AdjustmentsPresetsPanel>.  Everything else (activeSubpanel
 * state, tool routing, JSX) stays in PaintingApp.
 */
export function useAdjustmentsSystem({
  activeSubpanelRef,
  setActiveSubpanel,
  scheduleComposite,
  composite,
  markLayerBitmapDirty,
  pushHistory,
}: UseAdjustmentsSystemParams): UseAdjustmentsSystemReturn {
  /**
   * Stores the subpanel that was active before the user switched to the
   * adjustments panel, so we can restore it after the adjustment is applied.
   */
  const preAdjustmentSubpanelRef = useRef<string | null>(null);

  // ── Toggle ────────────────────────────────────────────────────────────────

  const handleAdjustmentsToggle = useCallback(() => {
    preAdjustmentSubpanelRef.current = activeSubpanelRef.current as
      | string
      | null;
    setActiveSubpanel((prev) =>
      prev === "adjustments"
        ? (preAdjustmentSubpanelRef.current as Tool | null)
        : "adjustments",
    );
  }, [activeSubpanelRef, setActiveSubpanel]);

  // ── AdjustmentsPresetsPanel callbacks ────────────────────────────────────

  const onAdjustmentsPreview = useCallback(() => {
    scheduleComposite();
  }, [scheduleComposite]);

  const onAdjustmentsComposite = useCallback(() => {
    composite();
    // Restore the subpanel that was active before adjustments were opened
    setActiveSubpanel(preAdjustmentSubpanelRef.current as Tool | null);
  }, [composite, setActiveSubpanel]);

  const onAdjustmentsThumbnailUpdate = useCallback((layerId: string) => {
    markCanvasDirty(layerId);
  }, []);

  const onAdjustmentsMarkLayerDirty = useCallback(
    (id: string) => {
      markLayerBitmapDirty(id);
    },
    [markLayerBitmapDirty],
  );

  const onAdjustmentsPushUndo = useCallback(
    (layerId: string, before: ImageData, after: ImageData) => {
      pushHistory({ type: "pixels", layerId, before, after });
    },
    [pushHistory],
  );

  return {
    handleAdjustmentsToggle,
    onAdjustmentsPreview,
    onAdjustmentsComposite,
    onAdjustmentsThumbnailUpdate,
    onAdjustmentsMarkLayerDirty,
    onAdjustmentsPushUndo,
  };
}
