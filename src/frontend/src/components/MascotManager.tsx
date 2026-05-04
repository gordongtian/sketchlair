/**
 * MascotManager — admin UI for uploading and managing mascot expressions (PNG)
 * and animations (Lottie JSON). Follows the same patterns as ImageSetManager.tsx.
 */

import { createActorWithConfig, loadConfig } from "@/config";
import { StorageClient } from "@/utils/StorageClient";
import { HttpAgent, type Identity } from "@icp-sdk/core/agent";
import lottie, { type AnimationItem } from "lottie-web";
import {
  AlertCircle,
  CheckCircle2,
  Film,
  ImagePlus,
  Loader2,
  Play,
  SmilePlus,
  Square,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

interface MascotManagerProps {
  identity: Identity | null;
}

type MascotTab = "expressions" | "animations";

interface MascotAssets {
  expressions: Array<[string, string]>; // [name, blobUrl]
  animations: Array<[string, string]>; // [name, blobUrl]
  defaultExpressionName?: string;
  defaultIdleAnimationName?: string;
}

interface PendingUpload {
  name: string;
  assetUrl: string;
  type: "expression" | "animation";
}

// ── Confirm Dialog ────────────────────────────────────────────────────────────

function ConfirmDialog({
  message,
  onConfirm,
  onCancel,
}: {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <dialog
      data-ocid="mascot_confirm.dialog"
      open
      className="fixed inset-0 z-[9998] flex items-center justify-center w-full h-full max-w-full max-h-full m-0 p-0"
      style={{ background: "rgba(0,0,0,0.7)" }}
    >
      <div
        className="rounded-xl p-6 max-w-sm w-full mx-4 flex flex-col gap-4"
        style={{
          backgroundColor: "oklch(var(--toolbar))",
          border: "1px solid oklch(var(--outline))",
        }}
      >
        <p className="text-sm" style={{ color: "oklch(var(--text))" }}>
          {message}
        </p>
        <div className="flex gap-3 justify-end">
          <button
            type="button"
            data-ocid="mascot_confirm.cancel_button"
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-sm transition-opacity hover:opacity-80"
            style={{
              backgroundColor: "oklch(var(--sidebar-left))",
              color: "oklch(var(--text))",
              border: "1px solid oklch(var(--outline))",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            data-ocid="mascot_confirm.confirm_button"
            onClick={onConfirm}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-opacity hover:opacity-80"
            style={{ backgroundColor: "oklch(0.55 0.22 25)", color: "#fff" }}
          >
            Delete
          </button>
        </div>
      </div>
    </dialog>
  );
}

// ── Name Input Dialog ─────────────────────────────────────────────────────────

function NameDialog({
  title,
  initialName,
  onConfirm,
  onCancel,
  isSaving,
}: {
  title: string;
  initialName: string;
  onConfirm: (name: string) => void;
  onCancel: () => void;
  isSaving: boolean;
}) {
  const [value, setValue] = useState(initialName);

  return (
    <dialog
      data-ocid="mascot_name.dialog"
      open
      aria-label={title}
      className="fixed inset-0 z-[9998] flex items-center justify-center w-full h-full max-w-full max-h-full m-0 p-0"
      style={{ background: "rgba(0,0,0,0.7)" }}
    >
      <div
        className="rounded-xl p-6 max-w-sm w-full mx-4 flex flex-col gap-4"
        style={{
          backgroundColor: "oklch(var(--toolbar))",
          border: "1px solid oklch(var(--outline))",
        }}
      >
        <h3
          className="text-sm font-semibold"
          style={{ color: "oklch(var(--text))" }}
        >
          {title}
        </h3>
        <input
          data-ocid="mascot_name.input"
          type="text"
          value={value}
          maxLength={64}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && value.trim()) onConfirm(value.trim());
            if (e.key === "Escape") onCancel();
          }}
          className="px-3 py-2 rounded-lg text-sm"
          style={{
            backgroundColor: "oklch(var(--sidebar-left))",
            border: "1px solid oklch(var(--outline))",
            color: "oklch(var(--text))",
            outline: "none",
          }}
          placeholder="Expression name…"
          // biome-ignore lint/a11y/noAutofocus: intentional for modal UX
          autoFocus
        />
        <div className="flex gap-3 justify-end">
          <button
            type="button"
            data-ocid="mascot_name.cancel_button"
            onClick={onCancel}
            disabled={isSaving}
            className="px-4 py-2 rounded-lg text-sm transition-opacity hover:opacity-80"
            style={{
              backgroundColor: "oklch(var(--sidebar-left))",
              color: "oklch(var(--text))",
              border: "1px solid oklch(var(--outline))",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            data-ocid="mascot_name.confirm_button"
            onClick={() => value.trim() && onConfirm(value.trim())}
            disabled={isSaving || !value.trim()}
            className="px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-opacity hover:opacity-80 disabled:opacity-50"
            style={{
              backgroundColor: "oklch(var(--accent))",
              color: "oklch(var(--accent-text))",
            }}
          >
            {isSaving && <Loader2 size={14} className="animate-spin" />}
            Save
          </button>
        </div>
      </div>
    </dialog>
  );
}

// ── LottiePreview ─────────────────────────────────────────────────────────────

function LottiePreview({
  assetUrl,
  isPlaying,
}: { assetUrl: string; isPlaying: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<AnimationItem | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const anim = lottie.loadAnimation({
      container: containerRef.current,
      renderer: "svg",
      loop: true,
      autoplay: isPlaying,
      path: assetUrl,
    });
    animRef.current = anim;
    return () => {
      anim.destroy();
      animRef.current = null;
    };
  }, [assetUrl, isPlaying]);

  useEffect(() => {
    if (!animRef.current) return;
    if (isPlaying) {
      animRef.current.play();
    } else {
      animRef.current.stop();
    }
  }, [isPlaying]);

  return (
    <div
      ref={containerRef}
      className="w-[80px] h-[80px] rounded-lg overflow-hidden flex items-center justify-center"
      style={{ backgroundColor: "oklch(var(--canvas-bg))" }}
    />
  );
}

// ── Expression Card ───────────────────────────────────────────────────────────

function ExpressionCard({
  name,
  assetUrl,
  isDefault,
  onSetDefault,
  onDelete,
  index,
}: {
  name: string;
  assetUrl: string;
  isDefault: boolean;
  onSetDefault: () => void;
  onDelete: () => void;
  index: number;
}) {
  return (
    <div
      data-ocid={`mascot_expression.item.${index}`}
      className="flex flex-col rounded-xl overflow-hidden relative"
      style={{
        backgroundColor: "oklch(var(--sidebar-left) / 0.6)",
        border: `1px solid ${isDefault ? "oklch(var(--accent) / 0.5)" : "oklch(var(--outline))"}`,
      }}
    >
      {/* Default badge */}
      {isDefault && (
        <div className="absolute top-2 right-2 z-10">
          <span
            className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
            style={{
              backgroundColor: "oklch(var(--accent) / 0.85)",
              color: "oklch(var(--accent-text))",
            }}
          >
            <Star size={9} />
            Default
          </span>
        </div>
      )}

      {/* Thumbnail */}
      <div
        className="w-full aspect-square flex items-center justify-center"
        style={{ backgroundColor: "oklch(var(--canvas-bg))" }}
      >
        <img
          src={assetUrl}
          alt={name}
          className="w-full h-full object-contain"
        />
      </div>

      {/* Name + actions */}
      <div className="flex flex-col gap-2 p-3">
        <p
          className="text-xs font-medium truncate"
          style={{ color: "oklch(var(--text))" }}
          title={name}
        >
          {name}
        </p>
        <div className="flex gap-1.5">
          <button
            type="button"
            data-ocid={`mascot_expression.set_default_button.${index}`}
            onClick={onSetDefault}
            disabled={isDefault}
            className="flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded-md text-xs transition-opacity hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              backgroundColor: isDefault
                ? "oklch(var(--accent) / 0.12)"
                : "oklch(var(--sidebar-left))",
              color: isDefault
                ? "oklch(var(--accent))"
                : "oklch(var(--muted-text))",
              border: `1px solid ${isDefault ? "oklch(var(--accent) / 0.3)" : "oklch(var(--outline))"}`,
            }}
          >
            <Star size={9} />
            {isDefault ? "Default" : "Set Default"}
          </button>
          <button
            type="button"
            data-ocid={`mascot_expression.delete_button.${index}`}
            onClick={onDelete}
            className="p-1.5 rounded-md transition-opacity hover:opacity-80"
            style={{
              backgroundColor: "oklch(var(--sidebar-left))",
              color: "oklch(0.65 0.2 25)",
              border: "1px solid oklch(0.45 0.2 25 / 0.4)",
            }}
            aria-label={`Delete expression ${name}`}
          >
            <Trash2 size={11} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Animation Card ────────────────────────────────────────────────────────────

function AnimationCard({
  name,
  assetUrl,
  isDefault,
  onSetDefault,
  onDelete,
  index,
}: {
  name: string;
  assetUrl: string;
  isDefault: boolean;
  onSetDefault: () => void;
  onDelete: () => void;
  index: number;
}) {
  const [isPlaying, setIsPlaying] = useState(false);

  return (
    <div
      data-ocid={`mascot_animation.item.${index}`}
      className="flex flex-col rounded-xl overflow-hidden"
      style={{
        backgroundColor: "oklch(var(--sidebar-left) / 0.6)",
        border: `1px solid ${isDefault ? "oklch(var(--accent) / 0.5)" : "oklch(var(--outline))"}`,
      }}
    >
      <div className="p-3 flex flex-col gap-3">
        {/* Name + idle badge */}
        <div className="flex items-center gap-2 min-w-0">
          <p
            className="text-xs font-medium truncate flex-1 min-w-0"
            style={{ color: "oklch(var(--text))" }}
            title={name}
          >
            {name}
          </p>
          {isDefault && (
            <span
              className="text-xs px-2 py-0.5 rounded-full shrink-0 flex items-center gap-1"
              style={{
                backgroundColor: "oklch(var(--accent) / 0.15)",
                color: "oklch(var(--accent))",
                border: "1px solid oklch(var(--accent) / 0.3)",
              }}
            >
              <Star size={9} />
              Idle
            </span>
          )}
        </div>

        {/* Lottie preview + play toggle */}
        <div className="flex items-center gap-3">
          <LottiePreview assetUrl={assetUrl} isPlaying={isPlaying} />
          <button
            type="button"
            data-ocid={`mascot_animation.play_button.${index}`}
            onClick={() => setIsPlaying((v) => !v)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-opacity hover:opacity-80"
            style={{
              backgroundColor: isPlaying
                ? "oklch(var(--accent) / 0.15)"
                : "oklch(var(--sidebar-left))",
              color: isPlaying
                ? "oklch(var(--accent))"
                : "oklch(var(--muted-text))",
              border: `1px solid ${isPlaying ? "oklch(var(--accent) / 0.35)" : "oklch(var(--outline))"}`,
            }}
          >
            {isPlaying ? <Square size={10} /> : <Play size={10} />}
            {isPlaying ? "Stop" : "Play"}
          </button>
        </div>

        {/* Actions */}
        <div className="flex gap-1.5">
          <button
            type="button"
            data-ocid={`mascot_animation.set_default_button.${index}`}
            onClick={onSetDefault}
            disabled={isDefault}
            className="flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded-md text-xs transition-opacity hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              backgroundColor: isDefault
                ? "oklch(var(--accent) / 0.12)"
                : "oklch(var(--sidebar-left))",
              color: isDefault
                ? "oklch(var(--accent))"
                : "oklch(var(--muted-text))",
              border: `1px solid ${isDefault ? "oklch(var(--accent) / 0.3)" : "oklch(var(--outline))"}`,
            }}
          >
            <Film size={9} />
            {isDefault ? "Default Idle" : "Set Default Idle"}
          </button>
          <button
            type="button"
            data-ocid={`mascot_animation.delete_button.${index}`}
            onClick={onDelete}
            className="p-1.5 rounded-md transition-opacity hover:opacity-80"
            style={{
              backgroundColor: "oklch(var(--sidebar-left))",
              color: "oklch(0.65 0.2 25)",
              border: "1px solid oklch(0.45 0.2 25 / 0.4)",
            }}
            aria-label={`Delete animation ${name}`}
          >
            <Trash2 size={11} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Upload Progress Bar ───────────────────────────────────────────────────────

function UploadProgress({
  name,
  progress,
  error,
  done,
}: {
  name: string;
  progress: number;
  error: string | null;
  done: boolean;
}) {
  return (
    <div
      className="flex flex-col gap-1 px-4 py-3 rounded-lg"
      style={{
        backgroundColor: "oklch(var(--sidebar-left) / 0.4)",
        border: "1px solid oklch(var(--outline))",
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className="text-xs truncate min-w-0"
          style={{ color: "oklch(var(--muted-text))" }}
        >
          {name}
        </span>
        {done && !error && (
          <CheckCircle2 size={12} style={{ color: "oklch(0.65 0.15 140)" }} />
        )}
        {error && (
          <AlertCircle size={12} style={{ color: "oklch(0.65 0.2 25)" }} />
        )}
      </div>
      {error ? (
        <p className="text-xs" style={{ color: "oklch(0.65 0.2 25)" }}>
          {error}
        </p>
      ) : (
        <div
          className="h-1.5 rounded-full overflow-hidden"
          style={{ backgroundColor: "oklch(var(--outline))" }}
        >
          <div
            className="h-full rounded-full transition-all duration-200"
            style={{
              width: `${progress}%`,
              backgroundColor: done
                ? "oklch(0.65 0.15 140)"
                : "oklch(var(--accent))",
            }}
          />
        </div>
      )}
    </div>
  );
}

// ── MascotManager ─────────────────────────────────────────────────────────────

export function MascotManager({ identity }: MascotManagerProps) {
  const [activeTab, setActiveTab] = useState<MascotTab>("expressions");
  const [assets, setAssets] = useState<MascotAssets>({
    expressions: [],
    animations: [],
  });
  const [isLoading, setIsLoading] = useState(true);
  const [globalError, setGlobalError] = useState<string | null>(null);

  // Upload state
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [pendingUpload, setPendingUpload] = useState<PendingUpload | null>(
    null,
  );
  const [isSavingName, setIsSavingName] = useState(false);

  // Confirm dialog
  const [confirmState, setConfirmState] = useState<{
    message: string;
    onConfirm: () => void;
  } | null>(null);

  const exprFileRef = useRef<HTMLInputElement>(null);
  const animFileRef = useRef<HTMLInputElement>(null);
  const actorRef = useRef<Awaited<
    ReturnType<typeof createActorWithConfig>
  > | null>(null);

  const getActor = useCallback(async () => {
    if (!actorRef.current) {
      actorRef.current = await createActorWithConfig({
        identity: identity ?? undefined,
      });
    }
    return actorRef.current;
  }, [identity]);

  const loadAssets = useCallback(async () => {
    setIsLoading(true);
    setGlobalError(null);
    try {
      const actor = await getActor();
      const result = await actor.getMascotAssets();
      setAssets(result);
    } catch (err) {
      setGlobalError(
        err instanceof Error ? err.message : "Failed to load mascot assets",
      );
    } finally {
      setIsLoading(false);
    }
  }, [getActor]);

  useEffect(() => {
    void loadAssets();
  }, [loadAssets]);

  // ── Upload helper ──────────────────────────────────────────────────────────

  const uploadToStorage = useCallback(
    async (file: File, onProgress: (pct: number) => void): Promise<string> => {
      const config = await loadConfig();
      const agent = new HttpAgent({
        identity: identity ?? undefined,
        host: config.backend_host,
      });
      if (config.backend_host?.includes("localhost")) {
        await agent.fetchRootKey().catch(() => {});
      }
      const storageClient = new StorageClient(
        config.bucket_name,
        config.storage_gateway_url,
        config.backend_canister_id,
        config.project_id,
        agent,
      );
      const bytes = new Uint8Array(await file.arrayBuffer());
      const { hash } = await storageClient.putFile(bytes, onProgress);
      return storageClient.getDirectURL(hash);
    },
    [identity],
  );

  // ── Expression upload ──────────────────────────────────────────────────────

  const handleExpressionFileSelect = useCallback(
    async (file: File) => {
      if (file.type !== "image/png") {
        setUploadError("Only PNG files are accepted for expressions.");
        return;
      }
      setUploadError(null);
      setIsUploading(true);
      setUploadProgress(0);
      try {
        const assetUrl = await uploadToStorage(file, setUploadProgress);
        const defaultName = file.name.replace(/\.png$/i, "");
        setPendingUpload({ name: defaultName, assetUrl, type: "expression" });
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : "Upload failed");
      } finally {
        setIsUploading(false);
      }
    },
    [uploadToStorage],
  );

  const handleConfirmExpressionName = useCallback(
    async (name: string) => {
      if (!pendingUpload) return;
      setIsSavingName(true);
      try {
        const actor = await getActor();
        const ok = await actor.uploadMascotExpression(
          name,
          pendingUpload.assetUrl,
        );
        if (!ok) {
          toast.error("Failed to register expression — check admin access.");
          return;
        }
        setPendingUpload(null);
        toast.success(`Expression "${name}" added.`);
        await loadAssets();
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to save expression",
        );
      } finally {
        setIsSavingName(false);
      }
    },
    [pendingUpload, getActor, loadAssets],
  );

  // ── Animation upload ───────────────────────────────────────────────────────

  const handleAnimationFileSelect = useCallback(
    async (file: File) => {
      const isJson =
        file.type === "application/json" ||
        file.name.toLowerCase().endsWith(".json");
      if (!isJson) {
        setUploadError("Only Lottie JSON files are accepted for animations.");
        return;
      }
      setUploadError(null);
      setIsUploading(true);
      setUploadProgress(0);
      try {
        const assetUrl = await uploadToStorage(file, setUploadProgress);
        const defaultName = file.name.replace(/\.json$/i, "");
        setPendingUpload({ name: defaultName, assetUrl, type: "animation" });
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : "Upload failed");
      } finally {
        setIsUploading(false);
      }
    },
    [uploadToStorage],
  );

  const handleConfirmAnimationName = useCallback(
    async (name: string) => {
      if (!pendingUpload) return;
      setIsSavingName(true);
      try {
        const actor = await getActor();
        const ok = await actor.uploadMascotAnimation(
          name,
          pendingUpload.assetUrl,
        );
        if (!ok) {
          toast.error("Failed to register animation — check admin access.");
          return;
        }
        setPendingUpload(null);
        toast.success(`Animation "${name}" added.`);
        await loadAssets();
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to save animation",
        );
      } finally {
        setIsSavingName(false);
      }
    },
    [pendingUpload, getActor, loadAssets],
  );

  // ── Set default expression ─────────────────────────────────────────────────

  const handleSetDefaultExpression = useCallback(
    async (name: string) => {
      try {
        const actor = await getActor();
        const ok = await actor.setDefaultExpression(name);
        if (!ok) {
          toast.error("Failed to set default expression — check admin access.");
          return;
        }
        setAssets((prev) => ({ ...prev, defaultExpressionName: name }));
        toast.success(`"${name}" is now the default expression.`);
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to set default",
        );
      }
    },
    [getActor],
  );

  // ── Delete expression ──────────────────────────────────────────────────────

  const handleDeleteExpression = useCallback(
    (name: string) => {
      setConfirmState({
        message: `Delete expression "${name}"? This cannot be undone.`,
        onConfirm: async () => {
          setConfirmState(null);
          try {
            const actor = await getActor();
            const ok = await actor.deleteMascotExpression(name);
            if (!ok) {
              toast.error("Failed to delete expression — check admin access.");
              return;
            }
            setAssets((prev) => ({
              ...prev,
              expressions: prev.expressions.filter(([n]) => n !== name),
              defaultExpressionName:
                prev.defaultExpressionName === name
                  ? undefined
                  : prev.defaultExpressionName,
            }));
            toast.success(`Expression "${name}" deleted.`);
          } catch (err) {
            toast.error(
              err instanceof Error ? err.message : "Failed to delete",
            );
          }
        },
      });
    },
    [getActor],
  );

  // ── Set default idle animation ─────────────────────────────────────────────

  const handleSetDefaultIdle = useCallback(
    async (name: string) => {
      try {
        const actor = await getActor();
        const ok = await actor.setDefaultIdleAnimation(name);
        if (!ok) {
          toast.error("Failed to set default idle — check admin access.");
          return;
        }
        setAssets((prev) => ({ ...prev, defaultIdleAnimationName: name }));
        toast.success(`"${name}" is now the default idle animation.`);
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to set default idle",
        );
      }
    },
    [getActor],
  );

  // ── Delete animation ───────────────────────────────────────────────────────

  const handleDeleteAnimation = useCallback(
    (name: string) => {
      setConfirmState({
        message: `Delete animation "${name}"? This cannot be undone.`,
        onConfirm: async () => {
          setConfirmState(null);
          try {
            const actor = await getActor();
            const ok = await actor.deleteMascotAnimation(name);
            if (!ok) {
              toast.error("Failed to delete animation — check admin access.");
              return;
            }
            setAssets((prev) => ({
              ...prev,
              animations: prev.animations.filter(([n]) => n !== name),
              defaultIdleAnimationName:
                prev.defaultIdleAnimationName === name
                  ? undefined
                  : prev.defaultIdleAnimationName,
            }));
            toast.success(`Animation "${name}" deleted.`);
          } catch (err) {
            toast.error(
              err instanceof Error ? err.message : "Failed to delete",
            );
          }
        },
      });
    },
    [getActor],
  );

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      data-ocid="mascot_manager.panel"
      className="flex flex-col gap-6 h-full overflow-y-auto"
      style={{ color: "oklch(var(--text))" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-4 shrink-0">
        <div>
          <h2
            className="text-base font-semibold"
            style={{ color: "oklch(var(--text))" }}
          >
            Mascot Assets
          </h2>
          <p
            className="text-xs mt-0.5"
            style={{ color: "oklch(var(--muted-text))" }}
          >
            Manage expression images and Lottie animations for the mascot
            character
          </p>
        </div>
      </div>

      {/* Global error */}
      {globalError && (
        <div
          data-ocid="mascot_manager.error_state"
          className="flex items-center gap-2 px-4 py-3 rounded-lg text-sm"
          style={{
            backgroundColor: "oklch(0.45 0.18 25 / 0.15)",
            border: "1px solid oklch(0.45 0.18 25 / 0.4)",
            color: "oklch(0.75 0.2 25)",
          }}
        >
          <AlertCircle size={14} />
          {globalError}
          <button
            type="button"
            onClick={() => setGlobalError(null)}
            className="ml-auto transition-opacity hover:opacity-70"
            aria-label="Dismiss error"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div
          data-ocid="mascot_manager.loading_state"
          className="flex items-center justify-center py-16"
        >
          <Loader2
            size={24}
            className="animate-spin"
            style={{ color: "oklch(var(--muted-text))" }}
          />
        </div>
      )}

      {!isLoading && (
        <>
          {/* Tab switcher */}
          <div
            className="flex gap-1 p-1 rounded-xl shrink-0"
            style={{ backgroundColor: "oklch(var(--sidebar-left))" }}
          >
            {(["expressions", "animations"] as MascotTab[]).map((tab) => (
              <button
                key={tab}
                type="button"
                data-ocid={`mascot_manager.tab.${tab}`}
                onClick={() => setActiveTab(tab)}
                className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all"
                style={{
                  backgroundColor:
                    activeTab === tab ? "oklch(var(--toolbar))" : "transparent",
                  color:
                    activeTab === tab
                      ? "oklch(var(--text))"
                      : "oklch(var(--muted-text))",
                  boxShadow:
                    activeTab === tab ? "0 1px 4px rgba(0,0,0,0.25)" : "none",
                }}
              >
                {tab === "expressions" ? (
                  <SmilePlus size={14} />
                ) : (
                  <Film size={14} />
                )}
                {tab === "expressions" ? "Expressions" : "Animations"}
              </button>
            ))}
          </div>

          {/* ── Expressions Tab ───────────────────────────────────────────── */}
          {activeTab === "expressions" && (
            <div className="flex flex-col gap-4">
              {/* Subsection header */}
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h3
                    className="text-sm font-semibold"
                    style={{ color: "oklch(var(--text))" }}
                  >
                    Expression Images
                  </h3>
                  <p
                    className="text-xs mt-0.5"
                    style={{ color: "oklch(var(--muted-text))" }}
                  >
                    PNG images for each mascot facial expression
                  </p>
                </div>
                <input
                  ref={exprFileRef}
                  type="file"
                  accept="image/png"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleExpressionFileSelect(file);
                    e.target.value = "";
                  }}
                />
                <button
                  type="button"
                  data-ocid="mascot_manager.upload_expression_button"
                  onClick={() => exprFileRef.current?.click()}
                  disabled={isUploading}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium shrink-0 transition-opacity hover:opacity-80 disabled:opacity-50"
                  style={{
                    backgroundColor: "oklch(var(--accent))",
                    color: "oklch(var(--accent-text))",
                  }}
                >
                  <ImagePlus size={14} />
                  Upload Expression (PNG)
                </button>
              </div>

              {/* Upload progress */}
              {isUploading && (
                <UploadProgress
                  name="Uploading…"
                  progress={uploadProgress}
                  error={null}
                  done={false}
                />
              )}
              {uploadError && activeTab === "expressions" && (
                <div
                  data-ocid="mascot_expression.error_state"
                  className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs"
                  style={{
                    backgroundColor: "oklch(0.45 0.18 25 / 0.15)",
                    border: "1px solid oklch(0.45 0.18 25 / 0.4)",
                    color: "oklch(0.75 0.2 25)",
                  }}
                >
                  <AlertCircle size={12} />
                  {uploadError}
                  <button
                    type="button"
                    onClick={() => setUploadError(null)}
                    className="ml-auto"
                    aria-label="Dismiss"
                  >
                    <X size={12} />
                  </button>
                </div>
              )}

              {/* Expression grid */}
              {assets.expressions.length === 0 ? (
                <div
                  data-ocid="mascot_expression.empty_state"
                  className="flex flex-col items-center gap-3 py-16 rounded-xl"
                  style={{ border: "1px dashed oklch(var(--outline))" }}
                >
                  <SmilePlus
                    size={28}
                    style={{ color: "oklch(var(--muted-text))" }}
                  />
                  <p
                    className="text-sm text-center"
                    style={{ color: "oklch(var(--muted-text))" }}
                  >
                    No expressions uploaded yet.
                    <br />
                    Upload PNG files to add mascot expressions.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {assets.expressions.map(([name, assetUrl], idx) => (
                    <ExpressionCard
                      key={name}
                      name={name}
                      assetUrl={assetUrl}
                      isDefault={assets.defaultExpressionName === name}
                      onSetDefault={() => void handleSetDefaultExpression(name)}
                      onDelete={() => handleDeleteExpression(name)}
                      index={idx + 1}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Animations Tab ────────────────────────────────────────────── */}
          {activeTab === "animations" && (
            <div className="flex flex-col gap-4">
              {/* Subsection header */}
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h3
                    className="text-sm font-semibold"
                    style={{ color: "oklch(var(--text))" }}
                  >
                    Lottie Animations
                  </h3>
                  <p
                    className="text-xs mt-0.5"
                    style={{ color: "oklch(var(--muted-text))" }}
                  >
                    Lottie JSON animations played over the mascot character
                  </p>
                </div>
                <input
                  ref={animFileRef}
                  type="file"
                  accept=".json,application/json"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleAnimationFileSelect(file);
                    e.target.value = "";
                  }}
                />
                <button
                  type="button"
                  data-ocid="mascot_manager.upload_animation_button"
                  onClick={() => animFileRef.current?.click()}
                  disabled={isUploading}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium shrink-0 transition-opacity hover:opacity-80 disabled:opacity-50"
                  style={{
                    backgroundColor: "oklch(var(--accent))",
                    color: "oklch(var(--accent-text))",
                  }}
                >
                  <Film size={14} />
                  Upload Animation (JSON)
                </button>
              </div>

              {/* Upload progress */}
              {isUploading && (
                <UploadProgress
                  name="Uploading…"
                  progress={uploadProgress}
                  error={null}
                  done={false}
                />
              )}
              {uploadError && activeTab === "animations" && (
                <div
                  data-ocid="mascot_animation.error_state"
                  className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs"
                  style={{
                    backgroundColor: "oklch(0.45 0.18 25 / 0.15)",
                    border: "1px solid oklch(0.45 0.18 25 / 0.4)",
                    color: "oklch(0.75 0.2 25)",
                  }}
                >
                  <AlertCircle size={12} />
                  {uploadError}
                  <button
                    type="button"
                    onClick={() => setUploadError(null)}
                    className="ml-auto"
                    aria-label="Dismiss"
                  >
                    <X size={12} />
                  </button>
                </div>
              )}

              {/* Animation grid */}
              {assets.animations.length === 0 ? (
                <div
                  data-ocid="mascot_animation.empty_state"
                  className="flex flex-col items-center gap-3 py-16 rounded-xl"
                  style={{ border: "1px dashed oklch(var(--outline))" }}
                >
                  <Film
                    size={28}
                    style={{ color: "oklch(var(--muted-text))" }}
                  />
                  <p
                    className="text-sm text-center"
                    style={{ color: "oklch(var(--muted-text))" }}
                  >
                    No animations uploaded yet.
                    <br />
                    Upload Lottie JSON files to add mascot animations.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {assets.animations.map(([name, assetUrl], idx) => (
                    <AnimationCard
                      key={name}
                      name={name}
                      assetUrl={assetUrl}
                      isDefault={assets.defaultIdleAnimationName === name}
                      onSetDefault={() => void handleSetDefaultIdle(name)}
                      onDelete={() => handleDeleteAnimation(name)}
                      index={idx + 1}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Overlays */}
      {confirmState && (
        <ConfirmDialog
          message={confirmState.message}
          onConfirm={confirmState.onConfirm}
          onCancel={() => setConfirmState(null)}
        />
      )}

      {pendingUpload && (
        <NameDialog
          title={
            pendingUpload.type === "expression"
              ? "Name this expression"
              : "Name this animation"
          }
          initialName={pendingUpload.name}
          onConfirm={
            pendingUpload.type === "expression"
              ? (name) => void handleConfirmExpressionName(name)
              : (name) => void handleConfirmAnimationName(name)
          }
          onCancel={() => setPendingUpload(null)}
          isSaving={isSavingName}
        />
      )}
    </div>
  );
}
