import type { RefObject } from "react";

// --- RotateCrosshairOverlay ---

interface RotateCrosshairOverlayProps {
  visible: boolean;
}

export function RotateCrosshairOverlay({
  visible,
}: RotateCrosshairOverlayProps) {
  if (!visible) return null;

  return (
    <div
      style={{
        position: "fixed",
        left: "50%",
        top: "50%",
        transform: "translate(-50%, -50%)",
        pointerEvents: "none",
        zIndex: 30,
      }}
    >
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="white"
        strokeWidth="1.5"
        style={{ filter: "drop-shadow(0 0 1px rgba(0,0,0,0.8))" }}
        role="img"
        aria-label="Rotation center"
      >
        <title>Rotation center</title>
        <line x1="12" y1="2" x2="12" y2="22" />
        <line x1="2" y1="12" x2="22" y2="12" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    </div>
  );
}

// --- BrushSizeOverlayCanvas ---

interface BrushSizeOverlayCanvasProps {
  canvasRef: RefObject<HTMLCanvasElement | null>;
}

export function BrushSizeOverlayCanvas({
  canvasRef,
}: BrushSizeOverlayCanvasProps) {
  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "fixed",
        pointerEvents: "none",
        transform: "translate(-50%, -50%)",
        zIndex: 9999,
      }}
    />
  );
}

// --- SoftwareCursorCanvas ---

interface SoftwareCursorCanvasProps {
  canvasRef: RefObject<HTMLCanvasElement | null>;
}

export function SoftwareCursorCanvas({ canvasRef }: SoftwareCursorCanvasProps) {
  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "fixed",
        pointerEvents: "none",
        transform: "translate(-50%, -50%)",
        zIndex: 9998,
      }}
    />
  );
}
