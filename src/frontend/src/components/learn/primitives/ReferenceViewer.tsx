// ── ReferenceViewer ────────────────────────────────────────────────────────────
//
// Self-contained reference image display primitive for Learn modules.
// Supports four modes: flash, side, floating, tracing.
//
// Mode responsibilities:
// - "tracing": handled externally via layer system — this component returns null.
// - "side": handled externally via world-space canvas injection — this component returns null.
//   The side canvas is managed imperatively by FigureDrawingSession, appended as a
//   position:absolute sibling inside the canvasWrapperRef world-space container.
// - "flash": rendered here as a screen-space fixed overlay (position: fixed, pointer-events: none).
// - "floating": rendered here as a draggable + fully resizable screen-space overlay.
//
// COORDINATE MAPPING GUARANTEE:
// Neither FlashViewer nor FloatingViewer affect the main canvas's DOM position or
// bounding rect in any way:
//   - Both use position: fixed — they are screen-space overlays completely outside
//     the document flow and outside the world-space transform container.
//   - FloatingViewer's canvas area has pointer-events: none so strokes pass through
//     to the main canvas.
//   - Resize/drag handles have pointer-events: auto so the window can be moved/resized.
//   - The main canvas's getBoundingClientRect() is unaffected by either overlay.

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

export interface ReferenceViewerProps {
  image: ImageBitmap | null;
  mode: "flash" | "side" | "floating" | "tracing";
  handedness: "left" | "right";
  onFlashComplete: () => void;
}

export interface ReferenceViewerHandle {
  /** Used externally to swap the image (e.g. tracing mode layer updates) */
  swapImage: (newImage: ImageBitmap) => void;
}

// ── Flash mode ─────────────────────────────────────────────────────────────────
// Uses position: fixed so it is a screen-space overlay that cannot affect the
// main canvas's layout or bounding rect. pointer-events: none so strokes pass
// through to the main canvas during and after the flash.

