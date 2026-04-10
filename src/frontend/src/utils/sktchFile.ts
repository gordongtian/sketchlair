import type { Layer } from "../components/LayersPanel";
import type { UndoEntry } from "../hooks/useLayerSystem";
import type { SelectionSnapshot } from "../selectionTypes";
import type { LayerGroup, LayerItem, LayerNode } from "../types";
import { RULER_KEYS, type RulerFields } from "../types";

export interface SktchFile {
  version: 1;
  canvasWidth: number;
  canvasHeight: number;
  activeLayerId: string;
  layers: SerializedLayer[];
  layerTree?: SerializedLayerNode[];
  undoStack: SerializedUndoEntry[];
  redoStack: SerializedUndoEntry[];
}

interface SerializedLayer extends RulerFields {
  id: string;
  name: string;
  blendMode: string;
  opacity: number;
  visible: boolean;
  isClippingMask: boolean;
  alphaLock: boolean;
  pixelDataUrl: string;
}

// ── Layer tree serialization types ─────────────────────────────────────────

interface SerializedLayerItem {
  kind: "layer";
  id: string;
  layer: SerializedLayer;
}

interface SerializedLayerGroup {
  kind: "group";
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  collapsed: boolean;
  children: SerializedLayerNode[];
}

type SerializedLayerNode = SerializedLayerItem | SerializedLayerGroup;

// ── Undo entry serialization types (existing + 10 new) ─────────────────────

type SerializedUndoEntry =
  | {
      type: "pixels";
      layerId: string;
      beforeUrl: string;
      afterUrl: string;
      dirtyRect?: { x: number; y: number; w: number; h: number };
    }
  | {
      type: "layer-add";
      layer: SerializedLayer;
      index: number;
      previousActiveLayerId?: string;
    }
  | {
      type: "layer-add-pixels";
      layer: SerializedLayer;
      index: number;
      pixelsUrl: string;
      srcLayerId?: string;
      srcBeforeUrl?: string;
      srcAfterUrl?: string;
    }
  | {
      type: "layer-delete";
      layer: SerializedLayer;
      pixelsUrl: string;
      index: number;
    }
  | { type: "blend-mode"; layerId: string; before: string; after: string }
  | { type: "selection"; before: SelectionSnapshot; after: SelectionSnapshot }
  | {
      type: "ruler-edit";
      layerId: string;
      before: Record<string, unknown>;
      after: Record<string, unknown>;
    }
  | {
      type: "layer-merge";
      activeLayer: SerializedLayer;
      activeIndex: number;
      activePixelsUrl: string;
      belowLayerId: string;
      belowPixelsBeforeUrl: string;
      belowPixelsAfterUrl: string;
      belowLayerIsClippingMaskBefore: boolean;
      belowLayerIsClippingMaskAfter: boolean;
    }
  | {
      type: "canvas-resize";
      beforeWidth: number;
      beforeHeight: number;
      afterWidth: number;
      afterHeight: number;
      cropX: number;
      cropY: number;
      layerPixelsBefore: { layerId: string; dataUrl: string }[];
      layerPixelsAfter: { layerId: string; dataUrl: string }[];
      layersBefore: SerializedLayer[];
      layersAfter: SerializedLayer[];
    }
  // ── 10 new entry types ───────────────────────────────────────────────────
  | {
      type: "layer-group-create";
      treeBefore: SerializedLayerNode[];
      treeAfter: SerializedLayerNode[];
      layersBefore: SerializedLayer[];
      layersAfter: SerializedLayer[];
    }
  | {
      type: "layer-group-delete";
      treeBefore: SerializedLayerNode[];
      treeAfter: SerializedLayerNode[];
      layersBefore: SerializedLayer[];
      layersAfter: SerializedLayer[];
      deletedCanvases: { layerId: string; dataUrl: string }[];
    }
  | {
      type: "layer-opacity-change";
      layerId: string;
      before: number;
      after: number;
    }
  | {
      type: "group-opacity-change";
      groupId: string;
      before: number;
      after: number;
    }
  | {
      type: "layer-visibility-change";
      layerId: string;
      before: boolean;
      after: boolean;
    }
  | {
      type: "alpha-lock-change";
      layerId: string;
      before: boolean;
      after: boolean;
    }
  | {
      type: "clipping-mask-change";
      layerId: string;
      before: boolean;
      after: boolean;
    }
  | { type: "layer-rename"; layerId: string; before: string; after: string }
  | {
      type: "layer-reorder";
      treeBefore: SerializedLayerNode[];
      treeAfter: SerializedLayerNode[];
      layersBefore: SerializedLayer[];
      layersAfter: SerializedLayer[];
    }
  | {
      type: "multi-layer-pixels";
      layers: { layerId: string; beforeUrl: string; afterUrl: string }[];
    };

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Async canvas→data-URL via toBlob + FileReader.
 * Allows the browser to release memory between calls rather than holding all
 * base64 strings in RAM simultaneously (unlike synchronous toDataURL).
 */
