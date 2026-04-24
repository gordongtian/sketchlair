/**
 * CtrlRightClickLayerMenu — a floating layer-picker that appears when the
 * user holds Ctrl (or Cmd) and right-clicks the main canvas.
 *
 * Design: matches existing Popover / ContextMenu style used elsewhere
 * (bg-popover, rounded-md, border, shadow-md, text-popover-foreground).
 *
 * Behaviour:
 *  - Positioned at the cursor's screen coords, clamped to stay in the viewport.
 *  - Closed by: clicking outside, pressing Escape, any external close trigger.
 *  - Removed from the DOM entirely when not open (conditional render by caller).
 *  - Locked layers shown disabled with a Lock icon; clicking them is a no-op.
 *  - Active layer highlighted with a Check icon.
 *  - Layer thumbnails drawn from layerCanvasesRef into small 28×28 canvases.
 */

import { Check, Lock } from "lucide-react";
import { useEffect, useRef } from "react";
import type React from "react";
import type { Layer } from "./LayersPanel";

interface CtrlRightClickLayerMenuProps {
  /** Filtered list of paint layers that have content at the clicked pixel. */
  layers: Layer[];
  /** Screen-space position of the right-click event (from e.clientX / e.clientY). */
  position: { x: number; y: number };
  /** Currently active layer ID. */
  activeLayerId: string;
  /** Called when the user picks a non-locked layer. */
  onSelect: (layerId: string) => void;
  /** Called to close the menu (without changing the active layer). */
  onClose: () => void;
  /** Live map of layer-id → HTMLCanvasElement for thumbnail rendering. */
  layerCanvasesRef: React.MutableRefObject<Map<string, HTMLCanvasElement>>;
}

const MENU_W = 220;
const THUMB_SIZE = 28;
const APPROX_ROW_H = 40; // px — used for viewport-overflow estimation
const HEADER_H = 28;

export function CtrlRightClickLayerMenu({
  layers,
  position,
  activeLayerId,
  onSelect,
  onClose,
  layerCanvasesRef,
}: CtrlRightClickLayerMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // ── Clamped position ────────────────────────────────────────────────────────
  const approxH = HEADER_H + layers.length * APPROX_ROW_H + 8;
  const clampedX =
    position.x + MENU_W > window.innerWidth
      ? Math.max(0, position.x - MENU_W)
      : position.x;
  const clampedY =
    position.y + approxH > window.innerHeight
      ? Math.max(0, position.y - approxH)
      : position.y;

  // ── Close on outside click ──────────────────────────────────────────────────
  useEffect(() => {
    const handlePointerDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    // Use capture so it fires before canvas pointer-down handlers.
    document.addEventListener("pointerdown", handlePointerDown, {
      capture: true,
    });
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, {
        capture: true,
      });
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      data-ocid="ctrl-right-click-layer-menu"
      style={{
        position: "fixed",
        left: clampedX,
        top: clampedY,
        width: MENU_W,
        zIndex: 9999,
      }}
      className="rounded-md border border-border bg-popover text-popover-foreground shadow-md py-1 select-none"
    >
      {/* Header */}
      <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide border-b border-border mb-1">
        Select Layer
      </div>

      {layers.map((layer) => {
        const isActive = layer.id === activeLayerId;
        const isLocked = !!(layer as unknown as Record<string, unknown>)
          .isLocked;

        return (
          <button
            key={layer.id}
            type="button"
            data-ocid={`ctrl-right-click-layer-menu.item.${layer.id}`}
            disabled={isLocked}
            onClick={() => {
              if (!isLocked) {
                onSelect(layer.id);
              }
            }}
            className={[
              "w-full flex items-center gap-2 px-2 py-1.5 text-sm text-left rounded-sm transition-colors duration-100",
              isActive
                ? "bg-accent text-accent-foreground"
                : "hover:bg-accent/50",
              isLocked ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
            ].join(" ")}
          >
            {/* Check / Lock indicator — fixed 16px width to keep layout stable */}
            <span className="flex-shrink-0 w-4 flex items-center justify-center">
              {isActive ? (
                <Check size={12} className="text-primary" />
              ) : isLocked ? (
                <Lock size={12} className="text-muted-foreground" />
              ) : null}
            </span>

            {/* Thumbnail */}
            <LayerThumb
              layerId={layer.id}
              layerCanvasesRef={layerCanvasesRef}
            />

            {/* Layer name */}
            <span className="flex-1 min-w-0 truncate">{layer.name}</span>

            {/* Lock badge if locked (redundant with the left icon but explicit) */}
            {isLocked && (
              <Lock size={10} className="flex-shrink-0 text-muted-foreground" />
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── Thumbnail sub-component ───────────────────────────────────────────────────

interface LayerThumbProps {
  layerId: string;
  layerCanvasesRef: React.MutableRefObject<Map<string, HTMLCanvasElement>>;
}

function LayerThumb({ layerId, layerCanvasesRef }: LayerThumbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const thumb = canvasRef.current;
    if (!thumb) return;
    const src = layerCanvasesRef.current.get(layerId);
    const ctx = thumb.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, THUMB_SIZE, THUMB_SIZE);
    if (src && src.width > 0 && src.height > 0) {
      // Draw a checkerboard background for transparency
      ctx.fillStyle = "#ccc";
      ctx.fillRect(0, 0, THUMB_SIZE, THUMB_SIZE);
      ctx.fillStyle = "#fff";
      const sq = THUMB_SIZE / 4;
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 4; c++) {
          if ((r + c) % 2 === 0) ctx.fillRect(c * sq, r * sq, sq, sq);
        }
      }
      // Draw the layer canvas scaled to the thumbnail
      ctx.drawImage(src, 0, 0, THUMB_SIZE, THUMB_SIZE);
    } else {
      ctx.fillStyle = "#888";
      ctx.fillRect(0, 0, THUMB_SIZE, THUMB_SIZE);
    }
  }, [layerId, layerCanvasesRef]);

  return (
    <canvas
      ref={canvasRef}
      width={THUMB_SIZE}
      height={THUMB_SIZE}
      className="flex-shrink-0 rounded-sm border border-border/40"
      style={{ width: THUMB_SIZE, height: THUMB_SIZE }}
    />
  );
}
