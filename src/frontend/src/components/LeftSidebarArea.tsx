import type { HSVAColor } from "@/utils/colorUtils";
import type { Preset } from "@/utils/toolPresets";
import type React from "react";
import { AdjustmentsPresetsPanel } from "./AdjustmentsPresetsPanel";
import type { BrushSettings } from "./BrushSettingsPanel";
import { ColorPickerPanel } from "./ColorPickerPanel";
import { EyedropperSettingsPanel } from "./EyedropperSettingsPanel";
import { FillPresetsPanel } from "./FillPresetsPanel";
import type { FillMode, FillSettings } from "./FillPresetsPanel";
import { LassoPresetsPanel } from "./LassoPresetsPanel";
import type { Layer } from "./LayersPanel";
import { type RulerPresetType, RulerPresetsPanel } from "./RulerPresetsPanel";
import { ToolPresetsPanel } from "./ToolPresetsPanel";
import type { LassoMode, Tool } from "./Toolbar";

export interface LeftSidebarAreaProps {
  // Sidebar sizing / visibility
  leftSidebarCollapsed: boolean;
  setLeftSidebarCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  leftSidebarWidth: number;
  setLeftSidebarWidth: React.Dispatch<React.SetStateAction<number>>;
  activeTool: Tool;

  // Color picker
  color: HSVAColor;
  setColor: React.Dispatch<React.SetStateAction<HSVAColor>>;
  recentColors: string[];
  onRecentColorClick: (hex: string) => void;

  // Active subpanel / tool presets
  activeSubpanel: Tool | null;
  setActiveSubpanel: React.Dispatch<React.SetStateAction<Tool | null>>;

  // Brush/Smudge/Eraser presets
  presets: Record<"brush" | "smudge" | "eraser", Preset[]>;
  activePresetIds: Record<"brush" | "smudge" | "eraser", string | null>;
  brushSettings: BrushSettings;
  currentBrushSize: number;
  onSelectPreset: (preset: Preset) => void;
  onUpdatePreset: (preset: Preset) => void;
  onAddPreset: (tipImageData?: string) => void;
  onDeletePreset: (presetId: string) => void;
  onActivatePreset: () => void;
  onReorderPresets: (fromIndex: number, toIndex: number) => void;
  onSaveCurrentToPreset: (
    presetId: string,
    size: number,
    opacity: number,
  ) => void;

  // Lasso presets
  lassoMode: LassoMode;
  onSelectLassoMode: (mode: LassoMode) => void;
  wandTolerance: number;
  wandContiguous: boolean;
  wandGrowShrink: number;
  onWandToleranceChange: React.Dispatch<React.SetStateAction<number>>;
  onWandContiguousChange: React.Dispatch<React.SetStateAction<boolean>>;
  onWandGrowShrinkChange: React.Dispatch<React.SetStateAction<number>>;

  // Adjustments panel
  activeLayerId: string | null;
  layers: Layer[];
  layerCanvasesRef: React.RefObject<Map<string, HTMLCanvasElement>>;
  selectionMaskRef: React.RefObject<HTMLCanvasElement | null>;
  selectionActive: boolean;
  onAdjustmentsPushUndo: (
    layerId: string,
    before: ImageData,
    after: ImageData,
  ) => void;
  onAdjustmentsPreview: () => void;
  onAdjustmentsComposite: () => void;
  onAdjustmentsThumbnailUpdate: (layerId: string) => void;
  onAdjustmentsMarkLayerDirty: (id: string) => void;

  // Fill presets
  fillMode: FillMode;
  fillSettings: FillSettings;
  onSelectFillMode: (mode: FillMode) => void;
  onFillSettingsChange: (settings: FillSettings) => void;

