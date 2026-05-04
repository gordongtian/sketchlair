import { useCallback, useEffect, useRef } from "react";

type CP = [number, number, number, number];

interface PressureCurveEditorProps {
  value: CP;
  onChange: (v: CP) => void;
}

const PRESETS: { label: string; value: CP }[] = [
  { label: "Linear", value: [0.25, 0.25, 0.75, 0.75] },
  { label: "S-Curve", value: [0.1, 0.4, 0.9, 0.6] },
  { label: "Heavy", value: [0.5, 0.1, 0.9, 0.5] },
  { label: "Light", value: [0.1, 0.5, 0.5, 0.9] },
];

const SIZE = 160;
const PAD = 14;
const INNER = SIZE - PAD * 2;
const HANDLE_R = 5;

function toCanvas(norm: number): number {
  return PAD + norm * INNER;
}
function fromCanvas(px: number): number {
  return Math.max(0, Math.min(1, (px - PAD) / INNER));
}

export function PressureCurveEditor({
  value,
  onChange,
}: PressureCurveEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const draggingRef = useRef<null | 0 | 1>(null); // 0 = cp1, 1 = cp2

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const [p1x, p1y, p2x, p2y] = value;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Background
    ctx.fillStyle = "#1a1a1f";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const s = dpr;

    // Grid lines
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 1;
    for (let i = 1; i <= 3; i++) {
      const x = toCanvas(i / 4) * s;
      const y = toCanvas(i / 4) * s;
      ctx.beginPath();
      ctx.moveTo(x, PAD * s);
      ctx.lineTo(x, (PAD + INNER) * s);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(PAD * s, y);
      ctx.lineTo((PAD + INNER) * s, y);
      ctx.stroke();
    }

    // Border
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 1;
    ctx.strokeRect(PAD * s, PAD * s, INNER * s, INNER * s);

    // Linear reference line
    ctx.strokeStyle = "rgba(255,255,255,0.15)";
    ctx.setLineDash([3 * s, 3 * s]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD * s, (PAD + INNER) * s);
    ctx.lineTo((PAD + INNER) * s, PAD * s);
    ctx.stroke();
    ctx.setLineDash([]);

    // Control handle lines
    ctx.strokeStyle = "rgba(120,120,180,0.4)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD * s, (PAD + INNER) * s); // P0
    ctx.lineTo(toCanvas(p1x) * s, toCanvas(1 - p1y) * s);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo((PAD + INNER) * s, PAD * s); // P3
    ctx.lineTo(toCanvas(p2x) * s, toCanvas(1 - p2y) * s);
    ctx.stroke();

    // Bezier curve
    ctx.strokeStyle = "#a78bfa";
    ctx.lineWidth = 2 * s;
    ctx.beginPath();
    ctx.moveTo(PAD * s, (PAD + INNER) * s);
    ctx.bezierCurveTo(
      toCanvas(p1x) * s,
      toCanvas(1 - p1y) * s,
      toCanvas(p2x) * s,
      toCanvas(1 - p2y) * s,
      (PAD + INNER) * s,
      PAD * s,
    );
    ctx.stroke();

    // Control point handles
    const drawHandle = (nx: number, ny: number, color: string) => {
      ctx.fillStyle = color;
      ctx.strokeStyle = "rgba(255,255,255,0.6)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(
        toCanvas(nx) * s,
        toCanvas(1 - ny) * s,
        HANDLE_R * s,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      ctx.stroke();
    };

    drawHandle(p1x, p1y, "#7c3aed");
    drawHandle(p2x, p2y, "#5b21b6");

    // Axis labels
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.font = `${9 * s}px sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText("Input Pressure", (PAD + INNER / 2) * s, (SIZE - 2) * s);
    ctx.save();
    ctx.translate(5 * s, (PAD + INNER / 2) * s);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("Output", 0, 0);
    ctx.restore();
  }, [value]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = SIZE * dpr;
    canvas.height = SIZE * dpr;
    canvas.style.width = `${SIZE}px`;
    canvas.style.height = `${SIZE}px`;
    draw();
  }, [draw]);

  const hitTest = useCallback(
    (cx: number, cy: number): null | 0 | 1 => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const scaleX = SIZE / rect.width;
      const scaleY = SIZE / rect.height;
      const px = (cx - rect.left) * scaleX;
      const py = (cy - rect.top) * scaleY;
      const [p1x, p1y, p2x, p2y] = value;

      const d1 = Math.hypot(px - toCanvas(p1x), py - toCanvas(1 - p1y));
      const d2 = Math.hypot(px - toCanvas(p2x), py - toCanvas(1 - p2y));
      const threshold = 12;
      if (d1 < threshold && d1 <= d2) return 0;
      if (d2 < threshold) return 1;
      return null;
    },
    [value],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const hit = hitTest(e.clientX, e.clientY);
      if (hit === null) return;
      draggingRef.current = hit;
      (e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId);
      e.preventDefault();
    },
    [hitTest],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (draggingRef.current === null) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const scaleX = SIZE / rect.width;
      const scaleY = SIZE / rect.height;
      const px = (e.clientX - rect.left) * scaleX;
      const py = (e.clientY - rect.top) * scaleY;
      const nx = fromCanvas(px);
      const ny = 1 - fromCanvas(py);
      const next: CP = [...value] as CP;
      if (draggingRef.current === 0) {
        next[0] = nx;
        next[1] = ny;
      } else {
        next[2] = nx;
        next[3] = ny;
      }
      onChange(next);
      e.preventDefault();
    },
    [value, onChange],
  );

  const onPointerUp = useCallback(() => {
    draggingRef.current = null;
  }, []);

  return (
    <div className="flex flex-col gap-2">
      <canvas
        ref={canvasRef}
        style={{ cursor: "crosshair", touchAction: "none", display: "block" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="rounded"
      />
      {/* Preset buttons — 2×2 grid, auto-width (compact) */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, auto)",
          justifyContent: "start",
          gap: 4,
        }}
      >
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => onChange(p.value)}
            className="px-1 py-1 text-xs rounded bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors"
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}
