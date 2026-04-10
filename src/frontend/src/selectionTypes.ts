import type { LassoMode } from "./components/Toolbar";

export type SelectionGeom = {
  type: LassoMode;
  points?: { x: number; y: number }[];
  x?: number;
  y?: number;
  w?: number;
  h?: number;
} | null;

export type SelectionSnapshot = {
  geometry: SelectionGeom;
  maskDataURL: string | null;
  active: boolean;
  shapes: NonNullable<SelectionGeom>[];
};
