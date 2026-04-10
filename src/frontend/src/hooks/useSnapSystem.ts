import { useCallback } from "react";
import type { Layer } from "../components/LayersPanel";
import type { use1pt2ptPerspectiveRuler } from "./use1pt2ptPerspectiveRuler";
import type { use3pt5ptPerspectiveRuler } from "./use3pt5ptPerspectiveRuler";
import type { useEllipseGridRuler } from "./useEllipseGridRuler";
import type { useLineRuler } from "./useLineRuler";

type Point = { x: number; y: number };

interface UseSnapSystemParams {
  lineRuler: ReturnType<typeof useLineRuler>;
  ruler1pt2pt: ReturnType<typeof use1pt2ptPerspectiveRuler>;
  ruler3pt5pt: ReturnType<typeof use3pt5ptPerspectiveRuler>;
  ellipseGridRuler: ReturnType<typeof useEllipseGridRuler>;
  layersRef: React.MutableRefObject<Layer[]>;
  shiftHeldRef: React.MutableRefObject<boolean>;
  strokeHvPivotRef: React.MutableRefObject<Point | null>;
  strokeHvAxisRef: React.MutableRefObject<"h" | "v" | null>;
}

export interface UseSnapSystemReturn {
  getSnapPosition: (rawPos: Point, origin: Point) => Point;
}

export function useSnapSystem({
  lineRuler,
  ruler1pt2pt,
  ruler3pt5pt,
  ellipseGridRuler,
  layersRef,
  shiftHeldRef,
  strokeHvPivotRef,
  strokeHvAxisRef,
}: UseSnapSystemParams): UseSnapSystemReturn {
  // Snap a canvas position to one of three ruler lines:
  // 1. A line parallel to the horizon (through stroke origin)
  // 2. A line perpendicular to the horizon (through stroke origin)
  // 3. A line pointing toward the vanishing point (through VP, converging)
  // The line type is determined by the user's initial stroke direction and locked for the
  // entire stroke so there are no mid-stroke jumps.
  // Snap a canvas position to a ruler line. Delegates to the four ruler sub-hooks.
  const getSnapPosition = useCallback(
    (rawPos: Point, origin: Point): Point => {
      const rulerLayer = layersRef.current.find((l) => l.isRuler);
      if (!rulerLayer || !rulerLayer.isRuler) {
        if (shiftHeldRef.current) {
          if (!strokeHvPivotRef.current) strokeHvPivotRef.current = origin;
          const pivot = strokeHvPivotRef.current;
          const dx = rawPos.x - pivot.x;
          const dy = rawPos.y - pivot.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (!strokeHvAxisRef.current) {
            if (dist < 4) return pivot;
            strokeHvAxisRef.current = Math.abs(dx) >= Math.abs(dy) ? "h" : "v";
          }
          const p = strokeHvPivotRef.current;
          return strokeHvAxisRef.current === "h"
            ? { x: rawPos.x, y: p.y }
            : { x: p.x, y: rawPos.y };
        }
        return rawPos;
      }
      if (!rulerLayer.visible) {
        if (shiftHeldRef.current) {
          if (!strokeHvPivotRef.current) strokeHvPivotRef.current = origin;
          const pivot = strokeHvPivotRef.current;
          const dx = rawPos.x - pivot.x;
          const dy = rawPos.y - pivot.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (!strokeHvAxisRef.current) {
            if (dist < 4) return pivot;
            strokeHvAxisRef.current = Math.abs(dx) >= Math.abs(dy) ? "h" : "v";
          }
          const p = strokeHvPivotRef.current;
          return strokeHvAxisRef.current === "h"
            ? { x: rawPos.x, y: p.y }
            : { x: p.x, y: rawPos.y };
        }
        return rawPos;
      }
      const isRulerActive = shiftHeldRef.current
        ? !(rulerLayer.rulerActive ?? true)
        : (rulerLayer.rulerActive ?? true);
      if (!isRulerActive) return rawPos;

      const presetType = rulerLayer.rulerPresetType ?? "perspective-1pt";

      if (presetType === "line")
        return lineRuler.getLineSnapPosition(rawPos, origin);
      if (presetType === "perspective-1pt")
        return ruler1pt2pt.get1ptSnapPosition(rawPos, origin);
      if (presetType === "perspective-2pt")
        return ruler1pt2pt.get2ptSnapPosition(rawPos, origin);
      if (presetType === "perspective-3pt")
        return ruler3pt5pt.get3ptSnapPosition(rawPos, origin);
      if (presetType === "perspective-5pt")
        return ruler3pt5pt.get5ptSnapPosition(rawPos, origin);
      if (presetType === "oval")
        return ellipseGridRuler.getOvalSnapPosition(rawPos, origin);
      if (presetType === "grid")
        return ellipseGridRuler.getGridSnapPosition(rawPos, origin);
      return rawPos;
    },
    [
      lineRuler,
      ruler1pt2pt,
      ruler3pt5pt,
      ellipseGridRuler,
      layersRef,
      shiftHeldRef,
      strokeHvPivotRef,
      strokeHvAxisRef,
    ],
  );

  return { getSnapPosition };
}
