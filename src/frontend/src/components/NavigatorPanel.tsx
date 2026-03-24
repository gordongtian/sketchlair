import { Minus, Plus, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

interface ViewTransform {
  panX: number;
  panY: number;
  zoom: number;
  rotation: number;
}

interface NavigatorPanelProps {
  viewTransform: ViewTransform;
  onSetTransform: (t: ViewTransform) => void;
  canvasWidth: number;
  canvasHeight: number;
  thumbnailDataUrl: string | null;
}

export function NavigatorPanel({
  viewTransform,
  onSetTransform,
  canvasWidth,
  canvasHeight,
  thumbnailDataUrl,
}: NavigatorPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const thumbRef = useRef<HTMLCanvasElement>(null);
  const isDragging = useRef(false);
  const THUMB_W = 204;
  const thumbH = Math.round((canvasHeight / canvasWidth) * THUMB_W);

  useEffect(() => {
    const canvas = thumbRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const drawViewport = (c: CanvasRenderingContext2D) => {
      const zoom = viewTransform.zoom;
      const vw = (THUMB_W / canvasWidth) * (canvasWidth / zoom);
      const vh = (thumbH / canvasHeight) * (canvasHeight / zoom);
      const cx2 = THUMB_W / 2 - (viewTransform.panX / canvasWidth) * THUMB_W;
      const cy2 = thumbH / 2 - (viewTransform.panY / canvasHeight) * thumbH;
      c.strokeStyle = "rgba(255,200,0,0.9)";
      c.lineWidth = 1.5;
      c.strokeRect(cx2 - vw / 2, cy2 - vh / 2, vw, vh);
    };

    if (thumbnailDataUrl) {
      const img = new Image();
      img.onload = () => {
        const offscreen = document.createElement("canvas");
        offscreen.width = THUMB_W;
        offscreen.height = thumbH;
        const offCtx = offscreen.getContext("2d");
        if (offCtx) {
          offCtx.drawImage(img, 0, 0, THUMB_W, thumbH);
          drawViewport(offCtx);
          ctx.clearRect(0, 0, THUMB_W, thumbH);
          ctx.drawImage(offscreen, 0, 0);
        }
      };
      img.src = thumbnailDataUrl;
    } else {
      ctx.clearRect(0, 0, THUMB_W, thumbH);
      ctx.fillStyle = "#555";
      ctx.fillRect(0, 0, THUMB_W, thumbH);
      drawViewport(ctx);
    }
    // biome-ignore lint/correctness/useExhaustiveDependencies: THUMB_W is constant
  }, [thumbnailDataUrl, viewTransform, thumbH, canvasWidth, canvasHeight]);

  const handleThumbPointer = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (e.type === "pointerdown") {
        isDragging.current = true;
        (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
      }
      if (e.type === "pointerup" || e.type === "pointercancel") {
        isDragging.current = false;
        return;
      }
      if (!isDragging.current) return;
      const canvas = thumbRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const tx = (e.clientX - rect.left) / rect.width;
      const ty = (e.clientY - rect.top) / rect.height;
      const panX = -(tx - 0.5) * canvasWidth;
      const panY = -(ty - 0.5) * canvasHeight;
      onSetTransform({ ...viewTransform, panX, panY });
    },
    [viewTransform, onSetTransform, canvasWidth, canvasHeight],
  );

  return (
    <div
      data-ocid="navigator.panel"
      className="rounded-lg bg-card overflow-hidden"
      style={{ width: "100%" }}
    >
      {/* Header */}
      <button
        type="button"
        className="flex items-center justify-between w-full px-2 py-1 cursor-pointer select-none text-left"
        onClick={() => setCollapsed((c) => !c)}
      >
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Navigator
        </span>
        <span className="text-muted-foreground text-[10px]">
          {collapsed ? "+" : "−"}
        </span>
      </button>

      {!collapsed && (
        <div className="flex flex-col gap-1 px-1.5 pb-1.5">
          {/* Thumbnail */}
          <canvas
            ref={thumbRef}
            width={THUMB_W}
            height={thumbH}
            data-ocid="navigator.canvas_target"
            className="rounded cursor-crosshair border border-border/50"
            style={{ display: "block", width: THUMB_W, height: thumbH }}
            onPointerDown={handleThumbPointer}
            onPointerMove={handleThumbPointer}
            onPointerUp={handleThumbPointer}
            onPointerCancel={handleThumbPointer}
          />

          {/* Zoom row */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              data-ocid="navigator.zoom_out_button"
              onClick={() =>
                onSetTransform({
                  ...viewTransform,
                  zoom: Math.max(0.05, viewTransform.zoom / 1.25),
                })
              }
              className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted"
            >
              <Minus size={11} />
            </button>
            <span className="flex-1 text-center text-[10px] text-muted-foreground">
              {Math.round(viewTransform.zoom * 100)}%
            </span>
            <button
              type="button"
              data-ocid="navigator.zoom_in_button"
              onClick={() =>
                onSetTransform({
                  ...viewTransform,
                  zoom: Math.min(20, viewTransform.zoom * 1.25),
                })
              }
              className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted"
            >
              <Plus size={11} />
            </button>
          </div>

          {/* Rotation row */}
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-muted-foreground shrink-0">
              ↺
            </span>
            <input
              type="range"
              min={-180}
              max={180}
              step={1}
              value={Math.round(viewTransform.rotation)}
              onChange={(e) =>
                onSetTransform({
                  ...viewTransform,
                  rotation: Number(e.target.value),
                })
              }
              className="flex-1 h-1.5 accent-primary cursor-pointer"
            />
            <span className="text-[10px] text-muted-foreground w-8 text-right shrink-0">
              {Math.round(viewTransform.rotation)}°
            </span>
          </div>

          {/* Reset button */}
          <button
            type="button"
            data-ocid="navigator.reset_button"
            onClick={() =>
              onSetTransform({ panX: 0, panY: 0, zoom: 1, rotation: 0 })
            }
            className="flex items-center justify-center gap-1 w-full py-0.5 rounded text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <RotateCcw size={10} />
            Reset
          </button>
        </div>
      )}
    </div>
  );
}
