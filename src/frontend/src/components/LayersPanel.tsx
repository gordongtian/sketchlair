import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { BLEND_MODES } from "@/utils/constants";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Eraser,
  Eye,
  EyeOff,
  FolderClosed,
  FolderOpen,
  FolderPlus,
  GripVertical,
  Lock,
  Plus,
  Ruler,
  Scissors,
  Trash2,
  X,
} from "lucide-react";
import React, { memo, useRef, useState } from "react";
import type { LayerGroup, LayerNode, RulerFields } from "../types";
import { findNode, flattenTree, moveNode } from "../utils/layerTree";

export interface Layer extends RulerFields {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  blendMode: string;
  isClippingMask: boolean;
  alphaLock: boolean;
}

// ── Drag state ────────────────────────────────────────────────────────────────

type DropPosition = "before" | "after" | "inside";

interface DragState {
  nodeId: string;
  nodeKind: "layer" | "group";
}

interface DropTarget {
  targetId: string;
  position: DropPosition;
}

// ── LayerRow ──────────────────────────────────────────────────────────────────

interface LayerRowProps {
  layer: Layer;
  isActive: boolean;
  isSelected: boolean;
  depth: number;
  thumbnail: string | undefined;
  dragOverTarget: DropTarget | null;
  renamingId: string | null;
  renameVal: string;
  totalNonRulerLayers: number;
  onSetActive: (id: string) => void;
  onToggleVisible: (id: string) => void;
  onSetOpacity: (id: string, opacity: number) => void;
  onSetBlendMode: (id: string, blendMode: string) => void;
  onDeleteLayer: (id: string) => void;
  onCtrlClickLayer: (id: string) => void;
  onToggleRulerActive: (id: string) => void;
  onDragStart: (id: string, kind: "layer") => void;
  onDragOver: (e: React.DragEvent, id: string, kind: "layer" | "group") => void;
  onDrop: (e: React.DragEvent, id: string, kind: "layer" | "group") => void;
  onStartRename: (id: string, name: string) => void;
  onCommitRename: (id: string) => void;
  onSetRenamingId: (id: string | null) => void;
  onSetRenameVal: (v: string) => void;
  onToggleSelection: (id: string, shiftHeld: boolean) => void;
}

