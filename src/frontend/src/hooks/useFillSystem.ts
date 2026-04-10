import type { HSVAColor } from "@/utils/colorUtils";
import { generateLayerThumbnail, hsvToRgb } from "@/utils/colorUtils";
import { bfsFloodFill } from "@/utils/selectionUtils";
import { getThumbCanvas, getThumbCtx } from "@/utils/thumbnailCache";
import type React from "react";
import { useCallback, useRef, useState } from "react";
import type { FillMode, FillSettings } from "../components/FillPresetsPanel";
import type { Layer } from "../components/LayersPanel";
import { markCanvasDirty, markLayerBitmapDirty } from "./useCompositing";
import type { UndoEntry } from "./useLayerSystem";

/**
 * useFillSystem — owns all fill tool state and callbacks.
 *
 * Extracted from PaintingApp.tsx (structural refactor only, zero logic changes).
 * Handles: flood fill, gradient fill, lasso fill
 */

export interface FillSystemParams {
  /** isIPad flag for willReadFrequently optimization */
  isIPad: boolean;

  /** Current HSVA color (ref) */
  colorRef: React.MutableRefObject<HSVAColor>;

  /** Active layer id (ref) */
  activeLayerIdRef: React.MutableRefObject<string>;

  /** All flat layers (ref) */
  layersRef: React.MutableRefObject<Layer[]>;

  /** Layer canvases map (ref) */
  layerCanvasesRef: React.MutableRefObject<Map<string, HTMLCanvasElement>>;

  /** Selection mask canvas (ref) — null when no selection */
  selectionMaskRef: React.MutableRefObject<HTMLCanvasElement | null>;

  /** Whether selection is active (ref) */
  selectionActiveRef: React.MutableRefObject<boolean>;

  /** Stroke-start snapshot ref used for lasso fill undo */
  strokeStartSnapshotRef: React.MutableRefObject<{
    pixels: ImageData;
    x: number;
    y: number;
  } | null>;

  /** Push a history entry */
  pushHistory: (entry: UndoEntry) => void;

  /** Trigger a compositing pass */
  composite: () => void;

  /** Schedule a deferred composite */
  scheduleComposite: () => void;
}

export interface FillSystemReturn {
  // State
  fillMode: FillMode;
  setFillMode: React.Dispatch<React.SetStateAction<FillMode>>;
  fillSettings: FillSettings;
  setFillSettings: React.Dispatch<React.SetStateAction<FillSettings>>;

  // Refs (used by PaintingApp event handlers directly)
  fillModeRef: React.MutableRefObject<FillMode>;
  fillSettingsRef: React.MutableRefObject<FillSettings>;

  // Lasso fill drag state refs
  lassoFillOriginRef: React.MutableRefObject<{ x: number; y: number } | null>;
  lassoFillLastPtRef: React.MutableRefObject<{ x: number; y: number } | null>;
  isLassoFillDrawingRef: React.MutableRefObject<boolean>;
  lassoFillSmoothedPtRef: React.MutableRefObject<{
    x: number;
    y: number;
  } | null>;
  lassoFillPointsRef: React.MutableRefObject<{ x: number; y: number }[]>;

  // Gradient fill drag state refs
  gradientDragStartRef: React.MutableRefObject<{ x: number; y: number } | null>;
  gradientDragEndRef: React.MutableRefObject<{ x: number; y: number } | null>;
  isGradientDraggingRef: React.MutableRefObject<boolean>;

  // Core fill functions
  floodFillWithTolerance: (
    lc: HTMLCanvasElement,
    px: number,
    py: number,
    fr: number,
    fg: number,
    fb: number,
    fa: number,
    tolerance: number,
    contiguous?: boolean,
  ) => void;
  applyLassoFill: (
    lc: HTMLCanvasElement,
    points: { x: number; y: number }[],
    fr: number,
    fg: number,
    fb: number,
  ) => void;

  /** Pointer-down handler for the fill tool */
  handleFillPointerDown: (
    pos: { x: number; y: number },
    layerId: string,
    lc: HTMLCanvasElement,
  ) => void;
  /** Pointer-move handler for gradient & lasso fill drags. Returns true if the event was consumed. */
  handleFillPointerMove: (
    e: PointerEvent,
    getCanvasPos: (
      clientX: number,
      clientY: number,
    ) => { x: number; y: number },
  ) => boolean;
  /** Pointer-up handler for gradient & lasso fill commits */
  handleFillPointerUp: () => void;
}

