/**
 * useCompositing — extracted from PaintingApp.tsx
 *
 * Owns:
 *  - ImageBitmap layer cache (markLayerBitmapDirty / invalidateAllLayerBitmaps / getBitmapOrCanvas)
 *  - Module-level compositing canvas / context caches
 *  - composite()                 — full dirty-rect layer blending → display canvas
 *  - compositeWithStrokePreview() — per-stamp stroke preview (doesn't touch layer canvases)
 *  - buildStrokeCanvases()        — builds below/above/snapshot canvases at stroke start
 *  - flushStrokeBuffer()          — commits WebGL stroke buffer to layer canvas
 *  - scheduleComposite()          — RAF-coalesced composite trigger
 *  - _strokeCommitDirty()         — computes dirty rect for post-stroke composite
 *
 * All refs are OWNED by PaintingApp and passed in here — this hook only reads/writes .current.
 */

import type { BrushSettings } from "@/components/BrushSettingsPanel";
import type { Layer } from "@/components/LayersPanel";
import type { Tool } from "@/components/Toolbar";
import type { XfState } from "@/context/PaintingContext";
import type { LayerNode } from "@/types";
import {
  flattenTree,
  getEffectiveOpacity,
  getEffectiveVisibility,
} from "@/utils/layerTree";
import { useCallback, useRef } from "react";
import type React from "react";

// ─── isIPad (duplicated from PaintingApp so this module is self-contained) ───
const isIPad =
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

// ─── ImageBitmap cache ────────────────────────────────────────────────────────
// GPU-resident bitmaps that avoid re-uploading layer pixel data on every drawImage call.
// markLayerBitmapDirty() is called wherever a layer canvas's pixels change.
// getBitmapOrCanvas() returns the cached bitmap when available, or falls back to the raw canvas
// and asynchronously regenerates the bitmap for the next frame.
// The active layer is always excluded from caching — it changes on every stroke commit
// and the async upload overhead outweighs the benefit for frequently-modified canvases.
const _layerBitmapCache = new Map<string, ImageBitmap>();
const _layerBitmapDirty = new Set<string>();
const _layerBitmapPending = new Set<string>();
let _activeLayerIdForBitmap = ""; // set by useEffect(activeLayerId) in PaintingApp

export function markLayerBitmapDirty(id: string): void {
  _layerBitmapDirty.add(id);
}

export function invalidateAllLayerBitmaps(): void {
  for (const bm of _layerBitmapCache.values()) {
    bm.close();
  }
  _layerBitmapCache.clear();
  _layerBitmapDirty.clear();
  _layerBitmapPending.clear();
}

export function setActiveLayerIdForBitmap(id: string): void {
  _activeLayerIdForBitmap = id;
}

export function getBitmapOrCanvas(
  id: string,
  lc: HTMLCanvasElement,
): HTMLCanvasElement | ImageBitmap {
  // Active layer changes on every stroke — skip cache entirely to avoid async upload overhead.
  if (id === _activeLayerIdForBitmap) return lc;
  if (_layerBitmapDirty.has(id)) {
    if (!_layerBitmapPending.has(id)) {
      _layerBitmapPending.add(id);
      createImageBitmap(lc).then((bm) => {
        const old = _layerBitmapCache.get(id);
        if (old) old.close();
        _layerBitmapCache.set(id, bm);
        _layerBitmapDirty.delete(id);
        _layerBitmapPending.delete(id);
      });
    }
    return lc;
  }
  const cached = _layerBitmapCache.get(id);
  if (cached) return cached;
  if (!_layerBitmapPending.has(id)) {
    _layerBitmapPending.add(id);
    createImageBitmap(lc).then((bm) => {
      const old = _layerBitmapCache.get(id);
      if (old) old.close();
      _layerBitmapCache.set(id, bm);
      _layerBitmapPending.delete(id);
    });
  }
  return lc;
}

// ─── Canvas-dirty signal ─────────────────────────────────────────────────────
// Lightweight subscription for "the display canvas was just fully composited".
// PaintingApp registers updateNavigatorCanvas here so any code that calls
// composite() automatically keeps the navigator in sync — no scattered explicit
// callsites needed.
//
// Only composite() (full blending pass) fires this. compositeWithStrokePreview()
// does NOT fire it — the navigator should not update on every per-stamp preview.
let _compositeDoneCallback: (() => void) | null = null;
let _compositeDoneRafId: number | null = null;

/** Register a callback that fires (debounced via rAF) after every composite(). */
export function setCompositeDoneCallback(cb: () => void): void {
  _compositeDoneCallback = cb;
}

/** Remove the registered callback (call on unmount). */
export function clearCompositeDoneCallback(): void {
  _compositeDoneCallback = null;
  if (_compositeDoneRafId !== null) {
    cancelAnimationFrame(_compositeDoneRafId);
    _compositeDoneRafId = null;
  }
}

/** Called at the end of composite() to schedule the navigator/thumbnail update. */
function _scheduleCompositeDone(): void {
  if (!_compositeDoneCallback) return;
  // Deduplicate: one RAF per batch of composites, not one per call.
  if (_compositeDoneRafId !== null) return;
  const cb = _compositeDoneCallback;
  _compositeDoneRafId = requestAnimationFrame(() => {
    _compositeDoneRafId = null;
    cb();
  });
}

// ─── markCanvasDirty — centralised thumbnail + navigator update ───────────────
// A single entry-point that replaces the 60+ scattered calls to
// setLayerThumbnails / setNavigatorVersion / updateNavigatorCanvas across 8 files.
//
// Usage:
//   markCanvasDirty()           — navigator update only (no specific layer)
//   markCanvasDirty(layerId)    — layer thumbnail + navigator update
//
// Both operations are debounced: thumbnails at 80 ms, navigator at 120 ms.
// This avoids hammering React state on rapid operations like undo chains.
//
// The callbacks are registered once by PaintingApp via registerCanvasDirtyCallbacks().
// Until registration, calls are silently ignored.

type LayerThumbnailsDispatch = React.Dispatch<
  React.SetStateAction<Record<string, string>>
>;

interface CanvasDirtyCallbacks {
  setLayerThumbnails: LayerThumbnailsDispatch;
  setNavigatorVersion: React.Dispatch<React.SetStateAction<number>>;
  /** Returns the current thumbnail data URL for a given layer canvas */
  getLayerThumbnail: (layerId: string) => string;
}

