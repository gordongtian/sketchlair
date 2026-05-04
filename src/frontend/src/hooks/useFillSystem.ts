import type { HSVAColor } from "@/utils/colorUtils";
import { generateLayerThumbnail, hsvToRgb } from "@/utils/colorUtils";
import {
  applyDestinationOverExpansion,
  bfsFloodFill,
  chaikinSmooth,
} from "@/utils/selectionUtils";
import { getThumbCanvas, getThumbCtx } from "@/utils/thumbnailCache";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
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

  /**
   * Optional callback invoked when lasso fill drawing starts.
   * PaintingApp uses this to kick the marching-ants RAF loop so the
   * in-progress ant trail is visible from the first pointer-down.
   */
  onLassoFillStart?: () => void;
}

export interface FillSystemReturn {
  // State
  fillMode: FillMode;
  /** Use this instead of setFillMode — keeps fillModeRef in sync synchronously. */
  updateFillMode: (mode: FillMode) => void;
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
    featherEdges?: boolean,
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

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Rasterize an array of polygon points onto a new canvas as a white filled shape.
 * Returns a canvas the same size as `w × h` with white inside the polygon and
 * transparent outside. Used as a destination-in clip mask.
 */
function rasterizeLassoMask(
  points: { x: number; y: number }[],
  w: number,
  h: number,
): HTMLCanvasElement {
  const maskC = document.createElement("canvas");
  maskC.width = w;
  maskC.height = h;
  const maskCtx = maskC.getContext("2d")!;
  maskCtx.fillStyle = "white";
  maskCtx.beginPath();
  maskCtx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    maskCtx.lineTo(points[i].x, points[i].y);
  }
  maskCtx.closePath();
  maskCtx.fill();
  return maskC;
}

/**
 * Force every pixel in `imgData` that has 0 < alpha < 255 to alpha = 255.
 * This ensures semi-transparent pixels in the fill region are brought to full
 * opacity (Bug 3).
 */
function forceFullOpacity(imgData: ImageData): void {
  const d = imgData.data;
  for (let i = 3; i < d.length; i += 4) {
    if (d[i] > 0 && d[i] < 255) {
      d[i] = 255;
    }
  }
}

