import type { HSVAColor } from "@/utils/colorUtils";
import type { Preset } from "@/utils/toolPresets";
import {
  Layers,
  Palette,
  SlidersHorizontal as PresetsIcon,
} from "lucide-react";
import type { RefObject } from "react";
import type { ViewTransform } from "../types";
import type { BrushSettings } from "./BrushSettingsPanel";
import { ColorPickerPanel } from "./ColorPickerPanel";
import { FillPresetsPanel } from "./FillPresetsPanel";
import type { FillMode, FillSettings } from "./FillPresetsPanel";
import { LassoPresetsPanel } from "./LassoPresetsPanel";
import type { Layer } from "./LayersPanel";
import { MobileCanvasSliders } from "./MobileCanvasSliders";
import { type RulerPresetType, RulerPresetsPanel } from "./RulerPresetsPanel";
import { ToolPresetsPanel } from "./ToolPresetsPanel";
import type { LassoMode, Tool } from "./Toolbar";

// --- Prop types ---

type ActiveSubpanel =
  | "brush"
  | "smudge"
  | "eraser"
  | "lasso"
  | "fill"
  | "ruler"
  | "eyedropper"
  | "rotate"
  | null;

export interface CanvasAreaProps {
  // Refs
  containerRef: RefObject<HTMLDivElement | null>;
  displayCanvasRef: RefObject<HTMLCanvasElement | null>;
  selectionOverlayCanvasRef: RefObject<HTMLCanvasElement | null>;
  rulerCanvasRef: RefObject<HTMLCanvasElement | null>;
  canvasWrapperRef: RefObject<HTMLDivElement | null>;
  canvasWidthRef: RefObject<number>;
  canvasHeightRef: RefObject<number>;
  cropRectRef: RefObject<{ x: number; y: number; w: number; h: number }>;
  toolSizesRef: RefObject<Record<string, number>>;
  toolOpacitiesRef: RefObject<Record<string, number>>;
  toolFlowsRef: RefObject<Record<string, number>>;

  // Canvas dimensions (React state)
  canvasWidth: number;
  canvasHeight: number;

  // View transform state
  viewTransform: ViewTransform;
  isFlipped: boolean;
  isDefaultTransform: boolean;
  zoom: number;
  rotation: number;

  // Tool state
  activeTool: Tool;
  activeSubpanel: ActiveSubpanel;
  currentBrushSize: number;
  color: HSVAColor;
  brushSettings: BrushSettings;
  lassoMode: LassoMode;
  fillMode: FillMode;
  fillSettings: FillSettings;
  activeRulerPresetType: RulerPresetType;
  presets: Record<"brush" | "smudge" | "eraser", Preset[]>;
  activePresetIds: Record<string, string | null>;
  layers: Layer[];

  // Ruler
  scheduleRulerOverlay: () => void;

  // Crop state
  isCropActive: boolean;
  cropRectVersion: number;

  // Mobile state
  isMobile: boolean;
  leftHanded: boolean;
  showMobileColorPanel: boolean;
  showMobilePresetsPanel: boolean;
  recentColors: string[];
  wandTolerance: number;
  wandContiguous: boolean;
  wandGrowShrink: number;

  // CSS cursor
  cursor: string;

  // Callbacks — mobile
  onSetShowMobileColorPanel: (show: boolean) => void;
  onSetShowMobilePresetsPanel: (show: boolean) => void;
  onSetRightSidebarCollapsed: (collapsed: (c: boolean) => boolean) => void;
  onRecentColorClick: (color: string) => void;
  onColorChange: (color: HSVAColor) => void;

  // Brush slider callbacks
  onBrushSizeChange: (v: number) => void;
  onBrushOpacityChange: (v: number) => void;
  onBrushFlowChange: (v: number) => void;

  // Liquify slider props — passed through to MobileCanvasSliders when activeTool === 'liquify'
  liquifySize?: number;
  liquifyStrength?: number;
  onLiquifySizeChange?: (v: number) => void;
  onLiquifyStrengthChange?: (v: number) => void;

  // Preset callbacks
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

