/**
 * groupUtils.ts — Pure utility functions for the flat-array layer architecture.
 *
 * In the new architecture the layer stack is a single flat array. Groups are
 * represented by two special marker entries that sit at the same level as their
 * siblings:
 *
 *   { type: 'group',     id: 'G', name: '...', ... }   ← group header
 *   { type: 'end_group', id: 'G' }                      ← closing marker (same id)
 *
 * All layers and nested groups appear between the header and its end_group.
 * Nesting depth is determined purely by position, not by object references or
 * parentId fields.
 *
 * All functions are pure / immutable — they never mutate their inputs.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * A regular paint/ruler layer in the flat array.
 * During the migration this maps to the existing `Layer` interface from
 * LayersPanel.tsx.  The `type` discriminant will be added there; until it is,
 * anything that is not explicitly 'group' or 'end_group' is treated as a
 * regular layer.
 */
export interface FlatLayer {
  type?: "layer";
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  blendMode: string;
  isClippingMask: boolean;
  alphaLock: boolean;
  [key: string]: unknown; // ruler fields and any other extension properties
}

/** Group header marker — appears at the top of a group slice. */
export interface FlatGroupHeader {
  type: "group";
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  collapsed: boolean;
}

/** End-group marker — appears at the bottom of a group slice, same id as its header. */
export interface FlatEndGroup {
  type: "end_group";
  id: string;
}

/**
 * Union of all entry types in the flat layer array.
 * Use `isFlatLayer`, `isFlatGroupHeader`, and `isFlatEndGroup` to discriminate.
 */
export type FlatEntry = FlatLayer | FlatGroupHeader | FlatEndGroup;

// ── Type guards ───────────────────────────────────────────────────────────────

export function isFlatGroupHeader(e: FlatEntry): e is FlatGroupHeader {
  return e.type === "group";
}

export function isFlatEndGroup(e: FlatEntry): e is FlatEndGroup {
  return e.type === "end_group";
}

export function isFlatLayer(e: FlatEntry): e is FlatLayer {
  return e.type !== "group" && e.type !== "end_group";
}

// ── ID generation ─────────────────────────────────────────────────────────────

let _groupIdCounter = 0;

/**
 * Generate a unique id that is shared by a group header and its end_group
 * marker.  Both entries receive the SAME id — they are linked by id, not by a
 * separate field.
 */
export function generateGroupId(): string {
  _groupIdCounter++;
  return `group_${Date.now()}_${_groupIdCounter}`;
}

/** Read the current counter value (used by history/undo to capture state). */
export function getGroupIdCounter(): number {
  return _groupIdCounter;
}

/** Restore the counter to a specific value (used by undo/redo). */
export function setGroupIdCounter(n: number): void {
  _groupIdCounter = n;
}

/**
 * Walk a flat array and advance _groupIdCounter past any group ids it finds.
 * Call once after loading a file so freshly-created groups never collide.
 */
export function resetGroupIdCounterFromFlat(layers: FlatEntry[]): void {
  let max = 0;
  for (const entry of layers) {
    if (isFlatGroupHeader(entry)) {
      const parts = entry.id.split("_");
      const suffix =
        parts.length >= 3
          ? Number.parseInt(parts[parts.length - 1], 10)
          : Number.NaN;
      if (!Number.isNaN(suffix) && suffix > max) {
        max = suffix;
      }
    }
  }
  if (max > _groupIdCounter) {
    _groupIdCounter = max;
  }
}

// ── Core utilities ────────────────────────────────────────────────────────────

/**
 * getGroupSlice
 *
 * Returns the contiguous slice of the flat array that belongs to the group
 * with `groupId`, including its header and end_group markers.
 *
 * @returns { startIndex, endIndex, entries } where:
 *   - startIndex is the index of the group header
 *   - endIndex   is the index of the matching end_group
 *   - entries    is layers.slice(startIndex, endIndex + 1) — inclusive of both markers
 * @returns null if no group with the given id is found.
 */
export function getGroupSlice(
  layers: FlatEntry[],
  groupId: string,
): { startIndex: number; endIndex: number; entries: FlatEntry[] } | null {
  // Find the group header
  const startIndex = layers.findIndex(
    (e) => isFlatGroupHeader(e) && e.id === groupId,
  );
  if (startIndex === -1) return null;

  // Walk forward to find the matching end_group.
  // We track depth so nested groups with different ids don't confuse us,
  // but we match the end_group by id, not just by depth counter.
  let depth = 0;
  for (let i = startIndex + 1; i < layers.length; i++) {
    const e = layers[i];
    if (isFlatGroupHeader(e)) {
      depth++;
    } else if (isFlatEndGroup(e)) {
      if (depth === 0 && e.id === groupId) {
        // Found the matching end_group
        return {
          startIndex,
          endIndex: i,
          entries: layers.slice(startIndex, i + 1),
        };
      }
      depth--;
    }
  }

  // Malformed array — header without matching end_group
  return null;
}

