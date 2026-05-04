// ── FigureDrawingSession ────────────────────────────────────────────────────────
//
// Main session workspace component for Figure Drawing.
// Manages pose queue, timer, reference display, snapshotting, and pose transitions.

import type { Layer } from "@/components/LayersPanel";
import { LearnTimer } from "@/components/learn/primitives/LearnTimer";
import type { LearnTimerHandle } from "@/components/learn/primitives/LearnTimer";
import { ReferenceViewer } from "@/components/learn/primitives/ReferenceViewer";
import { useCanvasSwapper } from "@/components/learn/primitives/useCanvasSwapper";
import { setActiveLayerIdForBitmap } from "@/hooks/useCompositing";
import type {
  FigureDrawingConfig,
  ImageReference,
  ImageSet,
} from "@/types/learn";
import {
  AlertTriangle,
  ChevronRight,
  Pause,
  Play,
  StopCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FigureDrawingSessionProps {
  config: FigureDrawingConfig;
  imageSets: ImageSet[];
  handedness: "left" | "right";
  onSessionComplete: (snapshots: ImageData[]) => void;
  onAbort: () => void;
  // Canvas system (passed down from PaintingApp via App)
  layers: Layer[];
  setLayers: (layers: Layer[]) => void;
  canvasWidth: number;
  canvasHeight: number;
  /**
   * Atomically resizes the display canvas, WebGL brush, offscreen compositing
   * canvases, AND updates canvasWidthRef/canvasHeightRef before calling the
   * React state setters. Always use this instead of setCanvasWidth/setCanvasHeight
   * to avoid a pixel-vs-CSS-size mismatch that causes coordinate scaling bugs.
   */
  resizeCanvas: (w: number, h: number) => void;
  compositeAllLayers: () => void;
  commitActiveStroke: () => void;
  getDisplayCanvas: () => HTMLCanvasElement | null;
  layerCanvasesRef: React.MutableRefObject<Map<string, HTMLCanvasElement>>;
  generateLayerId: () => string;
  /** Direct ref to PaintingApp's activeLayerIdRef — must be set synchronously after session init */
  activeLayerIdRef: React.MutableRefObject<string>;
  /** PaintingApp's setActiveLayerId state setter — triggers the useEffect that calls setActiveLayerIdForBitmap */
  setActiveLayerId: (id: string) => void;
  /**
   * When set to true, composite() bypasses the dirty-rect optimisation for one call
   * and then auto-clears. Passed to useCanvasSwapper so pose-transition composites
   * always paint the full canvas surface, including newly expanded regions.
   */
  needsFullCompositeRef: React.MutableRefObject<boolean>;
  /**
   * Ref to the world-space transform container (canvasWrapperRef in CanvasArea).
   * Used by side canvas mode to inject the reference canvas as a sibling of the
   * main canvas inside the world-space container, so it moves with pan/zoom/rotate.
   */
  canvasWrapperRef: React.RefObject<HTMLDivElement | null>;
}

// ── Fisher-Yates shuffle ─────────────────────────────────────────────────────

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Crop transparent edges from ImageData ─────────────────────────────────────

function cropTransparent(src: ImageData): ImageData {
  const { width, height, data } = src;
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
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
  if (minX > maxX || minY > maxY) {
    return new ImageData(1, 1);
  }
  const cropW = maxX - minX + 1;
  const cropH = maxY - minY + 1;
  const tmp = document.createElement("canvas");
  tmp.width = cropW;
  tmp.height = cropH;
  const ctx = tmp.getContext("2d")!;
  ctx.putImageData(src, -minX, -minY);
  return ctx.getImageData(0, 0, cropW, cropH);
}

// ── Fetch image ────────────────────────────────────────────────────────────────

async function fetchPoseImage(
  ref: ImageReference,
): Promise<ImageBitmap | null> {
  if (!ref.assetUrl) {
    console.warn(
      `[FigureDrawing] fetching pose image: EMPTY assetUrl — using demo placeholder (${ref.width ?? 600}x${ref.height ?? 800})`,
    );
    // Demo mode placeholder
    const c = document.createElement("canvas");
    c.width = ref.width || 600;
    c.height = ref.height || 800;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#1a1a2e";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = "#e0e0e0";
    ctx.font = `${Math.floor(c.width / 10)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Pose Reference", c.width / 2, c.height / 2);
    return createImageBitmap(c);
  }
  console.log(`[FigureDrawing] fetching pose image: ${ref.assetUrl}`);
  try {
    const response = await fetch(ref.assetUrl);
    console.log(
      `[FigureDrawing] fetch response status: ${response.status} for ${ref.assetUrl}`,
    );
    const blob = await response.blob();
    return createImageBitmap(blob);
  } catch (e) {
    console.error(`[FigureDrawing] fetch error for ${ref.assetUrl}:`, e);
    return null;
  }
}

// ── Main component ─────────────────────────────────────────────────────────────

export function FigureDrawingSession({
  config,
  imageSets,
  handedness,
  onSessionComplete,
  onAbort,
  layers,
  setLayers,
  resizeCanvas,
  compositeAllLayers,
  commitActiveStroke,
  layerCanvasesRef,
  generateLayerId,
  activeLayerIdRef,
  setActiveLayerId,
  needsFullCompositeRef,
  canvasWrapperRef,
}: FigureDrawingSessionProps) {
  // ── Build pose queue once ─────────────────────────────────────────────────
  const poseQueue = useMemo<ImageReference[]>(() => {
    console.log(
      `[FigureDrawing] building poseQueue from prop imageSets: ${imageSets.length} sets. Per-set images: ${imageSets.map((s) => `${s.name}: ${s.images?.length ?? 0} images`).join(", ")}`,
    );
    const selected = imageSets.filter((s) =>
      config.selectedSetIds.includes(s.id),
    );
    const allImages = selected.flatMap((s) => s.images);
    if (allImages.length === 0) {
      console.warn(
        "[FigureDrawing] WARNING: poseQueue is empty — no images to show. Falling back to demo placeholders.",
      );
      // Stub queue for demo mode — use config.poseCount if numeric, else 5
      const demoCount = config.poseCount === "all" ? 5 : config.poseCount;
      const stubQueue = Array.from({ length: demoCount }, (_, i) => ({
        id: `pose-${i}`,
        assetUrl: "",
        width: 600,
        height: 800,
      }));
      console.log(
        `[FigureDrawing] poseQueue built: ${stubQueue.length} entries. First assetUrl: ${stubQueue[0]?.assetUrl || "NONE (demo)"}`,
      );
      return stubQueue;
    }
    // When poseCount === 'all', use every available image exactly once (shuffled).
    // Otherwise, shuffle and take the requested count.
    const shuffled = shuffleArray(allImages);
    const queue =
      config.poseCount === "all"
        ? shuffled
        : shuffled.slice(0, config.poseCount);
    console.log(
      `[FigureDrawing] poseQueue built: ${queue.length} entries. First assetUrl: ${queue[0]?.assetUrl ?? "NONE"}`,
    );
    return queue;
  }, [imageSets, config.selectedSetIds, config.poseCount]);

  // ── Session state ──────────────────────────────────────────────────────────
  const snapshotsRef = useRef<ImageData[]>([]);
  const currentPoseIndexRef = useRef(0);
  const isTransitioningRef = useRef(false);
  const initDoneRef = useRef(false);
  const layerIdsRef = useRef<{
    backgroundId: string;
    drawingId: string;
    tracingId: string | null;
  } | null>(null);

  // ── Side canvas (world-space reference canvas sibling) ───────────────────
  // Created imperatively and appended inside canvasWrapperRef so it moves with
  // the camera transform exactly like the main canvas. NOT a viewport overlay.
  const sideCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvasWrapperRefStable = canvasWrapperRef;

  const [currentPoseIndex, setCurrentPoseIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isFlashing, setIsFlashing] = useState(false);
  const [currentImage, setCurrentImage] = useState<ImageBitmap | null>(null);
  const [showAbortConfirm, setShowAbortConfirm] = useState(false);
  const [initDone, setInitDone] = useState(false);
  const timerRef = useRef<LearnTimerHandle>(null);

  // On unmount, close the current pose image to free GPU memory.
  useEffect(() => {
    return () => {
      setCurrentImage((prev) => {
        if (prev) prev.close();
        return null;
      });
    };
  }, []);

  // ── Side canvas lifecycle ─────────────────────────────────────────────────
  // The side canvas must live inside canvasWrapperRef (world-space container) as
  // a position:absolute sibling of the main canvas. This way it is affected by the
  // same CSS transform (pan/zoom/rotate) and never shifts the main canvas in DOM flow.
  // canvasWidth here is the main canvas width — used to compute the side canvas x position.
  const SIDE_GAP = 56; // world-space pixels between main canvas right/left edge and side canvas

  // Creates (or reuses) the side canvas element and appends it to canvasWrapperRef.
  const ensureSideCanvas = useCallback(
    (
      imgW: number,
      imgH: number,
      mainCanvasW: number,
    ): HTMLCanvasElement | null => {
      const wrapper = canvasWrapperRefStable.current;
      if (!wrapper) return null;
      // Reuse existing or create new
      let el = sideCanvasRef.current;
      if (!el) {
        el = document.createElement("canvas");
        el.style.position = "absolute";
        el.style.pointerEvents = "none";
        sideCanvasRef.current = el;
        wrapper.appendChild(el);
      }

      // Set pixel dimensions to exactly match reference image
      el.width = imgW;
      el.height = imgH;
      // CSS display size matches pixel size (1:1 world-space pixels)
      el.style.width = `${imgW}px`;
      el.style.height = `${imgH}px`;

      const isHorizontal = imgW > imgH;

      if (isHorizontal) {
        // Horizontal reference image: place ABOVE the main canvas.
        // Align its left edge with the main canvas left edge (left: 0).
        // top = -(referenceHeight + gap)
        el.style.top = `${-(imgH + SIDE_GAP)}px`;
        el.style.left = "0px";
      } else {
        // Vertical or square reference image: place beside the main canvas.
        // Reset top to 0 so it stays level with the main canvas.
        el.style.top = "0px";
        if (handedness === "right") {
          // Left of main canvas: x = -(referenceWidth + gap)
          el.style.left = `${-(imgW + SIDE_GAP)}px`;
        } else {
          // Right of main canvas: x = mainCanvasWidth + gap
          el.style.left = `${mainCanvasW + SIDE_GAP}px`;
        }
      }

      return el;
    },
    [canvasWrapperRefStable, handedness],
  );

  // Draws an image to the side canvas (creates it first if needed).
  const drawToSideCanvas = useCallback(
    (image: ImageBitmap, mainCanvasW: number) => {
      const el = ensureSideCanvas(image.width, image.height, mainCanvasW);
      if (!el) return;
      const ctx = el.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, el.width, el.height);
      ctx.drawImage(image, 0, 0);
    },
    [ensureSideCanvas],
  );
  const drawToSideCanvasRef = useRef(drawToSideCanvas);
  useEffect(() => {
    drawToSideCanvasRef.current = drawToSideCanvas;
  }, [drawToSideCanvas]);

  // Remove side canvas from DOM when session ends (unmount) or when mode changes away from "side".
  useEffect(() => {
    if (config.referenceMode !== "side") {
      // If mode is not "side", ensure any stale side canvas is removed
      const el = sideCanvasRef.current;
      if (el?.parentNode) {
        el.parentNode.removeChild(el);
        sideCanvasRef.current = null;
      }
    }
    return () => {
      // Cleanup on unmount: remove side canvas from world-space container
      const el = sideCanvasRef.current;
      if (el?.parentNode) {
        el.parentNode.removeChild(el);
        sideCanvasRef.current = null;
      }
    };
  }, [config.referenceMode]);

  // Stable refs for callbacks used inside async flows
  const setLayersRef = useRef(setLayers);
  const resizeCanvasRef = useRef(resizeCanvas);
  const compositeRef = useRef(compositeAllLayers);
  const onSessionCompleteRef = useRef(onSessionComplete);
  const generateLayerIdRef = useRef(generateLayerId);
  const configRef = useRef(config);
  // activeLayerIdRef is a stable MutableRefObject from PaintingApp — use directly
  const setActiveLayerIdRef = useRef(setActiveLayerId);

  useEffect(() => {
    setLayersRef.current = setLayers;
  }, [setLayers]);
  useEffect(() => {
    resizeCanvasRef.current = resizeCanvas;
  }, [resizeCanvas]);
  useEffect(() => {
    compositeRef.current = compositeAllLayers;
  }, [compositeAllLayers]);
  useEffect(() => {
    onSessionCompleteRef.current = onSessionComplete;
  }, [onSessionComplete]);
  useEffect(() => {
    generateLayerIdRef.current = generateLayerId;
  }, [generateLayerId]);
  useEffect(() => {
    configRef.current = config;
  }, [config]);
  useEffect(() => {
    setActiveLayerIdRef.current = setActiveLayerId;
  }, [setActiveLayerId]);

  // ── Canvas swapper ────────────────────────────────────────────────────────
  const { swapToImage } = useCanvasSwapper({
    resizeCanvas,
    layers,
    layerCanvasesRef,
    compositeAllLayers,
    needsFullCompositeRef,
  });
  const swapToImageRef = useRef(swapToImage);
  useEffect(() => {
    swapToImageRef.current = swapToImage;
  }, [swapToImage]);

  // ── Session initialization ────────────────────────────────────────────────
  useEffect(() => {
    if (initDoneRef.current || poseQueue.length === 0) return;
    initDoneRef.current = true;

    const init = async () => {
      const firstRef = poseQueue[0];
      console.log(
        "[FigureDrawing] fetching reference image:",
        firstRef.assetUrl || "(demo placeholder)",
      );
      const firstImage = await fetchPoseImage(firstRef);
      if (firstImage) {
        console.log(
          "[FigureDrawing] image fetched — dimensions:",
          firstImage.width,
          "x",
          firstImage.height,
        );
      } else {
        console.warn("[FigureDrawing] image fetch returned null");
      }
      const refMode = configRef.current.referenceMode;

      const bgId = generateLayerIdRef.current();
      const drawId = generateLayerIdRef.current();
      const tracingId =
        refMode === "tracing" ? generateLayerIdRef.current() : null;
      layerIdsRef.current = {
        backgroundId: bgId,
        drawingId: drawId,
        tracingId,
      };

      const w = firstImage ? firstImage.width : firstRef.width || 600;
      const h = firstImage ? firstImage.height : firstRef.height || 800;

      const bgCanvas = document.createElement("canvas");
      bgCanvas.width = w;
      bgCanvas.height = h;
      const bgCtx = bgCanvas.getContext("2d")!;
      bgCtx.fillStyle = "#ffffff";
      bgCtx.fillRect(0, 0, w, h);

      const drawCanvas = document.createElement("canvas");
      drawCanvas.width = w;
      drawCanvas.height = h;

      layerCanvasesRef.current.set(bgId, bgCanvas);
      layerCanvasesRef.current.set(drawId, drawCanvas);

      const sessionLayers: Layer[] = [];

      // Drawing layer at index 0 (TOP — composite iterates backwards so low index = top)
      sessionLayers.push({
        id: drawId,
        name: "Drawing",
        type: "layer",
        visible: true,
        opacity: 1,
        blendMode: "source-over",
        isClippingMask: false,
        alphaLock: false,
      });

      // Tracing reference layer at index 1 (middle)
      if (tracingId && firstImage) {
        const tracingCanvas = document.createElement("canvas");
        tracingCanvas.width = w;
        tracingCanvas.height = h;
        const tracingCtx = tracingCanvas.getContext("2d")!;
        tracingCtx.drawImage(firstImage, 0, 0, w, h);
        layerCanvasesRef.current.set(tracingId, tracingCanvas);

        sessionLayers.push({
          id: tracingId,
          name: "Reference",
          type: "layer",
          visible: true,
          opacity: 0.06,
          blendMode: "source-over",
          isClippingMask: false,
          alphaLock: false,
        });
      }

      // Background at last index (BOTTOM)
      sessionLayers.push({
        id: bgId,
        name: "Background",
        type: "layer",
        visible: true,
        opacity: 1,
        blendMode: "source-over",
        isClippingMask: false,
        alphaLock: false,
      });

      setLayersRef.current(sessionLayers);
      resizeCanvasRef.current(w, h);

      // ── Fix 1: Update activeLayerIdRef synchronously BEFORE composite ──
      // The pointer-down handler reads activeLayerIdRef.current directly.
      // If we only call setActiveLayerId (a React state setter), it schedules a
      // re-render but the ref won't update until after PaintingApp re-renders.
      // By setting the ref synchronously here, the first stroke finds the correct
      // layer canvas in layerCanvasesRef immediately.
      activeLayerIdRef.current = drawId;
      // Also call the state setter so PaintingApp's useEffect fires and calls
      // setActiveLayerIdForBitmap — this keeps the compositing cache in sync.
      setActiveLayerIdRef.current(drawId);
      // Call setActiveLayerIdForBitmap directly here too, in case the React state
      // update is still pending when the first composite runs.
      setActiveLayerIdForBitmap(drawId);

      // ── Fix 2: Call compositeAllLayers synchronously (not in rAF) ──
      // Wrapping in requestAnimationFrame defers the first composite, which means
      // the reference image (tracing mode) won't appear until the next frame —
      // and if the user draws immediately, the stroke may fire before the composite.
      //
      // Belt-and-suspenders: fill background white immediately before composite
      // so no transparent frame can reach the screen even if resizeCanvas touched
      // the background layer canvas.
      {
        const bgLayer = sessionLayers.find(
          (l) =>
            l.name === "Background" &&
            l.type !== "group" &&
            l.type !== "end_group",
        );
        if (bgLayer) {
          const bgCanvas = layerCanvasesRef.current.get(bgLayer.id);
          if (bgCanvas) {
            const bgCtx = bgCanvas.getContext("2d");
            if (bgCtx) {
              bgCtx.fillStyle = "#ffffff";
              bgCtx.fillRect(0, 0, bgCanvas.width, bgCanvas.height);
            }
          }
        }
      }
      compositeRef.current();

      // ── Side canvas mode: inject reference canvas into world-space container ──
      // This must happen AFTER canvas dimensions are set (w, h) so the side canvas
      // is positioned correctly relative to the main canvas.
      if (refMode === "side" && firstImage) {
        drawToSideCanvasRef.current(firstImage, w);
      }

      // ── Assertions: verify session is correctly initialized ──
      // These fire as console.warn (not error) so they're visible without being fatal.
      if (!layerCanvasesRef.current.has(drawId)) {
        console.warn(
          "[FigureDrawing] ASSERT FAILED: drawing layer not in layerCanvasMap",
          drawId,
        );
      }
      const drawCanvasCheck = layerCanvasesRef.current.get(drawId);
      if (firstImage && drawCanvasCheck?.width !== firstImage.width) {
        console.warn(
          "[FigureDrawing] ASSERT FAILED: drawing layer canvas width mismatch",
          drawCanvasCheck?.width,
          "!==",
          firstImage.width,
        );
      }
      if (activeLayerIdRef.current !== drawId) {
        console.warn(
          "[FigureDrawing] ASSERT FAILED: activeLayerId !== drawingLayerId",
          activeLayerIdRef.current,
          drawId,
        );
      }

      if (firstImage && (refMode === "floating" || refMode === "flash")) {
        // image is handled by ReferenceViewer via currentImage state
      }

      // Close the previous pose image (if any) before storing the new one.
      setCurrentImage((prev) => {
        if (prev && prev !== firstImage) prev.close();
        return firstImage;
      });
      if (refMode === "flash") {
        setIsFlashing(true);
      } else {
        timerRef.current?.reset();
      }
      setInitDone(true);
    };

    void init();
    // biome-ignore lint/correctness/useExhaustiveDependencies: activeLayerIdRef is a stable ref object, adding it satisfies linter without causing re-runs
  }, [poseQueue, layerCanvasesRef, activeLayerIdRef]);

  // ── Clear drawing layer ───────────────────────────────────────────────────
  const clearDrawingLayer = useCallback(() => {
    const ids = layerIdsRef.current;
    if (!ids) return;
    const canvas = layerCanvasesRef.current.get(ids.drawingId);
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx?.clearRect(0, 0, canvas.width, canvas.height);
  }, [layerCanvasesRef]);

  // ── Snapshot drawing layer ────────────────────────────────────────────────
  // Composites the background (white) and drawing layer together so each
  // snapshot is a flat opaque image — exactly what the user sees on screen.
  const takeSnapshot = useCallback((): ImageData => {
    const ids = layerIdsRef.current;
    if (!ids) return new ImageData(1, 1);
    const drawCanvas = layerCanvasesRef.current.get(ids.drawingId);
    if (!drawCanvas) return new ImageData(1, 1);

    const w = drawCanvas.width;
    const h = drawCanvas.height;

    // Build a flat composite: white background + drawing layer
    const composite = document.createElement("canvas");
    composite.width = w;
    composite.height = h;
    const ctx = composite.getContext("2d");
    if (!ctx) return new ImageData(1, 1);

    // Fill white (matches background layer)
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);

    // Draw the user's strokes on top
    ctx.drawImage(drawCanvas, 0, 0);

    const rawData = ctx.getImageData(0, 0, w, h);
    return cropTransparent(rawData);
  }, [layerCanvasesRef]);

  // ── Pose transition ───────────────────────────────────────────────────────
  const advancePose = useCallback(async () => {
    if (isTransitioningRef.current) return;
    isTransitioningRef.current = true;
    try {
      commitActiveStroke();

      const snapshot = takeSnapshot();
      snapshotsRef.current.push(snapshot);

      clearDrawingLayer();

      const nextIndex = currentPoseIndexRef.current + 1;

      if (nextIndex >= poseQueue.length) {
        compositeRef.current();
        onSessionCompleteRef.current(snapshotsRef.current);
        return;
      }

      const nextRef = poseQueue[nextIndex];
      const nextImage = await fetchPoseImage(nextRef);
      const tracingImage =
        configRef.current.referenceMode === "tracing" ? nextImage : null;

      await swapToImageRef.current(nextRef, tracingImage);

      // Update side canvas with new pose image
      if (configRef.current.referenceMode === "side" && nextImage) {
        const nextW = nextRef.width || nextImage.width;
        drawToSideCanvasRef.current(nextImage, nextW);
      }

      // Close the previous pose image before storing the new one.
      setCurrentImage((prev) => {
        if (prev && prev !== nextImage) prev.close();
        return nextImage;
      });
      currentPoseIndexRef.current = nextIndex;
      setCurrentPoseIndex(nextIndex);

      if (configRef.current.referenceMode === "flash") {
        setIsFlashing(true);
        timerRef.current?.pause();
      } else {
        timerRef.current?.reset();
      }
    } finally {
      isTransitioningRef.current = false;
    }
  }, [commitActiveStroke, takeSnapshot, clearDrawingLayer, poseQueue]);

  // ── Flash complete ────────────────────────────────────────────────────────
  const handleFlashComplete = useCallback(() => {
    setIsFlashing(false);
    // Reset and start the timer after the flash hides
    timerRef.current?.reset();
    timerRef.current?.resume();
  }, []);

  // ── Pause timer immediately when flash starts (timer should not run during flash) ─
  useEffect(() => {
    if (isFlashing) {
      // Small rAF delay to let the timer mount/reset before pausing
      const id = requestAnimationFrame(() => {
        timerRef.current?.pause();
      });
      return () => cancelAnimationFrame(id);
    }
  }, [isFlashing]);

  // ── Pause / resume ────────────────────────────────────────────────────────
  const togglePause = useCallback(() => {
    setIsPaused((prev) => {
      const next = !prev;
      if (next) {
        timerRef.current?.pause();
      } else {
        timerRef.current?.resume();
      }
      return next;
    });
  }, []);

  // ── Timer complete (countdown hits 0) ─────────────────────────────────────
  const handleTimerComplete = useCallback(() => {
    void advancePose();
  }, [advancePose]);

  // ── Abort ──────────────────────────────────────────────────────────────────
  const handleAbortConfirm = useCallback(() => {
    setShowAbortConfirm(false);
    // Release any snapshots accumulated before the abort — they will never be
    // compiled into a collage, so there is no reason to keep them in memory.
    snapshotsRef.current = [];
    onAbort();
  }, [onAbort]);

  const isInfinite = config.poseDuration === null;
  const totalPoses = poseQueue.length;

  // ── Loading state ──────────────────────────────────────────────────────────
  if (!initDone) {
    return (
      <div
        className="absolute inset-0 z-40 flex items-center justify-center"
        style={{ backgroundColor: "oklch(var(--canvas-bg) / 0.85)" }}
      >
        <div className="flex flex-col items-center gap-3">
          <div
            className="w-8 h-8 rounded-full border-2 animate-spin"
            style={{
              borderColor: "oklch(var(--outline))",
              borderTopColor: "oklch(var(--accent))",
            }}
          />
          <span
            className="text-sm"
            style={{ color: "oklch(var(--muted-text))" }}
          >
            Loading session…
          </span>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Reference viewer */}
      <ReferenceViewer
        image={
          config.referenceMode === "flash"
            ? isFlashing
              ? currentImage
              : null
            : currentImage
        }
        mode={config.referenceMode}
        handedness={handedness}
        onFlashComplete={handleFlashComplete}
      />

      {/* Session HUD — top right, replacing navigator area */}
      <div
        data-ocid="figure_drawing_session.hud"
        className="absolute top-2 right-2 z-40 flex items-center gap-2 px-3 py-2 rounded-xl"
        style={{
          backgroundColor: "oklch(var(--toolbar) / 0.92)",
          border: "1px solid oklch(var(--outline))",
          backdropFilter: "blur(8px)",
        }}
      >
        {/* Pause/Resume */}
        <button
          type="button"
          data-ocid="figure_drawing_session.pause_button"
          onClick={togglePause}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-opacity hover:opacity-80"
          style={{
            backgroundColor: isPaused
              ? "oklch(var(--accent))"
              : "oklch(var(--sidebar-left))",
            color: isPaused
              ? "oklch(var(--accent-text))"
              : "oklch(var(--text))",
            border: "1px solid oklch(var(--outline))",
          }}
        >
          {isPaused ? <Play size={12} /> : <Pause size={12} />}
          {isPaused ? "Resume" : "Pause"}
        </button>

        {/* Timer */}
        <div
          className="font-mono text-sm font-semibold tabular-nums min-w-[46px] text-center"
          style={{ color: "oklch(var(--accent))" }}
        >
          <LearnTimer
            ref={timerRef}
            mode={isInfinite ? "countup" : "countdown"}
            durationSeconds={config.poseDuration}
            onComplete={handleTimerComplete}
            onTick={() => {}}
          />
        </div>

        {/* Next button (infinite mode only) */}
        {isInfinite && (
          <button
            type="button"
            data-ocid="figure_drawing_session.next_button"
            onClick={() => {
              void advancePose();
            }}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-opacity hover:opacity-80"
            style={{
              backgroundColor: "oklch(var(--accent))",
              color: "oklch(var(--accent-text))",
            }}
          >
            Next
            <ChevronRight size={12} />
          </button>
        )}

        {/* Pose counter */}
        <span
          className="text-xs tabular-nums"
          style={{ color: "oklch(var(--muted-text))" }}
        >
          {currentPoseIndex + 1}/{totalPoses}
        </span>

        {/* End session */}
        <button
          type="button"
          data-ocid="figure_drawing_session.end_button"
          onClick={() => setShowAbortConfirm(true)}
          className="p-1.5 rounded-lg transition-opacity hover:opacity-80"
          style={{ color: "oklch(var(--muted-text))" }}
          title="End session"
        >
          <StopCircle size={14} />
        </button>
      </div>

      {/* Pause overlay — blocks all canvas interaction */}
      {isPaused && (
        <div
          data-ocid="figure_drawing_session.pause_overlay"
          className="absolute inset-0 z-30 flex items-center justify-center pointer-events-auto"
          style={{ backgroundColor: "oklch(var(--canvas-bg) / 0.5)" }}
        >
          <div
            className="flex flex-col items-center gap-3 px-8 py-6 rounded-2xl"
            style={{
              backgroundColor: "oklch(var(--toolbar) / 0.95)",
              border: "1px solid oklch(var(--outline))",
            }}
          >
            <Pause size={28} style={{ color: "oklch(var(--accent))" }} />
            <span
              className="text-sm font-semibold"
              style={{ color: "oklch(var(--text))" }}
            >
              Session Paused
            </span>
            <button
              type="button"
              data-ocid="figure_drawing_session.resume_button"
              onClick={togglePause}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-opacity hover:opacity-80"
              style={{
                backgroundColor: "oklch(var(--accent))",
                color: "oklch(var(--accent-text))",
              }}
            >
              <Play size={14} />
              Resume
            </button>
          </div>
        </div>
      )}

      {/* Abort confirm dialog */}
      {showAbortConfirm && (
        <div
          data-ocid="figure_drawing_session.abort_dialog"
          className="absolute inset-0 z-50 flex items-center justify-center pointer-events-auto"
          style={{ backgroundColor: "oklch(var(--canvas-bg) / 0.7)" }}
        >
          <div
            className="flex flex-col gap-4 px-7 py-6 rounded-2xl max-w-xs w-full mx-4"
            style={{
              backgroundColor: "oklch(var(--toolbar))",
              border: "1px solid oklch(var(--outline))",
            }}
          >
            <div className="flex items-center gap-3">
              <AlertTriangle
                size={20}
                style={{ color: "oklch(var(--accent))" }}
              />
              <span
                className="font-semibold text-sm"
                style={{ color: "oklch(var(--text))" }}
              >
                End session?
              </span>
            </div>
            <p
              className="text-xs"
              style={{ color: "oklch(var(--muted-text))" }}
            >
              Your progress so far will be compiled into a collage.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                data-ocid="figure_drawing_session.abort_cancel_button"
                onClick={() => setShowAbortConfirm(false)}
                className="px-3 py-1.5 rounded-lg text-sm transition-opacity hover:opacity-80"
                style={{
                  backgroundColor: "oklch(var(--sidebar-left))",
                  color: "oklch(var(--text))",
                  border: "1px solid oklch(var(--outline))",
                }}
              >
                Continue
              </button>
              <button
                type="button"
                data-ocid="figure_drawing_session.abort_confirm_button"
                onClick={handleAbortConfirm}
                className="px-3 py-1.5 rounded-lg text-sm font-semibold transition-opacity hover:opacity-80"
                style={{
                  backgroundColor: "oklch(var(--accent))",
                  color: "oklch(var(--accent-text))",
                }}
              >
                End Session
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
