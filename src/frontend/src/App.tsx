import { AdminPortal } from "@/components/AdminPortal";
import { CloseTabDialog } from "@/components/CloseTabDialog";
import { DocumentTabBar } from "@/components/DocumentTabBar";
import { MarketplaceScreen } from "@/components/MarketplaceScreen";
import { NewDocumentModal } from "@/components/NewDocumentModal";
import { PaintingApp } from "@/components/PaintingApp";
import { SplashScreen } from "@/components/SplashScreen";
import { FigureDrawingSetup } from "@/components/learn/FigureDrawingSetup";
import { SessionEndScreen } from "@/components/learn/SessionEndScreen";
import { Toaster } from "@/components/ui/sonner";
import {
  DocumentProvider,
  useDocumentContext,
} from "@/context/DocumentContext";
import { useAuth } from "@/hooks/useAuth";
import { useIsMobile } from "@/hooks/useIsMobile";
import { usePreferences } from "@/hooks/usePreferences";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { X } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { Component, useCallback, useEffect, useRef, useState } from "react";
import type { ErrorInfo, ReactNode } from "react";
import {
  InternetIdentityProvider,
  useInternetIdentity,
} from "./hooks/useInternetIdentity";
import type { PresetsPayload } from "./hooks/usePresetSystem";
import type { FigureDrawingConfig, ImageSet } from "./types/learn";
import { type ThemeId, applyThemeOverrides } from "./utils/themeOverrides";

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

// Figure drawing session flow state
type FigureDrawingView =
  | { mode: "idle" }
  | { mode: "setup" }
  | {
      mode: "session";
      config: FigureDrawingConfig;
      imageSets: ImageSet[];
      handedness: "left" | "right";
    }
  | { mode: "end"; snapshots: ImageData[] };

