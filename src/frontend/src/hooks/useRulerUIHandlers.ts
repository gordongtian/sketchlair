import { useCallback } from "react";
import type { Layer } from "../components/LayersPanel";
import type { RulerPresetType } from "../components/RulerPresetsPanel";

interface UseRulerUIHandlersParams {
  setLayers: React.Dispatch<React.SetStateAction<Layer[]>>;
  layersRef: React.MutableRefObject<Layer[]>;
  setActiveRulerPresetType: React.Dispatch<
    React.SetStateAction<RulerPresetType>
  >;
  activeRulerPresetTypeRef: React.MutableRefObject<RulerPresetType>;
  canvasWidthRef: React.MutableRefObject<number>;
  canvasHeightRef: React.MutableRefObject<number>;
  selectionOverlayCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  rulerCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  scheduleRulerOverlay: () => void;
}

export function useRulerUIHandlers({
  setLayers,
  layersRef,
  setActiveRulerPresetType,
  activeRulerPresetTypeRef,
  canvasWidthRef,
  canvasHeightRef,
  selectionOverlayCanvasRef,
  rulerCanvasRef,
  scheduleRulerOverlay,
}: UseRulerUIHandlersParams) {
  const handleRulerPresetTypeChangeForCanvas = useCallback(
    (type: RulerPresetType) => {
      setActiveRulerPresetType(type);
      activeRulerPresetTypeRef.current = type;
      setLayers((prev) =>
        prev.map((l) => (l.isRuler ? { ...l, rulerPresetType: type } : l)),
      );
      layersRef.current = layersRef.current.map((l) =>
        l.isRuler ? { ...l, rulerPresetType: type } : l,
      );
      scheduleRulerOverlay();
    },
    [
      setActiveRulerPresetType,
      activeRulerPresetTypeRef,
      setLayers,
      layersRef,
      scheduleRulerOverlay,
    ],
  );

  const handleRulerColorChangeForCanvas = useCallback(
    (color: string) => {
      setLayers((prev) =>
        prev.map((l) => (l.isRuler ? { ...l, rulerColor: color } : l)),
      );
      layersRef.current = layersRef.current.map((l) =>
        l.isRuler ? { ...l, rulerColor: color } : l,
      );
      scheduleRulerOverlay();
    },
    [setLayers, layersRef, scheduleRulerOverlay],
  );

  const handleVp1ColorChangeForCanvas = useCallback(
    (color: string) => {
      setLayers((prev) =>
        prev.map((l) => (l.isRuler ? { ...l, vp1Color: color } : l)),
      );
      layersRef.current = layersRef.current.map((l) =>
        l.isRuler ? { ...l, vp1Color: color } : l,
      );
      scheduleRulerOverlay();
    },
    [setLayers, layersRef, scheduleRulerOverlay],
  );

  const handleVp2ColorChangeForCanvas = useCallback(
    (color: string) => {
      setLayers((prev) =>
        prev.map((l) => (l.isRuler ? { ...l, vp2Color: color } : l)),
      );
      layersRef.current = layersRef.current.map((l) =>
        l.isRuler ? { ...l, vp2Color: color } : l,
      );
      scheduleRulerOverlay();
    },
    [setLayers, layersRef, scheduleRulerOverlay],
  );

  const handleVp3ColorChangeForCanvas = useCallback(
    (color: string) => {
      setLayers((prev) =>
        prev.map((l) => (l.isRuler ? { ...l, vp3Color: color } : l)),
      );
      layersRef.current = layersRef.current.map((l) =>
        l.isRuler ? { ...l, vp3Color: color } : l,
      );
      scheduleRulerOverlay();
    },
    [setLayers, layersRef, scheduleRulerOverlay],
  );

  const handleRulerWarmupDistChangeForCanvas = useCallback(
    (val: number) => {
      setLayers((prev) =>
        prev.map((l) => (l.isRuler ? { ...l, rulerWarmupDist: val } : l)),
      );
      layersRef.current = layersRef.current.map((l) =>
        l.isRuler ? { ...l, rulerWarmupDist: val } : l,
      );
    },
    [setLayers, layersRef],
  );

  const handleLineSnapModeChangeForCanvas = useCallback(
    (mode: "line" | "parallel") => {
      setLayers((prev) =>
        prev.map((l) => (l.isRuler ? { ...l, lineSnapMode: mode } : l)),
      );
      layersRef.current = layersRef.current.map((l) =>
        l.isRuler ? { ...l, lineSnapMode: mode } : l,
      );
    },
    [setLayers, layersRef],
  );

  const handleLockFocalLengthChangeForCanvas = useCallback(
    (val: boolean) => {
      setLayers((prev) =>
        prev.map((l) => (l.isRuler ? { ...l, lockFocalLength: val } : l)),
      );
      layersRef.current = layersRef.current.map((l) =>
        l.isRuler ? { ...l, lockFocalLength: val } : l,
      );
    },
    [setLayers, layersRef],
  );

  const handleOvalSnapModeChangeForCanvas = useCallback(
    (mode: "ellipse" | "parallel-minor") => {
      setLayers((prev) =>
        prev.map((l) => (l.isRuler ? { ...l, ovalSnapMode: mode } : l)),
      );
      layersRef.current = layersRef.current.map((l) =>
        l.isRuler ? { ...l, ovalSnapMode: mode } : l,
      );
    },
    [setLayers, layersRef],
  );

  const handleFivePtEnableCenterChangeForCanvas = useCallback(
    (v: boolean) => {
      setLayers((prev) =>
        prev.map((l) => (l.isRuler ? { ...l, fivePtEnableCenter: v } : l)),
      );
      layersRef.current = layersRef.current.map((l) =>
        l.isRuler ? { ...l, fivePtEnableCenter: v } : l,
      );
    },
    [setLayers, layersRef],
  );

  const handleFivePtEnableLRChangeForCanvas = useCallback(
    (v: boolean) => {
      setLayers((prev) =>
        prev.map((l) => (l.isRuler ? { ...l, fivePtEnableLR: v } : l)),
      );
      layersRef.current = layersRef.current.map((l) =>
        l.isRuler ? { ...l, fivePtEnableLR: v } : l,
      );
    },
    [setLayers, layersRef],
  );

  const handleFivePtEnableUDChangeForCanvas = useCallback(
    (v: boolean) => {
      setLayers((prev) =>
        prev.map((l) => (l.isRuler ? { ...l, fivePtEnableUD: v } : l)),
      );
      layersRef.current = layersRef.current.map((l) =>
        l.isRuler ? { ...l, fivePtEnableUD: v } : l,
      );
    },
    [setLayers, layersRef],
  );

  const handleGridResetForCanvas = useCallback(() => {
    const half2 = 150;
    const cx3 = canvasWidthRef.current / 2;
    const cy3 = canvasHeightRef.current / 2;
    const corners: [
      { x: number; y: number },
      { x: number; y: number },
      { x: number; y: number },
      { x: number; y: number },
    ] = [
      { x: cx3 - half2, y: cy3 - half2 },
      { x: cx3 + half2, y: cy3 - half2 },
      { x: cx3 + half2, y: cy3 + half2 },
      { x: cx3 - half2, y: cy3 + half2 },
    ];
    setLayers((prev) =>
      prev.map((l) => (l.isRuler ? { ...l, gridCorners: corners } : l)),
    );
    layersRef.current = layersRef.current.map((l) =>
      l.isRuler ? { ...l, gridCorners: corners } : l,
    );
    scheduleRulerOverlay();
  }, [
    setLayers,
    layersRef,
    canvasWidthRef,
    canvasHeightRef,
    scheduleRulerOverlay,
  ]);

  const handleGridModeChangeForCanvas = useCallback(
    (mode: "subdivide" | "extrude") => {
      setLayers((prev) =>
        prev.map((l) => (l.isRuler ? { ...l, gridMode: mode } : l)),
      );
      layersRef.current = layersRef.current.map((l) =>
        l.isRuler ? { ...l, gridMode: mode } : l,
      );
      scheduleRulerOverlay();
    },
    [setLayers, layersRef, scheduleRulerOverlay],
  );

  const handleGridVertSegmentsChangeForCanvas = useCallback(
    (v: number) => {
      setLayers((prev) =>
        prev.map((l) => (l.isRuler ? { ...l, gridVertSegments: v } : l)),
      );
      layersRef.current = layersRef.current.map((l) =>
        l.isRuler ? { ...l, gridVertSegments: v } : l,
      );
      scheduleRulerOverlay();
    },
    [setLayers, layersRef, scheduleRulerOverlay],
  );

  const handleGridHorizSegmentsChangeForCanvas = useCallback(
    (v: number) => {
      setLayers((prev) =>
        prev.map((l) => (l.isRuler ? { ...l, gridHorizSegments: v } : l)),
      );
      layersRef.current = layersRef.current.map((l) =>
        l.isRuler ? { ...l, gridHorizSegments: v } : l,
      );
      scheduleRulerOverlay();
    },
    [setLayers, layersRef, scheduleRulerOverlay],
  );

  const handleFivePtCenterColorChangeForCanvas = useCallback(
    (color: string) => {
      setLayers((prev) =>
        prev.map((l) => (l.isRuler ? { ...l, fivePtCenterColor: color } : l)),
      );
      layersRef.current = layersRef.current.map((l) =>
        l.isRuler ? { ...l, fivePtCenterColor: color } : l,
      );
      scheduleRulerOverlay();
    },
    [setLayers, layersRef, scheduleRulerOverlay],
  );

  const handleFivePtLRColorChangeForCanvas = useCallback(
    (color: string) => {
      setLayers((prev) =>
        prev.map((l) => (l.isRuler ? { ...l, fivePtLRColor: color } : l)),
      );
      layersRef.current = layersRef.current.map((l) =>
        l.isRuler ? { ...l, fivePtLRColor: color } : l,
      );
      scheduleRulerOverlay();
    },
    [setLayers, layersRef, scheduleRulerOverlay],
  );

  const handleFivePtUDColorChangeForCanvas = useCallback(
    (color: string) => {
      setLayers((prev) =>
        prev.map((l) => (l.isRuler ? { ...l, fivePtUDColor: color } : l)),
      );
      layersRef.current = layersRef.current.map((l) =>
        l.isRuler ? { ...l, fivePtUDColor: color } : l,
      );
      scheduleRulerOverlay();
    },
    [setLayers, layersRef, scheduleRulerOverlay],
  );

  const handleSelectionOverlayCanvasRef = useCallback(
    (el: HTMLCanvasElement | null) => {
      selectionOverlayCanvasRef.current = el;
    },
    [selectionOverlayCanvasRef],
  );

  const handleRulerCanvasRef = useCallback(
    (el: HTMLCanvasElement | null) => {
      rulerCanvasRef.current = el;
    },
    [rulerCanvasRef],
  );

  return {
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
  };
}
