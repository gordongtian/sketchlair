// ── CloseTabDialog ────────────────────────────────────────────────────────────
//
// Confirmation dialog shown when closing a dirty (unsaved) document tab.
// Provides Save, Discard, and Cancel actions.

import { motion } from "motion/react";
import { useEffect } from "react";

// ── Props ─────────────────────────────────────────────────────────────────────

export interface CloseTabDialogProps {
  filename: string;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function CloseTabDialog({
  filename,
  onSave,
  onDiscard,
  onCancel,
}: CloseTabDialogProps) {
  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onCancel]);

  return (
    <div
      data-ocid="close_tab_dialog.backdrop"
      className="fixed inset-0 z-[9500] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
      }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
        data-ocid="close_tab_dialog.panel"
        className="w-full max-w-xs rounded-xl shadow-2xl p-5 flex flex-col gap-4"
        style={{
          backgroundColor: "oklch(var(--toolbar))",
          border: "1px solid oklch(var(--outline))",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col gap-1.5">
          <h3
            className="text-sm font-semibold"
            style={{ color: "oklch(var(--text))" }}
          >
            Unsaved Changes
          </h3>
          <p
            className="text-xs leading-relaxed"
            style={{ color: "oklch(var(--muted-text))" }}
          >
            Save changes to{" "}
            <span
              className="font-medium"
              style={{ color: "oklch(var(--text))" }}
            >
              "{filename}"
            </span>{" "}
            before closing?
          </p>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            data-ocid="close_tab_dialog.save"
            onClick={onSave}
            className="flex-1 py-2 rounded-lg text-xs font-semibold transition-all hover:opacity-90"
            style={{
              backgroundColor: "oklch(var(--accent))",
              color: "oklch(var(--accent-text))",
            }}
          >
            Save
          </button>
          <button
            type="button"
            data-ocid="close_tab_dialog.discard"
            onClick={onDiscard}
            className="flex-1 py-2 rounded-lg text-xs font-semibold transition-all hover:opacity-80"
            style={{
              backgroundColor: "oklch(var(--sidebar-left))",
              color: "oklch(var(--text))",
              border: "1px solid oklch(var(--outline))",
            }}
          >
            Discard
          </button>
          <button
            type="button"
            data-ocid="close_tab_dialog.cancel"
            onClick={onCancel}
            className="flex-1 py-2 rounded-lg text-xs font-semibold transition-all hover:opacity-80"
            style={{
              backgroundColor: "oklch(var(--sidebar-left))",
              color: "oklch(var(--muted-text))",
              border: "1px solid oklch(var(--outline))",
            }}
          >
            Cancel
          </button>
        </div>
      </motion.div>
    </div>
  );
}
