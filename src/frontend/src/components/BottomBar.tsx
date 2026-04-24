import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Slider } from "@/components/ui/slider";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { BLEND_MODES } from "@/utils/constants";
import {
  Download,
  FileImage,
  Loader2,
  Redo2,
  Save,
  Trash2,
  Undo2,
} from "lucide-react";
import React, { useState } from "react";
import { toast } from "sonner";
import type { Layer } from "./LayersPanel";
import type { Tool } from "./Toolbar";

export type LiquifyMode = "push";

interface BottomBarProps {
  brushSize: number;
  brushOpacity: number;
  brushFlow: number;
  brushBlendMode: string;
  activeTool: Tool;
  smudgeStrength: number;
  onBrushSizeChange: (v: number) => void;
  onBrushOpacityChange: (v: number) => void;
  onBrushFlowChange: (v: number) => void;
  onBrushBlendModeChange: (mode: string) => void;
  onSmudgeStrengthChange: (v: number) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  onExport: () => void;
  onExportJPG?: () => void;
  onExportPSD?: () => void;
  isPsdExporting?: boolean;
  isPngExporting?: boolean;
  onSave: () => void;
  // Eyedropper
  eyedropperSampleSource: "canvas" | "layer";
  eyedropperSampleSize: 1 | 3 | 5;
  onEyedropperSampleSourceChange: (v: "canvas" | "layer") => void;
  onEyedropperSampleSizeChange: (v: 1 | 3 | 5) => void;
  // Crop
  isCropActive: boolean;
  onCropConfirm: () => void;
  onCropCancel: () => void;
  // Selection
  hasSelection: boolean;
  isTransformActive: boolean;
  onGrowSelection: () => void;
  onShrinkSelection: () => void;
  onClearSelection: () => void;
  onCopyToNewLayer: () => void;
  onCutToNewLayer: () => void;
  onDeselect: () => void;
  // Transform
  onTransformCommit: () => void;
  onTransformCancel: () => void;
  onTransformReset: () => void;
  // Ruler
  activeRuler: Layer | null;
  onResetCurrentRuler: () => void;
  onClearAllRulers: () => void;
  onUpdateRulerLayer: (updates: Record<string, unknown>) => void;
  onSetLastSingle5ptFamily: (v: "central" | "lr" | "ud") => void;
  onSetLastSingle2ptFamily: (v: "vp1" | "vp2") => void;
  onSetLastSingle3ptFamily: (v: "vp1" | "vp2" | "vp3") => void;
  // Liquify
  liquifySize: number;
  liquifyStrength: number;
  liquifyScope: "active" | "all-visible";
  onLiquifySizeChange: (v: number) => void;
  onLiquifyStrengthChange: (v: number) => void;
  onLiquifyScopeChange: (s: "active" | "all-visible") => void;
  // Mobile
  isMobile?: boolean;
  // Brush tip editor mode — hides save/export
  brushTipEditorActive?: boolean;
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

function Divider() {
  return <div className="w-px h-5 bg-border flex-shrink-0" />;
}

function BarButton({
  onClick,
  active,
  children,
  className = "",
  title,
  danger,
}: {
  onClick: () => void;
  active?: boolean;
  children: React.ReactNode;
  className?: string;
  title?: string;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={[
        "px-2.5 h-7 rounded text-xs font-medium transition-colors shrink-0 whitespace-nowrap",
        active
          ? "bg-primary text-primary-foreground"
          : danger
            ? "bg-muted text-destructive hover:bg-destructive hover:text-destructive-foreground border border-border"
            : "bg-muted text-foreground hover:bg-accent hover:text-accent-foreground border border-border",
        className,
      ].join(" ")}
    >
      {children}
    </button>
  );
}

export function BottomBar({
  brushSize,
  brushOpacity,
  brushFlow,
  brushBlendMode,
  activeTool,
  smudgeStrength,
  onBrushSizeChange,
  onBrushOpacityChange,
  onBrushFlowChange,
  onBrushBlendModeChange,
  onSmudgeStrengthChange,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onClear,
  onExport,
  onExportJPG,
  onExportPSD,
  isPsdExporting = false,
  isPngExporting = false,
  onSave,
  eyedropperSampleSource,
  eyedropperSampleSize,
  onEyedropperSampleSourceChange,
  onEyedropperSampleSizeChange,
  isCropActive,
  onCropConfirm,
  onCropCancel,
  hasSelection,
  isTransformActive,
  onGrowSelection,
  onShrinkSelection,
  onClearSelection,
  onCopyToNewLayer,
  onCutToNewLayer,
  onDeselect,
  onTransformCommit,
  onTransformCancel,
  onTransformReset,
  activeRuler,
  onResetCurrentRuler,
  onClearAllRulers,
  onUpdateRulerLayer,
  onSetLastSingle5ptFamily,
  onSetLastSingle2ptFamily,
  onSetLastSingle3ptFamily,
  liquifySize,
  liquifyStrength,
  liquifyScope,
  onLiquifySizeChange,
  onLiquifyStrengthChange,
  onLiquifyScopeChange,
  isMobile = false,
  brushTipEditorActive = false,
}: BottomBarProps) {
  const [showMobileSaveMenu, setShowMobileSaveMenu] = useState(false);
  const renderToolControls = () => {
    // Crop tool
    if (activeTool === "crop" && isCropActive) {
      return (
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            data-ocid="crop.confirm_button"
            onClick={onCropConfirm}
            className="flex items-center gap-1.5 px-3 h-7 rounded bg-green-600 text-white text-xs font-semibold hover:bg-green-500 transition-colors"
          >
            ✓ Confirm
          </button>
          <button
            type="button"
            data-ocid="crop.cancel_button"
            onClick={onCropCancel}
            className="flex items-center gap-1.5 px-3 h-7 rounded bg-destructive text-destructive-foreground text-xs font-semibold hover:opacity-90 transition-opacity"
          >
            ✕ Cancel
          </button>
        </div>
      );
    }

    // Move/Transform tool
    if (activeTool === "move" && isTransformActive) {
      return (
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            data-ocid="transform.commit_button"
            onClick={onTransformCommit}
            className="flex items-center gap-1.5 px-3 h-7 rounded bg-green-600 text-white text-xs font-semibold hover:bg-green-500 transition-colors"
          >
            ✓ Commit
          </button>
          <button
            type="button"
            data-ocid="transform.cancel_button"
            onClick={onTransformCancel}
            className="flex items-center gap-1.5 px-3 h-7 rounded bg-destructive text-destructive-foreground text-xs font-semibold hover:opacity-90 transition-opacity"
          >
            ✕ Cancel
          </button>
          <BarButton
            data-ocid="transform.reset_button"
            onClick={onTransformReset}
          >
            Reset
          </BarButton>
        </div>
      );
    }

    // Selection tool with active selection (all selection sub-modes use Tool "lasso")
    if (activeTool === "lasso" && hasSelection) {
      return (
        <div className="flex items-center gap-1.5 shrink-0">
          <BarButton
            data-ocid="selection.shrink_button"
            onClick={onShrinkSelection}
            title="Shrink selection"
          >
            − Shrink
          </BarButton>
          <BarButton
            data-ocid="selection.grow_button"
            onClick={onGrowSelection}
            title="Grow selection"
          >
            + Grow
          </BarButton>
          <Divider />
          <BarButton
            data-ocid="selection.clear_button"
            onClick={onClearSelection}
            title="Clear selection content"
          >
            Clear
          </BarButton>
          <BarButton
            data-ocid="selection.copy_layer_button"
            onClick={onCopyToNewLayer}
            title="Copy to new layer (J)"
          >
            Copy
          </BarButton>
          <BarButton
            data-ocid="selection.cut_layer_button"
            onClick={onCutToNewLayer}
            title="Cut to new layer (Shift+J)"
          >
            Cut
          </BarButton>
          <Divider />
          <BarButton
            data-ocid="selection.deselect_button"
            onClick={onDeselect}
            title="Deselect (D)"
          >
            Deselect
          </BarButton>
        </div>
      );
    }

    // Smudge tool
    if (activeTool === "smudge") {
      return (
        <div className="flex items-center gap-2">
          {!isMobile && (
            <>
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                Size
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
              <Divider />
            </>
          )}
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            Strength
          </span>
          <Slider
            data-ocid="bottombar.smudge_strength_input"
            value={[Math.round((smudgeStrength ?? 0.8) * 100)]}
            min={1}
            max={100}
            step={1}
            onValueChange={([v]) => onSmudgeStrengthChange(v / 100)}
            className="w-20"
          />
          <SyncedNumberInput
            value={Math.round((smudgeStrength ?? 0.8) * 100)}
            min={1}
            max={100}
            onChange={(v) => onSmudgeStrengthChange(v / 100)}
            suffix="%"
          />
        </div>
      );
    }

    // Eraser tool — on mobile, hide size/opacity/flow (moved to vertical sliders)
    if (activeTool === "eraser") {
      if (isMobile) {
        // Mobile: no sliders shown (they're on the canvas edge)
        return null;
      }
      return (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            Eraser
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
          <Divider />
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
          <Divider />
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            Flow
          </span>
          <Slider
            data-ocid="bottombar.flow_input"
            value={[Math.round(brushFlow * 100)]}
            min={1}
            max={100}
            step={1}
            onValueChange={([v]) => onBrushFlowChange(v / 100)}
            className="w-20"
          />
          <SyncedNumberInput
            value={Math.round(brushFlow * 100)}
            min={1}
            max={100}
            onChange={(v) => onBrushFlowChange(v / 100)}
            suffix="%"
          />
        </div>
      );
    }

    // Fill tool
    if (activeTool === "fill") {
      return (
        <div className="flex items-center gap-2">
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
          {!isMobile && (
            <>
              <Divider />
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
            </>
          )}
        </div>
      );
    }

    // Eyedropper tool
    if (activeTool === "eyedropper") {
      return (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            Source
          </span>
          <div className="flex items-center gap-1">
            <BarButton
              onClick={() => onEyedropperSampleSourceChange("canvas")}
              active={eyedropperSampleSource === "canvas"}
            >
              Canvas
            </BarButton>
            <BarButton
              onClick={() => onEyedropperSampleSourceChange("layer")}
              active={eyedropperSampleSource === "layer"}
            >
              Active Layer
            </BarButton>
          </div>
          <Divider />
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            Sample
          </span>
          <div className="flex items-center gap-1">
            {([1, 3, 5] as const).map((s) => (
              <BarButton
                key={s}
                onClick={() => onEyedropperSampleSizeChange(s)}
                active={eyedropperSampleSize === s}
              >
                {s}px
              </BarButton>
            ))}
          </div>
        </div>
      );
    }

    // Ruler tool
    if (activeTool === "ruler") {
      const rtype = activeRuler?.rulerPresetType;
      const showFamilyToggles =
        rtype === "oval" ||
        rtype === "grid" ||
        rtype === "perspective-5pt" ||
        rtype === "perspective-2pt" ||
        rtype === "perspective-3pt";

      return (
        <div className="flex items-center gap-1.5 flex-wrap">
          {activeRuler && (
            <>
              <BarButton
                onClick={onResetCurrentRuler}
                title="Reset current ruler to canvas center"
              >
                Reset Ruler
              </BarButton>
              <BarButton
                onClick={onClearAllRulers}
                danger
                title="Delete all ruler layers"
              >
                Clear All
              </BarButton>
              {showFamilyToggles && <Divider />}
            </>
          )}
          {activeRuler && showFamilyToggles && (
            <>
              {rtype === "oval" && (
                <>
                  <BarButton
                    onClick={() =>
                      onUpdateRulerLayer({ ovalSnapMode: "ellipse" })
                    }
                    active={
                      (activeRuler.ovalSnapMode ?? "ellipse") === "ellipse"
                    }
                  >
                    Snap to Ellipse
                  </BarButton>
                  <BarButton
                    onClick={() =>
                      onUpdateRulerLayer({ ovalSnapMode: "parallel-minor" })
                    }
                    active={
                      (activeRuler.ovalSnapMode ?? "ellipse") ===
                      "parallel-minor"
                    }
                  >
                    Parallel to Minor
                  </BarButton>
                </>
              )}
              {rtype === "grid" && (
                <>
                  <BarButton
                    onClick={() =>
                      onUpdateRulerLayer({ gridMode: "subdivide" })
                    }
                    active={
                      (activeRuler.gridMode ?? "subdivide") === "subdivide"
                    }
                  >
                    Subdivide
                  </BarButton>
                  <BarButton
                    onClick={() => onUpdateRulerLayer({ gridMode: "extrude" })}
                    active={(activeRuler.gridMode ?? "subdivide") === "extrude"}
                  >
                    Extrude
                  </BarButton>
                </>
              )}
              {rtype === "perspective-5pt" &&
                (["central", "lr", "ud"] as const).map((family) => {
                  const label =
                    family === "central"
                      ? "Central"
                      : family === "lr"
                        ? "Left/Right"
                        : "Up/Down";
                  const isActive =
                    family === "central"
                      ? activeRuler.fivePtEnableCenter !== false
                      : family === "lr"
                        ? activeRuler.fivePtEnableLR !== false
                        : activeRuler.fivePtEnableUD !== false;
                  return (
                    <BarButton
                      key={family}
                      active={isActive}
                      onClick={() => {
                        const c = activeRuler.fivePtEnableCenter !== false;
                        const lr = activeRuler.fivePtEnableLR !== false;
                        const ud = activeRuler.fivePtEnableUD !== false;
                        const activeCount = [c, lr, ud].filter(Boolean).length;
                        if (isActive && activeCount === 1) {
                          toast.error(
                            "To disable all guide families, turn the ruler off in the layer panel.",
                          );
                          return;
                        }
                        const newC = family === "central" ? !isActive : c;
                        const newLR = family === "lr" ? !isActive : lr;
                        const newUD = family === "ud" ? !isActive : ud;
                        const newCount = [newC, newLR, newUD].filter(
                          Boolean,
                        ).length;
                        if (newCount === 1) {
                          onSetLastSingle5ptFamily(
                            newC ? "central" : newLR ? "lr" : "ud",
                          );
                        }
                        onUpdateRulerLayer({
                          fivePtEnableCenter: newC,
                          fivePtEnableLR: newLR,
                          fivePtEnableUD: newUD,
                        });
                      }}
                    >
                      {label}
                    </BarButton>
                  );
                })}
              {rtype === "perspective-2pt" &&
                (["vp1", "vp2"] as const).map((vp) => {
                  const isActive =
                    vp === "vp1"
                      ? activeRuler.twoPtEnableVP1 !== false
                      : activeRuler.twoPtEnableVP2 !== false;
                  return (
                    <BarButton
                      key={vp}
                      active={isActive}
                      onClick={() => {
                        const a1 = activeRuler.twoPtEnableVP1 !== false;
                        const a2 = activeRuler.twoPtEnableVP2 !== false;
                        const count = [a1, a2].filter(Boolean).length;
                        if (isActive && count === 1) {
                          toast.error(
                            "To disable all guide families, turn the ruler off in the layer panel.",
                          );
                          return;
                        }
                        const newV1 = vp === "vp1" ? !isActive : a1;
                        const newV2 = vp === "vp2" ? !isActive : a2;
                        if ([newV1, newV2].filter(Boolean).length === 1) {
                          onSetLastSingle2ptFamily(newV1 ? "vp1" : "vp2");
                        }
                        onUpdateRulerLayer({
                          twoPtEnableVP1: newV1,
                          twoPtEnableVP2: newV2,
                        });
                      }}
                    >
                      {vp === "vp1" ? "VP1" : "VP2"}
                    </BarButton>
                  );
                })}
              {rtype === "perspective-3pt" &&
                (["vp1", "vp2", "vp3"] as const).map((vp) => {
                  const isActive =
                    vp === "vp1"
                      ? activeRuler.threePtEnableVP1 !== false
                      : vp === "vp2"
                        ? activeRuler.threePtEnableVP2 !== false
                        : activeRuler.threePtEnableVP3 !== false;
                  return (
                    <BarButton
                      key={vp}
                      active={isActive}
                      onClick={() => {
                        const b1 = activeRuler.threePtEnableVP1 !== false;
                        const b2 = activeRuler.threePtEnableVP2 !== false;
                        const b3 = activeRuler.threePtEnableVP3 !== false;
                        const count = [b1, b2, b3].filter(Boolean).length;
                        if (isActive && count === 1) {
                          toast.error(
                            "To disable all guide families, turn the ruler off in the layer panel.",
                          );
                          return;
                        }
                        const newT1 = vp === "vp1" ? !isActive : b1;
                        const newT2 = vp === "vp2" ? !isActive : b2;
                        const newT3 = vp === "vp3" ? !isActive : b3;
                        if (
                          [newT1, newT2, newT3].filter(Boolean).length === 1
                        ) {
                          onSetLastSingle3ptFamily(
                            newT1 ? "vp1" : newT2 ? "vp2" : "vp3",
                          );
                        }
                        onUpdateRulerLayer({
                          threePtEnableVP1: newT1,
                          threePtEnableVP2: newT2,
                          threePtEnableVP3: newT3,
                        });
                      }}
                    >
                      {vp === "vp1" ? "VP1" : vp === "vp2" ? "VP2" : "VP3"}
                    </BarButton>
                  );
                })}
            </>
          )}
        </div>
      );
    }

    // Standard brush tool — on mobile, hide Size/Opacity/Flow (moved to vertical sliders)
    if (activeTool === "brush") {
      return (
        <div className="flex items-center gap-2">
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
          {!isMobile && (
            <>
              <Divider />
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                Size
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
              <Divider />
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
              <Divider />
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                Flow
              </span>
              <Slider
                data-ocid="bottombar.flow_input"
                value={[Math.round(brushFlow * 100)]}
                min={1}
                max={100}
                step={1}
                onValueChange={([v]) => onBrushFlowChange(v / 100)}
                className="w-20"
              />
              <SyncedNumberInput
                value={Math.round(brushFlow * 100)}
                min={1}
                max={100}
                onChange={(v) => onBrushFlowChange(v / 100)}
                suffix="%"
              />
            </>
          )}
        </div>
      );
    }

    // Liquify tool
    if (activeTool === "liquify") {
      return (
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Scope */}
          <BarButton
            active={liquifyScope === "active"}
            onClick={() => onLiquifyScopeChange("active")}
          >
            Active Layer
          </BarButton>
          <BarButton
            active={liquifyScope === "all-visible"}
            onClick={() => onLiquifyScopeChange("all-visible")}
          >
            All Visible
          </BarButton>
          <Divider />
          {/* Size */}
          {!isMobile && (
            <>
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                Size
              </span>
              <Slider
                value={[sizeToSlider(liquifySize)]}
                min={0}
                max={100}
                step={0.5}
                onValueChange={([v]) =>
                  onLiquifySizeChange(Math.round(sliderToSize(v)))
                }
                className="w-20"
              />
              <SyncedNumberInput
                value={liquifySize}
                min={1}
                max={1000}
                onChange={onLiquifySizeChange}
                suffix="px"
              />
              <Divider />
            </>
          )}
          {/* Strength */}
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            Strength
          </span>
          <Slider
            value={[Math.round(liquifyStrength * 100)]}
            min={1}
            max={100}
            step={1}
            onValueChange={([v]) => onLiquifyStrengthChange(v / 100)}
            className="w-20"
          />
          <SyncedNumberInput
            value={Math.round(liquifyStrength * 100)}
            min={1}
            max={100}
            onChange={(v) => onLiquifyStrengthChange(v / 100)}
            suffix="%"
          />
        </div>
      );
    }

    // All other tools: no tool-specific controls
    return null;
  };

