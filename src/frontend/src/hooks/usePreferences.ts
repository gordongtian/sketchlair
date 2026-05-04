/**
 * usePreferences — centralized preferences manager
 *
 * Single point of access for all preference reads and writes.
 * No component talks to the canister directly — everything goes through here.
 *
 * Architecture:
 * - ICP canister is the source of truth (when authenticated)
 * - In-memory state is a session cache loaded once on mount
 * - All writes go to canister AND update local cache simultaneously
 * - Continuous changes are debounced 2000ms; discrete changes write immediately
 * - Flush on visibilitychange + beforeunload so no changes are lost on tab close
 * - Graceful degradation: canister errors → fall back to in-memory defaults, never crash
 */

import { createActorWithConfig } from "@/config";
import { exportAllThemes, importThemes } from "@/utils/themeOverrides";
import type { ThemeId } from "@/utils/themeOverrides";
import type { Preset } from "@/utils/toolPresets";
import { DEFAULT_PRESETS } from "@/utils/toolPresets";
import type { Identity } from "@icp-sdk/core/agent";
import { useCallback, useEffect, useRef, useState } from "react";

// ── Shared types exported for consumers ─────────────────────────────────────

export interface BrushPreset {
  id: string;
  name: string;
  isDefault: boolean;
  settings: string; // JSON-serialized BrushSettings
  createdAt: number;
  modifiedAt: number;
}

export interface AppSettings {
  theme: string;
  canvasBackground: string;
  uiScale: number;
  otherSettings: string; // JSON-serialized { cursorType, cursorCenter, pressureCurve, forceDesktop, leftHanded, themeColorOverrides }
  modifiedAt: number;
}

export interface HotkeyAssignments {
  assignments: string; // JSON-serialized HotkeyAction[]
  modifiedAt: number;
}

export interface UserPreferences {
  brushes: BrushPreset[];
  settings: AppSettings;
  hotkeys: HotkeyAssignments;
  schemaVersion: number;
  lastModified: number;
}

export interface PreferencesManager {
  brushes: BrushPreset[];
  settings: AppSettings;
  hotkeys: HotkeyAssignments;
  isLoading: boolean;
  isSyncing: boolean;
  /** true only while an upload is in progress */
  isUploadingSyncing: boolean;
  /** true only while a download is in progress */
  isDownloadingSyncing: boolean;
  error: string | null;
  /** Error from the most recent upload attempt, null if last upload succeeded */
  uploadError: string | null;
  /** Error from the most recent download attempt, null if last download succeeded */
  downloadError: string | null;
  isAuthenticated: boolean;
  /** @deprecated Use lastUploaded / lastDownloaded instead */
  lastSynced: number | null;
  /** Timestamp of the last successful upload to the canister */
  lastUploaded: number | null;
  /** Timestamp of the last successful download from the canister */
  lastDownloaded: number | null;
  saveBrush(brush: BrushPreset): Promise<void>;
  deleteBrush(id: string): Promise<void>;
  updateSettings(partial: Partial<AppSettings>): Promise<void>;
  updateHotkeys(partial: Partial<HotkeyAssignments>): Promise<void>;
  exportPreferences(): Promise<void>;
  importPreferences(file: File): Promise<void>;
  flushPendingWrites(): void;
  syncNow(): Promise<void>;
  syncUpload(): Promise<void>;
  syncDownload(): Promise<void>;
  /**
   * Directly update the in-memory brush cache without a canister write.
   * Used by PaintingApp to keep brushesRef current whenever the user mutates
   * presets — so syncUpload always reads the freshest list.
   */
  setBrushesDirectly(brushes: BrushPreset[]): void;
  /**
   * Register a callback that fires after syncDownload successfully fetches
   * brushes from the canister. PaintingApp uses this to push the downloaded
   * brushes back into usePresetSystem so the brush UI reflects the cloud state.
   */
  registerOnDownload(cb: (brushes: BrushPreset[]) => void): void;
}

// ── Constants ────────────────────────────────────────────────────────────────

const CURRENT_SCHEMA_VERSION = 1;
const DEBOUNCE_MS = 2000;

/** How many times to retry a sync call when the canister is temporarily stopped. */
const SYNC_RETRY_ATTEMPTS = 3;
/** Milliseconds to wait between retry attempts. */
const SYNC_RETRY_DELAY_MS = 2000;

const LS_LAST_UPLOADED = "sketchlair_last_uploaded";
const LS_LAST_DOWNLOADED = "sketchlair_last_downloaded";

const DEFAULT_APP_SETTINGS: AppSettings = {
  theme: "light",
  canvasBackground: "#ffffff",
  uiScale: 1.0,
  otherSettings: "{}",
  modifiedAt: 0,
};

const DEFAULT_HOTKEYS: HotkeyAssignments = {
  assignments: "[]",
  modifiedAt: 0,
};

// ── BigInt conversion helpers ─────────────────────────────────────────────────