/**
 * getParentGroup
 *
 * Returns the group header of the nearest enclosing group for the entry
 * identified by `layerId`, or null if the entry is at the top level.
 *
 * Algorithm: scan backwards from the entry's position tracking unclosed groups.
 *   - Encountering an end_group while scanning backwards means we are exiting
 *     a nested group (increment skip-depth counter).
 *   - Encountering a group header while scanning backwards with skip-depth > 0
 *     means the header belongs to the nested group we're skipping (decrement).
 *   - Encountering a group header while scanning backwards with skip-depth === 0
 *     means this is the immediately enclosing group → return it.
 */
export function getParentGroup(
  layers: FlatEntry[],
  layerId: string,
): FlatGroupHeader | null {
  const idx = layers.findIndex((e) => e.id === layerId);
  if (idx === -1) return null;

  let skipDepth = 0;
  for (let i = idx - 1; i >= 0; i--) {
    const e = layers[i];
    if (isFlatEndGroup(e)) {
      // We're passing over a complete nested group while scanning backwards
      skipDepth++;
    } else if (isFlatGroupHeader(e)) {
      if (skipDepth > 0) {
        // This header closes the nested group we were skipping over
        skipDepth--;
      } else {
        // This is the immediately enclosing group header
        return e;
      }
    }
  }

  return null; // top-level entry
}

/**
 * isInsideGroup
 *
 * Returns true if the entry identified by `layerId` is nested inside any group.
 * Equivalent to `getParentGroup(layers, layerId) !== null` but named for clarity.
 */
export function isInsideGroup(layers: FlatEntry[], layerId: string): boolean {
  return getParentGroup(layers, layerId) !== null;
}

/**
 * validateDropTarget
 *
 * Returns false if dropping the slice [dragStartIndex, dragEndIndex] at
 * `dropIndex` would be a no-op or would place a group inside itself.
 *
 * Rules:
 *   - dropIndex is the insertion point (before the entry at dropIndex).
 *   - If dropIndex is within the dragged slice (strictly between startIndex
 *     and endIndex+1 inclusive), the drop is invalid because it would nest
 *     the group inside itself or produce a no-op identity move.
 *   - For a single-entry drag (dragStartIndex === dragEndIndex) the only
 *     invalid drop is dropIndex === dragStartIndex (identity move) or
 *     dropIndex === dragStartIndex + 1 (inserts right after itself = no-op).
 *
 * @param layers        Current flat layer array (used to validate bounds).
 * @param dragStartIndex Inclusive start index of the dragged slice.
 * @param dragEndIndex   Inclusive end index of the dragged slice.
 * @param dropIndex      Target insertion index (0 … layers.length inclusive).
 * @returns true if the drop is structurally valid, false otherwise.
 */
export function validateDropTarget(
  layers: FlatEntry[],
  dragStartIndex: number,
  dragEndIndex: number,
  dropIndex: number,
): boolean {
  // Bounds guard
  if (
    dragStartIndex < 0 ||
    dragEndIndex < dragStartIndex ||
    dragEndIndex >= layers.length ||
    dropIndex < 0 ||
    dropIndex > layers.length
  ) {
    return false;
  }

  // A drop inside the dragged slice is always invalid:
  // insertion at any index from dragStartIndex to dragEndIndex+1 (inclusive)
  // would leave the array unchanged or create a self-nesting.
  if (dropIndex >= dragStartIndex && dropIndex <= dragEndIndex + 1) {
    return false;
  }

  return true;
}

// ── Depth utilities ───────────────────────────────────────────────────────────

/**
 * getDepth
 *
 * Returns the visual nesting depth of the entry at `index`.
 *
 * Depth rules:
 *   - Top-level entries have depth 0.
 *   - Each unclosed group header encountered while walking from 0 → index-1
 *     adds 1 to the running depth counter.
 *   - Each end_group encountered reduces the counter by 1.
 *   - Group HEADERS render at the same depth as their siblings (depth of their
 *     parent group's contents), so no adjustment is needed for a header itself.
 *   - END_GROUP markers render at the same depth as their group header, which
 *     is one level above the group's contents.  Because the counter is already
 *     at "content depth" after processing the header, we subtract 1 for end_group
 *     entries.
 */
