import { Label } from "@/components/ui/label";
import type { PreferencesManager } from "@/hooks/usePreferences";
import {
  type ThemeId,
  applyThemeOverrides,
  exportAllThemes,
  importThemes,
} from "@/utils/themeOverrides";
import {
  Activity,
  Cloud,
  Download,
  Hand,
  Keyboard,
  Loader2,
  LogIn,
  LogOut,
  Monitor,
  Moon,
  MousePointer2,
  Palette,
  Smartphone,
  Upload,
  User,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { HotkeyEditor } from "./HotkeyEditor";
import { PressureCurveEditor } from "./PressureCurveEditor";
import { ThemeColorEditor } from "./ThemeColorEditor";

const THEME_KEY = "sl-theme";

const THEMES: { id: ThemeId; label: string }[] = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "bubble-pop", label: "Bubble Pop" },
  { id: "all-business", label: "All Business" },
  { id: "fireside", label: "Fireside" },
  { id: "sketchlair-95", label: "SketchLair 95" },
  { id: "mainframe", label: "Mainframe" },
  { id: "rose-pine", label: "Rose Pine" },
  { id: "everforest-dark", label: "Everforest Dark" },
  { id: "everforest-light", label: "Everforest Light" },
];

const ALL_THEME_CLASSES = [
  "dark",
  "theme-bubble-pop",
  "theme-all-business",
  "theme-fireside",
  "theme-sketchlair-95",
  "theme-mainframe",
  "theme-rose-pine",
  "theme-everforest-dark",
  "theme-everforest-light",
];

function formatRelativeTime(ts: number | null): string {
  if (ts === null) return "Never";
  const diffMs = Date.now() - ts;
  const diffSecs = Math.floor(diffMs / 1000);
  if (diffSecs < 10) return "just now";
  if (diffSecs < 60) return `${diffSecs}s ago`;
  const diffMins = Math.floor(diffSecs / 60);
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return new Date(ts).toLocaleDateString();
}

function applyThemeClass(themeId: ThemeId) {
  const el = document.documentElement;
  for (const cls of ALL_THEME_CLASSES) {
    el.classList.remove(cls);
  }
  if (themeId === "dark") {
    el.classList.add("dark");
  } else if (themeId !== "light") {
    el.classList.add(`theme-${themeId}`);
  }
}

export interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
  onExportBrushes: () => void;
  onImportBrushes: (file: File) => void;
  cursorType: "circle" | "brush-outline" | "crosshair";
  cursorCenter: "none" | "crosshair" | "dot";
  onCursorSettingsChange: (
    type: "circle" | "brush-outline" | "crosshair",
    center: "none" | "crosshair" | "dot",
  ) => void;
  pressureCurve: [number, number, number, number];
  onPressureCurveChange: (v: [number, number, number, number]) => void;
  isLoggedIn?: boolean;
  principalId?: string | null;
  onLogin?: () => void;
  onLogout?: () => void;
  isMobile?: boolean;
  forceDesktop?: boolean;
  onForceDesktopChange?: (v: boolean) => void;
  leftHanded?: boolean;
  onLeftHandedChange?: (v: boolean) => void;
  /** Centralized preferences manager — optional; enables canister sync */
  preferences?: PreferencesManager;
}

