import { CloseTabDialog } from "@/components/CloseTabDialog";
import { DocumentTabBar } from "@/components/DocumentTabBar";
import { NewDocumentModal } from "@/components/NewDocumentModal";
import { PaintingApp } from "@/components/PaintingApp";
import { SplashScreen } from "@/components/SplashScreen";
import { Toaster } from "@/components/ui/sonner";
import {
  DocumentProvider,
  useDocumentContext,
} from "@/context/DocumentContext";
import { useIsMobile } from "@/hooks/useIsMobile";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { X } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { Component, useCallback, useEffect, useRef, useState } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { createActorWithConfig } from "./config";
import {
  InternetIdentityProvider,
  useInternetIdentity,
} from "./hooks/useInternetIdentity";
import type { PresetsPayload } from "./hooks/usePresetSystem";
import {
  type ThemeId,
  applyThemeOverrides,
  importThemes,
} from "./utils/themeOverrides";

const queryClient = new QueryClient();

// ── PaintingApp error boundary ────────────────────────────────────────────────

interface PaintingErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class PaintingErrorBoundary extends Component<
  { children: ReactNode },
  PaintingErrorBoundaryState
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): PaintingErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(
      "[PaintingApp] Render error caught by ErrorBoundary:",
      error,
      info,
    );
  }

  render() {
    if (this.state.hasError) {
      return null;
    }
    return this.props.children;
  }
}

const THEME_KEY = "sl-theme";
const SESSION_EXISTS_KEY = "sl_has_session";

// ── AppInner ──────────────────────────────────────────────────────────────────

