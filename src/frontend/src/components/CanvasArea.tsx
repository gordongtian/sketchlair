import type { HSVAColor } from "@/utils/colorUtils";
import type { Preset } from "@/utils/toolPresets";
import { Layers, MapPin, Palette } from "lucide-react";
import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { MobileLayoutState } from "../hooks/useIsMobile";
import {
  readMobileLayoutState,
  writeMobileLayoutState,
} from "../hooks/useIsMobile";
import type { ViewTransform } from "../types";
import type { BrushSettings } from "./BrushSettingsPanel";
import { ColorPickerPanel } from "./ColorPickerPanel";
import { FillPresetsPanel } from "./FillPresetsPanel";
import type { FillMode, FillSettings } from "./FillPresetsPanel";
import { LassoPresetsPanel } from "./LassoPresetsPanel";
import type { Layer } from "./LayersPanel";
import { LayersPanel } from "./LayersPanel";
import { MobileCanvasSliders } from "./MobileCanvasSliders";
import { type RulerPresetType, RulerPresetsPanel } from "./RulerPresetsPanel";
import { ToolPresetsPanel } from "./ToolPresetsPanel";
import type { LassoMode, Tool } from "./Toolbar";

// --- Mobile panel dragging infrastructure ---

interface PanelPosition {
  x: number;
  y: number;
}

/** LP tab width in px (the 40px button stack on the right edge) */
const LP_TAB_WIDTH = 40;

/** Left toolbar width in px (tool buttons column) */
const TOOLBAR_WIDTH = 46;

/**
 * Auto-pin threshold: if the user drags more than this many pixels from the
 * pointer-down origin, the panel is silently pinned mid-drag.
 */
export const PANEL_DRAG_AUTOPIN_THRESHOLD = 50;

/** Side the panel opens on — right (LP panels) or left (presets from toolbar) */
type PanelSide = "right" | "left";

interface UsePanelDragOptions {
  /** Which side the panel defaults to when not pinned. */
  side?: PanelSide;
  /**
   * Left-hand mode flag — flips the default/snap-back position:
   * - LP panels (normally "right"): open to right of LP tabs on LEFT edge → left: LP_TAB_WIDTH + 8
   * - Presets panel (normally "left"): open to left of toolbar on RIGHT edge → right: TOOLBAR_WIDTH + 8
   */
  leftHanded?: boolean;
  isMobile?: boolean;
  /** When false, toolbar-side constraint is removed so panels can reach the toolbar edge */
  showFOBSliders?: boolean;
}

/**
 * Hook that provides pin state + drag behaviour for a single mobile panel.
 * Position is tracked in a ref during drag to avoid re-renders.
 * Only the pinned boolean lives in state.
 */
