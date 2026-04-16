import type { Layer as LayerPanelLayer } from "../components/LayersPanel";
import type { UndoEntry } from "../hooks/useLayerSystem";
import type { SelectionSnapshot } from "../selectionTypes";
import type { LayerNode } from "../types";
import { RULER_KEYS, type RulerFields } from "../types";
import { resetGroupIdCounterFromFlat } from "./groupUtils";

// ── File format interfaces ────────────────────────────────────────────────────

/**
 * Version 2: flat-array format. `layers` is the full flat array (including
 * group headers and end_group markers). `layerFormat: "flat"` discriminates
 * this from the legacy v1 tree format.
 */
export interface SktchFileV2 {
  version: 2;
  layerFormat: "flat";
  canvasWidth: number;
  canvasHeight: number;
  activeLayerId: string;
  layers: SerializedLayer[];
  undoStack: SerializedUndoEntry[];
  redoStack: SerializedUndoEntry[];
}

/**
 * Version 1: legacy tree format. Kept for backward-compatible load only.
 * New saves never produce this shape.
 */
interface SktchFileV1 {
  version: 1;
  layerFormat?: undefined; // absent in old files
  canvasWidth: number;
  canvasHeight: number;
  activeLayerId: string;
  layers: SerializedLayer[];
  layerTree?: SerializedLayerNode[];
  undoStack: SerializedUndoEntry[];
  redoStack: SerializedUndoEntry[];
}

type SktchFile = SktchFileV1 | SktchFileV2;

interface SerializedLayer extends RulerFields {
  id: string;
  name: string;
  type?: string; // 'group', 'end_group', 'layer', 'ruler', or undefined
  blendMode: string;
  opacity: number;
  visible: boolean;
  collapsed?: boolean; // group headers only
  isClippingMask: boolean;
  alphaLock: boolean;
  pixelDataUrl: string;
}

// ── Legacy tree serialization types (load-only) ───────────────────────────────

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

// ── Undo entry serialization types ──────────────────────────────────────────

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

// ── Helpers ───────────────────────────────────────────────────────────────────

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
  layer: LayerPanelLayer,
  pixelDataUrl: string,
): SerializedLayer {
  const base: SerializedLayer = {
    id: layer.id,
    name: (layer as { name?: string }).name ?? "",
    type: layer.type,
    blendMode: (layer as { blendMode?: string }).blendMode ?? "normal",
    opacity: (layer as { opacity?: number }).opacity ?? 1,
    visible: (layer as { visible?: boolean }).visible ?? true,
    isClippingMask:
      (layer as { isClippingMask?: boolean }).isClippingMask ?? false,
    alphaLock: (layer as { alphaLock?: boolean }).alphaLock ?? false,
    pixelDataUrl,
  };
  // group headers carry collapsed state
  if (layer.type === "group") {
    base.collapsed = (layer as { collapsed?: boolean }).collapsed ?? false;
  }
  // ruler fields
  Object.assign(
    base,
    pickRulerFields(layer as unknown as Record<string, unknown>),
  );
  return base;
}

function serializedToLayer(s: SerializedLayer): LayerPanelLayer {
  if (s.type === "end_group") {
    return { type: "end_group", id: s.id } as unknown as LayerPanelLayer;
  }
  if (s.type === "group") {
    return {
      type: "group",
      id: s.id,
      name: s.name,
      visible: s.visible,
      opacity: s.opacity,
      collapsed: s.collapsed ?? false,
    } as unknown as LayerPanelLayer;
  }
  // Regular paint/ruler layer
  return {
    id: s.id,
    name: s.name,
    type: s.type as "layer" | "ruler" | undefined,
    blendMode: s.blendMode,
    opacity: s.opacity,
    visible: s.visible,
    isClippingMask: s.isClippingMask,
    alphaLock: s.alphaLock,
    ...pickRulerFields(s as unknown as Record<string, unknown>),
  };
}

// ── Legacy tree → flat conversion (load path only) ────────────────────────────

/**
 * Converts the legacy serialized tree format to a flat array of SerializedLayer
 * entries, inserting group header and end_group entries as structural markers.
 * Called only when loading an old .sktch file that has no `layerFormat: "flat"`.
 */