async function canvasToDataUrlAsync(
  canvas: HTMLCanvasElement,
): Promise<string> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("canvas.toBlob returned null"));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    }, "image/png");
  });
}

/**
 * Converts an ImageData to a data URL asynchronously via an offscreen canvas.
 * Falls back gracefully — returns "" on failure so a single bad layer doesn't
 * abort the entire save.
 */
async function imageDataToDataUrlAsync(data: ImageData): Promise<string> {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = data.width;
    canvas.height = data.height;
    const ctx = canvas.getContext("2d")!;
    ctx.putImageData(data, 0, 0);
    return await canvasToDataUrlAsync(canvas);
  } catch (err) {
    console.warn("[sktchFile] imageDataToDataUrlAsync failed:", err);
    return "";
  }
}

async function dataUrlToImageData(
  url: string,
  w: number,
  h: number,
): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      resolve(ctx.getImageData(0, 0, w, h));
    };
    img.onerror = reject;
    img.src = url;
  });
}

function pickRulerFields(obj: Record<string, unknown>): Partial<RulerFields> {
  const result: Partial<RulerFields> = {};
  for (const key of RULER_KEYS) {
    if (key in obj) {
      (result as Record<string, unknown>)[key] = obj[key];
    }
  }
  return result;
}

function layerToSerialized(
  layer: Layer,
  pixelDataUrl: string,
): SerializedLayer {
  return {
    id: layer.id,
    name: layer.name,
    blendMode: layer.blendMode,
    opacity: layer.opacity,
    visible: layer.visible,
    isClippingMask: layer.isClippingMask,
    alphaLock: layer.alphaLock,
    pixelDataUrl,
    ...pickRulerFields(layer as unknown as Record<string, unknown>),
  };
}

function serializedToLayer(s: SerializedLayer): Layer {
  return {
    id: s.id,
    name: s.name,
    blendMode: s.blendMode,
    opacity: s.opacity,
    visible: s.visible,
    isClippingMask: s.isClippingMask,
    alphaLock: s.alphaLock,
    ...pickRulerFields(s as unknown as Record<string, unknown>),
  };
}

// ── Layer tree serialization ─────────────────────────────────────────────────

/**
 * Serializes a LayerNode[] tree asynchronously, converting each leaf canvas
 * to a data URL one at a time (sequential) to avoid memory spikes.
 * Layer pixel data is embedded in the leaf SerializedLayerItem nodes.
 */
export async function serializeLayerTreeAsync(
  tree: LayerNode[],
  layerCanvases: Map<string, HTMLCanvasElement>,
): Promise<SerializedLayerNode[]> {
  const result: SerializedLayerNode[] = [];
  for (const node of tree) {
    if (node.kind === "group") {
      const g = node as LayerGroup;
      const children = await serializeLayerTreeAsync(
        g.children ?? [],
        layerCanvases,
      );
      result.push({
        kind: "group" as const,
        id: g.id,
        name: g.name,
        visible: g.visible,
        opacity: g.opacity,
        collapsed: g.collapsed,
        children,
      });
    } else {
      // kind === "layer"
      const item = node as LayerItem;
      let pixelDataUrl = "";
      if (!item.layer.isRuler) {
        const canvas = layerCanvases.get(item.layer.id);
        if (canvas) {
          try {
            pixelDataUrl = await canvasToDataUrlAsync(canvas);
          } catch (err) {
            console.warn(
              `[sktchFile] Failed to serialize layer ${item.layer.id}, skipping pixel data:`,
              err,
            );
          }
        }
      }
      result.push({
        kind: "layer" as const,
        id: item.id,
        layer: layerToSerialized(item.layer, pixelDataUrl),
      });
    }
  }
  return result;
}

/**
 * Synchronous version retained for internal backward-compat paths only.
 * Prefer serializeLayerTreeAsync for all new save paths.
 */
