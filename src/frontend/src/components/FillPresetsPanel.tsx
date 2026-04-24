import { ScrollArea } from "@/components/ui/scroll-area";
import { Blend, Droplets, Paintbrush } from "lucide-react";

export type FillMode = "flood" | "gradient" | "lasso";
export type GradientMode = "linear" | "radial";

export interface FillSettings {
  tolerance: number;
  gradientMode: GradientMode;
  contiguous: boolean;
  gapClosing: number;
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
        style={
          {
            "--fill-pct": `${((value - min) / (max - min)) * 100}%`,
          } as React.CSSProperties
        }
        className="w-full h-1.5 cursor-pointer"
      />
    </div>
  );
}

/** A simple, reliable toggle that doesn't rely on Tailwind arbitrary translate values */
function Toggle({
  checked,
  ocid,
  onChange,
}: {
  checked: boolean;
  ocid?: string;
  onChange: (v: boolean) => void;
}) {
  // Track: 40×20px  Knob: 16×16px  Padding: 2px each side
  // ON  translateX = 40 - 16 - 2 = 22px
  // OFF translateX = 2px
  return (
    <button
      type="button"
      data-ocid={ocid}
      onClick={() => onChange(!checked)}
      className={`relative w-10 h-5 rounded-full transition-colors flex-shrink-0 ${
        checked ? "bg-primary" : "bg-muted border border-border"
      }`}
    >
      <span
        className="absolute top-0.5 left-0 w-4 h-4 rounded-full bg-white shadow-sm transition-transform"
        style={{ transform: `translateX(${checked ? 22 : 2}px)` }}
      />
    </button>
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
                  label={`Gap Closing: ${fillSettings.gapClosing}`}
                  value={fillSettings.gapClosing}
                  min={0}
                  max={30}
                  ocid="fill_presets.gap_closing.input"
                  onChange={(v) =>
                    onSettingsChange({ ...fillSettings, gapClosing: v })
                  }
                />
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-muted-foreground font-medium">
                    Contiguous
                  </span>
                  <Toggle
                    checked={fillSettings.contiguous}
                    ocid="fill_presets.contiguous.toggle"
                    onChange={(v) =>
                      onSettingsChange({ ...fillSettings, contiguous: v })
                    }
                  />
                </div>
              </>
            )}

            {fillMode === "gradient" && (
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
            )}

            {fillMode === "lasso" && (
              <div className="flex flex-col gap-1.5">
                <p className="text-xs text-muted-foreground/70 leading-tight mt-0.5">
                  Draw a closed lasso shape to fill with the current color.
                </p>
              </div>
            )}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