function FlashViewer({
  image,
  onFlashComplete,
}: {
  image: ImageBitmap | null;
  onFlashComplete: () => void;
}) {
  const [visible, setVisible] = useState(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const completedRef = useRef(false);
  const onCompleteRef = useRef(onFlashComplete);
  useEffect(() => {
    onCompleteRef.current = onFlashComplete;
  }, [onFlashComplete]);

  useEffect(() => {
    if (!image) return;
    completedRef.current = false;
    setVisible(true);
    timerRef.current = setTimeout(() => {
      setVisible(false);
      if (!completedRef.current) {
        completedRef.current = true;
        onCompleteRef.current();
      }
    }, 5000);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [image]);

  if (!image || !visible) return null;

  return (
    // position: fixed — screen-space overlay, does NOT affect any element's layout
    // or bounding rect. pointer-events: none — strokes pass through to main canvas.
    <div
      className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none"
      style={{ backgroundColor: "oklch(var(--canvas-bg) / 0.75)" }}
    >
      <div
        className="relative rounded-xl overflow-hidden shadow-2xl"
        style={{ maxWidth: "60vw", maxHeight: "70vh" }}
      >
        <canvas
          ref={(el) => {
            if (!el || !image) return;
            el.width = image.width;
            el.height = image.height;
            const ctx = el.getContext("2d");
            ctx?.drawImage(image, 0, 0);
          }}
          style={{
            display: "block",
            maxWidth: "60vw",
            maxHeight: "70vh",
            objectFit: "contain",
          }}
        />
        <div
          className="absolute bottom-3 left-1/2 -translate-x-1/2 text-xs px-3 py-1 rounded-full font-medium"
          style={{
            backgroundColor: "oklch(var(--toolbar) / 0.9)",
            color: "oklch(var(--muted-text))",
          }}
        >
          Memorise this pose
        </div>
      </div>
    </div>
  );
}

// ── Side mode ─────────────────────────────────────────────────────────────────
// Side mode is handled by FigureDrawingSession which injects a canvas element
// directly into the canvasWrapperRef world-space container. Nothing is rendered
// by ReferenceViewer in this mode.

// ── Floating mode ─────────────────────────────────────────────────────────────
//
// A draggable, fully resizable screen-space window (position: fixed).
// Uses posRef for position/size during drag/resize so every pixel of movement
// does NOT trigger a React re-render — styles are applied directly to the DOM.
// A single forceUpdate fires on pointerup to commit state once.
//
// 8 resize handles: nw / n / ne / e / se / s / sw / w
// Each handle knows which dimensions it controls:
//   - corner handles: both x+y
//   - edge handles: one axis only
// For top/left anchored handles, the origin must move opposite to the size delta.
//
// Coordinate mapping guarantee:
//   - position: fixed → outside document flow, cannot shift main canvas
//   - canvas area: pointer-events: none → strokes pass through to main canvas
//   - handles: pointer-events: auto → user can still drag/resize

type ResizeDir = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

interface ResizeState {
  dir: ResizeDir;
  startX: number;
  startY: number;
  origX: number;
  origY: number;
  origW: number;
  origH: number;
}

const FLOAT_DEFAULT_W = 280;
const FLOAT_DEFAULT_H = 360;
const FLOAT_MIN = 100;

function clamp(val: number, min: number, max: number) {
  return Math.max(min, Math.min(max, val));
}

function getMaxSize() {
  return {
    maxW: Math.floor(window.innerWidth * 0.8),
    maxH: Math.floor(window.innerHeight * 0.8),
  };
}

/** Clamp the window rect so it stays fully within the viewport. */
function clampToViewport(x: number, y: number, w: number, h: number) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const cx = clamp(x, 0, vw - w);
  const cy = clamp(y, 0, vh - h);
  return { x: cx, y: cy };
}

// Cursor per resize direction
const RESIZE_CURSORS: Record<ResizeDir, string> = {
  nw: "nwse-resize",
  se: "nwse-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
};

// 8 handle definitions: position (as CSS), which axes they control
interface HandleDef {
  dir: ResizeDir;
  style: React.CSSProperties;
}

const HANDLE_DEFS: HandleDef[] = [
  // Corners
  { dir: "nw", style: { top: -6, left: -6 } },
  { dir: "ne", style: { top: -6, right: -6 } },
  { dir: "se", style: { bottom: -6, right: -6 } },
  { dir: "sw", style: { bottom: -6, left: -6 } },
  // Edges — use transform to center on the edge
  { dir: "n", style: { top: -6, left: "50%", transform: "translateX(-50%)" } },
  {
    dir: "s",
    style: { bottom: -6, left: "50%", transform: "translateX(-50%)" },
  },
  { dir: "e", style: { right: -6, top: "50%", transform: "translateY(-50%)" } },
  { dir: "w", style: { left: -6, top: "50%", transform: "translateY(-50%)" } },
];

function FloatingViewer({
  image,
  handedness,
}: {
  image: ImageBitmap | null;
  handedness: "left" | "right";
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // posRef holds position + size during drag/resize to avoid per-pixel re-renders
  const posRef = useRef<{ x: number; y: number; w: number; h: number } | null>(
    null,
  );
  const divRef = useRef<HTMLDivElement>(null);

  // Drag state (title bar drag-to-move)
  const dragRef = useRef<{
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);

  // Resize state
  const resizeRef = useRef<ResizeState | null>(null);

  const [, forceUpdate] = useState(0);

  // Initialize position once based on handedness
  if (!posRef.current) {
    const x =
      handedness === "right" ? 24 : window.innerWidth - FLOAT_DEFAULT_W - 24;
    posRef.current = { x, y: 80, w: FLOAT_DEFAULT_W, h: FLOAT_DEFAULT_H };
  }

  // Draw image to canvas whenever it changes
  useEffect(() => {
    const el = canvasRef.current;
    if (!el || !image) return;
    el.width = image.width;
    el.height = image.height;
    const ctx = el.getContext("2d");
    ctx?.drawImage(image, 0, 0);
  }, [image]);

  // ── Title bar: drag-to-move ─────────────────────────────────────────────────
  const handleTitlePointerDown = useCallback((e: React.PointerEvent) => {
    if (!posRef.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: posRef.current.x,
      origY: posRef.current.y,
    };
  }, []);

  // ── Resize handle: pointerdown ──────────────────────────────────────────────
  const handleResizePointerDown = useCallback(
    (e: React.PointerEvent, dir: ResizeDir) => {
      e.stopPropagation(); // prevent drag-to-move from also activating
      if (!posRef.current) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      resizeRef.current = {
        dir,
        startX: e.clientX,
        startY: e.clientY,
        origX: posRef.current.x,
        origY: posRef.current.y,
        origW: posRef.current.w,
        origH: posRef.current.h,
      };
    },
    [],
  );

  // ── Pointer move: handle both drag and resize ───────────────────────────────
  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    // Drag-to-move
    if (dragRef.current && posRef.current) {
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      const rawX = dragRef.current.origX + dx;
      const rawY = dragRef.current.origY + dy;
      const { x, y } = clampToViewport(
        rawX,
        rawY,
        posRef.current.w,
        posRef.current.h,
      );
      posRef.current = { ...posRef.current, x, y };
      if (divRef.current) {
        divRef.current.style.left = `${x}px`;
        divRef.current.style.top = `${y}px`;
      }
    }

    // Resize
    if (resizeRef.current && posRef.current) {
      const rs = resizeRef.current;
      const { maxW, maxH } = getMaxSize();
      const dx = e.clientX - rs.startX;
      const dy = e.clientY - rs.startY;
      const dir = rs.dir;

      let newX = rs.origX;
      let newY = rs.origY;
      let newW = rs.origW;
      let newH = rs.origH;

      // Width changes for e/ne/se and w/nw/sw
      if (dir === "e" || dir === "ne" || dir === "se") {
        newW = clamp(rs.origW + dx, FLOAT_MIN, maxW);
      } else if (dir === "w" || dir === "nw" || dir === "sw") {
        const proposedW = clamp(rs.origW - dx, FLOAT_MIN, maxW);
        newX = rs.origX + (rs.origW - proposedW);
        newW = proposedW;
      }

      // Height changes for s/se/sw and n/ne/nw
      if (dir === "s" || dir === "se" || dir === "sw") {
        newH = clamp(rs.origH + dy, FLOAT_MIN, maxH);
      } else if (dir === "n" || dir === "ne" || dir === "nw") {
        const proposedH = clamp(rs.origH - dy, FLOAT_MIN, maxH);
        newY = rs.origY + (rs.origH - proposedH);
        newH = proposedH;
      }

      // Clamp position so window stays within viewport
      const clamped = clampToViewport(newX, newY, newW, newH);
      newX = clamped.x;
      newY = clamped.y;

      posRef.current = { x: newX, y: newY, w: newW, h: newH };
      if (divRef.current) {
        divRef.current.style.left = `${newX}px`;
        divRef.current.style.top = `${newY}px`;
        divRef.current.style.width = `${newW}px`;
        divRef.current.style.height = `${newH}px`;
      }
    }
  }, []);

  // ── Pointer up: commit to state once ───────────────────────────────────────
  const handlePointerUp = useCallback(() => {
    dragRef.current = null;
    resizeRef.current = null;
    forceUpdate((n) => n + 1);
  }, []);

  if (!image || !posRef.current) return null;

  const pos = posRef.current;

  return (
    // position: fixed — screen-space overlay. Does NOT affect the main canvas's
    // bounding rect or document layout in any way.
    <div
      ref={divRef}
      className="fixed z-50 rounded-xl shadow-2xl flex flex-col"
      style={{
        left: pos.x,
        top: pos.y,
        width: pos.w,
        height: pos.h,
        minWidth: FLOAT_MIN,
        minHeight: FLOAT_MIN,
        backgroundColor: "oklch(var(--toolbar))",
        border: "1px solid oklch(var(--outline))",
        // overflow: visible so resize handles (positioned outside) are clickable
        overflow: "visible",
      }}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {/* Title bar — drag handle. pointer-events: auto (inherited default) */}
      <div
        className="flex items-center justify-between px-2 py-1 shrink-0 cursor-grab active:cursor-grabbing select-none rounded-t-xl"
        style={{
          backgroundColor: "oklch(var(--sidebar-left))",
          borderBottom: "1px solid oklch(var(--outline))",
        }}
        onPointerDown={handleTitlePointerDown}
      >
        <span
          className="text-[10px] font-medium uppercase tracking-wider"
          style={{ color: "oklch(var(--muted-text))" }}
        >
          Reference
        </span>
        {/* Drag indicator dots */}
        <div className="flex gap-0.5 opacity-40">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="w-1 h-1 rounded-full"
              style={{ backgroundColor: "oklch(var(--muted-text))" }}
            />
          ))}
        </div>
      </div>

      {/* Image area — pointer-events: none so strokes pass through to main canvas */}
      <div
        className="flex-1 relative rounded-b-xl overflow-hidden"
        style={{
          backgroundColor: "#1a1a1a",
          pointerEvents: "none",
        }}
      >
        <canvas
          ref={canvasRef}
          style={{
            display: "block",
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "contain",
          }}
        />
      </div>

      {/* 8 resize handles — pointer-events: auto so they can be grabbed */}
      {HANDLE_DEFS.map(({ dir, style }) => (
        <div
          key={dir}
          aria-label={`Resize ${dir}`}
          style={{
            position: "absolute",
            width: 12,
            height: 12,
            borderRadius: 2,
            backgroundColor: "oklch(var(--accent) / 0.7)",
            border: "1px solid oklch(var(--outline))",
            cursor: RESIZE_CURSORS[dir],
            pointerEvents: "auto",
            zIndex: 10,
            ...style,
          }}
          onPointerDown={(e) => handleResizePointerDown(e, dir)}
        />
      ))}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export const ReferenceViewer = forwardRef<
  ReferenceViewerHandle,
  ReferenceViewerProps
>(function ReferenceViewer({ image, mode, handedness, onFlashComplete }, ref) {
  // Expose swapImage handle (no-op — tracing is handled externally via layers)
  useImperativeHandle(
    ref,
    () => ({
      swapImage: (_newImage: ImageBitmap) => {
        // Tracing mode: handled externally via canvas layer system
      },
    }),
    [],
  );

  // "tracing" — handled via layer system, nothing to render here.
  // The reference layer canvas in layerCanvasesRef is NOT a DOM element visible
  // to layout — it does not affect the main canvas's bounding rect.
  if (mode === "tracing") return null;

  // "side" — handled by FigureDrawingSession which injects the canvas directly
  // into the world-space container (canvasWrapperRef) as a position:absolute sibling.
  // Nothing to render here.
  if (mode === "side") return null;

  if (mode === "flash") {
    return <FlashViewer image={image} onFlashComplete={onFlashComplete} />;
  }

  if (mode === "floating") {
    return <FloatingViewer image={image} handedness={handedness} />;
  }

  return null;
});
