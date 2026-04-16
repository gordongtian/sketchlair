// ── Types ─────────────────────────────────────────────────────────────────
export type KeyBinding = {
  key: string; // e.g. "b", "tab", "]"
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
};

export type HotkeyAction = {
  id: string;
  label: string;
  category:
    | "Tools"
    | "Canvas"
    | "Layers"
    | "Brush"
    | "History"
    | "Selection"
    | "Ruler";
  primary: KeyBinding | null;
  secondary: KeyBinding | null;
  locked?: boolean;
};

// ── Helpers ────────────────────────────────────────────────────────────────
export function serializeBinding(b: KeyBinding): string {
  const parts: string[] = [];
  if (b.ctrl) parts.push("ctrl");
  if (b.shift) parts.push("shift");
  if (b.alt) parts.push("alt");
  if (b.meta) parts.push("meta");
  parts.push(b.key.toLowerCase());
  return parts.join("+");
}

export function parseBinding(s: string): KeyBinding {
  const parts = s.toLowerCase().split("+");
  const binding: KeyBinding = { key: "" };
  for (const p of parts) {
    if (p === "ctrl") binding.ctrl = true;
    else if (p === "shift") binding.shift = true;
    else if (p === "alt") binding.alt = true;
    else if (p === "meta") binding.meta = true;
    else binding.key = p;
  }
  return binding;
}

const MODIFIER_KEYS = new Set(["shift", "control", "alt", "meta"]);

export function matchesBinding(
  e: KeyboardEvent,
  b: KeyBinding | null,
): boolean {
  if (!b) return false;
  if (MODIFIER_KEYS.has(e.key.toLowerCase())) return false;
  const key =
    e.key === "Delete"
      ? "delete"
      : e.key === "Backspace"
        ? "backspace"
        : e.key === "Tab"
          ? "tab"
          : e.key === "Escape"
            ? "escape"
            : e.key === "Enter"
              ? "enter"
              : e.key === "[" || e.key === "]"
                ? e.key
                : e.key.toLowerCase();
  return (
    key === b.key.toLowerCase() &&
    !!e.ctrlKey === !!b.ctrl &&
    !!e.shiftKey === !!b.shift &&
    !!e.altKey === !!b.alt &&
    !!e.metaKey === !!b.meta
  );
}

export function bindingLabel(b: KeyBinding | null): string {
  if (!b) return "";
  const parts: string[] = [];
  if (b.ctrl) parts.push("Ctrl");
  if (b.shift) parts.push("Shift");
  if (b.alt) parts.push("Alt");
  if (b.meta) parts.push("Meta");
  const k = b.key;
  const keyDisplay =
    k === "tab"
      ? "Tab"
      : k === "delete"
        ? "Delete"
        : k === "backspace"
          ? "Backspace"
          : k === "escape"
            ? "Esc"
            : k === "enter"
              ? "Enter"
              : k === " "
                ? "Space"
                : k === "["
                  ? "["
                  : k === "]"
                    ? "]"
                    : k.toUpperCase();
  parts.push(keyDisplay);
  return parts.join("+");
}

