import { PaintingApp } from "@/components/PaintingApp";
import { SplashScreen } from "@/components/SplashScreen";
import { Toaster } from "@/components/ui/sonner";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { X } from "lucide-react";
import { Component, useCallback, useEffect, useRef, useState } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { createActorWithConfig } from "./config";
import {
  InternetIdentityProvider,
  useInternetIdentity,
} from "./hooks/useInternetIdentity";
// hotkeyConfig not needed at App level — PaintingApp loads hotkeys internally
import {
  type ThemeId,
  applyThemeOverrides,
  importThemes,
} from "./utils/themeOverrides";

const queryClient = new QueryClient();

// ── PaintingApp error boundary ────────────────────────────────────────────────
// Prevents a crash inside PaintingApp from unmounting the SplashScreen.
// Without this, any render error in PaintingApp kills the entire AppInner tree,
// producing a blank white page where even the splash cannot be seen.

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
      // Render nothing — the SplashScreen (a sibling) will cover the viewport.
      // The error is logged to the console for debugging.
      return null;
    }
    return this.props.children;
  }
}

const THEME_KEY = "sl-theme";
// Key used to mark that a session exists and can be resumed
const SESSION_EXISTS_KEY = "sl_has_session";

function AppInner() {
  const [softwareWebGL, setSoftwareWebGL] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const { identity, login, clear, isInitializing } = useInternetIdentity();
  const isLoggedIn = !!identity && !identity.getPrincipal().isAnonymous();

  // Splash: shown on every launch until the user makes a choice
  const [showSplash, setShowSplash] = useState(true);

  // Initial canvas size (set by splash, then passed to PaintingApp)
  const [initialCanvasWidth, setInitialCanvasWidth] = useState<number | null>(
    null,
  );
  const [initialCanvasHeight, setInitialCanvasHeight] = useState<number | null>(
    null,
  );

  // Track if we already synced settings for the current login session
  const settingsSyncedRef = useRef(false);

  // Cloud save removed — local saves only; login restores settings only

  // Ref to PaintingApp's load function (used by handleOpenFile)
  const handleLoadFileRef = useRef<((file: File) => Promise<void>) | null>(
    null,
  );

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

  // Silently sync settings when the user logs in — no toast, no splash trigger
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

        // Sync settings from cloud — silently
        const settingsJson = await actor.getUserSettings();
        if (settingsJson) {
          try {
            const settings = JSON.parse(settingsJson) as {
              theme?: string;
              themeOverrides?: Record<string, Record<string, string>>;
              hotkeys?: Record<string, string[]>;
            };
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
            if (settings.themeOverrides) {
              const currentTheme = (localStorage.getItem(THEME_KEY) ||
                "light") as ThemeId;
              importThemes(settings.themeOverrides, currentTheme);
            }
            // Hotkeys: restored silently if present in settings
            if (settings.hotkeys) {
              try {
                // Store hotkeys directly to localStorage — loadHotkeys() will pick them up on next read
                localStorage.setItem(
                  "sl_hotkeys",
                  JSON.stringify(settings.hotkeys),
                );
              } catch {
                // ignore hotkey restore errors
              }
            }
          } catch (e) {
            console.warn("Failed to parse cloud settings", e);
          }
        }
      } catch (e) {
        // Settings sync failure is silent — don't block the user
        console.warn("Settings sync failed", e);
      }
    })();
  }, [isLoggedIn, isInitializing]);

  const hasLocalSession =
    typeof localStorage !== "undefined" &&
    !!localStorage.getItem(SESSION_EXISTS_KEY);

  // Splash handlers
  const handleNewCanvas = useCallback(
    (opts: { width: number; height: number }) => {
      setInitialCanvasWidth(opts.width);
      setInitialCanvasHeight(opts.height);
      setShowSplash(false);
      localStorage.setItem(SESSION_EXISTS_KEY, "1");
    },
    [],
  );

  const handleOpenFile = useCallback(async (file: File) => {
    setShowSplash(false);
    localStorage.setItem(SESSION_EXISTS_KEY, "1");
    // Load the file after the canvas has mounted — use a short delay so PaintingApp
    // has time to finish its mount cycle before we push pixel data into it.
    setTimeout(() => {
      handleLoadFileRef.current?.(file);
    }, 100);
  }, []);

  const handleResume = useCallback(() => {
    setShowSplash(false);
  }, []);

  const handleLogout = useCallback(() => {
    clear();
    settingsSyncedRef.current = false;
  }, [clear]);

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

      {/* PaintingApp is always mounted (so refs are valid), but hidden behind the splash.
          Wrapped in an ErrorBoundary so any render crash does not unmount the SplashScreen. */}
      <PaintingErrorBoundary>
        <PaintingApp
          isLoggedIn={isLoggedIn}
          identity={identity}
          onLogin={login}
          onLogout={handleLogout}
          cloudSave={undefined}
          getCanvasHash={undefined}
          initialCanvasWidth={initialCanvasWidth ?? undefined}
          initialCanvasHeight={initialCanvasHeight ?? undefined}
          registerGetSktchBlob={undefined}
          registerLoadFile={(fn) => {
            handleLoadFileRef.current = fn;
          }}
        />
      </PaintingErrorBoundary>

      {showSplash && (
        <SplashScreen
          hasLocalSession={hasLocalSession}
          principalId={principalId}
          isLoggedIn={isLoggedIn}
          onLogin={login}
          onLogout={handleLogout}
          onNewCanvas={handleNewCanvas}
          onOpenFile={handleOpenFile}
          onResume={handleResume}
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
        <AppInner />
      </InternetIdentityProvider>
    </QueryClientProvider>
  );
}
