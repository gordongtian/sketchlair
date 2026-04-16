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
import {
  isFlatEndGroup,
  isFlatGroupHeader,
  isFlatLayer,
} from "@/utils/groupUtils";
import type { FlatEntry } from "@/utils/groupUtils";
import { useCallback, useRef } from "react";
import type React from "react";
import { isIPad } from "../utils/constants";
import { getLiquifyStrokeActive } from "./useLiquifySystem";

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

// ─── scheduleComposite cancellation token ────────────────────────────────────
// Module-level RAF ID so external callers (e.g. liquify pointer-down) can cancel
// a pending scheduleComposite RAF that has already been enqueued. Without this,
// the two-RAF chain  (_liqRafPendingRef → scheduleComposite inner RAF) means
// cancelling only _liqRafPendingRef is insufficient when the first RAF already
// fired and enqueued the scheduleComposite inner RAF before pointer-down ran.
let _scheduleCompositeRafId: number | null = null;

/**
 * Cancel the pending scheduleComposite RAF if one is in flight.
 * Call at liquify pointer-down to prevent a trailing composite from the previous
 * stroke's last pointer-move from flashing inactive layers' pre-warp state.
 */
export function cancelScheduledComposite(): void {
  if (_scheduleCompositeRafId !== null) {
    cancelAnimationFrame(_scheduleCompositeRafId);
    _scheduleCompositeRafId = null;
  }
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
  /**
   * Returns the current flat layers array (used to skip thumbnails for
   * collapsed-group children).
   */
  getLayers?: () => FlatEntry[];
}

let _dirtyCallbacks: CanvasDirtyCallbacks | null = null;

// Pending layer IDs that need thumbnail regeneration
const _pendingThumbLayerIds = new Set<string>();
let _thumbFlushTimerId: ReturnType<typeof setTimeout> | null = null;
let _navFlushTimerId: ReturnType<typeof setTimeout> | null = null;

/**
 * Returns false if the layer is inside a collapsed group (and therefore not
 * visible in the layer panel). Thumbnail regeneration is skipped for such layers
 * because the user can't see them in the panel anyway — saving CPU on large layer stacks.
 *
 * A layer that is simply hidden (visible=false) still has its thumbnail updated
 * so the panel can show the correct thumbnail when the layer is made visible again.
 *
 * Returns true for top-level layers and layers inside fully-expanded groups.
 */
function checkIsLayerVisibleInPanel(
  layerId: string,
  layers: FlatEntry[],
): boolean {
  const idx = layers.findIndex((e) => e.id === layerId);
  if (idx === -1) return false;

  // Walk backwards from the layer's position to find all ancestor group headers.
  // If any ancestor group is collapsed, the layer is hidden in the panel.
  let skipDepth = 0;
  for (let i = idx - 1; i >= 0; i--) {
    const e = layers[i];
    if (isFlatEndGroup(e)) {
      // Passing over a complete nested group while scanning backwards
      skipDepth++;
    } else if (isFlatGroupHeader(e)) {
      if (skipDepth > 0) {
        // This header belongs to the nested group we're skipping
        skipDepth--;
      } else {
        // This is an ancestor group header
        if (e.collapsed) return false;
      }
    }
  }

  return true;
}

