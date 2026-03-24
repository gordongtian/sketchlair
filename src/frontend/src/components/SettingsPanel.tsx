import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Download, Moon, MousePointer2, Upload, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const THEME_KEY = "heavybrush-theme";
const ACCENT_KEY = "heavybrush-accent";

interface AccentSwatch {
  label: string;
  oklch: string; // raw L C H params
  family: "warm" | "neutral" | "cool";
}

const ACCENT_SWATCHES: AccentSwatch[] = [
  { label: "Rust", oklch: "0.58 0.18 30", family: "warm" },
  { label: "Amber", oklch: "0.72 0.18 50", family: "warm" },
  { label: "Stone", oklch: "0.62 0.05 60", family: "neutral" },
  { label: "Slate", oklch: "0.55 0.03 250", family: "neutral" },
  { label: "Teal", oklch: "0.62 0.14 195", family: "cool" },
  { label: "Indigo", oklch: "0.62 0.14 275", family: "cool" },
];

function applyAccent(oklch: string) {
  const el = document.documentElement;
  el.style.setProperty("--primary", oklch);
  el.style.setProperty("--accent", oklch);
  el.style.setProperty("--ring", oklch);
  el.style.setProperty("--sidebar-primary", oklch);
  el.style.setProperty("--sidebar-ring", oklch);
  el.style.setProperty("--chart-1", oklch);
}

export interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
  onExportBrushes: () => void;
  onImportBrushes: (file: File) => void;
  cursorType: "circle" | "brush-outline";
  cursorCrosshair: boolean;
  onCursorSettingsChange: (
    type: "circle" | "brush-outline",
    crosshair: boolean,
  ) => void;
}

