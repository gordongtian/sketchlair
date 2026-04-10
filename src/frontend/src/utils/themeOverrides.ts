const STORAGE_PREFIX = "sl-theme-override-";
const THEME_KEY = "heavybrush-theme";
const DEFAULT_VERSION_KEY = "sl-themes-default-version";
const DEFAULT_THEMES_FILE =
  "sketchlair-themes-019d6a2b-ca05-72fc-8856-f4471f6dfd3e";

export const ALL_THEME_IDS = [
  "light",
  "dark",
  "bubble-pop",
  "all-business",
  "fireside",
  "sketchlair-95",
  "mainframe",
  "rose-pine",
  "everforest-dark",
  "everforest-light",
] as const;

export type ThemeId = (typeof ALL_THEME_IDS)[number];

// The 13 semantic palette variables exposed in the theme editor
export const ALL_CSS_VAR_NAMES: string[] = [
  "toolbar",
  "sidebar-left",
  "sidebar-right",
  "sidebar-item",
  "accent",
  "canvas-bg",
  "outline",
  "slider-bg",
  "slider-handle",
  "slider-highlight",
  "text",
  "accent-text",
  "highlighted-text",
  "muted-text",
];

// Old variable names that may exist in localStorage from before this refactor.
// We clean them up when applying overrides so stale values don't bleed through.
const OLD_VAR_NAMES: string[] = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent-foreground",
  "destructive",
  "destructive-foreground",
  "border",
  "input",
  "ring",
  "canvas-workspace",
  "layer-highlight",
  "sidebar",
  "sidebar-foreground",
  "sidebar-primary",
  "sidebar-primary-foreground",
  "sidebar-accent",
  "sidebar-accent-foreground",
  "sidebar-border",
  "sidebar-ring",
  "slider-track",
  "chart-1",
  "chart-2",
  "chart-3",
  "chart-4",
  "chart-5",
];

export function getThemeOverrides(themeId: ThemeId): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + themeId);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

export function setThemeOverride(
  themeId: ThemeId,
  varName: string,
  oklchValue: string,
): void {
  const overrides = getThemeOverrides(themeId);
  overrides[varName] = oklchValue;
  localStorage.setItem(STORAGE_PREFIX + themeId, JSON.stringify(overrides));
}

export function clearThemeOverrides(themeId: ThemeId): void {
  localStorage.removeItem(STORAGE_PREFIX + themeId);
}

export function applyThemeOverrides(themeId: ThemeId): void {
  const el = document.documentElement;
  // Clear stale inline overrides from old variable names
  for (const name of OLD_VAR_NAMES) {
    el.style.removeProperty(`--${name}`);
  }
  // Clear all known semantic overrides
  for (const name of ALL_CSS_VAR_NAMES) {
    el.style.removeProperty(`--${name}`);
  }
  // Apply current overrides
  const overrides = getThemeOverrides(themeId);
  for (const [varName, value] of Object.entries(overrides)) {
    el.style.setProperty(`--${varName}`, value);
  }
}

export function exportAllThemes(): Record<string, Record<string, string>> {
  const result: Record<string, Record<string, string>> = {};
  for (const id of ALL_THEME_IDS) {
    const overrides = getThemeOverrides(id);
    if (Object.keys(overrides).length > 0) {
      result[id] = overrides;
    }
  }
  return result;
}

export function importThemes(
  data: Record<string, Record<string, string>>,
  currentThemeId: ThemeId,
): void {
  for (const [themeKey, overrides] of Object.entries(data)) {
    if (!ALL_THEME_IDS.includes(themeKey as ThemeId)) continue;
    const id = themeKey as ThemeId;
    // Overwrite: merge incoming overrides over existing ones
    const existing = getThemeOverrides(id);
    const merged = { ...existing, ...overrides };
    localStorage.setItem(STORAGE_PREFIX + id, JSON.stringify(merged));
  }
  // Re-apply current theme overrides
  applyThemeOverrides(currentThemeId);
}

/**
 * Fetches the bundled default themes and returns the defaults for the given
 * theme ID, or null if the fetch fails or the theme has no shipped defaults.
 */
async function fetchDefaultsForTheme(
  themeId: ThemeId,
): Promise<Record<string, string> | null> {
  try {
    const res = await fetch(`/assets/${DEFAULT_THEMES_FILE}.sltheme`);
    if (!res.ok) return null;
    const b64 = await res.text();
    const decoded = atob(b64.trim());
    const data = JSON.parse(decoded) as Record<string, Record<string, string>>;
    return data[themeId] ?? null;
  } catch {
    return null;
  }
}

/**
 * Resets a theme back to its shipped defaults by re-fetching the bundled
 * .sltheme file and overwriting any user edits for that theme. After writing
 * to localStorage, the theme is re-applied to the document so the UI updates
 * immediately.
 *
 * Returns true if the reset succeeded, false if the defaults could not be
 * loaded (e.g. network unavailable).
 */
export async function resetThemeToDefaults(themeId: ThemeId): Promise<boolean> {
  const defaults = await fetchDefaultsForTheme(themeId);
  if (defaults === null) {
    // No shipped defaults found — fall back to clearing all overrides so the
    // raw CSS baseline is shown (better than doing nothing).
    clearThemeOverrides(themeId);
    applyThemeOverrides(themeId);
    return false;
  }
  // Replace the stored overrides with exactly the shipped defaults (no user
  // edits on top — this is a full reset).
  localStorage.setItem(STORAGE_PREFIX + themeId, JSON.stringify(defaults));
  applyThemeOverrides(themeId);
  return true;
}

/**
 * Fetches the bundled default themes file and applies its values to localStorage
 * if this version hasn't been loaded before. Skips if the stored version key
 * already matches the current file identifier.
 *
 * After applying, re-applies the current theme so the UI reflects any new defaults.
 */
export async function loadDefaultThemes(): Promise<void> {
  try {
    const storedVersion = localStorage.getItem(DEFAULT_VERSION_KEY);
    if (storedVersion === DEFAULT_THEMES_FILE) {
      // Already loaded this version — nothing to do.
      return;
    }

    const res = await fetch(`/assets/${DEFAULT_THEMES_FILE}.sltheme`);
    if (!res.ok) return;

    const b64 = await res.text();
    const decoded = atob(b64.trim());
    const data = JSON.parse(decoded) as Record<string, Record<string, string>>;

    // Apply all defaults from the file. This replaces old defaults but keeps
    // any overrides the user set on top via the theme editor (because
    // setThemeOverride merges, not replaces).
    for (const [themeKey, overrides] of Object.entries(data)) {
      if (!ALL_THEME_IDS.includes(themeKey as ThemeId)) continue;
      const id = themeKey as ThemeId;
      const existing = getThemeOverrides(id);
      const merged = { ...overrides, ...existing };
      localStorage.setItem(STORAGE_PREFIX + id, JSON.stringify(merged));
    }

    // Mark this version as loaded
    localStorage.setItem(DEFAULT_VERSION_KEY, DEFAULT_THEMES_FILE);

    // Re-apply the currently active theme
    const currentTheme = (localStorage.getItem(THEME_KEY) ||
      "light") as ThemeId;
    applyThemeOverrides(currentTheme);
  } catch (e) {
    console.warn("Failed to load default themes:", e);
  }
}