  // Lasso/fill/ruler preset callbacks
  onSelectLassoMode: (mode: LassoMode) => void;
  onCloseMobilePresetsPanel: () => void;
  onWandToleranceChange: (v: number) => void;
  onWandContiguousChange: (v: boolean) => void;
  onWandGrowShrinkChange: (v: number) => void;
  onSelectFillMode: (mode: FillMode) => void;
  onFillSettingsChange: (settings: FillSettings) => void;
  onRulerPresetTypeChange: (type: RulerPresetType) => void;
  onRulerColorChange: (color: string) => void;
  onVp1ColorChange: (color: string) => void;
  onVp2ColorChange: (color: string) => void;
  onVp3ColorChange: (color: string) => void;
  onRulerWarmupDistChange: (val: number) => void;
  onLineSnapModeChange: (mode: "line" | "parallel") => void;
  onLockFocalLengthChange: (val: boolean) => void;
  onOvalSnapModeChange: (mode: "ellipse" | "parallel-minor") => void;
  onFivePtEnableCenterChange: (v: boolean) => void;
  onFivePtEnableLRChange: (v: boolean) => void;
  onFivePtEnableUDChange: (v: boolean) => void;
  onGridReset: () => void;

  // Crop handle drag
  onCropHandlePointerDown: (
    e: React.PointerEvent<HTMLDivElement>,
    handle: "nw" | "n" | "ne" | "w" | "e" | "sw" | "s" | "se",
  ) => void;

  // View HUD
  onResetView: () => void;

  // Canvas double-click (lasso free-form close)
  onCanvasDoubleClick: (e: React.MouseEvent<HTMLCanvasElement>) => void;

  // Ruler overlay ref callback
  onRulerCanvasRef: (el: HTMLCanvasElement | null) => void;
  onSelectionOverlayCanvasRef: (el: HTMLCanvasElement | null) => void;
}