export function SettingsPanel({
  open,
  onClose,
  onExportBrushes,
  onImportBrushes,
  cursorType,
  cursorCrosshair,
  onCursorSettingsChange,
}: SettingsPanelProps) {
  const [darkMode, setDarkMode] = useState(() => {
    const stored = localStorage.getItem(THEME_KEY);
    return stored === "dark";
  });

  const [accentIndex, setAccentIndex] = useState(() => {
    const stored = localStorage.getItem(ACCENT_KEY);
    const idx = stored !== null ? Number.parseInt(stored, 10) : 1; // default: Amber
    return Number.isNaN(idx) ? 1 : idx;
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    // Use pointerdown with capture:true so we catch canvas interactions
    // even when the canvas calls stopPropagation or uses pointer capture.
    const handlePointerDown = (e: PointerEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("pointerdown", handlePointerDown, {
      capture: true,
    });
    return () =>
      document.removeEventListener("pointerdown", handlePointerDown, {
        capture: true,
      });
  }, [open, onClose]);

  useEffect(() => {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === "dark") {
      document.documentElement.classList.add("dark");
      setDarkMode(true);
    } else {
      document.documentElement.classList.remove("dark");
      setDarkMode(false);
    }
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem(ACCENT_KEY);
    const idx = stored !== null ? Number.parseInt(stored, 10) : 1;
    const safeIdx = Number.isNaN(idx) ? 1 : idx;
    applyAccent(ACCENT_SWATCHES[safeIdx].oklch);
    setAccentIndex(safeIdx);
  }, []);

  const handleToggle = (checked: boolean) => {
    setDarkMode(checked);
    if (checked) {
      document.documentElement.classList.add("dark");
      localStorage.setItem(THEME_KEY, "dark");
    } else {
      document.documentElement.classList.remove("dark");
      localStorage.setItem(THEME_KEY, "light");
    }
  };

  const handleAccentSelect = (idx: number) => {
    setAccentIndex(idx);
    localStorage.setItem(ACCENT_KEY, String(idx));
    applyAccent(ACCENT_SWATCHES[idx].oklch);
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onImportBrushes(file);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  if (!open) return null;

  const families: Array<"warm" | "neutral" | "cool"> = [
    "warm",
    "neutral",
    "cool",
  ];

  return (
    <div
      data-ocid="settings.panel"
      ref={panelRef}
      className="fixed left-16 z-50 w-64 bg-popover border border-border rounded-lg shadow-lg overflow-y-auto"
      style={{
        bottom: "calc(5rem + env(safe-area-inset-bottom))",
        maxHeight:
          "calc(100vh - 8rem - env(safe-area-inset-bottom) - env(safe-area-inset-top))",
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <span className="text-sm font-semibold text-foreground">Settings</span>
        <button
          type="button"
          data-ocid="settings.close_button"
          onClick={onClose}
          className="w-6 h-6 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
        >
          <X size={14} />
        </button>
      </div>

      {/* Content */}
      <div className="px-4 py-3 space-y-4">
        {/* Dark Mode Toggle */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Moon size={14} className="text-muted-foreground" />
            <Label
              htmlFor="dark-mode-switch"
              className="text-sm text-foreground cursor-pointer"
            >
              Dark Mode
            </Label>
          </div>
          <Switch
            id="dark-mode-switch"
            data-ocid="settings.dark_mode_switch"
            checked={darkMode}
            onCheckedChange={handleToggle}
          />
        </div>

        {/* Accent Color */}
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground uppercase tracking-wide">
            Accent Color
          </Label>
          <div className="flex items-center gap-3">
            {families.map((family, fi) => (
              <div
                key={family}
                className={`flex gap-1.5 ${fi < families.length - 1 ? "pr-3 border-r border-border" : ""}`}
              >
                {ACCENT_SWATCHES.filter((s) => s.family === family).map(
                  (swatch, _si) => {
                    const globalIdx = ACCENT_SWATCHES.indexOf(swatch);
                    const isSelected = globalIdx === accentIndex;
                    return (
                      <button
                        key={swatch.label}
                        type="button"
                        data-ocid="settings.toggle"
                        title={swatch.label}
                        onClick={() => handleAccentSelect(globalIdx)}
                        className="relative w-6 h-6 rounded-full transition-transform hover:scale-110 focus:outline-none"
                        style={{ backgroundColor: `oklch(${swatch.oklch})` }}
                      >
                        {isSelected && (
                          <span
                            className="absolute inset-0 rounded-full"
                            style={{
                              boxShadow: `0 0 0 2px oklch(var(--popover)), 0 0 0 3.5px oklch(${swatch.oklch})`,
                            }}
                          />
                        )}
                      </button>
                    );
                  },
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Cursor Settings */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <MousePointer2 size={14} className="text-muted-foreground" />
            <Label className="text-xs text-muted-foreground uppercase tracking-wide">
              Cursor
            </Label>
          </div>
          <div className="flex gap-1">
            <button
              type="button"
              data-ocid="settings.cursor_circle_button"
              onClick={() => onCursorSettingsChange("circle", cursorCrosshair)}
              className={`flex-1 h-7 rounded text-xs border transition-colors ${
                cursorType === "circle"
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              Circle
            </button>
            <button
              type="button"
              data-ocid="settings.cursor_outline_button"
              onClick={() =>
                onCursorSettingsChange("brush-outline", cursorCrosshair)
              }
              className={`flex-1 h-7 rounded text-xs border transition-colors ${
                cursorType === "brush-outline"
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              Tip Outline
            </button>
          </div>
          <div className="flex items-center justify-between">
            <Label
              htmlFor="cursor-crosshair-switch"
              className="text-sm text-foreground cursor-pointer"
            >
              Crosshair
            </Label>
            <Switch
              id="cursor-crosshair-switch"
              data-ocid="settings.cursor_crosshair_switch"
              checked={cursorCrosshair}
              onCheckedChange={(checked) =>
                onCursorSettingsChange(cursorType, checked)
              }
            />
          </div>
        </div>

        {/* Export Brushes Button */}
        <button
          type="button"
          data-ocid="settings.export_button"
          onClick={onExportBrushes}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <Download size={14} />
          Export Brushes
        </button>

        {/* Import Brushes Button */}
        <button
          type="button"
          data-ocid="settings.import_button"
          onClick={handleImportClick}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <Upload size={14} />
          Import Brushes
        </button>

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".hbrush"
          data-ocid="settings.upload_button"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>
    </div>
  );
}
