/**
 * layerTree.ts — DELETED
 *
 * All types (LayerItem, LayerGroup, LayerNode) have been moved to types.ts.
 * All tree-traversal functions have been replaced by groupUtils.ts.
 * This file is kept as an empty stub so the build system does not error on
 * any lingering reference in .bak / .old_clean / .current_broken files.
 *
 * DO NOT import from this file in new or active code.
 */

// Re-export the legacy types from their new home so any stale import that
// slipped through the migration still resolves without a build error.
export type { LayerGroup, LayerItem, LayerNode } from "../types";
