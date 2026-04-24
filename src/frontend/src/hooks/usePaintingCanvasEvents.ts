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
import { useCallback, useEffect, useRef, useState } from "react";
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
import {
  type FlatEntry,
  flattenLayersForOps,
  getEffectivelySelectedLayers,
} from "../utils/groupUtils";
import {
  bfsFloodFill,
  blurEdgesOnly,
  computeMaskBounds,
  floatMaskToCanvas,
  growShrinkMask,
  perceptualColorDistance,
} from "../utils/selectionUtils";
import type { WebGLBrushContext } from "../utils/webglBrush";
import { markCanvasDirty, markLayerBitmapDirty } from "./useCompositing";
import type { UndoEntry } from "./useLayerSystem";
import {
  expandLiquifyFrameDirty,
  getLiquifySnapH,
  getLiquifySnapW,
  getLiquifySnapshot,
  initLiquifyField,
  renderLiquifyFromSnapshot,
  renderLiquifyMultiLayer,
  resetLiquifyFrameDirty,
  setLiquifySnapshot,
  setLiquifyStrokeActive,
  updateLiquifyDisplacementField,
} from "./useLiquifySystem";
import {
  PRESSURE_SMOOTHING,
  type PathPoint,
  applyColorJitter,
  clearSmudgeBuffer,
  evalPressureCurve,
  resetSmudgeInitialized,
} from "./useStrokeEngine";
import { getTransformCornersWorld } from "./useTransformSystem";

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
  _container: HTMLElement,
  canvas: HTMLCanvasElement,
  transform: ViewTransform,
  isFlipped = false,
) {
  // Use the canvas element's own bounding rect as the coordinate origin.
  // getBoundingClientRect() on the canvas already accounts for the CSS
  // translate(panX, panY) applied to the wrapper div — so centerX is the
  // canvas's actual screen center including pan. We must NOT subtract
  // transform.panX/panY again; doing so would double-count the translation.
  const cr = canvas.getBoundingClientRect();
  console.log(
    `[CoordMap] getBoundingClientRect — left: ${cr.left} top: ${cr.top} width: ${cr.width} height: ${cr.height}`,
  );
  const centerX = cr.left + cr.width / 2;
  const centerY = cr.top + cr.height / 2;
  // ox/oy: pointer offset from the canvas's screen-space center.
  // No additional panX/panY subtraction — the rect already encodes that shift.
  const ox = clientX - centerX;
  const oy = clientY - centerY;
  const sx = ox / transform.zoom;
  const sy = oy / transform.zoom;
  const px = isFlipped ? -sx : sx;
  const rad = (-transform.rotation * Math.PI) / 180;
  const rx = px * Math.cos(rad) - sy * Math.sin(rad);
  const ry = px * Math.sin(rad) + sy * Math.cos(rad);
  const mappedX = rx + canvas.width / 2;
  const mappedY = ry + canvas.height / 2;
  return { x: mappedX, y: mappedY };
}