  // Ruler presets
  activeRulerPresetType: RulerPresetType;
  onRulerPresetTypeChange: (type: RulerPresetType) => void;
  onRulerColorChange: (color: string) => void;
  onVp1ColorChange: (color: string) => void;
  onVp2ColorChange: (color: string) => void;
  onVp3ColorChange: (color: string) => void;
  onRulerWarmupDistChange: (val: number) => void;
  onLineSnapModeChange: (mode: "line" | "parallel") => void;
  onLockFocalLengthChange: (val: boolean) => void;
  onOvalSnapModeChange: (mode: "ellipse" | "parallel-minor") => void;
  onGridModeChange: (mode: "subdivide" | "extrude") => void;
  onGridVertSegmentsChange: (v: number) => void;
  onGridHorizSegmentsChange: (v: number) => void;
  onFivePtCenterColorChange: (color: string) => void;
  onFivePtLRColorChange: (color: string) => void;
  onFivePtUDColorChange: (color: string) => void;
  onFivePtEnableCenterChange: (v: boolean) => void;
  onFivePtEnableLRChange: (v: boolean) => void;
  onFivePtEnableUDChange: (v: boolean) => void;
  onGridReset: () => void;

  // Eyedropper
  eyedropperSampleSource: "canvas" | "layer";
  setEyedropperSampleSource: React.Dispatch<
    React.SetStateAction<"canvas" | "layer">
  >;
  eyedropperSampleSize: 1 | 3 | 5;
  setEyedropperSampleSize: React.Dispatch<React.SetStateAction<1 | 3 | 5>>;
}

