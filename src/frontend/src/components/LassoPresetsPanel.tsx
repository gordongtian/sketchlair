import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Circle,
  Lasso,
  Pentagon,
  RectangleHorizontal,
  Wand2,
  X,
} from "lucide-react";
import type { LassoMode } from "./Toolbar";

interface LassoPresetsPanelProps {
  lassoMode: LassoMode;
  onSelectMode: (mode: LassoMode) => void;
  onClose: () => void;
  accentColor?: string;
  isDarkMode?: boolean;
  wandTolerance?: number;
  wandContiguous?: boolean;
  onWandToleranceChange?: (v: number) => void;
  onWandContiguousChange?: (v: boolean) => void;
}

const LASSO_TOOLS: { mode: LassoMode; label: string; icon: React.ReactNode }[] =
  [
    {
      mode: "rect",
      label: "Rectangle Select",
      icon: <RectangleHorizontal size={14} />,
    },
    { mode: "ellipse", label: "Ellipse Select", icon: <Circle size={14} /> },
    { mode: "free", label: "Free Lasso", icon: <Lasso size={14} /> },
    { mode: "poly", label: "Polygon Lasso", icon: <Pentagon size={14} /> },
    { mode: "wand", label: "Magic Wand", icon: <Wand2 size={14} /> },
  ];

export function LassoPresetsPanel({
  lassoMode,
  onSelectMode,
  onClose,
  wandTolerance = 32,
  wandContiguous = true,
  onWandToleranceChange,
  onWandContiguousChange,
}: LassoPresetsPanelProps) {
  return (
    <div
      className="flex flex-col border-r border-border bg-card h-full"
      style={{ width: "100%", minWidth: 0 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border shrink-0">
        <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Selection Tools
        </span>
        <button
          type="button"
          data-ocid="lasso_presets.close_button"
          onClick={onClose}
          className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <X size={14} />
        </button>
      </div>

      {/* Tool list */}
      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-1 p-2">
          {LASSO_TOOLS.map((item, idx) => {
            const isActive = item.mode === lassoMode;
            return (
              <button
                key={item.mode}
                type="button"
                data-ocid={`lasso_presets.tool.item.${idx + 1}`}
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

          {/* Wand settings — shown when wand is active */}
          {lassoMode === "wand" && (
            <div className="mt-2 p-3 rounded-md bg-muted/40 border border-border flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-muted-foreground font-medium">
                    Tolerance
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={255}
                    value={wandTolerance}
                    onChange={(e) =>
                      onWandToleranceChange?.(
                        Math.max(0, Math.min(255, Number(e.target.value))),
                      )
                    }
                    className="w-12 text-[11px] text-right bg-muted border border-border rounded px-1 py-0.5"
                    data-ocid="lasso_presets.wand_tolerance.input"
                  />
                </div>
                <input
                  type="range"
                  min={0}
                  max={255}
                  value={wandTolerance}
                  onChange={(e) =>
                    onWandToleranceChange?.(Number(e.target.value))
                  }
                  className="w-full accent-primary"
                  data-ocid="lasso_presets.wand_tolerance_slider.input"
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-muted-foreground font-medium">
                  Contiguous
                </span>
                <button
                  type="button"
                  data-ocid="lasso_presets.wand_contiguous.toggle"
                  onClick={() => onWandContiguousChange?.(!wandContiguous)}
                  className={`w-8 h-4 rounded-full transition-colors relative ${
                    wandContiguous
                      ? "bg-primary"
                      : "bg-muted border border-border"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
                      wandContiguous ? "translate-x-4" : "translate-x-0.5"
                    }`}
                  />
                </button>
              </div>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