function _getCanvasPosWithRect(
  clientX: number,
  clientY: number,
  cr: DOMRect,
  canvas: HTMLCanvasElement,
  transform: ViewTransform,
  isFlipped = false,
) {
  // cr must be canvas.getBoundingClientRect() — the canvas's actual screen rect
  // including any CSS transform applied to the wrapper. Do NOT subtract panX/panY;
  // the rect already encodes the translation from the wrapper's CSS transform.
  const centerX = cr.left + cr.width / 2;
  const centerY = cr.top + cr.height / 2;
  const ox = clientX - centerX;
  const oy = clientY - centerY;
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
  // Transform handle cursor — update cursor icon based on hovered handle
  updateTransformCursorForHandle: (
    handle: string | null,
    ctrlHeld?: boolean,
  ) => void;
  // State setters
  setActiveTool: React.Dispatch<React.SetStateAction<Tool>>;
  setActiveSubpanel: React.Dispatch<React.SetStateAction<Tool | null>>;
  setActiveLayerId: React.Dispatch<React.SetStateAction<string>>;
  setLayers: React.Dispatch<React.SetStateAction<Layer[]>>;
  setLayerTree: React.Dispatch<React.SetStateAction<LayerNode[]>>;
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
    opacity?: number,
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
  /** Apply lasso fill to the active layer canvas */
  applyLassoFill: (
    lc: HTMLCanvasElement,
    points: { x: number; y: number }[],
    fr: number,
    fg: number,
    fb: number,
  ) => void;
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
    extractFloat: (
      fromSel: boolean,
      opts?: { fromToolActivation?: boolean },
    ) => void;
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
  toolSizesRef: React.MutableRefObject<Record<string, number | undefined>>;
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
    /** For scale handle drags: the canvas-space pivot point (opposite handle's position at drag start) */
    pivotX?: number;
    pivotY?: number;
    /** Skew values captured at drag start — skew accumulates from these */
    skewXAtDragStart?: number;
    skewYAtDragStart?: number;
    /** For free-corner drag (corner handle + Ctrl): the four corner world positions at drag start */
    dragStartCorners?: {
      tl: { x: number; y: number };
      tr: { x: number; y: number };
      bl: { x: number; y: number };
      br: { x: number; y: number };
    };
  } | null>;
  transformActionsRef: React.MutableRefObject<{
    hitTestTransformHandle: (x: number, y: number) => string | null;
    extractFloat: (
      fromSel: boolean,
      opts?: { fromToolActivation?: boolean },
    ) => void;
    commitFloat: (opts?: { keepSelection?: boolean }) => void;
    revertTransform: () => void;
  }>;
  /** Free-corner mode state ref — set when Ctrl+corner drag is active */
  freeCornerStateRef: React.MutableRefObject<{
    corners: {
      tl: { x: number; y: number };
      tr: { x: number; y: number };
      bl: { x: number; y: number };
      br: { x: number; y: number };
    };
    draggedCorner: "tl" | "tr" | "bl" | "br";
    origRect: { x: number; y: number; w: number; h: number };
  } | null>;

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
  /** Path accumulation buffer — cleared at stroke start, appended per-point. */
  strokePathBufferRef: React.MutableRefObject<PathPoint[]>;
  /** Index into strokePathBufferRef of the last segment that had a stamp placed. */
  lastStampPathIdxRef: React.MutableRefObject<number>;

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

  // ---- Spring-loaded tool switching refs ----
  // The tool that was active before a spring-load was triggered. Null when not spring-loaded.
  springLoadedPreviousToolRef: React.MutableRefObject<Tool | null>;
  // The exact key string (e.key) that triggered the spring-load.
  springLoadedKeyRef: React.MutableRefObject<string | null>;
  // Set to true when the spring key is released mid-stroke; cleared and restore applied after pointer-up.
  pendingSpringRestoreRef: React.MutableRefObject<boolean>;
  // Pending 500ms hold timer — non-null means key is held but spring hasn't activated yet (tap window).
  holdTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  // The key being held while we wait for the hold timer to fire.
  pendingSpringKeyRef: React.MutableRefObject<string | null>;
  // The target tool waiting to be activated once the hold timer fires.
  pendingSpringToolRef: React.MutableRefObject<Tool | null>;

  // ---- Ctrl+right-click layer menu ----
  /** True when a figure drawing session is active — menu must not open. */
  isFigureDrawingSessionRef: React.MutableRefObject<boolean>;
  /** Called when Ctrl+right-click is detected with at least one hit layer. */
  onCtrlRightClick: (payload: {
    layers: Layer[];
    x: number;
    y: number;
  }) => void;

  // ---- Ctrl+drag layer move refs ----
  /** True while a Ctrl+drag layer-move is in progress. */
  ctrlDragMoveActiveRef: React.MutableRefObject<boolean>;
  /** Accumulated canvas-space offset for the current Ctrl+drag move preview. */
  ctrlDragOffsetRef: React.MutableRefObject<{ x: number; y: number }>;
  /** The layer ID that is being moved by Ctrl+drag (may differ from activeLayerIdRef for Ctrl+Shift). */
  ctrlDragMovingLayerIdRef: React.MutableRefObject<string>;
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

  // ── Shift-held React state (mirrors shiftHeldRef for re-render on key events) ──
  // The ref is the fast synchronous path used by snap/stroke calculations.
  // The state drives indicator re-renders in LayerRow without touching any logic.
  const [shiftHeld, setShiftHeld] = useState(false);

  // ── Liquify performance refs ─────────────────────────────────────────────
  // throttle counter: in multi-layer mode, skip every other coalesced event
  const _liqThrottleCounterRef = useRef(0);
  // Batch layers built once at pointer-down, reused on every pointer-move event.
  // Avoids rebuilding ctx lookups and snapshot references on each coalesced event.
  const _liqBatchLayersRef = useRef<
    Array<{
      ctx: CanvasRenderingContext2D;
      snapshot: ImageData;
      layerId: string;
      isRuler?: boolean;
    }>
  >([]);
  // Whether the current liquify stroke is operating in multi-layer mode.
  const _liqIsMultiRef = useRef(false);
  // Stride chosen at stroke start based on layer count.
  const _liqStrideRef = useRef(1);
  // NOTE: The liquify stroke active flag lives in useLiquifySystem as
  // _liquifyStrokeActive (accessed via getLiquifyStrokeActive / setLiquifyStrokeActive).
  // scheduleComposite in useCompositing gates on that flag — this is the single
  // authoritative suppression point for all pre-warp renders (A4 fix).

  // ── Line tool refs ────────────────────────────────────────────────────────
  // Set true between pointerdown and pointerup when line tool is active.
  const lineIsDrawingRef = useRef(false);
  // Canvas-space start position captured at pointerdown.
  const lineStartPosRef = useRef<Point | null>(null);
  // Pressure at the start of the drag (captured on pointerdown).
  const lineStartPressureRef = useRef(1.0);
  // Snapshot of the active layer taken at pointerdown (for undo history).
  const lineStartSnapshotRef = useRef<ImageData | null>(null);
  // Continuous pressure samples recorded as the user drags the line out.
  // Each entry stores the absolute distance from the start point and the pressure at that moment.
  const linePressureSamplesRef = useRef<
    Array<{ dist: number; pressure: number }>
  >([]);
  // The farthest distance the cursor has reached from the start point during the current drag.
  const lineFarthestDistanceRef = useRef(0);

  // ── Skew / Ctrl modifier refs ─────────────────────────────────────────────
  // The transform handle the pointer is currently hovering over (not dragging).
  // Updated by the hover pointer-move path and cleared when leaving the transform area.
  // Used by the Ctrl keydown/keyup listener to re-apply cursor without needing pointer-move.
  const hoveredTransformHandleRef = useRef<string | null>(null);
  // True while Ctrl is held down — read on every pointer-move for skew vs scale branching.
  const ctrlHeldRef = useRef(false);

  // ── Session max pressure (Linux/Wacom fix) ───────────────────────────────
  // True when a stroke started outside the canvas element (within the viewport
  // container background) and hasn't yet transitioned onto the canvas.
  const _offCanvasStrokeRef = useRef(false);
  // Buffered pointermove events accumulated while the stroke is still off-canvas,
  // to be replayed when the pointer enters the canvas for a seamless carry-on.
  const _offCanvasPendingPathRef = useRef<PointerEvent[]>([]);

  // ── Palm rejection refs (three-layer system) ─────────────────────────────
  const PEN_GRACE_PERIOD_MS = 500;
  // true = pen is currently touching OR grace period is still active
  const penActiveRef = useRef(false);
  const penLiftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // true once any 'pen' pointerType event has been received in this session.
  // When false, touch events fall through normally (non-iPad device graceful degradation).
  const penEverSeenRef = useRef(false);
  // Active pointer tracking map for Layer 3 rollback
  const activePointersRef = useRef(
    new Map<
      number,
      {
        type: string;
        hasActiveStroke: boolean;
        preStrokeSnapshot: {
          x: number;
          y: number;
          width: number;
          height: number;
          data: ImageData;
        } | null;
      }
    >(),
  );

  // ── Line tool: pressure interpolation helper ─────────────────────────────
  // Linearly interpolates pressure at `targetDist` from the recorded samples.
  // Samples before the first sample use the first sample's pressure.
  // Samples after the last sample use the last sample's pressure.
  function interpolateLinePressure(
    samples: Array<{ dist: number; pressure: number }>,
    targetDist: number,
  ): number {
    if (samples.length === 0) return 1.0;
    if (samples.length === 1) return samples[0].pressure;
    if (targetDist <= samples[0].dist) return samples[0].pressure;
    if (targetDist >= samples[samples.length - 1].dist)
      return samples[samples.length - 1].pressure;
    for (let i = 0; i < samples.length - 1; i++) {
      if (targetDist >= samples[i].dist && targetDist <= samples[i + 1].dist) {
        const span = samples[i + 1].dist - samples[i].dist;
        if (span === 0) return samples[i].pressure;
        const alpha = (targetDist - samples[i].dist) / span;
        return (
          samples[i].pressure +
          alpha * (samples[i + 1].pressure - samples[i].pressure)
        );
      }
    }
    return samples[samples.length - 1].pressure;
  }

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
          (currentTool === "brush" ||
            currentTool === "eraser" ||
            currentTool === "liquify" ||
            currentTool === "smudge")
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
        // ── Spring-loadable tools: brush, eraser, smudge, liquify, fill, lasso, move/transform, ruler ──
        // On keydown: if the hotkey maps to a tool that is NOT currently active,
        // start a 500ms hold timer. If the key is released before the timer fires
        // (tap), permanently switch to the tool. If the timer fires first (hold),
        // activate spring-loading and snap back to the previous tool on key release.
        const _springTools: Array<{ action: string; tool: Tool }> = [
          { action: "brush", tool: "brush" },
          { action: "eraser", tool: "eraser" },
          { action: "smudge", tool: "smudge" },
          { action: "line", tool: "line" },
          { action: "liquify", tool: "liquify" },
          { action: "fill", tool: "fill" },
          { action: "lasso", tool: "lasso" },
          { action: "ruler", tool: "ruler" },
          { action: "transform", tool: "move" },
        ];
        let _springHandled = false;
        for (const { action, tool: springTool } of _springTools) {
          if (matchAct(action)) {
            const currentTool = activeToolRef.current;
            const isSameToolActive =
              currentTool === springTool ||
              (springTool === "move" &&
                (currentTool === "move" || currentTool === "transform"));
            if (!isSameToolActive) {
              // Clear any existing hold timer before starting a new one
              if (p.holdTimerRef.current !== null) {
                clearTimeout(p.holdTimerRef.current);
                p.holdTimerRef.current = null;
              }
              // Record the previous tool before switching
              const previousTool = currentTool;
              // Record which key is pending (for the tap/hold detection on keyup)
              p.pendingSpringKeyRef.current = e.key;
              p.pendingSpringToolRef.current = springTool;

              // Switch tool IMMEDIATELY on key down — no delay
              if (springTool === "lasso") {
                cancelInProgressSelectionRef.current();
                callbacksRef.current.handleToolChange("lasso");
              } else if (springTool === "ruler") {
                cancelInProgressSelectionRef.current();
                const _rl = p.layersRef.current.find((l) => l.isRuler);
                p.lastPaintToolRef2.current = previousTool;
                p.lastPaintLayerIdRef.current = p.activeLayerIdRef.current;
                callbacksRef.current.setActiveTool("ruler");
                callbacksRef.current.setActiveSubpanel("ruler" as Tool);
                if (_rl) {
                  callbacksRef.current.setActiveLayerId(_rl.id);
                  p.activeLayerIdRef.current = _rl.id;
                }
              } else if (springTool === "move") {
                cancelInProgressSelectionRef.current();
                if (transformActiveRef.current) {
                  p.selectionActionsRef.current.commitFloat({
                    keepSelection: true,
                  });
                } else {
                  p.lastToolBeforeTransformRef.current = previousTool;
                }
                callbacksRef.current.setActiveTool("move");
                callbacksRef.current.setActiveSubpanel(null);
                // Immediately compute and display the bounding box — no pointer
                // interaction required. fromToolActivation=true ensures an empty
                // layer produces no box instead of a degenerate fallback.
                if (!transformActiveRef.current) {
                  p.selectionActionsRef.current.extractFloat(
                    p.selectionActiveRef.current,
                    { fromToolActivation: true },
                  );
                }
              } else {
                callbacksRef.current.handleToolChange(springTool);
              }

              // Start the 500ms hold timer. If it fires, mark this session as
              // spring-loaded (so key-up will snap back to the previous tool).
              // If key-up fires before the timer, this was a tap — keep the tool.
              p.holdTimerRef.current = setTimeout(() => {
                p.holdTimerRef.current = null;
                // Guard: only activate spring-load if the same key is still pending
                if (p.pendingSpringKeyRef.current !== e.key) return;
                // Spring-load is now active: store previous tool for restore on key-up
                p.springLoadedPreviousToolRef.current = previousTool;
                p.springLoadedKeyRef.current = e.key;
                p.pendingSpringKeyRef.current = null;
                p.pendingSpringToolRef.current = null;
              }, 500);
            }
            // Already on this tool — do nothing (no spring-load)
            _springHandled = true;
            e.preventDefault();
            break;
          }
        }
        if (_springHandled) {
          // Spring-load handled; skip all the legacy individual checks below
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
          // Handled by spring-load path above; this fallback is kept for safety
          if (activeToolRef.current !== "lasso") {
            cancelInProgressSelectionRef.current();
            cb.setActiveTool("lasso");
            cb.setActiveSubpanel("lasso" as Tool);
          }
        } else if (matchAct("ruler")) {
          // Handled by spring-load path above; this fallback is kept for safety
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
          // Handled by spring-load path above; this fallback is kept for safety
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
            cb.setActiveTool("move");
            cb.setActiveSubpanel(null);
          }
        } else if (matchAct("crop")) {
          e.preventDefault();
          if (activeToolRef.current !== "crop") {
            cropPrevToolRef.current = activeToolRef.current;
            cb.handleToolChange("crop");
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
            const canvas = displayCanvasRef.current;
            if (canvas) {
              // Step 1: Capture the canvas-space point currently at the viewport center.
              // In _getCanvasPosTransformed, centerX = canvas.getBoundingClientRect() center
              // = viewport_center + panX. So at clientX = viewport_center:
              //   ox = viewport_center - (viewport_center + panX) = -panX
              //   oy = viewport_center_y - (viewport_center_y + panY) = -panY
              const ox = -vtE.panX;
              const oy = -vtE.panY;
              const sx = ox / vtE.zoom;
              const sy = oy / vtE.zoom;
              const px = isFlippedRef.current ? -sx : sx;
              const rad = (-vtE.rotation * Math.PI) / 180;
              const canvasCX =
                px * Math.cos(rad) - sy * Math.sin(rad) + canvas.width / 2;
              const canvasCY =
                px * Math.sin(rad) + sy * Math.cos(rad) + canvas.height / 2;
              // Step 2 & 3: Reset rotation to 0 and recompute pan so that
              // canvasCX/canvasCY maps back to the viewport center.
              // With rotation=0: screenX = (canvasCX - canvas.width/2)*zoom + panX + vpCX
              // We want screenX = vpCX, so: newPanX = -(canvasCX - canvas.width/2)*zoom
              const newPanXE = -(canvasCX - canvas.width / 2) * vtE.zoom;
              const newPanYE = -(canvasCY - canvas.height / 2) * vtE.zoom;
              const newVtE = {
                ...vtE,
                rotation: 0,
                panX: newPanXE,
                panY: newPanYE,
              };
              applyTransformToDOMRef.current(newVtE);
              cb.setViewTransform(newVtE);
            } else {
              // Fallback: canvas ref not ready, just reset rotation
              const newVtE = { ...vtE, rotation: 0 };
              applyTransformToDOMRef.current(newVtE);
              cb.setViewTransform(newVtE);
            }
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

      // ── Spring-load key release ──
      // Guard: don't process if focused on a text input
      const _upTag = (e.target as HTMLElement).tagName;
      const _upIsEditable =
        (e.target as HTMLElement).isContentEditable === true;
      if (
        _upTag !== "INPUT" &&
        _upTag !== "TEXTAREA" &&
        _upTag !== "SELECT" &&
        !_upIsEditable
      ) {
        // ── TAP path: hold timer still pending (key released before 500ms) ──
        // The tool was already switched immediately on keydown. Since the hold timer
        // hasn't fired yet, spring-load was never activated. Just cancel the timer
        // and clear refs — the tool change is permanent (same as clicking in the panel).
        if (
          p.pendingSpringKeyRef.current !== null &&
          e.key === p.pendingSpringKeyRef.current &&
          p.holdTimerRef.current !== null
        ) {
          // Cancel the hold timer — this was a tap, tool stays on the new selection
          clearTimeout(p.holdTimerRef.current);
          p.holdTimerRef.current = null;
          p.pendingSpringKeyRef.current = null;
          p.pendingSpringToolRef.current = null;
          // No tool switch needed — the tool was already switched on keydown
        }
        // ── HOLD path: timer already fired (spring-load is active), restore previous tool ──
        else if (
          p.springLoadedKeyRef.current !== null &&
          e.key === p.springLoadedKeyRef.current
        ) {
          const _prevTool = p.springLoadedPreviousToolRef.current;
          if (_prevTool !== null) {
            if (p.isDrawingRef.current || p.isCommittingRef.current) {
              // Mid-stroke — defer the restore until pointer-up completes
              p.pendingSpringRestoreRef.current = true;
            } else {
              // Not mid-stroke — restore immediately
              p.springLoadedPreviousToolRef.current = null;
              p.springLoadedKeyRef.current = null;
              p.pendingSpringRestoreRef.current = false;
              callbacksRef.current.handleToolChange(_prevTool);
            }
          } else {
            // No previous tool stored — just clear refs
            p.springLoadedPreviousToolRef.current = null;
            p.springLoadedKeyRef.current = null;
            p.pendingSpringRestoreRef.current = false;
          }
        }
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
      setShiftHeld(false);
      // Cancel any pending hold timer on blur
      if (p.holdTimerRef.current !== null) {
        clearTimeout(p.holdTimerRef.current);
        p.holdTimerRef.current = null;
      }
      p.pendingSpringKeyRef.current = null;
      p.pendingSpringToolRef.current = null;
      // Cancel any active spring-load on window blur (key-up won't fire)
      if (p.springLoadedPreviousToolRef.current !== null) {
        const _blurPrevTool = p.springLoadedPreviousToolRef.current;
        p.springLoadedPreviousToolRef.current = null;
        p.springLoadedKeyRef.current = null;
        p.pendingSpringRestoreRef.current = false;
        if (!p.isDrawingRef.current && !p.isCommittingRef.current) {
          callbacksRef.current.handleToolChange(_blurPrevTool);
        }
      }
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
        setShiftHeld(true);
        const prevToolForAltShift = altEyedropperActiveRef.current
          ? prevToolRef.current
          : activeToolRef.current;
        if (
          e.altKey &&
          (prevToolForAltShift === "brush" ||
            prevToolForAltShift === "eraser" ||
            prevToolForAltShift === "smudge" ||
            prevToolForAltShift === "liquify")
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
        setShiftHeld(false);
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

  // ── 2b. Ctrl key listener — updates skew cursor when Ctrl pressed/released ──
  // biome-ignore lint/correctness/useExhaustiveDependencies: stable refs only
  useEffect(() => {
    const onCtrlDown = (e: KeyboardEvent) => {
      if (e.key !== "Control") return;
      ctrlHeldRef.current = true;
      // Re-apply cursor if pointer is currently over a transform handle
      // Corner handles get 'move' cursor (free-corner mode); edge handles get skew cursor
      const hovHandle = hoveredTransformHandleRef.current;
      if (hovHandle && hovHandle !== "move" && hovHandle !== "rot") {
        callbacksRef.current.updateTransformCursorForHandle(hovHandle, true);
      } else if (
        !hovHandle &&
        !p.isFigureDrawingSessionRef.current &&
        !p.isDrawingRef.current &&
        !p.isPanningRef.current
      ) {
        // Show grab cursor to indicate Ctrl+drag layer move is available
        const _cont = containerRef.current;
        if (_cont) _cont.style.cursor = "grab";
      }
    };
    const onCtrlUp = (e: KeyboardEvent) => {
      if (e.key !== "Control") return;
      ctrlHeldRef.current = false;
      // If a Ctrl+drag is in progress, commit it immediately on Ctrl release
      // (edge case: user releases Ctrl while still holding the pointer down —
      //  cancel the move and restore the original layer data by re-applying the
      //  before snapshot rather than committing the partial move)
      // In practice the pointer-up path handles commit; we only restore cursor here.
      if (!p.ctrlDragMoveActiveRef.current) {
        // Re-apply cursor if pointer is currently over a transform handle
        const hovHandle = hoveredTransformHandleRef.current;
        if (hovHandle) {
          callbacksRef.current.updateTransformCursorForHandle(hovHandle, false);
        } else {
          // Restore normal tool cursor
          updateBrushCursorRef.current();
        }
      }
    };
    window.addEventListener("keydown", onCtrlDown);
    window.addEventListener("keyup", onCtrlUp);
    return () => {
      window.removeEventListener("keydown", onCtrlDown);
      window.removeEventListener("keyup", onCtrlUp);
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

  // ── Palm rejection helpers ───────────────────────────────────────────────
  // onPenLift: called on pen pointerup or pointercancel. Starts the 500ms
  // grace period that blocks touch events after the pen lifts, closing the
  // window where a resting palm could register as a stroke.
  function onPenLift(e: PointerEvent) {
    if (e.pointerType !== "pen") return;
    p.penDownCountRef.current = Math.max(0, p.penDownCountRef.current - 1);
    penActiveRef.current = false;
    console.log("[PalmRejection] pen lift — grace period started (500ms)");
    if (penLiftTimerRef.current) {
      clearTimeout(penLiftTimerRef.current);
    }
    penLiftTimerRef.current = setTimeout(() => {
      penLiftTimerRef.current = null;
      console.log(
        "[PalmRejection] grace period elapsed — touch gestures re-enabled",
      );
    }, PEN_GRACE_PERIOD_MS);
  }

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
    // ── LAYER 1 + 2: Palm rejection gate ─────────────────────────────────────
    if (e.pointerType === "pen") {
      // Mark that a pen has been seen in this session — enables the lock
      penEverSeenRef.current = true;
      penActiveRef.current = true;
      // Cancel any pending grace period timer
      if (penLiftTimerRef.current) {
        clearTimeout(penLiftTimerRef.current);
        penLiftTimerRef.current = null;
      }
      console.log("[PalmRejection] pen down — lock active");
      // Keep penDownCountRef for compatibility with touch gesture guards
      p.penDownCountRef.current += 1;
    } else if (e.pointerType === "touch") {
      // Only gate if a pen has ever been seen (degrade gracefully on non-pen devices)
      if (penEverSeenRef.current) {
        if (penActiveRef.current || penLiftTimerRef.current !== null) {
          const reason = penActiveRef.current
            ? "pen-active lock"
            : "grace period";
          console.log(
            `[PalmRejection] touch rejected during ${reason}: pointerId`,
            e.pointerId,
          );
          return;
        }
        // pen-active lock fully inactive — touch gestures use touchstart/touchmove (separate path)
        return;
      }
      // No pen ever seen this session — apply legacy size filter and fall through
      if (p.penDownCountRef.current > 0 || e.width > 200 || e.height > 200) {
        return;
      }
    }
    // ── End palm rejection gate ───────────────────────────────────────────────

    // Track this pointer for Layer 3 rollback
    activePointersRef.current.set(e.pointerId, {
      type: e.pointerType,
      hasActiveStroke: false,
      preStrokeSnapshot: null,
    });
    // Capture pre-stroke snapshot for Layer 3 rollback
    {
      const entry = activePointersRef.current.get(e.pointerId);
      if (entry && p.displayCanvasRef.current) {
        const ctx = p.displayCanvasRef.current.getContext("2d");
        if (ctx) {
          const snapshotSize = 400;
          const snapX = Math.max(0, Math.round(e.clientX) - snapshotSize / 2);
          const snapY = Math.max(0, Math.round(e.clientY) - snapshotSize / 2);
          const snapW = Math.min(
            snapshotSize,
            p.displayCanvasRef.current.width - snapX,
          );
          const snapH = Math.min(
            snapshotSize,
            p.displayCanvasRef.current.height - snapY,
          );
          if (snapW > 0 && snapH > 0) {
            try {
              const imageData = ctx.getImageData(snapX, snapY, snapW, snapH);
              entry.preStrokeSnapshot = {
                x: snapX,
                y: snapY,
                width: snapW,
                height: snapH,
                data: imageData,
              };
              entry.hasActiveStroke = true;
            } catch (_err) {
              // getImageData can throw on cross-origin — silently ignore
            }
          }
        }
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

    console.log(
      "[Paint] pointerdown received — tool:",
      tool,
      "layer:",
      layerId,
      "canvas:",
      lc?.width,
      "x",
      lc?.height,
    );

    // ── Ctrl+drag / Ctrl+Shift+drag layer move ────────────────────────────
    // Intercept before any tool dispatch. Guards:
    //   - Ctrl must be held (ctrlHeldRef, or e.ctrlKey as fallback)
    //   - Not figure drawing session
    //   - Stroke not in progress
    //   - Not panning
    //   - No focused text input / contenteditable
    //   - Not during transform tool handle interaction (isDraggingFloatRef guard)
    if (
      (ctrlHeldRef.current || e.ctrlKey) &&
      !p.isFigureDrawingSessionRef.current &&
      !p.isDrawingRef.current &&
      !p.isPanningRef.current &&
      !p.isDraggingFloatRef.current
    ) {
      const _activeEl = document.activeElement;
      const _elTag = _activeEl?.tagName ?? "";
      const _elEditable = (_activeEl as HTMLElement | null)?.isContentEditable;
      const _inputFocused =
        _elTag === "INPUT" || _elTag === "TEXTAREA" || _elEditable === true;
      if (!_inputFocused) {
        const _isCtrlShift = e.ctrlKey && e.shiftKey;
        const _cW = p.canvasWidthRef.current;
        const _cH = p.canvasHeightRef.current;
        // Bounds check
        if (pos.x >= 0 && pos.y >= 0 && pos.x < _cW && pos.y < _cH) {
          let _movingLayerId = p.activeLayerIdRef.current;

          if (_isCtrlShift) {
            // ── Ctrl+Shift: pick topmost non-locked non-ruler layer with content ──
            const _cx = Math.round(pos.x);
            const _cy = Math.round(pos.y);
            let _picked: string | null = null;
            for (const _lay of p.layersRef.current) {
              const _lt = (_lay as { type?: string }).type;
              if (_lt === "group" || _lt === "end_group") continue;
              if ((_lay as { isRuler?: boolean }).isRuler) continue;
              if ((_lay as { isLocked?: boolean }).isLocked) continue;
              const _layLc = p.layerCanvasesRef.current.get(_lay.id);
              if (!_layLc || _layLc.width === 0 || _layLc.height === 0)
                continue;
              if (_cx >= _layLc.width || _cy >= _layLc.height) continue;
              const _layCtx = _layLc.getContext("2d", {
                willReadFrequently: true,
              });
              if (!_layCtx) continue;
              const _alpha = _layCtx.getImageData(_cx, _cy, 1, 1).data[3];
              if (_alpha > 0) {
                _picked = _lay.id;
                break;
              }
            }
            if (!_picked) {
              // No content at cursor — do nothing
            } else {
              _movingLayerId = _picked;
              // Switch active layer if different
              if (_picked !== p.activeLayerIdRef.current) {
                p.activeLayerIdRef.current = _picked;
                cb.setActiveLayerId(_picked);
              }
              // Start the move
              p.ctrlDragMoveActiveRef.current = true;
              p.ctrlDragMovingLayerIdRef.current = _movingLayerId;
              p.ctrlDragOffsetRef.current = { x: 0, y: 0 };
              // Snapshot the layer canvas for undo (before state)
              const _moveLc = p.layerCanvasesRef.current.get(_movingLayerId);
              if (_moveLc) {
                const _moveCtx = _moveLc.getContext("2d", {
                  willReadFrequently: true,
                });
                if (_moveCtx) {
                  p.strokeStartSnapshotRef.current = {
                    pixels: _moveCtx.getImageData(
                      0,
                      0,
                      _moveLc.width,
                      _moveLc.height,
                    ),
                    x: 0,
                    y: 0,
                  };
                }
              }
              p.lastPosRef.current = pos;
              if (p.containerRef.current)
                p.containerRef.current.style.cursor = "grab";
              return;
            }
          } else {
            // ── Ctrl only: move active layer ──────────────────────────────
            const _activeLayer = p.layersRef.current.find(
              (l) => l.id === _movingLayerId,
            );
            const _lt = (_activeLayer as { type?: string } | undefined)?.type;
            const _isRuler = (_activeLayer as { isRuler?: boolean } | undefined)
              ?.isRuler;
            const _isLocked = (
              _activeLayer as { isLocked?: boolean } | undefined
            )?.isLocked;
            if (
              _activeLayer &&
              _lt !== "group" &&
              _lt !== "end_group" &&
              !_isRuler &&
              !_isLocked
            ) {
              p.ctrlDragMoveActiveRef.current = true;
              p.ctrlDragMovingLayerIdRef.current = _movingLayerId;
              p.ctrlDragOffsetRef.current = { x: 0, y: 0 };
              // Snapshot for undo
              const _moveLc2 = p.layerCanvasesRef.current.get(_movingLayerId);
              if (_moveLc2) {
                const _moveCtx2 = _moveLc2.getContext("2d", {
                  willReadFrequently: true,
                });
                if (_moveCtx2) {
                  p.strokeStartSnapshotRef.current = {
                    pixels: _moveCtx2.getImageData(
                      0,
                      0,
                      _moveLc2.width,
                      _moveLc2.height,
                    ),
                    x: 0,
                    y: 0,
                  };
                }
              }
              p.lastPosRef.current = pos;
              if (p.containerRef.current)
                p.containerRef.current.style.cursor = "grab";
              return;
            }
          }
        }
      }
    }
    // ── End Ctrl+drag layer move intercept ────────────────────────────────

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
        p.layersRef.current as FlatEntry[],
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
        // Insert the ruler ABOVE (visually) the current active layer.
        // Index 0 = topmost in the panel, so "above active" = same index as
        // active (shifting active down by 1). Fall back to appending if no
        // active layer is found.
        const activeIdNow = p.activeLayerIdRef.current;
        cb.setLayers((prev) => {
          const idx = prev.findIndex((l) => l.id === activeIdNow);
          if (idx === -1) return [...prev, newRulerLayer];
          const next = [...prev];
          next.splice(idx, 0, newRulerLayer);
          return next;
        });
        cb.setLayerTree((prev) => {
          const idx = prev.findIndex(
            (n) => n.kind === "layer" && n.id === activeIdNow,
          );
          const rulerNode: import("../types").LayerItem = {
            kind: "layer",
            id: newRulerLayer.id,
            layer: newRulerLayer as unknown as import("../types").Layer,
          };
          if (idx === -1) return [...prev, rulerNode];
          const next = [...prev];
          next.splice(idx, 0, rulerNode);
          return next;
        });
        const activeIdxFlat = p.layersRef.current.findIndex(
          (l) => l.id === activeIdNow,
        );
        if (activeIdxFlat === -1) {
          p.layersRef.current = [...p.layersRef.current, newRulerLayer];
        } else {
          const next = [...p.layersRef.current];
          next.splice(activeIdxFlat, 0, newRulerLayer);
          p.layersRef.current = next;
        }
        const rulerInsertIndex =
          activeIdxFlat === -1 ? p.layersRef.current.length - 1 : activeIdxFlat;
        cb.setActiveLayerId(newRulerLayer.id);
        p.activeLayerIdRef.current = newRulerLayer.id;
        cb.pushHistory({
          type: "layer-add",
          layer: newRulerLayer,
          index: rulerInsertIndex,
          previousActiveLayerId: prevActiveIdForRuler,
        });
        p.rulerEditHistoryDepthRef.current = 1;

        // Fix 1: Immediately begin ruler setup on the first pointer-down.
        // The layer is now in layersRef so the ruler handlers can find it.
        const rh2 = cb.rulerHandlers;
        const handleRadius2 = Math.max(
          12,
          24 / p.viewTransformRef.current.zoom,
        );
        if (currentPresetType === "line") {
          rh2.handleLineRulerPointerDown(pos, newRulerLayer, handleRadius2);
        } else if (currentPresetType === "perspective-1pt") {
          rh2.handle1ptRulerPointerDown(pos, newRulerLayer, handleRadius2);
        } else if (currentPresetType === "perspective-2pt") {
          rh2.handle2ptRulerPointerDown(pos, newRulerLayer, handleRadius2);
        } else if (currentPresetType === "perspective-3pt") {
          rh2.handle3ptRulerPointerDown(
            pos,
            newRulerLayer,
            handleRadius2,
            p.shiftHeldRef.current,
          );
        } else if (currentPresetType === "perspective-5pt") {
          rh2.handle5ptRulerPointerDown(
            pos,
            newRulerLayer,
            handleRadius2,
            p.shiftHeldRef.current,
          );
        } else if (currentPresetType === "oval") {
          rh2.handleOvalRulerPointerDown(pos, newRulerLayer, handleRadius2);
        } else if (currentPresetType === "grid") {
          rh2.handleGridRulerPointerDown(pos, newRulerLayer, handleRadius2);
        }

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
        // ── Soft flood fill ────────────────────────────────────────────────
        // Tolerance maps directly to perceptual distance threshold (0–255).
        const W = p.canvasWidthRef.current;
        const H = p.canvasHeightRef.current;
        const tol = p.wandToleranceRef.current; // direct 0–255 scale
        const contiguous = p.wandContiguousRef.current;

        // Unpremultiply seed pixel color
        const sidx = (wy * W + wx) * 4;
        const sa = srcData[sidx + 3];
        const seedR = sa > 0 ? Math.round((srcData[sidx] * 255) / sa) : 0;
        const seedG = sa > 0 ? Math.round((srcData[sidx + 1] * 255) / sa) : 0;
        const seedB = sa > 0 ? Math.round((srcData[sidx + 2] * 255) / sa) : 0;

        const transitionZone = tol * 0.12;
        const lowerBound = tol - transitionZone;
        const upperBound = tol + transitionZone;

        // Helper: compute weight (0.0–1.0) for a pixel at flat index i
        const pixelWeight = (i: number): number => {
          const pi = i * 4;
          const a = srcData[pi + 3];
          if (a === 0) return 0;
          const r = Math.round((srcData[pi] * 255) / a);
          const g = Math.round((srcData[pi + 1] * 255) / a);
          const b = Math.round((srcData[pi + 2] * 255) / a);
          const dist = perceptualColorDistance(r, g, b, seedR, seedG, seedB);
          if (dist <= lowerBound) return 1.0;
          if (dist >= upperBound) return 0.0;
          return 1.0 - (dist - lowerBound) / (2 * transitionZone);
        };

        const floatMask = new Float32Array(W * H);

        if (contiguous) {
          // BFS from tap position
          const visited = new Uint8Array(W * H);
          const queue: number[] = [wy * W + wx];
          let head = 0;
          while (head < queue.length) {
            const pos = queue[head++];
            if (visited[pos]) continue;
            visited[pos] = 1;
            const x = pos % W;
            const y = Math.floor(pos / W);
            const w = pixelWeight(pos);
            if (w <= 0) continue;
            floatMask[pos] = w;
            const neighbors = [
              x > 0 ? pos - 1 : -1,
              x < W - 1 ? pos + 1 : -1,
              y > 0 ? pos - W : -1,
              y < H - 1 ? pos + W : -1,
            ];
            for (const nb of neighbors) {
              if (nb >= 0 && !visited[nb]) queue.push(nb);
            }
          }
        } else {
          // Non-contiguous: scan entire canvas
          for (let i = 0; i < W * H; i++) {
            floatMask[i] = pixelWeight(i);
          }
        }

        // ── Hard boundary penalty (Fix 2d) ─────────────────────────────────
        // Reduce weight at anti-aliased pixels near hard color boundaries
        const penalized = new Float32Array(floatMask);
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const pos = y * W + x;
            if (floatMask[pos] <= 0) continue;
            const pi = pos * 4;
            const pa = srcData[pi + 3];
            if (pa === 0) continue;
            const pr = Math.round((srcData[pi] * 255) / pa);
            const pg = Math.round((srcData[pi + 1] * 255) / pa);
            const pb = Math.round((srcData[pi + 2] * 255) / pa);

            let nearHardBoundary = false;
            const ns = [
              x > 0 ? pos - 1 : -1,
              x < W - 1 ? pos + 1 : -1,
              y > 0 ? pos - W : -1,
              y < H - 1 ? pos + W : -1,
            ];
            for (const nb of ns) {
              if (nb < 0) continue;
              const npi = nb * 4;
              const na = srcData[npi + 3];
              if (na === 0) continue;
              const nr = Math.round((srcData[npi] * 255) / na);
              const ng = Math.round((srcData[npi + 1] * 255) / na);
              const nbCol = Math.round((srcData[npi + 2] * 255) / na);
              const distToSeed = perceptualColorDistance(
                nr,
                ng,
                nbCol,
                seedR,
                seedG,
                seedB,
              );
              const distToPixel = perceptualColorDistance(
                nr,
                ng,
                nbCol,
                pr,
                pg,
                pb,
              );
              if (distToSeed > tol * 2.0 && distToPixel > 50) {
                nearHardBoundary = true;
                break;
              }
            }
            if (nearHardBoundary) penalized[pos] *= 0.5;
          }
        }

        // ── Erosion pass (Fix 2d continued) — 1px edge shrink ─────────────
        const eroded = new Float32Array(penalized);
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const pos = y * W + x;
            if (penalized[pos] <= 0) continue;
            const ns2 = [
              x > 0 ? pos - 1 : -1,
              x < W - 1 ? pos + 1 : -1,
              y > 0 ? pos - W : -1,
              y < H - 1 ? pos + W : -1,
            ];
            for (const nb of ns2) {
              if (nb < 0 || penalized[nb] <= 0.05) {
                eroded[pos] *= 0.4;
                break;
              }
            }
          }
        }

        // ── Edge blur (Fix 2c) ─────────────────────────────────────────────
        const blurred = blurEdgesOnly(eroded, W, H, 1);

        // ── Grow/Shrink on binary representation then convert back ─────────
        const growShrinkPx = p.wandGrowShrinkRef.current;
        let finalMaskCanvas: HTMLCanvasElement;
        if (growShrinkPx !== 0) {
          // Convert float mask to binary Uint8Array for growShrinkMask
          const binaryMask = new Uint8Array(W * H);
          for (let i = 0; i < W * H; i++) {
            binaryMask[i] = blurred[i] >= 0.5 ? 1 : 0;
          }
          const grown = growShrinkMask(binaryMask, W, H, growShrinkPx);
          // Convert grown binary back to float for floatMaskToCanvas
          const grownFloat = new Float32Array(W * H);
          for (let i = 0; i < W * H; i++) {
            // Blend: if a pixel was grown into, give it weight 0.8; if already selected, keep its weight
            if (grown[i]) {
              grownFloat[i] = binaryMask[i] ? blurred[i] : 0.8;
            }
          }
          finalMaskCanvas = floatMaskToCanvas(grownFloat, W, H);
        } else {
          finalMaskCanvas = floatMaskToCanvas(blurred, W, H);
        }

        // Copy finalMaskCanvas pixel data into maskImgData for shift-key union below
        const finalCtx = finalMaskCanvas.getContext("2d", {
          willReadFrequently: !isIPad,
        });
        if (finalCtx) {
          const fd = finalCtx.getImageData(0, 0, W, H).data;
          for (let i = 0; i < fd.length; i++) {
            md[i] = fd[i];
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
          // Compute pivot for scale handles (opposite handle's position) and
          // rotation center for the rot handle, both captured at drag-start.
          let pivotX: number | undefined;
          let pivotY: number | undefined;
          if (xfDown) {
            const { x: bx, y: by, w: bw, h: bh } = xfDown;
            if (hitHandle === "rot") {
              // Rotation always pivots around the exact bounding box center.
              // Capture it once at drag-start so it never drifts mid-drag.
              pivotX = bx + bw / 2;
              pivotY = by + bh / 2;
            } else if (hitHandle !== "move") {
              // Scale handle: pivot is the opposite handle's position
              switch (hitHandle) {
                case "nw":
                  pivotX = bx + bw;
                  pivotY = by + bh;
                  break; // se
                case "n":
                  pivotX = bx + bw / 2;
                  pivotY = by + bh;
                  break; // s
                case "ne":
                  pivotX = bx;
                  pivotY = by + bh;
                  break; // sw
                case "e":
                  pivotX = bx;
                  pivotY = by + bh / 2;
                  break; // w
                case "se":
                  pivotX = bx;
                  pivotY = by;
                  break; // nw
                case "s":
                  pivotX = bx + bw / 2;
                  pivotY = by;
                  break; // n
                case "sw":
                  pivotX = bx + bw;
                  pivotY = by;
                  break; // ne
                case "w":
                  pivotX = bx + bw;
                  pivotY = by + bh / 2;
                  break; // e
              }
            }
          }
          p.floatDragStartRef.current = {
            px: pos.x,
            py: pos.y,
            fx: xfDown ? xfDown.x : 0,
            fy: xfDown ? xfDown.y : 0,
            origBounds: xfDown
              ? { x: xfDown.x, y: xfDown.y, w: xfDown.w, h: xfDown.h }
              : undefined,
            initRotation: xfDown ? xfDown.rotation : 0,
            pivotX,
            pivotY,
            skewXAtDragStart: xfDown?.skewX ?? 0,
            skewYAtDragStart: xfDown?.skewY ?? 0,
            // For free-corner drag: store the four corner world positions at drag start.
            // If freeCornerStateRef is active (from a previous Ctrl+corner drag in this
            // session), use those corners as the baseline so the next drag starts from
            // the actual current quad geometry rather than the stale xfState geometry.
            dragStartCorners:
              hitHandle === "nw" ||
              hitHandle === "ne" ||
              hitHandle === "sw" ||
              hitHandle === "se" ||
              ((hitHandle === "n" ||
                hitHandle === "s" ||
                hitHandle === "w" ||
                hitHandle === "e") &&
                e.ctrlKey)
                ? (p.freeCornerStateRef.current?.corners ??
                  (xfDown ? getTransformCornersWorld(xfDown) : undefined))
                : undefined,
          };
          // Reset freeCornerStateRef so the new drag starts fresh.
          // It will be re-initialized on the first pointer-move.
          if (
            hitHandle === "nw" ||
            hitHandle === "ne" ||
            hitHandle === "sw" ||
            hitHandle === "se" ||
            hitHandle === "n" ||
            hitHandle === "s" ||
            hitHandle === "w" ||
            hitHandle === "e"
          ) {
            p.freeCornerStateRef.current = null;
          }
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

    // ── Line tool: capture start state and bail — no normal stroke pipeline ──
    if (tool === "line") {
      // Ruler-layer guard (same as brush)
      {
        const _lineActiveLayer = p.layersRef.current.find(
          (l) => l.id === layerId,
        );
        if (_lineActiveLayer?.isRuler) return;
      }
      const rawPressureLine =
        e.pointerType === "mouse"
          ? 1.0
          : Math.max(0, Math.min(1, e.pressure || 1.0));
      lineIsDrawingRef.current = true;
      lineStartPosRef.current = pos;
      lineStartPressureRef.current = rawPressureLine;
      // Initialize continuous pressure sampling — record initial pressure at dist=0
      linePressureSamplesRef.current = [{ dist: 0, pressure: rawPressureLine }];
      lineFarthestDistanceRef.current = 0;
      // Snapshot for undo
      const _lineCtx = lc.getContext("2d", { willReadFrequently: !isIPad });
      if (_lineCtx) {
        const _lineSnap = _lineCtx.getImageData(0, 0, lc.width, lc.height);
        lineStartSnapshotRef.current = _lineSnap;
        // CRITICAL: flushStrokeBuffer bails immediately if strokeStartSnapshotRef
        // is null — set it here so the commit path succeeds at pointer-up.
        p.strokeStartSnapshotRef.current = { pixels: _lineSnap, x: 0, y: 0 };
      }
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
    // Reset path accumulation buffer — must be cleared for every new stroke.
    p.strokePathBufferRef.current = [];
    p.lastStampPathIdxRef.current = 1;
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
        p.layersRef.current as FlatEntry[],
        p.selectedLayerIdsRef.current,
      );
      if (_smudgeSelDown.length > 1) {
        const newSmudgeSnaps = new Map<string, ImageData>();
        for (const layerItem of _smudgeSelDown) {
          const lid2 = layerItem.id;
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
        p.layersRef.current as FlatEntry[],
        p.selectedLayerIdsRef.current,
      );
      for (const item of _eSel) {
        const _c = p.layerCanvasesRef.current.get(item.id);
        if (_c) return _c;
      }
      return undefined;
    })();

    if (tool === "liquify" && liqLcResolved) {
      // Set the single authoritative stroke-active flag (A4 fix).
      // scheduleComposite in useCompositing checks this flag and skips any
      // trailing RAF from the previous stroke — no RAF cancellation needed here.
      setLiquifyStrokeActive(true);

      const _liqSnapCtx = liqLcResolved.getContext("2d", {
        willReadFrequently: !isIPad,
      });
      if (_liqSnapCtx) {
        // Determine the working layer set based on scope:
        //   "all-visible" → every visible layer in the tree (regardless of selection)
        //   "active"       → only the effectively selected layers
        const _liqScope = p.liquifyScopeRef.current;
        const _liqWorkingLayers =
          _liqScope === "all-visible"
            ? flattenLayersForOps(p.layersRef.current as FlatEntry[]).filter(
                (item) => item.visible,
              )
            : getEffectivelySelectedLayers(
                p.layersRef.current as FlatEntry[],
                p.selectedLayerIdsRef.current,
              );

        const _liqIsMulti = _liqWorkingLayers.length > 1;
        if (_liqIsMulti) {
          const newSnapshots = new Map<string, ImageData>();
          const newBatchLayers: Array<{
            ctx: CanvasRenderingContext2D;
            snapshot: ImageData;
            layerId: string;
            isRuler?: boolean;
          }> = [];
          for (const layerItem of _liqWorkingLayers) {
            const lid2 = layerItem.id;
            const lc2 = p.layerCanvasesRef.current.get(lid2);
            if (!lc2) continue;
            const ctx2 = lc2.getContext("2d", { willReadFrequently: !isIPad });
            if (!ctx2) continue;
            const snap2 = ctx2.getImageData(0, 0, lc2.width, lc2.height);
            newSnapshots.set(lid2, snap2);
            newBatchLayers.push({
              ctx: ctx2,
              snapshot: snap2,
              layerId: lid2,
              isRuler: (layerItem as { isRuler?: boolean }).isRuler === true,
            });
          }
          p.liquifyMultiBeforeSnapshotsRef.current = newSnapshots;
          p.liquifyBeforeSnapshotRef.current = null;
          // Store batch at stroke-start so pointer-move can reuse without rebuilding
          _liqBatchLayersRef.current = newBatchLayers;
        } else {
          p.liquifyBeforeSnapshotRef.current = _liqSnapCtx.getImageData(
            0,
            0,
            liqLcResolved.width,
            liqLcResolved.height,
          );
          p.liquifyMultiBeforeSnapshotsRef.current.clear();
          _liqBatchLayersRef.current = [];
        }
        // Store multi/stride state for reuse in pointer-move
        _liqIsMultiRef.current = _liqIsMulti;
        _liqStrideRef.current = _liqWorkingLayers.length >= 3 ? 2 : 1;

        const snapData = _liqSnapCtx.getImageData(
          0,
          0,
          liqLcResolved.width,
          liqLcResolved.height,
        );
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
      const effectiveOpacity = (() => {
        if (settings.pressureOpacity) return flow;
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
        const _initStabCapAlpha = settings.pressureOpacity
          ? curvedPressure * baseOpacity
          : undefined;
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
        const _initCapAlpha = settings.pressureOpacity
          ? curvedPressure * baseOpacity
          : undefined;
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
        // For liquify: do NOT call compositeWithStrokePreview at pointer-down.
        // The stroke-active flag in useLiquifySystem gates scheduleComposite
        // so no pre-warp layer state can reach the display canvas.
        // The first pointer-move RAF will composite correctly after warp is applied.
        if (tool !== "liquify") {
          // Use the dirty rect from the initial stamp (set by stampWebGL above) so only
          // the stamp area is composited — avoids a full-canvas redraw for the first stamp.
          const _initDR = p.strokeDirtyRectRef.current;
          const _initUseDirty = _initDR ? _initDR : undefined;
          cb.compositeWithStrokePreview(
            p.lastCompositeOpacityRef.current,
            tool,
            _initUseDirty,
          );
        }
        p.strokeStampsPlacedRef.current = 1;
      }
    }
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: uses refs intentionally
  const handlePointerMove = useCallback((e: PointerEvent) => {
    // ── Layer 1 + 2: Palm rejection — block touch moves during pen-active lock ──
    if (e.pointerType === "touch" && penEverSeenRef.current) {
      if (penActiveRef.current || penLiftTimerRef.current !== null) {
        return;
      }
    }
    const isIPad = p.isIPadRef.current;
    p.currentPointerTypeRef.current = e.pointerType;
    p.pointerScreenPosRef.current = { x: e.clientX, y: e.clientY };
    // ── Diagnostic: confirm coalesced event delivery for Apple Pencil ───────
    if (e.pointerType === "pen") {
      const _diagCoalesced = e.getCoalescedEvents?.() ?? [e];
      console.log(
        `[Pencil] pointermove — coalesced count: ${_diagCoalesced.length}, primary: (${e.clientX.toFixed(1)}, ${e.clientY.toFixed(1)})`,
      );
    }
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
        if (p.activeToolRef.current === "smudge") {
          p.toolSizesRef.current.brush = newSize;
        }
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
      // Fix 2: update ruler overlay live during camera zoom drag
      cb.scheduleRulerOverlay();
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
      // Fix 2: update ruler overlay live during camera pan drag
      cb.scheduleRulerOverlay();
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
      // Fix 2: update ruler overlay live during camera rotation drag
      cb.scheduleRulerOverlay();
      return;
    }

    // ── Ctrl+drag layer move: update offset ──────────────────────────────
    if (p.ctrlDragMoveActiveRef.current) {
      const _dispCtrl = p.displayCanvasRef.current;
      const _contCtrl = p.containerRef.current;
      if (_dispCtrl && _contCtrl) {
        const _posCtrl = _getCanvasPosTransformed(
          e.clientX,
          e.clientY,
          _contCtrl,
          _dispCtrl,
          p.viewTransformRef.current,
          p.isFlippedRef.current,
        );
        const _prev = p.lastPosRef.current;
        if (_prev) {
          p.ctrlDragOffsetRef.current = {
            x: p.ctrlDragOffsetRef.current.x + (_posCtrl.x - _prev.x),
            y: p.ctrlDragOffsetRef.current.y + (_posCtrl.y - _prev.y),
          };
        }
        p.lastPosRef.current = _posCtrl;
      }
      if (p.containerRef.current)
        p.containerRef.current.style.cursor = "grabbing";
      cb.scheduleComposite();
      return;
    }
    // ── End Ctrl+drag layer move pointer-move ─────────────────────────────

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
          const _containerRect2 = display2.getBoundingClientRect();
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

      // Keep cursor matching the active drag handle while dragging, with skew variant if Ctrl held
      if (p.transformHandleRef.current) {
        cb.updateTransformCursorForHandle(
          p.transformHandleRef.current,
          e.ctrlKey,
        );
      }

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
          // Use the pivot captured at drag-start so the rotation center never
          // drifts if the box was scaled or moved earlier in the same session.
          const cx = drag.pivotX ?? xfRot.x + xfRot.w / 2;
          const cy = drag.pivotY ?? xfRot.y + xfRot.h / 2;
          const startAngle = Math.atan2(drag.py - cy, drag.px - cx);
          const curAngle = Math.atan2(pos3.y - cy, pos3.x - cx);
          const initRot = drag.initRotation ?? 0;
          const angle = curAngle - startAngle + initRot;
          p.xfStateRef.current = { ...xfRot, rotation: angle };
        } else if (
          e.ctrlKey &&
          (handle === "nw" ||
            handle === "ne" ||
            handle === "sw" ||
            handle === "se")
        ) {
          // ── Free-corner mode: Ctrl held + corner handle ──────────────────
          // The dragged corner follows the cursor exactly.
          // The other three corners stay at their recorded drag-start positions.
          // No affine decomposition — store the four corner positions directly.
          const dc = drag.dragStartCorners;
          if (!dc) return;

          // Map handle name to corner key
          const cornerKey =
            handle === "nw"
              ? "tl"
              : handle === "ne"
                ? "tr"
                : handle === "sw"
                  ? "bl"
                  : "br";

          // Initialize or update freeCornerStateRef
          if (!p.freeCornerStateRef.current) {
            // First pointer-move after drag start: initialize free-corner state
            const ob = p.moveFloatOriginBoundsRef.current;
            p.freeCornerStateRef.current = {
              corners: { ...dc },
              draggedCorner: cornerKey as "tl" | "tr" | "bl" | "br",
              origRect: ob
                ? { x: ob.x, y: ob.y, w: ob.w, h: ob.h }
                : { x: 0, y: 0, w: 1, h: 1 },
            };
          }

          // Update only the dragged corner to the current cursor position.
          // The other three corners remain exactly at their drag-start positions.
          const fc = p.freeCornerStateRef.current;
          fc.corners = {
            tl: cornerKey === "tl" ? { x: pos3.x, y: pos3.y } : dc.tl,
            tr: cornerKey === "tr" ? { x: pos3.x, y: pos3.y } : dc.tr,
            bl: cornerKey === "bl" ? { x: pos3.x, y: pos3.y } : dc.bl,
            br: cornerKey === "br" ? { x: pos3.x, y: pos3.y } : dc.br,
          };
          // xfStateRef is kept as-is — rendering uses freeCornerStateRef directly
          // (getTransformHandles and PaintingApp rendering read freeCornerStateRef)
        } else if (
          e.ctrlKey &&
          (handle === "n" || handle === "s" || handle === "e" || handle === "w")
        ) {
          // ── Edge-translate mode: Ctrl held + edge handle ─────────────────
          // The entire edge (both corners on that side) translates together.
          // The opposite edge stays completely fixed. Result is a parallelogram.
          const origBounds = drag.origBounds;
          if (!origBounds) return;

          // Get the four corner world positions captured at drag-start.
          // If dragStartCorners was set at pointer-down, use those directly.
          // Otherwise recompute from origBounds + rotation.
          let dragStartTL: { x: number; y: number };
          let dragStartTR: { x: number; y: number };
          let dragStartBL: { x: number; y: number };
          let dragStartBR: { x: number; y: number };

          const dsc = drag.dragStartCorners;
          if (dsc) {
            dragStartTL = dsc.tl;
            dragStartTR = dsc.tr;
            dragStartBL = dsc.bl;
            dragStartBR = dsc.br;
          } else {
            // Fallback: compute corners from origBounds + current rotation
            const rotation = p.xfStateRef.current?.rotation ?? 0;
            const cx = origBounds.x + origBounds.w / 2;
            const cy = origBounds.y + origBounds.h / 2;
            const halfW = origBounds.w / 2;
            const halfH = origBounds.h / 2;
            const cosF = Math.cos(rotation);
            const sinF = Math.sin(rotation);
            dragStartTL = {
              x: cx + -halfW * cosF - -halfH * sinF,
              y: cy + -halfW * sinF + -halfH * cosF,
            };
            dragStartTR = {
              x: cx + halfW * cosF - -halfH * sinF,
              y: cy + halfW * sinF + -halfH * cosF,
            };
            dragStartBL = {
              x: cx + -halfW * cosF - halfH * sinF,
              y: cy + -halfW * sinF + halfH * cosF,
            };
            dragStartBR = {
              x: cx + halfW * cosF - halfH * sinF,
              y: cy + halfW * sinF + halfH * cosF,
            };
          }

          // Compute raw drag delta from drag-start position
          const rawDx = pos3.x - drag.px;
          const rawDy = pos3.y - drag.py;
          const rotation = p.xfStateRef.current?.rotation ?? 0;

          // Convert to local coordinate frame (rotate by -rotation)
          const cosR = Math.cos(-rotation);
          const sinR = Math.sin(-rotation);
          const localDx = rawDx * cosR - rawDy * sinR;
          const localDy = rawDx * sinR + rawDy * cosR;

          // Both axes are fully applied — no constraint on edge handle skew
          const constrainedLocalDx = localDx;
          const constrainedLocalDy = localDy;

          // Forward-rotate the constrained local delta back to world space
          const cosF2 = Math.cos(rotation);
          const sinF2 = Math.sin(rotation);
          const worldDx =
            constrainedLocalDx * cosF2 - constrainedLocalDy * sinF2;
          const worldDy =
            constrainedLocalDx * sinF2 + constrainedLocalDy * cosF2;

          // Apply delta to the two corners on the dragged edge; keep opposite edge fixed
          let newTL = { ...dragStartTL };
          let newTR = { ...dragStartTR };
          let newBL = { ...dragStartBL };
          let newBR = { ...dragStartBR };

          if (handle === "n") {
            newTL = { x: dragStartTL.x + worldDx, y: dragStartTL.y + worldDy };
            newTR = { x: dragStartTR.x + worldDx, y: dragStartTR.y + worldDy };
            // BL, BR stay fixed
          } else if (handle === "s") {
            newBL = { x: dragStartBL.x + worldDx, y: dragStartBL.y + worldDy };
            newBR = { x: dragStartBR.x + worldDx, y: dragStartBR.y + worldDy };
            // TL, TR stay fixed
          } else if (handle === "w") {
            newTL = { x: dragStartTL.x + worldDx, y: dragStartTL.y + worldDy };
            newBL = { x: dragStartBL.x + worldDx, y: dragStartBL.y + worldDy };
            // TR, BR stay fixed
          } else if (handle === "e") {
            newTR = { x: dragStartTR.x + worldDx, y: dragStartTR.y + worldDy };
            newBR = { x: dragStartBR.x + worldDx, y: dragStartBR.y + worldDy };
            // TL, BL stay fixed
          }

          // Store in freeCornerStateRef so:
          //   - rendering already deforms the bounding box using these corners
          //   - commitFloat() already calls solveHomography() with these corners
          // No changes needed to those paths.
          const origRect = {
            x: origBounds.x,
            y: origBounds.y,
            w: origBounds.w,
            h: origBounds.h,
          };
          p.freeCornerStateRef.current = {
            corners: { tl: newTL, tr: newTR, bl: newBL, br: newBR },
            // Edge-translate mode has no single dragged corner — use "tl" as a
            // required-field placeholder; commitFloat() only reads .corners and .origRect.
            draggedCorner: "tl" as const,
            origRect,
          };
          // xfStateRef is kept as-is — rendering uses freeCornerStateRef directly
        } else {
          // ── Scale mode: no Ctrl, or corner handle ───────────────────────
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
          // Pivot (opposite handle) captured at drag-start — the fixed anchor point.
          // For each handle, the opposite edge stays pinned to the pivot coordinate.
          const pX = drag.pivotX ?? origBounds.x + origBounds.w / 2;
          const pY = drag.pivotY ?? origBounds.y + origBounds.h / 2;
          if (handle === "nw") {
            // Dragged: top-left. Pivot: bottom-right (pX, pY).
            newX = origBounds.x + dx2;
            newY = origBounds.y + dy2;
            newW = pX - newX;
            newH = pY - newY;
          } else if (handle === "ne") {
            // Dragged: top-right. Pivot: bottom-left (pX, pY).
            newY = origBounds.y + dy2;
            newW = origBounds.x + origBounds.w + dx2 - pX;
            newX = pX;
            newH = pY - newY;
          } else if (handle === "sw") {
            // Dragged: bottom-left. Pivot: top-right (pX, pY).
            newX = origBounds.x + dx2;
            newW = pX - newX;
            newH = origBounds.y + origBounds.h + dy2 - pY;
            newY = pY;
          } else if (handle === "se") {
            // Dragged: bottom-right. Pivot: top-left (pX, pY).
            newX = pX;
            newY = pY;
            newW = origBounds.x + origBounds.w + dx2 - pX;
            newH = origBounds.y + origBounds.h + dy2 - pY;
          } else if (handle === "n") {
            // Dragged: top edge. Pivot: bottom edge (pY fixed).
            newY = origBounds.y + dy2;
            newH = pY - newY;
          } else if (handle === "s") {
            // Dragged: bottom edge. Pivot: top edge (pY fixed).
            newY = pY;
            newH = origBounds.y + origBounds.h + dy2 - pY;
          } else if (handle === "w") {
            // Dragged: left edge. Pivot: right edge (pX fixed).
            newX = origBounds.x + dx2;
            newW = pX - newX;
          } else if (handle === "e") {
            // Dragged: right edge. Pivot: left edge (pX fixed).
            newX = pX;
            newW = origBounds.x + origBounds.w + dx2 - pX;
          }
          if (e.shiftKey && origBounds.w > 0 && origBounds.h > 0) {
            const aspect = origBounds.w / origBounds.h;
            if (
              Math.abs(newW - origBounds.w) >= Math.abs(newH - origBounds.h)
            ) {
              newH = newW / aspect;
              if (handle === "nw" || handle === "n") newY = pY - newH;
            } else {
              newW = newH * aspect;
              if (handle === "nw" || handle === "w") newX = pX - newW;
            }
          }
          const MIN = 10;
          if (newW < MIN) {
            if (handle === "nw" || handle === "w" || handle === "sw")
              newX = pX - MIN;
            newW = MIN;
          }
          if (newH < MIN) {
            if (handle === "nw" || handle === "n" || handle === "ne")
              newY = pY - MIN;
            newH = MIN;
          }
          const xfScale = p.xfStateRef.current;
          p.xfStateRef.current = {
            x: newX,
            y: newY,
            w: newW,
            h: newH,
            rotation: xfScale ? xfScale.rotation : 0,
            skewX: xfScale?.skewX ?? 0,
            skewY: xfScale?.skewY ?? 0,
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
          skewX: xfMv?.skewX ?? 0,
          skewY: xfMv?.skewY ?? 0,
        };
      }
      cb.scheduleComposite();
      return;
    }

    // Hover cursor update: transform tool active, not actively dragging
    if (
      (p.activeToolRef.current === "move" ||
        p.activeToolRef.current === "transform") &&
      (p.transformActiveRef.current || p.isDraggingFloatRef.current) &&
      !p.floatDragStartRef.current
    ) {
      const displayHov = p.displayCanvasRef.current;
      const containerHov = p.containerRef.current;
      if (displayHov && containerHov) {
        const posHov = _getCanvasPosTransformed(
          e.clientX,
          e.clientY,
          containerHov,
          displayHov,
          p.viewTransformRef.current,
          p.isFlippedRef.current,
        );
        const hovHandle = p.transformActionsRef.current.hitTestTransformHandle(
          posHov.x,
          posHov.y,
        );
        // Track hovered handle so Ctrl key listener can update cursor without pointer-move
        hoveredTransformHandleRef.current = hovHandle;
        cb.updateTransformCursorForHandle(hovHandle, e.ctrlKey);
      }
    }

    // ── Line tool: stamp-based preview ───────────────────────────────────────
    if (p.activeToolRef.current === "line" && lineIsDrawingRef.current) {
      const _lineDisplay = p.displayCanvasRef.current;
      const _lineCont = p.containerRef.current;
      if (!_lineDisplay || !_lineCont) return;
      const _linePos = _getCanvasPosTransformed(
        e.clientX,
        e.clientY,
        _lineCont,
        _lineDisplay,
        p.viewTransformRef.current,
        p.isFlippedRef.current,
      );
      const _lineStart = lineStartPosRef.current;
      if (!_lineStart) return;

      // ── Continuous pressure sampling ────────────────────────────────────
      const _lpCurrentPressure =
        e.pointerType === "mouse"
          ? 1.0
          : Math.max(0, Math.min(1, e.pressure || 1.0));
      const _lpMoveDx = _linePos.x - _lineStart.x;
      const _lpMoveDy = _linePos.y - _lineStart.y;
      const _lpCurrentDist = Math.sqrt(
        _lpMoveDx * _lpMoveDx + _lpMoveDy * _lpMoveDy,
      );
      if (_lpCurrentDist > lineFarthestDistanceRef.current) {
        // Line is extending — add a new sample at the current distance
        lineFarthestDistanceRef.current = _lpCurrentDist;
        linePressureSamplesRef.current.push({
          dist: _lpCurrentDist,
          pressure: _lpCurrentPressure,
        });
      } else {
        // Line is shrinking — discard samples beyond the new endpoint
        linePressureSamplesRef.current = linePressureSamplesRef.current.filter(
          (s) => s.dist <= _lpCurrentDist,
        );
        lineFarthestDistanceRef.current = _lpCurrentDist;
      }

      const _lpLayerId = p.activeLayerIdRef.current;
      const _lpSettings = p.brushSettingsRef.current;
      const _lpBaseSize = cb.getActiveSize();
      const _lpBaseOpacity = p.brushOpacityRef.current;
      const _lpFillStyle = p.colorFillStyleRef.current;
      // Reset FBOs fresh for this preview frame so stamps accumulate cleanly
      p.webglBrushRef.current?.clear();
      cb.buildStrokeCanvases(_lpLayerId);
      p.strokeCommitOpacityRef.current = _lpBaseOpacity;
      const _lpFlushCap = _lpSettings.pressureOpacity ? _lpBaseOpacity : 1.0;
      p.flushDisplayCapRef.current = _lpFlushCap;
      p.lastCompositeOpacityRef.current = _lpSettings.pressureOpacity
        ? 1.0
        : _lpBaseOpacity;
      // Compute line geometry
      const _lpDx = _linePos.x - _lineStart.x;
      const _lpDy = _linePos.y - _lineStart.y;
      const _lpLineDist = Math.sqrt(_lpDx * _lpDx + _lpDy * _lpDy);
      const _lpStrokeAngle = Math.atan2(_lpDy, _lpDx);
      const _lpSpacingPixels = Math.max(
        0.5,
        (_lpSettings.spacing / 100) * _lpBaseSize,
      );
      if (_lpLineDist < 0.5) {
        // Single stamp for near-zero-length drag
        const _lpPressure = interpolateLinePressure(
          linePressureSamplesRef.current,
          0,
        );
        const _lpCurved = evalPressureCurve(
          _lpPressure,
          p.universalPressureCurveRef.current as [
            number,
            number,
            number,
            number,
          ],
        );
        const _lpSize = _lpSettings.pressureSize
          ? _lpBaseSize *
            (_lpSettings.minSize / 100 +
              (1 - _lpSettings.minSize / 100) * _lpCurved)
          : _lpBaseSize;
        const _lpFlow = _lpSettings.flow ?? 1.0;
        const _lpCapAlpha = _lpSettings.pressureOpacity
          ? _lpCurved * _lpBaseOpacity
          : undefined;
        cb.stampWebGL(
          _lineStart.x,
          _lineStart.y,
          _lpSize,
          _lpFlow,
          _lpSettings,
          _lpSettings.rotateMode === "follow"
            ? 0
            : (_lpSettings.rotation * Math.PI) / 180,
          _lpFillStyle,
          undefined,
          _lpCapAlpha,
        );
      } else {
        let _lpAccDist = 0;
        let _lpStampCount = 0;
        while (_lpAccDist <= _lpLineDist) {
          const _lpSx =
            _lineStart.x +
            _lpDx * (_lpLineDist > 0 ? _lpAccDist / _lpLineDist : 0);
          const _lpSy =
            _lineStart.y +
            _lpDy * (_lpLineDist > 0 ? _lpAccDist / _lpLineDist : 0);
          const _lpPressure = interpolateLinePressure(
            linePressureSamplesRef.current,
            _lpAccDist,
          );
          const _lpCurved = evalPressureCurve(
            _lpPressure,
            p.universalPressureCurveRef.current as [
              number,
              number,
              number,
              number,
            ],
          );
          const _lpSize = _lpSettings.pressureSize
            ? _lpBaseSize *
              (_lpSettings.minSize / 100 +
                (1 - _lpSettings.minSize / 100) * _lpCurved)
            : _lpBaseSize;
          const _lpFlow = _lpSettings.flow ?? 1.0;
          const _lpStampOpacity = _lpSettings.pressureOpacity
            ? _lpFlow
            : _lpSettings.pressureFlow
              ? _lpFlow *
                ((_lpSettings.minFlow ?? 0) +
                  (1 - (_lpSettings.minFlow ?? 0)) * _lpCurved)
              : _lpFlow;
          const _lpCapAlpha = _lpSettings.pressureOpacity
            ? _lpCurved * _lpBaseOpacity
            : undefined;
          const _lpBaseAngle =
            _lpSettings.rotateMode === "follow"
              ? _lpStrokeAngle
              : (_lpSettings.rotation * Math.PI) / 180;
          cb.stampWebGL(
            _lpSx,
            _lpSy,
            _lpSize,
            _lpStampOpacity,
            _lpSettings,
            _lpBaseAngle,
            _lpFillStyle,
            undefined,
            _lpCapAlpha,
          );
          _lpAccDist += _lpSpacingPixels;
          _lpStampCount++;
          if (_lpStampCount > 20000) break;
        }
      }
      // Show mid-stroke preview using the stamp FBOs
      p.webglBrushRef.current?.flushDisplay(_lpFlushCap);
      cb.compositeWithStrokePreview(_lpBaseOpacity, "brush");
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
        p.layersRef.current as FlatEntry[],
        p.selectedLayerIdsRef.current,
      );
      const _isSmudgeMulti = _smudgeSel.length > 1;

      const _rawCoalescedSmear = e.getCoalescedEvents?.();
      const smearCoalescedEvents: PointerEvent[] =
        _rawCoalescedSmear && _rawCoalescedSmear.length > 0
          ? _rawCoalescedSmear
          : [e];
      // Use canvas rect (not container rect) so the side reference canvas
      // insertion doesn't shift the coordinate origin.
      const _smearContainerRect = display.getBoundingClientRect();
      const _smearXform = p.viewTransformRef.current;
      const _smearFlipped = p.isFlippedRef.current;
      const baseStrength = settings.smearStrength ?? 0.8;
      const _smearPrevPrimary = p.prevPrimaryPressureRef.current;
      const _smearCurrentPrimary = e.pressure > 0 ? e.pressure : 0.5;
      for (let i = 0; i < smearCoalescedEvents.length; i++) {
        const sce = smearCoalescedEvents[i];
        let scePos = _getCanvasPosWithRect(
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
          ? baseStrength *
            ((settings.minStrength ?? 0) +
              (1 - (settings.minStrength ?? 0)) * smearPressure)
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
                  const _smearLc = p.layerCanvasesRef.current.get(layerItem.id);
                  if (_smearLc) {
                    cb.renderSmearAlongPoints(
                      _smearLc,
                      [stab, newStab],
                      activeSize,
                      settings,
                      effectiveSmearStrength,
                      p.brushOpacityRef.current,
                    );
                    // Invalidate bitmap cache so compositor re-reads live canvas on next frame
                    markLayerBitmapDirty(layerItem.id);
                  }
                }
              } else {
                cb.renderSmearAlongPoints(
                  lc,
                  [stab, newStab],
                  activeSize,
                  settings,
                  effectiveSmearStrength,
                  p.brushOpacityRef.current,
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
                  const _smearLc = p.layerCanvasesRef.current.get(layerItem.id);
                  if (_smearLc) {
                    cb.renderSmearAlongPoints(
                      _smearLc,
                      [scePrev, scePos],
                      activeSize,
                      settings,
                      effectiveSmearStrength,
                      p.brushOpacityRef.current,
                    );
                    // Invalidate bitmap cache so compositor re-reads live canvas on next frame
                    markLayerBitmapDirty(layerItem.id);
                  }
                }
              } else {
                cb.renderSmearAlongPoints(
                  lc,
                  [scePrev, scePos],
                  activeSize,
                  settings,
                  effectiveSmearStrength,
                  p.brushOpacityRef.current,
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
      // Reuse the canvas for the active layer (or first visible layer as fallback).
      // The actual per-layer rendering uses _liqBatchLayersRef built at pointer-down.
      let liqLc = p.layerCanvasesRef.current.get(layerId);
      if (!liqLc) {
        const _fallbackBatch = _liqBatchLayersRef.current;
        if (_fallbackBatch.length > 0) {
          liqLc = p.layerCanvasesRef.current.get(_fallbackBatch[0].layerId);
        }
      }
      if (liqLc) {
        const liqCtx = liqLc.getContext("2d", { willReadFrequently: !isIPad });
        if (liqCtx) {
          const coalescedEvents = e.getCoalescedEvents?.();
          const evts: PointerEvent[] =
            coalescedEvents && coalescedEvents.length > 0
              ? coalescedEvents
              : [e];
          // Use canvas rect (not container rect) — correct for all zoom levels
          // and unaffected by sibling canvas insertions.
          const containerRect = display.getBoundingClientRect();
          // Use the multi/stride flags captured at stroke-start — fixed for the
          // entire stroke duration, no per-event recalculation.
          const _liqMoveIsMulti = _liqIsMultiRef.current;
          const _liqStride = _liqStrideRef.current;
          // Pre-read the batch array once for the whole pointer-move call
          const _liqBatch = _liqBatchLayersRef.current;

          // Reset per-frame dirty rect at the start of processing this batch
          resetLiquifyFrameDirty();

          const lastEvtIndex = evts.length - 1;
          for (let _evtIdx = 0; _evtIdx < evts.length; _evtIdx++) {
            const ce = evts[_evtIdx];
            const isLastEvt = _evtIdx === lastEvtIndex;

            // Throttle: in multi-layer mode skip every other non-final event
            if (_liqMoveIsMulti && !isLastEvt) {
              _liqThrottleCounterRef.current++;
              if (_liqThrottleCounterRef.current % 2 !== 0) continue;
            }

            let cePos = _getCanvasPosWithRect(
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

                // Compute stamp bounds — expand per-frame dirty rect
                const stampX0 = Math.max(0, Math.floor(cePos.x - radius));
                const stampY0 = Math.max(0, Math.floor(cePos.y - radius));
                const stampX1 = Math.min(
                  getLiquifySnapW() > 0 ? getLiquifySnapW() : liqLc.width,
                  Math.ceil(cePos.x + radius + 1),
                );
                const stampY1 = Math.min(
                  getLiquifySnapH() > 0 ? getLiquifySnapH() : liqLc.height,
                  Math.ceil(cePos.y + radius + 1),
                );
                expandLiquifyFrameDirty(stampX0, stampY0, stampX1, stampY1);

                // Compute displacement once — reused for all layers
                updateLiquifyDisplacementField(
                  cePos.x,
                  cePos.y,
                  radius,
                  p.liquifyStrengthRef.current * 0.6,
                  ndx,
                  ndy,
                );

                if (_liqMoveIsMulti && _liqBatch.length > 0) {
                  // Apply the same displacement field to every layer in the
                  // pre-built batch. No merging/compositing — each layer is
                  // processed and written back independently.
                  const savedSnapshot = getLiquifySnapshot();
                  renderLiquifyMultiLayer(_liqBatch, _liqStride);
                  // Restore global snapshot pointer (renderLiquifyMultiLayer
                  // may have shifted it while iterating per-layer snapshots)
                  setLiquifySnapshot(savedSnapshot);
                  // Invalidate bitmap caches for all rendered layers
                  for (const batchItem of _liqBatch) {
                    markLayerBitmapDirty(batchItem.layerId);
                  }
                } else {
                  // Single-layer path: ruler layer guard — silently skip the write
                  const _liqActiveLayer = p.layersRef.current.find(
                    (l) => l.id === layerId,
                  );
                  if (
                    !(_liqActiveLayer as { isRuler?: boolean } | undefined)
                      ?.isRuler
                  ) {
                    renderLiquifyFromSnapshot(liqCtx);
                  }
                }
                p.lastPosRef.current = cePos;
              }
            } else {
              p.lastPosRef.current = cePos;
            }
          }

          // Defer composite to rAF via scheduleComposite — deduped internally.
          // scheduleComposite is a no-op while liquifyStrokeActive is true, so
          // no pre-warp state can flash at stroke start.
          cb.scheduleComposite();
        }
      }
    } else if (tool === "brush" || tool === "eraser") {
      const ctx = lc.getContext("2d", { willReadFrequently: !isIPad });
      if (!ctx) return;
      const _rawCoalesced = e.getCoalescedEvents?.();
      const coalescedEvents: PointerEvent[] =
        _rawCoalesced && _rawCoalesced.length > 0 ? _rawCoalesced : [e];
      // Use canvas rect (not container rect) so strokes are correct at all
      // zoom levels and regardless of whether the side reference canvas is present.
      const _containerRect = display.getBoundingClientRect();
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
        const cappedOpacity = (() => {
          if (settings.pressureOpacity) return flow;
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
        const _moveCapAlpha = settings.pressureOpacity
          ? curvedPressure * baseOpacity
          : undefined;
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

  // ── Layer 3: pointercancel rollback ─────────────────────────────────────
  // Called when the browser's heuristics identify a touch as accidental.
  // Restores the canvas to its pre-stroke state and clears stroke tracking.
  // biome-ignore lint/correctness/useExhaustiveDependencies: uses refs intentionally
  const handlePointerCancel = useCallback((e: PointerEvent) => {
    if (e.pointerType === "touch") {
      const entry = activePointersRef.current.get(e.pointerId);
      if (entry?.hasActiveStroke) {
        console.log(
          "[PalmRejection] pointercancel rollback fired for touch pointerId",
          e.pointerId,
        );
        // Restore the pre-stroke snapshot if available
        if (entry.preStrokeSnapshot && p.displayCanvasRef.current) {
          const ctx = p.displayCanvasRef.current.getContext("2d");
          if (ctx && entry.preStrokeSnapshot.data) {
            ctx.putImageData(
              entry.preStrokeSnapshot.data,
              entry.preStrokeSnapshot.x,
              entry.preStrokeSnapshot.y,
            );
          }
        }
        // Cancel any in-progress stroke state
        if (p.isDrawingRef) p.isDrawingRef.current = false;
        if (p.lastPosRef) p.lastPosRef.current = null;
      }
      activePointersRef.current.delete(e.pointerId);
    }
    if (e.pointerType === "pen") {
      // Pen cancelled by system (incoming call, system gesture etc.) — treat as pen lift
      onPenLift(e);
      activePointersRef.current.delete(e.pointerId);
      // Commit current stroke gracefully via the normal up path
      handlePointerUp(e);
    }
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: uses refs/snapshotSelection intentionally
  const handlePointerUp = useCallback((e?: PointerEvent) => {
    const isIPad = p.isIPadRef.current;
    if (e) p.currentPointerTypeRef.current = e.pointerType;
    if (e && e.pointerType === "pen") {
      // Layer 2: Pen lift starts grace period (onPenLift also decrements penDownCountRef)
      onPenLift(e);
    }
    // Clean up active pointer tracking (Layer 3)
    if (e) activePointersRef.current.delete(e.pointerId);
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

    // ── Ctrl+drag layer move: commit pixel data ───────────────────────────
    if (p.ctrlDragMoveActiveRef.current) {
      const _movId = p.ctrlDragMovingLayerIdRef.current;
      const _offset = p.ctrlDragOffsetRef.current;
      const _movLc = p.layerCanvasesRef.current.get(_movId);
      const _beforeSnap = p.strokeStartSnapshotRef.current;
      if (_movLc && _beforeSnap) {
        const _w = _movLc.width;
        const _h = _movLc.height;
        const _movCtx = _movLc.getContext("2d");
        if (_movCtx) {
          // Create a temp canvas of the same size, draw the layer into it at the offset
          const _tmp = document.createElement("canvas");
          _tmp.width = _w;
          _tmp.height = _h;
          const _tmpCtx = _tmp.getContext("2d");
          if (_tmpCtx) {
            _tmpCtx.drawImage(_movLc, _offset.x, _offset.y);
            // Clear the original and draw temp back (pixels outside bounds are cropped)
            _movCtx.clearRect(0, 0, _w, _h);
            _movCtx.drawImage(_tmp, 0, 0);
          }
          // Read after state for undo
          const _afterData = _movCtx.getImageData(0, 0, _w, _h);
          cb.pushHistory({
            type: "pixels",
            layerId: _movId,
            before: _beforeSnap.pixels,
            after: _afterData,
          });
          markLayerBitmapDirty(_movId);
          markCanvasDirty(_movId);
        }
      }
      // Reset ctrl drag state
      p.ctrlDragMoveActiveRef.current = false;
      p.ctrlDragOffsetRef.current = { x: 0, y: 0 };
      p.ctrlDragMovingLayerIdRef.current = "";
      p.strokeStartSnapshotRef.current = null;
      p.lastPosRef.current = null;
      // Restore cursor
      p.updateBrushCursorRef.current();
      cb.composite();
      return;
    }
    // ── End Ctrl+drag layer move commit ───────────────────────────────────

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
          // ── Lasso fill hook ───────────────────────────────────────────────
          // When the fill tool is active in lasso fill mode, fill the enclosed
          // region instead of creating a selection. The lasso tool's core path
          // tracking and boundary detection logic is unchanged — we only intercept
          // the close event here.
          if (
            p.activeToolRef.current === "fill" &&
            p.fillModeRef.current === "lasso" &&
            pts.length >= 3
          ) {
            const layerId = p.activeLayerIdRef.current;
            const lc = p.layerCanvasesRef.current.get(layerId);
            if (lc) {
              const col = p.colorRef.current;
              const [cr, cg, cbC] = hsvToRgb(col.h, col.s, col.v) as [
                number,
                number,
                number,
              ];
              // Capture before state for undo
              const lcCtx = lc.getContext("2d", {
                willReadFrequently: !isIPad,
              });
              const beforePixels =
                lcCtx?.getImageData(0, 0, lc.width, lc.height) ?? null;
              // Apply lasso fill — handles semi-transparent blending and edge expansion
              cb.applyLassoFill(
                lc,
                pts,
                Math.round(cr),
                Math.round(cg),
                Math.round(cbC),
              );
              cb.composite();
              markLayerBitmapDirty(layerId);
              const afterPixels =
                lcCtx?.getImageData(0, 0, lc.width, lc.height) ?? null;
              if (beforePixels && afterPixels) {
                cb.pushHistory({
                  type: "pixels",
                  layerId,
                  before: beforePixels,
                  after: afterPixels,
                });
              }
              markCanvasDirty(layerId);
            }
            // Reset lasso drawing state — do NOT create a selection
            p.selectionDraftPointsRef.current = [];
            p.selectionDraftCursorRef.current = null;
            p.isDrawingSelectionRef.current = false;
            p.lassoHasPolyPointsRef.current = false;
            p.lassoIsDraggingRef.current = false;
            p.lassoStrokeStartRef.current = null;
            p.selectionPolyClosingRef.current = false;
            p.selectionBeforeRef.current = null;
            cb.scheduleComposite();
            return;
          }
          // ── End lasso fill hook ───────────────────────────────────────────

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
      // Stroke is ending — clear the single authoritative suppression flag so
      // subsequent non-liquify composites are not accidentally blocked.
      setLiquifyStrokeActive(false);
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
        _liqBatchLayersRef.current = [];
        p.isCommittingRef.current = false;
        p.lastPosRef.current = null;
        cb.composite();
        return;
      }

      const liqLc = p.layerCanvasesRef.current.get(liqLayerId);
      const liqBefore = p.liquifyBeforeSnapshotRef.current;
      p.liquifyBeforeSnapshotRef.current = null;
      _liqBatchLayersRef.current = [];
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

    // ── Line tool commit ──────────────────────────────────────────────────────
    // Must be checked BEFORE the isDrawingRef guard below — the line tool never
    // sets isDrawingRef, so it would be incorrectly skipped by that guard.
    if (p.activeToolRef.current === "line" && lineIsDrawingRef.current) {
      lineIsDrawingRef.current = false;
      const _lStart = lineStartPosRef.current;
      lineStartPosRef.current = null;
      const _lBefore = lineStartSnapshotRef.current;
      lineStartSnapshotRef.current = null;
      const _lLayerId = p.activeLayerIdRef.current;
      const _lLc = p.layerCanvasesRef.current.get(_lLayerId);
      if (_lStart && _lLc) {
        const _lDisplay = p.displayCanvasRef.current;
        const _lContainer = p.containerRef.current;
        const _lEndPos =
          e && _lDisplay && _lContainer
            ? _getCanvasPosTransformed(
                e.clientX,
                e.clientY,
                _lContainer,
                _lDisplay,
                p.viewTransformRef.current,
                p.isFlippedRef.current,
              )
            : _lStart;
        const _lEndPressure = e
          ? e.pointerType === "mouse"
            ? 1.0
            : Math.max(0, Math.min(1, e.pressure || 1.0))
          : lineStartPressureRef.current;
        // Finalize the pressure sample array:
        // add the endpoint pressure at the final dist, discard any samples beyond it
        const _lFinalDx = _lEndPos.x - _lStart.x;
        const _lFinalDy = _lEndPos.y - _lStart.y;
        const _lFinalDist = Math.sqrt(
          _lFinalDx * _lFinalDx + _lFinalDy * _lFinalDy,
        );
        linePressureSamplesRef.current = linePressureSamplesRef.current.filter(
          (s) => s.dist <= _lFinalDist,
        );
        linePressureSamplesRef.current.push({
          dist: _lFinalDist,
          pressure: _lEndPressure,
        });
        // Ensure sample at dist=0 always exists
        if (
          linePressureSamplesRef.current.length === 0 ||
          linePressureSamplesRef.current[0].dist > 0
        ) {
          linePressureSamplesRef.current.unshift({
            dist: 0,
            pressure: lineStartPressureRef.current,
          });
        }

        const _lSettings = p.brushSettingsRef.current;
        const _lBaseSize = cb.getActiveSize();
        const _lBaseOpacity = p.brushOpacityRef.current;
        const _lFillStyle = p.colorFillStyleRef.current;
        const _lFlushCap = _lSettings.pressureOpacity ? _lBaseOpacity : 1.0;

        // STEP 1: Clear the preview FBOs so the line preview is removed before
        // the commit stamps are placed. Do NOT composite here — compositing on
        // empty FBOs before any stamps are placed wipes the display canvas and
        // causes the stroke to be lost. The composite fires AFTER flushStrokeBuffer
        // (see STEP 3 below), matching the brush tool's commit pattern exactly.
        p.webglBrushRef.current?.clear();

        // STEP 2: Initialise WebGL brush FBOs for the committed stroke.
        // isDrawingRef must be true so flushStrokeBuffer treats this as an
        // active stroke rather than a no-op.
        p.isDrawingRef.current = true;
        cb.buildStrokeCanvases(_lLayerId);
        p.strokeCommitOpacityRef.current = _lBaseOpacity;
        p.flushDisplayCapRef.current = _lFlushCap;
        p.lastCompositeOpacityRef.current = _lSettings.pressureOpacity
          ? 1.0
          : _lBaseOpacity;

        // Compute line length and spacing
        const _lDx = _lEndPos.x - _lStart.x;
        const _lDy = _lEndPos.y - _lStart.y;
        const _lLineDist = Math.sqrt(_lDx * _lDx + _lDy * _lDy);
        const _lStrokeAngle = Math.atan2(_lDy, _lDx);
        const _lSpacingPixels = Math.max(
          0.5,
          (_lSettings.spacing / 100) * _lBaseSize,
        );
        if (_lLineDist < 0.5) {
          // Tap: place a single stamp at the start
          const _ltPressure = interpolateLinePressure(
            linePressureSamplesRef.current,
            0,
          );
          const _ltCurved = evalPressureCurve(
            _ltPressure,
            p.universalPressureCurveRef.current as [
              number,
              number,
              number,
              number,
            ],
          );
          const _ltSize = _lSettings.pressureSize
            ? _lBaseSize *
              (_lSettings.minSize / 100 +
                (1 - _lSettings.minSize / 100) * _ltCurved)
            : _lBaseSize;
          const _ltFlow = _lSettings.flow ?? 1.0;
          const _ltCapAlpha = _lSettings.pressureOpacity
            ? _ltCurved * _lBaseOpacity
            : undefined;
          cb.stampWebGL(
            _lStart.x,
            _lStart.y,
            _ltSize,
            _ltFlow,
            _lSettings,
            _lSettings.rotateMode === "follow"
              ? 0
              : (_lSettings.rotation * Math.PI) / 180,
            _lFillStyle,
            undefined,
            _ltCapAlpha,
          );
        } else {
          // Interpolate stamps along the line using the continuous pressure samples
          let _lAccDist = 0;
          let _lStampCount = 0;
          while (_lAccDist <= _lLineDist) {
            const _lt = _lLineDist > 0 ? _lAccDist / _lLineDist : 0;
            const _lSx = _lStart.x + _lDx * _lt;
            const _lSy = _lStart.y + _lDy * _lt;
            // Interpolate pressure from the continuous samples array
            const _lPressure = interpolateLinePressure(
              linePressureSamplesRef.current,
              _lAccDist,
            );
            const _lCurved = evalPressureCurve(
              _lPressure,
              p.universalPressureCurveRef.current as [
                number,
                number,
                number,
                number,
              ],
            );
            const _lSize = _lSettings.pressureSize
              ? _lBaseSize *
                (_lSettings.minSize / 100 +
                  (1 - _lSettings.minSize / 100) * _lCurved)
              : _lBaseSize;
            const _lFlow = _lSettings.flow ?? 1.0;
            const _lStampOpacity = _lSettings.pressureOpacity
              ? _lFlow
              : _lSettings.pressureFlow
                ? _lFlow *
                  ((_lSettings.minFlow ?? 0) +
                    (1 - (_lSettings.minFlow ?? 0)) * _lCurved)
                : _lFlow;
            const _lCapAlpha = _lSettings.pressureOpacity
              ? _lCurved * _lBaseOpacity
              : undefined;
            const _lBaseAngle =
              _lSettings.rotateMode === "follow"
                ? _lStrokeAngle
                : (_lSettings.rotation * Math.PI) / 180;
            cb.stampWebGL(
              _lSx,
              _lSy,
              _lSize,
              _lStampOpacity,
              _lSettings,
              _lBaseAngle,
              _lFillStyle,
              undefined,
              _lCapAlpha,
            );
            _lAccDist += _lSpacingPixels;
            _lStampCount++;
            // Safety cap to avoid infinite loop on degenerate spacing
            if (_lStampCount > 20000) break;
          }
        }
        // STEP 3: Transfer WebGL FBO contents to the 2D stroke buffer canvas, then flush to layer
        p.webglBrushRef.current?.flushDisplay(p.flushDisplayCapRef.current);
        cb.flushStrokeBuffer(
          _lLc,
          _lSettings.pressureOpacity ? 1.0 : _lBaseOpacity,
          "brush",
        );
        p.isDrawingRef.current = false;
        p.webglBrushRef.current?.clearMask();
        cb.composite();
        // Push history
        if (_lBefore) {
          const _lCtxAfter = _lLc.getContext("2d", {
            willReadFrequently: false,
          });
          if (_lCtxAfter) {
            const _lAfter = _lCtxAfter.getImageData(
              0,
              0,
              _lLc.width,
              _lLc.height,
            );
            cb.pushHistory({
              type: "pixels",
              layerId: _lLayerId,
              before: _lBefore,
              after: _lAfter,
            });
          }
        }
        markCanvasDirty(_lLayerId);
      }
      // Reset all stroke state so spring-load restore works correctly
      p.isCommittingRef.current = false;
      p.strokeStartSnapshotRef.current = null;
      p.lastPosRef.current = null;
      linePressureSamplesRef.current = [];
      lineFarthestDistanceRef.current = 0;
      // Deferred spring-load restore (same pattern as normal stroke)
      if (
        p.pendingSpringRestoreRef.current &&
        p.springLoadedPreviousToolRef.current !== null
      ) {
        const _lRestoreTool = p.springLoadedPreviousToolRef.current;
        p.springLoadedPreviousToolRef.current = null;
        p.springLoadedKeyRef.current = null;
        p.pendingSpringRestoreRef.current = false;
        p.holdTimerRef.current = null;
        p.pendingSpringKeyRef.current = null;
        p.pendingSpringToolRef.current = null;
        Promise.resolve().then(() => {
          callbacksRef.current.handleToolChange(_lRestoreTool);
        });
      }
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
        void _ux;
        void _uy;
        void _ux2;
        void _uy2;
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

    console.log(
      "[Paint] stroke commit — layerId:",
      layerId,
      "canvas in map:",
      !!p.layerCanvasesRef.current.get(layerId),
      "canvas size:",
      p.layerCanvasesRef.current.get(layerId)?.width,
    );

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
              ? baseStrengthUp *
                ((settings.minStrength ?? 0) +
                  (1 - (settings.minStrength ?? 0)) *
                    p.smoothedPressureRef.current)
              : baseStrengthUp;
            cb.renderSmearAlongPoints(
              lc,
              [stab, raw],
              cb.getActiveSize(),
              settings,
              effectiveSmearStrengthUp,
              p.brushOpacityRef.current,
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

    // Spec: carriedBuffer must be null between strokes — reset at every pointer-up
    if (tool === "smudge") {
      clearSmudgeBuffer();
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

    // ── Pending spring-load restore ──
    // If a spring key was released mid-stroke, apply the deferred tool restore now.
    if (
      p.pendingSpringRestoreRef.current &&
      p.springLoadedPreviousToolRef.current !== null
    ) {
      const _restoreTool = p.springLoadedPreviousToolRef.current;
      p.springLoadedPreviousToolRef.current = null;
      p.springLoadedKeyRef.current = null;
      p.pendingSpringRestoreRef.current = false;
      p.holdTimerRef.current = null;
      p.pendingSpringKeyRef.current = null;
      p.pendingSpringToolRef.current = null;
      // Use a microtask to ensure all stroke state is fully settled before switching
      Promise.resolve().then(() => {
        callbacksRef.current.handleToolChange(_restoreTool);
      });
    }
  }, []);

  // ── 6. Attach pointer events to display canvas ───────────────────────────
  // biome-ignore lint/correctness/useExhaustiveDependencies: all mutable state accessed via stable refs
  useEffect(() => {
    const canvas = displayCanvasRef.current;
    if (!canvas) return;
    const onLeave = (e: PointerEvent) => {
      // If there's an active off-canvas pending stroke, don't hide the cursor
      // or terminate the stroke — the window-level listeners keep tracking it.
      if (_offCanvasStrokeRef.current) {
        return;
      }
      if (softwareCursorRef.current)
        softwareCursorRef.current.style.display = "none";
      // Reset stored position so updateBrushCursor won't re-show the software
      // cursor at a stale (off-canvas) coordinate after a tool switch.
      p.pointerScreenPosRef.current = { x: 0, y: 0 };
      // Clear hovered transform handle when pointer leaves the canvas
      hoveredTransformHandleRef.current = null;
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

      // If a stroke started off-canvas and pointer is now entering the canvas,
      // begin painting from the buffered off-canvas path.
      if (_offCanvasStrokeRef.current && !p.isDrawingRef.current) {
        _offCanvasStrokeRef.current = false;
        const buffered = _offCanvasPendingPathRef.current;
        _offCanvasPendingPathRef.current = [];

        // Start the stroke at the canvas entry point (current event)
        handlePointerDown(e);

        // Replay any buffered moves that came after the entry point
        for (const bufferedMove of buffered) {
          handlePointerMove(bufferedMove);
        }
      }
    };

    // ── Ctrl+right-click layer picker ─────────────────────────────────────
    const onContextMenu = (e: MouseEvent) => {
      // Only intercept when Ctrl (or Cmd on Mac) is held.
      if (!e.ctrlKey && !e.metaKey) return;
      // Disabled during figure drawing sessions.
      if (p.isFigureDrawingSessionRef.current) return;

      e.preventDefault();

      const display = displayCanvasRef.current;
      const container = p.containerRef.current;
      if (!display || !container) return;

      // Convert screen coords to canvas coords using the same helper used by
      // pointer handlers.  getBoundingClientRect() is called fresh here — never
      // cached — so pan/zoom changes are always reflected correctly.
      const vt = p.viewTransformRef.current;
      const flipped = p.isFlippedRef.current;
      const pos = _getCanvasPosTransformed(
        e.clientX,
        e.clientY,
        container,
        display,
        vt,
        flipped,
      );

      // Bounds check — if outside the canvas document, do nothing.
      const cw = p.canvasWidthRef.current;
      const ch = p.canvasHeightRef.current;
      if (pos.x < 0 || pos.y < 0 || pos.x >= cw || pos.y >= ch) return;

      const cx = Math.round(pos.x);
      const cy = Math.round(pos.y);

      // Sample alpha of every paint layer at this canvas coordinate.
      // Layers are iterated in flat-array order (lowest index = topmost).
      const layersSnapshot = p.layersRef.current;
      const canvasMap = p.layerCanvasesRef.current;
      const hitLayers: typeof layersSnapshot = [];

      for (const layer of layersSnapshot) {
        // Skip group headers, end_group markers, and ruler layers.
        const t = (layer as { type?: string }).type;
        if (t === "group" || t === "end_group") continue;
        if ((layer as { isRuler?: boolean }).isRuler) continue;

        const lc = canvasMap.get(layer.id);
        if (!lc || lc.width === 0 || lc.height === 0) continue;
        if (cx >= lc.width || cy >= lc.height) continue;

        const ctx = lc.getContext("2d", { willReadFrequently: true });
        if (!ctx) continue;
        const alpha = ctx.getImageData(cx, cy, 1, 1).data[3];
        if (alpha > 0) {
          hitLayers.push(layer);
        }
      }

      if (hitLayers.length === 0) return;

      p.onCtrlRightClick({
        layers: hitLayers as import("../components/LayersPanel").Layer[],
        x: e.clientX,
        y: e.clientY,
      });
    };

    canvas.addEventListener("contextmenu", onContextMenu);
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
    canvas.addEventListener(
      "pointercancel",
      handlePointerCancel as EventListener,
      { passive: false },
    );
    canvas.addEventListener("pointerleave", onLeave, { passive: false });
    return () => {
      canvas.removeEventListener("contextmenu", onContextMenu);
      canvas.removeEventListener("pointerenter", onEnter);
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerup", handlePointerUp as EventListener);
      canvas.removeEventListener(
        "pointercancel",
        handlePointerCancel as EventListener,
      );
      canvas.removeEventListener("pointerleave", onLeave);
    };
  }, [
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerCancel,
  ]);

  // ── 7. Window-level listeners for off-canvas stroke start & cursor ────────
  // These allow strokes that begin outside the canvas element to carry onto
  // the canvas naturally. The brush cursor also shows in the viewport bg area.
  // biome-ignore lint/correctness/useExhaustiveDependencies: all mutable state accessed via stable refs
  useEffect(() => {
    // Tracks whether a stroke started off-canvas and hasn't yet entered the canvas
    _offCanvasStrokeRef.current = false;
    // Buffered pointermove events while the off-canvas stroke hasn't entered yet
    _offCanvasPendingPathRef.current = [];

    const isPointerOverCanvas = (e: PointerEvent): boolean => {
      const canvas = displayCanvasRef.current;
      if (!canvas) return false;
      const rect = canvas.getBoundingClientRect();
      return (
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom
      );
    };

    const isPointerOverContainer = (e: PointerEvent): boolean => {
      const container = containerRef.current;
      if (!container) return false;
      const rect = container.getBoundingClientRect();
      return (
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom
      );
    };

    const onWindowPointerDown = (e: PointerEvent) => {
      // Only track mouse and pen (stylus). Ignore touch (handled by touch system).
      if (e.pointerType === "touch") return;
      // If pointer is on the canvas, the canvas listener handles it — don't duplicate.
      if (isPointerOverCanvas(e)) return;
      // Only care if pointer is within the viewport container background.
      if (!isPointerOverContainer(e)) return;

      // A stroke is starting off-canvas inside the viewport area.
      _offCanvasStrokeRef.current = true;
      _offCanvasPendingPathRef.current = [];
    };

    const onWindowPointerMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;

      // Hide the software cursor whenever the pointer is outside the canvas.
      // It is only shown inside onEnter / onMove (canvas-bound handlers).
      if (!isPointerOverCanvas(e)) {
        const sc = softwareCursorRef.current;
        if (sc && sc.style.display !== "none") {
          sc.style.display = "none";
        }
      }

      // Update screen position so off-canvas stroke buffering stays accurate.
      if (isPointerOverContainer(e)) {
        p.pointerScreenPosRef.current = { x: e.clientX, y: e.clientY };
      }

      // If an off-canvas stroke is pending (not yet entered the canvas),
      // buffer moves so they can be replayed once the pointer enters the canvas.
      if (_offCanvasStrokeRef.current && !p.isDrawingRef.current) {
        if (isPointerOverCanvas(e)) {
          // Pointer just entered the canvas mid-move — the pointerenter event
          // on the canvas will fire and handle starting the stroke with replay.
          // Don't push this move to the buffer; let pointerenter take it.
        } else {
          // Still off-canvas — buffer the event for potential future replay.
          // Keep the buffer small (last 16 events) to avoid excess memory use.
          const buf = _offCanvasPendingPathRef.current;
          buf.push(e);
          if (buf.length > 16) buf.shift();
        }
      }
    };

    const onWindowPointerUp = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      // Clear any off-canvas stroke state regardless of where pointer is.
      _offCanvasStrokeRef.current = false;
      _offCanvasPendingPathRef.current = [];
      // If we were drawing (stroke already started on canvas), let handlePointerUp commit.
      // The canvas pointerup listener handles it if the pointer is over the canvas,
      // but if the user releases outside the canvas while drawing, we need to commit here.
      if (p.isDrawingRef.current && !isPointerOverCanvas(e)) {
        handlePointerUp(e);
      }
    };

    window.addEventListener("pointerdown", onWindowPointerDown, {
      passive: false,
    });
    window.addEventListener("pointermove", onWindowPointerMove, {
      passive: true,
    });
    window.addEventListener("pointerup", onWindowPointerUp, { passive: false });

    return () => {
      window.removeEventListener("pointerdown", onWindowPointerDown);
      window.removeEventListener("pointermove", onWindowPointerMove);
      window.removeEventListener("pointerup", onWindowPointerUp);
    };
  }, [handlePointerDown, handlePointerMove, handlePointerUp]);

  // ── 8. Window-level ruler pointer listeners (Fix 1) ──────────────────────
  // When the ruler tool is active, ruler handles may be positioned anywhere in
  // the viewport — including outside the canvas element's bounds. The canvas-
  // level pointer listeners only fire within the canvas rect, so off-canvas
  // handles are unreachable via those. This effect attaches window-level
  // listeners that handle ruler pointer events wherever they occur.
  //
  // These listeners are ONLY active when the ruler tool is selected. For every
  // other tool, the canvas-level listeners remain the sole handlers.
  //
  // Coordinate mapping: pointer client coords → canvas-space via the same
  // _getCanvasPosTransformed helper used by handlePointerDown/Move.
  // biome-ignore lint/correctness/useExhaustiveDependencies: all mutable state accessed via stable refs
  useEffect(() => {
    const onWindowRulerPointerDown = (e: PointerEvent) => {
      // Only handle ruler tool
      if (p.activeToolRef.current !== "ruler") return;
      // Touch is handled by the touch system
      if (e.pointerType === "touch") return;

      const display = p.displayCanvasRef.current;
      const container = p.containerRef.current;
      if (!display || !container) return;

      // Check whether the pointer is over the canvas element itself.
      // If it is, the canvas-level pointerdown already fired (or is about to),
      // so we must not duplicate the event.
      const canvasRect = display.getBoundingClientRect();
      const overCanvas =
        e.clientX >= canvasRect.left &&
        e.clientX <= canvasRect.right &&
        e.clientY >= canvasRect.top &&
        e.clientY <= canvasRect.bottom;
      if (overCanvas) return;

      // Check whether the pointer is within the viewport container
      const containerRect = container.getBoundingClientRect();
      const overContainer =
        e.clientX >= containerRect.left &&
        e.clientX <= containerRect.right &&
        e.clientY >= containerRect.top &&
        e.clientY <= containerRect.bottom;
      if (!overContainer) return;

      e.preventDefault();

      const pos = _getCanvasPosTransformed(
        e.clientX,
        e.clientY,
        container,
        display,
        p.viewTransformRef.current,
        p.isFlippedRef.current,
      );

      const rulerLayer = p.layersRef.current.find((l) => l.isRuler);
      if (!rulerLayer) return;

      const cb = callbacksRef.current;
      const rh = cb.rulerHandlers;
      const handleRadius = Math.max(12, 24 / p.viewTransformRef.current.zoom);
      const layerPresetType = rulerLayer.rulerPresetType ?? "perspective-1pt";

      let consumed = false;
      if (layerPresetType === "line") {
        consumed = rh.handleLineRulerPointerDown(pos, rulerLayer, handleRadius);
      } else if (layerPresetType === "perspective-1pt") {
        consumed = rh.handle1ptRulerPointerDown(pos, rulerLayer, handleRadius);
      } else if (layerPresetType === "perspective-2pt") {
        consumed = rh.handle2ptRulerPointerDown(pos, rulerLayer, handleRadius);
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
        consumed = rh.handleOvalRulerPointerDown(pos, rulerLayer, handleRadius);
      } else if (layerPresetType === "grid") {
        consumed = rh.handleGridRulerPointerDown(pos, rulerLayer, handleRadius);
      }
      void consumed;
      cb.scheduleRulerOverlay();
    };

    const onWindowRulerPointerMove = (e: PointerEvent) => {
      // Only handle ruler tool when a ruler drag is in progress
      if (p.activeToolRef.current !== "ruler") return;
      if (e.pointerType === "touch") return;

      const cb = callbacksRef.current;
      const rh = cb.rulerHandlers;

      // Only take over if a ruler drag is actually active
      if (
        !rh.isLineRulerDragging() &&
        !rh.is1pt2ptRulerDragging() &&
        !rh.is3ptExclusiveDragging() &&
        !rh.is5ptDragging() &&
        !rh.isOvalDragging() &&
        !rh.isGridDragging()
      ) {
        return;
      }

      const display = p.displayCanvasRef.current;
      const container = p.containerRef.current;
      if (!display || !container) return;

      // If the pointer is over the canvas, the canvas-level listener will handle it
      const canvasRect = display.getBoundingClientRect();
      const overCanvas =
        e.clientX >= canvasRect.left &&
        e.clientX <= canvasRect.right &&
        e.clientY >= canvasRect.top &&
        e.clientY <= canvasRect.bottom;
      if (overCanvas) return;

      const pos = _getCanvasPosTransformed(
        e.clientX,
        e.clientY,
        container,
        display,
        p.viewTransformRef.current,
        p.isFlippedRef.current,
      );

      const rulerLayer = p.layersRef.current.find((l) => l.isRuler);
      if (!rulerLayer) return;

      rh.handleLineRulerPointerMove(pos, rulerLayer);
      rh.handle1pt2ptRulerPointerMove(pos, rulerLayer);
      rh.handle3ptExclusivePointerMove(pos, rulerLayer);
      rh.handle5ptRulerPointerMove(pos, rulerLayer);
      rh.handleOvalRulerPointerMove(pos, rulerLayer);
      rh.handleGridRulerPointerMove(pos, rulerLayer);
      cb.scheduleRulerOverlay();
    };

    const onWindowRulerPointerUp = (e: PointerEvent) => {
      // Only handle ruler tool
      if (p.activeToolRef.current !== "ruler") return;
      if (e.pointerType === "touch") return;

      const cb = callbacksRef.current;
      const rh = cb.rulerHandlers;

      if (
        !rh.isLineRulerDragging() &&
        !rh.is1pt2ptRulerDragging() &&
        !rh.is3ptExclusiveDragging() &&
        !rh.is5ptDragging() &&
        !rh.isOvalDragging() &&
        !rh.isGridDragging()
      ) {
        return;
      }

      const display = p.displayCanvasRef.current;
      const container = p.containerRef.current;
      if (!display || !container) return;

      // If the pointer is over the canvas, the canvas-level pointerup will handle it
      const canvasRect = display.getBoundingClientRect();
      const overCanvas =
        e.clientX >= canvasRect.left &&
        e.clientX <= canvasRect.right &&
        e.clientY >= canvasRect.top &&
        e.clientY <= canvasRect.bottom;
      if (overCanvas) return;

      const rulerLayer = p.layersRef.current.find((l) => l.isRuler);
      if (!rulerLayer) return;

      rh.handleLineRulerPointerUp(rulerLayer);
      rh.handle1pt2ptRulerPointerUp(rulerLayer);
      rh.handle3pt5ptRulerPointerUp(rulerLayer);
      rh.handleEllipseGridRulerPointerUp(rulerLayer);
    };

    window.addEventListener("pointerdown", onWindowRulerPointerDown, {
      passive: false,
    });
    window.addEventListener("pointermove", onWindowRulerPointerMove, {
      passive: true,
    });
    window.addEventListener("pointerup", onWindowRulerPointerUp, {
      passive: false,
    });

    return () => {
      window.removeEventListener("pointerdown", onWindowRulerPointerDown);
      window.removeEventListener("pointermove", onWindowRulerPointerMove);
      window.removeEventListener("pointerup", onWindowRulerPointerUp);
    };
  }, [handlePointerDown, handlePointerMove, handlePointerUp]);

  return { shiftHeld };
}
