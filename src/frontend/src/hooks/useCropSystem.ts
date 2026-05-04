/**
 * useCropSystem — owns all crop tool state, refs, and handlers.
 *
 * Extracted from PaintingApp.tsx (structural refactor — zero logic changes).
 *
 * Provides:
 *   - isCropActiveRef, cropRectRef, cropDragRef, cropPrevViewRef, cropPrevToolRef
 *   - isCropActive, cropRectVersion (reactive state for rendering)
 *   - commitCrop   — confirm crop and resize the canvas
 *   - handleCropCancel — cancel crop and restore previous view/tool
 *   - handleCropHandlePointerDown — drag the 8 crop handles
 *   - activateCrop / deactivateCrop — called by PaintingApp's tool-switch effect
 */

import { useCallback, useRef, useState } from "react";
import type React from "react";
import type { Layer } from "../components/LayersPanel";
import type { Tool } from "../components/Toolbar";
import type { ViewTransform } from "../types";
import { applyCanvasResizeSideEffects } from "../utils/canvasResize";
import type { WebGLBrushContext } from "../utils/webglBrush";
import {
  invalidateAllLayerBitmaps,
  invalidateCompositeContextCaches,
  markCanvasDirty,
} from "./useCompositing";
import type { UndoEntry } from "./useLayerSystem";
import { liquifyFreeState } from "./useLiquifySystem";

// Module-level navigator canvas — imported from PaintingApp module scope via params
// (we receive it as a ref so we don't duplicate the singleton)

export interface CropSystemParams {
  // Canvas dimension state + refs
  canvasWidthRef: React.MutableRefObject<number>;
  canvasHeightRef: React.MutableRefObject<number>;
  setCanvasWidth: (w: number) => void;
  setCanvasHeight: (h: number) => void;

  // Layer data
  layersRef: React.MutableRefObject<Layer[]>;
  layerCanvasesRef: React.MutableRefObject<Map<string, HTMLCanvasElement>>;
  setLayers: (layers: Layer[]) => void;

  // Display canvas + compositing
  displayCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  rulerCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  belowActiveCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  aboveActiveCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  snapshotCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  activePreviewCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;

  // WebGL brush (needs resize after crop)
  webglBrushRef: React.MutableRefObject<WebGLBrushContext | null>;

  // Compositing / cache invalidation
  strokeCanvasCacheKeyRef: React.MutableRefObject<number>;
  needsFullCompositeRef: React.MutableRefObject<boolean>;
  /** Called when the display canvas is resized — should null out the overlay ctx cache. */
  onInvalidateOverlayCtx: () => void;

  // Navigator
  navThumbCanvasRef: React.MutableRefObject<HTMLCanvasElement>;
  navThumbW: number;
  composite: () => void;

  // View transform
  viewTransformRef: React.MutableRefObject<ViewTransform>;
  isFlippedRef: React.MutableRefObject<boolean>;
  setViewTransform: (vt: ViewTransform) => void;

  // Tool state
  setActiveTool: (t: Tool) => void;

  // Container (for zoom-to-fit on activate)
  containerRef: React.MutableRefObject<HTMLDivElement | null>;

  // History
  pushHistory: (entry: UndoEntry) => void;

  // Selection
  clearSelection: () => void;
}

