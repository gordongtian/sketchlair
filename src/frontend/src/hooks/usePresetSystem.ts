import type { BrushSettings } from "@/components/BrushSettingsPanel";
import type { Tool } from "@/components/Toolbar";
import type { BrushPreset } from "@/hooks/usePreferences";
import { presetToBrushPreset } from "@/hooks/usePreferences";
import type { Preset } from "@/utils/toolPresets";
import { DEFAULT_PRESETS } from "@/utils/toolPresets";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

export type BrushSizes = { brush: number; eraser: number };

export interface ConflictItem {
  toolType: "brush" | "smudge" | "eraser";
  preset: Preset;
}

/** Shape of the presets payload saved/restored from the cloud. */
export interface PresetsPayload {
  brush: Preset[];
  smudge: Preset[];
  eraser: Preset[];
  activePresetIds: Record<string, string | null>;
}

export interface UsePresetSystemProps {
  /** Current active tool — used in tool-switch effect and preset callbacks */
  activeTool: Tool;
  /** Current active subpanel — used to determine which preset list to operate on */
  activeSubpanel: Tool | null;
  /** Setters for cross-cutting state that lives in PaintingApp */
  setBrushSizes: React.Dispatch<React.SetStateAction<BrushSizes>>;
  setBrushSettings: React.Dispatch<React.SetStateAction<BrushSettings>>;
  setColor: React.Dispatch<
    React.SetStateAction<{ h: number; s: number; v: number; a: number }>
  >;
  setActiveTool?: (tool: Tool) => void;
  /**
   * Called (debounced 500 ms) whenever presets are mutated and the user is
   * authenticated. Receives the full JSON string to persist to the backend.
   * When undefined or when the user is not logged in, no save is attempted.
   */
  onPresetsMutated?: (json: string) => void;
  /**
   * Called alongside onPresetsMutated whenever presets are mutated.
   * Receives all brushes (all three tool types) serialized to BrushPreset[]
   * so the caller can push them into usePreferences and keep brushesRef current.
   * This is the wiring that ensures syncUpload always reads the live preset state.
   */
  onBrushesChanged?: (brushes: BrushPreset[]) => void;
  /** When true the debounced save fires; when false/undefined it is suppressed. */
  isLoggedIn?: boolean;
}

export interface UsePresetSystemReturn {
  // ── State ──────────────────────────────────────────────────────────────────
  presets: typeof DEFAULT_PRESETS;
  activePresetIds: Record<string, string | null>;

  /**
   * PaintingApp must keep this ref current every render:
   *   brushSettingsSnapshotRef.current = brushSettings;
   * It is used by handleAddPreset to snapshot the current brush settings.
   */
  brushSettingsSnapshotRef: React.MutableRefObject<BrushSettings>;

  // ── Import dialog state (consumed by PaintingApp JSX) ─────────────────────
  importParsed: typeof DEFAULT_PRESETS | null;
  setImportParsed: React.Dispatch<
    React.SetStateAction<typeof DEFAULT_PRESETS | null>
  >;
  showMergeDialog: boolean;
  setShowMergeDialog: React.Dispatch<React.SetStateAction<boolean>>;
  conflictQueue: ConflictItem[];
  setConflictQueue: React.Dispatch<React.SetStateAction<ConflictItem[]>>;
  pendingMerged: typeof DEFAULT_PRESETS | null;
  setPendingMerged: React.Dispatch<
    React.SetStateAction<typeof DEFAULT_PRESETS | null>
  >;
  currentConflict: ConflictItem | null;
  setCurrentConflict: React.Dispatch<React.SetStateAction<ConflictItem | null>>;

  // ── Refs ───────────────────────────────────────────────────────────────────
  presetsRef: React.MutableRefObject<typeof DEFAULT_PRESETS>;
  activePresetIdsRef: React.MutableRefObject<Record<string, string | null>>;
  /** Kept in sync by this hook whenever setBrushSizes is called from preset callbacks */
  brushSizesRef: React.MutableRefObject<BrushSizes>;
  /** PaintingApp must keep this in sync: brushOpacityRef.current = color.a */
  brushOpacityRef: React.MutableRefObject<number>;
  toolSizesRef: React.MutableRefObject<Record<string, number | undefined>>;
  toolOpacitiesRef: React.MutableRefObject<Record<string, number>>;
  toolFlowsRef: React.MutableRefObject<Record<string, number>>;

