import { useEffect, useState } from "react";

export interface MobileState {
  isMobile: boolean;
  isPortrait: boolean;
  forceDesktop: boolean;
  leftHanded: boolean;
  uiModeOverride: "mobile" | "desktop" | null;
  setForceDesktop: (v: boolean) => void;
  setLeftHanded: (v: boolean) => void;
  setUIModeOverride: (override: "mobile" | "desktop" | null) => void;
  showFOBSliders: boolean;
  setShowFOBSliders: (v: boolean) => void;
}

// ── Mobile layout state persistence ──────────────────────────────────────────
const MOBILE_LAYOUT_KEY = "MOBILE_LAYOUT_STATE";

export interface MobileLayoutState {
  layersPanel?: { x: number; y: number; pinned: boolean };
  palettePanel?: { x: number; y: number; pinned: boolean };
  lpTabSide?: "left" | "right";
  showFOBSliders?: boolean;
}

export function readMobileLayoutState(): MobileLayoutState {
  try {
    const raw = localStorage.getItem(MOBILE_LAYOUT_KEY);
    if (raw) return JSON.parse(raw) as MobileLayoutState;
  } catch {}
  return {};
}

export function writeMobileLayoutState(state: MobileLayoutState): void {
  try {
    localStorage.setItem(MOBILE_LAYOUT_KEY, JSON.stringify(state));
  } catch {}
}

/** Synchronously detect mobile at call time using multiple independent signals.
 *  Any ONE of the following being true is sufficient to return true:
 *  1. UA contains iPhone/iPad/iPod/Android
 *  2. navigator.platform contains iPhone/iPad/iPod/Android
 *  3. pointer: coarse media query (reflects actual input hardware, cannot be spoofed)
 *  4. maxTouchPoints > 0 AND screen.width <= 1024
 *  The pointer:coarse check is the most reliable single signal — it reflects the
 *  real hardware input type even when browsers (e.g. Opera on iPhone) spoof their UA.
 */
function detectMobile(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined")
    return false;

  const uaMatch = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  const platformMatch = /iPhone|iPad|iPod|Android/i.test(
    navigator.platform ?? "",
  );
  const pointerCoarse = window.matchMedia("(pointer: coarse)").matches;
  const touchScreen =
    navigator.maxTouchPoints > 0 && window.screen.width <= 1024;

  const result = uaMatch || platformMatch || pointerCoarse || touchScreen;

  console.log("[MobileDetect]", {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
    screenWidth: window.screen.width,
    uaMatch,
    platformMatch,
    pointerCoarse,
    touchScreen,
    result,
  });

  return result;
}

/** Migrate legacy key on first call — runs synchronously before detection. */
function migrateLegacyKey(): void {
  try {
    const legacy = localStorage.getItem("sketchlair-force-desktop");
    if (legacy === "true") {
      localStorage.setItem("UI_MODE_OVERRIDE", "desktop");
      localStorage.removeItem("sketchlair-force-desktop");
    } else if (legacy === "false") {
      // "false" means the user actively turned it off — clear both
      localStorage.removeItem("sketchlair-force-desktop");
    }
  } catch {
    // localStorage may be unavailable in some environments
  }
}

export function useIsMobile(): MobileState {
  // Read UI_MODE_OVERRIDE BEFORE running detection so the override takes effect immediately.
  const [uiModeOverride, setUIModeOverrideState] = useState<
    "mobile" | "desktop" | null
  >(() => {
    migrateLegacyKey();
    const stored = localStorage.getItem("UI_MODE_OVERRIDE");
    if (stored === "desktop" || stored === "mobile") return stored;
    return null;
  });

  const [rawIsMobile] = useState<boolean>(() => detectMobile());
  const [isPortrait, setIsPortrait] = useState<boolean>(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(orientation: portrait)").matches
      : false,
  );
  const [leftHanded, setLeftHandedState] = useState<boolean>(
    () => localStorage.getItem("sketchlair-left-handed") === "true",
  );

  // FOB sliders preference — default true (show FOB sliders)
  // Read from MOBILE_LAYOUT_STATE for consistency (Change 5 stores it there too)
  const [showFOBSliders, setShowFOBSlidersState] = useState<boolean>(() => {
    try {
      const layout = readMobileLayoutState();
      if (typeof layout.showFOBSliders === "boolean")
        return layout.showFOBSliders;
    } catch {}
    return true;
  });

  useEffect(() => {
    const portraitQuery = window.matchMedia("(orientation: portrait)");

    const update = () => {
      setIsPortrait(portraitQuery.matches);
    };

    update();
    portraitQuery.addEventListener("change", update);

    // Sync uiModeOverride across all useIsMobile instances in the same tab.
    // When PaintingApp's instance calls setUIModeOverride, it emits this event
    // so that AppInner's instance (which controls DocumentTabBar visibility)
    // re-reads the latest value from localStorage and updates accordingly.
    const syncOverride = () => {
      const stored = localStorage.getItem("UI_MODE_OVERRIDE");
      const next: "mobile" | "desktop" | null =
        stored === "desktop" || stored === "mobile" ? stored : null;
      setUIModeOverrideState(next);
    };
    window.addEventListener("sl:ui-mode-changed", syncOverride);

    return () => {
      portraitQuery.removeEventListener("change", update);
      window.removeEventListener("sl:ui-mode-changed", syncOverride);
    };
  }, []);

  const setUIModeOverride = (override: "mobile" | "desktop" | null) => {
    if (override === null) {
      localStorage.removeItem("UI_MODE_OVERRIDE");
    } else {
      localStorage.setItem("UI_MODE_OVERRIDE", override);
    }
    setUIModeOverrideState(override);
    // Notify other useIsMobile instances in the same tab so they re-read the
    // new value and update their derived isMobile / forceDesktop.
    window.dispatchEvent(new CustomEvent("sl:ui-mode-changed"));
    // No page reload — isMobile recomputes reactively from the new state.
  };

  // Backward-compat: forceDesktop derives from uiModeOverride
  const forceDesktop = uiModeOverride === "desktop";

  const setForceDesktop = (v: boolean) => {
    const newOverride = v ? "desktop" : null;
    if (newOverride === null) {
      localStorage.removeItem("UI_MODE_OVERRIDE");
    } else {
      localStorage.setItem("UI_MODE_OVERRIDE", newOverride);
    }
    setUIModeOverrideState(newOverride);
    window.dispatchEvent(new CustomEvent("sl:ui-mode-changed"));
  };

  const setLeftHanded = (v: boolean) => {
    setLeftHandedState(v);
    localStorage.setItem("sketchlair-left-handed", v ? "true" : "false");
  };

  const setShowFOBSliders = (v: boolean) => {
    setShowFOBSlidersState(v);
    // Persist inside MOBILE_LAYOUT_STATE
    const current = readMobileLayoutState();
    writeMobileLayoutState({ ...current, showFOBSliders: v });
  };

  // Derive isMobile: override takes full precedence, then raw detection
  const isMobile: boolean =
    uiModeOverride === "desktop"
      ? false
      : uiModeOverride === "mobile"
        ? true
        : rawIsMobile;

  return {
    isMobile,
    isPortrait,
    forceDesktop,
    leftHanded,
    uiModeOverride,
    setForceDesktop,
    setLeftHanded,
    setUIModeOverride,
    showFOBSliders,
    setShowFOBSliders,
  };
}