export function CanvasArea({
  containerRef,
  displayCanvasRef,
  canvasWrapperRef,
  canvasWidthRef,
  canvasHeightRef,
  cropRectRef,
  canvasWidth,
  canvasHeight,
  viewTransform,
  isFlipped,
  isDefaultTransform,
  zoom,
  rotation,
  activeTool,
  activeSubpanel,
  currentBrushSize,
  color,
  brushSettings,
  lassoMode,
  fillMode,
  fillSettings,
  activeRulerPresetType,
  presets,
  activePresetIds,
  layers,
  scheduleRulerOverlay,
  isCropActive,
  cropRectVersion,
  isMobile,
  leftHanded,
  showMobileColorPanel,
  showMobilePresetsPanel,
  recentColors,
  wandTolerance,
  wandContiguous,
  wandGrowShrink,
  cursor,
  onSetShowMobileColorPanel,
  onSetShowMobilePresetsPanel,
  onSetRightSidebarCollapsed,
  onRecentColorClick,
  onColorChange,
  onBrushSizeChange,
  onBrushOpacityChange,
  onBrushFlowChange,
  liquifySize,
  liquifyStrength,
  onLiquifySizeChange,
  onLiquifyStrengthChange,
  onSelectPreset,
  onUpdatePreset,
  onAddPreset,
  onDeletePreset,
  onActivatePreset,
  onReorderPresets,
  onSaveCurrentToPreset,
  onSelectLassoMode,
  onCloseMobilePresetsPanel,
  onWandToleranceChange,
  onWandContiguousChange,
  onWandGrowShrinkChange,
  onSelectFillMode,
  onFillSettingsChange,
  onRulerPresetTypeChange,
  onRulerColorChange,
  onVp1ColorChange,
  onVp2ColorChange,
  onVp3ColorChange,
  onRulerWarmupDistChange,
  onLineSnapModeChange,
  onLockFocalLengthChange,
  onOvalSnapModeChange,
  onFivePtEnableCenterChange,
  onFivePtEnableLRChange,
  onFivePtEnableUDChange,
  onGridReset,
  onCropHandlePointerDown,
  onResetView,
  onCanvasDoubleClick,
  onRulerCanvasRef,
  onSelectionOverlayCanvasRef,
}: CanvasAreaProps) {
  // Derive ruler layer props from layers array
  const rulerLayer = layers.find((l) => l.isRuler);

  return (
    <div
      ref={containerRef}
      className="flex-1 relative overflow-hidden canvas-workspace-bg"
      style={{ cursor, touchAction: "none" }}
    >
      {/* Mobile: vertical canvas edge sliders (Flow, Opacity, Size) — only for tools that use them */}
      {isMobile &&
        (activeTool === "brush" ||
          activeTool === "eraser" ||
          activeTool === "smudge" ||
          activeTool === "liquify") && (
          <MobileCanvasSliders
            brushSize={currentBrushSize}
            brushOpacity={color.a}
            brushFlow={brushSettings.flow ?? 1}
            leftHanded={leftHanded}
            activeTool={activeTool}
            liquifySize={liquifySize}
            liquifyStrength={liquifyStrength}
            onBrushSizeChange={onBrushSizeChange}
            onBrushOpacityChange={onBrushOpacityChange}
            onBrushFlowChange={onBrushFlowChange}
            onLiquifySizeChange={onLiquifySizeChange}
            onLiquifyStrengthChange={onLiquifyStrengthChange}
          />
        )}
      {/* Mobile: all canvas corner buttons in one row — offset past the slider on the non-slider side */}
      {/* Slider is 44px wide at offset 6px from edge, so buttons start at 56px from that edge */}
      {isMobile && (
        <div
          style={{
            position: "absolute",
            // paddingTop accounts for safe area on iPad notch/rounded corners
            top: "max(8px, env(safe-area-inset-top, 8px))",
            // On right-handed: slider on left → buttons also on left (offset past slider), layers on right
            // On left-handed: slider on right → buttons on right (offset past slider), layers on left
            ...(leftHanded ? { right: 56 } : { left: 56 }),
            zIndex: 25,
            display: "flex",
            flexDirection: "row",
            gap: 6,
            alignItems: "center",
          }}
        >
          {/* Color panel button */}
          <button
            type="button"
            data-ocid="mobile.color_panel_button"
            onClick={() => {
              onSetShowMobileColorPanel(!showMobileColorPanel);
              onSetShowMobilePresetsPanel(false);
            }}
            style={{
              width: 40,
              height: 40,
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: showMobileColorPanel
                ? "oklch(var(--accent))"
                : "rgba(0,0,0,0.45)",
              backdropFilter: showMobileColorPanel ? undefined : "blur(6px)",
              borderRadius: 8,
              border: showMobileColorPanel
                ? "1px solid oklch(var(--accent))"
                : "1px solid rgba(255,255,255,0.15)",
              color: showMobileColorPanel
                ? "oklch(var(--accent-text))"
                : "rgba(255,255,255,0.85)",
              cursor: "pointer",
            }}
            title="Color Panel"
          >
            <Palette size={18} />
          </button>
          {/* Presets panel button */}
          <button
            type="button"
            data-ocid="mobile.presets_panel_button"
            onClick={() => {
              onSetShowMobilePresetsPanel(!showMobilePresetsPanel);
              onSetShowMobileColorPanel(false);
            }}
            style={{
              width: 40,
              height: 40,
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: showMobilePresetsPanel
                ? "oklch(var(--accent))"
                : "rgba(0,0,0,0.45)",
              backdropFilter: showMobilePresetsPanel ? undefined : "blur(6px)",
              borderRadius: 8,
              border: showMobilePresetsPanel
                ? "1px solid oklch(var(--accent))"
                : "1px solid rgba(255,255,255,0.15)",
              color: showMobilePresetsPanel
                ? "oklch(var(--accent-text))"
                : "rgba(255,255,255,0.85)",
              cursor: "pointer",
            }}
            title="Tool Presets"
          >
            <PresetsIcon size={18} />
          </button>
        </div>
      )}
      {/* Mobile: canvas corner button — Layers (opposite side from slider) */}
      {isMobile && (
        <div
          style={{
            position: "absolute",
            top: "max(8px, env(safe-area-inset-top, 8px))",
            // Layers button on the opposite side from slider/color/presets buttons
            ...(leftHanded ? { left: 8 } : { right: 8 }),
            zIndex: 25,
            display: "flex",
            flexDirection: "row",
            gap: 6,
            alignItems: "center",
          }}
        >
          {/* Layers button */}
          <button
            type="button"
            data-ocid="mobile.layers_button"
            onClick={() => onSetRightSidebarCollapsed((c) => !c)}
            style={{
              width: 40,
              height: 40,
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(0,0,0,0.45)",
              backdropFilter: "blur(6px)",
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.15)",
              color: "rgba(255,255,255,0.85)",
              cursor: "pointer",
            }}
            title="Layers"
          >
            <Layers size={18} />
          </button>
        </div>
      )}
      {/* Mobile: floating color panel overlay (portrait and landscape) */}
      {isMobile && showMobileColorPanel && (
        <>
          {/* Backdrop */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 40,
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerUp={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onSetShowMobileColorPanel(false);
            }}
          />
          {/* Floating panel — anchored below the corner buttons, aligned with slider offset */}
          <div
            data-ocid="mobile.color_panel"
            style={{
              position: "absolute",
              top: "calc(max(8px, env(safe-area-inset-top, 8px)) + 48px)",
              ...(leftHanded ? { right: 56 } : { left: 56 }),
              zIndex: 50,
              background: "oklch(var(--sidebar-left))",
              border: "1px solid oklch(var(--border))",
              borderRadius: 10,
              boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
              width: 240,
              maxHeight: "80dvh",
              overflow: "hidden auto",
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <ColorPickerPanel
              color={color}
              onColorChange={onColorChange}
              recentColors={recentColors}
              onRecentColorClick={onRecentColorClick}
            />
          </div>
        </>
      )}
      {/* Mobile: floating presets panel overlay (portrait and landscape) */}
      {isMobile && showMobilePresetsPanel && (
        <>
          {/* Backdrop */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 40,
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerUp={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onSetShowMobilePresetsPanel(false);
            }}
          />
          {/* Floating panel — anchored below the corner buttons, aligned with slider offset */}
          <div
            data-ocid="mobile.presets_panel"
            style={{
              position: "absolute",
              top: "calc(max(8px, env(safe-area-inset-top, 8px)) + 48px)",
              ...(leftHanded ? { right: 56 } : { left: 56 }),
              zIndex: 50,
              background: "oklch(var(--sidebar-left))",
              border: "1px solid oklch(var(--border))",
              borderRadius: 10,
              boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
              width: 280,
              maxHeight: "85dvh",
              overflow: "hidden auto",
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div className="flex flex-col" style={{ overflowX: "hidden" }}>
              {activeSubpanel === "brush" ||
              activeSubpanel === "smudge" ||
              activeSubpanel === "eraser" ? (
                <ToolPresetsPanel
                  tool={activeSubpanel}
                  availableTips={(() => {
                    const seen = new Set<string>();
                    const tips: {
                      id: string;
                      name: string;
                      tipImageData?: string;
                    }[] = [];
                    for (const toolType of [
                      "brush",
                      "smudge",
                      "eraser",
                    ] as const) {
                      for (const preset of presets[toolType]) {
                        const key =
                          preset.settings.tipImageData ??
                          `__no-tip-${preset.id}`;
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
                  })()}
                  presets={presets[activeSubpanel]}
                  activePresetId={activePresetIds[activeSubpanel] ?? null}
                  currentSettings={brushSettings}
                  onSelectPreset={onSelectPreset}
                  onUpdatePreset={onUpdatePreset}
                  onAddPreset={onAddPreset}
                  onDeletePreset={onDeletePreset}
                  onActivate={onActivatePreset}
                  onClose={onCloseMobilePresetsPanel}
                  onReorderPresets={onReorderPresets}
                  currentSize={currentBrushSize}
                  currentOpacity={color.a}
                  onSaveCurrentToPreset={onSaveCurrentToPreset}
                />
              ) : activeSubpanel === "lasso" ? (
                <LassoPresetsPanel
                  lassoMode={lassoMode}
                  onSelectMode={onSelectLassoMode}
                  onClose={onCloseMobilePresetsPanel}
                  accentColor="var(--accent)"
                  isDarkMode={false}
                  wandTolerance={wandTolerance}
                  wandContiguous={wandContiguous}
                  onWandToleranceChange={onWandToleranceChange}
                  onWandContiguousChange={onWandContiguousChange}
                  wandGrowShrink={wandGrowShrink}
                  onWandGrowShrinkChange={onWandGrowShrinkChange}
                />
              ) : activeSubpanel === "fill" ? (
                <FillPresetsPanel
                  fillMode={fillMode}
                  fillSettings={fillSettings}
                  onSelectMode={onSelectFillMode}
                  onSettingsChange={onFillSettingsChange}
                  onClose={onCloseMobilePresetsPanel}
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
                  fivePtEnableCenter={rulerLayer?.fivePtEnableCenter !== false}
                  onFivePtEnableCenterChange={onFivePtEnableCenterChange}
                  fivePtEnableLR={rulerLayer?.fivePtEnableLR !== false}
                  onFivePtEnableLRChange={onFivePtEnableLRChange}
                  fivePtEnableUD={rulerLayer?.fivePtEnableUD !== false}
                  onFivePtEnableUDChange={onFivePtEnableUDChange}
                  onGridReset={onGridReset}
                />
              ) : (
                <div className="flex items-center justify-center h-16 text-muted-foreground text-xs select-none opacity-40">
                  No presets for this tool
                </div>
              )}
            </div>
          </div>
        </>
      )}
      {/* Transform wrapper with optional horizontal flip */}
      <div
        ref={canvasWrapperRef}
        style={{
          position: "absolute",
          width: canvasWidth,
          height: canvasHeight,
          left: "50%",
          top: "50%",
          marginLeft: -canvasWidth / 2,
          marginTop: -canvasHeight / 2,
          transformOrigin: "center center",
          backgroundImage:
            "linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%)",
          backgroundSize: "16px 16px",
          backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0px",
          backgroundColor: "#fff",
          boxShadow: "0 0 0 1px rgba(0,0,0,0.25), 0 8px 32px rgba(0,0,0,0.4)",
        }}
      >
        <canvas
          ref={displayCanvasRef}
          data-ocid="canvas.canvas_target"
          style={{
            display: "block",
            width: "100%",
            height: "100%",
            touchAction: "none",
            cursor: "inherit",
          }}
          onDoubleClick={onCanvasDoubleClick}
        />
        {/* Selection / Transform overlay canvas */}
        <canvas
          ref={(el) => {
            onSelectionOverlayCanvasRef(el);
            if (
              el &&
              (el.width !== canvasWidthRef.current ||
                el.height !== canvasHeightRef.current)
            ) {
              el.width = canvasWidthRef.current;
              el.height = canvasHeightRef.current;
            }
          }}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            pointerEvents: "none",
          }}
        />
      </div>
      {/*
        Ruler overlay canvas — lives OUTSIDE the canvas wrapper so it is not clipped
        to the canvas rect. Positioned to fill the container so ruler lines can extend
        past canvas boundaries into the surrounding background area.
        drawRulerOverlay in PaintingApp applies the canvas-space → container-space
        transform so canvas-space coordinates still map correctly.
      */}
      <canvas
        ref={(el) => {
          onRulerCanvasRef(el);
          // Initialise pixel dimensions to the container size; drawRulerOverlay
          // keeps these in sync on every frame via the container's clientWidth/Height.
          const container = containerRef.current;
          if (el && container) {
            const cw = container.clientWidth || canvasWidthRef.current;
            const ch = container.clientHeight || canvasHeightRef.current;
            if (el.width !== cw || el.height !== ch) {
              el.width = cw;
              el.height = ch;
              scheduleRulerOverlay();
            }
          }
        }}
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          zIndex: 10,
        }}
      />
      {/* Crop Tool Overlay */}
      {isCropActive &&
        activeTool === "crop" &&
        (() => {
          const vt = viewTransform;
          const flip = isFlipped ? -1 : 1;
          const container = containerRef.current;
          if (!container) return null;
          const cw = container.clientWidth;
          const ch = container.clientHeight;
          // Convert canvas point to screen coords
          const toScreen = (cx: number, cy: number) => {
            const lx = (cx - canvasWidth / 2) * flip;
            const ly = cy - canvasHeight / 2;
            const rad = (vt.rotation * Math.PI) / 180;
            const rx = lx * Math.cos(rad) - ly * Math.sin(rad);
            const ry = lx * Math.sin(rad) + ly * Math.cos(rad);
            return {
              sx: cw / 2 + rx * vt.zoom + vt.panX,
              sy: ch / 2 + ry * vt.zoom + vt.panY,
            };
          };
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          void cropRectVersion; // consume to trigger re-renders
          const { x: rx, y: ry, w: rw, h: rh } = cropRectRef.current;
          const tl = toScreen(rx, ry);
          const tr = toScreen(rx + rw, ry);
          const bl = toScreen(rx, ry + rh);
          const br = toScreen(rx + rw, ry + rh);
          const handles: Record<string, { sx: number; sy: number }> = {
            nw: tl,
            ne: tr,
            sw: bl,
            se: br,
            n: toScreen(rx + rw / 2, ry),
            s: toScreen(rx + rw / 2, ry + rh),
            w: toScreen(rx, ry + rh / 2),
            e: toScreen(rx + rw, ry + rh / 2),
          };
          const HANDLE_SIZE = 12;
          const polyPoints = `${tl.sx},${tl.sy} ${tr.sx},${tr.sy} ${br.sx},${br.sy} ${bl.sx},${bl.sy}`;
          return (
            <div
              style={{
                position: "absolute",
                inset: 0,
                zIndex: 25,
                pointerEvents: "none",
              }}
            >
              <svg
                width={cw}
                height={ch}
                aria-hidden="true"
                style={{
                  position: "absolute",
                  inset: 0,
                  pointerEvents: "none",
                }}
              >
                <defs>
                  <mask id="crop-mask">
                    <rect x={0} y={0} width={cw} height={ch} fill="white" />
                    <polygon points={polyPoints} fill="black" />
                  </mask>
                </defs>
                <rect
                  x={0}
                  y={0}
                  width={cw}
                  height={ch}
                  fill="rgba(0,0,0,0.5)"
                  mask="url(#crop-mask)"
                />
                <polygon
                  points={polyPoints}
                  fill="none"
                  stroke="white"
                  strokeWidth="1.5"
                  strokeDasharray="6 4"
                />
              </svg>
              {Object.entries(handles).map(([handle, pos]) => (
                <div
                  key={handle}
                  data-ocid={`crop.${handle}_handle`}
                  style={{
                    position: "absolute",
                    left: pos.sx - HANDLE_SIZE / 2,
                    top: pos.sy - HANDLE_SIZE / 2,
                    width: HANDLE_SIZE,
                    height: HANDLE_SIZE,
                    background: "white",
                    border: "1.5px solid rgba(0,0,0,0.5)",
                    borderRadius: 2,
                    cursor: `${handle}-resize`,
                    pointerEvents: "auto",
                  }}
                  onPointerDown={(e) =>
                    onCropHandlePointerDown(
                      e,
                      handle as
                        | "nw"
                        | "n"
                        | "ne"
                        | "w"
                        | "e"
                        | "sw"
                        | "s"
                        | "se",
                    )
                  }
                />
              ))}
            </div>
          );
        })()}
      {/* View HUD */}
      <div
        data-ocid="canvas.panel"
        style={{
          position: "absolute",
          bottom: 48,
          left: 12,
          display: "flex",
          alignItems: "center",
          gap: 8,
          background: "rgba(0,0,0,0.55)",
          backdropFilter: "blur(6px)",
          borderRadius: 6,
          padding: "4px 8px",
          fontSize: 11,
          color: "rgba(255,255,255,0.85)",
          fontFamily: "monospace",
          pointerEvents: "auto",
          userSelect: "none",
          zIndex: 10,
        }}
      >
        <span title="Canvas dimensions">
          {canvasWidth}×{canvasHeight}
        </span>
        <span style={{ opacity: 0.4 }}>|</span>
        <span title="Zoom: Ctrl+Space drag or scroll">
          {Math.round(zoom * 100)}%
        </span>
        <span style={{ opacity: 0.4 }}>|</span>
        <span title="Rotation: R + drag">{Math.round(rotation)}°</span>
        {isFlipped && (
          <>
            <span style={{ opacity: 0.4 }}>|</span>
            <span style={{ color: "rgba(255,200,100,0.9)" }}>Flipped</span>
          </>
        )}
        {!isDefaultTransform && (
          <>
            <span style={{ opacity: 0.4 }}>|</span>
            <button
              type="button"
              data-ocid="canvas.reset_button"
              onClick={onResetView}
              title="Reset view (press 0)"
              style={{
                background: "rgba(255,255,255,0.15)",
                border: "none",
                borderRadius: 4,
                color: "rgba(255,255,255,0.9)",
                cursor: "pointer",
                fontSize: 11,
                padding: "1px 6px",
                fontFamily: "monospace",
              }}
            >
              ⌂ Reset
            </button>
          </>
        )}
      </div>
    </div>
  );
}