export function serializeLayerTree(
  tree: LayerNode[],
  layerCanvases: Map<string, HTMLCanvasElement>,
): SerializedLayerNode[] {
  return tree.map((node) => {
    if (node.kind === "group") {
      const g = node as LayerGroup;
      return {
        kind: "group" as const,
        id: g.id,
        name: g.name,
        visible: g.visible,
        opacity: g.opacity,
        collapsed: g.collapsed,
        children: serializeLayerTree(g.children ?? [], layerCanvases),
      };
    }
    // kind === "layer"
    const item = node as LayerItem;
    const canvas = layerCanvases.get(item.layer.id);
    const pixelDataUrl =
      canvas && !item.layer.isRuler ? canvas.toDataURL("image/png") : "";
    return {
      kind: "layer" as const,
      id: item.id,
      layer: layerToSerialized(item.layer, pixelDataUrl),
    };
  });
}

/**
 * Deserializes a SerializedLayerNode[] back into a LayerNode[] tree.
 * Pixel data loading is handled separately via `layerPixels` map.
 */
export function deserializeLayerTree(
  nodes: SerializedLayerNode[],
): LayerNode[] {
  return nodes.map((node) => {
    if (node.kind === "group") {
      const g = node as SerializedLayerGroup;
      return {
        kind: "group" as const,
        id: g.id,
        name: g.name,
        visible: g.visible,
        opacity: g.opacity,
        collapsed: g.collapsed,
        children: deserializeLayerTree(g.children ?? []),
      } satisfies LayerGroup;
    }
    // kind === "layer"
    const item = node as SerializedLayerItem;
    return {
      kind: "layer" as const,
      id: item.id,
      layer: serializedToLayer(item.layer),
    } satisfies LayerItem;
  });
}

/**
 * Collects all SerializedLayer leaf nodes from a SerializedLayerNode[] tree
 * so they can be included in the flat `layers` array for backward compatibility.
 */
function collectSerializedLayers(
  nodes: SerializedLayerNode[],
): SerializedLayer[] {
  const result: SerializedLayer[] = [];
  for (const node of nodes) {
    if (node.kind === "layer") {
      result.push(node.layer);
    } else {
      result.push(...collectSerializedLayers(node.children ?? []));
    }
  }
  return result;
}

/**
 * Builds a flat LayerNode[] from a flat Layer[] array (for backward compat with
 * old files that have no layerTree field).
 */
function flatLayersToTree(layers: Layer[]): LayerNode[] {
  return layers.map((layer) => ({
    kind: "layer" as const,
    id: layer.id,
    layer,
  }));
}

// ── Undo entry serialization ─────────────────────────────────────────────────

/**
 * Returns null for entry types that cannot be serialized (e.g. layers-clear-rulers
 * which holds only Layer metadata, no pixel data). These entries are silently
 * filtered out of the saved history stack rather than throwing and aborting the
 * whole save.
 *
 * All ImageData→dataURL conversions are now async (toBlob path) to release
 * memory between layers rather than holding all base64 strings in RAM at once.
 */
