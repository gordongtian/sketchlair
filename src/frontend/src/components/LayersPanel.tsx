import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { BLEND_MODES } from "@/utils/constants";
import {
  ArrowDownToLine,
  ChevronDown,
  ChevronRight,
  ClipboardCopy,
  Eraser,
  Eye,
  EyeOff,
  FolderClosed,
  FolderOpen,
  FolderPlus,
  GripVertical,
  Layers,
  Plus,
  Ruler,
  Scissors,
  Trash2,
} from "lucide-react";
import { memo, useCallback, useRef, useState } from "react";
import type React from "react";
import type { GroupHeader, LayerNode, PaintLayer, RulerFields } from "../types";
import {
  computeNestingDepths,
  getGroupSlice,
  isFlatEndGroup,
  isFlatGroupHeader,
} from "../utils/groupUtils";
import type { FlatEntry } from "../utils/groupUtils";

// ── Legacy Layer interface ────────────────────────────────────────────────────
// Exported so other files (PaintingApp, RightSidebarArea, etc.) can keep
// importing `Layer` from this file without changes.

export interface Layer extends RulerFields {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  blendMode: string;
  isClippingMask: boolean;
  alphaLock: boolean;
  isLocked?: boolean;
  // Flat-array type discriminant — kept optional for backward compat
  // GroupHeader and EndGroup objects are cast through this interface at runtime.
  type?: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const INDENT_SIZE = 16; // px per nesting level

// ── Drag state ────────────────────────────────────────────────────────────────

interface DragState {
  phase: "idle" | "dragging" | "hovering";
  dragIndex: number;
  dragEndIndex: number;
  dropIndex: number;
  sourceSnapshot: Layer[];
  pointerStartY: number;
}

const IDLE_DRAG: DragState = {
  phase: "idle",
  dragIndex: -1,
  dragEndIndex: -1,
  dropIndex: -1,
  sourceSnapshot: [],
  pointerStartY: 0,
};

// ── LayerRow ──────────────────────────────────────────────────────────────────

interface LayerRowProps {
  layer: PaintLayer;
  isActive: boolean;
  isSelected: boolean;
  depth: number;
  isDragging: boolean;
  thumbnail: string | undefined;
  renamingId: string | null;
  renameVal: string;
  totalNonRulerLayers: number;
  dropIndicatorBefore: boolean;
  dropIndicatorAfter: boolean;
  shiftHeld: boolean;
  onSetActive: (id: string) => void;
  onToggleVisible: (id: string) => void;
  onSetOpacity: (id: string, opacity: number) => void;
  onSetOpacityLive: (id: string, opacity: number) => void;
  onSetOpacityCommit: (id: string, before: number, after: number) => void;
  onDeleteLayer: (id: string) => void;
  onCtrlClickLayer: (id: string) => void;
  onToggleRulerActive: (id: string) => void;
  onDragHandlePointerDown: (e: React.PointerEvent, index: number) => void;
  flatIndex: number;
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
  isDragging,
  thumbnail,
  renamingId,
  renameVal,
  totalNonRulerLayers,
  dropIndicatorBefore,
  dropIndicatorAfter,
  shiftHeld,
  onSetActive,
  onToggleVisible,
  onSetOpacityLive,
  onSetOpacityCommit,
  onDeleteLayer,
  onCtrlClickLayer,
  onToggleRulerActive,
  onDragHandlePointerDown,
  flatIndex,
  onStartRename,
  onCommitRename,
  onSetRenamingId,
  onSetRenameVal,
  onToggleSelection,
}: LayerRowProps) {
  const isRenaming = renamingId === layer.id;
  const opacityDragStartRef = useRef<number | null>(null);

  // XOR shift to display effective ruler active state without mutating
  const effectiveRulerActive = layer.isRuler
    ? (layer.rulerActive ?? true) !== shiftHeld
    : false;

  const extraClipPad = layer.isClippingMask ? 16 : 0;
  const leftPad = depth * INDENT_SIZE + extraClipPad + 8;

  let bg = "bg-[oklch(var(--sidebar-item))] hover:brightness-95";
  if (isActive) bg = "bg-[oklch(var(--accent)/0.25)]";
  else if (isSelected) bg = "bg-[oklch(var(--accent)/0.15)]";

  return (
    <div
      style={{ opacity: isDragging ? 0.4 : 1, position: "relative" }}
      data-layer-flat-index={flatIndex}
    >
      {dropIndicatorBefore && (
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-primary z-10 pointer-events-none" />
      )}
      <div
        className={`flex items-center gap-1.5 py-1.5 cursor-pointer border-b border-border/40 ${bg}`}
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
        {/* Drag handle */}
        <span
          className="self-stretch shrink-0 cursor-grab active:cursor-grabbing flex items-center px-0.5"
          style={{ minWidth: 16 }}
          onPointerDown={(e) => {
            e.stopPropagation();
            onDragHandlePointerDown(e, flatIndex);
          }}
        >
          <GripVertical size={10} className="text-muted-foreground" />
        </span>

        {/* Thumbnail / ruler toggle */}
        {layer.isRuler ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleRulerActive(layer.id);
            }}
            className={`w-8 h-8 rounded shrink-0 flex items-center justify-center border border-border text-xs font-bold transition-colors ${
              effectiveRulerActive
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
            data-ocid="layers.ruler_toggle_thumb"
          >
            {effectiveRulerActive ? "ON" : "OFF"}
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
          <div className="flex items-center gap-1 mt-0.5">
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={layer.opacity}
              onPointerDown={(e) => {
                e.stopPropagation();
                opacityDragStartRef.current = layer.opacity;
              }}
              onChange={(e) => {
                e.stopPropagation();
                onSetOpacityLive(layer.id, Number(e.target.value));
              }}
              onPointerUp={(e) => {
                e.stopPropagation();
                if (opacityDragStartRef.current !== null) {
                  onSetOpacityCommit(
                    layer.id,
                    opacityDragStartRef.current,
                    Number((e.target as HTMLInputElement).value),
                  );
                  opacityDragStartRef.current = null;
                }
              }}
              onClick={(e) => e.stopPropagation()}
              style={
                {
                  "--fill-pct": `${layer.opacity * 100}%`,
                } as React.CSSProperties
              }
              className="flex-1 min-w-0"
              data-ocid="layers.opacity_slider"
            />
            <input
              type="number"
              min={0}
              max={100}
              value={Math.round(layer.opacity * 100)}
              onChange={(e) => {
                e.stopPropagation();
                const pct = Math.max(0, Math.min(100, Number(e.target.value)));
                onSetOpacityLive(layer.id, pct / 100);
              }}
              onBlur={(e) => {
                e.stopPropagation();
                const pct = Math.max(
                  0,
                  Math.min(100, Number(e.target.value) || 0),
                );
                const before = opacityDragStartRef.current ?? layer.opacity;
                onSetOpacityCommit(layer.id, before, pct / 100);
                opacityDragStartRef.current = null;
              }}
              onFocus={(e) => {
                e.stopPropagation();
                opacityDragStartRef.current = layer.opacity;
              }}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              onClick={(e) => e.stopPropagation()}
              className="w-9 shrink-0 bg-muted/60 border border-border/60 rounded text-foreground text-[10px] text-center px-0 py-0 leading-none h-4 focus:outline-none focus:border-primary [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              data-ocid="layers.opacity_input"
            />
          </div>
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
          {(!layer.isRuler && totalNonRulerLayers > 1) || layer.isRuler ? (
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
          ) : null}
        </div>
      </div>
      {dropIndicatorAfter && (
        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary z-10 pointer-events-none" />
      )}
    </div>
  );
});

// ── GroupRow ──────────────────────────────────────────────────────────────────

interface GroupRowProps {
  group: GroupHeader;
  depth: number;
  isDragging: boolean;
  isSelected: boolean;
  renamingId: string | null;
  renameVal: string;
  dropIndicatorBefore: boolean;
  dropIndicatorAfter: boolean;
  onToggleCollapse: (id: string) => void;
  onToggleVisible: (id: string) => void;
  onSetOpacity: (id: string, opacity: number) => void;
  onSetOpacityLive: (id: string, opacity: number) => void;
  onSetOpacityCommit: (id: string, before: number, after: number) => void;
  onOpenDeleteGroup: (id: string) => void;
  onDragHandlePointerDown: (e: React.PointerEvent, index: number) => void;
  flatIndex: number;
  onStartRename: (id: string, name: string) => void;
  onCommitRename: (id: string) => void;
  onSetRenamingId: (id: string | null) => void;
  onSetRenameVal: (v: string) => void;
  onToggleSelection: (id: string, shiftHeld: boolean) => void;
}

const GroupRow = memo(function GroupRow({
  group,
  depth,
  isDragging,
  isSelected,
  renamingId,
  renameVal,
  dropIndicatorBefore,
  dropIndicatorAfter,
  onToggleCollapse,
  onToggleVisible,
  onSetOpacityLive,
  onSetOpacityCommit,
  onOpenDeleteGroup,
  onDragHandlePointerDown,
  flatIndex,
  onStartRename,
  onCommitRename,
  onSetRenamingId,
  onSetRenameVal,
  onToggleSelection,
}: GroupRowProps) {
  const isRenaming = renamingId === group.id;
  const leftPad = depth * INDENT_SIZE + 8;
  const opacityDragStartRef = useRef<number | null>(null);

  const bg = isSelected
    ? "bg-[oklch(var(--accent)/0.2)]"
    : "bg-[oklch(var(--sidebar-item)/0.6)] hover:brightness-95";

  return (
    <div
      style={{ opacity: isDragging ? 0.4 : 1, position: "relative" }}
      data-layer-flat-index={flatIndex}
    >
      {dropIndicatorBefore && (
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-primary z-10 pointer-events-none" />
      )}
      <div
        className={`flex items-center gap-1.5 py-1.5 cursor-pointer border-b border-border/40 ${bg}`}
        style={{ paddingLeft: leftPad, paddingRight: 8 }}
        onClick={(e) => {
          if (e.shiftKey) {
            onToggleSelection(group.id, true);
          } else {
            onToggleSelection(group.id, false);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            onToggleSelection(group.id, e.shiftKey);
          }
        }}
        data-ocid="layers.group_row"
      >
        {/* Drag handle */}
        <span
          className="self-stretch shrink-0 cursor-grab active:cursor-grabbing flex items-center px-0.5"
          style={{ minWidth: 16 }}
          onPointerDown={(e) => {
            e.stopPropagation();
            onDragHandlePointerDown(e, flatIndex);
          }}
        >
          <GripVertical size={10} className="text-muted-foreground" />
        </span>

        {/* Collapse toggle */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleCollapse(group.id);
          }}
          className="p-0.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground shrink-0"
          data-ocid="layers.group_collapse"
        >
          {group.collapsed ? (
            <ChevronRight size={10} />
          ) : (
            <ChevronDown size={10} />
          )}
        </button>

        {/* Folder icon */}
        <span className="shrink-0 text-muted-foreground">
          {group.collapsed ? (
            <FolderClosed size={12} />
          ) : (
            <FolderOpen size={12} />
          )}
        </span>

        {/* Name + opacity */}
        <div className="flex flex-col flex-1 min-w-0">
          {isRenaming ? (
            <input
              // biome-ignore lint/a11y/noAutofocus: rename UX requires autofocus
              autoFocus
              value={renameVal}
              onChange={(e) => onSetRenameVal(e.target.value)}
              onBlur={() => onCommitRename(group.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onCommitRename(group.id);
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
                onStartRename(group.id, group.name);
              }}
            >
              {group.name}
            </span>
          )}
          <div className="flex items-center gap-1 mt-0.5">
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={group.opacity}
              onPointerDown={(e) => {
                e.stopPropagation();
                opacityDragStartRef.current = group.opacity;
              }}
              onChange={(e) => {
                e.stopPropagation();
                onSetOpacityLive(group.id, Number(e.target.value));
              }}
              onPointerUp={(e) => {
                e.stopPropagation();
                if (opacityDragStartRef.current !== null) {
                  onSetOpacityCommit(
                    group.id,
                    opacityDragStartRef.current,
                    Number((e.target as HTMLInputElement).value),
                  );
                  opacityDragStartRef.current = null;
                }
              }}
              onClick={(e) => e.stopPropagation()}
              style={
                {
                  "--fill-pct": `${group.opacity * 100}%`,
                } as React.CSSProperties
              }
              className="flex-1 min-w-0"
              data-ocid="layers.group_opacity_slider"
            />
            <input
              type="number"
              min={0}
              max={100}
              value={Math.round(group.opacity * 100)}
              onChange={(e) => {
                e.stopPropagation();
                const pct = Math.max(0, Math.min(100, Number(e.target.value)));
                onSetOpacityLive(group.id, pct / 100);
              }}
              onBlur={(e) => {
                e.stopPropagation();
                const pct = Math.max(
                  0,
                  Math.min(100, Number(e.target.value) || 0),
                );
                const before = opacityDragStartRef.current ?? group.opacity;
                onSetOpacityCommit(group.id, before, pct / 100);
                opacityDragStartRef.current = null;
              }}
              onFocus={(e) => {
                e.stopPropagation();
                opacityDragStartRef.current = group.opacity;
              }}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              onClick={(e) => e.stopPropagation()}
              className="w-9 shrink-0 bg-muted/60 border border-border/60 rounded text-foreground text-[10px] text-center px-0 py-0 leading-none h-4 focus:outline-none focus:border-primary [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              data-ocid="layers.group_opacity_input"
            />
          </div>
        </div>

        {/* Controls */}
        <div className="flex flex-col items-center gap-0.5 shrink-0">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleVisible(group.id);
            }}
            className="p-0.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
            data-ocid="layers.group_visibility"
          >
            {group.visible ? <Eye size={10} /> : <EyeOff size={10} />}
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenDeleteGroup(group.id);
            }}
            className="p-0.5 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive"
            data-ocid="layers.group_delete"
          >
            <Trash2 size={10} />
          </button>
        </div>
      </div>
      {dropIndicatorAfter && (
        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary z-10 pointer-events-none" />
      )}
    </div>
  );
});

// ── LayersPanel props ─────────────────────────────────────────────────────────

interface LayersPanelProps {
  layers: Layer[];
  /** @deprecated Kept for backward compat — not used in flat-array rendering */
  layerTree?: LayerNode[];
  activeLayerId: string;
  selectedLayerIds: Set<string>;
  onSetActive: (id: string) => void;
  onToggleVisible: (id: string) => void;
  onSetOpacity: (id: string, opacity: number) => void;
  onSetOpacityLive: (id: string, opacity: number) => void;
  onSetOpacityCommit: (id: string, before: number, after: number) => void;
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
  onToggleLockLayer: (id: string) => void;
  onDuplicateLayer: () => void;
  onCutToNewLayer: () => void;
  onCopyToNewLayer: () => void;
  thumbnails: Record<string, string>;
  onToggleRulerActive: (id: string) => void;
  onToggleGroupCollapse: (groupId: string) => void;
  onRenameGroup: (groupId: string, name: string) => void;
  onSetGroupOpacity: (groupId: string, opacity: number) => void;
  onSetGroupOpacityLive: (groupId: string, opacity: number) => void;
  onSetGroupOpacityCommit: (
    groupId: string,
    before: number,
    after: number,
  ) => void;
  onToggleGroupVisible: (groupId: string) => void;
  /** Called when the user clicks the delete button on a group — opens the confirm dialog */
  onDeleteGroup: (groupId: string) => void;
  onReorderTree: (newTree: Layer[] | LayerNode[]) => void;
  /** Silent reorder — no history entry */
  onReorderTreeSilent: (newTree: Layer[] | LayerNode[]) => void;
  /** Silent flat reorder — no history entry */
  onReorderLayersSilent: (ids: string[]) => void;
  onCommitReorderHistory: (
    treeBefore: LayerNode[],
    treeAfter: LayerNode[],
    layersBefore: Layer[],
    layersAfter: Layer[],
  ) => void;
  onToggleLayerSelection: (id: string, shiftHeld: boolean) => void;
  onCreateGroup: () => void;
  onClose?: () => void;
  shiftHeld?: boolean;
  /** True when there is an active selection — enables Cut/Copy to New Layer buttons */
  hasActiveSelection?: boolean;
  /** Called when the user interacts with a layer (selects it) — used by mobile to bring panel to front */
  onInteract?: () => void;
}

// ── LayersPanel ───────────────────────────────────────────────────────────────

export const LayersPanel = memo(function LayersPanel({
  layers,
  activeLayerId,
  selectedLayerIds,
  onSetActive,
  onToggleVisible,
  onSetOpacity,
  onSetOpacityLive,
  onSetOpacityCommit,
  onSetBlendMode,
  onAddLayer,
  onDeleteLayer,
  onClearLayer,
  onToggleClippingMask,
  onMergeLayers,
  onCtrlClickLayer,
  onRenameLayer,
  onToggleAlphaLock,
  onToggleLockLayer: _onToggleLockLayer,
  onDuplicateLayer,
  onCutToNewLayer,
  onCopyToNewLayer,
  thumbnails,
  onToggleRulerActive,
  onToggleGroupCollapse,
  onRenameGroup,
  onSetGroupOpacity,
  onSetGroupOpacityLive,
  onSetGroupOpacityCommit,
  onToggleGroupVisible,
  onDeleteGroup,
  onReorderTree,
  onReorderTreeSilent: _onReorderTreeSilent,
  onCommitReorderHistory,
  onToggleLayerSelection,
  onCreateGroup,
  onClose: _onClose,
  shiftHeld = false,
  hasActiveSelection = false,
  onInteract,
}: LayersPanelProps) {
  // ── Always-current refs ────────────────────────────────────────────────────
  const layersRef = useRef<Layer[]>(layers);
  layersRef.current = layers;

  // Wrap onSetActive to fire onInteract when a layer is selected
  const handleSetActive = useCallback(
    (id: string) => {
      onInteract?.();
      onSetActive(id);
    },
    [onSetActive, onInteract],
  );

  // ── Drag state ─────────────────────────────────────────────────────────────
  const dragStateRef = useRef<DragState>({ ...IDLE_DRAG });
  const [dropIndex, setDropIndex] = useState<number>(-1);
  const [draggingIndex, setDraggingIndex] = useState<number>(-1);
  const listRef = useRef<HTMLDivElement>(null);

  // ── Rename state ───────────────────────────────────────────────────────────
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState("");

  // ── Rename handlers ────────────────────────────────────────────────────────

  const startRename = useCallback((id: string, name: string) => {
    setRenamingId(id);
    setRenameVal(name);
  }, []);

  const commitRename = useCallback(
    (id: string) => {
      if (!renameVal.trim()) {
        setRenamingId(null);
        return;
      }
      const entry = layersRef.current.find((l) => l.id === id);
      if (entry?.type === "group") {
        onRenameGroup(id, renameVal.trim());
      } else {
        onRenameLayer(id, renameVal.trim());
      }
      setRenamingId(null);
    },
    [renameVal, onRenameGroup, onRenameLayer],
  );

  // ── Visibility computation ─────────────────────────────────────────────────
  // Compute which indices are hidden (inside a collapsed group)

  const computeHidden = useCallback((flatLayers: Layer[]): Set<number> => {
    const hidden = new Set<number>();
    const entries = flatLayers as FlatEntry[];
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (isFlatGroupHeader(e) && e.collapsed) {
        const slice = getGroupSlice(entries, e.id);
        if (slice) {
          // Hide everything from startIndex+1 (children) through endIndex (end_group)
          for (let j = slice.startIndex + 1; j <= slice.endIndex; j++) {
            hidden.add(j);
          }
        }
      }
    }
    return hidden;
  }, []);

  // ── Pointer-based drag-drop ────────────────────────────────────────────────

  /**
   * Given a clientY coordinate and the list container, determine which flat
   * array insertion index the pointer is hovering over.
   */
  const getDropIndexFromPointer = useCallback((clientY: number): number => {
    const container = listRef.current;
    if (!container) return -1;

    const rows = container.querySelectorAll<HTMLElement>(
      "[data-layer-flat-index]",
    );
    if (rows.length === 0) return 0;

    for (const row of rows) {
      const rect = row.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      const idx = Number(row.dataset.layerFlatIndex ?? "-1");
      if (idx === -1) continue;
      if (clientY < mid) {
        return idx; // drop before this row
      }
    }
    // Below all rows — drop at the very end
    const last = rows[rows.length - 1];
    const lastIdx = Number((last as HTMLElement).dataset.layerFlatIndex ?? "0");
    return lastIdx + 1;
  }, []);

  const handleDragHandlePointerDown = useCallback(
    (e: React.PointerEvent, index: number) => {
      e.preventDefault();
      e.stopPropagation();

      const currentLayers = layersRef.current;
      const entry = currentLayers[index] as FlatEntry | undefined;
      if (!entry) return;

      // end_group entries are non-draggable
      if (isFlatEndGroup(entry)) return;

      // Determine the end index (for groups, drag the full slice)
      let dragEndIndex = index;
      if (isFlatGroupHeader(entry)) {
        const slice = getGroupSlice(currentLayers as FlatEntry[], entry.id);
        if (slice) {
          dragEndIndex = slice.endIndex;
        }
      }

      dragStateRef.current = {
        phase: "dragging",
        dragIndex: index,
        dragEndIndex,
        dropIndex: index,
        sourceSnapshot: currentLayers.slice(),
        pointerStartY: e.clientY,
      };

      setDraggingIndex(index);
      setDropIndex(-1);

      const el = e.currentTarget as HTMLElement;
      el.setPointerCapture(e.pointerId);

      const onPointerMove = (ev: PointerEvent) => {
        const ds = dragStateRef.current;
        if (ds.phase === "idle") return;

        const newDropIdx = getDropIndexFromPointer(ev.clientY);
        if (newDropIdx === -1) return;

        // Validate with validateDropTarget logic inlined:
        const { dragIndex, dragEndIndex: dEndIdx } = ds;
        const isValid = newDropIdx < dragIndex || newDropIdx > dEndIdx + 1;

        if (isValid) {
          dragStateRef.current.dropIndex = newDropIdx;
          dragStateRef.current.phase = "hovering";
          setDropIndex(newDropIdx);
        }
      };

      const onPointerUp = () => {
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);

        const ds = dragStateRef.current;

        if (ds.phase === "hovering" && ds.dropIndex !== -1) {
          const {
            dragIndex,
            dragEndIndex: dEndIdx,
            dropIndex: dIdx,
            sourceSnapshot,
          } = ds;
          const curr = layersRef.current;

          // Build new flat array
          const dragSlice = curr.slice(dragIndex, dEndIdx + 1);
          const without = [
            ...curr.slice(0, dragIndex),
            ...curr.slice(dEndIdx + 1),
          ];
          // Adjust drop index for removal of slice
          const adjustedDrop =
            dIdx > dEndIdx ? dIdx - (dEndIdx - dragIndex + 1) : dIdx;

          const newLayers = [
            ...without.slice(0, adjustedDrop),
            ...dragSlice,
            ...without.slice(adjustedDrop),
          ];

          // Commit with history
          onReorderTree(newLayers);
          // Also push explicit history entry with before/after
          onCommitReorderHistory([], [], sourceSnapshot, newLayers);
        }

        // Reset state
        dragStateRef.current = { ...IDLE_DRAG };
        setDraggingIndex(-1);
        setDropIndex(-1);
      };

      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
    },
    [getDropIndexFromPointer, onReorderTree, onCommitReorderHistory],
  );

  // ── Derived data ───────────────────────────────────────────────────────────

  const activeLayer = layers.find((l) => l.id === activeLayerId) as
    | PaintLayer
    | undefined;
  const totalNonRulerLayers = layers.filter(
    (l) =>
      l.type !== "group" &&
      l.type !== "end_group" &&
      !(l as PaintLayer).isRuler,
  ).length;

  // ── Action bar disabled states ─────────────────────────────────────────────
  const activeLayerRaw = layers.find((l) => l.id === activeLayerId) as
    | { type?: string }
    | undefined;
  const isGroupHeader = activeLayerRaw?.type === "group";
  const isEndGroup = activeLayerRaw?.type === "end_group";
  const activeLayerIndex = layers.findIndex((l) => l.id === activeLayerId);
  const layerBelow =
    activeLayerIndex < layers.length - 1 ? layers[activeLayerIndex + 1] : null;
  const mergeDownDisabled =
    !activeLayerRaw ||
    isGroupHeader ||
    isEndGroup ||
    !layerBelow ||
    (layerBelow as { type?: string }).type === "end_group" ||
    (layerBelow as { type?: string }).type === "group";
  const selectionOpsDisabled = !hasActiveSelection;
  const lockOpsDisabled = isGroupHeader || isEndGroup;
  const newGroupDisabled = isGroupHeader || isEndGroup;

  /**
   * Panel-level blend mode selector value.
   * - Single active non-ruler layer → show its blend mode
   * - Multiple selected non-ruler layers with same mode → show that mode
   * - Multiple selected with different modes → "" (shows ---)
   * - Ruler layer → null (hide selector)
   */
  const panelBlendMode = (() => {
    if (selectedLayerIds.size === 0) {
      if ((activeLayer as PaintLayer | undefined)?.isRuler) return null;
      return activeLayer?.blendMode ?? "source-over";
    }
    const nonRulerSelected = layers.filter(
      (l) =>
        selectedLayerIds.has(l.id) &&
        l.type !== "group" &&
        l.type !== "end_group" &&
        !(l as PaintLayer).isRuler,
    );
    if (nonRulerSelected.length === 0) return null;
    const first = nonRulerSelected[0].blendMode ?? "source-over";
    const allSame = nonRulerSelected.every(
      (l) => (l.blendMode ?? "source-over") === first,
    );
    return allSame ? first : "";
  })();

  const handlePanelBlendModeChange = useCallback(
    (newMode: string) => {
      if (newMode === "") return;
      if (selectedLayerIds.size > 1) {
        for (const id of selectedLayerIds) {
          const l = layers.find((x) => x.id === id);
          if (
            l &&
            l.type !== "group" &&
            l.type !== "end_group" &&
            !(l as PaintLayer).isRuler
          ) {
            onSetBlendMode(id, newMode);
          }
        }
      } else if (activeLayer && !(activeLayer as PaintLayer).isRuler) {
        onSetBlendMode(activeLayer.id, newMode);
      }
    },
    [selectedLayerIds, layers, activeLayer, onSetBlendMode],
  );

  // ── Render ─────────────────────────────────────────────────────────────────

  const depths = computeNestingDepths(layers as FlatEntry[]);
  const hidden = computeHidden(layers);

  const rows: React.ReactNode[] = [];

  for (let i = 0; i < layers.length; i++) {
    if (hidden.has(i)) continue;

    const entry = layers[i] as FlatEntry;
    const depth = depths[i];

    // end_group: thin visual gap only — no interaction
    if (isFlatEndGroup(entry)) {
      rows.push(
        <div
          key={`end_group_${entry.id}_${i}`}
          style={{ height: 4, marginLeft: Math.max(0, depth) * INDENT_SIZE }}
          className="border-b border-border/20 bg-muted/10"
          aria-hidden="true"
        />,
      );
      continue;
    }

    const isDragging = i === draggingIndex;
    const dropBefore = dropIndex === i;
    const dropAfter = dropIndex === i + 1;

    if (isFlatGroupHeader(entry)) {
      const group = entry as GroupHeader;
      rows.push(
        <GroupRow
          key={group.id}
          group={group}
          depth={depth}
          isDragging={isDragging}
          isSelected={selectedLayerIds.has(group.id)}
          renamingId={renamingId}
          renameVal={renameVal}
          dropIndicatorBefore={dropBefore}
          dropIndicatorAfter={dropAfter && !hidden.has(i + 1)}
          onToggleCollapse={onToggleGroupCollapse}
          onToggleVisible={onToggleGroupVisible}
          onSetOpacity={onSetGroupOpacity}
          onSetOpacityLive={onSetGroupOpacityLive}
          onSetOpacityCommit={onSetGroupOpacityCommit}
          onOpenDeleteGroup={onDeleteGroup}
          onDragHandlePointerDown={handleDragHandlePointerDown}
          flatIndex={i}
          onStartRename={startRename}
          onCommitRename={commitRename}
          onSetRenamingId={setRenamingId}
          onSetRenameVal={setRenameVal}
          onToggleSelection={onToggleLayerSelection}
        />,
      );
      continue;
    }

    // Regular layer or ruler
    const layer = entry as PaintLayer;
    rows.push(
      <LayerRow
        key={layer.id}
        layer={layer}
        isActive={layer.id === activeLayerId}
        isSelected={selectedLayerIds.has(layer.id)}
        depth={depth}
        isDragging={isDragging}
        thumbnail={thumbnails[layer.id]}
        renamingId={renamingId}
        renameVal={renameVal}
        totalNonRulerLayers={totalNonRulerLayers}
        dropIndicatorBefore={dropBefore}
        dropIndicatorAfter={dropAfter}
        shiftHeld={layer.isRuler ? shiftHeld : false}
        onSetActive={handleSetActive}
        onToggleVisible={onToggleVisible}
        onSetOpacity={onSetOpacity}
        onSetOpacityLive={onSetOpacityLive}
        onSetOpacityCommit={onSetOpacityCommit}
        onDeleteLayer={onDeleteLayer}
        onCtrlClickLayer={onCtrlClickLayer}
        onToggleRulerActive={onToggleRulerActive}
        onDragHandlePointerDown={handleDragHandlePointerDown}
        flatIndex={i}
        onStartRename={startRename}
        onCommitRename={commitRename}
        onSetRenamingId={setRenamingId}
        onSetRenameVal={setRenameVal}
        onToggleSelection={onToggleLayerSelection}
      />,
    );
  }

  // Drop indicator at the very end (after all rows)
  if (dropIndex === layers.length) {
    rows.push(
      <div
        key="drop-indicator-end"
        className="h-0.5 bg-primary pointer-events-none"
      />,
    );
  }

  return (
    <div
      className="flex flex-col h-full"
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* Action buttons row — desktop only */}
      <TooltipProvider>
        <div className="flex items-center flex-wrap gap-0.5 px-2 py-1 border-b border-border/60 bg-muted/20">
          {/* 1. Clear Layer */}
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

          {/* 2. Merge Down */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onMergeLayers}
                disabled={mergeDownDisabled}
                className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed"
                data-ocid="layers.merge_button"
              >
                <ArrowDownToLine size={12} />
              </button>
            </TooltipTrigger>
            <TooltipContent>Merge Down</TooltipContent>
          </Tooltip>

          {/* 3. Alpha Lock */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => onToggleAlphaLock(activeLayerId)}
                disabled={lockOpsDisabled}
                className={`p-1 rounded hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed ${activeLayer?.alphaLock ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                data-ocid="layers.alpha_lock_button"
              >
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: "bold",
                    lineHeight: 1,
                    fontFamily: "serif",
                  }}
                >
                  α
                </span>
              </button>
            </TooltipTrigger>
            <TooltipContent>Alpha Lock</TooltipContent>
          </Tooltip>

          {/* 4. Clipping Mask */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => onToggleClippingMask(activeLayerId)}
                disabled={lockOpsDisabled}
                className={`p-1 rounded hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed ${activeLayer?.isClippingMask ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                data-ocid="layers.clipping_mask_button"
              >
                <Layers size={12} />
              </button>
            </TooltipTrigger>
            <TooltipContent>Clipping Mask</TooltipContent>
          </Tooltip>

          {/* 5. Copy to New Layer / Duplicate Layer (dual behavior) */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={
                  hasActiveSelection ? onCopyToNewLayer : onDuplicateLayer
                }
                disabled={lockOpsDisabled}
                className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed"
                data-ocid="layers.copy_to_new_layer_button"
              >
                <ClipboardCopy size={12} />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              {hasActiveSelection ? "Copy to New Layer" : "Duplicate Layer"}
            </TooltipContent>
          </Tooltip>

          {/* 6. Cut to New Layer */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onCutToNewLayer}
                disabled={selectionOpsDisabled || lockOpsDisabled}
                className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed"
                data-ocid="layers.cut_to_new_layer_button"
              >
                <Scissors size={12} />
              </button>
            </TooltipTrigger>
            <TooltipContent>Cut to New Layer</TooltipContent>
          </Tooltip>

          {/* 7. New Group */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onCreateGroup}
                disabled={newGroupDisabled}
                className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed"
                data-ocid="layers.create_group_button"
              >
                <FolderPlus size={12} />
              </button>
            </TooltipTrigger>
            <TooltipContent>New Layer Group</TooltipContent>
          </Tooltip>

          {/* 8. New Layer */}
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
            <TooltipContent>New Layer</TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>

      {/* Blend mode row */}
      {panelBlendMode !== null && (
        <div className="flex items-center gap-1.5 px-2 py-1 border-b border-border/60 bg-muted/20">
          <span className="text-[9px] text-muted-foreground shrink-0 font-medium">
            Mode
          </span>
          <select
            value={panelBlendMode}
            onChange={(e) => handlePanelBlendModeChange(e.target.value)}
            onBlur={() => {
              requestAnimationFrame(() => {
                document
                  .querySelector<HTMLCanvasElement>(
                    '[data-ocid="canvas.canvas_target"]',
                  )
                  ?.focus();
              });
            }}
            onMouseDown={(e) => e.stopPropagation()}
            className="flex-1 text-[9px] bg-transparent text-foreground border border-border/40 rounded px-1 py-0.5 focus:outline-none focus:border-primary cursor-pointer min-w-0 truncate"
            data-ocid="layers.panel_blend_select"
          >
            {panelBlendMode === "" && <option value="">---</option>}
            {BLEND_MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Layer list */}
      <div
        ref={listRef}
        className="flex-1 overflow-y-auto"
        style={{ userSelect: "none" }}
      >
        {rows}
      </div>
    </div>
  );
});