function bigIntToNumber(v: bigint | number): number {
  return typeof v === "bigint" ? Number(v) : v;
}

function numberToBigInt(v: number): bigint {
  return BigInt(Math.floor(v));
}

// ── localStorage timestamp helpers ───────────────────────────────────────────

function loadTimestamp(key: string): number | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function saveTimestamp(key: string, ts: number): void {
  try {
    localStorage.setItem(key, String(ts));
  } catch {
    // localStorage unavailable — non-fatal
  }
}

// ── Schema migration ──────────────────────────────────────────────────────────

function migratePreferences(prefs: UserPreferences): UserPreferences {
  const version = prefs.schemaVersion;
  if (version === CURRENT_SCHEMA_VERSION) return prefs;
  if (version > CURRENT_SCHEMA_VERSION) {
    console.warn(
      `[Preferences] Canister schema version ${version} is newer than frontend (${CURRENT_SCHEMA_VERSION}). Unknown fields will use defaults.`,
    );
    return {
      ...prefs,
      schemaVersion: CURRENT_SCHEMA_VERSION,
    };
  }
  // v0 → v1: no structural changes yet, just bump version
  console.log(
    `[Preferences] Migrating preferences from schema v${version} to v${CURRENT_SCHEMA_VERSION}`,
  );
  return { ...prefs, schemaVersion: CURRENT_SCHEMA_VERSION };
}

// ── Error message helpers ─────────────────────────────────────────────────────

/**
 * Map raw canister/network error strings to clear user-facing messages.
 * "Unauthorized" from Motoko means an anonymous or mismatched principal — tell
 * the user to sign in rather than surfacing internal error text.
 * IC0508 / reject_code 5 means the canister is temporarily stopped — tell the
 * user the service is unavailable rather than dumping the raw rejection.
 */
function extractSyncError(
  raw: string,
  direction: "upload" | "download",
): string {
  const lower = raw.toLowerCase();
  if (
    lower.includes("unauthorized") ||
    lower.includes("user is not registered") ||
    lower.includes("only users can") ||
    lower.includes("anonymous")
  ) {
    return "Not signed in — please log in and try again.";
  }
  if (lower.includes("network") || lower.includes("fetch")) {
    return "Network error — check your connection and try again.";
  }
  if (
    lower.includes("ic0508") ||
    lower.includes("canister is stopped") ||
    lower.includes("reject_code: 5") ||
    lower.includes('"reject_code":5') ||
    lower.includes('reject_code":5')
  ) {
    return "The service is temporarily unavailable. Please wait a moment and try again.";
  }
  const verb = direction === "upload" ? "Upload" : "Download";
  return raw || `${verb} failed. Please try again.`;
}

/** Returns true if the error string indicates a transiently stopped canister (IC0508). */
function isCanisterStoppedError(raw: string): boolean {
  const lower = raw.toLowerCase();
  return (
    lower.includes("ic0508") ||
    lower.includes("canister is stopped") ||
    lower.includes("reject_code: 5") ||
    lower.includes('"reject_code":5') ||
    lower.includes('reject_code":5')
  );
}

/** Sleep for `ms` milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Theme sync helpers ─────────────────────────────────────────────────────────

/**
 * Inject the current themeColorOverrides (from localStorage via exportAllThemes)
 * into the settings.otherSettings JSON so they get uploaded with the preferences.
 */
function injectThemeOverridesIntoSettings(settings: AppSettings): AppSettings {
  try {
    const overrides = exportAllThemes();
    // Only inject if there are non-empty overrides to avoid bloating the payload
    const hasOverrides = Object.values(overrides).some(
      (themeOverrides) => Object.keys(themeOverrides).length > 0,
    );
    if (!hasOverrides) return settings;
    const other = settings.otherSettings
      ? (JSON.parse(settings.otherSettings) as Record<string, unknown>)
      : {};
    const merged = { ...other, themeColorOverrides: overrides };
    return { ...settings, otherSettings: JSON.stringify(merged) };
  } catch {
    return settings;
  }
}

/**
 * On download, extract themeColorOverrides from settings.otherSettings and apply
 * them locally via importThemes so custom theme colors are restored.
 */