export function getDepth(layers: FlatEntry[], index: number): number {
  if (index < 0 || index >= layers.length) return 0;

  let depth = 0;
  for (let i = 0; i < index; i++) {
    const e = layers[i];
    if (isFlatGroupHeader(e)) {
      depth++;
    } else if (isFlatEndGroup(e)) {
      depth--;
    }
  }

  // end_group renders at its group header's depth, which is one above the
  // content depth tracked by the loop above.
  if (isFlatEndGroup(layers[index])) {
    depth--;
  }

  return Math.max(0, depth);
}

/**
 * computeNestingDepths
 *
 * Returns an array of visual nesting depths, one per entry, computed in a
 * single O(n) pass.  Prefer this over calling getDepth() repeatedly.
 *
 * Uses the same semantics as getDepth():
 *   - Regular layers and group headers at the top level → depth 0.
 *   - end_group entries render at the same depth as their header.
 */
export function computeNestingDepths(layers: FlatEntry[]): number[] {
  const depths: number[] = new Array(layers.length).fill(0);
  let runningDepth = 0;

  for (let i = 0; i < layers.length; i++) {
    const e = layers[i];

    if (isFlatEndGroup(e)) {
      // end_group renders at the parent-group depth (one above content depth)
      runningDepth--;
      depths[i] = Math.max(0, runningDepth);
      // Note: runningDepth is already decremented; subsequent entries are at the lower depth.
    } else if (isFlatGroupHeader(e)) {
      // Header renders at the current (parent) depth, then content is deeper
      depths[i] = Math.max(0, runningDepth);
      runningDepth++;
    } else {
      // Regular layer — depth is whatever the running counter says
      depths[i] = Math.max(0, runningDepth);
    }
  }

  return depths;
}

// ── Selection helpers ─────────────────────────────────────────────────────────

/**
 * getEffectivelySelectedLayers
 *
 * Given the flat layers array and a set of selected layer IDs, returns all
 * paintable layers that are "effectively" selected.
 *
 * - If a group header is selected, all paintable layers between it and its
 *   matching end_group (exclusive) are included.
 * - If a leaf layer is selected, it is included as-is.
 * - end_group entries are never included in the result.
 * - Deduplicates: a layer that is both directly selected and inside a selected
 *   group appears only once.
 *
 * This is the flat-array equivalent of the legacy tree `getEffectivelySelectedLayers`.
 */
export function getEffectivelySelectedLayers(
  layers: FlatEntry[],
  selectedIds: Set<string>,
): FlatLayer[] {
  const result: FlatLayer[] = [];
  const seen = new Set<string>();

  let i = 0;
  while (i < layers.length) {
    const entry = layers[i];

    if (isFlatGroupHeader(entry) && selectedIds.has(entry.id)) {
      // Collect all paintable layers inside this group (until matching end_group)
      let depth = 0;
      i++;
      while (i < layers.length) {
        const inner = layers[i];
        if (isFlatGroupHeader(inner)) {
          depth++;
        } else if (isFlatEndGroup(inner)) {
          if (depth === 0 && inner.id === entry.id) {
            // End of this group — stop collecting
            break;
          }
          depth--;
        } else if (isFlatLayer(inner) && !seen.has(inner.id)) {
          seen.add(inner.id);
          result.push(inner);
        }
        i++;
      }
      // Advance past the end_group we stopped on
    } else if (isFlatLayer(entry) && selectedIds.has(entry.id)) {
      if (!seen.has(entry.id)) {
        seen.add(entry.id);
        result.push(entry);
      }
    }
    i++;
  }

  return result;
}

/**
 * flattenLayersForOps
 *
 * Returns all layers in the flat array that are NOT group headers and NOT
 * end_group entries — i.e., only the actual paintable/content layers.
 *
 * This is the flat-array equivalent of the legacy tree `flattenTree()`.
 */
export function flattenLayersForOps(layers: FlatEntry[]): FlatLayer[] {
  return layers.filter(isFlatLayer);
}

// ── Convenience: create a matched header+end_group pair ───────────────────────

/**
 * createGroupPair
 *
 * Convenience factory that returns a matched [header, end_group] tuple for
 * insertion into the flat array.  Both share the same generated id.
 */
export function createGroupPair(name: string): [FlatGroupHeader, FlatEndGroup] {
  const id = generateGroupId();
  const header: FlatGroupHeader = {
    type: "group",
    id,
    name,
    visible: true,
    opacity: 1,
    collapsed: false,
  };
  const endMarker: FlatEndGroup = {
    type: "end_group",
    id,
  };
  return [header, endMarker];
}
