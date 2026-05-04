import { useInternetIdentity } from "@/hooks/useInternetIdentity";
import type { PreferencesManager } from "@/hooks/usePreferences";
import { loadHotkeys, saveHotkeys } from "@/utils/hotkeyConfig";
import {
  ALL_THEME_IDS,
  applyThemeOverrides,
  exportAllThemes,
  importThemes,
} from "@/utils/themeOverrides";
import type { ThemeId } from "@/utils/themeOverrides";
import { Download, Loader2, Upload, X } from "lucide-react";
import type { RefObject } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { HotkeyEditor } from "./HotkeyEditor";
import { PressureCurveEditor } from "./PressureCurveEditor";
import { ThemeColorEditor } from "./ThemeColorEditor";

// ── Theme label map ───────────────────────────────────────────────────────────
const THEME_LABELS: Record<ThemeId, string> = {
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

const THEME_KEY = "sl-theme";

const POPUP_WIDTH = 520;
const POPUP_APPROX_HEIGHT = 480;

// ── localStorage keys (match PaintingApp / useCursorSystem) ─────────────────
const LS_CURSOR_TYPE = "sk-cursor-type";
const LS_CURSOR_CENTER = "sk-cursor-center";
const LS_PRESSURE_CURVE = "sk-pressure-curve";

type CursorType = "circle" | "brush-outline" | "crosshair";
type CursorCenter = "none" | "crosshair" | "dot";
type CP = [number, number, number, number];

const DEFAULT_PRESSURE: CP = [0.25, 0.25, 0.75, 0.75];

// ── Helpers ──────────────────────────────────────────────────────────────────

function readCursorType(): CursorType {
  const v = localStorage.getItem(LS_CURSOR_TYPE);
  if (v === "brush-outline" || v === "crosshair") return v;
  return "circle";
}

function readCursorCenter(): CursorCenter {
  const v = localStorage.getItem(LS_CURSOR_CENTER);
  if (v === "crosshair" || v === "dot") return v;
  return "none";
}

function readPressureCurve(): CP {
  try {
    const s = localStorage.getItem(LS_PRESSURE_CURVE);
    if (s) return JSON.parse(s) as CP;
  } catch {}
  return DEFAULT_PRESSURE;
}

function writeCursorType(v: CursorType): void {
  localStorage.setItem(LS_CURSOR_TYPE, v);
  window.dispatchEvent(new Event("sl:cursor-settings-changed"));
}

function writeCursorCenter(v: CursorCenter): void {
  localStorage.setItem(LS_CURSOR_CENTER, v);
  window.dispatchEvent(new Event("sl:cursor-settings-changed"));
}

function writePressureCurve(v: CP): void {
  localStorage.setItem(LS_PRESSURE_CURVE, JSON.stringify(v));
  window.dispatchEvent(new Event("sl:pressure-curve-changed"));
}

function truncatePrincipal(p: string): string {
  if (p.length <= 16) return p;
  return `${p.slice(0, 8)}…${p.slice(-4)}`;
}

function formatTimestamp(ts: number | null): string {
  if (!ts) return "Never";
  const d = new Date(ts);
  return d.toLocaleString();
}

function getActiveThemeId(): ThemeId {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored && ALL_THEME_IDS.includes(stored as ThemeId)) {
    return stored as ThemeId;
  }
  const classes = Array.from(document.documentElement.classList);
  if (classes.includes("dark")) return "dark";
  for (const cls of classes) {
    if (cls.startsWith("theme-")) return cls.replace("theme-", "") as ThemeId;
  }
  return "light";
}

