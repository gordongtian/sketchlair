import type { HSVAColor } from "@/utils/colorUtils";
import { hsvToRgb } from "@/utils/colorUtils";
import { useCallback, useEffect, useRef, useState } from "react";
import type { BrushSettings } from "../components/BrushSettingsPanel";
import type { LassoMode, Tool } from "../components/Toolbar";
import type { LayerNode } from "../types";
import type { ViewTransform } from "../types";
import { findNode, getEffectivelySelectedLayers } from "../utils/layerTree";

// ── isIPad (mirrors the constant in PaintingApp, safe to re-evaluate here) ───
const isIPad =
  typeof navigator !== "undefined" &&
  (/iPad/.test(navigator.userAgent) ||
    (/Mac/.test(navigator.userAgent) && navigator.maxTouchPoints > 1));

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
  layerTreeRef: React.MutableRefObject<LayerNode[]>;
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
    lassoModeRef,
    liquifySizeRef,
    brushSizesRef,
    viewTransformRef,
    eyedropperHoverColorRef,
    layerCanvasesRef,
    layerTreeRef,
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

  // ── Icon cursor cache refs ────────────────────────────────────────────────
  const _zoomCursorCacheRef = useRef<string | null>(null);
  const _rotateCursorCacheRef = useRef<string | null>(null);

  // ── Stable refs for callbacks ─────────────────────────────────────────────
  const updateBrushCursorRef = useRef<() => void>(() => {});
  const updateEyedropperCursorRef = useRef<() => void>(() => {});

  // ── Initialize software cursor as hidden ──────────────────────────────────
  useEffect(() => {
    if (softwareCursorRef.current) {
      softwareCursorRef.current.style.display = "none";
    }
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

  const buildLassoCursor = (mode: string): string => {
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

  const buildFillCursor = (): string => {
    return buildIconCursor((ctx) => {
      // PaintBucket icon
      ctx.beginPath();
      ctx.moveTo(19, 11);
      ctx.lineTo(11, 3);
      ctx.lineTo(2.5, 11.5);
      ctx.quadraticCurveTo(2.5, 19, 10.28, 19);
      ctx.quadraticCurveTo(14, 19, 19, 11);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(5, 2);
      ctx.lineTo(10, 7);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(2, 13);
      ctx.lineTo(17, 13);
      ctx.stroke();
      // water drop
      ctx.beginPath();
      ctx.arc(22, 20, 2, 0, Math.PI * 2);
      ctx.fillStyle = "#000";
      ctx.fill();
    });
  };

  // Memoize: these are pure canvas operations — computed once, cached for lifetime of component
  const buildZoomCursor = (): string => {
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

  const buildRotateCursor = (): string => {
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
    const _isMultiLayerContext = (() => {
      const selIds = selectedLayerIdsRef?.current ?? new Set<string>();
      if (selIds.size > 1) return true;
      for (const id of selIds) {
        const found = findNode(layerTreeRef?.current ?? [], id);
        if (found && found.node.kind === "group") return true;
      }
      return false;
    })();

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
    // Lasso cursor
    if (activeTool === "lasso") {
      hideSoftwareCursor();
      const dataUrl = buildLassoCursor(lassoModeRef.current);
      containerRef.current.style.cursor = `url(${dataUrl}) 2 38, crosshair`;
      return;
    }
    // Fill cursor
    if (activeTool === "fill") {
      hideSoftwareCursor();
      const dataUrl = buildFillCursor();
      containerRef.current.style.cursor = `url(${dataUrl}) 2 38, crosshair`;
      return;
    }
    // Zoom cursor (Z held or zoom locked)
    if (zKeyDownRef.current || zoomLockedRef.current) {
      hideSoftwareCursor();
      const dataUrl = buildZoomCursor();
      containerRef.current.style.cursor = `url(${dataUrl}) 2 38, zoom-in`;
      return;
    }
    // Rotate cursor (R held or rotate locked)
    if (
      rKeyDownRef.current ||
      rotateLockedRef.current ||
      activeTool === "rotate"
    ) {
      hideSoftwareCursor();
      const dataUrl = buildRotateCursor();
      containerRef.current.style.cursor = `url(${dataUrl}) 2 38, crosshair`;
      return;
    }
    // Pan cursor (Space held or pan locked)
    if (spaceDownRef.current || panLockedRef.current) {
      hideSoftwareCursor();
      if (isPanningRef.current) {
        containerRef.current.style.cursor = "grabbing";
      } else {
        const panDataUrl = buildIconCursor((ctx) => {
          // Hand icon
          ctx.beginPath();
          ctx.moveTo(18, 11);
          ctx.lineTo(18, 6);
          ctx.quadraticCurveTo(18, 4, 16, 4);
          ctx.quadraticCurveTo(14, 4, 14, 6);
          ctx.lineTo(14, 6);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(14, 10);
          ctx.lineTo(14, 4);
          ctx.quadraticCurveTo(14, 2, 12, 2);
          ctx.quadraticCurveTo(10, 2, 10, 4);
          ctx.lineTo(10, 14);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(10, 10.5);
          ctx.quadraticCurveTo(10, 8.5, 8, 8.5);
          ctx.quadraticCurveTo(6, 8.5, 6, 10.5);
          ctx.lineTo(6, 12);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(6, 14);
          ctx.quadraticCurveTo(6, 12, 4, 12);
          ctx.quadraticCurveTo(2, 12, 2, 14);
          ctx.lineTo(2, 16);
          ctx.quadraticCurveTo(2, 20, 4, 21.5);
          ctx.lineTo(5.3, 22.8);
          ctx.quadraticCurveTo(6.1, 23.4, 7.4, 23.4);
          ctx.lineTo(16, 23.4);
          ctx.quadraticCurveTo(18, 23.4, 18, 21.4);
          ctx.lineTo(18, 19.4);
          ctx.quadraticCurveTo(18, 17.4, 16, 17.4);
          ctx.lineTo(6, 17.4);
          ctx.stroke();
        });
        containerRef.current.style.cursor = `url(${panDataUrl}) 2 38, grab`;
      }
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

  // Re-run cursor update when relevant state changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: updateBrushCursor uses refs
  useEffect(() => {
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
    updateBrushCursor,
  ]);

  // ── getCursorStyle — used in JSX container style prop ────────────────────
  const getCursorStyle = (): string => {
    // Grab/pan cursors — always take precedence
    if (isPanningRef.current) return "grabbing";
    if (spaceDownRef.current || panLocked) return "grab";
    // Move/transform: React manages grab cursor; updateBrushCursor does not override these
    if (activeTool === "move" || activeTool === "transform") return "grab";
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
    // Lasso, fill, zoom-locked, rotate-locked: use CSS crosshair as reliable base;
    // updateBrushCursor will overlay the custom data-URI cursor if available.
    if (activeTool === "lasso") return "crosshair";
    if (activeTool === "fill") return "crosshair";
    if (zoomLocked || rotateLocked) return "crosshair";
    if (activeTool === "rotate") return "crosshair";
    // All other tools (crop, rulers, etc.): default browser cursor
    return "";
  };

  // ── Sample eyedropper color at canvas position ───────────────────────────
  const sampleEyedropperColor = (
    x: number,
    y: number,
  ): { r: number; g: number; b: number } => {
    let sourceCanvas: HTMLCanvasElement | null | undefined = null;
    if (eyedropperSampleSourceRef.current === "layer") {
      // Multi-select: composite all selected layers into a temp canvas and sample from it
      const _effectiveSel = getEffectivelySelectedLayers(
        layerTreeRef.current,
        selectedLayerIdsRef.current,
      );
      if (_effectiveSel.length > 1) {
        const refLc = layerCanvasesRef.current.get(activeLayerIdRef.current);
        if (refLc) {
          const tmpC = document.createElement("canvas");
          tmpC.width = refLc.width;
          tmpC.height = refLc.height;
          const tmpCtx = tmpC.getContext("2d", { willReadFrequently: true })!;
          for (const layerItem of _effectiveSel) {
            const lc2 = layerCanvasesRef.current.get(layerItem.layer.id);
            if (!lc2) continue;
            tmpCtx.globalAlpha = layerItem.layer.opacity ?? 1;
            tmpCtx.drawImage(lc2, 0, 0);
          }
          tmpCtx.globalAlpha = 1;
          sourceCanvas = tmpC;
        }
      } else {
        sourceCanvas = layerCanvasesRef.current.get(activeLayerIdRef.current);
      }
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
  };
}