let _dirtyCallbacks: CanvasDirtyCallbacks | null = null;

// Pending layer IDs that need thumbnail regeneration
const _pendingThumbLayerIds = new Set<string>();
let _thumbFlushTimerId: ReturnType<typeof setTimeout> | null = null;
let _navFlushTimerId: ReturnType<typeof setTimeout> | null = null;

function _flushPendingThumbs(): void {
  _thumbFlushTimerId = null;
  if (!_dirtyCallbacks || _pendingThumbLayerIds.size === 0) return;
  const ids = [..._pendingThumbLayerIds];
  _pendingThumbLayerIds.clear();
  _dirtyCallbacks.setLayerThumbnails((prev) => {
    const next = { ...prev };
    for (const id of ids) {
      const thumb = _dirtyCallbacks!.getLayerThumbnail(id);
      if (thumb) next[id] = thumb;
    }
    return next;
  });
}

function _flushNavUpdate(): void {
  _navFlushTimerId = null;
  if (!_dirtyCallbacks) return;
  _dirtyCallbacks.setNavigatorVersion((v) => v + 1);
}

/**
 * Register the React state setters and thumbnail generator used by markCanvasDirty().
 * Call once from PaintingApp after the state is initialised.
 */
export function registerCanvasDirtyCallbacks(cbs: CanvasDirtyCallbacks): void {
  _dirtyCallbacks = cbs;
}

/**
 * Mark the canvas as dirty.
 * - If layerId is provided: schedules a debounced thumbnail regeneration for that layer.
 * - Always schedules a debounced navigator version bump.
 *
 * Replaces direct calls to setLayerThumbnails / setNavigatorVersion / updateNavigatorCanvas
 * scattered across hook files.
 */
export function markCanvasDirty(layerId?: string): void {
  if (!_dirtyCallbacks) return;
  if (layerId) {
    _pendingThumbLayerIds.add(layerId);
    if (_thumbFlushTimerId !== null) clearTimeout(_thumbFlushTimerId);
    _thumbFlushTimerId = setTimeout(_flushPendingThumbs, 80);
  }
  if (_navFlushTimerId !== null) clearTimeout(_navFlushTimerId);
  _navFlushTimerId = setTimeout(_flushNavUpdate, 120);
}

// ─── Module-level compositing canvas / context caches ────────────────────────
// Pre-allocated temp canvases for compositing — avoids per-frame allocation
export const _tempStrokeCanvas = document.createElement("canvas");
_tempStrokeCanvas.width = _tempStrokeCanvas.height = 1;
export let _tempStrokeCtxCached: CanvasRenderingContext2D | null = null;
export const _clipTmpCanvas = document.createElement("canvas");
_clipTmpCanvas.width = _clipTmpCanvas.height = 1;
export let _clipTmpCtxCached: CanvasRenderingContext2D | null = null;
export const _aboveClipTmpCanvas = document.createElement("canvas");
_aboveClipTmpCanvas.width = _aboveClipTmpCanvas.height = 1;
export let _aboveClipTmpCtxCached: CanvasRenderingContext2D | null = null;
export let _overlayCtxCached: CanvasRenderingContext2D | null = null;

// Cached 2D contexts for the hot-path per-frame canvases.
// These are populated once the canvas elements are known and invalidated on resize.
export let _displayCtxCached: CanvasRenderingContext2D | null = null;
export let _belowCtxCached: CanvasRenderingContext2D | null = null;
export let _aboveCtxCached: CanvasRenderingContext2D | null = null;
export let _snapCtxCached: CanvasRenderingContext2D | null = null;
export let _previewCtxCached: CanvasRenderingContext2D | null = null;

/** Call after any canvas resize so the hot-path caches are cleared. */
export function invalidateCompositeContextCaches(): void {
  _displayCtxCached = null;
  _belowCtxCached = null;
  _aboveCtxCached = null;
  _snapCtxCached = null;
  _previewCtxCached = null;
  _overlayCtxCached = null;
  _clipTmpCtxCached = null;
  _aboveClipTmpCtxCached = null;
  _tempStrokeCtxCached = null;
}

// ─── Hook params ─────────────────────────────────────────────────────────────