const LayerRow = memo(function LayerRow({
  layer,
  isActive,
  isSelected,
  depth,
  thumbnail,
  dragOverTarget,
  renamingId,
  renameVal,
  totalNonRulerLayers,
  onSetActive,
  onToggleVisible,
  onSetOpacity,
  onSetBlendMode,
  onDeleteLayer,
  onCtrlClickLayer,
  onToggleRulerActive,
  onDragStart,
  onDragOver,
  onDrop,
  onStartRename,
  onCommitRename,
  onSetRenamingId,
  onSetRenameVal,
  onToggleSelection,
}: LayerRowProps) {
  const isRenaming = renamingId === layer.id;

  const isDragTarget =
    dragOverTarget?.targetId === layer.id &&
    (dragOverTarget.position === "before" ||
      dragOverTarget.position === "after");

  const depthPad = depth * 16;
  const extraClipPad = layer.isClippingMask ? 16 : 0;
  const leftPad = depthPad + extraClipPad + 8; // 8px base

  let bg = "bg-[oklch(var(--sidebar-item))] hover:brightness-95";
  if (isActive) bg = "bg-[oklch(var(--accent)/0.25)]";
  else if (isSelected) bg = "bg-[oklch(var(--accent)/0.15)]";

  return (
    <div
      onDragOver={(e) => onDragOver(e, layer.id, "layer")}
      onDrop={(e) => onDrop(e, layer.id, "layer")}
      className={`flex items-center gap-1.5 py-1.5 cursor-pointer border-b border-border/40 ${bg} ${
        isDragTarget && dragOverTarget?.position === "before"
          ? "border-t-2 border-primary"
          : ""
      } ${
        isDragTarget && dragOverTarget?.position === "after"
          ? "border-b-2 border-primary"
          : ""
      }`}
      style={{ paddingLeft: leftPad, paddingRight: 8 }}
      onClick={(e) => {
        if (e.shiftKey) {
          onToggleSelection(layer.id, true);
        } else {
          onToggleSelection(layer.id, false);
          onSetActive(layer.id);
        }
      }}
      onKeyDown={(e) => e.key === "Enter" && onSetActive(layer.id)}
      onContextMenu={(e) => {
        e.preventDefault();
        onCtrlClickLayer(layer.id);
      }}
    >
      <span
        draggable
        onDragStart={(e) => {
          e.stopPropagation();
          onDragStart(layer.id, "layer");
        }}
        className="shrink-0 cursor-grab active:cursor-grabbing flex items-center"
      >
        <GripVertical size={10} className="text-muted-foreground" />
      </span>

      {/* Thumbnail */}
      {layer.isRuler ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleRulerActive(layer.id);
          }}
          className={`w-8 h-8 rounded shrink-0 flex items-center justify-center border border-border text-xs font-bold transition-colors ${
            layer.rulerActive
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground hover:bg-muted/80"
          }`}
          data-ocid="layers.ruler_toggle_thumb"
        >
          {layer.rulerActive ? "ON" : "OFF"}
        </button>
      ) : thumbnail ? (
        <img
          src={thumbnail}
          alt=""
          className="w-8 h-8 rounded shrink-0 border border-border object-cover"
          style={{ imageRendering: "pixelated" }}
        />
      ) : (
        <div className="w-8 h-8 rounded shrink-0 bg-white border border-border" />
      )}

      <div className="flex flex-col flex-1 min-w-0">
        {isRenaming ? (
          <input
            // biome-ignore lint/a11y/noAutofocus: rename UX requires autofocus
            autoFocus
            value={renameVal}
            onChange={(e) => onSetRenameVal(e.target.value)}
            onBlur={() => onCommitRename(layer.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onCommitRename(layer.id);
              if (e.key === "Escape") onSetRenamingId(null);
            }}
            onClick={(e) => e.stopPropagation()}
            className="text-xs bg-transparent border-b border-primary text-foreground focus:outline-none w-full"
            data-ocid="layers.rename_input"
          />
        ) : (
          <div className="flex items-center gap-1 min-w-0">
            {layer.isRuler ? (
              <Ruler size={10} className="text-muted-foreground shrink-0" />
            ) : null}
            <span
              className="text-xs truncate text-foreground flex-1"
              onDoubleClick={(e) => {
                e.stopPropagation();
                onStartRename(layer.id, layer.name);
              }}
            >
              {layer.name}
            </span>
          </div>
        )}
        {!layer.isRuler && (
          <div className="flex items-center gap-1 mt-0.5">
            <select
              value={layer.blendMode}
              onChange={(e) => {
                e.stopPropagation();
                onSetBlendMode(layer.id, e.target.value);
              }}
              onMouseDown={(e) => e.stopPropagation()}
              className="text-[9px] bg-transparent text-muted-foreground border-none focus:outline-none cursor-pointer flex-1 min-w-0 truncate"
              data-ocid="layers.blend_select"
            >
              {BLEND_MODES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
        )}
        {layer.isRuler && (
          <div className="flex items-center gap-1 mt-0.5">
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={layer.opacity}
              onChange={(e) => {
                e.stopPropagation();
                onSetOpacity(layer.id, Number(e.target.value));
              }}
              onClick={(e) => e.stopPropagation()}
              style={
                {
                  "--fill-pct": `${layer.opacity * 100}%`,
                } as React.CSSProperties
              }
              className="flex-1"
              data-ocid="layers.ruler_opacity_slider"
            />
          </div>
        )}
        {!layer.isRuler && (
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={layer.opacity}
            onChange={(e) => {
              e.stopPropagation();
              onSetOpacity(layer.id, Number(e.target.value));
            }}
            onClick={(e) => e.stopPropagation()}
            style={
              { "--fill-pct": `${layer.opacity * 100}%` } as React.CSSProperties
            }
            className="w-full mt-0.5"
            data-ocid="layers.opacity_slider"
          />
        )}
      </div>

      <div className="flex flex-col items-center gap-0.5 shrink-0">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleVisible(layer.id);
          }}
          className="p-0.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
          data-ocid="layers.visibility_button"
        >
          {layer.visible ? <Eye size={10} /> : <EyeOff size={10} />}
        </button>
        {!layer.isRuler && totalNonRulerLayers > 1 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDeleteLayer(layer.id);
            }}
            className="p-0.5 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive"
            data-ocid="layers.delete_button"
          >
            <Trash2 size={10} />
          </button>
        )}
        {layer.isRuler && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDeleteLayer(layer.id);
            }}
            className="p-0.5 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive"
            data-ocid="layers.ruler_delete_button"
          >
            <Trash2 size={10} />
          </button>
        )}
      </div>
    </div>
  );
});