  return (
    <TooltipProvider delayDuration={300}>
      <div
        className="flex items-center gap-2 px-3 border-b border-border bg-card flex-shrink-0 overflow-x-auto"
        style={{
          height: "calc(48px + env(safe-area-inset-top))",
          paddingTop: "env(safe-area-inset-top)",
        }}
      >
        {/* Tool-specific left/center section */}
        <div className="flex items-center gap-2 flex-1 min-w-0 overflow-x-auto">
          {renderToolControls()}
        </div>

        <div className="flex-shrink-0" />

        {/* Persistent right section */}
        <div className="flex items-center gap-1 shrink-0 ml-auto">
          {/* Undo/Redo */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                data-ocid="bottombar.undo_button"
                onClick={onUndo}
                disabled={!canUndo || isTransformActive}
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
                disabled={!canRedo || isTransformActive}
                className="w-8 h-8 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 transition-colors"
              >
                <Redo2 size={16} />
              </button>
            </TooltipTrigger>
            <TooltipContent>Redo (Ctrl+Shift+Z)</TooltipContent>
          </Tooltip>

          <Divider />

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

          {/* Export dropdown — hidden in brush tip editor mode */}
          {!brushTipEditorActive && !isMobile && (
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      data-ocid="bottombar.export_button"
                      className="w-8 h-8 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    >
                      <Download size={16} />
                    </button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>Export</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  data-ocid="bottombar.save_sktch_item"
                  onClick={onSave}
                >
                  <Save size={14} className="mr-2 shrink-0" />
                  Save as .sktch
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  data-ocid="bottombar.export_png_item"
                  onClick={onExport}
                  disabled={isPngExporting}
                >
                  {isPngExporting ? (
                    <Loader2 size={14} className="mr-2 animate-spin shrink-0" />
                  ) : (
                    <FileImage size={14} className="mr-2 shrink-0" />
                  )}
                  {isPngExporting ? "Exporting…" : "PNG Image"}
                </DropdownMenuItem>
                <DropdownMenuItem
                  data-ocid="bottombar.export_psd_item"
                  onClick={onExportPSD}
                  disabled={!onExportPSD || isPsdExporting}
                >
                  {isPsdExporting ? (
                    <Loader2 size={14} className="mr-2 animate-spin shrink-0" />
                  ) : (
                    <Download size={14} className="mr-2 shrink-0 opacity-50" />
                  )}
                  {isPsdExporting ? "Exporting…" : "Photoshop (.psd)"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* Save — desktop only, hidden in brush tip editor mode */}
          {!brushTipEditorActive && !isMobile && (
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
          )}

          {/* Mobile: unified Save/Export button — hidden in brush tip editor mode */}
          {!brushTipEditorActive && isMobile && (
            <div style={{ position: "relative" }}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    data-ocid="bottombar.mobile_save_export_button"
                    onClick={() => setShowMobileSaveMenu((v) => !v)}
                    className="w-8 h-8 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  >
                    <Download size={16} />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Save / Export</TooltipContent>
              </Tooltip>
              {showMobileSaveMenu && (
                <>
                  {/* Backdrop to close menu */}
                  <div
                    style={{
                      position: "fixed",
                      inset: 0,
                      zIndex: 998,
                      background: "rgba(0,0,0,0.45)",
                    }}
                    onPointerDown={() => setShowMobileSaveMenu(false)}
                  />
                  {/* Dropdown menu — centered in viewport on mobile */}
                  <div
                    data-ocid="bottombar.mobile_save_export_menu"
                    style={{
                      position: "fixed",
                      top: "40%",
                      left: "50%",
                      transform: "translateX(-50%) translateY(-50%)",
                      zIndex: 999,
                      background: "oklch(var(--card))",
                      border: "1px solid oklch(var(--border))",
                      borderRadius: 12,
                      boxShadow: "0 16px 48px rgba(0,0,0,0.45)",
                      width: "fit-content",
                      minWidth: 200,
                      maxWidth: "80vw",
                      paddingLeft: 24,
                      paddingRight: 24,
                      overflow: "hidden",
                    }}
                  >
                    <button
                      type="button"
                      data-ocid="bottombar.mobile_save_sktch_item"
                      onClick={() => {
                        setShowMobileSaveMenu(false);
                        onSave();
                      }}
                      className="w-full flex items-center gap-3 px-5 text-sm text-foreground hover:bg-muted transition-colors text-left"
                      style={{ minHeight: 48 }}
                    >
                      <Save
                        size={16}
                        className="shrink-0 text-muted-foreground"
                      />
                      Save as .sktch
                    </button>
                    <div className="h-px bg-border" />
                    <button
                      type="button"
                      data-ocid="bottombar.mobile_export_png_item"
                      onClick={() => {
                        setShowMobileSaveMenu(false);
                        onExport();
                      }}
                      disabled={isPngExporting}
                      className="w-full flex items-center gap-3 px-5 text-sm text-foreground hover:bg-muted transition-colors text-left disabled:opacity-40"
                      style={{ minHeight: 48 }}
                    >
                      {isPngExporting ? (
                        <Loader2
                          size={16}
                          className="shrink-0 animate-spin text-muted-foreground"
                        />
                      ) : (
                        <FileImage
                          size={16}
                          className="shrink-0 text-muted-foreground"
                        />
                      )}
                      Export as PNG
                    </button>
                    <div className="h-px bg-border" />
                    <button
                      type="button"
                      data-ocid="bottombar.mobile_export_jpg_item"
                      onClick={() => {
                        setShowMobileSaveMenu(false);
                        onExportJPG?.();
                      }}
                      className="w-full flex items-center gap-3 px-5 text-sm text-foreground hover:bg-muted transition-colors text-left"
                      style={{ minHeight: 48 }}
                    >
                      <FileImage
                        size={16}
                        className="shrink-0 text-muted-foreground"
                      />
                      Export as JPG
                    </button>
                    <div className="h-px bg-border" />
                    <button
                      type="button"
                      data-ocid="bottombar.mobile_export_psd_item"
                      onClick={() => {
                        setShowMobileSaveMenu(false);
                        onExportPSD?.();
                      }}
                      disabled={isPsdExporting}
                      className="w-full flex items-center gap-3 px-5 text-sm text-foreground hover:bg-muted transition-colors text-left disabled:opacity-40"
                      style={{ minHeight: 48 }}
                    >
                      {isPsdExporting ? (
                        <Loader2
                          size={16}
                          className="shrink-0 animate-spin text-muted-foreground"
                        />
                      ) : (
                        <Download
                          size={16}
                          className="shrink-0 text-muted-foreground"
                        />
                      )}
                      Export as PSD
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}