export function useFillSystem(params: FillSystemParams): FillSystemReturn {
  const {
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
  } = params;

  // ── State ────────────────────────────────────────────────────────────────
  const [fillMode, setFillMode] = useState<FillMode>("flood");
  const fillModeRef = useRef<FillMode>("flood");

  const [fillSettings, setFillSettings] = useState<FillSettings>({
    tolerance: 30,
    gradientMode: "linear",
    contiguous: true,
  });
  const fillSettingsRef = useRef<FillSettings>({
    tolerance: 30,
    gradientMode: "linear",
    contiguous: true,
  });

  // ── Lasso fill drag state ────────────────────────────────────────────────
  const lassoFillOriginRef = useRef<{ x: number; y: number } | null>(null);
  const lassoFillLastPtRef = useRef<{ x: number; y: number } | null>(null);
  const isLassoFillDrawingRef = useRef(false);
  const lassoFillSmoothedPtRef = useRef<{ x: number; y: number } | null>(null);
  const lassoFillPointsRef = useRef<{ x: number; y: number }[]>([]);

  // ── Gradient fill drag state ─────────────────────────────────────────────
  const gradientDragStartRef = useRef<{ x: number; y: number } | null>(null);
  const gradientDragEndRef = useRef<{ x: number; y: number } | null>(null);
  const isGradientDraggingRef = useRef(false);

  // ── floodFillWithTolerance ───────────────────────────────────────────────
  // biome-ignore lint/correctness/useExhaustiveDependencies: selection refs are stable
  const floodFillWithTolerance = useCallback(
    (
      lc: HTMLCanvasElement,
      px: number,
      py: number,
      fr: number,
      fg: number,
      fb: number,
      fa: number,
      tolerance: number,
      contiguous = true,
    ) => {
      const ctx = lc.getContext("2d", { willReadFrequently: !isIPad });
      if (!ctx) return;
      const { width, height } = lc;
      const x = Math.round(px);
      const y = Math.round(py);
      if (x < 0 || x >= width || y < 0 || y >= height) return;
      const imgData = ctx.getImageData(0, 0, width, height);
      const data = imgData.data;
      // Build selection mask if active
      let selData: Uint8ClampedArray | null = null;
      if (selectionMaskRef.current && selectionActiveRef.current) {
        const selCtx = selectionMaskRef.current.getContext("2d", {
          willReadFrequently: !isIPad,
        });
        if (selCtx) selData = selCtx.getImageData(0, 0, width, height).data;
      }

      // If the active layer is a clipping mask, constrain the fill to the base layer's alpha.
      const activeLayerFill = layersRef.current.find(
        (l) => l.id === activeLayerIdRef.current,
      );
      if (activeLayerFill?.isClippingMask) {
        const ls = layersRef.current;
        const aIdx = ls.findIndex((l) => l.id === activeLayerIdRef.current);
        let baseLayer: (typeof ls)[0] | null = null;
        for (let j = aIdx + 1; j < ls.length; j++) {
          if (!ls[j].isClippingMask) {
            baseLayer = ls[j];
            break;
          }
        }
        if (baseLayer) {
          const baseLc = layerCanvasesRef.current.get(baseLayer.id);
          if (baseLc) {
            const baseCtx = baseLc.getContext("2d", {
              willReadFrequently: !isIPad,
            });
            if (baseCtx) {
              const baseData = baseCtx.getImageData(0, 0, width, height).data;
              const combined = new Uint8ClampedArray(width * height * 4);
              for (let i = 0; i < width * height; i++) {
                const ai = i * 4 + 3;
                const baseAlpha = baseData[ai];
                const selAlpha = selData ? selData[ai] : 255;
                const clipped = Math.min(baseAlpha, selAlpha);
                combined[ai] = clipped;
              }
              selData = combined;
            }
          }
        }
      }

      const fillMask = bfsFloodFill(
        data,
        width,
        height,
        x,
        y,
        tolerance,
        contiguous,
        selData,
      );
      for (let i = 0; i < fillMask.length; i++) {
        if (fillMask[i]) {
          const pi = i * 4;
          data[pi] = fr;
          data[pi + 1] = fg;
          data[pi + 2] = fb;
          data[pi + 3] = fa;
        }
      }
      ctx.putImageData(imgData, 0, 0);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // ── applyLassoFill ───────────────────────────────────────────────────────
  // biome-ignore lint/correctness/useExhaustiveDependencies: selection refs from hook are stable
  const applyLassoFill = useCallback(
    (
      lc: HTMLCanvasElement,
      points: { x: number; y: number }[],
      fr: number,
      fg: number,
      fb: number,
    ) => {
      if (points.length < 3) return;
      const ctx = lc.getContext("2d", { willReadFrequently: !isIPad });
      if (!ctx) return;
      ctx.save();
      // Clip to selection if active
      if (selectionMaskRef.current && selectionActiveRef.current) {
        ctx.globalCompositeOperation = "source-over";
        const tempC = document.createElement("canvas");
        tempC.width = lc.width;
        tempC.height = lc.height;
        const tempCtx = tempC.getContext("2d", {
          willReadFrequently: !isIPad,
        })!;
        tempCtx.imageSmoothingEnabled = true;
        tempCtx.beginPath();
        tempCtx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++)
          tempCtx.lineTo(points[i].x, points[i].y);
        tempCtx.closePath();
        tempCtx.fillStyle = `rgb(${fr},${fg},${fb})`;
        tempCtx.fill();
        tempCtx.globalCompositeOperation = "source-over";
        tempCtx.strokeStyle = `rgb(${fr},${fg},${fb})`;
        tempCtx.lineWidth = 2;
        tempCtx.stroke();
        // Smooth the outer edge specifically with a wider stroke
        tempCtx.beginPath();
        tempCtx.moveTo(points[1].x, points[1].y);
        tempCtx.lineTo(points[2].x, points[2].y);
        tempCtx.strokeStyle = `rgb(${fr},${fg},${fb})`;
        tempCtx.lineWidth = 3;
        tempCtx.stroke();
        tempCtx.globalCompositeOperation = "destination-in";
        tempCtx.drawImage(selectionMaskRef.current, 0, 0);
        ctx.drawImage(tempC, 0, 0);
      } else {
        ctx.imageSmoothingEnabled = true;
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++)
          ctx.lineTo(points[i].x, points[i].y);
        ctx.closePath();
        ctx.fillStyle = `rgb(${fr},${fg},${fb})`;
        ctx.fill();
        ctx.strokeStyle = `rgb(${fr},${fg},${fb})`;
        ctx.lineWidth = 2;
        ctx.stroke();
        // Smooth the outer edge specifically with a wider stroke
        ctx.beginPath();
        ctx.moveTo(points[1].x, points[1].y);
        ctx.lineTo(points[2].x, points[2].y);
        ctx.strokeStyle = `rgb(${fr},${fg},${fb})`;
        ctx.lineWidth = 3;
        ctx.stroke();
      }
      ctx.restore();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // ── handleFillPointerDown ────────────────────────────────────────────────
  // biome-ignore lint/correctness/useExhaustiveDependencies: params is stable
  const handleFillPointerDown = useCallback(
    (pos: { x: number; y: number }, layerId: string, lc: HTMLCanvasElement) => {
      const mode = fillModeRef.current;
      const fSettings = fillSettingsRef.current;
      const col = colorRef.current;

      if (mode === "flood") {
        const [r, g, b] = hsvToRgb(col.h, col.s, col.v);
        const fa = Math.round(col.a * 255);
        const tol = fSettings.tolerance;
        const [fr, fg, fb] = [Math.round(r), Math.round(g), Math.round(b)];
        const lcCtxFlood = lc.getContext("2d", {
          willReadFrequently: !isIPad,
        });
        const beforeFlood =
          lcCtxFlood?.getImageData(0, 0, lc.width, lc.height) ?? null;
        floodFillWithTolerance(
          lc,
          pos.x,
          pos.y,
          fr,
          fg,
          fb,
          fa,
          tol,
          fSettings.contiguous ?? true,
        );
        composite();
        markLayerBitmapDirty(layerId);
        const afterFlood =
          lcCtxFlood?.getImageData(0, 0, lc.width, lc.height) ?? null;
        if (beforeFlood && afterFlood) {
          pushHistory({
            type: "pixels",
            layerId,
            before: beforeFlood,
            after: afterFlood,
          });
        }
        markCanvasDirty(layerId);
        return;
      }

      if (mode === "gradient") {
        gradientDragStartRef.current = { x: pos.x, y: pos.y };
        gradientDragEndRef.current = { x: pos.x, y: pos.y };
        isGradientDraggingRef.current = true;
        return;
      }

      if (mode === "lasso") {
        const layerCtxLF = lc.getContext("2d", {
          willReadFrequently: !isIPad,
        });
        if (layerCtxLF) {
          strokeStartSnapshotRef.current = {
            pixels: layerCtxLF.getImageData(0, 0, lc.width, lc.height),
            x: 0,
            y: 0,
          };
        }
        isLassoFillDrawingRef.current = true;
        lassoFillOriginRef.current = { x: pos.x, y: pos.y };
        lassoFillLastPtRef.current = { x: pos.x, y: pos.y };
        lassoFillSmoothedPtRef.current = { x: pos.x, y: pos.y };
        lassoFillPointsRef.current = [{ x: pos.x, y: pos.y }];
        scheduleComposite();
        return;
      }
    },
    // biome-ignore lint/correctness/useExhaustiveDependencies: params is stable, setLayerThumbnails/updateNav used via params
    [
      colorRef,
      composite,
      floodFillWithTolerance,
      isIPad,
      params,
      pushHistory,
      scheduleComposite,
      strokeStartSnapshotRef,
    ],
  );

  // ── handleFillPointerMove ────────────────────────────────────────────────
  const handleFillPointerMove = useCallback(
    (
      e: PointerEvent,
      getCanvasPos: (
        clientX: number,
        clientY: number,
      ) => { x: number; y: number },
    ): boolean => {
      // Handle gradient fill drag preview
      if (isGradientDraggingRef.current) {
        const posG = getCanvasPos(e.clientX, e.clientY);
        gradientDragEndRef.current = { x: posG.x, y: posG.y };
        scheduleComposite();
        return true; // consumed
      }

      // Handle lasso fill drawing: collect points
      if (isLassoFillDrawingRef.current) {
        const posLF = getCanvasPos(e.clientX, e.clientY);
        // Apply exponential smoothing to lasso fill cursor position
        const prevSmoothed = lassoFillSmoothedPtRef.current ?? posLF;
        const alpha = 0.7;
        const smoothedLF = {
          x: prevSmoothed.x * (1 - alpha) + posLF.x * alpha,
          y: prevSmoothed.y * (1 - alpha) + posLF.y * alpha,
        };
        lassoFillSmoothedPtRef.current = smoothedLF;
        const prev = lassoFillLastPtRef.current;
        if (prev) {
          const dx = smoothedLF.x - prev.x;
          const dy = smoothedLF.y - prev.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist >= 1) {
            lassoFillPointsRef.current.push({
              x: smoothedLF.x,
              y: smoothedLF.y,
            });
            lassoFillLastPtRef.current = {
              x: smoothedLF.x,
              y: smoothedLF.y,
            };
            scheduleComposite();
          }
        }
        return true; // consumed
      }

      return false; // not consumed
    },
    [scheduleComposite],
  );

  // ── handleFillPointerUp ──────────────────────────────────────────────────
  // biome-ignore lint/correctness/useExhaustiveDependencies: params is stable
  const handleFillPointerUp = useCallback(() => {
    // Handle gradient fill pointer up
    if (isGradientDraggingRef.current) {
      isGradientDraggingRef.current = false;
      const layerIdG = activeLayerIdRef.current;
      const lcG = layerCanvasesRef.current.get(layerIdG);
      if (!lcG) return;
      const ctxG = lcG.getContext("2d", { willReadFrequently: !isIPad });
      if (!ctxG) return;
      const start = gradientDragStartRef.current;
      const end = gradientDragEndRef.current;
      if (!start || !end) return;
      const before = ctxG.getImageData(0, 0, lcG.width, lcG.height);
      const col = colorRef.current;
      const [gr, gg, gb] = hsvToRgb(col.h, col.s, col.v);
      const fSettings = fillSettingsRef.current;
      const gradColorStr = `rgb(${gr},${gg},${gb})`;
      const transparentStr = `rgba(${gr},${gg},${gb},0)`;
      // Clip to selection if active
      if (selectionMaskRef.current && selectionActiveRef.current) {
        const tempC = document.createElement("canvas");
        tempC.width = lcG.width;
        tempC.height = lcG.height;
        const tempCtx = tempC.getContext("2d", {
          willReadFrequently: !isIPad,
        })!;
        let grad: CanvasGradient;
        if (fSettings.gradientMode === "radial") {
          const dx = end.x - start.x;
          const dy = end.y - start.y;
          const radius = Math.sqrt(dx * dx + dy * dy);
          grad = tempCtx.createRadialGradient(
            start.x,
            start.y,
            0,
            start.x,
            start.y,
            Math.max(radius, 1),
          );
        } else {
          grad = tempCtx.createLinearGradient(start.x, start.y, end.x, end.y);
        }
        grad.addColorStop(0, gradColorStr);
        grad.addColorStop(1, transparentStr);
        tempCtx.fillStyle = grad;
        tempCtx.fillRect(0, 0, tempC.width, tempC.height);
        tempCtx.globalCompositeOperation = "destination-in";
        tempCtx.drawImage(selectionMaskRef.current, 0, 0);
        tempCtx.globalCompositeOperation = "source-over";
        ctxG.globalCompositeOperation = "source-over";
        ctxG.drawImage(tempC, 0, 0);
      } else {
        let grad: CanvasGradient;
        if (fSettings.gradientMode === "radial") {
          const dx = end.x - start.x;
          const dy = end.y - start.y;
          const radius = Math.sqrt(dx * dx + dy * dy);
          grad = ctxG.createRadialGradient(
            start.x,
            start.y,
            0,
            start.x,
            start.y,
            Math.max(radius, 1),
          );
        } else {
          grad = ctxG.createLinearGradient(start.x, start.y, end.x, end.y);
        }
        grad.addColorStop(0, gradColorStr);
        grad.addColorStop(1, transparentStr);
        ctxG.fillStyle = grad;
        ctxG.fillRect(0, 0, lcG.width, lcG.height);
      }
      composite();
      markLayerBitmapDirty(layerIdG);
      const after = ctxG.getImageData(0, 0, lcG.width, lcG.height);
      pushHistory({
        type: "pixels",
        layerId: layerIdG,
        before,
        after,
      });
      markCanvasDirty(layerIdG);
      gradientDragStartRef.current = null;
      gradientDragEndRef.current = null;
      return;
    }

    // Handle lasso fill pointer up: commit undo entry
    if (isLassoFillDrawingRef.current) {
      const layerIdLF = activeLayerIdRef.current;
      const lcLF = layerCanvasesRef.current.get(layerIdLF);
      if (lcLF) {
        const col = colorRef.current;
        const [cr, cg, cb] = hsvToRgb(col.h, col.s, col.v);
        const pts = lassoFillPointsRef.current;
        if (pts.length >= 3) {
          applyLassoFill(
            lcLF,
            pts,
            Math.round(cr),
            Math.round(cg),
            Math.round(cb),
          );
        }
        composite();
        markLayerBitmapDirty(layerIdLF);
        const after = lcLF
          .getContext("2d", { willReadFrequently: !isIPad })
          ?.getImageData(0, 0, lcLF.width, lcLF.height);
        const before = strokeStartSnapshotRef.current;
        if (before && after) {
          pushHistory({
            type: "pixels",
            layerId: layerIdLF,
            before: before.pixels,
            after,
          });
        }
      }
      if (lcLF) {
        markCanvasDirty(layerIdLF);
      }
      isLassoFillDrawingRef.current = false;
      lassoFillOriginRef.current = null;
      lassoFillLastPtRef.current = null;
      lassoFillPointsRef.current = [];
      strokeStartSnapshotRef.current = null;
      return;
    }
  }, [
    activeLayerIdRef,
    applyLassoFill,
    colorRef,
    composite,
    isIPad,
    layerCanvasesRef,
    pushHistory,
    selectionActiveRef,
    selectionMaskRef,
    strokeStartSnapshotRef,
    params,
  ]);

  return {
    fillMode,
    setFillMode,
    fillSettings,
    setFillSettings,
    fillModeRef,
    fillSettingsRef,
    lassoFillOriginRef,
    lassoFillLastPtRef,
    isLassoFillDrawingRef,
    lassoFillSmoothedPtRef,
    lassoFillPointsRef,
    gradientDragStartRef,
    gradientDragEndRef,
    isGradientDraggingRef,
    floodFillWithTolerance,
    applyLassoFill,
    handleFillPointerDown,
    handleFillPointerMove,
    handleFillPointerUp,
  };
}
