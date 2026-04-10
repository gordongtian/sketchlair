/**
 * usePaintingCanvasEvents — extracts all canvas/keyboard/wheel/touch event
 * handler SETUP out of PaintingApp.tsx into a dedicated hook.
 *
 * APPROACH A (safe): all refs are passed as parameters. Callbacks that may
 * change between renders are bundled into a single stable `callbacksRef` so
 * the event-listener useEffects can keep [] deps without going stale.
 *
 * OWNERSHIP: All refs are still OWNED by PaintingApp. This hook only reads /
 * writes their `.current` values — it never replaces the ref object itself.
 *
 * What lives here:
 *  1. Global hotkey useEffect   (keydown + keyup + blur)
 *  2. Space/rotate useEffect    (keydown + keyup)
 *  3. Wheel-zoom useEffect
 *  4. Multi-touch useEffect     (touchstart + touchmove + touchend)
 *  5. Canvas pointer-attach useEffect  (pointerenter/down/move/up/leave)
 *  6. handlePointerDown, handlePointerMove, handlePointerUp implementations
 */

import type { HSVAColor } from "@/utils/colorUtils";
import { hsvToRgb, rgbToHex, rgbToHsv } from "@/utils/colorUtils";
import { getLuminance as _getLum } from "@/utils/colorUtils";
import {
  type HotkeyAction,
  loadHotkeys,
  matchesBinding,
} from "@/utils/hotkeyConfig";
import type { Preset } from "@/utils/toolPresets";
import { useCallback, useEffect } from "react";
import type React from "react";
import { toast } from "sonner";
import type { BrushSettings } from "../components/BrushSettingsPanel";
import type { FillMode, FillSettings } from "../components/FillPresetsPanel";
import type { Layer } from "../components/LayersPanel";
import type { RulerPresetType } from "../components/RulerPresetsPanel";
import type { LassoMode, Tool } from "../components/Toolbar";
import type {
  SelectionBoundaryPath,
  XfState,
} from "../context/PaintingContext";
import type { SelectionGeom, SelectionSnapshot } from "../selectionTypes";
import type { LayerNode } from "../types";
import type { ViewTransform } from "../types";
import { getEffectivelySelectedLayers } from "../utils/layerTree";
import {
  bfsFloodFill,
  computeMaskBounds,
  growShrinkMask,
} from "../utils/selectionUtils";
import type { WebGLBrushContext } from "../utils/webglBrush";
import { markCanvasDirty, markLayerBitmapDirty } from "./useCompositing";
import type { UndoEntry } from "./useLayerSystem";
import {
  getLiquifySnapshot,
  initLiquifyField,
  renderLiquifyFromSnapshot,
  setLiquifySnapshot,
  updateLiquifyDisplacementField,
} from "./useLiquifySystem";
import {
  PRESSURE_SMOOTHING,
  applyColorJitter,
  evalPressureCurve,
  resetSmudgeInitialized,
} from "./useStrokeEngine";

// ─── Helper types (local, not exported) ──────────────────────────────────────
type Point = { x: number; y: number };
type BrushSizes = { brush: number; eraser: number };
type StrokePoint = {
  x: number;
  y: number;
  size: number;
  opacity: number;
  capAlpha?: number;
};

// ─── Ruler handlers bundle ────────────────────────────────────────────────────
// All ruler sub-hook methods used by the pointer handlers, bundled into a
// single object added to callbacksRef so the hook can call them without taking
// the four ruler hook objects as direct params.
export interface RulerHandlers {
  // Line ruler
  handleLineRulerPointerDown: (
    pos: Point,
    rulerLayer: Layer,
    handleRadius: number,
  ) => boolean;
  handleLineRulerPointerMove: (pos: Point, rulerLayer: Layer) => void;
  handleLineRulerPointerUp: (rulerLayer: Layer) => void;
  isLineRulerDragging: () => boolean;
  // 1pt/2pt perspective
  handle1ptRulerPointerDown: (
    pos: Point,
    rulerLayer: Layer,
    handleRadius: number,
  ) => boolean;
  handle2ptRulerPointerDown: (
    pos: Point,
    rulerLayer: Layer,
    handleRadius: number,
  ) => boolean;
  handle1pt2ptRulerPointerMove: (pos: Point, rulerLayer: Layer) => void;
  handle1pt2ptRulerPointerUp: (rulerLayer: Layer) => void;
  is1pt2ptRulerDragging: () => boolean;
  // 3pt/5pt perspective
  handle3ptRulerPointerDown: (
    pos: Point,
    rulerLayer: Layer,
    handleRadius: number,
    shiftHeld: boolean,
  ) => boolean;
  handle5ptRulerPointerDown: (
    pos: Point,
    rulerLayer: Layer,
    handleRadius: number,
    shiftHeld: boolean,
  ) => boolean;
  handle3ptExclusivePointerMove: (pos: Point, rulerLayer: Layer) => void;
  handle5ptRulerPointerMove: (pos: Point, rulerLayer: Layer) => void;
  handle3pt5ptRulerPointerUp: (rulerLayer: Layer) => void;
  is3ptExclusiveDragging: () => boolean;
  is5ptDragging: () => boolean;
  // Ellipse/grid
  handleOvalRulerPointerDown: (
    pos: Point,
    rulerLayer: Layer,
    handleRadius: number,
  ) => boolean;
  handleGridRulerPointerDown: (
    pos: Point,
    rulerLayer: Layer,
    handleRadius: number,
  ) => boolean;
  handleOvalRulerPointerMove: (pos: Point, rulerLayer: Layer) => void;
  handleGridRulerPointerMove: (pos: Point, rulerLayer: Layer) => void;
  handleEllipseGridRulerPointerUp: (rulerLayer: Layer) => void;
  isOvalDragging: () => boolean;
  isGridDragging: () => boolean;
}

// ─── Helper functions ─────────────────────────────────────────────────────────
function _getCanvasPosTransformed(
  clientX: number,
  clientY: number,
  container: HTMLElement,
  canvas: HTMLCanvasElement,
  transform: ViewTransform,
  isFlipped = false,
) {
  const cr = container.getBoundingClientRect();
  const centerX = cr.left + cr.width / 2;
  const centerY = cr.top + cr.height / 2;
  const ox = clientX - centerX - transform.panX;
  const oy = clientY - centerY - transform.panY;
  const sx = ox / transform.zoom;
  const sy = oy / transform.zoom;
  const px = isFlipped ? -sx : sx;
  const rad = (-transform.rotation * Math.PI) / 180;
  const rx = px * Math.cos(rad) - sy * Math.sin(rad);
  const ry = px * Math.sin(rad) + sy * Math.cos(rad);
  return {
    x: rx + canvas.width / 2,
    y: ry + canvas.height / 2,
  };
}

function _getCanvasPosWithRect(
  clientX: number,
  clientY: number,
  cr: DOMRect,
  canvas: HTMLCanvasElement,
  transform: ViewTransform,
  isFlipped = false,
) {
  const centerX = cr.left + cr.width / 2;
  const centerY = cr.top + cr.height / 2;
  const ox = clientX - centerX - transform.panX;
  const oy = clientY - centerY - transform.panY;
  const sx = ox / transform.zoom;
  const sy = oy / transform.zoom;
  const px = isFlipped ? -sx : sx;
  const rad = (-transform.rotation * Math.PI) / 180;
  const rx = px * Math.cos(rad) - sy * Math.sin(rad);
  const ry = px * Math.sin(rad) + sy * Math.cos(rad);
  return {
    x: rx + canvas.width / 2,
    y: ry + canvas.height / 2,
  };
}

// ─── Callbacks interface ─────────────────────────────────────────────────────
// All functions that may change between renders. PaintingApp updates
// callbacksRef.current on every render so useEffect closures are never stale.

export interface PaintingCanvasEventsCallbacks {
  // Undo / redo
  handleUndo: () => void;
  handleRedo: () => void;
  // Paste as floating selection (delegates to PaintingApp where all refs live)
  pasteFloat: (img: HTMLImageElement) => void;
  // File save
  handleSaveFile: () => Promise<void>;
  handleSilentSave: () => Promise<void>;
  // Layer ops
  handleAddLayer: () => void;
  handleDeleteLayer: (id: string) => void;
  handleToggleVisible: (id: string) => void;
  handleToggleAlphaLock: (id: string) => void;
  handleMergeLayersRef: React.MutableRefObject<() => void>;
  handleToggleClippingMaskRef: React.MutableRefObject<() => void>;
  handleCreateGroup: () => void;
  handleClear: () => void;
  // Selection grow/shrink
  handleGrowShrink: (direction: 1 | -1) => void;
  // Ruler
  collapseRulerHistory: () => void;
  scheduleRulerOverlay: () => void;
  // Canvas
  composite: (dirtyRegion?: {
    x: number;
    y: number;
    w: number;
    h: number;
  }) => void;
  scheduleComposite: () => void;
  // Cursor
  drawBrushTipOverlay: (canvas: HTMLCanvasElement, screenSize: number) => void;
  sampleEyedropperColor: (
    x: number,
    y: number,
  ) => { r: number; g: number; b: number };
  updateEyedropperCursorRef: React.MutableRefObject<() => void>;
  // State setters
  setActiveTool: React.Dispatch<React.SetStateAction<Tool>>;
  setActiveSubpanel: React.Dispatch<React.SetStateAction<Tool | null>>;
  setActiveLayerId: React.Dispatch<React.SetStateAction<string>>;
  setLayers: React.Dispatch<React.SetStateAction<Layer[]>>;
  setViewTransform: React.Dispatch<React.SetStateAction<ViewTransform>>;
  setIsFlipped: React.Dispatch<React.SetStateAction<boolean>>;
  setBrushSizes: React.Dispatch<React.SetStateAction<BrushSizes>>;
  setBrushSettings: React.Dispatch<React.SetStateAction<BrushSettings>>;
  setBrushBlendMode: React.Dispatch<React.SetStateAction<string>>;
  setColor: React.Dispatch<React.SetStateAction<HSVAColor>>;
  setLiquifySize: React.Dispatch<React.SetStateAction<number>>;
  setLiquifyStrength: React.Dispatch<React.SetStateAction<number>>;
  setZoomLocked: React.Dispatch<React.SetStateAction<boolean>>;
  setRotateLocked: React.Dispatch<React.SetStateAction<boolean>>;
  setPanLocked: React.Dispatch<React.SetStateAction<boolean>>;
  setSelectionActive: React.Dispatch<React.SetStateAction<boolean>>;
  setRecentColors: React.Dispatch<React.SetStateAction<string[]>>;
  setCropRectVersion: React.Dispatch<React.SetStateAction<number>>;
  // Tool change — full handleToolChange from PaintingApp (includes rotate cleanup)
  handleToolChange: (tool: Tool) => void;
  // Compositing / stroke helpers
  compositeWithStrokePreview: (
    opacity: number,
    tool: Tool,
    dirty?: { minX: number; minY: number; maxX: number; maxY: number },
  ) => void;
  buildStrokeCanvases: (layerId: string) => void;
  flushStrokeBuffer: (
    lc: HTMLCanvasElement,
    opacity: number,
    tool: Tool,
  ) => void;
  strokeCommitDirty: () =>
    | { x: number; y: number; w: number; h: number }
    | undefined;
  getActiveSize: () => number;
  applyTransformToDOM: (vt: ViewTransform) => void;
  // History
  pushHistory: (entry: UndoEntry) => void;
  // Selection
  snapshotSelection: () => SelectionSnapshot;
  clearSelection: () => void;
  rasterizeSelectionMask: () => void;
  // Stroke engine functions
  stampWebGL: (
    x: number,
    y: number,
    size: number,
    opacity: number,
    settings: BrushSettings,
    angle: number,
    fillStyle: string,
    dualFillStyle?: string,
    capAlpha?: number,
  ) => void;
  stampDot: (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    settings: BrushSettings,
    strokeAngle: number,
  ) => void;
  renderBrushSegmentAlongPoints: (
    ctx: CanvasRenderingContext2D,
    pts: StrokePoint[],
    startSize: number,
    endSize: number,
    startOpacity: number,
    endOpacity: number,
    settings: BrushSettings,
    tool: Tool,
    useWebGL: boolean,
    capAlpha?: number,
  ) => void;
  renderSmearAlongPoints: (
    lc: HTMLCanvasElement,
    pts: { x: number; y: number }[],
    size: number,
    settings: BrushSettings,
    strength: number,
  ) => void;
  initSmudgeBuffer: (lc: HTMLCanvasElement, pos: Point, size: number) => void;
  getSnapPosition: (pos: Point, origin: Point) => Point;
  // Fill system
  handleFillPointerDown: (
    pos: Point,
    layerId: string,
    lc: HTMLCanvasElement,
  ) => void;
  handleFillPointerMove: (
    e: PointerEvent,
    getPos: (cx: number, cy: number) => Point,
  ) => boolean;
  handleFillPointerUp: () => void;
  // Ruler handlers bundle
  rulerHandlers: RulerHandlers;
}

// ─── Params interface ─────────────────────────────────────────────────────────

export interface PaintingCanvasEventsParams {
  /** Stable ref to all callbacks — updated by PaintingApp each render */
  callbacksRef: React.MutableRefObject<PaintingCanvasEventsCallbacks>;

  // ---- DOM refs ----
  displayCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  softwareCursorRef: React.MutableRefObject<HTMLCanvasElement | null>;
  brushSizeOverlayRef: React.MutableRefObject<HTMLCanvasElement | null>;
  fileLoadInputRef: React.RefObject<HTMLInputElement | null>;

  // ---- Canvas data refs ----
  layerCanvasesRef: React.MutableRefObject<Map<string, HTMLCanvasElement>>;
  activeLayerIdRef: React.MutableRefObject<string>;
  layersRef: React.MutableRefObject<Layer[]>;
  canvasWidthRef: React.MutableRefObject<number>;
  canvasHeightRef: React.MutableRefObject<number>;

  // ---- Drawing state refs ----
  isDrawingRef: React.MutableRefObject<boolean>;
  isCommittingRef: React.MutableRefObject<boolean>;
  lastPosRef: React.MutableRefObject<Point | null>;
  strokeStartSnapshotRef: React.MutableRefObject<{
    pixels: ImageData;
    x: number;
    y: number;
  } | null>;
  strokeSnapLayerRef: React.MutableRefObject<HTMLCanvasElement | null>;
  tailRafIdRef: React.MutableRefObject<number | null>;

  // ---- Selection refs ----
  selectionActiveRef: React.MutableRefObject<boolean>;
  selectionMaskRef: React.MutableRefObject<HTMLCanvasElement | null>;
  selectionGeometryRef: React.MutableRefObject<SelectionGeom>;
  selectionBoundaryPathRef: React.MutableRefObject<SelectionBoundaryPath>;
  selectionShapesRef: React.MutableRefObject<NonNullable<SelectionGeom>[]>;
  selectionActionsRef: React.MutableRefObject<{
    clearSelection: () => void;
    deleteSelection: () => void;
    cutOrCopyToLayer: (cut: boolean) => void;
    commitFloat: (opts?: { keepSelection?: boolean }) => void;
    revertTransform: () => void;
    rasterizeSelectionMask: () => void;
    extractFloat: (fromSel: boolean) => void;
  }>;
  isDrawingSelectionRef: React.MutableRefObject<boolean>;
  selectionPolyClosingRef: React.MutableRefObject<boolean>;
  cancelInProgressSelectionRef: React.MutableRefObject<() => void>;
  commitInProgressLassoRef: React.MutableRefObject<() => void>;
  rebuildChainsNowRef: React.MutableRefObject<
    (mask: HTMLCanvasElement) => void
  >;

  // ---- Transform refs ----
  transformActiveRef: React.MutableRefObject<boolean>;
  isDraggingFloatRef: React.MutableRefObject<boolean>;
  moveFloatOriginBoundsRef: React.MutableRefObject<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>;
  xfStateRef: React.MutableRefObject<XfState | null>;
  transformHandleRef: React.MutableRefObject<string | null>;
  transformPreSnapshotRef: React.MutableRefObject<ImageData | null>;
  transformPreCommitSnapshotRef: React.MutableRefObject<ImageData | null>;
  transformOrigFloatCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  lastToolBeforeTransformRef: React.MutableRefObject<Tool | null>;

  // ---- View refs ----
  viewTransformRef: React.MutableRefObject<ViewTransform>;
  isFlippedRef: React.MutableRefObject<boolean>;
  spaceDownRef: React.MutableRefObject<boolean>;
  zoomModeRef: React.MutableRefObject<boolean>;
  rKeyDownRef: React.MutableRefObject<boolean>;
  zKeyDownRef: React.MutableRefObject<boolean>;
  isPanningRef: React.MutableRefObject<boolean>;
  panStartRef: React.MutableRefObject<Point>;
  panOriginRef: React.MutableRefObject<Point>;
  isRotatingRef: React.MutableRefObject<boolean>;
  rotOriginRef: React.MutableRefObject<number>;
  rotAngleOriginRef: React.MutableRefObject<number>;
  rotCenterRef: React.MutableRefObject<Point>;
  isZoomDraggingRef: React.MutableRefObject<boolean>;
  zoomDragStartXRef: React.MutableRefObject<number>;
  zoomDragOriginRef: React.MutableRefObject<number>;
  zoomDragCursorStartRef: React.MutableRefObject<Point>;
  zoomDragPanOriginRef: React.MutableRefObject<Point>;
  rotDragCursorRef: React.MutableRefObject<Point>;
  rotDragCanvasPointRef: React.MutableRefObject<Point>;
  rotDragPanOriginRef: React.MutableRefObject<Point>;
  applyTransformToDOMRef: React.MutableRefObject<(vt: ViewTransform) => void>;
  wheelCommitTimerRef: React.MutableRefObject<number | null>;
  zoomLockedRef: React.MutableRefObject<boolean>;
  rotateLockedRef: React.MutableRefObject<boolean>;
  panLockedRef: React.MutableRefObject<boolean>;

  // ---- Alt / mode refs ----
  altEyedropperActiveRef: React.MutableRefObject<boolean>;
  altSpaceModeRef: React.MutableRefObject<boolean>;
  prevToolRef: React.MutableRefObject<Tool>;
  shiftHeldRef: React.MutableRefObject<boolean>;
  isBrushSizeAdjustingRef: React.MutableRefObject<boolean>;
  brushSizeAdjustStartXRef: React.MutableRefObject<number>;
  brushSizeAdjustOriginRef: React.MutableRefObject<number>;
  brushSizeOverlayStartPosRef: React.MutableRefObject<Point | null>;
  penDownCountRef: React.MutableRefObject<number>;
  currentPointerTypeRef: React.MutableRefObject<string>;
  pointerScreenPosRef: React.MutableRefObject<Point>;
  eyedropperIsPressedRef: React.MutableRefObject<boolean>;
  updateBrushCursorRef: React.MutableRefObject<() => void>;

  // ---- Tool refs ----
  activeToolRef: React.MutableRefObject<Tool>;
  hotkeysRef: React.MutableRefObject<Record<string, HotkeyAction>>;
  brushSizesRef: React.MutableRefObject<BrushSizes>;
  toolSizesRef: React.MutableRefObject<Record<string, number>>;
  toolOpacitiesRef: React.MutableRefObject<Record<string, number>>;
  liquifySizeRef: React.MutableRefObject<number>;
  liquifyStrengthRef: React.MutableRefObject<number>;
  lastPaintLayerIdRef: React.MutableRefObject<string>;
  lastPaintToolRef2: React.MutableRefObject<Tool>;
  opacityFirstDigitRef: React.MutableRefObject<number | null>;
  opacityTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  isIPadRef: React.MutableRefObject<boolean>;
  brushBlendModeRef: React.MutableRefObject<string>;
  prevBrushBlendModeRef: React.MutableRefObject<string>;

  // ---- Crop refs ----
  isCropActiveRef: React.MutableRefObject<boolean>;
  cropRectRef: React.MutableRefObject<{
    x: number;
    y: number;
    w: number;
    h: number;
  }>;
  cropPrevViewRef: React.MutableRefObject<ViewTransform | null>;
  cropPrevToolRef: React.MutableRefObject<Tool>;

  // ---- Ruler family refs ----
  lastSingle5ptFamilyRef: React.MutableRefObject<"central" | "lr" | "ud">;
  lastSingle2ptFamilyRef: React.MutableRefObject<"vp1" | "vp2">;
  lastSingle3ptFamilyRef: React.MutableRefObject<"vp1" | "vp2" | "vp3">;

  // ---- Unused here but part of the structural param list ----
  undoStackRef: React.MutableRefObject<UndoEntry[]>;
  redoStackRef: React.MutableRefObject<UndoEntry[]>;
  presetsRef: React.MutableRefObject<Record<string, Preset[]>>;
  activeRulerPresetTypeRef: React.MutableRefObject<RulerPresetType>;
  fillModeRef: React.MutableRefObject<FillMode>;
  fillSettingsRef: React.MutableRefObject<FillSettings>;

  // ---- Pointer handler: additional refs needed by handlePointerDown/Move/Up ----

