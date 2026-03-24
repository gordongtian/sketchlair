import type { BrushSettings } from "@/components/BrushSettingsPanel";
import {
  BrushSettingsPanel,
  ScratchpadDialog,
} from "@/components/BrushSettingsPanel";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Preset } from "@/utils/toolPresets";
import {
  Check,
  GripVertical,
  ImagePlus,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface ToolPresetsPanelProps {
  tool: "brush" | "smear" | "eraser";
  presets: Preset[];
  activePresetId: string | null;
  currentSettings: BrushSettings;
  availableTips?: { id: string; name: string; tipImageData?: string }[];
  onSelectPreset: (preset: Preset) => void;
  onUpdatePreset: (preset: Preset) => void;
  onAddPreset: (tipImageData?: string) => void;
  onActivate: () => void;
  onClose?: () => void;
  onDeletePreset: (presetId: string) => void;
  onReorderPresets: (fromIndex: number, toIndex: number) => void;
  onSaveCurrentToPreset?: (
    presetId: string,
    size: number,
    opacity: number,
  ) => void;
  currentSize?: number;
  currentOpacity?: number;
}

const TOOL_LABELS: Record<"brush" | "smear" | "eraser", string> = {
  brush: "Brush",
  smear: "Smudge",
  eraser: "Eraser",
};

function BrushTipPickerDialog({
  availableTips,
  onPick,
  onCancel,
}: {
  availableTips: { id: string; name: string; tipImageData?: string }[];
  onPick: (tipImageData?: string) => void;
  onCancel: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      onPick(dataUrl);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  return (
    <DialogContent
      data-ocid="brush.tip_picker.dialog"
      className="max-w-sm"
      onPointerDownOutside={onCancel}
    >
      <DialogHeader>
        <DialogTitle className="text-sm">Choose Brush Tip</DialogTitle>
      </DialogHeader>

      <div className="flex flex-col gap-3">
        <p className="text-xs text-muted-foreground">
          Pick a tip from an existing preset, upload an image, or draw a new
          one.
        </p>

        {/* Existing preset tips */}
        <ScrollArea className="max-h-48">
          <div className="grid grid-cols-4 gap-2 pr-2">
            {availableTips.map((tip, idx) => (
              <button
                key={tip.id}
                type="button"
                data-ocid={`brush.tip_picker.item.${idx + 1}`}
                title={tip.name}
                onClick={() => onPick(tip.tipImageData)}
                className="flex flex-col items-center gap-1 group"
              >
                <div
                  className="w-14 h-14 rounded border border-border overflow-hidden transition-all group-hover:border-primary group-hover:scale-105"
                  style={{ background: "#1a1a1a" }}
                >
                  {tip.tipImageData ? (
                    <img
                      src={tip.tipImageData}
                      alt={tip.name}
                      className="w-full h-full object-cover"
                      style={{ imageRendering: "pixelated" }}
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <div className="w-8 h-8 rounded-full bg-white opacity-80" />
                    </div>
                  )}
                </div>
                <span className="text-[10px] text-muted-foreground truncate w-full text-center">
                  {tip.name}
                </span>
              </button>
            ))}
          </div>
        </ScrollArea>

        {/* Actions */}
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-ocid="brush.tip_picker.upload_button"
            className="flex-1 text-xs gap-1.5"
            onClick={() => fileInputRef.current?.click()}
          >
            <ImagePlus size={13} />
            Upload Image
          </Button>
          <ScratchpadDialog
            onSave={(dataUrl) => onPick(dataUrl)}
            trigger={
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-ocid="brush.tip_picker.draw_button"
                className="flex-1 text-xs gap-1.5"
              >
                <Pencil size={13} />
                Draw New
              </Button>
            }
          />
        </div>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-ocid="brush.tip_picker.cancel_button"
          className="text-xs text-muted-foreground"
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleUpload}
      />
    </DialogContent>
  );
}

// Default size slider curve helpers (same as brush size)
const sliderToDefaultSize = (v: number) =>
  v <= 50 ? 1 + (v / 50) * 99 : 100 + ((v - 50) / 50) * 900;
const defaultSizeToSlider = (s: number) =>
  s <= 100 ? ((s - 1) / 99) * 50 : 50 + ((s - 100) / 900) * 50;

export function ToolPresetsPanel({
  tool,
  presets,
  activePresetId,
  currentSettings: _currentSettings,
  availableTips,
  onSelectPreset,
  onUpdatePreset,
  onAddPreset,
  onActivate,
  onClose: _onClose,
  onDeletePreset,
  onReorderPresets,
  onSaveCurrentToPreset,
  currentSize,
  currentOpacity,
}: ToolPresetsPanelProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [tipPickerOpen, setTipPickerOpen] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const editingItemRef = useRef<HTMLDivElement | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on tool change
  useEffect(() => {
    setEditingId(null);
  }, [tool]);

  // Scroll editing item into view so Done/X buttons are always visible
  useEffect(() => {
    if (editingId && editingItemRef.current) {
      editingItemRef.current.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    }
  }, [editingId]);

  const startEdit = (preset: Preset) => {
    const opening = editingId !== preset.id;
    if (opening) {
      onActivate();
      onSelectPreset(preset);
    }
    setEditingId(opening ? preset.id : null);
    setEditName(preset.name);
  };

  const commitName = (preset: Preset) => {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== preset.name) {
      onUpdatePreset({ ...preset, name: trimmed });
    }
  };

  const handleSettingsChange = (preset: Preset, newSettings: BrushSettings) => {
    onUpdatePreset({ ...preset, settings: newSettings });
  };

  const handlePickTip = (tipImageData?: string) => {
    setTipPickerOpen(false);
    onAddPreset(tipImageData);
  };

  return (
    <div
      className="flex flex-col border-r border-border bg-card h-full"
      style={{ width: "100%", minWidth: 0 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border shrink-0">
        <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          {TOOL_LABELS[tool]} Presets
        </span>
      </div>

      {/* Presets list — scrollable, fills available height */}
      <ScrollArea
        className="flex-1 min-h-0"
        style={{
          WebkitOverflowScrolling: "touch" as any,
          overscrollBehavior: "contain",
        }}
      >
        <div className="flex flex-col gap-1 p-2">
          {presets.map((preset, idx) => {
            const isActive = preset.id === activePresetId;
            const isEditing = editingId === preset.id;
            const itemIndex = idx + 1;

            return (
              <div
                key={preset.id}
                data-ocid={`tool_presets.preset.item.${itemIndex}`}
                className={`rounded-md border transition-all duration-100 overflow-hidden min-w-0 ${
                  isActive
                    ? "border-primary bg-primary/10"
                    : "border-border bg-muted/30 hover:bg-muted/60"
                }`}
              >
                {isEditing ? (
                  <div
                    ref={editingItemRef}
                    className="p-2 flex flex-col gap-2 overflow-hidden min-w-0"
                  >
                    {/* Name + confirm/cancel row */}
                    <div className="flex items-center gap-1.5 overflow-hidden">
                      <Input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            commitName(preset);
                            setEditingId(null);
                          } else if (e.key === "Escape") {
                            setEditName(preset.name);
                            setEditingId(null);
                          }
                        }}
                        className="h-7 text-xs flex-1 min-w-0"
                        placeholder="Preset name"
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        data-ocid="tool_presets.done_edit_button"
                        className="text-xs h-7 w-7 p-0 flex-shrink-0"
                        title="Done"
                        onClick={() => {
                          commitName(preset);
                          setEditingId(null);
                        }}
                      >
                        <Check size={13} />
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        data-ocid="tool_presets.cancel_edit_button"
                        className="text-xs h-7 w-7 p-0 flex-shrink-0"
                        title="Cancel"
                        onClick={() => {
                          setEditName(preset.name);
                          setEditingId(null);
                        }}
                      >
                        <X size={13} />
                      </Button>
                    </div>
                    {/* Default Size slider */}
                    <div className="flex flex-col gap-0.5 min-w-0 w-full">
                      <div className="flex items-center justify-between min-w-0">
                        <span className="text-xs text-muted-foreground">
                          Default Size
                        </span>
                        <input
                          type="number"
                          min={1}
                          max={1000}
                          value={preset.defaultSize ?? 1}
                          onChange={(e) => {
                            const v =
                              e.target.value === ""
                                ? 1
                                : Math.min(
                                    1000,
                                    Math.max(1, Number(e.target.value)),
                                  );
                            onUpdatePreset({ ...preset, defaultSize: v });
                          }}
                          className="text-xs text-foreground bg-transparent border border-border rounded px-1 text-right focus:outline-none focus:border-primary [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                          style={{ width: 48 }}
                        />
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={0.5}
                        value={defaultSizeToSlider(preset.defaultSize ?? 1)}
                        onChange={(e) => {
                          const v = sliderToDefaultSize(Number(e.target.value));
                          onUpdatePreset({
                            ...preset,
                            defaultSize: Math.round(v),
                          });
                        }}
                        className="w-full min-w-0 h-1 accent-primary cursor-pointer"
                      />
                    </div>
                    {/* Mini brush settings — auto-save on every change */}
                    <div className="rounded border border-border overflow-hidden min-w-0">
                      <BrushSettingsPanel
                        brushSettings={preset.settings}
                        onBrushSettingsChange={(newSettings) =>
                          handleSettingsChange(preset, newSettings)
                        }
                        activeTool={tool}
                        availableTips={
                          availableTips ??
                          presets.map((p) => ({
                            id: p.id,
                            name: p.name,
                            tipImageData: p.settings.tipImageData,
                          }))
                        }
                      />
                    </div>

                    {/* Save Size & Opacity */}
                    {onSaveCurrentToPreset &&
                      currentSize !== undefined &&
                      currentOpacity !== undefined && (
                        <button
                          type="button"
                          data-ocid={`tool_presets.preset.save_size_button.${itemIndex}`}
                          onClick={() =>
                            onSaveCurrentToPreset(
                              preset.id,
                              currentSize!,
                              currentOpacity!,
                            )
                          }
                          className="w-full h-7 text-xs rounded bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors flex items-center justify-center gap-1"
                        >
                          Save Current Size &amp; Opacity to Preset
                        </button>
                      )}
                    {/* Actions row: Delete */}
                    <div className="flex items-center justify-between gap-2">
                      {presets.length > 1 ? (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              data-ocid={`tool_presets.preset.delete_button.${itemIndex}`}
                              className="text-xs h-7 gap-1.5 text-destructive hover:text-destructive hover:bg-destructive/10"
                            >
                              <Trash2 size={12} />
                              Delete
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent data-ocid="tool_presets.delete.dialog">
                            <AlertDialogHeader>
                              <AlertDialogTitle>
                                Delete preset?
                              </AlertDialogTitle>
                              <AlertDialogDescription>
                                "{preset.name}" will be permanently deleted.
                                This cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel data-ocid="tool_presets.delete.cancel_button">
                                Cancel
                              </AlertDialogCancel>
                              <AlertDialogAction
                                data-ocid="tool_presets.delete.confirm_button"
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                onClick={() => {
                                  onDeletePreset(preset.id);
                                  setEditingId(null);
                                }}
                              >
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      ) : (
                        <div />
                      )}
                    </div>
                  </div>
                ) : (
                  <div
                    className={`flex items-center group cursor-grab active:cursor-grabbing ${
                      dragOverIndex === idx ? "border-t-2 border-primary" : ""
                    }`}
                    draggable={true}
                    onDragStart={() => setDragIndex(idx)}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOverIndex(idx);
                    }}
                    onDrop={() => {
                      if (dragIndex !== null) {
                        onReorderPresets(dragIndex, idx);
                      }
                      setDragIndex(null);
                      setDragOverIndex(null);
                    }}
                    onDragEnd={() => {
                      setDragIndex(null);
                      setDragOverIndex(null);
                    }}
                  >
                    {/* Drag handle */}
                    <div className="w-4 h-7 flex items-center justify-center text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0 ml-1">
                      <GripVertical size={12} />
                    </div>
                    {/* Tip thumbnail */}
                    <div
                      className="w-7 h-7 rounded overflow-hidden flex-shrink-0"
                      style={{ background: "#1a1a1a" }}
                    >
                      {preset.settings.tipImageData ? (
                        <img
                          src={preset.settings.tipImageData}
                          alt="tip"
                          className="w-full h-full object-cover"
                          style={{ imageRendering: "pixelated" }}
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <div className="w-4 h-4 rounded-full bg-white opacity-60" />
                        </div>
                      )}
                    </div>
                    {/* Preset name / select area */}
                    <button
                      type="button"
                      className="flex-1 text-left px-2 py-2 text-xs font-medium truncate"
                      onClick={() => {
                        if (editingId !== null && editingId !== preset.id) {
                          setEditingId(null);
                        }
                        onActivate();
                        onSelectPreset(preset);
                      }}
                    >
                      <span
                        className={
                          isActive ? "text-primary" : "text-foreground"
                        }
                      >
                        {preset.name}
                      </span>
                      {isActive && (
                        <span className="ml-1.5 text-primary opacity-70">
                          ✓
                        </span>
                      )}
                    </button>
                    {/* Edit button */}
                    <button
                      type="button"
                      data-ocid={`tool_presets.preset.edit_button.${itemIndex}`}
                      onClick={() => startEdit(preset)}
                      className="w-7 h-7 flex items-center justify-center rounded text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity mr-1 shrink-0"
                      title="Edit preset"
                    >
                      <Pencil size={12} />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </ScrollArea>

      {/* Add new preset button */}
      <div className="p-2 border-t border-border shrink-0">
        <Dialog open={tipPickerOpen} onOpenChange={setTipPickerOpen}>
          <Button
            variant="ghost"
            size="sm"
            data-ocid="tool_presets.add_button"
            className="w-full h-8 text-xs justify-start gap-1.5"
            onClick={() => setTipPickerOpen(true)}
          >
            <Plus size={13} />
            New Preset
          </Button>
          <BrushTipPickerDialog
            availableTips={
              availableTips ??
              presets.map((p) => ({
                id: p.id,
                name: p.name,
                tipImageData: p.settings.tipImageData,
              }))
            }
            onPick={handlePickTip}
            onCancel={() => setTipPickerOpen(false)}
          />
        </Dialog>
      </div>
    </div>
  );
}
