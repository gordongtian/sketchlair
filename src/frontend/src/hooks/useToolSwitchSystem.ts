import type { Layer } from "@/components/LayersPanel";
import type { Tool } from "@/components/Toolbar";
import type {
  SelectionActions,
  SelectionBoundaryPath,
} from "@/context/PaintingContext";
import { useCallback } from "react";
import type React from "react";
import type { WebGLBrushContext } from "../utils/webglBrush";
import {
  cancelScheduledComposite,
  forceResetCompositeSchedule,
} from "./useCompositing";
import { setLiquifyStrokeActive } from "./useLiquifySystem";
import { clearSmearBuffers } from "./useStrokeEngine";

export interface ToolSwitchSystemParams {
  // Refs
  cancelInProgressSelectionRef: React.MutableRefObject<() => void>;
  activeToolRef: React.MutableRefObject<Tool>;
  isRotatingRef: React.MutableRefObject<boolean>;
  rotateLockedRef: React.MutableRefObject<boolean>;
  updateBrushCursorRef: React.MutableRefObject<() => void>;
  transformActiveRef: React.MutableRefObject<boolean>;
  selectionActionsRef: React.MutableRefObject<SelectionActions>;
  lastToolBeforeTransformRef: React.MutableRefObject<Tool | null>;
  selectionBoundaryPathRef: React.MutableRefObject<SelectionBoundaryPath>;
  selectionActiveRef: React.MutableRefObject<boolean>;
  prevToolRef: React.MutableRefObject<Tool>;
  layersRef: React.MutableRefObject<Layer[]>;
  lastPaintToolRef2: React.MutableRefObject<Tool>;
  lastPaintLayerIdRef: React.MutableRefObject<string>;
  activeLayerIdRef: React.MutableRefObject<string>;
  /** WebGL brush context ref — used to destroy liquify GPU state on tool switch. */
  webglBrushRef?: React.MutableRefObject<WebGLBrushContext | null>;
  // State values
  activeTool: Tool;
  activeLayerId: string;
  // State setters
  setActiveTool: (tool: Tool) => void;
  setZoomLocked: (v: boolean) => void;
  setRotateLocked: (v: boolean) => void;
  setPanLocked: (v: boolean) => void;
  setActiveSubpanel: (v: Tool | null) => void;
  setActiveLayerId: (id: string) => void;
  // Callbacks
  handleAdjustmentsToggle: () => void;
  collapseRulerHistory: () => void;
}

export interface ToolSwitchSystemReturn {
  handleToolChange: (tool: Tool) => void;
}

