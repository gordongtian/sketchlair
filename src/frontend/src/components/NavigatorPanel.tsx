import { useCallback, useEffect, useRef, useState } from "react";
import type { ViewTransform } from "../types";

interface NavigatorPanelProps {
  viewTransform: ViewTransform;
  onSetTransform: (t: ViewTransform) => void;
  canvasWidth: number;
  canvasHeight: number;
  thumbnailCanvas: HTMLCanvasElement | null;
  thumbnailVersion: number;
  /** Whether the canvas is horizontally flipped — affects the viewport indicator direction */
  isFlipped?: boolean;
}

export function NavigatorPanel({
  viewTransform,
  onSetTransform,
  canvasWidth,
  canvasHeight,
  thumbnailCanvas,
  thumbnailVersion,
  isFlipped = false,
}: NavigatorPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const thumbRef = useRef<HTMLCanvasElement>(null);
  const isDragging = useRef(false);
  const THUMB_W = 1024;
  const thumbH = Math.round((canvasHeight / canvasWidth) * THUMB_W);
  // biome-ignore lint/correctness/useExhaustiveDependencies: thumbnailVersion signals new pixels in the same canvas ref
  useEffect(() => {
    const canvas = thumbRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const drawViewport = (c: CanvasRenderingContext2D) => {
      const zoom = viewTransform.zoom;
      // Viewport dimensions in thumbnail-space (how much of the canvas is visible)
      const vw = THUMB_W / zoom;
      const vh = thumbH / zoom;

      // The canvas center in thumbnail-space is (THUMB_W/2, thumbH/2).
      // panX/panY are in screen-space pixels offset from center, so we convert:
      //   screenPanX moves the canvas right by panX px → canvas center shifts right
      //   In thumbnail coords: shiftX = panX * (THUMB_W / canvasWidth) / zoom ... but pan is
      //   screen-space not canvas-space. Actually pan is applied as CSS translate in screen px,
      //   so 1 screen px of pan corresponds to (THUMB_W / canvasWidth) / zoom thumbnail pixels.
      //   Simpler: the viewport center in canvas coords = canvas_center - (panX/zoom, panY/zoom)
      //   Then map canvas coords to thumb coords by scaling.
      const canvasCenterX = canvasWidth / 2 - viewTransform.panX / zoom;
      const canvasCenterY = canvasHeight / 2 - viewTransform.panY / zoom;
      const cx2 = (canvasCenterX / canvasWidth) * THUMB_W;
      const cy2 = (canvasCenterY / canvasHeight) * thumbH;

      const rot = (viewTransform.rotation * Math.PI) / 180;
      const flipSign = isFlipped ? -1 : 1;

      // Compute minimum stroke width so each line is at least 2 CSS pixels wide.
      // The canvas is THUMB_W internal pixels displayed at clientWidth CSS pixels,
      // so 1 CSS pixel = (THUMB_W / clientWidth) canvas pixels.
      const displayWidth = thumbRef.current?.clientWidth ?? 0;
      const cssToCanvas = displayWidth > 0 ? THUMB_W / displayWidth : 8;
      const minStroke = 2 * cssToCanvas; // 2 CSS pixels in canvas-space units

      c.save();
      c.translate(cx2, cy2);
      c.rotate(rot * flipSign);
      // Outer dark shadow stroke for contrast on any background
      c.strokeStyle = "rgba(0,0,0,0.7)";
      c.lineWidth = Math.max(6, minStroke);
      c.strokeRect(-vw / 2, -vh / 2, vw, vh);
      // Main bright indicator stroke
      c.strokeStyle = "rgba(255,200,0,1)";
      c.lineWidth = Math.max(4, minStroke);
      c.strokeRect(-vw / 2, -vh / 2, vw, vh);
      // Draw a small cross at the center for reference
      const cross = 7;
      c.lineWidth = Math.max(3, minStroke);
      c.strokeStyle = "rgba(0,0,0,0.7)";
      c.beginPath();
      c.moveTo(-cross, 0);
      c.lineTo(cross, 0);
      c.moveTo(0, -cross);
      c.lineTo(0, cross);
      c.stroke();
      c.strokeStyle = "rgba(255,200,0,1)";
      c.lineWidth = Math.max(2, minStroke);
      c.beginPath();
      c.moveTo(-cross, 0);
      c.lineTo(cross, 0);
      c.moveTo(0, -cross);
      c.lineTo(0, cross);
      c.stroke();
      c.restore();
    };

    ctx.clearRect(0, 0, THUMB_W, thumbH);
    if (thumbnailCanvas) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(thumbnailCanvas, 0, 0, THUMB_W, thumbH);
    } else {
      ctx.fillStyle = "#555";
      ctx.fillRect(0, 0, THUMB_W, thumbH);
    }
    drawViewport(ctx);
  }, [
    thumbnailCanvas,
    thumbnailVersion,
    viewTransform,
    thumbH,
    canvasWidth,
    canvasHeight,
    isFlipped,
  ]);

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
      const panX = -(tx - 0.5) * canvasWidth * viewTransform.zoom;
      const panY = -(ty - 0.5) * canvasHeight * viewTransform.zoom;
      onSetTransform({ ...viewTransform, panX, panY });
    },
    [viewTransform, onSetTransform, canvasWidth, canvasHeight],
  );

  return (
    <div
      data-ocid="navigator.panel"
      style={{
        width: "100%",
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Header — fixed height, never shrinks */}
      <button
        type="button"
        className="flex items-center justify-between w-full px-2 py-1 cursor-pointer select-none text-left"
        style={{ flexShrink: 0 }}
        onClick={() => setCollapsed((c) => !c)}
      >
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Navigator
        </span>
        <span className="text-muted-foreground text-[10px]">
          {collapsed ? "+" : "\u2212"}
        </span>
      </button>

      {!collapsed && (
        /* Canvas wrapper: takes all remaining height in the 25%-capped container,
           centers the canvas so it scales down with aspect ratio preserved (object-fit: contain style) */
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflow: "hidden",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <canvas
            ref={thumbRef}
            width={THUMB_W}
            height={thumbH}
            data-ocid="navigator.canvas_target"
            className="cursor-crosshair"
            style={{
              display: "block",
              maxWidth: "100%",
              maxHeight: "100%",
              width: "auto",
              height: "auto",
            }}
            onPointerDown={handleThumbPointer}
            onPointerMove={handleThumbPointer}
            onPointerUp={handleThumbPointer}
            onPointerCancel={handleThumbPointer}
          />
        </div>
      )}
    </div>
  );
}