  // Lasso / selection drawing
  lassoModeRef: React.MutableRefObject<LassoMode>;
  lassoIsDraggingRef: React.MutableRefObject<boolean>;
  lassoHasPolyPointsRef: React.MutableRefObject<boolean>;
  lassoStrokeStartRef: React.MutableRefObject<Point | null>;
  lassoLastTapTimeRef: React.MutableRefObject<number>;
  lassoLastTapPosRef: React.MutableRefObject<Point | null>;
  lassoFreeLastPtRef: React.MutableRefObject<Point | null>;
  selectionDraftBoundsRef: React.MutableRefObject<{
    sx: number;
    sy: number;
    ex: number;
    ey: number;
  } | null>;
  selectionDraftPointsRef: React.MutableRefObject<Point[]>;
  selectionDraftCursorRef: React.MutableRefObject<Point | null>;
  selectionBeforeRef: React.MutableRefObject<SelectionSnapshot | null>;
  marchingAntsRafRef: React.MutableRefObject<number | null>;
  drawAntsRef: React.MutableRefObject<(() => void) | null>;
  wandToleranceRef: React.MutableRefObject<number>;
  wandContiguousRef: React.MutableRefObject<boolean>;
  wandGrowShrinkRef: React.MutableRefObject<number>;

  // Transform / float
  moveFloatCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  floatDragStartRef: React.MutableRefObject<{
    px: number;
    py: number;
    fx: number;
    fy: number;
    origBounds?: { x: number; y: number; w: number; h: number };
    initRotation?: number;
  } | null>;
  transformActionsRef: React.MutableRefObject<{
    hitTestTransformHandle: (x: number, y: number) => string | null;
    extractFloat: (fromSel: boolean) => void;
    commitFloat: (opts?: { keepSelection?: boolean }) => void;
    revertTransform: () => void;
  }>;

  // Fill system
  isGradientDraggingRef: React.MutableRefObject<boolean>;
  isLassoFillDrawingRef: React.MutableRefObject<boolean>;

  // Crop
  cropDragRef: React.MutableRefObject<{
    handle: string;
    startScreenX: number;
    startScreenY: number;
    startRect: { x: number; y: number; w: number; h: number };
  } | null>;

  // Stroke engine refs
  strokeSnapshotPendingRef: React.MutableRefObject<boolean>;
  strokeDirtyRectRef: React.MutableRefObject<{
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  } | null>;
  strokeStampsPlacedRef: React.MutableRefObject<number>;
  strokeSnapOriginRef: React.MutableRefObject<Point | null>;
  strokeSnapDirRef: React.MutableRefObject<{ cos: number; sin: number } | null>;
  strokeHvAxisRef: React.MutableRefObject<"h" | "v" | null>;
  strokeHvPivotRef: React.MutableRefObject<Point | null>;
  gridSnapLineRef: React.MutableRefObject<{
    ax: number;
    ay: number;
    bx: number;
    by: number;
  } | null>;
  strokeWarmRawDistRef: React.MutableRefObject<number>;
  smoothedPressureRef: React.MutableRefObject<number>;
  prevPrimaryPressureRef: React.MutableRefObject<number>;
  rawStylusPosRef: React.MutableRefObject<
    (Point & { size: number; opacity: number; capAlpha?: number }) | null
  >;
  stabBrushPosRef: React.MutableRefObject<
    (Point & { size: number; opacity: number; capAlpha?: number }) | null
  >;
  smoothBufferRef: React.MutableRefObject<
    (Point & { size: number; opacity: number; capAlpha?: number })[]
  >;
  elasticPosRef: React.MutableRefObject<Point | null>;
  elasticVelRef: React.MutableRefObject<{ x: number; y: number }>;
  elasticRawPrevRef: React.MutableRefObject<Point | null>;
  lastCompositeOpacityRef: React.MutableRefObject<number>;
  strokeCommitOpacityRef: React.MutableRefObject<number>;
  flushDisplayCapRef: React.MutableRefObject<number>;
  strokePreviewRafRef: React.MutableRefObject<number | null>;
  strokePreviewPendingWorkRef: React.MutableRefObject<boolean>;
  universalPressureCurveRef: React.MutableRefObject<number[]>;
  brushSettingsRef: React.MutableRefObject<BrushSettings>;
  brushOpacityRef: React.MutableRefObject<number>;
  colorRef: React.MutableRefObject<HSVAColor>;
  colorFillStyleRef: React.MutableRefObject<string>;
  webglBrushRef: React.MutableRefObject<WebGLBrushContext | null>;
  strokeBufferRef: React.MutableRefObject<HTMLCanvasElement | null>;
  tailDoCommitRef: React.MutableRefObject<(() => void) | null>;
  smearRafRef: React.MutableRefObject<number | null>;
  smearDirtyRef: React.MutableRefObject<boolean>;
  distAccumRef: React.MutableRefObject<number>;

  // Layer tree (for multi-select/group handling)
  layerTreeRef: React.MutableRefObject<LayerNode[]>;
  selectedLayerIdsRef: React.MutableRefObject<Set<string>>;

  // Liquify refs
  liquifyBeforeSnapshotRef: React.MutableRefObject<ImageData | null>;
  liquifyMultiBeforeSnapshotsRef: React.MutableRefObject<
    Map<string, ImageData>
  >;
  liquifyHoldIntervalRef: React.MutableRefObject<ReturnType<
    typeof setInterval
  > | null>;
  liquifyScopeRef: React.MutableRefObject<string>;

  // Thumbnail debounce
  thumbDebounceRef: React.MutableRefObject<ReturnType<
    typeof setTimeout
  > | null>;
  thumbDebounceLcRef: React.MutableRefObject<HTMLCanvasElement | null>;
  thumbDebounceLayerIdRef: React.MutableRefObject<string | null>;

  // Compositing
  compositeWithStrokePreviewRef: React.MutableRefObject<
    (
      opacity: number,
      tool: Tool,
      dirty?: { minX: number; minY: number; maxX: number; maxY: number },
    ) => void
  >;

  // Eyedropper
  eyedropperHoverColorRef: React.MutableRefObject<{
    r: number;
    g: number;
    b: number;
  }>;

  // Cursor building guard
  cursorBuildingRef: React.MutableRefObject<boolean>;

  // Ruler edit history depth (for ruler pointer down)
  rulerEditHistoryDepthRef: React.MutableRefObject<number>;
}

// ─── The hook ─────────────────────────────────────────────────────────────────