function _flushPendingThumbs(): void {
  _thumbFlushTimerId = null;
  if (!_dirtyCallbacks || _pendingThumbLayerIds.size === 0) return;
  const ids = [..._pendingThumbLayerIds];
  _pendingThumbLayerIds.clear();
  // Snapshot the current flat layers once for all panel-visibility checks.
  const currentLayers = _dirtyCallbacks.getLayers?.() ?? null;
  _dirtyCallbacks.setLayerThumbnails((prev) => {
    const next = { ...prev };
    for (const id of ids) {
      // Skip thumbnail regeneration for layers inside collapsed groups — they
      // are not visible in the panel so regenerating would be pure waste.
      if (currentLayers && !checkIsLayerVisibleInPanel(id, currentLayers)) {
        continue;
      }
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
  layersRef: React.MutableRefObject<Layer[]>;
  activeLayerIdRef: React.MutableRefObject<string>;
  activeLayerAlphaLockRef: React.MutableRefObject<boolean>;
  brushBlendModeRef: React.MutableRefObject<string>;
  tailRafIdRef: React.MutableRefObject<number | null>;
  needsFullCompositeRef: React.MutableRefObject<boolean>;
  /**
   * Set to true at pointer-down (stroke start) and false at flushStrokeBuffer commit.
   * Any function that would write to a layer canvas checks this flag and blocks
   * if a stroke is active — layer canvases are strictly read-only during a stroke.
   */
  strokeActiveRef: React.MutableRefObject<boolean>;
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
  /** Opacity locked at stroke start so compositeWithStrokePreview and flushStrokeBuffer
   *  always use the same value — prevents mid-stroke opacity collapse when a move/transform
   *  commits and updates layer state while a stroke is in flight (Symptom 3 fix). */
  strokeActiveLayerOpacityRef: React.MutableRefObject<number | null>;
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
  /**
   * Canvas integrity utility — returns a correctly-sized HTMLCanvasElement for
   * the given layerId, creating or resizing it if necessary.
   * Passed from PaintingApp so the implementation is never duplicated.
   */
  getOrCreateLayerCanvas: (layerId: string) => HTMLCanvasElement;
}

// ─── Group scope stack helpers ────────────────────────────────────────────────
// Used during the bottom-to-top compositing loop to cascade opacity/visibility
// from ancestor group headers to their child layers.
//
// The flat array is walked from ls.length-1 → 0 (bottom to top = painter's order).
// When walking upward:
//   end_group encountered → we are entering a group's content range → push scope
//   group header encountered → we are leaving a group's content range → pop scope
//
// This means the stack always contains the enclosing group headers for the
// current compositing position, in innermost-first order.

interface GroupScope {
  id: string;
  opacity: number;
  visible: boolean;
  blendMode: string;
  /** True when this group has its own offscreen compositing buffer */
  hasOffscreen: boolean;
  /** The offscreen canvas for this group scope, when hasOffscreen is true */
  offscreenCanvas: HTMLCanvasElement | null;
  offscreenCtx: CanvasRenderingContext2D | null;
}

/**
 * Compute the cascaded effective opacity of a layer, given the current group scope stack.
 * The stack is ordered innermost-first (top of stack = immediately enclosing group).
 * Effective opacity = layer.opacity × product of all scope opacities.
 */
function effectiveOpacityFromStack(
  layerOpacity: number,
  stack: GroupScope[],
): number {
  let result = layerOpacity;
  for (const scope of stack) {
    result *= scope.opacity;
  }
  return result;
}

/**
 * Returns true if the layer is effectively visible given the group scope stack.
 * A layer is invisible if its own visible flag is false OR if any enclosing group
 * has visible=false.
 */
function effectiveVisibleFromStack(
  layerVisible: boolean,
  stack: GroupScope[],
): boolean {
  if (!layerVisible) return false;
  for (const scope of stack) {
    if (!scope.visible) return false;
  }
  return true;
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
  layersRef,
  activeLayerIdRef,
  activeLayerAlphaLockRef,
  brushBlendModeRef,
  tailRafIdRef,
  needsFullCompositeRef,
  strokeActiveRef,
  strokeDirtyRectRef,
  strokeStartSnapshotRef,
  strokeCanvasCacheKeyRef,
  strokeCanvasLastBuiltGenRef,
  strokeActiveLayerOpacityRef,
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
  getOrCreateLayerCanvas,
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
        // Safety net: fill the dirty region with opaque white so the HTML page background
        // never shows through if the bottommost layer canvas is still transparent.
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(drX, drY, drW, drH);
      } else {
        ctx.clearRect(0, 0, dW, dH);
        // Safety net: fill the full canvas with opaque white before drawing any layer.
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, dW, dH);
      }

      // Iterate the flat layers array directly (bottom-to-top = painter's algorithm).
      // Group headers and end_group markers define compositing scope boundaries.
      // Walking from the end of the array to the start means:
      //   end_group → entering a group's content range (push scope)
      //   group header → leaving a group's content range (pop scope)
      const ls = layersRef.current as unknown as FlatEntry[];

      // When a dirty region is known, clip all draws to it so GPU only processes that region.
      if (useDR) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(drX, drY, drW, drH);
        ctx.clip();
      }

      // Group scope stack — innermost-first.
      // Each entry tracks the enclosing group's opacity/visibility for cascading.
      const groupScopeStack: GroupScope[] = [];

      // FIX 3: Validation counters for the debug log at the end of composite().
      let paintedCount = 0;
      const totalPaintLayers = ls.filter(isFlatLayer).length;

      for (let i = ls.length - 1; i >= 0; i--) {
        const entry = ls[i];

        // ── end_group: push a group compositing scope ──────────────────────
        // We are entering (from below) a group's content range.
        if (isFlatEndGroup(entry)) {
          // Find the matching group header to get its properties
          const groupId = entry.id;
          let headerOpacity = 1;
          let headerVisible = true;
          let headerBlendMode = "source-over";
          // Scan backwards for the header (it will be before its end_group in the array,
          // but since we're iterating in reverse we need to scan forward from current position)
          for (let j = i - 1; j >= 0; j--) {
            const candidate = ls[j];
            if (isFlatGroupHeader(candidate) && candidate.id === groupId) {
              headerOpacity = candidate.opacity;
              headerVisible = candidate.visible;
              headerBlendMode =
                (candidate as unknown as { blendMode?: string }).blendMode ??
                "source-over";
              break;
            }
          }

          // Determine if this group needs an offscreen compositing buffer.
          // A group needs its own offscreen buffer when it has non-default opacity
          // or a non-default blend mode — so the group composites as a unit.
          const needsOffscreen =
            headerOpacity < 1 ||
            (headerBlendMode !== "source-over" && headerBlendMode !== "");

          let offscreenCanvas: HTMLCanvasElement | null = null;
          let offscreenCtx: CanvasRenderingContext2D | null = null;

          if (needsOffscreen) {
            offscreenCanvas = document.createElement("canvas");
            offscreenCanvas.width = dW;
            offscreenCanvas.height = dH;
            offscreenCtx = offscreenCanvas.getContext("2d");
          }

          groupScopeStack.push({
            id: groupId,
            opacity: headerOpacity,
            visible: headerVisible,
            blendMode: headerBlendMode,
            hasOffscreen: needsOffscreen,
            offscreenCanvas,
            offscreenCtx,
          });
          continue;
        }

        // ── group header: pop the group scope and composite its buffer ──────
        // We are leaving (from below) the group's content range.
        if (isFlatGroupHeader(entry)) {
          const scope = groupScopeStack.pop();
          if (scope?.hasOffscreen && scope.offscreenCanvas) {
            // Determine the target context — either the parent offscreen or the display
            const parentScope = groupScopeStack[groupScopeStack.length - 1];
            const targetCtx =
              parentScope?.hasOffscreen && parentScope.offscreenCtx
                ? parentScope.offscreenCtx
                : ctx;

            // Effective group opacity = group's own opacity × all ancestor group opacities
            const cascadedOpacity = effectiveOpacityFromStack(
              scope.opacity,
              groupScopeStack,
            );
            const groupVisible = effectiveVisibleFromStack(
              scope.visible,
              groupScopeStack,
            );

            if (groupVisible) {
              targetCtx.globalAlpha = cascadedOpacity;
              targetCtx.globalCompositeOperation = (scope.blendMode ||
                "source-over") as GlobalCompositeOperation;
              if (useDR) {
                targetCtx.drawImage(
                  scope.offscreenCanvas,
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
                targetCtx.drawImage(scope.offscreenCanvas, 0, 0);
              }
              targetCtx.globalAlpha = 1;
              targetCtx.globalCompositeOperation = "source-over";
            }
          }
          // If no offscreen scope was pushed (opacity=1, default blend mode),
          // there is nothing extra to composite — children were already drawn
          // directly into the parent context.
          continue;
        }

        // ── Regular PaintLayer ─────────────────────────────────────────────
        if (!isFlatLayer(entry)) continue;

        // Cast to the paint-layer shape (FlatEntry has all the fields we need)
        const layer = entry as FlatEntry & {
          visible: boolean;
          opacity: number;
          blendMode: string;
          isClippingMask?: boolean;
        };

        // Visibility: layer must be visible and all ancestor groups must be visible
        if (!effectiveVisibleFromStack(layer.visible, groupScopeStack))
          continue;

        // FIX 2a: Use getOrCreateLayerCanvas for paint layers so missing or
        // wrongly-sized canvases are self-healed rather than silently skipped.
        const lc = getOrCreateLayerCanvas(layer.id);
        paintedCount++;

        // Effective opacity cascades through all ancestor group opacities
        const effectiveOpacity = effectiveOpacityFromStack(
          layer.opacity,
          groupScopeStack,
        );

        // Determine which context to render into:
        // If the immediately enclosing group has an offscreen buffer, render there.
        // Otherwise render directly to the display canvas.
        const enclosingScope = groupScopeStack[groupScopeStack.length - 1];
        const renderCtx =
          enclosingScope?.hasOffscreen && enclosingScope.offscreenCtx
            ? enclosingScope.offscreenCtx
            : ctx;

        // If clipping mask, apply clip to layer below
        if (layer.isClippingMask) {
          // Find the layer below (non-clipping, non-background) in the flat array
          let belowLayer:
            | (FlatEntry & {
                visible: boolean;
                opacity: number;
                blendMode: string;
              })
            | null = null;
          for (let j = i + 1; j < ls.length; j++) {
            const candidate = ls[j];
            if (isFlatLayer(candidate)) {
              const candidateLayer = candidate as FlatEntry & {
                isClippingMask?: boolean;
              };
              if (!candidateLayer.isClippingMask) {
                belowLayer = candidate as FlatEntry & {
                  visible: boolean;
                  opacity: number;
                  blendMode: string;
                };
                break;
              }
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
              renderCtx.globalAlpha = 1;
              renderCtx.globalCompositeOperation = (layer.blendMode ||
                "source-over") as GlobalCompositeOperation;
              if (useDR) {
                renderCtx.drawImage(
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
                renderCtx.drawImage(_clipTmpCanvas, 0, 0);
              }
              renderCtx.globalCompositeOperation = "source-over";
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
          renderCtx.globalAlpha = effectiveOpacity;
          renderCtx.globalCompositeOperation = (layer.blendMode ||
            "source-over") as GlobalCompositeOperation;
          renderCtx.drawImage(_clipTmpCanvas, 0, 0);
          renderCtx.globalCompositeOperation = "source-over";
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
          renderCtx.globalAlpha = effectiveOpacity;
          renderCtx.globalCompositeOperation = (layer.blendMode ||
            "source-over") as GlobalCompositeOperation;
          renderCtx.drawImage(_clipTmpCanvas, 0, 0);
          renderCtx.globalCompositeOperation = "source-over";
        } else if (!isBeingExtracted) {
          // Normal layer — draw from cache
          renderCtx.globalAlpha = effectiveOpacity;
          renderCtx.globalCompositeOperation = (layer.blendMode ||
            "source-over") as GlobalCompositeOperation;
          renderCtx.drawImage(getBitmapOrCanvas(layer.id, lc), 0, 0);
          renderCtx.globalCompositeOperation = "source-over";
        }
      }

      ctx.globalAlpha = 1;
      if (useDR) ctx.restore();
      // FIX 3: Debug log — how many paint layers were actually painted vs total.
      // Gated behind console.debug so it only shows in dev tools when enabled.
      console.debug(
        `[Composite] painted ${paintedCount}/${totalPaintLayers} paint layers`,
      );
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
      const activeLayerAsFlat = activeLayer as unknown as FlatEntry & {
        isClippingMask?: boolean;
      };
      if (activeLayerAsFlat.isClippingMask) {
        const ls2 = layersRef.current as unknown as FlatEntry[];
        const aIdx2 = ls2.findIndex((l) => l.id === activeLayerId);
        let baseLayerForClip: (FlatEntry & { id: string }) | null = null;
        for (let j = aIdx2 + 1; j < ls2.length; j++) {
          const candidate = ls2[j];
          if (isFlatLayer(candidate)) {
            const candidateLayer = candidate as FlatEntry & {
              isClippingMask?: boolean;
            };
            if (!candidateLayer.isClippingMask) {
              baseLayerForClip = candidate as FlatEntry & { id: string };
              break;
            }
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

      // Draw active layer preview to display.
      // The composite operation MUST always be source-over (or the layer's blend mode)
      // for normal paint strokes. destination-out is only valid for the eraser tool and
      // is applied to the PREVIEW canvas above — never to the display canvas draw here.
      const activeLayerBlend =
        (activeLayer as Layer).blendMode || "source-over";
      if (
        activeLayerBlend === "destination-out" &&
        !(tool === "eraser" || brushBlendModeRef.current === "clear")
      ) {
        // This should never happen for normal strokes. Log and fall back to source-over.
        console.warn(
          "[StrokePreview] destination-out reached for non-eraser/non-clear stroke — forcing source-over",
        );
      }
      displayCtx.globalAlpha =
        strokeActiveLayerOpacityRef.current ?? (activeLayer as Layer).opacity;
      // For the display canvas composite: always use the layer's blend mode (source-over for normal paint).
      // The eraser's destination-out was already applied inside previewCtx above — the display
      // draw just composites the fully-built preview at the layer's blend mode.
      displayCtx.globalCompositeOperation =
        activeLayerBlend as GlobalCompositeOperation;
      displayCtx.drawImage(previewSource, cx, cy, cw, ch, cx, cy, cw, ch);
      displayCtx.globalAlpha = 1;
      displayCtx.globalCompositeOperation = "source-over";

      // Apply above-active layers individually with their correct blend modes.
      // INVARIANT: This block ALWAYS runs after the active preview draw — it is never
      // conditional, never skippable. The clear above must always be followed by above-layer draws.
      // Walk from aIdx2-1 down to 0 (painter's order: low index = visually on top).
      {
        const ls2 = layersRef.current as unknown as FlatEntry[];
        const aIdx2 = ls2.findIndex((l) => l.id === activeLayerId);

        if (aIdx2 < 0) {
          // Active layer not found in flat array — log and leave the display as-is.
          // Do NOT clear and do NOT call composite() (which would yield via rAF and produce a flash).
          console.warn(
            "[StrokePreview] active layer not found in flat array — above-layer loop skipped, display left as-is",
            activeLayerId,
          );
        } else {
          // Resize check + context fetch hoisted outside the per-layer loop.
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

          // Group scope stack for cascaded opacity/visibility from ancestor groups.
          // We iterate downward (aIdx2-1 → 0), so:
          //   group header encountered going downward → push scope
          //   end_group encountered going downward → pop scope
          const aboveScopeStack: GroupScope[] = [];

          for (let i = aIdx2 - 1; i >= 0; i--) {
            const entry = ls2[i];

            // Group header going downward = entering the group from above → push scope
            if (isFlatGroupHeader(entry)) {
              aboveScopeStack.push({
                id: entry.id,
                opacity: entry.opacity,
                visible: entry.visible,
                blendMode:
                  (entry as unknown as { blendMode?: string }).blendMode ??
                  "source-over",
                hasOffscreen: false,
                offscreenCanvas: null,
                offscreenCtx: null,
              });
              continue;
            }

            // end_group going downward = leaving the group → pop scope
            if (isFlatEndGroup(entry)) {
              aboveScopeStack.pop();
              continue;
            }

            // Skip non-paint entries
            if (!isFlatLayer(entry)) continue;

            const layer = entry as FlatEntry & {
              visible: boolean;
              opacity: number;
              blendMode: string;
              isClippingMask?: boolean;
            };

            // Respect group visibility cascade
            if (!effectiveVisibleFromStack(layer.visible, aboveScopeStack))
              continue;

            // Read the layer canvas directly — do NOT call getOrCreateLayerCanvas here
            // because layer canvases are read-only during a stroke (strokeActiveRef invariant).
            // If the canvas is missing, skip this layer but continue the loop.
            const lc = layerCanvasesRef.current.get(layer.id);
            if (!lc) continue;

            // Cascade opacity through ancestor groups
            const effOpacity = effectiveOpacityFromStack(
              layer.opacity,
              aboveScopeStack,
            );

            let layerSource: HTMLCanvasElement = lc;

            // Handle clipping mask: mask layer pixels against its base layer
            if (layer.isClippingMask) {
              let baseLayer: (FlatEntry & { id: string }) | null = null;
              for (let j = i + 1; j < ls2.length; j++) {
                const candidate = ls2[j];
                if (isFlatLayer(candidate)) {
                  const candidateLayer = candidate as FlatEntry & {
                    isClippingMask?: boolean;
                  };
                  if (!candidateLayer.isClippingMask) {
                    baseLayer = candidate as FlatEntry & { id: string };
                    break;
                  }
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

            displayCtx.globalAlpha = effOpacity;
            displayCtx.globalCompositeOperation = (layer.blendMode ||
              "source-over") as GlobalCompositeOperation;
            displayCtx.drawImage(layerSource, cx, cy, cw, ch, cx, cy, cw, ch);
            displayCtx.globalAlpha = 1;
            displayCtx.globalCompositeOperation = "source-over";
          }
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
    // FIX 2b: Use getOrCreateLayerCanvas so the active layer's canvas always
    // exists and is correctly sized before a stroke begins.
    const activeLayerCanvas = getOrCreateLayerCanvas(activeLayerId);
    if (!display || !below || !above || !snap) return;

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

    const ls = layersRef.current as unknown as FlatEntry[];
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
      // Build a group scope stack for cascaded opacity/visibility while
      // iterating below layers (same bottom-to-top direction as composite()).
      const belowScopeStack: GroupScope[] = [];
      for (let i = ls.length - 1; i > activeIdx; i--) {
        const entry = ls[i];

        // end_group → push scope (entering a group's range going upward)
        if (isFlatEndGroup(entry)) {
          const groupId = entry.id;
          let hOpacity = 1;
          let hVisible = true;
          let hBlendMode = "source-over";
          for (let j = i - 1; j >= 0; j--) {
            const candidate = ls[j];
            if (isFlatGroupHeader(candidate) && candidate.id === groupId) {
              hOpacity = candidate.opacity;
              hVisible = candidate.visible;
              hBlendMode =
                (candidate as unknown as { blendMode?: string }).blendMode ??
                "source-over";
              break;
            }
          }
          belowScopeStack.push({
            id: groupId,
            opacity: hOpacity,
            visible: hVisible,
            blendMode: hBlendMode,
            hasOffscreen: false,
            offscreenCanvas: null,
            offscreenCtx: null,
          });
          continue;
        }

        // group header → pop scope (leaving a group's range going upward)
        if (isFlatGroupHeader(entry)) {
          belowScopeStack.pop();
          continue;
        }

        // Regular layer — skip non-visible ones
        if (!isFlatLayer(entry)) continue;
        const layer = entry as FlatEntry & {
          visible: boolean;
          opacity: number;
          blendMode: string;
          isClippingMask?: boolean;
        };
        if (!effectiveVisibleFromStack(layer.visible, belowScopeStack))
          continue;
        const lc = layerCanvasesRef.current.get(layer.id);
        if (!lc) continue;
        const effOpacity = effectiveOpacityFromStack(
          layer.opacity,
          belowScopeStack,
        );
        belowCtx.globalAlpha = effOpacity;
        belowCtx.globalCompositeOperation = (layer.blendMode ||
          "source-over") as GlobalCompositeOperation;
        if (layer.isClippingMask) {
          // Find the base layer this clips to
          let baseLayer: (FlatEntry & { id: string }) | null = null;
          for (let j = i + 1; j < ls.length; j++) {
            const candidate = ls[j];
            if (isFlatLayer(candidate)) {
              const candidateLayer = candidate as FlatEntry & {
                isClippingMask?: boolean;
              };
              if (!candidateLayer.isClippingMask) {
                baseLayer = candidate as FlatEntry & { id: string };
                break;
              }
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

    // Capture the active layer's opacity atomically at stroke start.
    // compositeWithStrokePreview and flushStrokeBuffer both read from this ref
    // so they always agree even if layer.opacity is mutated mid-stroke by a
    // concurrent move/transform commit (Symptom 3 fix).
    const activeLayerData = layersRef.current.find(
      (l) => l.id === activeLayerId,
    );
    strokeActiveLayerOpacityRef.current =
      (activeLayerData as Layer | undefined)?.opacity ?? 1;
  }, []);

  // ── flushStrokeBuffer ─────────────────────────────────────────────────────
  // biome-ignore lint/correctness/useExhaustiveDependencies: all refs are stable (useRef)
  const flushStrokeBuffer = useCallback(
    (lc: HTMLCanvasElement, _opacity: number, tool: Tool) => {
      // FIX 2a: Validate/repair the active layer canvas before any pixel write.
      // If lc is wrongly sized or has been replaced (e.g. after an undo), the
      // authoritative canvas is the one returned by getOrCreateLayerCanvas().
      const activeLayerId = activeLayerIdRef.current;
      const validatedLc = getOrCreateLayerCanvas(activeLayerId);
      // Use validatedLc unless the caller passed a different canvas (e.g. during
      // tail RAF where _tailLc is explicitly set). Match by identity and fall
      // back to validatedLc only when they agree on the same layer.
      const effectiveLc = validatedLc.width > 0 ? validatedLc : lc;
      const layerCtx = effectiveLc.getContext("2d", {
        willReadFrequently: !isIPad,
      });
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
        ? Math.min(effectiveLc.width, Math.ceil(_dr.maxX) + _pad)
        : effectiveLc.width;
      const _dry2 = _dr
        ? Math.min(effectiveLc.height, Math.ceil(_dr.maxY) + _pad)
        : effectiveLc.height;
      const _drw = _drx2 - _drx;
      const _drh = _dry2 - _dry;
      const _useDirtyRestore = _dr != null && _drw > 0 && _drh > 0;

      const selMask = selectionMaskRef.current;
      if (selMask && selectionActiveRef.current) {
        // Clip stroke to selection: draw stroke into a temp canvas, mask with selection, then composite
        // Reuse pre-allocated canvas to avoid per-stroke-commit allocation
        if (
          _tempStrokeCanvas.width !== effectiveLc.width ||
          _tempStrokeCanvas.height !== effectiveLc.height
        ) {
          _tempStrokeCanvas.width = effectiveLc.width;
          _tempStrokeCanvas.height = effectiveLc.height;
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
      // Clear the stroke-active guard — the commit write to the layer canvas is complete.
      // From this point on, layer canvases are writable again (e.g. by getOrCreateLayerCanvas).
      strokeActiveRef.current = false;
      // Release the locked stroke opacity — stroke is complete.
      strokeActiveLayerOpacityRef.current = null;
    },
    [],
  );

  // ── scheduleComposite ────────────────────────────────────────────────────
  // Gated by getLiquifyStrokeActive(): while a liquify stroke is in progress,
  // any trailing RAF from the previous stroke's pointer-move is suppressed here
  // so pre-warp layer state is never drawn to the canvas at stroke start.
  // This is the single authoritative gate (A4 fix — collapsed from three stacked fixes).
  const compositeScheduledRef = useRef(false);
  const scheduleComposite = useCallback(() => {
    // Gate: skip if a liquify stroke is active so no pre-warp render can sneak through.
    if (getLiquifyStrokeActive()) return;
    if (compositeScheduledRef.current) return;
    compositeScheduledRef.current = true;
    requestAnimationFrame(() => {
      compositeScheduledRef.current = false;
      // Re-check inside the RAF — pointer-down may have set the flag while
      // this frame was already pending.
      if (getLiquifyStrokeActive()) return;
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
