import { FigureDrawingSetup } from "@/components/learn/FigureDrawingSetup";
import { LearnAuthGate } from "@/components/learn/LearnAuthGate";
import { LearnMenu } from "@/components/learn/LearnMenu";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import type { FigureDrawingConfig } from "@/types/learn";
import {
  FolderOpen,
  GraduationCap,
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
  principalId?: string;
  isLoggedIn: boolean;
  onLogin: () => void;
  onLogout: () => void;
  onNewCanvas: (opts: NewCanvasOptions) => void;
  onOpenFile: (file: File) => void;
  onLearnModule?: (moduleId: string) => void;
  onStartFigureDrawing?: (
    config: FigureDrawingConfig,
    imageSets: import("@/types/learn").ImageSet[],
  ) => void;
  onAdminPortal?: () => void;
  onShowMarketplace?: () => void;
  onSettings?: () => void;
  username?: string;
}

const PRESETS: { label: string; w: number; h: number }[] = [
  { label: "1920 × 1080", w: 1920, h: 1080 },
  { label: "2048 × 2048", w: 2048, h: 2048 },
  { label: "2560 × 1440", w: 2560, h: 1440 },
  { label: "3840 × 2160", w: 3840, h: 2160 },
  { label: "4096 × 2048", w: 4096, h: 2048 },
];

type View = "main" | "new-canvas" | "learn-gate" | "learn";