export function SettingsPanel({
  open,
  onClose,
  onExportBrushes,
  onImportBrushes,
  cursorType,
  cursorCenter,
  onCursorSettingsChange,
  pressureCurve,
  onPressureCurveChange,
  isLoggedIn = false,
  principalId = null,
  onLogin,
  onLogout,
  isMobile = false,
  forceDesktop = false,
  onForceDesktopChange,
  leftHanded = false,
  onLeftHandedChange,
  preferences,
}: SettingsPanelProps) {
  const [themeId, setThemeId] = useState<ThemeId>(() => {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored && THEMES.some((t) => t.id === stored)) return stored as ThemeId;
    return "light";
  });
  const [showThemeEditor, setShowThemeEditor] = useState(false);
  const [showHotkeyEditor, setShowHotkeyEditor] = useState(false);
  // Tick counter so relative timestamps re-render every 30s
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const themeFileInputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number }>(() => ({
    x: Math.max(0, Math.round(window.innerWidth / 2 - 175)),
    y: Math.max(0, Math.round(window.innerHeight / 3 - 100)),
  }));
  const dragRef = useRef<{
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);

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
      setPos({
        x: Math.max(
          0,
          Math.min(window.innerWidth - 256, dragRef.current.origX + dx),
        ),
        y: Math.max(
          0,
          Math.min(window.innerHeight - 60, dragRef.current.origY + dy),
        ),
      });
    },
    [],
  );

  const handlePointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (e: PointerEvent) => {
      // Don't close if the theme editor or hotkey editor is open and the click is inside it
      const editorEl = document.querySelector(
        "[data-ocid='theme_editor.panel']",
      );
      if (editorEl?.contains(e.target as Node)) return;
      const hotkeyEditorEl = document.querySelector(
        "[data-ocid='hotkey_editor.panel']",
      );
      if (hotkeyEditorEl?.contains(e.target as Node)) return;
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

  // Apply saved theme on mount
  useEffect(() => {
    const stored = localStorage.getItem(THEME_KEY);
    const id: ThemeId = (
      stored && THEMES.some((t) => t.id === stored) ? stored : "light"
    ) as ThemeId;
    applyThemeClass(id);
    applyThemeOverrides(id);
    setThemeId(id);
  }, []);

  // Sync theme state when canister preferences load (initial login/visit) OR after Download
  const prefsTheme = preferences?.settings.theme;
  useEffect(() => {
    if (!prefsTheme) return;
    if (THEMES.some((t) => t.id === prefsTheme)) {
      const id = prefsTheme as ThemeId;
      setThemeId(id);
      localStorage.setItem(THEME_KEY, id);
      applyThemeClass(id);
      applyThemeOverrides(id);
    }
  }, [prefsTheme]);

  const prefImportRef = useRef<HTMLInputElement>(null);

  const handleThemeChange = (id: ThemeId) => {
    setThemeId(id);
    localStorage.setItem(THEME_KEY, id);
    applyThemeClass(id);
    applyThemeOverrides(id);
    // Sync to canister (discrete write — fires immediately)
    preferences
      ?.updateSettings({ theme: id })
      .catch((e) => console.warn("[SettingsPanel] Failed to sync theme:", e));
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

  // Export all theme overrides as .sltheme
  const handleExportThemes = () => {
    const data = exportAllThemes();
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "sketchlair-themes.sltheme";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1000);
  };

  // Import themes from .sltheme file
  const handleImportThemesClick = () => {
    themeFileInputRef.current?.click();
  };

  const handleThemeFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target?.result as string);
        importThemes(parsed, themeId);
      } catch {
        // invalid file, ignore
      }
    };
    reader.readAsText(file);
    if (themeFileInputRef.current) {
      themeFileInputRef.current.value = "";
    }
  };

  // Show interface section if device is touch OR if forceDesktop was previously set (so user can re-enable)
  const showInterfaceSection = isMobile || forceDesktop;

  if (!open) return null;

  return (
    <>
      <div
        data-ocid="settings.panel"
        ref={panelRef}
        className="fixed z-50 w-64 border border-border rounded-lg shadow-lg overflow-y-auto"
        style={{
          left: pos.x,
          top: pos.y,
          maxHeight: "calc(100vh - 8rem)",
          backgroundColor: "oklch(var(--toolbar))",
          WebkitTransform: "translateZ(0)",
          transform: "translateZ(0)",
        }}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3 border-b border-border"
          style={{ cursor: "move", userSelect: "none" }}
          onPointerDown={handleTitlePointerDown}
        >
          <span className="text-sm font-semibold text-foreground">
            Settings
          </span>
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
          {/* Account Section */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <User size={14} className="text-muted-foreground" />
              <span className="text-xs text-muted-foreground uppercase tracking-wide font-medium">
                Account
              </span>
            </div>
            {isLoggedIn ? (
              <div className="flex items-center gap-2">
                <div
                  className="flex-1 min-w-0 px-2 py-1.5 rounded text-xs font-mono text-muted-foreground border border-border truncate"
                  style={{ backgroundColor: "oklch(var(--sidebar-left))" }}
                >
                  {principalId
                    ? `${principalId.substring(0, 10)}...`
                    : "Logged in"}
                </div>
                <button
                  type="button"
                  data-ocid="settings.close_button"
                  onClick={onLogout}
                  title="Log out"
                  className="shrink-0 flex items-center gap-1 px-2 py-1.5 rounded text-xs border border-border text-muted-foreground hover:text-foreground transition-colors"
                  style={{ backgroundColor: "oklch(var(--sidebar-left))" }}
                >
                  <LogOut size={12} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                data-ocid="settings.primary_button"
                onClick={onLogin}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded text-sm font-medium transition-colors"
                style={{
                  backgroundColor: "oklch(var(--accent))",
                  color: "oklch(var(--accent-text))",
                }}
              >
                <LogIn size={14} />
                Log in with Internet Identity
              </button>
            )}
          </div>
          {/* Theme Selector */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Moon size={14} className="text-muted-foreground" />
              <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                Theme
              </Label>
            </div>
            <select
              value={themeId}
              onChange={(e) => handleThemeChange(e.target.value as ThemeId)}
              className="w-full h-8 px-2 rounded text-sm border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer"
            >
              {THEMES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>

            {/* Edit Theme Colors button */}
            <button
              type="button"
              data-ocid="settings.edit_theme_button"
              onClick={() => setShowThemeEditor((v) => !v)}
              className={`w-full flex items-center gap-2 px-3 py-1.5 rounded text-xs border transition-colors ${
                showThemeEditor
                  ? "bg-primary/10 border-primary/40 text-primary"
                  : "border-border/60 text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              <Palette size={12} />
              Edit Theme Colors
            </button>

            {/* Edit Hotkeys button */}
            <button
              type="button"
              data-ocid="settings.edit_hotkeys_button"
              onClick={() => setShowHotkeyEditor((v) => !v)}
              className={`w-full flex items-center gap-2 px-3 py-1.5 rounded text-xs border transition-colors ${
                showHotkeyEditor
                  ? "bg-primary/10 border-primary/40 text-primary"
                  : "border-border/60 text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              <Keyboard size={12} />
              Edit Hotkeys
            </button>
          </div>

          {/* Cursor Settings */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <MousePointer2 size={14} className="text-muted-foreground" />
              <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                Cursor
              </Label>
            </div>
            <Label className="text-xs text-muted-foreground">
              Cursor Outline
            </Label>
            <div className="flex gap-1">
              <button
                type="button"
                data-ocid="settings.cursor_circle_button"
                onClick={() => onCursorSettingsChange("circle", cursorCenter)}
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
                  onCursorSettingsChange("brush-outline", cursorCenter)
                }
                className={`flex-1 h-7 rounded text-xs border transition-colors ${
                  cursorType === "brush-outline"
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
              >
                Tip Outline
              </button>
              <button
                type="button"
                data-ocid="settings.cursor_crosshair_outline_button"
                onClick={() =>
                  onCursorSettingsChange("crosshair", cursorCenter)
                }
                className={`flex-1 h-7 rounded text-xs border transition-colors ${
                  cursorType === "crosshair"
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
              >
                Crosshair
              </button>
            </div>
            <Label className="text-xs text-muted-foreground mt-1">
              Cursor Center
            </Label>
            <div className="flex gap-1">
              <button
                type="button"
                data-ocid="settings.cursor_center_none_button"
                onClick={() => onCursorSettingsChange(cursorType, "none")}
                className={`flex-1 h-7 rounded text-xs border transition-colors ${
                  cursorCenter === "none"
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
              >
                None
              </button>
              <button
                type="button"
                data-ocid="settings.cursor_center_crosshair_button"
                onClick={() => onCursorSettingsChange(cursorType, "crosshair")}
                className={`flex-1 h-7 rounded text-xs border transition-colors ${
                  cursorCenter === "crosshair"
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
              >
                Crosshair
              </button>
              <button
                type="button"
                data-ocid="settings.cursor_center_dot_button"
                onClick={() => onCursorSettingsChange(cursorType, "dot")}
                className={`flex-1 h-7 rounded text-xs border transition-colors ${
                  cursorCenter === "dot"
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
              >
                Dot
              </button>
            </div>
          </div>

          {/* Pressure Curve */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Activity size={14} className="text-muted-foreground" />
              <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                Pressure Curve
              </Label>
            </div>
            <PressureCurveEditor
              value={pressureCurve}
              onChange={onPressureCurveChange}
            />
          </div>

          {/* Interface Section (mobile only) */}
          {showInterfaceSection && (
            <div className="space-y-2 border-t border-border/40 pt-3">
              <div className="flex items-center gap-2">
                <Smartphone size={14} className="text-muted-foreground" />
                <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                  Interface
                </Label>
              </div>

              {/* Desktop Version toggle */}
              <div className="flex items-center justify-between gap-2 py-1">
                <div className="flex items-start gap-2 min-w-0">
                  <Monitor
                    size={14}
                    className="text-muted-foreground shrink-0 mt-0.5"
                  />
                  <div className="min-w-0">
                    <div className="text-xs text-foreground font-medium">
                      Desktop Version
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Use full desktop layout
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  data-ocid="settings.desktop_version_toggle"
                  onClick={() => onForceDesktopChange?.(!forceDesktop)}
                  style={{
                    flexShrink: 0,
                    width: 36,
                    height: 20,
                    borderRadius: 10,
                    border: "none",
                    background: forceDesktop
                      ? "oklch(var(--accent))"
                      : "oklch(var(--muted))",
                    position: "relative",
                    cursor: "pointer",
                    transition: "background 0.2s",
                  }}
                  aria-pressed={forceDesktop}
                  aria-label="Desktop Version"
                >
                  <span
                    style={{
                      position: "absolute",
                      top: 2,
                      left: forceDesktop ? 18 : 2,
                      width: 16,
                      height: 16,
                      borderRadius: "50%",
                      background: forceDesktop
                        ? "oklch(var(--accent-text))"
                        : "oklch(var(--muted-foreground))",
                      transition: "left 0.15s",
                    }}
                  />
                </button>
              </div>

              {/* Left-handed Mode toggle */}
              <div className="flex items-center justify-between gap-2 py-1">
                <div className="flex items-start gap-2 min-w-0">
                  <Hand
                    size={14}
                    className="text-muted-foreground shrink-0 mt-0.5"
                  />
                  <div className="min-w-0">
                    <div className="text-xs text-foreground font-medium">
                      Left-handed Mode
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Mirror toolbar and sliders
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  data-ocid="settings.left_handed_toggle"
                  onClick={() => onLeftHandedChange?.(!leftHanded)}
                  style={{
                    flexShrink: 0,
                    width: 36,
                    height: 20,
                    borderRadius: 10,
                    border: "none",
                    background: leftHanded
                      ? "oklch(var(--accent))"
                      : "oklch(var(--muted))",
                    position: "relative",
                    cursor: "pointer",
                    transition: "background 0.2s",
                  }}
                  aria-pressed={leftHanded}
                  aria-label="Left-handed Mode"
                >
                  <span
                    style={{
                      position: "absolute",
                      top: 2,
                      left: leftHanded ? 18 : 2,
                      width: 16,
                      height: 16,
                      borderRadius: "50%",
                      background: leftHanded
                        ? "oklch(var(--accent-text))"
                        : "oklch(var(--muted-foreground))",
                      transition: "left 0.15s",
                    }}
                  />
                </button>
              </div>
            </div>
          )}

          {/* Brush Export/Import */}
          <button
            type="button"
            data-ocid="settings.export_button"
            onClick={onExportBrushes}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <Download size={14} />
            Export Brushes
          </button>

          <button
            type="button"
            data-ocid="settings.import_button"
            onClick={handleImportClick}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <Upload size={14} />
            Import Brushes
          </button>

          {/* Preferences sync section */}
          <div className="border-t border-border/40 pt-3 space-y-1">
            <Label className="text-xs text-muted-foreground uppercase tracking-wide block mb-2">
              Preferences
            </Label>
            {!isLoggedIn && (
              <div
                data-ocid="settings.sync_notice"
                className="flex items-start gap-2 px-2 py-2 rounded text-xs text-muted-foreground border border-border/30 bg-muted/10 mb-2"
              >
                <Cloud
                  size={12}
                  className="shrink-0 mt-0.5 text-muted-foreground/60"
                />
                <span>Sign in to save preferences across devices</span>
              </div>
            )}
            {isLoggedIn && (
              <div data-ocid="settings.sync_status" className="space-y-1.5">
                {/* Last uploaded / last downloaded — two separate lines */}
                <div className="px-1 py-1 space-y-1">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Upload
                      size={11}
                      className="shrink-0 text-muted-foreground/60"
                    />
                    <span className="truncate">
                      Last uploaded:{" "}
                      {preferences?.isUploadingSyncing ? (
                        <Loader2 size={11} className="inline animate-spin" />
                      ) : (
                        formatRelativeTime(preferences?.lastUploaded ?? null)
                      )}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Download
                      size={11}
                      className="shrink-0 text-muted-foreground/60"
                    />
                    <span className="truncate">
                      Last downloaded:{" "}
                      {preferences?.isDownloadingSyncing ? (
                        <Loader2 size={11} className="inline animate-spin" />
                      ) : (
                        formatRelativeTime(preferences?.lastDownloaded ?? null)
                      )}
                    </span>
                  </div>
                </div>
                {/* Per-direction error messages */}
                {preferences?.uploadError && (
                  <div
                    data-ocid="settings.sync_upload.error_state"
                    className="px-2 py-1.5 rounded text-xs text-destructive border border-destructive/30 bg-destructive/10"
                  >
                    {preferences.uploadError}
                  </div>
                )}
                {preferences?.downloadError && (
                  <div
                    data-ocid="settings.sync_download.error_state"
                    className="px-2 py-1.5 rounded text-xs text-destructive border border-destructive/30 bg-destructive/10"
                  >
                    {preferences.downloadError}
                  </div>
                )}
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    data-ocid="settings.sync_upload_button"
                    disabled={preferences?.isSyncing}
                    title="Push your local brushes and settings to the cloud"
                    aria-label="Push your local brushes and settings to the cloud"
                    onClick={() => preferences?.syncUpload()}
                    className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded text-xs border border-border/60 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {preferences?.isUploadingSyncing ? (
                      <Loader2 size={11} className="animate-spin" />
                    ) : (
                      <Upload size={11} />
                    )}
                    Upload
                  </button>
                  <button
                    type="button"
                    data-ocid="settings.sync_download_button"
                    disabled={preferences?.isSyncing}
                    title="Pull your saved brushes and settings from the cloud"
                    aria-label="Pull your saved brushes and settings from the cloud"
                    onClick={() => preferences?.syncDownload()}
                    className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded text-xs border border-border/60 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {preferences?.isDownloadingSyncing ? (
                      <Loader2 size={11} className="animate-spin" />
                    ) : (
                      <Download size={11} />
                    )}
                    Download
                  </button>
                </div>
              </div>
            )}
            <button
              type="button"
              data-ocid="settings.export_preferences_button"
              onClick={() => preferences?.exportPreferences()}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <Download size={14} />
              Export Preferences
            </button>
            <button
              type="button"
              data-ocid="settings.import_preferences_button"
              onClick={() => prefImportRef.current?.click()}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <Upload size={14} />
              Import Preferences
            </button>
            <input
              ref={prefImportRef}
              type="file"
              accept=".json"
              className="hidden"
              data-ocid="settings.preferences_upload_button"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) preferences?.importPreferences(file);
                if (prefImportRef.current) prefImportRef.current.value = "";
              }}
            />
          </div>

          {/* Theme Export/Import */}
          <div className="border-t border-border/40 pt-3 space-y-1">
            <Label className="text-xs text-muted-foreground uppercase tracking-wide block mb-2">
              Themes
            </Label>
            <button
              type="button"
              data-ocid="settings.export_themes_button"
              onClick={handleExportThemes}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <Download size={14} />
              Export Themes
            </button>

            <button
              type="button"
              data-ocid="settings.import_themes_button"
              onClick={handleImportThemesClick}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <Upload size={14} />
              Import Themes
            </button>
          </div>

          {/* Hidden file inputs */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".hbrush"
            data-ocid="settings.upload_button"
            className="hidden"
            onChange={handleFileChange}
          />
          <input
            ref={themeFileInputRef}
            type="file"
            accept=".sltheme"
            data-ocid="settings.theme_upload_button"
            className="hidden"
            onChange={handleThemeFileChange}
          />
        </div>
      </div>

      {/* Theme Color Editor — rendered outside panel via portal inside ThemeColorEditor */}
      {showThemeEditor && (
        <ThemeColorEditor
          themeId={themeId}
          onClose={() => setShowThemeEditor(false)}
        />
      )}

      {/* Hotkey Editor — rendered outside panel via portal inside HotkeyEditor */}
      {showHotkeyEditor && (
        <HotkeyEditor
          onClose={() => setShowHotkeyEditor(false)}
          onHotkeysChanged={(updated) => {
            preferences
              ?.updateHotkeys({
                assignments: JSON.stringify(Object.values(updated)),
              })
              .catch((e) =>
                console.warn("[SettingsPanel] Failed to sync hotkeys:", e),
              );
          }}
        />
      )}
    </>
  );
}
