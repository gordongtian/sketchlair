import { useEffect, useState } from "react";

export interface MobileState {
  isMobile: boolean;
  isPortrait: boolean;
  forceDesktop: boolean;
  leftHanded: boolean;
  setForceDesktop: (v: boolean) => void;
  setLeftHanded: (v: boolean) => void;
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

export function useIsMobile(): MobileState {
  // Derived synchronously once — no re-detection needed since device type
  // doesn't change at runtime. Portrait/landscape can still change.
  const [rawIsMobile] = useState<boolean>(() => detectMobile());
  const [isPortrait, setIsPortrait] = useState<boolean>(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(orientation: portrait)").matches
      : false,
  );
  const [forceDesktop, setForceDesktopState] = useState<boolean>(
    () => localStorage.getItem("sketchlair-force-desktop") === "true",
  );
  const [leftHanded, setLeftHandedState] = useState<boolean>(
    () => localStorage.getItem("sketchlair-left-handed") === "true",
  );

  useEffect(() => {
    const portraitQuery = window.matchMedia("(orientation: portrait)");

    const update = () => {
      setIsPortrait(portraitQuery.matches);
    };

    update();
    portraitQuery.addEventListener("change", update);

    return () => {
      portraitQuery.removeEventListener("change", update);
    };
  }, []);

  const setForceDesktop = (v: boolean) => {
    setForceDesktopState(v);
    localStorage.setItem("sketchlair-force-desktop", v ? "true" : "false");
  };

  const setLeftHanded = (v: boolean) => {
    setLeftHandedState(v);
    localStorage.setItem("sketchlair-left-handed", v ? "true" : "false");
  };

  const isMobile = forceDesktop ? false : rawIsMobile;

  return {
    isMobile,
    isPortrait,
    forceDesktop,
    leftHanded,
    setForceDesktop,
    setLeftHanded,
  };
}