function usePanelDrag(options: UsePanelDragOptions | PanelSide = "right") {
  // Support both old string API and new object API
  const opts: UsePanelDragOptions =
    typeof options === "string" ? { side: options } : options;
  const side: PanelSide = opts.side ?? "right";
  const leftHanded = opts.leftHanded ?? false;
  const isMobile = opts.isMobile ?? false;
  const showFOBSliders = opts.showFOBSliders ?? true;

  const [pinned, setPinned] = useState(false);
  // Saved position ref — survives unpins, reset only on app reload
  const lastPosRef = useRef<PanelPosition | null>(null);
  // Default button-aligned Y for snap-back after short drag
  const defaultYRef = useRef<number>(8);
  // DOM ref for the panel element (set by each panel's outer div)
  const panelRef = useRef<HTMLDivElement | null>(null);
  // Drag state stored in refs to avoid re-renders
  const isDraggingRef = useRef(false);
  const dragStartPointerRef = useRef({ x: 0, y: 0 });
  const dragStartPanelRef = useRef({ x: 0, y: 0 });
  // Whether auto-pin triggered during this drag
  const autoPinnedThisDragRef = useRef(false);
  // Expose setPinned so callers can force-unpin
  const pinnedRef = useRef(pinned);
  pinnedRef.current = pinned;

  /**
   * Effective side: in left-hand mode on mobile, LP panels flip from "right"
   * to "left" (they open from the left edge), and presets flip from "left"
   * to "right" (they open from the right edge near the toolbar).
   */
  const effectiveSide: PanelSide =
    isMobile && leftHanded ? (side === "right" ? "left" : "right") : side;

  /** Clamp panel position to stay within canvas and clear of the toolbar when FOB sliders are shown */
  const clampPosition = useCallback(
    (x: number, y: number): PanelPosition => {
      const el = panelRef.current;
      if (!el) return { x, y };
      const pw = el.offsetWidth;
      const ph = el.offsetHeight;
      const container = el.closest<HTMLElement>(
        ".canvas-workspace-bg, [data-canvas-area]",
      );
      const cw = container ? container.clientWidth : window.innerWidth;
      const ch = container ? container.clientHeight : window.innerHeight;
      // Keep a small handle visible on screen (24px minimum handle strip)
      const HANDLE = 24;
      let maxX: number;
      let minX: number;
      if (effectiveSide === "left") {
        // Panel opens from left edge
        // No LP tab constraint — panels can overlap tabs
        minX = -pw + HANDLE; // allow sliding mostly off-screen left but keep a handle visible
        // Right-side: only constrain if FOB sliders are shown (toolbar visible on right in left-hand mode)
        maxX =
          isMobile && leftHanded && showFOBSliders
            ? cw - TOOLBAR_WIDTH - 4 - pw
            : cw - HANDLE;
      } else {
        // Panel opens from right edge
        // Left-side: only constrain if FOB sliders are shown (toolbar visible on left in normal mode)
        minX = !leftHanded && showFOBSliders ? TOOLBAR_WIDTH + 4 : HANDLE - pw;
        // No LP tab constraint — panels can overlap tabs
        maxX = cw - HANDLE;
      }
      const maxY = ch - ph;
      return {
        x: Math.max(minX, Math.min(x, maxX)),
        y: Math.max(0, Math.min(y, maxY)),
      };
    },
    [effectiveSide, leftHanded, isMobile, showFOBSliders],
  );

  /** Apply position to DOM element directly (no React state) */
  const applyPosition = useCallback((pos: PanelPosition) => {
    const el = panelRef.current;
    if (!el) return;
    el.style.left = `${pos.x}px`;
    el.style.top = `${pos.y}px`;
    el.style.right = "auto";
    el.style.transform = "none";
  }, []);

  /** Set the default Y position (button-aligned) for snap-back */
  const setDefaultY = useCallback((y: number) => {
    defaultYRef.current = y;
  }, []);

  /** Start dragging from the title bar — works whether pinned or not */
  const handleTitleBarPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.stopPropagation();
      const el = panelRef.current;
      if (!el) return;

      // Resolve absolute left/top from current rendered position
      const rect = el.getBoundingClientRect();
      const container = el.closest<HTMLElement>(
        ".canvas-workspace-bg, [data-canvas-area]",
      );
      const containerRect = container
        ? container.getBoundingClientRect()
        : { left: 0, top: 0 };

      const startX = rect.left - containerRect.left;
      const startY = rect.top - containerRect.top;
      applyPosition({ x: startX, y: startY });

      isDraggingRef.current = true;
      autoPinnedThisDragRef.current = false;
      dragStartPointerRef.current = { x: e.clientX, y: e.clientY };
      dragStartPanelRef.current = { x: startX, y: startY };

      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [applyPosition],
  );

  const handleTitleBarPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, onAutoPinned?: () => void) => {
      if (!isDraggingRef.current) return;
      e.stopPropagation();
      const dx = e.clientX - dragStartPointerRef.current.x;
      const dy = e.clientY - dragStartPointerRef.current.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Auto-pin if drag distance exceeds threshold and not yet pinned
      if (dist > PANEL_DRAG_AUTOPIN_THRESHOLD && !pinnedRef.current) {
        autoPinnedThisDragRef.current = true;
        setPinned(true);
        onAutoPinned?.();
      }

      const newPos = clampPosition(
        dragStartPanelRef.current.x + dx,
        dragStartPanelRef.current.y + dy,
      );
      applyPosition(newPos);
    },
    [clampPosition, applyPosition],
  );

  const handleTitleBarPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isDraggingRef.current) return;
      e.stopPropagation();
      isDraggingRef.current = false;

      const el = panelRef.current;
      if (!el) return;

      if (pinnedRef.current) {
        // Save final position to lastPosRef
        const x = Number.parseFloat(el.style.left) || 0;
        const y = Number.parseFloat(el.style.top) || 0;
        lastPosRef.current = { x, y };
      } else {
        // Short drag — snap back to default button-aligned position
        const defaultY = defaultYRef.current;
        const container = el.closest<HTMLElement>(
          ".canvas-workspace-bg, [data-canvas-area]",
        );
        const cw = container ? container.clientWidth : window.innerWidth;
        const pw = el.offsetWidth;
        let snapX: number;
        if (effectiveSide === "left") {
          // LP panels in left-hand mode open from left edge
          snapX = LP_TAB_WIDTH + 8;
        } else if (isMobile && leftHanded) {
          // Presets in left-hand mode snap to right of toolbar on right edge
          snapX = cw - TOOLBAR_WIDTH - 8 - pw;
        } else if (side === "right") {
          snapX = cw - LP_TAB_WIDTH - 8 - pw;
        } else {
          snapX = TOOLBAR_WIDTH + 8;
        }
        applyPosition(clampPosition(snapX, defaultY));
      }
    },
    [side, effectiveSide, leftHanded, isMobile, applyPosition, clampPosition],
  );

  /**
   * Toggle pin state.
   * - Pinning: panel stays open, becomes draggable
   * - Unpinning: save position to lastPosRef, close panel (caller responsible for closing)
   */
  const togglePin = useCallback((onClose: () => void) => {
    if (pinnedRef.current) {
      // Save current position before unpinning
      const el = panelRef.current;
      if (el) {
        const x = Number.parseFloat(el.style.left) || 0;
        const y = Number.parseFloat(el.style.top) || 0;
        if (x !== 0 || y !== 0) {
          lastPosRef.current = { x, y };
        }
      }
      setPinned(false);
      onClose();
    } else {
      setPinned(true);
    }
  }, []);

  /**
   * Force-close this panel: save position, unpin, and call onClose.
   * Used when the LP button is tapped while the panel is open — always closes
   * regardless of pin state.
   */
  const forceClose = useCallback((onClose: () => void) => {
    const el = panelRef.current;
    if (el) {
      const x = Number.parseFloat(el.style.left) || 0;
      const y = Number.parseFloat(el.style.top) || 0;
      if (x !== 0 || y !== 0) {
        lastPosRef.current = { x, y };
      }
    }
    setPinned(false);
    onClose();
  }, []);

  /**
   * Get the inline style for the panel.
   * - Pinned with last position: use last position
   * - Default: button-aligned position based on effective side
   */
  const getPanelStyle = useCallback(
    (buttonY?: number): React.CSSProperties => {
      if (pinned && lastPosRef.current) {
        return {
          position: "absolute",
          left: lastPosRef.current.x,
          top: lastPosRef.current.y,
          right: "auto",
          transform: "none",
        };
      }
      // Use buttonY if provided, otherwise fall back to defaultYRef (set on last open)
      const topY = buttonY !== undefined ? buttonY : defaultYRef.current;
      if (effectiveSide === "left") {
        // LP panels in left-hand mode: open to the right of the LP tab strip on the left edge
        return {
          position: "absolute",
          top: topY,
          transform: "none",
          left: LP_TAB_WIDTH + 8,
          right: "auto",
        };
      }
      if (isMobile && leftHanded) {
        // Presets in left-hand mode: open to the left of the toolbar on the right edge
        return {
          position: "absolute",
          top: topY,
          transform: "none",
          right: TOOLBAR_WIDTH + 8,
          left: "auto",
        };
      }
      if (side === "right") {
        // LP panels in normal mode: open to the left of the LP tab strip on the right edge
        return {
          position: "absolute",
          top: topY,
          transform: "none",
          right: LP_TAB_WIDTH + 8,
          left: "auto",
        };
      }
      // Presets in normal mode: open to the right of the toolbar on the left edge
      return {
        position: "absolute",
        top: topY,
        transform: "none",
        left: TOOLBAR_WIDTH + 8,
        right: "auto",
      };
    },
    [pinned, side, effectiveSide, leftHanded, isMobile],
  );

  return {
    pinned,
    setPinned,
    panelRef,
    getPanelStyle,
    setDefaultY,
    togglePin,
    forceClose,
    handleTitleBarPointerDown,
    handleTitleBarPointerMove,
    handleTitleBarPointerUp,
    /** Effective side accounting for left-hand mode — used for animation direction */
    effectiveSide,
  };
}

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
  | "adjustments"
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
  toolSizesRef: RefObject<Record<string, number | undefined>>;
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

  // Layers panel (mobile floating overlay) props
  layerTree: import("../types").LayerNode[];
  activeLayerId: string;
  selectedLayerIds: Set<string>;
  layerThumbnails: Record<string, string>;
  onSetActive: (id: string) => void;
  onToggleVisible: (id: string) => void;
  onSetOpacity: (id: string, opacity: number) => void;
  onSetOpacityLive: (id: string, opacity: number) => void;
  onSetOpacityCommit: (id: string, before: number, after: number) => void;
  onSetBlendMode: (id: string, blendMode: string) => void;
  onAddLayer: () => void;
  onDeleteLayer: (id: string) => void;
  onReorderLayers: (ids: string[]) => void;
  onClearLayer: () => void;
  onToggleClippingMask: (id: string) => void;
  onMergeLayers: () => void;
  onRenameLayer: (id: string, name: string) => void;
  onToggleAlphaLock: (id: string) => void;
  onToggleLockLayer: (id: string) => void;
  onDuplicateLayer: () => void;
  onCutToNewLayer: () => void;
  onCopyToNewLayer: () => void;
  hasSelection?: boolean;
  onCtrlClickLayer: (id: string) => void;
  onToggleRulerActive: (id: string) => void;
  onToggleGroupCollapse: (groupId: string) => void;
  onRenameGroup: (groupId: string, name: string) => void;
  onSetGroupOpacity: (groupId: string, opacity: number) => void;
  onSetGroupOpacityLive: (groupId: string, opacity: number) => void;
  onSetGroupOpacityCommit: (
    groupId: string,
    before: number,
    after: number,
  ) => void;
  onToggleGroupVisible: (groupId: string) => void;
  onOpenDeleteGroup: (groupId: string) => void;
  onReorderTree: (newTree: import("../types").LayerNode[] | Layer[]) => void;
  onReorderTreeSilent: (
    newTree: import("../types").LayerNode[] | Layer[],
  ) => void;
  onReorderLayersSilent: (ids: string[]) => void;
  onCommitReorderHistory: (
    treeBefore: import("../types").LayerNode[],
    treeAfter: import("../types").LayerNode[],
    layersBefore: Layer[],
    layersAfter: Layer[],
  ) => void;
  onToggleLayerSelection: (id: string, shiftHeld: boolean) => void;
  onCreateGroup: () => void;
  shiftHeld: boolean;
  brushTipEditorActive?: boolean;

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
  showMobileLayersPanel: boolean;
  showFOBSliders?: boolean;
  recentColors: string[];
  wandTolerance: number;
  wandContiguous: boolean;
  wandGrowShrink: number;
  wandEdgeExpand: number;

  // CSS cursor
  cursor: string;

  // Callbacks — mobile
  onSetActiveMobilePanel: (
    panel: "layers" | "presets" | "palette" | null,
  ) => void;
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
  onWandEdgeExpandChange: (v: number) => void;
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

  /**
   * Pre-rendered AdjustmentsPresetsPanel node for mobile popup.
   * Shown in the mobile presets popup when activeSubpanel === 'adjustments'.
   */
  mobileAdjustmentsPanel?: ReactNode;

  /** Called when brush tip editor opens — mobile only */
  onEnterBrushTipEditor?: (onAccept: (dataUrl: string) => void) => void;
  /** Ref that CanvasArea writes a saveMobileLayoutState function into — caller invokes before mode switch */
  saveMobileLayoutRef?: React.MutableRefObject<(() => void) | null>;
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
  layerTree,
  activeLayerId,
  selectedLayerIds,
  layerThumbnails,
  onSetActive,
  onToggleVisible,
  onSetOpacity,
  onSetOpacityLive,
  onSetOpacityCommit,
  onSetBlendMode,
  onAddLayer,
  onDeleteLayer,
  onReorderLayers,
  onClearLayer,
  onToggleClippingMask,
  onMergeLayers,
  onRenameLayer,
  onToggleAlphaLock,
  onToggleLockLayer,
  onDuplicateLayer,
  onCutToNewLayer,
  onCopyToNewLayer,
  hasSelection = false,
  onCtrlClickLayer,
  onToggleRulerActive,
  onToggleGroupCollapse,
  onRenameGroup,
  onSetGroupOpacity,
  onSetGroupOpacityLive,
  onSetGroupOpacityCommit,
  onToggleGroupVisible,
  onOpenDeleteGroup,
  onReorderTree,
  onReorderTreeSilent,
  onReorderLayersSilent,
  onCommitReorderHistory,
  onToggleLayerSelection,
  onCreateGroup,
  shiftHeld,
  brushTipEditorActive = false,
  scheduleRulerOverlay,
  isCropActive,
  cropRectVersion,
  isMobile,
  leftHanded,
  showMobileColorPanel,
  showMobilePresetsPanel,
  showMobileLayersPanel,
  showFOBSliders = true,
  recentColors,
  wandTolerance,
  wandContiguous,
  wandGrowShrink,
  wandEdgeExpand,
  cursor,
  onSetActiveMobilePanel,
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
  onWandEdgeExpandChange,
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
  mobileAdjustmentsPanel,
  onEnterBrushTipEditor,
  saveMobileLayoutRef,
}: CanvasAreaProps) {
  // Derive ruler layer props from layers array
  const rulerLayer = layers.find((l) => l.isRuler);

  // ── Change 5: Read stored mobile layout BEFORE hooks initialize ──────────
  // This is a module-level read that happens synchronously so panel positions
  // can be injected into lastPosRef before the first render.
  const storedLayoutRef = useRef<MobileLayoutState | null>(null);
  if (storedLayoutRef.current === null) {
    storedLayoutRef.current = readMobileLayoutState();
  }

  // --- Mobile panel drag hooks (one per panel) ---
  // In left-hand mode: LP panels (color/layers) flip to left side, presets flip to right side
  const colorDrag = usePanelDrag({
    side: "right",
    leftHanded,
    isMobile,
    showFOBSliders,
  });
  const presetsDrag = usePanelDrag({
    side: "left",
    leftHanded,
    isMobile,
    showFOBSliders,
  });
  const layersDrag = usePanelDrag({
    side: "right",
    leftHanded,
    isMobile,
    showFOBSliders,
  });

  // Restore stored panel positions into lastPosRef on first mount (Change 5)
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional one-time restore on mount
  useEffect(() => {
    if (!isMobile) return;
    const stored = storedLayoutRef.current;
    if (!stored) return;
    if (stored.palettePanel) {
      colorDrag.panelRef.current?.style.setProperty(
        "left",
        `${stored.palettePanel.x}px`,
      );
      colorDrag.panelRef.current?.style.setProperty(
        "top",
        `${stored.palettePanel.y}px`,
      );
      // If was pinned, restore pin state
      if (stored.palettePanel.pinned) {
        colorDrag.setPinned(true);
      }
    }
    if (stored.layersPanel) {
      layersDrag.panelRef.current?.style.setProperty(
        "left",
        `${stored.layersPanel.x}px`,
      );
      layersDrag.panelRef.current?.style.setProperty(
        "top",
        `${stored.layersPanel.y}px`,
      );
      if (stored.layersPanel.pinned) {
        layersDrag.setPinned(true);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobile]);

  /** Save current mobile layout to localStorage (Change 5) */
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally omits ref.current (stable DOM refs)
  const saveMobileLayoutState = useCallback(() => {
    const el0 = colorDrag.panelRef.current;
    const el1 = layersDrag.panelRef.current;
    const state: MobileLayoutState = {
      palettePanel: el0
        ? {
            x: Number.parseFloat(el0.style.left) || 0,
            y: Number.parseFloat(el0.style.top) || 0,
            pinned: colorDrag.pinned,
          }
        : undefined,
      layersPanel: el1
        ? {
            x: Number.parseFloat(el1.style.left) || 0,
            y: Number.parseFloat(el1.style.top) || 0,
            pinned: layersDrag.pinned,
          }
        : undefined,
      showFOBSliders,
    };
    writeMobileLayoutState(state);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colorDrag.pinned, layersDrag.pinned, showFOBSliders]);

  // Expose saveMobileLayoutState via ref so PaintingApp can call it before mode switch
  useEffect(() => {
    if (saveMobileLayoutRef) {
      saveMobileLayoutRef.current = saveMobileLayoutState;
    }
  }, [saveMobileLayoutRef, saveMobileLayoutState]);

  // ── Change 1: Mobile panel z-order tracking ───────────────────────────────
  type PanelId = "palette" | "layers" | "presets";
  const [panelZOrder, setPanelZOrder] = useState<PanelId[]>([]);

  const bringPanelToFront = useCallback(
    (panelId: PanelId) => {
      if (!isMobile) return;
      setPanelZOrder((prev) => {
        const filtered = prev.filter((id) => id !== panelId);
        return [...filtered, panelId];
      });
    },
    [isMobile],
  );

  const removePanelFromZOrder = useCallback((panelId: PanelId) => {
    setPanelZOrder((prev) => prev.filter((id) => id !== panelId));
  }, []);

  /** Derive z-index for a panel. Base = 50 (above canvas, below save/export overlays).
   *  Last element in panelZOrder gets highest z-index. */
  const getPanelZIndex = useCallback(
    (panelId: PanelId) => {
      if (!isMobile) return 50;
      const idx = panelZOrder.indexOf(panelId);
      if (idx === -1) return 50;
      return 50 + idx + 1;
    },
    [isMobile, panelZOrder],
  );

  // ── Issue 2: Bring panel to front whenever it is opened (show prop → true) ──
  // biome-ignore lint/correctness/useExhaustiveDependencies: bringPanelToFront is stable
  useEffect(() => {
    if (showMobileColorPanel) bringPanelToFront("palette");
  }, [showMobileColorPanel]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: bringPanelToFront is stable
  useEffect(() => {
    if (showMobilePresetsPanel) bringPanelToFront("presets");
  }, [showMobilePresetsPanel]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: bringPanelToFront is stable
  useEffect(() => {
    if (showMobileLayersPanel) bringPanelToFront("layers");
  }, [showMobileLayersPanel]);

  // Pinned panels are visible independently of activeMobilePanel
  const colorVisible = showMobileColorPanel || colorDrag.pinned;
  const presetsVisible = showMobilePresetsPanel || presetsDrag.pinned;
  const layersVisible =
    (showMobileLayersPanel && !brushTipEditorActive) || layersDrag.pinned;

  // Refs for LP tab buttons — used to measure Y position for panel alignment
  const layersBtnRef = useRef<HTMLButtonElement | null>(null);
  const colorBtnRef = useRef<HTMLButtonElement | null>(null);

  // Shared title bar style
  const titleBarStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "6px 10px 6px 12px",
    borderBottom: "1px solid oklch(var(--border))",
    flexShrink: 0,
    cursor: "default",
    userSelect: "none",
    background: "oklch(var(--sidebar-left) / 0.8)",
  };

  const titleBarTextStyle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "oklch(var(--muted-foreground))",
  };

  const pinButtonStyle = (isPinned: boolean): React.CSSProperties => ({
    width: 26,
    height: 26,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "none",
    border: "none",
    borderRadius: 4,
    cursor: "pointer",
    color: isPinned ? "oklch(var(--accent))" : "oklch(var(--muted-foreground))",
    padding: 0,
    transition: "color 0.15s",
    flexShrink: 0,
  });

  /** Backdrop that closes the unpinned panel on tap */
  const renderBackdrop = (onClose: () => void) => (
    <div
      style={{ position: "absolute", inset: 0, zIndex: 40 }}
      onPointerDown={(e) => {
        e.stopPropagation();
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerUp={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onClose();
      }}
    />
  );

  return (
    <div
      ref={containerRef}
      className="flex-1 relative overflow-hidden canvas-workspace-bg"
      data-canvas-area
      style={{ cursor, touchAction: "none" }}
    >
      {/* Mobile: vertical canvas edge sliders (Flow, Opacity, Size) — only for tools that use them.
          Only shown when showFOBSliders is true (Change 4). */}
      {isMobile &&
        showFOBSliders &&
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
      {/* Mobile: LP tab — TWO buttons only: Layers (L) at top, Color Palette (C) at bottom */}
      {isMobile && (
        <div
          style={{
            position: "absolute",
            top: "max(8px, env(safe-area-inset-top, 8px))",
            ...(leftHanded ? { left: 0 } : { right: 0 }),
            zIndex: 25,
            display: "flex",
            flexDirection: "column",
            gap: 0,
            alignItems: "center",
          }}
        >
          {/* Layers button */}
          <button
            ref={layersBtnRef}
            type="button"
            data-ocid="mobile.layers_button"
            onClick={() => {
              if (showMobileLayersPanel || layersDrag.pinned) {
                // Always close — unpin if needed
                removePanelFromZOrder("layers");
                layersDrag.forceClose(() => onSetActiveMobilePanel(null));
              } else {
                // Measure button Y relative to canvas container
                const btn = layersBtnRef.current;
                const container = btn?.closest<HTMLElement>(
                  ".canvas-workspace-bg, [data-canvas-area]",
                );
                if (btn && container) {
                  const btnRect = btn.getBoundingClientRect();
                  const cRect = container.getBoundingClientRect();
                  const buttonY = btnRect.top - cRect.top;
                  layersDrag.setDefaultY(buttonY);
                }
                bringPanelToFront("layers");
                onSetActiveMobilePanel("layers");
              }
            }}
            style={{
              width: 40,
              height: 40,
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background:
                showMobileLayersPanel || layersDrag.pinned
                  ? "oklch(var(--accent))"
                  : "rgba(0,0,0,0.45)",
              backdropFilter:
                showMobileLayersPanel || layersDrag.pinned
                  ? undefined
                  : "blur(6px)",
              borderRadius: leftHanded ? "0 8px 0 0" : "8px 0 0 0",
              border:
                showMobileLayersPanel || layersDrag.pinned
                  ? "1px solid oklch(var(--accent))"
                  : "1px solid rgba(255,255,255,0.15)",
              borderBottom: "none",
              color:
                showMobileLayersPanel || layersDrag.pinned
                  ? "oklch(var(--accent-text))"
                  : "rgba(255,255,255,0.85)",
              cursor: "pointer",
            }}
            title="Layers"
          >
            <Layers size={18} />
          </button>
          {/* Color panel button */}
          <button
            ref={colorBtnRef}
            type="button"
            data-ocid="mobile.color_panel_button"
            onClick={() => {
              if (showMobileColorPanel || colorDrag.pinned) {
                // Always close — unpin if needed
                removePanelFromZOrder("palette");
                colorDrag.forceClose(() => onSetActiveMobilePanel(null));
              } else {
                // Measure button Y relative to canvas container
                const btn = colorBtnRef.current;
                const container = btn?.closest<HTMLElement>(
                  ".canvas-workspace-bg, [data-canvas-area]",
                );
                if (btn && container) {
                  const btnRect = btn.getBoundingClientRect();
                  const cRect = container.getBoundingClientRect();
                  const buttonY = btnRect.top - cRect.top;
                  colorDrag.setDefaultY(buttonY);
                }
                bringPanelToFront("palette");
                onSetActiveMobilePanel("palette");
              }
            }}
            style={{
              width: 40,
              height: 40,
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background:
                showMobileColorPanel || colorDrag.pinned
                  ? "oklch(var(--accent))"
                  : "rgba(0,0,0,0.45)",
              backdropFilter:
                showMobileColorPanel || colorDrag.pinned
                  ? undefined
                  : "blur(6px)",
              borderRadius: leftHanded ? "0 0 8px 0" : "0 0 0 8px",
              border:
                showMobileColorPanel || colorDrag.pinned
                  ? "1px solid oklch(var(--accent))"
                  : "1px solid rgba(255,255,255,0.15)",
              color:
                showMobileColorPanel || colorDrag.pinned
                  ? "oklch(var(--accent-text))"
                  : "rgba(255,255,255,0.85)",
              cursor: "pointer",
            }}
            title="Color Panel"
          >
            <Palette size={18} />
          </button>
        </div>
      )}

      {/* Mobile: floating color panel */}
      {isMobile && colorVisible && (
        <>
          {/* Backdrop — only when NOT pinned */}
          {!colorDrag.pinned &&
            renderBackdrop(() => onSetActiveMobilePanel(null))}
          <div
            ref={colorDrag.panelRef}
            data-ocid="mobile.color_panel"
            style={{
              ...colorDrag.getPanelStyle(),
              zIndex: getPanelZIndex("palette"),
              background: "oklch(var(--sidebar-left))",
              border: "1px solid oklch(var(--border))",
              borderRadius: 10,
              boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
              width: 260,
              maxHeight: "calc(100dvh - 80px)",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              transition: "height 0.15s ease",
              animation: colorDrag.pinned
                ? undefined
                : leftHanded
                  ? "slideInFromLeft 0.18s ease-out"
                  : "slideInFromRight 0.18s ease-out",
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
              bringPanelToFront("palette");
            }}
          >
            {/* Title bar */}
            <div
              style={{
                ...titleBarStyle,
                cursor: colorDrag.pinned ? "grab" : "default",
              }}
              onPointerDown={(e) => {
                bringPanelToFront("palette");
                colorDrag.handleTitleBarPointerDown(e);
              }}
              onPointerMove={(e) => colorDrag.handleTitleBarPointerMove(e)}
              onPointerUp={colorDrag.handleTitleBarPointerUp}
            >
              <span style={titleBarTextStyle}>Color</span>
              <button
                type="button"
                title={colorDrag.pinned ? "Unpin panel" : "Pin panel"}
                style={pinButtonStyle(colorDrag.pinned)}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() =>
                  colorDrag.togglePin(() => onSetActiveMobilePanel(null))
                }
              >
                <MapPin
                  size={14}
                  fill={colorDrag.pinned ? "currentColor" : "none"}
                />
              </button>
            </div>
            {/* Content */}
            <div
              style={{
                overflow: "visible",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <ColorPickerPanel
                color={color}
                onColorChange={onColorChange}
                recentColors={recentColors}
                onRecentColorClick={onRecentColorClick}
                onInteract={() => bringPanelToFront("palette")}
                isMobile={true}
              />
            </div>
          </div>
        </>
      )}

      {/* Mobile: floating presets panel */}
      {isMobile && presetsVisible && (
        <>
          {!presetsDrag.pinned &&
            renderBackdrop(() => onSetActiveMobilePanel(null))}
          <div
            ref={presetsDrag.panelRef}
            data-ocid="mobile.presets_panel"
            style={{
              ...presetsDrag.getPanelStyle(),
              zIndex: getPanelZIndex("presets"),
              background: "oklch(var(--sidebar-left))",
              border: "1px solid oklch(var(--border))",
              borderRadius: 10,
              boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
              width: 280,
              maxHeight: "calc(100dvh - 80px)",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              animation: presetsDrag.pinned
                ? undefined
                : leftHanded
                  ? "slideInFromRight 0.18s ease-out"
                  : "slideInFromLeft 0.18s ease-out",
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
              bringPanelToFront("presets");
            }}
          >
            {/* Title bar */}
            <div
              style={{
                ...titleBarStyle,
                cursor: presetsDrag.pinned ? "grab" : "default",
              }}
              onPointerDown={(e) => {
                bringPanelToFront("presets");
                presetsDrag.handleTitleBarPointerDown(e);
              }}
              onPointerMove={(e) => presetsDrag.handleTitleBarPointerMove(e)}
              onPointerUp={presetsDrag.handleTitleBarPointerUp}
            >
              <span style={titleBarTextStyle}>Tool Presets</span>
              <button
                type="button"
                title={presetsDrag.pinned ? "Unpin panel" : "Pin panel"}
                style={pinButtonStyle(presetsDrag.pinned)}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() =>
                  presetsDrag.togglePin(() => onSetActiveMobilePanel(null))
                }
              >
                <MapPin
                  size={14}
                  fill={presetsDrag.pinned ? "currentColor" : "none"}
                />
              </button>
            </div>
            {/* Content */}
            <div style={{ overflow: "hidden auto", flex: 1 }}>
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
                    onEnterBrushTipEditor={onEnterBrushTipEditor}
                    onInteract={() => bringPanelToFront("presets")}
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
                    wandEdgeExpand={wandEdgeExpand}
                    onWandEdgeExpandChange={onWandEdgeExpandChange}
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
                    fivePtEnableCenter={
                      rulerLayer?.fivePtEnableCenter !== false
                    }
                    onFivePtEnableCenterChange={onFivePtEnableCenterChange}
                    fivePtEnableLR={rulerLayer?.fivePtEnableLR !== false}
                    onFivePtEnableLRChange={onFivePtEnableLRChange}
                    fivePtEnableUD={rulerLayer?.fivePtEnableUD !== false}
                    onFivePtEnableUDChange={onFivePtEnableUDChange}
                    onGridReset={onGridReset}
                  />
                ) : activeSubpanel === "adjustments" &&
                  mobileAdjustmentsPanel ? (
                  mobileAdjustmentsPanel
                ) : (
                  <div className="flex items-center justify-center h-16 text-muted-foreground text-xs select-none opacity-40">
                    No presets for this tool
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Mobile: floating layers panel */}
      {isMobile && layersVisible && (
        <>
          {!layersDrag.pinned &&
            renderBackdrop(() => onSetActiveMobilePanel(null))}
          <div
            ref={layersDrag.panelRef}
            data-ocid="mobile.layers_panel"
            style={{
              ...layersDrag.getPanelStyle(),
              zIndex: getPanelZIndex("layers"),
              background: "oklch(var(--sidebar-right))",
              border: "1px solid oklch(var(--border))",
              borderRadius: 10,
              boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
              width: 280,
              maxHeight: "calc(100dvh - 80px)",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              animation: layersDrag.pinned
                ? undefined
                : leftHanded
                  ? "slideInFromLeft 0.18s ease-out"
                  : "slideInFromRight 0.18s ease-out",
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
              bringPanelToFront("layers");
            }}
          >
            {/* Single authoritative title bar: title + pin */}
            <div
              style={{
                ...titleBarStyle,
                cursor: layersDrag.pinned ? "grab" : "default",
              }}
              onPointerDown={(e) => {
                bringPanelToFront("layers");
                layersDrag.handleTitleBarPointerDown(e);
              }}
              onPointerMove={(e) => layersDrag.handleTitleBarPointerMove(e)}
              onPointerUp={layersDrag.handleTitleBarPointerUp}
            >
              <span style={titleBarTextStyle}>Layers</span>
              <button
                type="button"
                title={layersDrag.pinned ? "Unpin panel" : "Pin panel"}
                style={pinButtonStyle(layersDrag.pinned)}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() =>
                  layersDrag.togglePin(() => onSetActiveMobilePanel(null))
                }
              >
                <MapPin
                  size={14}
                  fill={layersDrag.pinned ? "currentColor" : "none"}
                />
              </button>
            </div>

            {/* Content */}
            <div
              style={{
                overflow: "hidden",
                flex: 1,
                display: "flex",
                flexDirection: "column",
              }}
            >
              <LayersPanel
                layers={layers}
                layerTree={layerTree}
                activeLayerId={activeLayerId}
                selectedLayerIds={selectedLayerIds}
                onSetActive={onSetActive}
                onToggleVisible={onToggleVisible}
                onSetOpacity={onSetOpacity}
                onSetOpacityLive={onSetOpacityLive}
                onSetOpacityCommit={onSetOpacityCommit}
                onSetBlendMode={onSetBlendMode}
                onAddLayer={onAddLayer}
                onDeleteLayer={onDeleteLayer}
                onReorderLayers={onReorderLayers}
                onClearLayer={onClearLayer}
                onToggleClippingMask={onToggleClippingMask}
                onMergeLayers={onMergeLayers}
                onRenameLayer={onRenameLayer}
                onToggleAlphaLock={onToggleAlphaLock}
                onToggleLockLayer={onToggleLockLayer}
                onDuplicateLayer={onDuplicateLayer}
                onCutToNewLayer={onCutToNewLayer}
                onCopyToNewLayer={onCopyToNewLayer}
                hasActiveSelection={hasSelection}
                thumbnails={layerThumbnails}
                onCtrlClickLayer={onCtrlClickLayer}
                onToggleRulerActive={onToggleRulerActive}
                onToggleGroupCollapse={onToggleGroupCollapse}
                onRenameGroup={onRenameGroup}
                onSetGroupOpacity={onSetGroupOpacity}
                onSetGroupOpacityLive={onSetGroupOpacityLive}
                onSetGroupOpacityCommit={onSetGroupOpacityCommit}
                onToggleGroupVisible={onToggleGroupVisible}
                onDeleteGroup={onOpenDeleteGroup}
                onReorderTree={onReorderTree}
                onReorderTreeSilent={onReorderTreeSilent}
                onReorderLayersSilent={onReorderLayersSilent}
                onCommitReorderHistory={onCommitReorderHistory}
                onToggleLayerSelection={onToggleLayerSelection}
                onCreateGroup={onCreateGroup}
                shiftHeld={shiftHeld}
                onInteract={() => bringPanelToFront("layers")}
              />
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
          tabIndex={0}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: "100%",
            height: "100%",
            touchAction: "none",
            cursor: "inherit",
            outline: "none",
          }}
          onDoubleClick={onCanvasDoubleClick}
        />
      </div>
      {/*
        Selection / Transform overlay canvas — lives OUTSIDE the canvas wrapper so
        transform handles can extend beyond the canvas bounds. The drawing code in
        PaintingApp applies the same canvas-space → container-space transform as
        the ruler overlay, so all coordinates still map correctly.
        pointer-events: none so pointer events fall through to the canvas/container.
      */}
      <canvas
        ref={(el) => {
          onSelectionOverlayCanvasRef(el);
          // Size to the full viewport so handles outside the container's
          // overflow:hidden boundary are still visible and interactive.
          if (el) {
            const vw = window.innerWidth;
            const vh = window.innerHeight;
            if (el.width !== vw || el.height !== vh) {
              el.width = vw;
              el.height = vh;
            }
          }
        }}
        style={{
          position: "fixed",
          inset: 0,
          pointerEvents: "none",
          zIndex: 11,
        }}
      />
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
      {/* View HUD — hidden on mobile, always visible on desktop */}
      {!isMobile && (
        <div
          data-ocid="canvas.panel"
          style={{
            position: "absolute",
            bottom: 48,
            // On mobile: shift right to clear the FOS sliders (width ~30px, offset 6px → ~44px clear)
            // Right-handed: sliders on left → offset from left; left-handed: sliders on right → stay at left
            left: isMobile && !leftHanded ? 44 : 12,
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
      )}
    </div>
  );
}
