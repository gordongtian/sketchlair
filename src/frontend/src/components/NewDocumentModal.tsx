// ── NewDocumentModal ──────────────────────────────────────────────────────────
//
// Standalone resolution picker modal — extracted from PaintingAppWrapper.
// Renders preset buttons + custom width/height inputs + orientation toggle.
// Custom W/H state is lifted to the caller so typing values survive modal
// open/close cycles without being reset.

import { Monitor } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";

// ── Resolution presets ────────────────────────────────────────────────────────

const RESOLUTION_PRESETS: { label: string; w: number; h: number }[] = [
  { label: "1920 × 1080", w: 1920, h: 1080 },
  { label: "2048 × 2048", w: 2048, h: 2048 },
  { label: "2560 × 1440", w: 2560, h: 1440 },
  { label: "3840 × 2160", w: 3840, h: 2160 },
  { label: "4096 × 2048", w: 4096, h: 2048 },
];

// ── Props ─────────────────────────────────────────────────────────────────────

export interface NewDocumentModalProps {
  onCreate: (width: number, height: number) => void;
  onCancel: () => void;
  /** Lifted state — lives in parent so modal remounts never reset typed values */
  customW: string;
  customH: string;
  onCustomWChange: (v: string) => void;
  onCustomHChange: (v: string) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function NewDocumentModal({
  onCreate,
  onCancel,
  customW,
  customH,
  onCustomWChange,
  onCustomHChange,
}: NewDocumentModalProps) {
  const [orientation, setOrientation] = useState<"landscape" | "portrait">(
    "landscape",
  );

  const screenPreset = {
    label: "Screen Size",
    w: typeof window !== "undefined" ? window.screen.width : 1920,
    h: typeof window !== "undefined" ? window.screen.height : 1080,
  };
  const allPresets = [...RESOLUTION_PRESETS, screenPreset];

  const applyOrientation = (w: number, h: number) => {
    if (orientation === "portrait")
      return { width: Math.min(w, h), height: Math.max(w, h) };
    return { width: Math.max(w, h), height: Math.min(w, h) };
  };

  const handlePreset = (w: number, h: number) => {
    const final = applyOrientation(w, h);
    onCreate(final.width, final.height);
  };

  const handleCustomCreate = () => {
    const parsedW = Number.parseInt(customW, 10);
    const parsedH = Number.parseInt(customH, 10);
    if (!parsedW || !parsedH || parsedW <= 0 || parsedH <= 0) {
      // Don't silently fall back to a default — require valid input
      return;
    }
    const w = Math.max(1, Math.min(16384, parsedW));
    const h = Math.max(1, Math.min(16384, parsedH));
    // Custom sizes: width is always width, height is always height.
    // Orientation toggle only applies to presets, NOT to custom sizes.
    onCreate(w, h);
  };

  return (
    <div
      data-ocid="new_doc_modal.backdrop"
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
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 12 }}
        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        data-ocid="new_doc_modal.panel"
        className="w-full max-w-sm rounded-xl shadow-2xl p-6 flex flex-col gap-4"
        style={{
          backgroundColor: "oklch(var(--toolbar))",
          border: "1px solid oklch(var(--outline))",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2
            className="text-sm font-semibold uppercase tracking-wider"
            style={{ color: "oklch(var(--muted-text))" }}
          >
            New Canvas
          </h2>
          <button
            type="button"
            onClick={onCancel}
            className="text-xs px-2 py-1 rounded hover:opacity-80 transition-opacity"
            style={{
              color: "oklch(var(--muted-text))",
              backgroundColor: "oklch(var(--sidebar-left))",
            }}
          >
            ✕
          </button>
        </div>

        {/* Orientation toggle */}
        <div className="flex gap-2">
          {(["landscape", "portrait"] as const).map((o) => (
            <button
              key={o}
              type="button"
              data-ocid={`new_doc_modal.orientation_${o}`}
              onClick={() => setOrientation(o)}
              className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-all"
              style={{
                backgroundColor:
                  orientation === o
                    ? "oklch(var(--accent))"
                    : "oklch(var(--sidebar-left))",
                color:
                  orientation === o
                    ? "oklch(var(--accent-text))"
                    : "oklch(var(--text))",
                border: "1px solid oklch(var(--outline))",
              }}
            >
              <Monitor
                size={14}
                style={{
                  transform: o === "portrait" ? "rotate(90deg)" : undefined,
                }}
              />
              {o.charAt(0).toUpperCase() + o.slice(1)}
            </button>
          ))}
        </div>

        {/* Preset grid */}
        <div className="grid grid-cols-2 gap-2">
          {allPresets.map((p) => {
            const final = applyOrientation(p.w, p.h);
            return (
              <button
                key={p.label}
                type="button"
                data-ocid={`new_doc_modal.preset_${p.label.replace(/\s+/g, "_").toLowerCase()}`}
                onClick={() => handlePreset(p.w, p.h)}
                className="flex flex-col items-start p-3 rounded-lg text-left transition-all hover:opacity-90"
                style={{
                  backgroundColor: "oklch(var(--sidebar-left))",
                  border: "1px solid oklch(var(--outline))",
                  color: "oklch(var(--text))",
                }}
              >
                <span className="text-sm font-semibold">
                  {final.width} × {final.height}
                </span>
                <span
                  className="text-xs mt-0.5"
                  style={{ color: "oklch(var(--muted-text))" }}
                >
                  {p.label}
                </span>
              </button>
            );
          })}
        </div>

        {/* Custom size */}
        <div
          className="rounded-xl p-4 flex flex-col gap-3"
          style={{
            backgroundColor: "oklch(var(--sidebar-left))",
            border: "1px solid oklch(var(--outline))",
          }}
        >
          <span
            className="text-xs font-semibold uppercase tracking-wider"
            style={{ color: "oklch(var(--muted-text))" }}
          >
            Custom Size
          </span>
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={customW}
              onChange={(e) => onCustomWChange(e.target.value)}
              className="w-full px-3 py-1.5 rounded-lg text-sm"
              style={{
                backgroundColor: "oklch(var(--toolbar))",
                border: "1px solid oklch(var(--outline))",
                color: "oklch(var(--text))",
                outline: "none",
              }}
              placeholder="Width"
              min={1}
              max={16384}
            />
            <span style={{ color: "oklch(var(--muted-text))" }}>×</span>
            <input
              type="number"
              value={customH}
              onChange={(e) => onCustomHChange(e.target.value)}
              className="w-full px-3 py-1.5 rounded-lg text-sm"
              style={{
                backgroundColor: "oklch(var(--toolbar))",
                border: "1px solid oklch(var(--outline))",
                color: "oklch(var(--text))",
                outline: "none",
              }}
              placeholder="Height"
              min={1}
              max={16384}
            />
          </div>
          <button
            type="button"
            data-ocid="new_doc_modal.create_custom"
            onClick={handleCustomCreate}
            className="w-full py-2 rounded-lg text-sm font-semibold transition-all hover:opacity-90"
            style={{
              backgroundColor: "oklch(var(--accent))",
              color: "oklch(var(--accent-text))",
            }}
          >
            Create
          </button>
        </div>
      </motion.div>
    </div>
  );
}