export interface UseCompositingParams {
  displayCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  belowActiveCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  aboveActiveCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  snapshotCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  activePreviewCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  strokeBufferRef: React.MutableRefObject<HTMLCanvasElement | null>;
  layerCanvasesRef: React.MutableRefObject<Map<string, HTMLCanvasElement>>;
  layerTreeRef: React.MutableRefObject<LayerNode[]>;
  layersRef: React.MutableRefObject<Layer[]>;
  activeLayerIdRef: React.MutableRefObject<string>;
  activeLayerAlphaLockRef: React.MutableRefObject<boolean>;
  brushBlendModeRef: React.MutableRefObject<string>;
  tailRafIdRef: React.MutableRefObject<number | null>;
  needsFullCompositeRef: React.MutableRefObject<boolean>;
  strokeDirtyRectRef: React.MutableRefObject<{
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  } | null>;
  strokeStartSnapshotRef: React.MutableRefObject<{
    pixels: ImageData;
    x: number;
    y: number;
  } | null>;
  strokeCanvasCacheKeyRef: React.MutableRefObject<number>;
  strokeCanvasLastBuiltGenRef: React.MutableRefObject<number>;
  selectionActiveRef: React.MutableRefObject<boolean>;
  selectionMaskRef: React.MutableRefObject<HTMLCanvasElement | null>;
  layersBeingExtractedRef: React.MutableRefObject<Set<string>>;
  isDraggingFloatRef: React.MutableRefObject<boolean>;
  transformActiveRef: React.MutableRefObject<boolean>;
  /** Per-layer float canvases for multi-layer transform.
   *  During multi-layer transform, each layer ID maps to its own float canvas containing
   *  only that layer's pixels. The compositing loop renders each float at the current
   *  transform position in layer stack order. Empty/cleared when no transform is active. */
  multiFloatCanvasesRef: React.MutableRefObject<Map<string, HTMLCanvasElement>>;
  /** Ordered array of layer IDs participating in a multi-layer per-float transform.
   *  When non-empty and transformActiveRef is true, each layer in this list renders
   *  its per-layer float canvas at the current transform position instead of its
   *  raw (now-empty) layer canvas. */
  multiLayerResolvedIdsRef: React.MutableRefObject<string[]>;
  moveFloatCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  moveFloatOriginBoundsRef: React.MutableRefObject<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>;
  xfStateRef: React.MutableRefObject<XfState | null>;
  transformOrigFloatCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  webglBrushRef: React.MutableRefObject<{ clear(): void } | null>;
  getActiveSize: () => number;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useCompositing({
  displayCanvasRef,
  belowActiveCanvasRef,
  aboveActiveCanvasRef,
  snapshotCanvasRef,
  activePreviewCanvasRef,
  strokeBufferRef,
  layerCanvasesRef,
  layerTreeRef,
  layersRef,
  activeLayerIdRef,
  activeLayerAlphaLockRef,
  brushBlendModeRef,
  tailRafIdRef,
  needsFullCompositeRef,
  strokeDirtyRectRef,
  strokeStartSnapshotRef,
  strokeCanvasCacheKeyRef,
  strokeCanvasLastBuiltGenRef,
  selectionActiveRef,
  selectionMaskRef,
  layersBeingExtractedRef,
  isDraggingFloatRef,
  transformActiveRef,
  multiFloatCanvasesRef: _multiFloatCanvasesRef, // per-layer float canvases for multi-layer transform
  multiLayerResolvedIdsRef,
  moveFloatCanvasRef,
  moveFloatOriginBoundsRef,
  xfStateRef,
  transformOrigFloatCanvasRef,
  webglBrushRef,
  getActiveSize,
}: UseCompositingParams) {
  // ── composite ──────────────────────────────────────────────────────────────
  // Composite all visible layers onto display canvas.
  // Optional dirty rect: when provided, only clears and redraws that region — O(region)
  // instead of O(canvas). Use for post-stroke commits where the affected region is known.
  // biome-ignore lint/correctness/useExhaustiveDependencies: all refs are stable (useRef)
  const composite = useCallback(
    (dirtyRegion?: { x: number; y: number; w: number; h: number }) => {
      const display = displayCanvasRef.current;
      if (!display) return;
      // If the elastic tail is animating, only block the display canvas write
      // (not the entire function) so layer changes during tail still take effect.
      if (tailRafIdRef.current !== null) return;
      if (!_displayCtxCached) _displayCtxCached = display.getContext("2d");
      const ctx = _displayCtxCached;
      if (!ctx) return;
      const dW = display.width;
      const dH = display.height;
      // If a canvas resize just happened, force a full repaint and clear the flag.
      // This prevents the dirty-rect path from using a stale (transparent) belowActiveCanvas
      // that was cleared when canvas dimensions were changed by the splash screen or crop tool.
      let useDR = dirtyRegion != null && dirtyRegion.w > 0 && dirtyRegion.h > 0;
      if (needsFullCompositeRef.current) {
        needsFullCompositeRef.current = false;
        useDR = false;
      }
      const drX = useDR ? Math.max(0, dirtyRegion!.x) : 0;
      const drY = useDR ? Math.max(0, dirtyRegion!.y) : 0;
      const drX2 = useDR ? Math.min(dW, dirtyRegion!.x + dirtyRegion!.w) : dW;
      const drY2 = useDR ? Math.min(dH, dirtyRegion!.y + dirtyRegion!.h) : dH;
      const drW = drX2 - drX;
      const drH = drY2 - drY;
      if (useDR) {
        ctx.clearRect(drX, drY, drW, drH);
      } else {
        ctx.clearRect(0, 0, dW, dH);
      }
      // Build the flat layer list from the tree for this composite call.
      // flattenTree gives compositing order (top-to-bottom), matching layersRef order.
      const _tree = layerTreeRef.current;
      const ls = flattenTree(_tree).map((item) => item.layer);
      // When a dirty region is known, clip all draws to it so GPU only processes that region.
      if (useDR) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(drX, drY, drW, drH);
        ctx.clip();
      }
      // Precompute mask canvases
      for (let i = ls.length - 1; i >= 0; i--) {
        const layer = ls[i];
        if (!getEffectiveVisibility(_tree, layer.id)) continue;
        const lc = layerCanvasesRef.current.get(layer.id);
        if (!lc) continue;
        // Effective opacity cascades through all ancestor group opacities
        const effectiveOpacity = getEffectiveOpacity(_tree, layer.id);
        // If clipping mask, apply clip to layer below
        if (layer.isClippingMask && i < ls.length - 1) {
          // Find the layer below (non-clipping, non-background)
          let belowLayer: Layer | null = null;
          for (let j = i + 1; j < ls.length; j++) {
            if (!ls[j].isClippingMask) {
              belowLayer = ls[j];
              break;
            }
          }
          if (belowLayer) {
            const belowLc = layerCanvasesRef.current.get(belowLayer.id);
            if (belowLc) {
              if (
                _clipTmpCanvas.width !== lc.width ||
                _clipTmpCanvas.height !== lc.height
              ) {
                _clipTmpCanvas.width = lc.width;
                _clipTmpCanvas.height = lc.height;
                _clipTmpCtxCached = null;
              }
              if (!_clipTmpCtxCached)
                _clipTmpCtxCached = _clipTmpCanvas.getContext("2d", {
                  willReadFrequently: !isIPad,
                });
              const tmpCtx = _clipTmpCtxCached!;
              // Scope clear and draws to the dirty region when available — avoids full-canvas
              // blit for each clipping mask layer when only a small area changed.
              if (useDR) {
                tmpCtx.clearRect(drX, drY, drW, drH);
                tmpCtx.globalAlpha = effectiveOpacity;
                tmpCtx.globalCompositeOperation = "source-over";
                tmpCtx.drawImage(
                  getBitmapOrCanvas(layer.id, lc),
                  drX,
                  drY,
                  drW,
                  drH,
                  drX,
                  drY,
                  drW,
                  drH,
                );
                tmpCtx.globalCompositeOperation = "destination-in";
                tmpCtx.drawImage(
                  getBitmapOrCanvas(belowLayer.id, belowLc),
                  drX,
                  drY,
                  drW,
                  drH,
                  drX,
                  drY,
                  drW,
                  drH,
                );
              } else {
                tmpCtx.clearRect(0, 0, lc.width, lc.height);
                tmpCtx.globalAlpha = effectiveOpacity;
                tmpCtx.globalCompositeOperation = "source-over";
                tmpCtx.drawImage(getBitmapOrCanvas(layer.id, lc), 0, 0);
                tmpCtx.globalCompositeOperation = "destination-in";
                tmpCtx.drawImage(
                  getBitmapOrCanvas(belowLayer.id, belowLc),
                  0,
                  0,
                );
              }
              tmpCtx.globalCompositeOperation = "source-over";
              ctx.globalAlpha = 1;
              ctx.globalCompositeOperation = (layer.blendMode ||
                "source-over") as GlobalCompositeOperation;
              if (useDR) {
                ctx.drawImage(
                  _clipTmpCanvas,
                  drX,
                  drY,
                  drW,
                  drH,
                  drX,
                  drY,
                  drW,
                  drH,
                );
              } else {
                ctx.drawImage(_clipTmpCanvas, 0, 0);
              }
              ctx.globalCompositeOperation = "source-over";
              continue;
            }
          }
        }
        // ── Transform float rendering ──────────────────────────────────────
        // Determine which transform mode is active for this layer.
        //
        // PER-LAYER FLOAT DESIGN (multi-layer):
        //   multiLayerResolvedIdsRef contains all layer IDs whose pixels were
        //   extracted into individual per-layer float canvases (multiFloatCanvasesRef).
        //   Each layer renders its own float canvas at the current transform position.
        //   No composite float overlay is needed — each layer owns its own pixels.
        //
        // SINGLE-LAYER DESIGN (unchanged):
        //   The active layer renders with its float canvas drawn on top.

        const isTransformActive =
          isDraggingFloatRef.current || transformActiveRef.current;

        // Multi-layer per-float: this layer is a participant if it's in the resolved list
        const multiLayerResolvedSet =
          isTransformActive && multiLayerResolvedIdsRef.current.length > 1
            ? multiLayerResolvedIdsRef.current
            : null;
        const isMultiLayerParticipant =
          multiLayerResolvedSet?.includes(layer.id) === true;
        const perLayerFloat = isMultiLayerParticipant
          ? (_multiFloatCanvasesRef.current.get(layer.id) ?? null)
          : null;

        // Single-layer float: the active layer gets its float drawn on top of it
        const activeLayerIdForFloat = activeLayerIdRef.current;
        const isSingleLayerFloat =
          !isMultiLayerParticipant &&
          !multiLayerResolvedSet &&
          layer.id === activeLayerIdForFloat &&
          moveFloatCanvasRef.current &&
          isTransformActive;

        // Extraction guard: layer pixels were just cleared but float isn't live yet
        const isBeingExtracted =
          layersBeingExtractedRef.current.size > 0 &&
          layersBeingExtractedRef.current.has(layer.id);

        if (isMultiLayerParticipant && perLayerFloat) {
          // Render this layer's per-layer float canvas at the current transform position.
          // The float contains ONLY this layer's pixels — no masking needed.
          const xf = xfStateRef.current;
          const ob = moveFloatOriginBoundsRef.current;
          // Use a temp canvas so we can apply the layer's blend mode correctly
          if (
            _clipTmpCanvas.width !== lc.width ||
            _clipTmpCanvas.height !== lc.height
          ) {
            _clipTmpCanvas.width = lc.width;
            _clipTmpCanvas.height = lc.height;
            _clipTmpCtxCached = null;
          }
          if (!_clipTmpCtxCached)
            _clipTmpCtxCached = _clipTmpCanvas.getContext("2d", {
              willReadFrequently: !isIPad,
            });
          const tmpCtx = _clipTmpCtxCached!;
          tmpCtx.clearRect(0, 0, lc.width, lc.height);
          tmpCtx.globalAlpha = 1;
          tmpCtx.globalCompositeOperation = "source-over";
          // Draw the layer's cleared canvas first (it's empty but preserves blend-mode slot)
          // then draw the float on top
          if (xf && ob) {
            const cx = xf.x + xf.w / 2;
            const cy = xf.y + xf.h / 2;
            tmpCtx.save();
            tmpCtx.translate(cx, cy);
            tmpCtx.rotate(xf.rotation);
            tmpCtx.drawImage(
              perLayerFloat,
              ob.x,
              ob.y,
              ob.w,
              ob.h,
              -xf.w / 2,
              -xf.h / 2,
              xf.w,
              xf.h,
            );
            tmpCtx.restore();
          } else if (xf) {
            tmpCtx.drawImage(perLayerFloat, xf.x, xf.y);
          } else {
            tmpCtx.drawImage(perLayerFloat, 0, 0);
          }
          ctx.globalAlpha = effectiveOpacity;
          ctx.globalCompositeOperation = (layer.blendMode ||
            "source-over") as GlobalCompositeOperation;
          ctx.drawImage(_clipTmpCanvas, 0, 0);
          ctx.globalCompositeOperation = "source-over";
        } else if (isMultiLayerParticipant && !perLayerFloat) {
          // Float not yet available (extraction in progress) — render as empty slot
        } else if (isSingleLayerFloat) {
          // Single-layer: composite layer hole + float so blend mode is applied once
          if (
            _clipTmpCanvas.width !== lc.width ||
            _clipTmpCanvas.height !== lc.height
          ) {
            _clipTmpCanvas.width = lc.width;
            _clipTmpCanvas.height = lc.height;
            _clipTmpCtxCached = null;
          }
          if (!_clipTmpCtxCached)
            _clipTmpCtxCached = _clipTmpCanvas.getContext("2d", {
              willReadFrequently: !isIPad,
            });
          const tmpCtx = _clipTmpCtxCached!;
          tmpCtx.clearRect(0, 0, lc.width, lc.height);
          tmpCtx.globalAlpha = 1;
          tmpCtx.globalCompositeOperation = "source-over";
          tmpCtx.drawImage(getBitmapOrCanvas(layer.id, lc), 0, 0);
          const xf = xfStateRef.current;
          const ob = moveFloatOriginBoundsRef.current;
          const floatSource =
            transformOrigFloatCanvasRef.current || moveFloatCanvasRef.current!;
          if (xf && ob && floatSource) {
            const cx = xf.x + xf.w / 2;
            const cy = xf.y + xf.h / 2;
            tmpCtx.save();
            tmpCtx.translate(cx, cy);
            tmpCtx.rotate(xf.rotation);
            tmpCtx.drawImage(
              floatSource,
              ob.x,
              ob.y,
              ob.w,
              ob.h,
              -xf.w / 2,
              -xf.h / 2,
              xf.w,
              xf.h,
            );
            tmpCtx.restore();
          } else if (xf && floatSource) {
            tmpCtx.drawImage(floatSource, xf.x, xf.y);
          } else if (floatSource) {
            tmpCtx.drawImage(floatSource, 0, 0);
          }
          ctx.globalAlpha = effectiveOpacity;
          ctx.globalCompositeOperation = (layer.blendMode ||
            "source-over") as GlobalCompositeOperation;
          ctx.drawImage(_clipTmpCanvas, 0, 0);
          ctx.globalCompositeOperation = "source-over";
        } else if (!isBeingExtracted) {
          // Normal layer — draw from cache
          ctx.globalAlpha = effectiveOpacity;
          ctx.globalCompositeOperation = (layer.blendMode ||
            "source-over") as GlobalCompositeOperation;
          ctx.drawImage(getBitmapOrCanvas(layer.id, lc), 0, 0);
          ctx.globalCompositeOperation = "source-over";
        }
      }

      ctx.globalAlpha = 1;
      if (useDR) ctx.restore();
      // Notify subscribers (e.g. navigator) that a full composite just completed.
      _scheduleCompositeDone();
    },
    [],
  );

