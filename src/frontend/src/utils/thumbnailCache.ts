// Shared 144×144 canvas for layer thumbnail generation.
// All thumbnail generation paths (stroke, undo, redo, fill, merge, crop) use this
// single pre-allocated canvas to avoid per-operation canvas allocation.
// Operations are synchronous 2D canvas ops — sequential use is always safe.

let _thumbCanvas: HTMLCanvasElement | null = null;
let _thumbCtx: CanvasRenderingContext2D | null = null;

export function getThumbCanvas(): HTMLCanvasElement {
  if (!_thumbCanvas) {
    _thumbCanvas = document.createElement("canvas");
    _thumbCanvas.width = 144;
    _thumbCanvas.height = 144;
  }
  return _thumbCanvas;
}

export function getThumbCtx(): CanvasRenderingContext2D {
  if (!_thumbCtx) {
    _thumbCtx = getThumbCanvas().getContext("2d", {
      willReadFrequently: true,
    })!;
  }
  return _thumbCtx;
}