  // ── Setters ────────────────────────────────────────────────────────────────
  setPresets: React.Dispatch<React.SetStateAction<typeof DEFAULT_PRESETS>>;
  setActivePresetIds: React.Dispatch<
    React.SetStateAction<Record<string, string | null>>
  >;

  // ── Callbacks ──────────────────────────────────────────────────────────────
  handleSelectPreset: (preset: Preset) => void;
  handleUpdatePreset: (updated: Preset) => void;
  handleAddPreset: (tipImageData?: string) => void;
  handleDeletePreset: (presetId: string) => void;
  handleActivatePreset: () => void;
  handleReorderPresets: (fromIndex: number, toIndex: number) => void;
  handleSaveCurrentToPreset: (
    presetId: string,
    size: number,
    opacity: number,
  ) => void;
  handleExportBrushes: () => void;
  handleImportBrushes: (file: File) => void;
  processImportAppend: (
    parsed: typeof DEFAULT_PRESETS,
    currentPresets: typeof DEFAULT_PRESETS,
  ) => void;
  resolveConflict: (action: "overwrite" | "rename" | "skip") => void;

  /**
   * Bulk-restore presets from a saved payload (e.g. loaded from cloud on login).
   * Replaces the current presets + activePresetIds with the provided values.
   * Falls back gracefully if any key is missing.
   */
  loadPresets: (payload: PresetsPayload) => void;

  // ── Slider change helpers (sync both state and toolRefs) ──────────────────
  handleCanvasBrushSizeChange: (v: number) => void;
  handleCanvasBrushOpacityChange: (v: number) => void;
  handleCanvasBrushFlowChange: (v: number) => void;
}

