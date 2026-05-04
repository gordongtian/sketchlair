import type { HSVAColor } from "@/utils/colorUtils";
import { hsvToRgb } from "@/utils/colorUtils";
import { useCallback, useEffect, useRef, useState } from "react";
import type { BrushSettings } from "../components/BrushSettingsPanel";
import type { LassoMode, Tool } from "../components/Toolbar";
import type { ViewTransform } from "../types";
import { isIPad } from "../utils/constants";

export interface CursorSystemParams {
  // State / reactive values
  activeTool: Tool;
  color: HSVAColor;
  brushSettings: BrushSettings;
  liquifySize: number;
  lassoMode?: LassoMode | string; // not used directly (hook reads lassoModeRef)
  zoomLocked: boolean;
  rotateLocked: boolean;
  panLocked: boolean;

  // Refs that cursor code reads at call-time
  containerRef: React.RefObject<HTMLDivElement | null>;
  pointerScreenPosRef: React.MutableRefObject<{ x: number; y: number }>;
  isBrushSizeAdjustingRef: React.MutableRefObject<boolean>;
  isPanningRef: React.MutableRefObject<boolean>;
  spaceDownRef: React.MutableRefObject<boolean>;
  panLockedRef: React.MutableRefObject<boolean>;
  zKeyDownRef: React.MutableRefObject<boolean>;
  zoomLockedRef: React.MutableRefObject<boolean>;
  rKeyDownRef: React.MutableRefObject<boolean>;
  rotateLockedRef: React.MutableRefObject<boolean>;
  lassoModeRef: React.MutableRefObject<LassoMode | string>;
  liquifySizeRef: React.MutableRefObject<number>;
  brushSizesRef: React.MutableRefObject<{ brush: number; eraser: number }>;
  viewTransformRef: React.MutableRefObject<ViewTransform>;
  eyedropperHoverColorRef: React.MutableRefObject<{
    r: number;
    g: number;
    b: number;
  }>;
  // For eyedropper sampling
  layerCanvasesRef: React.MutableRefObject<Map<string, HTMLCanvasElement>>;
  selectedLayerIdsRef: React.MutableRefObject<Set<string>>;
  activeLayerIdRef: React.MutableRefObject<string>;
  eyedropperSampleSourceRef: React.MutableRefObject<"canvas" | "layer">;
  eyedropperSampleSizeRef: React.MutableRefObject<1 | 3 | 5>;
  displayCanvasRef: React.RefObject<HTMLCanvasElement | null>;
}

export interface CursorSystemResult {
  // Cursor preferences state (for Settings panel)
  cursorType: "circle" | "brush-outline" | "crosshair";
  cursorCenter: "none" | "crosshair" | "dot";
  setCursorType: React.Dispatch<
    React.SetStateAction<"circle" | "brush-outline" | "crosshair">
  >;
  setCursorCenter: React.Dispatch<
    React.SetStateAction<"none" | "crosshair" | "dot">
  >;

  // Canvas refs that JSX mounts
  softwareCursorRef: React.MutableRefObject<HTMLCanvasElement | null>;

  // Stable ref-wrapped callbacks (safe to read from event handlers)
  updateBrushCursorRef: React.MutableRefObject<() => void>;
  updateEyedropperCursorRef: React.MutableRefObject<() => void>;

  // Internal guard exposed so event handlers can check cursor build state
  cursorBuildingRef: React.MutableRefObject<boolean>;

  // Direct callbacks
  drawBrushTipOverlay: (canvas: HTMLCanvasElement, screenSize: number) => void;
  getCursorStyle: () => string;

  // Eyedropper helper used by pointer-move handler
  sampleEyedropperColor: (
    x: number,
    y: number,
  ) => { r: number; g: number; b: number };

  // Transform handle cursor — called from pointer-move to update cursor based on hovered handle
  updateTransformCursorForHandle: (
    handle: string | null,
    ctrlHeld?: boolean,
  ) => void;
}