export function LeftSidebarArea({
  leftSidebarCollapsed,
  setLeftSidebarCollapsed,
  leftSidebarWidth,
  setLeftSidebarWidth,
  activeTool,
  color,
  setColor,
  recentColors,
  onRecentColorClick,
  activeSubpanel,
  setActiveSubpanel,
  presets,
  activePresetIds,
  brushSettings,
  currentBrushSize,
  onSelectPreset,
  onUpdatePreset,
  onAddPreset,
  onDeletePreset,
  onActivatePreset,
  onReorderPresets,
  onSaveCurrentToPreset,
  lassoMode,
  onSelectLassoMode,
  wandTolerance,
  wandContiguous,
  wandGrowShrink,
  onWandToleranceChange,
  onWandContiguousChange,
  onWandGrowShrinkChange,
  activeLayerId,
  layers,
  layerCanvasesRef,
  selectionMaskRef,
  selectionActive,
  onAdjustmentsPushUndo,
  onAdjustmentsPreview,
  onAdjustmentsComposite,
  onAdjustmentsThumbnailUpdate,
  onAdjustmentsMarkLayerDirty,
  fillMode,
  fillSettings,
  onSelectFillMode,
  onFillSettingsChange,
  activeRulerPresetType,
  onRulerPresetTypeChange,
  onRulerColorChange,
  onVp1ColorChange,
  onVp2ColorChange,
  onVp3ColorChange,
  onRulerWarmupDistChange,
  onLineSnapModeChange,
  onLockFocalLengthChange,
  onOvalSnapModeChange,
  onGridModeChange,
  onGridVertSegmentsChange,
  onGridHorizSegmentsChange,
  onFivePtCenterColorChange,
  onFivePtLRColorChange,
  onFivePtUDColorChange,
  onFivePtEnableCenterChange,
  onFivePtEnableLRChange,
  onFivePtEnableUDChange,
  onGridReset,
  eyedropperSampleSource,
  setEyedropperSampleSource,
  eyedropperSampleSize,
  setEyedropperSampleSize,
}: LeftSidebarAreaProps) {
  // Build the deduplicated tips list for ToolPresetsPanel
  const availableTips = (() => {
    const seen = new Set<string>();
    const tips: { id: string; name: string; tipImageData?: string }[] = [];
    for (const toolType of ["brush", "smudge", "eraser"] as const) {
      for (const preset of presets[toolType]) {
        const key = preset.settings.tipImageData ?? `__no-tip-${preset.id}`;
        if (!seen.has(key)) {
          seen.add(key);
          tips.push({
            id: preset.id,
            name: preset.name,
            tipImageData: preset.settings.tipImageData,
          });
        }
      }
    }
    return tips;
  })();

  const rulerLayer = layers.find((l) => l.isRuler);

  return (
    <div
      className="flex border-r border-border overflow-hidden relative"
      style={{
        width: leftSidebarCollapsed ? 16 : leftSidebarWidth,
        minWidth: leftSidebarCollapsed ? 16 : 160,
        maxWidth: leftSidebarCollapsed ? 16 : 380,
        transition: "width 0.15s ease, min-width 0.15s ease",
        flexShrink: 0,
        paddingBottom: "env(safe-area-inset-bottom)",
        background: "oklch(var(--sidebar-left))",
      }}
    >
      {/* Left sidebar resize handle (right edge) */}
      {!leftSidebarCollapsed && (
        <div
          style={{
            position: "absolute",
            right: 0,
            top: 0,
            bottom: 0,
            width: 4,
            cursor: "col-resize",
            zIndex: 10,
          }}
          onPointerDown={(e) => {
            e.preventDefault();
            const startX = e.clientX;
            const startW = leftSidebarWidth;
            const onMove = (me: PointerEvent) => {
              const delta = me.clientX - startX;
              setLeftSidebarWidth(Math.min(380, Math.max(160, startW + delta)));
            };
            const onUp = () => {
              window.removeEventListener("pointermove", onMove);
              window.removeEventListener("pointerup", onUp);
            };
            window.addEventListener("pointermove", onMove);
            window.addEventListener("pointerup", onUp);
          }}
        />
      )}
      {!leftSidebarCollapsed && (
        <div className="flex flex-col flex-1" style={{ overflowX: "hidden" }}>
          {/* Color Picker Panel */}
          <div onPointerDown={(e) => e.stopPropagation()} className="shrink-0">
            <ColorPickerPanel
              color={color}
              onColorChange={setColor}
              recentColors={recentColors}
              onRecentColorClick={onRecentColorClick}
            />
          </div>

          {/* Divider */}
          <div className="border-t border-border" />

          {/* Tool Presets Panel */}
          <div
            className="flex-1 min-h-0 flex flex-col"
            style={{ overflowX: "hidden" }}
          >
            {activeSubpanel === "brush" ||
            activeSubpanel === "smudge" ||
            activeSubpanel === "eraser" ? (
              <ToolPresetsPanel
                tool={activeSubpanel}
                availableTips={availableTips}
                presets={presets[activeSubpanel]}
                activePresetId={activePresetIds[activeSubpanel] ?? null}
                currentSettings={brushSettings}
                onSelectPreset={onSelectPreset}
                onUpdatePreset={onUpdatePreset}
                onAddPreset={onAddPreset}
                onDeletePreset={onDeletePreset}
                onActivate={onActivatePreset}
                onClose={() => setActiveSubpanel(null)}
                onReorderPresets={onReorderPresets}
                currentSize={currentBrushSize}
                currentOpacity={color.a}
                onSaveCurrentToPreset={onSaveCurrentToPreset}
              />
            ) : activeSubpanel === "lasso" ? (
              <LassoPresetsPanel
                lassoMode={lassoMode}
                onSelectMode={onSelectLassoMode}
                onClose={() => setActiveSubpanel(null)}
                accentColor="var(--accent)"
                isDarkMode={false}
                wandTolerance={wandTolerance}
                wandContiguous={wandContiguous}
                onWandToleranceChange={onWandToleranceChange}
                onWandContiguousChange={onWandContiguousChange}
                wandGrowShrink={wandGrowShrink}
                onWandGrowShrinkChange={onWandGrowShrinkChange}
              />
            ) : activeSubpanel === "adjustments" ? (
              <AdjustmentsPresetsPanel
                activeLayerId={activeLayerId}
                activeLayerIsRuler={
                  !!layers.find((l) => l.id === activeLayerId)?.isRuler
                }
                layerCanvasesRef={layerCanvasesRef}
                selectionMaskRef={selectionMaskRef}
                selectionActive={selectionActive}
                onPushUndo={onAdjustmentsPushUndo}
                onPreview={onAdjustmentsPreview}
                onComposite={onAdjustmentsComposite}
                onThumbnailUpdate={onAdjustmentsThumbnailUpdate}
                onMarkLayerDirty={onAdjustmentsMarkLayerDirty}
              />
            ) : activeSubpanel === "fill" ? (
              <FillPresetsPanel
                fillMode={fillMode}
                fillSettings={fillSettings}
                onSelectMode={onSelectFillMode}
                onSettingsChange={onFillSettingsChange}
                onClose={() => setActiveSubpanel(null)}
              />
            ) : activeSubpanel === "ruler" ? (
              <RulerPresetsPanel
                rulerPresetType={activeRulerPresetType}
                onRulerPresetTypeChange={onRulerPresetTypeChange}
                rulerColor={rulerLayer?.rulerColor ?? "#9333ea"}
                onRulerColorChange={onRulerColorChange}
                vp1Color={rulerLayer?.vp1Color ?? "#ff0000"}
                vp2Color={rulerLayer?.vp2Color ?? "#0000ff"}
                vp3Color={rulerLayer?.vp3Color ?? "#00ff00"}
                onVp1ColorChange={onVp1ColorChange}
                onVp2ColorChange={onVp2ColorChange}
                onVp3ColorChange={onVp3ColorChange}
                rulerWarmupDist={rulerLayer?.rulerWarmupDist ?? 10}
                onRulerWarmupDistChange={onRulerWarmupDistChange}
                lineSnapMode={rulerLayer?.lineSnapMode ?? "line"}
                onLineSnapModeChange={onLineSnapModeChange}
                lockFocalLength={rulerLayer?.lockFocalLength ?? false}
                onLockFocalLengthChange={onLockFocalLengthChange}
                ovalSnapMode={rulerLayer?.ovalSnapMode ?? "ellipse"}
                onOvalSnapModeChange={onOvalSnapModeChange}
                gridMode={rulerLayer?.gridMode ?? "subdivide"}
                onGridModeChange={onGridModeChange}
                gridVertSegments={rulerLayer?.gridVertSegments ?? 4}
                onGridVertSegmentsChange={onGridVertSegmentsChange}
                gridHorizSegments={rulerLayer?.gridHorizSegments ?? 4}
                onGridHorizSegmentsChange={onGridHorizSegmentsChange}
                fivePtCenterColor={rulerLayer?.fivePtCenterColor ?? "#9333ea"}
                onFivePtCenterColorChange={onFivePtCenterColorChange}
                fivePtLRColor={rulerLayer?.fivePtLRColor ?? "#ff0000"}
                onFivePtLRColorChange={onFivePtLRColorChange}
                fivePtUDColor={rulerLayer?.fivePtUDColor ?? "#0000ff"}
                onFivePtUDColorChange={onFivePtUDColorChange}
                fivePtEnableCenter={rulerLayer?.fivePtEnableCenter !== false}
                onFivePtEnableCenterChange={onFivePtEnableCenterChange}
                fivePtEnableLR={rulerLayer?.fivePtEnableLR !== false}
                onFivePtEnableLRChange={onFivePtEnableLRChange}
                fivePtEnableUD={rulerLayer?.fivePtEnableUD !== false}
                onFivePtEnableUDChange={onFivePtEnableUDChange}
                onGridReset={onGridReset}
              />
            ) : activeSubpanel === ("eyedropper" as never) ? (
              <EyedropperSettingsPanel
                sampleSource={eyedropperSampleSource}
                onSampleSourceChange={(v) => setEyedropperSampleSource(v)}
                sampleSize={eyedropperSampleSize}
                onSampleSizeChange={(v) => setEyedropperSampleSize(v)}
              />
            ) : activeSubpanel === ("rotate" as never) ? (
              <div className="flex items-center justify-center h-16 text-muted-foreground text-xs select-none opacity-40">
                R to rotate · Shift+R to hold
              </div>
            ) : (
              <div className="flex items-center justify-center h-16 text-muted-foreground text-xs select-none opacity-40">
                No presets
              </div>
            )}
          </div>
        </div>
      )}

      {/* Collapse / expand toggle button */}
      {(leftSidebarCollapsed ||
        !(
          activeTool === "brush" ||
          activeTool === "smudge" ||
          activeTool === "eraser" ||
          activeTool === "lasso" ||
          activeTool === "fill"
        )) && (
        <button
          type="button"
          data-ocid="left_sidebar.toggle"
          onClick={() => setLeftSidebarCollapsed((c) => !c)}
          className="absolute top-1/2 -translate-y-1/2 right-0 translate-x-full z-20 flex items-center justify-center bg-card border border-border rounded-r-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          style={{ width: 14, height: 40, fontSize: 9 }}
          title={leftSidebarCollapsed ? "Expand panel" : "Collapse panel"}
        >
          {leftSidebarCollapsed ? "›" : "‹"}
        </button>
      )}
    </div>
  );
}