// ── useFillSystem ─────────────────────────────────────────────────────────────

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
    onLassoFillStart,
  } = params;

  // ── State ────────────────────────────────────────────────────────────────
  const [fillMode, setFillMode] = useState<FillMode>("flood");
  const fillModeRef = useRef<FillMode>("flood");

  // Sync fillModeRef synchronously at the call site so pointer-down always
  // reads the correct mode — a useEffect would be one render late.
  const updateFillMode = useCallback((mode: FillMode) => {
    fillModeRef.current = mode;
    setFillMode(mode);
  }, []);

  const [fillSettings, setFillSettings] = useState<FillSettings>({
    tolerance: 30,
    gradientMode: "linear",
    contiguous: true,
    featherEdges: true,
  });
  const fillSettingsRef = useRef<FillSettings>({
    tolerance: 30,
    gradientMode: "linear",
    contiguous: true,
    featherEdges: true,
  });

  // Keep fillSettingsRef in sync with fillSettings state.
  useEffect(() => {
    fillSettingsRef.current = fillSettings;
  }, [fillSettings]);

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
      featherEdges = true,
    ) => {
      // Ruler layer guard — silently abort if the active layer is a ruler layer
      const activeLayerFillCheck = layersRef.current.find(
        (l) => l.id === activeLayerIdRef.current,
      );
      if ((activeLayerFillCheck as { isRuler?: boolean } | undefined)?.isRuler)
        return;
      // Lock guard — silently abort if the active layer is locked
      if (
        (activeLayerFillCheck as { isLocked?: boolean } | undefined)?.isLocked
      )
        return;
      const ctx = lc.getContext("2d", { willReadFrequently: !isIPad });
      if (!ctx) return;
      const { width, height } = lc;
      const x = Math.round(px);
      const y = Math.round(py);
      if (x < 0 || x >= width || y < 0 || y >= height) return;
      const imgData = ctx.getImageData(0, 0, width, height);
      const data = imgData.data;

      // Read seed pixel color (unpremultiplied) for Phase 2 skip condition
      const sidx = (y * width + x) * 4;
      const seedA = data[sidx + 3];
      const seedR = seedA > 0 ? Math.round((data[sidx] * 255) / seedA) : 0;
      const seedG = seedA > 0 ? Math.round((data[sidx + 1] * 255) / seedA) : 0;
      const seedB = seedA > 0 ? Math.round((data[sidx + 2] * 255) / seedA) : 0;

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

      // Phase 1: scanline flood fill — fills pixels within tolerance
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

      // Apply Phase 1 fill pixels, respecting float selection weights.
      for (let i = 0; i < fillMask.length; i++) {
        if (fillMask[i]) {
          const pi = i * 4;
          // Determine selection weight for this pixel (1.0 when no selection)
          const selWeight = selData ? selData[pi + 3] / 255 : 1.0;
          if (selWeight <= 0) continue;

          const existingAlpha = data[pi + 3];
          if (existingAlpha === 0) {
            // Fully transparent pixel — write fill color at selWeight opacity
            data[pi] = fr;
            data[pi + 1] = fg;
            data[pi + 2] = fb;
            data[pi + 3] = Math.round(fa * selWeight);
          } else {
            // Opaque/semi-opaque pixel — blend fill color by selWeight
            if (selWeight >= 1.0) {
              // Full selection: overwrite RGB, keep alpha
              if (data[pi] === fr && data[pi + 1] === fg && data[pi + 2] === fb)
                continue;
              data[pi] = fr;
              data[pi + 1] = fg;
              data[pi + 2] = fb;
            } else {
              // Partial selection: lerp toward fill color
              data[pi] = Math.round(data[pi] + (fr - data[pi]) * selWeight);
              data[pi + 1] = Math.round(
                data[pi + 1] + (fg - data[pi + 1]) * selWeight,
              );
              data[pi + 2] = Math.round(
                data[pi + 2] + (fb - data[pi + 2]) * selWeight,
              );
              // alpha stays as-is for partial selections on opaque pixels
            }
          }
        }
      }

      // Phase 2: destination-over expansion (feather edges)
      // Expands 1 pixel outward from the filled region and composites the fill
      // color UNDERNEATH existing pixels using destination-over blending.
      // Fully opaque line pixels are unchanged. Semi-transparent edge pixels
      // receive fill color proportional to their transparency — closing the gap.
      if (featherEdges) {
        applyDestinationOverExpansion(
          data,
          width,
          height,
          fillMask,
          fr,
          fg,
          fb,
          fa,
          seedR,
          seedG,
          seedB,
          tolerance,
        );
      }

      ctx.putImageData(imgData, 0, 0);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // ── applyLassoFill ───────────────────────────────────────────────────────
  // Bug 1 fix: always render fill to a temp canvas then apply destination-in clip.
  // When selectionActiveRef is true, selectionMaskRef already contains the rasterized
  // lasso boundary — use it as the clip. When no selection is active, clip to the
  // lasso polygon itself so no pixels outside the drawn boundary are touched.
  //
  // Bug 3 fix: after rendering fill color to tempC, force all non-zero pixels in the
  // region to alpha=255 before blitting onto the layer canvas with 'copy' composite
  // so that semi-transparent pixels on the layer are fully overwritten.
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
      // Ruler layer guard — silently abort if the active layer is a ruler layer
      const activeLayerLasso = layersRef.current.find(
        (l) => l.id === activeLayerIdRef.current,
      );
      if ((activeLayerLasso as { isRuler?: boolean } | undefined)?.isRuler)
        return;
      // Lock guard — silently abort if the active layer is locked
      if ((activeLayerLasso as { isLocked?: boolean } | undefined)?.isLocked)
        return;
      const ctx = lc.getContext("2d", { willReadFrequently: !isIPad });
      if (!ctx) return;

      const w = lc.width;
      const h = lc.height;

      // Apply Chaikin smoothing so the fill boundary and ant trail always match.
      // 2 passes gives a natural smooth curve without losing tight corners.
      const smoothedPoints = chaikinSmooth(points, 2);

      // Step 1: render the fill polygon onto a temp canvas
      const tempC = document.createElement("canvas");
      tempC.width = w;
      tempC.height = h;
      const tempCtx = tempC.getContext("2d", { willReadFrequently: false })!;
      tempCtx.imageSmoothingEnabled = true;
      tempCtx.beginPath();
      tempCtx.moveTo(smoothedPoints[0].x, smoothedPoints[0].y);
      for (let i = 1; i < smoothedPoints.length; i++) {
        tempCtx.lineTo(smoothedPoints[i].x, smoothedPoints[i].y);
      }
      tempCtx.closePath();
      tempCtx.fillStyle = `rgb(${fr},${fg},${fb})`;
      tempCtx.fill();

      // Step 2: determine the clip mask.
      // Bug 1: when a selection is active, selectionMaskRef IS the rasterized lasso
      // boundary — use it as the hard clip. When no selection is active, create the
      // clip mask from the lasso polygon points so nothing outside the drawn shape
      // is ever touched (fixes flood-fill-ignoring-lasso behaviour).
      let clipMask: HTMLCanvasElement;
      if (selectionMaskRef.current && selectionActiveRef.current) {
        clipMask = selectionMaskRef.current;
      } else {
        // No active selection — clip to the smoothed lasso polygon itself
        clipMask = rasterizeLassoMask(smoothedPoints, w, h);
      }

      // Apply the clip: destination-in removes all pixels outside the mask
      tempCtx.globalCompositeOperation = "destination-in";
      tempCtx.drawImage(clipMask, 0, 0);
      tempCtx.globalCompositeOperation = "source-over";

      // Step 3 (Bug 3): force full opacity on every non-zero pixel in the filled region
      // so that semi-transparent pixels on the destination layer are fully overwritten.
      const fillImgData = tempCtx.getImageData(0, 0, w, h);
      forceFullOpacity(fillImgData);
      tempCtx.putImageData(fillImgData, 0, 0);

      // Step 4: blit onto the layer canvas.
      // Use 'source-atop' so we write the fill color with full opacity onto pixels that
      // exist on the layer (including semi-transparent ones), and 'source-over' for new
      // pixels that were transparent. Together this ensures the fill region is fully solid.
      ctx.save();
      ctx.globalCompositeOperation = "source-over";
      ctx.drawImage(tempC, 0, 0);
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
          fSettings.featherEdges ?? true,
        );
        composite();
        markLayerBitmapDirty(layerId);
        const afterFlood =
          lcCtxFlood?.getImageData(0, 0, lc.width, lc.height) ?? null;
        if (beforeFlood && afterFlood) {
          pushHistory({
            type: "pixels",
            layerId,
            dirtyRect: { x: 0, y: 0, w: lc.width, h: lc.height },
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
        // Kick the marching-ants RAF loop so the in-progress ant trail is
        // visible from the first pointer-down (the loop checks isLassoFillDrawingRef).
        onLassoFillStart?.();
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
  // Gradient fill: two independent steps —
  //   Step 1: bfsFloodFill seeded at the drag-start point → boolean mask only,
  //           no color output.
  //   Step 2: for every pixel in the mask, evaluate the gradient at that pixel's
  //           (x, y) and write the pure gradient color directly — no blending,
  //           no source-over, no mixing with what was underneath.
  // biome-ignore lint/correctness/useExhaustiveDependencies: params is stable
  const handleFillPointerUp = useCallback(() => {
    // ── Gradient fill pointer up ─────────────────────────────────────────
    if (isGradientDraggingRef.current) {
      isGradientDraggingRef.current = false;
      const layerIdG = activeLayerIdRef.current;
      const lcG = layerCanvasesRef.current.get(layerIdG);
      if (!lcG) return;
      // Ruler layer guard — silently abort; reset drag state but produce no pixels
      const activeLayerGrad = layersRef.current.find((l) => l.id === layerIdG);
      if ((activeLayerGrad as { isRuler?: boolean } | undefined)?.isRuler) {
        gradientDragStartRef.current = null;
        gradientDragEndRef.current = null;
        return;
      }
      // Lock guard — silently abort if the active layer is locked
      if ((activeLayerGrad as { isLocked?: boolean } | undefined)?.isLocked) {
        gradientDragStartRef.current = null;
        gradientDragEndRef.current = null;
        return;
      }
      const ctxG = lcG.getContext("2d", { willReadFrequently: !isIPad });
      if (!ctxG) return;
      const start = gradientDragStartRef.current;
      const end = gradientDragEndRef.current;
      if (!start || !end) return;

      const col = colorRef.current;
      const [gr, gg, gb] = hsvToRgb(col.h, col.s, col.v);
      const ga = Math.round(col.a * 255);
      const fSettings = fillSettingsRef.current;

      // ── Step 1: Region detection via flood fill ──────────────────────────
      // Seed from the drag-start point (where the user clicked).
      // This is the ONLY use of flood fill here — it produces a boolean mask.
      const { width, height } = lcG;
      const imgData = ctxG.getImageData(0, 0, width, height);
      const before = ctxG.getImageData(0, 0, width, height);
      const data = imgData.data;

      const seedX = Math.round(start.x);
      const seedY = Math.round(start.y);

      // Read seed color (unpremultiplied) for Phase 2 skip condition
      const sidxG = (seedY * width + seedX) * 4;
      const seedAG = data[sidxG + 3];
      const seedRG = seedAG > 0 ? Math.round((data[sidxG] * 255) / seedAG) : 0;
      const seedGG =
        seedAG > 0 ? Math.round((data[sidxG + 1] * 255) / seedAG) : 0;
      const seedBG =
        seedAG > 0 ? Math.round((data[sidxG + 2] * 255) / seedAG) : 0;

      // Build selection data for bfsFloodFill if a selection is active
      let selData: Uint8ClampedArray | null = null;
      if (selectionMaskRef.current && selectionActiveRef.current) {
        const selCtx = selectionMaskRef.current.getContext("2d", {
          willReadFrequently: !isIPad,
        });
        if (selCtx) selData = selCtx.getImageData(0, 0, width, height).data;
      }

      const fillMask = bfsFloodFill(
        data,
        width,
        height,
        seedX,
        seedY,
        fSettings.tolerance,
        fSettings.contiguous ?? true,
        selData,
      );

      // ── Step 2: Write gradient colors directly for every masked pixel ────
      // Colors are evaluated purely from position — no blending, no compositing.
      if (fSettings.gradientMode === "radial") {
        // Radial: t = clamp(dist(pixel, start) / dist(end, start), 0, 1)
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const radius = Math.sqrt(dx * dx + dy * dy);
        const safeRadius = Math.max(radius, 1);

        for (let i = 0; i < fillMask.length; i++) {
          if (!fillMask[i]) continue;
          const px = i % width;
          const py = Math.floor(i / width);
          const pdx = px - start.x;
          const pdy = py - start.y;
          const dist = Math.sqrt(pdx * pdx + pdy * pdy);
          const t = Math.min(1, Math.max(0, dist / safeRadius));
          // Stop 0: full color, Stop 1: transparent — linear interpolation
          const pi = i * 4;
          data[pi] = Math.round(gr * (1 - t));
          data[pi + 1] = Math.round(gg * (1 - t));
          data[pi + 2] = Math.round(gb * (1 - t));
          data[pi + 3] = Math.round(255 * (1 - t));
        }
      } else {
        // Linear: t = clamp(dot(pixel - start, end - start) / |end - start|², 0, 1)
        const vx = end.x - start.x;
        const vy = end.y - start.y;
        const lenSq = vx * vx + vy * vy;
        const safeLenSq = Math.max(lenSq, 1);

        for (let i = 0; i < fillMask.length; i++) {
          if (!fillMask[i]) continue;
          const px = i % width;
          const py = Math.floor(i / width);
          const dot = (px - start.x) * vx + (py - start.y) * vy;
          const t = Math.min(1, Math.max(0, dot / safeLenSq));
          // Stop 0: full color, Stop 1: transparent — linear interpolation
          const pi = i * 4;
          data[pi] = Math.round(gr * (1 - t));
          data[pi + 1] = Math.round(gg * (1 - t));
          data[pi + 2] = Math.round(gb * (1 - t));
          data[pi + 3] = Math.round(255 * (1 - t));
        }
      }

      // Direct write for gradient pixels — no compositing, no blending
      ctxG.putImageData(imgData, 0, 0);

      // Phase 2: destination-over expansion at gradient boundary
      // Reads back the canvas to get the post-gradient state, then expands 1px
      // outward from the filled region compositing the seed-point fill color
      // underneath existing pixels — closing the gap at anti-aliased line edges.
      // Uses the full fill color (not gradient-interpolated) for the expansion edge.
      if (fSettings.featherEdges ?? true) {
        const postGradData = ctxG.getImageData(0, 0, width, height);
        applyDestinationOverExpansion(
          postGradData.data,
          width,
          height,
          fillMask,
          Math.round(gr),
          Math.round(gg),
          Math.round(gb),
          ga,
          seedRG,
          seedGG,
          seedBG,
          fSettings.tolerance,
        );
        ctxG.putImageData(postGradData, 0, 0);
      }

      composite();
      markLayerBitmapDirty(layerIdG);
      const after = ctxG.getImageData(0, 0, lcG.width, lcG.height);
      pushHistory({
        type: "pixels",
        layerId: layerIdG,
        dirtyRect: { x: 0, y: 0, w: lcG.width, h: lcG.height },
        before,
        after,
      });
      markCanvasDirty(layerIdG);
      gradientDragStartRef.current = null;
      gradientDragEndRef.current = null;
      return;
    }

    // ── Lasso fill pointer up ────────────────────────────────────────────
    if (isLassoFillDrawingRef.current) {
      const layerIdLF = activeLayerIdRef.current;
      const lcLF = layerCanvasesRef.current.get(layerIdLF);
      // Ruler layer guard — silently abort; clean up lasso state but produce no pixels
      const activeLayerLF = layersRef.current.find((l) => l.id === layerIdLF);
      if ((activeLayerLF as { isRuler?: boolean } | undefined)?.isRuler) {
        isLassoFillDrawingRef.current = false;
        lassoFillOriginRef.current = null;
        lassoFillLastPtRef.current = null;
        lassoFillPointsRef.current = [];
        strokeStartSnapshotRef.current = null;
        return;
      }
      // Lock guard — silently abort if the active layer is locked
      if ((activeLayerLF as { isLocked?: boolean } | undefined)?.isLocked) {
        isLassoFillDrawingRef.current = false;
        lassoFillOriginRef.current = null;
        lassoFillLastPtRef.current = null;
        lassoFillPointsRef.current = [];
        strokeStartSnapshotRef.current = null;
        return;
      }
      if (lcLF) {
        const col = colorRef.current;
        const [cr, cg, cb] = hsvToRgb(col.h, col.s, col.v);
        const pts = lassoFillPointsRef.current;
        if (pts.length >= 3) {
          // Solid lasso fill — applyLassoFill handles chaikinSmooth internally.
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
        const _lfCtxAfter = lcLF.getContext("2d", {
          willReadFrequently: !isIPad,
        });
        const before = strokeStartSnapshotRef.current;
        if (before && _lfCtxAfter) {
          // Compute dirty rect from lasso points bounding box
          let _lfMinX = Number.POSITIVE_INFINITY;
          let _lfMinY = Number.POSITIVE_INFINITY;
          let _lfMaxX = Number.NEGATIVE_INFINITY;
          let _lfMaxY = Number.NEGATIVE_INFINITY;
          for (const _pt of pts) {
            if (_pt.x < _lfMinX) _lfMinX = _pt.x;
            if (_pt.x > _lfMaxX) _lfMaxX = _pt.x;
            if (_pt.y < _lfMinY) _lfMinY = _pt.y;
            if (_pt.y > _lfMaxY) _lfMaxY = _pt.y;
          }
          const _lfPad = 4;
          const _lfDrX = Math.max(0, Math.floor(_lfMinX) - _lfPad);
          const _lfDrY = Math.max(0, Math.floor(_lfMinY) - _lfPad);
          const _lfDrX2 = Math.min(lcLF.width, Math.ceil(_lfMaxX) + _lfPad);
          const _lfDrY2 = Math.min(lcLF.height, Math.ceil(_lfMaxY) + _lfPad);
          const _lfDrW = _lfDrX2 - _lfDrX;
          const _lfDrH = _lfDrY2 - _lfDrY;
          const _lfUseDirtyRect =
            _lfDrW > 0 &&
            _lfDrH > 0 &&
            _lfDrW * _lfDrH < lcLF.width * lcLF.height * 0.5;
          if (_lfUseDirtyRect) {
            // Crop the full-canvas before-snapshot to the dirty region
            const _lfTmp = document.createElement("canvas");
            _lfTmp.width = _lfDrW;
            _lfTmp.height = _lfDrH;
            const _lfTmpCtx = _lfTmp.getContext("2d", {
              willReadFrequently: true,
            });
            if (_lfTmpCtx) {
              _lfTmpCtx.putImageData(before.pixels, -_lfDrX, -_lfDrY);
              const _lfCroppedBefore = _lfTmpCtx.getImageData(
                0,
                0,
                _lfDrW,
                _lfDrH,
              );
              const _lfAfter = _lfCtxAfter.getImageData(
                _lfDrX,
                _lfDrY,
                _lfDrW,
                _lfDrH,
              );
              const _lfDirtyRect = {
                x: _lfDrX,
                y: _lfDrY,
                w: _lfDrW,
                h: _lfDrH,
              };
              pushHistory({
                type: "pixels",
                layerId: layerIdLF,
                dirtyRect: _lfDirtyRect,
                before: _lfCroppedBefore,
                after: _lfAfter,
              });
            } else {
              pushHistory({
                type: "pixels",
                layerId: layerIdLF,
                dirtyRect: { x: 0, y: 0, w: lcLF.width, h: lcLF.height },
                before: before.pixels,
                after: _lfCtxAfter.getImageData(0, 0, lcLF.width, lcLF.height),
              });
            }
          } else {
            pushHistory({
              type: "pixels",
              layerId: layerIdLF,
              dirtyRect: { x: 0, y: 0, w: lcLF.width, h: lcLF.height },
              before: before.pixels,
              after: _lfCtxAfter.getImageData(0, 0, lcLF.width, lcLF.height),
            });
          }
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
    updateFillMode,
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
