/**
 * AppDialogs — all top-level AlertDialog panels extracted from PaintingApp.tsx.
 * Pure JSX + presentation only; all state and callbacks live in the parent.
 */
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { Preset } from "@/utils/toolPresets";
import { toast } from "sonner";
import type { ConflictItem } from "../hooks/usePresetSystem";
import type { BrushSettings } from "./BrushSettingsPanel";

export type PresetStore = Record<"brush" | "smudge" | "eraser", Preset[]>;

// ─── Cloud Overwrite Dialog ───────────────────────────────────────────────────

interface CloudOverwriteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

export function CloudOverwriteDialog({
  open,
  onOpenChange,
  onCancel,
  onConfirm,
}: CloudOverwriteDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent data-ocid="settings.dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>Overwrite Cloud Save?</AlertDialogTitle>
          <AlertDialogDescription>
            You already have a canvas saved in the cloud. Saving now will
            replace it. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Overwrite</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ─── Delete Group Dialog ──────────────────────────────────────────────────────

interface DeleteGroupDialogProps {
  deleteGroupConfirm: { groupId: string; groupName: string } | null;
  onOpenChange: (open: boolean) => void;
  onCancel: () => void;
  onRelease: (groupId: string) => void;
  onDeleteAll: (groupId: string) => void;
}

export function DeleteGroupDialog({
  deleteGroupConfirm,
  onOpenChange,
  onCancel,
  onRelease,
  onDeleteAll,
}: DeleteGroupDialogProps) {
  return (
    <AlertDialog
      open={!!deleteGroupConfirm}
      onOpenChange={(open) => {
        if (!open) onOpenChange(false);
      }}
    >
      <AlertDialogContent data-ocid="layer.delete_group_dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>
            Delete group &ldquo;{deleteGroupConfirm?.groupName}&rdquo;?
          </AlertDialogTitle>
          <AlertDialogDescription>
            Choose what to do with the layers inside.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel
            data-ocid="layer.delete_group_cancel"
            onClick={onCancel}
          >
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            data-ocid="layer.delete_group_release"
            onClick={() => {
              if (deleteGroupConfirm) onRelease(deleteGroupConfirm.groupId);
            }}
          >
            Release layers (keep them, remove group only)
          </AlertDialogAction>
          <AlertDialogAction
            data-ocid="layer.delete_group_all"
            onClick={() => {
              if (deleteGroupConfirm) onDeleteAll(deleteGroupConfirm.groupId);
            }}
          >
            Delete group and all layers inside
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ─── Merge Strategy Dialog ────────────────────────────────────────────────────

interface MergeStrategyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  importParsed: PresetStore | null;
  presets: PresetStore;
  processImportAppend: (imported: PresetStore, current: PresetStore) => void;
  setPresets: React.Dispatch<React.SetStateAction<PresetStore>>;
  setActivePresetIds: React.Dispatch<
    React.SetStateAction<Record<string, string | null>>
  >;
  setBrushSettings: React.Dispatch<React.SetStateAction<BrushSettings>>;
}

export function MergeStrategyDialog({
  open,
  onOpenChange,
  importParsed,
  presets,
  processImportAppend,
  setPresets,
  setActivePresetIds,
  setBrushSettings,
}: MergeStrategyDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent data-ocid="settings.dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>Import Brushes</AlertDialogTitle>
          <AlertDialogDescription>
            How would you like to merge the imported brushes with your current
            presets?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-ocid="settings.cancel_button">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            data-ocid="settings.secondary_button"
            onClick={() => {
              onOpenChange(false);
              if (importParsed) processImportAppend(importParsed, presets);
            }}
          >
            Append
          </AlertDialogAction>
          <AlertDialogAction
            data-ocid="settings.primary_button"
            onClick={() => {
              onOpenChange(false);
              if (importParsed) {
                const merged: PresetStore = {
                  brush: importParsed.brush || [],
                  smudge: importParsed.smudge || [],
                  eraser: importParsed.eraser || [],
                };
                setPresets(merged);
                // Reset active preset IDs to the first preset in each tool category
                setActivePresetIds({
                  brush: merged.brush[0]?.id ?? null,
                  smudge: merged.smudge[0]?.id ?? null,
                  eraser: merged.eraser[0]?.id ?? null,
                });
                // Sync brushSettings to the new active brush preset's full settings
                if (merged.brush[0]?.settings) {
                  const s = { ...merged.brush[0].settings };
                  if (merged.brush[0].defaultFlow !== undefined)
                    s.flow = merged.brush[0].defaultFlow;
                  setBrushSettings(s);
                }
                toast.success("Brushes replaced successfully!");
              }
            }}
          >
            Replace All
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ─── Brush Conflict Dialog ────────────────────────────────────────────────────

interface BrushConflictDialogProps {
  currentConflict: ConflictItem | null;
  onOpenChange: (open: boolean) => void;
  onCancel: () => void;
  onResolve: (resolution: "skip" | "rename" | "overwrite") => void;
}

export function BrushConflictDialog({
  currentConflict,
  onOpenChange,
  onCancel,
  onResolve,
}: BrushConflictDialogProps) {
  return (
    <AlertDialog
      open={!!currentConflict}
      onOpenChange={(open) => {
        if (!open) onOpenChange(false);
      }}
    >
      <AlertDialogContent data-ocid="settings.conflict_dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>Brush Conflict</AlertDialogTitle>
          <AlertDialogDescription>
            A brush named &ldquo;{currentConflict?.preset.name}&rdquo; already
            exists. What would you like to do?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel
            data-ocid="settings.conflict_cancel_button"
            onClick={onCancel}
          >
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            data-ocid="settings.conflict_skip_button"
            onClick={() => onResolve("skip")}
          >
            Skip
          </AlertDialogAction>
          <AlertDialogAction
            data-ocid="settings.conflict_rename_button"
            onClick={() => onResolve("rename")}
          >
            Rename
          </AlertDialogAction>
          <AlertDialogAction
            data-ocid="settings.conflict_overwrite_button"
            onClick={() => onResolve("overwrite")}
          >
            Overwrite
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