export function useCursorSystem(
  params: CursorSystemParams,
): CursorSystemResult {
  const {
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
  } = params;

  // ── Cursor preference state ───────────────────────────────────────────────
  const [cursorType, setCursorType] = useState<
    "circle" | "brush-outline" | "crosshair"
  >(
    () =>
      (localStorage.getItem("sk-cursor-type") as
        | "circle"
        | "brush-outline"
        | "crosshair") || "circle",
  );
  const [cursorCenter, setCursorCenter] = useState<
    "none" | "crosshair" | "dot"
  >(() => {
    const stored = localStorage.getItem("sk-cursor-center");
    if (stored === "crosshair" || stored === "dot" || stored === "none")
      return stored;
    // migrate legacy sk-cursor-crosshair
    return localStorage.getItem("sk-cursor-crosshair") === "true"
      ? "crosshair"
      : "none";
  });

  // ── Canvas refs ───────────────────────────────────────────────────────────
  const softwareCursorRef = useRef<HTMLCanvasElement | null>(null);
  const cursorOffscreenCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // ── Generation / building guards ─────────────────────────────────────────
  const cursorGenRef = useRef(0);
  const cursorBuildingRef = useRef(false);

  // ── Icon cursor cache entry type ─────────────────────────────────────────
  type IconCursorCache = {
    dataURL: string;
    hotspotX: number;
    hotspotY: number;
    dpr: number;
  } | null;

  // ── Icon cursor cache refs ────────────────────────────────────────────────
  const _zoomCursorCacheRef = useRef<string | null>(null);
  const _rotateCursorCacheRef = useRef<string | null>(null);
  const _navDotCursorCacheRef = useRef<string | null>(null);
  const _fillIconCursorCacheRef = useRef<IconCursorCache>(null);
  // Selection tool icon cursors (one per sub-mode icon variant)
  const _lassoRectCursorCacheRef = useRef<IconCursorCache>(null);
  const _lassoEllipseCursorCacheRef = useRef<IconCursorCache>(null);
  const _lassoFreeCursorCacheRef = useRef<IconCursorCache>(null);
  const _lassoWandCursorCacheRef = useRef<IconCursorCache>(null);
  // Crop and ruler icon cursors
  const _cropIconCursorCacheRef = useRef<IconCursorCache>(null);
  const _rulerIconCursorCacheRef = useRef<IconCursorCache>(null);
  // Nav tool icon+dot cursors (pan, rotate, zoom)
  const _panIconCursorCacheRef = useRef<IconCursorCache>(null);
  const _rotateIconCursorCacheRef = useRef<IconCursorCache>(null);
  const _zoomIconCursorCacheRef = useRef<IconCursorCache>(null);
  // Transform tool icon cursor (move icon, same style as pan/zoom/rotate)
  const _transformIconCursorCacheRef = useRef<IconCursorCache>(null);
  // Active transform handle cursor override — set by updateTransformCursorForHandle,
  // read by getCursorStyle() so React re-renders never reset it to the wrong value.
  const _transformHandleCursorRef = useRef<string | null>(null);
  // Transform handle-specific cursors
  const _scaleNSCursorCacheRef = useRef<IconCursorCache>(null);
  const _scaleEWCursorCacheRef = useRef<IconCursorCache>(null);
  const _scaleNWSECursorCacheRef = useRef<IconCursorCache>(null);
  const _scaleNESWCursorCacheRef = useRef<IconCursorCache>(null);
  const _rotateTransformCursorCacheRef = useRef<IconCursorCache>(null);

  // ── Stable refs for callbacks ─────────────────────────────────────────────
  const updateBrushCursorRef = useRef<() => void>(() => {});
  const updateEyedropperCursorRef = useRef<() => void>(() => {});

  // ── Initialize software cursor as hidden ──────────────────────────────────
  useEffect(() => {
    if (softwareCursorRef.current) {
      softwareCursorRef.current.style.display = "none";
    }
    // Clear all composite icon cursor caches so they regenerate with current settings
    _fillIconCursorCacheRef.current = null;
    _navDotCursorCacheRef.current = null;
    _lassoRectCursorCacheRef.current = null;
    _lassoEllipseCursorCacheRef.current = null;
    _lassoFreeCursorCacheRef.current = null;
    _lassoWandCursorCacheRef.current = null;
    _cropIconCursorCacheRef.current = null;
    _rulerIconCursorCacheRef.current = null;
    _panIconCursorCacheRef.current = null;
    _rotateIconCursorCacheRef.current = null;
    _zoomIconCursorCacheRef.current = null;
    _transformIconCursorCacheRef.current = null;
    _scaleNSCursorCacheRef.current = null;
    _scaleEWCursorCacheRef.current = null;
    _scaleNWSECursorCacheRef.current = null;
    _scaleNESWCursorCacheRef.current = null;
    _rotateTransformCursorCacheRef.current = null;
  }, []);

  // ── DPR change detection — clears all icon cursor caches and re-applies ───
  // Uses matchMedia self-re-registration pattern for reliable cross-browser support.
  // Brush, eraser, smudge, liquify, and eyedropper caches are NOT cleared here.
  const activeToolRef = useRef(activeTool);
  useEffect(() => {
    activeToolRef.current = activeTool;
  }, [activeTool]);

  useEffect(() => {
    const clearAllIconCursorCaches = () => {
      _panIconCursorCacheRef.current = null;
      _rotateIconCursorCacheRef.current = null;
      _zoomIconCursorCacheRef.current = null;
      _transformIconCursorCacheRef.current = null;
      _fillIconCursorCacheRef.current = null;
      _lassoRectCursorCacheRef.current = null;
      _lassoEllipseCursorCacheRef.current = null;
      _lassoFreeCursorCacheRef.current = null;
      _lassoWandCursorCacheRef.current = null;
      _cropIconCursorCacheRef.current = null;
      _rulerIconCursorCacheRef.current = null;
      _scaleNSCursorCacheRef.current = null;
      _scaleEWCursorCacheRef.current = null;
      _scaleNWSECursorCacheRef.current = null;
      _scaleNESWCursorCacheRef.current = null;
      _rotateTransformCursorCacheRef.current = null;
      _transformHandleCursorRef.current = null;
    };

    let cleanup: (() => void) | null = null;

    const setupDPRChangeListener = () => {
      if (cleanup) cleanup();
      const dpr = window.devicePixelRatio || 1;
      const mq = window.matchMedia(`(resolution: ${dpr}dppx)`);
      const handler = () => {
        const newDPR = window.devicePixelRatio;
        // Multi-Monitor Fix: log DPR change and confirm all caches are cleared
        // so no stale cursor image from the previous DPR is reused.
        clearAllIconCursorCaches();
        // Compute representative hotspot for the crosshair composite cursor
        // to confirm integer CSS px values at the new DPR.
        // chX=8, chY=38 — the logical crosshair center in buildCompositeIconCursor.
        const hotspotX = Math.round(8); // always 8 — logged for verification
        const hotspotY = Math.round(38); // always 38 — logged for verification
        console.log(
          `[Cursor] DPR changed to ${newDPR} — regenerating all cursors at 4x physical resolution`,
        );
        console.log(`[Cursor] hotspot: (${hotspotX}, ${hotspotY}) CSS pixels`);
        // Re-apply the cursor for the current tool by calling updateBrushCursorRef.
        // Use a microtask delay so the new DPR is fully settled before rebuilding.
        Promise.resolve().then(() => {
          updateBrushCursorRef.current();
        });
        // Re-register for the next DPR change (new value)
        setupDPRChangeListener();
      };
      mq.addEventListener("change", handler, { once: true });
      cleanup = () => mq.removeEventListener("change", handler);
    };

    setupDPRChangeListener();
    return () => {
      if (cleanup) cleanup();
    };
  }, []);

  // ── Cursor builder helpers ────────────────────────────────────────────────
  // Helper: build a cursor with a Lucide-style icon (drawn via Canvas 2D) + small triangle pointer
  const buildIconCursor = (
    drawIcon: (
      ctx: CanvasRenderingContext2D,
      ox: number,
      oy: number,
      size: number,
    ) => void,
  ): string => {
    const canvasSize = 40;
    const c = document.createElement("canvas");
    c.width = canvasSize;
    c.height = canvasSize;
    const ctx = c.getContext("2d")!;
    // Draw icon at top-right area (18,2 size 20x20), scaled from 24x24 viewBox
    const scale = 20 / 24;
    ctx.save();
    ctx.translate(18, 2);
    ctx.scale(scale, scale);
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 2 / scale;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.fillStyle = "none";
    drawIcon(ctx, 0, 0, 24);
    ctx.restore();
    // White outline behind icon via destination-over
    ctx.globalCompositeOperation = "destination-over";
    ctx.save();
    ctx.translate(18, 2);
    ctx.scale(scale, scale);
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 4 / scale;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.fillStyle = "none";
    drawIcon(ctx, 0, 0, 24);
    ctx.restore();
    ctx.globalCompositeOperation = "source-over";
    // Small triangle pointer at bottom-left, hotspot at (2,38)
    ctx.beginPath();
    ctx.moveTo(2, 38); // tip
    ctx.lineTo(10, 22); // top-right
    ctx.lineTo(10, 34); // bottom-right
    ctx.closePath();
    // White outline first (destination-over)
    ctx.globalCompositeOperation = "destination-over";
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#000";
    ctx.fill();
    return c.toDataURL();
  };

  // Reserved: kept for potential future use (e.g. lasso sub-mode cursors)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _buildLassoCursor = (mode: string): string => {
    return buildIconCursor((ctx) => {
      if (mode === "rect") {
        ctx.strokeRect(3, 3, 18, 18);
      } else if (mode === "ellipse") {
        ctx.beginPath();
        ctx.arc(12, 12, 10, 0, Math.PI * 2);
        ctx.stroke();
      } else if (mode === "wand") {
        // Wand2 icon (simplified)
        ctx.beginPath();
        ctx.moveTo(21.64, 3.64);
        ctx.lineTo(20.36, 2.36);
        ctx.lineTo(2, 19);
        ctx.lineTo(5, 22);
        ctx.lineTo(22.36, 4.36);
        ctx.closePath();
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(14, 7);
        ctx.lineTo(17, 10);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(5, 6);
        ctx.lineTo(5, 10);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(19, 14);
        ctx.lineTo(19, 18);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(10, 2);
        ctx.lineTo(10, 4);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(7, 8);
        ctx.lineTo(3, 8);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(21, 16);
        ctx.lineTo(17, 16);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(11, 3);
        ctx.lineTo(9, 3);
        ctx.stroke();
      } else {
        // Free lasso (Lasso icon)
        ctx.beginPath();
        ctx.moveTo(7, 22);
        ctx.quadraticCurveTo(5, 18, 3.3, 14);
        ctx.quadraticCurveTo(2, 12, 2, 10);
        ctx.quadraticCurveTo(2, 2, 12, 2);
        ctx.quadraticCurveTo(22, 2, 22, 10);
        ctx.quadraticCurveTo(22, 18, 12, 18);
        ctx.quadraticCurveTo(8, 18, 7, 22);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(5, 20, 2, 0, Math.PI * 2);
        ctx.stroke();
      }
    });
  };

  /**
   * Dot cursor — identical to the brush tool's
   * "cursor center → dot" option: 1.5px black outer + 1px white inner, centered.
   * Canvas is 15×15 with hotspot at (7, 7).
   * Reserved: nav tools now use buildDotWithIconCursor instead.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _buildNavDotCursor = (): string => {
    if (_navDotCursorCacheRef.current) return _navDotCursorCacheRef.current;
    const size = 15;
    const c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    const ctx2 = c.getContext("2d");
    if (!ctx2) return "crosshair";
    const cx = size / 2;
    const cy = size / 2;
    ctx2.fillStyle = "rgba(0,0,0,0.7)";
    ctx2.beginPath();
    ctx2.arc(cx, cy, 1.5, 0, Math.PI * 2);
    ctx2.fill();
    ctx2.fillStyle = "rgba(255,255,255,0.8)";
    ctx2.beginPath();
    ctx2.arc(cx, cy, 1, 0, Math.PI * 2);
    ctx2.fill();
    const result = c.toDataURL();
    _navDotCursorCacheRef.current = result;
    return result;
  };

  /**
   * Nav tool cursor: Lucide icon centered on the canvas with the nav dot drawn
   * on top at the center. The icon is centered on a 25×25 canvas, and the dot
   * (identical to buildNavDotCursor) is drawn at the canvas center (12, 12).
   * Hotspot is (12, 12) — the dot/icon center.
   *
   * Same icon styling as buildCompositeIconCursor:
   *   - 8× supersampling then downscale to 25×25
   *   - Stroke: #141414, lineWidth 2.0 (in 24-unit viewBox space)
   *   - White outline: 6px logical post-downscale
   */
  const buildDotWithIconCursor = (
    iconPaths: string[],
    cacheRef: React.MutableRefObject<{
      dataURL: string;
      hotspotX: number;
      hotspotY: number;
      dpr: number;
    } | null>,
    flipHorizontal = false,
  ): { dataURL: string; hotspotX: number; hotspotY: number } => {
    const dpr = window.devicePixelRatio || 1;

    // Return cache only if DPR matches
    if (cacheRef.current && cacheRef.current.dpr === dpr) {
      return cacheRef.current;
    }
    // Cache miss or DPR changed — rebuild
    cacheRef.current = null;

    // Fix 1: Force logicalSize to be even so logicalSize/2 is always a whole integer,
    // eliminating 0.5px center ambiguity at fractional DPR values like 1.5x.
    // Fix 2: Fixed 32px canvas (no DPR scaling) to bypass Windows OS double-scaling.
    // On Windows at 150% scaling, DPR=1.5 but Windows may also upscale the cursor
    // bitmap by an additional factor — rendering at a fixed 32px and letting Windows
    // handle all scaling eliminates the double-scaling hotspot shift.
    const RAW_SIZE = 25; // original logical size
    // Ensure even number (Fix 1)
    const logicalSize = RAW_SIZE % 2 === 0 ? RAW_SIZE : RAW_SIZE + 1; // 26
    // Fixed canvas size — no DPR scaling (Fix 2)
    const FIXED_SIZE = 32;
    const hotspotX = Math.floor(FIXED_SIZE / 2); // 16 — always a whole integer
    const hotspotY = Math.floor(FIXED_SIZE / 2); // 16

    console.log(
      `[setCursor] dpr=${dpr.toFixed(4)} logicalSize=${logicalSize} fixedCanvasSize=${FIXED_SIZE} hotspot=(${hotspotX},${hotspotY}) timestamp=${Date.now()}`,
    );

    // ── Step 1: Render icon at 3× for crisp edges, then downscale to FIXED_SIZE ──
    const superScale = 3;
    // Render at superscaled logical size — no DPR multiplication (Fix 2: DPR-agnostic)
    const renderSize = logicalSize * superScale; // integer — no ceil needed

    const hiCanvas = document.createElement("canvas");
    hiCanvas.width = renderSize;
    hiCanvas.height = renderSize;
    hiCanvas.style.width = `${logicalSize * superScale}px`;
    hiCanvas.style.height = `${logicalSize * superScale}px`;
    const hiCtx = hiCanvas.getContext("2d")!;

    const hiScale = renderSize / 24;
    // Visual stroke weight in final 32×32 output ≈ 1.9px (in viewBox units).
    // ctx.scale(hiScale, hiScale) maps viewBox coords (0–24) to the high-res canvas,
    // so lineWidth is expressed in viewBox units directly — no superScale compensation needed.
    const hiLineWidth = 1.9;

    // White glow pass — draw icon in white at same lineWidth, then blur.
    // The blur spreads the white pixels into a soft halo around the dark icon.
    hiCtx.save();
    if (flipHorizontal) {
      hiCtx.translate(renderSize, 0);
      hiCtx.scale(-hiScale, hiScale);
    } else {
      hiCtx.scale(hiScale, hiScale);
    }
    hiCtx.strokeStyle = "#ffffff";
    hiCtx.lineWidth = hiLineWidth;
    hiCtx.lineCap = "round";
    hiCtx.lineJoin = "round";
    for (const d of iconPaths) {
      hiCtx.stroke(new Path2D(d));
    }
    hiCtx.restore();
    // Copy the white pass to a glow canvas, clear hiCanvas, then draw it back
    // with a blur filter so the white spreads into a soft halo.
    const glowCanvas = document.createElement("canvas");
    glowCanvas.width = renderSize;
    glowCanvas.height = renderSize;
    const glowCtx = glowCanvas.getContext("2d")!;
    glowCtx.drawImage(hiCanvas, 0, 0);
    hiCtx.clearRect(0, 0, renderSize, renderSize);
    hiCtx.filter = "blur(3px)";
    hiCtx.drawImage(glowCanvas, 0, 0);
    hiCtx.filter = "none";

    // Dark icon on top of blurred white glow
    hiCtx.save();
    if (flipHorizontal) {
      hiCtx.translate(renderSize, 0);
      hiCtx.scale(-hiScale, hiScale);
    } else {
      hiCtx.scale(hiScale, hiScale);
    }
    hiCtx.strokeStyle = "#141414";
    hiCtx.lineWidth = hiLineWidth;
    hiCtx.lineCap = "round";
    hiCtx.lineJoin = "round";
    for (const d of iconPaths) {
      hiCtx.stroke(new Path2D(d));
    }
    hiCtx.restore();

    // ── Step 2: Downscale to fixed 32×32 canvas — no DPR scaling (Fix 2) ────
    // Windows handles all display scaling from here; we just provide 32×32 pixels
    // and let the OS render it at whatever size it deems appropriate.
    const c = document.createElement("canvas");
    c.width = FIXED_SIZE;
    c.height = FIXED_SIZE;
    // Set explicit CSS dimensions equal to canvas dimensions so browser
    // interprets the bitmap at 1:1 logical pixels (critical for correct hotspot).
    c.style.width = `${FIXED_SIZE}px`;
    c.style.height = `${FIXED_SIZE}px`;
    const ctx = c.getContext("2d")!;
    // Draw high-res icon scaled down to 32×32 — no ctx.scale(dpr) call (Fix 2)
    ctx.drawImage(hiCanvas, 0, 0, FIXED_SIZE, FIXED_SIZE);

    const dataURL = c.toDataURL();
    const entry = { dataURL, hotspotX, hotspotY, dpr };
    cacheRef.current = entry;
    return entry;
  };

  // ── Nav tool icon paths ───────────────────────────────────────────────────
  // Pan tool → hand icon (https://lucide.dev/icons/hand) — no flip
  const _handPaths = [
    "M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0",
    "M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0",
    "M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0",
    "M18 11a2 2 0 1 1 4 0v3a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15",
    "M6 5V3",
  ];

  // Rotate canvas tool → rotate-ccw icon (https://lucide.dev/icons/rotate-ccw) — no flip
  const _rotateCcwPaths = [
    "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8",
    "M3 3v5h5",
  ];

  // Zoom tool → zoom-in icon (https://lucide.dev/icons/zoom-in) — no flip
  // Circle element converted to a Path2D-compatible arc path
  const _zoomInPaths = [
    "m21 21-4.34-4.34",
    "M11 8v6",
    "M8 11h6",
    // Full circle for cx=11 cy=11 r=8 (converted to arc via cubic bezier approximation)
    "M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16z",
  ];

  const buildPanIconCursor = () =>
    buildDotWithIconCursor(_handPaths, _panIconCursorCacheRef, false);

  const buildRotateIconCursor = () =>
    buildDotWithIconCursor(_rotateCcwPaths, _rotateIconCursorCacheRef, false);

  const buildZoomIconCursor = () =>
    buildDotWithIconCursor(_zoomInPaths, _zoomIconCursorCacheRef, false);

  // Transform tool → move icon (https://lucide.dev/icons/move) — no flip
  const _movePaths = [
    "M5 9l-3 3 3 3",
    "M9 5l3-3 3 3",
    "M15 19l-3 3-3-3",
    "M19 9l3 3-3 3",
    "M2 12h20",
    "M12 2v20",
  ];

  const buildTransformIconCursor = () =>
    buildDotWithIconCursor(_movePaths, _transformIconCursorCacheRef, false);

  // ── Transform handle cursors (scale + rotate) ─────────────────────────────
  // Lucide maximize-2 paths (viewBox 0 0 24 24) — diagonal NW↔SE arrow
  const _maximize2Paths = [
    "M15 3h6v6",
    "M9 21H3v-6",
    "M21 3l-7 7",
    "M3 21l7-7",
  ];

  // Lucide arrow-up-down paths (viewBox 0 0 24 24) — vertical double arrow
  const _arrowUpDownPaths = [
    "m21 16-4 4-4-4",
    "M17 20V4",
    "m3 8 4-4 4 4",
    "M7 4v16",
  ];

  // Lucide arrow-left-right paths (viewBox 0 0 24 24) — horizontal double arrow
  const _arrowLeftRightPaths = ["M8 3 4 7l4 4", "M4 7h16", "m16 3 4 4-4 4"];

  // Lucide rotate-cw paths (viewBox 0 0 24 24) — clockwise rotation
  const _rotateCwPaths = ["M21 2v6h-6", "M21 13a9 9 0 1 1-3-7.7L21 8"];

  /**
   * Build a cursor for the NE↔SW diagonal scale handle.
   * We reuse the Maximize2 icon but render it on an intermediate canvas
   * rotated 90°, then pass the rotated image as the cursor.
   */
  const _buildScaleNESWCursor = (): {
    dataURL: string;
    hotspotX: number;
    hotspotY: number;
  } => {
    const dpr = window.devicePixelRatio || 1;

    if (
      _scaleNESWCursorCacheRef.current &&
      _scaleNESWCursorCacheRef.current.dpr === dpr
    ) {
      return _scaleNESWCursorCacheRef.current;
    }
    _scaleNESWCursorCacheRef.current = null;

    // Fix 1: Force size to be even so size/2 is always a whole integer.
    // Fix 2: Fixed 32px canvas — no DPR scaling to bypass Windows double-scaling.
    const RAW_SIZE = 25;
    const logicalSize = RAW_SIZE % 2 === 0 ? RAW_SIZE : RAW_SIZE + 1; // 26
    const FIXED_SIZE = 32;
    const hotspotX = Math.floor(FIXED_SIZE / 2); // 16
    const hotspotY = Math.floor(FIXED_SIZE / 2); // 16
    const superScale = 3;
    const renderSize = logicalSize * superScale; // integer — no DPR multiplication (Fix 2)

    console.log(
      `[setCursor] dpr=${dpr.toFixed(4)} logicalSize=${logicalSize} fixedCanvasSize=${FIXED_SIZE} hotspot=(${hotspotX},${hotspotY}) timestamp=${Date.now()}`,
    );

    // Step 1: Render Maximize2 at high-res
    const hiCanvas = document.createElement("canvas");
    hiCanvas.width = renderSize;
    hiCanvas.height = renderSize;
    hiCanvas.style.width = `${logicalSize * superScale}px`;
    hiCanvas.style.height = `${logicalSize * superScale}px`;
    const hiCtx = hiCanvas.getContext("2d")!;
    const hiScale = renderSize / 24;
    const hiLineWidth = 1.9;

    // White glow pass
    hiCtx.save();
    hiCtx.scale(hiScale, hiScale);
    hiCtx.strokeStyle = "#ffffff";
    hiCtx.lineWidth = hiLineWidth;
    hiCtx.lineCap = "round";
    hiCtx.lineJoin = "round";
    for (const d of _maximize2Paths) hiCtx.stroke(new Path2D(d));
    hiCtx.restore();
    const glowCanvas = document.createElement("canvas");
    glowCanvas.width = renderSize;
    glowCanvas.height = renderSize;
    const glowCtx = glowCanvas.getContext("2d")!;
    glowCtx.drawImage(hiCanvas, 0, 0);
    hiCtx.clearRect(0, 0, renderSize, renderSize);
    hiCtx.filter = "blur(3px)";
    hiCtx.drawImage(glowCanvas, 0, 0);
    hiCtx.filter = "none";

    // Dark icon pass
    hiCtx.save();
    hiCtx.scale(hiScale, hiScale);
    hiCtx.strokeStyle = "#141414";
    hiCtx.lineWidth = hiLineWidth;
    hiCtx.lineCap = "round";
    hiCtx.lineJoin = "round";
    for (const d of _maximize2Paths) hiCtx.stroke(new Path2D(d));
    hiCtx.restore();

    // Step 2: Rotate 90° onto fixed 32×32 canvas — no DPR scaling (Fix 2)
    const c = document.createElement("canvas");
    c.width = FIXED_SIZE;
    c.height = FIXED_SIZE;
    c.style.width = `${FIXED_SIZE}px`;
    c.style.height = `${FIXED_SIZE}px`;
    const ctx = c.getContext("2d")!;
    ctx.translate(FIXED_SIZE / 2, FIXED_SIZE / 2);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(
      hiCanvas,
      -FIXED_SIZE / 2,
      -FIXED_SIZE / 2,
      FIXED_SIZE,
      FIXED_SIZE,
    );

    const dataURL = c.toDataURL();
    const entry = { dataURL, hotspotX, hotspotY, dpr };
    _scaleNESWCursorCacheRef.current = entry;
    return entry;
  };

  const buildScaleNSCursor = () =>
    buildDotWithIconCursor(_arrowUpDownPaths, _scaleNSCursorCacheRef, false);

  const buildScaleEWCursor = () =>
    buildDotWithIconCursor(_arrowLeftRightPaths, _scaleEWCursorCacheRef, false);

  const buildScaleNWSECursor = () =>
    buildDotWithIconCursor(_maximize2Paths, _scaleNWSECursorCacheRef, false);

  const buildScaleNESWCursor = () => _buildScaleNESWCursor();

  const buildRotateTransformCursor = () =>
    buildDotWithIconCursor(
      _rotateCwPaths,
      _rotateTransformCursorCacheRef,
      false,
    );

  /**
   * Apply the appropriate transform cursor for the given handle name.
   * Called from pointer-move (hover) and during active dragging.
   * null / undefined = default Move cursor.
   * When ctrlHeld is true and handle is an edge handle (n/s/e/w), show
   * the skew cursor variant (opposite axis double arrow).
   */
  const updateTransformCursorForHandle = (
    handle: string | null,
    ctrlHeld?: boolean,
  ) => {
    if (!containerRef.current) return;
    const sc = softwareCursorRef.current;
    if (sc) sc.style.display = "none";

    let result: { dataURL: string; hotspotX: number; hotspotY: number };
    if (handle === "rot") {
      result = buildRotateTransformCursor();
    } else if (handle === "nw" || handle === "se") {
      // Ctrl held on corner: free-corner mode — use 'move' cursor
      result = ctrlHeld ? buildTransformIconCursor() : buildScaleNESWCursor();
    } else if (handle === "ne" || handle === "sw") {
      // Ctrl held on corner: free-corner mode — use 'move' cursor
      result = ctrlHeld ? buildTransformIconCursor() : buildScaleNWSECursor();
    } else if (handle === "n" || handle === "s") {
      // Ctrl held: skew mode — use EW (horizontal double arrow) for top/bottom edge
      result = ctrlHeld ? buildScaleEWCursor() : buildScaleNSCursor();
    } else if (handle === "e" || handle === "w") {
      // Ctrl held: skew mode — use NS (vertical double arrow) for left/right edge
      result = ctrlHeld ? buildScaleNSCursor() : buildScaleEWCursor();
    } else {
      // move (inside bbox) or null (outside / default)
      result = buildTransformIconCursor();
    }
    // Store in ref so getCursorStyle() returns the correct value on re-renders,
    // preventing React's style reconciliation from resetting the cursor.
    // Hotspot is always in CSS/logical pixels from the builder.
    _transformHandleCursorRef.current = `url(${result.dataURL}) ${result.hotspotX} ${result.hotspotY}, crosshair`;
    containerRef.current.style.cursor = _transformHandleCursorRef.current;
  };

  // Memoize: these are pure canvas operations — computed once, cached for lifetime of component
  // Kept for potential future use (zoom/rotate/pan now use buildDotWithIconCursor)
  const _buildZoomCursor = (): string => {
    if (_zoomCursorCacheRef.current) return _zoomCursorCacheRef.current;
    const result = buildIconCursor((ctx) => {
      // ZoomIn icon
      ctx.beginPath();
      ctx.arc(11, 11, 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(21, 21);
      ctx.lineTo(16.65, 16.65);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(11, 8);
      ctx.lineTo(11, 14);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(8, 11);
      ctx.lineTo(14, 11);
      ctx.stroke();
    });
    _zoomCursorCacheRef.current = result;
    return result;
  };

  const _buildRotateCursor = (): string => {
    if (_rotateCursorCacheRef.current) return _rotateCursorCacheRef.current;
    const result = buildIconCursor((ctx) => {
      // RotateCcw icon
      ctx.beginPath();
      ctx.arc(12, 12, 9, 0.3, 0.3 + Math.PI * 2 * 0.85);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(3, 3);
      ctx.lineTo(3, 8);
      ctx.lineTo(8, 8);
      ctx.stroke();
    });
    _rotateCursorCacheRef.current = result;
    return result;
  };

  // ── Shared composite cursor builder: crosshair + icon ────────────────────
  // Layout (all values in logical px):
  //   chX=8, chY=38 — crosshair center (hotspot)
  //   iconX=12, iconY=0 — icon upper-right with ~4px gap from crosshair center
  //   canvasW=38 (even), canvasH=48 (even) — forced even for clean center
  //
  // Render pipeline (4x physical pixel fix):
  //   1. Render icon at 3x supersampling then downscale to logical size
  //   2. Composite onto a canvas rendered at logicalSize × 4 physical pixels
  //   3. Draw crosshair at exactly the 4x canvas center (logicalCenter * 4 physical px)
  //   4. Hotspot is always computed in logical/CSS px space — never divided from physical
  //   5. canvas.style dimensions set to logical px so browser scales back down correctly
  const buildCompositeIconCursor = (
    iconPaths: string[],
    cacheRef: React.MutableRefObject<{
      dataURL: string;
      hotspotX: number;
      hotspotY: number;
      dpr: number;
    } | null>,
    flipHorizontal = false,
  ): { dataURL: string; hotspotX: number; hotspotY: number } => {
    const dpr = window.devicePixelRatio || 1;

    // Return cache only if DPR matches
    if (cacheRef.current && cacheRef.current.dpr === dpr) {
      return cacheRef.current;
    }
    // Cache miss or DPR changed — rebuild
    cacheRef.current = null;

    // All logical dimensions forced to even integers so half-values are whole integers.
    // This eliminates 0.5px center ambiguity at all DPR values.
    const iconW = 26; // even
    const iconH = 26; // even
    const gap = 4; // even
    const arm = 8; // even

    // Crosshair center — hotspot (logical px). Always integer — never computed by
    // dividing a physical pixel coordinate by DPR.
    const chX = 8; // even, logical CSS px
    const chY = iconH + gap + arm; // 26 + 4 + 8 = 38 — even, logical CSS px

    // Icon position: upper-right of crosshair center
    const iconX = chX + gap; // 12 — even, logical CSS px
    const iconYClamped = 0;

    // Canvas logical dimensions — both forced even
    const canvasW = Math.max(chX + arm + 2, iconX + iconW); // max(18, 38) = 38
    const canvasH = chY + arm + 2; // 38 + 8 + 2 = 48

    // ── Hotspot clamping (Secondary Fix) ──────────────────────────────────────
    // Hotspot is always computed in logical/CSS px space — NEVER divide physical coords by DPR.
    // Math.round() instead of Math.floor() to guarantee the nearest integer center.
    const hotspotX = Math.round(chX); // 8 — integer CSS px
    const hotspotY = Math.round(chY); // 38 — integer CSS px
    if (!Number.isInteger(hotspotX) || !Number.isInteger(hotspotY)) {
      console.warn(
        `[Cursor] WARNING: fractional hotspot detected: (${hotspotX}, ${hotspotY}) — clamping to integer`,
      );
    }

    console.log(
      `[setCursor] dpr=${dpr.toFixed(4)} logicalSize=${canvasW}x${canvasH} physicalSize=${canvasW * 4}x${canvasH * 4} center=(${hotspotX},${hotspotY}) hotspot=(${hotspotX},${hotspotY}) timestamp=${Date.now()}`,
    );

    // ── Step 1: Render icon at 3× superscaling for crisp edges ──────────────
    const superScale = 3;
    const iconRenderW = iconW * superScale;
    const iconRenderH = iconH * superScale;

    const hiCanvas = document.createElement("canvas");
    hiCanvas.width = iconRenderW;
    hiCanvas.height = iconRenderH;
    hiCanvas.style.width = `${iconW * superScale}px`;
    hiCanvas.style.height = `${iconH * superScale}px`;
    const hiCtx = hiCanvas.getContext("2d")!;

    const hiScaleX = iconRenderW / 24;
    const hiScaleY = iconRenderH / 24;
    // Visual stroke weight in final output = 1.9px (in viewBox units).
    const hiLineWidth = 1.9;

    hiCtx.save();
    if (flipHorizontal) {
      hiCtx.translate(iconRenderW, 0);
      hiCtx.scale(-hiScaleX, hiScaleY);
    } else {
      hiCtx.scale(hiScaleX, hiScaleY);
    }
    // White glow pass — draw icon in white at same lineWidth, then blur for soft halo.
    hiCtx.strokeStyle = "#ffffff";
    hiCtx.lineWidth = hiLineWidth;
    hiCtx.lineCap = "round";
    hiCtx.lineJoin = "round";
    for (const d of iconPaths) {
      hiCtx.stroke(new Path2D(d));
    }
    hiCtx.restore();
    // Copy the white pass to a glow canvas, clear hiCanvas, then draw it back
    // with a blur filter so the white spreads into a soft halo.
    const glowCanvas = document.createElement("canvas");
    glowCanvas.width = iconRenderW;
    glowCanvas.height = iconRenderH;
    const glowCtx = glowCanvas.getContext("2d")!;
    glowCtx.drawImage(hiCanvas, 0, 0);
    hiCtx.clearRect(0, 0, iconRenderW, iconRenderH);
    hiCtx.filter = "blur(3px)";
    hiCtx.drawImage(glowCanvas, 0, 0);
    hiCtx.filter = "none";

    // Dark icon on top of blurred white glow
    hiCtx.save();
    if (flipHorizontal) {
      hiCtx.translate(iconRenderW, 0);
      hiCtx.scale(-hiScaleX, hiScaleY);
    } else {
      hiCtx.scale(hiScaleX, hiScaleY);
    }
    hiCtx.strokeStyle = "#141414";
    hiCtx.lineWidth = hiLineWidth;
    hiCtx.lineCap = "round";
    hiCtx.lineJoin = "round";
    for (const d of iconPaths) {
      hiCtx.stroke(new Path2D(d));
    }
    hiCtx.restore();

    // ── Step 2: Downscale icon to logical size (icon portion at 1:1 logical px) ──
    // Render at exactly logicalSize — the final canvas is 4x physical, so we'll
    // scale this up when compositing onto it via drawImage.
    const midCanvas = document.createElement("canvas");
    midCanvas.width = iconW;
    midCanvas.height = iconH;
    midCanvas.style.width = `${iconW}px`;
    midCanvas.style.height = `${iconH}px`;
    const midCtx = midCanvas.getContext("2d")!;
    midCtx.drawImage(hiCanvas, 0, 0, iconW, iconH);

    // ── Step 3: Composite onto 4x physical pixel canvas (Primary Fix) ────────
    // Rendering at 4× logical size reduces the relative hotspot rounding error from
    // ~1 CSS pixel to ~0.25 CSS pixel — below the perceptible threshold at all DPRs.
    // The crosshair center in physical pixels is exactly logicalCenter * 4, which
    // maps back to the logical hotspot with no rounding error.
    const RENDER_SCALE = 4; // 4x physical pixels
    const physCanvasW = canvasW * RENDER_SCALE;
    const physCanvasH = canvasH * RENDER_SCALE;
    const c = document.createElement("canvas");
    c.width = physCanvasW;
    c.height = physCanvasH;
    // CSS size = logical size so the browser scales the 4x bitmap down correctly.
    c.style.width = `${canvasW}px`;
    c.style.height = `${canvasH}px`;
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    // Draw icon at its position — scale up from logical to 4x physical
    ctx.drawImage(
      midCanvas,
      iconX * RENDER_SCALE,
      iconYClamped * RENDER_SCALE,
      iconW * RENDER_SCALE,
      iconH * RENDER_SCALE,
    );

    // Draw crosshair at exactly logicalCenter * 4 physical pixels.
    // This guarantees the visual center and the logical hotspot are perfectly aligned
    // regardless of DPR — the 4x canvas eliminates fractional pixel rounding entirely.
    const phChX = chX * RENDER_SCALE; // exact integer, no DPR involved
    const phChY = chY * RENDER_SCALE; // exact integer, no DPR involved
    const phArm = arm * RENDER_SCALE; // exact integer arm length in physical px
    // Outer dark pass
    ctx.imageSmoothingEnabled = false; // crisp lines for crosshair
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.lineWidth = Math.round(1.5 * RENDER_SCALE);
    ctx.beginPath();
    ctx.moveTo(phChX - phArm, phChY);
    ctx.lineTo(phChX + phArm, phChY);
    ctx.moveTo(phChX, phChY - phArm);
    ctx.lineTo(phChX, phChY + phArm);
    ctx.stroke();
    // Inner light pass
    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.lineWidth = Math.max(1, Math.round(0.8 * RENDER_SCALE));
    ctx.beginPath();
    ctx.moveTo(phChX - phArm, phChY);
    ctx.lineTo(phChX + phArm, phChY);
    ctx.moveTo(phChX, phChY - phArm);
    ctx.lineTo(phChX, phChY + phArm);
    ctx.stroke();

    const dataURL = c.toDataURL();
    const entry = { dataURL, hotspotX, hotspotY, dpr };
    cacheRef.current = entry;
    return entry;
  };

  // ── Fill tool: crosshair + PaintBucket icon composite cursor ─────────────
  // Lucide paint-bucket paths (viewBox 0 0 24 24, v0.562.0, square bottom)
  const _paintBucketPaths = [
    "M11 7 6 2",
    "M18.992 12H2.041",
    "M21.145 18.38A3.34 3.34 0 0 1 20 16.5a3.3 3.3 0 0 1-1.145 1.88c-.575.46-.855 1.02-.855 1.595A2 2 0 0 0 20 22a2 2 0 0 0 2-2.025c0-.58-.285-1.13-.855-1.595",
    "m8.5 4.5 2.148-2.148a1.205 1.205 0 0 1 1.704 0l7.296 7.296a1.205 1.205 0 0 1 0 1.704l-7.592 7.592a3.615 3.615 0 0 1-5.112 0l-3.888-3.888a3.615 3.615 0 0 1 0-5.112L5.67 7.33",
  ];
  const buildFillCrosshairWithIconCursor = () =>
    buildCompositeIconCursor(_paintBucketPaths, _fillIconCursorCacheRef, false);

  // ── Lasso sub-mode: square-dashed (rect / mask) ───────────────────────────
  // Lucide square-dashed paths (viewBox 0 0 24 24)
  const _squareDashedPaths = [
    "M5 3a2 2 0 0 0-2 2",
    "M19 3a2 2 0 0 1 2 2",
    "M21 19a2 2 0 0 1-2 2",
    "M5 21a2 2 0 0 1-2-2",
    "M9 3h1",
    "M9 21h1",
    "M14 3h1",
    "M14 21h1",
    "M3 9v1",
    "M21 9v1",
    "M3 14v1",
    "M21 14v1",
  ];
  const buildLassoRectCursor = () =>
    buildCompositeIconCursor(
      _squareDashedPaths,
      _lassoRectCursorCacheRef,
      false,
    );

  // ── Lasso sub-mode: circle-dashed (ellipse) ──────────────────────────────
  // Lucide circle-dashed paths (viewBox 0 0 24 24)
  const _circleDashedPaths = [
    "M10.1 2.182a10 10 0 0 1 3.8 0",
    "M13.9 21.818a10 10 0 0 1-3.8 0",
    "M17.609 3.721a10 10 0 0 1 2.69 2.69",
    "M2.182 13.9a10 10 0 0 1 0-3.8",
    "M21.818 10.1a10 10 0 0 1 0 3.8",
    "M3.721 17.609a10 10 0 0 1-2.69-2.69",
    "M6.391 20.279a10 10 0 0 1-2.69-2.69",
    "M20.279 6.39a10 10 0 0 1 2.69 2.69",
  ];
  const buildLassoEllipseCursor = () =>
    buildCompositeIconCursor(
      _circleDashedPaths,
      _lassoEllipseCursorCacheRef,
      false,
    );

  // ── Lasso sub-mode: lasso (free / poly) ──────────────────────────────────
  // Lucide lasso paths (viewBox 0 0 24 24) — flipped horizontally for directionality
  const _lassoPaths = [
    "M7 22a5 5 0 0 1-2-4",
    "M3.3 14A6.8 6.8 0 0 1 2 10c0-4.4 4.5-8 10-8s10 3.6 10 8-4.5 8-10 8a12 12 0 0 1-5-1",
    "M5 18a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  ];
  const buildLassoFreeCursor = () =>
    buildCompositeIconCursor(_lassoPaths, _lassoFreeCursorCacheRef, true); // flip like paint bucket

  // ── Lasso sub-mode: wand-sparkles (magic wand) ───────────────────────────
  // Lucide wand-sparkles paths (viewBox 0 0 24 24) — no flip, naturally faces upper-right
  const _wandSparklesPaths = [
    "m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.21 1.21 0 0 0 1.72 0L21.64 5.36a1.21 1.21 0 0 0 0-1.72",
    "m14 7 3 3",
    "M5 6v4",
    "M19 14v4",
    "M10 2v2",
    "M7 8H3",
    "M21 16h-4",
    "M11 3H9",
  ];
  const buildLassoWandCursor = () =>
    buildCompositeIconCursor(
      _wandSparklesPaths,
      _lassoWandCursorCacheRef,
      false,
    );

  // ── Crop tool: crosshair + crop icon ─────────────────────────────────────
  // Lucide crop paths (viewBox 0 0 24 24) — no flip, standard orientation
  const _cropPaths = ["M6 2v14a2 2 0 0 0 2 2h14", "M18 22V8a2 2 0 0 0-2-2H2"];
  const buildCropIconCursor = () =>
    buildCompositeIconCursor(_cropPaths, _cropIconCursorCacheRef, false);

  // ── Ruler tool: crosshair + ruler icon ───────────────────────────────────
  // Lucide ruler paths (viewBox 0 0 24 24) — flipped so ruler handle faces right
  const _rulerPaths = [
    "M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z",
    "m14.5 12.5 2-2",
    "m11.5 9.5 2-2",
    "m8.5 6.5 2-2",
    "m17.5 15.5 2-2",
  ];
  const buildRulerIconCursor = () =>
    buildCompositeIconCursor(_rulerPaths, _rulerIconCursorCacheRef, true); // flip for directionality

  const buildEyedropperCursor = (
    hoverColor: { r: number; g: number; b: number },
    activeColor: string,
  ): string => {
    const size = 128;
    const c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    const ctx = c.getContext("2d")!;
    const cx = size / 2;
    const cy = size / 2;
    const outerR = 60;
    const innerR = 45;
    // Top half: hovered color
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, outerR, Math.PI, 0);
    ctx.closePath();
    ctx.fillStyle = `rgb(${hoverColor.r},${hoverColor.g},${hoverColor.b})`;
    ctx.fill();
    // Bottom half: active/committed color
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, outerR, 0, Math.PI);
    ctx.closePath();
    ctx.fillStyle = activeColor;
    ctx.fill();
    // Inner hole: transparent
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";
    // Outer ring stroke
    ctx.beginPath();
    ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, outerR + 1.5, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // Inner ring stroke
    ctx.beginPath();
    ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(0,0,0,0.4)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // Divider line (horizontal)
    ctx.beginPath();
    ctx.moveTo(cx - outerR, cy);
    ctx.lineTo(cx + outerR, cy);
    ctx.strokeStyle = "rgba(255,255,255,0.8)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // Center crosshair (5x5px)
    const arm = 2.5;
    ctx.strokeStyle = "rgba(0,0,0,0.8)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - arm, cy);
    ctx.lineTo(cx + arm, cy);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx, cy - arm);
    ctx.lineTo(cx, cy + arm);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.8)";
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(cx - arm, cy);
    ctx.lineTo(cx + arm, cy);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx, cy - arm);
    ctx.lineTo(cx, cy + arm);
    ctx.stroke();
    return c.toDataURL();
  };

  // ── Update eyedropper cursor (called on move and color changes) ───────────
  // biome-ignore lint/correctness/useExhaustiveDependencies: cursor helper fns are stable
  const updateEyedropperCursor = useCallback(() => {
    if (!containerRef.current) return;
    if (activeTool !== "eyedropper") return;
    const [cr2, cg2, cb2] = hsvToRgb(color.h, color.s, color.v);
    const committedColorStr = `rgb(${Math.round(cr2)},${Math.round(cg2)},${Math.round(cb2)})`;
    const hoverColor = eyedropperHoverColorRef.current;
    const dataUrl = buildEyedropperCursor(hoverColor, committedColorStr);
    containerRef.current.style.cursor = `url(${dataUrl}) 64 64, crosshair`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTool, color]);

  useEffect(() => {
    updateEyedropperCursorRef.current = updateEyedropperCursor;
  }, [updateEyedropperCursor]);

  // Trigger eyedropper cursor update when tool or color changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: uses refs
  useEffect(() => {
    updateEyedropperCursor();
  }, [activeTool, color, updateEyedropperCursor]);

  // ── Draws the brush tip outline onto the overlay canvas ───────────────────
  const drawBrushTipOverlay = useCallback(
    (canvas: HTMLCanvasElement, screenSize: number) => {
      const r = Math.max(1, screenSize / 2);
      const padded = Math.max(6, Math.ceil(screenSize) + 8);
      canvas.width = padded;
      canvas.height = padded;
      canvas.style.width = `${padded}px`;
      canvas.style.height = `${padded}px`;
      const ctx = canvas.getContext("2d", { willReadFrequently: !isIPad });
      if (!ctx) return;
      const cx = padded / 2;
      const cy = padded / 2;
      ctx.clearRect(0, 0, padded, padded);
      // Always use the synchronous circle outline — the overlay only needs to show brush SIZE
      ctx.strokeStyle = "rgba(0,0,0,0.65)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    },
    [],
  );

  // ── Main brush cursor update ───────────────────────────────────────────────
  // biome-ignore lint/correctness/useExhaustiveDependencies: cursor helper fns are stable
  const updateBrushCursor = useCallback(() => {
    // Read cursorType / cursorCenter from refs so the function always uses the
    // latest value even when called before a React re-render (e.g. from event handlers).
    const cursorType = cursorTypeRef.current;
    const cursorCenter = cursorCenterRef.current;
    // Immediately clear the software cursor canvas so the previous tool's outline
    // does not linger while the new cursor shape is being computed (may be async).
    {
      const sc = softwareCursorRef.current;
      if (sc) {
        const scCtx = sc.getContext("2d");
        if (scCtx) scCtx.clearRect(0, 0, sc.width, sc.height);
        sc.style.display = "none";
      }
    }
    // When switching away from move/transform, clear the handle override so the
    // new tool's cursor is not blocked by a stale transform cursor value.
    if (activeTool !== "move" && activeTool !== "transform") {
      _transformHandleCursorRef.current = null;
    }
    if (isBrushSizeAdjustingRef.current) return;
    const cursorGen = ++cursorGenRef.current;
    const isBrushTool =
      activeTool === "brush" ||
      activeTool === "eraser" ||
      activeTool === "smudge" ||
      activeTool === "liquify";
    if (!containerRef.current) return;
    // Helper: hide the software cursor canvas (used when showing a non-brush CSS cursor)
    const hideSoftwareCursor = () => {
      const sc = softwareCursorRef.current;
      if (sc) sc.style.display = "none";
    };
    // Helper: for pen input, mirror cursor onto software canvas (CSS cursors are suppressed during pen capture)
    const applyToSoftwareCursor = (src: HTMLCanvasElement) => {
      const sc = softwareCursorRef.current;
      if (!sc) return;
      const pos = pointerScreenPosRef.current;
      // Hide the software cursor until we have a real pointer position
      // (prevents cursor from snapping to top-left on tool switch before the pointer enters the canvas)
      if (pos.x === 0 && pos.y === 0) {
        sc.style.display = "none";
        return;
      }
      sc.width = src.width;
      sc.height = src.height;
      const scCtx = sc.getContext("2d");
      if (scCtx) {
        scCtx.clearRect(0, 0, sc.width, sc.height);
        scCtx.drawImage(src, 0, 0);
      }
      sc.style.display = "block";
      sc.style.left = `${pos.x}px`;
      sc.style.top = `${pos.y}px`;
      if (containerRef.current) containerRef.current.style.cursor = "none";
    };

    // Bug 4 fix: show a ban cursor when a disabled tool is used with multi-layer selection
    const _disabledForMultiSelect = new Set([
      "brush",
      "eraser",
      "fill",
      "smudge",
    ]);
    const _isMultiLayerContext = (selectedLayerIdsRef?.current?.size ?? 0) > 1;

    if (_isMultiLayerContext && _disabledForMultiSelect.has(activeTool)) {
      hideSoftwareCursor();
      if (containerRef.current) {
        // Ban cursor SVG (lucide-ban) encoded as URL-encoded data URI — red, visible on any background
        const banSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="%23ff4444" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M4.929 4.929 19.07 19.071"/></svg>`;
        containerRef.current.style.cursor = `url("data:image/svg+xml,${banSvg}") 16 16, not-allowed`;
      }
      return;
    }

    // Eyedropper cursor is handled separately
    if (activeTool === "eyedropper") {
      hideSoftwareCursor();
      updateEyedropperCursorRef.current();
      return;
    }
    // Lasso cursor — composite crosshair + icon, routed by sub-mode
    if (activeTool === "lasso") {
      hideSoftwareCursor();
      const lassoMode = params.lassoModeRef?.current ?? "free";
      let result: { dataURL: string; hotspotX: number; hotspotY: number };
      if (lassoMode === "rect" || lassoMode === "mask") {
        result = buildLassoRectCursor();
      } else if (lassoMode === "ellipse") {
        result = buildLassoEllipseCursor();
      } else if (lassoMode === "wand") {
        result = buildLassoWandCursor();
      } else {
        // free / poly
        result = buildLassoFreeCursor();
      }
      containerRef.current.style.cursor = `url(${result.dataURL}) ${result.hotspotX} ${result.hotspotY}, crosshair`;
      return;
    }
    // Fill cursor
    if (activeTool === "fill") {
      hideSoftwareCursor();
      const result = buildFillCrosshairWithIconCursor();
      // Hotspot is in CSS (logical) pixels — the crosshair center.
      containerRef.current.style.cursor = `url(${result.dataURL}) ${result.hotspotX} ${result.hotspotY}, crosshair`;
      return;
    }
    // Crop cursor — crosshair + crop icon composite
    if (activeTool === "crop") {
      hideSoftwareCursor();
      const result = buildCropIconCursor();
      containerRef.current.style.cursor = `url(${result.dataURL}) ${result.hotspotX} ${result.hotspotY}, crosshair`;
      return;
    }
    // Ruler cursor — crosshair + ruler icon composite
    if (activeTool === "ruler") {
      hideSoftwareCursor();
      const result = buildRulerIconCursor();
      containerRef.current.style.cursor = `url(${result.dataURL}) ${result.hotspotX} ${result.hotspotY}, crosshair`;
      return;
    }
    // Zoom cursor (Z held or zoom locked) — dot + zoom-in icon
    if (zKeyDownRef.current || zoomLockedRef.current) {
      hideSoftwareCursor();
      const result = buildZoomIconCursor();
      // Hotspot in CSS/logical pixels — the icon center.
      containerRef.current.style.cursor = `url(${result.dataURL}) ${result.hotspotX} ${result.hotspotY}, crosshair`;
      return;
    }
    // Rotate cursor (R held or rotate locked) — dot + rotate-ccw icon
    if (
      rKeyDownRef.current ||
      rotateLockedRef.current ||
      activeTool === "rotate"
    ) {
      hideSoftwareCursor();
      const result = buildRotateIconCursor();
      // Hotspot in CSS/logical pixels — the icon center.
      containerRef.current.style.cursor = `url(${result.dataURL}) ${result.hotspotX} ${result.hotspotY}, crosshair`;
      return;
    }
    // Pan cursor (Space held or pan locked) — dot + hand icon
    if (spaceDownRef.current || panLockedRef.current) {
      hideSoftwareCursor();
      const result = buildPanIconCursor();
      // Hotspot in CSS/logical pixels — the icon center.
      containerRef.current.style.cursor = `url(${result.dataURL}) ${result.hotspotX} ${result.hotspotY}, crosshair`;
      return;
    }
    // Transform cursor — managed imperatively by updateTransformCursorForHandle.
    // Do NOT override here; getCursorStyle() returns the correct value on re-renders.
    if (activeTool === "transform" || activeTool === "move") {
      hideSoftwareCursor();
      return;
    }
    if (!isBrushTool) {
      // Not a brush-type tool and no special cursor override is active.
      // Hide the software cursor canvas and leave the CSS cursor alone — React
      // manages it via getCursorStyle() on the container's style prop.
      hideSoftwareCursor();
      return;
    }
    const rawSize =
      activeTool === "liquify"
        ? liquifySizeRef.current
        : activeTool === "eraser"
          ? brushSizesRef.current.eraser
          : brushSizesRef.current.brush;
    const vt = viewTransformRef.current;
    const screenSize = rawSize * vt.zoom;

    // Crosshair outline cursor always uses a fixed 25x25 canvas (17px arms + padding)
    const padded =
      cursorType === "crosshair" ? 25 : Math.max(6, Math.ceil(screenSize) + 8);
    if (!cursorOffscreenCanvasRef.current) {
      cursorOffscreenCanvasRef.current = document.createElement("canvas");
    }
    const offscreen = cursorOffscreenCanvasRef.current;
    if (offscreen.width !== padded || offscreen.height !== padded) {
      offscreen.width = padded;
      offscreen.height = padded;
    } else {
      offscreen.getContext("2d")?.clearRect(0, 0, padded, padded);
    }
    const ctx = offscreen.getContext("2d", { willReadFrequently: !isIPad });
    if (!ctx) return;
    const cxPos = padded / 2;
    const cyPos = padded / 2;
    const r = Math.max(1, screenSize / 2);
    ctx.clearRect(0, 0, padded, padded);

    const drawCenterCrosshair = () => {
      const armLen = 2.5;
      ctx.strokeStyle = "rgba(0,0,0,0.7)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cxPos - armLen, cyPos);
      ctx.lineTo(cxPos + armLen, cyPos);
      ctx.moveTo(cxPos, cyPos - armLen);
      ctx.lineTo(cxPos, cyPos + armLen);
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255,0.8)";
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(cxPos - armLen, cyPos);
      ctx.lineTo(cxPos + armLen, cyPos);
      ctx.moveTo(cxPos, cyPos - armLen);
      ctx.lineTo(cxPos, cyPos + armLen);
      ctx.stroke();
    };

    const drawDot = () => {
      ctx.fillStyle = "rgba(0,0,0,0.7)";
      ctx.beginPath();
      ctx.arc(cxPos, cyPos, 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.8)";
      ctx.beginPath();
      ctx.arc(cxPos, cyPos, 1, 0, Math.PI * 2);
      ctx.fill();
    };

    const drawCenter = () => {
      if (cursorCenter === "dot") {
        drawDot();
        return;
      }
      if (cursorCenter === "crosshair") {
        drawCenterCrosshair();
      }
    };

    const drawOutlineCrosshair = () => {
      // Fixed 17x17px crosshair — does not scale with brush size
      const arm = 8.5;
      ctx.strokeStyle = "rgba(0,0,0,0.6)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cxPos - arm, cyPos);
      ctx.lineTo(cxPos + arm, cyPos);
      ctx.moveTo(cxPos, cyPos - arm);
      ctx.lineTo(cxPos, cyPos + arm);
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255,0.7)";
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(cxPos - arm, cyPos);
      ctx.lineTo(cxPos + arm, cyPos);
      ctx.moveTo(cxPos, cyPos - arm);
      ctx.lineTo(cxPos, cyPos + arm);
      ctx.stroke();
    };

    // Liquify tool: always use circle + crosshair at liquify size
    if (activeTool === "liquify") {
      const liqRadius = Math.max(1, r - 1);
      // Outer black ring
      ctx.strokeStyle = "rgba(0,0,0,0.6)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cxPos, cyPos, liqRadius, 0, Math.PI * 2);
      ctx.stroke();
      // Inner white ring
      ctx.strokeStyle = "rgba(255,255,255,0.8)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cxPos, cyPos, liqRadius, 0, Math.PI * 2);
      ctx.stroke();
      // Crosshair arms (scaled to brush size, capped at reasonable length)
      const armLen = Math.min(liqRadius * 0.35, 10);
      ctx.strokeStyle = "rgba(0,0,0,0.7)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cxPos - armLen, cyPos);
      ctx.lineTo(cxPos + armLen, cyPos);
      ctx.moveTo(cxPos, cyPos - armLen);
      ctx.lineTo(cxPos, cyPos + armLen);
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.lineWidth = 0.75;
      ctx.beginPath();
      ctx.moveTo(cxPos - armLen, cyPos);
      ctx.lineTo(cxPos + armLen, cyPos);
      ctx.moveTo(cxPos, cyPos - armLen);
      ctx.lineTo(cxPos, cyPos + armLen);
      ctx.stroke();
      if (containerRef.current) {
        applyToSoftwareCursor(offscreen);
      }
      return;
    }
    if (cursorType === "brush-outline" && brushSettings.tipImageData) {
      // Render brush tip as an outline cursor
      const img = new Image();
      img.onload = () => {
        ctx.clearRect(0, 0, padded, padded);

        // Step 1: draw tip onto temp canvas, build alpha mask (black=opaque, white=transparent)
        const tmpCanvas = document.createElement("canvas");
        tmpCanvas.width = padded;
        tmpCanvas.height = padded;
        const tmpCtx = tmpCanvas.getContext("2d", {
          willReadFrequently: !isIPad,
        })!;
        tmpCtx.drawImage(img, cxPos - r, cyPos - r, r * 2, r * 2);
        const rawData = tmpCtx.getImageData(0, 0, padded, padded);

        // Build black alpha mask
        const maskData = tmpCtx.createImageData(padded, padded);
        for (let i = 0; i < rawData.data.length; i += 4) {
          const brightness =
            (rawData.data[i] + rawData.data[i + 1] + rawData.data[i + 2]) / 3;
          const a =
            rawData.data[i + 3] > 0
              ? Math.round((1 - brightness / 255) * 255)
              : 0;
          maskData.data[i] = 0;
          maskData.data[i + 1] = 0;
          maskData.data[i + 2] = 0;
          maskData.data[i + 3] = a;
        }
        tmpCtx.putImageData(maskData, 0, 0);
        const maskDataUrl = tmpCanvas.toDataURL();

        // Step 2: outer black ring = expanded tip minus exact tip
        const outerCanvas = document.createElement("canvas");
        outerCanvas.width = padded;
        outerCanvas.height = padded;
        const outerCtx = outerCanvas.getContext("2d", {
          willReadFrequently: !isIPad,
        })!;
        outerCtx.drawImage(
          tmpCanvas,
          cxPos - r - 1.5,
          cyPos - r - 1.5,
          (r + 1.5) * 2,
          (r + 1.5) * 2,
        );
        const maskImg = new Image();
        maskImg.onload = () => {
          if (cursorGenRef.current !== cursorGen) return;
          outerCtx.globalCompositeOperation = "destination-out";
          outerCtx.drawImage(maskImg, cxPos - r, cyPos - r, r * 2, r * 2);
          outerCtx.globalCompositeOperation = "source-over";

          // Step 3: white inner ring
          const innerCanvas = document.createElement("canvas");
          innerCanvas.width = padded;
          innerCanvas.height = padded;
          const innerCtx = innerCanvas.getContext("2d", {
            willReadFrequently: !isIPad,
          })!;
          const whiteMask = innerCtx.createImageData(padded, padded);
          for (let i = 0; i < rawData.data.length; i += 4) {
            const brightness =
              (rawData.data[i] + rawData.data[i + 1] + rawData.data[i + 2]) / 3;
            const a =
              rawData.data[i + 3] > 0
                ? Math.round((1 - brightness / 255) * 200)
                : 0;
            whiteMask.data[i] = 255;
            whiteMask.data[i + 1] = 255;
            whiteMask.data[i + 2] = 255;
            whiteMask.data[i + 3] = a;
          }
          innerCtx.putImageData(whiteMask, 0, 0);
          innerCtx.globalCompositeOperation = "destination-out";
          innerCtx.drawImage(
            maskImg,
            cxPos - r + 1,
            cyPos - r + 1,
            (r - 1) * 2,
            (r - 1) * 2,
          );
          innerCtx.globalCompositeOperation = "source-over";

          // Composite both rings
          ctx.drawImage(outerCanvas, 0, 0);
          ctx.drawImage(innerCanvas, 0, 0);

          drawCenter();
          cursorBuildingRef.current = false;
          applyToSoftwareCursor(offscreen);
        };
        maskImg.src = maskDataUrl;
      };
      cursorBuildingRef.current = true;
      img.src = brushSettings.tipImageData;
      if (containerRef.current) containerRef.current.style.cursor = "none";
      return;
    }

    // Crosshair outline cursor
    if (cursorType === "crosshair") {
      drawOutlineCrosshair();
      if (cursorCenter !== "crosshair") {
        drawCenter();
      }
      if (containerRef.current) {
        applyToSoftwareCursor(offscreen);
      }
      return;
    }

    // Default: circle cursor
    const radius = Math.max(1, r - 1);
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cxPos, cyPos, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.8)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cxPos, cyPos, radius, 0, Math.PI * 2);
    ctx.stroke();
    drawCenter();
    if (containerRef.current) {
      applyToSoftwareCursor(offscreen);
    }
  }, [
    activeTool,
    cursorType,
    cursorCenter,
    brushSettings.tipImageData,
    liquifySize,
  ]);

  useEffect(() => {
    updateBrushCursorRef.current = updateBrushCursor;
  }, [updateBrushCursor]);

  // ── Re-apply cursor when Settings panel changes cursor preferences ─────────
  // SettingsPanel writes to sk-cursor-type / sk-cursor-center then dispatches
  // 'sl:cursor-settings-changed'. We re-read those keys and rebuild the cursor.
  // Note: setCursorType/setCursorCenter schedule async state updates; we also
  // store the latest values in refs so updateBrushCursorRef can use them
  // immediately without waiting for the next render cycle.
  const cursorTypeRef = useRef(cursorType);
  const cursorCenterRef = useRef(cursorCenter);
  useEffect(() => {
    cursorTypeRef.current = cursorType;
  }, [cursorType]);
  useEffect(() => {
    cursorCenterRef.current = cursorCenter;
  }, [cursorCenter]);

  useEffect(() => {
    const handler = () => {
      const stored = localStorage.getItem("sk-cursor-type");
      if (
        stored === "brush-outline" ||
        stored === "crosshair" ||
        stored === "circle"
      ) {
        setCursorType(stored);
        cursorTypeRef.current = stored;
      }
      const storedCenter = localStorage.getItem("sk-cursor-center");
      if (
        storedCenter === "crosshair" ||
        storedCenter === "dot" ||
        storedCenter === "none"
      ) {
        setCursorCenter(storedCenter);
        cursorCenterRef.current = storedCenter;
      }
      // Rebuild cursor immediately using the latest values from the refs.
      // The React state update will also trigger a re-render + useEffect rebuild,
      // but calling via ref here ensures the visual updates without waiting.
      requestAnimationFrame(() => updateBrushCursorRef.current());
    };
    window.addEventListener("sl:cursor-settings-changed", handler);
    return () =>
      window.removeEventListener("sl:cursor-settings-changed", handler);
  }, []);

  // Re-run cursor update when relevant state changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: updateBrushCursor uses refs
  useEffect(() => {
    // Clear lasso sub-mode caches so the correct icon is shown immediately on mode switch
    if (activeTool === "lasso") {
      _lassoRectCursorCacheRef.current = null;
      _lassoEllipseCursorCacheRef.current = null;
      _lassoFreeCursorCacheRef.current = null;
      _lassoWandCursorCacheRef.current = null;
    }
    updateBrushCursor();
  }, [
    activeTool,
    brushSettings.tipImageData,
    brushSettings.softness,
    cursorType,
    cursorCenter,
    zoomLocked,
    rotateLocked,
    panLocked,
    params.lassoMode,
    updateBrushCursor,
  ]);

  // ── getCursorStyle — used in JSX container style prop ────────────────────
  const getCursorStyle = (): string => {
    // Grab/pan cursors — always take precedence
    if (isPanningRef.current) return "grabbing";
    if (spaceDownRef.current || panLocked) return "grab";
    // Move/transform: cursor is managed imperatively by updateTransformCursorForHandle.
    // Return the stored override so React re-renders never reset it to "none" or the default.
    if (activeTool === "move" || activeTool === "transform") {
      if (_transformHandleCursorRef.current)
        return _transformHandleCursorRef.current;
      // No active transform yet — build and cache the default move cursor.
      // Hotspot in CSS/logical pixels — the icon center.
      const { dataURL, hotspotX, hotspotY } = buildTransformIconCursor();
      return `url(${dataURL}) ${hotspotX} ${hotspotY}, crosshair`;
    }
    // Brush-type tools: software cursor canvas + CSS none (set by applyToSoftwareCursor)
    if (
      activeTool === "brush" ||
      activeTool === "eraser" ||
      activeTool === "smudge" ||
      activeTool === "liquify"
    )
      return "none";
    // Eyedropper: updateEyedropperCursor sets cursor directly; use crosshair as base
    if (activeTool === "eyedropper") return "crosshair";
    // Lasso, fill, crop, ruler, zoom-locked, rotate-locked: use CSS crosshair as reliable base;
    // updateBrushCursor will overlay the custom data-URI cursor if available.
    if (activeTool === "lasso") return "crosshair";
    if (activeTool === "fill") return "crosshair";
    if (activeTool === "crop") return "crosshair";
    if (activeTool === "ruler") return "crosshair";
    if (zoomLocked || rotateLocked) return "crosshair";
    if (activeTool === "rotate") return "crosshair";
    // All other tools: default browser cursor
    return "";
  };

  // ── Sample eyedropper color at canvas position ───────────────────────────
  const sampleEyedropperColor = (
    x: number,
    y: number,
  ): { r: number; g: number; b: number } => {
    let sourceCanvas: HTMLCanvasElement | null | undefined = null;
    if (eyedropperSampleSourceRef.current === "layer") {
      // Sample from the active layer canvas
      sourceCanvas = layerCanvasesRef.current.get(activeLayerIdRef.current);
    } else {
      sourceCanvas = displayCanvasRef.current;
    }
    if (!sourceCanvas) return { r: 0, g: 0, b: 0 };
    const ctx = sourceCanvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return { r: 0, g: 0, b: 0 };
    const size = eyedropperSampleSizeRef.current;
    if (size === 1) {
      const cx = Math.round(Math.max(0, Math.min(x, sourceCanvas.width - 1)));
      const cy = Math.round(Math.max(0, Math.min(y, sourceCanvas.height - 1)));
      const pixel = ctx.getImageData(cx, cy, 1, 1).data;
      return { r: pixel[0], g: pixel[1], b: pixel[2] };
    }
    const half = Math.floor(size / 2);
    const x0 = Math.max(0, Math.round(x) - half);
    const y0 = Math.max(0, Math.round(y) - half);
    const x1 = Math.min(sourceCanvas.width - 1, Math.round(x) + half);
    const y1 = Math.min(sourceCanvas.height - 1, Math.round(y) + half);
    const w = x1 - x0 + 1;
    const h = y1 - y0 + 1;
    if (w <= 0 || h <= 0) return { r: 0, g: 0, b: 0 };
    const data = ctx.getImageData(x0, y0, w, h).data;
    let rSum = 0;
    let gSum = 0;
    let bSum = 0;
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] > 0) {
        rSum += data[i];
        gSum += data[i + 1];
        bSum += data[i + 2];
        count++;
      }
    }
    if (count === 0) {
      // All transparent — average everything
      for (let i = 0; i < data.length; i += 4) {
        rSum += data[i];
        gSum += data[i + 1];
        bSum += data[i + 2];
      }
      count = data.length / 4;
    }
    return {
      r: Math.round(rSum / count),
      g: Math.round(gSum / count),
      b: Math.round(bSum / count),
    };
  };

  return {
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
  };
}