function applyThemeOverridesFromSettings(
  settings: AppSettings,
  currentThemeId: ThemeId,
): void {
  try {
    if (!settings.otherSettings) return;
    const other = JSON.parse(settings.otherSettings) as Record<string, unknown>;
    if (
      other.themeColorOverrides &&
      typeof other.themeColorOverrides === "object"
    ) {
      importThemes(
        other.themeColorOverrides as Record<string, Record<string, string>>,
        currentThemeId,
      );
    }
  } catch {
    // malformed otherSettings — silently ignore
  }
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function usePreferences(
  identity: Identity | undefined,
  isAuthenticated: boolean,
): PreferencesManager {
  const [brushes, setBrushes] = useState<BrushPreset[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [hotkeys, setHotkeys] = useState<HotkeyAssignments>(DEFAULT_HOTKEYS);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isUploadingSyncing, setIsUploadingSyncing] = useState(false);
  const [isDownloadingSyncing, setIsDownloadingSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  // Timestamps — initialised from localStorage so they survive page refreshes
  const [lastUploaded, setLastUploadedState] = useState<number | null>(() =>
    loadTimestamp(LS_LAST_UPLOADED),
  );
  const [lastDownloaded, setLastDownloadedState] = useState<number | null>(() =>
    loadTimestamp(LS_LAST_DOWNLOADED),
  );

  const setLastUploaded = useCallback((ts: number) => {
    setLastUploadedState(ts);
    saveTimestamp(LS_LAST_UPLOADED, ts);
  }, []);

  const setLastDownloaded = useCallback((ts: number) => {
    setLastDownloadedState(ts);
    saveTimestamp(LS_LAST_DOWNLOADED, ts);
  }, []);

  // Refs for debounced settings writes
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSettingsRef = useRef<AppSettings | null>(null);

  // Keep a ref to the latest identity so async callbacks always read the
  // freshest value without re-creating every dependent useCallback.
  const identityRef = useRef(identity);

  // Snapshot of current full state for flush operations
  const brushesRef = useRef(brushes);
  const settingsRef = useRef(settings);
  const hotkeysRef = useRef(hotkeys);
  brushesRef.current = brushes;
  settingsRef.current = settings;
  hotkeysRef.current = hotkeys;

  // Invalidate cached actor whenever identity or auth state changes so we
  // never re-use a stale anonymous principal after logout→login.
  const cachedActorRef = useRef<Awaited<
    ReturnType<typeof createActorWithConfig>
  > | null>(null);

  useEffect(() => {
    // Update ref so async callbacks always read the current identity
    identityRef.current = identity;
    // Bust the cached actor — next sync call will rebuild it with the fresh identity
    cachedActorRef.current = null;
    console.log(
      "[Preferences] identity changed — actor cache invalidated, isAuthenticated:",
      isAuthenticated,
    );
  }, [identity, isAuthenticated]);

  // Callback registered by PaintingApp to receive downloaded brushes
  const onDownloadCallbackRef = useRef<
    ((brushes: BrushPreset[]) => void) | null
  >(null);

  // ── Actor factory ──────────────────────────────────────────────────────────
  // Reads identityRef.current (always current) and caches the actor so we
  // don't re-create it on every sync call — but the cache is busted by the
  // useEffect above whenever identity or isAuthenticated changes.

  const getActor = useCallback(async () => {
    const id = identityRef.current;

    // Hard guard: never create an actor for an anonymous/null identity
    if (!id) {
      console.warn("[Preferences] getActor — no identity available");
      return null;
    }
    if (id.getPrincipal().isAnonymous()) {
      console.warn(
        "[Preferences] getActor — identity is anonymous, refusing to create actor",
      );
      return null;
    }

    // Return cached actor if we have one for the current identity
    if (cachedActorRef.current !== null) {
      return cachedActorRef.current;
    }

    console.log(
      "[Preferences] getActor — creating fresh actor for principal:",
      id.getPrincipal().toText(),
    );
    const actor = await createActorWithConfig({ identity: id });
    cachedActorRef.current = actor;
    return actor;
  }, []);

  // ── Flush pending debounced settings write ─────────────────────────────────

  const flushPendingWrites = useCallback(() => {
    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    const pending = pendingSettingsRef.current;
    if (!pending) return;
    pendingSettingsRef.current = null;

    void (async () => {
      try {
        const actor = await getActor();
        if (!actor) return;
        const prefs: UserPreferences = {
          brushes: brushesRef.current,
          settings: pending,
          hotkeys: hotkeysRef.current,
          schemaVersion: CURRENT_SCHEMA_VERSION,
          lastModified: Date.now(),
        };
        await actor.savePreferences(toCanisterPreferences(prefs));
        const ts = Date.now();
        setLastUploaded(ts);
      } catch (e) {
        console.warn("[Preferences] Flush failed:", e);
      }
    })();
  }, [getActor, setLastUploaded]);

  // ── Load on mount ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (!isAuthenticated || !identity) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const actor = await createActorWithConfig({ identity });
        const raw = await actor.getPreferences();
        if (cancelled) return;

        if (raw !== null && raw !== undefined) {
          const prefs = fromCanisterPreferences(raw);
          const migrated = migratePreferences(prefs);

          // If we migrated, write updated schema back
          if (migrated.schemaVersion !== prefs.schemaVersion) {
            void actor
              .savePreferences(toCanisterPreferences(migrated))
              .catch((e) =>
                console.warn("[Preferences] Migration write failed:", e),
              );
          }

          setBrushes(migrated.brushes);
          setSettings(migrated.settings);
          setHotkeys(migrated.hotkeys);
        }
        // else: first time user — defaults already in state
      } catch (e) {
        if (!cancelled) {
          console.warn("[Preferences] Failed to load from canister:", e);
          setError("Could not load preferences — using defaults.");
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, identity]);

  // ── Flush on visibility change and tab close ───────────────────────────────

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        flushPendingWrites();
      }
    };
    const onBeforeUnload = () => {
      flushPendingWrites();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [flushPendingWrites]);

  // ── saveBrush ──────────────────────────────────────────────────────────────

  const saveBrush = useCallback(
    async (brush: BrushPreset): Promise<void> => {
      // Update local cache immediately
      setBrushes((prev) => {
        const filtered = prev.filter((b) => b.id !== brush.id);
        return [...filtered, brush];
      });

      if (!isAuthenticated) return;

      setIsSyncing(true);
      try {
        const actor = await getActor();
        if (!actor) return;
        await actor.saveBrush({
          id: brush.id,
          name: brush.name,
          isDefault: brush.isDefault,
          settings: brush.settings,
          createdAt: numberToBigInt(brush.createdAt),
          modifiedAt: numberToBigInt(brush.modifiedAt),
        });
        setLastUploaded(Date.now());
      } catch (e) {
        console.warn("[Preferences] saveBrush failed:", e);
        setError("Failed to save brush to cloud.");
      } finally {
        setIsSyncing(false);
      }
    },
    [isAuthenticated, getActor, setLastUploaded],
  );

  // ── deleteBrush ───────────────────────────────────────────────────────────

  const deleteBrush = useCallback(
    async (id: string): Promise<void> => {
      setBrushes((prev) => prev.filter((b) => b.id !== id));

      if (!isAuthenticated) return;

      setIsSyncing(true);
      try {
        const actor = await getActor();
        if (!actor) return;
        await actor.deleteBrush(id);
        setLastUploaded(Date.now());
      } catch (e) {
        console.warn("[Preferences] deleteBrush failed:", e);
        setError("Failed to delete brush from cloud.");
      } finally {
        setIsSyncing(false);
      }
    },
    [isAuthenticated, getActor, setLastUploaded],
  );

  // ── updateSettings ────────────────────────────────────────────────────────

  const updateSettings = useCallback(
    async (partial: Partial<AppSettings>): Promise<void> => {
      const updated: AppSettings = {
        ...settingsRef.current,
        ...partial,
        modifiedAt: Date.now(),
      };
      setSettings(updated);

      if (!isAuthenticated) return;

      // Discrete changes (theme, etc.) write immediately; continuous (uiScale etc) debounce
      const isDiscrete =
        partial.theme !== undefined || partial.canvasBackground !== undefined;

      if (isDiscrete) {
        // Cancel any pending debounce and write immediately
        if (debounceTimerRef.current !== null) {
          clearTimeout(debounceTimerRef.current);
          debounceTimerRef.current = null;
          pendingSettingsRef.current = null;
        }
        setIsSyncing(true);
        try {
          const actor = await getActor();
          if (!actor) return;
          const prefs: UserPreferences = {
            brushes: brushesRef.current,
            settings: updated,
            hotkeys: hotkeysRef.current,
            schemaVersion: CURRENT_SCHEMA_VERSION,
            lastModified: Date.now(),
          };
          await actor.savePreferences(toCanisterPreferences(prefs));
          setLastUploaded(Date.now());
        } catch (e) {
          console.warn("[Preferences] updateSettings (discrete) failed:", e);
          setError("Failed to save settings to cloud.");
        } finally {
          setIsSyncing(false);
        }
      } else {
        // Debounced write
        pendingSettingsRef.current = updated;
        if (debounceTimerRef.current !== null) {
          clearTimeout(debounceTimerRef.current);
        }
        debounceTimerRef.current = setTimeout(() => {
          debounceTimerRef.current = null;
          const pending = pendingSettingsRef.current;
          if (!pending) return;
          pendingSettingsRef.current = null;

          void (async () => {
            setIsSyncing(true);
            try {
              const actor = await getActor();
              if (!actor) return;
              const prefs: UserPreferences = {
                brushes: brushesRef.current,
                settings: pending,
                hotkeys: hotkeysRef.current,
                schemaVersion: CURRENT_SCHEMA_VERSION,
                lastModified: Date.now(),
              };
              await actor.savePreferences(toCanisterPreferences(prefs));
              setLastUploaded(Date.now());
            } catch (e) {
              console.warn(
                "[Preferences] updateSettings (debounced) failed:",
                e,
              );
            } finally {
              setIsSyncing(false);
            }
          })();
        }, DEBOUNCE_MS);
      }
    },
    [isAuthenticated, getActor, setLastUploaded],
  );

  // ── updateHotkeys ──────────────────────────────────────────────────────────

  const updateHotkeys = useCallback(
    async (partial: Partial<HotkeyAssignments>): Promise<void> => {
      const updated: HotkeyAssignments = {
        ...hotkeysRef.current,
        ...partial,
        modifiedAt: Date.now(),
      };
      setHotkeys(updated);

      if (!isAuthenticated) return;

      setIsSyncing(true);
      try {
        const actor = await getActor();
        if (!actor) return;
        const prefs: UserPreferences = {
          brushes: brushesRef.current,
          settings: settingsRef.current,
          hotkeys: updated,
          schemaVersion: CURRENT_SCHEMA_VERSION,
          lastModified: Date.now(),
        };
        await actor.savePreferences(toCanisterPreferences(prefs));
        setLastUploaded(Date.now());
      } catch (e) {
        console.warn("[Preferences] updateHotkeys failed:", e);
        setError("Failed to save hotkeys to cloud.");
      } finally {
        setIsSyncing(false);
      }
    },
    [isAuthenticated, getActor, setLastUploaded],
  );

  // ── syncNow ───────────────────────────────────────────────────────────────

  const syncNow = useCallback(async (): Promise<void> => {
    if (!isAuthenticated) {
      setUploadError("Sign in to sync preferences.");
      return;
    }

    // Cancel any pending debounce — this supersedes it
    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    pendingSettingsRef.current = null;

    setIsSyncing(true);
    setUploadError(null);
    try {
      const actor = await getActor();
      if (!actor) {
        setUploadError("Not connected to the network. Please try again.");
        return;
      }
      const prefs: UserPreferences = {
        brushes: brushesRef.current,
        settings: settingsRef.current,
        hotkeys: hotkeysRef.current,
        schemaVersion: CURRENT_SCHEMA_VERSION,
        lastModified: Date.now(),
      };
      console.log(
        "[Sync] syncNow payload:",
        JSON.stringify({
          brushCount: prefs.brushes.length,
          theme: prefs.settings.theme,
        }),
      );
      await actor.savePreferences(toCanisterPreferences(prefs));
      setLastUploaded(Date.now());
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : "Sync failed. Please try again.";
      console.warn("[Preferences] syncNow failed:", e);
      setError(msg);
      setUploadError(msg);
    } finally {
      setIsSyncing(false);
    }
  }, [isAuthenticated, getActor, setLastUploaded]);

  // ── setBrushesDirectly — sync live preset state into brushesRef ────────────

  const setBrushesDirectly = useCallback((newBrushes: BrushPreset[]): void => {
    setBrushes(newBrushes);
    // brushesRef is kept in sync by the assignment above (react re-render)
    // but we also update the ref synchronously so syncUpload reads the
    // latest value even if it fires before the re-render cycle completes.
    brushesRef.current = newBrushes;
  }, []);

  // ── registerOnDownload — PaintingApp registers to hear download completions ─

  const registerOnDownload = useCallback(
    (cb: (brushes: BrushPreset[]) => void): void => {
      onDownloadCallbackRef.current = cb;
    },
    [],
  );

  // ── syncUpload — push all local preferences to canister ──────────────────

  const syncUpload = useCallback(async (): Promise<void> => {
    // Clear stale error from previous attempt
    setUploadError(null);

    if (!isAuthenticated) {
      setUploadError("Sign in to upload preferences.");
      return;
    }

    // Defence-in-depth: check identity before attempting the call
    const currentIdentity = identityRef.current;
    if (!currentIdentity || currentIdentity.getPrincipal().isAnonymous()) {
      setUploadError("Not signed in — please log in and try again.");
      return;
    }

    // Cancel any pending debounce — this upload supersedes it
    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    pendingSettingsRef.current = null;

    setIsUploadingSyncing(true);
    setIsSyncing(true);

    let lastError = "Upload failed. Please try again.";

    for (let attempt = 1; attempt <= SYNC_RETRY_ATTEMPTS; attempt++) {
      try {
        const actor = await getActor();
        if (!actor) {
          setUploadError("Not signed in — please log in and try again.");
          setIsUploadingSyncing(false);
          setIsSyncing(false);
          return;
        }

        // Log exactly what's going up
        console.log(
          `[Sync] syncUpload attempt ${attempt}/${SYNC_RETRY_ATTEMPTS} — ${brushesRef.current.length} brush(es), theme: ${settingsRef.current.theme}`,
        );
        console.log(
          "[Sync] savePreferences payload:",
          JSON.stringify({
            brushCount: brushesRef.current.length,
            brushIds: brushesRef.current.map((b) => b.id),
            theme: settingsRef.current.theme,
          }),
        );

        const prefs: UserPreferences = {
          brushes: brushesRef.current,
          settings: injectThemeOverridesIntoSettings(settingsRef.current),
          hotkeys: hotkeysRef.current,
          schemaVersion: CURRENT_SCHEMA_VERSION,
          lastModified: Date.now(),
        };
        await actor.savePreferences(toCanisterPreferences(prefs));

        const ts = Date.now();
        setLastUploaded(ts);
        console.log(
          `[Preferences] Upload complete — ${brushesRef.current.length} brush(es) pushed to canister.`,
        );
        // Success — clear any lingering error and exit
        setUploadError(null);
        setIsUploadingSyncing(false);
        setIsSyncing(false);
        return;
      } catch (e) {
        const raw = e instanceof Error ? e.message : String(e);
        lastError = raw;
        console.warn(
          `[Preferences] syncUpload attempt ${attempt}/${SYNC_RETRY_ATTEMPTS} failed:`,
          e,
        );

        // Only retry on transient canister-stopped errors
        if (isCanisterStoppedError(raw) && attempt < SYNC_RETRY_ATTEMPTS) {
          console.log(
            `[Preferences] Canister stopped — waiting ${SYNC_RETRY_DELAY_MS}ms before retry…`,
          );
          await sleep(SYNC_RETRY_DELAY_MS);
          // Keep isUploadingSyncing=true so the button stays in loading state
          continue;
        }

        // Non-retryable error or final attempt — surface friendly message
        setUploadError(extractSyncError(raw, "upload"));
        setIsUploadingSyncing(false);
        setIsSyncing(false);
        return;
      }
    }

    // All retries exhausted (canister still stopped)
    setUploadError(extractSyncError(lastError, "upload"));
    setIsUploadingSyncing(false);
    setIsSyncing(false);
  }, [isAuthenticated, getActor, setLastUploaded]);

  // ── syncDownload — pull canister preferences and apply to local state ─────

  const syncDownload = useCallback(async (): Promise<void> => {
    // Clear stale error from previous attempt
    setDownloadError(null);

    if (!isAuthenticated) {
      setDownloadError("Sign in to download preferences.");
      return;
    }

    // Defence-in-depth: check identity before attempting the call
    const currentIdentity = identityRef.current;
    if (!currentIdentity || currentIdentity.getPrincipal().isAnonymous()) {
      setDownloadError("Not signed in — please log in and try again.");
      return;
    }

    setIsDownloadingSyncing(true);
    setIsSyncing(true);

    let lastError = "Download failed. Please try again.";

    for (let attempt = 1; attempt <= SYNC_RETRY_ATTEMPTS; attempt++) {
      try {
        const actor = await getActor();
        if (!actor) {
          setDownloadError("Not signed in — please log in and try again.");
          setIsDownloadingSyncing(false);
          setIsSyncing(false);
          return;
        }

        console.log(
          `[Sync] syncDownload attempt ${attempt}/${SYNC_RETRY_ATTEMPTS}`,
        );

        const raw = await actor.getPreferences();
        console.log(
          "[Sync] getPreferences response:",
          JSON.stringify(
            raw !== null && raw !== undefined
              ? {
                  brushCount: (raw as { brushes: unknown[] }).brushes?.length,
                  theme: (raw as { settings: { theme: string } }).settings
                    ?.theme,
                }
              : null,
          ),
        );

        if (raw !== null && raw !== undefined) {
          const prefs = fromCanisterPreferences(raw);
          const migrated = migratePreferences(prefs);

          // If migration changed the schema, write it back
          if (migrated.schemaVersion !== prefs.schemaVersion) {
            void actor
              .savePreferences(toCanisterPreferences(migrated))
              .catch((e) =>
                console.warn(
                  "[Preferences] Post-download migration write failed:",
                  e,
                ),
              );
          }

          setBrushes(migrated.brushes);
          setSettings(migrated.settings);
          setHotkeys(migrated.hotkeys);

          // Restore custom theme color overrides if present in the downloaded preferences
          const currentThemeId = (localStorage.getItem("sl-theme") ??
            "light") as ThemeId;
          applyThemeOverridesFromSettings(migrated.settings, currentThemeId);

          const ts = Date.now();
          setLastDownloaded(ts);

          // Notify PaintingApp so the brush UI reflects the downloaded brushes
          if (onDownloadCallbackRef.current) {
            onDownloadCallbackRef.current(migrated.brushes);
          }
          console.log(
            `[Preferences] Download complete — ${migrated.brushes.length} brush(es) loaded from canister.`,
          );
        } else {
          // No preferences stored yet — nothing to pull, still record the attempt
          setLastDownloaded(Date.now());
          console.log(
            "[Preferences] Download complete — no canister preferences found, keeping local state.",
          );
        }

        // Success
        setDownloadError(null);
        setIsDownloadingSyncing(false);
        setIsSyncing(false);
        return;
      } catch (e) {
        const raw = e instanceof Error ? e.message : String(e);
        lastError = raw;
        console.warn(
          `[Preferences] syncDownload attempt ${attempt}/${SYNC_RETRY_ATTEMPTS} failed:`,
          e,
        );

        // Only retry on transient canister-stopped errors
        if (isCanisterStoppedError(raw) && attempt < SYNC_RETRY_ATTEMPTS) {
          console.log(
            `[Preferences] Canister stopped — waiting ${SYNC_RETRY_DELAY_MS}ms before retry…`,
          );
          await sleep(SYNC_RETRY_DELAY_MS);
          continue;
        }

        // Non-retryable error or final attempt
        setDownloadError(extractSyncError(raw, "download"));
        setIsDownloadingSyncing(false);
        setIsSyncing(false);
        return;
      }
    }

    // All retries exhausted
    setDownloadError(extractSyncError(lastError, "download"));
    setIsDownloadingSyncing(false);
    setIsSyncing(false);
  }, [isAuthenticated, getActor, setLastDownloaded]);

  // ── exportPreferences ─────────────────────────────────────────────────────

  const exportPreferences = useCallback(async (): Promise<void> => {
    const payload = {
      brushes: brushesRef.current,
      settings: settingsRef.current,
      hotkeys: hotkeysRef.current,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      exportedAt: Date.now(),
    };
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const defaultName = "sketchlair-preferences.json";

    try {
      if ("showSaveFilePicker" in window) {
        const handle = await (
          window as Window & {
            showSaveFilePicker: (
              opts: unknown,
            ) => Promise<FileSystemFileHandle>;
          }
        ).showSaveFilePicker({
          suggestedName: defaultName,
          types: [
            {
              description: "SketchLair Preferences",
              accept: { "application/json": [".json"] },
            },
          ],
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = defaultName;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      console.error("[Preferences] Export failed:", e);
      setError("Failed to export preferences.");
    }
  }, []);

  // ── importPreferences ─────────────────────────────────────────────────────

  const importPreferences = useCallback(
    async (file: File): Promise<void> => {
      // Snapshot current state for rollback
      const prevBrushes = brushesRef.current;
      const prevSettings = settingsRef.current;
      const prevHotkeys = hotkeysRef.current;

      try {
        const text = await file.text();
        const parsed = JSON.parse(text) as Partial<{
          schemaVersion: number;
          brushes: BrushPreset[];
          settings: AppSettings;
          hotkeys: HotkeyAssignments;
        }>;

        // Validate structure
        if (
          typeof parsed.schemaVersion !== "number" ||
          !Array.isArray(parsed.brushes) ||
          typeof parsed.settings !== "object" ||
          typeof parsed.hotkeys !== "object"
        ) {
          throw new Error("Invalid preferences file structure.");
        }

        if (parsed.schemaVersion > CURRENT_SCHEMA_VERSION) {
          throw new Error(
            `Preferences file was saved by a newer version of SketchLair (schema v${parsed.schemaVersion}). Please update the app.`,
          );
        }

        // Merge brushes: add new, update existing by id, preserve others
        const importedBrushMap = new Map(parsed.brushes.map((b) => [b.id, b]));
        const existingBrushMap = new Map(prevBrushes.map((b) => [b.id, b]));

        // Start with all existing brushes, update those present in import
        const mergedBrushes: BrushPreset[] = prevBrushes.map(
          (b) => importedBrushMap.get(b.id) ?? b,
        );
        // Add imported brushes not already in existing set
        for (const [id, brush] of importedBrushMap) {
          if (!existingBrushMap.has(id)) {
            mergedBrushes.push(brush);
          }
        }

        const mergedSettings: AppSettings = {
          ...DEFAULT_APP_SETTINGS,
          ...parsed.settings,
          modifiedAt: Date.now(),
        };
        const mergedHotkeys: HotkeyAssignments = {
          ...DEFAULT_HOTKEYS,
          ...parsed.hotkeys,
          modifiedAt: Date.now(),
        };

        // Apply to state
        setBrushes(mergedBrushes);
        setSettings(mergedSettings);
        setHotkeys(mergedHotkeys);

        // Write to canister if authenticated
        if (isAuthenticated) {
          setIsSyncing(true);
          setIsUploadingSyncing(true);
          try {
            const actor = await getActor();
            if (actor) {
              const prefs: UserPreferences = {
                brushes: mergedBrushes,
                settings: mergedSettings,
                hotkeys: mergedHotkeys,
                schemaVersion: CURRENT_SCHEMA_VERSION,
                lastModified: Date.now(),
              };
              await actor.savePreferences(toCanisterPreferences(prefs));
              setLastUploaded(Date.now());
            }
          } catch (e) {
            console.warn("[Preferences] Import canister write failed:", e);
            // Still applied locally — not a fatal error
          } finally {
            setIsSyncing(false);
            setIsUploadingSyncing(false);
          }
        }
      } catch (e) {
        console.error("[Preferences] Import failed:", e);
        // Roll back to pre-import state
        setBrushes(prevBrushes);
        setSettings(prevSettings);
        setHotkeys(prevHotkeys);
        setError(
          e instanceof Error ? e.message : "Failed to import preferences.",
        );
      }
    },
    [isAuthenticated, getActor, setLastUploaded],
  );

  // lastSynced is derived as the most recent of lastUploaded / lastDownloaded
  const lastSynced =
    lastUploaded !== null && lastDownloaded !== null
      ? Math.max(lastUploaded, lastDownloaded)
      : (lastUploaded ?? lastDownloaded);

  return {
    brushes,
    settings,
    hotkeys,
    isLoading,
    isSyncing,
    isUploadingSyncing,
    isDownloadingSyncing,
    error,
    uploadError,
    downloadError,
    isAuthenticated,
    lastSynced,
    lastUploaded,
    lastDownloaded,
    saveBrush,
    deleteBrush,
    updateSettings,
    updateHotkeys,
    exportPreferences,
    importPreferences,
    flushPendingWrites,
    syncNow,
    syncUpload,
    syncDownload,
    setBrushesDirectly,
    registerOnDownload,
  };
}

// ── Preset ↔ BrushPreset conversion helpers (exported for PaintingApp use) ───

/** Set of all IDs that ship as built-in defaults — used to mark isDefault correctly. */
const _DEFAULT_PRESET_IDS = new Set<string>([
  ...DEFAULT_PRESETS.brush.map((p) => p.id),
  ...DEFAULT_PRESETS.smudge.map((p) => p.id),
  ...DEFAULT_PRESETS.eraser.map((p) => p.id),
]);

/**
 * Convert a live Preset (settings as object) to a BrushPreset (settings as JSON string)
 * suitable for canister storage.
 */
export function presetToBrushPreset(preset: Preset): BrushPreset {
  return {
    id: preset.id,
    name: preset.name,
    isDefault: _DEFAULT_PRESET_IDS.has(preset.id),
    settings: JSON.stringify(preset.settings),
    createdAt: Date.now(),
    modifiedAt: Date.now(),
  };
}

/**
 * Convert a stored BrushPreset back to a live Preset.
 * Returns null if the settings JSON is malformed — caller should skip such entries.
 */
export function brushPresetToPreset(bp: BrushPreset): Preset | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const settings = JSON.parse(bp.settings) as any;
    if (!settings || typeof settings !== "object") return null;
    return {
      id: bp.id,
      name: bp.name,
      settings,
    };
  } catch {
    console.warn(
      `[Preferences] brushPresetToPreset: malformed settings JSON for brush "${bp.name}" (${bp.id}) — skipping`,
    );
    return null;
  }
}