function convertTreeToFlat(nodes: SerializedLayerNode[]): SerializedLayer[] {
  const result: SerializedLayer[] = [];
  for (const node of nodes) {
    if (node.kind === "group") {
      // Emit group header
      result.push({
        id: node.id,
        name: node.name,
        type: "group",
        blendMode: "normal",
        opacity: node.opacity,
        visible: node.visible,
        collapsed: node.collapsed,
        isClippingMask: false,
        alphaLock: false,
        pixelDataUrl: "",
      });
      // Recursively emit children
      result.push(...convertTreeToFlat(node.children ?? []));
      // Emit end_group marker
      result.push({
        id: node.id,
        name: "",
        type: "end_group",
        blendMode: "normal",
        opacity: 1,
        visible: true,
        isClippingMask: false,
        alphaLock: false,
        pixelDataUrl: "",
      });
    } else {
      // Leaf layer — strip parentId if present, include as-is
      const { parentId: _parentId, ...layerData } =
        node.layer as SerializedLayer & { parentId?: unknown };
      void _parentId;
      result.push(layerData as SerializedLayer);
    }
  }
  return result;
}

/**
 * Validates that every group header has a matching end_group entry.
 * Logs a warning if the structure is malformed but does not throw.
 */
function validateGroupPairs(layers: SerializedLayer[]): void {
  const headerIds = new Set<string>();
  const endIds = new Set<string>();
  for (const l of layers) {
    if (l.type === "group") headerIds.add(l.id);
    if (l.type === "end_group") endIds.add(l.id);
  }
  for (const id of headerIds) {
    if (!endIds.has(id)) {
      console.warn(`[sktchFile] Group header ${id} has no matching end_group`);
    }
  }
  for (const id of endIds) {
    if (!headerIds.has(id)) {
      console.warn(`[sktchFile] end_group ${id} has no matching group header`);
    }
  }
}

// ── Undo entry serialization (unchanged logic, no tree dependencies) ──────────

