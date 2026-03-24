import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { PlusCircle, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { BrushSettings } from "./BrushSettingsPanel";
import { DEFAULT_BRUSH_SETTINGS } from "./BrushSettingsPanel";

export interface BrushPreset {
  id: string;
  name: string;
  settings: BrushSettings;
}

const DEFAULT_PRESETS: BrushPreset[] = [
  {
    id: "preset-pencil",
    name: "Pencil",
    settings: {
      ...DEFAULT_BRUSH_SETTINGS,
      spacing: 5,
      softness: 0,
      pressureSize: true,
      pressureOpacity: false,
    },
  },
  {
    id: "preset-airbrush",
    name: "Airbrush",
    settings: {
      ...DEFAULT_BRUSH_SETTINGS,
      spacing: 2,
      softness: 0.7,
      pressureSize: true,
      pressureOpacity: true,
    },
  },
  {
    id: "preset-marker",
    name: "Marker",
    settings: {
      ...DEFAULT_BRUSH_SETTINGS,
      spacing: 1,
      softness: 0.1,
      pressureSize: false,
      pressureOpacity: false,
    },
  },
  {
    id: "preset-smudge",
    name: "Smudge Stick",
    settings: {
      ...DEFAULT_BRUSH_SETTINGS,
      spacing: 10,
      softness: 0.3,
      pressureSize: true,
      pressureOpacity: false,
    },
  },
];

const STORAGE_KEY = "heavybrush_presets";

function loadPresets(): BrushPreset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as BrushPreset[];
  } catch {
    // ignore
  }
  return DEFAULT_PRESETS;
}

function savePresets(presets: BrushPreset[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  } catch {
    // ignore
  }
}

function TipThumb({ tipImageData }: { tipImageData?: string }) {
  return (
    <div
      className="w-4 h-4 rounded-full overflow-hidden flex-shrink-0"
      style={{ background: "#1a1a1a" }}
    >
      {tipImageData ? (
        <img
          src={tipImageData}
          alt="tip"
          className="w-full h-full object-cover"
          style={{ imageRendering: "pixelated" }}
        />
      ) : (
        <div
          className="w-full h-full rounded-full"
          style={{ background: "rgba(255,255,255,0.6)" }}
        />
      )}
    </div>
  );
}

interface AdminPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApplyPreset: (settings: BrushSettings) => void;
}