// ── Canister type conversion helpers ─────────────────────────────────────────

type CanisterUserPreferences = {
  brushes: Array<{
    id: string;
    name: string;
    isDefault: boolean;
    settings: string;
    createdAt: bigint;
    modifiedAt: bigint;
  }>;
  settings: {
    theme: string;
    canvasBackground: string;
    uiScale: number;
    otherSettings: string;
    modifiedAt: bigint;
  };
  hotkeys: {
    assignments: string;
    modifiedAt: bigint;
  };
  schemaVersion: bigint;
  lastModified: bigint;
};

function toCanisterPreferences(
  prefs: UserPreferences,
): CanisterUserPreferences {
  return {
    brushes: prefs.brushes.map((b) => ({
      id: b.id,
      name: b.name,
      isDefault: b.isDefault,
      settings: b.settings,
      createdAt: numberToBigInt(b.createdAt),
      modifiedAt: numberToBigInt(b.modifiedAt),
    })),
    settings: {
      theme: prefs.settings.theme,
      canvasBackground: prefs.settings.canvasBackground,
      uiScale: prefs.settings.uiScale,
      otherSettings: prefs.settings.otherSettings,
      modifiedAt: numberToBigInt(prefs.settings.modifiedAt),
    },
    hotkeys: {
      assignments: prefs.hotkeys.assignments,
      modifiedAt: numberToBigInt(prefs.hotkeys.modifiedAt),
    },
    schemaVersion: BigInt(prefs.schemaVersion),
    lastModified: numberToBigInt(prefs.lastModified),
  };
}

function fromCanisterPreferences(
  raw: CanisterUserPreferences,
): UserPreferences {
  return {
    brushes: raw.brushes.map((b) => ({
      id: b.id,
      name: b.name,
      isDefault: b.isDefault,
      settings: b.settings,
      createdAt: bigIntToNumber(b.createdAt),
      modifiedAt: bigIntToNumber(b.modifiedAt),
    })),
    settings: {
      theme: raw.settings.theme,
      canvasBackground: raw.settings.canvasBackground,
      uiScale: raw.settings.uiScale,
      otherSettings: raw.settings.otherSettings,
      modifiedAt: bigIntToNumber(raw.settings.modifiedAt),
    },
    hotkeys: {
      assignments: raw.hotkeys.assignments,
      modifiedAt: bigIntToNumber(raw.hotkeys.modifiedAt),
    },
    schemaVersion: bigIntToNumber(raw.schemaVersion),
    lastModified: bigIntToNumber(raw.lastModified),
  };
}