function AppInner() {
  const [softwareWebGL, setSoftwareWebGL] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const { identity, login, clear, isInitializing } = useInternetIdentity();
  const isLoggedIn = !!identity && !identity.getPrincipal().isAnonymous();
  const { isMobile, forceDesktop } = useIsMobile();

  // Splash: shown on every launch until the user makes a choice
  const [showSplash, setShowSplash] = useState(true);

  // All document operations come from context — no duplicate logic here
  const {
    documents,
    activeDocumentId,
    swappingToId,
    removeDocument,
    createDocument,
    openFileAsDocument,
    getSktchBlob,
    setDirty,
    handleSwitchDocument,
  } = useDocumentContext();

  // Return to splash when all tabs are closed
  useEffect(() => {
    if (activeDocumentId === null) {
      setShowSplash(true);
    }
  }, [activeDocumentId]);

  // Settings sync state
  const settingsSyncedRef = useRef(false);
  const loadPresetsRef = useRef<((payload: PresetsPayload) => void) | null>(
    null,
  );
  const presetSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Modal / dialog state
  const [showNewDocModal, setShowNewDocModal] = useState(false);
  const [newDocWidth, setNewDocWidth] = useState("");
  const [newDocHeight, setNewDocHeight] = useState("");
  const [closeDialogState, setCloseDialogState] = useState<{
    docId: string;
    filename: string;
  } | null>(null);

  // Detect software WebGL
  useEffect(() => {
    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl") ||
      canvas.getContext("experimental-webgl")) as WebGLRenderingContext | null;
    if (gl) {
      const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
      if (debugInfo) {
        const renderer = gl.getParameter(
          debugInfo.UNMASKED_RENDERER_WEBGL,
        ) as string;
        if (/swiftshader|llvmpipe|software|mesa offscreen/i.test(renderer)) {
          setSoftwareWebGL(true);
        }
      }
    }
  }, []);

  // Silently sync settings when the user logs in
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional one-shot on login change
  useEffect(() => {
    if (isInitializing) return;
    if (!isLoggedIn) {
      settingsSyncedRef.current = false;
      return;
    }
    if (settingsSyncedRef.current) return;
    settingsSyncedRef.current = true;

    void (async () => {
      try {
        const actor = await createActorWithConfig({
          agentOptions: { identity },
        });

        console.log("[Load] Fetching user settings from backend...");
        const settingsJson = await actor.getUserSettings();
        console.log("[Load] Raw user settings from backend:", settingsJson);
        if (settingsJson) {
          try {
            const settings = JSON.parse(settingsJson) as {
              theme?: string;
              themeOverrides?: Record<string, Record<string, string>>;
              hotkeys?: Record<string, string[]>;
              presets?: PresetsPayload;
            };
            console.log("[Load] Parsed user settings:", settings);
            if (settings.theme) {
              const validTheme = settings.theme as ThemeId;
              localStorage.setItem(THEME_KEY, validTheme);
              for (const cls of [...document.documentElement.classList]) {
                if (cls.startsWith("theme-"))
                  document.documentElement.classList.remove(cls);
              }
              document.documentElement.classList.add(`theme-${validTheme}`);
              applyThemeOverrides(validTheme);
            }
            console.log("[Load] Parsed preferences applied (theme/hotkeys):", {
              theme: settings.theme,
              hotkeys: settings.hotkeys,
            });
            if (settings.themeOverrides) {
              const currentTheme = (localStorage.getItem(THEME_KEY) ||
                "light") as ThemeId;
              importThemes(settings.themeOverrides, currentTheme);
            }
            if (settings.hotkeys) {
              try {
                localStorage.setItem(
                  "sl_hotkeys",
                  JSON.stringify(settings.hotkeys),
                );
              } catch {
                // ignore hotkey restore errors
              }
            }
            console.log(
              "[Load] Raw brush settings from storage:",
              settings.presets,
            );
            if (settings.presets && loadPresetsRef.current) {
              try {
                loadPresetsRef.current(settings.presets);
                console.log(
                  "[Load] Brush settings handed off to preset system for application",
                );
              } catch {
                // ignore preset restore errors
              }
            } else if (!settings.presets) {
              console.warn("[Load] Brush settings: null — nothing to load");
            }
          } catch (e) {
            console.warn("Failed to parse cloud settings", e);
          }
        }
      } catch (e) {
        console.warn("[Load] Failed to load user settings:", e);
      }
    })();
  }, [isLoggedIn, isInitializing]);

  // ── Splash handlers ──────────────────────────────────────────────────────

  const handleNewCanvas = useCallback(
    (opts: { width: number; height: number }) => {
      createDocument(opts.width, opts.height, "Untitled-1.sktch");
      setShowSplash(false);
      localStorage.setItem(SESSION_EXISTS_KEY, "1");
    },
    [createDocument],
  );

  const handleOpenFile = useCallback(
    async (file: File) => {
      setShowSplash(false);
      localStorage.setItem(SESSION_EXISTS_KEY, "1");
      // Short delay so the splash fade-out completes before loading
      setTimeout(() => {
        openFileAsDocument(file);
      }, 100);
    },
    [openFileAsDocument],
  );

  const handleLogout = useCallback(() => {
    clear();
    settingsSyncedRef.current = false;
  }, [clear]);

  // ── Brush preset auto-save ────────────────────────────────────────────────

  const identityRef = useRef(identity);
  identityRef.current = identity;

  const handlePresetsMutated = useCallback(
    async (presetsJson: string) => {
      if (presetSaveTimerRef.current !== null) {
        clearTimeout(presetSaveTimerRef.current);
        presetSaveTimerRef.current = null;
      }
      if (activeDocumentId) setDirty(activeDocumentId, true);

      try {
        const currentIdentity = identityRef.current;
        if (!currentIdentity || currentIdentity.getPrincipal().isAnonymous())
          return;
        const actor = await createActorWithConfig({
          agentOptions: { identity: currentIdentity },
        });
        let base: Record<string, unknown> = {};
        try {
          const existing = await actor.getUserSettings();
          console.log("[Save] Existing user settings from backend:", existing);
          if (existing) {
            base = JSON.parse(existing) as Record<string, unknown>;
          }
        } catch {
          // start fresh
        }
        const presets = JSON.parse(presetsJson) as PresetsPayload;
        console.log(
          "[Save] Brush settings: queuing save for presets payload:",
          presets,
        );
        const merged = { ...base, presets };
        console.log("[Save] Merged settings being written to backend:", merged);
        await actor.saveUserSettings(JSON.stringify(merged));
      } catch (error) {
        console.warn("[Save] Brush settings: save failed:", error);
      }
    },
    [activeDocumentId, setDirty],
  );

  // ── Tab bar handlers ──────────────────────────────────────────────────────

  const handleNewDocument = useCallback(() => {
    // Reset custom size fields each time the modal opens
    setNewDocWidth("");
    setNewDocHeight("");
    setShowNewDocModal(true);
  }, []);

  const handleNewDocumentCreate = useCallback(
    (width: number, height: number) => {
      setShowNewDocModal(false);
      createDocument(width, height);
    },
    [createDocument],
  );

  const handleOpenDocument = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".sktch";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      openFileAsDocument(file);
    };
    input.click();
  }, [openFileAsDocument]);

  const handleCloseTab = useCallback(
    (id: string) => {
      const doc = documents.find((d) => d.id === id);
      if (!doc) return;
      if (doc.isDirty) {
        setCloseDialogState({ docId: id, filename: doc.filename });
        return;
      }
      removeDocument(id);
    },
    [documents, removeDocument],
  );

  const handleCloseDialogSave = useCallback(async () => {
    if (!closeDialogState) return;
    const { docId, filename } = closeDialogState;
    setCloseDialogState(null);

    if (docId === activeDocumentId && getSktchBlob) {
      try {
        const blob = await getSktchBlob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
      } catch {
        // Save failed silently — close anyway
      }
    }
    removeDocument(docId);
  }, [closeDialogState, activeDocumentId, getSktchBlob, removeDocument]);

  const handleCloseDialogDiscard = useCallback(() => {
    if (!closeDialogState) return;
    removeDocument(closeDialogState.docId);
    setCloseDialogState(null);
  }, [closeDialogState, removeDocument]);

  const handleCloseDialogCancel = useCallback(() => {
    setCloseDialogState(null);
  }, []);

  // ── Mark dirty on first user interaction ─────────────────────────────────
  useEffect(() => {
    if (!activeDocumentId) return;
    let marked = false;
    const handlePointerDown = () => {
      if (!marked) {
        marked = true;
        setDirty(activeDocumentId, true);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [activeDocumentId, setDirty]);

  const principalId = isLoggedIn
    ? identity!.getPrincipal().toString()
    : undefined;

  return (
    <>
      {softwareWebGL && !dismissed && (
        <div
          data-ocid="software_webgl.toast"
          className="fixed top-0 left-0 right-0 z-[9999] flex items-center justify-between gap-3 bg-amber-400 px-4 py-2 text-amber-950 shadow-md"
        >
          <span className="text-sm font-medium">
            ⚠️ Hardware acceleration is disabled in your browser. SketchLair may
            feel slow. To fix this, enable hardware acceleration in your browser
            settings.
          </span>
          <button
            type="button"
            data-ocid="software_webgl.close_button"
            onClick={() => setDismissed(true)}
            className="shrink-0 rounded p-0.5 hover:bg-amber-500 transition-colors"
            aria-label="Dismiss warning"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* PaintingApp: always mounted (behind splash), single persistent instance.
          Wrapped in ErrorBoundary so any render crash does not kill the SplashScreen. */}
      <PaintingErrorBoundary>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            height: "100vh",
            overflow: "hidden",
          }}
        >
          {/* Main canvas area — paddingBottom compensates for fixed DocumentTabBar height */}
          <div
            style={{
              flex: 1,
              overflow: "hidden",
              position: "relative",
              paddingBottom: "36px",
            }}
          >
            {/* PaintingApp reads registerSwapFn / registerLoadFileFn / registerGetSktchBlobFn
                directly from DocumentContext — no prop drilling needed */}
            <PaintingApp
              isLoggedIn={isLoggedIn}
              identity={identity ?? undefined}
              onLogin={login}
              onLogout={handleLogout}
              onPresetsMutated={handlePresetsMutated}
              registerLoadPresets={(fn) => {
                loadPresetsRef.current = fn;
              }}
              cloudSave={undefined}
              getCanvasHash={undefined}
            />
          </div>

          {/* Tab bar — desktop only, fixed at bottom */}
          <DocumentTabBar
            documents={documents.map((d) => ({
              id: d.id,
              filename: d.filename,
              isDirty: d.isDirty,
            }))}
            activeDocumentId={activeDocumentId}
            swappingToId={swappingToId}
            onSwitchDocument={handleSwitchDocument}
            onCloseTab={handleCloseTab}
            onNewDocument={handleNewDocument}
            onOpenDocument={handleOpenDocument}
            isMobile={isMobile}
            forceDesktop={forceDesktop}
          />
        </div>
      </PaintingErrorBoundary>

      {/* New Document Resolution Selector Modal */}
      <AnimatePresence>
        {showNewDocModal && (
          <NewDocumentModal
            onCreate={handleNewDocumentCreate}
            onCancel={() => setShowNewDocModal(false)}
            customW={newDocWidth}
            customH={newDocHeight}
            onCustomWChange={setNewDocWidth}
            onCustomHChange={setNewDocHeight}
          />
        )}
      </AnimatePresence>

      {/* Close Tab Confirmation Dialog */}
      <AnimatePresence>
        {closeDialogState && (
          <CloseTabDialog
            filename={closeDialogState.filename}
            onSave={handleCloseDialogSave}
            onDiscard={handleCloseDialogDiscard}
            onCancel={handleCloseDialogCancel}
          />
        )}
      </AnimatePresence>

      {showSplash && (
        <SplashScreen
          principalId={principalId}
          isLoggedIn={isLoggedIn}
          onLogin={login}
          onLogout={handleLogout}
          onNewCanvas={handleNewCanvas}
          onOpenFile={handleOpenFile}
        />
      )}

      <Toaster />
    </>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <InternetIdentityProvider>
        <DocumentProvider>
          <AppInner />
        </DocumentProvider>
      </InternetIdentityProvider>
    </QueryClientProvider>
  );
}
