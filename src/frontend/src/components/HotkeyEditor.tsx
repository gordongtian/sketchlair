import {
  DEFAULT_HOTKEYS,
  type HotkeyAction,
  type KeyBinding,
  bindingLabel,
  loadHotkeys,
  matchesBinding,
  saveHotkeys,
  serializeBinding,
} from "@/utils/hotkeyConfig";
import {
  AlertTriangle,
  Download,
  GripHorizontal,
  Keyboard,
  RotateCcw,
  Search,
  Upload,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Props = { onClose: () => void };

const CATEGORY_ORDER = [
  "Tools",
  "Canvas",
  "Layers",
  "Brush",
  "History",
  "Selection",
  "Ruler",
] as const;

export function HotkeyEditor({ onClose }: Props) {
  const [hotkeys, setHotkeys] = useState<Record<string, HotkeyAction>>(() =>
    loadHotkeys(),
  );
  const [search, setSearch] = useState("");
  const [capturingSlot, setCapturingSlot] = useState<{
    actionId: string;
    slot: "primary" | "secondary";
  } | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number }>(() => ({
    x: Math.max(0, window.innerWidth / 2 - 240),
    y: Math.max(0, window.innerHeight / 2 - 300),
  }));
  const dragRef = useRef<{
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Conflict detection ─────────────────────────────────────────────────
  const conflicts = new Set<string>();
  const bindingMap = new Map<string, string[]>();
  for (const action of Object.values(hotkeys)) {
    for (const slot of ["primary", "secondary"] as const) {
      const b = action[slot];
      if (!b) continue;
      const key = serializeBinding(b);
      const existing = bindingMap.get(key) ?? [];
      existing.push(action.id);
      bindingMap.set(key, existing);
    }
  }
  for (const [, ids] of bindingMap) {
    if (ids.length > 1) {
      for (const id of ids) conflicts.add(id);
    }
  }

  const updateAndSave = useCallback((updated: Record<string, HotkeyAction>) => {
    setHotkeys(updated);
    saveHotkeys(updated);
    window.dispatchEvent(new Event("sl:hotkeys-updated"));
  }, []);

  const handleReset = useCallback(
    (actionId: string) => {
      const def = DEFAULT_HOTKEYS[actionId];
      if (!def) return;
      const updated = {
        ...hotkeys,
        [actionId]: {
          ...hotkeys[actionId],
          primary: def.primary,
          secondary: def.secondary,
        },
      };
      updateAndSave(updated);
    },
    [hotkeys, updateAndSave],
  );

  const handleResetAll = useCallback(() => {
    const reset: Record<string, HotkeyAction> = {};
    for (const id of Object.keys(hotkeys)) {
      reset[id] = {
        ...hotkeys[id],
        primary: DEFAULT_HOTKEYS[id]?.primary ?? null,
        secondary: DEFAULT_HOTKEYS[id]?.secondary ?? null,
      };
    }
    updateAndSave(reset);
  }, [hotkeys, updateAndSave]);

  const handleClearSlot = useCallback(
    (actionId: string, slot: "primary" | "secondary") => {
      if (hotkeys[actionId]?.locked) return;
      const updated = {
        ...hotkeys,
        [actionId]: { ...hotkeys[actionId], [slot]: null },
      };
      updateAndSave(updated);
    },
    [hotkeys, updateAndSave],
  );

  const handleSlotClick = useCallback(
    (actionId: string, slot: "primary" | "secondary") => {
      if (hotkeys[actionId]?.locked) return;
      setCapturingSlot({ actionId, slot });
    },
    [hotkeys],
  );

  // ── Capture mode ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!capturingSlot) return;
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setCapturingSlot(null);
        return;
      }
      if (["shift", "control", "alt", "meta"].includes(e.key.toLowerCase()))
        return;
      const binding: KeyBinding = {
        key:
          e.key === "Delete"
            ? "delete"
            : e.key === "Backspace"
              ? "backspace"
              : e.key === "Tab"
                ? "tab"
                : e.key === "Enter"
                  ? "enter"
                  : e.key === "[" || e.key === "]"
                    ? e.key
                    : e.key.toLowerCase(),
        ...(e.ctrlKey ? { ctrl: true } : {}),
        ...(e.shiftKey ? { shift: true } : {}),
        ...(e.altKey ? { alt: true } : {}),
        ...(e.metaKey ? { meta: true } : {}),
      };
      const { actionId, slot } = capturingSlot;
      const updated = {
        ...hotkeys,
        [actionId]: { ...hotkeys[actionId], [slot]: binding },
      };
      updateAndSave(updated);
      setCapturingSlot(null);
    };
    window.addEventListener("keydown", handler, { capture: true });
    return () =>
      window.removeEventListener("keydown", handler, { capture: true });
  }, [capturingSlot, hotkeys, updateAndSave]);

  // ── Export / Import ────────────────────────────────────────────────────
  const handleExport = useCallback(() => {
    const json = JSON.stringify(hotkeys, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "sketchlair-hotkeys.slkeys";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1000);
  }, [hotkeys]);

  const handleImportClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const parsed = JSON.parse(ev.target?.result as string) as Record<
            string,
            HotkeyAction
          >;
          const merged: Record<string, HotkeyAction> = { ...hotkeys };
          for (const id of Object.keys(DEFAULT_HOTKEYS)) {
            if (parsed[id] && !DEFAULT_HOTKEYS[id]?.locked) {
              merged[id] = {
                ...hotkeys[id],
                primary: parsed[id].primary,
                secondary: parsed[id].secondary,
              };
            }
          }
          updateAndSave(merged);
        } catch {
          /* ignore invalid files */
        }
      };
      reader.readAsText(file);
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [hotkeys, updateAndSave],
  );

  // ── Drag ───────────────────────────────────────────────────────────────
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
          Math.min(window.innerWidth - 500, dragRef.current.origX + dx),
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

  // ── Grouping ───────────────────────────────────────────────────────────
  const grouped = CATEGORY_ORDER.map((cat) => {
    const actions = Object.values(hotkeys).filter((a) => {
      if (a.category !== cat) return false;
      if (search) return a.label.toLowerCase().includes(search.toLowerCase());
      return true;
    });
    return { cat, actions };
  }).filter((g) => g.actions.length > 0);

  // ── Render ─────────────────────────────────────────────────────────────
  const editor = (
    <div
      data-ocid="hotkey_editor.panel"
      style={{
        position: "fixed",
        left: pos.x,
        top: pos.y,
        zIndex: 200,
        width: 500,
        maxHeight: "90vh",
        display: "flex",
        flexDirection: "column",
        pointerEvents: "auto",
        backgroundColor: "oklch(var(--toolbar))",
        WebkitTransform: "translateZ(0)",
        transform: "translateZ(0)",
      }}
      className="border border-border rounded-lg shadow-2xl overflow-hidden"
    >
      {/* Title bar */}
      <div
        data-ocid="hotkey_editor.drag_handle"
        onPointerDown={handleTitlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className="flex items-center justify-between px-3 py-2.5 border-b border-border cursor-grab active:cursor-grabbing select-none"
        style={{ touchAction: "none" }}
      >
        <div className="flex items-center gap-2">
          <GripHorizontal size={12} className="text-muted-foreground" />
          <Keyboard size={13} className="text-muted-foreground" />
          <span className="text-sm font-semibold text-foreground">
            Hotkey Editor
          </span>
        </div>
        <button
          type="button"
          data-ocid="hotkey_editor.close_button"
          onClick={onClose}
          className="w-6 h-6 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
        >
          <X size={13} />
        </button>
      </div>

      {/* Search */}
      <div className="px-3 py-2 border-b border-border/40">
        <div className="flex items-center gap-2 px-2 py-1.5 rounded bg-muted/30 border border-border/40">
          <Search size={12} className="text-muted-foreground flex-shrink-0" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search actions…"
            data-ocid="hotkey_editor.search_input"
            className="flex-1 text-xs bg-transparent outline-none text-foreground placeholder:text-muted-foreground"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="text-muted-foreground hover:text-foreground"
            >
              <X size={11} />
            </button>
          )}
        </div>
      </div>

      {/* Capture hint */}
      {capturingSlot && (
        <div
          className="px-3 py-2 text-xs text-center border-b border-border/40 animate-pulse"
          style={{
            backgroundColor: "oklch(var(--accent)/0.15)",
            borderColor: "oklch(var(--accent)/0.3)",
            color: "oklch(var(--accent))",
          }}
        >
          Press a key combination… (Esc to cancel)
        </div>
      )}

      {/* Column headers */}
      <div className="grid grid-cols-[1fr_130px_130px_28px] gap-1 px-3 py-1.5 border-b border-border/40 bg-muted/10">
        <span className="text-xs text-muted-foreground uppercase tracking-wider">
          Action
        </span>
        <span className="text-xs text-muted-foreground uppercase tracking-wider text-center">
          Primary
        </span>
        <span className="text-xs text-muted-foreground uppercase tracking-wider text-center">
          Secondary
        </span>
        <span />
      </div>

      {/* Scrollable body */}
      <div
        className="overflow-y-auto flex-1"
        style={{ overscrollBehavior: "contain" }}
      >
        {grouped.map(({ cat, actions }) => (
          <div key={cat} className="border-b border-border/40 last:border-b-0">
            <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground bg-muted/5">
              {cat}
            </div>
            {actions.map((action) => {
              const isCapturing = capturingSlot?.actionId === action.id;
              const hasConflict = conflicts.has(action.id);
              return (
                <div
                  key={action.id}
                  className={`grid grid-cols-[1fr_130px_130px_28px] gap-1 items-center px-3 py-1.5 transition-colors ${
                    hasConflict
                      ? "bg-destructive/10"
                      : "hover:bg-[oklch(var(--sidebar-item)/0.5)]"
                  }`}
                >
                  {/* Label */}
                  <div className="flex items-center gap-1.5 min-w-0">
                    {hasConflict && (
                      <AlertTriangle
                        size={11}
                        className="text-destructive flex-shrink-0"
                      />
                    )}
                    <span
                      className={`text-xs truncate ${
                        hasConflict ? "text-destructive" : "text-foreground/80"
                      } ${action.locked ? "opacity-60" : ""}`}
                    >
                      {action.label}
                    </span>
                    {action.locked && (
                      <span className="text-[9px] text-muted-foreground bg-muted/50 px-1 py-0.5 rounded flex-shrink-0">
                        locked
                      </span>
                    )}
                  </div>

                  {/* Primary slot */}
                  <SlotButton
                    binding={action.primary}
                    isCapturing={
                      isCapturing && capturingSlot?.slot === "primary"
                    }
                    locked={action.locked}
                    onCapture={() => handleSlotClick(action.id, "primary")}
                    onClear={() => handleClearSlot(action.id, "primary")}
                    ocid={`hotkey_editor.${action.id}.primary.button`}
                  />

                  {/* Secondary slot */}
                  <SlotButton
                    binding={action.secondary}
                    isCapturing={
                      isCapturing && capturingSlot?.slot === "secondary"
                    }
                    locked={action.locked}
                    onCapture={() => handleSlotClick(action.id, "secondary")}
                    onClear={() => handleClearSlot(action.id, "secondary")}
                    ocid={`hotkey_editor.${action.id}.secondary.button`}
                  />

                  {/* Reset */}
                  <button
                    type="button"
                    onClick={() => handleReset(action.id)}
                    disabled={action.locked}
                    title="Reset to default"
                    data-ocid={`hotkey_editor.${action.id}.reset_button`}
                    className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <RotateCcw size={10} />
                  </button>
                </div>
              );
            })}
          </div>
        ))}
        {grouped.length === 0 && (
          <div className="px-4 py-8 text-center text-xs text-muted-foreground">
            No actions match "{search}"
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-border/40 px-3 py-2 bg-muted/10 flex items-center gap-2">
        <button
          type="button"
          data-ocid="hotkey_editor.reset_all_button"
          onClick={handleResetAll}
          className="flex items-center gap-1.5 px-2 py-1.5 rounded text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 border border-border/60 hover:border-destructive/30 transition-colors"
        >
          <RotateCcw size={11} />
          Reset All
        </button>
        <div className="flex-1" />
        <button
          type="button"
          data-ocid="hotkey_editor.import_button"
          onClick={handleImportClick}
          className="flex items-center gap-1.5 px-2 py-1.5 rounded text-xs text-muted-foreground hover:text-foreground border border-border/60 hover:border-border transition-colors"
        >
          <Upload size={11} />
          Import
        </button>
        <button
          type="button"
          data-ocid="hotkey_editor.export_button"
          onClick={handleExport}
          className="flex items-center gap-1.5 px-2 py-1.5 rounded text-xs text-muted-foreground hover:text-foreground border border-border/60 hover:border-border transition-colors"
        >
          <Download size={11} />
          Export
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".slkeys"
          className="hidden"
          onChange={handleFileChange}
          data-ocid="hotkey_editor.upload_button"
        />
      </div>
    </div>
  );

  return createPortal(editor, document.body);
}

