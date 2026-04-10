import type { BrushSettings } from "@/components/BrushSettingsPanel";
import type { Tool } from "@/components/Toolbar";
import type { Preset } from "@/utils/toolPresets";
import { DEFAULT_PRESETS } from "@/utils/toolPresets";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

export type BrushSizes = { brush: number; eraser: number };

export interface ConflictItem {
  toolType: "brush" | "smudge" | "eraser";
  preset: Preset;
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
  toolSizesRef: React.MutableRefObject<Record<string, number>>;
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
  const toolSizesRef = useRef<Record<string, number>>({
    brush: DEFAULT_PRESETS.brush[0]?.defaultSize ?? 24,
    eraser: DEFAULT_PRESETS.eraser[0]?.defaultSize ?? 24,
    smudge: DEFAULT_PRESETS.smudge[0]?.defaultSize ?? 24,
  });
  const toolOpacitiesRef = useRef<Record<string, number>>({});
  const toolFlowsRef = useRef<Record<string, number>>({});

  // Snapshot of current brushSettings — PaintingApp must keep this updated:
  //   brushSettingsSnapshotRef.current = brushSettings;
  const brushSettingsSnapshotRef = useRef<BrushSettings>(
    DEFAULT_PRESETS.brush[0]?.settings ?? ({} as BrushSettings),
  );

  // Keep refs in sync with state
  useEffect(() => {
    presetsRef.current = presets;
  }, [presets]);
  useEffect(() => {
    activePresetIdsRef.current = activePresetIds;
  }, [activePresetIds]);

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
          // Restore preset's stored size if defined, otherwise restore tool's stored size
          const sizeKey = activeTool === "eraser" ? "eraser" : "brush";
          const restoredSize = toolSizesRef.current[activeTool] ?? preset.size;
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
    },
    [activeSubpanel, activePresetIds, setBrushSettings],
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
    },
    [activeSubpanel, setBrushSettings],
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
    },
    [activeSubpanel, activePresetIds],
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
    },
    [activeSubpanel],
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
    },
    [activeSubpanel],
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
      }
    },
    [setBrushSettings],
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
      }
    },
    [currentConflict, pendingMerged, conflictQueue],
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
    handleCanvasBrushSizeChange,
    handleCanvasBrushOpacityChange,
    handleCanvasBrushFlowChange,
  };
}
