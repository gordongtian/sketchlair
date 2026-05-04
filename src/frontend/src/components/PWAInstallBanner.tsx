import { IS_IOS, IS_STANDALONE } from "@/pwa";
import { X } from "lucide-react";
import { useEffect, useState } from "react";

// BeforeInstallPromptEvent is not in standard TypeScript DOM types
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function PWAInstallBanner() {
  const [installEvent, setInstallEvent] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [showIosBanner, setShowIosBanner] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Never show banners if already installed as PWA
    if (IS_STANDALONE) return;

    // iOS: show manual instructions banner on Safari (no beforeinstallprompt support)
    if (IS_IOS) {
      // Only show on iOS Safari (not Chrome/Firefox on iOS — they can't install PWAs)
      const isSafari =
        /Safari/i.test(navigator.userAgent) &&
        !/CriOS|FxiOS/i.test(navigator.userAgent);
      if (isSafari) {
        setShowIosBanner(true);
      }
      return;
    }

    // Android / Desktop Chrome: capture beforeinstallprompt for in-app prompt
    const handler = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
    };

    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const handleInstall = async () => {
    if (!installEvent) return;
    await installEvent.prompt();
    const choice = await installEvent.userChoice;
    if (choice.outcome === "accepted") {
      setInstallEvent(null);
    }
  };

  const handleDismiss = () => {
    setDismissed(true);
    setInstallEvent(null);
    setShowIosBanner(false);
  };

  // Don't render anything if dismissed or nothing to show
  if (dismissed) return null;

  // ── Android / Desktop: native install prompt ──────────────────────────────
  if (installEvent) {
    return (
      <div
        data-ocid="pwa_install.banner"
        className="flex items-center gap-3 rounded-xl px-4 py-3 mt-4 w-full"
        style={{
          backgroundColor: "oklch(var(--toolbar))",
          border: "1px solid oklch(var(--outline))",
        }}
      >
        <span className="text-lg flex-shrink-0">📱</span>
        <p
          className="flex-1 text-xs leading-snug"
          style={{ color: "oklch(var(--text))" }}
        >
          Install SketchLair for the best experience
        </p>
        <button
          type="button"
          data-ocid="pwa_install.install_button"
          onClick={handleInstall}
          className="flex-shrink-0 text-xs font-semibold px-3 py-1.5 rounded-lg transition-opacity hover:opacity-80"
          style={{
            backgroundColor: "oklch(var(--accent))",
            color: "oklch(var(--accent-text))",
          }}
        >
          Install
        </button>
        <button
          type="button"
          data-ocid="pwa_install.close_button"
          onClick={handleDismiss}
          className="flex-shrink-0 p-1 rounded transition-opacity hover:opacity-70"
          style={{ color: "oklch(var(--muted-text))" }}
          aria-label="Dismiss install banner"
        >
          <X size={14} />
        </button>
      </div>
    );
  }

  // ── iOS: manual instructions hint ──────────────────────────────────────────
  if (showIosBanner) {
    return (
      <div
        data-ocid="pwa_install_ios.banner"
        className="flex items-center gap-3 rounded-xl px-4 py-3 mt-4 w-full"
        style={{
          backgroundColor: "oklch(var(--toolbar))",
          border: "1px solid oklch(var(--outline))",
        }}
      >
        <span className="text-lg flex-shrink-0">📱</span>
        <p
          className="flex-1 text-xs leading-snug"
          style={{ color: "oklch(var(--text))" }}
        >
          Add to Home Screen: tap <span className="font-semibold">Share</span>{" "}
          then <span className="font-semibold">"Add to Home Screen"</span>
        </p>
        <button
          type="button"
          data-ocid="pwa_install_ios.close_button"
          onClick={handleDismiss}
          className="flex-shrink-0 p-1 rounded transition-opacity hover:opacity-70"
          style={{ color: "oklch(var(--muted-text))" }}
          aria-label="Dismiss iOS install hint"
        >
          <X size={14} />
        </button>
      </div>
    );
  }

  return null;
}
