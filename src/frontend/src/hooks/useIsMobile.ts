import { useEffect, useState } from "react";

export interface MobileState {
  isMobile: boolean;
  isPortrait: boolean;
  forceDesktop: boolean;
  leftHanded: boolean;
  setForceDesktop: (v: boolean) => void;
  setLeftHanded: (v: boolean) => void;
}

export function useIsMobile(): MobileState {
  const [rawIsMobile, setRawIsMobile] = useState<boolean>(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(pointer: coarse)").matches
      : false,
  );
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
    const coarseQuery = window.matchMedia("(pointer: coarse)");
    const portraitQuery = window.matchMedia("(orientation: portrait)");

    const update = () => {
      setRawIsMobile(coarseQuery.matches);
      setIsPortrait(portraitQuery.matches);
    };

    update();
    coarseQuery.addEventListener("change", update);
    portraitQuery.addEventListener("change", update);

    return () => {
      coarseQuery.removeEventListener("change", update);
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
