// ── useCanvasSwapper ───────────────────────────────────────────────────────────
//
// Handles resizing the canvas between poses without corrupting layer state.
// Preserves background layer (white fill), clears drawing layer, updates tracing
// layer with new reference image, then triggers a composite.

import type { Layer } from "@/components/LayersPanel";
import { markLayerBitmapDirty } from "@/hooks/useCompositing";
import type { ImageReference } from "@/types/learn";
import { useCallback } from "react";

export interface CanvasSwapperProps {
  /**
   * Atomically resizes the display canvas, WebGL brush, offscreen compositing
   * canvases, AND updates canvasWidthRef/canvasHeightRef before calling the
   * React state setters. Must be used instead of separate setCanvasWidth /
   * setCanvasHeight to avoid a pixel-vs-CSS-size mismatch that causes scaling bugs.
   */
  resizeCanvas: (w: number, h: number) => void;
  layers: Layer[];
  layerCanvasesRef: React.MutableRefObject<Map<string, HTMLCanvasElement>>;
  compositeAllLayers: () => void;
  /**
   * When set to true, composite() bypasses the dirty-rect optimisation and
   * repaints the entire canvas surface. useCanvasSwapper sets this to true
   * immediately before the pose-transition composite so the newly expanded
   * region (which was never marked dirty) is fully painted.
   * composite() auto-clears the flag after use.
   */
  needsFullCompositeRef: React.MutableRefObject<boolean>;
}

export interface UseCanvasSwapperResult {
  swapToImage: (
    imageRef: ImageReference,
    tracingImage: ImageBitmap | null,
  ) => Promise<void>;
}

export function useCanvasSwapper({
  resizeCanvas,
  layers,
  layerCanvasesRef,
  compositeAllLayers,
  needsFullCompositeRef,
}: CanvasSwapperProps): UseCanvasSwapperResult {
  const swapToImage = useCallback(
    async (imageRef: ImageReference, tracingImage: ImageBitmap | null) => {
      const { width: newW, height: newH } = imageRef;

      // ── Step 1: Atomic background canvas swap ────────────────────────────
      // Create a brand-new canvas pre-filled with white at the new dimensions
      // and immediately replace the background layer's entry in layerCanvasMap.
      // The old canvas is discarded. There is never an intermediate state where
      // the background canvas exists at the new size but is transparent.
      for (const layer of layers) {
        if (layer.name !== "Background") continue;
        if (layer.type === "group" || layer.type === "end_group") continue;

        const newBgCanvas = document.createElement("canvas");
        newBgCanvas.width = newW;
        newBgCanvas.height = newH;
        const newBgCtx = newBgCanvas.getContext("2d");
        if (newBgCtx) {
          newBgCtx.fillStyle = "#ffffff";
          newBgCtx.fillRect(0, 0, newW, newH);
        }
        // Atomic swap — old canvas replaced in a single assignment
        layerCanvasesRef.current.set(layer.id, newBgCanvas);
        break;
      }

      // ── Step 2: Resize all other layer canvases ──────────────────────────
      // Background has already been atomically swapped above — skip it here.
      for (const layer of layers) {
        if (layer.type === "group" || layer.type === "end_group") continue;
        if (layer.name === "Background") continue; // already swapped atomically

        const canvas = layerCanvasesRef.current.get(layer.id);
        if (!canvas) continue;

        const prevData = canvas
          .getContext("2d")
          ?.getImageData(0, 0, canvas.width, canvas.height);

        canvas.width = newW;
        canvas.height = newH;
        const ctx = canvas.getContext("2d");
        if (!ctx) continue;

        const isReference = layer.name === "Reference";

        if (isReference && tracingImage) {
          // Tracing reference layer: draw the new reference image at full size
          ctx.clearRect(0, 0, newW, newH);
          ctx.drawImage(tracingImage, 0, 0, newW, newH);
        } else {
          // Drawing layer: preserve content if dimensions match (pose 1 init),
          // otherwise clear (already wiped by advancePose before swap)
          if (prevData && prevData.width === newW && prevData.height === newH) {
            ctx.putImageData(prevData, 0, 0);
          } else {
            ctx.clearRect(0, 0, newW, newH);
          }
        }
      }

      // ── Step 2b: Invalidate stale ImageBitmap cache entries for all layers ──
      // When a layer canvas is swapped or resized, the GPU-resident ImageBitmap
      // cached from the previous canvas is now wrong size. buildStrokeCanvases()
      // uses getBitmapOrCanvas() to build belowActiveCanvas — if it gets a stale
      // smaller bitmap, it only draws e.g. 600×800 pixels into an 800×1000
      // belowActiveCanvas, leaving the expanded region transparent.
      // compositeWithStrokePreview then blits that transparent region onto the
      // display canvas, producing the visible transparency flash on the first stroke
      // of the new pose when the canvas grew larger than the previous pose.
      for (const layer of layers) {
        if (layer.type === "group" || layer.type === "end_group") continue;
        markLayerBitmapDirty(layer.id);
      }

      // ── Step 3: Atomically resize the display canvas, WebGL brush, and
      // offscreen compositing canvases. Must happen AFTER layer canvases are
      // ready so the compositing system reads correct dimensions on first composite.
      resizeCanvas(newW, newH);

      // ── Step 4: Force full-canvas composite ─────────────────────────────
      // resizeCanvas sets needsFullCompositeRef = true, but set it here as
      // belt-and-suspenders so the flag is guaranteed true when compositeAllLayers
      // runs synchronously below, regardless of any async React scheduling.
      needsFullCompositeRef.current = true;

      compositeAllLayers();
    },
    [
      layers,
      layerCanvasesRef,
      resizeCanvas,
      compositeAllLayers,
      needsFullCompositeRef,
    ],
  );

  return { swapToImage };
}
