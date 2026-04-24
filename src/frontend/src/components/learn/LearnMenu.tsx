// ── LearnMenu ──────────────────────────────────────────────────────────────────
//
// The Learn module selection screen. Shown after clicking "Learning" on the
// splash screen. Adding future modules only requires extending the MODULES array.

import { ArrowLeft, PersonStanding } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

interface LearnModule {
  id: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  available: boolean;
}

const MODULES: LearnModule[] = [
  {
    id: "figure-drawing",
    icon: <PersonStanding size={22} />,
    title: "Figure Drawing",
    description:
      "Timed gesture sessions with reference images. Build speed and confidence drawing the human form.",
    available: true,
  },
  // Future modules — add here without structural changes
  // { id: 'still-life', icon: <Apple size={22} />, title: 'Still Life', description: '...', available: false },
  // { id: 'portrait', icon: <Smile size={22} />, title: 'Portrait', description: '...', available: false },
];

interface LearnMenuProps {
  onSelectModule: (moduleId: string) => void;
  onBack: () => void;
}

export function LearnMenu({ onSelectModule, onBack }: LearnMenuProps) {
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key="learn-menu"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -16 }}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-sm flex flex-col gap-4"
      >
        {/* Header */}
        <div className="flex items-center gap-3 mb-2">
          <button
            type="button"
            data-ocid="learn_menu.back_button"
            onClick={onBack}
            className="flex items-center gap-1.5 text-xs px-2 py-1 rounded transition-opacity hover:opacity-80"
            style={{
              color: "oklch(var(--muted-text))",
              backgroundColor: "oklch(var(--sidebar-left))",
            }}
          >
            <ArrowLeft size={12} />
            Back
          </button>
          <h2
            className="text-sm font-semibold uppercase tracking-wider"
            style={{ color: "oklch(var(--muted-text))" }}
          >
            Learn
          </h2>
        </div>

        {/* Module list */}
        <div className="flex flex-col gap-2">
          {MODULES.map((mod) => (
            <button
              key={mod.id}
              type="button"
              data-ocid={`learn_menu.module.${mod.id.replace(/-/g, "_")}`}
              disabled={!mod.available}
              onClick={() => mod.available && onSelectModule(mod.id)}
              className="flex items-center gap-4 p-4 rounded-xl text-left transition-all hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                backgroundColor: "oklch(var(--toolbar))",
                border: "1px solid oklch(var(--outline))",
                color: "oklch(var(--text))",
              }}
            >
              <div
                className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                style={{
                  backgroundColor: mod.available
                    ? "oklch(var(--accent) / 0.15)"
                    : "oklch(var(--sidebar-left))",
                  color: mod.available
                    ? "oklch(var(--accent))"
                    : "oklch(var(--muted-text))",
                }}
              >
                {mod.icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm flex items-center gap-2">
                  {mod.title}
                  {!mod.available && (
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                      style={{
                        backgroundColor: "oklch(var(--sidebar-left))",
                        color: "oklch(var(--muted-text))",
                      }}
                    >
                      Soon
                    </span>
                  )}
                </div>
                <div
                  className="text-xs mt-0.5 leading-relaxed"
                  style={{ color: "oklch(var(--muted-text))" }}
                >
                  {mod.description}
                </div>
              </div>
            </button>
          ))}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