  // ── compositeWithStrokePreview ────────────────────────────────────────────
  // Renders preview of active stroke to the display canvas WITHOUT modifying any layer canvas.
  // Accepts an optional dirty rect — when provided, only composites that region (O(stampArea)
  // instead of O(fullCanvas)), enabling synchronous per-event updates with negligible cost.
  // biome-ignore lint/correctness/useExhaustiveDependencies: selection refs from hook are stable
  const compositeWithStrokePreview = useCallback(
    (
      _opacity: number,
      tool: Tool,
      dirty?: { minX: number; minY: number; maxX: number; maxY: number },
    ) => {
      const display = displayCanvasRef.current;
      const below = belowActiveCanvasRef.current;
      const snap = snapshotCanvasRef.current;
      const preview = activePreviewCanvasRef.current;
      const sbuf = strokeBufferRef.current;
      const activeLayerId = activeLayerIdRef.current;
      if (!display || !below || !snap || !preview || !sbuf || !activeLayerId)
        return;

      const W = display.width;
      const H = display.height;
      const activeLayer = layersRef.current.find((l) => l.id === activeLayerId);
      if (!activeLayer) return;

      // Determine composite region — clip to canvas bounds, add 2px guard for rounding
      const useDirty =
        dirty != null &&
        Number.isFinite(dirty.minX) &&
        dirty.maxX >= dirty.minX;
      const cx = useDirty ? Math.max(0, Math.floor(dirty!.minX) - 2) : 0;
      const cy = useDirty ? Math.max(0, Math.floor(dirty!.minY) - 2) : 0;
      const cx2 = useDirty ? Math.min(W, Math.ceil(dirty!.maxX) + 2) : W;
      const cy2 = useDirty ? Math.min(H, Math.ceil(dirty!.maxY) + 2) : H;
      const cw = cx2 - cx;
      const ch = cy2 - cy;

      // 1. Build active layer preview in composite region: snapshot + stroke buffer at strokeOpacity
      if (!_previewCtxCached)
        _previewCtxCached = preview.getContext("2d", {
          willReadFrequently: !isIPad,
        });
      const previewCtx = _previewCtxCached;
      if (!previewCtx) return;
      previewCtx.clearRect(cx, cy, cw, ch);
      previewCtx.globalAlpha = 1;
      previewCtx.globalCompositeOperation = "source-over";
      previewCtx.drawImage(snap, cx, cy, cw, ch, cx, cy, cw, ch);
      // Apply stroke-level opacity and selection masking to preview.
      // If a selection is active, route the stroke through a temp canvas masked with
      // the selection so pixels outside the selection are invisible during drawing.
      const previewSelMask = selectionMaskRef.current;
      if (previewSelMask && selectionActiveRef.current) {
        if (_tempStrokeCanvas.width !== W || _tempStrokeCanvas.height !== H) {
          _tempStrokeCanvas.width = W;
          _tempStrokeCanvas.height = H;
          _tempStrokeCtxCached = null;
        }
        if (!_tempStrokeCtxCached)
          _tempStrokeCtxCached = _tempStrokeCanvas.getContext("2d", {
            willReadFrequently: !isIPad,
          });
        const tmpCtx2 = _tempStrokeCtxCached!;
        tmpCtx2.clearRect(cx, cy, cw, ch);
        tmpCtx2.globalAlpha = _opacity;
        tmpCtx2.globalCompositeOperation = "source-over";
        tmpCtx2.drawImage(sbuf, cx, cy, cw, ch, cx, cy, cw, ch);
        tmpCtx2.globalAlpha = 1;
        tmpCtx2.globalCompositeOperation = "destination-in";
        tmpCtx2.drawImage(previewSelMask, cx, cy, cw, ch, cx, cy, cw, ch);
        tmpCtx2.globalCompositeOperation = "source-over";
        previewCtx.globalAlpha = 1;
        previewCtx.globalCompositeOperation =
          tool === "eraser" || brushBlendModeRef.current === "clear"
            ? "destination-out"
            : "source-over";
        previewCtx.drawImage(_tempStrokeCanvas, cx, cy, cw, ch, cx, cy, cw, ch);
        previewCtx.globalAlpha = 1;
        previewCtx.globalCompositeOperation = "source-over";
      } else if (activeLayerAlphaLockRef.current && tool !== "eraser") {
        // Alpha lock: mask stroke preview against the layer's existing alpha (snapshot)
        if (_tempStrokeCanvas.width !== W || _tempStrokeCanvas.height !== H) {
          _tempStrokeCanvas.width = W;
          _tempStrokeCanvas.height = H;
          _tempStrokeCtxCached = null;
        }
        if (!_tempStrokeCtxCached)
          _tempStrokeCtxCached = _tempStrokeCanvas.getContext("2d", {
            willReadFrequently: !isIPad,
          });
        const tmpCtxAL = _tempStrokeCtxCached!;
        tmpCtxAL.clearRect(cx, cy, cw, ch);
        tmpCtxAL.globalAlpha = _opacity;
        tmpCtxAL.globalCompositeOperation = "source-over";
        tmpCtxAL.drawImage(sbuf, cx, cy, cw, ch, cx, cy, cw, ch);
        tmpCtxAL.globalAlpha = 1;
        // Keep only pixels where the layer snapshot already has paint
        tmpCtxAL.globalCompositeOperation = "destination-in";
        tmpCtxAL.drawImage(snap, cx, cy, cw, ch, cx, cy, cw, ch);
        tmpCtxAL.globalCompositeOperation = "source-over";
        previewCtx.globalAlpha = 1;
        previewCtx.globalCompositeOperation = "source-over";
        previewCtx.drawImage(_tempStrokeCanvas, cx, cy, cw, ch, cx, cy, cw, ch);
        previewCtx.globalAlpha = 1;
        previewCtx.globalCompositeOperation = "source-over";
      } else {
        previewCtx.globalAlpha = _opacity;
        previewCtx.globalCompositeOperation =
          tool === "eraser" || brushBlendModeRef.current === "clear"
            ? "destination-out"
            : "source-over";
        previewCtx.drawImage(sbuf, cx, cy, cw, ch, cx, cy, cw, ch);
        previewCtx.globalAlpha = 1;
        previewCtx.globalCompositeOperation = "source-over";
      }
      // 2. Composite to display in region: below layers + active layer preview + above layers
      if (!_displayCtxCached) _displayCtxCached = display.getContext("2d");
      const displayCtx = _displayCtxCached;
      if (!displayCtx) return;
      displayCtx.clearRect(cx, cy, cw, ch);
      displayCtx.globalAlpha = 1;
      displayCtx.drawImage(below, cx, cy, cw, ch, cx, cy, cw, ch);

      // If active layer is a clipping mask, clip preview to base layer
      let previewSource: HTMLCanvasElement = preview;
      if (activeLayer.isClippingMask) {
        const ls2 = layersRef.current;
        const aIdx2 = ls2.findIndex((l) => l.id === activeLayerId);
        let baseLayerForClip: Layer | null = null;
        for (let j = aIdx2 + 1; j < ls2.length; j++) {
          if (!ls2[j].isClippingMask) {
            baseLayerForClip = ls2[j];
            break;
          }
        }
        if (baseLayerForClip) {
          const baseLcForClip = layerCanvasesRef.current.get(
            baseLayerForClip.id,
          );
          if (baseLcForClip) {
            if (_clipTmpCanvas.width !== W || _clipTmpCanvas.height !== H) {
              _clipTmpCanvas.width = W;
              _clipTmpCanvas.height = H;
              _clipTmpCtxCached = null;
            }
            if (!_clipTmpCtxCached)
              _clipTmpCtxCached = _clipTmpCanvas.getContext("2d", {
                willReadFrequently: !isIPad,
              });
            const clipCtx = _clipTmpCtxCached!;
            // Clip to dirty rect — avoids full-canvas blits for small brush strokes
            clipCtx.clearRect(cx, cy, cw, ch);
            clipCtx.globalCompositeOperation = "source-over";
            clipCtx.drawImage(preview, cx, cy, cw, ch, cx, cy, cw, ch);
            clipCtx.globalCompositeOperation = "destination-in";
            clipCtx.drawImage(baseLcForClip, cx, cy, cw, ch, cx, cy, cw, ch);
            clipCtx.globalCompositeOperation = "source-over";
            previewSource = _clipTmpCanvas;
          }
        }
      }

      displayCtx.globalAlpha = activeLayer.opacity;
      displayCtx.globalCompositeOperation = (activeLayer.blendMode ||
        "source-over") as GlobalCompositeOperation;
      displayCtx.drawImage(previewSource, cx, cy, cw, ch, cx, cy, cw, ch);
      displayCtx.globalAlpha = 1;
      displayCtx.globalCompositeOperation = "source-over";

      // Apply above-active layers individually with their correct blend modes.
      // These layers cannot be pre-baked into a single canvas because blend modes
      // require compositing against the already-drawn pixels beneath them.
      {
        const ls2 = layersRef.current;
        const aIdx2 = ls2.findIndex((l) => l.id === activeLayerId);
        // Resize check + context fetch hoisted outside the per-layer loop so
        // it runs at most once per frame regardless of how many clipping-mask
        // layers are above the active layer.
        if (
          _aboveClipTmpCanvas.width !== W ||
          _aboveClipTmpCanvas.height !== H
        ) {
          _aboveClipTmpCanvas.width = W;
          _aboveClipTmpCanvas.height = H;
          _aboveClipTmpCtxCached = null;
        }
        if (!_aboveClipTmpCtxCached)
          _aboveClipTmpCtxCached = _aboveClipTmpCanvas.getContext("2d", {
            willReadFrequently: !isIPad,
          });
        for (let i = aIdx2 - 1; i >= 0; i--) {
          const layer = ls2[i];
          if (!layer.visible) continue;
          const lc = layerCanvasesRef.current.get(layer.id);
          if (!lc) continue;

          let layerSource: HTMLCanvasElement = lc;

          // Handle clipping mask: mask layer pixels against its base layer
          if (layer.isClippingMask && i < ls2.length - 1) {
            let baseLayer: (typeof ls2)[0] | null = null;
            for (let j = i + 1; j < ls2.length; j++) {
              if (!ls2[j].isClippingMask) {
                baseLayer = ls2[j];
                break;
              }
            }
            if (baseLayer) {
              const baseLc = layerCanvasesRef.current.get(baseLayer.id);
              if (baseLc) {
                const abClipCtx = _aboveClipTmpCtxCached!;
                abClipCtx.clearRect(cx, cy, cw, ch);
                abClipCtx.globalCompositeOperation = "source-over";
                abClipCtx.drawImage(lc, cx, cy, cw, ch, cx, cy, cw, ch);
                abClipCtx.globalCompositeOperation = "destination-in";
                abClipCtx.drawImage(baseLc, cx, cy, cw, ch, cx, cy, cw, ch);
                abClipCtx.globalCompositeOperation = "source-over";
                layerSource = _aboveClipTmpCanvas;
              }
            }
          }

          displayCtx.globalAlpha = layer.opacity;
          displayCtx.globalCompositeOperation = (layer.blendMode ||
            "source-over") as GlobalCompositeOperation;
          displayCtx.drawImage(layerSource, cx, cy, cw, ch, cx, cy, cw, ch);
          displayCtx.globalAlpha = 1;
          displayCtx.globalCompositeOperation = "source-over";
        }
      }
    },
    [],
  );

