/**
 * layerTree.ts — Pure utility functions for operating on the LayerNode tree.
 *
 * All functions are immutable: they never mutate their input arrays/objects and
 * always return new arrays/objects when a change is needed.
 *
 * Tree invariants:
 *  - flattenTree returns items in compositing order (top-to-bottom visual order)
 *  - index 0 in any children array = topmost visually
 */

import type { Layer } from "../components/LayersPanel";
import type { LayerGroup, LayerItem, LayerNode } from "../types";

// ── Internal helpers ──────────────────────────────────────────────────────────

let _groupIdCounter = 0;

/** Generate a unique group id */
export function generateGroupId(): string {
  _groupIdCounter++;
  return `group_${Date.now()}_${_groupIdCounter}`;
}

// ── Traversal ─────────────────────────────────────────────────────────────────

/**
 * Flatten the tree to a list of all LayerItems (for rendering/compositing),
 * ordered top-to-bottom (same as visual layer stacking order).
 */
export function flattenTree(nodes: LayerNode[]): LayerItem[] {
  const result: LayerItem[] = [];
  for (const node of nodes) {
    if (node.kind === "layer") {
      result.push(node);
    } else {
      // Recurse into group children (guard against undefined children from stale data)
      result.push(...flattenTree(node.children ?? []));
    }
  }
  return result;
}

/**
 * Convert LayerNode[] back to flat Layer[] (for backward compatibility
 * where only Layer[] is needed).
 */
export function treeToFlatLayers(nodes: LayerNode[]): Layer[] {
  return flattenTree(nodes).map((item) => item.layer);
}

/**
 * Convert a flat Layer[] to a LayerNode[] (migration helper).
 * Each Layer becomes a LayerItem at the root level.
 */
export function flatLayersToTree(layers: Layer[]): LayerNode[] {
  return layers.map((layer) => ({
    kind: "layer" as const,
    id: layer.id,
    layer,
  }));
}

/**
 * Get the topmost LayerItem (visually topmost = first in flat render order).
 */
export function getTopmostLayer(nodes: LayerNode[]): LayerItem | null {
  const flat = flattenTree(nodes);
  return flat[0] ?? null;
}

// ── Node Location ─────────────────────────────────────────────────────────────

export type NodeLocation = {
  node: LayerNode;
  /** The array that directly contains this node (root array or group.children) */
  parent: LayerNode[];
  /** Index within parent */
  index: number;
  /** The group that owns this node, or null if at root */
  parentGroup: LayerGroup | null;
};

/**
 * Find a node by id anywhere in the tree.
 * Returns {node, parent, index, parentGroup} or null if not found.
 */
export function findNode(
  nodes: LayerNode[],
  id: string,
  _parentGroup: LayerGroup | null = null,
): NodeLocation | null {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (node.id === id) {
      return { node, parent: nodes, index: i, parentGroup: _parentGroup };
    }
    if (node.kind === "group") {
      const found = findNode(node.children ?? [], id, node);
      if (found) return found;
    }
  }
  return null;
}

// ── Effective Properties ──────────────────────────────────────────────────────

/**
 * Get all ancestor LayerGroup ids for a given node id (from root → immediate parent).
 */
export function getAncestorGroupIds(nodes: LayerNode[], id: string): string[] {
  function recurse(
    current: LayerNode[],
    target: string,
    path: string[],
  ): string[] | null {
    for (const node of current) {
      if (node.id === target) return path;
      if (node.kind === "group") {
        const found = recurse(node.children ?? [], target, [...path, node.id]);
        if (found) return found;
      }
    }
    return null;
  }
  return recurse(nodes, id, []) ?? [];
}

/**
 * Get the effective opacity for a layer given its position in the tree.
 * Multiplies all ancestor group opacities with the layer's own opacity.
 */
export function getEffectiveOpacity(
  nodes: LayerNode[],
  layerId: string,
): number {
  const loc = findNode(nodes, layerId);
  if (!loc) return 1;
  const node = loc.node;
  const layerOpacity =
    node.kind === "layer" ? node.layer.opacity : (node as LayerGroup).opacity;

  const ancestorIds = getAncestorGroupIds(nodes, layerId);
  let multiplier = 1;
  for (const gid of ancestorIds) {
    const gLoc = findNode(nodes, gid);
    if (gLoc?.node.kind === "group") {
      multiplier *= (gLoc.node as LayerGroup).opacity;
    }
  }
  return layerOpacity * multiplier;
}