export function SplashScreen({
  principalId,
  isLoggedIn,
  onLogin,
  onLogout,
  onNewCanvas,
  onOpenFile,
  onLearnModule,
  onStartFigureDrawing,
  onAdminPortal,
  onShowMarketplace,
  onSettings,
  username,
}: SplashScreenProps) {
  const { isAdmin, username: authUsername } = useAuth();
  const [view, setView] = useState<View>("main");
  const [selectedModule, setSelectedModule] = useState<string | null>(null);
  const [orientation, setOrientation] = useState<"landscape" | "portrait">(
    "landscape",
  );
  const [customW, setCustomW] = useState("");
  const [customH, setCustomH] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Resolve display name: prefer username prop, then hook's username, then truncated principal
  const displayName = username ?? authUsername ?? null;
  const shortPrincipal =
    principalId && principalId.length > 8
      ? `${principalId.substring(0, 8)}…`
      : (principalId ?? "");
  const signedInName = displayName
    ? displayName
    : isLoggedIn
      ? shortPrincipal
      : null;

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
    onNewCanvas(applyOrientation(w, h));
  };

  const handleCustomCreate = () => {
    const w = Math.max(1, Math.min(16384, Number.parseInt(customW, 10) || 0));
    const h = Math.max(1, Math.min(16384, Number.parseInt(customH, 10) || 0));
    if (!customW.trim() || !customH.trim() || w <= 0 || h <= 0) return;
    onNewCanvas({ width: w, height: h });
  };

  const handleOpenFile = async () => {
    setFileError(null);
    if ("showOpenFilePicker" in window) {
      try {
        const [fileHandle] = await (
          window as Window & {
            showOpenFilePicker: (
              opts: unknown,
            ) => Promise<{ getFile: () => Promise<File> }[]>;
          }
        ).showOpenFilePicker({
          types: [
            {
              description: "SketchLair Files",
              accept: { "application/octet-stream": [".sktch"] },
            },
          ],
          multiple: false,
        });
        const file = await fileHandle.getFile();
        try {
          await onOpenFile(file);
        } catch {
          setFileError(
            "File could not be read. Make sure it is a valid .sktch file.",
          );
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name !== "AbortError") {
          setFileError("Could not open file. Please try again.");
        }
      }
    } else {
      fileInputRef.current?.click();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        onOpenFile(file);
      } catch {
        setFileError(
          "File could not be read. Make sure it is a valid .sktch file.",
        );
      }
    }
    e.target.value = "";
  };

  // ── Shared style shortcuts ────────────────────────────────────────────────
  const primaryBtnStyle: React.CSSProperties = {
    backgroundColor: "oklch(var(--accent))",
    color: "oklch(var(--accent-text))",
    border: "none",
  };
  const secondaryBtnStyle: React.CSSProperties = {
    backgroundColor: "oklch(var(--sidebar-left))",
    color: "oklch(var(--text))",
    border: "1px solid oklch(var(--outline))",
  };
  const ghostBtnStyle: React.CSSProperties = {
    backgroundColor: "transparent",
    color: "oklch(var(--text))",
    border: "1px solid oklch(var(--outline))",
  };

  const btnBase =
    "flex items-center justify-center gap-2 w-full py-3 px-5 rounded-xl font-semibold transition-opacity hover:opacity-85 active:opacity-70 text-sm";

  // ── New-canvas sub-view (shared) ─────────────────────────────────────────
  const newCanvasView = (
    <motion.div
      key="new-canvas"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -16 }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      className="w-full flex flex-col gap-4 mb-8"
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
  );

  // ── Unified layout ────────────────────────────────────────────────────────
  return (
    <>
      <div
        data-ocid="splash.panel"
        className="fixed inset-0 z-[9000] flex items-center justify-center overflow-y-auto"
        style={{ backgroundColor: "oklch(var(--toolbar))" }}
      >
        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".sktch"
          className="hidden"
          onChange={handleFileChange}
        />

        {/* Centered content column */}
        <div
          className="flex flex-col items-center w-full px-6 py-8"
          style={{ maxWidth: 360 }}
        >
          {/* ── Logo area ──────────────────────────────────────────────────── */}
          <div
            className="flex flex-col items-center gap-2 mb-8"
            style={{ marginTop: "10vh" }}
          >
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center"
              style={{ backgroundColor: "oklch(var(--accent))" }}
            >
              <Palette
                size={28}
                style={{ color: "oklch(var(--accent-text))" }}
              />
            </div>
            <h1
              className="text-2xl font-bold tracking-tight leading-none mt-1"
              style={{ color: "oklch(var(--text))" }}
            >
              SketchLair
            </h1>
            <p
              className="text-sm font-normal"
              style={{ color: "oklch(var(--muted-text))" }}
            >
              your digital studio
            </p>
          </div>

          {/* ── Main content: either action buttons or sub-view ────────────── */}
          <div className="w-full">
            <AnimatePresence mode="wait">
              {view === "main" && (
                <motion.div
                  key="main"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                  className="flex flex-col items-stretch w-full gap-0"
                >
                  {/* Row 1: New Canvas | Load — side by side */}
                  <div className="flex gap-2 w-full">
                    <button
                      type="button"
                      data-ocid="splash.new_canvas_button"
                      onClick={() => setView("new-canvas")}
                      className="flex-1 flex items-center justify-center gap-2 py-3 px-3 rounded-xl font-semibold transition-opacity hover:opacity-85 active:opacity-70 text-sm"
                      style={primaryBtnStyle}
                    >
                      <Plus size={16} />
                      New Canvas
                    </button>
                    <div className="flex flex-col flex-1 gap-1">
                      <button
                        type="button"
                        data-ocid="splash.open_file_button"
                        onClick={handleOpenFile}
                        className="flex-1 flex items-center justify-center gap-2 py-3 px-3 rounded-xl font-semibold transition-opacity hover:opacity-85 active:opacity-70 text-sm"
                        style={secondaryBtnStyle}
                      >
                        <FolderOpen size={16} />
                        Load
                      </button>
                    </div>
                  </div>

                  {/* File error */}
                  {fileError && (
                    <p
                      data-ocid="splash.file_error"
                      className="text-xs text-center mt-1.5"
                      style={{ color: "oklch(0.65 0.22 25)" }}
                    >
                      {fileError}
                    </p>
                  )}

                  {/* Row 2: Learn */}
                  <button
                    type="button"
                    data-ocid="splash.learning_button"
                    onClick={() => {
                      setView("learn-gate");
                      setSelectedModule(null);
                    }}
                    className={`${btnBase} mt-2`}
                    style={secondaryBtnStyle}
                  >
                    <GraduationCap size={16} />
                    Learn
                  </button>

                  {/* Row 3: Marketplace */}
                  {onShowMarketplace && (
                    <button
                      type="button"
                      data-ocid="splash.marketplace_button"
                      onClick={onShowMarketplace}
                      className={`${btnBase} mt-2`}
                      style={secondaryBtnStyle}
                    >
                      <ShoppingBag size={16} />
                      Marketplace
                    </button>
                  )}

                  {/* Separator */}
                  <hr
                    className="my-5 w-full"
                    style={{ borderColor: "oklch(var(--outline))" }}
                  />

                  {/* Signed-in area */}
                  <div className="flex flex-col items-center gap-2 w-full">
                    {isLoggedIn ? (
                      <>
                        {/* "signed in as" label — informational, not a button */}
                        <div
                          className="flex items-center gap-1.5 text-sm"
                          style={{ color: "oklch(var(--muted-text))" }}
                        >
                          <User size={14} />
                          <span className="truncate max-w-[240px]">
                            signed in as{" "}
                            <span
                              className="font-medium"
                              style={{ color: "oklch(var(--text))" }}
                            >
                              {signedInName}
                            </span>
                          </span>
                        </div>

                        {/* Sign out link */}
                        <button
                          type="button"
                          data-ocid="splash.logout_button"
                          onClick={onLogout}
                          className="text-xs transition-opacity hover:opacity-70 hover:underline"
                          style={{ color: "oklch(var(--muted-text))" }}
                        >
                          sign out
                        </button>

                        {/* Admin link */}
                        {isAdmin === true && onAdminPortal && (
                          <button
                            type="button"
                            data-ocid="splash.admin_button"
                            onClick={onAdminPortal}
                            className="text-xs font-semibold tracking-wide transition-opacity hover:opacity-70"
                            style={{ color: "oklch(var(--accent))" }}
                          >
                            Admin
                          </button>
                        )}
                      </>
                    ) : (
                      <button
                        type="button"
                        data-ocid="splash.login_button"
                        onClick={onLogin}
                        className={btnBase}
                        style={ghostBtnStyle}
                      >
                        <User size={16} />
                        Sign In
                      </button>
                    )}
                  </div>

                  {/* Footer text links */}
                  {onSettings && (
                    <div className="flex justify-center mt-4 mb-2">
                      <button
                        type="button"
                        data-ocid="splash.settings_link"
                        onClick={onSettings}
                        className="text-xs transition-opacity hover:opacity-70 hover:underline"
                        style={{ color: "oklch(var(--muted-text))" }}
                      >
                        Settings
                      </button>
                    </div>
                  )}
                </motion.div>
              )}

              {view === "new-canvas" && newCanvasView}

              {view === "learn-gate" && (
                <motion.div
                  key="learn-gate"
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -16 }}
                  transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                  className="w-full flex flex-col gap-4 mb-8"
                >
                  <LearnAuthGate
                    onBack={() => {
                      setView("main");
                      setSelectedModule(null);
                    }}
                    onEnter={() => {
                      setView("learn");
                      setSelectedModule(null);
                    }}
                  />
                </motion.div>
              )}

              {view === "learn" && selectedModule === "figure-drawing" && (
                <motion.div
                  key="figure-drawing-setup"
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -16 }}
                  transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                  className="w-full mb-8"
                >
                  <FigureDrawingSetup
                    onBack={() => setSelectedModule(null)}
                    onStart={(config: FigureDrawingConfig, imageSets) => {
                      if (onStartFigureDrawing) {
                        onStartFigureDrawing(config, imageSets);
                      } else {
                        onLearnModule?.("figure-drawing");
                      }
                    }}
                    onShowMarketplace={onShowMarketplace}
                  />
                </motion.div>
              )}

              {view === "learn" && !selectedModule && (
                <motion.div
                  key="learn"
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -16 }}
                  transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                  className="w-full mb-8"
                >
                  <LearnMenu
                    onSelectModule={(moduleId) => {
                      setSelectedModule(moduleId);
                    }}
                    onBack={() => setView("main")}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </>
  );
}