async function serializeUndoEntry(
  entry: UndoEntry,
  _canvasWidth: number,
  _canvasHeight: number,
  layerCanvases: Map<string, HTMLCanvasElement>,
): Promise<SerializedUndoEntry | null> {
  if (entry.type === "pixels") {
    const beforeUrl = await imageDataToDataUrlAsync(entry.before);
    const afterUrl = await imageDataToDataUrlAsync(entry.after);
    return {
      type: "pixels",
      layerId: entry.layerId,
      beforeUrl,
      afterUrl,
      dirtyRect: entry.dirtyRect,
    };
  }
  if (entry.type === "layer-add") {
    return {
      type: "layer-add",
      layer: layerToSerialized(entry.layer, ""),
      index: entry.index,
      previousActiveLayerId: entry.previousActiveLayerId,
    };
  }
  if (entry.type === "layer-add-pixels") {
    const pixelsUrl = await imageDataToDataUrlAsync(entry.pixels);
    const srcBeforeUrl = entry.srcBefore
      ? await imageDataToDataUrlAsync(entry.srcBefore)
      : undefined;
    const srcAfterUrl = entry.srcAfter
      ? await imageDataToDataUrlAsync(entry.srcAfter)
      : undefined;
    return {
      type: "layer-add-pixels",
      layer: layerToSerialized(entry.layer, ""),
      index: entry.index,
      pixelsUrl,
      srcLayerId: entry.srcLayerId,
      srcBeforeUrl,
      srcAfterUrl,
    };
  }
  if (entry.type === "layer-delete") {
    const pixelsUrl = await imageDataToDataUrlAsync(entry.pixels);
    return {
      type: "layer-delete",
      layer: layerToSerialized(entry.layer, ""),
      pixelsUrl,
      index: entry.index,
    };
  }
  if (entry.type === "blend-mode") {
    return {
      type: "blend-mode",
      layerId: entry.layerId,
      before: entry.before,
      after: entry.after,
    };
  }
  if (entry.type === "selection") {
    return { type: "selection", before: entry.before, after: entry.after };
  }
  if (entry.type === "ruler-edit") {
    return {
      type: "ruler-edit",
      layerId: entry.layerId,
      before: entry.before as Record<string, unknown>,
      after: entry.after as Record<string, unknown>,
    };
  }
  if (entry.type === "layer-merge") {
    const activePixelsUrl = await imageDataToDataUrlAsync(entry.activePixels);
    const belowPixelsBeforeUrl = await imageDataToDataUrlAsync(
      entry.belowPixelsBefore,
    );
    const belowPixelsAfterUrl = await imageDataToDataUrlAsync(
      entry.belowPixelsAfter,
    );
    return {
      type: "layer-merge",
      activeLayer: layerToSerialized(entry.activeLayer, ""),
      activeIndex: entry.activeIndex,
      activePixelsUrl,
      belowLayerId: entry.belowLayerId,
      belowPixelsBeforeUrl,
      belowPixelsAfterUrl,
      belowLayerIsClippingMaskBefore: entry.belowLayerIsClippingMaskBefore,
      belowLayerIsClippingMaskAfter: entry.belowLayerIsClippingMaskAfter,
    };
  }
  if (entry.type === "canvas-resize") {
    const beforeList: { layerId: string; dataUrl: string }[] = [];
    const afterList: { layerId: string; dataUrl: string }[] = [];
    for (const [layerId, imgData] of entry.layerPixelsBefore) {
      beforeList.push({
        layerId,
        dataUrl: await imageDataToDataUrlAsync(imgData),
      });
    }
    for (const [layerId, imgData] of entry.layerPixelsAfter) {
      afterList.push({
        layerId,
        dataUrl: await imageDataToDataUrlAsync(imgData),
      });
    }
    return {
      type: "canvas-resize",
      beforeWidth: entry.beforeWidth,
      beforeHeight: entry.beforeHeight,
      afterWidth: entry.afterWidth,
      afterHeight: entry.afterHeight,
      cropX: entry.cropX,
      cropY: entry.cropY,
      layerPixelsBefore: beforeList,
      layerPixelsAfter: afterList,
      layersBefore: entry.layersBefore.map((l) => layerToSerialized(l, "")),
      layersAfter: entry.layersAfter.map((l) => layerToSerialized(l, "")),
    };
  }
  // ── 10 new entry types ────────────────────────────────────────────────────
  if (entry.type === "layer-group-create") {
    return {
      type: "layer-group-create",
      treeBefore: serializeLayerTree(entry.treeBefore, layerCanvases),
      treeAfter: serializeLayerTree(entry.treeAfter, layerCanvases),
      layersBefore: entry.layersBefore.map((l) => layerToSerialized(l, "")),
      layersAfter: entry.layersAfter.map((l) => layerToSerialized(l, "")),
    };
  }
  if (entry.type === "layer-group-delete") {
    const deletedCanvasesList: { layerId: string; dataUrl: string }[] = [];
    for (const [layerId, imgData] of entry.deletedCanvases) {
      deletedCanvasesList.push({
        layerId,
        dataUrl: await imageDataToDataUrlAsync(imgData),
      });
    }
    return {
      type: "layer-group-delete",
      treeBefore: serializeLayerTree(entry.treeBefore, layerCanvases),
      treeAfter: serializeLayerTree(entry.treeAfter, layerCanvases),
      layersBefore: entry.layersBefore.map((l) => layerToSerialized(l, "")),
      layersAfter: entry.layersAfter.map((l) => layerToSerialized(l, "")),
      deletedCanvases: deletedCanvasesList,
    };
  }
  if (entry.type === "layer-opacity-change") {
    return {
      type: "layer-opacity-change",
      layerId: entry.layerId,
      before: entry.before,
      after: entry.after,
    };
  }
  if (entry.type === "group-opacity-change") {
    return {
      type: "group-opacity-change",
      groupId: entry.groupId,
      before: entry.before,
      after: entry.after,
    };
  }
  if (entry.type === "layer-visibility-change") {
    return {
      type: "layer-visibility-change",
      layerId: entry.layerId,
      before: entry.before,
      after: entry.after,
    };
  }
  if (entry.type === "alpha-lock-change") {
    return {
      type: "alpha-lock-change",
      layerId: entry.layerId,
      before: entry.before,
      after: entry.after,
    };
  }
  if (entry.type === "clipping-mask-change") {
    return {
      type: "clipping-mask-change",
      layerId: entry.layerId,
      before: entry.before,
      after: entry.after,
    };
  }
  if (entry.type === "layer-rename") {
    return {
      type: "layer-rename",
      layerId: entry.layerId,
      before: entry.before,
      after: entry.after,
    };
  }
  if (entry.type === "layer-reorder") {
    return {
      type: "layer-reorder",
      treeBefore: serializeLayerTree(entry.treeBefore, layerCanvases),
      treeAfter: serializeLayerTree(entry.treeAfter, layerCanvases),
      layersBefore: entry.layersBefore.map((l) => layerToSerialized(l, "")),
      layersAfter: entry.layersAfter.map((l) => layerToSerialized(l, "")),
    };
  }
  if (entry.type === "multi-layer-pixels") {
    const layersList: {
      layerId: string;
      beforeUrl: string;
      afterUrl: string;
    }[] = [];
    for (const [layerId, { before, after }] of entry.layers) {
      layersList.push({
        layerId,
        beforeUrl: await imageDataToDataUrlAsync(before),
        afterUrl: await imageDataToDataUrlAsync(after),
      });
    }
    return {
      type: "multi-layer-pixels",
      layers: layersList,
    };
  }
  // layers-clear-rulers holds only layer metadata (no pixel ImageData to serialize).
  // We intentionally drop it from the saved history rather than failing the save.
  if (entry.type === "layers-clear-rulers") {
    return null;
  }
  // Exhaustive fallback — should never be reached
  return null;
}

