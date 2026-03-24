import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Eraser,
  Eye,
  EyeOff,
  GripVertical,
  Lock,
  Plus,
  Trash2,
} from "lucide-react";
import { useRef, useState } from "react";

const LAYER_BLEND_MODES = [
  { value: "source-over", label: "Normal" },
  { value: "multiply", label: "Multiply" },
  { value: "screen", label: "Screen" },
  { value: "overlay", label: "Overlay" },
  { value: "soft-light", label: "Soft Light" },
  { value: "hard-light", label: "Hard Light" },
  { value: "color-dodge", label: "Dodge" },
  { value: "color-burn", label: "Burn" },
  { value: "darken", label: "Darken" },
  { value: "lighten", label: "Lighten" },
  { value: "difference", label: "Difference" },
  { value: "hue", label: "Hue" },
  { value: "saturation", label: "Saturation" },
  { value: "color", label: "Color" },
  { value: "luminosity", label: "Luminosity" },
];

export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  blendMode: string;
  isClippingMask: boolean;
  maskActive: boolean;
  hasMask: boolean;
}

interface LayersPanelProps {
  layers: Layer[];
  activeLayerId: string;
  onSetActive: (id: string) => void;
  onToggleVisible: (id: string) => void;
  onSetOpacity: (id: string, opacity: number) => void;
  onSetBlendMode: (id: string, blendMode: string) => void;
  onAddLayer: () => void;
  onDeleteLayer: (id: string) => void;
  onReorderLayers: (ids: string[]) => void;
  onClearLayer: () => void;
  onToggleClippingMask: (id: string) => void;
  onAddMask: (id: string) => void;
  onToggleMaskActive: (id: string) => void;
  onMergeLayers: () => void;
  onCtrlClickLayer: (id: string) => void;
  backgroundColor: string;
  onBackgroundColorChange: (color: string) => void;
  backgroundLayerId: string;
  thumbnails: Record<string, string>;
}