function serializeLayerTree(
  _tree: unknown,
  _canvases: unknown,
): SerializedLayerNode[] {
  // Stub: undo entries that carried a tree are legacy. On save we keep whatever
  // was loaded so old files round-trip without corruption. New operations never
  // produce layer-group-create/delete/reorder entries with a tree payload.
  return [];
}

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
  if (entry.type === "layer-group-create") {
    return {
      type: "layer-group-create",
      treeBefore: serializeLayerTree(entry.treeBefore ?? [], layerCanvases),
      treeAfter: serializeLayerTree(entry.treeAfter ?? [], layerCanvases),
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
      treeBefore: serializeLayerTree(entry.treeBefore ?? [], layerCanvases),
      treeAfter: serializeLayerTree(entry.treeAfter ?? [], layerCanvases),
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
      treeBefore: serializeLayerTree(entry.treeBefore ?? [], layerCanvases),
      treeAfter: serializeLayerTree(entry.treeAfter ?? [], layerCanvases),
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
  if (entry.type === "layers-clear-rulers") {
    return null;
  }
  return null;
}

function deserializeLayerTree(nodes: SerializedLayerNode[]): LayerPanelLayer[] {
  // Used only when deserializing legacy undo entries that contain tree payloads.
  // Returns a flat array built from the tree (no group structure — just leaves).
  const result: LayerPanelLayer[] = [];
  for (const node of nodes) {
    if (node.kind === "layer") {
      result.push(serializedToLayer(node.layer));
    } else {
      result.push(...deserializeLayerTree(node.children ?? []));
    }
  }
  return result;
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
  if (s.type === "layer-group-create") {
    return {
      type: "layer-group-create",
      treeBefore: deserializeLayerTree(s.treeBefore) as unknown as LayerNode[],
      treeAfter: deserializeLayerTree(s.treeAfter) as unknown as LayerNode[],
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
      treeBefore: deserializeLayerTree(s.treeBefore) as unknown as LayerNode[],
      treeAfter: deserializeLayerTree(s.treeAfter) as unknown as LayerNode[],
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
      treeBefore: deserializeLayerTree(s.treeBefore) as unknown as LayerNode[],
      treeAfter: deserializeLayerTree(s.treeAfter) as unknown as LayerNode[],
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
  console.warn(
    "[sktchFile] Unknown serialized UndoEntry type, skipping:",
    (s as { type: string }).type,
  );
  return null;
}

// ── Size estimation ───────────────────────────────────────────────────────────

function estimateHistoryBytes(
  canvasWidth: number,
  canvasHeight: number,
  layerCount: number,
  stepCount: number,
): number {
  return canvasWidth * canvasHeight * 4 * 2 * layerCount * stepCount;
}

const UNDO_THRESHOLD_SKIP = 50 * 1024 * 1024;
const UNDO_THRESHOLD_TRIM = 10 * 1024 * 1024;

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

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Serializes the current canvas state to a .sktch Blob.
 * Always writes the new flat-array format (version 2, layerFormat: "flat").
 * The `layerTree` parameter is accepted but ignored — it exists only to avoid
 * breaking callers that still pass it during the transition.
 */
export async function serializeSktch(
  layers: LayerPanelLayer[],
  layerCanvases: Map<string, HTMLCanvasElement>,
  activeLayerId: string,
  canvasWidth: number,
  canvasHeight: number,
  undoStack: UndoEntry[],
  redoStack: UndoEntry[],
  _layerTree?: unknown,
): Promise<Blob> {
  try {
    // Serialize the flat layers array sequentially (one canvas at a time) to
    // avoid inflating all layer data URLs into RAM simultaneously.
    const serializedLayers: SerializedLayer[] = [];
    for (const layer of layers) {
      if (layer.type === "end_group") {
        serializedLayers.push(layerToSerialized(layer, ""));
        continue;
      }
      if (layer.type === "group") {
        serializedLayers.push(layerToSerialized(layer, ""));
        continue;
      }
      // PaintLayer / ruler layer
      const paintLayer = layer as { id: string; isRuler?: boolean };
      if (paintLayer.isRuler) {
        serializedLayers.push(layerToSerialized(layer, ""));
      } else {
        const canvas = layerCanvases.get(paintLayer.id);
        let pixelDataUrl = "";
        if (canvas) {
          try {
            pixelDataUrl = await canvasToDataUrlAsync(canvas);
          } catch (err) {
            console.warn(
              `[sktchFile] Failed to serialize layer ${paintLayer.id}, skipping pixel data:`,
              err,
            );
          }
        }
        serializedLayers.push(layerToSerialized(layer, pixelDataUrl));
      }
    }

    const layerCount = Math.max(
      1,
      layers.filter((l) => l.type !== "group" && l.type !== "end_group").length,
    );
    const undoLimit = resolveUndoStepLimit(
      canvasWidth,
      canvasHeight,
      layerCount,
      10,
    );
    const cappedUndo = undoLimit > 0 ? undoStack.slice(-undoLimit) : [];
    const cappedRedo = undoLimit > 0 ? redoStack.slice(-undoLimit) : [];

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

    const file: SktchFileV2 = {
      version: 2,
      layerFormat: "flat",
      canvasWidth,
      canvasHeight,
      activeLayerId,
      layers: serializedLayers,
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
    if (err instanceof Error) throw err;
    throw new Error("Failed to serialize file: unknown error");
  }
}

/**
 * Deserializes a .sktch file.
 *
 * Supports both formats:
 *   - New format (version 2, `layerFormat: "flat"`): loads the flat layers
 *     array directly. Undo/redo stacks are deserialized normally.
 *   - Legacy format (presence of `layerTree` key at the top level): converts
 *     the tree to a flat array via `convertTreeToFlat`. Undo/redo stacks are
 *     cleared because legacy entries reference tree-based snapshots that are
 *     incompatible with the flat architecture.
 *
 * Detection: a file is legacy if it contains a `layerTree` key at the top
 * level — regardless of that key's value. New-format saves never write this
 * key, so `'layerTree' in data` is the authoritative discriminant.
 *
 * Returns a flat `layers` array ready to be passed directly to `setLayers`.
 * The `layerTree` field in the return value is always an empty array — callers
 * should no longer use it; it is retained only for interface compatibility
 * during the transition.
 */
export async function deserializeSktch(file: File): Promise<{
  layers: LayerPanelLayer[];
  layerTree: LayerPanelLayer[];
  activeLayerId: string;
  canvasWidth: number;
  canvasHeight: number;
  undoStack: UndoEntry[];
  redoStack: UndoEntry[];
  layerPixels: Map<string, ImageData>;
}> {
  let data: SktchFile;
  try {
    const text = await file.text();
    data = JSON.parse(text) as SktchFile;
  } catch (err) {
    throw new Error(
      `Could not read file "${file.name}" — the file may be corrupted or is not a valid .sktch file. (${err instanceof Error ? err.message : String(err)})`,
    );
  }

  if (data.version !== 1 && data.version !== 2) {
    throw new Error(
      `Unsupported .sktch version (${(data as { version?: unknown }).version}). Please update SketchLair to open this file.`,
    );
  }

  const { canvasWidth, canvasHeight } = data;

  // ── Detect format: legacy = `layerTree` key present at top level ──────────
  // New saves never write `layerTree`, so presence of the key is the reliable
  // discriminant — more robust than checking `layerFormat === "flat"` because
  // old files never wrote the `layerFormat` field at all.
  const isLegacyFormat = "layerTree" in data;

  // ── Determine the flat serialized layers ─────────────────────────────────
  let flatSerialized: SerializedLayer[];

  if (!isLegacyFormat) {
    // New flat-array format: layers array IS the flat array
    flatSerialized = data.layers;
  } else {
    // Legacy tree format — migrate to flat array at load time.
    // Undo/redo stacks will be cleared below (legacy entries are incompatible).
    console.info(
      "[sktchFile] Legacy .sktch format detected — migrating layer tree to flat array",
    );

    const legacyData = data as SktchFileV1;
    const layerTree = legacyData.layerTree;

    // Attempt tree migration. Fall back to the flat `layers` array if:
    //   • `layerTree` is absent or not an array
    //   • `layerTree` is an empty array but `layers` has entries (old files
    //      with no groups stored everything directly in `layers`)
    //   • The tree conversion throws
    try {
      if (Array.isArray(layerTree) && layerTree.length > 0) {
        // Populated tree — convert recursively
        flatSerialized = convertTreeToFlat(layerTree);
      } else if (
        Array.isArray(legacyData.layers) &&
        legacyData.layers.length > 0
      ) {
        // Tree is absent or empty, but there are plain layers — use them directly
        console.info(
          "[sktchFile] Legacy file has no layer tree — using flat layers array as-is",
        );
        flatSerialized = legacyData.layers;
      } else {
        // Both empty — blank canvas
        flatSerialized = [];
      }
    } catch (migrationErr) {
      // Tree conversion failed — attempt best-effort fallback to raw layers
      console.warn(
        "[sktchFile] Layer tree migration failed, falling back to flat layers array:",
        migrationErr,
      );
      if (Array.isArray(legacyData.layers) && legacyData.layers.length > 0) {
        flatSerialized = legacyData.layers;
      } else {
        throw new Error(
          `Could not open "${file.name}" — the file uses a legacy format and the layer data could not be migrated. The file may be corrupted.`,
        );
      }
    }
  }

  validateGroupPairs(flatSerialized);

  // ── Dissolve invalid ruler clip relationships ─────────────────────────────
  // If a layer has isClippingMask===true but either it or the layer below it
  // is a ruler layer, clear the clip flag.  This handles files saved before
  // the ruler-clip guard was in place.
  for (let i = 0; i < flatSerialized.length; i++) {
    const sl = flatSerialized[i];
    if (!sl.isClippingMask) continue;
    // Layer itself is a ruler — cannot be a clip source
    if ((sl as { isRuler?: boolean }).isRuler) {
      flatSerialized[i] = { ...sl, isClippingMask: false };
      continue;
    }
    // Find the next non-marker layer below — if it's a ruler, dissolve
    let belowIdx = i + 1;
    while (
      belowIdx < flatSerialized.length &&
      (flatSerialized[belowIdx].type === "end_group" ||
        flatSerialized[belowIdx].type === "group")
    ) {
      belowIdx++;
    }
    const below = flatSerialized[belowIdx];
    if (below && (below as { isRuler?: boolean }).isRuler) {
      flatSerialized[i] = { ...sl, isClippingMask: false };
    }
  }

  // ── Deserialize layers and pixel data ────────────────────────────────────
  const layers: LayerPanelLayer[] = [];
  const layerPixels = new Map<string, ImageData>();

  for (const sl of flatSerialized) {
    layers.push(serializedToLayer(sl));

    // Only paintable layers have pixel data
    const isGroup = sl.type === "group" || sl.type === "end_group";
    if (!isGroup && !(sl as { isRuler?: boolean }).isRuler && sl.pixelDataUrl) {
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

  // ── Deserialize history stacks ───────────────────────────────────────────
  // Legacy files: clear both stacks. Their entries reference tree-based
  // snapshots that are structurally incompatible with the flat-array system.
  // Losing undo history on a legacy load is acceptable and expected.
  let undoStack: UndoEntry[] = [];
  let redoStack: UndoEntry[] = [];

  if (!isLegacyFormat) {
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
    undoStack = rawUndo.filter((e): e is UndoEntry => e !== null);
    redoStack = rawRedo.filter((e): e is UndoEntry => e !== null);
  } else {
    console.info(
      "[sktchFile] Legacy format — undo/redo history cleared (incompatible with flat-array architecture)",
    );
  }

  const validActiveId =
    layers.find((l) => l.id === data.activeLayerId)?.id ?? layers[0]?.id ?? "";

  // BUG-006 FIX: Advance the group ID counter past any group IDs that exist in
  // the deserialized flat array. This prevents newly-created groups in the loaded
  // document from colliding with group IDs that were saved in the file.
  // Covers both the new flat-array format and the legacy tree-to-flat migration path.
  // Note: useFileIOSystem.handleLoadFile calls this too as a belt-and-suspenders guard.
  resetGroupIdCounterFromFlat(layers as import("./groupUtils").FlatEntry[]);

  return {
    layers,
    layerTree: [], // flat architecture — no tree needed
    activeLayerId: validActiveId,
    canvasWidth,
    canvasHeight,
    undoStack,
    redoStack,
    layerPixels,
  };
}
