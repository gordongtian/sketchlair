import { useDocumentContext } from "@/context/DocumentContext";
import type { DocumentState } from "@/types/DocumentTypes";
import type { HSVAColor } from "@/utils/colorUtils";
import {
  generateLayerThumbnail,
  getLuminance,
  hexToRgb,
  hsvToRgb,
  rgbToHex,
  rgbToHsv,
} from "@/utils/colorUtils";
import { exportAsPSD } from "@/utils/exportPsd";
import type { FlatEntry } from "@/utils/groupUtils";
import { resetGroupIdCounterFromFlat } from "@/utils/groupUtils";
import {
  type HotkeyAction,
  loadHotkeys,
  matchesBinding,
} from "@/utils/hotkeyConfig";
import { DEFAULT_PRESETS } from "@/utils/toolPresets";
import {
  Layers,
  Palette,
  SlidersHorizontal as PresetsIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { PaintingContextProvider } from "../context/PaintingContext";
// Grouped ref type declarations (structural only — no logic)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type {} from "../hooks/paintingRefs";
import { use1pt2ptPerspectiveRuler } from "../hooks/use1pt2ptPerspectiveRuler";
import { use3pt5ptPerspectiveRuler } from "../hooks/use3pt5ptPerspectiveRuler";
import { useAdjustmentsSystem } from "../hooks/useAdjustmentsSystem";
import { useAppInitialization } from "../hooks/useAppInitialization";
import {
  _aboveClipTmpCanvas,
  _clipTmpCanvas,
  _tempStrokeCanvas,
  clearCompositeDoneCallback,
  getBitmapOrCanvas,
  invalidateAllLayerBitmaps,
  invalidateCompositeContextCaches,
  markCanvasDirty,
  markLayerBitmapDirty,
  registerCanvasDirtyCallbacks,
  setActiveLayerIdForBitmap,
  setCompositeDoneCallback,
  useCompositing,
} from "../hooks/useCompositing";
import { useCropSystem } from "../hooks/useCropSystem";
import { useCursorSystem } from "../hooks/useCursorSystem";
import { useEllipseGridRuler } from "../hooks/useEllipseGridRuler";
import { useFileIOSystem } from "../hooks/useFileIOSystem";
import { useFillSystem } from "../hooks/useFillSystem";
import { useHistory } from "../hooks/useHistory";
import { useIsMobile } from "../hooks/useIsMobile";
import { useLayerSystem } from "../hooks/useLayerSystem";
import type { UndoEntry } from "../hooks/useLayerSystem";
import { useLineRuler } from "../hooks/useLineRuler";
import { resetLiquifyField, useLiquifySystem } from "../hooks/useLiquifySystem";
import { usePaintingCanvasEvents } from "../hooks/usePaintingCanvasEvents";
import type { PaintingCanvasEventsCallbacks } from "../hooks/usePaintingCanvasEvents";
import { brushPresetToPreset } from "../hooks/usePreferences";
import { usePresetSystem } from "../hooks/usePresetSystem";
import type { BrushSizes, PresetsPayload } from "../hooks/usePresetSystem";
import { useRulerUIHandlers } from "../hooks/useRulerUIHandlers";
import { useSelectionSystem } from "../hooks/useSelectionSystem";
import { useSnapSystem } from "../hooks/useSnapSystem";
import { useStrokeEngine } from "../hooks/useStrokeEngine";
import { useToolSwitchSystem } from "../hooks/useToolSwitchSystem";
import { useTransformSystem } from "../hooks/useTransformSystem";
import type { SelectionGeom, SelectionSnapshot } from "../selectionTypes";
import type { ViewTransform } from "../types";
import { isIPad } from "../utils/constants";
import {
  chaikinSmooth,
  computeMaskBounds,
  growShrinkMask,
} from "../utils/selectionUtils";
import { getThumbCanvas, getThumbCtx } from "../utils/thumbnailCache";
import { createWebGLBrushContext } from "../utils/webglBrush";
import type { WebGLBrushContext } from "../utils/webglBrush";
import { AdjustmentsPresetsPanel } from "./AdjustmentsPresetsPanel";
import {
  BrushConflictDialog,
  CloudOverwriteDialog,
  DeleteGroupDialog,
  MergeStrategyDialog,
} from "./AppDialogs";
import { BottomBar } from "./BottomBar";
import type { BrushSettings } from "./BrushSettingsPanel";
import {
  BrushSettingsPanel,
  DEFAULT_BRUSH_SETTINGS,
} from "./BrushSettingsPanel";
import { CanvasArea } from "./CanvasArea";
import {
  BrushSizeOverlayCanvas,
  RotateCrosshairOverlay,
  SoftwareCursorCanvas,
} from "./CanvasOverlays";
import type { FillMode, FillSettings } from "./FillPresetsPanel";
import type { Layer } from "./LayersPanel";
import { LeftSidebarArea } from "./LeftSidebarArea";
import { MobileCanvasSliders } from "./MobileCanvasSliders";
import { RightSidebarArea } from "./RightSidebarArea";
import type { RulerPresetType } from "./RulerPresetsPanel";
import { SettingsPanel } from "./SettingsPanel";
import type { LassoMode, Tool } from "./Toolbar";
import { ToolbarArea } from "./ToolbarArea";
import { WebGL1WarningBanner } from "./WebGL1WarningBanner";

const CANVAS_WIDTH = isIPad ? 1280 : 2560;
const CANVAS_HEIGHT = isIPad ? 720 : 1440;

type Point = { x: number; y: number };

// IMPORTANT: Layer IDs must be globally unique across ALL open documents.
// Never use sequential integers or position-based keys — two documents with
// identical layer structure would collide in layerCanvasMap and share canvases.
// Always use generateLayerId() so each layer has a unique ID regardless of
// how many documents are open or when they were created.
let _layerNameCounter = 0;
function generateLayerId(): string {
  return `layer_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}
function newLayer(): Layer {
  _layerNameCounter++;
  return {
    id: generateLayerId(),
    name: `Layer ${_layerNameCounter}`,
    visible: true,
    opacity: 1,
    blendMode: "source-over",
    isClippingMask: false,
    alphaLock: false,
  };
}

// Module-level unique IDs for the cold-start useState defaults.
// These are allocated once at module load time and never reused.
const _INIT_LAYER1_ID = generateLayerId();
const _INIT_LAYER2_ID = generateLayerId();

const DEFAULT_TRANSFORM: ViewTransform = {
  panX: 0,
  panY: 0,
  zoom: 1,
  rotation: 0,
};

// Module-level tint canvas, smudge buffers, stamp caches → now in useStrokeEngine.ts

// Compositing temp canvases, ctx caches → now in useCompositing.ts
// _overlayCtxCached lives here since it's used by the marching-ants loop below
let _overlayCtxCached: CanvasRenderingContext2D | null = null;

// Pre-allocated canvases for thumbnail generation — avoids per-stroke canvas allocation
// _cropThumbCanvas and _layerThumbCanvas are now provided by thumbnailCache.ts (getThumbCanvas/getThumbCtx)

const NAV_THUMB_W = 1024;
const NAV_THUMB_H = Math.round(NAV_THUMB_W * (CANVAS_HEIGHT / CANVAS_WIDTH)); // 90px for 2560×1440
const _navThumbCanvas = document.createElement("canvas");
_navThumbCanvas.width = NAV_THUMB_W;
_navThumbCanvas.height = NAV_THUMB_H;
const _navThumbCtx = _navThumbCanvas.getContext("2d", {
  willReadFrequently: !isIPad,
})!;

// Smear buffers, _smearOutputImageData, _smearSoftnessWeights, _smearTipCacheKey → now in useStrokeEngine.ts

// Module-level cached canvas for selection boundary rebuild (avoids 60fps allocation)
const _boundaryRebuildCanvas = document.createElement("canvas");
_boundaryRebuildCanvas.width = _boundaryRebuildCanvas.height = 1;
let _boundaryRebuildCtxCached: CanvasRenderingContext2D | null = null;

// Shared helper: scan a selection mask at 1/4 scale and stitch boundary segments
// into connected chains (polylines). Used by both the static idle-rebuild path and
// the transform path so there is a single implementation with no duplication.
const _buildChainsFromMask = (
  mask: HTMLCanvasElement,
  canvasW: number,
  canvasH: number,
  isIPadHint: boolean,
): Array<Array<[number, number]>> => {
  const SCALE = 4;
  const sw = Math.ceil(canvasW / SCALE);
  const sh = Math.ceil(canvasH / SCALE);
  if (
    _boundaryRebuildCanvas.width !== sw ||
    _boundaryRebuildCanvas.height !== sh
  ) {
    _boundaryRebuildCanvas.width = sw;
    _boundaryRebuildCanvas.height = sh;
    _boundaryRebuildCtxCached = null;
  }
  if (!_boundaryRebuildCtxCached) {
    _boundaryRebuildCtxCached = _boundaryRebuildCanvas.getContext("2d", {
      willReadFrequently: !isIPadHint,
    });
  }
  const tc = _boundaryRebuildCtxCached!;
  tc.clearRect(0, 0, sw, sh);
  tc.drawImage(mask, 0, 0, canvasW, canvasH, 0, 0, sw, sh);
  const data = tc.getImageData(0, 0, sw, sh).data;
  const isSel = (x: number, y: number) => {
    if (x < 0 || x >= sw || y < 0 || y >= sh) return false;
    return data[(y * sw + x) * 4 + 3] > 64;
  };
  type Seg4 = [number, number, number, number];
  const segs: Seg4[] = [];
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      if (isSel(x, y)) {
        if (!isSel(x, y - 1))
          segs.push([x * SCALE, y * SCALE, (x + 1) * SCALE, y * SCALE]);
        if (!isSel(x, y + 1))
          segs.push([
            x * SCALE,
            (y + 1) * SCALE,
            (x + 1) * SCALE,
            (y + 1) * SCALE,
          ]);
        if (!isSel(x - 1, y))
          segs.push([x * SCALE, y * SCALE, x * SCALE, (y + 1) * SCALE]);
        if (!isSel(x + 1, y))
          segs.push([
            (x + 1) * SCALE,
            y * SCALE,
            (x + 1) * SCALE,
            (y + 1) * SCALE,
          ]);
      }
    }
  }
  const ptKey = (x: number, y: number) => `${x},${y}`;
  const adj = new Map<string, Seg4[]>();
  for (const s of segs) {
    const k0 = ptKey(s[0], s[1]);
    const k1 = ptKey(s[2], s[3]);
    if (!adj.has(k0)) adj.set(k0, []);
    if (!adj.has(k1)) adj.set(k1, []);
    adj.get(k0)!.push(s);
    adj.get(k1)!.push([s[2], s[3], s[0], s[1]]);
  }
  const used = new Set<string>();
  const chains: Array<Array<[number, number]>> = [];
  for (const s of segs) {
    const fk = `${s[0]},${s[1]}->${s[2]},${s[3]}`;
    if (used.has(fk)) continue;
    const chain: Array<[number, number]> = [
      [s[0], s[1]],
      [s[2], s[3]],
    ];
    used.add(fk);
    used.add(`${s[2]},${s[3]}->${s[0]},${s[1]}`);
    let cur: [number, number] = [s[2], s[3]];
    for (;;) {
      const nexts = adj.get(ptKey(cur[0], cur[1])) ?? [];
      let ext = false;
      for (const n of nexts) {
        const nk = `${n[0]},${n[1]}->${n[2]},${n[3]}`;
        if (!used.has(nk)) {
          used.add(nk);
          used.add(`${n[2]},${n[3]}->${n[0]},${n[1]}`);
          chain.push([n[2], n[3]]);
          cur = [n[2], n[3]];
          ext = true;
          break;
        }
      }
      if (!ext) break;
    }
    chains.push(chain);
  }
  return chains;
};

// Synchronously rebuild boundary chains from the current selection mask.
// Called at every state transition that produces a new mask-type selection,
// so the drawAnts loop always has correct chain data immediately.
const _rebuildChainsNow = (
  mask: HTMLCanvasElement,
  bdRef: {
    chains: Array<Array<[number, number]>>;
    segments: Array<[number, number, number, number]>;
    dirty: boolean;
  },
  canvasW: number,
  canvasH: number,
  isIPadHint: boolean,
) => {
  const chains = _buildChainsFromMask(mask, canvasW, canvasH, isIPadHint);
  bdRef.chains = chains;
  bdRef.segments = [];
  bdRef.dirty = false;
};

// ---- ImageBitmap cache functions are now in useCompositing.ts ----
// markLayerBitmapDirty, invalidateAllLayerBitmaps, getBitmapOrCanvas imported at top
// ---- Liquify displacement field functions are now in useLiquifySystem.ts ----
// updateLiquifyDisplacementField, renderLiquifyFromSnapshot, initLiquifyField, resetLiquifyField imported at top
// ---- evalPressureCurve, applyColorJitter, PRESSURE_SMOOTHING → now in useStrokeEngine.ts ----

// BrushSizes type is imported from usePresetSystem

// Stamp color parse cache → now in useStrokeEngine.ts

interface PaintingAppProps {
  isLoggedIn?: boolean;
  identity?: { getPrincipal(): { toString(): string; isAnonymous(): boolean } };
  onLogin?: () => void;
  onLogout?: () => void;
  cloudSave?: (getBlob: () => Promise<Blob>) => Promise<void>;
  getCanvasHash?: () => Promise<string | null>;
  /**
   * Called (debounced 500 ms inside usePresetSystem) whenever presets are
   * mutated and the user is logged in. Receives the full JSON string to
   * persist to the backend.
   */
  onPresetsMutated?: (json: string) => void;
  /**
   * Registers the loadPresets function so the caller (App.tsx) can invoke it
   * on login to restore saved presets from the cloud.
   */
  registerLoadPresets?: (
    fn: (payload: import("../hooks/usePresetSystem").PresetsPayload) => void,
  ) => void;
  /** Centralized preferences manager — passed from App so SettingsPanel can sync to canister */
  preferences?: import("../hooks/usePreferences").PreferencesManager;
  /**
   * Called whenever the brush tip editor enters or exits so the parent can
   * lock / unlock the document tab bar.
   */
  onBrushTipEditorActiveChange?: (active: boolean) => void;
}

export function PaintingApp({
  isLoggedIn = false,
  identity,
  onLogin,
  onLogout,
  cloudSave,
  getCanvasHash,
  onPresetsMutated,
  registerLoadPresets,
  preferences,
  onBrushTipEditorActiveChange,
}: PaintingAppProps = {}) {
  // Access DocumentContext to register imperative functions and react to document events
  const {
    registerSwapFn,
    registerDiscardFlushFn,
    registerLoadFileFn,
    registerGetSktchBlobFn,
    updateDocument,
    activeDocumentId,
    activeDocument,
    openFileAsDocument,
  } = useDocumentContext();
  // Stable ref so callbacks never capture stale document state
  const activeDocumentRef = useRef(activeDocument);
  activeDocumentRef.current = activeDocument;
  // UI state
  const [activeTool, setActiveTool] = useState<Tool>("brush");
  const [activeRulerPresetType, setActiveRulerPresetType] =
    useState<RulerPresetType>("perspective-1pt");
  const activeRulerPresetTypeRef = useRef<RulerPresetType>("perspective-1pt");
  const isLoggedInRef = useRef(isLoggedIn);
  const cloudSaveRef = useRef(cloudSave);
  const getCanvasHashRef = useRef(getCanvasHash);
  // Stable refs for DocumentContext callbacks so closures in useFileIOSystem never go stale
  const updateDocumentRef = useRef(updateDocument);
  updateDocumentRef.current = updateDocument;
  const activeDocumentIdRef = useRef(activeDocumentId);
  activeDocumentIdRef.current = activeDocumentId;
  isLoggedInRef.current = isLoggedIn;
  cloudSaveRef.current = cloudSave;
  getCanvasHashRef.current = getCanvasHash;
  const [brushSizes, setBrushSizes] = useState<BrushSizes>(() => ({
    brush: DEFAULT_PRESETS.brush[0]?.defaultSize ?? 24,
    eraser: DEFAULT_PRESETS.eraser[0]?.defaultSize ?? 24,
  }));
  // Liquify tool state — managed by useLiquifySystem
  const {
    liquifySize,
    liquifyStrength,
    liquifyScope,
    setLiquifySize,
    setLiquifyStrength,
    setLiquifyScope,
    liquifySizeRef,
    liquifyStrengthRef,
    liquifyScopeRef,
    liquifyBeforeSnapshotRef,
    liquifyMultiBeforeSnapshotsRef,
    liquifyHoldIntervalRef,
  } = useLiquifySystem();
  const [color, setColor] = useState<HSVAColor>({ h: 0, s: 0, v: 0.05, a: 1 });
  const [layers, setLayers] = useState<Layer[]>([
    {
      id: _INIT_LAYER1_ID,
      name: "Layer 1",
      visible: true,
      opacity: 1,
      blendMode: "source-over",
      isClippingMask: false,
      alphaLock: false,
    },
    {
      id: _INIT_LAYER2_ID,
      name: "Background",
      visible: true,
      opacity: 1,
      blendMode: "source-over",
      isClippingMask: false,
      alphaLock: false,
    },
  ]);
  const [activeLayerId, setActiveLayerId] = useState(_INIT_LAYER1_ID);
  const [recentColors, setRecentColors] = useState<string[]>([]);
  const [undoCount, setUndoCount] = useState(0);
  const [redoCount, setRedoCount] = useState(0);
  const [brushSettings, setBrushSettings] = useState<BrushSettings>(() => {
    const _initPreset = DEFAULT_PRESETS.brush[0];
    const _initSettings = _initPreset?.settings ?? DEFAULT_BRUSH_SETTINGS;
    if (_initPreset?.defaultFlow !== undefined) {
      return { ..._initSettings, flow: _initPreset.defaultFlow };
    }
    return _initSettings;
  });
  const [viewTransform, setViewTransform] =
    useState<ViewTransform>(DEFAULT_TRANSFORM);
  const [zoomLocked, setZoomLocked] = useState(false);
  const [rotateLocked, setRotateLocked] = useState(false);

  const [panLocked, setPanLocked] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const DEFAULT_PRESSURE_CURVE: [number, number, number, number] = [
    0.25, 0.25, 0.75, 0.75,
  ];
  const [universalPressureCurve, setUniversalPressureCurve] = useState<
    [number, number, number, number]
  >(() => {
    try {
      const stored = localStorage.getItem("sk-pressure-curve");
      if (stored) return JSON.parse(stored);
    } catch {}
    return DEFAULT_PRESSURE_CURVE;
  });
  const universalPressureCurveRef = useRef(universalPressureCurve);
  useEffect(() => {
    universalPressureCurveRef.current = universalPressureCurve;
  }, [universalPressureCurve]);

  const [isFlipped, setIsFlipped] = useState(false);
  // Always start at a sensible default. The real dimensions from the splash
  // screen arrive later via props and are applied in a dedicated useEffect.
  // Using window.innerWidth here (before splash resolves) would result in the
  // canvas being locked at viewport size regardless of the preset chosen.
  const [canvasWidth, setCanvasWidth] = useState(CANVAS_WIDTH);
  const [canvasHeight, setCanvasHeight] = useState(CANVAS_HEIGHT);
  // canvasWidthRef, canvasHeightRef → now in uiRefs group (declared below)

  const [webGLFallbackWarning, setWebGLFallbackWarning] = useState(false);
  const [isPsdExporting, setIsPsdExporting] = useState(false);
  const [isPngExporting, setIsPngExporting] = useState(false);
  const [activeSubpanel, setActiveSubpanel] = useState<Tool | null>("brush");
  const [leftSidebarCollapsed, setLeftSidebarCollapsed] = useState(false);
  const [rightSidebarCollapsed, setRightSidebarCollapsed] = useState(() => {
    // Default closed on mobile (touch/coarse pointer), open on desktop
    if (typeof window !== "undefined") {
      return window.matchMedia("(pointer: coarse)").matches;
    }
    return false;
  });

  // ── Brush tip editor state ─────────────────────────────────────────────────
  // When active, the main workspace shows a 256×256 tip-editing canvas.
  // The savedColor is restored on exit; the onAccept callback receives the
  // grayscale data URL and passes it to the brush engine exactly as the old
  // ScratchpadDialog did.
  const [brushTipEditorMode, setBrushTipEditorMode] = useState<{
    active: boolean;
    onAccept: (dataUrl: string) => void;
    savedColor: import("@/utils/colorUtils").HSVAColor;
    grayLevel: number; // 0–255, slider value
    // Snapshot of main doc state (layer canvases, layers, etc.) — stored in refs below
  } | null>(null);
  const brushTipEditorModeRef = useRef(brushTipEditorMode);
  useEffect(() => {
    brushTipEditorModeRef.current = brushTipEditorMode;
  }, [brushTipEditorMode]);
  // Saved canvas state for the main document — set on enter, restored on exit
  const savedMainLayerCanvasesRef = useRef<Map<
    string,
    HTMLCanvasElement
  > | null>(null);
  const savedMainLayersRef = useRef<import("./LayersPanel").Layer[]>([]);
  const savedMainActiveLayerIdRef = useRef<string>("");
  const savedMainViewTransformRef = useRef<import("../types").ViewTransform>({
    panX: 0,
    panY: 0,
    zoom: 1,
    rotation: 0,
  });
  const savedMainCanvasWidthRef = useRef<number>(CANVAS_WIDTH);
  const savedMainCanvasHeightRef = useRef<number>(CANVAS_HEIGHT);
  const savedMainUndoStackRef = useRef<
    import("../hooks/useLayerSystem").UndoEntry[]
  >([]);
  const savedMainRedoStackRef = useRef<
    import("../hooks/useLayerSystem").UndoEntry[]
  >([]);
  // Layer canvases owned by the tip editor — created on enter, discarded on exit
  const tipEditorLayerCanvasesRef = useRef<Map<string, HTMLCanvasElement>>(
    new Map(),
  );
  // Saved right panel state — restored on brush tip editor exit
  const savedRightSidebarCollapsedRef = useRef<boolean>(false);
  const savedRightPanelWidthRef = useRef<number>(220);

  // Notify parent when brush tip editor enters/exits
  useEffect(() => {
    onBrushTipEditorActiveChange?.(brushTipEditorMode?.active ?? false);
  }, [brushTipEditorMode?.active, onBrushTipEditorActiveChange]);

  // Beforeunload guard while brush tip editor is active
  useEffect(() => {
    if (!brushTipEditorMode?.active) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue =
        "You have an unsaved brush tip. Accept or discard before leaving.";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [brushTipEditorMode?.active]);
  // Mobile layout state
  const { isMobile, forceDesktop, leftHanded, setForceDesktop, setLeftHanded } =
    useIsMobile();
  const [showMobileColorPanel, setShowMobileColorPanel] = useState(false);
  const [showMobilePresetsPanel, setShowMobilePresetsPanel] = useState(false);

  // Auto-open mobile presets popup when adjustments subpanel becomes active
  useEffect(() => {
    if (isMobile && activeSubpanel === "adjustments") {
      setShowMobilePresetsPanel(true);
    }
  }, [isMobile, activeSubpanel]);

  // ── Preset system ──────────────────────────────────────────────────────────
  // Call here after brushSizes/setBrushSizes, brushSettings/setBrushSettings,
  // color/setColor, activeTool, and activeSubpanel are all defined.
  const {
    presets,
    activePresetIds,
    brushSettingsSnapshotRef,
    importParsed,
    // setImportParsed — used internally by handleImportBrushes in the hook
    showMergeDialog,
    setShowMergeDialog,
    // conflictQueue — managed internally by the hook; setConflictQueue used in JSX dialog
    setConflictQueue,
    // pendingMerged — managed internally by the hook; setPendingMerged used in JSX dialog
    setPendingMerged,
    currentConflict,
    setCurrentConflict,
    presetsRef,
    // activePresetIdsRef is not needed in PaintingApp — the hook manages it internally
    brushSizesRef,
    brushOpacityRef,
    toolSizesRef,
    toolOpacitiesRef,
    toolFlowsRef,
    setPresets,
    setActivePresetIds,
    handleSelectPreset,
    handleUpdatePreset,
    handleAddPreset,
    handleDeletePreset,
    handleActivatePreset,
    handleReorderPresets,
    handleSaveCurrentToPreset,
    handleExportBrushes,
    handleImportBrushes,
    processImportAppend,
    resolveConflict,
    loadPresets,
    handleCanvasBrushSizeChange,
    handleCanvasBrushOpacityChange,
    handleCanvasBrushFlowChange,
  } = usePresetSystem({
    activeTool,
    activeSubpanel,
    setBrushSizes,
    setBrushSettings,
    setColor,
    setActiveTool: (t) => setActiveTool(t),
    onPresetsMutated,
    isLoggedIn,
    // FIX-WIRE-004: whenever the user creates/edits/deletes a preset, push the
    // full serialized list into usePreferences so brushesRef stays current and
    // syncUpload always reads the live state rather than a stale canister cache.
    onBrushesChanged: (brushes) => {
      preferences?.setBrushesDirectly(brushes);
    },
  });

  // Register loadPresets with the parent so it can restore cloud presets on login.
  // Use a ref to avoid triggering re-runs when loadPresets identity changes.
  const loadPresetsRef = useRef(loadPresets);
  loadPresetsRef.current = loadPresets;
  useEffect(() => {
    registerLoadPresets?.((payload) => loadPresetsRef.current(payload));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registerLoadPresets]);

  // FIX-WIRE-003: Register a download callback so that when syncDownload fetches
  // brushes from the canister, they are pushed back into usePresetSystem and the
  // brush UI reflects the cloud state immediately.
  useEffect(() => {
    if (!preferences?.registerOnDownload) return;
    preferences.registerOnDownload((brushPresets) => {
      // Convert BrushPreset[] (canister format) → Preset[] (UI format) per tool type
      const brush: PresetsPayload["brush"] = [];
      const smudge: PresetsPayload["smudge"] = [];
      const eraser: PresetsPayload["eraser"] = [];
      for (const bp of brushPresets) {
        const preset = brushPresetToPreset(bp);
        if (!preset) continue; // skip malformed entries
        if (bp.id.startsWith("smear-") || bp.id.startsWith("smudge-")) {
          smudge.push(preset);
        } else if (bp.id.startsWith("eraser-")) {
          eraser.push(preset);
        } else {
          brush.push(preset);
        }
      }
      const payload: PresetsPayload = {
        brush: brush.length > 0 ? brush : [],
        smudge: smudge.length > 0 ? smudge : [],
        eraser: eraser.length > 0 ? eraser : [],
        activePresetIds: {
          brush: brush[0]?.id ?? null,
          smudge: smudge[0]?.id ?? null,
          eraser: eraser[0]?.id ?? null,
        },
      };
      console.log("[Preferences] Download callback: pushing brushes into UI", {
        brush: brush.length,
        smudge: smudge.length,
        eraser: eraser.length,
      });
      loadPresetsRef.current(payload);
    });
    // preferences object identity is stable — registerOnDownload stores into a ref
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preferences?.registerOnDownload]);

  // Import dialog state (cloud overwrite — preset import/conflict dialogs are in usePresetSystem)
  const [showCloudOverwriteDialog, setShowCloudOverwriteDialog] =
    useState(false);
  const pendingCloudSaveRef = useRef<(() => void) | null>(null);

  // Selection & transform state
  const [lassoMode, setLassoMode] = useState<LassoMode>("free");

  // Crop tool state — owned by useCropSystem (initialized below, after canvas refs are declared)
  // Fill state and refs are now owned by useFillSystem — initialized after hooks below.
  const [isTransformActive, setIsTransformActive] = useState(false);
  const [_isDraggingFloatState, setIsDraggingFloatState] = useState(false);
  const [brushBlendMode, setBrushBlendMode] = useState("source-over");
  const [rightPanelWidth, setRightPanelWidth] = useState(220);
  const rightPanelWidthRef = useRef(220);
  rightPanelWidthRef.current = rightPanelWidth;
  const rightSidebarCollapsedRef = useRef(false);
  rightSidebarCollapsedRef.current = rightSidebarCollapsed;
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(220);
  const [wandTolerance, setWandTolerance] = useState(13);
  const [wandContiguous, setWandContiguous] = useState(true);
  // wandToleranceRef, wandContiguousRef, wandGrowShrinkRef → now in toolRefs group (declared below)
  const [wandGrowShrink, setWandGrowShrink] = useState(0);
  // brushBlendModeRef → now in brushRefs group (declared below)
  // Eyedropper settings UI state
  const [eyedropperSampleSource, setEyedropperSampleSource] = useState<
    "canvas" | "layer"
  >("canvas");
  const [eyedropperSampleSize, setEyedropperSampleSize] = useState<1 | 3 | 5>(
    1,
  );
  const [layerThumbnails, setLayerThumbnails] = useState<
    Record<string, string>
  >({});
  const [navigatorVersion, setNavigatorVersion] = useState(0);
  const navigatorCanvasRef = useRef<HTMLCanvasElement>(_navThumbCanvas);
  // Delete-group confirmation dialog state
  const [deleteGroupConfirm, setDeleteGroupConfirm] = useState<{
    groupId: string;
    groupName: string;
  } | null>(null);

  // ── Grouped canvas refs ───────────────────────────────────────────────────
  // Each group is a plain const object whose values are individual useRef() calls.
  // Hooks still receive each ref as an individual MutableRefObject — the grouping
  // only changes how they are declared and accessed here in PaintingApp.
  const canvasRefs = {
    displayCanvasRef: useRef<HTMLCanvasElement>(null),
    layerCanvasesRef: useRef<Map<string, HTMLCanvasElement>>(new Map()),
    selectionOverlayCanvasRef: useRef<HTMLCanvasElement | null>(null),
    strokeBufferRef: useRef<HTMLCanvasElement | null>(null),
    webglBrushRef: useRef<WebGLBrushContext | null>(null),
    belowActiveCanvasRef: useRef<HTMLCanvasElement | null>(null),
    aboveActiveCanvasRef: useRef<HTMLCanvasElement | null>(null),
    snapshotCanvasRef: useRef<HTMLCanvasElement | null>(null),
    activePreviewCanvasRef: useRef<HTMLCanvasElement | null>(null),
    rulerCanvasRef: useRef<HTMLCanvasElement | null>(null),
    containerRef: useRef<HTMLDivElement>(null),
    canvasWrapperRef: useRef<HTMLDivElement>(null),
    brushSizeOverlayRef: useRef<HTMLCanvasElement | null>(null),
    defaultTipCanvasRef: useRef<HTMLCanvasElement | null>(null),
  } as const;
  // Destructure for ergonomic local access (no behaviour change)
  const {
    displayCanvasRef,
    layerCanvasesRef,
    selectionOverlayCanvasRef,
    strokeBufferRef,
    webglBrushRef,
    belowActiveCanvasRef,
    aboveActiveCanvasRef,
    snapshotCanvasRef,
    activePreviewCanvasRef,
    rulerCanvasRef,
    containerRef,
    canvasWrapperRef,
    brushSizeOverlayRef,
    defaultTipCanvasRef,
  } = canvasRefs;

  // ── Grouped brush refs ────────────────────────────────────────────────────
  const brushRefs = {
    tipCanvasCacheRef: useRef<Map<string, HTMLCanvasElement>>(new Map()),
    // Precomputed fill style string — updated on color change, avoids hsvToRgb in hot path
    colorFillStyleRef: useRef<string>("rgb(0,0,0)"),
    brushBlendModeRef: useRef("source-over"),
    prevBrushBlendModeRef: useRef("source-over"),
    isBrushSizeAdjustingRef: useRef(false),
    brushSizeAdjustStartXRef: useRef(0),
    brushSizeAdjustOriginRef: useRef(0),
    brushSizeOverlayStartPosRef: useRef<{ x: number; y: number } | null>(null),
  } as const;
  const {
    tipCanvasCacheRef,
    colorFillStyleRef,
    brushBlendModeRef,
    prevBrushBlendModeRef,
    isBrushSizeAdjustingRef,
    brushSizeAdjustStartXRef,
    brushSizeAdjustOriginRef,
    brushSizeOverlayStartPosRef,
  } = brushRefs;

  // ── Grouped drawing refs ──────────────────────────────────────────────────
  const drawingRefs = {
    isDrawingRef: useRef(false),
    // Guards undo/redo during the window between isDrawingRef=false and pushHistory completing
    isCommittingRef: useRef(false),
    lastPosRef: useRef<Point | null>(null),
    distAccumRef: useRef(0),
    dualDistAccumRef: useRef(0),
    // Stabilizer refs, pressure refs, and smear/preview RAF refs are now owned by useStrokeEngine
    strokeCanvasCacheKeyRef: useRef<number>(1),
    strokeCanvasLastBuiltGenRef: useRef<number>(0),
    // needsFullCompositeRef: when true, composite() skips the dirty-rect optimisation
    // and does a full repaint. Set to true after any canvas resize (splash screen, crop)
    // so the first composite after a resize always paints the full canvas correctly.
    needsFullCompositeRef: useRef<boolean>(false),
    compositeRef: useRef<() => void>(() => {}),
    pendingLayerPixelsRef: useRef<Map<string, ImageData>>(new Map()),
    layersBeingExtractedRef: useRef<Set<string>>(new Set()),
  } as const;
  const {
    isDrawingRef,
    isCommittingRef,
    lastPosRef,
    distAccumRef,
    dualDistAccumRef,
    strokeCanvasCacheKeyRef,
    strokeCanvasLastBuiltGenRef,
    needsFullCompositeRef,
    compositeRef,
    pendingLayerPixelsRef,
    layersBeingExtractedRef,
  } = drawingRefs;

  // Stroke opacity locked at stroke start — see Fix 3 in useCompositing.
  // Owned here (PaintingApp) so it can be passed to useCompositing as a ref.
  const strokeActiveLayerOpacityRef = useRef<number | null>(null);

  // strokeActiveRef: true between pointer-down (stroke start) and flushStrokeBuffer commit.
  // While true, layer canvases are strictly read-only — any write attempt will be blocked
  // with a console warning. Cleared by flushStrokeBuffer at the end of every stroke.
  const strokeActiveRef = useRef<boolean>(false);

  // ── Grouped state refs ────────────────────────────────────────────────────
  const stateRefs = {
    activeToolRef: useRef(activeTool),
    activeSubpanelRef: useRef(activeSubpanel),
    colorRef: useRef(color),
    // (pressure window / cap refs moved to useStrokeEngine)
    activeLayerAlphaLockRef: useRef(false),
    activeLayerIdRef: useRef(activeLayerId),
    layersRef: useRef(layers),
    brushSettingsRef: useRef(brushSettings),
    viewTransformRef: useRef(viewTransform),
    zoomLockedRef: useRef(zoomLocked),
    rotateLockedRef: useRef(rotateLocked),
    isFlippedRef: useRef(false),
    panLockedRef: useRef(false),
  } as const;
  const {
    activeToolRef,
    activeSubpanelRef,
    colorRef,
    activeLayerAlphaLockRef,
    activeLayerIdRef,
    layersRef,
    brushSettingsRef,
    viewTransformRef,
    zoomLockedRef,
    rotateLockedRef,
    isFlippedRef,
    panLockedRef,
  } = stateRefs;

  // ── Grouped view-transform input refs ────────────────────────────────────
  const viewTransformInputRefs = {
    spaceDownRef: useRef(false),
    zoomModeRef: useRef(false),
    rKeyDownRef: useRef(false),
    isPanningRef: useRef(false),
    panStartRef: useRef({ x: 0, y: 0 }),
    panOriginRef: useRef({ x: 0, y: 0 }),
    isRotatingRef: useRef(false),
    rotOriginRef: useRef(0),
    rotAngleOriginRef: useRef(0),
    rotCenterRef: useRef({ x: 0, y: 0 }),
    isZoomDraggingRef: useRef(false),
    zoomDragStartXRef: useRef(0),
    zoomDragOriginRef: useRef(1),
    zKeyDownRef: useRef(false),
    zoomDragCursorStartRef: useRef({ x: 0, y: 0 }),
    zoomDragPanOriginRef: useRef({ x: 0, y: 0 }),
    rotDragCursorRef: useRef({ x: 0, y: 0 }),
    rotDragCanvasPointRef: useRef({ x: 0, y: 0 }),
    rotDragPanOriginRef: useRef({ x: 0, y: 0 }),
    altSpaceModeRef: useRef(false),
  } as const;
  const {
    spaceDownRef,
    zoomModeRef,
    rKeyDownRef,
    isPanningRef,
    panStartRef,
    panOriginRef,
    isRotatingRef,
    rotOriginRef,
    rotAngleOriginRef,
    rotCenterRef,
    isZoomDraggingRef,
    zoomDragStartXRef,
    zoomDragOriginRef,
    zKeyDownRef,
    zoomDragCursorStartRef,
    zoomDragPanOriginRef,
    rotDragCursorRef,
    rotDragCanvasPointRef,
    rotDragPanOriginRef,
    altSpaceModeRef,
  } = viewTransformInputRefs;

  // ── Grouped tool refs ─────────────────────────────────────────────────────
  const toolRefs = {
    wandToleranceRef: useRef(13),
    wandContiguousRef: useRef(true),
    wandGrowShrinkRef: useRef(0),
    eyedropperSampleSourceRef: useRef<"canvas" | "layer">("canvas"),
    eyedropperSampleSizeRef: useRef<1 | 3 | 5>(1),
    eyedropperIsPressedRef: useRef(false),
    eyedropperHoverColorRef: useRef<{ r: number; g: number; b: number }>({
      r: 0,
      g: 0,
      b: 0,
    }),
    altEyedropperActiveRef: useRef(false),
    prevToolRef: useRef<Tool>("brush"),
  } as const;
  const {
    wandToleranceRef,
    wandContiguousRef,
    wandGrowShrinkRef,
    eyedropperSampleSourceRef,
    eyedropperSampleSizeRef,
    eyedropperIsPressedRef,
    eyedropperHoverColorRef,
    altEyedropperActiveRef,
    prevToolRef,
  } = toolRefs;

  // ── Grouped UI refs ───────────────────────────────────────────────────────
  const uiRefs = {
    currentPointerTypeRef: useRef<string>("mouse"),
    penDownCountRef: useRef(0),
    pointerScreenPosRef: useRef<{ x: number; y: number }>({ x: 0, y: 0 }),
    lastPaintLayerIdRef: useRef<string>(activeLayerId),
    lastPaintToolRef2: useRef<Tool>("brush"),
    cancelInProgressSelectionRef: useRef<() => void>(() => {}),
    commitInProgressLassoRef: useRef<() => void>(() => {}),
    updateNavigatorCanvasRef: useRef<() => void>(() => {}),
    canvasWidthRef: useRef(CANVAS_WIDTH),
    canvasHeightRef: useRef(CANVAS_HEIGHT),
    _isIPadRef: useRef(
      typeof navigator !== "undefined" &&
        (/iPad/.test(navigator.userAgent) ||
          (/Mac/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)),
    ),
    // biome-ignore lint/correctness/noUnusedVariables: kept for potential future use in hotkey config
    rotateHotkeyBehaviorRef: useRef<"hold" | "switch">("switch"),
    wheelCommitTimerRef: useRef<number | null>(null),
    opacityFirstDigitRef: useRef<number | null>(null),
    opacityTimerRef: useRef<ReturnType<typeof setTimeout> | null>(null),
    // Debounce refs for layer thumbnail updates — avoids React re-render on every stroke commit.
    thumbDebounceRef: useRef<ReturnType<typeof setTimeout> | null>(null),
    thumbDebounceLayerIdRef: useRef<string | null>(null),
    thumbDebounceLcRef: useRef<HTMLCanvasElement | null>(null),
    prewarmRafRef: useRef<number | null>(null),
    hotkeysRef: useRef<Record<string, HotkeyAction>>(loadHotkeys()),
    shiftHeldRef: useRef(false),
    rulerEditHistoryDepthRef: useRef(0),
    applyTransformToDOMRef: useRef<(vt: ViewTransform) => void>(() => {}),
  } as const;
  const {
    currentPointerTypeRef,
    penDownCountRef,
    pointerScreenPosRef,
    lastPaintLayerIdRef,
    lastPaintToolRef2,
    cancelInProgressSelectionRef,
    commitInProgressLassoRef,
    updateNavigatorCanvasRef,
    canvasWidthRef,
    canvasHeightRef,
    _isIPadRef,
    // biome-ignore lint/correctness/noUnusedVariables: kept for potential future use in hotkey config
    rotateHotkeyBehaviorRef,
    wheelCommitTimerRef,
    opacityFirstDigitRef,
    opacityTimerRef,
    thumbDebounceRef,
    thumbDebounceLayerIdRef,
    thumbDebounceLcRef,
    prewarmRafRef,
    hotkeysRef,
    shiftHeldRef,
    rulerEditHistoryDepthRef,
    applyTransformToDOMRef,
  } = uiRefs;

  // Undo/redo stacks (not grouped — used directly as history primitives)
  const undoStackRef = useRef<UndoEntry[]>([]);
  const redoStackRef = useRef<UndoEntry[]>([]);

  // ── getOrCreateLayerCanvas ─────────────────────────────────────────────────
  // Returns a correctly-sized HTMLCanvasElement for the given layerId.
  // - Found and correctly sized → return as-is.
  // - Found but wrong size → resize in place (clears it — a wrongly-sized
  //   canvas would produce corrupt pixel writes anyway) and return.
  // - Not found → create new canvas at live dimensions, register, return.
  //
  // STROKE GUARD: While strokeActiveRef is true (a stroke is in progress),
  // layer canvases are strictly read-only. Any code path that would resize or
  // create a layer canvas mid-stroke is blocked — layer canvases must not be
  // mutated between pointer-down and flushStrokeBuffer commit.
  //
  // Uses canvasWidthRef/canvasHeightRef (live refs, never React state) so the
  // result is always accurate even if called synchronously during a render.
  //
  // Pass this function to useLayerSystem and useCompositing via their props so
  // canvas creation/validation is centralised here — do NOT duplicate the logic.
  // biome-ignore lint/correctness/useExhaustiveDependencies: layerCanvasesRef, canvasWidthRef, canvasHeightRef are stable refs
  const getOrCreateLayerCanvas = useCallback(
    (layerId: string): HTMLCanvasElement => {
      const cw = canvasWidthRef.current;
      const ch = canvasHeightRef.current;
      const existing = layerCanvasesRef.current.get(layerId);
      if (existing) {
        if (existing.width !== cw || existing.height !== ch) {
          // Guard: never resize a layer canvas during an active stroke — doing so would
          // clear it and destroy in-progress pixel data.
          if (strokeActiveRef.current) {
            console.warn(
              "[Stroke Guard] blocked resize of layer canvas during active stroke: layer id",
              layerId,
            );
            return existing;
          }
          existing.width = cw;
          existing.height = ch;
          // After a resize the canvas is cleared — re-fill Background with white
          const resizedLayerMeta = layersRef.current.find(
            (l) => l.id === layerId,
          );
          if (
            resizedLayerMeta &&
            (resizedLayerMeta as { name?: string }).name === "Background"
          ) {
            const fillCtx = existing.getContext("2d");
            if (fillCtx) {
              fillCtx.fillStyle = "#ffffff";
              fillCtx.fillRect(0, 0, cw, ch);
            }
          }
        }
        return existing;
      }
      // Guard: never create a new layer canvas during an active stroke — the stroke
      // pipeline has already captured a snapshot and must not see a new empty canvas.
      if (strokeActiveRef.current) {
        console.warn(
          "[Stroke Guard] blocked creation of layer canvas during active stroke: layer id",
          layerId,
        );
        // Return a dummy empty canvas rather than null to avoid null-dereference crashes.
        // The stroke will paint to this temporary canvas and the result will be discarded
        // at the next non-stroke composite.
        const dummy = document.createElement("canvas");
        dummy.width = cw;
        dummy.height = ch;
        return dummy;
      }
      const canvas = document.createElement("canvas");
      canvas.width = cw;
      canvas.height = ch;
      // If this is a Background layer being created for the first time (e.g. recovered
      // by getOrCreateLayerCanvas after a missing-canvas scenario), fill it with opaque
      // white so it is never transparent. Identify by layer name, not by hardcoded ID.
      const layerMeta = layersRef.current.find((l) => l.id === layerId);
      if (layerMeta && (layerMeta as { name?: string }).name === "Background") {
        const fillCtx = canvas.getContext("2d");
        if (fillCtx) {
          fillCtx.fillStyle = "#ffffff";
          fillCtx.fillRect(0, 0, cw, ch);
        }
      }
      layerCanvasesRef.current.set(layerId, canvas);
      console.debug(
        `[Canvas] Created missing canvas for layer ${layerId} at ${cw}×${ch}`,
      );
      return canvas;
    },
    [],
  );

  // ── Spring-loaded tool switching refs ─────────────────────────────────────
  // Owned by PaintingApp so they can be cleared from the toolbar click handler.
  const springLoadedPreviousToolRef = useRef<Tool | null>(null);
  const springLoadedKeyRef = useRef<string | null>(null);
  const pendingSpringRestoreRef = useRef<boolean>(false);
  // holdTimerRef: the pending 500ms timer before spring-load activates.
  // Non-null means the key is held but the timer hasn't fired yet (tap window).
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // pendingSpringKeyRef: the key that was pressed and is awaiting the hold timer.
  // Set on keydown, cleared on keyup or timer fire.
  const pendingSpringKeyRef = useRef<string | null>(null);
  // pendingSpringToolRef: the target tool waiting to be activated by the hold timer.
  const pendingSpringToolRef = useRef<Tool | null>(null);

  // ─── useStrokeEngine: stroke lifecycle, stampWebGL, smudge, tail RAF ──────
  const {
    tailRafIdRef,
    tailDoCommitRef,
    strokeStartSnapshotRef,
    strokeDirtyRectRef,
    strokeSnapLayerRef,
    strokeSnapshotPendingRef,
    strokeStampsPlacedRef,
    strokeWarmRawDistRef,
    // Pressure tracking refs (moved from PaintingApp)
    smoothedPressureRef,
    prevPrimaryPressureRef,
    lastCompositeOpacityRef,
    flushDisplayCapRef,
    strokeCommitOpacityRef,
    // Stabilizer state refs (moved from PaintingApp)
    stabBrushPosRef,
    smoothBufferRef,
    elasticPosRef,
    elasticVelRef,
    elasticRawPrevRef,
    // Glide-to-finish / smear / preview RAF refs (moved from PaintingApp)
    rawStylusPosRef,
    smearDirtyRef,
    smearRafRef,
    strokePreviewRafRef,
    strokePreviewPendingWorkRef,
    // Stamp functions
    stampDot,
    stampWebGL,
    renderBrushSegmentAlongPoints,
    renderSmearAlongPoints,
    initSmudgeBuffer,
  } = useStrokeEngine({
    webglBrushRef,
    strokeBufferRef,
    defaultTipCanvasRef,
    tipCanvasCacheRef,
    activeLayerIdRef,
    distAccumRef,
    dualDistAccumRef,
    markLayerBitmapDirty,
  });

  // ── Ruler sub-hooks ────────────────────────────────────────────────────────
  // scheduleRulerOverlay and pushHistory are defined later in this component;
  // we forward them via stable callback refs to avoid forward-reference issues.
  const scheduleRulerOverlayRef = useRef<() => void>(() => {});
  const scheduleRulerOverlayForHooks = useCallback(() => {
    scheduleRulerOverlayRef.current();
  }, []);

  const pushHistoryRef = useRef<(entry: UndoEntry) => void>(() => {});
  const pushHistoryForHooks = useCallback((entry: UndoEntry) => {
    pushHistoryRef.current(entry);
  }, []);

  // Refs for useLayerSystem's applyLayerEntry / undoLayerEntry — populated after
  // useLayerSystem is called, below. useHistory is called before useLayerSystem so
  // these refs bridge the ordering gap without changing hook call order.
  const applyLayerEntryRef = useRef<
    (entry: import("../hooks/useLayerSystem").LayerSystemEntry) => void
  >(() => {});
  const undoLayerEntryRef = useRef<
    (entry: import("../hooks/useLayerSystem").LayerSystemEntry) => void
  >(() => {});

  // ── Selection animation + lasso refs (not grouped) ─────────────────────────
  const lassoModeRef = useRef<LassoMode>("free");
  const lassoIsDraggingRef = useRef(false);
  const lassoHasPolyPointsRef = useRef(false);
  const lassoStrokeStartRef = useRef<{ x: number; y: number } | null>(null);
  const lassoLastTapTimeRef = useRef<number>(0);
  const lassoLastTapPosRef = useRef<{ x: number; y: number } | null>(null);
  const lassoFreeLastPtRef = useRef<{ x: number; y: number } | null>(null);
  const marchingAntsOffsetRef = useRef(0);
  const marchingAntsRafRef = useRef<number | null>(null);
  const marchingAntsLastDrawRef = useRef(0);
  const drawAntsRef = useRef<(() => void) | null>(null);
  // Ruler animation ref
  const rulerRafRef = useRef<number | null>(null);
  // Snap refs (owned by PaintingApp, shared with all ruler sub-hooks)
  const strokeSnapOriginRef = useRef<Point | null>(null);
  const strokeSnapDirRef = useRef<{ cos: number; sin: number } | null>(null);
  const gridSnapLineRef = useRef<{
    ax: number;
    ay: number;
    bx: number;
    by: number;
  } | null>(null);
  const strokeHvAxisRef = useRef<"h" | "v" | null>(null);
  const strokeHvPivotRef = useRef<Point | null>(null);

  const rulerSnapRefs = useMemo(
    () => ({
      strokeSnapDirRef: strokeSnapDirRef as React.MutableRefObject<{
        cos: number;
        sin: number;
        throughVP: boolean;
        vpAnchorX?: number;
        vpAnchorY?: number;
      } | null>,
      strokeHvAxisRef,
      strokeHvPivotRef,
      strokeSnapOriginRef,
      gridSnapLineRef,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const lineRuler = useLineRuler({
    canvasWidthRef,
    canvasHeightRef,
    layersRef,
    setLayers,
    pushHistory: pushHistoryForHooks,
    rulerEditHistoryDepthRef,
    scheduleRulerOverlay: scheduleRulerOverlayForHooks,
    activeToolRef,
    snapRefs: rulerSnapRefs,
    isFlippedRef,
  });

  const ruler1pt2pt = use1pt2ptPerspectiveRuler({
    canvasWidthRef,
    canvasHeightRef,
    layersRef,
    setLayers,
    pushHistory: pushHistoryForHooks,
    rulerEditHistoryDepthRef,
    scheduleRulerOverlay: scheduleRulerOverlayForHooks,
    activeToolRef,
    snapRefs: rulerSnapRefs,
  });

  const ruler3pt5pt = use3pt5ptPerspectiveRuler({
    canvasWidthRef,
    canvasHeightRef,
    layersRef,
    setLayers,
    pushHistory: pushHistoryForHooks,
    rulerEditHistoryDepthRef,
    scheduleRulerOverlay: scheduleRulerOverlayForHooks,
    activeToolRef,
    snapRefs: rulerSnapRefs,
    shared2ptDragRefs: ruler1pt2pt,
  });

  const ellipseGridRuler = useEllipseGridRuler({
    canvasWidthRef,
    canvasHeightRef,
    layersRef,
    setLayers,
    pushHistory: pushHistoryForHooks,
    rulerEditHistoryDepthRef,
    scheduleRulerOverlay: scheduleRulerOverlayForHooks,
    activeToolRef,
    snapRefs: rulerSnapRefs,
  });

  // All ruler drag refs are now owned by the four ruler sub-hooks.
  // PaintingApp accesses them exclusively through the hook methods (handleXxxPointerDown,
  // handleXxxPointerMove, handleXxxPointerUp, isXxxDragging).

  const { getSnapPosition } = useSnapSystem({
    lineRuler,
    ruler1pt2pt,
    ruler3pt5pt,
    ellipseGridRuler,
    layersRef,
    shiftHeldRef,
    strokeHvPivotRef,
    strokeHvAxisRef,
  });

  // Sync refs with state
  // biome-ignore lint/correctness/useExhaustiveDependencies: liquifyHoldIntervalRef is a stable ref
  useEffect(() => {
    activeToolRef.current = activeTool;
    // Clear liquify hold interval when switching away from liquify
    if (activeTool !== "liquify" && liquifyHoldIntervalRef.current) {
      clearInterval(liquifyHoldIntervalRef.current);
      liquifyHoldIntervalRef.current = null;
    }
    // Crop tool activation — delegated to useCropSystem
    if (activeTool === "crop" && !isCropActiveRef.current) {
      activateCrop();
    }
    if (activeTool !== "crop" && isCropActiveRef.current) {
      deactivateCrop();
      // Layer switch based on new tool
      const newTool = activeTool;
      if (
        newTool === "brush" ||
        newTool === "eraser" ||
        newTool === "smudge" ||
        newTool === "fill" ||
        newTool === "eyedropper"
      ) {
        const targetId = lastPaintLayerIdRef.current;
        if (targetId) {
          setActiveLayerId(targetId);
          activeLayerIdRef.current = targetId;
        }
      } else if (newTool === "ruler") {
        const rulerLayer = layersRef.current.find((l) => l.isRuler);
        if (rulerLayer) {
          setActiveLayerId(rulerLayer.id);
          activeLayerIdRef.current = rulerLayer.id;
        }
      }
    }
    // If the user switches to any non-ruler tool while the active layer is a ruler layer,
    // automatically redirect them to the last paint layer.
    if (activeTool !== "ruler" && activeTool !== "crop") {
      const currentLayer = layersRef.current.find(
        (l) => l.id === activeLayerIdRef.current,
      );
      if (currentLayer?.isRuler) {
        const fallbackId = lastPaintLayerIdRef.current;
        const fallbackLayer = layersRef.current.find(
          (l) => l.id === fallbackId && !l.isRuler,
        );
        const targetId = fallbackLayer
          ? fallbackId
          : layersRef.current.find((l) => !l.isRuler)?.id;
        if (targetId) {
          setActiveLayerId(targetId);
          activeLayerIdRef.current = targetId;
        }
      }
    }
  }, [activeTool]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: activeSubpanelRef is a stable ref
  useEffect(() => {
    activeSubpanelRef.current = activeSubpanel;
  }, [activeSubpanel]);
  // presetsRef and activePresetIdsRef are now kept in sync by usePresetSystem.
  // brushSizesRef (from usePresetSystem) is kept in sync below.
  // biome-ignore lint/correctness/useExhaustiveDependencies: brushSizesRef is a stable ref from usePresetSystem
  useEffect(() => {
    brushSizesRef.current = brushSizes;
  }, [brushSizes]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: colorRef is a stable ref
  useEffect(() => {
    colorRef.current = color;
  }, [color]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: brushOpacityRef is a stable ref from usePresetSystem
  useEffect(() => {
    brushOpacityRef.current = color.a;
  }, [color.a]);
  // Keep brushSettingsSnapshotRef current so handleAddPreset reads latest settings
  useEffect(() => {
    brushSettingsSnapshotRef.current = brushSettings;
  }, [brushSettings, brushSettingsSnapshotRef]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: colorFillStyleRef is a stable ref
  useEffect(() => {
    const col = color;
    const [r, g, b] = hsvToRgb(col.h, col.s, col.v);
    colorFillStyleRef.current = `rgb(${r},${g},${b})`;
  }, [color]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: refs are stable
  useEffect(() => {
    activeLayerIdRef.current = activeLayerId;
    const al = layersRef.current.find((l) => l.id === activeLayerId);
    activeLayerAlphaLockRef.current = al?.alphaLock ?? false;
    // Invalidate below/above stroke canvas cache when active layer changes
    strokeCanvasCacheKeyRef.current++;
    // Keep module-level active layer ID in sync so getBitmapOrCanvas can bypass cache for it
    setActiveLayerIdForBitmap(activeLayerId);
  }, [activeLayerId]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: refs are stable
  useEffect(() => {
    layersRef.current = layers;
    console.log(
      "[Reorder] layersRef updated, ids:",
      layers.map((l) => l.id),
    );
    const al = layers.find((l) => l.id === activeLayerIdRef.current);
    activeLayerAlphaLockRef.current = al?.alphaLock ?? false;
    // Invalidate below/above stroke canvas cache whenever layer stack changes
    strokeCanvasCacheKeyRef.current++;
  }, [layers]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: brushSettingsRef is a stable ref
  useEffect(() => {
    brushSettingsRef.current = brushSettings;
  }, [brushSettings]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: viewTransformRef is a stable ref
  useEffect(() => {
    viewTransformRef.current = viewTransform;
  }, [viewTransform]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: brushBlendModeRef is a stable ref
  useEffect(() => {
    brushBlendModeRef.current = brushBlendMode;
  }, [brushBlendMode]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: isFlippedRef is a stable ref
  useEffect(() => {
    isFlippedRef.current = isFlipped;
  }, [isFlipped]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: lassoModeRef is a stable ref
  useEffect(() => {
    lassoModeRef.current = lassoMode;
  }, [lassoMode]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: wandToleranceRef is a stable ref
  useEffect(() => {
    wandToleranceRef.current = wandTolerance;
  }, [wandTolerance]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: wandContiguousRef is a stable ref
  useEffect(() => {
    wandContiguousRef.current = wandContiguous;
  }, [wandContiguous]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: wandGrowShrinkRef is a stable ref
  useEffect(() => {
    wandGrowShrinkRef.current = wandGrowShrink;
  }, [wandGrowShrink]);
  // fillMode/fillSettings sync effects are now inside useFillSystem
  // compositeRef is now in drawingRefs group (declared above); it allows the
  // selection hook to call composite() without a circular dep.

  // biome-ignore lint/correctness/useExhaustiveDependencies: brushSizesRef is a stable ref from usePresetSystem
  const getActiveSize = useCallback(() => {
    const tool = activeToolRef.current;
    return tool === "eraser"
      ? brushSizesRef.current.eraser
      : brushSizesRef.current.brush;
  }, []);

  // Stable pushHistory for useSelectionSystem — defined before the hook call to avoid forward-reference errors.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refs are stable
  const pushHistoryForSelection = useCallback(
    (entry: unknown) => {
      (undoStackRef.current as UndoEntry[]).push(entry as UndoEntry);
      if (undoStackRef.current.length > 50) undoStackRef.current.shift();
      redoStackRef.current = [];
      setUndoCount(undoStackRef.current.length);
      setRedoCount(0);
      setHasUnsavedChanges(true);
      isDirtyRef.current = true;
    },
    [undoStackRef, redoStackRef, setUndoCount, setRedoCount],
  );

  // rebuildChainsNowRef: synchronously rebuilds boundary chains from the given mask.
  // Declared here (before useSelectionSystem) so it can be passed into both hooks.
  // The actual implementation is wired in a useEffect below (needs selectionBoundaryPathRef).
  const rebuildChainsNowRef = useRef<(mask: HTMLCanvasElement) => void>(
    () => {},
  );
  // Stable ref for updateNavigatorCanvas — now in uiRefs group (declared above).
  // The .current is synced to the real callback after it is defined.

  // ---- Layer tree stable refs (declared early, before useSelectionSystem and useTransformSystem) ----
  // These are populated/synced once useLayerSystem returns below.
  // layerTreeRef: still referenced by useTransformSystem and useCursorSystem as an optional param.
  // It is kept as a stub (always empty array) — the flat layers array is now the source of truth.
  const layerTreeRef = useRef<import("../types").LayerNode[]>([]);
  const selectedLayerIdsRef = useRef<Set<string>>(new Set());
  // setLayerTreeRef: kept as a no-op stub for hooks that accept it as an optional param
  // (useSelectionSystem, useHistory, useFileIOSystem). Declared before useSelectionSystem.
  const setLayerTreeRef = useRef<
    React.Dispatch<React.SetStateAction<import("../types").LayerNode[]>>
  >(() => {});

  // ---- Selection system hook ----
  const {
    selectionActive,
    setSelectionActive,
    selectionActiveRef,
    selectionGeometryRef,
    selectionShapesRef,
    selectionBoundaryPathRef,
    selectionMaskRef,
    isDrawingSelectionRef,
    selectionPolyClosingRef,
    selectionDraftPointsRef,
    selectionDraftCursorRef,
    selectionDraftBoundsRef,
    selectionBeforeRef,
    selectionActionsRef,
    snapshotSelection,
    restoreSelectionSnapshot,
    rasterizeSelectionMask,
    clearSelection,
    handleCtrlClickLayer,
    cancelBoundaryRebuildRef,
  } = useSelectionSystem({
    canvasWidth: canvasWidth,
    canvasHeight: canvasHeight,
    canvasWidthRef,
    canvasHeightRef,
    layersRef,
    newLayerFn: newLayer,
    pushHistory: pushHistoryForSelection,
    layerCanvasesRef,
    activeLayerIdRef,
    pendingLayerPixelsRef,
    setLayers,
    setActiveLayerId,
    setActiveTool,
    selectionOverlayCanvasRef,
    compositeRef,
    markLayerBitmapDirty,
    rebuildChainsNowRef,
    setLayerTreeRef,
  });

  // Wire cancelBoundaryRebuildRef — called by clearSelection() to clear stale chains.
  // biome-ignore lint/correctness/useExhaustiveDependencies: selectionBoundaryPathRef is a stable ref
  useEffect(() => {
    cancelBoundaryRebuildRef.current = () => {
      const bdRef = selectionBoundaryPathRef.current;
      bdRef.chains = [];
      bdRef.segments = [];
      bdRef.dirty = true;
    };
  }, [selectionBoundaryPathRef]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refs are stable
  useEffect(() => {
    rebuildChainsNowRef.current = (mask: HTMLCanvasElement) => {
      _rebuildChainsNow(
        mask,
        selectionBoundaryPathRef.current,
        canvasWidthRef.current,
        canvasHeightRef.current,
        isIPad,
      );
    };
  }, [selectionBoundaryPathRef]);

  // ---- Layer tree stable refs (declared early for useTransformSystem and useSelectionSystem) ----
  // (moved before useSelectionSystem — see declaration above)

  // BUG_3b: Stable ref to markLayerBitmapDirty so useTransformSystem can call it
  const markLayerBitmapDirtyRef =
    useRef<(id: string) => void>(markLayerBitmapDirty);
  // BUG_3b: layersBeingExtractedRef is now in drawingRefs group (declared above).

  // ---- Transform system hook ----
  const {
    moveFloatCanvasRef,
    moveFloatOriginBoundsRef,
    isDraggingFloatRef,
    floatDragStartRef,
    xfStateRef,
    transformPreSnapshotRef,
    transformPreCommitSnapshotRef,
    transformOrigFloatCanvasRef,
    transformActiveRef,
    transformHandleRef,
    lastToolBeforeTransformRef,
    multiFloatCanvasesRef,
    multiLayerResolvedIdsRef,
    transformActionsRef,
  } = useTransformSystem({
    canvasWidth: canvasWidth,
    canvasHeight: canvasHeight,
    canvasWidthRef,
    canvasHeightRef,
    setActiveTool,
    setActiveSubpanel,
    setSelectionActive,
    setIsTransformActive,
    setIsDraggingFloatState,
    setUndoCount,
    setRedoCount,
    layerCanvasesRef,
    activeLayerIdRef,
    layersRef,
    viewTransformRef,
    selectedLayerIdsRef,
    undoStackRef,
    redoStackRef,
    selectionActiveRef,
    selectionMaskRef,
    selectionGeometryRef,
    selectionShapesRef,
    selectionBoundaryPathRef,
    compositeRef,
    rebuildChainsNowRef,
    markLayerBitmapDirtyRef,
    layersBeingExtractedRef,
    strokeCanvasCacheKeyRef,
  });

  // ─── useCompositing: composite, compositeWithStrokePreview, buildStrokeCanvases, etc. ──
  const {
    composite,
    compositeWithStrokePreview,
    buildStrokeCanvases,
    flushStrokeBuffer,
    scheduleComposite: _rawScheduleComposite,
    _strokeCommitDirty,
  } = useCompositing({
    displayCanvasRef,
    belowActiveCanvasRef,
    aboveActiveCanvasRef,
    snapshotCanvasRef,
    activePreviewCanvasRef,
    strokeBufferRef,
    layerCanvasesRef,
    layersRef,
    activeLayerIdRef,
    activeLayerAlphaLockRef,
    brushBlendModeRef,
    tailRafIdRef,
    needsFullCompositeRef,
    strokeActiveRef,
    strokeDirtyRectRef,
    strokeStartSnapshotRef,
    strokeCanvasCacheKeyRef,
    strokeCanvasLastBuiltGenRef,
    strokeActiveLayerOpacityRef,
    selectionActiveRef,
    selectionMaskRef,
    layersBeingExtractedRef,
    isDraggingFloatRef,
    transformActiveRef,
    multiFloatCanvasesRef,
    multiLayerResolvedIdsRef,
    moveFloatCanvasRef,
    moveFloatOriginBoundsRef,
    xfStateRef,
    transformOrigFloatCanvasRef,
    webglBrushRef,
    getActiveSize,
    getOrCreateLayerCanvas,
  });

  // scheduleComposite — thin wrapper around _rawScheduleComposite.
  // Option B: no swap guard needed since canvases are owned per-document and
  // the display canvas is never cleared mid-swap.
  // biome-ignore lint/correctness/useExhaustiveDependencies: _rawScheduleComposite is a stable fn
  const scheduleComposite = useCallback(() => {
    _rawScheduleComposite();
  }, [_rawScheduleComposite]);

  // ---- History hook ----
  // Stable ref pointing to the current revertTransform function (wired up after useTransformSystem)
  const revertTransformRef = useRef<() => void>(() => {});
  // Stable ref so useHistory's useEffect dependency doesn't re-trigger every render
  // biome-ignore lint/correctness/useExhaustiveDependencies: displayCanvasRef is a stable ref
  const updateNavigatorCanvas = useCallback(() => {
    const display = displayCanvasRef.current;
    if (display) {
      const navH = _navThumbCanvas.height;
      _navThumbCtx.clearRect(0, 0, NAV_THUMB_W, navH);
      _navThumbCtx.drawImage(display, 0, 0, NAV_THUMB_W, navH);
    }
    setNavigatorVersion((v) => v + 1);
  }, []);
  // Keep the early ref in sync with the memoized callback
  // biome-ignore lint/correctness/useExhaustiveDependencies: updateNavigatorCanvasRef is a stable ref
  useEffect(() => {
    updateNavigatorCanvasRef.current = updateNavigatorCanvas;
  }, [updateNavigatorCanvas]);

  // ── Canvas-dirty signal ───────────────────────────────────────────────────
  // Register updateNavigatorCanvas as the composite-done callback so it fires
  // automatically after every composite() call. This eliminates the need for
  // scattered explicit updateNavigatorCanvas() calls after each operation.
  useEffect(() => {
    setCompositeDoneCallback(updateNavigatorCanvas);
    return () => clearCompositeDoneCallback();
  }, [updateNavigatorCanvas]);

  // Register the centralised markCanvasDirty callbacks so hooks across the codebase
  // can call markCanvasDirty(layerId) instead of scattering setLayerThumbnails /
  // setNavigatorVersion calls everywhere.
  // biome-ignore lint/correctness/useExhaustiveDependencies: setLayerThumbnails and setNavigatorVersion are stable React dispatch fns
  useEffect(() => {
    registerCanvasDirtyCallbacks({
      setLayerThumbnails,
      setNavigatorVersion,
      getLayerThumbnail: (layerId: string) => {
        const lc = layerCanvasesRef.current.get(layerId);
        if (!lc) return "";
        return generateLayerThumbnail(lc, getThumbCanvas(), getThumbCtx());
      },
      // Provide a live flat-array reference so markCanvasDirty can skip thumbnail
      // regeneration for layers inside collapsed groups (performance B5).
      getLayers: () => layersRef.current as unknown as FlatEntry[],
    });
  }, [setLayerThumbnails, setNavigatorVersion]);
  const {
    handleUndo,
    handleRedo,
    pushHistory: _rawPushHistory,
  } = useHistory({
    setUndoCount,
    setRedoCount,
    canvasWidth: canvasWidth,
    canvasHeight: canvasHeight,
    layers,
    setLayers,
    setLayerTreeRef,
    setActiveLayerId,
    updateNavigatorCanvas,
    composite,
    restoreSelectionSnapshot,
    moveFloatCanvasRef,
    xfStateRef,
    isDraggingFloatRef,
    transformActiveRef,
    transformPreSnapshotRef,
    transformPreCommitSnapshotRef,
    transformOrigFloatCanvasRef,
    setIsTransformActive,
    setIsDraggingFloatState,
    revertTransformRef,
    setCanvasWidth,
    setCanvasHeight,
    displayCanvasRef,
    rulerCanvasRef,
    webglBrushRef,
    belowActiveCanvasRef,
    aboveActiveCanvasRef,
    snapshotCanvasRef,
    activePreviewCanvasRef,
    undoStackRef,
    redoStackRef,
    pendingLayerPixelsRef,
    layerCanvasesRef,
    selectionActiveRef,
    selectionMaskRef,
    canvasWidthRef,
    canvasHeightRef,
    markLayerBitmapDirty,
    invalidateAllLayerBitmaps,
    applyLayerEntryRef,
    undoLayerEntryRef,
  });

  // Wire revertTransformRef to the current revertTransform from useTransformSystem
  useEffect(() => {
    revertTransformRef.current = transformActionsRef.current.revertTransform;
  }, [transformActionsRef]);

  // ─── File I/O system ────────────────────────────────────────────────────────
  const {
    hasUnsavedChanges,
    setHasUnsavedChanges,
    isDirtyRef,
    fileLoadInputRef,
    handleSaveFile,
    handleSilentSave,
  } = useFileIOSystem({
    layersRef,
    layerCanvasesRef,
    activeLayerIdRef,
    canvasWidthRef,
    canvasHeightRef,
    undoStackRef,
    redoStackRef,
    pendingLayerPixelsRef,
    transformActiveRef,
    selectionActionsRef,
    displayCanvasRef,
    rulerCanvasRef,
    webglBrushRef,
    belowActiveCanvasRef,
    aboveActiveCanvasRef,
    snapshotCanvasRef,
    activePreviewCanvasRef,
    layerTreeRef,
    setLayerTreeRef,
    setCanvasWidth,
    setCanvasHeight,
    setLayers,
    setActiveLayerId,
    setUndoCount,
    setRedoCount,
    clearSelection,
    registerGetSktchBlob: registerGetSktchBlobFn,
    registerLoadFile: registerLoadFileFn,
    onDocumentSaved: (filename: string) => {
      // Update the active document's tab name in DocumentManager after a successful save
      const docId = activeDocumentIdRef.current;
      if (docId) {
        updateDocumentRef.current(docId, { filename, isDirty: false });
      }
    },
  });

  // ── Multi-document swap ref ────────────────────────────────────────────────
  // Stable ref holding the three-phase swap function.
  // The wrapper calls swapDocumentRef.current(fromDoc, toDoc) on tab switch.
  // The actual implementation is assigned on every render (no deps array) so
  // it always closes over the latest state and refs.
  const swapDocumentRef = useRef<
    (fromDoc: DocumentState, toDoc: DocumentState) => void
  >(() => {});

  // Register the stable wrapper with DocumentContext so DocumentManager can call it on tab switch
  // biome-ignore lint/correctness/useExhaustiveDependencies: registerSwapFn is stable
  useEffect(() => {
    registerSwapFn((fromDoc, toDoc) => swapDocumentRef.current(fromDoc, toDoc));
  }, [registerSwapFn]);

  // Register the discard flush callback with DocumentContext.
  // DocumentManager calls this synchronously before removing a document from its array,
  // ensuring all pixel data is cleared before any new document initializes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: registerDiscardFlushFn is stable
  useEffect(() => {
    registerDiscardFlushFn((doc: DocumentState, isActiveDoc: boolean): void => {
      console.warn(
        `[Doc Flush] Flushing discarded document "${doc.filename}" (id=${doc.id}, isActive=${isActiveDoc})`,
      );

      // 1. Clear and release all layer canvases owned by the discarded document.
      //    This prevents their pixel data from being reused by a new document.
      for (const [layerId, canvas] of doc.layerCanvases) {
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
        } else {
          console.warn(
            `[Doc Flush] Could not get 2d context for layer canvas ${layerId} — canvas may already be detached`,
          );
        }
        doc.layerCanvases.delete(layerId);
      }

      // 2. Null out pixelData on all paint layers so ImageData cannot be reused.
      //    LayerPixelSnapshot.pixelData is the field; plain layers may not have it,
      //    so we guard with a property check.
      for (const layer of doc.layers) {
        if (
          layer &&
          typeof layer === "object" &&
          "pixelData" in layer &&
          layer.pixelData !== null
        ) {
          (layer as { pixelData: ImageData | null }).pixelData = null;
        }
      }

      // 3. Clear the display canvas — only needed when discarding the currently
      //    active document (the display canvas is shared; inactive docs don't own it).
      if (isActiveDoc && displayCanvasRef.current) {
        const displayCtx = displayCanvasRef.current.getContext("2d");
        if (displayCtx) {
          displayCtx.clearRect(
            0,
            0,
            displayCanvasRef.current.width,
            displayCanvasRef.current.height,
          );
        }
      }

      // 4. Clear WebGL FBOs (strokeFBO, pressureMaskFBO, flowFBO) if the discarded
      //    document was active. These transient buffers could hold stale stamp data
      //    from an incomplete stroke on the discarded document.
      //    The existing clear() method on WebGLBrushContext clears all three FBOs.
      if (isActiveDoc && webglBrushRef.current) {
        webglBrushRef.current.clear();
      }

      console.warn(
        `[Doc Flush] Flush complete for "${doc.filename}" — layerCanvases cleared (map size now ${doc.layerCanvases.size})`,
      );
    });
  }, [registerDiscardFlushFn]);

  // App-level initialization: themes, beforeunload guard, preset loading, hotkey reload
  useAppInitialization({
    isDirtyRef,
    hotkeysRef,
    onPresetsLoaded: (loaded, loadedBrushSettings) => {
      setPresets(loaded);
      setBrushSettings(loadedBrushSettings);
    },
  });

  // Wrapped pushHistory that marks unsaved changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: isDirtyRef and setHasUnsavedChanges are stable refs/setters
  const pushHistory = useCallback(
    (entry: Parameters<typeof _rawPushHistory>[0]) => {
      _rawPushHistory(entry);
      setHasUnsavedChanges(true);
      isDirtyRef.current = true;
    },
    [_rawPushHistory],
  );
  // Wire the stable ref so ruler sub-hooks (instantiated earlier) get the
  // real pushHistory with unsaved-changes tracking.
  pushHistoryRef.current = pushHistory;

  // ─── Brush Tip Editor — enter / exit ─────────────────────────────────────
  // biome-ignore lint/correctness/useExhaustiveDependencies: refs are stable
  const enterBrushTipEditor = useCallback(
    (onAccept: (dataUrl: string) => void) => {
      const TIP_SIZE = 256;

      // ── Save current main-document state into stable refs ──────────────
      savedMainLayerCanvasesRef.current = layerCanvasesRef.current;
      savedMainLayersRef.current = [...layersRef.current];
      savedMainActiveLayerIdRef.current = activeLayerIdRef.current;
      savedMainViewTransformRef.current = { ...viewTransformRef.current };
      savedMainCanvasWidthRef.current = canvasWidthRef.current;
      savedMainCanvasHeightRef.current = canvasHeightRef.current;
      savedMainUndoStackRef.current = [...undoStackRef.current];
      savedMainRedoStackRef.current = [...redoStackRef.current];
      // Save right panel state so it can be fully restored on exit
      savedRightSidebarCollapsedRef.current = rightSidebarCollapsedRef.current;
      savedRightPanelWidthRef.current = rightPanelWidthRef.current;

      // ── Create the 256×256 tip editor layers and canvases ──────────────
      const bgId = generateLayerId();
      const paintId = generateLayerId();

      const bgCanvas = document.createElement("canvas");
      bgCanvas.width = TIP_SIZE;
      bgCanvas.height = TIP_SIZE;
      const bgCtx = bgCanvas.getContext("2d")!;
      bgCtx.fillStyle = "#ffffff";
      bgCtx.fillRect(0, 0, TIP_SIZE, TIP_SIZE);

      const paintCanvas = document.createElement("canvas");
      paintCanvas.width = TIP_SIZE;
      paintCanvas.height = TIP_SIZE;

      const tipLayerCanvases = new Map<string, HTMLCanvasElement>();
      tipLayerCanvases.set(bgId, bgCanvas);
      tipLayerCanvases.set(paintId, paintCanvas);
      tipEditorLayerCanvasesRef.current = tipLayerCanvases;

      const bgLayer: Layer = {
        id: bgId,
        name: "Background",
        type: "paint",
        visible: true,
        opacity: 1,
        blendMode: "source-over",
        isClippingMask: false,
        alphaLock: false,
      };
      const paintLayer: Layer = {
        id: paintId,
        name: "Tip Layer",
        type: "paint",
        visible: true,
        opacity: 1,
        blendMode: "source-over",
        isClippingMask: false,
        alphaLock: false,
      };
      // paintLayer at index 0 (top), bgLayer at index 1 (bottom)
      const tipLayers: Layer[] = [paintLayer, bgLayer];

      // ── Compute zoom to fit 256×256 comfortably in the viewport ────────
      const container = containerRef.current;
      const fitZoom = container
        ? Math.min(
            (container.clientWidth * 0.7) / TIP_SIZE,
            (container.clientHeight * 0.7) / TIP_SIZE,
          )
        : 1;
      const tipViewTransform: import("../types").ViewTransform = {
        panX: 0,
        panY: 0,
        zoom: Math.max(0.1, Math.min(fitZoom, 10)),
        rotation: 0,
      };

      // ── Swap workspace to tip editor canvas ────────────────────────────
      invalidateAllLayerBitmaps();
      layerCanvasesRef.current = tipLayerCanvases;
      canvasWidthRef.current = TIP_SIZE;
      canvasHeightRef.current = TIP_SIZE;
      layersRef.current = tipLayers;
      activeLayerIdRef.current = paintId;
      setActiveLayerIdForBitmap(paintId);
      undoStackRef.current = [];
      redoStackRef.current = [];
      strokeCanvasCacheKeyRef.current++;
      needsFullCompositeRef.current = true;
      invalidateCompositeContextCaches();
      _overlayCtxCached = null;

      // Resize display and auxiliary canvases
      if (displayCanvasRef.current) {
        displayCanvasRef.current.width = TIP_SIZE;
        displayCanvasRef.current.height = TIP_SIZE;
      }
      if (rulerCanvasRef.current) {
        rulerCanvasRef.current.width = TIP_SIZE;
        rulerCanvasRef.current.height = TIP_SIZE;
      }
      if (webglBrushRef.current)
        webglBrushRef.current.resize(TIP_SIZE, TIP_SIZE);
      for (const offscreen of [
        belowActiveCanvasRef,
        aboveActiveCanvasRef,
        snapshotCanvasRef,
        activePreviewCanvasRef,
      ]) {
        if (offscreen.current) {
          offscreen.current.width = TIP_SIZE;
          offscreen.current.height = TIP_SIZE;
        }
      }

      viewTransformRef.current = tipViewTransform;
      applyTransformToDOMRef.current(tipViewTransform);

      // React state sync
      const savedColor = colorRef.current ?? { h: 0, s: 0, v: 0.05, a: 1 };
      // Set foreground to black for tip editing
      const blackColor: import("@/utils/colorUtils").HSVAColor = {
        h: 0,
        s: 0,
        v: 0,
        a: 1,
      };

      setBrushTipEditorMode({
        active: true,
        onAccept,
        savedColor,
        grayLevel: 0,
      });

      requestAnimationFrame(() => {
        setLayers([...tipLayers]);
        setActiveLayerId(paintId);
        setCanvasWidth(TIP_SIZE);
        setCanvasHeight(TIP_SIZE);
        setViewTransform(tipViewTransform);
        setUndoCount(0);
        setRedoCount(0);
        setColor(blackColor);
        layersRef.current = [...tipLayers];
        composite();
        updateNavigatorCanvas();
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: refs are stable
  const exitBrushTipEditor = useCallback(
    (accept: boolean) => {
      const editorState = brushTipEditorModeRef.current;
      if (!editorState) return;

      if (accept) {
        // ── Extract tip data from the display canvas (what the user sees) ──
        // The display canvas is always the ground truth — the WebGL brush engine
        // renders to it directly. Reading from it before any teardown guarantees
        // we capture exactly the painted content, not a potentially stale layer canvas.
        const displayCanvas = displayCanvasRef.current;
        if (!displayCanvas) {
          setBrushTipEditorMode(null);
          return;
        }
        const TIP_SIZE = 256;

        console.log(
          "[BrushTipEditor] accepting — canvas:",
          displayCanvas.width,
          "x",
          displayCanvas.height,
        );

        // Copy the WebGL display canvas into a 2D canvas so we can call getImageData.
        // drawImage on a WebGL canvas into a 2D context composites the WebGL result correctly.
        const flatCanvas = document.createElement("canvas");
        flatCanvas.width = TIP_SIZE;
        flatCanvas.height = TIP_SIZE;
        const flatCtx = flatCanvas.getContext("2d")!;
        flatCtx.drawImage(displayCanvas, 0, 0);

        const imageData = flatCtx.getImageData(0, 0, TIP_SIZE, TIP_SIZE);
        console.log(
          "[BrushTipEditor] imageData non-zero pixels:",
          imageData.data.filter((v: number, i: number) => i % 4 === 3 && v > 0)
            .length,
        );

        // Grayscale conversion with luminance weights
        const { data } = imageData;
        for (let i = 0; i < data.length; i += 4) {
          const gray = Math.round(
            0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2],
          );
          data[i] = gray;
          data[i + 1] = gray;
          data[i + 2] = gray;
        }

        // Write grayscale data to a temp canvas and produce the data URL
        const tempCanvas = document.createElement("canvas");
        tempCanvas.width = TIP_SIZE;
        tempCanvas.height = TIP_SIZE;
        const tempCtx = tempCanvas.getContext("2d")!;
        tempCtx.putImageData(imageData, 0, 0);
        const dataUrl = tempCanvas.toDataURL("image/png");

        // Hand off to the brush engine BEFORE any teardown begins
        editorState.onAccept(dataUrl);
      }

      // ── Restore the main document ────────────────────────────────────
      const savedLayerCanvases = savedMainLayerCanvasesRef.current;
      if (!savedLayerCanvases) {
        setBrushTipEditorMode(null);
        return;
      }
      const savedLayers2 = savedMainLayersRef.current;
      const savedActiveLayerId = savedMainActiveLayerIdRef.current;
      const savedViewTransform = savedMainViewTransformRef.current;
      const savedCW = savedMainCanvasWidthRef.current;
      const savedCH = savedMainCanvasHeightRef.current;
      const savedUndo = savedMainUndoStackRef.current;
      const savedRedo = savedMainRedoStackRef.current;

      // Discard tip editor canvases
      for (const [, c] of tipEditorLayerCanvasesRef.current) {
        const ctx = c.getContext("2d");
        ctx?.clearRect(0, 0, c.width, c.height);
      }
      tipEditorLayerCanvasesRef.current = new Map();

      // Swap back
      invalidateAllLayerBitmaps();
      layerCanvasesRef.current = savedLayerCanvases;
      canvasWidthRef.current = savedCW;
      canvasHeightRef.current = savedCH;
      layersRef.current = [...savedLayers2];
      activeLayerIdRef.current = savedActiveLayerId;
      setActiveLayerIdForBitmap(savedActiveLayerId);
      undoStackRef.current = [...savedUndo];
      redoStackRef.current = [...savedRedo];
      strokeCanvasCacheKeyRef.current++;
      needsFullCompositeRef.current = true;
      invalidateCompositeContextCaches();
      _overlayCtxCached = null;

      // Resize display and auxiliary canvases back
      if (displayCanvasRef.current) {
        displayCanvasRef.current.width = savedCW;
        displayCanvasRef.current.height = savedCH;
      }
      if (rulerCanvasRef.current) {
        rulerCanvasRef.current.width = savedCW;
        rulerCanvasRef.current.height = savedCH;
      }
      if (webglBrushRef.current) webglBrushRef.current.resize(savedCW, savedCH);
      for (const offscreen of [
        belowActiveCanvasRef,
        aboveActiveCanvasRef,
        snapshotCanvasRef,
        activePreviewCanvasRef,
      ]) {
        if (offscreen.current) {
          offscreen.current.width = savedCW;
          offscreen.current.height = savedCH;
        }
      }

      viewTransformRef.current = savedViewTransform;
      applyTransformToDOMRef.current(savedViewTransform);

      // Restore saved color and right panel state
      const savedColor = editorState.savedColor;
      setBrushTipEditorMode(null);
      setRightSidebarCollapsed(savedRightSidebarCollapsedRef.current);
      setRightPanelWidth(savedRightPanelWidthRef.current);

      requestAnimationFrame(() => {
        setLayers([...savedLayers2]);
        setActiveLayerId(savedActiveLayerId);
        setCanvasWidth(savedCW);
        setCanvasHeight(savedCH);
        setViewTransform(savedViewTransform);
        setUndoCount(savedUndo.length);
        setRedoCount(savedRedo.length);
        setColor(savedColor);
        layersRef.current = [...savedLayers2];
        composite();
        updateNavigatorCanvas();
      });

      // Clear refs
      savedMainLayerCanvasesRef.current = null;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const {
    handleAdjustmentsToggle,
    onAdjustmentsPreview,
    onAdjustmentsComposite,
    onAdjustmentsThumbnailUpdate,
    onAdjustmentsMarkLayerDirty,
    onAdjustmentsPushUndo,
  } = useAdjustmentsSystem({
    activeSubpanelRef,
    setActiveSubpanel,
    scheduleComposite,
    composite,
    markLayerBitmapDirty,
    pushHistory,
  });

  // ─── Fill system ────────────────────────────────────────────────────────────
  const {
    fillMode,
    updateFillMode,
    fillSettings,
    setFillSettings,
    fillModeRef,
    fillSettingsRef,
    lassoFillOriginRef,
    isLassoFillDrawingRef,
    lassoFillPointsRef,
    gradientDragStartRef,
    gradientDragEndRef,
    isGradientDraggingRef,
    applyLassoFill,
    handleFillPointerDown,
    handleFillPointerMove,
    handleFillPointerUp,
  } = useFillSystem({
    isIPad,
    colorRef,
    activeLayerIdRef,
    layersRef,
    layerCanvasesRef,
    selectionMaskRef,
    selectionActiveRef,
    strokeStartSnapshotRef,
    pushHistory,
    composite,
    scheduleComposite,
    // Kick the marching-ants RAF loop when lasso fill drawing begins so the
    // in-progress ant trail is visible immediately (loop checks isLassoFillDrawingRef).
    onLassoFillStart: () => {
      if (marchingAntsRafRef.current === null && drawAntsRef.current) {
        marchingAntsRafRef.current = requestAnimationFrame(drawAntsRef.current);
      }
    },
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: zoomLockedRef is a stable ref
  useEffect(() => {
    zoomLockedRef.current = zoomLocked;
  }, [zoomLocked]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: rotateLockedRef is a stable ref
  useEffect(() => {
    rotateLockedRef.current = rotateLocked;
  }, [rotateLocked]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: panLockedRef is a stable ref
  useEffect(() => {
    panLockedRef.current = panLocked;
  }, [panLocked]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: eyedropperSampleSourceRef is a stable ref
  useEffect(() => {
    eyedropperSampleSourceRef.current = eyedropperSampleSource;
  }, [eyedropperSampleSource]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: eyedropperSampleSizeRef is a stable ref
  useEffect(() => {
    eyedropperSampleSizeRef.current = eyedropperSampleSize;
  }, [eyedropperSampleSize]);

  // Helper: get active tool's current size

  // Wire compositeRef so selection hook can call composite without circular dep
  // biome-ignore lint/correctness/useExhaustiveDependencies: compositeRef is a stable ref
  useEffect(() => {
    compositeRef.current = composite;
  }, [composite]);

  // ─── Crop system ────────────────────────────────────────────────────────────
  const {
    isCropActive,
    cropRectVersion,
    isCropActiveRef,
    cropRectRef,
    cropDragRef,
    cropPrevViewRef,
    cropPrevToolRef,
    setCropRectVersion,
    activateCrop,
    deactivateCrop,
    commitCrop,
    handleCropCancel,
    handleCropHandlePointerDown,
  } = useCropSystem({
    canvasWidthRef,
    canvasHeightRef,
    setCanvasWidth,
    setCanvasHeight,
    layersRef,
    layerCanvasesRef,
    setLayers,
    displayCanvasRef,
    rulerCanvasRef,
    belowActiveCanvasRef,
    aboveActiveCanvasRef,
    snapshotCanvasRef,
    activePreviewCanvasRef,
    webglBrushRef,
    strokeCanvasCacheKeyRef,
    needsFullCompositeRef,
    onInvalidateOverlayCtx: () => {
      _overlayCtxCached = null;
    },
    navThumbCanvasRef: navigatorCanvasRef,
    navThumbW: NAV_THUMB_W,
    composite,
    viewTransformRef,
    isFlippedRef,
    setViewTransform,
    setActiveTool,
    containerRef,
    pushHistory,
    clearSelection,
  });

  // Reset the active ruler to canvas-center defaults (undoable)
  const handleResetCurrentRuler = () => {
    const ruler = layersRef.current.find((l) => l.isRuler);
    if (!ruler) return;
    const cx = canvasWidthRef.current / 2;
    const cy = canvasHeightRef.current / 2;
    const half =
      Math.min(canvasWidthRef.current, canvasHeightRef.current) * 0.15;
    const spread2pt = canvasWidthRef.current * 0.25;
    const rtype = ruler.rulerPresetType ?? "perspective-1pt";
    const isLine = rtype === "line";
    const is2pt = rtype === "perspective-2pt";
    const is3pt = rtype === "perspective-3pt";
    const is5pt = rtype === "perspective-5pt";
    const isOval = rtype === "oval";
    const isGrid = rtype === "grid";

    // Build the "after" (reset) state
    const afterState: Record<string, unknown> = {
      horizonAngle: 0,
      rulerWarmupDist: 10,
    };
    if (!isLine && !is2pt && !is3pt && !is5pt) {
      afterState.vpX = cx;
      afterState.vpY = cy;
    }
    if (is2pt || is3pt) {
      afterState.horizonCenterX = cx;
      afterState.horizonCenterY = cy;
      afterState.vp1X = cx - spread2pt;
      afterState.vp1Y = cy;
      afterState.vp2X = cx + spread2pt;
      afterState.vp2Y = cy;
      afterState.rulerGridBX = cx;
      afterState.rulerGridBY = cy + 120;
      if (is3pt) {
        afterState.rulerVP3Y = cy - 200;
        afterState.rulerHandleDX = cx - spread2pt / 4;
        afterState.rulerHandleDY = cy - 70;
      }
    }
    if (isLine) {
      afterState.lineX1 = cx - half;
      afterState.lineY1 = cy;
      afterState.lineX2 = cx + half;
      afterState.lineY2 = cy;
    }
    if (isOval) {
      afterState.ovalCenterX = cx;
      afterState.ovalCenterY = cy;
      afterState.ovalAngle = 0;
      afterState.ovalSemiMajor = 120;
      afterState.ovalSemiMinor = 60;
    }
    if (is5pt) {
      afterState.fivePtCenterX = cx;
      afterState.fivePtCenterY = cy;
      afterState.fivePtHandleADist = 40;
      afterState.fivePtHandleBDist = 40;
      afterState.fivePtRotation = 0;
    }
    if (isGrid) {
      const half2 = 150;
      afterState.gridCorners = [
        { x: cx - half2, y: cy - half2 },
        { x: cx + half2, y: cy - half2 },
        { x: cx + half2, y: cy + half2 },
        { x: cx - half2, y: cy + half2 },
      ];
    }

    // Build before state from current ruler
    const { isRuler: _ir, rulerActive: _ra, ...beforeState } = ruler;
    pushHistory({
      type: "ruler-edit",
      layerId: ruler.id,
      before: beforeState,
      after: afterState as typeof beforeState,
    });

    setLayers((prev) =>
      prev.map((l) => (l.id === ruler.id ? { ...l, ...afterState } : l)),
    );
    layersRef.current = layersRef.current.map((l) =>
      l.id === ruler.id ? { ...l, ...afterState } : l,
    );
    scheduleRulerOverlay();
  };

  // Clear all ruler layers (undoable)
  const handleClearAllRulers = () => {
    const rulerLayers = layersRef.current.filter((l) => l.isRuler);
    if (rulerLayers.length === 0) return;
    const removedLayers = rulerLayers.map((layer) => ({
      layer,
      index: layersRef.current.findIndex((l) => l.id === layer.id),
    }));
    pushHistory({ type: "layers-clear-rulers", removedLayers });
    const ids = new Set(rulerLayers.map((l) => l.id));
    setLayers((prev) => prev.filter((l) => !ids.has(l.id)));
    layersRef.current = layersRef.current.filter((l) => !ids.has(l.id));
    scheduleRulerOverlay();
  };

  // scheduleComposite and _strokeCommitDirty are now from useCompositing hook above

  // Cancel any in-progress selection drawing (lasso, rect, ellipse, wand)
  // cancelInProgressSelectionRef is in uiRefs group (declared above); just wire its .current:
  cancelInProgressSelectionRef.current = () => {
    if (!isDrawingSelectionRef.current) return;
    isDrawingSelectionRef.current = false;
    selectionDraftPointsRef.current = [];
    selectionDraftBoundsRef.current = null;
    selectionDraftCursorRef.current = null;
    lassoHasPolyPointsRef.current = false;
    lassoIsDraggingRef.current = false;
    lassoStrokeStartRef.current = null;
    selectionPolyClosingRef.current = false;
    scheduleComposite();
  };

  // Commit an in-progress lasso (freehand/polygon) selection
  // commitInProgressLassoRef is in uiRefs group (declared above); just wire its .current:
  commitInProgressLassoRef.current = () => {
    if (!isDrawingSelectionRef.current) return;
    const mode = lassoModeRef.current;
    if (mode === "rect" || mode === "ellipse") {
      const sb = selectionDraftBoundsRef.current;
      if (sb) {
        const x = Math.min(sb.sx, sb.ex);
        const y = Math.min(sb.sy, sb.ey);
        const w = Math.abs(sb.ex - sb.sx);
        const h = Math.abs(sb.ey - sb.sy);
        if (w > 1 && h > 1) {
          if (mode === "rect") {
            selectionGeometryRef.current = { type: "rect", x, y, w, h };
            selectionShapesRef.current = [
              { type: "rect" as LassoMode, x, y, w, h },
            ];
          } else {
            selectionGeometryRef.current = { type: "ellipse", x, y, w, h };
            selectionShapesRef.current = [
              { type: "ellipse" as LassoMode, x, y, w, h },
            ];
          }
          selectionBoundaryPathRef.current.dirty = true;
          rasterizeSelectionMask();
          setSelectionActive(true);
        } else {
          clearSelection();
        }
        selectionDraftBoundsRef.current = null;
        isDrawingSelectionRef.current = false;
        const afterSnap = snapshotSelection();
        pushHistory({
          type: "selection",
          before: selectionBeforeRef.current ?? afterSnap,
          after: afterSnap,
        });
        selectionBeforeRef.current = null;
        scheduleComposite();
      }
      return;
    }
    if (mode === "wand") {
      cancelInProgressSelectionRef.current();
      return;
    }
    // Free/polygon lasso
    const pts = selectionDraftPointsRef.current;
    if (pts.length >= 3) {
      selectionGeometryRef.current = { type: "free", points: [...pts] };
      selectionShapesRef.current = [
        { type: "free" as LassoMode, points: [...pts] },
      ];
      selectionBoundaryPathRef.current.dirty = true;
      rasterizeSelectionMask();
      setSelectionActive(true);
      const afterSnap = snapshotSelection();
      pushHistory({
        type: "selection",
        before: selectionBeforeRef.current ?? afterSnap,
        after: afterSnap,
      });
      selectionBeforeRef.current = null;
    } else {
      clearSelection();
    }
    selectionDraftPointsRef.current = [];
    selectionDraftCursorRef.current = null;
    isDrawingSelectionRef.current = false;
    lassoHasPolyPointsRef.current = false;
    lassoIsDraggingRef.current = false;
    lassoStrokeStartRef.current = null;
    selectionPolyClosingRef.current = false;
    scheduleComposite();
  };

  // Marching ants animation loop
  // biome-ignore lint/correctness/useExhaustiveDependencies: all refs are stable (useRef)
  useEffect(() => {
    const overlay = selectionOverlayCanvasRef.current;
    if (!overlay) return;
    const drawAnts = () => {
      // Continue the loop while a selection is active OR while a selection is
      // being drawn (lasso/rect/ellipse draft) so the in-progress preview is visible.
      // BUG_3a FIX: Also keep the loop alive while a transform is active so the
      // transform bounding box is drawn even when no selection is present.
      // LASSO FILL FIX: Also keep alive while lasso fill is being drawn so the
      // marching ants trail is visible in real time.
      if (
        !selectionActiveRef.current &&
        !isDrawingSelectionRef.current &&
        !transformActiveRef.current &&
        !isLassoFillDrawingRef.current
      ) {
        marchingAntsRafRef.current = null;
        if (!_overlayCtxCached)
          _overlayCtxCached = overlay.getContext("2d", {
            willReadFrequently: !isIPad,
          });
        const ctx2 = _overlayCtxCached;
        if (ctx2) ctx2.clearRect(0, 0, overlay.width, overlay.height);
        return;
      }
      marchingAntsRafRef.current = requestAnimationFrame(drawAnts);
      // Throttle actual canvas work to ~60fps (~16ms interval) for performance.
      const now = performance.now();
      if (now - marchingAntsLastDrawRef.current < 16) return;
      marchingAntsLastDrawRef.current = now;
      if (!_overlayCtxCached)
        _overlayCtxCached = overlay.getContext("2d", {
          willReadFrequently: !isIPad,
        });
      const ctx = _overlayCtxCached;
      if (!ctx) return;
      ctx.clearRect(0, 0, overlay.width, overlay.height);

      marchingAntsOffsetRef.current =
        (marchingAntsOffsetRef.current + 0.5) % 16;
      const offset = marchingAntsOffsetRef.current;

      // Helper: stroke a selection path with marching ants at given translation
      const strokeAnts = (
        tx: number,
        ty: number,
        buildPath: (c: CanvasRenderingContext2D) => void,
      ) => {
        ctx.save();
        if (tx !== 0 || ty !== 0) ctx.translate(tx, ty);
        ctx.lineWidth = 1.0;
        // white layer
        ctx.strokeStyle = "#ffffff";
        ctx.setLineDash([8, 8]);
        ctx.lineDashOffset = -offset;
        ctx.beginPath();
        buildPath(ctx);
        ctx.stroke();
        // black layer
        ctx.strokeStyle = "#000000";
        ctx.lineDashOffset = -offset + 8;
        ctx.beginPath();
        buildPath(ctx);
        ctx.stroke();
        ctx.restore();
      };

      // Helper: build path for a committed geometry
      const buildGeomPath = (
        c: CanvasRenderingContext2D,
        geom: typeof selectionGeometryRef.current,
      ) => {
        if (!geom) return;
        if (geom.type === "mask" || geom.type === "wand") {
          // Chains are always up-to-date (rebuilt synchronously at every state transition).
          // Just draw them directly — no async scheduling, no generation guards.
          const chains = selectionBoundaryPathRef.current.chains;
          const smoothChain = (
            ch: Array<[number, number]>,
          ): Array<[number, number]> => {
            if (ch.length < 4) return ch;
            const out: Array<[number, number]> = [ch[0]];
            for (let ci = 1; ci < ch.length - 1; ci++) {
              out.push([
                (ch[ci - 1][0] + ch[ci][0] + ch[ci + 1][0]) / 3,
                (ch[ci - 1][1] + ch[ci][1] + ch[ci + 1][1]) / 3,
              ]);
            }
            out.push(ch[ch.length - 1]);
            return out;
          };
          for (const rawChain of chains) {
            const chain = smoothChain(rawChain);
            if (chain.length < 2) continue;
            c.moveTo(chain[0][0], chain[0][1]);
            for (let ci = 1; ci < chain.length; ci++) {
              c.lineTo(chain[ci][0], chain[ci][1]);
            }
          }
        }
        if (geom.type === "rect" && geom.w !== undefined) {
          const x = geom.w < 0 ? geom.x! + geom.w : geom.x!;
          const y = geom.h! < 0 ? geom.y! + geom.h! : geom.y!;
          const w = Math.abs(geom.w);
          const h = Math.abs(geom.h!);
          c.rect(x, y, w, h);
        } else if (geom.type === "ellipse" && geom.w !== undefined) {
          const cx = geom.x! + geom.w / 2;
          const cy = geom.y! + geom.h! / 2;
          const rx = Math.abs(geom.w / 2);
          const ry = Math.abs(geom.h! / 2);
          c.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        } else if (geom.points && geom.points.length > 1) {
          c.moveTo(geom.points[0].x, geom.points[0].y);
          for (let i = 1; i < geom.points.length; i++) {
            c.lineTo(geom.points[i].x, geom.points[i].y);
          }
          c.closePath();
        }
      };

      // Draw committed selection with float-translation offset
      // Generation guard: only draw committed geometry if the selection generation
      // Draw committed selection geometry. Chains are always current (rebuilt synchronously
      // at every state transition), so no generation guard is needed.
      const geom = selectionGeometryRef.current;
      if (geom && selectionActiveRef.current) {
        if (transformActiveRef.current) {
          // During transform: draw ants matching the current scaled/rotated bounds,
          // preserving the original selection shape (polygon, ellipse, rect, etc.)
          const xfAnts = xfStateRef.current;
          const ob = moveFloatOriginBoundsRef.current;
          if (xfAnts && ob) {
            const bx = xfAnts.x;
            const by = xfAnts.y;
            const bw = xfAnts.w;
            const bh = xfAnts.h;
            const ocx = bx + bw / 2;
            const ocy = by + bh / 2;
            const scaleX = ob.w > 0 ? bw / ob.w : 1;
            const scaleY = ob.h > 0 ? bh / ob.h : 1;
            const dx = bx - ob.x;
            const dy = by - ob.y;

            // Build a path using the actual shapes, transformed to match current xfState
            const buildTransformedPath = (c: CanvasRenderingContext2D) => {
              const shapes = selectionShapesRef.current;
              const shapesToDraw =
                shapes.length > 0 ? shapes : geom ? [geom] : [];
              for (const shape of shapesToDraw) {
                if (
                  (shape.type === "rect" || shape.type === "wand") &&
                  shape.w !== undefined
                ) {
                  const sx = shape.w < 0 ? shape.x! + shape.w : shape.x!;
                  const sy = shape.h! < 0 ? shape.y! + shape.h! : shape.y!;
                  const sw = Math.abs(shape.w);
                  const sh = Math.abs(shape.h!);
                  // Transform corners
                  const corners = [
                    { x: sx, y: sy },
                    { x: sx + sw, y: sy },
                    { x: sx + sw, y: sy + sh },
                    { x: sx, y: sy + sh },
                  ].map((p) => ({
                    x: ob.x + (p.x - ob.x) * scaleX + dx,
                    y: ob.y + (p.y - ob.y) * scaleY + dy,
                  }));
                  c.moveTo(corners[0].x, corners[0].y);
                  for (let i = 1; i < corners.length; i++)
                    c.lineTo(corners[i].x, corners[i].y);
                  c.closePath();
                } else if (shape.type === "ellipse" && shape.w !== undefined) {
                  const ecx = shape.x! + shape.w / 2;
                  const ecy = shape.y! + shape.h! / 2;
                  const newCx = ob.x + (ecx - ob.x) * scaleX + dx;
                  const newCy = ob.y + (ecy - ob.y) * scaleY + dy;
                  const newRx = Math.abs(shape.w / 2) * scaleX;
                  const newRy = Math.abs(shape.h! / 2) * scaleY;
                  c.ellipse(newCx, newCy, newRx, newRy, 0, 0, Math.PI * 2);
                } else if (shape.points && shape.points.length > 1) {
                  const newPts = shape.points.map((p) => ({
                    x: ob.x + (p.x - ob.x) * scaleX + dx,
                    y: ob.y + (p.y - ob.y) * scaleY + dy,
                  }));
                  c.moveTo(newPts[0].x, newPts[0].y);
                  for (let i = 1; i < newPts.length; i++)
                    c.lineTo(newPts[i].x, newPts[i].y);
                  c.closePath();
                } else if (shape.type === "mask") {
                  // Chains are always current — just draw them transformed.
                  const bdRef = selectionBoundaryPathRef.current;
                  const chains = bdRef.chains;
                  if (chains.length > 0) {
                    for (const rawChain of chains) {
                      if (rawChain.length < 2) continue;
                      const tp = rawChain.map(([cx, cy]) => ({
                        x: ob.x + (cx - ob.x) * scaleX + dx,
                        y: ob.y + (cy - ob.y) * scaleY + dy,
                      }));
                      c.moveTo(tp[0].x, tp[0].y);
                      for (let i = 1; i < tp.length; i++)
                        c.lineTo(tp[i].x, tp[i].y);
                    }
                  }
                }
              }
            };

            ctx.save();
            ctx.translate(ocx, ocy);
            ctx.rotate(xfAnts.rotation);
            ctx.translate(-ocx, -ocy);
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = "#ffffff";
            ctx.setLineDash([8, 8]);
            ctx.lineDashOffset = -offset;
            ctx.beginPath();
            buildTransformedPath(ctx);
            ctx.stroke();
            ctx.strokeStyle = "#000000";
            ctx.lineDashOffset = -offset + 8;
            ctx.beginPath();
            buildTransformedPath(ctx);
            ctx.stroke();
            ctx.restore();
          }
        } else {
          const xfMove = xfStateRef.current;
          const ob = moveFloatOriginBoundsRef.current;
          if (xfMove && ob && isDraggingFloatRef.current) {
            // Draw selection at the float's current transformed position
            if (geom.type === "rect" || geom.type === "ellipse") {
              const movedGeom = {
                ...geom,
                x: xfMove.x,
                y: xfMove.y,
                w: xfMove.w,
                h: xfMove.h,
              };
              strokeAnts(0, 0, (c) => buildGeomPath(c, movedGeom));
            } else if (geom.points && geom.points.length > 1) {
              // Translate + scale polygon points
              const scaleX = ob.w > 0 ? xfMove.w / ob.w : 1;
              const scaleY = ob.h > 0 ? xfMove.h / ob.h : 1;
              const dx = xfMove.x - ob.x;
              const dy = xfMove.y - ob.y;
              const newPts = geom.points.map((p) => ({
                x: ob.x + (p.x - ob.x) * scaleX + dx,
                y: ob.y + (p.y - ob.y) * scaleY + dy,
              }));
              strokeAnts(0, 0, (c) => {
                c.moveTo(newPts[0].x, newPts[0].y);
                for (let i = 1; i < newPts.length; i++)
                  c.lineTo(newPts[i].x, newPts[i].y);
                c.closePath();
              });
            } else {
              strokeAnts(0, 0, (c) => buildGeomPath(c, geom));
            }
          } else {
            strokeAnts(0, 0, (c) => buildGeomPath(c, geom));
          }
        }
      }

      // Draw in-progress draft selection with marching ants
      const draftBounds = selectionDraftBoundsRef.current;
      const draftPts = selectionDraftPointsRef.current;
      const mode = lassoModeRef.current;
      if (draftBounds) {
        // rect or ellipse in progress
        if (mode === "rect") {
          strokeAnts(0, 0, (c) => {
            c.rect(
              draftBounds.sx,
              draftBounds.sy,
              draftBounds.ex - draftBounds.sx,
              draftBounds.ey - draftBounds.sy,
            );
          });
        } else if (mode === "ellipse") {
          strokeAnts(0, 0, (c) => {
            const cx = (draftBounds.sx + draftBounds.ex) / 2;
            const cy = (draftBounds.sy + draftBounds.ey) / 2;
            const rx = Math.abs(draftBounds.ex - draftBounds.sx) / 2;
            const ry = Math.abs(draftBounds.ey - draftBounds.sy) / 2;
            if (rx > 0 && ry > 0) c.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
          });
        }
      } else if (
        draftPts.length > 0 &&
        mode !== "wand" &&
        isDrawingSelectionRef.current
      ) {
        const cursor = selectionDraftCursorRef.current;
        strokeAnts(0, 0, (c) => {
          if (draftPts.length === 0) return;
          c.moveTo(draftPts[0].x, draftPts[0].y);
          for (let i = 1; i < draftPts.length; i++)
            c.lineTo(draftPts[i].x, draftPts[i].y);
          // Draw line to current cursor position for polygon vertex preview
          if (cursor && !lassoIsDraggingRef.current)
            c.lineTo(cursor.x, cursor.y);
        });
        // Draw pip at start point when lasso session is open
        if (
          isDrawingSelectionRef.current &&
          draftPts.length > 0 &&
          (mode === "free" || mode === "poly")
        ) {
          const pip = draftPts[0];
          ctx.save();
          ctx.setLineDash([]);
          // Dark background circle
          ctx.beginPath();
          ctx.arc(pip.x, pip.y, 7, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(0,0,0,0.5)";
          ctx.fill();
          // White filled circle
          ctx.beginPath();
          ctx.arc(pip.x, pip.y, 6, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(255,255,255,0.9)";
          ctx.fill();
          ctx.strokeStyle = "rgba(255,255,255,0.9)";
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.restore();
        }
      }

      // Draw lasso fill in-progress preview — marching ants trail along the smoothed path
      if (
        isLassoFillDrawingRef.current &&
        activeToolRef.current === "fill" &&
        lassoFillOriginRef.current
      ) {
        const lfPts = lassoFillPointsRef.current;
        const lfOrigin = lassoFillOriginRef.current;
        if (lfPts.length >= 2) {
          // Apply the same Chaikin smoothing used at fill-commit time so the
          // ant trail and the filled area always match exactly.
          const smoothedLfPts = chaikinSmooth(lfPts, 2);
          strokeAnts(0, 0, (c) => {
            c.moveTo(smoothedLfPts[0].x, smoothedLfPts[0].y);
            for (let i = 1; i < smoothedLfPts.length; i++) {
              c.lineTo(smoothedLfPts[i].x, smoothedLfPts[i].y);
            }
            // Close path back to origin so user sees the full closed region preview
            c.lineTo(lfOrigin.x, lfOrigin.y);
            c.closePath();
          });
        }
        // Draw origin pip (same style as lasso selection tool)
        ctx.save();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(lfOrigin.x, lfOrigin.y, 7, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.fill();
        ctx.beginPath();
        ctx.arc(lfOrigin.x, lfOrigin.y, 6, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.fill();
        ctx.restore();
      }

      // Draw gradient fill drag preview
      if (isGradientDraggingRef.current && activeToolRef.current === "fill") {
        const gStart = gradientDragStartRef.current;
        const gEnd = gradientDragEndRef.current;
        if (gStart && gEnd) {
          ctx.save();
          ctx.strokeStyle = "rgba(0,120,255,0.8)";
          ctx.lineWidth = 1.5;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(gStart.x, gStart.y);
          ctx.lineTo(gEnd.x, gEnd.y);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(gStart.x, gStart.y, 4, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(0,120,255,0.8)";
          ctx.fill();
          ctx.restore();
        }
      }

      // Draw transform handles if transform tool is active
      if (
        transformActiveRef.current &&
        (activeToolRef.current === "transform" ||
          activeToolRef.current === "move")
      ) {
        // Inline handle computation to avoid forward reference
        const xfHandles = xfStateRef.current;
        const handles = xfHandles
          ? (() => {
              const { x, y, w, h } = xfHandles;
              const hw = w / 2;
              const hh = h / 2;
              return {
                nw: { x, y },
                n: { x: x + hw, y },
                ne: { x: x + w, y },
                w: { x, y: y + hh },
                e: { x: x + w, y: y + hh },
                sw: { x, y: y + h },
                s: { x: x + hw, y: y + h },
                se: { x: x + w, y: y + h },
                rot: { x: x + hw, y: y - 24 },
                bounds: { x, y, w, h },
              };
            })()
          : null;
        if (handles) {
          const rot = xfHandles!.rotation;
          const { x, y, w, h } = handles.bounds;
          const vcx = x + w / 2;
          const vcy = y + h / 2;
          ctx.save();
          ctx.translate(vcx, vcy);
          ctx.rotate(rot);
          ctx.translate(-vcx, -vcy);
          // Draw bounding box
          ctx.strokeStyle = "rgba(0,120,255,0.8)";
          ctx.lineWidth = 1;
          ctx.setLineDash([]);
          ctx.strokeRect(x, y, w, h);
          // Draw rotation line
          ctx.beginPath();
          // No rotation handle line
          // Draw square handles (Photoshop/Magma style) — no rotation handle
          const handleKeys = [
            "nw",
            "n",
            "ne",
            "w",
            "e",
            "sw",
            "s",
            "se",
          ] as const;
          // Scale handle size inversely with zoom so handles maintain a consistent
          // screen-pixel footprint. At zoom >= 1 hr = 4 (8×8px handle). When
          // zoomed out (zoom < 1) hr grows so the handle stays easy to grab.
          const zoom = viewTransformRef.current.zoom;
          const hr = Math.max(4, 4 / zoom);
          for (const key of handleKeys) {
            const pt = handles[key] as { x: number; y: number };
            ctx.fillStyle = "white";
            ctx.strokeStyle = "rgba(0,100,220,0.9)";
            ctx.lineWidth = Math.max(1.5, 1.5 / zoom);
            ctx.setLineDash([]);
            ctx.fillRect(pt.x - hr, pt.y - hr, hr * 2, hr * 2);
            ctx.strokeRect(pt.x - hr, pt.y - hr, hr * 2, hr * 2);
          }
          ctx.restore();
        }
      }
    };
    // Store drawAnts in a ref so the selectionActive restart effect can start it
    drawAntsRef.current = drawAnts;
    // Only start the loop immediately if a selection is already active at mount
    if (selectionActiveRef.current) {
      marchingAntsRafRef.current = requestAnimationFrame(drawAnts);
    }
    return () => {
      if (marchingAntsRafRef.current !== null) {
        cancelAnimationFrame(marchingAntsRafRef.current);
        marchingAntsRafRef.current = null;
      }
      drawAntsRef.current = null;
    };
  }, []);

  // Restart the marching ants loop when a selection becomes active.
  // The loop self-terminates when selectionActiveRef goes false, so we only
  // need to kick it off again when it transitions from inactive → active.
  useEffect(() => {
    if (
      selectionActive &&
      marchingAntsRafRef.current === null &&
      drawAntsRef.current
    ) {
      marchingAntsRafRef.current = requestAnimationFrame(drawAntsRef.current);
    }
  }, [selectionActive]);

  // FIX_5: Force-restart the overlay loop whenever transform becomes active.
  // The previous guard (`marchingAntsRafRef.current === null`) meant the loop
  // was never restarted when transform activated while a selection was already
  // being drawn — so the blue bounding box never appeared for multi-layer transforms
  // where a selection existed beforehand. Now we always cancel any in-flight RAF
  // and immediately schedule a new frame so the bounding box appears right away.
  useEffect(() => {
    if (isTransformActive && drawAntsRef.current) {
      // Cancel any existing loop frame before scheduling a fresh one
      if (marchingAntsRafRef.current !== null) {
        cancelAnimationFrame(marchingAntsRafRef.current);
      }
      marchingAntsRafRef.current = requestAnimationFrame(drawAntsRef.current);
    }
  }, [isTransformActive]);

  // Preload default circle tip
  // biome-ignore lint/correctness/useExhaustiveDependencies: all refs are stable
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      const tc = document.createElement("canvas");
      tc.width = tc.height = 128;
      const ctx = tc.getContext("2d", { willReadFrequently: !isIPad })!;
      ctx.drawImage(img, 0, 0, 128, 128);
      const imgData = ctx.getImageData(0, 0, 128, 128);
      const d = imgData.data;
      for (let i = 0; i < d.length; i += 4) {
        const lum = getLuminance(d[i], d[i + 1], d[i + 2]);
        d[i] = 255;
        d[i + 1] = 255;
        d[i + 2] = 255;
        d[i + 3] = 255 - lum;
      }
      ctx.putImageData(imgData, 0, 0);
      defaultTipCanvasRef.current = tc;
    };
    img.src = "/assets/generated/brush-tip-circle-transparent.dim_128x128.png";
  }, []);

  // Preload tip image into cache whenever brushSettings.tipImageData changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: all refs are stable
  useEffect(() => {
    const tipImageData = brushSettings.tipImageData;
    if (!tipImageData) return;
    const cacheKey = tipImageData.slice(0, 100);
    if (tipCanvasCacheRef.current.has(cacheKey)) return;
    const img = new Image();
    img.onload = () => {
      const tc = document.createElement("canvas");
      tc.width = tc.height = 128;
      const tcCtx = tc.getContext("2d", { willReadFrequently: !isIPad })!;
      tcCtx.drawImage(img, 0, 0, 128, 128);
      const imgData = tcCtx.getImageData(0, 0, 128, 128);
      const d = imgData.data;
      for (let i = 0; i < d.length; i += 4) {
        const lum = getLuminance(d[i], d[i + 1], d[i + 2]);
        d[i] = 255;
        d[i + 1] = 255;
        d[i + 2] = 255;
        d[i + 3] = 255 - lum;
      }
      tcCtx.putImageData(imgData, 0, 0);
      tipCanvasCacheRef.current.set(cacheKey, tc);
      webglBrushRef.current?.preloadTipTexture(tipImageData);
    };
    img.src = tipImageData;
    // Also kick off WebGL texture preload immediately (will complete when image loads)
    webglBrushRef.current?.preloadTipTexture(tipImageData);
  }, [brushSettings.tipImageData]);

  // Initialize WebGL brush and auxiliary canvases (one-time setup on mount).
  // Option B: layer canvases are created inside the swap function (per-document),
  // NOT here. This effect only sets up the WebGL brush context and the
  // offscreen compositing canvases that are shared across all documents.
  // biome-ignore lint/correctness/useExhaustiveDependencies: all refs are stable
  useEffect(() => {
    const display = displayCanvasRef.current;
    if (!display) return;
    display.width = canvasWidthRef.current;
    display.height = canvasHeightRef.current;

    const glBrush = createWebGLBrushContext(
      canvasWidthRef.current,
      canvasHeightRef.current,
    );
    if (glBrush) {
      webglBrushRef.current = glBrush;
      strokeBufferRef.current = glBrush.canvas;
      if (!glBrush.isWebGL2) {
        setWebGLFallbackWarning(true);
      }
    } else {
      const buf = document.createElement("canvas");
      buf.width = canvasWidthRef.current;
      buf.height = canvasHeightRef.current;
      strokeBufferRef.current = buf;
    }

    const makeOffscreenCanvas = () => {
      const c = document.createElement("canvas");
      c.width = canvasWidthRef.current;
      c.height = canvasHeightRef.current;
      return c;
    };
    belowActiveCanvasRef.current = makeOffscreenCanvas();
    aboveActiveCanvasRef.current = makeOffscreenCanvas();
    snapshotCanvasRef.current = makeOffscreenCanvas();
    activePreviewCanvasRef.current = makeOffscreenCanvas();

    scheduleComposite();

    return () => {
      webglBrushRef.current?.dispose();
    };
  }, [scheduleComposite]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: applyTransformToDOMRef is a stable ref
  const resetView = useCallback(() => {
    applyTransformToDOMRef.current(DEFAULT_TRANSFORM);
    setViewTransform(DEFAULT_TRANSFORM);
  }, []);

  // Collapses multiple ruler-edit undo entries into a single entry when switching away from the ruler tool.
  // biome-ignore lint/correctness/useExhaustiveDependencies: all refs are stable
  const collapseRulerHistory = useCallback(() => {
    if (activeToolRef.current !== "ruler") return;
    if (rulerEditHistoryDepthRef.current <= 1) return;
    const _d = rulerEditHistoryDepthRef.current;
    const _stack = undoStackRef.current;
    const _first = _stack[_stack.length - _d];
    const _last = _stack[_stack.length - 1];
    if (_first && _last && _first !== _last) {
      const firstType = (_first as { type: string }).type;
      const lastType = (_last as { type: string }).type;
      if (firstType === "ruler-edit" && lastType === "ruler-edit") {
        // Both are ruler-edits: merge final state into the first entry
        (_first as unknown as { after: unknown }).after = (
          _last as unknown as { after: unknown }
        ).after;
      } else if (firstType === "layer-add" && lastType === "ruler-edit") {
        // Base is a ruler layer-add: fold final ruler state into the layer object
        // so a single Ctrl+Z undoes the entire ruler creation.
        const layerAddEntry = _first as unknown as {
          type: "layer-add";
          layer: { [key: string]: unknown };
        };
        const lastRulerEdit = _last as unknown as {
          type: "ruler-edit";
          after: { [key: string]: unknown };
        };
        // Merge all ruler-edit "after" fields into the layer-add layer
        layerAddEntry.layer = {
          ...layerAddEntry.layer,
          ...lastRulerEdit.after,
        };
      }
    }
    // Splice out all ruler-edit entries after the base entry (layer-add or first ruler-edit)
    _stack.splice(-(_d - 1), _d - 1);
    rulerEditHistoryDepthRef.current = 1;
    setUndoCount(_stack.length);
    setRedoCount(redoStackRef.current.length);
  }, [
    activeToolRef,
    rulerEditHistoryDepthRef,
    undoStackRef,
    redoStackRef,
    setUndoCount,
    setRedoCount,
  ]);

  /**
   * Wraps handleUndo to detect when a ruler layer-add entry was just undone.
   * If the user is in ruler tool mode but no ruler layer remains after the undo,
   * automatically switch back to the last paint tool so the UI stays consistent.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: refs are stable
  const handleUndoWithRulerToolSwitch = useCallback(() => {
    // Peek at the top entry before undoing to check if it's a ruler layer-add
    const topEntry = undoStackRef.current[undoStackRef.current.length - 1];
    const isRulerLayerAdd =
      topEntry &&
      (topEntry as { type: string }).type === "layer-add" &&
      (topEntry as { layer: { isRuler?: boolean } }).layer?.isRuler === true;

    handleUndo();

    // After undo: if a ruler layer-add was removed and the ruler tool is still active,
    // switch back to the last paint tool so the user can draw immediately.
    if (isRulerLayerAdd && activeToolRef.current === "ruler") {
      const restoreTool = lastPaintToolRef2.current ?? "brush";
      setActiveTool(restoreTool);
      activeToolRef.current = restoreTool;
      rulerEditHistoryDepthRef.current = 0;
      if (
        restoreTool === "brush" ||
        restoreTool === "smudge" ||
        restoreTool === "eraser"
      ) {
        setActiveSubpanel(restoreTool as "brush" | "smudge" | "eraser");
      } else {
        setActiveSubpanel(null);
      }
      if (lastPaintLayerIdRef.current) {
        setActiveLayerId(lastPaintLayerIdRef.current);
        activeLayerIdRef.current = lastPaintLayerIdRef.current;
      }
    }
  }, [
    handleUndo,
    undoStackRef,
    activeToolRef,
    lastPaintToolRef2,
    lastPaintLayerIdRef,
    activeLayerIdRef,
    rulerEditHistoryDepthRef,
    setActiveTool,
    setActiveSubpanel,
    setActiveLayerId,
  ]);

  // stampDot, normalizePressure, flushStrokeBuffer → now from useStrokeEngine/useCompositing hooks

  // compositeWithStrokePreview, buildStrokeCanvases → now from useCompositing hook
  // Prewarm useEffect stays here since it orchestrates buildStrokeCanvases after layer/activeLayerId changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional – layers/activeLayerId trigger re-warm
  useEffect(() => {
    if (prewarmRafRef.current !== null)
      cancelAnimationFrame(prewarmRafRef.current);
    prewarmRafRef.current = requestAnimationFrame(() => {
      prewarmRafRef.current = null;
      if (!isDrawingRef.current) {
        buildStrokeCanvases(activeLayerIdRef.current);
      }
    });
    return () => {
      if (prewarmRafRef.current !== null) {
        cancelAnimationFrame(prewarmRafRef.current);
        prewarmRafRef.current = null;
      }
    };
  }, [layers, activeLayerId]); // eslint-disable-line
  // compositeWithStrokePreview, buildStrokeCanvases, stampWebGL, renderBrushSegmentAlongPoints,
  // renderSmearAlongPoints → all moved to useCompositing/useStrokeEngine hooks.

  // ── Option B document swap implementation ────────────────────────────────
  // Each document owns its layer canvases in doc.layerCanvases (a Map).
  // Switching tabs = re-point layerCanvasesRef at the new doc's map + composite().
  // No getImageData, no putImageData, no pixel data loss risk.
  //
  // Runs on every render (no deps) to keep the ref current with latest state and refs.
  // swapDocumentRef.current(fromDoc, toDoc) is called by DocumentManager on tab switch.
  useEffect(() => {
    swapDocumentRef.current = (
      fromDoc: DocumentState,
      toDoc: DocumentState,
    ): void => {
      // ── SAVE: Write all current non-pixel state into fromDoc ───────────────
      // Pixel data is NOT saved here — it's already live in fromDoc.layerCanvases.
      fromDoc.layers = [...layersRef.current];
      fromDoc.activeLayerId = activeLayerIdRef.current;
      fromDoc.undoStack = structuredClone(undoStackRef.current);
      fromDoc.redoStack = structuredClone(redoStackRef.current);
      fromDoc.viewTransform = { ...viewTransformRef.current };
      fromDoc.isFlipped = isFlippedRef.current;
      fromDoc.isDirty = isDirtyRef.current;
      fromDoc.canvasWidth = canvasWidthRef.current;
      fromDoc.canvasHeight = canvasHeightRef.current;
      fromDoc.activeTool = activeToolRef.current;
      fromDoc.brushSettings = brushSettings ? { ...brushSettings } : null;
      fromDoc.brushSizes = { ...brushSizes };
      fromDoc.brushBlendMode = brushBlendMode;
      fromDoc.color = color ? { ...color } : null;
      fromDoc.recentColors = [...recentColors];
      fromDoc.lassoMode = lassoMode;
      fromDoc.activeRulerPresetType = activeRulerPresetType;
      fromDoc.wandTolerance = wandTolerance;
      fromDoc.wandContiguous = wandContiguous;
      // BUG-005 FIX: Read from ref (always current) rather than React state
      // (which can be stale when called synchronously during a render cycle).
      fromDoc.activeSubpanel = activeSubpanelRef.current;
      fromDoc.layerThumbnails = { ...layerThumbnails };

      // ── INITIALIZE: If toDoc has no layers, create Layer 1 + Background ──
      // Canvases are created here and stored in toDoc.layerCanvases so they
      // survive across tab switches without ever needing save/restore.
      if (toDoc.layers.length === 0) {
        const newW = Math.max(1, toDoc.canvasWidth);
        const newH = Math.max(1, toDoc.canvasHeight);

        // Generate globally unique IDs so that two documents with the same
        // layer structure never collide in layerCanvasMap.
        const layer1Id = generateLayerId();
        const bgLayerId = generateLayerId();

        const layer1: Layer = {
          id: layer1Id,
          name: "Layer 1",
          type: "paint",
          visible: true,
          opacity: 1,
          blendMode: "source-over",
          isClippingMask: false,
          alphaLock: false,
        };
        const bgLayer: Layer = {
          id: bgLayerId,
          name: "Background",
          type: "paint",
          visible: true,
          opacity: 1,
          blendMode: "source-over",
          isClippingMask: false,
          alphaLock: false,
        };

        // Layer 1 canvas — transparent
        const l1Canvas = document.createElement("canvas");
        l1Canvas.width = newW;
        l1Canvas.height = newH;
        toDoc.layerCanvases.set(layer1.id, l1Canvas);

        // Background canvas — filled white
        const bgCanvas = document.createElement("canvas");
        bgCanvas.width = newW;
        bgCanvas.height = newH;
        const bgCtx = bgCanvas.getContext("2d", {
          willReadFrequently: !isIPad,
        });
        if (bgCtx) {
          bgCtx.fillStyle = "#ffffff";
          bgCtx.fillRect(0, 0, newW, newH);
        }
        toDoc.layerCanvases.set(bgLayer.id, bgCanvas);

        // Layer 1 at index 0 (top), Background at index 1 (bottom).
        // Composite loop iterates BACKWARDS: high index = bottom, low = top.
        toDoc.layers = [layer1, bgLayer];
        toDoc.activeLayerId = layer1Id;

        // Fit new canvas to viewport
        const containerNew = containerRef.current;
        if (containerNew) {
          const cw = containerNew.clientWidth;
          const ch = containerNew.clientHeight;
          const zoom = Math.min((cw * 0.85) / newW, (ch * 0.85) / newH, 1);
          const vt = { zoom, panX: 0, panY: 0, rotation: 0 };
          viewTransformRef.current = vt;
          applyTransformToDOMRef.current(vt);
          toDoc.viewTransform = { ...vt };
        }
      }

      const newW = Math.max(1, toDoc.canvasWidth);
      const newH = Math.max(1, toDoc.canvasHeight);

      // ── SWAP (synchronous) ─────────────────────────────────────────────────
      clearSelection();
      invalidateAllLayerBitmaps();

      // 1. Point layerCanvasesRef at the incoming document's canvas map.
      //    This is the core of Option B — no pixel data copy needed.
      layerCanvasesRef.current = toDoc.layerCanvases;

      // 2. Resize display canvas if dimensions differ
      if (displayCanvasRef.current) {
        if (
          displayCanvasRef.current.width !== newW ||
          displayCanvasRef.current.height !== newH
        ) {
          displayCanvasRef.current.width = newW;
          displayCanvasRef.current.height = newH;
        }
      }

      // 3. Resize auxiliary canvases (ruler, webgl brush, offscreen compositing)
      if (rulerCanvasRef.current) {
        rulerCanvasRef.current.width = newW;
        rulerCanvasRef.current.height = newH;
      }
      if (webglBrushRef.current) {
        webglBrushRef.current.resize(newW, newH);
      }
      for (const offscreen of [
        belowActiveCanvasRef,
        aboveActiveCanvasRef,
        snapshotCanvasRef,
        activePreviewCanvasRef,
      ]) {
        if (offscreen.current) {
          offscreen.current.width = newW;
          offscreen.current.height = newH;
        }
      }
      invalidateCompositeContextCaches();
      _overlayCtxCached = null;
      strokeCanvasCacheKeyRef.current++;
      needsFullCompositeRef.current = true;

      // 4. Update all refs from toDoc
      canvasWidthRef.current = newW;
      canvasHeightRef.current = newH;
      layersRef.current = [...toDoc.layers];
      activeLayerIdRef.current = toDoc.activeLayerId;
      setActiveLayerIdForBitmap(toDoc.activeLayerId);
      undoStackRef.current = structuredClone(toDoc.undoStack);
      redoStackRef.current = structuredClone(toDoc.redoStack);
      viewTransformRef.current = { ...toDoc.viewTransform };
      isFlippedRef.current = toDoc.isFlipped;
      brushBlendModeRef.current = toDoc.brushBlendMode;
      activeToolRef.current = toDoc.activeTool as Tool;
      activeSubpanelRef.current = toDoc.activeSubpanel as Tool | null;
      isDirtyRef.current = toDoc.isDirty;
      applyTransformToDOMRef.current({ ...toDoc.viewTransform });

      // Mark all layer bitmaps dirty so composite() re-reads fresh canvases
      for (const layer of toDoc.layers) {
        if (layer.type !== undefined && layer.type !== "paint") continue;
        if (layer.isRuler) continue;
        markLayerBitmapDirty(layer.id);
      }

      // 5a. Ensure Background layer has white fill on the incoming document.
      //     Covers the file-load case where pixelData was null and the canvas
      //     was created empty, as well as any document where the Background
      //     canvas was silently cleared by an earlier resize.
      for (const layer of toDoc.layers) {
        if (layer.type !== "paint") continue;
        const layerMeta = layer as { name?: string };
        if (layerMeta.name !== "Background") continue;
        const bgCanvas =
          layerCanvasesRef.current.get(layer.id) ||
          getOrCreateLayerCanvas(layer.id);
        const bgCtx = bgCanvas.getContext("2d");
        if (bgCtx) {
          const imageData = bgCtx.getImageData(
            0,
            0,
            Math.max(1, bgCanvas.width),
            Math.max(1, bgCanvas.height),
          );
          const hasPixels = imageData.data.some((v, i) => i % 4 === 3 && v > 0);
          if (!hasPixels) {
            bgCtx.fillStyle = "#ffffff";
            bgCtx.fillRect(0, 0, bgCanvas.width, bgCanvas.height);
            // Invalidate the cached bitmap so composite() re-reads the filled canvas
            markLayerBitmapDirty(layer.id);
          }
        }
      }

      // ── BUG-004 FIX: Validate canvases before first composite ─────────────
      // After canvases are created/pointed at for toDoc, verify every paint
      // layer has a correctly-sized canvas before compositeAllLayers() runs.
      // Warn and auto-create/resize any canvas that is missing or wrong-sized.
      // This guard prevents silent corruption when a canvas is absent or was
      // resized to wrong dimensions before the swap settled.
      for (const layer of toDoc.layers) {
        if (layer.type !== undefined && layer.type !== "paint") continue;
        if (layer.isRuler) continue;
        const existingCanvas = layerCanvasesRef.current.get(layer.id);
        if (
          !existingCanvas ||
          existingCanvas.width !== newW ||
          existingCanvas.height !== newH
        ) {
          console.warn(
            `[Canvas Validation] Missing or wrong-size canvas for layer ${layer.id} ("${(layer as { name?: string }).name ?? "?"}") — expected ${newW}×${newH}, got ${existingCanvas ? `${existingCanvas.width}×${existingCanvas.height}` : "none"}. Auto-creating.`,
          );
          const recovered = existingCanvas ?? document.createElement("canvas");
          recovered.width = newW;
          recovered.height = newH;
          // Re-fill Background if it was just cleared by resize
          if ((layer as { name?: string }).name === "Background") {
            const rCtx = recovered.getContext("2d");
            if (rCtx) {
              rCtx.fillStyle = "#ffffff";
              rCtx.fillRect(0, 0, newW, newH);
            }
          }
          layerCanvasesRef.current.set(layer.id, recovered);
          toDoc.layerCanvases.set(layer.id, recovered);
          markLayerBitmapDirty(layer.id);
        }
      }

      // 5b. Composite synchronously — pixels are already on the layer canvases
      composite();
      updateNavigatorCanvas();

      // ── REACT SYNC (rAF — only affects UI chrome, not canvas pixels) ──────
      requestAnimationFrame(() => {
        setLayers([...toDoc.layers]);
        // BUG-006 FIX: Advance the group ID counter past any group IDs present in
        // the incoming document's layer array. This prevents newly-created groups
        // in this document from colliding with group IDs that were loaded from a
        // file or imported from another document. Must be called here (in addition
        // to handleLoadFile) because the swap path is also a bulk layer restore.
        resetGroupIdCounterFromFlat(toDoc.layers as FlatEntry[]);
        setActiveLayerId(toDoc.activeLayerId);
        setCanvasWidth(newW);
        setCanvasHeight(newH);
        setViewTransform({ ...toDoc.viewTransform });
        setIsFlipped(toDoc.isFlipped);
        setActiveTool(toDoc.activeTool as Tool);
        if (toDoc.brushSettings) setBrushSettings(toDoc.brushSettings);
        setBrushSizes(toDoc.brushSizes);
        setBrushBlendMode(toDoc.brushBlendMode);
        if (toDoc.color) setColor(toDoc.color);
        setRecentColors(toDoc.recentColors);
        setLassoMode(toDoc.lassoMode as LassoMode);
        setActiveRulerPresetType(
          toDoc.activeRulerPresetType as RulerPresetType,
        );
        setWandTolerance(toDoc.wandTolerance);
        setWandContiguous(toDoc.wandContiguous);
        setActiveSubpanel(toDoc.activeSubpanel as Tool | null);
        setHasUnsavedChanges(toDoc.isDirty);
        setLayerThumbnails(toDoc.layerThumbnails);
        setUndoCount(toDoc.undoStack.length);
        setRedoCount(toDoc.redoStack.length);

        // Re-composite after React re-render to confirm pixels are displayed
        layersRef.current = [...toDoc.layers];
        composite();
        updateNavigatorCanvas();
      });
    };
  }); // No deps array — runs after every render to keep refs current

  // Apply view transform directly to DOM during gesture — no React re-render
  // biome-ignore lint/correctness/useExhaustiveDependencies: all refs are stable
  const applyTransformToDOM = useCallback((vt: ViewTransform) => {
    viewTransformRef.current = vt;
    const el = canvasWrapperRef.current;
    if (el) {
      const flip = isFlippedRef.current ? -1 : 1;
      el.style.transform = `translate(${vt.panX}px, ${vt.panY}px) scaleX(${flip}) rotate(${vt.rotation}deg) scale(${vt.zoom})`;
    }
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: applyTransformToDOMRef is a stable ref
  useEffect(() => {
    applyTransformToDOMRef.current = applyTransformToDOM;
  }, [applyTransformToDOM]);

  // Keep canvas wrapper DOM transform in sync with React state.
  // This is critical: applyTransformToDOM mutates el.style.transform directly (bypassing React),
  // but any React re-render from an unrelated state change (thumbnail update, etc.) will
  // overwrite the DOM transform with the stale React state value.
  // By running applyTransformToDOM here, we ensure every render that touches viewTransform
  // or isFlipped also pushes the correct transform to the DOM immediately after paint.
  // Also schedule a ruler overlay redraw so the ruler canvas (which applies the view
  // transform manually) stays in sync with pan/zoom/rotation/flip changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: applyTransformToDOM is stable
  useEffect(() => {
    applyTransformToDOM(viewTransform);
    scheduleRulerOverlayRef.current();
  }, [viewTransform, isFlipped, applyTransformToDOM]);

  // Keep the selection overlay canvas pixel dimensions in sync with the main canvas.
  // The ref callback only fires at mount, so after a crop resize the overlay would
  // retain old pixel dimensions, causing a CSS-scale mismatch and coordinate desync.
  // biome-ignore lint/correctness/useExhaustiveDependencies: selectionOverlayCanvasRef is a stable ref
  useEffect(() => {
    const overlay = selectionOverlayCanvasRef.current;
    if (
      overlay &&
      (overlay.width !== canvasWidth || overlay.height !== canvasHeight)
    ) {
      overlay.width = canvasWidth;
      overlay.height = canvasHeight;
    }
  }, [canvasWidth, canvasHeight]);

  // Redraw ruler overlay when any ruler-relevant state changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: drawRulerOverlay is stable
  useEffect(() => {
    drawRulerOverlay();
  }, [undoCount, redoCount, layers, activeRulerPresetType]);

  // ---- Ruler overlay rendering ----
  // Delegates to the four ruler sub-hooks which contain the drawing logic.
  // The ruler canvas is sized to the container viewport (not the canvas rect) so
  // ruler lines can extend past canvas boundaries into the surrounding background.
  // We apply a context transform that maps canvas-space coordinates to container
  // space so all existing draw functions work without change.
  // biome-ignore lint/correctness/useExhaustiveDependencies: all refs are stable
  const drawRulerOverlay = useCallback(() => {
    const rc = rulerCanvasRef.current;
    if (!rc) return;
    const container = containerRef.current;
    if (!container) return;
    const ctx = rc.getContext("2d");
    if (!ctx) return;

    // Resize canvas to container dimensions so ruler lines are not clipped.
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    if (rc.width !== cw || rc.height !== ch) {
      rc.width = cw;
      rc.height = ch;
    }

    ctx.clearRect(0, 0, rc.width, rc.height);

    // Always read fresh from the ref — never use a captured/stale variable
    const rulerLayer = layersRef.current.find((l) => l.isRuler);
    if (!rulerLayer || !rulerLayer.visible) return;

    const opacity = rulerLayer.opacity;
    const presetType = rulerLayer.rulerPresetType ?? "perspective-1pt";

    // Build the canvas-space → container-space transform.
    // This replicates the CSS transform applied to canvasWrapperRef so that
    // canvas-space 0,0 maps to the canvas's on-screen top-left corner.
    const vt = viewTransformRef.current;
    const flip = isFlippedRef.current ? -1 : 1;
    const rad = (vt.rotation * Math.PI) / 180;
    const W = canvasWidthRef.current;
    const H = canvasHeightRef.current;

    ctx.save();
    ctx.globalAlpha = opacity;

    // Translate to container center + pan offset
    ctx.translate(cw / 2 + vt.panX, ch / 2 + vt.panY);
    // Apply rotation
    ctx.rotate(rad);
    // Apply zoom and horizontal flip
    ctx.scale(vt.zoom * flip, vt.zoom);
    // Translate so that canvas-space 0,0 maps correctly
    ctx.translate(-W / 2, -H / 2);

    const currentZoom = vt.zoom;
    if (presetType === "line") {
      lineRuler.drawLineRulerOverlay(ctx, rulerLayer, currentZoom);
    } else if (presetType === "perspective-1pt") {
      ruler1pt2pt.draw1ptRulerOverlay(ctx, rulerLayer, currentZoom);
    } else if (presetType === "perspective-2pt") {
      ruler1pt2pt.draw2ptRulerOverlay(ctx, rulerLayer, currentZoom);
    } else if (presetType === "perspective-3pt") {
      ruler3pt5pt.draw3ptRulerOverlay(ctx, rulerLayer, opacity, currentZoom);
    } else if (presetType === "perspective-5pt") {
      ruler3pt5pt.draw5ptRulerOverlay(ctx, rulerLayer, opacity, currentZoom);
    } else if (presetType === "oval") {
      ellipseGridRuler.drawOvalRulerOverlay(ctx, rulerLayer, currentZoom);
    } else if (presetType === "grid") {
      ellipseGridRuler.drawGridRulerOverlay(ctx, rulerLayer, currentZoom);
    }

    ctx.restore();
  }, [lineRuler, ruler1pt2pt, ruler3pt5pt, ellipseGridRuler]);

  // Debounced ruler overlay: coalesces multiple back-to-back calls (ruler drag, undo/redo,
  // layer changes) into a single draw per animation frame — eliminates redundant full-canvas
  // redraws when several ruler-editing operations fire in rapid succession.
  const scheduleRulerOverlay = useCallback(() => {
    if (rulerRafRef.current !== null) return;
    rulerRafRef.current = requestAnimationFrame(() => {
      rulerRafRef.current = null;
      drawRulerOverlay();
    });
  }, [drawRulerOverlay]);
  // Wire the stable ref so ruler sub-hooks (instantiated earlier) can call
  // scheduleRulerOverlay without a forward-reference issue.
  scheduleRulerOverlayRef.current = scheduleRulerOverlay;

  // handlePointerDown, handlePointerMove, and handlePointerUp are all implemented
  // inside usePaintingCanvasEvents.ts. They are not defined here.

  // biome-ignore lint/correctness/useExhaustiveDependencies: selectionActiveRef and selectionMaskRef are stable refs
  const handleClear = useCallback(() => {
    const layerId = activeLayerIdRef.current;
    const lc = layerCanvasesRef.current.get(layerId);
    if (!lc) return;
    const ctx = lc.getContext("2d", { willReadFrequently: !isIPad });
    if (!ctx) return;
    const before = ctx.getImageData(0, 0, lc.width, lc.height);
    if (selectionActiveRef.current && selectionMaskRef.current) {
      // Only erase pixels inside the selection
      ctx.globalCompositeOperation = "destination-out";
      ctx.drawImage(selectionMaskRef.current, 0, 0);
      ctx.globalCompositeOperation = "source-over";
    } else {
      ctx.clearRect(0, 0, lc.width, lc.height);
    }
    const after = ctx.getImageData(0, 0, lc.width, lc.height);
    pushHistory({ type: "pixels", layerId, before, after });
    markCanvasDirty(layerId);
    scheduleComposite();
  }, [scheduleComposite, pushHistory]);

  // handleExportBrushes, handleImportBrushes, processImportAppend, resolveConflict
  // are now provided by usePresetSystem above.

  /**
   * Shared save-dialog helper for PNG and PSD export.
   * Uses the File System Access API when available (Chrome/Edge) so the user
   * can choose a name and save location. Falls back silently to a standard
   * <a download> link for Firefox/Safari.
   *
   * Errors are propagated to the caller. AbortError (user cancelled) must be
   * caught and silently ignored at the call site.
   */
  const exportWithSaveDialog = useCallback(
    async (
      blob: Blob,
      defaultName: string,
      fileType: { description: string; accept: Record<string, string[]> },
    ): Promise<void> => {
      if ("showSaveFilePicker" in window) {
        // biome-ignore lint/suspicious/noExplicitAny: File System Access API not in TS lib
        const fileHandle = await (window as any).showSaveFilePicker({
          suggestedName: defaultName,
          types: [fileType],
        });
        const writable = await fileHandle.createWritable();
        await writable.write(blob);
        await writable.close();
      } else {
        // Fallback — silent, no indication that native dialog was unavailable
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = defaultName;
        a.style.display = "none";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    },
    [],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: displayCanvasRef is a stable ref
  const handleExport = useCallback(async () => {
    const display = displayCanvasRef.current;
    if (!display) return;

    const doc = activeDocumentRef.current;
    const baseName =
      (doc?.filename ?? "untitled").replace(/\.sktch$/i, "").trim() ||
      "untitled";
    const defaultFilename = `${baseName}.png`;

    setIsPngExporting(true);
    try {
      const exportCanvas = document.createElement("canvas");
      exportCanvas.width = display.width;
      exportCanvas.height = display.height;
      const ctx = exportCanvas.getContext("2d", {
        willReadFrequently: !isIPad,
      });
      if (!ctx) return;
      ctx.drawImage(display, 0, 0);

      // Use toBlob (async) for better memory handling and Blob API compatibility
      const pngBlob = await new Promise<Blob | null>((resolve) =>
        exportCanvas.toBlob(resolve, "image/png"),
      );
      if (!pngBlob) throw new Error("Failed to generate PNG data");

      await exportWithSaveDialog(pngBlob, defaultFilename, {
        description: "PNG Image",
        accept: { "image/png": [".png"] },
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return; // user cancelled
      console.error("[PNG Export] Failed:", err);
      alert(
        `PNG export failed: ${err instanceof Error ? err.message : "Unknown error"}`,
      );
    } finally {
      setIsPngExporting(false);
    }
  }, [exportWithSaveDialog]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: stable refs + activeDocumentRef
  const handleExportPSD = useCallback(async () => {
    setIsPsdExporting(true);
    try {
      const doc = activeDocumentRef.current;
      const baseName =
        (doc?.filename ?? "untitled").replace(/\.sktch$/i, "").trim() ||
        "untitled";
      const psdBlob = await exportAsPSD({
        layers: layersRef.current,
        layerCanvasMap: layerCanvasesRef.current,
        canvasWidth: canvasWidthRef.current,
        canvasHeight: canvasHeightRef.current,
        filename: baseName,
      });
      await exportWithSaveDialog(psdBlob, `${baseName}.psd`, {
        description: "Photoshop Document",
        accept: { "application/octet-stream": [".psd"] },
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return; // user cancelled
      console.error("[PSD Export] Failed:", err);
      alert(
        `PSD export failed: ${err instanceof Error ? err.message : "Unknown error"}`,
      );
    } finally {
      setIsPsdExporting(false);
    }
  }, [exportWithSaveDialog]);

  const handleSave = useCallback(async () => {
    // Save button always does silent local save (Ctrl+S behavior)
    await handleSilentSave();
  }, [handleSilentSave]);

  const handleRecentColorClick = useCallback((hex: string) => {
    const rgb = hexToRgb(hex);
    if (!rgb) return;
    const [r, g, b] = rgb;
    const [h, s, v] = rgbToHsv(r, g, b);
    setColor((prev) => ({ ...prev, h, s, v }));
  }, []);

  // ---- Move/Transform helpers ----
  // These are now in useTransformSystem. Wire them into selectionActionsRef for backward compat.

  // biome-ignore lint/correctness/useExhaustiveDependencies: stable ref
  useEffect(() => {
    selectionActionsRef.current.extractFloat =
      transformActionsRef.current.extractFloat;
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: stable ref
  useEffect(() => {
    selectionActionsRef.current.commitFloat =
      transformActionsRef.current.commitFloat;
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: stable ref
  useEffect(() => {
    selectionActionsRef.current.revertTransform =
      transformActionsRef.current.revertTransform;
  }, []);

  // ── Selection grow/shrink ─────────────────────────────────────────────────
  const handleGrowShrink = (direction: 1 | -1) => {
    if (!selectionMaskRef.current) return;
    selectionBeforeRef.current = snapshotSelection();
    const mc = selectionMaskRef.current;
    const mctx = mc.getContext("2d", { willReadFrequently: !isIPad });
    if (!mctx) return;

    // Use computeMaskBounds for the initial size measurement
    const preBounds = computeMaskBounds(mc);
    if (!preBounds) return;

    const pixels =
      Math.max(1, Math.round(Math.max(preBounds.w, preBounds.h) * 0.05)) *
      direction;

    const mdata = mctx.getImageData(
      0,
      0,
      canvasWidthRef.current,
      canvasHeightRef.current,
    ).data;
    const currentMask = new Uint8Array(
      canvasWidthRef.current * canvasHeightRef.current,
    );
    for (let i = 0; i < canvasWidthRef.current * canvasHeightRef.current; i++) {
      currentMask[i] = mdata[i * 4 + 3] > 64 ? 1 : 0;
    }
    const newMask = growShrinkMask(
      currentMask,
      canvasWidthRef.current,
      canvasHeightRef.current,
      pixels,
    );
    const newImgData = mctx.createImageData(
      canvasWidthRef.current,
      canvasHeightRef.current,
    );
    const nd = newImgData.data;
    for (let i = 0; i < newMask.length; i++) {
      if (newMask[i]) {
        nd[i * 4] = 255;
        nd[i * 4 + 1] = 255;
        nd[i * 4 + 2] = 255;
        nd[i * 4 + 3] = 255;
      }
    }
    mctx.putImageData(newImgData, 0, 0);

    // Normalize to mask type with no stale shape data — extractFloat and the ant
    // renderer will both read the actual pixel mask for bounds and outline.
    selectionGeometryRef.current = { type: "mask" as LassoMode };
    selectionShapesRef.current = [];
    selectionBoundaryPathRef.current.dirty = true;
    // Synchronously rebuild chains so the ant loop reflects the grown/shrunk selection.
    if (selectionMaskRef.current)
      rebuildChainsNowRef.current(selectionMaskRef.current);

    const afterSnap = snapshotSelection();
    pushHistory({
      type: "selection",
      before: selectionBeforeRef.current ?? afterSnap,
      after: afterSnap,
    });
    selectionBeforeRef.current = null;

    // If a transform is currently active, update the bounding box to match the new mask
    if (transformActiveRef.current) {
      const newBounds = computeMaskBounds(mc);
      if (newBounds) {
        moveFloatOriginBoundsRef.current = newBounds;
        xfStateRef.current = {
          ...newBounds,
          rotation: xfStateRef.current?.rotation ?? 0,
        };
      }
    }
    scheduleComposite();
  };

  // ── Cursor system hook ────────────────────────────────────────────────────
  const {
    cursorType,
    cursorCenter,
    setCursorType,
    setCursorCenter,
    softwareCursorRef,
    updateBrushCursorRef,
    updateEyedropperCursorRef,
    cursorBuildingRef,
    drawBrushTipOverlay,
    getCursorStyle,
    sampleEyedropperColor,
    updateTransformCursorForHandle,
  } = useCursorSystem({
    activeTool,
    color,
    brushSettings,
    liquifySize,
    zoomLocked,
    rotateLocked,
    panLocked,
    containerRef,
    pointerScreenPosRef,
    isBrushSizeAdjustingRef,
    isPanningRef,
    spaceDownRef,
    panLockedRef,
    zKeyDownRef,
    zoomLockedRef,
    rKeyDownRef,
    rotateLockedRef,
    lassoModeRef,
    liquifySizeRef,
    brushSizesRef,
    viewTransformRef,
    eyedropperHoverColorRef,
    layerCanvasesRef,
    selectedLayerIdsRef,
    activeLayerIdRef,
    eyedropperSampleSourceRef,
    eyedropperSampleSizeRef,
    displayCanvasRef,
  });

  // Stable ref for compositeWithStrokePreview (used from RAF callbacks)
  const compositeWithStrokePreviewRef = useRef<
    (
      opacity: number,
      tool: Tool,
      dirty?: { minX: number; minY: number; maxX: number; maxY: number },
    ) => void
  >(() => {});
  useEffect(() => {
    compositeWithStrokePreviewRef.current = (
      opacity: number,
      tool: Tool,
      dirty?: { minX: number; minY: number; maxX: number; maxY: number },
    ) => compositeWithStrokePreview(opacity, tool, dirty);
  }, [compositeWithStrokePreview]);

  // ---- Layer system hook ----
  const {
    handleAddLayer,
    handleDeleteLayer,
    handleToggleVisible,
    handleRenameLayer,
    handleToggleAlphaLock,
    handleSetOpacity,
    handleSetOpacityLive,
    handleSetOpacityCommit,
    handleMergeLayers,
    handleMergeLayersRef,
    handleToggleClippingMask,
    handleToggleClippingMaskRef,
    handleReorderLayers,
    handleSetLayerBlendMode,
    handleCreateGroup,
    handleDeleteGroup,
    // Group UI handlers — wired to LayersPanel tree UI in upcoming task
    handleToggleGroupCollapse: _handleToggleGroupCollapse,
    handleRenameGroup: _handleRenameGroup,
    handleSetGroupOpacity: _handleSetGroupOpacity,
    handleSetGroupOpacityLive: _handleSetGroupOpacityLive,
    handleSetGroupOpacityCommit: _handleSetGroupOpacityCommit,
    handleToggleGroupVisible: _handleToggleGroupVisible,
    handleReorderTree: _handleReorderTree,
    handleReorderTreeSilent: _handleReorderTreeSilent,
    handleReorderLayersSilent: _handleReorderLayersSilent,
    handleCommitReorderHistory: _handleCommitReorderHistory,
    selectedLayerIds,
    setSelectedLayerIds,
    handleToggleLayerSelection: _handleToggleLayerSelection,
    applyLayerEntry,
    undoLayerEntry,
  } = useLayerSystem({
    layers,
    setLayers,
    setActiveLayerId,
    composite,
    setUndoCount,
    newLayerFn: newLayer,
    canvasWidth: canvasWidth,
    canvasHeight: canvasHeight,
    activeLayerIdRef,
    layerCanvasesRef,
    undoStackRef,
    redoStackRef,
    transformActiveRef,
    isDraggingFloatRef,
    selectionActionsRef,
    setLayerThumbnails,
    markLayerBitmapDirty,
    // Pass the ref so handleToggleLayerSelection can keep it in sync synchronously.
    // This ensures extractFloat always reads the correct selection even when called
    // in the same event-loop tick as a layer-selection click.
    selectedLayerIdsRef,
    getOrCreateLayerCanvas,
  });

  // selectedLayerIdsRef is also updated synchronously inside handleToggleLayerSelection,
  // but we keep this effect as a fallback for any other setSelectedLayerIds call sites
  // (layer add, group create, undo/redo, etc.) that don't go through the toggle handler.
  useEffect(() => {
    selectedLayerIdsRef.current = selectedLayerIds;
  }, [selectedLayerIds]);
  // Keep applyLayerEntryRef / undoLayerEntryRef in sync so useHistory delegates
  // pure layer-state undo/redo to useLayerSystem without prop-ordering issues.
  useEffect(() => {
    applyLayerEntryRef.current = applyLayerEntry;
  }, [applyLayerEntry]);
  useEffect(() => {
    undoLayerEntryRef.current = undoLayerEntry;
  }, [undoLayerEntry]);

  // ── usePaintingCanvasEvents: wires all keyboard/wheel/touch/pointer events ─
  // canvasEventCallbacksRef is updated every render so event handlers always
  // call the latest callbacks without stale-closure issues.

  const { handleToolChange } = useToolSwitchSystem({
    cancelInProgressSelectionRef,
    activeToolRef,
    isRotatingRef,
    rotateLockedRef,
    updateBrushCursorRef,
    transformActiveRef,
    selectionActionsRef,
    lastToolBeforeTransformRef,
    selectionBoundaryPathRef,
    selectionActiveRef,
    prevToolRef,
    layersRef,
    lastPaintToolRef2,
    lastPaintLayerIdRef,
    activeLayerIdRef,
    activeTool,
    activeLayerId,
    setActiveTool,
    setZoomLocked,
    setRotateLocked,
    setPanLocked,
    setActiveSubpanel,
    setActiveLayerId,
    handleAdjustmentsToggle,
    collapseRulerHistory,
  });

  const canvasEventCallbacksRef = useRef<PaintingCanvasEventsCallbacks>(
    {} as PaintingCanvasEventsCallbacks,
  );
  canvasEventCallbacksRef.current = {
    handleUndo: handleUndoWithRulerToolSwitch,
    handleRedo,
    pasteFloat: (img: HTMLImageElement) => {
      const layerId = activeLayerIdRef.current;
      const lc = layerCanvasesRef.current.get(layerId);
      if (!lc) return;
      const layerCtx = lc.getContext("2d", {
        willReadFrequently: !_isIPadRef.current,
      });
      if (!layerCtx) return;
      // Snapshot BEFORE any changes — the layer content is preserved intact
      const snapshot = layerCtx.getImageData(0, 0, lc.width, lc.height);
      const cw = canvasWidthRef.current;
      const ch = canvasHeightRef.current;
      const imgW = img.naturalWidth;
      const imgH = img.naturalHeight;
      const drawX = Math.round((cw - imgW) / 2);
      const drawY = Math.round((ch - imgH) / 2);
      // Float canvas contains only the pasted image — layer is NOT cleared
      const fc = document.createElement("canvas");
      fc.width = cw;
      fc.height = ch;
      const fcCtx = fc.getContext("2d", {
        willReadFrequently: !_isIPadRef.current,
      })!;
      fcCtx.drawImage(img, drawX, drawY, imgW, imgH);
      // origCopy for scale/rotate reset
      const origCopy = document.createElement("canvas");
      origCopy.width = cw;
      origCopy.height = ch;
      origCopy
        .getContext("2d", { willReadFrequently: !_isIPadRef.current })!
        .drawImage(fc, 0, 0);
      // Wire up all transform refs
      transformPreSnapshotRef.current = snapshot;
      // Pre-commit snapshot is the current layer state (paste composites on top)
      transformPreCommitSnapshotRef.current = snapshot;
      moveFloatCanvasRef.current = fc;
      moveFloatOriginBoundsRef.current = {
        x: drawX,
        y: drawY,
        w: imgW,
        h: imgH,
      };
      transformOrigFloatCanvasRef.current = origCopy;
      xfStateRef.current = {
        x: drawX,
        y: drawY,
        w: imgW,
        h: imgH,
        rotation: 0,
      };
      lastToolBeforeTransformRef.current = activeTool as Tool;
      transformActiveRef.current = true;
      isDraggingFloatRef.current = true;
      setIsTransformActive(true);
      setIsDraggingFloatState(true);
      setActiveTool("move");
      setActiveSubpanel(null);
      composite();
      markCanvasDirty(layerId);
    },
    handleSaveFile,
    handleSilentSave,
    handleAddLayer,
    handleDeleteLayer,
    handleToggleVisible,
    handleToggleAlphaLock,
    handleMergeLayersRef,
    handleToggleClippingMaskRef,
    handleCreateGroup,
    handleClear,
    handleGrowShrink,
    collapseRulerHistory,
    scheduleRulerOverlay,
    composite,
    drawBrushTipOverlay,
    setActiveTool,
    setActiveSubpanel,
    setActiveLayerId,
    setLayers,
    // setLayerTree: no-op stub — flat array is the single source of truth
    setLayerTree: () => {},
    setViewTransform,
    setIsFlipped,
    setBrushSizes,
    setBrushSettings,
    setBrushBlendMode,
    setColor,
    setLiquifySize,
    setLiquifyStrength,
    setZoomLocked,
    setRotateLocked,
    setPanLocked,
    setSelectionActive,
    setRecentColors,
    setCropRectVersion,
    handleToolChange,
    // Compositing / stroke helpers
    scheduleComposite,
    compositeWithStrokePreview,
    // Wrap buildStrokeCanvases to set strokeActiveRef at stroke start.
    // This must fire before any stamp or compositeWithStrokePreview call so
    // the layer canvas write guard is active for the full duration of the stroke.
    buildStrokeCanvases: (layerId: string) => {
      strokeActiveRef.current = true;
      buildStrokeCanvases(layerId);
    },
    flushStrokeBuffer,
    strokeCommitDirty: _strokeCommitDirty,
    getActiveSize,
    applyTransformToDOM,
    // History / selection
    pushHistory,
    snapshotSelection,
    clearSelection,
    rasterizeSelectionMask,
    // Stroke engine
    stampWebGL,
    stampDot,
    renderBrushSegmentAlongPoints,
    renderSmearAlongPoints,
    initSmudgeBuffer,
    getSnapPosition,
    // Fill system
    handleFillPointerDown,
    handleFillPointerMove,
    handleFillPointerUp,
    applyLassoFill,
    // Cursor
    sampleEyedropperColor,
    updateEyedropperCursorRef,
    updateTransformCursorForHandle,
    // Ruler handlers bundle
    rulerHandlers: {
      handleLineRulerPointerDown: lineRuler.handleLineRulerPointerDown,
      handleLineRulerPointerMove: lineRuler.handleLineRulerPointerMove,
      handleLineRulerPointerUp: lineRuler.handleLineRulerPointerUp,
      isLineRulerDragging: lineRuler.isLineRulerDragging,
      handle1ptRulerPointerDown: ruler1pt2pt.handle1ptRulerPointerDown,
      handle2ptRulerPointerDown: ruler1pt2pt.handle2ptRulerPointerDown,
      handle1pt2ptRulerPointerMove: ruler1pt2pt.handle1pt2ptRulerPointerMove,
      handle1pt2ptRulerPointerUp: ruler1pt2pt.handle1pt2ptRulerPointerUp,
      is1pt2ptRulerDragging: ruler1pt2pt.is1pt2ptRulerDragging,
      handle3ptRulerPointerDown: ruler3pt5pt.handle3ptRulerPointerDown,
      handle5ptRulerPointerDown: ruler3pt5pt.handle5ptRulerPointerDown,
      handle3ptExclusivePointerMove: ruler3pt5pt.handle3ptExclusivePointerMove,
      handle5ptRulerPointerMove: ruler3pt5pt.handle5ptRulerPointerMove,
      handle3pt5ptRulerPointerUp: ruler3pt5pt.handle3pt5ptRulerPointerUp,
      is3ptExclusiveDragging: ruler3pt5pt.is3ptExclusiveDragging,
      is5ptDragging: ruler3pt5pt.is5ptDragging,
      handleOvalRulerPointerDown: ellipseGridRuler.handleOvalRulerPointerDown,
      handleGridRulerPointerDown: ellipseGridRuler.handleGridRulerPointerDown,
      handleOvalRulerPointerMove: ellipseGridRuler.handleOvalRulerPointerMove,
      handleGridRulerPointerMove: ellipseGridRuler.handleGridRulerPointerMove,
      handleEllipseGridRulerPointerUp:
        ellipseGridRuler.handleEllipseGridRulerPointerUp,
      isOvalDragging: ellipseGridRuler.isOvalDragging,
      isGridDragging: ellipseGridRuler.isGridDragging,
    },
  };

  const { shiftHeld } = usePaintingCanvasEvents({
    callbacksRef: canvasEventCallbacksRef,
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
    panStartRef,
    panOriginRef,
    isRotatingRef,
    rotOriginRef,
    rotAngleOriginRef,
    rotCenterRef,
    isZoomDraggingRef,
    zoomDragStartXRef,
    zoomDragOriginRef,
    zoomDragCursorStartRef,
    zoomDragPanOriginRef,
    rotDragCursorRef,
    rotDragCanvasPointRef,
    rotDragPanOriginRef,
    applyTransformToDOMRef,
    wheelCommitTimerRef,
    zoomLockedRef,
    rotateLockedRef,
    panLockedRef,
    altEyedropperActiveRef,
    altSpaceModeRef,
    prevToolRef,
    shiftHeldRef,
    isBrushSizeAdjustingRef,
    brushSizeAdjustStartXRef,
    brushSizeAdjustOriginRef,
    brushSizeOverlayRef,
    brushSizeOverlayStartPosRef,
    penDownCountRef,
    currentPointerTypeRef,
    pointerScreenPosRef,
    eyedropperIsPressedRef,
    updateBrushCursorRef,
    activeToolRef,
    hotkeysRef,
    isDrawingRef,
    isCommittingRef,
    transformActiveRef,
    isDraggingFloatRef,
    selectionActiveRef,
    isDrawingSelectionRef,
    selectionPolyClosingRef,
    cancelInProgressSelectionRef,
    commitInProgressLassoRef,
    rebuildChainsNowRef,
    selectionMaskRef,
    selectionGeometryRef,
    selectionBoundaryPathRef,
    selectionShapesRef,
    selectionActionsRef,
    moveFloatOriginBoundsRef,
    xfStateRef,
    transformHandleRef,
    transformPreSnapshotRef,
    transformPreCommitSnapshotRef,
    transformOrigFloatCanvasRef,
    lastToolBeforeTransformRef,
    isCropActiveRef,
    cropRectRef,
    cropPrevViewRef,
    cropPrevToolRef,
    layerCanvasesRef,
    activeLayerIdRef,
    layersRef,
    canvasWidthRef,
    canvasHeightRef,
    lastPosRef,
    strokeStartSnapshotRef,
    strokeSnapLayerRef,
    tailRafIdRef,
    fileLoadInputRef,
    liquifySizeRef,
    liquifyStrengthRef,
    lastPaintLayerIdRef,
    lastPaintToolRef2,
    opacityFirstDigitRef,
    opacityTimerRef,
    isIPadRef: _isIPadRef,
    toolSizesRef,
    toolOpacitiesRef,
    brushSizesRef,
    lastSingle5ptFamilyRef: ruler3pt5pt.lastSingle5ptFamilyRef,
    lastSingle2ptFamilyRef: ruler1pt2pt.lastSingle2ptFamilyRef,
    lastSingle3ptFamilyRef: ruler3pt5pt.lastSingle3ptFamilyRef,
    undoStackRef,
    redoStackRef,
    presetsRef,
    activeRulerPresetTypeRef,
    fillModeRef,
    fillSettingsRef,
    // Lasso / selection drawing refs
    lassoModeRef,
    lassoIsDraggingRef,
    lassoHasPolyPointsRef,
    lassoStrokeStartRef,
    lassoLastTapTimeRef,
    lassoLastTapPosRef,
    lassoFreeLastPtRef,
    selectionDraftBoundsRef,
    selectionDraftPointsRef,
    selectionDraftCursorRef,
    selectionBeforeRef,
    marchingAntsRafRef,
    drawAntsRef,
    wandToleranceRef,
    wandContiguousRef,
    wandGrowShrinkRef,
    // Transform / float refs
    moveFloatCanvasRef,
    floatDragStartRef,
    transformActionsRef,
    // Fill refs
    isGradientDraggingRef,
    isLassoFillDrawingRef,
    // Crop ref
    cropDragRef,
    // Stroke engine refs
    strokeSnapshotPendingRef,
    strokeDirtyRectRef,
    strokeStampsPlacedRef,
    strokeSnapOriginRef,
    strokeSnapDirRef,
    strokeHvAxisRef,
    strokeHvPivotRef,
    gridSnapLineRef,
    strokeWarmRawDistRef,
    smoothedPressureRef,
    prevPrimaryPressureRef,
    rawStylusPosRef,
    stabBrushPosRef,
    smoothBufferRef,
    elasticPosRef,
    elasticVelRef,
    elasticRawPrevRef,
    lastCompositeOpacityRef,
    strokeCommitOpacityRef,
    flushDisplayCapRef,
    strokePreviewRafRef,
    strokePreviewPendingWorkRef,
    universalPressureCurveRef,
    brushSettingsRef,
    brushOpacityRef,
    colorRef,
    colorFillStyleRef,
    webglBrushRef,
    strokeBufferRef,
    tailDoCommitRef,
    smearRafRef,
    smearDirtyRef,
    distAccumRef,
    // Layer tree
    layerTreeRef,
    selectedLayerIdsRef,
    // Liquify refs
    liquifyBeforeSnapshotRef,
    liquifyMultiBeforeSnapshotsRef,
    liquifyHoldIntervalRef,
    liquifyScopeRef,
    // Thumbnail debounce
    thumbDebounceRef,
    thumbDebounceLcRef,
    thumbDebounceLayerIdRef,
    // Compositing
    compositeWithStrokePreviewRef,
    // Eyedropper
    eyedropperHoverColorRef,
    // Cursor building guard
    cursorBuildingRef,
    // Ruler edit history depth
    rulerEditHistoryDepthRef,
    // Brush blend mode (for toggleClearBlendMode hotkey)
    brushBlendModeRef,
    prevBrushBlendModeRef,
    // Spring-loaded tool switching
    springLoadedPreviousToolRef,
    springLoadedKeyRef,
    pendingSpringRestoreRef,
    holdTimerRef,
    pendingSpringKeyRef,
    pendingSpringToolRef,
  });

  const handleZoomLockToggle = useCallback(() => {
    setZoomLocked((prev) => {
      if (!prev) {
        setRotateLocked(false);
        setPanLocked(false);
      }
      return !prev;
    });
  }, []);

  const handleRotateLockToggle = useCallback(() => {
    setRotateLocked((prev) => {
      if (!prev) {
        setZoomLocked(false);
        setPanLocked(false);
      }
      return !prev;
    });
  }, []);

  const handlePanLockToggle = useCallback(() => {
    setPanLocked((prev) => {
      if (!prev) {
        setZoomLocked(false);
        setRotateLocked(false);
      }
      return !prev;
    });
  }, []);

  const handleFlipToggle = useCallback(() => {
    setIsFlipped((f) => !f);
  }, []);

  const handleAdminOpen = useCallback(() => {
    setSettingsOpen(true);
  }, []);

  const handleToolReselect = useCallback((tool: Tool) => {
    // Always keep subpanel open — no toggling
    if (tool === "brush" || tool === "smudge" || tool === "eraser") {
      setActiveSubpanel(tool as "brush" | "smudge" | "eraser");
    } else if (tool === "lasso") {
      setActiveSubpanel("lasso");
    } else if (tool === "fill") {
      setActiveSubpanel("fill");
    } else if (tool === "ruler") {
      setActiveSubpanel("ruler");
    } else if (tool === "eyedropper") {
      setActiveSubpanel("eyedropper" as never);
    }
  }, []);

  // Wraps handleToolChange for panel/toolbar clicks. Clears any active spring-load
  // so that releasing the spring key after a manual tool click does nothing.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refs are stable
  const handleToolChangeFromPanel = useCallback(
    (tool: Tool) => {
      // Cancel any pending hold timer before it fires
      if (holdTimerRef.current !== null) {
        clearTimeout(holdTimerRef.current);
        holdTimerRef.current = null;
      }
      springLoadedPreviousToolRef.current = null;
      springLoadedKeyRef.current = null;
      pendingSpringRestoreRef.current = false;
      pendingSpringKeyRef.current = null;
      pendingSpringToolRef.current = null;
      handleToolChange(tool);
    },
    [handleToolChange],
  );

  const { panX, panY, zoom, rotation } = viewTransform;
  const isDefaultTransform =
    panX === 0 && panY === 0 && zoom === 1 && rotation === 0;

  // Current tool's size for BottomBar
  const currentBrushSize =
    activeTool === "eraser" ? brushSizes.eraser : brushSizes.brush;

  // ---- CanvasArea callbacks ----
  // handleCropHandlePointerDown is now from useCropSystem above.

  // biome-ignore lint/correctness/useExhaustiveDependencies: refs are stable
  const handleCanvasDoubleClick = useCallback(
    (_evDbl: React.MouseEvent<HTMLCanvasElement>) => {
      if (
        activeToolRef.current === "lasso" &&
        isDrawingSelectionRef.current &&
        lassoModeRef.current !== "rect" &&
        lassoModeRef.current !== "ellipse" &&
        lassoModeRef.current !== "wand"
      ) {
        const pts = selectionDraftPointsRef.current;
        if (pts.length > 2) {
          selectionGeometryRef.current = {
            type: "free",
            points: [...pts],
          };
          selectionShapesRef.current = [
            { type: "free" as LassoMode, points: [...pts] },
          ];
          selectionBoundaryPathRef.current.dirty = true;
          rasterizeSelectionMask();
          setSelectionActive(true);
          const afterSnap = snapshotSelection();
          pushHistory({
            type: "selection",
            before: selectionBeforeRef.current ?? afterSnap,
            after: afterSnap,
          });
          selectionBeforeRef.current = null;
        } else {
          clearSelection();
        }
        selectionDraftPointsRef.current = [];
        selectionDraftCursorRef.current = null;
        isDrawingSelectionRef.current = false;
        lassoHasPolyPointsRef.current = false;
        lassoIsDraggingRef.current = false;
        lassoStrokeStartRef.current = null;
      }
    },
    [],
  );

  // Preset callbacks (handleSelectPreset, handleUpdatePreset, handleAddPreset,
  // handleDeletePreset, handleActivatePreset, handleReorderPresets,
  // handleSaveCurrentToPreset) are now provided by usePresetSystem above.

  const handleSelectLassoMode = useCallback((mode: LassoMode) => {
    setLassoMode(mode);
  }, []);

  const handleSelectFillMode = useCallback(
    (mode: FillMode) => {
      updateFillMode(mode);
    },
    [updateFillMode],
  );

  const handleFillSettingsChange = useCallback(
    (settings: FillSettings) => {
      setFillSettings(settings);
    },
    [setFillSettings],
  );

  // handleCanvasBrushSizeChange, handleCanvasBrushOpacityChange, handleCanvasBrushFlowChange
  // are now provided by usePresetSystem above.

  // Ruler UI handlers are now provided by useRulerUIHandlers below.
  const {
    handleRulerPresetTypeChangeForCanvas,
    handleRulerColorChangeForCanvas,
    handleVp1ColorChangeForCanvas,
    handleVp2ColorChangeForCanvas,
    handleVp3ColorChangeForCanvas,
    handleRulerWarmupDistChangeForCanvas,
    handleLineSnapModeChangeForCanvas,
    handleLockFocalLengthChangeForCanvas,
    handleOvalSnapModeChangeForCanvas,
    handleFivePtEnableCenterChangeForCanvas,
    handleFivePtEnableLRChangeForCanvas,
    handleFivePtEnableUDChangeForCanvas,
    handleGridResetForCanvas,
    handleGridModeChangeForCanvas,
    handleGridVertSegmentsChangeForCanvas,
    handleGridHorizSegmentsChangeForCanvas,
    handleFivePtCenterColorChangeForCanvas,
    handleFivePtLRColorChangeForCanvas,
    handleFivePtUDColorChangeForCanvas,
    handleSelectionOverlayCanvasRef,
    handleRulerCanvasRef,
  } = useRulerUIHandlers({
    setLayers,
    layersRef,
    setActiveRulerPresetType,
    activeRulerPresetTypeRef,
    canvasWidthRef,
    canvasHeightRef,
    selectionOverlayCanvasRef,
    rulerCanvasRef,
    scheduleRulerOverlay,
  });

  return (
    <PaintingContextProvider
      canvasWidth={canvasWidth}
      canvasHeight={canvasHeight}
      canvasWidthRef={canvasWidthRef}
      canvasHeightRef={canvasHeightRef}
      layerCanvasesRef={layerCanvasesRef}
      activeLayerIdRef={activeLayerIdRef}
      layersRef={layersRef}
      pendingLayerPixelsRef={pendingLayerPixelsRef}
      undoStackRef={undoStackRef}
      redoStackRef={redoStackRef}
      selectionActiveRef={selectionActiveRef}
      selectionMaskRef={selectionMaskRef}
      selectionGeometryRef={selectionGeometryRef}
      selectionBoundaryPathRef={selectionBoundaryPathRef}
      selectionShapesRef={selectionShapesRef}
      selectionActionsRef={selectionActionsRef}
      selectionOverlayCanvasRef={selectionOverlayCanvasRef}
      transformActiveRef={transformActiveRef}
      isDraggingFloatRef={isDraggingFloatRef}
      moveFloatCanvasRef={moveFloatCanvasRef}
      xfStateRef={xfStateRef}
      compositeRef={compositeRef}
      updateNavigatorCanvasRef={updateNavigatorCanvasRef}
      rebuildChainsNowRef={rebuildChainsNowRef}
      setLayerThumbnails={setLayerThumbnails}
      setActiveTool={setActiveTool}
      setActiveLayerId={setActiveLayerId}
      setLayers={setLayers}
      setUndoCount={setUndoCount}
      setRedoCount={setRedoCount}
      markLayerBitmapDirty={markLayerBitmapDirty}
      invalidateAllLayerBitmaps={invalidateAllLayerBitmaps}
      selectedLayerIdsRef={selectedLayerIdsRef}
      setSelectedLayerIds={setSelectedLayerIds}
    >
      <div
        className="flex flex-col bg-background overflow-hidden select-none"
        style={{
          height: "100dvh",
          width: "100dvw",
          paddingLeft: "env(safe-area-inset-left)",
          paddingRight: "env(safe-area-inset-right)",
          paddingTop: "env(safe-area-inset-top)",
        }}
      >
        {/* WebGL1 fallback warning banner */}
        <WebGL1WarningBanner
          visible={webGLFallbackWarning}
          onDismiss={() => setWebGLFallbackWarning(false)}
        />
        <div className="flex flex-1 overflow-hidden">
          <ToolbarArea
            activeTool={activeTool}
            activeSubpanel={activeSubpanel}
            activeLassoMode={lassoMode}
            onToolChange={handleToolChangeFromPanel}
            onToolReselect={handleToolReselect}
            zoomLocked={zoomLocked}
            rotateLocked={rotateLocked}
            panLocked={panLocked}
            isFlipped={isFlipped}
            onZoomLockToggle={handleZoomLockToggle}
            onRotateLockToggle={handleRotateLockToggle}
            onPanLockToggle={handlePanLockToggle}
            onFlipToggle={handleFlipToggle}
            onAdminOpen={handleAdminOpen}
            onSaveFile={handleSaveFile}
            onOpenFile={() => fileLoadInputRef.current?.click()}
            hasUnsavedChanges={hasUnsavedChanges}
            isMobile={isMobile}
            leftHanded={leftHanded}
            fileLoadInputRef={fileLoadInputRef}
            onFileLoad={openFileAsDocument}
          />
          {/* Left sidebar: Color Panel + Tool Presets — desktop only; mobile uses floating panels */}
          {!isMobile && (
            <LeftSidebarArea
              leftSidebarCollapsed={leftSidebarCollapsed}
              setLeftSidebarCollapsed={setLeftSidebarCollapsed}
              leftSidebarWidth={leftSidebarWidth}
              setLeftSidebarWidth={setLeftSidebarWidth}
              activeTool={activeTool}
              color={color}
              setColor={setColor}
              recentColors={recentColors}
              onRecentColorClick={handleRecentColorClick}
              activeSubpanel={activeSubpanel}
              setActiveSubpanel={setActiveSubpanel}
              presets={presets}
              activePresetIds={activePresetIds}
              brushSettings={brushSettings}
              currentBrushSize={currentBrushSize}
              onSelectPreset={handleSelectPreset}
              onUpdatePreset={handleUpdatePreset}
              onAddPreset={handleAddPreset}
              onDeletePreset={handleDeletePreset}
              onActivatePreset={handleActivatePreset}
              onReorderPresets={handleReorderPresets}
              onSaveCurrentToPreset={handleSaveCurrentToPreset}
              lassoMode={lassoMode}
              onSelectLassoMode={handleSelectLassoMode}
              wandTolerance={wandTolerance}
              wandContiguous={wandContiguous}
              wandGrowShrink={wandGrowShrink}
              onWandToleranceChange={setWandTolerance}
              onWandContiguousChange={setWandContiguous}
              onWandGrowShrinkChange={setWandGrowShrink}
              activeLayerId={activeLayerId}
              layers={layers}
              layerCanvasesRef={layerCanvasesRef}
              selectionMaskRef={selectionMaskRef}
              selectionActive={selectionActive}
              onAdjustmentsPushUndo={onAdjustmentsPushUndo}
              onAdjustmentsPreview={onAdjustmentsPreview}
              onAdjustmentsComposite={onAdjustmentsComposite}
              onAdjustmentsThumbnailUpdate={onAdjustmentsThumbnailUpdate}
              onAdjustmentsMarkLayerDirty={onAdjustmentsMarkLayerDirty}
              fillMode={fillMode}
              fillSettings={fillSettings}
              onSelectFillMode={handleSelectFillMode}
              onFillSettingsChange={handleFillSettingsChange}
              activeRulerPresetType={activeRulerPresetType}
              onRulerPresetTypeChange={handleRulerPresetTypeChangeForCanvas}
              onRulerColorChange={handleRulerColorChangeForCanvas}
              onVp1ColorChange={handleVp1ColorChangeForCanvas}
              onVp2ColorChange={handleVp2ColorChangeForCanvas}
              onVp3ColorChange={handleVp3ColorChangeForCanvas}
              onRulerWarmupDistChange={handleRulerWarmupDistChangeForCanvas}
              onLineSnapModeChange={handleLineSnapModeChangeForCanvas}
              onLockFocalLengthChange={handleLockFocalLengthChangeForCanvas}
              onOvalSnapModeChange={handleOvalSnapModeChangeForCanvas}
              onGridModeChange={handleGridModeChangeForCanvas}
              onGridVertSegmentsChange={handleGridVertSegmentsChangeForCanvas}
              onGridHorizSegmentsChange={handleGridHorizSegmentsChangeForCanvas}
              onFivePtCenterColorChange={handleFivePtCenterColorChangeForCanvas}
              onFivePtLRColorChange={handleFivePtLRColorChangeForCanvas}
              onFivePtUDColorChange={handleFivePtUDColorChangeForCanvas}
              onFivePtEnableCenterChange={
                handleFivePtEnableCenterChangeForCanvas
              }
              onFivePtEnableLRChange={handleFivePtEnableLRChangeForCanvas}
              onFivePtEnableUDChange={handleFivePtEnableUDChangeForCanvas}
              onGridReset={handleGridResetForCanvas}
              eyedropperSampleSource={eyedropperSampleSource}
              setEyedropperSampleSource={setEyedropperSampleSource}
              eyedropperSampleSize={eyedropperSampleSize}
              setEyedropperSampleSize={setEyedropperSampleSize}
              onEnterBrushTipEditor={enterBrushTipEditor}
              brushTipEditorActive={brushTipEditorMode?.active === true}
              grayLevel={brushTipEditorMode?.grayLevel ?? 0}
              onGrayLevelChange={(gv) => {
                setBrushTipEditorMode((prev) =>
                  prev ? { ...prev, grayLevel: gv } : prev,
                );
                // Map grayscale 0-255 → HSVA: h=0, s=0, v=gv/255
                setColor({ h: 0, s: 0, v: gv / 255, a: 1 });
              }}
            />
          )}{" "}
          {/* end mobile/desktop conditional for left sidebar */}
          {/* Canvas + top bar */}
          <div className="flex flex-col flex-1 min-w-0">
            <BottomBar
              brushSize={currentBrushSize}
              brushOpacity={color.a}
              brushFlow={brushSettings.flow ?? 1}
              brushBlendMode={brushBlendMode}
              activeTool={activeTool}
              onBrushSizeChange={(v) => {
                const key = activeTool === "eraser" ? "eraser" : "brush";
                setBrushSizes((prev) => ({ ...prev, [key]: v }));
                toolSizesRef.current = {
                  ...toolSizesRef.current,
                  [activeTool]: v,
                };
              }}
              onBrushOpacityChange={(v) => {
                setColor((prev) => ({ ...prev, a: v }));
                toolOpacitiesRef.current = {
                  ...toolOpacitiesRef.current,
                  [activeTool]: v,
                };
              }}
              onBrushFlowChange={(v) => {
                setBrushSettings((prev) => ({ ...prev, flow: v }));
                toolFlowsRef.current = {
                  ...toolFlowsRef.current,
                  [activeTool]: v,
                };
              }}
              onBrushBlendModeChange={setBrushBlendMode}
              smudgeStrength={brushSettings.smearStrength ?? 0.8}
              onSmudgeStrengthChange={(v) =>
                setBrushSettings((prev) => ({ ...prev, smearStrength: v }))
              }
              canUndo={
                undoCount > 0 && !isTransformActive && !isDrawingRef.current
              }
              canRedo={
                redoCount > 0 && !isTransformActive && !isDrawingRef.current
              }
              onUndo={() => {
                if (isDrawingRef.current || isCommittingRef.current) return;
                if (transformActiveRef.current) {
                  toast.warning(
                    "Commit or cancel the transform before undoing",
                  );
                  return;
                }
                handleUndoWithRulerToolSwitch();
              }}
              onRedo={() => {
                if (isDrawingRef.current || isCommittingRef.current) return;
                if (transformActiveRef.current) {
                  toast.warning(
                    "Commit or cancel the transform before redoing",
                  );
                  return;
                }
                handleRedo();
              }}
              onClear={handleClear}
              onExport={handleExport}
              onExportPSD={handleExportPSD}
              isPsdExporting={isPsdExporting}
              isPngExporting={isPngExporting}
              onSave={handleSave}
              eyedropperSampleSource={eyedropperSampleSource}
              eyedropperSampleSize={eyedropperSampleSize}
              onEyedropperSampleSourceChange={setEyedropperSampleSource}
              onEyedropperSampleSizeChange={setEyedropperSampleSize}
              isCropActive={isCropActive}
              onCropConfirm={commitCrop}
              onCropCancel={handleCropCancel}
              hasSelection={selectionActive}
              isTransformActive={isTransformActive}
              onGrowSelection={() => handleGrowShrink(1)}
              onShrinkSelection={() => handleGrowShrink(-1)}
              onClearSelection={() =>
                selectionActionsRef.current.deleteSelection()
              }
              onCopyToNewLayer={() =>
                selectionActionsRef.current.cutOrCopyToLayer(false)
              }
              onCutToNewLayer={() =>
                selectionActionsRef.current.cutOrCopyToLayer(true)
              }
              onDeselect={() => {
                selectionActionsRef.current.commitFloat();
                selectionActionsRef.current.clearSelection();
              }}
              onTransformCommit={() =>
                selectionActionsRef.current.commitFloat({ keepSelection: true })
              }
              onTransformCancel={() =>
                selectionActionsRef.current.revertTransform()
              }
              onTransformReset={() =>
                selectionActionsRef.current.revertTransform()
              }
              activeRuler={layers.find((l) => l.isRuler) ?? null}
              onResetCurrentRuler={handleResetCurrentRuler}
              onClearAllRulers={handleClearAllRulers}
              onUpdateRulerLayer={(updates) => {
                setLayers((prev) =>
                  prev.map((l) => (l.isRuler ? { ...l, ...updates } : l)),
                );
                layersRef.current = layersRef.current.map((l) =>
                  l.isRuler ? { ...l, ...updates } : l,
                );
              }}
              onSetLastSingle5ptFamily={(v) => {
                ruler3pt5pt.lastSingle5ptFamilyRef.current = v;
              }}
              onSetLastSingle2ptFamily={(v) => {
                ruler1pt2pt.lastSingle2ptFamilyRef.current = v;
              }}
              onSetLastSingle3ptFamily={(v) => {
                ruler3pt5pt.lastSingle3ptFamilyRef.current = v;
              }}
              liquifySize={liquifySize}
              liquifyStrength={liquifyStrength}
              liquifyScope={liquifyScope}
              onLiquifySizeChange={setLiquifySize}
              onLiquifyStrengthChange={setLiquifyStrength}
              onLiquifyScopeChange={setLiquifyScope}
              isMobile={isMobile}
              brushTipEditorActive={brushTipEditorMode?.active === true}
            />
            {/* ── Brush Tip Editor strip ── */}
            {brushTipEditorMode?.active && (
              <div
                data-ocid="brush_tip_editor.strip"
                className="flex items-center gap-3 px-3 py-1.5 shrink-0 border-b border-border z-10"
                style={{
                  backgroundColor: "oklch(var(--toolbar))",
                  borderTop: "2px solid oklch(var(--accent))",
                }}
              >
                {/* Label */}
                <span
                  className="text-xs font-semibold tracking-wide shrink-0"
                  style={{ color: "oklch(var(--accent))" }}
                >
                  🖌 Brush Tip Editor
                </span>

                {/* Spacer */}
                <div className="flex-1" />

                {/* Cancel / Accept */}
                <button
                  type="button"
                  data-ocid="brush_tip_editor.cancel_button"
                  onClick={() => exitBrushTipEditor(false)}
                  className="text-xs px-3 py-1 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors shrink-0"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  data-ocid="brush_tip_editor.accept_button"
                  onClick={() => exitBrushTipEditor(true)}
                  className="text-xs px-3 py-1 rounded text-primary-foreground shrink-0 font-medium transition-colors"
                  style={{ backgroundColor: "oklch(var(--accent))" }}
                >
                  ✓ Accept
                </button>
              </div>
            )}
            <CanvasArea
              containerRef={containerRef}
              displayCanvasRef={displayCanvasRef}
              selectionOverlayCanvasRef={selectionOverlayCanvasRef}
              rulerCanvasRef={rulerCanvasRef}
              canvasWrapperRef={canvasWrapperRef}
              canvasWidthRef={canvasWidthRef}
              canvasHeightRef={canvasHeightRef}
              cropRectRef={cropRectRef}
              toolSizesRef={toolSizesRef}
              toolOpacitiesRef={toolOpacitiesRef}
              toolFlowsRef={toolFlowsRef}
              canvasWidth={canvasWidth}
              canvasHeight={canvasHeight}
              viewTransform={viewTransform}
              isFlipped={isFlipped}
              isDefaultTransform={isDefaultTransform}
              zoom={zoom}
              rotation={rotation}
              activeTool={activeTool}
              activeSubpanel={
                activeSubpanel as
                  | "brush"
                  | "smudge"
                  | "eraser"
                  | "lasso"
                  | "fill"
                  | "ruler"
                  | "eyedropper"
                  | "rotate"
                  | null
              }
              currentBrushSize={currentBrushSize}
              color={color}
              brushSettings={brushSettings}
              lassoMode={lassoMode}
              fillMode={fillMode}
              fillSettings={fillSettings}
              activeRulerPresetType={activeRulerPresetType}
              presets={presets}
              activePresetIds={activePresetIds}
              layers={layers}
              scheduleRulerOverlay={scheduleRulerOverlay}
              isCropActive={isCropActive}
              cropRectVersion={cropRectVersion}
              isMobile={isMobile}
              leftHanded={leftHanded}
              showMobileColorPanel={showMobileColorPanel}
              showMobilePresetsPanel={showMobilePresetsPanel}
              recentColors={recentColors}
              wandTolerance={wandTolerance}
              wandContiguous={wandContiguous}
              wandGrowShrink={wandGrowShrink}
              cursor={getCursorStyle()}
              onSetShowMobileColorPanel={setShowMobileColorPanel}
              onSetShowMobilePresetsPanel={setShowMobilePresetsPanel}
              onSetRightSidebarCollapsed={setRightSidebarCollapsed}
              onRecentColorClick={handleRecentColorClick}
              onColorChange={setColor}
              onBrushSizeChange={handleCanvasBrushSizeChange}
              onBrushOpacityChange={handleCanvasBrushOpacityChange}
              onBrushFlowChange={handleCanvasBrushFlowChange}
              liquifySize={liquifySize}
              liquifyStrength={liquifyStrength}
              onLiquifySizeChange={setLiquifySize}
              onLiquifyStrengthChange={setLiquifyStrength}
              onSelectPreset={handleSelectPreset}
              onUpdatePreset={handleUpdatePreset}
              onAddPreset={handleAddPreset}
              onDeletePreset={handleDeletePreset}
              onActivatePreset={handleActivatePreset}
              onReorderPresets={handleReorderPresets}
              onSaveCurrentToPreset={handleSaveCurrentToPreset}
              onSelectLassoMode={handleSelectLassoMode}
              onCloseMobilePresetsPanel={() => setShowMobilePresetsPanel(false)}
              onWandToleranceChange={setWandTolerance}
              onWandContiguousChange={setWandContiguous}
              onWandGrowShrinkChange={setWandGrowShrink}
              onSelectFillMode={handleSelectFillMode}
              onFillSettingsChange={handleFillSettingsChange}
              onRulerPresetTypeChange={handleRulerPresetTypeChangeForCanvas}
              onRulerColorChange={handleRulerColorChangeForCanvas}
              onVp1ColorChange={handleVp1ColorChangeForCanvas}
              onVp2ColorChange={handleVp2ColorChangeForCanvas}
              onVp3ColorChange={handleVp3ColorChangeForCanvas}
              onRulerWarmupDistChange={handleRulerWarmupDistChangeForCanvas}
              onLineSnapModeChange={handleLineSnapModeChangeForCanvas}
              onLockFocalLengthChange={handleLockFocalLengthChangeForCanvas}
              onOvalSnapModeChange={handleOvalSnapModeChangeForCanvas}
              onFivePtEnableCenterChange={
                handleFivePtEnableCenterChangeForCanvas
              }
              onFivePtEnableLRChange={handleFivePtEnableLRChangeForCanvas}
              onFivePtEnableUDChange={handleFivePtEnableUDChangeForCanvas}
              onGridReset={handleGridResetForCanvas}
              onCropHandlePointerDown={handleCropHandlePointerDown}
              onResetView={resetView}
              onCanvasDoubleClick={handleCanvasDoubleClick}
              onSelectionOverlayCanvasRef={handleSelectionOverlayCanvasRef}
              onRulerCanvasRef={handleRulerCanvasRef}
              mobileAdjustmentsPanel={
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
              }
            />
          </div>
          {/* Right panel: Navigator + Layers */}
          {/* On mobile: hidden when collapsed (button in canvas overlay handles toggle) */}
          {/* Hidden entirely while brush tip editor is active — canvas expands to fill the space */}
          {(!isMobile || !rightSidebarCollapsed) &&
            !brushTipEditorMode?.active && (
              <RightSidebarArea
                isMobile={isMobile}
                rightSidebarCollapsed={rightSidebarCollapsed}
                rightPanelWidth={rightPanelWidth}
                setRightPanelWidth={setRightPanelWidth}
                setRightSidebarCollapsed={setRightSidebarCollapsed}
                viewTransform={viewTransform}
                onSetTransform={(t) => {
                  setViewTransform(t);
                  applyTransformToDOM(t);
                }}
                canvasWidth={canvasWidth}
                canvasHeight={canvasHeight}
                thumbnailCanvas={navigatorCanvasRef.current}
                thumbnailVersion={navigatorVersion}
                isFlipped={isFlipped}
                layers={layers}
                layerTree={[]}
                activeLayerId={activeLayerId}
                selectedLayerIds={selectedLayerIds}
                layerThumbnails={layerThumbnails}
                shiftHeld={shiftHeld}
                onSetActive={(id) => {
                  const clickedLayer = layersRef.current.find(
                    (l) => l.id === id,
                  );

                  // If a move/transform is in progress, commit it to history before switching layers
                  const wasTransformActive =
                    transformActiveRef.current || isDraggingFloatRef.current;
                  if (wasTransformActive && !clickedLayer?.isRuler) {
                    selectionActionsRef.current.commitFloat({
                      keepSelection: false,
                    });
                  }

                  if (clickedLayer?.isRuler) {
                    // Switch to ruler tool when clicking a ruler layer
                    lastPaintToolRef2.current =
                      activeToolRef.current !== "ruler"
                        ? activeToolRef.current
                        : lastPaintToolRef2.current;
                    lastPaintLayerIdRef.current =
                      activeLayerIdRef.current !== id
                        ? activeLayerIdRef.current
                        : lastPaintLayerIdRef.current;
                    // Sync active preset type from the ruler layer
                    const presetType = (clickedLayer.rulerPresetType ??
                      "perspective-1pt") as RulerPresetType;
                    setActiveRulerPresetType(presetType);
                    activeRulerPresetTypeRef.current = presetType;
                    setActiveTool("ruler");
                    setActiveSubpanel("ruler");
                  } else if (activeToolRef.current === "ruler") {
                    // Switching away from ruler layer: restore paint tool
                    collapseRulerHistory();
                    const tool = lastPaintToolRef2.current;
                    setActiveTool(tool);
                    if (
                      tool === "brush" ||
                      tool === "smudge" ||
                      tool === "eraser"
                    ) {
                      setActiveSubpanel(tool);
                    } else {
                      setActiveSubpanel(null);
                    }
                  }
                  setActiveLayerId(id);
                  activeLayerIdRef.current = id;
                  if (!clickedLayer?.isRuler) {
                    lastPaintLayerIdRef.current = id;
                  }

                  // If a transform was active, begin a new transform on the newly selected layer
                  if (
                    wasTransformActive &&
                    !clickedLayer?.isRuler &&
                    activeToolRef.current === "move"
                  ) {
                    const newLayerId = id;
                    const lc = layerCanvasesRef.current.get(newLayerId);
                    if (lc) {
                      const ctx = lc.getContext("2d", {
                        willReadFrequently: !isIPad,
                      });
                      if (ctx) {
                        const imageData = ctx.getImageData(
                          0,
                          0,
                          lc.width,
                          lc.height,
                        );
                        const { data, width, height } = imageData;
                        let minX = width;
                        let minY = height;
                        let maxX = -1;
                        let maxY = -1;
                        for (let y = 0; y < height; y++) {
                          for (let x = 0; x < width; x++) {
                            const a = data[(y * width + x) * 4 + 3];
                            if (a > 0) {
                              if (x < minX) minX = x;
                              if (x > maxX) maxX = x;
                              if (y < minY) minY = y;
                              if (y > maxY) maxY = y;
                            }
                          }
                        }
                        if (maxX >= minX && maxY >= minY) {
                          const maskCanvas = document.createElement("canvas");
                          maskCanvas.width = canvasWidthRef.current;
                          maskCanvas.height = canvasHeightRef.current;
                          const mCtx = maskCanvas.getContext("2d")!;
                          mCtx.fillStyle = "white";
                          mCtx.fillRect(
                            minX,
                            minY,
                            maxX - minX + 1,
                            maxY - minY + 1,
                          );
                          selectionMaskRef.current = maskCanvas;
                          selectionGeometryRef.current = {
                            type: "rect" as const,
                            x: minX,
                            y: minY,
                            w: maxX - minX + 1,
                            h: maxY - minY + 1,
                          };
                          selectionShapesRef.current = [
                            selectionGeometryRef.current,
                          ];
                          selectionBoundaryPathRef.current.dirty = true;
                          setSelectionActive(true);
                          selectionActiveRef.current = true;
                          selectionActionsRef.current.extractFloat(true);
                        }
                      }
                    }
                  }
                }}
                onToggleVisible={(id) => {
                  const layer = layersRef.current.find((l) => l.id === id);
                  if (layer?.isRuler) {
                    const nowHiding = layer.visible;
                    const updFn = (l: Layer): Layer => {
                      if (l.id !== id) return l;
                      if (nowHiding) {
                        // Hiding: save current rulerActive state, then turn ruler OFF
                        return {
                          ...l,
                          visible: false,
                          rulerActiveBeforeHide: l.rulerActive ?? true,
                          rulerActive: false,
                        };
                      }
                      // Showing: restore previously saved rulerActive state
                      return {
                        ...l,
                        visible: true,
                        rulerActive:
                          l.rulerActiveBeforeHide ?? l.rulerActive ?? true,
                        rulerActiveBeforeHide: undefined,
                      };
                    };
                    // Update the ref synchronously FIRST so drawRulerOverlay
                    // reads the new visibility value immediately.
                    layersRef.current = layersRef.current.map(updFn);
                    setLayers((prev) => prev.map(updFn));
                    // Cancel any pending debounced RAF so it cannot override our
                    // draw with stale state, then render immediately — no delay.
                    if (rulerRafRef.current !== null) {
                      cancelAnimationFrame(rulerRafRef.current);
                      rulerRafRef.current = null;
                    }
                    drawRulerOverlay();
                  } else {
                    handleToggleVisible(id);
                  }
                }}
                onSetOpacity={handleSetOpacity}
                onSetOpacityLive={handleSetOpacityLive}
                onSetOpacityCommit={handleSetOpacityCommit}
                onSetBlendMode={handleSetLayerBlendMode}
                onAddLayer={handleAddLayer}
                onDeleteLayer={(id) => {
                  const isRuler = layersRef.current.find(
                    (l) => l.id === id,
                  )?.isRuler;
                  handleDeleteLayer(id);
                  if (isRuler) scheduleRulerOverlay();
                }}
                onReorderLayers={handleReorderLayers}
                onClearLayer={handleClear}
                onToggleClippingMask={handleToggleClippingMask}
                onMergeLayers={handleMergeLayers}
                onRenameLayer={handleRenameLayer}
                onToggleAlphaLock={handleToggleAlphaLock}
                onCtrlClickLayer={handleCtrlClickLayer}
                onToggleRulerActive={(id) => {
                  const toggleFn = (l: Layer): Layer =>
                    l.id === id
                      ? { ...l, rulerActive: !(l.rulerActive ?? true) }
                      : l;
                  setLayers((prev) => prev.map(toggleFn));
                  layersRef.current = layersRef.current.map(toggleFn);
                  scheduleRulerOverlay();
                }}
                onToggleGroupCollapse={_handleToggleGroupCollapse}
                onRenameGroup={_handleRenameGroup}
                onSetGroupOpacity={_handleSetGroupOpacity}
                onSetGroupOpacityLive={_handleSetGroupOpacityLive}
                onSetGroupOpacityCommit={_handleSetGroupOpacityCommit}
                onToggleGroupVisible={_handleToggleGroupVisible}
                onOpenDeleteGroup={(groupId) => {
                  const groupLayer = layers.find((l) => l.id === groupId);
                  const groupName = groupLayer?.name ?? "Group";
                  setDeleteGroupConfirm({ groupId, groupName });
                }}
                onReorderTree={_handleReorderTree}
                onReorderTreeSilent={_handleReorderTreeSilent}
                onReorderLayersSilent={_handleReorderLayersSilent}
                onCommitReorderHistory={_handleCommitReorderHistory}
                onToggleLayerSelection={_handleToggleLayerSelection}
                onCreateGroup={handleCreateGroup}
                brushTipEditorActive={brushTipEditorMode?.active === true}
              />
            )}{" "}
          {/* end mobile right panel conditional */}
          {/* Settings Panel */}
          <SettingsPanel
            open={settingsOpen}
            onClose={() => setSettingsOpen(false)}
            onExportBrushes={handleExportBrushes}
            onImportBrushes={handleImportBrushes}
            cursorType={cursorType}
            cursorCenter={cursorCenter}
            onCursorSettingsChange={(type, center) => {
              setCursorType(type);
              setCursorCenter(center);
              localStorage.setItem("sk-cursor-type", type);
              localStorage.setItem("sk-cursor-center", center);
            }}
            pressureCurve={universalPressureCurve}
            onPressureCurveChange={(v) => {
              setUniversalPressureCurve(v);
              localStorage.setItem("sk-pressure-curve", JSON.stringify(v));
            }}
            isLoggedIn={isLoggedIn}
            principalId={
              isLoggedIn && identity ? identity.getPrincipal().toString() : null
            }
            onLogin={onLogin}
            onLogout={onLogout}
            isMobile={isMobile || forceDesktop}
            forceDesktop={forceDesktop}
            onForceDesktopChange={(v) => {
              setForceDesktop(v);
              if (v) setRightSidebarCollapsed(false);
            }}
            leftHanded={leftHanded}
            onLeftHandedChange={setLeftHanded}
            preferences={preferences}
          />
          {/* Cloud Overwrite Confirmation Dialog */}
          <CloudOverwriteDialog
            open={showCloudOverwriteDialog}
            onOpenChange={setShowCloudOverwriteDialog}
            onCancel={() => {
              pendingCloudSaveRef.current = null;
              setShowCloudOverwriteDialog(false);
            }}
            onConfirm={() => {
              setShowCloudOverwriteDialog(false);
              pendingCloudSaveRef.current?.();
              pendingCloudSaveRef.current = null;
            }}
          />
          {/* Delete Group Confirmation Dialog */}
          <DeleteGroupDialog
            deleteGroupConfirm={deleteGroupConfirm}
            onOpenChange={() => setDeleteGroupConfirm(null)}
            onCancel={() => setDeleteGroupConfirm(null)}
            onRelease={(groupId) => {
              handleDeleteGroup(groupId, false);
              setDeleteGroupConfirm(null);
            }}
            onDeleteAll={(groupId) => {
              handleDeleteGroup(groupId, true);
              setDeleteGroupConfirm(null);
            }}
          />
          {/* Merge Strategy Dialog */}
          <MergeStrategyDialog
            open={showMergeDialog}
            onOpenChange={setShowMergeDialog}
            importParsed={importParsed}
            presets={presets}
            processImportAppend={processImportAppend}
            setPresets={setPresets}
            setActivePresetIds={setActivePresetIds}
            setBrushSettings={setBrushSettings}
          />
          {/* Conflict Resolution Dialog */}
          <BrushConflictDialog
            currentConflict={currentConflict}
            onOpenChange={(open) => {
              if (!open) {
                setCurrentConflict(null);
                setPendingMerged(null);
                setConflictQueue([]);
              }
            }}
            onCancel={() => {
              setCurrentConflict(null);
              setPendingMerged(null);
              setConflictQueue([]);
            }}
            onResolve={resolveConflict}
          />
          {/* Rotate center crosshair — shown when rotate tool is active */}
          <RotateCrosshairOverlay visible={rotateLocked} />
          {/* Fixed brush size overlay ring — stays at drag-start position during Alt+Shift resize */}
          <BrushSizeOverlayCanvas canvasRef={brushSizeOverlayRef} />
          {/* Software cursor for pen/stylus input — browser suppresses CSS cursors for pen during capture */}
          <SoftwareCursorCanvas canvasRef={softwareCursorRef} />
        </div>
      </div>
    </PaintingContextProvider>
  );
}
