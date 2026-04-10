/**
 * paintingRefs.ts
 *
 * Type definitions for the grouped ref objects used in PaintingApp.tsx.
 * This is a structural organization only — no logic lives here.
 * All hooks still receive individual MutableRefObject parameters; the grouping
 * only affects how refs are declared and accessed inside PaintingApp itself.
 */

import type { BrushSettings } from "@/components/BrushSettingsPanel";
import type { Layer } from "@/components/LayersPanel";
import type { LassoMode, Tool } from "@/components/Toolbar";
import type { LayerNode, ViewTransform } from "@/types";
import type { HSVAColor } from "@/utils/colorUtils";
import type { HotkeyAction } from "@/utils/hotkeyConfig";
import type { WebGLBrushContext } from "@/utils/webglBrush";
import type { MutableRefObject } from "react";

// ─── Canvas group ────────────────────────────────────────────────────────────

export interface CanvasRefs {
  displayCanvasRef: MutableRefObject<HTMLCanvasElement | null>;
  layerCanvasesRef: MutableRefObject<Map<string, HTMLCanvasElement>>;
  selectionOverlayCanvasRef: MutableRefObject<HTMLCanvasElement | null>;
  strokeBufferRef: MutableRefObject<HTMLCanvasElement | null>;
  webglBrushRef: MutableRefObject<WebGLBrushContext | null>;
  belowActiveCanvasRef: MutableRefObject<HTMLCanvasElement | null>;
  aboveActiveCanvasRef: MutableRefObject<HTMLCanvasElement | null>;
  snapshotCanvasRef: MutableRefObject<HTMLCanvasElement | null>;
  activePreviewCanvasRef: MutableRefObject<HTMLCanvasElement | null>;
  rulerCanvasRef: MutableRefObject<HTMLCanvasElement | null>;
  containerRef: MutableRefObject<HTMLDivElement | null>;
  canvasWrapperRef: MutableRefObject<HTMLDivElement | null>;
  brushSizeOverlayRef: MutableRefObject<HTMLCanvasElement | null>;
  defaultTipCanvasRef: MutableRefObject<HTMLCanvasElement | null>;
}

// ─── Brush group ─────────────────────────────────────────────────────────────

export interface BrushRefs {
  tipCanvasCacheRef: MutableRefObject<Map<string, HTMLCanvasElement>>;
  colorFillStyleRef: MutableRefObject<string>;
  brushBlendModeRef: MutableRefObject<string>;
  isBrushSizeAdjustingRef: MutableRefObject<boolean>;
  brushSizeAdjustStartXRef: MutableRefObject<number>;
  brushSizeAdjustOriginRef: MutableRefObject<number>;
  brushSizeOverlayStartPosRef: MutableRefObject<{
    x: number;
    y: number;
  } | null>;
}

// ─── Drawing group ───────────────────────────────────────────────────────────

export interface DrawingRefs {
  isDrawingRef: MutableRefObject<boolean>;
  isCommittingRef: MutableRefObject<boolean>;
  lastPosRef: MutableRefObject<{ x: number; y: number } | null>;
  distAccumRef: MutableRefObject<number>;
  dualDistAccumRef: MutableRefObject<number>;
  strokeCanvasCacheKeyRef: MutableRefObject<number>;
  strokeCanvasLastBuiltGenRef: MutableRefObject<number>;
  needsFullCompositeRef: MutableRefObject<boolean>;
  compositeRef: MutableRefObject<() => void>;
  pendingLayerPixelsRef: MutableRefObject<Map<string, ImageData>>;
  layersBeingExtractedRef: MutableRefObject<Set<string>>;
}

// ─── State group ─────────────────────────────────────────────────────────────

export interface StateRefs {
  activeToolRef: MutableRefObject<Tool>;
  activeSubpanelRef: MutableRefObject<Tool | null>;
  colorRef: MutableRefObject<HSVAColor>;
  activeLayerIdRef: MutableRefObject<string>;
  layersRef: MutableRefObject<Layer[]>;
  brushSettingsRef: MutableRefObject<BrushSettings>;
  viewTransformRef: MutableRefObject<ViewTransform>;
  zoomLockedRef: MutableRefObject<boolean>;
  rotateLockedRef: MutableRefObject<boolean>;
  isFlippedRef: MutableRefObject<boolean>;
  panLockedRef: MutableRefObject<boolean>;
  activeLayerAlphaLockRef: MutableRefObject<boolean>;
}

// ─── Selection group ─────────────────────────────────────────────────────────

