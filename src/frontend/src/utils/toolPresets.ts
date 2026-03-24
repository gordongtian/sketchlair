import { DEFAULT_BRUSH_SETTINGS } from "@/components/BrushSettingsPanel";
import type { BrushSettings } from "@/components/BrushSettingsPanel";

export interface Preset {
  id: string;
  name: string;
  settings: BrushSettings;
  size?: number;
  defaultSize?: number;
  opacity?: number;
}

export const DEFAULT_PRESETS: Record<"brush" | "smear" | "eraser", Preset[]> = {
  brush: [
    {
      id: "brush-default",
      name: "Default",
      settings: { ...DEFAULT_BRUSH_SETTINGS },
    },
    {
      id: "brush-soft",
      name: "Soft",
      settings: {
        ...DEFAULT_BRUSH_SETTINGS,
        softness: 0.7,
        minOpacity: 0.1,
        pressureOpacity: true,
      },
    },
    {
      id: "brush-hard",
      name: "Hard",
      settings: { ...DEFAULT_BRUSH_SETTINGS, softness: 0, spacing: 2 },
    },
    {
      id: "brush-airbrush",
      name: "Airbrush",
      settings: {
        ...DEFAULT_BRUSH_SETTINGS,
        softness: 0.9,
        pressureOpacity: true,
        minOpacity: 0,
        spacing: 3,
      },
    },
  ],
  smear: [
    {
      id: "smear-default",
      name: "Default",
      settings: { ...DEFAULT_BRUSH_SETTINGS },
    },
    {
      id: "smear-wide",
      name: "Wide",
      settings: { ...DEFAULT_BRUSH_SETTINGS, spacing: 2 },
    },
    {
      id: "smear-soft",
      name: "Soft",
      settings: { ...DEFAULT_BRUSH_SETTINGS, softness: 0.6 },
    },
  ],
  eraser: [
    {
      id: "eraser-default",
      name: "Default",
      settings: { ...DEFAULT_BRUSH_SETTINGS },
    },
    {
      id: "eraser-soft",
      name: "Soft",
      settings: { ...DEFAULT_BRUSH_SETTINGS, softness: 0.7 },
    },
    {
      id: "eraser-hard",
      name: "Hard",
      settings: { ...DEFAULT_BRUSH_SETTINGS, softness: 0, spacing: 1 },
    },
  ],
};