export function useCropSystem(p: CropSystemParams) {
  // ── State ──────────────────────────────────────────────────────────────────
  const [isCropActive, setIsCropActive] = useState(false);
  const [cropRectVersion, setCropRectVersion] = useState(0);

  // ── Refs ───────────────────────────────────────────────────────────────────
  const isCropActiveRef = useRef(false);
  const cropRectRef = useRef({
    x: 0,
    y: 0,
    w: p.canvasWidthRef.current,
    h: p.canvasHeightRef.current,
  });
  const cropDragRef = useRef<{
    handle: "nw" | "n" | "ne" | "w" | "e" | "sw" | "s" | "se";
    startScreenX: number;
    startScreenY: number;
    startRect: { x: number; y: number; w: number; h: number };
  } | null>(null);
  const cropPrevViewRef = useRef<ViewTransform | null>(null);
  const cropPrevToolRef = useRef<Tool>("brush");

  // ── Activate / Deactivate (called from PaintingApp tool-switch effect) ─────
  const activateCrop = useCallback(() => {
    isCropActiveRef.current = true;
    cropDragRef.current = null;
    setIsCropActive(true);
    cropPrevViewRef.current = { ...p.viewTransformRef.current };
    cropRectRef.current = {
      x: 0,
      y: 0,
      w: p.canvasWidthRef.current,
      h: p.canvasHeightRef.current,
    };
    const container = p.containerRef.current;
    if (container) {
      const cw = container.clientWidth;
      const ch = container.clientHeight;
      const targetZoom = Math.min(
        (cw * 0.6) / p.canvasWidthRef.current,
        (ch * 0.6) / p.canvasHeightRef.current,
      );
      // Only move the camera if the canvas is currently larger than it would
      // be at the target zoom. If the user is already zoomed out far enough
      // that the entire canvas fits (or is smaller than targetZoom would give),
      // leave the view where it is.
      const currentZoom = p.viewTransformRef.current.zoom;
      if (currentZoom > targetZoom) {
        const newVt: ViewTransform = {
          zoom: targetZoom,
          panX: 0,
          panY: 0,
          rotation: p.viewTransformRef.current.rotation,
        };
        p.viewTransformRef.current = newVt;
        p.setViewTransform(newVt);
      }
    }
  }, [p]);

  const deactivateCrop = useCallback(() => {
    isCropActiveRef.current = false;
    setIsCropActive(false);
  }, []);

  // ── Commit crop ─────────────────────────────────────────────────────────────
  const commitCrop = useCallback(() => {
    const { x: cropX, y: cropY, w: newW, h: newH } = cropRectRef.current;
    const roundedX = Math.round(cropX);
    const roundedY = Math.round(cropY);
    const roundedW = Math.max(1, Math.round(newW));
    const roundedH = Math.max(1, Math.round(newH));
    const oldW = p.canvasWidthRef.current;
    const oldH = p.canvasHeightRef.current;

    if (
      roundedX === 0 &&
      roundedY === 0 &&
      roundedW === oldW &&
      roundedH === oldH
    ) {
      isCropActiveRef.current = false;
      setIsCropActive(false);
      if (cropPrevViewRef.current) p.setViewTransform(cropPrevViewRef.current);
      return;
    }

    const layerPixelsBefore = new Map<string, ImageData>();
    const layerPixelsAfter = new Map<string, ImageData>();

    // Identify background layer (last non-ruler layer) so we can fill its
    // newly-expanded area with white. Without this, expanding the canvas
    // leaves transparent pixels in the background that paint-bucket fill
    // (contiguous mode) cannot reach, causing the display to flash transparent
    // when drawing in the expanded region.
    const nonRulerLayers = p.layersRef.current.filter((l) => !l.isRuler);
    const backgroundLayerId =
      nonRulerLayers.length > 0
        ? nonRulerLayers[nonRulerLayers.length - 1].id
        : null;
    const isExpanding =
      roundedW > oldW || roundedH > oldH || roundedX < 0 || roundedY < 0;

    for (const layer of p.layersRef.current) {
      if (layer.isRuler) continue;
      const lc = p.layerCanvasesRef.current.get(layer.id);
      if (!lc) continue;
      const ctx = lc.getContext("2d", { willReadFrequently: true });
      if (!ctx) continue;
      const beforePixels = ctx.getImageData(0, 0, oldW, oldH);
      layerPixelsBefore.set(layer.id, beforePixels);
      const tmpCanvas = document.createElement("canvas");
      tmpCanvas.width = roundedW;
      tmpCanvas.height = roundedH;
      const tmpCtx = tmpCanvas.getContext("2d")!;
      // For the background layer when expanding: pre-fill with white so the
      // new area is opaque. Other layers stay transparent in the new area
      // (correct behaviour — layers are transparent by default).
      if (isExpanding && layer.id === backgroundLayerId) {
        tmpCtx.fillStyle = "#ffffff";
        tmpCtx.fillRect(0, 0, roundedW, roundedH);
      }
      tmpCtx.drawImage(lc, -roundedX, -roundedY);
      const afterPixels = tmpCtx.getImageData(0, 0, roundedW, roundedH);
      layerPixelsAfter.set(layer.id, afterPixels);
      lc.width = roundedW;
      lc.height = roundedH;
      const newCtx = lc.getContext("2d", { willReadFrequently: true })!;
      newCtx.putImageData(afterPixels, 0, 0);
    }

    const layersBefore = p.layersRef.current.map((l) => ({ ...l }));
    const layersAfter = p.layersRef.current.map((l) => {
      if (l.isRuler) {
        const updated: typeof l = { ...l };
        const xFields = [
          "vpX",
          "lineX1",
          "lineX2",
          "vp1X",
          "vp2X",
          "horizonCenterX",
          "rulerGridBX",
          "rulerGridDX",
          "ovalCenterX",
          "fivePtCenterX",
        ] as const;
        const yFields = [
          "vpY",
          "lineY1",
          "lineY2",
          "vp1Y",
          "vp2Y",
          "horizonCenterY",
          "rulerVP3Y",
          "rulerGridBY",
          "ovalCenterY",
          "fivePtCenterY",
        ] as const;
        for (const f of xFields) {
          if (
            f in updated &&
            (updated as unknown as Record<string, unknown>)[f] !== undefined
          ) {
            (updated as unknown as Record<string, unknown>)[f] =
              ((updated as unknown as Record<string, unknown>)[f] as number) -
              roundedX;
          }
        }
        for (const f of yFields) {
          if (
            f in updated &&
            (updated as unknown as Record<string, unknown>)[f] !== undefined
          ) {
            (updated as unknown as Record<string, unknown>)[f] =
              ((updated as unknown as Record<string, unknown>)[f] as number) -
              roundedY;
          }
        }
        if (updated.gridCorners) {
          updated.gridCorners = updated.gridCorners.map((c) => ({
            x: c.x - roundedX,
            y: c.y - roundedY,
          })) as typeof updated.gridCorners;
        }
        return updated;
      }
      return l;
    });

    // Free any in-progress liquify stroke on canvas resize to avoid stale state
    liquifyFreeState();

    p.pushHistory({
      type: "canvas-resize",
      beforeWidth: oldW,
      beforeHeight: oldH,
      afterWidth: roundedW,
      afterHeight: roundedH,
      cropX: roundedX,
      cropY: roundedY,
      layerPixelsBefore,
      layerPixelsAfter,
      layersBefore,
      layersAfter,
    });
    // Dimensions changed — all cached bitmaps are now stale
    invalidateAllLayerBitmaps();

    // Route all common canvas resize side effects through the central coordinator.
    // This resizes: displayCanvas, rulerCanvas, WebGL brush FBO, and the four
    // offscreen compositing canvases (belowActive, aboveActive, snapshot, activePreview).
    applyCanvasResizeSideEffects(roundedW, roundedH, {
      displayCanvasRef: p.displayCanvasRef,
      rulerCanvasRef: p.rulerCanvasRef,
      webglBrushRef: p.webglBrushRef,
      belowActiveCanvasRef: p.belowActiveCanvasRef,
      aboveActiveCanvasRef: p.aboveActiveCanvasRef,
      snapshotCanvasRef: p.snapshotCanvasRef,
      activePreviewCanvasRef: p.activePreviewCanvasRef,
    });
    // Canvas element resizing (done above) invalidates the existing 2D context object
    // on some browsers. Null out all cached contexts so they are re-fetched on the next paint.
    invalidateCompositeContextCaches();
    p.onInvalidateOverlayCtx();

    p.setLayers(layersAfter);
    p.layersRef.current = layersAfter;

    // Schedule thumbnail + navigator updates for all non-ruler layers
    for (const layer of layersAfter) {
      if (!layer.isRuler) {
        markCanvasDirty(layer.id);
      }
    }

    p.setCanvasWidth(roundedW);
    p.setCanvasHeight(roundedH);
    p.canvasWidthRef.current = roundedW;
    p.canvasHeightRef.current = roundedH;

    isCropActiveRef.current = false;
    setIsCropActive(false);
    if (cropPrevViewRef.current) p.setViewTransform(cropPrevViewRef.current);

    // Resize the navigator thumbnail canvas to match new aspect ratio
    const navThumbCanvas = p.navThumbCanvasRef.current;
    navThumbCanvas.width = p.navThumbW;
    navThumbCanvas.height = Math.round(p.navThumbW * (roundedH / roundedW));

    // Invalidate the stroke canvas cache — the below/above canvases were just cleared
    // by the dimension change, so the first stroke after crop must rebuild them.
    p.strokeCanvasCacheKeyRef.current++;
    // Force a full composite repaint so the dirty-rect path cannot run against a
    // just-cleared display canvas.
    p.needsFullCompositeRef.current = true;

    p.composite();
    markCanvasDirty(); // navigator will update via composite-done callback
    // Clear any active selection — its mask is sized to the old canvas dimensions
    // and must not carry over after a resize.
    p.clearSelection();
  }, [p]);

  // ── Cancel crop ─────────────────────────────────────────────────────────────
  const handleCropCancel = useCallback(() => {
    cropRectRef.current = {
      x: 0,
      y: 0,
      w: p.canvasWidthRef.current,
      h: p.canvasHeightRef.current,
    };
    isCropActiveRef.current = false;
    setIsCropActive(false);
    if (cropPrevViewRef.current) p.setViewTransform(cropPrevViewRef.current);
    p.setActiveTool(cropPrevToolRef.current);
  }, [p]);

  // ── Handle pointer down on a crop handle ─────────────────────────────────────
  const handleCropHandlePointerDown = useCallback(
    (
      e: React.PointerEvent<HTMLDivElement>,
      h: "nw" | "n" | "ne" | "w" | "e" | "sw" | "s" | "se",
    ) => {
      e.stopPropagation();
      e.preventDefault();
      const startScreenX = e.clientX;
      const startScreenY = e.clientY;
      const startRect = { ...cropRectRef.current };
      cropDragRef.current = {
        handle: h,
        startScreenX,
        startScreenY,
        startRect,
      };
      const onMove = (me: PointerEvent) => {
        const vt = p.viewTransformRef.current;
        const scaleRatio = 1 / vt.zoom;
        const dx = (me.clientX - startScreenX) * scaleRatio;
        const dy = (me.clientY - startScreenY) * scaleRatio;
        const rad = (-vt.rotation * Math.PI) / 180;
        const cdx = dx * Math.cos(rad) - dy * Math.sin(rad);
        const cdy = dx * Math.sin(rad) + dy * Math.cos(rad);
        const flipCdx = p.isFlippedRef.current ? -cdx : cdx;
        const s = startRect;
        let nx = s.x;
        let ny = s.y;
        let nw = s.w;
        let nh = s.h;
        if (h === "nw") {
          nx = s.x + flipCdx;
          ny = s.y + cdy;
          nw = s.w - flipCdx;
          nh = s.h - cdy;
        } else if (h === "n") {
          ny = s.y + cdy;
          nh = s.h - cdy;
        } else if (h === "ne") {
          ny = s.y + cdy;
          nw = s.w + flipCdx;
          nh = s.h - cdy;
        } else if (h === "w") {
          nx = s.x + flipCdx;
          nw = s.w - flipCdx;
        } else if (h === "e") {
          nw = s.w + flipCdx;
        } else if (h === "sw") {
          nx = s.x + flipCdx;
          nw = s.w - flipCdx;
          nh = s.h + cdy;
        } else if (h === "s") {
          nh = s.h + cdy;
        } else if (h === "se") {
          nw = s.w + flipCdx;
          nh = s.h + cdy;
        }
        if (nw < 1) {
          if (h.includes("w")) nx = s.x + s.w - 1;
          nw = 1;
        }
        if (nh < 1) {
          if (h.includes("n")) ny = s.y + s.h - 1;
          nh = 1;
        }
        cropRectRef.current = { x: nx, y: ny, w: nw, h: nh };
        setCropRectVersion((v) => v + 1);
      };
      const onUp = () => {
        cropDragRef.current = null;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [p],
  );

  return {
    // State
    isCropActive,
    cropRectVersion,
    // Refs (needed by usePaintingCanvasEvents and the tool-switch effect)
    isCropActiveRef,
    cropRectRef,
    cropDragRef,
    cropPrevViewRef,
    cropPrevToolRef,
    setCropRectVersion,
    // Actions
    activateCrop,
    deactivateCrop,
    commitCrop,
    handleCropCancel,
    handleCropHandlePointerDown,
  };
}
