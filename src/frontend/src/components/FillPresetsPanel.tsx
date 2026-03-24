import { ScrollArea } from "@/components/ui/scroll-area";
import { Blend, Droplets, Paintbrush } from "lucide-react";

export type FillMode = "flood" | "gradient" | "lasso";
export type GradientMode = "linear" | "radial";

export interface FillSettings {
  tolerance: number;
  gradientMode: GradientMode;
  colorJitter: number;
}

interface FillPresetsPanelProps {
  fillMode: FillMode;
  fillSettings: FillSettings;
  onSelectMode: (mode: FillMode) => void;
  onSettingsChange: (settings: FillSettings) => void;
  onClose: () => void;
}

const FILL_TOOLS: { mode: FillMode; label: string; icon: React.ReactNode }[] = [
  { mode: "flood", label: "Flood Fill", icon: <Droplets size={14} /> },
  { mode: "gradient", label: "Gradient Fill", icon: <Blend size={14} /> },
  { mode: "lasso", label: "Lasso Fill", icon: <Paintbrush size={14} /> },
];

function SliderRow({
  label,
  value,
  min,
  max,
  ocid,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  ocid: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        <input
          type="number"
          min={min}
          max={max}
          value={value}
          onChange={(e) =>
            onChange(Math.max(min, Math.min(max, Number(e.target.value))))
          }
          className="w-12 text-xs text-right bg-muted/50 border border-border rounded px-1 py-0.5 text-foreground"
        />
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        data-ocid={ocid}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1.5 accent-primary cursor-pointer"
      />
    </div>
  );
}

export function FillPresetsPanel({
  fillMode,
  fillSettings,
  onSelectMode,
  onSettingsChange,
}: FillPresetsPanelProps) {
  return (
    <div
      className="flex flex-col border-r border-border bg-card h-full"
      style={{ width: "100%", minWidth: 0 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border shrink-0">
        <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Fill Tools
        </span>
      </div>

      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-1 p-2">
          {/* Mode selectors */}
          {FILL_TOOLS.map((item, idx) => {
            const isActive = item.mode === fillMode;
            return (
              <button
                key={item.mode}
                type="button"
                data-ocid={`fill_presets.tool.item.${idx + 1}`}
                onClick={() => onSelectMode(item.mode)}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-md text-xs font-medium w-full text-left transition-all duration-100 ${
                  isActive
                    ? "bg-primary/10 border border-primary text-primary"
                    : "border border-border bg-muted/30 hover:bg-muted/60 text-foreground"
                }`}
              >
                <span
                  className={
                    isActive ? "text-primary" : "text-muted-foreground"
                  }
                >
                  {item.icon}
                </span>
                <span>{item.label}</span>
                {isActive && (
                  <span className="ml-auto text-primary opacity-70">✓</span>
                )}
              </button>
            );
          })}

          {/* Settings for active mode */}
          <div className="mt-2 border-t border-border pt-2 flex flex-col gap-3 px-1">
            {fillMode === "flood" && (
              <>
                <SliderRow
                  label="Tolerance"
                  value={fillSettings.tolerance}
                  min={0}
                  max={100}
                  ocid="fill_presets.tolerance.input"
                  onChange={(v) =>
                    onSettingsChange({ ...fillSettings, tolerance: v })
                  }
                />
                <SliderRow
                  label="Color Jitter"
                  value={fillSettings.colorJitter}
                  min={0}
                  max={100}
                  ocid="fill_presets.flood_color_jitter.input"
                  onChange={(v) =>
                    onSettingsChange({ ...fillSettings, colorJitter: v })
                  }
                />
              </>
            )}

            {fillMode === "gradient" && (
              <>
                <div className="flex flex-col gap-2">
                  <span className="text-xs text-muted-foreground">Mode</span>
                  <div className="flex gap-1">
                    {(["linear", "radial"] as GradientMode[]).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        data-ocid={`fill_presets.gradient_mode.${mode}`}
                        onClick={() =>
                          onSettingsChange({
                            ...fillSettings,
                            gradientMode: mode,
                          })
                        }
                        className={`flex-1 py-1 text-xs rounded border transition-colors ${
                          fillSettings.gradientMode === mode
                            ? "bg-primary/10 border-primary text-primary"
                            : "border-border bg-muted/30 text-foreground hover:bg-muted/60"
                        }`}
                      >
                        {mode.charAt(0).toUpperCase() + mode.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
                <SliderRow
                  label="Color Jitter"
                  value={fillSettings.colorJitter}
                  min={0}
                  max={100}
                  ocid="fill_presets.gradient_color_jitter.input"
                  onChange={(v) =>
                    onSettingsChange({ ...fillSettings, colorJitter: v })
                  }
                />
              </>
            )}

            {fillMode === "lasso" && (
              <div className="flex flex-col gap-1.5">
                <SliderRow
                  label="Color Jitter"
                  value={fillSettings.colorJitter}
                  min={0}
                  max={100}
                  ocid="fill_presets.color_jitter.input"
                  onChange={(v) =>
                    onSettingsChange({ ...fillSettings, colorJitter: v })
                  }
                />
                <p className="text-xs text-muted-foreground/70 leading-tight mt-0.5">
                  Draw a closed lasso shape to fill with color jitter applied.
                </p>
              </div>
            )}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
