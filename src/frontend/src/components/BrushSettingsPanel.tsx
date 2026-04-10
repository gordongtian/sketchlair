import { Button } from "@/components/ui/button";

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

import { Label } from "@/components/ui/label";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

import { ScrollArea } from "@/components/ui/scroll-area";

import { Slider } from "@/components/ui/slider";

import { Switch } from "@/components/ui/switch";

import {
  ChevronDown,
  ChevronRight,
  Circle,
  Eraser,
  PaintBucket,
  Pencil,
  Spline,
  Square,
} from "lucide-react";

import React, { useCallback, useEffect, useRef, useState } from "react";

export interface BrushSettings {
  tipImageData?: string;
  pressureSize: boolean;
  pressureOpacity: boolean;
  pressureFlow: boolean;
  minFlow: number;
  flow: number;
  spacing: number;
  rotation: number;
  rotateMode: "fixed" | "follow";
  softness: number;
  strokeSmoothing: number;
  stabilizationMode: "basic" | "smooth" | "elastic" | "smooth+elastic";
  smoothStrength: number;
  elasticStrength: number;
  minSize: number;
  minOpacity: number;
  pressureCurve: number;
  smearStrength: number;
  pressureStrength: boolean;
  minStrength: number;
  scatter: number;
  sizeJitter: number;
  colorJitter: number;
  rotationJitter: number;
  flowJitter: number;
  count: number;
  dualTipEnabled: boolean;
  dualTipImageData?: string;
  dualTipBlendMode: "multiply" | "screen" | "overlay" | "darken" | "lighten";
  dualTipScatter: number;
  dualTipSpacing: number;
  dualTipSizeJitter: number;
  dualTipRotationJitter: number;
}

export const DEFAULT_BRUSH_SETTINGS: BrushSettings = {
  tipImageData: undefined,
  pressureSize: true,
  pressureOpacity: false,
  pressureFlow: false,
  minFlow: 0,
  flow: 1.0,
  spacing: 5,
  rotation: 0,
  rotateMode: "fixed",
  softness: 0,
  strokeSmoothing: 10,
  stabilizationMode: "basic",
  smoothStrength: 5,
  elasticStrength: 20,
  minSize: 0,
  minOpacity: 0,
  pressureCurve: 2.0,
  smearStrength: 0.8,
  pressureStrength: false,
  minStrength: 0,
  scatter: 0,
  sizeJitter: 0,
  colorJitter: 0,
  rotationJitter: 0,
  flowJitter: 0,
  count: 1,
  dualTipEnabled: false,
  dualTipBlendMode: "multiply",
  dualTipScatter: 0,
  dualTipSpacing: 5,
  dualTipSizeJitter: 0,
  dualTipRotationJitter: 0,
};

type BrushSettingsPanelProps = {
  brushSettings: BrushSettings;
  onBrushSettingsChange: (settings: BrushSettings) => void;
  availableTips?: { id: string; name: string; tipImageData?: string }[];
  activeTool?: string;
};

type ScratchpadTool = "draw" | "erase" | "lasso" | "gradient";
type GradientMode = "linear" | "radial";
type LassoMode = "fill" | "erase";
type ScratchpadTip = "circle" | "square" | "oval";