/**
 * Get the effective visibility for a layer.
 * Returns false if the layer itself OR any ancestor group has visible=false.
 */
export function getEffectiveVisibility(
  nodes: LayerNode[],
  layerId: string,
): boolean {
  const loc = findNode(nodes, layerId);
  if (!loc) return false;
  const node = loc.node;
  const selfVisible =
    node.kind === "layer" ? node.layer.visible : (node as LayerGroup).visible;
  if (!selfVisible) return false;

  const ancestorIds = getAncestorGroupIds(nodes, layerId);
  for (const gid of ancestorIds) {
    const gLoc = findNode(nodes, gid);
    if (gLoc?.node.kind === "group" && !(gLoc.node as LayerGroup).visible) {
      return false;
    }
  }
  return true;
}

// ── Descendants ───────────────────────────────────────────────────────────────

/**
 * Get all LayerItem ids that are descendants of a group (recursively).
 */
export function getDescendantLayerIds(group: LayerGroup): string[] {
  const ids: string[] = [];
  function recurse(nodes: LayerNode[]) {
    for (const node of nodes) {
      if (node.kind === "layer") {
        ids.push(node.layer.id);
      } else {
        recurse(node.children ?? []);
      }
    }
  }
  recurse(group.children ?? []);
  return ids;
}

/**
 * Get all LayerItems that are "effectively selected" given a set of selected node IDs.
 * If a group id is in selectedIds, include ALL its descendant LayerItems.
 */
export function getEffectivelySelectedLayers(
  nodes: LayerNode[],
  selectedIds: Set<string>,
): LayerItem[] {
  const result: LayerItem[] = [];
  const seen = new Set<string>();

  function collect(node: LayerNode) {
    if (node.kind === "layer") {
      if (!seen.has(node.layer.id)) {
        seen.add(node.layer.id);
        result.push(node);
      }
    } else {
      // Recurse into group children
      for (const child of node.children ?? []) {
        collect(child);
      }
    }
  }

  // Walk the full tree in order; collect any node (or group's descendants) that is selected
  function walk(nodeList: LayerNode[]) {
    for (const node of nodeList) {
      if (selectedIds.has(node.id)) {
        collect(node);
      } else if (node.kind === "group") {
        walk(node.children ?? []);
      }
    }
  }

  walk(nodes);
  return result;
}

// ── Immutable Tree Mutations ──────────────────────────────────────────────────

/**
 * Remove a node from the tree by id.
 * Returns a new tree (immutable).
 */
export function removeNode(nodes: LayerNode[], id: string): LayerNode[] {
  const result: LayerNode[] = [];
  for (const node of nodes) {
    if (node.id === id) continue; // skip the removed node
    if (node.kind === "group") {
      result.push({ ...node, children: removeNode(node.children ?? [], id) });
    } else {
      result.push(node);
    }
  }
  return result;
}

/**
 * Insert a node at a position relative to targetId.
 * - 'before': insert immediately before targetId in its parent
 * - 'after': insert immediately after targetId in its parent
 * - 'inside': insert as the first child of targetId (targetId must be a group)
 *
 * Returns a new tree (immutable).
 */
export function insertNode(
  nodes: LayerNode[],
  node: LayerNode,
  targetId: string,
  position: "before" | "after" | "inside",
): LayerNode[] {
  if (position === "inside") {
    // Insert as first child of the target group
    return nodes.map((n) => {
      if (n.id === targetId && n.kind === "group") {
        return { ...n, children: [node, ...(n.children ?? [])] };
      }
      if (n.kind === "group") {
        return {
          ...n,
          children: insertNode(n.children ?? [], node, targetId, position),
        };
      }
      return n;
    });
  }

  // before / after: linear insertion in parent array
  const result: LayerNode[] = [];
  let inserted = false;
  for (const n of nodes) {
    if (n.id === targetId) {
      if (position === "before") {
        result.push(node);
        inserted = true;
      }
      result.push(n);
      if (position === "after") {
        result.push(node);
        inserted = true;
      }
    } else if (n.kind === "group") {
      result.push({
        ...n,
        children: insertNode(n.children ?? [], node, targetId, position),
      });
    } else {
      result.push(n);
    }
  }
  if (!inserted) {
    // targetId not found at this level; append at end as fallback
    result.push(node);
  }
  return result;
}

