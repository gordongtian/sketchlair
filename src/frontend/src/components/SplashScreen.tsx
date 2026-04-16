import { Button } from "@/components/ui/button";
import {
  FolderOpen,
  GraduationCap,
  LogIn,
  LogOut,
  Monitor,
  Palette,
  Plus,
  ShoppingBag,
  User,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useRef, useState } from "react";

interface NewCanvasOptions {
  width: number;
  height: number;
}

interface SplashScreenProps {
  /** If logged in, show principal */
  principalId?: string;
  isLoggedIn: boolean;
  onLogin: () => void;
  onLogout: () => void;
  onNewCanvas: (opts: NewCanvasOptions) => void;
  onOpenFile: (file: File) => void;
}

const PRESETS: { label: string; w: number; h: number }[] = [
  { label: "1920 × 1080", w: 1920, h: 1080 },
  { label: "2048 × 2048", w: 2048, h: 2048 },
  { label: "2560 × 1440", w: 2560, h: 1440 },
  { label: "3840 × 2160", w: 3840, h: 2160 },
  { label: "4096 × 2048", w: 4096, h: 2048 },
];

type View = "main" | "new-canvas";

export function SplashScreen({
  principalId,
  isLoggedIn,
  onLogin,
  onLogout,
  onNewCanvas,
  onOpenFile,
}: SplashScreenProps) {
  const [view, setView] = useState<View>("main");
  const [orientation, setOrientation] = useState<"landscape" | "portrait">(
    "landscape",
  );
  const [customW, setCustomW] = useState("");
  const [customH, setCustomH] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const screenPreset = {
    label: "Screen Size",
    w: typeof window !== "undefined" ? window.screen.width : 1920,
    h: typeof window !== "undefined" ? window.screen.height : 1080,
  };
  const allPresets = [...PRESETS, screenPreset];

  const applyOrientation = (w: number, h: number): NewCanvasOptions => {
    if (orientation === "portrait")
      return { width: Math.min(w, h), height: Math.max(w, h) };
    return { width: Math.max(w, h), height: Math.min(w, h) };
  };

  const handlePreset = (w: number, h: number) => {
    const final = applyOrientation(w, h);
    onNewCanvas(final);
  };

  const handleCustomCreate = () => {
    const w = Math.max(1, Math.min(16384, Number.parseInt(customW, 10) || 0));
    const h = Math.max(1, Math.min(16384, Number.parseInt(customH, 10) || 0));
    // Require both dimensions to be explicitly entered
    if (!customW.trim() || !customH.trim() || w <= 0 || h <= 0) return;
    // Custom sizes: width is always width, height is always height.
    // Orientation toggle only applies to presets, NOT to custom sizes.
    onNewCanvas({ width: w, height: h });
  };

  const handleOpenFile = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onOpenFile(file);
    e.target.value = "";
  };

  const shortPrincipal =
    principalId && principalId.length > 12
      ? `${principalId.substring(0, 10)}…`
      : (principalId ?? "");

  return (
    <div
      data-ocid="splash.panel"
      className="fixed inset-0 z-[9000] flex"
      style={{
        background: "oklch(var(--canvas-bg) / 0.97)",
        backdropFilter: "blur(12px)",
      }}
    >
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".sktch"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Left sidebar — branding + nav */}
      <div
        className="flex flex-col w-64 shrink-0 border-r p-6 gap-6"
        style={{
          backgroundColor: "oklch(var(--toolbar))",
          borderColor: "oklch(var(--outline))",
        }}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 mt-2">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
            style={{ backgroundColor: "oklch(var(--accent))" }}
          >
            <Palette size={20} style={{ color: "oklch(var(--accent-text))" }} />
          </div>
          <div>
            <h1
              className="text-xl font-bold tracking-tight leading-none"
              style={{ color: "oklch(var(--text))" }}
            >
              SketchLair
            </h1>
            <p
              className="text-xs mt-0.5"
              style={{ color: "oklch(var(--muted-text))" }}
            >
              Professional Digital Painting
            </p>
          </div>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Placeholder nav items */}
        <div className="flex flex-col gap-2">
          <button
            type="button"
            data-ocid="splash.learning_button"
            disabled
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg opacity-50 cursor-not-allowed transition-opacity text-left"
            style={{
              backgroundColor: "oklch(var(--sidebar-left))",
              color: "oklch(var(--text))",
            }}
            title="Coming soon"
          >
            <GraduationCap
              size={16}
              style={{ color: "oklch(var(--muted-text))" }}
            />
            <div>
              <div className="text-sm font-medium">Learning</div>
              <div
                className="text-xs"
                style={{ color: "oklch(var(--muted-text))" }}
              >
                Coming soon
              </div>
            </div>
          </button>

          <button
            type="button"
            data-ocid="splash.marketplace_button"
            disabled
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg opacity-50 cursor-not-allowed transition-opacity text-left"
            style={{
              backgroundColor: "oklch(var(--sidebar-left))",
              color: "oklch(var(--text))",
            }}
            title="Coming soon"
          >
            <ShoppingBag
              size={16}
              style={{ color: "oklch(var(--muted-text))" }}
            />
            <div>
              <div className="text-sm font-medium">Marketplace</div>
              <div
                className="text-xs"
                style={{ color: "oklch(var(--muted-text))" }}
              >
                Coming soon
              </div>
            </div>
          </button>
        </div>

        {/* Login / user section */}
        <div
          className="pt-4 border-t"
          style={{ borderColor: "oklch(var(--outline))" }}
        >
          {isLoggedIn && principalId ? (
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <User size={12} style={{ color: "oklch(var(--muted-text))" }} />
                <span
                  className="text-xs font-mono truncate"
                  style={{ color: "oklch(var(--muted-text))" }}
                >
                  {shortPrincipal}
                </span>
              </div>
              <button
                type="button"
                data-ocid="splash.logout_button"
                onClick={onLogout}
                className="p-1.5 rounded-lg transition-opacity hover:opacity-80 shrink-0"
                style={{ color: "oklch(var(--muted-text))" }}
                title="Log out"
              >
                <LogOut size={14} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              data-ocid="splash.login_button"
              onClick={onLogin}
              className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm font-medium transition-opacity hover:opacity-80"
              style={{
                backgroundColor: "oklch(var(--sidebar-left))",
                color: "oklch(var(--text))",
                border: "1px solid oklch(var(--outline))",
              }}
            >
              <LogIn size={14} />
              Log in
            </button>
          )}
        </div>
      </div>

      {/* Main content area */}
      <div className="flex-1 flex items-center justify-center p-8">
        <AnimatePresence mode="wait">
          {view === "main" && (
            <motion.div
              key="main"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="w-full max-w-sm flex flex-col gap-4"
            >
              <h2
                className="text-sm font-semibold uppercase tracking-wider mb-2"
                style={{ color: "oklch(var(--muted-text))" }}
              >
                Start
              </h2>

              {/* New Canvas */}
              <button
                type="button"
                data-ocid="splash.new_canvas_button"
                onClick={() => setView("new-canvas")}
                className="flex items-center gap-4 p-4 rounded-xl text-left transition-all hover:opacity-90"
                style={{
                  backgroundColor: "oklch(var(--toolbar))",
                  border: "1px solid oklch(var(--outline))",
                  color: "oklch(var(--text))",
                }}
              >
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                  style={{ backgroundColor: "oklch(var(--sidebar-left))" }}
                >
                  <Plus size={18} style={{ color: "oklch(var(--text))" }} />
                </div>
                <div>
                  <div className="font-semibold text-sm">New Canvas</div>
                  <div
                    className="text-xs mt-0.5"
                    style={{ color: "oklch(var(--muted-text))" }}
                  >
                    Choose size and orientation
                  </div>
                </div>
              </button>

              {/* Open File */}
              <button
                type="button"
                data-ocid="splash.open_file_button"
                onClick={handleOpenFile}
                className="flex items-center gap-4 p-4 rounded-xl text-left transition-all hover:opacity-90"
                style={{
                  backgroundColor: "oklch(var(--toolbar))",
                  border: "1px solid oklch(var(--outline))",
                  color: "oklch(var(--text))",
                }}
              >
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                  style={{ backgroundColor: "oklch(var(--sidebar-left))" }}
                >
                  <FolderOpen
                    size={18}
                    style={{ color: "oklch(var(--text))" }}
                  />
                </div>
                <div>
                  <div className="font-semibold text-sm">Open File</div>
                  <div
                    className="text-xs mt-0.5"
                    style={{ color: "oklch(var(--muted-text))" }}
                  >
                    Load a .sktch file
                  </div>
                </div>
              </button>
            </motion.div>
          )}

          {view === "new-canvas" && (
            <motion.div
              key="new-canvas"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="w-full max-w-sm flex flex-col gap-4"
            >
              <div className="flex items-center gap-3 mb-2">
                <button
                  type="button"
                  onClick={() => setView("main")}
                  className="text-xs px-2 py-1 rounded hover:opacity-80 transition-opacity"
                  style={{
                    color: "oklch(var(--muted-text))",
                    backgroundColor: "oklch(var(--sidebar-left))",
                  }}
                >
                  ← Back
                </button>
                <h2
                  className="text-sm font-semibold uppercase tracking-wider"
                  style={{ color: "oklch(var(--muted-text))" }}
                >
                  New Canvas
                </h2>
              </div>

              {/* Orientation toggle */}
              <div className="flex gap-2">
                {(["landscape", "portrait"] as const).map((o) => (
                  <button
                    key={o}
                    type="button"
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
                        transform:
                          o === "portrait" ? "rotate(90deg)" : undefined,
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
                      data-ocid={`splash.preset_${p.label.replace(/\s+/g, "_").toLowerCase()}`}
                      onClick={() => handlePreset(p.w, p.h)}
                      className="flex flex-col items-start p-3 rounded-lg text-left transition-all hover:opacity-90"
                      style={{
                        backgroundColor: "oklch(var(--toolbar))",
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
                  backgroundColor: "oklch(var(--toolbar))",
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
                    onChange={(e) => setCustomW(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg text-sm"
                    style={{
                      backgroundColor: "oklch(var(--sidebar-left))",
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
                    onChange={(e) => setCustomH(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg text-sm"
                    style={{
                      backgroundColor: "oklch(var(--sidebar-left))",
                      border: "1px solid oklch(var(--outline))",
                      color: "oklch(var(--text))",
                      outline: "none",
                    }}
                    placeholder="Height"
                    min={1}
                    max={16384}
                  />
                </div>
                <Button
                  data-ocid="splash.create_custom_button"
                  onClick={handleCustomCreate}
                  className="w-full"
                  style={{
                    backgroundColor: "oklch(var(--accent))",
                    color: "oklch(var(--accent-text))",
                  }}
                >
                  Create
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
