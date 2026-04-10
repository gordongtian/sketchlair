import type { BrushSettings } from "@/components/BrushSettingsPanel";
import { type HotkeyAction, loadHotkeys } from "@/utils/hotkeyConfig";
import { loadDefaultThemes } from "@/utils/themeOverrides";
import { loadDefaultPresets } from "@/utils/toolPresets";
import type { Preset } from "@/utils/toolPresets";
import { useEffect } from "react";

export interface UseAppInitializationProps {
  isDirtyRef: React.MutableRefObject<boolean>;
  hotkeysRef: React.MutableRefObject<Record<string, HotkeyAction>>;
  onPresetsLoaded: (
    presets: Record<"brush" | "smudge" | "eraser", Preset[]>,
    brushSettings: BrushSettings,
  ) => void;
}

/**
 * Handles app-level initialization side effects:
 * - Loads default themes on mount
 * - Warns user before tab close if there are unsaved changes
 * - Loads default brush presets from .hbrush file on mount
 * - Reloads hotkeys when user saves from HotkeyEditor
 *
 * Note: hotkeysRef is initialized synchronously via useRef(loadHotkeys()) in PaintingApp —
 * that must stay there since it needs to happen at component initialization time.
 */
export function useAppInitialization({
  isDirtyRef,
  hotkeysRef,
  onPresetsLoaded,
}: UseAppInitializationProps): void {
  // Load default themes on mount
  useEffect(() => {
    loadDefaultThemes();
  }, []);

  // Beforeunload warning: fires when user tries to close the tab with unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirtyRef.current) {
        e.preventDefault();
        // Modern browsers show a generic "Leave site?" dialog; the return value
        // is required for older browsers but is ignored by modern ones.
        return "";
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirtyRef]);

  // Load default presets from .hbrush file on mount.
  // onPresetsLoaded is intentionally excluded from deps — this must run exactly once at mount.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional mount-only effect
  useEffect(() => {
    loadDefaultPresets().then((loaded) => {
      // Apply the full active brush preset settings from the loaded file to brushSettings.
      // Without this, brushSettings stays at hardcoded DEFAULT_PRESETS values (wrong smoothing,
      // stabilizationMode, etc.) even after the custom .hbrush file is loaded.
      const activeBrushPreset =
        loaded.brush?.find((p) => p.id === "brush-default") ??
        loaded.brush?.[0];
      let brushSettings: BrushSettings | null = null;
      if (activeBrushPreset?.settings) {
        const loadedSettings = { ...activeBrushPreset.settings };
        // Override flow with defaultFlow if defined (defaultFlow takes precedence)
        if (activeBrushPreset.defaultFlow !== undefined) {
          loadedSettings.flow = activeBrushPreset.defaultFlow;
        }
        brushSettings = loadedSettings;
      }
      if (brushSettings) {
        onPresetsLoaded(loaded, brushSettings);
      } else {
        // Presets loaded but no brush settings to apply — still update presets
        const fallback = loaded.brush?.[0]?.settings ?? null;
        if (fallback) onPresetsLoaded(loaded, fallback);
      }
    });
  }, []);

  // Reload hotkeys when user saves from HotkeyEditor
  useEffect(() => {
    const slHotkeyHandler = () => {
      hotkeysRef.current = loadHotkeys();
    };
    window.addEventListener("sl:hotkeys-updated", slHotkeyHandler);
    return () =>
      window.removeEventListener("sl:hotkeys-updated", slHotkeyHandler);
  }, [hotkeysRef]);
}