async function deserializeUndoEntry(
  s: SerializedUndoEntry,
  canvasWidth: number,
  canvasHeight: number,
): Promise<UndoEntry | null> {
  if (s.type === "pixels") {
    const dr = s.dirtyRect;
    const w = dr ? dr.w : canvasWidth;
    const h = dr ? dr.h : canvasHeight;
    const [before, after] = await Promise.all([
      dataUrlToImageData(s.beforeUrl, w, h),
      dataUrlToImageData(s.afterUrl, w, h),
    ]);
    return {
      type: "pixels",
      layerId: s.layerId,
      before,
      after,
      dirtyRect: s.dirtyRect,
    };
  }
  if (s.type === "layer-add") {
    return {
      type: "layer-add",
      layer: serializedToLayer(s.layer),
      index: s.index,
      previousActiveLayerId: s.previousActiveLayerId,
    };
  }
  if (s.type === "layer-add-pixels") {
    const pixels = await dataUrlToImageData(
      s.pixelsUrl,
      canvasWidth,
      canvasHeight,
    );
    const srcBefore = s.srcBeforeUrl
      ? await dataUrlToImageData(s.srcBeforeUrl, canvasWidth, canvasHeight)
      : undefined;
    const srcAfter = s.srcAfterUrl
      ? await dataUrlToImageData(s.srcAfterUrl, canvasWidth, canvasHeight)
      : undefined;
    return {
      type: "layer-add-pixels",
      layer: serializedToLayer(s.layer),
      index: s.index,
      pixels,
      srcLayerId: s.srcLayerId,
      srcBefore,
      srcAfter,
    };
  }
  if (s.type === "layer-delete") {
    const pixels = await dataUrlToImageData(
      s.pixelsUrl,
      canvasWidth,
      canvasHeight,
    );
    return {
      type: "layer-delete",
      layer: serializedToLayer(s.layer),
      pixels,
      index: s.index,
    };
  }
  if (s.type === "blend-mode") {
    return {
      type: "blend-mode",
      layerId: s.layerId,
      before: s.before,
      after: s.after,
    };
  }
  if (s.type === "selection") {
    return { type: "selection", before: s.before, after: s.after };
  }
  if (s.type === "ruler-edit") {
    return {
      type: "ruler-edit",
      layerId: s.layerId,
      before: s.before as Parameters<typeof Object.assign>[0],
      after: s.after as Parameters<typeof Object.assign>[0],
    };
  }
  if (s.type === "layer-merge") {
    const [activePixels, belowPixelsBefore, belowPixelsAfter] =
      await Promise.all([
        dataUrlToImageData(s.activePixelsUrl, canvasWidth, canvasHeight),
        dataUrlToImageData(s.belowPixelsBeforeUrl, canvasWidth, canvasHeight),
        dataUrlToImageData(s.belowPixelsAfterUrl, canvasWidth, canvasHeight),
      ]);
    return {
      type: "layer-merge",
      activeLayer: serializedToLayer(s.activeLayer),
      activeIndex: s.activeIndex,
      activePixels,
      belowLayerId: s.belowLayerId,
      belowPixelsBefore,
      belowPixelsAfter,
      belowLayerIsClippingMaskBefore: s.belowLayerIsClippingMaskBefore ?? false,
      belowLayerIsClippingMaskAfter: s.belowLayerIsClippingMaskAfter ?? false,
    };
  }
  if (s.type === "canvas-resize") {
    const beforeMap = new Map<string, ImageData>();
    const afterMap = new Map<string, ImageData>();
    await Promise.all([
      ...s.layerPixelsBefore.map(async ({ layerId, dataUrl }) => {
        beforeMap.set(
          layerId,
          await dataUrlToImageData(dataUrl, s.beforeWidth, s.beforeHeight),
        );
      }),
      ...s.layerPixelsAfter.map(async ({ layerId, dataUrl }) => {
        afterMap.set(
          layerId,
          await dataUrlToImageData(dataUrl, s.afterWidth, s.afterHeight),
        );
      }),
    ]);
    return {
      type: "canvas-resize",
      beforeWidth: s.beforeWidth,
      beforeHeight: s.beforeHeight,
      afterWidth: s.afterWidth,
      afterHeight: s.afterHeight,
      cropX: s.cropX,
      cropY: s.cropY,
      layerPixelsBefore: beforeMap,
      layerPixelsAfter: afterMap,
      layersBefore: s.layersBefore.map(serializedToLayer),
      layersAfter: s.layersAfter.map(serializedToLayer),
    };
  }
  // ── 10 new entry types ────────────────────────────────────────────────────
  if (s.type === "layer-group-create") {
    return {
      type: "layer-group-create",
      treeBefore: deserializeLayerTree(s.treeBefore),
      treeAfter: deserializeLayerTree(s.treeAfter),
      layersBefore: s.layersBefore.map(serializedToLayer),
      layersAfter: s.layersAfter.map(serializedToLayer),
    };
  }
  if (s.type === "layer-group-delete") {
    const deletedCanvasesMap = new Map<string, ImageData>();
    await Promise.all(
      s.deletedCanvases.map(async ({ layerId, dataUrl }) => {
        deletedCanvasesMap.set(
          layerId,
          await dataUrlToImageData(dataUrl, canvasWidth, canvasHeight),
        );
      }),
    );
    return {
      type: "layer-group-delete",
      treeBefore: deserializeLayerTree(s.treeBefore),
      treeAfter: deserializeLayerTree(s.treeAfter),
      layersBefore: s.layersBefore.map(serializedToLayer),
      layersAfter: s.layersAfter.map(serializedToLayer),
      deletedCanvases: deletedCanvasesMap,
    };
  }
  if (s.type === "layer-opacity-change") {
    return {
      type: "layer-opacity-change",
      layerId: s.layerId,
      before: s.before,
      after: s.after,
    };
  }
  if (s.type === "group-opacity-change") {
    return {
      type: "group-opacity-change",
      groupId: s.groupId,
      before: s.before,
      after: s.after,
    };
  }
  if (s.type === "layer-visibility-change") {
    return {
      type: "layer-visibility-change",
      layerId: s.layerId,
      before: s.before,
      after: s.after,
    };
  }
  if (s.type === "alpha-lock-change") {
    return {
      type: "alpha-lock-change",
      layerId: s.layerId,
      before: s.before,
      after: s.after,
    };
  }
  if (s.type === "clipping-mask-change") {
    return {
      type: "clipping-mask-change",
      layerId: s.layerId,
      before: s.before,
      after: s.after,
    };
  }
  if (s.type === "layer-rename") {
    return {
      type: "layer-rename",
      layerId: s.layerId,
      before: s.before,
      after: s.after,
    };
  }
  if (s.type === "layer-reorder") {
    return {
      type: "layer-reorder",
      treeBefore: deserializeLayerTree(s.treeBefore),
      treeAfter: deserializeLayerTree(s.treeAfter),
      layersBefore: s.layersBefore.map(serializedToLayer),
      layersAfter: s.layersAfter.map(serializedToLayer),
    };
  }
  if (s.type === "multi-layer-pixels") {
    const layersMap = new Map<
      string,
      { before: ImageData; after: ImageData }
    >();
    await Promise.all(
      s.layers.map(async ({ layerId, beforeUrl, afterUrl }) => {
        const [before, after] = await Promise.all([
          dataUrlToImageData(beforeUrl, canvasWidth, canvasHeight),
          dataUrlToImageData(afterUrl, canvasWidth, canvasHeight),
        ]);
        layersMap.set(layerId, { before, after });
      }),
    );
    return {
      type: "multi-layer-pixels",
      layers: layersMap,
    };
  }
  // Unknown type — log a warning and skip rather than throwing
  console.warn(
    "[sktchFile] Unknown serialized UndoEntry type, skipping:",
    (s as { type: string }).type,
  );
  return null;
}