// ── Default bindings ───────────────────────────────────────────────────────
export const DEFAULT_HOTKEYS: Record<string, HotkeyAction> = {
  // Tools
  brush: {
    id: "brush",
    label: "Brush",
    category: "Tools",
    primary: { key: "b" },
    secondary: null,
  },
  eraser: {
    id: "eraser",
    label: "Eraser",
    category: "Tools",
    primary: { key: "e" },
    secondary: null,
  },
  smudge: {
    id: "smudge",
    label: "Smudge",
    category: "Tools",
    primary: { key: "s" },
    secondary: null,
  },
  liquify: {
    id: "liquify",
    label: "Liquify",
    category: "Tools",
    primary: { key: "w" },
    secondary: null,
  },
  fill: {
    id: "fill",
    label: "Fill",
    category: "Tools",
    primary: { key: "f" },
    secondary: null,
  },
  eyedropper: {
    id: "eyedropper",
    label: "Eyedropper",
    category: "Tools",
    primary: { key: "i" },
    secondary: null,
  },
  lasso: {
    id: "lasso",
    label: "Lasso / Selection",
    category: "Tools",
    primary: { key: "l" },
    secondary: null,
  },
  transform: {
    id: "transform",
    label: "Move / Transform",
    category: "Tools",
    primary: { key: "v" },
    secondary: null,
  },
  ruler: {
    id: "ruler",
    label: "Ruler",
    category: "Tools",
    primary: { key: "g" },
    secondary: null,
  },
  // Canvas
  flipImage: {
    id: "flipImage",
    label: "Flip Image",
    category: "Canvas",
    primary: { key: "h" },
    secondary: null,
  },
  zoomIn: {
    id: "zoomIn",
    label: "Zoom In",
    category: "Canvas",
    primary: null,
    secondary: null,
  },
  zoomOut: {
    id: "zoomOut",
    label: "Zoom Out",
    category: "Canvas",
    primary: null,
    secondary: null,
  },
  rotateReset: {
    id: "rotateReset",
    label: "Reset Rotation",
    category: "Canvas",
    primary: { key: "escape" },
    secondary: null,
  },
  resetView: {
    id: "resetView",
    label: "Reset View",
    category: "Canvas",
    primary: null,
    secondary: null,
  },
  // Layers
  newLayer: {
    id: "newLayer",
    label: "New Layer",
    category: "Layers",
    primary: { key: "n", shift: true, ctrl: false, alt: false, meta: false },
    secondary: null,
  },
  deleteLayer: {
    id: "deleteLayer",
    label: "Delete Layer",
    category: "Layers",
    primary: { key: "delete" },
    secondary: null,
  },
  mergeDown: {
    id: "mergeDown",
    label: "Merge Down",
    category: "Layers",
    primary: { key: "e", shift: true },
    secondary: null,
  },
  duplicateLayer: {
    id: "duplicateLayer",
    label: "Duplicate Layer",
    category: "Layers",
    primary: null,
    secondary: null,
  },
  toggleVisibility: {
    id: "toggleVisibility",
    label: "Toggle Layer Visibility",
    category: "Layers",
    primary: null,
    secondary: null,
  },
  alphaLock: {
    id: "alphaLock",
    label: "Toggle Alpha Lock",
    category: "Layers",
    primary: null,
    secondary: null,
  },
  clearLayer: {
    id: "clearLayer",
    label: "Clear Layer",
    category: "Layers",
    primary: null,
    secondary: null,
  },
  createLayerGroup: {
    id: "createLayerGroup",
    label: "Create Layer Group",
    category: "Layers",
    primary: { key: "g", shift: true },
    secondary: null,
  },
  // Brush
  sizeIncrease: {
    id: "sizeIncrease",
    label: "Brush Size +",
    category: "Brush",
    primary: { key: "]" },
    secondary: null,
  },
  sizeDecrease: {
    id: "sizeDecrease",
    label: "Brush Size -",
    category: "Brush",
    primary: { key: "[" },
    secondary: null,
  },
  toggleClearBlendMode: {
    id: "toggleClearBlendMode",
    label: "Toggle Clear Blend Mode",
    category: "Brush",
    primary: null,
    secondary: null,
  },
  // History (locked)
  undo: {
    id: "undo",
    label: "Undo",
    category: "History",
    primary: { key: "z", ctrl: true },
    secondary: null,
  },
  redo: {
    id: "redo",
    label: "Redo",
    category: "History",
    primary: { key: "z", ctrl: true, shift: true },
    secondary: { key: "y", ctrl: true },
  },
  // Selection
  selectAll: {
    id: "selectAll",
    label: "Select All (Layer)",
    category: "Selection",
    primary: { key: "a", ctrl: true },
    secondary: null,
  },
  deselectAll: {
    id: "deselectAll",
    label: "Deselect All",
    category: "Selection",
    primary: { key: "d" },
    secondary: null,
  },
  invertSelection: {
    id: "invertSelection",
    label: "Invert Selection",
    category: "Selection",
    primary: null,
    secondary: null,
  },
  growSelection: {
    id: "growSelection",
    label: "Grow Selection",
    category: "Selection",
    primary: null,
    secondary: null,
  },
  shrinkSelection: {
    id: "shrinkSelection",
    label: "Shrink Selection",
    category: "Selection",
    primary: null,
    secondary: null,
  },
  // Ruler
  cycleRulerMode: {
    id: "cycleRulerMode",
    label: "Cycle Ruler Mode",
    category: "Ruler",
    primary: { key: "tab", shift: true },
    secondary: null,
  },
  rotateSwitch: {
    id: "rotateSwitch",
    label: "Rotate Canvas (Switch)",
    category: "Canvas",
    primary: { key: "r" },
    secondary: null,
  },
  rotateHold: {
    id: "rotateHold",
    label: "Rotate Canvas (Hold)",
    category: "Canvas",
    primary: { key: "y" },
    secondary: null,
  },
  crop: {
    id: "crop",
    label: "Crop Canvas",
    category: "Tools",
    primary: { key: "c", shift: true },
    secondary: null,
  },
};

// ── Migration ──────────────────────────────────────────────────────────────
// When a new default binding is added, existing users may have the old default
// (null) stored in localStorage. This table maps action IDs to the binding
// that was previously the default so we can detect "still using the old
// default" and upgrade it to the new default automatically.
const BINDING_MIGRATIONS: Record<
  string,
  { oldPrimary: null; newPrimary: KeyBinding }
> = {
  newLayer: {
    oldPrimary: null,
    newPrimary: { key: "n", shift: true, ctrl: false, alt: false, meta: false },
  },
};

// ── Persistence ────────────────────────────────────────────────────────────
const STORAGE_KEY = "sl_hotkeys";

export function loadHotkeys(): Record<string, HotkeyAction> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return { ...DEFAULT_HOTKEYS };
    const parsed = JSON.parse(stored) as Record<string, Partial<HotkeyAction>>;
    const result: Record<string, HotkeyAction> = { ...DEFAULT_HOTKEYS };
    for (const id of Object.keys(DEFAULT_HOTKEYS)) {
      if (parsed[id]) {
        result[id] = {
          ...DEFAULT_HOTKEYS[id],
          ...parsed[id],
        };
        // Migration: if the stored primary binding matches the OLD default (null),
        // and the new default has been bumped, upgrade to the new default.
        const migration = BINDING_MIGRATIONS[id];
        if (
          migration &&
          parsed[id].primary === migration.oldPrimary &&
          !("secondary" in parsed[id] && parsed[id].secondary !== null)
        ) {
          result[id] = {
            ...result[id],
            primary: migration.newPrimary,
          };
        }
      }
    }
    return result;
  } catch {
    return { ...DEFAULT_HOTKEYS };
  }
}

export function saveHotkeys(hotkeys: Record<string, HotkeyAction>): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(hotkeys));
}