function AppInner() {
  const [softwareWebGL, setSoftwareWebGL] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [brushTipEditorActive, setBrushTipEditorActive] = useState(false);

  const { identity, login, clear } = useInternetIdentity();
  const isLoggedIn = !!identity && !identity.getPrincipal().isAnonymous();
  const { isMobile, forceDesktop } = useIsMobile();

  // Admin status — fetched once per authenticated session via useAuth
  const { isAdmin } = useAuth();

  // Admin portal state
  const [showAdminPortal, setShowAdminPortal] = useState(false);
  const handleAdminPortalBack = useCallback(
    () => setShowAdminPortal(false),
    [],
  );

  // Marketplace state
  const [showMarketplace, setShowMarketplace] = useState(false);
  const handleShowMarketplace = useCallback(() => setShowMarketplace(true), []);
  const handleCloseMarketplace = useCallback(
    () => setShowMarketplace(false),
    [],
  );

  // ── Figure Drawing state ─────────────────────────────────────────────────
  const [figDrawView, setFigDrawView] = useState<FigureDrawingView>({
    mode: "idle",
  });

  // ── Preferences (canister-backed) ─────────────────────────────────────────
  const preferences = usePreferences(identity, isLoggedIn);

  // Apply loaded preferences to DOM once loading is done
  useEffect(() => {
    if (preferences.isLoading) return;
    const { theme } = preferences.settings;
    if (theme) {
      const validTheme = theme as ThemeId;
      localStorage.setItem(THEME_KEY, validTheme);
      for (const cls of [...document.documentElement.classList]) {
        if (cls.startsWith("theme-"))
          document.documentElement.classList.remove(cls);
      }
      if (validTheme === "dark") {
        document.documentElement.classList.add("dark");
      } else if (validTheme !== "light") {
        document.documentElement.classList.add(`theme-${validTheme}`);
      }
      applyThemeOverrides(validTheme);
    }
    // Apply hotkeys from canister if present
    const { assignments } = preferences.hotkeys;
    if (assignments && assignments !== "[]") {
      try {
        const parsed = JSON.parse(assignments) as Array<{
          id: string;
          primary: unknown;
          secondary: unknown;
        }>;
        if (Array.isArray(parsed) && parsed.length > 0) {
          const hotkeyMap: Record<string, unknown> = {};
          for (const action of parsed) {
            if (action.id) hotkeyMap[action.id] = action;
          }
          localStorage.setItem("sl_hotkeys", JSON.stringify(hotkeyMap));
          window.dispatchEvent(new Event("sl:hotkeys-updated"));
        }
      } catch {
        // ignore malformed hotkey data
      }
    }
  }, [preferences.isLoading, preferences.settings, preferences.hotkeys]);

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

  // Update page title whenever the active document changes
  useEffect(() => {
    if (!activeDocumentId) {
      document.title = "SketchLair";
      return;
    }
    const doc = documents.find((d) => d.id === activeDocumentId);
    if (doc) {
      const baseName = doc.filename.replace(/\.sktch$/i, "");
      document.title = baseName ? `${baseName} — SketchLair` : "SketchLair";
    }
  }, [activeDocumentId, documents]);

  // Return to splash when all tabs are closed
  useEffect(() => {
    if (activeDocumentId === null) {
      setShowSplash(true);
    }
  }, [activeDocumentId]);

  const loadPresetsRef = useRef<((payload: PresetsPayload) => void) | null>(
    null,
  );

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
  }, [clear]);

  // ── Learn module handler ─────────────────────────────────────────────────

  const handleLearnModule = useCallback((moduleId: string) => {
    if (moduleId === "figure-drawing") {
      setFigDrawView({ mode: "setup" });
      setShowSplash(false);
    }
  }, []);

  // ── Figure Drawing handlers ─────────────────────────────────────────────

  const handleFigureDrawingStart = useCallback(
    (config: FigureDrawingConfig, imageSets: ImageSet[]) => {
      // Read handedness from preferences otherSettings
      let handedness: "left" | "right" = "right";
      try {
        const otherSettings = preferences.settings.otherSettings
          ? JSON.parse(preferences.settings.otherSettings as string)
          : {};
        if (otherSettings.leftHanded === true) handedness = "left";
      } catch {
        // ignore parse errors
      }

      setFigDrawView({ mode: "session", config, imageSets, handedness });
    },
    [preferences.settings],
  );

  const handleSessionComplete = useCallback((snapshots: ImageData[]) => {
    setFigDrawView({ mode: "end", snapshots });
  }, []);

  const handleSessionAbort = useCallback(() => {
    setFigDrawView({ mode: "idle" });
    setShowSplash(true);
  }, []);

  const handleSessionEndDismiss = useCallback(() => {
    setFigDrawView({ mode: "idle" });
    setShowSplash(true);
  }, []);

  const handleFigureDrawingBack = useCallback(() => {
    setFigDrawView({ mode: "idle" });
    setShowSplash(true);
  }, []);

  // ── Brush preset auto-save ────────────────────────────────────────────────

  const handlePresetsMutated = useCallback(
    (_presetsJson: string) => {
      if (activeDocumentId) setDirty(activeDocumentId, true);
      // Preset persistence is handled by usePreferences via saveBrush — no legacy canister calls here.
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

  const isFigureDrawingSession = figDrawView.mode === "session";
  const figureDrawingSessionProp =
    isFigureDrawingSession && figDrawView.mode === "session"
      ? {
          config: figDrawView.config,
          imageSets: figDrawView.imageSets,
          handedness: figDrawView.handedness,
          onSessionComplete: handleSessionComplete,
          onAbort: handleSessionAbort,
        }
      : null;

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

      {/* PaintingApp: always mounted (behind splash) once preferences are loaded.
          Wrapped in ErrorBoundary so any render crash does not kill the SplashScreen.
          When the user is authenticated, we wait for preferences.isLoading to clear
          so the canvas initializes with the correct saved settings (theme, hotkeys, etc.)
          rather than flashing defaults. Unauthenticated users skip this gate entirely. */}
      {(!isLoggedIn || !preferences.isLoading) && (
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
                preferences={preferences}
                onBrushTipEditorActiveChange={setBrushTipEditorActive}
                figureDrawingSession={figureDrawingSessionProp}
                onNavigateToSplash={() => setShowSplash(true)}
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
              brushTipEditorActive={brushTipEditorActive}
            />
          </div>
        </PaintingErrorBoundary>
      )}

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

      {/* Figure Drawing Setup — shown over splash */}
      {figDrawView.mode === "setup" && (
        <div
          data-ocid="figure_drawing_setup.overlay"
          className="fixed inset-0 z-[9000] flex items-center justify-center"
          style={{
            background: "oklch(var(--canvas-bg) / 0.97)",
            backdropFilter: "blur(12px)",
          }}
        >
          <FigureDrawingSetup
            onStart={handleFigureDrawingStart}
            onBack={handleFigureDrawingBack}
            onShowMarketplace={handleShowMarketplace}
          />
        </div>
      )}

      {/* Session End Screen */}
      {figDrawView.mode === "end" && (
        <SessionEndScreen
          snapshots={figDrawView.snapshots}
          onDismiss={handleSessionEndDismiss}
        />
      )}

      {showSplash &&
        figDrawView.mode === "idle" &&
        !showAdminPortal &&
        !showMarketplace && (
          <SplashScreen
            principalId={principalId}
            isLoggedIn={isLoggedIn}
            onLogin={login}
            onLogout={handleLogout}
            onNewCanvas={handleNewCanvas}
            onOpenFile={handleOpenFile}
            onLearnModule={handleLearnModule}
            onStartFigureDrawing={(config, imageSets) => {
              setShowSplash(false);
              handleFigureDrawingStart(config, imageSets);
            }}
            onAdminPortal={() => setShowAdminPortal(true)}
            onShowMarketplace={handleShowMarketplace}
          />
        )}

      {/* Admin Portal — takes full screen, only for admins */}
      {showAdminPortal && isAdmin && (
        <AdminPortal onBack={handleAdminPortalBack} />
      )}

      {/* Marketplace — full-screen overlay */}
      {showMarketplace && (
        <MarketplaceScreen
          onClose={handleCloseMarketplace}
          identity={identity ?? undefined}
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