function applyTheme(themeId: ThemeId): void {
  localStorage.setItem(THEME_KEY, themeId);
  const el = document.documentElement;
  for (const cls of [...el.classList]) {
    if (cls.startsWith("theme-") || cls === "dark") el.classList.remove(cls);
  }
  if (themeId === "dark") {
    el.classList.add("dark");
  } else if (themeId !== "light") {
    el.classList.add(`theme-${themeId}`);
  }
  applyThemeOverrides(themeId);
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Toggle({
  checked,
  onChange,
  ocid,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  ocid: string;
  label: string;
}) {
  return (
    <button
      type="button"
      data-ocid={ocid}
      onClick={() => onChange(!checked)}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      style={{
        flexShrink: 0,
        width: 36,
        height: 20,
        borderRadius: 10,
        border: "none",
        background: checked ? "oklch(var(--accent))" : "oklch(var(--muted))",
        position: "relative",
        cursor: "pointer",
        transition: "background 0.2s",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 2,
          left: checked ? 18 : 2,
          width: 16,
          height: 16,
          borderRadius: "50%",
          background: checked
            ? "oklch(var(--accent-text))"
            : "oklch(var(--muted-foreground))",
          transition: "left 0.15s",
        }}
      />
    </button>
  );
}

function SectionHeader({ label }: { label: string }) {
  return (
    <>
      <div className="text-xs text-muted-foreground uppercase tracking-wide font-medium mt-1">
        {label}
      </div>
      <div className="w-full h-px bg-border mb-2" />
    </>
  );
}

function ActionRow({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-1.5 mb-3">{children}</div>;
}

function SmallBtn({
  onClick,
  ocid,
  title,
  children,
  variant = "secondary",
  disabled = false,
}: {
  onClick: () => void;
  ocid?: string;
  title?: string;
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "icon";
  disabled?: boolean;
}) {
  const base =
    "flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
  const styles =
    variant === "primary"
      ? `${base} bg-accent text-accent-foreground hover:bg-accent/90`
      : variant === "icon"
        ? `${base} w-7 h-7 justify-center p-0 bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground border border-border/60`
        : `${base} bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground border border-border/60`;
  return (
    <button
      type="button"
      className={styles}
      onClick={onClick}
      data-ocid={ocid}
      title={title}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
  isMobile?: boolean;
  leftHanded?: boolean;
  onLeftHandedChange?: (v: boolean) => void;
  uiModeOverride?: "mobile" | "desktop" | null;
  onUIModeOverrideChange?: (override: "mobile" | "desktop" | null) => void;
  showFOBSliders?: boolean;
  onShowFOBSlidersChange?: (v: boolean) => void;
  /** Ref to the canvas container — used to center the popup over the canvas area */
  containerRef?: RefObject<HTMLDivElement | null>;
  /** Centralized preferences manager for sync, export/import */
  preferences?: PreferencesManager;
}

// ── Main Component ────────────────────────────────────────────────────────────

export function SettingsPanel({
  open,
  onClose,
  isMobile = false,
  leftHanded = false,
  onLeftHandedChange,
  uiModeOverride: _uiModeOverride = null,
  onUIModeOverrideChange,
  showFOBSliders = true,
  onShowFOBSlidersChange,
  containerRef,
  preferences,
}: SettingsPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number }>(() => ({
    x: Math.max(0, Math.round(window.innerWidth / 2 - POPUP_WIDTH / 2)),
    y: Math.max(
      0,
      Math.round(window.innerHeight / 2 - POPUP_APPROX_HEIGHT / 2),
    ),
  }));
  const dragRef = useRef<{
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);
  // FIX 4: Guard flag — set to true immediately when the user makes a theme
  // selection to prevent the on-open useEffect from overwriting the freshly
  // committed state during the same render cycle.
  const themeUserSelectedRef = useRef(false);

  // ── Auth (via InternetIdentity context) ────────────────────────────────────
  // Note: isLoginSuccess is false on page reload with a persisted session even
  // when identity is valid. Always check identity directly for display logic.
  const { identity, login, clear, isLoginIdle } = useInternetIdentity();
  const isLoggedIn = !!identity && !identity.getPrincipal().isAnonymous();
  const principalText = isLoggedIn ? identity.getPrincipal().toString() : null;

  // ── Local UI state ──────────────────────────────────────────────────────────
  const [showTheme, setShowTheme] = useState(false);
  const [showHotkeys, setShowHotkeys] = useState(false);
  const [activeTheme, setActiveTheme] = useState<ThemeId>(getActiveThemeId);

  // ── Undo history limit ────────────────────────────────────────────────────
  const [undoHistoryLimit, setUndoHistoryLimit] = useState<number>(() => {
    try {
      const other = preferences?.settings?.otherSettings;
      if (other) {
        const parsed = JSON.parse(other) as Record<string, unknown>;
        const v = parsed.undoHistoryLimit;
        if (typeof v === "number" && v >= 10 && v <= 50) return v;
      }
    } catch {}
    return 20;
  });
  // Keep a ref so the close handler always has the latest value without
  // needing to be recreated on every slider tick.
  const undoHistoryLimitRef = useRef(undoHistoryLimit);
  undoHistoryLimitRef.current = undoHistoryLimit;

  // Cursor settings (localStorage)
  const [cursorType, setCursorTypeLocal] = useState<CursorType>(readCursorType);
  const [cursorCenter, setCursorCenterLocal] =
    useState<CursorCenter>(readCursorCenter);

  // Pressure curve (localStorage)
  const [pressureCurve, setPressureCurveLocal] =
    useState<CP>(readPressureCurve);

  // Re-read on open so values are always fresh
  useEffect(() => {
    if (!open) return;
    setCursorTypeLocal(readCursorType());
    setCursorCenterLocal(readCursorCenter());
    setPressureCurveLocal(readPressureCurve());
    // FIX 4: Only sync theme from localStorage when the panel opens, but skip
    // if the user actively selected a theme during this session (themeUserSelectedRef
    // is true) to prevent the localStorage read from overwriting the in-flight state
    // and causing a visible flash of the previous value.
    if (!themeUserSelectedRef.current) {
      setActiveTheme(getActiveThemeId());
    }
  }, [open]);

  // Hidden file inputs for import operations
  const themeImportRef = useRef<HTMLInputElement>(null);
  const hotkeyImportRef = useRef<HTMLInputElement>(null);
  const brushImportRef = useRef<HTMLInputElement>(null);
  const prefImportRef = useRef<HTMLInputElement>(null);

  // ── Drag logic ─────────────────────────────────────────────────────────────

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
          Math.min(window.innerWidth - POPUP_WIDTH, dragRef.current.origX + dx),
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

  // ── Save undo history limit and call onClose ──────────────────────────────

  const handleClose = useCallback(() => {
    const limit = undoHistoryLimitRef.current;
    // Persist the undo history limit into otherSettings JSON
    if (preferences) {
      try {
        const existing = preferences.settings?.otherSettings ?? "{}";
        const parsed = JSON.parse(existing) as Record<string, unknown>;
        parsed.undoHistoryLimit = limit;
        void preferences.updateSettings({
          otherSettings: JSON.stringify(parsed),
        });
      } catch {
        // malformed otherSettings — write a fresh object
        void preferences.updateSettings({
          otherSettings: JSON.stringify({ undoHistoryLimit: limit }),
        });
      }
    }
    // Notify PaintingApp so it can trim the live undo stack immediately
    document.dispatchEvent(
      new CustomEvent("sl:undo-history-limit-changed", { detail: { limit } }),
    );
    onClose();
  }, [onClose, preferences]);

  // ── Close on outside click ─────────────────────────────────────────────────

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        handleClose();
      }
    };
    // Use bubble phase (not capture) so that portalled sub-panels (HotkeyEditor,
    // ThemeColorEditor) can stopPropagation on their root divs and prevent this
    // handler from firing when the user clicks inside them.
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, handleClose]);

  // ── Center over canvas area when opening ───────────────────────────────────

  useEffect(() => {
    if (!open) return;
    const popupHeight = panelRef.current?.offsetHeight ?? POPUP_APPROX_HEIGHT;
    let x: number;
    let y: number;
    if (containerRef?.current) {
      const bounds = containerRef.current.getBoundingClientRect();
      x = bounds.left + bounds.width / 2 - POPUP_WIDTH / 2;
      y = bounds.top + bounds.height / 2 - popupHeight / 2;
    } else {
      x = window.innerWidth / 2 - POPUP_WIDTH / 2;
      y = window.innerHeight / 2 - popupHeight / 2;
    }
    setPos({
      x: Math.max(0, Math.min(window.innerWidth - POPUP_WIDTH, Math.round(x))),
      y: Math.max(0, Math.min(window.innerHeight - 60, Math.round(y))),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, containerRef]);

  // ── Cursor handlers ───────────────────────────────────────────────────────

  const handleCursorType = useCallback((v: CursorType) => {
    setCursorTypeLocal(v);
    writeCursorType(v);
  }, []);

  const handleCursorCenter = useCallback((v: CursorCenter) => {
    setCursorCenterLocal(v);
    writeCursorCenter(v);
  }, []);

  // ── Pressure curve handler ────────────────────────────────────────────────

  const handlePressureCurve = useCallback((v: CP) => {
    setPressureCurveLocal(v);
    writePressureCurve(v);
  }, []);

  // ── Theme selection ───────────────────────────────────────────────────────

  const handleThemeSelect = useCallback(
    (themeId: ThemeId) => {
      // FIX 4: Set local state FIRST (synchronously) before any async writes,
      // and mark the guard so the on-open useEffect won't overwrite this selection.
      themeUserSelectedRef.current = true;
      setActiveTheme(themeId);
      applyTheme(themeId);
      if (preferences) {
        preferences.settings.theme = themeId;
      }
    },
    [preferences],
  );

  // ── Theme export / import ─────────────────────────────────────────────────

  const handleThemeExport = useCallback(() => {
    const data = exportAllThemes();
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "sketchlair-themes.json";
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const handleThemeImport = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const data = JSON.parse(ev.target?.result as string) as Record<
            string,
            Record<string, string>
          >;
          const currentThemeId = getActiveThemeId();
          importThemes(data, currentThemeId);
        } catch {
          console.warn("[Settings] Theme import failed");
        }
      };
      reader.readAsText(file);
      if (themeImportRef.current) themeImportRef.current.value = "";
    },
    [],
  );

  // ── Hotkey export / import ────────────────────────────────────────────────

  const handleHotkeyExport = useCallback(() => {
    const data = loadHotkeys();
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "sketchlair-hotkeys.json";
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const handleHotkeyImport = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const data = JSON.parse(ev.target?.result as string) as Parameters<
            typeof saveHotkeys
          >[0];
          saveHotkeys(data);
          window.dispatchEvent(new Event("sl:hotkeys-updated"));
        } catch {
          console.warn("[Settings] Hotkey import failed");
        }
      };
      reader.readAsText(file);
      if (hotkeyImportRef.current) hotkeyImportRef.current.value = "";
    },
    [],
  );

  // ── Brush export / import (uses preferences manager) ─────────────────────

  const handleBrushExport = useCallback(() => {
    if (preferences) {
      void preferences.exportPreferences();
    }
  }, [preferences]);

  const handleBrushImport = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !preferences) return;
      void preferences.importPreferences(file);
      if (brushImportRef.current) brushImportRef.current.value = "";
    },
    [preferences],
  );

  // ── Preferences export / import ───────────────────────────────────────────

  const handlePrefExport = useCallback(() => {
    if (preferences) void preferences.exportPreferences();
  }, [preferences]);

  const handlePrefImport = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !preferences) return;
      void preferences.importPreferences(file);
      if (prefImportRef.current) prefImportRef.current.value = "";
    },
    [preferences],
  );

  if (!open) return null;

  const mobileUIOn = isMobile;

  const lastUploaded = preferences?.lastUploaded ?? null;
  const lastDownloaded = preferences?.lastDownloaded ?? null;
  const isUploading = preferences?.isUploadingSyncing ?? false;
  const isDownloading = preferences?.isDownloadingSyncing ?? false;

  // ── Column 1 sections ──────────────────────────────────────────────────────

  const col1 = (
    <div className="flex flex-col gap-0">
      {/* ACCOUNT */}
      <SectionHeader label="Account" />
      <div className="mb-3 space-y-1.5">
        <div className="text-xs text-muted-foreground font-mono truncate">
          {principalText ? truncatePrincipal(principalText) : "Not signed in"}
        </div>
        {isLoggedIn ? (
          <SmallBtn
            onClick={() => clear()}
            ocid="settings.sign_out_button"
            variant="secondary"
          >
            Sign Out
          </SmallBtn>
        ) : (
          <SmallBtn
            onClick={() => login()}
            ocid="settings.sign_in_button"
            variant="primary"
            disabled={!isLoginIdle}
          >
            Sign In
          </SmallBtn>
        )}
      </div>

      {/* THEME */}
      <SectionHeader label="Theme" />
      <div className="mb-2">
        <select
          data-ocid="settings.theme_select"
          value={activeTheme}
          onChange={(e) => handleThemeSelect(e.target.value as ThemeId)}
          style={{ width: "60%" }}
          className="text-xs rounded border border-border/60 bg-muted/50 text-foreground px-2 py-1.5 cursor-pointer hover:bg-muted transition-colors focus:outline-none focus:ring-1 focus:ring-accent"
        >
          {ALL_THEME_IDS.map((id) => (
            <option key={id} value={id}>
              {THEME_LABELS[id]}
            </option>
          ))}
        </select>
      </div>
      <ActionRow>
        <SmallBtn
          onClick={() => setShowTheme(true)}
          ocid="settings.edit_theme_button"
          variant="primary"
        >
          Edit Theme Colors
        </SmallBtn>
        <SmallBtn
          onClick={handleThemeExport}
          ocid="settings.theme_export_button"
          variant="icon"
          title="Export theme"
        >
          <Download size={12} />
        </SmallBtn>
        <SmallBtn
          onClick={() => themeImportRef.current?.click()}
          ocid="settings.theme_import_button"
          variant="icon"
          title="Import theme"
        >
          <Upload size={12} />
        </SmallBtn>
        <input
          ref={themeImportRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={handleThemeImport}
        />
      </ActionRow>

      {/* HOTKEYS */}
      <SectionHeader label="Hotkeys" />
      <ActionRow>
        <SmallBtn
          onClick={() => setShowHotkeys(true)}
          ocid="settings.edit_hotkeys_button"
          variant="primary"
        >
          Edit Hotkeys
        </SmallBtn>
        <SmallBtn
          onClick={handleHotkeyExport}
          ocid="settings.hotkeys_export_button"
          variant="icon"
          title="Export hotkeys"
        >
          <Download size={12} />
        </SmallBtn>
        <SmallBtn
          onClick={() => hotkeyImportRef.current?.click()}
          ocid="settings.hotkeys_import_button"
          variant="icon"
          title="Import hotkeys"
        >
          <Upload size={12} />
        </SmallBtn>
        <input
          ref={hotkeyImportRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={handleHotkeyImport}
        />
      </ActionRow>

      {/* PREFERENCES / SYNC */}
      <SectionHeader label="Preferences" />
      <div className="mb-3 space-y-1.5">
        <div className="text-xs text-muted-foreground">
          Last uploaded:{" "}
          <span className="text-foreground">
            {formatTimestamp(lastUploaded)}
          </span>
        </div>
        <div className="text-xs text-muted-foreground">
          Last downloaded:{" "}
          <span className="text-foreground">
            {formatTimestamp(lastDownloaded)}
          </span>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap mt-1">
          <SmallBtn
            onClick={() => preferences && void preferences.syncUpload()}
            ocid="settings.sync_upload_button"
            disabled={!preferences || !isLoggedIn || isUploading}
            variant="secondary"
          >
            {isUploading && <Loader2 size={10} className="animate-spin" />}
            Upload
          </SmallBtn>
          <SmallBtn
            onClick={() => preferences && void preferences.syncDownload()}
            ocid="settings.sync_download_button"
            disabled={!preferences || !isLoggedIn || isDownloading}
            variant="secondary"
          >
            {isDownloading && <Loader2 size={10} className="animate-spin" />}
            Download
          </SmallBtn>
          <SmallBtn
            onClick={handlePrefExport}
            ocid="settings.pref_export_button"
            variant="icon"
            title="Export preferences"
          >
            <Download size={12} />
          </SmallBtn>
          <SmallBtn
            onClick={() => prefImportRef.current?.click()}
            ocid="settings.pref_import_button"
            variant="icon"
            title="Import preferences"
          >
            <Upload size={12} />
          </SmallBtn>
          <input
            ref={prefImportRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={handlePrefImport}
          />
        </div>
        {preferences?.uploadError && (
          <div className="text-xs text-destructive">
            {preferences.uploadError}
          </div>
        )}
        {preferences?.downloadError && (
          <div className="text-xs text-destructive">
            {preferences.downloadError}
          </div>
        )}
      </div>

      {/* MOBILE UI + LEFTY MODE — at bottom of col 1 */}
      <SectionHeader label="Interface" />
      <div className="flex items-center justify-between gap-3 py-0.5 mb-1.5">
        <span className="text-sm text-foreground">Use Mobile UI</span>
        <Toggle
          checked={mobileUIOn}
          onChange={(on) => onUIModeOverrideChange?.(on ? "mobile" : "desktop")}
          ocid="settings.ui_mode_toggle"
          label="Use Mobile UI"
        />
      </div>
      {mobileUIOn && (
        <div className="flex items-center justify-between gap-3 py-0.5">
          <span className="text-sm text-foreground">Lefty Mode</span>
          <Toggle
            checked={leftHanded}
            onChange={(on) => onLeftHandedChange?.(on)}
            ocid="settings.left_handed_toggle"
            label="Lefty Mode"
          />
        </div>
      )}
      {mobileUIOn && (
        <div className="flex items-center justify-between gap-3 py-0.5 mt-1">
          <span className="text-sm text-foreground">Show FOS Sliders</span>
          <Toggle
            checked={showFOBSliders}
            onChange={(on) => onShowFOBSlidersChange?.(on)}
            ocid="settings.show_fob_sliders_toggle"
            label="Show FOS Sliders"
          />
        </div>
      )}
    </div>
  );

  // ── Column 2 sections ──────────────────────────────────────────────────────

  const col2 = (
    <div className="flex flex-col gap-0">
      {/* BRUSHES */}
      <SectionHeader label="Brushes" />
      <ActionRow>
        <SmallBtn
          onClick={handleBrushExport}
          ocid="settings.brushes_export_button"
          variant="primary"
        >
          Export Brushes
        </SmallBtn>
        <SmallBtn
          onClick={() => brushImportRef.current?.click()}
          ocid="settings.brushes_import_button"
          variant="secondary"
        >
          Import Brushes
        </SmallBtn>
        <input
          ref={brushImportRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={handleBrushImport}
        />
      </ActionRow>

      {/* CURSOR */}
      <SectionHeader label="Cursor" />
      <div className="mb-3 space-y-2">
        <div>
          <div className="text-xs text-muted-foreground mb-1">Brush cursor</div>
          <div className="flex gap-1 flex-wrap">
            {(
              [
                { v: "circle", label: "Circle" },
                { v: "brush-outline", label: "Brush Outline" },
                { v: "crosshair", label: "Crosshair" },
              ] as { v: CursorType; label: string }[]
            ).map(({ v, label }) => (
              <button
                key={v}
                type="button"
                data-ocid={`settings.cursor_type.${v}`}
                onClick={() => handleCursorType(v)}
                className={`px-2 py-0.5 text-xs rounded border transition-colors ${
                  cursorType === v
                    ? "bg-accent text-accent-foreground border-accent"
                    : "bg-muted/50 text-muted-foreground border-border/60 hover:bg-muted hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground mb-1">
            Center indicator
          </div>
          <div className="flex gap-1 flex-wrap">
            {(
              [
                { v: "none", label: "None" },
                { v: "crosshair", label: "Crosshair" },
                { v: "dot", label: "Dot" },
              ] as { v: CursorCenter; label: string }[]
            ).map(({ v, label }) => (
              <button
                key={v}
                type="button"
                data-ocid={`settings.cursor_center.${v}`}
                onClick={() => handleCursorCenter(v)}
                className={`px-2 py-0.5 text-xs rounded border transition-colors ${
                  cursorCenter === v
                    ? "bg-accent text-accent-foreground border-accent"
                    : "bg-muted/50 text-muted-foreground border-border/60 hover:bg-muted hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* PRESSURE CURVE */}
      <SectionHeader label="Pressure Curve" />
      <div className="mb-3">
        <PressureCurveEditor
          value={pressureCurve}
          onChange={handlePressureCurve}
        />
      </div>

      {/* UNDO HISTORY — very bottom of col 2 */}
      <SectionHeader label="Undo History" />
      <div className="mb-2">
        <div className="flex items-center gap-2">
          <input
            data-ocid="settings.undo_history_slider"
            type="range"
            min={10}
            max={50}
            step={5}
            value={undoHistoryLimit}
            onChange={(e) => setUndoHistoryLimit(Number(e.target.value))}
            className="flex-1 accent-[oklch(var(--accent))]"
          />
          <span className="text-xs text-foreground tabular-nums whitespace-nowrap min-w-[4.5rem] text-right">
            {undoHistoryLimit} states
          </span>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <div
        data-ocid="settings.panel"
        ref={panelRef}
        className="fixed z-50 border border-border rounded-lg shadow-lg overflow-y-auto"
        style={{
          left: pos.x,
          top: pos.y,
          width: POPUP_WIDTH,
          maxHeight: "calc(100vh - 4rem)",
          backgroundColor: "oklch(var(--toolbar))",
          WebkitTransform: "translateZ(0)",
          transform: "translateZ(0)",
        }}
        onPointerDown={(e) => e.stopPropagation()}
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
            onClick={handleClose}
            className="w-6 h-6 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        {/* Two-column content */}
        <div
          className="px-4 py-4"
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "0 24px",
          }}
        >
          {col1}
          {col2}
        </div>
      </div>

      {/* Modals (portalled) */}
      {showTheme && (
        <ThemeColorEditor
          themeId={activeTheme}
          onClose={() => setShowTheme(false)}
        />
      )}
      {showHotkeys && <HotkeyEditor onClose={() => setShowHotkeys(false)} />}
    </>
  );
}