  // ── buildStrokeCanvases ───────────────────────────────────────────────────
  // Builds the persistent below/above/snapshot canvases at stroke start.
  // Called once per stroke from handlePointerDown before the first stamp.
  // biome-ignore lint/correctness/useExhaustiveDependencies: all refs are stable (useRef)
  const buildStrokeCanvases = useCallback((activeLayerId: string) => {
    const display = displayCanvasRef.current;
    const below = belowActiveCanvasRef.current;
    const above = aboveActiveCanvasRef.current;
    const snap = snapshotCanvasRef.current;
    const activeLayerCanvas = layerCanvasesRef.current.get(activeLayerId);
    if (!display || !below || !above || !snap || !activeLayerCanvas) return;

    const W = display.width;
    const H = display.height;

    // Clear WebGL stroke buffer for new stroke
    if (webglBrushRef.current) {
      webglBrushRef.current.clear();
    } else {
      const sbuf = strokeBufferRef.current;
      if (sbuf)
        sbuf
          .getContext("2d", { willReadFrequently: !isIPad })
          ?.clearRect(0, 0, sbuf.width, sbuf.height);
    }

    const ls = layersRef.current;
    const activeIdx = ls.findIndex((l) => l.id === activeLayerId);

    // --- Cache check: skip expensive below/above rebuild if nothing changed ---
    // strokeCanvasCacheKeyRef is a monotonic counter incremented on every layer/activeLayerId change.
    // strokeCanvasLastBuiltGenRef stores the generation at the last successful build.
    // An O(1) integer comparison replaces the previous O(n) string-map-join over all layers.
    const currentGen = strokeCanvasCacheKeyRef.current;
    const cacheValid =
      strokeCanvasLastBuiltGenRef.current === currentGen &&
      below.width === W &&
      below.height === H;

    if (!cacheValid) {
      strokeCanvasLastBuiltGenRef.current = currentGen;
      // Resize below/above canvases if canvas was resized — also clear cached contexts
      if (below.width !== W || below.height !== H) {
        below.width = W;
        below.height = H;
        _belowCtxCached = null;
      }
      if (above.width !== W || above.height !== H) {
        above.width = W;
        above.height = H;
        _aboveCtxCached = null;
      }
    }

    // --- Build belowActiveCanvas: background fill + layers below (with blend modes) ---
    if (!_belowCtxCached)
      _belowCtxCached = below.getContext("2d", { willReadFrequently: !isIPad });
    const belowCtx = _belowCtxCached;
    if (!belowCtx) return;
    if (!cacheValid) {
      belowCtx.clearRect(0, 0, W, H);
      belowCtx.globalAlpha = 1;
      for (let i = ls.length - 1; i > activeIdx; i--) {
        const layer = ls[i];
        if (!layer.visible) continue;
        const lc = layerCanvasesRef.current.get(layer.id);
        if (!lc) continue;
        belowCtx.globalAlpha = layer.opacity;
        belowCtx.globalCompositeOperation = (layer.blendMode ||
          "source-over") as GlobalCompositeOperation;
        if (layer.isClippingMask && i < ls.length - 1) {
          // Find the base layer this clips to
          let baseLayer: Layer | null = null;
          for (let j = i + 1; j < ls.length; j++) {
            if (!ls[j].isClippingMask) {
              baseLayer = ls[j];
              break;
            }
          }
          if (baseLayer) {
            const baseLc = layerCanvasesRef.current.get(baseLayer.id);
            if (baseLc) {
              // Reuse the module-level _clipTmpCanvas to avoid per-stroke allocation
              if (_clipTmpCanvas.width !== W || _clipTmpCanvas.height !== H) {
                _clipTmpCanvas.width = W;
                _clipTmpCanvas.height = H;
                _clipTmpCtxCached = null;
              }
              if (!_clipTmpCtxCached) {
                _clipTmpCtxCached = _clipTmpCanvas.getContext("2d", {
                  willReadFrequently: !isIPad,
                });
              }
              const tmpCtx = _clipTmpCtxCached;
              if (tmpCtx) {
                tmpCtx.clearRect(0, 0, W, H);
                tmpCtx.globalCompositeOperation = "source-over";
                tmpCtx.drawImage(getBitmapOrCanvas(layer.id, lc), 0, 0);
                tmpCtx.globalCompositeOperation = "destination-in";
                tmpCtx.drawImage(getBitmapOrCanvas(baseLayer.id, baseLc), 0, 0);
                tmpCtx.globalCompositeOperation = "source-over";
                belowCtx.drawImage(_clipTmpCanvas, 0, 0);
              }
              belowCtx.globalCompositeOperation = "source-over";
              continue;
            }
          }
        }
        belowCtx.drawImage(getBitmapOrCanvas(layer.id, lc), 0, 0);
        belowCtx.globalCompositeOperation = "source-over";
      }
      belowCtx.globalAlpha = 1;
      belowCtx.globalCompositeOperation = "source-over";
    }

    // --- Build snapshotCanvas: active layer state at stroke start ---
    if (!_snapCtxCached)
      _snapCtxCached = snap.getContext("2d", { willReadFrequently: !isIPad });
    const snapCtx = _snapCtxCached;
    if (!snapCtx) return;
    snapCtx.clearRect(0, 0, W, H);
    snapCtx.drawImage(activeLayerCanvas, 0, 0);
  }, []);