export function useToolSwitchSystem({
  cancelInProgressSelectionRef,
  activeToolRef,
  isRotatingRef,
  rotateLockedRef,
  updateBrushCursorRef,
  transformActiveRef,
  selectionActionsRef,
  lastToolBeforeTransformRef,
  selectionBoundaryPathRef,
  selectionActiveRef,
  prevToolRef,
  layersRef,
  lastPaintToolRef2,
  lastPaintLayerIdRef,
  activeLayerIdRef,
  activeTool,
  activeLayerId,
  setActiveTool,
  setZoomLocked,
  setRotateLocked,
  setPanLocked,
  setActiveSubpanel,
  setActiveLayerId,
  handleAdjustmentsToggle,
  collapseRulerHistory,
  webglBrushRef,
}: ToolSwitchSystemParams): ToolSwitchSystemReturn {
  // biome-ignore lint/correctness/useExhaustiveDependencies: refs are stable
  const handleToolChange = useCallback(
    (tool: Tool) => {
      // Cancel any in-progress selection when switching tools
      cancelInProgressSelectionRef.current();
      // FIX 4: When switching away from smudge, release the per-stroke smear working
      // buffers. If a stroke is active it will have been committed by the pointer-up
      // handler already; this handles the case where tool switch occurs between strokes
      // (buffers are already null) or in edge cases where they are not yet released.
      if (activeToolRef.current === "smudge" && tool !== "smudge") {
        clearSmearBuffers();
      }
      // FIX: When switching away from liquify, destroy all GPU resources and clear
      // the stroke-active compositing guard. This prevents the guard from staying
      // true when the user creates a new layer or switches tools while on liquify,
      // which would suppress all subsequent compositing and make brush strokes invisible.
      if (activeToolRef.current === "liquify" && tool !== "liquify") {
        webglBrushRef?.current?.destroyLiquifyGPU();
        webglBrushRef?.current?.destroyAllLiquifyGPULayers();
        setLiquifyStrokeActive(false);
      }
      // FIX B (belt-and-suspenders): always clear the liquify stroke guard and any
      // stuck composite-scheduled flag when switching to any non-liquify tool.
      // This covers fast tool switches, pointer-up misses, and other edge cases.
      if (tool !== "liquify") {
        setLiquifyStrokeActive(false);
        forceResetCompositeSchedule();
      }
      // Clean up rotate tool state when switching away from rotate
      // Use activeToolRef.current (not the closed-over activeTool state) so this
      // is always current even when called from a hotkey handler that fires before
      // the React state update has been committed.
      if (activeToolRef.current === "rotate" && tool !== "rotate") {
        isRotatingRef.current = false;
        rotateLockedRef.current = false;
        // Force cursor to update immediately (before the React state effect fires)
        updateBrushCursorRef.current?.();
      }
      // Commit transform if switching away
      if (transformActiveRef.current && tool !== "move") {
        selectionActionsRef.current.commitFloat({
          keepSelection: true,
        });
      }
      // Fix A: when the user clicks the move tool from the toolbar,
      // record the previous tool (so commit/revert can restore it) and
      // immediately clear any stale boundary chains so the ant loop
      // never renders a ghost outline from the previous selection session.
      if (tool === "move" && !transformActiveRef.current) {
        lastToolBeforeTransformRef.current = activeToolRef.current;
        selectionBoundaryPathRef.current.chains = [];
        selectionBoundaryPathRef.current.segments = [];
        selectionBoundaryPathRef.current.dirty = true;
        // Immediately compute and display the bounding box at tool activation —
        // no pointer interaction required. fromToolActivation=true ensures an
        // empty layer produces no box instead of a degenerate fallback.
        selectionActionsRef.current.extractFloat(selectionActiveRef.current, {
          fromToolActivation: true,
        });
      }
      if (tool === "adjustments") {
        // Don't change activeTool — just show adjustments panel
        handleAdjustmentsToggle();
        return;
      }
      if (tool === "zoom" || tool === "rotate" || tool === "pan") {
        // Toggle off if already active
        if (activeTool === tool) {
          const prev = prevToolRef.current;
          setActiveTool(prev);
          setZoomLocked(false);
          setRotateLocked(false);
          setPanLocked(false);
          if (prev === "brush" || prev === "smudge" || prev === "eraser") {
            setActiveSubpanel(prev as "brush" | "smudge" | "eraser");
          } else if (prev === "lasso") {
            setActiveSubpanel("lasso");
          } else if (prev === "fill") {
            setActiveSubpanel("fill");
          } else {
            setActiveSubpanel(null);
          }
          return;
        }
        prevToolRef.current = activeTool as Tool;
        setActiveTool(tool);
        setActiveSubpanel(null);
        if (tool === "zoom") {
          setZoomLocked(true);
          setRotateLocked(false);
          setPanLocked(false);
        } else if (tool === "rotate") {
          setRotateLocked(true);
          setZoomLocked(false);
          setPanLocked(false);
          setActiveSubpanel("rotate" as never);
        } else if (tool === "pan") {
          setPanLocked(true);
          setZoomLocked(false);
          setRotateLocked(false);
        }
        return;
      }
      // Reset camera locks when switching to any drawing tool
      setZoomLocked(false);
      setRotateLocked(false);
      setPanLocked(false);
      setActiveTool(tool);
      if (tool === "ruler") {
        // Switch to ruler tool: auto-switch to ruler layer if it exists
        const rulerLayerTC = layersRef.current.find((l) => l.isRuler);
        lastPaintToolRef2.current =
          activeTool !== "ruler" ? activeTool : lastPaintToolRef2.current;
        lastPaintLayerIdRef.current =
          activeTool !== "ruler" ? activeLayerId : lastPaintLayerIdRef.current;
        setActiveTool("ruler");
        setActiveSubpanel("ruler");
        if (rulerLayerTC) {
          setActiveLayerId(rulerLayerTC.id);
          activeLayerIdRef.current = rulerLayerTC.id;
        }
        return;
      }
      // When switching away from ruler, restore last paint layer
      if (activeToolRef.current === "ruler") {
        collapseRulerHistory();
        if (lastPaintLayerIdRef.current) {
          setActiveLayerId(lastPaintLayerIdRef.current);
          activeLayerIdRef.current = lastPaintLayerIdRef.current;
        }
      }
      if (tool === "brush" || tool === "smudge" || tool === "eraser") {
        setActiveSubpanel(tool as "brush" | "smudge" | "eraser");
      } else if (tool === "lasso") {
        setActiveSubpanel("lasso");
      } else if (tool === "fill") {
        setActiveSubpanel("fill");
      } else if (tool === "eyedropper") {
        setActiveSubpanel("eyedropper" as never);
      } else {
        setActiveSubpanel(null);
      }
    },
    [activeTool, activeLayerId, handleAdjustmentsToggle, collapseRulerHistory],
  );

  return { handleToolChange };
}
