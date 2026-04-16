/**
 * canvasResize.ts — Central coordinator for canvas resize side effects.
 *
 * Call `applyCanvasResizeSideEffects()` whenever the canvas dimensions change
 * (crop commit, undo/redo of a canvas-resize entry, file load).
 *
 * This consolidates the five resize steps that were previously duplicated
 * across useCropSystem.ts and useHistory.ts:
 *   1. Resize the display canvas element
 *   2. Resize the ruler canvas element
 *   3. Resize the WebGL brush FBO
 *   4. Resize the four offscreen compositing canvases
 *      (belowActive, aboveActive, snapshot, activePreview)
 *
 * Callers retain responsibility for:
 *   - Updating canvasWidth/Height state and refs          (caller-specific)
 *   - Resizing individual layer canvases and restoring pixels (caller-specific)
 *   - invalidateAllLayerBitmaps()                          (caller-specific)
 *   - invalidateCompositeContextCaches() / overlay ctx   (crop only)
 *   - strokeCanvasCacheKeyRef / needsFullCompositeRef     (crop only)
 *   - Nav thumb canvas resize                             (crop only)
 *   - clearSelection()                                    (crop only)
 */

import type React from "react";
import type { WebGLBrushContext } from "./webglBrush";

export interface CanvasResizeTargets {
  /** The main display canvas shown to the user. */
  displayCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  /** The canvas used to render ruler overlays. */
  rulerCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  /** The WebGL brush context whose internal FBO must match the canvas size. */
  webglBrushRef: React.MutableRefObject<WebGLBrushContext | null>;
  /** Offscreen compositing canvas: layers below the active layer. */
  belowActiveCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  /** Offscreen compositing canvas: layers above the active layer. */
  aboveActiveCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  /** Snapshot canvas used for dirty-rect compositing. */
  snapshotCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  /** Preview canvas for the active layer during a stroke. */
  activePreviewCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
}

/**
 * Apply the shared canvas resize side effects that every resize event must trigger.
 *
 * @param newWidth  - New canvas width in pixels (already rounded/validated by caller).
 * @param newHeight - New canvas height in pixels (already rounded/validated by caller).
 * @param targets   - Refs to all canvases and the WebGL brush context that need resizing.
 */
export function applyCanvasResizeSideEffects(
  newWidth: number,
  newHeight: number,
  targets: CanvasResizeTargets,
): void {
  const {
    displayCanvasRef,
    rulerCanvasRef,
    webglBrushRef,
    belowActiveCanvasRef,
    aboveActiveCanvasRef,
    snapshotCanvasRef,
    activePreviewCanvasRef,
  } = targets;

  // 1. Resize display canvas
  if (displayCanvasRef.current) {
    displayCanvasRef.current.width = newWidth;
    displayCanvasRef.current.height = newHeight;
  }

  // 2. Resize ruler canvas
  if (rulerCanvasRef.current) {
    rulerCanvasRef.current.width = newWidth;
    rulerCanvasRef.current.height = newHeight;
  }

  // 3. Resize WebGL brush FBO
  if (webglBrushRef.current) {
    webglBrushRef.current.resize(newWidth, newHeight);
  }

  // 4. Resize offscreen compositing canvases
  for (const canvasRef of [
    belowActiveCanvasRef,
    aboveActiveCanvasRef,
    snapshotCanvasRef,
    activePreviewCanvasRef,
  ]) {
    if (canvasRef.current) {
      canvasRef.current.width = newWidth;
      canvasRef.current.height = newHeight;
    }
  }
}