  // ── flushStrokeBuffer ─────────────────────────────────────────────────────
  // biome-ignore lint/correctness/useExhaustiveDependencies: all refs are stable (useRef)
  const flushStrokeBuffer = useCallback(
    (lc: HTMLCanvasElement, _opacity: number, tool: Tool) => {
      const layerCtx = lc.getContext("2d", { willReadFrequently: !isIPad });
      const snap = strokeStartSnapshotRef.current;
      const sbuf = strokeBufferRef.current;
      if (!layerCtx || !snap || !sbuf) return;

      // snap.pixels is always full-canvas (x=0, y=0) — putImageData restores the full layer.
      // Dirty rect is still used to clip the sbuf drawImage calls for efficiency.
      const _dr = strokeDirtyRectRef.current;
      const _pad = 2; // 2px guard for AA/rounding
      const _drx = _dr ? Math.max(0, Math.floor(_dr.minX) - _pad) : 0;
      const _dry = _dr ? Math.max(0, Math.floor(_dr.minY) - _pad) : 0;
      const _drx2 = _dr
        ? Math.min(lc.width, Math.ceil(_dr.maxX) + _pad)
        : lc.width;
      const _dry2 = _dr
        ? Math.min(lc.height, Math.ceil(_dr.maxY) + _pad)
        : lc.height;
      const _drw = _drx2 - _drx;
      const _drh = _dry2 - _dry;
      const _useDirtyRestore = _dr != null && _drw > 0 && _drh > 0;

      const selMask = selectionMaskRef.current;
      if (selMask && selectionActiveRef.current) {
        // Clip stroke to selection: draw stroke into a temp canvas, mask with selection, then composite
        // Reuse pre-allocated canvas to avoid per-stroke-commit allocation
        if (
          _tempStrokeCanvas.width !== lc.width ||
          _tempStrokeCanvas.height !== lc.height
        ) {
          _tempStrokeCanvas.width = lc.width;
          _tempStrokeCanvas.height = lc.height;
          _tempStrokeCtxCached = null;
        }
        if (!_tempStrokeCtxCached)
          _tempStrokeCtxCached = _tempStrokeCanvas.getContext("2d", {
            willReadFrequently: !isIPad,
          });
        const tmpCanvas = _tempStrokeCanvas;
        const tmpCtx = _tempStrokeCtxCached!;
        tmpCtx.clearRect(0, 0, tmpCanvas.width, tmpCanvas.height);
        tmpCtx.globalAlpha = _opacity; // apply opacity ceiling when drawing sbuf into temp
        tmpCtx.globalCompositeOperation = "source-over";
        tmpCtx.drawImage(sbuf, 0, 0);
        tmpCtx.globalAlpha = 1;
        // Apply selection mask (destination-in keeps only selected pixels)
        tmpCtx.globalCompositeOperation = "destination-in";
        tmpCtx.drawImage(selMask, 0, 0);
        tmpCtx.globalCompositeOperation = "source-over";
        // Restore snapshot: 3-arg form places the cropped data at its origin (snap.x, snap.y)
        layerCtx.putImageData(snap.pixels, snap.x, snap.y);
        layerCtx.globalAlpha = 1;
        if (tool === "eraser") {
          layerCtx.globalCompositeOperation = "destination-out";
        } else if (activeLayerAlphaLockRef.current) {
          layerCtx.globalCompositeOperation = "source-atop";
        } else {
          layerCtx.globalCompositeOperation = "source-over";
        }
        if (_useDirtyRestore) {
          layerCtx.drawImage(
            tmpCanvas,
            _drx,
            _dry,
            _drw,
            _drh,
            _drx,
            _dry,
            _drw,
            _drh,
          );
        } else {
          layerCtx.drawImage(tmpCanvas, 0, 0);
        }
        layerCtx.globalAlpha = 1;
        layerCtx.globalCompositeOperation = "source-over";
      } else {
        // Restore snapshot: 3-arg form places the cropped data at its origin (snap.x, snap.y)
        layerCtx.putImageData(snap.pixels, snap.x, snap.y);
        // Apply opacity slider ceiling here via globalAlpha — flushDisplay outputs at 1.0.
        layerCtx.globalAlpha = _opacity;
        if (tool === "eraser" || brushBlendModeRef.current === "clear") {
          layerCtx.globalCompositeOperation = "destination-out";
        } else if (activeLayerAlphaLockRef.current) {
          layerCtx.globalCompositeOperation = "source-atop";
        } else {
          layerCtx.globalCompositeOperation =
            brushBlendModeRef.current as GlobalCompositeOperation;
        }
        if (_useDirtyRestore) {
          layerCtx.drawImage(
            sbuf,
            _drx,
            _dry,
            _drw,
            _drh,
            _drx,
            _dry,
            _drw,
            _drh,
          );
        } else {
          layerCtx.drawImage(sbuf, 0, 0);
        }
        layerCtx.globalAlpha = 1;
        layerCtx.globalCompositeOperation = "source-over";
      }
      // Mark this layer's bitmap dirty — pixels have changed, GPU must re-upload next frame
      markLayerBitmapDirty(activeLayerIdRef.current);
    },
    [],
  );

