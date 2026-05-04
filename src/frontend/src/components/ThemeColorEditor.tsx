import {
  hexToOklch,
  hexToRgb,
  hsvToRgb,
  oklchToHex,
  rgbToHsv,
} from "@/utils/colorUtils";
import {
  ALL_CSS_VAR_NAMES,
  type ThemeId,
  resetThemeToDefaults,
  setThemeOverride,
} from "@/utils/themeOverrides";
import { GripHorizontal, RotateCcw, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// ── Labels for each semantic variable ─────────────────────────────────────
const VAR_LABELS: Record<string, string> = {
  toolbar: "Toolbar",
  "sidebar-left": "Left Sidebar (Presets & Tools)",
  "sidebar-right": "Right Sidebar (Layers)",
  "sidebar-item": "Sidebar Item (Layer Rows)",
  accent: "Accent (Active Tool / Layer / Preset)",
  "canvas-bg": "Canvas Background",
  "slider-bg": "Slider Background",
  "slider-handle": "Slider Handle",
  "slider-highlight": "Slider Highlight",
  text: "Text",
  "accent-text": "Accent Text",
  "muted-text": "Muted Text",
  "highlighted-text": "Highlighted Text",
  outline: "Outline / Borders",
};

const THEME_LABELS: Record<string, string> = {
  light: "Light",
  dark: "Dark",
  "bubble-pop": "Bubble Pop",
  "all-business": "All Business",
  fireside: "Fireside",
  "sketchlair-95": "SketchLair 95",
  mainframe: "Mainframe",
  "rose-pine": "Rose Pine",
  "everforest-dark": "Everforest Dark",
  "everforest-light": "Everforest Light",
};

// Fixed section layout
const SECTIONS: { label: string; vars: string[] }[] = [
  {
    label: "Interface",
    vars: ["toolbar", "sidebar-left", "sidebar-right", "sidebar-item"],
  },
  {
    label: "Accent",
    vars: ["accent"],
  },
  {
    label: "Workspace",
    vars: ["canvas-bg", "outline"],
  },
  {
    label: "Sliders",
    vars: ["slider-bg", "slider-handle", "slider-highlight"],
  },
  {
    label: "Text",
    vars: ["text", "accent-text", "muted-text", "highlighted-text"],
  },
];

// ── Helpers ────────────────────────────────────────────────────────────────
function readCssVar(varName: string): string {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(`--${varName}`)
    .trim();
}

function varToHex(varName: string): string {
  const raw = readCssVar(varName);
  if (!raw) return "#808080";
  try {
    const parts = raw.trim().split(/\s+/).map(Number);
    if (parts.length < 3) return "#808080";
    return oklchToHex(parts[0], parts[1], parts[2]);
  } catch {
    return "#808080";
  }
}

// ── Inline HSV Color Picker ────────────────────────────────────────────────
const SV_W = 220;
const SV_H = 130;
const HUE_H = 14;

interface InlineHsvPickerProps {
  hex: string;
  onChange: (hex: string) => void;
}

function InlineHsvPicker({ hex, onChange }: InlineHsvPickerProps) {
  const svCanvasRef = useRef<HTMLCanvasElement>(null);
  const hueCanvasRef = useRef<HTMLCanvasElement>(null);
  const isDraggingSV = useRef(false);
  const isDraggingHue = useRef(false);

  // Parse current hex → HSV
  const [hsv, setHsv] = useState<[number, number, number]>(() => {
    const rgb = hexToRgb(hex);
    if (!rgb) return [0, 0, 0.5];
    return rgbToHsv(rgb[0], rgb[1], rgb[2]);
  });
  const [hexInput, setHexInput] = useState(hex);

  // Sync from outside when hex changes (e.g. different swatch selected)
  useEffect(() => {
    const rgb = hexToRgb(hex);
    if (!rgb) return;
    const newHsv = rgbToHsv(rgb[0], rgb[1], rgb[2]);
    setHsv(newHsv);
    setHexInput(hex);
  }, [hex]);

  const emitColor = useCallback(
    (h: number, s: number, v: number) => {
      const [r, g, b] = hsvToRgb(h, s, v);
      const newHex = `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
      setHexInput(newHex);
      onChange(newHex);
    },
    [onChange],
  );

  // Draw SV square
  const drawSV = useCallback(() => {
    const canvas = svCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    const [hr, hg, hb] = hsvToRgb(hsv[0], 1, 1);
    // White → hue
    const gradH = ctx.createLinearGradient(0, 0, w, 0);
    gradH.addColorStop(0, "#fff");
    gradH.addColorStop(1, `rgb(${hr},${hg},${hb})`);
    ctx.fillStyle = gradH;
    ctx.fillRect(0, 0, w, h);
    // Transparent → black
    const gradV = ctx.createLinearGradient(0, 0, 0, h);
    gradV.addColorStop(0, "rgba(0,0,0,0)");
    gradV.addColorStop(1, "rgba(0,0,0,1)");
    ctx.fillStyle = gradV;
    ctx.fillRect(0, 0, w, h);
  }, [hsv]);

  // Draw hue bar
  const drawHue = useCallback(() => {
    const canvas = hueCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    const grad = ctx.createLinearGradient(0, 0, w, 0);
    for (let i = 0; i <= 12; i++) {
      const hDeg = (i / 12) * 360;
      const [r, g, b] = hsvToRgb(hDeg, 1, 1);
      grad.addColorStop(i / 12, `rgb(${r},${g},${b})`);
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }, []);

  useEffect(() => {
    drawSV();
  }, [drawSV]);

  useEffect(() => {
    drawHue();
  }, [drawHue]);

  const getSVFromEvent = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    return [x, 1 - y] as [number, number];
  };

  const getHueFromEvent = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    return x * 360;
  };

  const handleSVPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    isDraggingSV.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    const [s, v] = getSVFromEvent(e);
    const newHsv: [number, number, number] = [hsv[0], s, v];
    setHsv(newHsv);
    emitColor(newHsv[0], newHsv[1], newHsv[2]);
  };

  const handleSVPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDraggingSV.current) return;
    const [s, v] = getSVFromEvent(e);
    const newHsv: [number, number, number] = [hsv[0], s, v];
    setHsv(newHsv);
    emitColor(newHsv[0], newHsv[1], newHsv[2]);
  };

  const handleSVPointerUp = () => {
    isDraggingSV.current = false;
  };

  const handleHuePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    isDraggingHue.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    const h = getHueFromEvent(e);
    const newHsv: [number, number, number] = [h, hsv[1], hsv[2]];
    setHsv(newHsv);
    emitColor(newHsv[0], newHsv[1], newHsv[2]);
  };

  const handleHuePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDraggingHue.current) return;
    const h = getHueFromEvent(e);
    const newHsv: [number, number, number] = [h, hsv[1], hsv[2]];
    setHsv(newHsv);
    emitColor(newHsv[0], newHsv[1], newHsv[2]);
  };

  const handleHuePointerUp = () => {
    isDraggingHue.current = false;
  };

  const handleHexInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setHexInput(val);
    const normalized = val.startsWith("#") ? val : `#${val}`;
    if (/^#[0-9a-fA-F]{6}$/.test(normalized)) {
      const rgb = hexToRgb(normalized);
      if (rgb) {
        const newHsv = rgbToHsv(rgb[0], rgb[1], rgb[2]);
        setHsv(newHsv);
        onChange(normalized);
      }
    }
  };

  const handleHexBlur = () => {
    // Reset to valid hex if user typed garbage
    setHexInput(hex);
  };

  const svX = hsv[1] * SV_W;
  const svY = (1 - hsv[2]) * SV_H;
  const hueX = (hsv[0] / 360) * SV_W;
  const [pr, pg, pb] = hsvToRgb(hsv[0], hsv[1], hsv[2]);
  const previewHex = `#${[pr, pg, pb].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;

  return (
    <div className="flex flex-col gap-2 px-3 py-2.5 border-b border-border/40">
      {/* SV square */}
      <div
        className="relative"
        style={{ width: SV_W, height: SV_H, touchAction: "none" }}
      >
        <canvas
          ref={svCanvasRef}
          width={SV_W}
          height={SV_H}
          style={{
            display: "block",
            borderRadius: 4,
            cursor: "crosshair",
            touchAction: "none",
          }}
          onPointerDown={handleSVPointerDown}
          onPointerMove={handleSVPointerMove}
          onPointerUp={handleSVPointerUp}
          onPointerCancel={handleSVPointerUp}
        />
        {/* Crosshair marker */}
        <div
          style={{
            position: "absolute",
            left: svX,
            top: svY,
            width: 12,
            height: 12,
            borderRadius: "50%",
            border: "2px solid white",
            boxShadow: "0 0 0 1px rgba(0,0,0,0.5)",
            transform: "translate(-50%, -50%)",
            pointerEvents: "none",
          }}
        />
      </div>

      {/* Hue bar */}
      <div
        className="relative"
        style={{ width: SV_W, height: HUE_H, touchAction: "none" }}
      >
        <canvas
          ref={hueCanvasRef}
          width={SV_W}
          height={HUE_H}
          style={{
            display: "block",
            borderRadius: 4,
            cursor: "ew-resize",
            touchAction: "none",
          }}
          onPointerDown={handleHuePointerDown}
          onPointerMove={handleHuePointerMove}
          onPointerUp={handleHuePointerUp}
          onPointerCancel={handleHuePointerUp}
        />
        {/* Hue thumb */}
        <div
          style={{
            position: "absolute",
            left: hueX,
            top: HUE_H / 2,
            width: 10,
            height: 10,
            borderRadius: "50%",
            border: "2px solid white",
            boxShadow: "0 0 0 1px rgba(0,0,0,0.5)",
            transform: "translate(-50%, -50%)",
            pointerEvents: "none",
          }}
        />
      </div>

      {/* Hex input + preview swatch */}
      <div className="flex items-center gap-2">
        <div
          style={{
            width: 22,
            height: 22,
            borderRadius: 4,
            backgroundColor: previewHex,
            border: "1px solid rgba(0,0,0,0.2)",
            flexShrink: 0,
          }}
        />
        <input
          type="text"
          value={hexInput}
          onChange={handleHexInput}
          onBlur={handleHexBlur}
          maxLength={7}
          spellCheck={false}
          className="flex-1 text-xs px-2 py-1 rounded border border-border bg-transparent text-foreground font-mono outline-none focus:ring-1 focus:ring-[oklch(var(--accent)/0.5)]"
          placeholder="#rrggbb"
        />
      </div>
    </div>
  );
}

// ── Color Row ──────────────────────────────────────────────────────────────
function ColorRow({
  varName,
  onSwatchClick,
  isActive,
}: {
  varName: string;
  onSwatchClick: (varName: string) => void;
  isActive: boolean;
}) {
  const hex = varToHex(varName);
  const label = VAR_LABELS[varName] ?? varName;

  return (
    <div
      className={`flex items-center justify-between py-1.5 px-2 rounded transition-colors ${
        isActive
          ? "bg-[oklch(var(--accent)/0.15)] ring-1 ring-[oklch(var(--accent)/0.4)]"
          : "hover:bg-[oklch(var(--sidebar-item))]"
      }`}
    >
      <span className="text-xs text-foreground/80 select-none">{label}</span>
      <button
        type="button"
        title={`Edit ${label}`}
        aria-label={`Edit color for ${label}`}
        onClick={() => onSwatchClick(varName)}
        className="flex-shrink-0 ml-2 rounded cursor-pointer border border-border/60 hover:scale-110 transition-transform"
        style={{
          width: 22,
          height: 22,
          backgroundColor: hex,
          outline: isActive ? "2px solid oklch(var(--accent))" : "none",
          outlineOffset: 1,
        }}
      />
    </div>
  );
}

// ── Section ────────────────────────────────────────────────────────────────
function Section({
  section,
  activeVar,
  onSwatchClick,
}: {
  section: { label: string; vars: string[] };
  activeVar: string | null;
  onSwatchClick: (varName: string) => void;
}) {
  return (
    <div className="border-b border-border/40 last:border-b-0">
      <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {section.label}
      </div>
      <div className="px-1 pb-1.5">
        {section.vars.map((v) => (
          <ColorRow
            key={v}
            varName={v}
            onSwatchClick={onSwatchClick}
            isActive={activeVar === v}
          />
        ))}
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
interface ThemeColorEditorProps {
  themeId: string;
  onClose: () => void;
}

export function ThemeColorEditor({ themeId, onClose }: ThemeColorEditorProps) {
  const safeThemeId = themeId as ThemeId;

  const [pos, setPos] = useState<{ x: number; y: number }>(() => ({
    x: Math.max(0, window.innerWidth / 2 - 190),
    y: Math.max(0, window.innerHeight / 2 - 300),
  }));
  const dragRef = useRef<{
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);

  // Active variable + picker state
  const [activeVar, setActiveVar] = useState<string | null>(null);
  const [pickerHex, setPickerHex] = useState("#808080");

  // Refresh counter to force re-render of swatches after color change
  const [refreshKey, setRefreshKey] = useState(0);

  const handleSwatchClick = useCallback((varName: string) => {
    const hex = varToHex(varName);
    setActiveVar(varName);
    setPickerHex(hex);
  }, []);

  const handleColorChange = useCallback(
    (hex: string) => {
      if (!activeVar) return;
      setPickerHex(hex);
      try {
        const [L, C, H] = hexToOklch(hex);
        const oklchStr = `${L.toFixed(4)} ${C.toFixed(4)} ${H.toFixed(2)}`;
        setThemeOverride(safeThemeId, activeVar, oklchStr);
        document.documentElement.style.setProperty(`--${activeVar}`, oklchStr);
        setRefreshKey((k) => k + 1);
      } catch {
        // ignore invalid colors
      }
    },
    [activeVar, safeThemeId],
  );

  const handleTitlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if ((e.target as HTMLElement).closest("button")) return;
      e.preventDefault();
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        origX: pos.x,
        origY: pos.y,
      };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    [pos],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      const newX = Math.max(
        0,
        Math.min(window.innerWidth - 380, dragRef.current.origX + dx),
      );
      const newY = Math.max(
        0,
        Math.min(window.innerHeight - 60, dragRef.current.origY + dy),
      );
      setPos({ x: newX, y: newY });
    },
    [],
  );

  const handlePointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  const handleReset = useCallback(() => {
    // Re-fetch the bundled .sltheme file and restore only the shipped defaults
    // for this theme, discarding any user edits. This is the correct behaviour
    // because the shipped defaults ARE stored as overrides — simply clearing
    // overrides would strip the built-in palette and fall back to the bare CSS
    // baseline (which looks like the Light theme for all non-Light themes).
    void resetThemeToDefaults(safeThemeId).then(() => {
      setActiveVar(null);
      setRefreshKey((k) => k + 1);
    });
  }, [safeThemeId]);

  const editor = (
    <div
      data-ocid="theme_editor.panel"
      style={{
        position: "fixed",
        left: pos.x,
        top: pos.y,
        zIndex: 200,
        width: 280,
        maxHeight: "90vh",
        display: "flex",
        flexDirection: "column",
        pointerEvents: "auto",
        // Explicit background bypasses the --popover→--toolbar CSS variable
        // chain that Safari/WebKit can fail to resolve inside oklch(), causing
        // the panel to render transparent on iPad.
        backgroundColor: "oklch(var(--toolbar))",
        // Force a compositor layer so iOS Safari paints the background
        // correctly when position:fixed sits over a transformed canvas.
        WebkitTransform: "translateZ(0)",
        transform: "translateZ(0)",
      }}
      className="border border-border rounded-lg shadow-2xl overflow-hidden"
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* Title bar */}
      <div
        data-ocid="theme_editor.drag_handle"
        onPointerDown={handleTitlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className="flex items-center justify-between px-3 py-2.5 border-b border-border cursor-grab active:cursor-grabbing select-none"
        style={{ touchAction: "none" }}
      >
        <div className="flex items-center gap-2">
          <GripHorizontal size={12} className="text-muted-foreground" />
          <span className="text-sm font-semibold text-foreground">
            Edit Theme Colors
          </span>
          <span className="text-xs text-muted-foreground">
            — {THEME_LABELS[themeId] ?? themeId}
          </span>
        </div>
        <button
          type="button"
          data-ocid="theme_editor.close_button"
          onClick={onClose}
          className="w-6 h-6 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
        >
          <X size={13} />
        </button>
      </div>

      {/* Inline HSV color picker — always visible, updates when swatch is clicked */}
      {activeVar ? (
        <InlineHsvPicker
          key={activeVar}
          hex={pickerHex}
          onChange={handleColorChange}
        />
      ) : (
        <div className="px-3 py-3 border-b border-border/40 text-xs text-muted-foreground italic">
          ← Select a color swatch to edit it
        </div>
      )}

      {/* Scrollable section body */}
      <div
        className="overflow-y-auto flex-1"
        style={{ overscrollBehavior: "contain" }}
      >
        <div key={`${safeThemeId}-${refreshKey}`}>
          {SECTIONS.map((s) => (
            <Section
              key={s.label}
              section={s}
              activeVar={activeVar}
              onSwatchClick={handleSwatchClick}
            />
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-border/40 px-3 py-2 bg-muted/10 flex justify-end">
        <button
          type="button"
          data-ocid="theme_editor.reset_button"
          onClick={handleReset}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 border border-border/60 hover:border-destructive/30 transition-colors"
        >
          <RotateCcw size={11} />
          Reset to Defaults
        </button>
      </div>
    </div>
  );

  return createPortal(editor, document.body);
}
