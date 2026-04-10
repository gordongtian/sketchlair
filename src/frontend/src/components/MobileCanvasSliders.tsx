import type React from "react";
import { useRef } from "react";

// Mirror the log-scale conversion from BottomBar
function sliderToSize(v: number): number {
  if (v <= 50) return 1 + (v / 50) * 99;
  return 100 + ((v - 50) / 50) * 900;
}
function sizeToSlider(size: number): number {
  if (size <= 100) return Math.max(0, ((size - 1) / 99) * 50);
  return 50 + ((size - 100) / 900) * 50;
}

interface MobileCanvasSlidersProps {
  brushSize: number;
  brushOpacity: number;
  brushFlow: number;
  onBrushSizeChange: (v: number) => void;
  onBrushOpacityChange: (v: number) => void;
  onBrushFlowChange: (v: number) => void;
  leftHanded?: boolean;
}

export function MobileCanvasSliders({
  brushSize,
  brushOpacity,
  brushFlow,
  onBrushSizeChange,
  onBrushOpacityChange,
  onBrushFlowChange,
  leftHanded = false,
}: MobileCanvasSlidersProps) {
  const sliders = [
    {
      label: "F",
      title: "Flow",
      value: brushFlow,
      min: 0.01,
      max: 1,
      onChange: (norm: number) => onBrushFlowChange(Math.max(0.01, norm)),
    },
    {
      label: "O",
      title: "Opacity",
      value: brushOpacity,
      min: 0.01,
      max: 1,
      onChange: (norm: number) => onBrushOpacityChange(Math.max(0.01, norm)),
    },
    {
      label: "S",
      title: "Size",
      value: sizeToSlider(brushSize) / 100,
      min: 0,
      max: 1,
      onChange: (norm: number) =>
        onBrushSizeChange(Math.round(sliderToSize(norm * 100))),
    },
  ];

  return (
    <div
      style={{
        position: "absolute",
        ...(leftHanded ? { right: 6 } : { left: 6 }),
        // Never exceed screen height — cap at 90dvh and center vertically
        top: "50%",
        transform: "translateY(-50%)",
        maxHeight: "min(90dvh, 100%)",
        width: 44,
        height: "min(90dvh, 100%)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        zIndex: 20,
        pointerEvents: "none",
      }}
    >
      {sliders.map((slider) => (
        <SliderItem key={slider.label} {...slider} />
      ))}
    </div>
  );
}

function SliderItem({
  label,
  title,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  title: string;
  value: number;
  min: number;
  max: number;
  onChange: (norm: number) => void;
}) {
  const draggingRef = useRef(false);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  // Normalized 0–1 fill percentage
  const fillPct = ((value - min) / (max - min)) * 100;

  const computeValue = (clientY: number): number => {
    const track = trackRef.current;
    if (!track) return value;
    const rect = track.getBoundingClientRect();
    const norm = (rect.bottom - clientY) / rect.height;
    return Math.min(max, Math.max(min, min + norm * (max - min)));
  };

  const getTooltipText = (val: number): string => {
    if (label === "S") {
      return `${Math.round(sliderToSize(val * 100))}px`;
    }
    return `${Math.round(val * 100)}%`;
  };

  const showTooltip = (val: number) => {
    if (tooltipRef.current) {
      tooltipRef.current.style.display = "block";
      tooltipRef.current.textContent = getTooltipText(val);
    }
  };

  const hideTooltip = () => {
    if (tooltipRef.current) {
      tooltipRef.current.style.display = "none";
    }
  };

  const updateFill = (val: number) => {
    const pct = ((val - min) / (max - min)) * 100;
    if (fillRef.current) {
      fillRef.current.style.height = `${pct}%`;
    }
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    draggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    const val = computeValue(e.clientY);
    updateFill(val);
    showTooltip(val);
    onChange(val);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    e.preventDefault();
    const val = computeValue(e.clientY);
    updateFill(val);
    showTooltip(val);
    onChange(val);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
    hideTooltip();
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 3,
        flex: 1,
        // Each slider takes at most 1/3 of the container, capped so all 3 fit
        maxHeight: "33%",
        pointerEvents: "auto",
        position: "relative",
        width: "100%",
      }}
    >
      {/* Label */}
      <span
        style={{
          fontSize: 9,
          fontWeight: 700,
          color: "oklch(var(--muted-foreground))",
          letterSpacing: "0.08em",
          lineHeight: 1,
          userSelect: "none",
          textTransform: "uppercase",
        }}
        title={title}
      >
        {label}
      </span>

      {/* Flat square track */}
      <div
        ref={trackRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        style={{
          flex: 1,
          width: 40,
          position: "relative",
          background: "oklch(var(--slider-bg, var(--muted)))",
          borderRadius: 0,
          overflow: "hidden",
          cursor: "ns-resize",
          touchAction: "none",
        }}
      >
        {/* Fill indicator — grows from bottom */}
        <div
          ref={fillRef}
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            height: `${fillPct}%`,
            background: "oklch(var(--slider-highlight))",
            pointerEvents: "none",
          }}
        />
      </div>

      {/* Tooltip — shown while dragging */}
      <div
        ref={tooltipRef}
        style={{
          display: "none",
          position: "absolute",
          left: "calc(100% + 8px)",
          top: "50%",
          transform: "translateY(-50%)",
          background: "oklch(var(--toolbar))",
          color: "oklch(var(--foreground))",
          fontSize: 11,
          fontWeight: 600,
          padding: "4px 8px",
          border: "1px solid oklch(var(--border))",
          whiteSpace: "nowrap",
          pointerEvents: "none",
          zIndex: 100,
        }}
      />
    </div>
  );
}