// ── Size estimation ──────────────────────────────────────────────────────────

/**
 * Estimates the raw byte cost of serializing undo/redo history for a given
 * canvas size and layer/step count. Used to cap history before a memory spike.
 *
 * Formula: width × height × 4 bytes/pixel × 2 (before+after) × layerCount × stepCount
 * Base64 encoding adds ~33% overhead, but raw pixel size is the right input here.
 */
function estimateHistoryBytes(
  canvasWidth: number,
  canvasHeight: number,
  layerCount: number,
  stepCount: number,
): number {
  return canvasWidth * canvasHeight * 4 * 2 * layerCount * stepCount;
}

const UNDO_THRESHOLD_SKIP = 50 * 1024 * 1024; // 50 MB — skip history entirely
const UNDO_THRESHOLD_TRIM = 10 * 1024 * 1024; // 10 MB — trim to 3 steps

/**
 * Returns the number of undo/redo steps to serialize given the canvas and
 * layer state. Prevents memory exhaustion on large hi-res files.
 */
function resolveUndoStepLimit(
  canvasWidth: number,
  canvasHeight: number,
  layerCount: number,
  requestedSteps: number,
): number {
  const estimated = estimateHistoryBytes(
    canvasWidth,
    canvasHeight,
    layerCount,
    requestedSteps,
  );
  if (estimated >= UNDO_THRESHOLD_SKIP) {
    console.warn(
      `[sktchFile] Undo history estimated ${(estimated / 1024 / 1024).toFixed(1)} MB — skipping history to avoid OOM`,
    );
    return 0;
  }
  if (estimated >= UNDO_THRESHOLD_TRIM) {
    console.warn(
      `[sktchFile] Undo history estimated ${(estimated / 1024 / 1024).toFixed(1)} MB — trimming to 3 steps`,
    );
    return 3;
  }
  return requestedSteps;
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function serializeSktch(
  layers: Layer[],
  layerCanvases: Map<string, HTMLCanvasElement>,
  activeLayerId: string,
  canvasWidth: number,
  canvasHeight: number,
  undoStack: UndoEntry[],
  redoStack: UndoEntry[],
  layerTree?: LayerNode[],
): Promise<Blob> {
  try {
    // Serialize the layer tree sequentially (one canvas at a time) to avoid
    // inflating all layer data URLs into RAM simultaneously.
    const serializedTree: SerializedLayerNode[] | undefined = layerTree
      ? await serializeLayerTreeAsync(layerTree, layerCanvases)
      : undefined;

    // Build flat layers array for backward compatibility.
    // If we have a tree, collect leaf layers from it (pixel data embedded above).
    // Otherwise fall back to serializing from the flat layers array directly,
    // also sequentially.
    let serializedLayers: SerializedLayer[];
    if (serializedTree) {
      serializedLayers = collectSerializedLayers(serializedTree);
    } else {
      serializedLayers = [];
      for (const layer of layers) {
        if (layer.isRuler) {
          serializedLayers.push(layerToSerialized(layer, ""));
        } else {
          const canvas = layerCanvases.get(layer.id);
          let pixelDataUrl = "";
          if (canvas) {
            try {
              pixelDataUrl = await canvasToDataUrlAsync(canvas);
            } catch (err) {
              console.warn(
                `[sktchFile] Failed to serialize layer ${layer.id}, skipping pixel data:`,
                err,
              );
            }
          }
          serializedLayers.push(layerToSerialized(layer, pixelDataUrl));
        }
      }
    }

    // Determine how many undo/redo steps to save based on estimated memory cost.
    const layerCount = Math.max(1, layers.length);
    const undoLimit = resolveUndoStepLimit(
      canvasWidth,
      canvasHeight,
      layerCount,
      10,
    );
    const cappedUndo = undoLimit > 0 ? undoStack.slice(-undoLimit) : [];
    const cappedRedo = undoLimit > 0 ? redoStack.slice(-undoLimit) : [];

    // Serialize history stacks sequentially to avoid a memory spike from
    // inflating all undo ImageData payloads simultaneously.
    const serializedUndo: SerializedUndoEntry[] = [];
    for (const entry of cappedUndo) {
      const s = await serializeUndoEntry(
        entry,
        canvasWidth,
        canvasHeight,
        layerCanvases,
      );
      if (s !== null) serializedUndo.push(s);
    }

    const serializedRedo: SerializedUndoEntry[] = [];
    for (const entry of cappedRedo) {
      const s = await serializeUndoEntry(
        entry,
        canvasWidth,
        canvasHeight,
        layerCanvases,
      );
      if (s !== null) serializedRedo.push(s);
    }

    const file: SktchFile = {
      version: 1,
      canvasWidth,
      canvasHeight,
      activeLayerId,
      layers: serializedLayers,
      layerTree: serializedTree,
      undoStack: serializedUndo,
      redoStack: serializedRedo,
    };

    let json: string;
    try {
      json = JSON.stringify(file);
    } catch (_stringifyErr) {
      throw new Error(
        "File too large to save — try reducing canvas size or number of layers",
      );
    }

    return new Blob([json], { type: "application/json" });
  } catch (err) {
    // Re-throw with a clear message so callers can display it to the user
    if (err instanceof Error) throw err;
    throw new Error("Failed to serialize file: unknown error");
  }
}

export async function deserializeSktch(file: File): Promise<{
  layers: Layer[];
  layerTree: LayerNode[];
  activeLayerId: string;
  canvasWidth: number;
  canvasHeight: number;
  undoStack: UndoEntry[];
  redoStack: UndoEntry[];
  layerPixels: Map<string, ImageData>;
}> {
  const text = await file.text();
  const data = JSON.parse(text) as SktchFile;

  if (data.version !== 1) throw new Error("Unsupported .sktch version");

  const { canvasWidth, canvasHeight } = data;

  // Deserialize layers and pixel data sequentially to avoid a memory spike
  // from inflating all layer images simultaneously.
  const layers: Layer[] = [];
  const layerPixels = new Map<string, ImageData>();

  for (const sl of data.layers) {
    layers.push(serializedToLayer(sl));
    if (!sl.isRuler && sl.pixelDataUrl) {
      try {
        const pixels = await dataUrlToImageData(
          sl.pixelDataUrl,
          canvasWidth,
          canvasHeight,
        );
        layerPixels.set(sl.id, pixels);
      } catch (err) {
        console.warn(
          `[sktchFile] Failed to deserialize pixel data for layer ${sl.id}, skipping:`,
          err,
        );
      }
    }
  }

  // Preserve original layer order (sequential loop above guarantees order,
  // but keep the sort as a safety net in case any future parallel path is added).
  layers.sort((a, b) => {
    const ai = data.layers.findIndex((sl) => sl.id === a.id);
    const bi = data.layers.findIndex((sl) => sl.id === b.id);
    return ai - bi;
  });

  // Deserialize history stacks in parallel, filtering out null (unknown) entries
  const [rawUndo, rawRedo] = await Promise.all([
    Promise.all(
      data.undoStack.map((e) =>
        deserializeUndoEntry(e, canvasWidth, canvasHeight),
      ),
    ),
    Promise.all(
      data.redoStack.map((e) =>
        deserializeUndoEntry(e, canvasWidth, canvasHeight),
      ),
    ),
  ]);

  const undoStack = rawUndo.filter((e): e is UndoEntry => e !== null);
  const redoStack = rawRedo.filter((e): e is UndoEntry => e !== null);

  // Validate activeLayerId; fall back to first layer if missing
  const validActiveId =
    layers.find((l) => l.id === data.activeLayerId)?.id ?? layers[0]?.id ?? "";

  // Restore the layer tree — either from the saved tree field, or reconstruct
  // a flat tree from the layers array (backward compat with pre-group files).
  const layerTree: LayerNode[] = data.layerTree
    ? deserializeLayerTree(data.layerTree)
    : flatLayersToTree(layers);

  return {
    layers,
    layerTree,
    activeLayerId: validActiveId,
    canvasWidth,
    canvasHeight,
    undoStack,
    redoStack,
    layerPixels,
  };
}