export function ScratchpadDialog({
  onSave,
  trigger,
}: {
  onSave: (dataUrl: string) => void;
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [activeTool, setActiveTool] = useState<ScratchpadTool>("draw");
  const [scratchpadSize, setScratchpadSize] = useState(5);
  const [gradientMode, setGradientMode] = useState<GradientMode>("radial");
  const [lassoMode, setLassoMode] = useState<LassoMode>("fill");
  const [scratchpadTip, setScratchpadTip] = useState<ScratchpadTip>("circle");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawingRef = useRef(false);
  const lassoPointsRef = useRef<{ x: number; y: number }[]>([]);
  const gradientStartRef = useRef<{ x: number; y: number } | null>(null);
  const lastDrawPosRef = useRef<{ x: number; y: number } | null>(null);
  const clearScratchpad = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 128, 128);
  }, []);
  const clearOverlay = useCallback(() => {
    const overlay = overlayCanvasRef.current;
    if (!overlay) return;
    const ctx = overlay.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, overlay.width, overlay.height);
  }, []);
  useEffect(() => {
    if (open) {
      setTimeout(() => clearScratchpad(), 10);
    }
  }, [open, clearScratchpad]);
  const getCanvasPos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const drawLassoOverlay = useCallback(
    (points: { x: number; y: number }[], mode: LassoMode) => {
      const overlay = overlayCanvasRef.current;
      if (!overlay) return;
      const ctx = overlay.getContext("2d");
      if (!ctx || points.length < 2) return;
      ctx.clearRect(0, 0, overlay.width, overlay.height);
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
      }
      ctx.closePath();
      ctx.fillStyle = mode === "fill" ? "#000000" : "#ffffff";
      ctx.fill();
      ctx.restore();
    },
    [],
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    isDrawingRef.current = true;
    const pos = getCanvasPos(e);
    if (activeTool === "draw" || activeTool === "erase") {
      lastDrawPosRef.current = null;
      drawAt(e);
    } else if (activeTool === "lasso") {
      lassoPointsRef.current = [pos];
    } else if (activeTool === "gradient") {
      gradientStartRef.current = pos;
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current) return;
    const coalescedEvents = e.nativeEvent.getCoalescedEvents?.() ?? [
      e.nativeEvent,
    ];
    for (const evt of coalescedEvents) {
      const syntheticLike = {
        ...e,
        clientX: evt.clientX,
        clientY: evt.clientY,
      };
      if (activeTool === "draw" || activeTool === "erase") {
        lastDrawPosRef.current = null;
        drawAt(syntheticLike as React.PointerEvent<HTMLCanvasElement>);
      } else if (activeTool === "lasso") {
        const pos = getCanvasPos(
          syntheticLike as React.PointerEvent<HTMLCanvasElement>,
        );
        lassoPointsRef.current.push(pos);
      }
    }
    if (activeTool === "lasso")
      drawLassoOverlay(lassoPointsRef.current, lassoMode);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;
    lastDrawPosRef.current = null;
    const pos = getCanvasPos(e);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (activeTool === "lasso") {
      const pts = lassoPointsRef.current;
      clearOverlay();
      if (pts.length < 3) return;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i].x, pts[i].y);
      }
      ctx.closePath();
      ctx.clip();
      ctx.fillStyle = lassoMode === "fill" ? "#000000" : "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
      lassoPointsRef.current = [];
    } else if (activeTool === "gradient" && gradientStartRef.current) {
      const start = gradientStartRef.current;
      const dx = pos.x - start.x;
      const dy = pos.y - start.y;
      const distance = Math.sqrt(dx * dx + dy * dy) || 1;
      const tempCanvas = document.createElement("canvas");
      tempCanvas.width = canvas.width;
      tempCanvas.height = canvas.height;
      const tempCtx = tempCanvas.getContext("2d")!;
      let grad: CanvasGradient;
      if (gradientMode === "radial") {
        grad = tempCtx.createRadialGradient(
          start.x,
          start.y,
          0,
          start.x,
          start.y,
          distance,
        );
      } else {
        grad = tempCtx.createLinearGradient(start.x, start.y, pos.x, pos.y);
      }
      grad.addColorStop(0, "rgba(0,0,0,1)");
      grad.addColorStop(1, "rgba(0,0,0,0)");
      tempCtx.fillStyle = grad;
      tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
      ctx.save();
      ctx.globalCompositeOperation = "source-over";
      ctx.drawImage(tempCanvas, 0, 0);
      ctx.restore();
      gradientStartRef.current = null;
    }
  };

  const drawAt = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const pos = getCanvasPos(e);
    const color = activeTool === "erase" ? "#ffffff" : "#000000";
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = scratchpadSize * 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const last = lastDrawPosRef.current;
    if (last) {
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
    } else {
      if (scratchpadTip === "circle") {
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, scratchpadSize, 0, Math.PI * 2);
        ctx.fill();
      } else if (scratchpadTip === "square") {
        ctx.fillRect(
          pos.x - scratchpadSize,
          pos.y - scratchpadSize,
          scratchpadSize * 2,
          scratchpadSize * 2,
        );
      } else if (scratchpadTip === "oval") {
        ctx.beginPath();
        ctx.ellipse(
          pos.x,
          pos.y,
          scratchpadSize,
          scratchpadSize * 0.5,
          0,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
    }
    lastDrawPosRef.current = pos;
  };

  const handleUseTip = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL("image/png");
    onSave(dataUrl);
    setOpen(false);
  };

  const mainTools: {
    tool: ScratchpadTool;
    icon: React.ReactNode;
    label: string;
    ocid: string;
  }[] = [
    {
      tool: "draw",
      icon: <Pencil size={14} />,
      label: "Draw",
      ocid: "scratchpad.draw_tool.button",
    },
    {
      tool: "erase",
      icon: <Eraser size={14} />,
      label: "Erase",
      ocid: "scratchpad.erase_tool.button",
    },
    {
      tool: "lasso",
      icon: <PaintBucket size={14} />,
      label: "Lasso",
      ocid: "scratchpad.lasso.button",
    },
    {
      tool: "gradient",
      icon: <Spline size={14} />,
      label: "Gradient",
      ocid: "scratchpad.gradient.button",
    },
  ];

  const tipShapes: {
    tip: ScratchpadTip;
    icon: React.ReactNode;
    label: string;
  }[] = [
    { tip: "circle", icon: <Circle size={12} />, label: "Circle" },
    { tip: "square", icon: <Square size={12} />, label: "Square" },
    {
      tip: "oval",
      icon: (
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          role="img"
          aria-label="Oval"
        >
          <title>Oval</title>
          <ellipse cx="6" cy="6" rx="5" ry="3" fill="currentColor" />
        </svg>
      ),
      label: "Oval",
    },
  ];
  const defaultTrigger = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      data-ocid="brush_settings.draw_tip_button"
      className="flex-1 text-xs h-7"
    >
      Draw Tip
    </Button>
  );
  return (
    <Dialog open={open} onOpenChange={setOpen} modal={false}>
      <DialogTrigger asChild>{trigger ?? defaultTrigger}</DialogTrigger>

      <DialogContent data-ocid="brush_settings.tip_dialog" className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm">Draw Brush Tip</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col items-center gap-3">
          <p className="text-xs text-muted-foreground text-center">
            Draw black shapes to paint, white to erase.
          </p>

          <div className="flex gap-1 w-full">
            {mainTools.map(({ tool, icon, label, ocid }) => (
              <button
                key={tool}
                type="button"
                data-ocid={ocid}
                title={label}
                onClick={() => setActiveTool(tool)}
                className={`flex-1 flex flex-col items-center gap-0.5 py-1.5 rounded text-[10px] transition-colors min-w-[44px] ${
                  activeTool === tool
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                {icon}
                <span>{label}</span>
              </button>
            ))}
          </div>

          {(activeTool === "draw" || activeTool === "erase") && (
            <div className="flex gap-1 w-full">
              {tipShapes.map(({ tip, icon, label }) => (
                <button
                  key={tip}
                  type="button"
                  title={label}
                  onClick={() => setScratchpadTip(tip)}
                  className={`flex-1 flex flex-col items-center gap-0.5 py-1 rounded text-[10px] transition-colors ${
                    scratchpadTip === tip
                      ? "bg-primary/20 text-primary border border-primary/40"
                      : "bg-muted/30 text-muted-foreground hover:bg-muted hover:text-foreground border border-transparent"
                  }`}
                >
                  {icon}
                  <span>{label}</span>
                </button>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2 w-full">
            <Label className="text-xs text-muted-foreground shrink-0 w-8">
              Size
            </Label>

            <Slider
              data-ocid="scratchpad.size_slider"
              min={2}
              max={30}
              step={1}
              value={[scratchpadSize]}
              onValueChange={([v]) => setScratchpadSize(v)}
              className="flex-1"
            />

            <span className="text-xs text-muted-foreground w-5 text-right">
              {scratchpadSize}
            </span>
          </div>

          {activeTool === "lasso" && (
            <div className="flex gap-1 w-full">
              <button
                type="button"
                data-ocid="scratchpad.lasso_fill.toggle"
                onClick={() => setLassoMode("fill")}
                className={`flex-1 py-1 rounded text-[10px] transition-colors ${
                  lassoMode === "fill"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                Fill
              </button>

              <button
                type="button"
                data-ocid="scratchpad.lasso_erase.toggle"
                onClick={() => setLassoMode("erase")}
                className={`flex-1 py-1 rounded text-[10px] transition-colors ${
                  lassoMode === "erase"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                Erase
              </button>
            </div>
          )}

          {activeTool === "gradient" && (
            <div className="flex gap-1 w-full">
              <button
                type="button"
                data-ocid="scratchpad.gradient_linear.toggle"
                onClick={() => setGradientMode("linear")}
                className={`flex-1 py-1 rounded text-[10px] transition-colors ${
                  gradientMode === "linear"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                Linear
              </button>

              <button
                type="button"
                data-ocid="scratchpad.gradient_radial.toggle"
                onClick={() => setGradientMode("radial")}
                className={`flex-1 py-1 rounded text-[10px] transition-colors ${
                  gradientMode === "radial"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                Radial
              </button>
            </div>
          )}

          <div className="relative" style={{ width: 220, height: 220 }}>
            <canvas
              ref={canvasRef}
              width={128}
              height={128}
              data-ocid="brush_settings.scratchpad_canvas"
              className="border border-border rounded cursor-crosshair touch-none absolute top-0 left-0 w-full h-full"
              style={{
                imageRendering: "pixelated",
                background: "#ffffff",
              }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerUp}
            />

            <canvas
              ref={overlayCanvasRef}
              width={128}
              height={128}
              className="absolute top-0 left-0 w-full h-full rounded pointer-events-none"
              style={{ opacity: 0.7 }}
            />
          </div>
        </div>

        <DialogFooter className="flex gap-2 sm:justify-between">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={clearScratchpad}
          >
            Clear
          </Button>

          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setOpen(false)}
              data-ocid="brush_settings.cancel_button"
            >
              Cancel
            </Button>

            <Button
              type="button"
              size="sm"
              onClick={handleUseTip}
              data-ocid="brush_settings.use_tip_button"
            >
              Use as Tip
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Reusable slider row component
function SliderRow({
  label,
  value,
  min,
  max,
  step,
  display: _display,
  onChange,
  ocid,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (v: number) => void;
  ocid: string;
}) {
  const [inputVal, setInputVal] = React.useState(String(value));

  React.useEffect(() => {
    setInputVal(String(value));
  }, [value]);

  const commitInput = (raw: string) => {
    const parsed = Number.parseFloat(raw);
    if (!Number.isNaN(parsed)) {
      onChange(Math.max(min, Math.min(max, parsed)));
    } else {
      setInputVal(String(value));
    }
  };

  return (
    <div className="flex flex-col gap-1 min-w-0 w-full">
      <div className="flex items-center justify-between min-w-0">
        <Label className="text-xs text-muted-foreground">{label}</Label>
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          onBlur={(e) => commitInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          onClick={(e) => (e.target as HTMLInputElement).select()}
          className="text-xs text-foreground bg-transparent border border-border rounded px-1 text-right focus:outline-none focus:border-primary [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          style={{ width: 48 }}
        />
      </div>
      <Slider
        data-ocid={ocid}
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={([v]) => onChange(v)}
        className="w-full"
      />
    </div>
  );
}

// Collapsible section
function CollapsibleSection({
  title,
  children,
}: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 w-full border-t border-border/60 mt-2 pt-2 cursor-pointer group"
      >
        {open ? (
          <ChevronDown className="w-3 h-3 text-muted-foreground group-hover:text-foreground transition-colors" />
        ) : (
          <ChevronRight className="w-3 h-3 text-muted-foreground group-hover:text-foreground transition-colors" />
        )}
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground group-hover:text-foreground transition-colors">
          {title}
        </span>
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  );
}

export function BrushSettingsPanel({
  brushSettings,
  onBrushSettingsChange,
  availableTips,
  activeTool: parentActiveTool,
}: BrushSettingsPanelProps) {
  const {
    tipImageData,
    pressureSize,
    pressureOpacity,
    flow,
    spacing,
    rotation,
    rotateMode,
    softness,
    strokeSmoothing,
    stabilizationMode,
    smoothStrength,
    elasticStrength,
    minSize,
    minOpacity,
    scatter,
    sizeJitter,
    rotationJitter,
    flowJitter,
    count,
    colorJitter,
    dualTipEnabled,
    dualTipImageData,
    dualTipBlendMode,
    dualTipScatter,
    dualTipSpacing,
    dualTipSizeJitter,
    dualTipRotationJitter,
    smearStrength,
    pressureStrength,
    minStrength,
    pressureFlow,
    minFlow,
  } = brushSettings;

  const isSmudge = parentActiveTool === "smudge";

  const fileInputRef = useRef<HTMLInputElement>(null);
  const dualFileInputRef = useRef<HTMLInputElement>(null);
  const [tipPickerOpen, setTipPickerOpen] = useState(false);
  const [dualTipPickerOpen, setDualTipPickerOpen] = useState(false);

  const update = (partial: Partial<BrushSettings>) =>
    onBrushSettingsChange({ ...brushSettings, ...partial });

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      update({ tipImageData: dataUrl });
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const handleDualUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      update({ dualTipImageData: dataUrl });
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const thumbnailClickable = availableTips && availableTips.length > 0;

  const thumbnailEl = (
    <div
      data-ocid="brush_settings.tip_thumbnail"
      className={`w-12 h-12 rounded border flex-shrink-0 overflow-hidden transition-all ${
        thumbnailClickable
          ? "border-border cursor-pointer hover:border-primary hover:scale-105"
          : "border-border"
      }`}
      style={{ background: "#1a1a1a" }}
      title={
        thumbnailClickable ? "Click to change brush tip" : "Current brush tip"
      }
    >
      {tipImageData ? (
        <img
          src={tipImageData}
          alt="Brush tip"
          className="w-full h-full object-cover"
          style={{ imageRendering: "pixelated" }}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <div className="w-7 h-7 rounded-full bg-white opacity-40" />
        </div>
      )}
    </div>
  );

  return (
    <div className="border-b border-border px-3 py-2.5 flex flex-col gap-1 w-full min-w-0 overflow-hidden box-border">
      <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1">
        Brush
      </span>

      {/* ─────────── Section: Tip ─────────── */}
      <CollapsibleSection title="Tip">
        <div className="flex flex-col gap-2">
          {/* Tip image picker */}
          <div className="flex items-center gap-2">
            {thumbnailClickable ? (
              <Popover open={tipPickerOpen} onOpenChange={setTipPickerOpen}>
                <PopoverTrigger asChild>{thumbnailEl}</PopoverTrigger>
                <PopoverContent
                  data-ocid="brush_settings.tip_picker.popover"
                  className="w-64 p-3"
                  side="right"
                  align="start"
                >
                  <p className="text-xs font-semibold mb-2">Choose Tip</p>
                  <ScrollArea className="max-h-48">
                    <div className="grid grid-cols-3 gap-2 pr-1">
                      {availableTips.map((tip, idx) => (
                        <button
                          key={tip.id}
                          type="button"
                          data-ocid={`brush_settings.tip_picker.item.${idx + 1}`}
                          title={tip.name}
                          onClick={() => {
                            update({ tipImageData: tip.tipImageData });
                            setTipPickerOpen(false);
                          }}
                          className="flex flex-col items-center gap-1 group"
                        >
                          <div
                            className="w-14 h-14 rounded border border-border overflow-hidden transition-all group-hover:border-primary group-hover:scale-105"
                            style={{ background: "#1a1a1a" }}
                          >
                            {tip.tipImageData ? (
                              <img
                                src={tip.tipImageData}
                                alt={tip.name}
                                className="w-full h-full object-cover"
                                style={{ imageRendering: "pixelated" }}
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <div className="w-8 h-8 rounded-full bg-white opacity-80" />
                              </div>
                            )}
                          </div>
                          <span className="text-[10px] text-muted-foreground truncate w-full text-center">
                            {tip.name}
                          </span>
                        </button>
                      ))}
                    </div>
                  </ScrollArea>
                </PopoverContent>
              </Popover>
            ) : (
              thumbnailEl
            )}
            <div className="flex gap-1 flex-1 flex-col">
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-ocid="brush_settings.upload_tip_button"
                className="w-full text-xs h-7"
                onClick={() => fileInputRef.current?.click()}
              >
                Upload
              </Button>
              <ScratchpadDialog
                onSave={(dataUrl) => update({ tipImageData: dataUrl })}
              />
            </div>
          </div>

          {tipImageData && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-ocid="brush_settings.clear_tip_button"
              className="text-xs h-6 text-destructive hover:text-destructive w-full"
              onClick={() => update({ tipImageData: undefined })}
            >
              Clear Tip
            </Button>
          )}

          <SliderRow
            label="Softness"
            value={Math.round(softness * 100)}
            min={0}
            max={100}
            step={1}
            display={`${Math.round(softness * 100)}%`}
            onChange={(v) => update({ softness: v / 100 })}
            ocid="brush_settings.softness_slider"
          />

          <SliderRow
            label="Spacing"
            value={spacing}
            min={1}
            max={200}
            step={1}
            display={`${spacing}%`}
            onChange={(v) => update({ spacing: v })}
            ocid="brush_settings.spacing_slider"
          />

          <SliderRow
            label="Count"
            value={count ?? 1}
            min={1}
            max={10}
            step={0.1}
            display={`${(count ?? 1).toFixed(1)}x`}
            onChange={(v) => update({ count: v })}
            ocid="brush_settings.count_slider"
          />

          <SliderRow
            label="Scatter"
            value={scatter}
            min={0}
            max={100}
            step={1}
            display={`${scatter}px`}
            onChange={(v) => update({ scatter: v })}
            ocid="brush_settings.scatter_slider"
          />

          {/* Rotation */}
          <div className="flex flex-col gap-1 min-w-0 w-full">
            <div className="flex items-center justify-between min-w-0">
              <Label className="text-xs text-muted-foreground">Rotation</Label>
              <span className="text-xs text-muted-foreground">{rotation}°</span>
            </div>
            <Slider
              data-ocid="brush_settings.rotation_slider"
              min={0}
              max={360}
              step={1}
              value={[rotation]}
              onValueChange={([v]) => update({ rotation: v })}
              className="w-full"
            />
            <div className="flex gap-1 mt-0.5">
              <button
                type="button"
                data-ocid="brush_settings.rotate_fixed_button"
                onClick={() => update({ rotateMode: "fixed" })}
                className={`flex-1 text-[10px] py-1 rounded transition-all duration-100 ${
                  rotateMode === "fixed"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                Fixed
              </button>
              <button
                type="button"
                data-ocid="brush_settings.rotate_follow_button"
                onClick={() => update({ rotateMode: "follow" })}
                className={`flex-1 text-[10px] py-1 rounded transition-all duration-100 ${
                  rotateMode === "follow"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                Follow Stroke
              </button>
            </div>
          </div>

          {/* Flow (hidden for smear tool) */}
          {!isSmudge && (
            <SliderRow
              label="Flow"
              value={Math.round((flow ?? 1.0) * 100)}
              min={1}
              max={100}
              step={1}
              display={`${Math.round((flow ?? 1.0) * 100)}%`}
              onChange={(v) => update({ flow: v / 100 })}
              ocid="brush_settings.flow_slider"
            />
          )}

          {/* Strength (smudge tool only) */}
          {isSmudge && (
            <SliderRow
              label="Strength"
              value={Math.round((smearStrength ?? 0.8) * 100)}
              min={0}
              max={100}
              step={1}
              display={`${Math.round((smearStrength ?? 0.8) * 100)}%`}
              onChange={(v) => update({ smearStrength: v / 100 })}
              ocid="brush_settings.smudge_strength_slider"
            />
          )}
        </div>
      </CollapsibleSection>

      {/* ─────────── Section: Texture ─────────── */}
      <CollapsibleSection title="Texture">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <Label
              className="text-xs text-muted-foreground cursor-pointer"
              htmlFor="dual-tip-enabled"
            >
              Enable Texture
            </Label>
            <Switch
              id="dual-tip-enabled"
              data-ocid="brush_settings.dual_tip_enabled_switch"
              checked={dualTipEnabled}
              onCheckedChange={(v) => update({ dualTipEnabled: v })}
            />
          </div>

          {dualTipEnabled && (
            <>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs text-muted-foreground">
                  Brush Texture
                </Label>
                <div className="flex items-center gap-2">
                  {availableTips && availableTips.length > 0 ? (
                    <Popover
                      open={dualTipPickerOpen}
                      onOpenChange={setDualTipPickerOpen}
                    >
                      <PopoverTrigger asChild>
                        <div
                          data-ocid="brush_settings.dual_tip_thumbnail"
                          className="w-12 h-12 rounded border border-border flex-shrink-0 overflow-hidden cursor-pointer hover:border-primary hover:scale-105 transition-all"
                          style={{ background: "#1a1a1a" }}
                          title="Click to change secondary brush tip"
                        >
                          {dualTipImageData ? (
                            <img
                              src={dualTipImageData}
                              alt="Dual tip"
                              className="w-full h-full object-cover"
                              style={{ imageRendering: "pixelated" }}
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <div className="w-7 h-7 rounded-full bg-white opacity-40" />
                            </div>
                          )}
                        </div>
                      </PopoverTrigger>
                      <PopoverContent
                        data-ocid="brush_settings.dual_tip_picker.popover"
                        className="w-64 p-3"
                        side="right"
                        align="start"
                      >
                        <p className="text-xs font-semibold mb-2">
                          Choose Brush Texture
                        </p>
                        <ScrollArea className="max-h-48">
                          <div className="grid grid-cols-3 gap-2 pr-1">
                            {availableTips.map((tip, idx) => (
                              <button
                                key={tip.id}
                                type="button"
                                data-ocid={`brush_settings.dual_tip_picker.item.${idx + 1}`}
                                title={tip.name}
                                onClick={() => {
                                  update({
                                    dualTipImageData: tip.tipImageData,
                                  });
                                  setDualTipPickerOpen(false);
                                }}
                                className="flex flex-col items-center gap-1 group"
                              >
                                <div
                                  className="w-14 h-14 rounded border border-border overflow-hidden transition-all group-hover:border-primary group-hover:scale-105"
                                  style={{ background: "#1a1a1a" }}
                                >
                                  {tip.tipImageData ? (
                                    <img
                                      src={tip.tipImageData}
                                      alt={tip.name}
                                      className="w-full h-full object-cover"
                                      style={{ imageRendering: "pixelated" }}
                                    />
                                  ) : (
                                    <div className="w-full h-full flex items-center justify-center">
                                      <div className="w-8 h-8 rounded-full bg-white opacity-80" />
                                    </div>
                                  )}
                                </div>
                                <span className="text-[10px] text-muted-foreground truncate w-full text-center">
                                  {tip.name}
                                </span>
                              </button>
                            ))}
                          </div>
                        </ScrollArea>
                      </PopoverContent>
                    </Popover>
                  ) : (
                    <div
                      data-ocid="brush_settings.dual_tip_thumbnail"
                      className="w-12 h-12 rounded border border-border flex-shrink-0 overflow-hidden"
                      style={{ background: "#1a1a1a" }}
                    >
                      {dualTipImageData ? (
                        <img
                          src={dualTipImageData}
                          alt="Dual tip"
                          className="w-full h-full object-cover"
                          style={{ imageRendering: "pixelated" }}
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <div className="w-7 h-7 rounded-full bg-white opacity-40" />
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex gap-1 flex-1 flex-col">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      data-ocid="brush_settings.dual_upload_tip_button"
                      className="w-full text-xs h-7"
                      onClick={() => dualFileInputRef.current?.click()}
                    >
                      Upload
                    </Button>
                    <ScratchpadDialog
                      onSave={(dataUrl) =>
                        update({ dualTipImageData: dataUrl })
                      }
                      trigger={
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="flex-1 text-xs h-7 w-full"
                        >
                          Draw Tip
                        </Button>
                      }
                    />
                  </div>
                </div>

                {dualTipImageData && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    data-ocid="brush_settings.clear_dual_tip_button"
                    className="text-xs h-6 text-destructive hover:text-destructive w-full"
                    onClick={() => update({ dualTipImageData: undefined })}
                  >
                    Clear Brush Texture
                  </Button>
                )}
              </div>

              {/* Blend Mode */}
              <div className="flex flex-col gap-1 min-w-0 w-full">
                <Label className="text-xs text-muted-foreground">
                  Blend Mode
                </Label>
                <select
                  data-ocid="brush_settings.dual_blend_mode_select"
                  value={dualTipBlendMode}
                  onChange={(e) =>
                    update({
                      dualTipBlendMode: e.target
                        .value as BrushSettings["dualTipBlendMode"],
                    })
                  }
                  className="w-full text-xs rounded border border-border bg-background px-2 py-1 h-7 focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="multiply">Multiply</option>
                  <option value="screen">Screen</option>
                  <option value="overlay">Overlay</option>
                  <option value="darken">Darken</option>
                  <option value="lighten">Lighten</option>
                </select>
              </div>

              <SliderRow
                label="Scatter"
                value={dualTipScatter ?? 0}
                min={0}
                max={100}
                step={1}
                display={`${dualTipScatter ?? 0}px`}
                onChange={(v) => update({ dualTipScatter: v })}
                ocid="brush_settings.dual_scatter_slider"
              />
              <SliderRow
                label="Spacing"
                value={dualTipSpacing ?? 5}
                min={1}
                max={200}
                step={1}
                display={`${dualTipSpacing ?? 5}%`}
                onChange={(v) => update({ dualTipSpacing: v })}
                ocid="brush_settings.dual_spacing_slider"
              />
              <SliderRow
                label="Size Jitter"
                value={Math.round((dualTipSizeJitter ?? 0) * 100)}
                min={0}
                max={100}
                step={1}
                display={`${Math.round((dualTipSizeJitter ?? 0) * 100)}%`}
                onChange={(v) => update({ dualTipSizeJitter: v / 100 })}
                ocid="brush_settings.dual_size_jitter_slider"
              />
              <SliderRow
                label="Rotation Jitter"
                value={dualTipRotationJitter ?? 0}
                min={0}
                max={360}
                step={1}
                display={`${dualTipRotationJitter ?? 0}°`}
                onChange={(v) => update({ dualTipRotationJitter: v })}
                ocid="brush_settings.dual_rotation_jitter_slider"
              />
            </>
          )}
        </div>
      </CollapsibleSection>

      {/* ─────────── Section: Pen Pressure ─────────── */}
      <CollapsibleSection title="Pen Pressure">
        <div className="flex flex-col gap-2">
          {/* Pressure → Size */}
          <div className="flex items-center justify-between gap-2">
            <Label
              className="text-xs text-muted-foreground cursor-pointer"
              htmlFor="pressure-size"
            >
              Pressure → Size
            </Label>
            <Switch
              id="pressure-size"
              data-ocid="brush_settings.pressure_size_switch"
              checked={pressureSize}
              onCheckedChange={(v) => update({ pressureSize: v })}
            />
          </div>
          {pressureSize && (
            <SliderRow
              label="Min Size"
              value={minSize}
              min={0}
              max={100}
              step={1}
              display={`${minSize}%`}
              onChange={(v) => update({ minSize: v })}
              ocid="brush_settings.min_size_slider"
            />
          )}

          {/* Pressure → Opacity / Strength (smudge) */}
          {isSmudge ? (
            <>
              <div className="flex items-center justify-between gap-2">
                <Label
                  className="text-xs text-muted-foreground cursor-pointer"
                  htmlFor="pressure-strength"
                >
                  Pressure → Strength
                </Label>
                <Switch
                  id="pressure-strength"
                  data-ocid="brush_settings.pressure_strength_switch"
                  checked={pressureStrength ?? false}
                  onCheckedChange={(v) => update({ pressureStrength: v })}
                />
              </div>
              {pressureStrength && (
                <SliderRow
                  label="Min Strength"
                  value={Math.round((minStrength ?? 0) * 100)}
                  min={0}
                  max={100}
                  step={1}
                  display={`${Math.round((minStrength ?? 0) * 100)}%`}
                  onChange={(v) => update({ minStrength: v / 100 })}
                  ocid="brush_settings.min_strength_slider"
                />
              )}
            </>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <Label
                  className="text-xs text-muted-foreground cursor-pointer"
                  htmlFor="pressure-opacity"
                >
                  Pressure → Opacity
                </Label>
                <Switch
                  id="pressure-opacity"
                  data-ocid="brush_settings.pressure_opacity_switch"
                  checked={pressureOpacity}
                  onCheckedChange={(v) => update({ pressureOpacity: v })}
                />
              </div>
              {pressureOpacity && (
                <SliderRow
                  label="Min Opacity"
                  value={Math.round(minOpacity * 100)}
                  min={0}
                  max={100}
                  step={1}
                  display={`${Math.round(minOpacity * 100)}%`}
                  onChange={(v) => update({ minOpacity: v / 100 })}
                  ocid="brush_settings.min_opacity_slider"
                />
              )}
            </>
          )}

          {/* Pressure → Flow (non-smudge only) */}
          {!isSmudge && (
            <>
              <div className="flex items-center justify-between gap-2">
                <Label
                  className="text-xs text-muted-foreground cursor-pointer"
                  htmlFor="pressure-flow"
                >
                  Pressure → Flow
                </Label>
                <Switch
                  id="pressure-flow"
                  data-ocid="brush_settings.pressure_flow_switch"
                  checked={pressureFlow ?? false}
                  onCheckedChange={(v) => update({ pressureFlow: v })}
                />
              </div>
              {pressureFlow && (
                <SliderRow
                  label="Min Flow"
                  value={Math.round((minFlow ?? 0) * 100)}
                  min={0}
                  max={100}
                  step={1}
                  display={`${Math.round((minFlow ?? 0) * 100)}%`}
                  onChange={(v) => update({ minFlow: v / 100 })}
                  ocid="brush_settings.min_flow_slider"
                />
              )}
            </>
          )}
        </div>
      </CollapsibleSection>

      {/* ─────────── Section: Smoothing ─────────── */}
      <CollapsibleSection title="Smoothing">
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-0.5">
            {(
              [
                ["basic", "Basic"],
                ["smooth", "Smooth"],
                ["elastic", "Elastic"],
                ["smooth+elastic", "Smooth+Elastic"],
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                data-ocid={`brush_settings.stab_${mode}_button`}
                onClick={() => update({ stabilizationMode: mode })}
                className={`text-[9px] py-1 rounded transition-all duration-100 ${
                  stabilizationMode === mode
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="text-[9px] text-muted-foreground leading-tight">
            {stabilizationMode === "basic" &&
              "Brush snaps ahead — crisp lines, low lag"}
            {stabilizationMode === "smooth" &&
              "Averages recent positions — smooth curves"}
            {stabilizationMode === "elastic" &&
              "Elastic follow — organic, flowing lines"}
            {stabilizationMode === "smooth+elastic" &&
              "Smooth then elastic — maximum smoothing"}
          </p>
          {stabilizationMode === "basic" && (
            <SliderRow
              label="Smoothing"
              value={strokeSmoothing}
              min={0}
              max={100}
              step={1}
              display={`${strokeSmoothing}`}
              onChange={(v) => update({ strokeSmoothing: v })}
              ocid="brush_settings.smoothing_slider"
            />
          )}
          {(stabilizationMode === "smooth" ||
            stabilizationMode === "smooth+elastic") && (
            <SliderRow
              label="Smooth Strength"
              value={smoothStrength}
              min={0}
              max={100}
              step={1}
              display={`${smoothStrength}`}
              onChange={(v) => update({ smoothStrength: v })}
              ocid="brush_settings.smooth_strength_slider"
            />
          )}
          {(stabilizationMode === "elastic" ||
            stabilizationMode === "smooth+elastic") && (
            <SliderRow
              label="Elastic Tension"
              value={elasticStrength}
              min={0}
              max={100}
              step={1}
              display={`${elasticStrength}`}
              onChange={(v) => update({ elasticStrength: v })}
              ocid="brush_settings.elastic_tension_slider"
            />
          )}
        </div>
      </CollapsibleSection>

      {/* ─────────── Section: Jitter ─────────── */}
      <CollapsibleSection title="Jitter">
        <div className="flex flex-col gap-2">
          <SliderRow
            label="Size Jitter"
            value={Math.round(sizeJitter * 100)}
            min={0}
            max={100}
            step={1}
            display={`${Math.round(sizeJitter * 100)}%`}
            onChange={(v) => update({ sizeJitter: v / 100 })}
            ocid="brush_settings.size_jitter_slider"
          />
          <SliderRow
            label="Rotation Jitter"
            value={rotationJitter ?? 0}
            min={0}
            max={360}
            step={1}
            display={`${rotationJitter ?? 0}°`}
            onChange={(v) => update({ rotationJitter: v })}
            ocid="brush_settings.rotation_jitter_slider"
          />
          {!isSmudge && (
            <SliderRow
              label="Flow Jitter"
              value={flowJitter ?? 0}
              min={0}
              max={100}
              step={1}
              display={`${flowJitter ?? 0}%`}
              onChange={(v) => update({ flowJitter: v })}
              ocid="brush_settings.flow_jitter_slider"
            />
          )}
          {!isSmudge && (
            <SliderRow
              label="Color Jitter"
              value={colorJitter ?? 0}
              min={0}
              max={100}
              step={1}
              display={`${colorJitter ?? 0}%`}
              onChange={(v) => update({ colorJitter: v })}
              ocid="brush_settings.color_jitter_slider"
            />
          )}
        </div>
      </CollapsibleSection>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleUpload}
      />
      <input
        ref={dualFileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleDualUpload}
      />
    </div>
  );
}
