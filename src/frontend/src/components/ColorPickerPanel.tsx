import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import type { HSVAColor } from "@/utils/colorUtils";
import { hexToRgb, hsvToRgb, hsvaToHex, rgbToHsv } from "@/utils/colorUtils";
import { SlidersHorizontal } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

interface ColorPickerPanelProps {
  color: HSVAColor;
  onColorChange: (color: HSVAColor) => void;
  recentColors: string[];
  onRecentColorClick: (hex: string) => void;
}

// ---- Photoshop-style Gradient Slider ----
interface GradientSliderProps {
  value: number;
  min: number;
  max: number;
  gradient: string;
  onChange: (v: number) => void;
  ocid?: string;
}

export function GradientSlider({
  value,
  min,
  max,
  gradient,
  onChange,
  ocid,
}: GradientSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const getValue = (clientX: number) => {
    const track = trackRef.current;
    if (!track) return value;
    const rect = track.getBoundingClientRect();
    const t = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return Math.round(min + t * (max - min));
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    isDragging.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    onChange(getValue(e.clientX));
  };
  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging.current) return;
    onChange(getValue(e.clientX));
  };
  const handlePointerUp = () => {
    isDragging.current = false;
  };

  const pct = ((value - min) / (max - min)) * 100;
  // Clamp thumb position to avoid overflow
  const thumbLeft = `clamp(6px, calc(${pct}% - 0px), calc(100% - 6px))`;

  return (
    <div
      ref={trackRef}
      data-ocid={ocid}
      role="slider"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      tabIndex={0}
      className="relative flex-1 cursor-pointer select-none"
      style={{
        height: 18,
        borderRadius: 2,
        background: gradient,
        touchAction: "none",
        paddingBottom: 0,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight" || e.key === "ArrowUp")
          onChange(Math.min(max, value + 1));
        if (e.key === "ArrowLeft" || e.key === "ArrowDown")
          onChange(Math.max(min, value - 1));
      }}
    >
      {/* Upward-pointing white triangle thumb */}
      <div
        className="absolute pointer-events-none"
        style={{
          left: thumbLeft,
          bottom: -1,
          transform: "translateX(-50%)",
          width: 12,
          height: 10,
          clipPath: "polygon(50% 0%, 0% 100%, 100% 100%)",
          background: "oklch(var(--slider-handle))",
          filter: "drop-shadow(0 0 1px rgba(0,0,0,0.8))",
        }}
      />
      {/* Thin dark outline for the triangle for contrast */}
      <div
        className="absolute pointer-events-none"
        style={{
          left: thumbLeft,
          bottom: -2,
          transform: "translateX(-50%)",
          width: 14,
          height: 12,
          clipPath: "polygon(50% 0%, 0% 100%, 100% 100%)",
          background: "rgba(0,0,0,0.5)",
          zIndex: -1,
        }}
      />
    </div>
  );
}