export function usePresetSystem({
  activeTool,
  activeSubpanel,
  setBrushSizes,
  setBrushSettings,
  setColor,
  setActiveTool,
  onPresetsMutated,
  onBrushesChanged,
  isLoggedIn,
}: UsePresetSystemProps): UsePresetSystemReturn {
  // ── State ──────────────────────────────────────────────────────────────────
  const [presets, setPresets] = useState(DEFAULT_PRESETS);
  const [activePresetIds, setActivePresetIds] = useState<
    Record<string, string | null>
  >({
    brush: "brush-default",
    smudge: "smear-default",
    eraser: "eraser-default",
  });

  // Import dialog state
  const [importParsed, setImportParsed] = useState<
    typeof DEFAULT_PRESETS | null
  >(null);
  const [showMergeDialog, setShowMergeDialog] = useState(false);
  const [conflictQueue, setConflictQueue] = useState<ConflictItem[]>([]);
  const [pendingMerged, setPendingMerged] = useState<
    typeof DEFAULT_PRESETS | null
  >(null);
  const [currentConflict, setCurrentConflict] = useState<ConflictItem | null>(
    null,
  );

  // ── Refs ───────────────────────────────────────────────────────────────────
  const presetsRef = useRef(presets);
  const activePresetIdsRef = useRef(activePresetIds);
  const brushSizesRef = useRef<BrushSizes>({
    brush: DEFAULT_PRESETS.brush[0]?.defaultSize ?? 24,
    eraser: DEFAULT_PRESETS.eraser[0]?.defaultSize ?? 24,
  });
  const brushOpacityRef = useRef(1);
  // Intentionally initialized as empty so that on first load the tool-switch
  // effect falls through to `preset.defaultSize` rather than a stale hardcoded
  // value.  `loadPresets` populates this from the active preset's defaultSize,
  // and `handleCanvasBrushSizeChange` writes explicit user adjustments.
  const toolSizesRef = useRef<Record<string, number | undefined>>({});
  const toolOpacitiesRef = useRef<Record<string, number>>({});
  const toolFlowsRef = useRef<Record<string, number>>({});

  // Snapshot of current brushSettings — PaintingApp must keep this updated:
  //   brushSettingsSnapshotRef.current = brushSettings;
  const brushSettingsSnapshotRef = useRef<BrushSettings>(
    DEFAULT_PRESETS.brush[0]?.settings ?? ({} as BrushSettings),
  );

  // ── Debounced save refs ─────────────────────────────────────────────────────
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Keep latest callback and login state in refs so the debounce closure
  // always reads the current values without needing to be recreated.
  const onPresetsMutatedRef = useRef(onPresetsMutated);
  const onBrushesChangedRef = useRef(onBrushesChanged);
  const isLoggedInRef = useRef(isLoggedIn);
  onPresetsMutatedRef.current = onPresetsMutated;
  onBrushesChangedRef.current = onBrushesChanged;
  isLoggedInRef.current = isLoggedIn;

  // Keep refs in sync with state
  useEffect(() => {
    presetsRef.current = presets;
  }, [presets]);
  useEffect(() => {
    activePresetIdsRef.current = activePresetIds;
  }, [activePresetIds]);

  // ── Debounced save helper ───────────────────────────────────────────────────
  /**
   * Schedules a debounced save 500 ms after the last mutation.
   * Only fires if the user is currently logged in and a save callback exists.
   * Reads presetsRef/activePresetIdsRef so it always uses the latest state.
   */
  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current !== null) {
      clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      const payload: PresetsPayload = {
        brush: presetsRef.current.brush,
        smudge: presetsRef.current.smudge,
        eraser: presetsRef.current.eraser,
        activePresetIds: activePresetIdsRef.current,
      };

      // Always notify the preferences manager of brush changes so
      // brushesRef stays current for syncUpload — works for both
      // authenticated and unauthenticated users.
      if (onBrushesChangedRef.current) {
        const allPresets = [
          ...presetsRef.current.brush,
          ...presetsRef.current.smudge,
          ...presetsRef.current.eraser,
        ];
        const brushPresets = allPresets.map(presetToBrushPreset);
        onBrushesChangedRef.current(brushPresets);
      }

      if (!isLoggedInRef.current) return;
      if (!onPresetsMutatedRef.current) return;
      try {
        console.log(
          "[Save] Brush settings: triggering save with payload:",
          payload,
        );
        onPresetsMutatedRef.current(JSON.stringify(payload));
      } catch {
        // serialization failure is silent
      }
    }, 500);
  }, []);

  // Clear the timer on unmount to prevent memory leaks / state updates after unmount.
  useEffect(() => {
    return () => {
      if (saveTimerRef.current !== null) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  // ── Tool-switch effect: restore size/opacity/flow from active preset ────────
  useEffect(() => {
    if (
      activeTool === "brush" ||
      activeTool === "smudge" ||
      activeTool === "eraser"
    ) {
      const presetId = activePresetIdsRef.current[activeTool];
      if (presetId) {
        const preset = presetsRef.current[activeTool]?.find(
          (p) => p.id === presetId,
        );
        if (preset) {
          setBrushSettings((prev) => ({
            ...preset.settings,
            flow:
              preset.defaultFlow !== undefined ? preset.defaultFlow : prev.flow,
          }));
          // Restore size: prefer an explicit user adjustment stored in toolSizesRef,
          // then fall back to the preset's defaultSize, then to preset.size.
          const sizeKey = activeTool === "eraser" ? "eraser" : "brush";
          const restoredSize =
            toolSizesRef.current[activeTool] ??
            preset.defaultSize ??
            preset.size;
          if (restoredSize !== undefined) {
            setBrushSizes((prev) => ({ ...prev, [sizeKey]: restoredSize }));
          }
          // Restore preset's stored opacity if defined, otherwise restore tool's stored opacity
          const restoredOpacity =
            preset.opacity ?? toolOpacitiesRef.current[activeTool];
          if (restoredOpacity !== undefined) {
            setColor((prev) => ({ ...prev, a: restoredOpacity }));
          }
          // Restore flow for this tool
          const restoredFlow = toolFlowsRef.current[activeTool];
          if (restoredFlow !== undefined) {
            setBrushSettings((prev) => ({ ...prev, flow: restoredFlow }));
          }
        }
      } else {
        // No preset active - restore tool's stored size/opacity/flow
        const sizeKey = activeTool === "eraser" ? "eraser" : "brush";
        const storedSize = toolSizesRef.current[activeTool];
        if (storedSize !== undefined) {
          setBrushSizes((prev) => ({ ...prev, [sizeKey]: storedSize }));
        }
        const storedOpacity = toolOpacitiesRef.current[activeTool];
        if (storedOpacity !== undefined) {
          setColor((prev) => ({ ...prev, a: storedOpacity }));
        }
        const storedFlow = toolFlowsRef.current[activeTool];
        if (storedFlow !== undefined) {
          setBrushSettings((prev) => ({ ...prev, flow: storedFlow }));
        }
      }
    }
  }, [activeTool, setBrushSettings, setBrushSizes, setColor]);

  // ── Preset callbacks ────────────────────────────────────────────────────────

  const handleSelectPreset = useCallback(
    (preset: Preset) => {
      if (
        activeSubpanel !== "brush" &&
        activeSubpanel !== "smudge" &&
        activeSubpanel !== "eraser"
      )
        return;
      const wasAlreadyActive = activePresetIds[activeSubpanel] === preset.id;
      setActivePresetIds((prev) => ({ ...prev, [activeSubpanel]: preset.id }));
      setBrushSettings((prev) => ({
        ...preset.settings,
        flow: wasAlreadyActive
          ? prev.flow
          : preset.defaultFlow !== undefined
            ? preset.defaultFlow
            : preset.settings.flow !== undefined
              ? preset.settings.flow
              : prev.flow,
      }));
      if (!wasAlreadyActive) {
        if (preset.size !== undefined) {
          const sizeKey = activeSubpanel === "eraser" ? "eraser" : "brush";
          setBrushSizes((prev) => ({ ...prev, [sizeKey]: preset.size! }));
          toolSizesRef.current = {
            ...toolSizesRef.current,
            [activeSubpanel]: preset.size!,
          };
        }
        if (preset.defaultSize !== undefined) {
          const sizeKey = activeSubpanel === "eraser" ? "eraser" : "brush";
          setBrushSizes((prev) => ({
            ...prev,
            [sizeKey]: preset.defaultSize!,
          }));
          toolSizesRef.current = {
            ...toolSizesRef.current,
            [activeSubpanel]: preset.defaultSize!,
          };
        }
      }
      if (preset.opacity !== undefined) {
        setColor((prev) => ({ ...prev, a: preset.opacity! }));
        toolOpacitiesRef.current = {
          ...toolOpacitiesRef.current,
          [activeSubpanel]: preset.opacity!,
        };
      }
      // Selecting a preset is not a mutation that needs cloud-saving —
      // only structural changes (add/update/delete/reorder/saveCurrentToPreset) are saved.
    },
    [
      activeSubpanel,
      activePresetIds,
      setBrushSettings,
      setBrushSizes,
      setColor,
    ],
  );

  const handleUpdatePreset = useCallback(
    (updated: Preset) => {
      if (
        activeSubpanel !== "brush" &&
        activeSubpanel !== "smudge" &&
        activeSubpanel !== "eraser"
      )
        return;
      setPresets((prev) => ({
        ...prev,
        [activeSubpanel]: prev[activeSubpanel].map((p) =>
          p.id === updated.id ? updated : p,
        ),
      }));
      if (activePresetIds[activeSubpanel] === updated.id)
        setBrushSettings((prev) => ({ ...updated.settings, flow: prev.flow }));
      scheduleSave();
    },
    [activeSubpanel, activePresetIds, setBrushSettings, scheduleSave],
  );

  const handleAddPreset = useCallback(
    (tipImageData?: string) => {
      if (
        activeSubpanel !== "brush" &&
        activeSubpanel !== "smudge" &&
        activeSubpanel !== "eraser"
      )
        return;
      const newId = `${activeSubpanel}-custom-${Date.now()}`;
      // Read current brushSettings from snapshot ref (kept current by PaintingApp)
      const currentSettings = brushSettingsSnapshotRef.current;
      const newPreset: Preset = {
        id: newId,
        name: "New Preset",
        settings: {
          ...currentSettings,
          ...(tipImageData !== undefined ? { tipImageData } : {}),
        },
      };
      setPresets((prev) => ({
        ...prev,
        [activeSubpanel]: [...prev[activeSubpanel], newPreset],
      }));
      setActivePresetIds((prev) => ({ ...prev, [activeSubpanel]: newId }));
      setBrushSettings(newPreset.settings);
      scheduleSave();
    },
    [activeSubpanel, setBrushSettings, scheduleSave],
  );

  const handleDeletePreset = useCallback(
    (presetId: string) => {
      if (
        activeSubpanel !== "brush" &&
        activeSubpanel !== "smudge" &&
        activeSubpanel !== "eraser"
      )
        return;
      setPresets((prev) => ({
        ...prev,
        [activeSubpanel]: prev[activeSubpanel].filter((p) => p.id !== presetId),
      }));
      if (activePresetIds[activeSubpanel] === presetId)
        setActivePresetIds((prev) => ({ ...prev, [activeSubpanel]: null }));
      scheduleSave();
    },
    [activeSubpanel, activePresetIds, scheduleSave],
  );

  const handleActivatePreset = useCallback(() => {
    if (
      activeSubpanel === "brush" ||
      activeSubpanel === "smudge" ||
      activeSubpanel === "eraser"
    ) {
      setActiveTool?.(activeSubpanel);
    }
  }, [activeSubpanel, setActiveTool]);

  const handleReorderPresets = useCallback(
    (fromIndex: number, toIndex: number) => {
      if (
        activeSubpanel !== "brush" &&
        activeSubpanel !== "smudge" &&
        activeSubpanel !== "eraser"
      )
        return;
      if (fromIndex === toIndex) return;
      setPresets((prev) => {
        const arr = [...prev[activeSubpanel]];
        const [moved] = arr.splice(fromIndex, 1);
        arr.splice(toIndex, 0, moved);
        return { ...prev, [activeSubpanel]: arr };
      });
      scheduleSave();
    },
    [activeSubpanel, scheduleSave],
  );

  const handleSaveCurrentToPreset = useCallback(
    (presetId: string, size: number, opacity: number) => {
      if (
        activeSubpanel !== "brush" &&
        activeSubpanel !== "smudge" &&
        activeSubpanel !== "eraser"
      )
        return;
      setPresets((prev) => ({
        ...prev,
        [activeSubpanel]: prev[activeSubpanel].map((p) =>
          p.id === presetId ? { ...p, size, opacity } : p,
        ),
      }));
      scheduleSave();
    },
    [activeSubpanel, scheduleSave],
  );

  // ── Import / Export ─────────────────────────────────────────────────────────

  const handleExportBrushes = useCallback(() => {
    const data = JSON.stringify(
      {
        version: 1,
        presets: {
          brush: presetsRef.current.brush,
          smudge: presetsRef.current.smudge,
          eraser: presetsRef.current.eraser,
        },
      },
      null,
      2,
    );
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "brushes.hbrush";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, []);

  const handleImportBrushes = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const json = JSON.parse(e.target?.result as string);
        if (!json.version || !json.presets) throw new Error("Invalid format");
        const parsed = json.presets as typeof DEFAULT_PRESETS;
        setImportParsed(parsed);
        setShowMergeDialog(true);
      } catch {
        toast.error("Invalid .hbrush file");
      }
    };
    reader.readAsText(file);
  }, []);

  const processImportAppend = useCallback(
    (
      parsed: typeof DEFAULT_PRESETS,
      currentPresets: typeof DEFAULT_PRESETS,
    ) => {
      const merged: typeof DEFAULT_PRESETS = {
        brush: [...currentPresets.brush],
        smudge: [...currentPresets.smudge],
        eraser: [...currentPresets.eraser],
      };
      const conflicts: ConflictItem[] = [];
      for (const toolType of ["brush", "smudge", "eraser"] as const) {
        for (const incoming of parsed[toolType] || []) {
          const exists = merged[toolType].some((p) => p.name === incoming.name);
          if (exists) {
            conflicts.push({ toolType, preset: incoming });
          } else {
            merged[toolType] = [
              ...merged[toolType],
              {
                ...incoming,
                id: `${toolType}-${Date.now()}-${Math.random()}`,
              },
            ];
          }
        }
      }
      if (conflicts.length > 0) {
        setPendingMerged(merged);
        setConflictQueue(conflicts.slice(1));
        setCurrentConflict(conflicts[0]);
      } else {
        setPresets(merged);
        // Sync brushSettings to the current active preset's settings
        const currentActiveBrushId = activePresetIdsRef.current?.brush;
        const newActivePreset = currentActiveBrushId
          ? merged.brush.find((p) => p.id === currentActiveBrushId)
          : null;
        if (newActivePreset?.settings) {
          const s = { ...newActivePreset.settings };
          if (newActivePreset.defaultFlow !== undefined)
            s.flow = newActivePreset.defaultFlow;
          setBrushSettings(s);
        }
        toast.success("Brushes imported successfully!");
        scheduleSave();
      }
    },
    [setBrushSettings, scheduleSave],
  );

  const resolveConflict = useCallback(
    (action: "overwrite" | "rename" | "skip") => {
      if (!currentConflict || !pendingMerged) return;
      const { toolType, preset } = currentConflict;
      let nextMerged = {
        ...pendingMerged,
        [toolType]: [...pendingMerged[toolType]],
      };

      if (action === "overwrite") {
        nextMerged[toolType] = nextMerged[toolType].map((p) =>
          p.name === preset.name ? { ...preset, id: p.id } : p,
        );
      } else if (action === "rename") {
        let suffix = 2;
        let newName = `${preset.name} ${suffix}`;
        while (nextMerged[toolType].some((p) => p.name === newName)) {
          suffix++;
          newName = `${preset.name} ${suffix}`;
        }
        nextMerged[toolType] = [
          ...nextMerged[toolType],
          {
            ...preset,
            name: newName,
            id: `${toolType}-${Date.now()}-${Math.random()}`,
          },
        ];
      }
      // skip: do nothing

      setPendingMerged(nextMerged);

      if (conflictQueue.length > 0) {
        setCurrentConflict(conflictQueue[0]);
        setConflictQueue(conflictQueue.slice(1));
      } else {
        setPresets(nextMerged);
        setCurrentConflict(null);
        setPendingMerged(null);
        toast.success("Brushes imported successfully!");
        scheduleSave();
      }
    },
    [currentConflict, pendingMerged, conflictQueue, scheduleSave],
  );

  // ── loadPresets (cloud restore on login) ────────────────────────────────────

  const loadPresets = useCallback(
    (payload: PresetsPayload) => {
      console.log(
        "[Load] Raw brush settings from storage (loadPresets called):",
        payload,
      );
      // Validate and fall back per-tool-type if the data is malformed
      const safeBrush =
        Array.isArray(payload.brush) && payload.brush.length > 0
          ? payload.brush
          : DEFAULT_PRESETS.brush;
      const safeSmudge =
        Array.isArray(payload.smudge) && payload.smudge.length > 0
          ? payload.smudge
          : DEFAULT_PRESETS.smudge;
      const safeEraser =
        Array.isArray(payload.eraser) && payload.eraser.length > 0
          ? payload.eraser
          : DEFAULT_PRESETS.eraser;
      const safeActiveIds =
        payload.activePresetIds && typeof payload.activePresetIds === "object"
          ? payload.activePresetIds
          : {
              brush: "brush-default",
              smudge: "smear-default",
              eraser: "eraser-default",
            };

      if (
        !payload ||
        (!Array.isArray(payload.brush) &&
          !Array.isArray(payload.smudge) &&
          !Array.isArray(payload.eraser))
      ) {
        console.warn("[Load] Brush settings: null — nothing to load");
      }

      setPresets({ brush: safeBrush, smudge: safeSmudge, eraser: safeEraser });
      setActivePresetIds(safeActiveIds);
      console.log("[Load] Parsed brush settings applied:", {
        presets: payload,
        activeIds: safeActiveIds,
      });

      // Seed toolSizesRef from each tool's active preset so that on first
      // tool-switch the effect reads the correct defaultSize rather than
      // whatever hardcoded fallback was used at mount.
      const toolPresetMap: Array<{
        tool: "brush" | "smudge" | "eraser";
        list: Preset[];
      }> = [
        { tool: "brush", list: safeBrush },
        { tool: "smudge", list: safeSmudge },
        { tool: "eraser", list: safeEraser },
      ];
      for (const { tool, list } of toolPresetMap) {
        const id = safeActiveIds[tool];
        const preset = id ? list.find((p) => p.id === id) : list[0];
        if (preset) {
          const size = preset.defaultSize ?? preset.size;
          if (size !== undefined) {
            toolSizesRef.current[tool] = size;
          }
        }
      }

      // Restore brush settings for the currently active brush preset
      const activeBrushId = safeActiveIds.brush;
      const activePreset = activeBrushId
        ? safeBrush.find((p) => p.id === activeBrushId)
        : null;
      if (activePreset) {
        if (activePreset.settings) {
          const s = { ...activePreset.settings };
          if (activePreset.defaultFlow !== undefined)
            s.flow = activePreset.defaultFlow;
          setBrushSettings(s);
        }
        // Apply the correct size immediately so the UI reflects the preset
        const correctSize = activePreset.defaultSize ?? activePreset.size;
        if (correctSize !== undefined) {
          setBrushSizes((prev) => ({ ...prev, brush: correctSize }));
          brushSizesRef.current = {
            ...brushSizesRef.current,
            brush: correctSize,
          };
        }
      }
    },
    [setBrushSettings, setBrushSizes],
  );

  // ── Slider change helpers ────────────────────────────────────────────────────

  const handleCanvasBrushSizeChange = useCallback(
    (v: number) => {
      const key = activeTool === "eraser" ? "eraser" : "brush";
      setBrushSizes((prev) => ({ ...prev, [key]: v }));
      toolSizesRef.current = { ...toolSizesRef.current, [activeTool]: v };
    },
    [activeTool, setBrushSizes],
  );

  const handleCanvasBrushOpacityChange = useCallback(
    (v: number) => {
      setColor((prev) => ({ ...prev, a: v }));
      toolOpacitiesRef.current = {
        ...toolOpacitiesRef.current,
        [activeTool]: v,
      };
    },
    [activeTool, setColor],
  );

  const handleCanvasBrushFlowChange = useCallback(
    (v: number) => {
      setBrushSettings((prev) => ({ ...prev, flow: v }));
      toolFlowsRef.current = { ...toolFlowsRef.current, [activeTool]: v };
    },
    [activeTool, setBrushSettings],
  );

  return {
    presets,
    activePresetIds,
    brushSettingsSnapshotRef,
    importParsed,
    setImportParsed,
    showMergeDialog,
    setShowMergeDialog,
    conflictQueue,
    setConflictQueue,
    pendingMerged,
    setPendingMerged,
    currentConflict,
    setCurrentConflict,
    presetsRef,
    activePresetIdsRef,
    brushSizesRef,
    brushOpacityRef,
    toolSizesRef,
    toolOpacitiesRef,
    toolFlowsRef,
    setPresets,
    setActivePresetIds,
    handleSelectPreset,
    handleUpdatePreset,
    handleAddPreset,
    handleDeletePreset,
    handleActivatePreset,
    handleReorderPresets,
    handleSaveCurrentToPreset,
    handleExportBrushes,
    handleImportBrushes,
    processImportAppend,
    resolveConflict,
    loadPresets,
    handleCanvasBrushSizeChange,
    handleCanvasBrushOpacityChange,
    handleCanvasBrushFlowChange,
  };
}