export function LayersPanel({
  layers,
  activeLayerId,
  onSetActive,
  onToggleVisible,
  onSetOpacity,
  onSetBlendMode,
  onAddLayer,
  onDeleteLayer,
  onReorderLayers,
  onClearLayer,
  onToggleClippingMask,
  onAddMask,
  onToggleMaskActive,
  onMergeLayers,
  onCtrlClickLayer,
  backgroundColor,
  onBackgroundColorChange,
  backgroundLayerId,
  thumbnails,
}: LayersPanelProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [ghostPos, setGhostPos] = useState<{ x: number; y: number } | null>(
    null,
  );
  const ghostLayerRef = useRef<Layer | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);

  const handleLayerPointerDown = (
    e: React.PointerEvent,
    layer: Layer,
    isBg: boolean,
  ) => {
    if (isBg) return;
    // Ctrl/Meta click: select layer pixels
    if (e.ctrlKey || e.metaKey) {
      e.stopPropagation();
      onCtrlClickLayer(layer.id);
      return;
    }
    onSetActive(layer.id);
  };

  const handleGripPointerDown = (
    e: React.PointerEvent,
    layer: Layer,
    isBg: boolean,
  ) => {
    if (isBg) return;
    e.stopPropagation();
    e.preventDefault();
    isDraggingRef.current = true;
    ghostLayerRef.current = layer;
    setDraggingId(layer.id);
    setGhostPos({ x: e.clientX, y: e.clientY });
    setDragOverIndex(null);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handleGripPointerMove = (e: React.PointerEvent) => {
    if (!isDraggingRef.current || !draggingId) return;
    setGhostPos({ x: e.clientX, y: e.clientY });

    // Find which layer row we're hovering over
    if (!listRef.current) return;
    const rows =
      listRef.current.querySelectorAll<HTMLElement>("[data-layer-id]");
    let found = false;
    for (const row of rows) {
      const rect = row.getBoundingClientRect();
      if (e.clientY >= rect.top && e.clientY <= rect.bottom) {
        const layerId = row.getAttribute("data-layer-id");
        if (layerId && layerId !== draggingId) {
          const idx = layers.findIndex((l) => l.id === layerId);
          setDragOverIndex(idx);
          found = true;
        }
        break;
      }
    }
    if (!found) setDragOverIndex(null);
  };

  const handleGripPointerUp = () => {
    if (
      isDraggingRef.current &&
      draggingId !== null &&
      dragOverIndex !== null
    ) {
      const fromIdx = layers.findIndex((l) => l.id === draggingId);
      if (fromIdx !== -1 && dragOverIndex !== fromIdx) {
        const newOrder = layers.map((l) => l.id);
        newOrder.splice(fromIdx, 1);
        newOrder.splice(dragOverIndex, 0, draggingId);
        onReorderLayers(newOrder);
      }
    }
    isDraggingRef.current = false;
    setDraggingId(null);
    setDragOverIndex(null);
    setGhostPos(null);
    ghostLayerRef.current = null;
  };

  const ghostLayer = ghostLayerRef.current;

  return (
    <TooltipProvider delayDuration={300}>
      <div
        className="flex flex-col border-t border-border"
        style={{ minHeight: 0, flex: 1, overflow: "hidden" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-border flex-shrink-0">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Layers
          </span>
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  data-ocid="layers.merge_button"
                  onClick={onMergeLayers}
                  className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors text-[10px] font-bold"
                  title="Merge Down (Shift+E)"
                >
                  M
                </button>
              </TooltipTrigger>
              <TooltipContent side="left">Merge Down (Shift+E)</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  data-ocid="layers.clear_button"
                  onClick={onClearLayer}
                  className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-muted transition-colors"
                >
                  <Eraser size={14} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="left">Clear Layer</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  data-ocid="layers.add_button"
                  onClick={onAddLayer}
                  className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                  <Plus size={14} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="left">Add Layer</TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* Layer list */}
        <div
          ref={listRef}
          className="flex-1 overflow-y-auto select-none"
          style={{
            WebkitOverflowScrolling: "touch" as any,
            overscrollBehavior: "contain",
          }}
          onPointerMove={handleGripPointerMove}
          onPointerUp={handleGripPointerUp}
          onPointerCancel={handleGripPointerUp}
        >
          {layers.map((layer, index) => {
            const isBg = layer.id === backgroundLayerId;
            const isActive = layer.id === activeLayerId;
            const thumb = thumbnails[layer.id];
            const isDragging = draggingId === layer.id;
            const isDropTarget = dragOverIndex === index;

            // If this layer is being dragged, show a divider placeholder
            if (isDragging) {
              return (
                <div
                  key={layer.id}
                  data-layer-id={layer.id}
                  className="h-1 w-full bg-primary/30"
                />
              );
            }

            return (
              <div
                key={layer.id}
                data-layer-id={layer.id}
                data-ocid={`layers.item.${index + 1}`}
                onPointerDown={(e) => handleLayerPointerDown(e, layer, isBg)}
                className={[
                  "group flex flex-col gap-0.5 px-2 py-1.5 cursor-pointer border-b border-border/50 transition-colors",
                  isActive
                    ? "bg-primary/10 border-l-2 border-l-primary"
                    : "hover:bg-muted/50",
                  isDropTarget ? "border-t-2 border-t-primary" : "",
                  layer.isClippingMask ? "pl-5" : "",
                ].join(" ")}
              >
                {/* Clipping mask indent indicator */}
                {layer.isClippingMask && (
                  <div
                    style={{
                      position: "absolute",
                      left: 8,
                      top: "50%",
                      width: 8,
                      height: 8,
                      borderLeft: "1.5px solid currentColor",
                      borderBottom: "1.5px solid currentColor",
                      transform: "translateY(-50%)",
                    }}
                    className="text-muted-foreground"
                  />
                )}

                {/* Row 1: drag handle, thumb, visibility, name, actions */}
                <div className="flex items-center gap-1">
                  {/* Drag handle */}
                  {!isBg && (
                    <span
                      className="cursor-grab text-muted-foreground opacity-0 group-hover:opacity-100 flex-shrink-0 touch-none"
                      onPointerDown={(e) =>
                        handleGripPointerDown(e, layer, isBg)
                      }
                    >
                      <GripVertical size={11} />
                    </span>
                  )}

                  {/* Thumbnail */}
                  {isBg ? (
                    <div
                      className="w-7 h-7 rounded-sm border border-border overflow-hidden flex-shrink-0"
                      style={{ backgroundColor }}
                    />
                  ) : (
                    <div
                      className="w-7 h-7 rounded-sm border border-border overflow-hidden flex-shrink-0 bg-muted"
                      style={{
                        backgroundImage:
                          "linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%)",
                        backgroundSize: "6px 6px",
                        backgroundPosition: "0 0, 0 3px, 3px -3px, -3px 0px",
                      }}
                    >
                      {thumb && (
                        <img
                          src={thumb}
                          alt=""
                          className="w-full h-full object-cover"
                          style={{ imageRendering: "pixelated" }}
                        />
                      )}
                    </div>
                  )}

                  {/* Visibility toggle */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleVisible(layer.id);
                    }}
                    className="w-5 h-5 flex items-center justify-center text-muted-foreground hover:text-foreground flex-shrink-0"
                  >
                    {layer.visible ? <Eye size={12} /> : <EyeOff size={12} />}
                  </button>

                  {/* Layer name */}
                  <span className="flex-1 text-xs truncate min-w-0">
                    {layer.name}
                  </span>

                  {/* Blend mode (non-bg layers) */}
                  {!isBg && (
                    <select
                      value={layer.blendMode}
                      onChange={(e) => {
                        e.stopPropagation();
                        onSetBlendMode(layer.id, e.target.value);
                      }}
                      onPointerDown={(e) => e.stopPropagation()}
                      className="text-[9px] bg-muted border border-border rounded px-0.5 h-4 text-muted-foreground cursor-pointer"
                      style={{ maxWidth: 52 }}
                      data-ocid={`layers.blend_select.${index + 1}`}
                    >
                      {LAYER_BLEND_MODES.map((m) => (
                        <option key={m.value} value={m.value}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  )}

                  {isBg ? (
                    <div className="flex items-center gap-1">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="text-muted-foreground">
                            <Lock size={10} />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="left">
                          Background — cannot paint
                        </TooltipContent>
                      </Tooltip>
                      <label
                        className="relative w-5 h-5 rounded border border-border flex-shrink-0 cursor-pointer overflow-hidden"
                        onPointerDown={(e) => e.stopPropagation()}
                      >
                        <span
                          className="absolute inset-0"
                          style={{ background: backgroundColor }}
                        />
                        <input
                          type="color"
                          value={backgroundColor}
                          onChange={(e) =>
                            onBackgroundColorChange(e.target.value)
                          }
                          onClick={(e) => e.stopPropagation()}
                          className="absolute opacity-0 w-full h-full cursor-pointer"
                          data-ocid="layers.background.input"
                        />
                      </label>
                    </div>
                  ) : (
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      {/* Clipping mask toggle */}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onToggleClippingMask(layer.id);
                            }}
                            className={`w-5 h-5 flex items-center justify-center rounded text-[9px] font-bold transition-colors ${
                              layer.isClippingMask
                                ? "text-primary"
                                : "text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            C
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="left">
                          Toggle Clipping Mask (Shift+G)
                        </TooltipContent>
                      </Tooltip>

                      {/* Delete */}
                      <button
                        type="button"
                        data-ocid={`layers.delete_button.${index + 1}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          const nonBgLayers = layers.filter(
                            (l) => l.id !== backgroundLayerId,
                          );
                          if (nonBgLayers.length > 1) onDeleteLayer(layer.id);
                        }}
                        disabled={
                          layers.filter((l) => l.id !== backgroundLayerId)
                            .length <= 1
                        }
                        className="w-5 h-5 flex items-center justify-center text-muted-foreground hover:text-destructive disabled:opacity-30"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  )}
                </div>

                {/* Row 2: opacity (regular layers only) */}
                {!isBg && (
                  <div className="flex items-center gap-1.5 pl-6">
                    {/* Opacity */}
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={Math.round(layer.opacity * 100)}
                      onChange={(e) =>
                        onSetOpacity(layer.id, Number(e.target.value) / 100)
                      }
                      onClick={(e) => e.stopPropagation()}
                      className="flex-1 h-1.5 accent-primary cursor-pointer"
                    />
                    <span className="text-[10px] text-muted-foreground w-6 text-right shrink-0">
                      {Math.round(layer.opacity * 100)}
                    </span>
                  </div>
                )}

                {/* Row 3: mask controls */}
                {!isBg && (
                  <div className="flex items-center gap-1 pl-6">
                    {layer.hasMask ? (
                      <>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleMaskActive(layer.id);
                          }}
                          className={`flex items-center gap-0.5 text-[9px] px-1 py-0 rounded transition-colors ${
                            layer.maskActive
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-muted-foreground hover:text-foreground"
                          }`}
                          title="Toggle painting on mask"
                        >
                          Mask
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onAddMask(layer.id);
                        }}
                        className="text-[9px] px-1 py-0 rounded bg-muted text-muted-foreground hover:text-foreground transition-colors opacity-0 group-hover:opacity-100"
                        title="Add Layer Mask"
                      >
                        + Mask
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Ghost drag overlay */}
        {draggingId && ghostPos && ghostLayer && (
          <div
            style={{
              position: "fixed",
              left: ghostPos.x + 10,
              top: ghostPos.y - 18,
              zIndex: 9999,
              pointerEvents: "none",
              opacity: 0.8,
              background: "var(--card)",
              border: "1px solid var(--primary)",
              borderRadius: 4,
              padding: "4px 8px",
              minWidth: 140,
              maxWidth: 220,
              boxShadow: "0 4px 16px rgba(0,0,0,0.35)",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            {thumbnails[ghostLayer.id] ? (
              <img
                src={thumbnails[ghostLayer.id]}
                alt=""
                style={{
                  width: 20,
                  height: 20,
                  objectFit: "cover",
                  borderRadius: 2,
                  imageRendering: "pixelated",
                  border: "1px solid var(--border)",
                }}
              />
            ) : (
              <div
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 2,
                  background: "var(--muted)",
                  border: "1px solid var(--border)",
                }}
              />
            )}
            <span
              style={{
                fontSize: 11,
                color: "var(--foreground)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {ghostLayer.name}
            </span>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