export interface SelectionRefs {
  lassoModeRef: MutableRefObject<LassoMode>;
  lassoIsDraggingRef: MutableRefObject<boolean>;
  lassoHasPolyPointsRef: MutableRefObject<boolean>;
  lassoStrokeStartRef: MutableRefObject<{ x: number; y: number } | null>;
  lassoLastTapTimeRef: MutableRefObject<number>;
  lassoLastTapPosRef: MutableRefObject<{ x: number; y: number } | null>;
  lassoFreeLastPtRef: MutableRefObject<{ x: number; y: number } | null>;
  marchingAntsOffsetRef: MutableRefObject<number>;
  marchingAntsRafRef: MutableRefObject<number | null>;
  marchingAntsLastDrawRef: MutableRefObject<number>;
  drawAntsRef: MutableRefObject<(() => void) | null>;
  rebuildChainsNowRef: MutableRefObject<(mask: HTMLCanvasElement) => void>;
  layerTreeRef: MutableRefObject<LayerNode[]>;
  selectedLayerIdsRef: MutableRefObject<Set<string>>;
  markLayerBitmapDirtyRef: MutableRefObject<(id: string) => void>;
}

// ─── View-transform input group ──────────────────────────────────────────────

export interface ViewTransformInputRefs {
  spaceDownRef: MutableRefObject<boolean>;
  zoomModeRef: MutableRefObject<boolean>;
  rKeyDownRef: MutableRefObject<boolean>;
  isPanningRef: MutableRefObject<boolean>;
  panStartRef: MutableRefObject<{ x: number; y: number }>;
  panOriginRef: MutableRefObject<{ x: number; y: number }>;
  isRotatingRef: MutableRefObject<boolean>;
  rotOriginRef: MutableRefObject<number>;
  rotAngleOriginRef: MutableRefObject<number>;
  rotCenterRef: MutableRefObject<{ x: number; y: number }>;
  isZoomDraggingRef: MutableRefObject<boolean>;
  zoomDragStartXRef: MutableRefObject<number>;
  zoomDragOriginRef: MutableRefObject<number>;
  zKeyDownRef: MutableRefObject<boolean>;
  zoomDragCursorStartRef: MutableRefObject<{ x: number; y: number }>;
  zoomDragPanOriginRef: MutableRefObject<{ x: number; y: number }>;
  rotDragCursorRef: MutableRefObject<{ x: number; y: number }>;
  rotDragCanvasPointRef: MutableRefObject<{ x: number; y: number }>;
  rotDragPanOriginRef: MutableRefObject<{ x: number; y: number }>;
  altSpaceModeRef: MutableRefObject<boolean>;
}

// ─── Tool group ──────────────────────────────────────────────────────────────

export interface ToolRefs {
  wandToleranceRef: MutableRefObject<number>;
  wandContiguousRef: MutableRefObject<boolean>;
  wandGrowShrinkRef: MutableRefObject<number>;
  eyedropperSampleSourceRef: MutableRefObject<"canvas" | "layer">;
  eyedropperSampleSizeRef: MutableRefObject<1 | 3 | 5>;
  eyedropperIsPressedRef: MutableRefObject<boolean>;
  eyedropperHoverColorRef: MutableRefObject<{
    r: number;
    g: number;
    b: number;
  }>;
  altEyedropperActiveRef: MutableRefObject<boolean>;
  prevToolRef: MutableRefObject<Tool>;
}

// ─── UI group ────────────────────────────────────────────────────────────────

export interface UIRefs {
  currentPointerTypeRef: MutableRefObject<string>;
  penDownCountRef: MutableRefObject<number>;
  pointerScreenPosRef: MutableRefObject<{ x: number; y: number }>;
  lastPaintLayerIdRef: MutableRefObject<string>;
  lastPaintToolRef2: MutableRefObject<Tool>;
  cancelInProgressSelectionRef: MutableRefObject<() => void>;
  commitInProgressLassoRef: MutableRefObject<() => void>;
  updateNavigatorCanvasRef: MutableRefObject<() => void>;
  canvasWidthRef: MutableRefObject<number>;
  canvasHeightRef: MutableRefObject<number>;
  splashDimsAppliedRef: MutableRefObject<boolean>;
  _isIPadRef: MutableRefObject<boolean>;
  rotateHotkeyBehaviorRef: MutableRefObject<"hold" | "switch">;
  wheelCommitTimerRef: MutableRefObject<number | null>;
  opacityFirstDigitRef: MutableRefObject<number | null>;
  opacityTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  thumbDebounceRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  thumbDebounceLayerIdRef: MutableRefObject<string | null>;
  thumbDebounceLcRef: MutableRefObject<HTMLCanvasElement | null>;
  prewarmRafRef: MutableRefObject<number | null>;
  hotkeysRef: MutableRefObject<Record<string, HotkeyAction>>;
  shiftHeldRef: MutableRefObject<boolean>;
  rulerEditHistoryDepthRef: MutableRefObject<number>;
  applyTransformToDOMRef: MutableRefObject<(vt: ViewTransform) => void>;
}