// ── GroupRow ──────────────────────────────────────────────────────────────────

interface GroupRowProps {
  node: LayerGroup;
  depth: number;
  isSelected: boolean;
  dragOverTarget: DropTarget | null;
  renamingId: string | null;
  renameVal: string;
  onToggleCollapse: (id: string) => void;
  onToggleVisible: (id: string) => void;
  onSetOpacity: (id: string, opacity: number) => void;
  onDeleteGroup: (id: string) => void;
  onDragStart: (id: string, kind: "group") => void;
  onDragOver: (e: React.DragEvent, id: string, kind: "layer" | "group") => void;
  onDrop: (e: React.DragEvent, id: string, kind: "layer" | "group") => void;
  onStartRename: (id: string, name: string) => void;
  onCommitRename: (id: string) => void;
  onSetRenamingId: (id: string | null) => void;
  onSetRenameVal: (v: string) => void;
  onToggleSelection: (id: string, shiftHeld: boolean) => void;
}

const GroupRow = memo(function GroupRow({
  node,
  depth,
  isSelected,
  dragOverTarget,
  renamingId,
  renameVal,
  onToggleCollapse,
  onToggleVisible,
  onSetOpacity,
  onDeleteGroup,
  onDragStart,
  onDragOver,
  onDrop,
  onStartRename,
  onCommitRename,
  onSetRenamingId,
  onSetRenameVal,
  onToggleSelection,
}: GroupRowProps) {
  const isRenaming = renamingId === node.id;

  const isDragTarget = dragOverTarget?.targetId === node.id;
  const isDropInside = isDragTarget && dragOverTarget?.position === "inside";
  const isDropBefore = isDragTarget && dragOverTarget?.position === "before";
  const isDropAfter = isDragTarget && dragOverTarget?.position === "after";

  const leftPad = depth * 16 + 8;

  const bg = isSelected
    ? "bg-[oklch(var(--accent)/0.2)]"
    : isDropInside
      ? "bg-[oklch(var(--accent)/0.12)]"
      : "bg-[oklch(var(--sidebar-item)/0.6)] hover:brightness-95";

  return (
    <div
      onDragOver={(e) => onDragOver(e, node.id, "group")}
      onDrop={(e) => onDrop(e, node.id, "group")}
      className={`flex items-center gap-1.5 py-1.5 cursor-pointer border-b border-border/40 ${bg} ${
        isDropBefore ? "border-t-2 border-primary" : ""
      } ${isDropAfter ? "border-b-2 border-primary" : ""} ${
        isDropInside ? "ring-1 ring-inset ring-primary/40" : ""
      }`}
      style={{ paddingLeft: leftPad, paddingRight: 8 }}
      onClick={(e) => {
        if (e.shiftKey) {
          onToggleSelection(node.id, true);
        } else {
          onToggleSelection(node.id, false);
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          onToggleSelection(node.id, e.shiftKey);
        }
      }}
      data-ocid="layers.group_row"
    >
      {/* Drag handle */}
      <span
        draggable
        onDragStart={(e) => {
          e.stopPropagation();
          onDragStart(node.id, "group");
        }}
        className="shrink-0 cursor-grab active:cursor-grabbing flex items-center"
      >
        <GripVertical size={10} className="text-muted-foreground" />
      </span>

      {/* Collapse toggle */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggleCollapse(node.id);
        }}
        className="p-0.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground shrink-0"
        data-ocid="layers.group_collapse"
      >
        {node.collapsed ? (
          <ChevronRight size={10} />
        ) : (
          <ChevronDown size={10} />
        )}
      </button>

      {/* Folder icon */}
      <span className="shrink-0 text-muted-foreground">
        {node.collapsed ? <FolderClosed size={12} /> : <FolderOpen size={12} />}
      </span>

      {/* Name */}
      <div className="flex flex-col flex-1 min-w-0">
        {isRenaming ? (
          <input
            // biome-ignore lint/a11y/noAutofocus: rename UX requires autofocus
            autoFocus
            value={renameVal}
            onChange={(e) => onSetRenameVal(e.target.value)}
            onBlur={() => onCommitRename(node.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onCommitRename(node.id);
              if (e.key === "Escape") onSetRenamingId(null);
            }}
            onClick={(e) => e.stopPropagation()}
            className="text-xs bg-transparent border-b border-primary text-foreground focus:outline-none w-full"
            data-ocid="layers.group_rename_input"
          />
        ) : (
          <span
            className="text-xs font-medium truncate text-foreground"
            onDoubleClick={(e) => {
              e.stopPropagation();
              onStartRename(node.id, node.name);
            }}
          >
            {node.name}
          </span>
        )}
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={node.opacity}
          onChange={(e) => {
            e.stopPropagation();
            onSetOpacity(node.id, Number(e.target.value));
          }}
          onClick={(e) => e.stopPropagation()}
          style={
            { "--fill-pct": `${node.opacity * 100}%` } as React.CSSProperties
          }
          className="w-full mt-0.5"
          data-ocid="layers.group_opacity_slider"
        />
      </div>

      {/* Controls */}
      <div className="flex flex-col items-center gap-0.5 shrink-0">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleVisible(node.id);
          }}
          className="p-0.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
          data-ocid="layers.group_visibility"
        >
          {node.visible ? <Eye size={10} /> : <EyeOff size={10} />}
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDeleteGroup(node.id);
          }}
          className="p-0.5 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive"
          data-ocid="layers.group_delete"
        >
          <Trash2 size={10} />
        </button>
      </div>
    </div>
  );
});