export function usePaintingCanvasEvents(p: PaintingCanvasEventsParams) {
  // Destructure only the refs that are directly referenced by name
  // in the keyboard/wheel/touch useEffect bodies below.
  const {
    callbacksRef,
    displayCanvasRef,
    containerRef,
    softwareCursorRef,
    viewTransformRef,
    isFlippedRef,
    spaceDownRef,
    zoomModeRef,
    rKeyDownRef,
    zKeyDownRef,
    isPanningRef,
    isZoomDraggingRef,
    applyTransformToDOMRef,
    wheelCommitTimerRef,
    rotateLockedRef,
    altEyedropperActiveRef,
    altSpaceModeRef,
    prevToolRef,
    shiftHeldRef,
    isBrushSizeAdjustingRef,
    penDownCountRef,
    updateBrushCursorRef,
    activeToolRef,
    hotkeysRef,
    isDrawingRef,
    isCommittingRef,
    transformActiveRef,
    isDraggingFloatRef,
    selectionActiveRef,
    isDrawingSelectionRef,
    cancelInProgressSelectionRef,
    commitInProgressLassoRef,
    liquifySizeRef,
    liquifyStrengthRef,
    isCropActiveRef,
    cropRectRef,
    cropPrevToolRef,
    cropPrevViewRef,
  } = p;

  // ── 1. Global hotkey handler ─────────────────────────────────────────────
  // biome-ignore lint/correctness/useExhaustiveDependencies: all mutable state accessed via stable refs / callbacksRef
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      const cb = callbacksRef.current;
      const matchAct = (action: string) => {
        const hk = hotkeysRef.current[action];
        if (!hk) return false;
        return matchesBinding(e, hk.primary) || matchesBinding(e, hk.secondary);
      };

      // Alt key → temporary eyedropper
      if (
        e.key === "Alt" &&
        !altEyedropperActiveRef.current &&
        !spaceDownRef.current
      ) {
        e.preventDefault();
        const currentTool = activeToolRef.current;
        if (
          shiftHeldRef.current &&
          (currentTool === "brush" || currentTool === "eraser")
        ) {
          altSpaceModeRef.current = true;
          updateBrushCursorRef.current();
          return;
        }
        if (currentTool !== "eyedropper") {
          prevToolRef.current = currentTool;
          altEyedropperActiveRef.current = true;
          cb.setActiveTool("eyedropper");
        }
        return;
      }

      if (
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "z"
      ) {
        e.preventDefault();
        if (isDrawingRef.current) return;
        cb.handleRedo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (e.shiftKey) {
          void cb.handleSaveFile();
        } else {
          void cb.handleSilentSave();
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "o") {
        e.preventDefault();
        p.fileLoadInputRef.current?.click();
        return;
      }
      if (
        matchesBinding(e, hotkeysRef.current.undo?.primary) ||
        matchesBinding(e, hotkeysRef.current.undo?.secondary)
      ) {
        e.preventDefault();
        if (isDrawingRef.current || isCommittingRef.current) return;
        if (transformActiveRef.current) return; // toast handled in PaintingApp
        cb.handleUndo();
        return;
      }
      if (
        matchesBinding(e, hotkeysRef.current.redo?.primary) ||
        matchesBinding(e, hotkeysRef.current.redo?.secondary)
      ) {
        e.preventDefault();
        if (isDrawingRef.current || isCommittingRef.current) return;
        if (transformActiveRef.current) return;
        cb.handleRedo();
        return;
      }
      // Ctrl+V: paste clipboard image as floating selection
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") {
        e.preventDefault();
        (async () => {
          try {
            const items = await navigator.clipboard.read();
            for (const item of items) {
              const imgType = item.types.find((t) => t.startsWith("image/"));
              if (!imgType) continue;
              const blob = await item.getType(imgType);
              const url = URL.createObjectURL(blob);
              const img = new Image();
              img.onload = () => {
                URL.revokeObjectURL(url);
                // Delegate to PaintingApp — it has access to all float refs.
                // The layer is NOT cleared here; the pasted image floats OVER
                // the existing content and is composited onto the layer only on commit.
                callbacksRef.current.pasteFloat(img);
              };
              img.src = url;
              break;
            }
          } catch {
            // Clipboard access denied or no image — silently ignore
          }
        })();
        return;
      }
      // Merge layers
      if (
        matchesBinding(e, hotkeysRef.current.mergeDown?.primary) ||
        matchesBinding(e, hotkeysRef.current.mergeDown?.secondary)
      ) {
        e.preventDefault();
        cb.handleMergeLayersRef.current();
        return;
      }
      // Create layer group (default: Shift+G, user-remappable)
      if (
        matchesBinding(e, hotkeysRef.current.createLayerGroup?.primary) ||
        matchesBinding(e, hotkeysRef.current.createLayerGroup?.secondary)
      ) {
        e.preventDefault();
        cb.handleCreateGroup();
        return;
      }
      // Shift+Tab: cycle ruler mode
      if (e.shiftKey && !e.ctrlKey && !e.metaKey && e.key === "Tab") {
        e.preventDefault();
        const activeRuler = p.layersRef.current.find((l) => l.isRuler);
        if (activeRuler) {
          const rtype = activeRuler.rulerPresetType ?? "perspective-1pt";
          if (rtype === "oval") {
            const next =
              (activeRuler.ovalSnapMode ?? "ellipse") === "ellipse"
                ? ("parallel-minor" as const)
                : ("ellipse" as const);
            const fn = (l: Layer) =>
              l.isRuler ? { ...l, ovalSnapMode: next } : l;
            cb.setLayers((prev) => prev.map(fn) as Layer[]);
            p.layersRef.current = p.layersRef.current.map(fn) as Layer[];
          } else if (rtype === "grid") {
            const next =
              (activeRuler.gridMode ?? "subdivide") === "subdivide"
                ? ("extrude" as const)
                : ("subdivide" as const);
            const fn = (l: Layer) => (l.isRuler ? { ...l, gridMode: next } : l);
            cb.setLayers((prev) => prev.map(fn) as Layer[]);
            p.layersRef.current = p.layersRef.current.map(fn) as Layer[];
            cb.scheduleRulerOverlay();
          } else if (rtype === "perspective-5pt") {
            const c5 = activeRuler.fivePtEnableCenter !== false;
            const lr5 = activeRuler.fivePtEnableLR !== false;
            const ud5 = activeRuler.fivePtEnableUD !== false;
            const activeCount5 = [c5, lr5, ud5].filter(Boolean).length;
            let nextC5 = false;
            let nextLR5 = false;
            let nextUD5 = false;
            if (activeCount5 > 1) {
              const last5 = p.lastSingle5ptFamilyRef.current;
              nextC5 = last5 === "central";
              nextLR5 = last5 === "lr";
              nextUD5 = last5 === "ud";
            } else {
              const cycle5 = ["central", "lr", "ud"] as const;
              const cur5: "central" | "lr" | "ud" = c5
                ? "central"
                : lr5
                  ? "lr"
                  : "ud";
              const idx5 = cycle5.indexOf(cur5);
              const nxt5 = cycle5[(idx5 + 1) % 3];
              p.lastSingle5ptFamilyRef.current = nxt5;
              nextC5 = nxt5 === "central";
              nextLR5 = nxt5 === "lr";
              nextUD5 = nxt5 === "ud";
            }
            const fn5 = (l: Layer) =>
              l.isRuler
                ? {
                    ...l,
                    fivePtEnableCenter: nextC5,
                    fivePtEnableLR: nextLR5,
                    fivePtEnableUD: nextUD5,
                  }
                : l;
            cb.setLayers((prev) => prev.map(fn5));
            p.layersRef.current = p.layersRef.current.map(fn5);
          } else if (rtype === "perspective-2pt") {
            const v1 = activeRuler.twoPtEnableVP1 !== false;
            const v2 = activeRuler.twoPtEnableVP2 !== false;
            const ac2 = [v1, v2].filter(Boolean).length;
            let nV1 = false;
            let nV2 = false;
            if (ac2 > 1) {
              const l2 = p.lastSingle2ptFamilyRef.current;
              nV1 = l2 === "vp1";
              nV2 = l2 === "vp2";
            } else {
              const cyc2 = ["vp1", "vp2"] as const;
              const cur2: "vp1" | "vp2" = v1 ? "vp1" : "vp2";
              const idx2 = cyc2.indexOf(cur2);
              const nxt2 = cyc2[(idx2 + 1) % 2];
              p.lastSingle2ptFamilyRef.current = nxt2;
              nV1 = nxt2 === "vp1";
              nV2 = nxt2 === "vp2";
            }
            const fn2 = (l: Layer) =>
              l.isRuler
                ? { ...l, twoPtEnableVP1: nV1, twoPtEnableVP2: nV2 }
                : l;
            cb.setLayers((prev) => prev.map(fn2));
            p.layersRef.current = p.layersRef.current.map(fn2);
          } else if (rtype === "perspective-3pt") {
            const t1 = activeRuler.threePtEnableVP1 !== false;
            const t2 = activeRuler.threePtEnableVP2 !== false;
            const t3 = activeRuler.threePtEnableVP3 !== false;
            const ac3 = [t1, t2, t3].filter(Boolean).length;
            let nT1 = false;
            let nT2 = false;
            let nT3 = false;
            if (ac3 > 1) {
              const l3 = p.lastSingle3ptFamilyRef.current;
              nT1 = l3 === "vp1";
              nT2 = l3 === "vp2";
              nT3 = l3 === "vp3";
            } else {
              const cyc3 = ["vp1", "vp2", "vp3"] as const;
              const cur3: "vp1" | "vp2" | "vp3" = t1
                ? "vp1"
                : t2
                  ? "vp2"
                  : "vp3";
              const idx3 = cyc3.indexOf(cur3);
              const nxt3 = cyc3[(idx3 + 1) % 3];
              p.lastSingle3ptFamilyRef.current = nxt3;
              nT1 = nxt3 === "vp1";
              nT2 = nxt3 === "vp2";
              nT3 = nxt3 === "vp3";
            }
            const fn3 = (l: Layer) =>
              l.isRuler
                ? {
                    ...l,
                    threePtEnableVP1: nT1,
                    threePtEnableVP2: nT2,
                    threePtEnableVP3: nT3,
                  }
                : l;
            cb.setLayers((prev) => prev.map(fn3));
            p.layersRef.current = p.layersRef.current.map(fn3);
          }
        }
        return;
      }

      if (!e.ctrlKey && !e.metaKey) {
        if (matchAct("brush")) {
          if (activeToolRef.current !== "brush") {
            cb.handleToolChange("brush");
          }
        } else if (matchAct("eraser")) {
          if (activeToolRef.current !== "eraser") {
            cb.handleToolChange("eraser");
          }
        } else if (matchAct("smudge")) {
          if (activeToolRef.current !== "smudge") {
            cb.handleToolChange("smudge");
          }
        } else if (matchAct("liquify")) {
          if (activeToolRef.current !== "liquify") {
            cb.handleToolChange("liquify");
          }
        } else if (matchAct("fill")) {
          if (activeToolRef.current !== "fill") {
            cb.handleToolChange("fill");
          }
        } else if (matchAct("eyedropper")) {
          if (activeToolRef.current !== "eyedropper") {
            cb.handleToolChange("eyedropper");
          }
        } else if (matchAct("flipImage")) {
          e.preventDefault();
          {
            const vt = viewTransformRef.current;
            const rot = (vt.rotation * Math.PI) / 180;
            const cosR = Math.cos(rot);
            const sinR = Math.sin(rot);
            const flip = isFlippedRef.current ? -1 : 1;
            const newFlip = -flip;
            const A = flip * cosR;
            const B = -flip * sinR;
            const C = sinR;
            const D = cosR;
            const px2 = -vt.panX / vt.zoom;
            const py2 = -vt.panY / vt.zoom;
            const det = A * D - B * C;
            const cxF = (D * px2 - B * py2) / det;
            const cyF = (-C * px2 + A * py2) / det;
            const newPanX = -newFlip * (cxF * cosR - cyF * sinR) * vt.zoom;
            const newPanY = -(cxF * sinR + cyF * cosR) * vt.zoom;
            cb.setViewTransform((prev) => ({
              ...prev,
              panX: newPanX,
              panY: newPanY,
            }));
            viewTransformRef.current = {
              ...viewTransformRef.current,
              panX: newPanX,
              panY: newPanY,
            };
            cb.setIsFlipped((f) => !f);
          }
        } else if (matchAct("lasso")) {
          if (activeToolRef.current !== "lasso") {
            cancelInProgressSelectionRef.current();
            cb.setActiveTool("lasso");
            cb.setActiveSubpanel("lasso" as Tool);
          }
        } else if (matchAct("ruler")) {
          cancelInProgressSelectionRef.current();
          const rulerLayer2 = p.layersRef.current.find((l) => l.isRuler);
          if (activeToolRef.current !== "ruler") {
            p.lastPaintToolRef2.current = activeToolRef.current;
            p.lastPaintLayerIdRef.current = p.activeLayerIdRef.current;
            cb.setActiveTool("ruler");
            cb.setActiveSubpanel("ruler" as Tool);
            if (rulerLayer2) {
              cb.setActiveLayerId(rulerLayer2.id);
              p.activeLayerIdRef.current = rulerLayer2.id;
            }
          }
        } else if (matchAct("transform")) {
          if (activeToolRef.current === "move" && !transformActiveRef.current) {
            // Already on move with no active transform — no-op
          } else {
            cancelInProgressSelectionRef.current();
            if (transformActiveRef.current) {
              p.selectionActionsRef.current.commitFloat({
                keepSelection: true,
              });
            } else {
              p.lastToolBeforeTransformRef.current = activeToolRef.current;
            }
            // Mirror exactly what the toolbar button does: just activate the move
            // tool. extractFloat is called on the first pointer-down, which already
            // handles multi-layer union bounds correctly. Do NOT call extractFloat
            // here — the inline single-layer scan that was here bypassed the
            // multi-layer path in useTransformSystem.
            cb.setActiveTool("move");
            cb.setActiveSubpanel(null);
          }
        } else if (e.key === "Escape") {
          if (isCropActiveRef.current) {
            cropRectRef.current = {
              x: 0,
              y: 0,
              w: p.canvasWidthRef.current,
              h: p.canvasHeightRef.current,
            };
            isCropActiveRef.current = false;
            cb.setActiveTool(cropPrevToolRef.current);
            if (cropPrevViewRef.current)
              cb.setViewTransform(cropPrevViewRef.current);
          } else if (isDrawingSelectionRef.current) {
            cancelInProgressSelectionRef.current();
          } else if (transformActiveRef.current) {
            p.selectionActionsRef.current.revertTransform();
          } else if (selectionActiveRef.current) {
            p.selectionActionsRef.current.clearSelection();
          } else if (viewTransformRef.current.rotation !== 0) {
            const vtE = viewTransformRef.current;
            const RE = (-vtE.rotation * Math.PI) / 180;
            const cosRE = Math.cos(RE);
            const sinRE = Math.sin(RE);
            const newPanXE = vtE.panX * cosRE + vtE.panY * sinRE;
            const newPanYE = -vtE.panX * sinRE + vtE.panY * cosRE;
            const newVtE = {
              ...vtE,
              rotation: 0,
              panX: newPanXE,
              panY: newPanYE,
            };
            applyTransformToDOMRef.current(newVtE);
            cb.setViewTransform(newVtE);
          }
        } else if (e.key === "Delete" || e.key === "Backspace") {
          if (selectionActiveRef.current) {
            e.preventDefault();
            p.selectionActionsRef.current.deleteSelection();
          } else if (matchAct("deleteLayer")) {
            e.preventDefault();
            if (p.activeLayerIdRef.current)
              cb.handleDeleteLayer(p.activeLayerIdRef.current);
          }
        } else if (e.key.toLowerCase() === "j") {
          if (!e.shiftKey) {
            e.preventDefault();
            p.selectionActionsRef.current.cutOrCopyToLayer(false);
          } else if (e.shiftKey && selectionActiveRef.current) {
            e.preventDefault();
            p.selectionActionsRef.current.cutOrCopyToLayer(true);
          }
        } else if (matchAct("deselectAll")) {
          if (
            selectionActiveRef.current ||
            transformActiveRef.current ||
            isDraggingFloatRef.current
          ) {
            e.preventDefault();
            if (transformActiveRef.current || isDraggingFloatRef.current) {
              p.selectionActionsRef.current.commitFloat({
                keepSelection: false,
              });
            } else {
              p.selectionActionsRef.current.clearSelection();
            }
          }
        } else if (e.key.toLowerCase() === "enter") {
          if (isDrawingSelectionRef.current) {
            e.preventDefault();
            commitInProgressLassoRef.current();
          } else if (isDraggingFloatRef.current || transformActiveRef.current) {
            e.preventDefault();
            p.selectionActionsRef.current.commitFloat({ keepSelection: true });
          }
        } else if (matchAct("sizeDecrease")) {
          if (activeToolRef.current === "liquify") {
            cb.setLiquifySize((prev) => {
              const delta = Math.max(1, Math.round(prev * 0.1));
              const newSize = Math.max(1, prev - delta);
              liquifySizeRef.current = newSize;
              return newSize;
            });
            updateBrushCursorRef.current();
          } else {
            cb.setBrushSizes((prev) => {
              const key =
                activeToolRef.current === "eraser" ? "eraser" : "brush";
              const delta = Math.max(1, Math.round(prev[key] * 0.1));
              const newSize = Math.max(1, prev[key] - delta);
              p.brushSizesRef.current = {
                ...p.brushSizesRef.current,
                [key]: newSize,
              };
              p.toolSizesRef.current[activeToolRef.current] = newSize;
              return { ...prev, [key]: newSize };
            });
            updateBrushCursorRef.current();
          }
        } else if (matchAct("sizeIncrease")) {
          if (activeToolRef.current === "liquify") {
            cb.setLiquifySize((prev) => {
              const delta = Math.max(1, Math.round(prev * 0.1));
              const newSize = Math.min(1000, prev + delta);
              liquifySizeRef.current = newSize;
              return newSize;
            });
            updateBrushCursorRef.current();
          } else {
            cb.setBrushSizes((prev) => {
              const key =
                activeToolRef.current === "eraser" ? "eraser" : "brush";
              const delta = Math.max(1, Math.round(prev[key] * 0.1));
              const newSize = Math.min(500, prev[key] + delta);
              p.brushSizesRef.current = {
                ...p.brushSizesRef.current,
                [key]: newSize,
              };
              p.toolSizesRef.current[activeToolRef.current] = newSize;
              return { ...prev, [key]: newSize };
            });
            updateBrushCursorRef.current();
          }
        } else if (
          ["1", "2", "3", "4", "5", "6", "7", "8", "9"].includes(e.key)
        ) {
          const tool = activeToolRef.current;
          if (
            tool === "brush" ||
            tool === "eraser" ||
            tool === "smudge" ||
            tool === "liquify"
          ) {
            e.preventDefault();
            const digit = Number.parseInt(e.key, 10);
            const immediateVal = digit / 10;
            const applyVal = (val: number) => {
              const clamped = Math.max(0.01, Math.min(1, val));
              if (tool === "smudge") {
                cb.setBrushSettings((prev) => ({
                  ...prev,
                  smearStrength: clamped,
                }));
              } else if (tool === "liquify") {
                liquifyStrengthRef.current = clamped;
                cb.setLiquifyStrength(clamped);
              } else {
                cb.setColor((prev) => ({ ...prev, a: clamped }));
                p.toolOpacitiesRef.current = {
                  ...p.toolOpacitiesRef.current,
                  [tool]: clamped,
                };
              }
            };
            if (p.opacityFirstDigitRef.current !== null) {
              const twoDigitVal =
                (p.opacityFirstDigitRef.current * 10 + digit) / 100;
              if (p.opacityTimerRef.current)
                clearTimeout(p.opacityTimerRef.current);
              p.opacityFirstDigitRef.current = null;
              p.opacityTimerRef.current = null;
              applyVal(twoDigitVal);
            } else {
              applyVal(immediateVal);
              p.opacityFirstDigitRef.current = digit;
              if (p.opacityTimerRef.current)
                clearTimeout(p.opacityTimerRef.current);
              p.opacityTimerRef.current = setTimeout(() => {
                p.opacityFirstDigitRef.current = null;
                p.opacityTimerRef.current = null;
              }, 1600);
            }
          }
        } else if (e.key === "0") {
          const tool = activeToolRef.current;
          if (
            tool === "brush" ||
            tool === "eraser" ||
            tool === "smudge" ||
            tool === "liquify"
          ) {
            e.preventDefault();
            const applyVal0 = (val: number) => {
              if (tool === "smudge") {
                cb.setBrushSettings((prev) => ({
                  ...prev,
                  smearStrength: val,
                }));
              } else if (tool === "liquify") {
                liquifyStrengthRef.current = val;
                cb.setLiquifyStrength(val);
              } else {
                cb.setColor((prev) => ({ ...prev, a: val }));
                p.toolOpacitiesRef.current = {
                  ...p.toolOpacitiesRef.current,
                  [tool]: val,
                };
              }
            };
            if (p.opacityFirstDigitRef.current !== null) {
              const twoDigitVal0 = (p.opacityFirstDigitRef.current * 10) / 100;
              if (p.opacityTimerRef.current)
                clearTimeout(p.opacityTimerRef.current);
              p.opacityFirstDigitRef.current = null;
              p.opacityTimerRef.current = null;
              applyVal0(twoDigitVal0);
            } else {
              applyVal0(1.0);
            }
          } else {
            cb.setViewTransform({
              panX: 0,
              panY: 0,
              zoom: 1,
              rotation: 0,
            });
          }
        } else if (matchAct("newLayer")) {
          e.preventDefault();
          cb.handleAddLayer();
        } else if (matchAct("toggleClearBlendMode")) {
          if (activeToolRef.current === "brush") {
            e.preventDefault();
            if (p.brushBlendModeRef.current === "clear") {
              // Restore previous blend mode
              const restored = p.prevBrushBlendModeRef.current || "source-over";
              p.brushBlendModeRef.current = restored;
              cb.setBrushBlendMode(restored);
            } else {
              // Save current blend mode and switch to clear
              p.prevBrushBlendModeRef.current = p.brushBlendModeRef.current;
              p.brushBlendModeRef.current = "clear";
              cb.setBrushBlendMode("clear");
            }
          }
        } else if (matchAct("clearLayer")) {
          e.preventDefault();
          cb.handleClear();
        } else if (matchAct("duplicateLayer")) {
          e.preventDefault();
          p.selectionActionsRef.current.cutOrCopyToLayer(false);
        } else if (matchAct("toggleVisibility")) {
          e.preventDefault();
          if (p.activeLayerIdRef.current)
            cb.handleToggleVisible(p.activeLayerIdRef.current);
        } else if (matchAct("alphaLock")) {
          e.preventDefault();
          if (p.activeLayerIdRef.current)
            cb.handleToggleAlphaLock(p.activeLayerIdRef.current);
        } else if (matchAct("invertSelection")) {
          e.preventDefault();
          if (p.selectionMaskRef.current) {
            const mc = p.selectionMaskRef.current;
            const mCtx = mc.getContext("2d", { willReadFrequently: true });
            if (mCtx) {
              const imgData = mCtx.getImageData(
                0,
                0,
                p.canvasWidthRef.current,
                p.canvasHeightRef.current,
              );
              const d = imgData.data;
              for (let i = 0; i < d.length; i += 4) {
                const wasSelected = d[i + 3] > 128;
                d[i] = wasSelected ? 0 : 255;
                d[i + 1] = wasSelected ? 0 : 255;
                d[i + 2] = wasSelected ? 0 : 255;
                d[i + 3] = wasSelected ? 0 : 255;
              }
              mCtx.putImageData(imgData, 0, 0);
              p.selectionBoundaryPathRef.current.dirty = true;
              if (p.selectionMaskRef.current)
                p.rebuildChainsNowRef.current(p.selectionMaskRef.current);
              cb.setSelectionActive(true);
            }
          }
        } else if (matchAct("growSelection")) {
          e.preventDefault();
          cb.handleGrowShrink(1);
        } else if (matchAct("shrinkSelection")) {
          e.preventDefault();
          cb.handleGrowShrink(-1);
        } else if (
          !(e.key === "Delete" || e.key === "Backspace") &&
          matchAct("deleteLayer") &&
          !selectionActiveRef.current
        ) {
          e.preventDefault();
          if (p.activeLayerIdRef.current)
            cb.handleDeleteLayer(p.activeLayerIdRef.current);
        }
      }
    };

    const upHandler = (e: KeyboardEvent) => {
      if (e.key === "Alt" && altEyedropperActiveRef.current) {
        altEyedropperActiveRef.current = false;
        callbacksRef.current.setActiveTool(prevToolRef.current);
      }
      if (e.key === "Alt" && altSpaceModeRef.current) {
        altSpaceModeRef.current = false;
        isBrushSizeAdjustingRef.current = false;
        updateBrushCursorRef.current();
      }
    };

    const blurHandler = () => {
      if (altEyedropperActiveRef.current) {
        altEyedropperActiveRef.current = false;
        callbacksRef.current.setActiveTool(prevToolRef.current);
      }
      if (altSpaceModeRef.current) {
        altSpaceModeRef.current = false;
        isBrushSizeAdjustingRef.current = false;
        updateBrushCursorRef.current();
      }
      shiftHeldRef.current = false;
    };

    window.addEventListener("keydown", handler);
    window.addEventListener("keyup", upHandler);
    window.addEventListener("blur", blurHandler);
    return () => {
      window.removeEventListener("keydown", handler);
      window.removeEventListener("keyup", upHandler);
      window.removeEventListener("blur", blurHandler);
    };
  }, []);

  // ── 2. Space / rotate key handler ────────────────────────────────────────
  // biome-ignore lint/correctness/useExhaustiveDependencies: all mutable state accessed via stable refs
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      if (e.key === "Shift") {
        shiftHeldRef.current = true;
        const prevToolForAltShift = altEyedropperActiveRef.current
          ? prevToolRef.current
          : activeToolRef.current;
        if (
          e.altKey &&
          (prevToolForAltShift === "brush" ||
            prevToolForAltShift === "eraser" ||
            prevToolForAltShift === "smudge")
        ) {
          if (altEyedropperActiveRef.current) {
            altEyedropperActiveRef.current = false;
            callbacksRef.current.setActiveTool(prevToolForAltShift);
          }
          altSpaceModeRef.current = true;
          updateBrushCursorRef.current();
        }
      }

      if (e.code === "Space") {
        e.preventDefault();
        if (isDrawingSelectionRef.current) {
          commitInProgressLassoRef.current();
          return;
        }
        spaceDownRef.current = true;
        zoomModeRef.current = !!(e.ctrlKey || e.metaKey);
        if (containerRef.current)
          containerRef.current.style.cursor = isPanningRef.current
            ? "grabbing"
            : "grab";
      }
      if ((e.key === "Control" || e.key === "Meta") && spaceDownRef.current) {
        zoomModeRef.current = true;
        if (containerRef.current)
          containerRef.current.style.cursor = isPanningRef.current
            ? "grabbing"
            : "grab";
      }
      if (
        matchesBinding(e, hotkeysRef.current.rotateSwitch?.primary) ||
        matchesBinding(e, hotkeysRef.current.rotateSwitch?.secondary)
      ) {
        if (activeToolRef.current !== "rotate") {
          cancelInProgressSelectionRef.current();
          prevToolRef.current = activeToolRef.current as Tool;
          callbacksRef.current.setActiveTool("rotate" as Tool);
          rotateLockedRef.current = true;
          callbacksRef.current.setRotateLocked(true);
          callbacksRef.current.setZoomLocked(false);
          callbacksRef.current.setPanLocked(false);
          callbacksRef.current.setActiveSubpanel("rotate" as Tool);
        }
        updateBrushCursorRef.current();
      }
      if (
        matchesBinding(e, hotkeysRef.current.rotateHold?.primary) ||
        matchesBinding(e, hotkeysRef.current.rotateHold?.secondary)
      ) {
        rKeyDownRef.current = true;
        updateBrushCursorRef.current();
      }
      if (
        e.key.toLowerCase() === "z" &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey
      ) {
        zKeyDownRef.current = true;
        updateBrushCursorRef.current();
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      let cameraKeyReleased = false;
      if (e.key === "Shift") {
        shiftHeldRef.current = false;
        if (altSpaceModeRef.current) {
          altSpaceModeRef.current = false;
          isBrushSizeAdjustingRef.current = false;
          updateBrushCursorRef.current();
        }
      }
      if (e.code === "Space") {
        spaceDownRef.current = false;
        zoomModeRef.current = false;
        isPanningRef.current = false;
        isZoomDraggingRef.current = false;
        cameraKeyReleased = true;
      }
      if ((e.key === "Control" || e.key === "Meta") && spaceDownRef.current) {
        zoomModeRef.current = false;
        cameraKeyReleased = true;
      }
      {
        const rHoldPrimary = hotkeysRef.current.rotateHold?.primary;
        const rHoldSecondary = hotkeysRef.current.rotateHold?.secondary;
        const rotateHoldKeyReleased =
          (rHoldPrimary && e.key.toLowerCase() === rHoldPrimary.key) ||
          (rHoldSecondary && e.key.toLowerCase() === rHoldSecondary.key);
        if (rotateHoldKeyReleased && rKeyDownRef.current) {
          rKeyDownRef.current = false;
          p.isRotatingRef.current = false;
          cameraKeyReleased = true;
        }
      }
      if (e.key.toLowerCase() === "z") {
        zKeyDownRef.current = false;
        isZoomDraggingRef.current = false;
        cameraKeyReleased = true;
      }
      if (cameraKeyReleased) {
        updateBrushCursorRef.current();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  // ── 3. Wheel zoom ────────────────────────────────────────────────────────
  // biome-ignore lint/correctness/useExhaustiveDependencies: stable refs only
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const t = viewTransformRef.current;
      const cr = container.getBoundingClientRect();
      const centerX = cr.left + cr.width / 2;
      const centerY = cr.top + cr.height / 2;
      const cx = e.clientX - centerX;
      const cy = e.clientY - centerY;
      const factor = 1 - e.deltaY * 0.001;
      const newZoom = Math.min(20, Math.max(0.05, t.zoom * factor));
      const zoomRatio = newZoom / t.zoom;
      const newPanX = cx - (cx - t.panX) * zoomRatio;
      const newPanY = cy - (cy - t.panY) * zoomRatio;
      const newTransform = {
        ...viewTransformRef.current,
        zoom: newZoom,
        panX: newPanX,
        panY: newPanY,
      };
      applyTransformToDOMRef.current(newTransform);
      if (wheelCommitTimerRef.current !== null)
        clearTimeout(wheelCommitTimerRef.current);
      wheelCommitTimerRef.current = window.setTimeout(() => {
        wheelCommitTimerRef.current = null;
        callbacksRef.current.setViewTransform({ ...viewTransformRef.current });
      }, 100);
    };
    container.addEventListener("wheel", onWheel, { passive: false });
    return () => container.removeEventListener("wheel", onWheel);
  }, []);

  // ── 4. Multi-touch gestures ──────────────────────────────────────────────
  // biome-ignore lint/correctness/useExhaustiveDependencies: transformActiveRef is a stable ref
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let prevDist = 0;
    let prevAngle = 0;
    let prevMidX = 0;
    let prevMidY = 0;
    let tapStartTime = 0;
    let tapTouchCount = 0;
    let tapMoved = false;
    const tapStartPositions = new Map<number, { x: number; y: number }>();

    const getDist = (t1: Touch, t2: Touch) => {
      const dx = t2.clientX - t1.clientX;
      const dy = t2.clientY - t1.clientY;
      return Math.sqrt(dx * dx + dy * dy);
    };
    const getAngle = (t1: Touch, t2: Touch) =>
      Math.atan2(t2.clientY - t1.clientY, t2.clientX - t1.clientX);

    const onTouchStart = (e: TouchEvent) => {
      const target = e.target as Element;
      const isInPanel = target.closest(
        ".overflow-y-auto, [data-radix-scroll-area-viewport]",
      );
      if (isInPanel && e.touches.length < 2) return;
      if (penDownCountRef.current > 0) {
        e.preventDefault();
        return;
      }
      tapStartTime = Date.now();
      tapTouchCount = e.touches.length;
      tapMoved = false;
      tapStartPositions.clear();
      for (let i = 0; i < e.touches.length; i++) {
        const t = e.touches[i];
        tapStartPositions.set(t.identifier, { x: t.clientX, y: t.clientY });
      }
      if (e.touches.length === 3) {
        e.preventDefault();
      }
      if (e.touches.length >= 2) {
        for (let i = 0; i < e.touches.length; i++) {
          const t = e.touches[i];
          const start = tapStartPositions.get(t.identifier);
          if (
            start &&
            Math.hypot(t.clientX - start.x, t.clientY - start.y) > 10
          ) {
            tapMoved = true;
          }
        }
      }
      if (e.touches.length === 2) {
        e.preventDefault();
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        prevDist = getDist(t1, t2);
        prevAngle = getAngle(t1, t2);
        prevMidX = (t1.clientX + t2.clientX) / 2;
        prevMidY = (t1.clientY + t2.clientY) / 2;
        p.isDrawingRef.current = false;
        p.strokeStartSnapshotRef.current = null;
        p.strokeSnapLayerRef.current = null;
        p.lastPosRef.current = null;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      const target = e.target as Element;
      const isInPanel = target.closest(
        ".overflow-y-auto, [data-radix-scroll-area-viewport]",
      );
      if (isInPanel && e.touches.length < 2) return;
      if (penDownCountRef.current > 0) return;
      if (e.touches.length === 2) {
        e.preventDefault();
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const newDist = getDist(t1, t2);
        const newAngle = getAngle(t1, t2);
        const newMidX = (t1.clientX + t2.clientX) / 2;
        const newMidY = (t1.clientY + t2.clientY) / 2;
        const zoomFactor = prevDist > 0 ? newDist / prevDist : 1;
        const angleDeltaDeg = ((newAngle - prevAngle) * 180) / Math.PI;
        const panDX = newMidX - prevMidX;
        const panDY = newMidY - prevMidY;
        const flipSign = isFlippedRef.current ? -1 : 1;
        const newTouchTransform = {
          ...viewTransformRef.current,
          zoom: Math.min(
            20,
            Math.max(0.05, viewTransformRef.current.zoom * zoomFactor),
          ),
          rotation:
            viewTransformRef.current.rotation + angleDeltaDeg * flipSign,
          panX: viewTransformRef.current.panX + panDX,
          panY: viewTransformRef.current.panY + panDY,
        };
        applyTransformToDOMRef.current(newTouchTransform);
        prevDist = newDist;
        prevAngle = newAngle;
        prevMidX = newMidX;
        prevMidY = newMidY;
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (penDownCountRef.current > 0) {
        penDownCountRef.current = 0;
        return;
      }
      prevDist = 0;
      callbacksRef.current.setViewTransform({ ...viewTransformRef.current });
      if (e.touches.length === 0) {
        const tapDuration = Date.now() - tapStartTime;
        if (tapDuration < 300 && tapTouchCount >= 2 && !tapMoved) {
          if (tapTouchCount === 2) {
            if (
              !p.isDrawingRef.current &&
              !p.isCommittingRef.current &&
              !transformActiveRef.current
            )
              callbacksRef.current.handleUndo();
          } else if (tapTouchCount >= 3) {
            if (
              !p.isDrawingRef.current &&
              !p.isCommittingRef.current &&
              !transformActiveRef.current
            )
              callbacksRef.current.handleRedo();
          }
        }
        tapStartTime = 0;
        tapTouchCount = 0;
        tapMoved = false;
        tapStartPositions.clear();
      }
    };

    container.addEventListener("touchstart", onTouchStart, { passive: false });
    container.addEventListener("touchmove", onTouchMove, { passive: false });
    container.addEventListener("touchend", onTouchEnd, { passive: false });
    return () => {
      container.removeEventListener("touchstart", onTouchStart);
      container.removeEventListener("touchmove", onTouchMove);
      container.removeEventListener("touchend", onTouchEnd);
    };
  }, []);

  // ── 5. Pointer handler implementations ──────────────────────────────────────
  // These are the full handlePointerDown/Move/Up implementations, moved here
  // from PaintingApp.tsx. They use stable refs from `p` and callbacks from
  // `callbacksRef.current` so they never go stale with [] deps.

  // biome-ignore lint/correctness/useExhaustiveDependencies: uses refs intentionally
  const handlePointerDown = useCallback((e: PointerEvent) => {
    const display = p.displayCanvasRef.current;
    const container = p.containerRef.current;
    if (!display || !container) return;
    e.preventDefault();
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
    const isIPad = p.isIPadRef.current;
    p.currentPointerTypeRef.current = e.pointerType;
    p.pointerScreenPosRef.current = { x: e.clientX, y: e.clientY };
    if (e.pointerType === "pen") {
      p.penDownCountRef.current += 1;
    } else if (e.pointerType === "touch") {
      if (p.penDownCountRef.current > 0 || e.width > 200 || e.height > 200) {
        return;
      }
    }

    // Alt+Shift: brush size drag
    if (p.altSpaceModeRef.current) {
      const isLiquifyAlt = p.activeToolRef.current === "liquify";
      p.isBrushSizeAdjustingRef.current = true;
      p.brushSizeAdjustStartXRef.current = e.clientX;
      p.brushSizeOverlayStartPosRef.current = { x: e.clientX, y: e.clientY };
      if (p.containerRef.current) p.containerRef.current.style.cursor = "none";
      if (isLiquifyAlt) {
        p.brushSizeAdjustOriginRef.current = p.liquifySizeRef.current;
        if (p.brushSizeOverlayRef.current) {
          const screenSize =
            p.liquifySizeRef.current * p.viewTransformRef.current.zoom;
          p.brushSizeOverlayRef.current.style.display = "block";
          p.brushSizeOverlayRef.current.style.left = `${e.clientX}px`;
          p.brushSizeOverlayRef.current.style.top = `${e.clientY}px`;
          callbacksRef.current.drawBrushTipOverlay(
            p.brushSizeOverlayRef.current,
            Math.max(2, screenSize),
          );
        }
      } else {
        const sizeKey =
          p.activeToolRef.current === "eraser" ? "eraser" : "brush";
        p.brushSizeAdjustOriginRef.current =
          p.brushSizesRef.current[
            sizeKey as keyof typeof p.brushSizesRef.current
          ];
        if (p.brushSizeOverlayRef.current) {
          const screenSize =
            p.brushSizesRef.current[
              sizeKey as keyof typeof p.brushSizesRef.current
            ] * p.viewTransformRef.current.zoom;
          p.brushSizeOverlayRef.current.style.display = "block";
          p.brushSizeOverlayRef.current.style.left = `${e.clientX}px`;
          p.brushSizeOverlayRef.current.style.top = `${e.clientY}px`;
          callbacksRef.current.drawBrushTipOverlay(
            p.brushSizeOverlayRef.current,
            Math.max(2, screenSize),
          );
        }
      }
      return;
    }

    // Z+drag zoom with cursor pivot
    if (p.zKeyDownRef.current) {
      p.isZoomDraggingRef.current = true;
      p.zoomDragStartXRef.current = e.clientX;
      p.zoomDragOriginRef.current = p.viewTransformRef.current.zoom;
      const cr = container.getBoundingClientRect();
      p.zoomDragCursorStartRef.current = {
        x: e.clientX - (cr.left + cr.width / 2),
        y: e.clientY - (cr.top + cr.height / 2),
      };
      p.zoomDragPanOriginRef.current = {
        x: p.viewTransformRef.current.panX,
        y: p.viewTransformRef.current.panY,
      };
      return;
    }

    if (
      p.zoomModeRef.current ||
      (p.zoomLockedRef.current &&
        !p.spaceDownRef.current &&
        !p.rKeyDownRef.current)
    ) {
      p.isZoomDraggingRef.current = true;
      p.zoomDragStartXRef.current = e.clientX;
      p.zoomDragOriginRef.current = p.viewTransformRef.current.zoom;
      const cr2 = container.getBoundingClientRect();
      p.zoomDragCursorStartRef.current = {
        x: e.clientX - (cr2.left + cr2.width / 2),
        y: e.clientY - (cr2.top + cr2.height / 2),
      };
      p.zoomDragPanOriginRef.current = {
        x: p.viewTransformRef.current.panX,
        y: p.viewTransformRef.current.panY,
      };
      return;
    }

    if (
      p.rKeyDownRef.current ||
      (p.rotateLockedRef.current &&
        !p.spaceDownRef.current &&
        !p.zoomModeRef.current)
    ) {
      p.isRotatingRef.current = true;
      p.rotOriginRef.current = p.viewTransformRef.current.rotation;
      const cr3 = container.getBoundingClientRect();
      const cx = cr3.left + cr3.width / 2;
      const cy = cr3.top + cr3.height / 2;
      p.rotCenterRef.current = { x: cx, y: cy };
      p.rotAngleOriginRef.current =
        Math.atan2(e.clientY - cy, e.clientX - cx) * (180 / Math.PI);
      p.rotDragCursorRef.current = { x: 0, y: 0 };
      p.rotDragCanvasPointRef.current = _getCanvasPosTransformed(
        cx,
        cy,
        container,
        display,
        p.viewTransformRef.current,
        p.isFlippedRef.current,
      );
      p.rotDragPanOriginRef.current = {
        x: p.viewTransformRef.current.panX,
        y: p.viewTransformRef.current.panY,
      };
      return;
    }

    if (e.button === 1 || p.spaceDownRef.current || p.panLockedRef.current) {
      p.isPanningRef.current = true;
      p.panStartRef.current = { x: e.clientX, y: e.clientY };
      p.panOriginRef.current = {
        x: p.viewTransformRef.current.panX,
        y: p.viewTransformRef.current.panY,
      };
      return;
    }

    if (
      p.brushSizeOverlayRef.current &&
      p.brushSizeOverlayRef.current.style.display !== "none"
    ) {
      p.brushSizeOverlayRef.current.style.display = "none";
      p.brushSizeOverlayStartPosRef.current = null;
      p.updateBrushCursorRef.current?.();
    }

    const pos = _getCanvasPosTransformed(
      e.clientX,
      e.clientY,
      container,
      display,
      p.viewTransformRef.current,
      p.isFlippedRef.current,
    );
    const tool = p.activeToolRef.current;
    const layerId = p.activeLayerIdRef.current;
    const lc = p.layerCanvasesRef.current.get(layerId);
    const cb = callbacksRef.current;

    // Hard guard: never allow painting on an invisible layer
    {
      const activeLayerCheck2 = p.layersRef.current.find(
        (l) => l.id === layerId,
      );
      if (activeLayerCheck2 && !activeLayerCheck2.visible && tool !== "ruler") {
        toast.error("Layer is hidden. Make it visible before drawing.");
        return;
      }
    }

    // Hard guard: never allow painting on a ruler layer
    {
      const activeLayerCheck = p.layersRef.current.find(
        (l) => l.id === layerId,
      );
      if (activeLayerCheck?.isRuler && tool !== "ruler") {
        const fallbackId = p.lastPaintLayerIdRef.current;
        const fallbackLayer = p.layersRef.current.find(
          (l) => l.id === fallbackId && !l.isRuler,
        );
        const targetId = fallbackLayer
          ? fallbackId
          : p.layersRef.current.find((l) => !l.isRuler)?.id;
        if (targetId) {
          cb.setActiveLayerId(targetId);
          p.activeLayerIdRef.current = targetId;
        }
        return;
      }
    }

    // Multi-select tool gate
    if (
      tool === "brush" ||
      tool === "eraser" ||
      tool === "fill" ||
      tool === "smudge"
    ) {
      const _effectiveSel = getEffectivelySelectedLayers(
        p.layerTreeRef.current,
        p.selectedLayerIdsRef.current,
      );
      if (_effectiveSel.length > 1) return;
    }

    // Handle ruler tool
    if (tool === "ruler") {
      const rulerLayer = p.layersRef.current.find((l) => l.isRuler);
      const currentPresetType = p.activeRulerPresetTypeRef.current;
      const handleRadius = Math.max(12, 24 / p.viewTransformRef.current.zoom);
      const rh = cb.rulerHandlers;

      if (rulerLayer) {
        const layerPresetType = rulerLayer.rulerPresetType ?? "perspective-1pt";
        let consumed = false;
        if (layerPresetType === "line") {
          consumed = rh.handleLineRulerPointerDown(
            pos,
            rulerLayer,
            handleRadius,
          );
        } else if (layerPresetType === "perspective-1pt") {
          consumed = rh.handle1ptRulerPointerDown(
            pos,
            rulerLayer,
            handleRadius,
          );
        } else if (layerPresetType === "perspective-2pt") {
          consumed = rh.handle2ptRulerPointerDown(
            pos,
            rulerLayer,
            handleRadius,
          );
        } else if (layerPresetType === "perspective-3pt") {
          consumed = rh.handle3ptRulerPointerDown(
            pos,
            rulerLayer,
            handleRadius,
            p.shiftHeldRef.current,
          );
        } else if (layerPresetType === "perspective-5pt") {
          consumed = rh.handle5ptRulerPointerDown(
            pos,
            rulerLayer,
            handleRadius,
            p.shiftHeldRef.current,
          );
        } else if (layerPresetType === "oval") {
          consumed = rh.handleOvalRulerPointerDown(
            pos,
            rulerLayer,
            handleRadius,
          );
        } else if (layerPresetType === "grid") {
          consumed = rh.handleGridRulerPointerDown(
            pos,
            rulerLayer,
            handleRadius,
          );
        }
        void consumed;
      } else if (currentPresetType) {
        const newRulerLayer: Layer = {
          id: `ruler-${Date.now()}`,
          name: "Ruler",
          visible: true,
          opacity: 1,
          blendMode: "normal",
          isRuler: true,
          rulerPresetType: currentPresetType,
          rulerActive: true,
          isClippingMask: false,
          alphaLock: false,
        };
        const prevActiveIdForRuler = p.activeLayerIdRef.current;
        cb.setLayers((prev) => [...prev, newRulerLayer]);
        p.layersRef.current = [...p.layersRef.current, newRulerLayer];
        cb.setActiveLayerId(newRulerLayer.id);
        p.activeLayerIdRef.current = newRulerLayer.id;
        cb.pushHistory({
          type: "layer-add",
          layer: newRulerLayer,
          index: p.layersRef.current.length - 1,
          previousActiveLayerId: prevActiveIdForRuler,
        });
        p.rulerEditHistoryDepthRef.current = 1;
        cb.scheduleRulerOverlay();
      }
      return;
    }

    if (tool === "eyedropper") {
      p.eyedropperIsPressedRef.current = true;
      p.eyedropperHoverColorRef.current = cb.sampleEyedropperColor(
        Math.round(pos.x),
        Math.round(pos.y),
      );
      cb.updateEyedropperCursorRef.current();
      return;
    }

    // Handle lasso selection tools
    if (tool === "lasso") {
      const mode = p.lassoModeRef.current;
      p.selectionBeforeRef.current = cb.snapshotSelection();
      if (mode === "rect" || mode === "ellipse") {
        if (!e.shiftKey && !e.altKey) {
          p.selectionActiveRef.current = false;
          cb.setSelectionActive(false);
          p.selectionGeometryRef.current = null;
          p.selectionMaskRef.current = null;
          p.selectionShapesRef.current = [];
          p.selectionBoundaryPathRef.current.chains = [];
          p.selectionBoundaryPathRef.current.segments = [];
          p.selectionBoundaryPathRef.current.dirty = true;
        }
        p.isDrawingSelectionRef.current = true;
        if (p.marchingAntsRafRef.current === null && p.drawAntsRef.current) {
          p.marchingAntsRafRef.current = requestAnimationFrame(
            p.drawAntsRef.current,
          );
        }
        p.selectionDraftBoundsRef.current = {
          sx: pos.x,
          sy: pos.y,
          ex: pos.x,
          ey: pos.y,
        };
      } else if (mode !== "wand") {
        if (!p.isDrawingSelectionRef.current) {
          if (!e.shiftKey && !e.altKey) {
            p.selectionActiveRef.current = false;
            cb.setSelectionActive(false);
            p.selectionGeometryRef.current = null;
            p.selectionMaskRef.current = null;
            p.selectionShapesRef.current = [];
            p.selectionBoundaryPathRef.current.chains = [];
            p.selectionBoundaryPathRef.current.segments = [];
            p.selectionBoundaryPathRef.current.dirty = true;
          }
          p.isDrawingSelectionRef.current = true;
          if (p.marchingAntsRafRef.current === null && p.drawAntsRef.current) {
            p.marchingAntsRafRef.current = requestAnimationFrame(
              p.drawAntsRef.current,
            );
          }
          p.selectionDraftPointsRef.current = [{ x: pos.x, y: pos.y }];
          p.lassoHasPolyPointsRef.current = false;
          p.selectionPolyClosingRef.current = false;
          p.selectionDraftCursorRef.current = null;
        }
        p.lassoIsDraggingRef.current = false;
        p.lassoStrokeStartRef.current = { x: pos.x, y: pos.y };
        p.lassoFreeLastPtRef.current = null;
      } else if (mode === "wand") {
        p.selectionBeforeRef.current = cb.snapshotSelection();
        const layerCanvas = p.layerCanvasesRef.current.get(
          p.activeLayerIdRef.current,
        );
        if (!layerCanvas) return;
        const lCtx = layerCanvas.getContext("2d", {
          willReadFrequently: !isIPad,
        });
        if (!lCtx) return;
        const wx = Math.round(pos.x);
        const wy = Math.round(pos.y);
        if (
          wx < 0 ||
          wx >= p.canvasWidthRef.current ||
          wy < 0 ||
          wy >= p.canvasHeightRef.current
        )
          return;
        const imgData = lCtx.getImageData(
          0,
          0,
          p.canvasWidthRef.current,
          p.canvasHeightRef.current,
        );
        const srcData = imgData.data;
        const maskCanvas = document.createElement("canvas");
        maskCanvas.width = p.canvasWidthRef.current;
        maskCanvas.height = p.canvasHeightRef.current;
        const mCtx = maskCanvas.getContext("2d", {
          willReadFrequently: !isIPad,
        })!;
        const maskImgData = mCtx.createImageData(
          p.canvasWidthRef.current,
          p.canvasHeightRef.current,
        );
        const md = maskImgData.data;
        const rawMask = bfsFloodFill(
          srcData,
          p.canvasWidthRef.current,
          p.canvasHeightRef.current,
          wx,
          wy,
          p.wandToleranceRef.current,
          p.wandContiguousRef.current,
        );
        const grownMask = growShrinkMask(
          rawMask,
          p.canvasWidthRef.current,
          p.canvasHeightRef.current,
          p.wandGrowShrinkRef.current,
        );
        for (let i = 0; i < grownMask.length; i++) {
          if (grownMask[i]) {
            const pi = i * 4;
            md[pi] = 255;
            md[pi + 1] = 255;
            md[pi + 2] = 255;
            md[pi + 3] = 255;
          }
        }
        if (e.shiftKey && p.selectionMaskRef.current) {
          const existCtx = p.selectionMaskRef.current.getContext("2d", {
            willReadFrequently: !isIPad,
          });
          if (existCtx) {
            const existData = existCtx.getImageData(
              0,
              0,
              p.canvasWidthRef.current,
              p.canvasHeightRef.current,
            ).data;
            for (let i = 3; i < md.length; i += 4) {
              if (existData[i] > 128) md[i] = 255;
            }
          }
        }
        mCtx.putImageData(maskImgData, 0, 0);
        p.selectionMaskRef.current = maskCanvas;
        const wandBounds = computeMaskBounds(maskCanvas);
        p.selectionGeometryRef.current = wandBounds
          ? { type: "mask" as LassoMode }
          : null;
        p.selectionShapesRef.current = [];
        p.selectionBoundaryPathRef.current.dirty = true;
        if (wandBounds && p.selectionMaskRef.current)
          p.rebuildChainsNowRef.current(p.selectionMaskRef.current);
        cb.setSelectionActive(!!wandBounds);
        {
          const afterSnap = cb.snapshotSelection();
          cb.pushHistory({
            type: "selection",
            before: p.selectionBeforeRef.current ?? afterSnap,
            after: afterSnap,
          });
          p.selectionBeforeRef.current = null;
        }
      }
      return;
    }

    // Handle move/transform tools
    if (tool === "move" || tool === "transform") {
      if (
        (tool === "transform" || tool === "move") &&
        p.transformActiveRef.current
      ) {
        const hitHandle = p.transformActionsRef.current.hitTestTransformHandle(
          pos.x,
          pos.y,
        );
        if (hitHandle) {
          p.transformHandleRef.current = hitHandle;
          const xfDown = p.xfStateRef.current;
          p.floatDragStartRef.current = {
            px: pos.x,
            py: pos.y,
            fx: xfDown ? xfDown.x : 0,
            fy: xfDown ? xfDown.y : 0,
            origBounds: xfDown
              ? { x: xfDown.x, y: xfDown.y, w: xfDown.w, h: xfDown.h }
              : undefined,
            initRotation: xfDown ? xfDown.rotation : 0,
          };
        }
        return;
      }
      // isDraggingFloatRef is true for both single-layer (moveFloatCanvasRef set)
      // and multi-layer (moveFloatCanvasRef is null, multiFloatCanvases populated).
      // Only re-extract when no float session is active at all.
      if (p.isDraggingFloatRef.current) {
        const xfMove2 = p.xfStateRef.current;
        p.floatDragStartRef.current = {
          px: pos.x,
          py: pos.y,
          fx: xfMove2 ? xfMove2.x : 0,
          fy: xfMove2 ? xfMove2.y : 0,
        };
      } else {
        p.selectionActionsRef.current.extractFloat(
          p.selectionActiveRef.current,
        );
        const xfAfterExtract = p.xfStateRef.current;
        p.floatDragStartRef.current = {
          px: pos.x,
          py: pos.y,
          fx: xfAfterExtract ? xfAfterExtract.x : 0,
          fy: xfAfterExtract ? xfAfterExtract.y : 0,
        };
      }
      return;
    }

    if (!lc) return;

    p.strokeSnapshotPendingRef.current = false;
    p.strokeDirtyRectRef.current = null;

    if (tool === "fill") {
      cb.handleFillPointerDown(pos, layerId, lc);
      return;
    }

    if (p.tailRafIdRef.current !== null) {
      cancelAnimationFrame(p.tailRafIdRef.current);
      p.tailRafIdRef.current = null;
      if (p.tailDoCommitRef.current) {
        p.tailDoCommitRef.current();
        p.tailDoCommitRef.current = null;
      }
    }
    p.isDrawingRef.current = true;
    p.stabBrushPosRef.current = null;
    p.smoothBufferRef.current = [];
    p.elasticPosRef.current = null;
    p.elasticVelRef.current = { x: 0, y: 0 };
    p.elasticRawPrevRef.current = null;
    p.strokeStampsPlacedRef.current = 0;
    p.distAccumRef.current = 0;
    p.strokeSnapOriginRef.current = pos;
    p.strokeSnapDirRef.current = null;
    p.gridSnapLineRef.current = null;
    p.strokeHvAxisRef.current = null;
    p.strokeHvPivotRef.current = null;
    const startPos = cb.getSnapPosition(pos, pos);
    p.strokeSnapOriginRef.current = startPos;
    p.lastPosRef.current = startPos;
    p.strokeWarmRawDistRef.current = 0;
    resetSmudgeInitialized();
    if (tool === "smudge" && lc) {
      const _smearSnapCtx = lc.getContext("2d", {
        willReadFrequently: !isIPad,
      });
      if (_smearSnapCtx) {
        p.strokeStartSnapshotRef.current = {
          pixels: _smearSnapCtx.getImageData(0, 0, lc.width, lc.height),
          x: 0,
          y: 0,
        };
      }
      p.strokeSnapshotPendingRef.current = false;
      p.strokeDirtyRectRef.current = null;
      // For multi-layer smudge: capture per-layer before-snapshots so pen_up can push
      // a history entry for each affected layer (same pattern as multi-layer liquify).
      const _smudgeSelDown = getEffectivelySelectedLayers(
        p.layerTreeRef.current,
        p.selectedLayerIdsRef.current,
      );
      if (_smudgeSelDown.length > 1) {
        const newSmudgeSnaps = new Map<string, ImageData>();
        for (const layerItem of _smudgeSelDown) {
          const lid2 = layerItem.layer.id;
          const lc2 = p.layerCanvasesRef.current.get(lid2);
          if (!lc2) continue;
          const ctx2 = lc2.getContext("2d", { willReadFrequently: !isIPad });
          if (ctx2) {
            newSmudgeSnaps.set(
              lid2,
              ctx2.getImageData(0, 0, lc2.width, lc2.height),
            );
          }
        }
        p.liquifyMultiBeforeSnapshotsRef.current = newSmudgeSnaps;
      } else {
        p.liquifyMultiBeforeSnapshotsRef.current.clear();
      }
      cb.initSmudgeBuffer(lc, startPos, cb.getActiveSize());
      p.smearDirtyRef.current = false;
      if (p.smearRafRef.current) {
        cancelAnimationFrame(p.smearRafRef.current);
        p.smearRafRef.current = null;
      }
    }
    const liqLcResolved: HTMLCanvasElement | undefined = (() => {
      if (lc) return lc;
      if (tool !== "liquify") return undefined;
      const _eSel = getEffectivelySelectedLayers(
        p.layerTreeRef.current,
        p.selectedLayerIdsRef.current,
      );
      for (const item of _eSel) {
        const _c = p.layerCanvasesRef.current.get(item.layer.id);
        if (_c) return _c;
      }
      return undefined;
    })();

    if (tool === "liquify" && liqLcResolved) {
      const _liqSnapCtx = liqLcResolved.getContext("2d", {
        willReadFrequently: !isIPad,
      });
      if (_liqSnapCtx) {
        const _liqSel = getEffectivelySelectedLayers(
          p.layerTreeRef.current,
          p.selectedLayerIdsRef.current,
        );
        const _liqIsMulti = _liqSel.length > 1;
        if (_liqIsMulti) {
          const newSnapshots = new Map<string, ImageData>();
          for (const layerItem of _liqSel) {
            const lid2 = layerItem.layer.id;
            const lc2 = p.layerCanvasesRef.current.get(lid2);
            if (!lc2) continue;
            const ctx2 = lc2.getContext("2d", { willReadFrequently: !isIPad });
            if (!ctx2) continue;
            newSnapshots.set(
              lid2,
              ctx2.getImageData(0, 0, lc2.width, lc2.height),
            );
          }
          p.liquifyMultiBeforeSnapshotsRef.current = newSnapshots;
          p.liquifyBeforeSnapshotRef.current = null;
        } else {
          p.liquifyBeforeSnapshotRef.current = _liqSnapCtx.getImageData(
            0,
            0,
            liqLcResolved.width,
            liqLcResolved.height,
          );
          p.liquifyMultiBeforeSnapshotsRef.current.clear();
        }
        let snapData: ImageData;
        if (p.liquifyScopeRef.current === "all-visible") {
          const tmpCanvas = document.createElement("canvas");
          tmpCanvas.width = liqLcResolved.width;
          tmpCanvas.height = liqLcResolved.height;
          const tmpCtx = tmpCanvas.getContext("2d")!;
          const ls = p.layersRef.current;
          for (let i = ls.length - 1; i >= 0; i--) {
            const layer = ls[i];
            if (!layer.visible) continue;
            const layerCanvas = p.layerCanvasesRef.current.get(layer.id);
            if (!layerCanvas) continue;
            tmpCtx.globalAlpha = layer.opacity;
            tmpCtx.globalCompositeOperation = (layer.blendMode ||
              "source-over") as GlobalCompositeOperation;
            tmpCtx.drawImage(layerCanvas, 0, 0);
          }
          tmpCtx.globalAlpha = 1;
          tmpCtx.globalCompositeOperation = "source-over";
          snapData = tmpCtx.getImageData(
            0,
            0,
            liqLcResolved.width,
            liqLcResolved.height,
          );
        } else {
          snapData = _liqSnapCtx.getImageData(
            0,
            0,
            liqLcResolved.width,
            liqLcResolved.height,
          );
        }
        initLiquifyField(snapData, liqLcResolved.width, liqLcResolved.height);
      }
      if (p.liquifyHoldIntervalRef.current)
        clearInterval(p.liquifyHoldIntervalRef.current);
    }
    if (p.webglBrushRef.current) {
      p.webglBrushRef.current.clear();
    } else {
      const sbufInit = p.strokeBufferRef.current;
      if (sbufInit)
        sbufInit
          .getContext("2d", { willReadFrequently: !isIPad })
          ?.clearRect(0, 0, sbufInit.width, sbufInit.height);
    }

    cb.buildStrokeCanvases(layerId);
    p.strokeSnapLayerRef.current = lc;
    {
      const _snapCtx = lc.getContext("2d", { willReadFrequently: !isIPad });
      if (_snapCtx) {
        p.strokeStartSnapshotRef.current = {
          pixels: _snapCtx.getImageData(0, 0, lc.width, lc.height),
          x: 0,
          y: 0,
        };
      }
    }

    const ctx = lc.getContext("2d", { willReadFrequently: !isIPad });
    if (ctx) {
      const rawPressure = e.pointerType === "mouse" ? 1.0 : (e.pressure ?? 0.5);
      p.smoothedPressureRef.current = rawPressure;
      p.prevPrimaryPressureRef.current = rawPressure;
      const pressure = p.smoothedPressureRef.current;
      const settings = p.brushSettingsRef.current;
      const baseSize = cb.getActiveSize();
      const baseOpacity = p.brushOpacityRef.current;
      const curvedPressure = evalPressureCurve(
        pressure,
        p.universalPressureCurveRef.current as [number, number, number, number],
      );
      const effectiveSize = settings.pressureSize
        ? baseSize *
          (settings.minSize / 100 +
            (1 - settings.minSize / 100) * curvedPressure)
        : baseSize;
      const flow = settings.flow ?? 1.0;
      // STEP 5: effectiveOpacity is always flow — unconditionally, no pressure gating.
      // Flow controls per-stamp deposit rate regardless of pressure mode.
      // The opacity ceiling is handled by opacityFBO in the WebGL brush engine.
      const effectiveOpacity = (() => {
        if (settings.pressureFlow)
          return (
            flow *
            ((settings.minFlow ?? 0) +
              (1 - (settings.minFlow ?? 0)) * curvedPressure)
          );
        return flow;
      })();
      p.strokeCommitOpacityRef.current = baseOpacity;
      p.lastCompositeOpacityRef.current = settings.pressureOpacity
        ? 1.0
        : baseOpacity;
      p.flushDisplayCapRef.current = settings.pressureOpacity
        ? baseOpacity
        : 1.0;
      const stabMode = settings.stabilizationMode ?? "basic";
      if (
        (stabMode === "basic" ? settings.strokeSmoothing > 0 : true) &&
        (tool === "brush" || tool === "eraser")
      ) {
        const _initStabOpacity = effectiveOpacity;
        // STEP 2d: capAlpha is always numeric — baseOpacity when pressure→opacity is off
        const _initStabCapAlpha = settings.pressureOpacity
          ? curvedPressure * baseOpacity
          : baseOpacity;
        p.stabBrushPosRef.current = {
          ...startPos,
          size: effectiveSize,
          opacity: _initStabOpacity,
          capAlpha: _initStabCapAlpha,
        };
        if (stabMode === "smooth" || stabMode === "smooth+elastic") {
          p.smoothBufferRef.current = [
            {
              x: startPos.x,
              y: startPos.y,
              size: effectiveSize,
              opacity: _initStabOpacity,
              capAlpha: _initStabCapAlpha,
            },
          ];
        }
        if (stabMode === "elastic" || stabMode === "smooth+elastic") {
          p.elasticPosRef.current = { x: startPos.x, y: startPos.y };
          p.elasticVelRef.current = { x: 0, y: 0 };
          p.elasticRawPrevRef.current = { x: startPos.x, y: startPos.y };
        }
      } else {
        const _initCappedOpacity = effectiveOpacity;
        // STEP 2d: capAlpha is always numeric
        const _initCapAlpha = settings.pressureOpacity
          ? curvedPressure * baseOpacity
          : baseOpacity;
        if (tool === "eraser") {
          cb.stampWebGL(
            startPos.x,
            startPos.y,
            effectiveSize,
            _initCappedOpacity,
            settings,
            settings.rotateMode === "follow"
              ? 0
              : (settings.rotation * Math.PI) / 180,
            "rgb(255,255,255)",
            undefined,
            _initCapAlpha,
          );
        } else {
          const _initFillStyle = p.colorFillStyleRef.current;
          cb.stampWebGL(
            startPos.x,
            startPos.y,
            effectiveSize,
            _initCappedOpacity,
            settings,
            settings.rotateMode === "follow"
              ? 0
              : (settings.rotation * Math.PI) / 180,
            _initFillStyle,
            undefined,
            _initCapAlpha,
          );
        }
        p.webglBrushRef.current?.flushDisplay(p.flushDisplayCapRef.current);
        cb.compositeWithStrokePreview(p.lastCompositeOpacityRef.current, tool);
        p.strokeStampsPlacedRef.current = 1;
      }
    }
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: uses refs intentionally
  const handlePointerMove = useCallback((e: PointerEvent) => {
    const isIPad = p.isIPadRef.current;
    p.currentPointerTypeRef.current = e.pointerType;
    p.pointerScreenPosRef.current = { x: e.clientX, y: e.clientY };
    {
      const sc = p.softwareCursorRef.current;
      if (sc) {
        sc.style.left = `${e.clientX}px`;
        sc.style.top = `${e.clientY}px`;
        if (sc.style.display === "none" && !p.cursorBuildingRef.current) {
          p.updateBrushCursorRef.current();
        }
      }
    }
    const cb = callbacksRef.current;
    // Handle crop drag
    if (p.cropDragRef.current && p.isCropActiveRef.current) {
      const drag = p.cropDragRef.current;
      const vt = p.viewTransformRef.current;
      const scaleRatio = 1 / vt.zoom;
      const dx = (e.clientX - drag.startScreenX) * scaleRatio;
      const dy = (e.clientY - drag.startScreenY) * scaleRatio;
      const rad = (-vt.rotation * Math.PI) / 180;
      const cdx = dx * Math.cos(rad) - dy * Math.sin(rad);
      const cdy = dx * Math.sin(rad) + dy * Math.cos(rad);
      const flipCdx = p.isFlippedRef.current ? -cdx : cdx;
      const s = drag.startRect;
      let nx = s.x;
      let ny = s.y;
      let nw = s.w;
      let nh = s.h;
      if (drag.handle === "nw") {
        nx = s.x + flipCdx;
        ny = s.y + cdy;
        nw = s.w - flipCdx;
        nh = s.h - cdy;
      } else if (drag.handle === "n") {
        ny = s.y + cdy;
        nh = s.h - cdy;
      } else if (drag.handle === "ne") {
        ny = s.y + cdy;
        nw = s.w + flipCdx;
        nh = s.h - cdy;
      } else if (drag.handle === "w") {
        nx = s.x + flipCdx;
        nw = s.w - flipCdx;
      } else if (drag.handle === "e") {
        nw = s.w + flipCdx;
      } else if (drag.handle === "sw") {
        nx = s.x + flipCdx;
        nw = s.w - flipCdx;
        nh = s.h + cdy;
      } else if (drag.handle === "s") {
        nh = s.h + cdy;
      } else if (drag.handle === "se") {
        nw = s.w + flipCdx;
        nh = s.h + cdy;
      }
      if (nw < 1) {
        if (drag.handle.includes("w")) nx = s.x + s.w - 1;
        nw = 1;
      }
      if (nh < 1) {
        if (drag.handle.includes("n")) ny = s.y + s.h - 1;
        nh = 1;
      }
      p.cropRectRef.current = { x: nx, y: ny, w: nw, h: nh };
      cb.setCropRectVersion((v) => v + 1);
      return;
    }

    if (p.isBrushSizeAdjustingRef.current) {
      const deltaX = e.clientX - p.brushSizeAdjustStartXRef.current;
      const newSize = Math.max(
        1,
        Math.round(p.brushSizeAdjustOriginRef.current + deltaX),
      );
      if (p.activeToolRef.current === "liquify") {
        cb.setLiquifySize(newSize);
        p.liquifySizeRef.current = newSize;
      } else {
        const sizeKey =
          p.activeToolRef.current === "eraser" ? "eraser" : "brush";
        cb.setBrushSizes((prev) => ({ ...prev, [sizeKey]: newSize }));
        p.toolSizesRef.current[p.activeToolRef.current] = newSize;
      }
      if (p.brushSizeOverlayRef.current) {
        const screenSize = newSize * p.viewTransformRef.current.zoom;
        cb.drawBrushTipOverlay(
          p.brushSizeOverlayRef.current,
          Math.max(2, screenSize),
        );
      }
      return;
    }
    if (p.isZoomDraggingRef.current) {
      const deltaX = e.clientX - p.zoomDragStartXRef.current;
      const newZoom = Math.min(
        20,
        Math.max(0.05, p.zoomDragOriginRef.current * Math.exp(deltaX * 0.005)),
      );
      const zoomRatio = newZoom / p.zoomDragOriginRef.current;
      const cx = p.zoomDragCursorStartRef.current.x;
      const cy = p.zoomDragCursorStartRef.current.y;
      const newPanX = cx - (cx - p.zoomDragPanOriginRef.current.x) * zoomRatio;
      const newPanY = cy - (cy - p.zoomDragPanOriginRef.current.y) * zoomRatio;
      cb.applyTransformToDOM({
        ...p.viewTransformRef.current,
        zoom: newZoom,
        panX: newPanX,
        panY: newPanY,
      });
      return;
    }
    if (p.isPanningRef.current) {
      const dx = e.clientX - p.panStartRef.current.x;
      const dy = e.clientY - p.panStartRef.current.y;
      cb.applyTransformToDOM({
        ...p.viewTransformRef.current,
        panX: p.panOriginRef.current.x + dx,
        panY: p.panOriginRef.current.y + dy,
      });
      return;
    }
    if (p.isRotatingRef.current) {
      const center = p.rotCenterRef.current;
      const currentAngle =
        Math.atan2(e.clientY - center.y, e.clientX - center.x) *
        (180 / Math.PI);
      let delta = currentAngle - p.rotAngleOriginRef.current;
      while (delta > 180) delta -= 360;
      while (delta < -180) delta += 360;
      const flipSign = p.isFlippedRef.current ? -1 : 1;
      const newRotation = p.rotOriginRef.current + delta * flipSign;
      const snappedRotation = p.shiftHeldRef.current
        ? Math.round(newRotation / 15) * 15
        : newRotation;
      const rad = (snappedRotation * Math.PI) / 180;
      const z = p.viewTransformRef.current.zoom;
      const cp = p.rotDragCanvasPointRef.current;
      const cpLocalX = cp.x - p.canvasWidthRef.current / 2;
      const cpLocalY = cp.y - p.canvasHeightRef.current / 2;
      const _pivotFlip = p.isFlippedRef.current ? -1 : 1;
      const rotX =
        _pivotFlip * (cpLocalX * Math.cos(rad) - cpLocalY * Math.sin(rad)) * z;
      const rotY = (cpLocalX * Math.sin(rad) + cpLocalY * Math.cos(rad)) * z;
      const cx = p.rotDragCursorRef.current.x;
      const cy = p.rotDragCursorRef.current.y;
      cb.applyTransformToDOM({
        ...p.viewTransformRef.current,
        rotation: snappedRotation,
        panX: cx - rotX,
        panY: cy - rotY,
      });
      return;
    }

    // Handle gradient fill drag preview and lasso fill drawing
    if (p.isGradientDraggingRef.current || p.isLassoFillDrawingRef.current) {
      const display2f = p.displayCanvasRef.current;
      const container2f = p.containerRef.current;
      if (display2f && container2f) {
        const consumed = cb.handleFillPointerMove(e, (cx, cy) =>
          _getCanvasPosTransformed(
            cx,
            cy,
            container2f,
            display2f,
            p.viewTransformRef.current,
            p.isFlippedRef.current,
          ),
        );
        if (consumed) return;
      }
    }

    // Handle ruler drag
    const rh = cb.rulerHandlers;
    if (
      rh.isLineRulerDragging() ||
      rh.is1pt2ptRulerDragging() ||
      rh.is3ptExclusiveDragging() ||
      rh.is5ptDragging() ||
      rh.isOvalDragging() ||
      rh.isGridDragging()
    ) {
      const dispRuler = p.displayCanvasRef.current;
      const contRuler = p.containerRef.current;
      if (!dispRuler || !contRuler) return;
      const posRuler = _getCanvasPosTransformed(
        e.clientX,
        e.clientY,
        contRuler,
        dispRuler,
        p.viewTransformRef.current,
        p.isFlippedRef.current,
      );
      const rulerLayerDrag = p.layersRef.current.find((l) => l.isRuler);
      if (rulerLayerDrag) {
        rh.handleLineRulerPointerMove(posRuler, rulerLayerDrag);
        rh.handle1pt2ptRulerPointerMove(posRuler, rulerLayerDrag);
        rh.handle3ptExclusivePointerMove(posRuler, rulerLayerDrag);
        rh.handle5ptRulerPointerMove(posRuler, rulerLayerDrag);
        rh.handleOvalRulerPointerMove(posRuler, rulerLayerDrag);
        rh.handleGridRulerPointerMove(posRuler, rulerLayerDrag);
        cb.scheduleRulerOverlay();
      }
      return;
    }

    // Update eyedropper cursor on move
    if (p.activeToolRef.current === "eyedropper") {
      const displayEd = p.displayCanvasRef.current;
      const containerEd = p.containerRef.current;
      if (displayEd && containerEd) {
        const posEd = _getCanvasPosTransformed(
          e.clientX,
          e.clientY,
          containerEd,
          displayEd,
          p.viewTransformRef.current,
          p.isFlippedRef.current,
        );
        const px = Math.round(
          Math.max(0, Math.min(posEd.x, displayEd.width - 1)),
        );
        const py = Math.round(
          Math.max(0, Math.min(posEd.y, displayEd.height - 1)),
        );
        p.eyedropperHoverColorRef.current = cb.sampleEyedropperColor(px, py);
        cb.updateEyedropperCursorRef.current();
      }
      return;
    }

    // Handle lasso drawing
    if (
      p.isDrawingSelectionRef.current &&
      p.activeToolRef.current === "lasso"
    ) {
      const display2 = p.displayCanvasRef.current;
      const container2 = p.containerRef.current;
      if (!display2 || !container2) return;
      const pos2 = _getCanvasPosTransformed(
        e.clientX,
        e.clientY,
        container2,
        display2,
        p.viewTransformRef.current,
        p.isFlippedRef.current,
      );
      const mode = p.lassoModeRef.current;
      if (mode === "rect" || mode === "ellipse") {
        const sb = p.selectionDraftBoundsRef.current;
        if (sb) {
          sb.ex = pos2.x;
          sb.ey = pos2.y;
        }
      } else if (mode !== "wand") {
        if (!p.lassoIsDraggingRef.current && p.lassoStrokeStartRef.current) {
          const sx = p.lassoStrokeStartRef.current.x;
          const sy = p.lassoStrokeStartRef.current.y;
          const d = Math.sqrt((pos2.x - sx) ** 2 + (pos2.y - sy) ** 2);
          if (d > 8) {
            p.lassoIsDraggingRef.current = true;
            const pts = p.selectionDraftPointsRef.current;
            const last = pts[pts.length - 1];
            if (!last || last.x !== sx || last.y !== sy)
              p.selectionDraftPointsRef.current.push({ x: sx, y: sy });
          }
        }
        if (p.lassoIsDraggingRef.current) {
          const _containerRect2 = container2.getBoundingClientRect();
          const _rawLasso = e.getCoalescedEvents?.();
          const lassoEvents =
            _rawLasso && _rawLasso.length > 0 ? _rawLasso : [e];
          for (const le of lassoEvents) {
            const lePos = _getCanvasPosWithRect(
              le.clientX,
              le.clientY,
              _containerRect2,
              display2,
              p.viewTransformRef.current,
              p.isFlippedRef.current,
            );
            const _lfLast = p.lassoFreeLastPtRef.current;
            const _lfDx = _lfLast ? lePos.x - _lfLast.x : 2;
            const _lfDy = _lfLast ? lePos.y - _lfLast.y : 2;
            if (Math.sqrt(_lfDx * _lfDx + _lfDy * _lfDy) >= 1) {
              p.selectionDraftPointsRef.current.push({
                x: lePos.x,
                y: lePos.y,
              });
              p.lassoFreeLastPtRef.current = { x: lePos.x, y: lePos.y };
            }
          }
        } else {
          p.selectionDraftCursorRef.current = { x: pos2.x, y: pos2.y };
          const pts2 = p.selectionDraftPointsRef.current;
          if (pts2.length > 2) {
            const fp = pts2[0];
            const dc = Math.sqrt((pos2.x - fp.x) ** 2 + (pos2.y - fp.y) ** 2);
            p.selectionPolyClosingRef.current = dc < 12;
          }
        }
      }
      return;
    }

    // Handle move/transform dragging.
    // Allow drag for both single-layer (moveFloatCanvasRef set) and multi-layer
    // (moveFloatCanvasRef is null; isDraggingFloatRef is the authoritative flag).
    if (
      (p.activeToolRef.current === "move" ||
        p.activeToolRef.current === "transform") &&
      p.floatDragStartRef.current &&
      p.isDraggingFloatRef.current
    ) {
      const display3 = p.displayCanvasRef.current;
      const container3 = p.containerRef.current;
      if (!display3 || !container3) return;
      const pos3 = _getCanvasPosTransformed(
        e.clientX,
        e.clientY,
        container3,
        display3,
        p.viewTransformRef.current,
        p.isFlippedRef.current,
      );
      const drag = p.floatDragStartRef.current;
      const dx = pos3.x - drag.px;
      const dy = pos3.y - drag.py;
      if (
        (p.activeToolRef.current === "transform" ||
          p.activeToolRef.current === "move") &&
        p.transformHandleRef.current &&
        p.transformHandleRef.current !== "move"
      ) {
        const handle = p.transformHandleRef.current;
        const ob = p.moveFloatOriginBoundsRef.current;
        if (!ob) return;
        if (handle === "rot") {
          const xfRot = p.xfStateRef.current;
          if (!xfRot) return;
          const cx = xfRot.x + xfRot.w / 2;
          const cy = xfRot.y + xfRot.h / 2;
          const startAngle = Math.atan2(drag.py - cy, drag.px - cx);
          const curAngle = Math.atan2(pos3.y - cy, pos3.x - cx);
          const initRot = drag.initRotation ?? 0;
          const angle = curAngle - startAngle + initRot;
          p.xfStateRef.current = { ...xfRot, rotation: angle };
        } else {
          const origBounds = drag.origBounds;
          if (!origBounds) return;
          const rawDx = pos3.x - drag.px;
          const rawDy = pos3.y - drag.py;
          const scaleRot = p.xfStateRef.current?.rotation ?? 0;
          let dx2: number;
          let dy2: number;
          if (scaleRot !== 0) {
            const cosR = Math.cos(-scaleRot);
            const sinR = Math.sin(-scaleRot);
            dx2 = rawDx * cosR - rawDy * sinR;
            dy2 = rawDx * sinR + rawDy * cosR;
          } else {
            dx2 = rawDx;
            dy2 = rawDy;
          }
          let newX = origBounds.x;
          let newY = origBounds.y;
          let newW = origBounds.w;
          let newH = origBounds.h;
          if (handle === "nw") {
            newX = origBounds.x + dx2;
            newY = origBounds.y + dy2;
            newW = origBounds.w - dx2;
            newH = origBounds.h - dy2;
          } else if (handle === "ne") {
            newY = origBounds.y + dy2;
            newW = origBounds.w + dx2;
            newH = origBounds.h - dy2;
          } else if (handle === "sw") {
            newX = origBounds.x + dx2;
            newW = origBounds.w - dx2;
            newH = origBounds.h + dy2;
          } else if (handle === "se") {
            newW = origBounds.w + dx2;
            newH = origBounds.h + dy2;
          } else if (handle === "n") {
            newY = origBounds.y + dy2;
            newH = origBounds.h - dy2;
          } else if (handle === "s") {
            newH = origBounds.h + dy2;
          } else if (handle === "w") {
            newX = origBounds.x + dx2;
            newW = origBounds.w - dx2;
          } else if (handle === "e") {
            newW = origBounds.w + dx2;
          }
          if (e.shiftKey && origBounds.w > 0 && origBounds.h > 0) {
            const aspect = origBounds.w / origBounds.h;
            if (
              Math.abs(newW - origBounds.w) >= Math.abs(newH - origBounds.h)
            ) {
              newH = newW / aspect;
              if (handle === "nw" || handle === "n")
                newY = origBounds.y + origBounds.h - newH;
            } else {
              newW = newH * aspect;
              if (handle === "nw" || handle === "w")
                newX = origBounds.x + origBounds.w - newW;
            }
          }
          const MIN = 10;
          if (newW < MIN) {
            if (handle === "nw" || handle === "w" || handle === "sw")
              newX = origBounds.x + origBounds.w - MIN;
            newW = MIN;
          }
          if (newH < MIN) {
            if (handle === "nw" || handle === "n" || handle === "ne")
              newY = origBounds.y + origBounds.h - MIN;
            newH = MIN;
          }
          const xfScale = p.xfStateRef.current;
          p.xfStateRef.current = {
            x: newX,
            y: newY,
            w: newW,
            h: newH,
            rotation: xfScale ? xfScale.rotation : 0,
          };
        }
      } else {
        const xfMv = p.xfStateRef.current;
        p.xfStateRef.current = {
          x: drag.fx + dx,
          y: drag.fy + dy,
          w: xfMv
            ? xfMv.w
            : (p.moveFloatOriginBoundsRef.current?.w ??
              p.canvasWidthRef.current),
          h: xfMv
            ? xfMv.h
            : (p.moveFloatOriginBoundsRef.current?.h ??
              p.canvasHeightRef.current),
          rotation: xfMv ? xfMv.rotation : 0,
        };
      }
      cb.scheduleComposite();
      return;
    }

    if (!p.isDrawingRef.current) return;
    const display = p.displayCanvasRef.current;
    const container = p.containerRef.current;
    if (!display || !container) return;

    const pos = _getCanvasPosTransformed(
      e.clientX,
      e.clientY,
      container,
      display,
      p.viewTransformRef.current,
      p.isFlippedRef.current,
    );
    const prev = p.lastPosRef.current;
    if (!prev) {
      p.lastPosRef.current = pos;
      return;
    }

    const tool = p.activeToolRef.current;
    const layerId = p.activeLayerIdRef.current;
    const lc = p.layerCanvasesRef.current.get(layerId);
    if (!lc) return;

    const _dx = pos.x - prev.x;
    const _dy = pos.y - prev.y;
    const _dist = Math.sqrt(_dx * _dx + _dy * _dy);
    void _dist;

    const settings = p.brushSettingsRef.current;
    const smoothing = settings.strokeSmoothing;
    const activeSize = cb.getActiveSize();

    if (tool === "smudge") {
      // Bug 1 fix: resolve multi-layer selection so smudge applies to all selected layers
      const _smudgeSel = getEffectivelySelectedLayers(
        p.layerTreeRef.current,
        p.selectedLayerIdsRef.current,
      );
      const _isSmudgeMulti = _smudgeSel.length > 1;

      const _rawCoalescedSmear = e.getCoalescedEvents?.();
      const smearCoalescedEvents: PointerEvent[] =
        _rawCoalescedSmear && _rawCoalescedSmear.length > 0
          ? _rawCoalescedSmear
          : [e];
      const _smearContainerRect = container.getBoundingClientRect();
      const _smearXform = p.viewTransformRef.current;
      const _smearFlipped = p.isFlippedRef.current;
      const baseStrength = settings.smearStrength ?? 0.8;
      const _smearPrevPrimary = p.prevPrimaryPressureRef.current;
      const _smearCurrentPrimary = e.pressure > 0 ? e.pressure : 0.5;
      for (let i = 0; i < smearCoalescedEvents.length; i++) {
        const sce = smearCoalescedEvents[i];
        const scePos = _getCanvasPosWithRect(
          sce.clientX,
          sce.clientY,
          _smearContainerRect,
          display,
          _smearXform,
          _smearFlipped,
        );
        const _smearT =
          smearCoalescedEvents.length > 1
            ? i / (smearCoalescedEvents.length - 1)
            : 1;
        const rawSmearPressure =
          sce.pointerType === "mouse"
            ? 1.0
            : _smearPrevPrimary +
              (_smearCurrentPrimary - _smearPrevPrimary) * _smearT;
        p.smoothedPressureRef.current =
          p.smoothedPressureRef.current * (1 - PRESSURE_SMOOTHING) +
          rawSmearPressure * PRESSURE_SMOOTHING;
        const smearPressure = p.smoothedPressureRef.current;
        const effectiveSmearStrength = settings.pressureStrength
          ? (settings.minStrength ?? 0) +
            (1 - (settings.minStrength ?? 0)) * smearPressure
          : baseStrength;
        p.rawStylusPosRef.current = { ...scePos, size: activeSize, opacity: 1 };
        if (smoothing > 0) {
          const settlingRadius = (smoothing / 100) ** 2 * 50;
          const stab = p.stabBrushPosRef.current;
          if (!stab) {
            p.stabBrushPosRef.current = {
              ...scePos,
              size: activeSize,
              opacity: 1,
            };
          } else {
            const sdx = scePos.x - stab.x;
            const sdy = scePos.y - stab.y;
            const sDist = Math.sqrt(sdx * sdx + sdy * sdy);
            if (sDist > settlingRadius) {
              const newStab = {
                x: scePos.x - (sdx / sDist) * settlingRadius,
                y: scePos.y - (sdy / sDist) * settlingRadius,
                size: activeSize,
                opacity: 1 as number,
              };
              if (_isSmudgeMulti) {
                for (const layerItem of _smudgeSel) {
                  const _smearLc = p.layerCanvasesRef.current.get(
                    layerItem.layer.id,
                  );
                  if (_smearLc) {
                    cb.renderSmearAlongPoints(
                      _smearLc,
                      [stab, newStab],
                      activeSize,
                      settings,
                      effectiveSmearStrength,
                    );
                    // Invalidate bitmap cache so compositor re-reads live canvas on next frame
                    markLayerBitmapDirty(layerItem.layer.id);
                  }
                }
              } else {
                cb.renderSmearAlongPoints(
                  lc,
                  [stab, newStab],
                  activeSize,
                  settings,
                  effectiveSmearStrength,
                );
              }
              p.stabBrushPosRef.current = newStab;
              p.lastPosRef.current = newStab;
            }
          }
        } else {
          const scePrev = p.lastPosRef.current;
          if (scePrev) {
            const sceDist = Math.sqrt(
              (scePos.x - scePrev.x) ** 2 + (scePos.y - scePrev.y) ** 2,
            );
            if (sceDist > 0.5) {
              if (_isSmudgeMulti) {
                for (const layerItem of _smudgeSel) {
                  const _smearLc = p.layerCanvasesRef.current.get(
                    layerItem.layer.id,
                  );
                  if (_smearLc) {
                    cb.renderSmearAlongPoints(
                      _smearLc,
                      [scePrev, scePos],
                      activeSize,
                      settings,
                      effectiveSmearStrength,
                    );
                    // Invalidate bitmap cache so compositor re-reads live canvas on next frame
                    markLayerBitmapDirty(layerItem.layer.id);
                  }
                }
              } else {
                cb.renderSmearAlongPoints(
                  lc,
                  [scePrev, scePos],
                  activeSize,
                  settings,
                  effectiveSmearStrength,
                );
              }
            }
            p.lastPosRef.current = scePos;
          }
        }
      }
      p.prevPrimaryPressureRef.current = _smearCurrentPrimary;
      p.smearDirtyRef.current = true;
      if (!p.smearRafRef.current) {
        p.smearRafRef.current = requestAnimationFrame(() => {
          p.smearRafRef.current = null;
          if (p.smearDirtyRef.current) {
            p.smearDirtyRef.current = false;
            const _smearDR = p.strokeDirtyRectRef.current;
            const _smearBrushSize = cb.getActiveSize();
            const _smearPad = Math.ceil(Math.max(_smearBrushSize / 2, 4));
            const _smearDisplay = p.displayCanvasRef.current;
            if (_smearDR && _smearDisplay) {
              const _sx = Math.max(0, Math.floor(_smearDR.minX) - _smearPad);
              const _sy = Math.max(0, Math.floor(_smearDR.minY) - _smearPad);
              const _sx2 = Math.min(
                _smearDisplay.width,
                Math.ceil(_smearDR.maxX) + _smearPad,
              );
              const _sy2 = Math.min(
                _smearDisplay.height,
                Math.ceil(_smearDR.maxY) + _smearPad,
              );
              cb.composite();
            } else {
              cb.composite();
            }
          }
        });
      }
    } else if (tool === "liquify") {
      const _liqMoveSel2 = getEffectivelySelectedLayers(
        p.layerTreeRef.current,
        p.selectedLayerIdsRef.current,
      );
      let liqLc = p.layerCanvasesRef.current.get(layerId);
      if (!liqLc && _liqMoveSel2.length > 0) {
        liqLc = p.layerCanvasesRef.current.get(_liqMoveSel2[0].layer.id);
      }
      if (liqLc) {
        const liqCtx = liqLc.getContext("2d", { willReadFrequently: !isIPad });
        if (liqCtx) {
          const coalescedEvents = e.getCoalescedEvents?.();
          const evts: PointerEvent[] =
            coalescedEvents && coalescedEvents.length > 0
              ? coalescedEvents
              : [e];
          const containerRect = container.getBoundingClientRect();
          const _liqMoveSel = _liqMoveSel2;
          const _liqMoveIsMulti =
            _liqMoveSel.length > 1 &&
            p.liquifyMultiBeforeSnapshotsRef.current.size > 1;
          for (const ce of evts) {
            const cePos = _getCanvasPosWithRect(
              ce.clientX,
              ce.clientY,
              containerRect,
              display,
              p.viewTransformRef.current,
              p.isFlippedRef.current,
            );
            const cePrev = p.lastPosRef.current;
            if (cePrev) {
              const ddx = cePos.x - cePrev.x;
              const ddy = cePos.y - cePrev.y;
              const ddist = Math.sqrt(ddx * ddx + ddy * ddy);
              const radius = p.liquifySizeRef.current / 2;
              const spacing = Math.max(1, radius * 0.04);
              if (ddist >= spacing) {
                const ndx = ddist > 0 ? ddx / ddist : 0;
                const ndy = ddist > 0 ? ddy / ddist : 0;
                updateLiquifyDisplacementField(
                  cePos.x,
                  cePos.y,
                  radius,
                  p.liquifyStrengthRef.current * 0.6,
                  ndx,
                  ndy,
                );
                if (_liqMoveIsMulti) {
                  // BUG_4 FIX: displacement field is computed once above, then applied to
                  // each layer using its own per-stroke snapshot. We collect all layer
                  // renders first, then trigger a SINGLE composite at the very end —
                  // never between layers, which is what caused the jumping artifact.
                  const savedSnapshot = getLiquifySnapshot();
                  for (const layerItem of _liqMoveSel) {
                    const lid2 = layerItem.layer.id;
                    const lc2 = p.layerCanvasesRef.current.get(lid2);
                    if (!lc2) continue;
                    const ctx2 = lc2.getContext("2d", {
                      willReadFrequently: !isIPad,
                    });
                    if (!ctx2) continue;
                    const perSnap =
                      p.liquifyMultiBeforeSnapshotsRef.current.get(lid2);
                    if (perSnap) {
                      setLiquifySnapshot(perSnap);
                      renderLiquifyFromSnapshot(ctx2);
                    }
                  }
                  // Restore to the original all-layers snapshot (not per-layer)
                  setLiquifySnapshot(savedSnapshot);
                } else {
                  renderLiquifyFromSnapshot(liqCtx);
                }
                p.lastPosRef.current = cePos;
              }
            } else {
              p.lastPosRef.current = cePos;
            }
          }
          cb.scheduleComposite();
        }
      }
    } else if (tool === "brush" || tool === "eraser") {
      const ctx = lc.getContext("2d", { willReadFrequently: !isIPad });
      if (!ctx) return;
      const _rawCoalesced = e.getCoalescedEvents?.();
      const coalescedEvents: PointerEvent[] =
        _rawCoalesced && _rawCoalesced.length > 0 ? _rawCoalesced : [e];
      const _containerRect = container.getBoundingClientRect();
      const _xform = p.viewTransformRef.current;
      const _flipped = p.isFlippedRef.current;
      let anyWork = false;
      let stabMoved = false;
      const _cumulDirty = {
        minX: Number.POSITIVE_INFINITY,
        minY: Number.POSITIVE_INFINITY,
        maxX: Number.NEGATIVE_INFINITY,
        maxY: Number.NEGATIVE_INFINITY,
      };
      const _prevPrimary = p.prevPrimaryPressureRef.current;
      const _currentPrimary = e.pressure > 0 ? e.pressure : 0.5;
      for (let i = 0; i < coalescedEvents.length; i++) {
        const ce = coalescedEvents[i];
        let cePos = _getCanvasPosWithRect(
          ce.clientX,
          ce.clientY,
          _containerRect,
          display,
          _xform,
          _flipped,
        );
        if (p.strokeSnapOriginRef.current)
          cePos = cb.getSnapPosition(cePos, p.strokeSnapOriginRef.current);
        const cePrev = p.lastPosRef.current;
        if (!cePrev) {
          p.lastPosRef.current = cePos;
          continue;
        }
        const ceDx = cePos.x - cePrev.x;
        const ceDy = cePos.y - cePrev.y;
        const ceDist = Math.sqrt(ceDx * ceDx + ceDy * ceDy);
        p.strokeWarmRawDistRef.current += ceDist;
        const _brushT =
          coalescedEvents.length > 1 ? i / (coalescedEvents.length - 1) : 1;
        const rawPressure =
          ce.pointerType === "mouse"
            ? 1.0
            : _prevPrimary + (_currentPrimary - _prevPrimary) * _brushT;
        p.smoothedPressureRef.current =
          p.smoothedPressureRef.current * (1 - PRESSURE_SMOOTHING) +
          rawPressure * PRESSURE_SMOOTHING;
        const pressure = p.smoothedPressureRef.current;
        const baseSize = activeSize;
        const baseOpacity = p.brushOpacityRef.current;
        const curvedPressure = evalPressureCurve(
          pressure,
          p.universalPressureCurveRef.current as [
            number,
            number,
            number,
            number,
          ],
        );
        const effectiveSize = settings.pressureSize
          ? baseSize *
            (settings.minSize / 100 +
              (1 - settings.minSize / 100) * curvedPressure)
          : baseSize;
        const flow = settings.flow ?? 1.0;
        // STEP 5: cappedOpacity is always flow — unconditionally, no pressure gating.
        const cappedOpacity = (() => {
          if (settings.pressureFlow)
            return (
              flow *
              ((settings.minFlow ?? 0) +
                (1 - (settings.minFlow ?? 0)) * curvedPressure)
            );
          return flow;
        })();
        p.strokeCommitOpacityRef.current = baseOpacity;
        p.lastCompositeOpacityRef.current = settings.pressureOpacity
          ? 1.0
          : baseOpacity;
        p.flushDisplayCapRef.current = settings.pressureOpacity
          ? baseOpacity
          : 1.0;
        // STEP 2d: _moveCapAlpha is always numeric
        const _moveCapAlpha = settings.pressureOpacity
          ? curvedPressure * baseOpacity
          : baseOpacity;
        const sbufCtxMove = p.strokeBufferRef.current?.getContext("2d", {
          willReadFrequently: !isIPad,
        });
        const _moveFillStyle = p.colorFillStyleRef.current;
        if (sbufCtxMove) {
          if (tool === "eraser") {
            sbufCtxMove.fillStyle = "rgba(0,0,0,1)";
          } else {
            sbufCtxMove.fillStyle = _moveFillStyle;
          }
          sbufCtxMove.globalCompositeOperation = "source-over";
        }
        p.rawStylusPosRef.current = {
          ...cePos,
          size: effectiveSize,
          opacity: cappedOpacity,
          capAlpha: _moveCapAlpha,
        };
        const effectiveSmoothing = smoothing;
        const _stabMode = settings.stabilizationMode ?? "basic";
        const _renderStabSegment = (from: StrokePoint, to: StrokePoint) => {
          const _segCtx2 =
            sbufCtxMove ??
            ({
              fillStyle: _moveFillStyle,
            } as unknown as CanvasRenderingContext2D);
          cb.renderBrushSegmentAlongPoints(
            _segCtx2,
            [from, to],
            from.size,
            to.size,
            from.opacity,
            to.opacity,
            settings,
            tool,
            true,
            to.capAlpha,
          );
          stabMoved = true;
          p.strokeStampsPlacedRef.current++;
          p.stabBrushPosRef.current = to;
          p.lastPosRef.current = to;
        };
        if (_stabMode === "basic" && effectiveSmoothing > 0) {
          const settlingRadius = (effectiveSmoothing / 100) ** 2 * 50;
          const stab = p.stabBrushPosRef.current;
          if (!stab) {
            p.stabBrushPosRef.current = {
              ...cePos,
              size: effectiveSize,
              opacity: cappedOpacity,
              capAlpha: _moveCapAlpha,
            };
          } else {
            const sdx = cePos.x - stab.x;
            const sdy = cePos.y - stab.y;
            const sDist = Math.sqrt(sdx * sdx + sdy * sdy);
            if (sDist > settlingRadius) {
              const newStab: StrokePoint = {
                x: cePos.x - (sdx / sDist) * settlingRadius,
                y: cePos.y - (sdy / sDist) * settlingRadius,
                size: effectiveSize,
                opacity: cappedOpacity,
                capAlpha: _moveCapAlpha,
              };
              _renderStabSegment(stab, newStab);
            }
          }
        } else if (_stabMode === "smooth" || _stabMode === "smooth+elastic") {
          const bufSize = Math.max(
            2,
            Math.round(2 + (settings.smoothStrength ?? 5) * 1.0),
          );
          p.smoothBufferRef.current.push({
            x: cePos.x,
            y: cePos.y,
            size: effectiveSize,
            opacity: cappedOpacity,
            capAlpha: _moveCapAlpha,
          });
          if (p.smoothBufferRef.current.length > bufSize)
            p.smoothBufferRef.current = p.smoothBufferRef.current.slice(
              -bufSize,
            );
          const n = p.smoothBufferRef.current.length;
          const avgX =
            p.smoothBufferRef.current.reduce((s, pt) => s + pt.x, 0) / n;
          const avgY =
            p.smoothBufferRef.current.reduce((s, pt) => s + pt.y, 0) / n;
          let effectivePos = { x: avgX, y: avgY };
          if (_stabMode === "smooth+elastic") {
            const tension =
              Math.max(0.01, (settings.elasticStrength ?? 20) / 100) * 0.3;
            const vel = p.elasticVelRef.current;
            let sp = p.elasticPosRef.current ?? effectivePos;
            const prevRaw = p.elasticRawPrevRef.current ?? effectivePos;
            const SUB_STEPS = 8;
            for (let _si = 0; _si < SUB_STEPS; _si++) {
              const t = (_si + 1) / SUB_STEPS;
              const targetX = prevRaw.x + (effectivePos.x - prevRaw.x) * t;
              const targetY = prevRaw.y + (effectivePos.y - prevRaw.y) * t;
              vel.x = (vel.x + (targetX - sp.x) * tension) * 0.75;
              vel.y = (vel.y + (targetY - sp.y) * tension) * 0.75;
              sp = { x: sp.x + vel.x, y: sp.y + vel.y };
            }
            p.elasticPosRef.current = sp;
            p.elasticRawPrevRef.current = {
              x: effectivePos.x,
              y: effectivePos.y,
            };
            effectivePos = sp;
          }
          const stab = p.stabBrushPosRef.current;
          if (!stab) {
            p.stabBrushPosRef.current = {
              ...effectivePos,
              size: effectiveSize,
              opacity: cappedOpacity,
              capAlpha: _moveCapAlpha,
            };
          } else {
            const dx2 = effectivePos.x - stab.x;
            const dy2 = effectivePos.y - stab.y;
            if (Math.sqrt(dx2 * dx2 + dy2 * dy2) > 0.5) {
              const newStab: StrokePoint = {
                ...effectivePos,
                size: effectiveSize,
                opacity: cappedOpacity,
                capAlpha: _moveCapAlpha,
              };
              _renderStabSegment(stab, newStab);
            }
          }
        } else if (_stabMode === "elastic") {
          const tension =
            Math.max(0.01, (settings.elasticStrength ?? 20) / 100) * 0.3;
          const vel = p.elasticVelRef.current;
          let sp = p.elasticPosRef.current ?? { x: cePos.x, y: cePos.y };
          const prevRaw = p.elasticRawPrevRef.current ?? {
            x: cePos.x,
            y: cePos.y,
          };
          const SUB_STEPS = 8;
          for (let _si = 0; _si < SUB_STEPS; _si++) {
            const t = (_si + 1) / SUB_STEPS;
            const targetX = prevRaw.x + (cePos.x - prevRaw.x) * t;
            const targetY = prevRaw.y + (cePos.y - prevRaw.y) * t;
            vel.x = (vel.x + (targetX - sp.x) * tension) * 0.75;
            vel.y = (vel.y + (targetY - sp.y) * tension) * 0.75;
            sp = { x: sp.x + vel.x, y: sp.y + vel.y };
          }
          p.elasticRawPrevRef.current = { x: cePos.x, y: cePos.y };
          p.elasticPosRef.current = sp;
          const newSp = sp;
          const stab = p.stabBrushPosRef.current;
          if (!stab) {
            p.stabBrushPosRef.current = {
              x: newSp.x,
              y: newSp.y,
              size: effectiveSize,
              opacity: cappedOpacity,
              capAlpha: _moveCapAlpha,
            };
          } else {
            const dx3 = newSp.x - stab.x;
            const dy3 = newSp.y - stab.y;
            if (Math.sqrt(dx3 * dx3 + dy3 * dy3) > 0.5) {
              const newStab: StrokePoint = {
                x: newSp.x,
                y: newSp.y,
                size: effectiveSize,
                opacity: cappedOpacity,
                capAlpha: _moveCapAlpha,
              };
              _renderStabSegment(stab, newStab);
            }
          }
        } else {
          const _spacingSoftness = settings.softness ?? 0;
          const _spacingFlow = cappedOpacity;
          const _softFactor =
            _spacingSoftness > 0.5
              ? 1.0 -
                (_spacingSoftness - 0.5) *
                  2.0 *
                  (1.0 - Math.max(0.35, _spacingFlow))
              : 1.0;
          const spacingPixels = Math.max(
            1,
            ((settings.spacing / 100) * effectiveSize * _softFactor) /
              (settings.count ?? 1),
          );
          const strokeAngle = Math.atan2(ceDy, ceDx);
          let accdist = p.distAccumRef.current + ceDist;
          let stampsPlaced = 0;
          const _moveDirtyNS = {
            minX: Number.POSITIVE_INFINITY,
            minY: Number.POSITIVE_INFINITY,
            maxX: Number.NEGATIVE_INFINITY,
            maxY: Number.NEGATIVE_INFINITY,
          };
          while (accdist >= spacingPixels) {
            const distFromPrev =
              (stampsPlaced + 1) * spacingPixels - p.distAccumRef.current;
            const t = ceDist > 0 ? distFromPrev / ceDist : 0;
            const sx = cePrev.x + ceDx * t;
            const sy = cePrev.y + ceDy * t;
            {
              const _countB = settings.count ?? 1;
              for (let _ciB = 0; _ciB < _countB; _ciB++) {
                const _scatter = settings.scatter ?? 0;
                const _sizeJitter = settings.sizeJitter ?? 0;
                const _colorJitter3 = settings.colorJitter ?? 0;
                const _rotationJitter3 = settings.rotationJitter ?? 0;
                const _flowJitter3 = settings.flowJitter ?? 0;
                const _stampX = sx + (Math.random() - 0.5) * 2 * _scatter;
                const _stampY = sy + (Math.random() - 0.5) * 2 * _scatter;
                const _stampSize =
                  effectiveSize * (1 + (Math.random() - 0.5) * _sizeJitter);
                const _rotJitterRad3 =
                  (_rotationJitter3 / 2) *
                  (Math.PI / 180) *
                  (Math.random() - 0.5) *
                  2;
                const _flowJitterVal3 =
                  (_flowJitter3 / 100) *
                  cappedOpacity *
                  (Math.random() - 0.5) *
                  2;
                const _stampOpacity3 = Math.max(
                  0,
                  Math.min(1, cappedOpacity + _flowJitterVal3),
                );
                const _baseAngle3 =
                  settings.rotateMode === "follow"
                    ? strokeAngle
                    : (settings.rotation * Math.PI) / 180;
                const _stampAngle3 = _baseAngle3 + _rotJitterRad3;
                if (tool === "eraser") {
                  cb.stampWebGL(
                    _stampX,
                    _stampY,
                    _stampSize,
                    _stampOpacity3,
                    settings,
                    _stampAngle3,
                    "rgb(255,255,255)",
                    undefined,
                    _moveCapAlpha,
                  );
                  const _erNS = _stampSize / 2;
                  if (_stampX - _erNS < _moveDirtyNS.minX)
                    _moveDirtyNS.minX = _stampX - _erNS;
                  if (_stampY - _erNS < _moveDirtyNS.minY)
                    _moveDirtyNS.minY = _stampY - _erNS;
                  if (_stampX + _erNS > _moveDirtyNS.maxX)
                    _moveDirtyNS.maxX = _stampX + _erNS;
                  if (_stampY + _erNS > _moveDirtyNS.maxY)
                    _moveDirtyNS.maxY = _stampY + _erNS;
                } else {
                  const _jFill3 =
                    _colorJitter3 > 0
                      ? applyColorJitter(_moveFillStyle, _colorJitter3)
                      : _moveFillStyle;
                  cb.stampWebGL(
                    _stampX,
                    _stampY,
                    _stampSize,
                    _stampOpacity3,
                    settings,
                    _stampAngle3,
                    _jFill3,
                    _jFill3,
                    _moveCapAlpha,
                  );
                }
              }
            }
            stampsPlaced++;
            accdist -= spacingPixels;
          }
          p.distAccumRef.current = accdist;
          if (stampsPlaced > 0) {
            anyWork = true;
            if (_moveDirtyNS.minX < _cumulDirty.minX)
              _cumulDirty.minX = _moveDirtyNS.minX;
            if (_moveDirtyNS.minY < _cumulDirty.minY)
              _cumulDirty.minY = _moveDirtyNS.minY;
            if (_moveDirtyNS.maxX > _cumulDirty.maxX)
              _cumulDirty.maxX = _moveDirtyNS.maxX;
            if (_moveDirtyNS.maxY > _cumulDirty.maxY)
              _cumulDirty.maxY = _moveDirtyNS.maxY;
          }
        }
        p.lastPosRef.current = cePos;
      }
      p.prevPrimaryPressureRef.current = _currentPrimary;
      if (anyWork || stabMoved) {
        const _tool = p.activeToolRef.current;
        const _dirty = { ..._cumulDirty };
        const _useDirty = Number.isFinite(_dirty.minX) ? _dirty : undefined;
        const _compositeOpacity = p.lastCompositeOpacityRef.current;
        if (p.strokeStampsPlacedRef.current <= 1) {
          p.webglBrushRef.current?.flushDisplay(p.flushDisplayCapRef.current);
          cb.compositeWithStrokePreview(_compositeOpacity, _tool, _useDirty);
        } else if (p.strokePreviewRafRef.current === null) {
          p.strokePreviewPendingWorkRef.current = true;
          p.strokePreviewRafRef.current = requestAnimationFrame(() => {
            p.strokePreviewRafRef.current = null;
            if (!p.strokePreviewPendingWorkRef.current) return;
            p.strokePreviewPendingWorkRef.current = false;
            p.webglBrushRef.current?.flushDisplay(p.flushDisplayCapRef.current);
            cb.compositeWithStrokePreview(_compositeOpacity, _tool, _useDirty);
          });
        }
      }
    }

    p.lastPosRef.current = pos;
    if (!p.isDrawingRef.current) cb.scheduleComposite();
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: uses refs/snapshotSelection intentionally
  const handlePointerUp = useCallback((e?: PointerEvent) => {
    const isIPad = p.isIPadRef.current;
    if (e) p.currentPointerTypeRef.current = e.pointerType;
    if (e && e.pointerType === "pen") {
      p.penDownCountRef.current = Math.max(0, p.penDownCountRef.current - 1);
    }
    if (p.strokePreviewRafRef.current !== null) {
      cancelAnimationFrame(p.strokePreviewRafRef.current);
      p.strokePreviewRafRef.current = null;
      const _pendingTool = p.activeToolRef.current;
      if (_pendingTool === "brush" || _pendingTool === "eraser") {
        p.webglBrushRef.current?.flushDisplay(p.flushDisplayCapRef.current);
      }
    }
    if (p.isBrushSizeAdjustingRef.current) {
      p.isBrushSizeAdjustingRef.current = false;
      if (p.brushSizeOverlayRef.current)
        p.brushSizeOverlayRef.current.style.display = "none";
      p.brushSizeOverlayStartPosRef.current = null;
      p.updateBrushCursorRef.current();
      return;
    }

    const cb = callbacksRef.current;
    const rh = cb.rulerHandlers;

    // Ruler drag end
    if (
      rh.isLineRulerDragging() ||
      rh.is1pt2ptRulerDragging() ||
      rh.is3ptExclusiveDragging() ||
      rh.is5ptDragging() ||
      rh.isOvalDragging() ||
      rh.isGridDragging()
    ) {
      const rulerLayerUp = p.layersRef.current.find((l) => l.isRuler);
      if (rulerLayerUp) {
        rh.handleLineRulerPointerUp(rulerLayerUp);
        rh.handle1pt2ptRulerPointerUp(rulerLayerUp);
        rh.handle3pt5ptRulerPointerUp(rulerLayerUp);
        rh.handleEllipseGridRulerPointerUp(rulerLayerUp);
      }
      return;
    }

    if (p.isZoomDraggingRef.current) {
      p.isZoomDraggingRef.current = false;
      cb.setViewTransform({ ...p.viewTransformRef.current });
      return;
    }
    if (p.isPanningRef.current) {
      p.isPanningRef.current = false;
      cb.setViewTransform({ ...p.viewTransformRef.current });
      return;
    }
    if (p.isRotatingRef.current) {
      p.isRotatingRef.current = false;
      cb.setViewTransform({ ...p.viewTransformRef.current });
      return;
    }

    // Handle gradient fill pointer up and lasso fill pointer up
    if (p.isGradientDraggingRef.current || p.isLassoFillDrawingRef.current) {
      cb.handleFillPointerUp();
      return;
    }

    // Handle lasso tool pointer up
    if (
      p.isDrawingSelectionRef.current &&
      p.activeToolRef.current === "lasso"
    ) {
      const mode = p.lassoModeRef.current;
      if (mode === "rect" || mode === "ellipse") {
        const sb = p.selectionDraftBoundsRef.current;
        if (
          sb &&
          (Math.abs(sb.ex - sb.sx) > 4 || Math.abs(sb.ey - sb.sy) > 4)
        ) {
          const newGeom = {
            type: mode,
            x: sb.sx,
            y: sb.sy,
            w: sb.ex - sb.sx,
            h: sb.ey - sb.sy,
          };
          if ((e?.shiftKey || e?.altKey) && p.selectionMaskRef.current) {
            const tempC = document.createElement("canvas");
            tempC.width = p.canvasWidthRef.current;
            tempC.height = p.canvasHeightRef.current;
            const tCtx = tempC.getContext("2d", {
              willReadFrequently: !isIPad,
            })!;
            tCtx.fillStyle = "white";
            if (mode === "rect") {
              const x = newGeom.w < 0 ? newGeom.x + newGeom.w : newGeom.x;
              const y = newGeom.h < 0 ? newGeom.y + newGeom.h : newGeom.y;
              tCtx.fillRect(x, y, Math.abs(newGeom.w), Math.abs(newGeom.h));
            } else {
              const cx2 = newGeom.x + newGeom.w / 2;
              const cy2 = newGeom.y + newGeom.h / 2;
              tCtx.beginPath();
              tCtx.ellipse(
                cx2,
                cy2,
                Math.abs(newGeom.w / 2),
                Math.abs(newGeom.h / 2),
                0,
                0,
                Math.PI * 2,
              );
              tCtx.fill();
            }
            const mc2 = p.selectionMaskRef.current;
            const mCtx2 = mc2.getContext("2d", {
              willReadFrequently: !isIPad,
            })!;
            if (e?.shiftKey && !e?.altKey) {
              mCtx2.globalCompositeOperation = "source-over";
              mCtx2.drawImage(tempC, 0, 0);
            } else if (e?.altKey && !e?.shiftKey) {
              mCtx2.globalCompositeOperation = "destination-out";
              mCtx2.drawImage(tempC, 0, 0);
            } else if (e?.shiftKey && e?.altKey) {
              mCtx2.globalCompositeOperation = "destination-in";
              mCtx2.drawImage(tempC, 0, 0);
            }
            mCtx2.globalCompositeOperation = "source-over";
            p.selectionGeometryRef.current = { type: "mask" as LassoMode };
            p.selectionShapesRef.current = [];
            p.selectionBoundaryPathRef.current.dirty = true;
            if (p.selectionMaskRef.current)
              p.rebuildChainsNowRef.current(p.selectionMaskRef.current);
            cb.setSelectionActive(true);
          } else {
            p.selectionGeometryRef.current = newGeom;
            p.selectionShapesRef.current = [newGeom];
            p.selectionBoundaryPathRef.current.dirty = true;
            cb.rasterizeSelectionMask();
            cb.setSelectionActive(true);
          }
        } else if (!e?.shiftKey && !e?.altKey) {
          cb.clearSelection();
        }
        p.selectionDraftBoundsRef.current = null;
        p.isDrawingSelectionRef.current = false;
        {
          const afterSnap = cb.snapshotSelection();
          cb.pushHistory({
            type: "selection",
            before: p.selectionBeforeRef.current ?? afterSnap,
            after: afterSnap,
          });
          p.selectionBeforeRef.current = null;
        }
      } else if (mode !== "wand") {
        const commitLassoPath = (
          pts: { x: number; y: number }[],
          ev?: PointerEvent | null,
        ) => {
          if (pts.length >= 3) {
            if ((ev?.shiftKey || ev?.altKey) && p.selectionMaskRef.current) {
              const tempC2 = document.createElement("canvas");
              tempC2.width = p.canvasWidthRef.current;
              tempC2.height = p.canvasHeightRef.current;
              const tCtx2 = tempC2.getContext("2d", {
                willReadFrequently: !isIPad,
              })!;
              tCtx2.fillStyle = "white";
              tCtx2.beginPath();
              tCtx2.moveTo(pts[0].x, pts[0].y);
              for (let i = 1; i < pts.length; i++)
                tCtx2.lineTo(pts[i].x, pts[i].y);
              tCtx2.closePath();
              tCtx2.fill();
              const mc3 = p.selectionMaskRef.current;
              const mCtx3 = mc3.getContext("2d", {
                willReadFrequently: !isIPad,
              })!;
              if (ev?.shiftKey && !ev?.altKey) {
                mCtx3.globalCompositeOperation = "source-over";
                mCtx3.drawImage(tempC2, 0, 0);
              } else if (ev?.altKey && !ev?.shiftKey) {
                mCtx3.globalCompositeOperation = "destination-out";
                mCtx3.drawImage(tempC2, 0, 0);
              } else if (ev?.shiftKey && ev?.altKey) {
                mCtx3.globalCompositeOperation = "destination-in";
                mCtx3.drawImage(tempC2, 0, 0);
              }
              mCtx3.globalCompositeOperation = "source-over";
              p.selectionGeometryRef.current = { type: "mask" as LassoMode };
              p.selectionShapesRef.current = [];
              p.selectionBoundaryPathRef.current.dirty = true;
              if (p.selectionMaskRef.current)
                p.rebuildChainsNowRef.current(p.selectionMaskRef.current);
              cb.setSelectionActive(true);
            } else {
              p.selectionGeometryRef.current = {
                type: "free",
                points: [...pts],
              };
              p.selectionShapesRef.current = [
                { type: "free" as LassoMode, points: [...pts] },
              ];
              p.selectionBoundaryPathRef.current.dirty = true;
              p.selectionActionsRef.current.rasterizeSelectionMask();
              cb.setSelectionActive(true);
            }
          } else if (!ev?.shiftKey && !ev?.altKey) {
            p.selectionActionsRef.current.clearSelection();
          }
          p.selectionDraftPointsRef.current = [];
          p.selectionDraftCursorRef.current = null;
          p.isDrawingSelectionRef.current = false;
          p.lassoHasPolyPointsRef.current = false;
          p.lassoIsDraggingRef.current = false;
          p.lassoStrokeStartRef.current = null;
          p.selectionPolyClosingRef.current = false;
          const afterSnap = cb.snapshotSelection();
          cb.pushHistory({
            type: "selection",
            before: p.selectionBeforeRef.current ?? afterSnap,
            after: afterSnap,
          });
          p.selectionBeforeRef.current = null;
        };

        if (p.lassoIsDraggingRef.current) {
          p.lassoIsDraggingRef.current = false;
          p.lassoStrokeStartRef.current = null;
          cb.scheduleComposite();
        } else {
          const _nowTap = Date.now();
          const _tapPos = p.lassoStrokeStartRef.current;
          const _lastPos = p.lassoLastTapPosRef.current;
          const _tapDist =
            _tapPos && _lastPos
              ? Math.sqrt(
                  (_tapPos.x - _lastPos.x) ** 2 + (_tapPos.y - _lastPos.y) ** 2,
                )
              : Number.POSITIVE_INFINITY;
          const _isDoubleTap =
            p.isDrawingSelectionRef.current &&
            _nowTap - p.lassoLastTapTimeRef.current < 400 &&
            _tapDist <= 15 &&
            p.selectionDraftPointsRef.current.length > 2;
          p.lassoLastTapTimeRef.current = _nowTap;
          p.lassoLastTapPosRef.current = _tapPos
            ? { x: _tapPos.x, y: _tapPos.y }
            : null;
          if (_isDoubleTap) {
            commitLassoPath(p.selectionDraftPointsRef.current, e ?? null);
            return;
          }
          const tapPos = p.lassoStrokeStartRef.current;
          p.lassoStrokeStartRef.current = null;
          if (!tapPos) return;
          const pts = p.selectionDraftPointsRef.current;
          if (pts.length > 2) {
            const fp = pts[0];
            const dc = Math.sqrt(
              (tapPos.x - fp.x) ** 2 + (tapPos.y - fp.y) ** 2,
            );
            if (dc < 20) {
              commitLassoPath(pts, e ?? null);
              return;
            }
          }
          p.lassoHasPolyPointsRef.current = true;
          const lastPt = pts[pts.length - 1];
          if (!lastPt || lastPt.x !== tapPos.x || lastPt.y !== tapPos.y) {
            p.selectionDraftPointsRef.current.push({
              x: tapPos.x,
              y: tapPos.y,
            });
          }
          p.selectionDraftCursorRef.current = null;
        }
      }
      return;
    }

    // Handle move pointer up
    if (
      p.activeToolRef.current === "move" &&
      p.floatDragStartRef.current &&
      !p.transformActiveRef.current
    ) {
      p.floatDragStartRef.current = null;
      p.selectionActionsRef.current.commitFloat({ keepSelection: true });
      return;
    }
    if (
      (p.activeToolRef.current === "transform" ||
        p.activeToolRef.current === "move") &&
      p.floatDragStartRef.current &&
      p.transformActiveRef.current
    ) {
      p.floatDragStartRef.current = null;
      p.transformHandleRef.current = null;
      return;
    }

    // Eyedropper: commit sampled color on pointer up
    if (p.activeToolRef.current === "eyedropper") {
      if (p.eyedropperIsPressedRef.current) {
        const { r: er, g: eg, b: eb } = p.eyedropperHoverColorRef.current;
        const hsv = rgbToHsv(er, eg, eb);
        const [eh, es, ev] = hsv as [number, number, number];
        cb.setColor((prev) => ({ ...prev, h: eh, s: es, v: ev }));
      }
      p.eyedropperIsPressedRef.current = false;
      return;
    }

    // Liquify: commit stroke as one history entry
    if (p.activeToolRef.current === "liquify") {
      if (p.liquifyHoldIntervalRef.current) {
        clearInterval(p.liquifyHoldIntervalRef.current);
        p.liquifyHoldIntervalRef.current = null;
      }
      p.isCommittingRef.current = true;
      p.isDrawingRef.current = false;
      const liqLayerId = p.activeLayerIdRef.current;

      if (p.liquifyMultiBeforeSnapshotsRef.current.size > 1) {
        for (const [lid, liqBefore] of p.liquifyMultiBeforeSnapshotsRef
          .current) {
          const lc2 = p.layerCanvasesRef.current.get(lid);
          if (!lc2) continue;
          const ctx2 = lc2.getContext("2d", { willReadFrequently: !isIPad });
          if (!ctx2) continue;
          const liqAfter = ctx2.getImageData(0, 0, lc2.width, lc2.height);
          cb.pushHistory({
            type: "pixels",
            layerId: lid,
            before: liqBefore,
            after: liqAfter,
          });
          markLayerBitmapDirty(lid);
          markCanvasDirty(lid);
        }
        p.liquifyMultiBeforeSnapshotsRef.current.clear();
        p.isCommittingRef.current = false;
        p.lastPosRef.current = null;
        cb.composite();
        return;
      }

      const liqLc = p.layerCanvasesRef.current.get(liqLayerId);
      const liqBefore = p.liquifyBeforeSnapshotRef.current;
      p.liquifyBeforeSnapshotRef.current = null;
      if (liqLc && liqBefore) {
        const liqCtx = liqLc.getContext("2d", { willReadFrequently: !isIPad });
        if (liqCtx) {
          const liqAfter = liqCtx.getImageData(0, 0, liqLc.width, liqLc.height);
          cb.pushHistory({
            type: "pixels",
            layerId: liqLayerId,
            before: liqBefore,
            after: liqAfter,
          });
          markLayerBitmapDirty(liqLayerId);
        }
        p.isCommittingRef.current = false;
        markCanvasDirty(liqLayerId);
      }
      p.isCommittingRef.current = false;
      p.lastPosRef.current = null;
      cb.composite();
      return;
    }

    if (!p.isDrawingRef.current) return;

    if (p.smearRafRef.current) {
      cancelAnimationFrame(p.smearRafRef.current);
      p.smearRafRef.current = null;
    }
    if (p.smearDirtyRef.current) {
      p.smearDirtyRef.current = false;
      const _smearUpDR = p.strokeDirtyRectRef.current;
      const _smearUpSize = cb.getActiveSize();
      const _smearUpPad = Math.ceil(Math.max(_smearUpSize / 2, 4));
      const _smearUpDisp = p.displayCanvasRef.current;
      if (_smearUpDR && _smearUpDisp) {
        const _ux = Math.max(0, Math.floor(_smearUpDR.minX) - _smearUpPad);
        const _uy = Math.max(0, Math.floor(_smearUpDR.minY) - _smearUpPad);
        const _ux2 = Math.min(
          _smearUpDisp.width,
          Math.ceil(_smearUpDR.maxX) + _smearUpPad,
        );
        const _uy2 = Math.min(
          _smearUpDisp.height,
          Math.ceil(_smearUpDR.maxY) + _smearUpPad,
        );
        cb.composite();
      } else {
        cb.composite();
      }
    }
    p.isCommittingRef.current = true;
    p.isDrawingRef.current = false;
    p.strokeSnapshotPendingRef.current = false;

    const settings = p.brushSettingsRef.current;
    const tool = p.activeToolRef.current;
    const layerId = p.activeLayerIdRef.current;
    const lc = p.layerCanvasesRef.current.get(layerId);

    const _baseOpacity = p.brushOpacityRef.current;
    const _upPressure = p.smoothedPressureRef.current;
    const _upCurvedPressure = evalPressureCurve(
      _upPressure,
      p.universalPressureCurveRef.current as [number, number, number, number],
    );
    void _upCurvedPressure;
    const _upCommitOpacity =
      (p.webglBrushRef.current?.hasMaskData() ?? false) ? 1.0 : _baseOpacity;

    if (
      lc &&
      (tool === "brush" || tool === "eraser") &&
      ((settings.stabilizationMode ?? "basic") !== "basic" ||
        settings.strokeSmoothing > 0) &&
      p.strokeStampsPlacedRef.current === 0
    ) {
      const tapPos = p.stabBrushPosRef.current ?? p.rawStylusPosRef.current;
      if (tapPos) {
        const tapFillStyle =
          tool === "eraser" ? "rgb(255,255,255)" : p.colorFillStyleRef.current;
        p.strokeSnapLayerRef.current = lc;
        cb.stampWebGL(
          tapPos.x,
          tapPos.y,
          tapPos.size,
          tapPos.opacity,
          settings,
          settings.rotateMode === "follow"
            ? 0
            : (settings.rotation * Math.PI) / 180,
          tapFillStyle,
          undefined,
          tapPos.capAlpha,
        );
        p.strokeCommitOpacityRef.current = _baseOpacity;
        p.webglBrushRef.current?.flushDisplay(p.flushDisplayCapRef.current);
        cb.flushStrokeBuffer(lc, _upCommitOpacity, tool);
        p.webglBrushRef.current?.clearMask();
      }
    }

    if (
      lc &&
      ((settings.stabilizationMode ?? "basic") !== "basic" ||
        settings.strokeSmoothing > 0)
    ) {
      const stab = p.stabBrushPosRef.current;
      const raw = p.rawStylusPosRef.current;
      if (stab && raw) {
        const gdx = raw.x - stab.x;
        const gdy = raw.y - stab.y;
        const gDist = Math.sqrt(gdx * gdx + gdy * gdy);
        if (gDist > 0.5) {
          if (tool === "smudge") {
            const baseStrengthUp = settings.smearStrength ?? 0.8;
            const effectiveSmearStrengthUp = settings.pressureStrength
              ? (settings.minStrength ?? 0) +
                (1 - (settings.minStrength ?? 0)) *
                  p.smoothedPressureRef.current
              : baseStrengthUp;
            cb.renderSmearAlongPoints(
              lc,
              [stab, raw],
              cb.getActiveSize(),
              settings,
              effectiveSmearStrengthUp,
            );
            cb.composite();
          } else if (tool === "brush" || tool === "eraser") {
            const sbufCtxUp = p.strokeBufferRef.current?.getContext("2d", {
              willReadFrequently: !isIPad,
            });
            const _upFillStyle =
              tool === "eraser" ? "rgba(0,0,0,1)" : p.colorFillStyleRef.current;
            if (sbufCtxUp) {
              sbufCtxUp.fillStyle = _upFillStyle;
              sbufCtxUp.globalCompositeOperation = "source-over";
            }
            const _upCtx =
              sbufCtxUp ??
              ({
                fillStyle: _upFillStyle,
              } as unknown as CanvasRenderingContext2D);
            const _upBaseSize = cb.getActiveSize();
            const _upMinSize = settings.pressureSize
              ? _upBaseSize * (settings.minSize / 100)
              : _upBaseSize;
            const _stabMode = settings.stabilizationMode ?? "basic";
            if (
              _stabMode === "smooth" ||
              _stabMode === "elastic" ||
              _stabMode === "smooth+elastic"
            ) {
              if (p.tailRafIdRef.current !== null) {
                cancelAnimationFrame(p.tailRafIdRef.current);
                p.tailRafIdRef.current = null;
                if (p.tailDoCommitRef.current) {
                  p.tailDoCommitRef.current();
                  p.tailDoCommitRef.current = null;
                }
              }
              let _tailX = stab.x;
              let _tailY = stab.y;
              let _tailVx = p.elasticVelRef.current.x;
              let _tailVy = p.elasticVelRef.current.y;
              const _tailTargetX = raw.x;
              const _tailTargetY = raw.y;
              const _tailStartSize = stab.size;
              const _tailMinSize = _upMinSize;
              const _tailOpacity = stab.opacity;
              const _tailEndOpacity = raw.opacity;
              const _tailCapAlpha = undefined;
              const _tailInitDx = _tailTargetX - _tailX;
              const _tailInitDy = _tailTargetY - _tailY;
              const _tailInitDist =
                Math.sqrt(
                  _tailInitDx * _tailInitDx + _tailInitDy * _tailInitDy,
                ) || 1;
              const _tailStiffness = 0.12;
              const _tailDamping = 0.72;
              let _tailPrevX = _tailX;
              let _tailPrevY = _tailY;
              let _tailFrame = 0;
              const _tailMaxFrames = 120;
              const _tailLc = lc;
              const _tailTool = tool;
              const _tailCommitOpacity =
                (p.webglBrushRef.current?.hasMaskData() ?? false)
                  ? 1.0
                  : _baseOpacity;
              const _tailSettings = settings;
              const _tailCtx = _upCtx;
              const _tailSnapRaw = p.strokeStartSnapshotRef.current;
              const _tailSnap = _tailSnapRaw;
              const _tailActiveSize = cb.getActiveSize();
              const _tailLayerId = layerId;
              const doCommit = () => {
                p.isCommittingRef.current = true;
                p.strokeCommitOpacityRef.current = _baseOpacity;
                p.strokeStartSnapshotRef.current = _tailSnap;
                p.webglBrushRef.current?.flushDisplay(
                  p.flushDisplayCapRef.current,
                );
                cb.flushStrokeBuffer(_tailLc, _tailCommitOpacity, _tailTool);
                p.webglBrushRef.current?.clearMask();
                p.strokeStartSnapshotRef.current = null;
                p.tailRafIdRef.current = null;
                p.tailDoCommitRef.current = null;
                cb.composite();
                if (_tailLc && _tailSnap) {
                  const ctx = _tailLc.getContext("2d", {
                    willReadFrequently: !isIPad,
                  });
                  if (ctx) {
                    const after = ctx.getImageData(
                      0,
                      0,
                      _tailLc.width,
                      _tailLc.height,
                    );
                    cb.pushHistory({
                      type: "pixels",
                      layerId: _tailLayerId,
                      before: _tailSnap.pixels,
                      after,
                    });
                  }
                }
                p.isCommittingRef.current = false;
                if (_tailLc) {
                  markCanvasDirty(_tailLayerId);
                }
              };
              const stepTail = () => {
                _tailFrame++;
                const dx = _tailTargetX - _tailX;
                const dy = _tailTargetY - _tailY;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < 0.5 || _tailFrame >= _tailMaxFrames) {
                  const _finalTaper = Math.min(dist / _tailInitDist, 1);
                  const _finalSegSize =
                    _tailMinSize +
                    (_tailStartSize - _tailMinSize) * _finalTaper;
                  if (dist > 0.1 && _finalSegSize >= _tailActiveSize * 0.05) {
                    const taper = _finalTaper;
                    const segSize = _finalSegSize;
                    const segOpacity =
                      _tailEndOpacity +
                      (_tailOpacity - _tailEndOpacity) * taper;
                    const prevPt: StrokePoint = {
                      x: _tailPrevX,
                      y: _tailPrevY,
                      size: segSize,
                      opacity: segOpacity,
                    };
                    const nextPt: StrokePoint = {
                      x: _tailTargetX,
                      y: _tailTargetY,
                      size: _tailMinSize,
                      opacity: _tailEndOpacity,
                    };
                    cb.renderBrushSegmentAlongPoints(
                      _tailCtx,
                      [prevPt, nextPt],
                      segSize,
                      _tailMinSize,
                      segOpacity,
                      _tailEndOpacity,
                      _tailSettings,
                      _tailTool,
                      true,
                      _tailCapAlpha,
                    );
                  }
                  doCommit();
                  return;
                }
                _tailVx = (_tailVx + dx * _tailStiffness) * _tailDamping;
                _tailVy = (_tailVy + dy * _tailStiffness) * _tailDamping;
                _tailPrevX = _tailX;
                _tailPrevY = _tailY;
                _tailX += _tailVx;
                _tailY += _tailVy;
                const taper = Math.min(dist / _tailInitDist, 1);
                const segSize =
                  _tailMinSize + (_tailStartSize - _tailMinSize) * taper;
                if (segSize < _tailActiveSize * 0.05) {
                  doCommit();
                  return;
                }
                const segOpacity =
                  _tailEndOpacity + (_tailOpacity - _tailEndOpacity) * taper;
                const prevPt: StrokePoint = {
                  x: _tailPrevX,
                  y: _tailPrevY,
                  size: segSize,
                  opacity: segOpacity,
                };
                const nextPt: StrokePoint = {
                  x: _tailX,
                  y: _tailY,
                  size: segSize,
                  opacity: segOpacity,
                };
                cb.renderBrushSegmentAlongPoints(
                  _tailCtx,
                  [prevPt, nextPt],
                  segSize,
                  segSize,
                  segOpacity,
                  segOpacity,
                  _tailSettings,
                  _tailTool,
                  true,
                  _tailCapAlpha,
                );
                p.webglBrushRef.current?.flushDisplay(
                  p.flushDisplayCapRef.current,
                );
                p.compositeWithStrokePreviewRef.current(
                  _tailCommitOpacity,
                  _tailTool,
                );
                p.tailRafIdRef.current = requestAnimationFrame(stepTail);
              };
              p.tailDoCommitRef.current = doCommit;
              p.tailRafIdRef.current = requestAnimationFrame(stepTail);
            } else {
              const _upRawTapered: StrokePoint = { ...raw, size: _upMinSize };
              cb.renderBrushSegmentAlongPoints(
                _upCtx,
                [stab, _upRawTapered],
                stab.size,
                _upMinSize,
                stab.opacity,
                raw.opacity,
                settings,
                tool,
                true,
                undefined,
              );
              p.strokeCommitOpacityRef.current = _baseOpacity;
              p.webglBrushRef.current?.flushDisplay(
                p.flushDisplayCapRef.current,
              );
              cb.flushStrokeBuffer(lc, _upCommitOpacity, tool);
              p.webglBrushRef.current?.clearMask();
              cb.composite(cb.strokeCommitDirty());
            }
          }
        } else {
          if (lc && (tool === "brush" || tool === "eraser")) {
            p.strokeCommitOpacityRef.current = _baseOpacity;
            p.webglBrushRef.current?.flushDisplay(p.flushDisplayCapRef.current);
            cb.flushStrokeBuffer(lc, _upCommitOpacity, tool);
            p.webglBrushRef.current?.clearMask();
          }
          cb.composite(cb.strokeCommitDirty());
        }
      } else {
        if (lc && (tool === "brush" || tool === "eraser")) {
          p.strokeCommitOpacityRef.current = _baseOpacity;
          p.webglBrushRef.current?.flushDisplay(p.flushDisplayCapRef.current);
          cb.flushStrokeBuffer(lc, _upCommitOpacity, tool);
          p.webglBrushRef.current?.clearMask();
        }
        cb.composite(cb.strokeCommitDirty());
      }
    } else {
      if (lc && (tool === "brush" || tool === "eraser")) {
        p.strokeCommitOpacityRef.current = _baseOpacity;
        p.webglBrushRef.current?.flushDisplay(p.flushDisplayCapRef.current);
        cb.flushStrokeBuffer(lc, _upCommitOpacity, tool);
        p.webglBrushRef.current?.clearMask();
      }
      cb.composite(cb.strokeCommitDirty());
    }

    p.smoothedPressureRef.current = 0.5;
    p.stabBrushPosRef.current = null;
    p.smoothBufferRef.current = [];
    p.elasticPosRef.current = null;
    p.elasticVelRef.current = { x: 0, y: 0 };
    p.elasticRawPrevRef.current = null;
    p.rawStylusPosRef.current = null;

    if (p.tailRafIdRef.current === null) {
      const before = p.strokeStartSnapshotRef.current;

      // Multi-layer smudge: push a single atomic history entry covering all affected layers
      if (
        tool === "smudge" &&
        p.liquifyMultiBeforeSnapshotsRef.current.size > 1
      ) {
        const atomicLayers = new Map<
          string,
          { before: ImageData; after: ImageData }
        >();
        for (const [lid, smudgeBefore] of p.liquifyMultiBeforeSnapshotsRef
          .current) {
          const smudgeLc = p.layerCanvasesRef.current.get(lid);
          if (!smudgeLc) continue;
          const smudgeCtx = smudgeLc.getContext("2d", {
            willReadFrequently: !isIPad,
          });
          if (!smudgeCtx) continue;
          const smudgeAfter = smudgeCtx.getImageData(
            0,
            0,
            smudgeLc.width,
            smudgeLc.height,
          );
          atomicLayers.set(lid, { before: smudgeBefore, after: smudgeAfter });
          markLayerBitmapDirty(lid);
          markCanvasDirty(lid);
        }
        if (atomicLayers.size > 0) {
          cb.pushHistory({
            type: "multi-layer-pixels",
            layers: atomicLayers,
          });
        }
        p.liquifyMultiBeforeSnapshotsRef.current.clear();
        p.isCommittingRef.current = false;
        p.strokeStartSnapshotRef.current = null;
        p.strokeSnapLayerRef.current = null;
        p.strokeDirtyRectRef.current = null;
        p.strokeSnapDirRef.current = null;
        p.gridSnapLineRef.current = null;
        p.strokeHvAxisRef.current = null;
        p.strokeHvPivotRef.current = null;
        p.lastPosRef.current = null;
      } else if (lc && before) {
        const ctx = lc.getContext("2d", { willReadFrequently: !isIPad });
        if (ctx) {
          const after = ctx.getImageData(0, 0, lc.width, lc.height);
          cb.pushHistory({
            type: "pixels",
            layerId,
            before: before.pixels,
            after,
          });
        }
      }
      p.isCommittingRef.current = false;
      p.strokeStartSnapshotRef.current = null;
      p.strokeSnapLayerRef.current = null;
      p.strokeDirtyRectRef.current = null;
      p.strokeSnapDirRef.current = null;
      p.gridSnapLineRef.current = null;
      p.strokeHvAxisRef.current = null;
      p.strokeHvPivotRef.current = null;
      p.lastPosRef.current = null;
    } else {
      p.strokeSnapLayerRef.current = null;
      p.strokeSnapDirRef.current = null;
      p.gridSnapLineRef.current = null;
      p.strokeHvAxisRef.current = null;
      p.strokeHvPivotRef.current = null;
      p.lastPosRef.current = null;
    }

    if (p.tailRafIdRef.current === null) {
      if (lc) {
        p.thumbDebounceLcRef.current = lc;
        p.thumbDebounceLayerIdRef.current = layerId;
        if (p.thumbDebounceRef.current !== null)
          clearTimeout(p.thumbDebounceRef.current);
        p.thumbDebounceRef.current = setTimeout(() => {
          p.thumbDebounceRef.current = null;
          const _lid = p.thumbDebounceLayerIdRef.current;
          if (_lid) {
            markCanvasDirty(_lid);
          }
        }, 150);
      }
    }

    const col = p.colorRef.current;
    if (p.activeToolRef.current === "brush") {
      const rgb = hsvToRgb(col.h, col.s, col.v);
      const [r, g, b] = rgb as [number, number, number];
      const hex = rgbToHex(r, g, b);
      cb.setRecentColors((prev) =>
        [hex, ...prev.filter((c) => c !== hex)].slice(0, 8),
      );
    }
  }, []);

  // ── 6. Attach pointer events to display canvas ───────────────────────────
  // biome-ignore lint/correctness/useExhaustiveDependencies: all mutable state accessed via stable refs
  useEffect(() => {
    const canvas = displayCanvasRef.current;
    if (!canvas) return;
    const onLeave = (e: PointerEvent) => {
      if (softwareCursorRef.current)
        softwareCursorRef.current.style.display = "none";
      // Reset stored position so updateBrushCursor won't re-show the software
      // cursor at a stale (off-canvas) coordinate after a tool switch.
      p.pointerScreenPosRef.current = { x: 0, y: 0 };
      if (activeToolRef.current === "eyedropper") {
        p.eyedropperIsPressedRef.current = false;
        return;
      }
      handlePointerUp(e);
    };
    const onEnter = (e: PointerEvent) => {
      // Update pointer position so the software cursor doesn't snap to (0,0)
      p.pointerScreenPosRef.current = { x: e.clientX, y: e.clientY };
      updateBrushCursorRef.current();
    };
    canvas.addEventListener("pointerenter", onEnter, { passive: true });
    canvas.addEventListener("pointerdown", handlePointerDown, {
      passive: false,
    });
    canvas.addEventListener("pointermove", handlePointerMove, {
      passive: false,
    });
    canvas.addEventListener("pointerup", handlePointerUp as EventListener, {
      passive: false,
    });
    canvas.addEventListener("pointerleave", onLeave, { passive: false });
    return () => {
      canvas.removeEventListener("pointerenter", onEnter);
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerup", handlePointerUp as EventListener);
      canvas.removeEventListener("pointerleave", onLeave);
    };
  }, [handlePointerDown, handlePointerMove, handlePointerUp]);
}