export function ColorPickerPanel({
  color,
  onColorChange,
  recentColors,
  onRecentColorClick,
}: ColorPickerPanelProps) {
  const svCanvasRef = useRef<HTMLCanvasElement>(null);
  const svContainerRef = useRef<HTMLDivElement>(null);
  const hueCanvasRef = useRef<HTMLCanvasElement>(null);
  const [hexInput, setHexInput] = useState(hsvaToHex(color));
  const isDraggingSV = useRef(false);
  const isDraggingHue = useRef(false);
  const colorRef = useRef(color);
  const onColorChangeRef = useRef(onColorChange);
  const [showSV, setShowSV] = useState(true);
  const [showHue, setShowHue] = useState(true);
  const [showHex, setShowHex] = useState(false);
  const [showHsvSliders, setShowHsvSliders] = useState(false);
  const [showRgbSliders, setShowRgbSliders] = useState(false);
  const [showRecent, setShowRecent] = useState(true);

  // Track the canvas pixel dimensions so we can draw at the right resolution
  const [svPixelW, setSvPixelW] = useState(194);
  const SV_HEIGHT = 150;

  // ResizeObserver: keep canvas pixel width in sync with its CSS display width.
  // showSV is included so we re-observe whenever the container remounts.
  // biome-ignore lint/correctness/useExhaustiveDependencies: showSV triggers re-observe after container remount
  useEffect(() => {
    const container = svContainerRef.current;
    if (!container) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.round(entry.contentRect.width);
        if (w > 0) setSvPixelW(w);
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [showSV]);

  const drawSVSquare = useCallback(() => {
    const canvas = svCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { width, height } = canvas;
    const [hr, hg, hb] = hsvToRgb(color.h, 1, 1);
    ctx.fillStyle = `rgb(${hr},${hg},${hb})`;
    ctx.fillRect(0, 0, width, height);
    const whiteGrad = ctx.createLinearGradient(0, 0, width, 0);
    whiteGrad.addColorStop(0, "rgba(255,255,255,1)");
    whiteGrad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = whiteGrad;
    ctx.fillRect(0, 0, width, height);
    const blackGrad = ctx.createLinearGradient(0, 0, 0, height);
    blackGrad.addColorStop(0, "rgba(0,0,0,0)");
    blackGrad.addColorStop(1, "rgba(0,0,0,1)");
    ctx.fillStyle = blackGrad;
    ctx.fillRect(0, 0, width, height);
    // Draw selection circle — always use pixel-space radius so it stays circular
    // regardless of canvas CSS display size (canvas pixel dims match display dims
    // because we sync them via ResizeObserver).
    const cx = color.s * width;
    const cy = (1 - color.v) * height;
    const r = 6;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, r - 1, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }, [color.h, color.s, color.v]);

  const drawHueBar = useCallback(() => {
    const canvas = hueCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { width, height } = canvas;
    const grad = ctx.createLinearGradient(0, 0, width, 0);
    for (let i = 0; i <= 360; i += 30) {
      const [r, g, b] = hsvToRgb(i, 1, 1);
      grad.addColorStop(i / 360, `rgb(${r},${g},${b})`);
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);
    const cx = (color.h / 360) * width;
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.fillRect(cx - 2, 0, 4, height);
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(cx - 1, 0, 2, height);
  }, [color.h]);

  // Redraw SV square whenever color or canvas pixel width changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: showSV triggers redraw after canvas remount
  useEffect(() => {
    drawSVSquare();
  }, [drawSVSquare, showSV, svPixelW]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: showHue triggers redraw after canvas remount
  useEffect(() => {
    drawHueBar();
  }, [drawHueBar, showHue]);
  useEffect(() => {
    setHexInput(hsvaToHex(color));
  }, [color]);

  const handleSVPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      isDraggingSV.current = true;
      const canvas = svCanvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const s = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const v = Math.max(
        0,
        Math.min(1, 1 - (e.clientY - rect.top) / rect.height),
      );
      onColorChange({ ...color, s, v });
    },
    [color, onColorChange],
  );

  // Keep refs in sync with latest props so the window listener (registered once) always has current values
  useEffect(() => {
    colorRef.current = color;
  });
  useEffect(() => {
    onColorChangeRef.current = onColorChange;
  });

  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      if (isDraggingSV.current) {
        const canvas = svCanvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const s = Math.max(
          0,
          Math.min(1, (e.clientX - rect.left) / rect.width),
        );
        const v = Math.max(
          0,
          Math.min(1, 1 - (e.clientY - rect.top) / rect.height),
        );
        onColorChangeRef.current({ ...colorRef.current, s, v });
      }
      if (isDraggingHue.current) {
        const canvas = hueCanvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const h = Math.max(
          0,
          Math.min(360, ((e.clientX - rect.left) / rect.width) * 360),
        );
        onColorChangeRef.current({ ...colorRef.current, h });
      }
    };
    const handlePointerUp = () => {
      isDraggingSV.current = false;
      isDraggingHue.current = false;
    };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, []); // register once — color/onColorChange accessed via refs

  const handleHexChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setHexInput(val);
    const rgb = hexToRgb(val);
    if (rgb) {
      const [r, g, b] = rgb;
      const [h, s, v] = rgbToHsv(r, g, b);
      onColorChange({ ...color, h, s, v });
    }
  };

  const [rVal, gVal, bVal] = hsvToRgb(color.h, color.s, color.v);

  const handleRgbChange = (channel: "r" | "g" | "b", rawVal: number) => {
    const val = Math.max(0, Math.min(255, rawVal));
    const r2 = channel === "r" ? val : rVal;
    const g2 = channel === "g" ? val : gVal;
    const b2 = channel === "b" ? val : bVal;
    const [h, s, v] = rgbToHsv(r2, g2, b2);
    onColorChange({ ...color, h, s, v });
  };

  const handleHsvChange = (channel: "h" | "s" | "v", rawVal: number) => {
    if (channel === "h")
      onColorChange({ ...color, h: Math.max(0, Math.min(360, rawVal)) });
    else if (channel === "s")
      onColorChange({ ...color, s: Math.max(0, Math.min(1, rawVal / 100)) });
    else onColorChange({ ...color, v: Math.max(0, Math.min(1, rawVal / 100)) });
  };

  const hexDisplay = hsvaToHex(color);
  const previewStyle = { background: `rgb(${rVal},${gVal},${bVal})` };

  // Build gradient strings for each channel
  const hGradient = (() => {
    const stops: string[] = [];
    for (let i = 0; i <= 360; i += 30) {
      const [r, g, b] = hsvToRgb(i, color.s, color.v);
      stops.push(`rgb(${r},${g},${b}) ${(i / 360) * 100}%`);
    }
    return `linear-gradient(to right, ${stops.join(", ")})`;
  })();

  const [sv0R, sv0G, sv0B] = hsvToRgb(color.h, 0, color.v);
  const [sv1R, sv1G, sv1B] = hsvToRgb(color.h, 1, color.v);
  const sGradient = `linear-gradient(to right, rgb(${sv0R},${sv0G},${sv0B}), rgb(${sv1R},${sv1G},${sv1B}))`;

  const [vv0R, vv0G, vv0B] = hsvToRgb(color.h, color.s, 0);
  const [vv1R, vv1G, vv1B] = hsvToRgb(color.h, color.s, 1);
  const vGradient = `linear-gradient(to right, rgb(${vv0R},${vv0G},${vv0B}), rgb(${vv1R},${vv1G},${vv1B}))`;

  const rGradient = `linear-gradient(to right, rgb(0,${gVal},${bVal}), rgb(255,${gVal},${bVal}))`;
  const gGradient = `linear-gradient(to right, rgb(${rVal},0,${bVal}), rgb(${rVal},255,${bVal}))`;
  const bGradient = `linear-gradient(to right, rgb(${rVal},${gVal},0), rgb(${rVal},${gVal},255))`;

  return (
    <div className="flex flex-col">
      {/* Header row */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Color
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              data-ocid="color.visibility_dropdown_menu"
              className="w-5 h-5 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            >
              <SlidersHorizontal size={12} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuLabel className="text-xs">
              Show / Hide
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              checked={showSV}
              onCheckedChange={setShowSV}
            >
              SV Square
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={showHue}
              onCheckedChange={setShowHue}
            >
              Hue bar
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={showHex}
              onCheckedChange={setShowHex}
            >
              Hex input
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={showHsvSliders}
              onCheckedChange={setShowHsvSliders}
            >
              HSV sliders
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={showRgbSliders}
              onCheckedChange={setShowRgbSliders}
            >
              RGB sliders
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={showRecent}
              onCheckedChange={setShowRecent}
            >
              Recent colors
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Color picker body */}
      <div className="flex flex-col gap-2 p-3">
        {/* SV Square — container measured by ResizeObserver so canvas pixel
              dimensions always match CSS display size, keeping the selection
              circle perfectly round at any panel width. */}
        {showSV && (
          <div ref={svContainerRef} className="w-full">
            <canvas
              ref={svCanvasRef}
              width={svPixelW}
              height={SV_HEIGHT}
              className="w-full rounded cursor-crosshair block"
              style={{ height: SV_HEIGHT, touchAction: "none" }}
              onPointerDown={handleSVPointerDown}
            />
          </div>
        )}

        {/* Hue bar */}
        {showHue && (
          <canvas
            ref={hueCanvasRef}
            width={194}
            height={14}
            className="w-full rounded cursor-crosshair"
            style={{ height: 14, touchAction: "none" }}
            onPointerDown={(e) => {
              isDraggingHue.current = true;
              const canvas = hueCanvasRef.current;
              if (!canvas) return;
              const rect = canvas.getBoundingClientRect();
              const h = Math.max(
                0,
                Math.min(360, ((e.clientX - rect.left) / rect.width) * 360),
              );
              onColorChange({ ...color, h });
            }}
          />
        )}

        {/* Hex + preview */}
        {showHex && (
          <div className="flex items-center gap-2">
            <div
              className="w-7 h-7 rounded border border-border flex-shrink-0"
              style={previewStyle}
            />
            <Input
              data-ocid="color.hex_input"
              value={hexInput}
              onChange={handleHexChange}
              onBlur={() => setHexInput(hexDisplay)}
              className="h-7 text-xs font-mono bg-muted border-border"
              maxLength={7}
            />
          </div>
        )}

        {/* HSV sliders */}
        {showHsvSliders && (
          <div className="flex flex-col gap-3">
            <SliderRow
              label="H"
              ocid="color.h_slider"
              value={Math.round(color.h)}
              max={360}
              onNumChange={(v) => handleHsvChange("h", v)}
            >
              <GradientSlider
                value={Math.round(color.h)}
                min={0}
                max={360}
                gradient={hGradient}
                onChange={(v) => handleHsvChange("h", v)}
              />
            </SliderRow>
            <SliderRow
              label="S"
              ocid="color.s_slider"
              value={Math.round(color.s * 100)}
              max={100}
              onNumChange={(v) => handleHsvChange("s", v)}
            >
              <GradientSlider
                value={Math.round(color.s * 100)}
                min={0}
                max={100}
                gradient={sGradient}
                onChange={(v) => handleHsvChange("s", v)}
              />
            </SliderRow>
            <SliderRow
              label="V"
              ocid="color.v_slider"
              value={Math.round(color.v * 100)}
              max={100}
              onNumChange={(v) => handleHsvChange("v", v)}
            >
              <GradientSlider
                value={Math.round(color.v * 100)}
                min={0}
                max={100}
                gradient={vGradient}
                onChange={(v) => handleHsvChange("v", v)}
              />
            </SliderRow>
          </div>
        )}

        {/* RGB sliders */}
        {showRgbSliders && (
          <div className="flex flex-col gap-3">
            <SliderRow
              label="R"
              ocid="color.r_slider"
              value={rVal}
              max={255}
              onNumChange={(v) => handleRgbChange("r", v)}
            >
              <GradientSlider
                value={rVal}
                min={0}
                max={255}
                gradient={rGradient}
                onChange={(v) => handleRgbChange("r", v)}
              />
            </SliderRow>
            <SliderRow
              label="G"
              ocid="color.g_slider"
              value={gVal}
              max={255}
              onNumChange={(v) => handleRgbChange("g", v)}
            >
              <GradientSlider
                value={gVal}
                min={0}
                max={255}
                gradient={gGradient}
                onChange={(v) => handleRgbChange("g", v)}
              />
            </SliderRow>
            <SliderRow
              label="B"
              ocid="color.b_slider"
              value={bVal}
              max={255}
              onNumChange={(v) => handleRgbChange("b", v)}
            >
              <GradientSlider
                value={bVal}
                min={0}
                max={255}
                gradient={bGradient}
                onChange={(v) => handleRgbChange("b", v)}
              />
            </SliderRow>
          </div>
        )}

        {/* Recent colors */}
        {showRecent && recentColors.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {recentColors.map((hex) => (
              <button
                type="button"
                key={hex}
                className="w-5 h-5 rounded-sm border border-border hover:scale-110 transition-transform flex-shrink-0"
                style={{ background: hex }}
                onClick={() => onRecentColorClick(hex)}
                title={hex}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SliderRow({
  label,
  ocid,
  value,
  max,
  onNumChange,
  children,
}: {
  label: string;
  ocid: string;
  value: number;
  max: number;
  onNumChange: (v: number) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2" data-ocid={ocid}>
      {/* Label */}
      <span className="text-[11px] font-medium text-muted-foreground w-3 shrink-0 select-none">
        {label}
      </span>
      {/* Slider track — extra bottom padding so triangle thumb has room */}
      <div
        className="flex-1"
        style={{ paddingBottom: 8, position: "relative" }}
      >
        {children}
      </div>
      {/* Numeric readout */}
      <input
        type="number"
        min={0}
        max={max}
        step={1}
        value={value}
        onChange={(e) => onNumChange(Number(e.target.value))}
        className="w-9 text-[10px] text-right bg-transparent border-0 border-b border-border/50 rounded-none px-0 h-5 text-foreground shrink-0 focus:outline-none focus:border-primary"
        style={{ appearance: "textfield" }}
      />
    </div>
  );
}
