/**
 * PSD Export Utility for SketchLair
 *
 * Converts the flat layer array + layer canvas map into a valid .psd file
 * using the ag-psd library. Supports groups, blend modes, opacity, visibility,
 * and clipping masks. Ruler layers are silently skipped.
 */

import type { Layer } from "@/components/LayersPanel";
import { writePsd } from "ag-psd";

// ── Blend mode mapping: SketchLair CSS composite op → PSD 4-char key ──────────

const BLEND_MODE_MAP: Record<string, string> = {
  "source-over": "norm",
  normal: "norm",
  multiply: "mul ",
  screen: "scrn",
  overlay: "over",
  darken: "dark",
  lighten: "lite",
  "color-dodge": "div ",
  "color-burn": "idiv",
  "hard-light": "hLit",
  "soft-light": "sLit",
  difference: "diff",
  exclusion: "smud",
  hue: "hue ",
  saturation: "sat ",
  color: "colr",
  luminosity: "lum ",
};

function mapBlendMode(mode: string): { key: string; unmapped: boolean } {
  const key = BLEND_MODE_MAP[mode];
  if (key) return { key, unmapped: false };
  return { key: "norm", unmapped: true };
}

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ExportPsdParams {
  layers: Layer[];
  layerCanvasMap: Map<string, HTMLCanvasElement>;
  canvasWidth: number;
  canvasHeight: number;
  filename: string;
}

// ag-psd layer/group node shape (minimal typing for what we need)
// biome-ignore lint/suspicious/noExplicitAny: ag-psd types are incomplete
type PsdNode = Record<string, any>;

// ── Canvas helpers ─────────────────────────────────────────────────────────────

function getLayerCanvas(
  layerId: string,
  layerCanvasMap: Map<string, HTMLCanvasElement>,
  canvasWidth: number,
  canvasHeight: number,
): HTMLCanvasElement {
  const canvas = layerCanvasMap.get(layerId);
  if (canvas) return canvas;

  // Fallback: transparent canvas at document size — prevents crash on missing canvas
  console.warn(
    `[PSD Export] No canvas found for layer ${layerId} — using blank fallback`,
  );
  const fallback = document.createElement("canvas");
  fallback.width = canvasWidth;
  fallback.height = canvasHeight;
  return fallback;
}

// ── Flat array → PSD nested tree reconstruction ────────────────────────────────

function buildPsdTree(
  layers: Layer[],
  layerCanvasMap: Map<string, HTMLCanvasElement>,
  canvasWidth: number,
  canvasHeight: number,
): PsdNode[] {
  // Stack for open groups: each entry is the group node currently being built.
  const stack: PsdNode[] = [];
  const root: PsdNode[] = [];

  const currentChildren = (): PsdNode[] => {
    if (stack.length === 0) return root;
    return stack[stack.length - 1].children as PsdNode[];
  };

  for (const layer of layers) {
    const layerType = (layer as Layer & { type?: string }).type;

    // ── end_group: close the current group ──────────────────────────────────
    if (layerType === "end_group") {
      if (stack.length > 0) {
        const completedGroup = stack.pop()!;
        currentChildren().push(completedGroup);
      }
      continue;
    }

    // ── group header: open a new group node ─────────────────────────────────
    if (layerType === "group") {
      const groupOpacity =
        typeof layer.opacity === "number" ? layer.opacity : 1;
      const { key: blendKey, unmapped } = mapBlendMode(
        layer.blendMode ?? "source-over",
      );
      const groupName = unmapped ? `${layer.name} [*]` : layer.name;

      const groupNode: PsdNode = {
        name: groupName,
        hidden: !layer.visible,
        opacity: Math.round(groupOpacity * 255),
        blendMode: blendKey,
        children: [],
      };
      stack.push(groupNode);
      continue;
    }

    // ── ruler layer: skip silently ───────────────────────────────────────────
    if (
      layerType === "ruler" ||
      (layer as Layer & { isRuler?: boolean }).isRuler === true
    ) {
      console.log(`[PSD Export] Skipping ruler layer: "${layer.name}"`);
      continue;
    }

    // ── paint layer ──────────────────────────────────────────────────────────
    const { key: blendKey, unmapped } = mapBlendMode(
      layer.blendMode ?? "source-over",
    );
    const layerName = unmapped ? `${layer.name} [*]` : layer.name;
    const opacity = typeof layer.opacity === "number" ? layer.opacity : 1;

    const canvas = getLayerCanvas(
      layer.id,
      layerCanvasMap,
      canvasWidth,
      canvasHeight,
    );

    const psdLayer: PsdNode = {
      name: layerName,
      hidden: !layer.visible,
      opacity: Math.round(opacity * 255),
      blendMode: blendKey,
      clipping:
        (layer as Layer & { isClippingMask?: boolean }).isClippingMask === true,
      canvas,
    };

    currentChildren().push(psdLayer);
  }

  // Close any unclosed groups (safety net for malformed flat arrays)
  while (stack.length > 0) {
    console.warn("[PSD Export] Unclosed group found — closing automatically");
    const unclosed = stack.pop()!;
    currentChildren().push(unclosed);
  }

  return root;
}

// ── Layer order reversal ───────────────────────────────────────────────────────
//
// SketchLair's flat array is top-to-bottom (index 0 = topmost layer).
// ag-psd expects bottom-to-top order (index 0 = bottommost layer).
// This helper reverses the children array at every level of nesting so the
// topmost layer in SketchLair appears as the topmost layer in the exported PSD.

function reverseLayerOrder(nodes: PsdNode[]): PsdNode[] {
  return [...nodes].reverse().map((node) => {
    if (node.children) {
      return {
        ...node,
        children: reverseLayerOrder(node.children as PsdNode[]),
      };
    }
    return node;
  });
}

// ── Main export function ───────────────────────────────────────────────────────
//
// Returns the generated PSD as a Blob. The caller is responsible for
// delivering the Blob to the user (e.g. via exportWithSaveDialog).

export async function exportAsPSD(params: ExportPsdParams): Promise<Blob> {
  const { layers, layerCanvasMap, canvasWidth, canvasHeight } = params;

  // Build the nested PSD tree from the flat layer array, then reverse layer
  // order at every level so the topmost SketchLair layer maps to the topmost
  // PSD layer (ag-psd uses bottom-to-top ordering).
  const children = reverseLayerOrder(
    buildPsdTree(layers, layerCanvasMap, canvasWidth, canvasHeight),
  );

  const psdDoc: PsdNode = {
    width: canvasWidth,
    height: canvasHeight,
    channels: 3,
    bitsPerChannel: 8,
    colorMode: 3, // RGB
    children,
  };

  // Yield to allow loading indicator to render before the heavy writePsd call
  await new Promise<void>((resolve) => setTimeout(resolve, 0));

  // Generate the PSD binary and return as Blob — caller handles delivery
  // @ts-ignore — ag-psd writePsd accepts our document shape
  const psdBuffer: ArrayBuffer = writePsd(psdDoc);
  return new Blob([psdBuffer], { type: "application/octet-stream" });
}