export function AdminPanel({
  open,
  onOpenChange,
  onApplyPreset,
}: AdminPanelProps) {
  const [presets, setPresets] = useState<BrushPreset[]>(loadPresets);
  const [selectedId, setSelectedId] = useState<string>(presets[0]?.id ?? "");

  const selected =
    presets.find((p) => p.id === selectedId) ?? presets[0] ?? null;

  useEffect(() => {
    savePresets(presets);
  }, [presets]);

  const updateSelected = (partial: Partial<BrushPreset>) => {
    setPresets((prev) =>
      prev.map((p) => (p.id === selectedId ? { ...p, ...partial } : p)),
    );
  };

  const updateSettings = (partial: Partial<BrushSettings>) => {
    if (!selected) return;
    updateSelected({ settings: { ...selected.settings, ...partial } });
  };

  const handleNew = () => {
    const id = `preset-${Date.now()}`;
    const preset: BrushPreset = {
      id,
      name: "New Preset",
      settings: { ...DEFAULT_BRUSH_SETTINGS },
    };
    setPresets((prev) => [...prev, preset]);
    setSelectedId(id);
  };

  const handleDelete = () => {
    if (!selected) return;
    setPresets((prev) => {
      const next = prev.filter((p) => p.id !== selectedId);
      if (next.length === 0) return prev; // keep at least one
      setSelectedId(next[0].id);
      return next;
    });
  };

  const handleApply = () => {
    if (!selected) return;
    onApplyPreset(selected.settings);
    onOpenChange(false);
  };

  const settings = selected?.settings ?? DEFAULT_BRUSH_SETTINGS;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="left"
        data-ocid="admin.sheet"
        className="flex flex-col w-[580px] max-w-[95vw] p-0"
      >
        <SheetHeader className="px-5 pt-5 pb-3 border-b border-border shrink-0">
          <SheetTitle className="text-base">Brush Presets</SheetTitle>
        </SheetHeader>

        <div className="flex flex-1 min-h-0">
          {/* Left: preset list */}
          <div
            className="flex flex-col border-r border-border"
            style={{ width: 160, minWidth: 160 }}
          >
            <ScrollArea className="flex-1">
              <div className="flex flex-col gap-0.5 p-2">
                {presets.map((preset, i) => (
                  <button
                    key={preset.id}
                    type="button"
                    data-ocid={`admin.preset.item.${i + 1}`}
                    onClick={() => setSelectedId(preset.id)}
                    className={`w-full text-left px-2.5 py-2 rounded text-sm transition-all duration-100 flex items-center gap-2 ${
                      selectedId === preset.id
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted"
                    }`}
                  >
                    <TipThumb tipImageData={preset.settings.tipImageData} />
                    <span className="truncate">{preset.name}</span>
                  </button>
                ))}
              </div>
            </ScrollArea>
            <div className="p-2 border-t border-border flex flex-col gap-1">
              <Button
                variant="outline"
                size="sm"
                data-ocid="admin.new_preset_button"
                onClick={handleNew}
                className="w-full text-xs h-7"
              >
                <PlusCircle size={12} className="mr-1" />
                New
              </Button>
              <Button
                variant="outline"
                size="sm"
                data-ocid="admin.delete_button"
                onClick={handleDelete}
                disabled={presets.length <= 1}
                className="w-full text-xs h-7 text-destructive hover:text-destructive"
              >
                <Trash2 size={12} className="mr-1" />
                Delete
              </Button>
            </div>
          </div>

          {/* Right: editor */}
          <ScrollArea className="flex-1">
            {selected ? (
              <div className="flex flex-col gap-4 p-4">
                {/* Name */}
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs text-muted-foreground uppercase tracking-wider">
                    Name
                  </Label>
                  <Input
                    data-ocid="admin.preset_name_input"
                    value={selected.name}
                    onChange={(e) => updateSelected({ name: e.target.value })}
                    className="h-8 text-sm"
                  />
                </div>

                {/* Tip shape */}
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs text-muted-foreground uppercase tracking-wider">
                    Tip Shape
                  </Label>
                </div>

                {/* Softness */}
                <SliderField
                  label="Softness"
                  value={Math.round(settings.softness * 100)}
                  min={0}
                  max={100}
                  unit="%"
                  ocid="admin.softness_slider"
                  onChange={(v) => updateSettings({ softness: v / 100 })}
                />

                {/* Spacing */}
                <SliderField
                  label="Spacing"
                  value={settings.spacing}
                  min={1}
                  max={200}
                  unit="%"
                  ocid="admin.spacing_slider"
                  onChange={(v) => updateSettings({ spacing: v })}
                />

                {/* Rotation */}
                <div className="flex flex-col gap-1.5">
                  <SliderField
                    label="Rotation"
                    value={settings.rotation}
                    min={0}
                    max={360}
                    unit="°"
                    ocid="admin.rotation_slider"
                    onChange={(v) => updateSettings({ rotation: v })}
                  />
                  <div className="flex gap-1.5 mt-0.5">
                    <button
                      type="button"
                      data-ocid="admin.rotate_fixed_button"
                      onClick={() => updateSettings({ rotateMode: "fixed" })}
                      className={`flex-1 text-xs py-1.5 rounded transition-all duration-100 ${
                        settings.rotateMode === "fixed"
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
                      }`}
                    >
                      Fixed Angle
                    </button>
                    <button
                      type="button"
                      data-ocid="admin.rotate_follow_button"
                      onClick={() => updateSettings({ rotateMode: "follow" })}
                      className={`flex-1 text-xs py-1.5 rounded transition-all duration-100 ${
                        settings.rotateMode === "follow"
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
                      }`}
                    >
                      Follow Stroke
                    </button>
                  </div>
                </div>

                {/* Pressure */}
                <div className="flex flex-col gap-2">
                  <Label className="text-xs text-muted-foreground uppercase tracking-wider">
                    Pressure
                  </Label>
                  <ToggleRow
                    label="Pressure → Size"
                    id="admin-pressure-size"
                    checked={settings.pressureSize}
                    ocid="admin.pressure_size_switch"
                    onChange={(v) => updateSettings({ pressureSize: v })}
                  />
                  <ToggleRow
                    label="Pressure → Opacity"
                    id="admin-pressure-opacity"
                    checked={settings.pressureOpacity}
                    ocid="admin.pressure_opacity_switch"
                    onChange={(v) => updateSettings({ pressureOpacity: v })}
                  />
                </div>

                {/* Apply button */}
                <Button
                  data-ocid="admin.apply_button"
                  onClick={handleApply}
                  className="w-full mt-2"
                >
                  Apply to Canvas
                </Button>
              </div>
            ) : (
              <div
                data-ocid="admin.empty_state"
                className="flex items-center justify-center h-full text-muted-foreground text-sm p-8 text-center"
              >
                Select or create a preset to edit
              </div>
            )}
          </ScrollArea>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function SliderField({
  label,
  value,
  min,
  max,
  unit,
  ocid,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  ocid: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-xs text-muted-foreground uppercase tracking-wider">
          {label}
        </Label>
        <span className="text-xs text-muted-foreground">
          {value}
          {unit}
        </span>
      </div>
      <Slider
        data-ocid={ocid}
        min={min}
        max={max}
        step={1}
        value={[value]}
        onValueChange={([v]) => onChange(v)}
        className="w-full"
      />
    </div>
  );
}

function ToggleRow({
  label,
  id,
  checked,
  ocid,
  onChange,
}: {
  label: string;
  id: string;
  checked: boolean;
  ocid: string;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <Label
        htmlFor={id}
        className="text-xs text-muted-foreground cursor-pointer"
      >
        {label}
      </Label>
      <Switch
        id={id}
        data-ocid={ocid}
        checked={checked}
        onCheckedChange={onChange}
      />
    </div>
  );
}