// ── LayersPanel ───────────────────────────────────────────────────────────────

interface LayersPanelProps {
  layers: Layer[];
  layerTree: LayerNode[];
  activeLayerId: string;
  selectedLayerIds: Set<string>;
  onSetActive: (id: string) => void;
  onToggleVisible: (id: string) => void;
  onSetOpacity: (id: string, opacity: number) => void;
  onSetBlendMode: (id: string, blendMode: string) => void;
  onAddLayer: () => void;
  onDeleteLayer: (id: string) => void;
  onReorderLayers: (ids: string[]) => void;
  onClearLayer: () => void;
  onToggleClippingMask: (id: string) => void;
  onMergeLayers: () => void;
  onCtrlClickLayer: (id: string) => void;
  onRenameLayer: (id: string, newName: string) => void;
  onToggleAlphaLock: (id: string) => void;
  thumbnails: Record<string, string>;
  onToggleRulerActive: (id: string) => void;
  onToggleGroupCollapse: (groupId: string) => void;
  onRenameGroup: (groupId: string, name: string) => void;
  onSetGroupOpacity: (groupId: string, opacity: number) => void;
  onToggleGroupVisible: (groupId: string) => void;
  onDeleteGroup: (groupId: string) => void;
  onReorderTree: (newTree: LayerNode[]) => void;
  onToggleLayerSelection: (id: string, shiftHeld: boolean) => void;
  onCreateGroup: () => void;
  /** Optional close handler — renders an X button inline in the header when provided */
  onClose?: () => void;
}

// ── Tree drag-and-drop helpers ────────────────────────────────────────────────

function computeDropTarget(
  _tree: LayerNode[],
  dragId: string,
  targetId: string,
  targetKind: "layer" | "group",
): DropTarget | null {
  if (dragId === targetId) return null;
  // Dropping onto a group: place inside
  if (targetKind === "group") {
    return { targetId, position: "inside" };
  }
  // Dropping onto a layer: place before
  return { targetId, position: "before" };
}

