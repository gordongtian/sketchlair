// ── PWA Utilities ─────────────────────────────────────────────────────────────
// Export IS_STANDALONE so any component can read it without recomputing

/** True when the app is running as an installed PWA (standalone display mode) */
export const IS_STANDALONE: boolean =
  window.matchMedia("(display-mode: standalone)").matches ||
  (window.navigator as Navigator & { standalone?: boolean }).standalone ===
    true;

/** True when the device is iOS (iPhone, iPad, iPod, or Mac with touchscreen) */
export const IS_IOS: boolean =
  /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

/** True when the device is mobile/tablet (coarse pointer) */
export const IS_MOBILE_UA: boolean =
  /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent,
  );