  // ── scheduleComposite ────────────────────────────────────────────────────
  const compositeScheduledRef = useRef(false);
  const scheduleComposite = useCallback(() => {
    if (compositeScheduledRef.current) return;
    compositeScheduledRef.current = true;
    requestAnimationFrame(() => {
      compositeScheduledRef.current = false;
      composite();
    });
  }, [composite]);

  // ── _strokeCommitDirty ────────────────────────────────────────────────────
  // Returns a dirty-rect region for composite() based on the current stroke's dirty rect.
  // biome-ignore lint/correctness/useExhaustiveDependencies: all refs are stable (useRef)
  const _strokeCommitDirty = useCallback(():
    | { x: number; y: number; w: number; h: number }
    | undefined => {
    const dr = strokeDirtyRectRef.current;
    if (!dr) return undefined;
    const pad = Math.ceil(Math.max(getActiveSize() / 2, 8));
    const display = displayCanvasRef.current;
    if (!display) return undefined;
    const x = Math.max(0, Math.floor(dr.minX) - pad);
    const y = Math.max(0, Math.floor(dr.minY) - pad);
    const x2 = Math.min(display.width, Math.ceil(dr.maxX) + pad);
    const y2 = Math.min(display.height, Math.ceil(dr.maxY) + pad);
    return { x, y, w: x2 - x, h: y2 - y };
  }, [getActiveSize]);

  return {
    composite,
    compositeWithStrokePreview,
    buildStrokeCanvases,
    flushStrokeBuffer,
    scheduleComposite,
    _strokeCommitDirty,
    needsFullCompositeRef,
  };
}
