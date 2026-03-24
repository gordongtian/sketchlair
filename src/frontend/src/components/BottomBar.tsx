import { Slider } from "@/components/ui/slider";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Download, Redo2, Save, Trash2, Undo2 } from "lucide-react";
import React, { useState, useEffect } from "react";
import type { Tool } from "./Toolbar";

const BLEND_MODES = [
  { value: "source-over", label: "Normal" },
  { value: "multiply", label: "Multiply" },
  { value: "screen", label: "Screen" },
  { value: "overlay", label: "Overlay" },
  { value: "darken", label: "Darken" },
  { value: "lighten", label: "Lighten" },
  { value: "color-dodge", label: "Dodge" },
  { value: "color-burn", label: "Burn" },
  { value: "hard-light", label: "Hard Light" },
  { value: "soft-light", label: "Soft Light" },
  { value: "difference", label: "Difference" },
  { value: "hue", label: "Hue" },
  { value: "saturation", label: "Saturation" },
  { value: "color", label: "Color" },
  { value: "luminosity", label: "Luminosity" },
];

interface BottomBarProps {
  brushSize: number;
  brushOpacity: number;
  brushBlendMode: string;
  activeTool: Tool;
  onBrushSizeChange: (v: number) => void;
  onBrushOpacityChange: (v: number) => void;
  onBrushBlendModeChange: (mode: string) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  onExport: () => void;
  onSave: () => void;
}

function SyncedNumberInput({
  value,
  min,
  max,
  onChange,
  suffix,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  suffix: string;
}) {
  const [inputVal, setInputVal] = React.useState(String(value));

  React.useEffect(() => {
    setInputVal(String(value));
  }, [value]);

  const commit = (raw: string) => {
    const parsed = Number.parseFloat(raw);
    if (!Number.isNaN(parsed)) {
      onChange(Math.max(min, Math.min(max, Math.round(parsed))));
    } else {
      setInputVal(String(value));
    }
  };

  return (
    <div className="flex items-center gap-0.5 shrink-0">
      <input
        type="number"
        min={min}
        max={max}
        step={1}
        value={inputVal}
        onChange={(e) => setInputVal(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        onClick={(e) => (e.target as HTMLInputElement).select()}
        className="text-xs text-foreground bg-transparent border border-border rounded px-1 text-right focus:outline-none focus:border-primary [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        style={{ width: 44 }}
      />
      <span className="text-xs text-muted-foreground">{suffix}</span>
    </div>
  );
}

function sliderToSize(v: number): number {
  if (v <= 50) return 1 + (v / 50) * 99;
  return 100 + ((v - 50) / 50) * 900;
}
function sizeToSlider(size: number): number {
  if (size <= 100) return Math.max(0, ((size - 1) / 99) * 50);
  return 50 + ((size - 100) / 900) * 50;
}

export function BottomBar({
  brushSize,
  brushOpacity,
  brushBlendMode,
  activeTool,
  onBrushSizeChange,
  onBrushOpacityChange,
  onBrushBlendModeChange,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onClear,
  onExport,
  onSave,
}: BottomBarProps) {
  const sizeLabel = activeTool === "eraser" ? "Eraser" : "Size";
  BLEND_MODES.find((m) => m.value === brushBlendMode) ?? BLEND_MODES[0];

  return (
    <TooltipProvider delayDuration={300}>
      <div
        className="flex items-center gap-2 px-3 border-t border-border bg-card flex-shrink-0 overflow-x-auto"
        style={{
          height: "calc(48px + env(safe-area-inset-bottom))",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        {/* Blend mode */}
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            Blend
          </span>
          <select
            data-ocid="bottombar.blend_select"
            value={brushBlendMode}
            onChange={(e) => onBrushBlendModeChange(e.target.value)}
            className="text-xs bg-muted border border-border rounded px-1 h-6 text-foreground cursor-pointer"
            style={{ maxWidth: 80 }}
          >
            {BLEND_MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        <div className="w-px h-5 bg-border flex-shrink-0" />

        {/* Brush size */}
        <div className="flex items-center gap-2 min-w-0 shrink-0">
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {sizeLabel}
          </span>
          <Slider
            data-ocid="bottombar.size_input"
            value={[sizeToSlider(brushSize)]}
            min={0}
            max={100}
            step={0.5}
            onValueChange={([v]) =>
              onBrushSizeChange(Math.round(sliderToSize(v)))
            }
            className="w-20"
          />
          <SyncedNumberInput
            value={brushSize}
            min={1}
            max={1000}
            onChange={onBrushSizeChange}
            suffix="px"
          />
        </div>

        <div className="w-px h-5 bg-border flex-shrink-0" />

        {/* Opacity slider */}
        <div className="flex items-center gap-2 min-w-0 shrink-0">
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            Opacity
          </span>
          <Slider
            data-ocid="bottombar.opacity_input"
            value={[Math.round(brushOpacity * 100)]}
            min={1}
            max={100}
            step={1}
            onValueChange={([v]) => onBrushOpacityChange(v / 100)}
            className="w-20"
          />
          <SyncedNumberInput
            value={Math.round(brushOpacity * 100)}
            min={0}
            max={100}
            onChange={(v) => onBrushOpacityChange(v / 100)}
            suffix="%"
          />
        </div>

        <div className="flex-1" />

        {/* Undo/Redo */}
        <div className="flex items-center gap-1 shrink-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                data-ocid="bottombar.undo_button"
                onClick={onUndo}
                disabled={!canUndo}
                className="w-8 h-8 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 transition-colors"
              >
                <Undo2 size={16} />
              </button>
            </TooltipTrigger>
            <TooltipContent>Undo (Ctrl+Z)</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                data-ocid="bottombar.redo_button"
                onClick={onRedo}
                disabled={!canRedo}
                className="w-8 h-8 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 transition-colors"
              >
                <Redo2 size={16} />
              </button>
            </TooltipTrigger>
            <TooltipContent>Redo (Ctrl+Shift+Z)</TooltipContent>
          </Tooltip>
        </div>

        <div className="w-px h-5 bg-border flex-shrink-0" />

        {/* Clear */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              data-ocid="bottombar.clear_button"
              onClick={onClear}
              className="w-8 h-8 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-muted transition-colors"
            >
              <Trash2 size={16} />
            </button>
          </TooltipTrigger>
          <TooltipContent>Clear Layer</TooltipContent>
        </Tooltip>

        {/* Export */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              data-ocid="bottombar.export_button"
              onClick={onExport}
              className="w-8 h-8 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <Download size={16} />
            </button>
          </TooltipTrigger>
          <TooltipContent>Export PNG</TooltipContent>
        </Tooltip>

        {/* Save */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              data-ocid="bottombar.save_button"
              onClick={onSave}
              className="flex items-center gap-1.5 px-3 h-8 rounded bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 transition-opacity"
            >
              <Save size={13} />
              Save
            </button>
          </TooltipTrigger>
          <TooltipContent>Save</TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}