// ── Slot Button ─────────────────────────────────────────────────────────────
function SlotButton({
  binding,
  isCapturing,
  locked,
  onCapture,
  onClear,
  ocid,
}: {
  binding: KeyBinding | null;
  isCapturing: boolean;
  locked?: boolean;
  onCapture: () => void;
  onClear: () => void;
  ocid: string;
}) {
  return (
    <div className="flex items-center gap-0.5">
      <button
        type="button"
        onClick={() => !locked && onCapture()}
        data-ocid={ocid}
        className={`flex-1 h-6 px-1.5 rounded text-xs font-mono border transition-colors min-w-0 truncate ${
          isCapturing
            ? "animate-pulse border-[oklch(var(--accent)/0.6)] text-[oklch(var(--accent))]"
            : binding
              ? "bg-muted/30 border-border/60 text-foreground hover:bg-muted/60"
              : "border-border/30 text-muted-foreground hover:border-border/60"
        } ${locked ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
        style={
          isCapturing ? { backgroundColor: "oklch(var(--accent)/0.2)" } : {}
        }
      >
        {isCapturing ? "…" : bindingLabel(binding) || "—"}
      </button>
      {binding && !locked && (
        <button
          type="button"
          onClick={onClear}
          className="w-4 h-4 flex items-center justify-center rounded text-muted-foreground hover:text-destructive flex-shrink-0"
          title="Clear binding"
        >
          <X size={9} />
        </button>
      )}
    </div>
  );
}