export const LayersPanel = memo(function LayersPanel({
  layers,
  layerTree,
  activeLayerId,
  selectedLayerIds,
  onSetActive,
  onToggleVisible,
  onSetOpacity,
  onSetBlendMode,
  onAddLayer,
  onDeleteLayer,
  onReorderLayers,
  onClearLayer,
  onToggleClippingMask,
  onMergeLayers,
  onCtrlClickLayer,
  onRenameLayer,
  onToggleAlphaLock,
  thumbnails,
  onToggleRulerActive,
  onToggleGroupCollapse,
  onRenameGroup,
  onSetGroupOpacity,
  onToggleGroupVisible,
  onDeleteGroup,
  onReorderTree,
  onToggleLayerSelection,
  onCreateGroup,
  onClose,
}: LayersPanelProps) {
  const dragState = useRef<DragState | null>(null);
  const [dragOverTarget, setDragOverTarget] = useState<DropTarget | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState("");

  // ── Drag handlers ────────────────────────────────────────────────────────

  const handleDragStart = (id: string, kind: "layer" | "group") => {
    dragState.current = { nodeId: id, nodeKind: kind };
  };

  const handleDragOver = (
    e: React.DragEvent,
    targetId: string,
    targetKind: "layer" | "group",
  ) => {
    e.preventDefault();
    const fromId = dragState.current?.nodeId;
    if (!fromId || fromId === targetId) return;
    const target = computeDropTarget(layerTree, fromId, targetId, targetKind);
    setDragOverTarget(target);
  };

  const handleDrop = (
    e: React.DragEvent,
    targetId: string,
    targetKind: "layer" | "group",
  ) => {
    e.preventDefault();
    const fromId = dragState.current?.nodeId;
    setDragOverTarget(null);
    dragState.current = null;

    if (!fromId || fromId === targetId) return;

    const target = computeDropTarget(layerTree, fromId, targetId, targetKind);
    if (!target) return;

    // For flat-layer reordering (both are root-level layers), use the legacy
    // onReorderLayers path so the existing compositing code isn't disrupted.
    const fromLoc = findNode(layerTree, fromId);
    const toLoc = findNode(layerTree, targetId);
    if (
      fromLoc &&
      toLoc &&
      fromLoc.parentGroup === null &&
      toLoc.parentGroup === null &&
      fromLoc.node.kind === "layer" &&
      toLoc.node.kind === "layer"
    ) {
      const ids = layers.map((l) => l.id);
      const fromIdx = ids.indexOf(fromId);
      const toIdx = ids.indexOf(targetId);
      if (fromIdx !== -1 && toIdx !== -1) {
        const newIds = [...ids];
        newIds.splice(fromIdx, 1);
        newIds.splice(toIdx, 0, fromId);
        onReorderLayers(newIds);
        return;
      }
    }

    // General tree reorder
    const newTree = moveNode(layerTree, fromId, targetId, target.position);
    onReorderTree(newTree);
  };

  // ── Rename handlers ──────────────────────────────────────────────────────

  const startRename = (id: string, name: string) => {
    setRenamingId(id);
    setRenameVal(name);
  };

  const commitRename = (id: string) => {
    if (!renameVal.trim()) {
      setRenamingId(null);
      return;
    }
    // Check whether this is a group or a layer
    const loc = findNode(layerTree, id);
    if (loc?.node.kind === "group") {
      onRenameGroup(id, renameVal.trim());
    } else {
      onRenameLayer(id, renameVal.trim());
    }
    setRenamingId(null);
  };

  // ── Derived data ─────────────────────────────────────────────────────────

  const activeLayer = layers.find((l) => l.id === activeLayerId);
  const totalNonRulerLayers = flattenTree(layerTree ?? []).filter(
    (item) => item?.layer && !item.layer.isRuler,
  ).length;

  // ── Recursive render ─────────────────────────────────────────────────────

  function renderNodes(nodes: LayerNode[], depth: number): React.ReactNode {
    // Guard: nodes may be undefined/non-array when layerTree state and history
    // are temporarily desynced (e.g. after an undo that touches the tree).
    if (!nodes || !Array.isArray(nodes)) return null;
    return nodes.map((node) => {
      // Guard: skip null/undefined nodes that may arrive from stale or migrated data
      if (!node) return null;

      if (node.kind === "group") {
        return (
          <React.Fragment key={node.id}>
            <GroupRow
              node={node}
              depth={depth}
              isSelected={selectedLayerIds.has(node.id)}
              dragOverTarget={dragOverTarget}
              renamingId={renamingId}
              renameVal={renameVal}
              onToggleCollapse={onToggleGroupCollapse}
              onToggleVisible={onToggleGroupVisible}
              onSetOpacity={onSetGroupOpacity}
              onDeleteGroup={onDeleteGroup}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onStartRename={startRename}
              onCommitRename={commitRename}
              onSetRenamingId={setRenamingId}
              onSetRenameVal={setRenameVal}
              onToggleSelection={onToggleLayerSelection}
            />
            {!node.collapsed && renderNodes(node.children ?? [], depth + 1)}
          </React.Fragment>
        );
      }

      // Guard: only render LayerRow when kind === "layer" and layer data is present
      if (node.kind !== "layer" || !node.layer) return null;

      return (
        <LayerRow
          key={node.id}
          layer={node.layer}
          isActive={node.id === activeLayerId}
          isSelected={selectedLayerIds.has(node.id)}
          depth={depth}
          thumbnail={thumbnails[node.layer.id]}
          dragOverTarget={dragOverTarget}
          renamingId={renamingId}
          renameVal={renameVal}
          totalNonRulerLayers={totalNonRulerLayers}
          onSetActive={onSetActive}
          onToggleVisible={onToggleVisible}
          onSetOpacity={onSetOpacity}
          onSetBlendMode={onSetBlendMode}
          onDeleteLayer={onDeleteLayer}
          onCtrlClickLayer={onCtrlClickLayer}
          onToggleRulerActive={onToggleRulerActive}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onStartRename={startRename}
          onCommitRename={commitRename}
          onSetRenamingId={setRenamingId}
          onSetRenameVal={setRenameVal}
          onToggleSelection={onToggleLayerSelection}
        />
      );
    });
  }

  return (
    <div
      className="flex flex-col h-full"
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* Layer panel top bar */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border">
        <span className="text-xs font-semibold text-foreground flex-1">
          Layers
        </span>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onToggleAlphaLock.bind(null, activeLayerId)}
                className={`p-1 rounded hover:bg-accent ${activeLayer?.alphaLock ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                data-ocid="layers.toggle.button"
              >
                <Lock size={12} />
              </button>
            </TooltipTrigger>
            <TooltipContent>Alpha Lock</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => onToggleClippingMask(activeLayerId)}
                className={`p-1 rounded hover:bg-accent ${activeLayer?.isClippingMask ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                data-ocid="layers.clipping_mask_button"
              >
                <Scissors size={12} />
              </button>
            </TooltipTrigger>
            <TooltipContent>Clipping Mask</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onClearLayer}
                className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
                data-ocid="layers.clear_button"
              >
                <Eraser size={12} />
              </button>
            </TooltipTrigger>
            <TooltipContent>Clear Layer</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onMergeLayers}
                disabled={activeLayer?.isRuler === true}
                className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
                data-ocid="layers.merge_button"
              >
                <Check size={12} />
              </button>
            </TooltipTrigger>
            <TooltipContent>Merge Down (Shift+E)</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onCreateGroup}
                className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
                data-ocid="layers.create_group_button"
              >
                <FolderPlus size={12} />
              </button>
            </TooltipTrigger>
            <TooltipContent>Create Layer Group (Shift+G)</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onAddLayer}
                className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
                data-ocid="layers.add_button"
              >
                <Plus size={12} />
              </button>
            </TooltipTrigger>
            <TooltipContent>Add Layer</TooltipContent>
          </Tooltip>
          {onClose && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose?.();
                  }}
                  className="p-1 rounded text-[oklch(var(--accent-foreground))] bg-[oklch(var(--accent))] hover:brightness-110 active:brightness-90"
                  data-ocid="layers.close_button"
                >
                  <X size={12} />
                </button>
              </TooltipTrigger>
              <TooltipContent>Close</TooltipContent>
            </Tooltip>
          )}
        </TooltipProvider>
      </div>

      {/* Layer list — recursive tree of memoized GroupRow / LayerRow */}
      <div className="flex-1 overflow-y-auto">
        {renderNodes(layerTree ?? [], 0)}
      </div>
    </div>
  );
});