/**
 * Move a node from its current position to a new position relative to targetId.
 * Returns a new tree (immutable).
 */
export function moveNode(
  nodes: LayerNode[],
  nodeId: string,
  targetId: string,
  position: "before" | "after" | "inside",
): LayerNode[] {
  const loc = findNode(nodes, nodeId);
  if (!loc) return nodes;
  const movingNode = loc.node;
  // Remove it, then insert at new position
  const withoutNode = removeNode(nodes, nodeId);
  return insertNode(withoutNode, movingNode, targetId, position);
}

// ── Group / Ungroup ───────────────────────────────────────────────────────────

/**
 * Create a group from a set of selected layer/group ids.
 * The group is inserted where the topmost selected node was (in tree order).
 * Selected nodes are removed from their original positions and placed inside the group.
 *
 * Returns { tree: new LayerNode[], groupId: string }.
 */
export function groupNodes(
  nodes: LayerNode[],
  selectedIds: string[],
  groupName: string,
): { tree: LayerNode[]; groupId: string } {
  if (selectedIds.length === 0) {
    const groupId = generateGroupId();
    const newGroup: LayerGroup = {
      kind: "group",
      id: groupId,
      name: groupName,
      visible: true,
      opacity: 1,
      collapsed: false,
      children: [],
    };
    return { tree: [newGroup, ...nodes], groupId };
  }

  // Collect all selected nodes (in tree traversal order = visual order)
  const selected: LayerNode[] = [];
  const selectedSet = new Set(selectedIds);

  function collectSelected(nodeList: LayerNode[]) {
    for (const node of nodeList) {
      if (selectedSet.has(node.id)) {
        selected.push(node);
      } else if (node.kind === "group") {
        collectSelected(node.children ?? []);
      }
    }
  }
  collectSelected(nodes);

  if (selected.length === 0) {
    const groupId = generateGroupId();
    return { tree: nodes, groupId };
  }

  // Record where the topmost selected node lives BEFORE removal
  const topmostId = selected[0].id;
  const topmostLoc = findNode(nodes, topmostId);

  const groupId = generateGroupId();
  const newGroup: LayerGroup = {
    kind: "group",
    id: groupId,
    name: groupName,
    visible: true,
    opacity: 1,
    collapsed: false,
    children: selected,
  };

  // Remove all selected nodes from the tree
  let tree = nodes;
  for (const node of selected) {
    tree = removeNode(tree, node.id);
  }

  // Insert the group at the recorded position of topmostId using immutable helpers.
  if (topmostLoc) {
    if (topmostLoc.parentGroup) {
      // Nested insertion: insert as sibling before the first selected node inside
      // the parent group. Use insertNode with "before" to keep it immutable.
      tree = insertNode(tree, newGroup, topmostId, "before");
    } else {
      // Root-level insertion: build a new root array with the group at the right index.
      const insertAt = Math.min(topmostLoc.index, tree.length);
      tree = [...tree.slice(0, insertAt), newGroup, ...tree.slice(insertAt)];
    }
  } else {
    // Fallback: prepend to root
    tree = [newGroup, ...tree];
  }

  return { tree, groupId };
}

/**
 * Ungroup a group: removes the group, inserts its children in its place.
 * Returns a new tree (immutable).
 */
export function ungroupNodes(nodes: LayerNode[], groupId: string): LayerNode[] {
  const loc = findNode(nodes, groupId);
  if (!loc || loc.node.kind !== "group") return nodes;
  const group = loc.node as LayerGroup;

  // Insert children before the group, then remove the group
  let tree = nodes;
  const children = group.children ?? [];
  // Insert each child before the group in reverse order to preserve original order
  for (let i = children.length - 1; i >= 0; i--) {
    tree = insertNode(tree, children[i], groupId, "before");
  }
  tree = removeNode(tree, groupId);
  return tree;
}

// ── handleReorderTree helper ──────────────────────────────────────────────────

/**
 * Replace the entire tree (used by drag-and-drop reordering).
 * Returns the new tree as-is (pure pass-through for type consistency).
 */
export function replaceTree(newTree: LayerNode[]): LayerNode[] {
  return newTree;
}
