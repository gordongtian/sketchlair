/**
 * ImageSetManager — admin UI for managing figure drawing image sets.
 */

import type { ImageReference, ImageSet, backendInterface } from "@/backend.d";
import { createActorWithConfig, loadConfig } from "@/config";
import type { paymentsInterface } from "@/payments.d";
import { createPaymentsActor } from "@/paymentsConfig";
import { StorageClient } from "@/utils/StorageClient";
import { HttpAgent, type Identity } from "@icp-sdk/core/agent";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  DollarSign,
  ImagePlus,
  KeyRound,
  Loader2,
  Lock,
  Pencil,
  Plus,
  Star,
  Tag,
  Trash2,
  X,
  ZoomIn,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

interface ImageSetManagerProps {
  identity: Identity;
}

interface UploadingFile {
  name: string;
  progress: number;
  error: string | null;
  done: boolean;
}

interface NewSetForm {
  name: string;
  isFree: boolean;
  isDefault: boolean;
  price: string;
  error: string | null;
}

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB

// ── Lightbox ─────────────────────────────────────────────────────────────────

function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <dialog
      data-ocid="lightbox.dialog"
      open
      aria-label="Image preview"
      className="fixed inset-0 z-[9999] flex items-center justify-center w-full h-full max-w-full max-h-full m-0 p-0"
      style={{ background: "rgba(0,0,0,0.88)" }}
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <button
        type="button"
        data-ocid="lightbox.close_button"
        className="absolute top-4 right-4 p-2 rounded-lg transition-opacity hover:opacity-70"
        style={{ color: "#fff" }}
        aria-label="Close lightbox"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        <X size={22} />
      </button>
      <img
        src={src}
        alt="Full size preview"
        className="max-w-[90vw] max-h-[90vh] rounded-lg object-contain cursor-default"
        style={{ boxShadow: "0 8px 48px rgba(0,0,0,0.6)" }}
      />
    </dialog>
  );
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
      data-ocid="confirm.dialog"
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
            data-ocid="confirm.cancel_button"
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
            data-ocid="confirm.confirm_button"
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

// ── New Set Dialog ────────────────────────────────────────────────────────────

function NewSetDialog({
  form,
  onChange,
  onConfirm,
  onCancel,
  isCreating,
}: {
  form: NewSetForm;
  onChange: (f: NewSetForm) => void;
  onConfirm: () => void;
  onCancel: () => void;
  isCreating: boolean;
}) {
  return (
    <dialog
      data-ocid="new_set.dialog"
      open
      aria-label="Create new image set"
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
          New Image Set
        </h3>

        {/* Name */}
        <div className="flex flex-col gap-1">
          <label
            htmlFor="new-set-name"
            className="text-xs"
            style={{ color: "oklch(var(--muted-text))" }}
          >
            Set name (3–50 characters)
          </label>
          <input
            id="new-set-name"
            data-ocid="new_set.input"
            type="text"
            value={form.name}
            maxLength={50}
            onChange={(e) =>
              onChange({ ...form, name: e.target.value, error: null })
            }
            className="px-3 py-2 rounded-lg text-sm"
            style={{
              backgroundColor: "oklch(var(--sidebar-left))",
              border: `1px solid ${form.error ? "oklch(0.55 0.22 25)" : "oklch(var(--outline))"}`,
              color: "oklch(var(--text))",
              outline: "none",
            }}
            placeholder="e.g. Advanced Poses"
          />
          {form.error && (
            <p
              data-ocid="new_set.error_state"
              className="text-xs"
              style={{ color: "oklch(0.65 0.2 25)" }}
            >
              {form.error}
            </p>
          )}
        </div>

        {/* Free / Paid toggle */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            data-ocid="new_set.toggle"
            onClick={() =>
              onChange({
                ...form,
                isFree: !form.isFree,
                price: "",
                error: null,
              })
            }
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-opacity hover:opacity-80"
            style={{
              backgroundColor: form.isFree
                ? "oklch(var(--accent) / 0.15)"
                : "oklch(var(--sidebar-left))",
              border: `1px solid ${form.isFree ? "oklch(var(--accent) / 0.4)" : "oklch(var(--outline))"}`,
              color: form.isFree
                ? "oklch(var(--accent))"
                : "oklch(var(--muted-text))",
            }}
          >
            {form.isFree ? "Free" : "Paid"}
          </button>
          <span
            className="text-xs"
            style={{ color: "oklch(var(--muted-text))" }}
          >
            {form.isFree
              ? "Available to all users"
              : "Requires marketplace purchase"}
          </span>
        </div>

        {/* Price input — only shown when Paid */}
        {!form.isFree && (
          <div className="flex flex-col gap-1">
            <label
              htmlFor="new-set-price"
              className="text-xs"
              style={{ color: "oklch(var(--muted-text))" }}
            >
              Price (USD)
            </label>
            <div className="relative">
              <span
                className="absolute left-3 top-1/2 -translate-y-1/2 text-sm"
                style={{ color: "oklch(var(--muted-text))" }}
              >
                $
              </span>
              <input
                id="new-set-price"
                data-ocid="new_set.price_input"
                type="number"
                step="0.01"
                min="0"
                value={form.price}
                onChange={(e) =>
                  onChange({ ...form, price: e.target.value, error: null })
                }
                className="pl-7 pr-3 py-2 rounded-lg text-sm w-full"
                style={{
                  backgroundColor: "oklch(var(--sidebar-left))",
                  border: "1px solid oklch(var(--outline))",
                  color: "oklch(var(--text))",
                  outline: "none",
                }}
                placeholder="4.99"
              />
            </div>
          </div>
        )}

        {/* Mark as default checkbox */}
        <label
          className="flex items-center gap-2.5 cursor-pointer select-none"
          data-ocid="new_set.default_checkbox"
        >
          <input
            type="checkbox"
            checked={form.isDefault}
            onChange={(e) => onChange({ ...form, isDefault: e.target.checked })}
            className="w-4 h-4 rounded"
            style={{ accentColor: "oklch(var(--accent))" }}
          />
          <span className="text-xs" style={{ color: "oklch(var(--text))" }}>
            Mark as default set
          </span>
        </label>

        <div className="flex gap-3 justify-end">
          <button
            type="button"
            data-ocid="new_set.cancel_button"
            onClick={onCancel}
            disabled={isCreating}
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
            data-ocid="new_set.confirm_button"
            onClick={onConfirm}
            disabled={isCreating}
            className="px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-opacity hover:opacity-80"
            style={{
              backgroundColor: "oklch(var(--accent))",
              color: "oklch(var(--accent-text))",
            }}
          >
            {isCreating && <Loader2 size={14} className="animate-spin" />}
            Create
          </button>
        </div>
      </div>
    </dialog>
  );
}

// ── Stripe Secret Modal ───────────────────────────────────────────────────────

function StripeSecretModal({
  title,
  placeholder,
  isSaving,
  onSave,
  onCancel,
}: {
  title: string;
  placeholder: string;
  isSaving: boolean;
  onSave: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <dialog
      data-ocid="stripe_secret.dialog"
      open
      aria-label={title}
      className="fixed inset-0 z-[9998] flex items-center justify-center w-full h-full max-w-full max-h-full m-0 p-0"
      style={{ background: "rgba(0,0,0,0.75)" }}
    >
      <div
        className="rounded-xl p-6 max-w-sm w-full mx-4 flex flex-col gap-4"
        style={{
          backgroundColor: "oklch(var(--toolbar))",
          border: "1px solid oklch(var(--outline))",
        }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
            style={{ backgroundColor: "oklch(var(--accent) / 0.15)" }}
          >
            <KeyRound size={13} style={{ color: "oklch(var(--accent))" }} />
          </div>
          <h3
            className="text-sm font-semibold"
            style={{ color: "oklch(var(--text))" }}
          >
            {title}
          </h3>
        </div>

        <p
          className="text-xs leading-relaxed"
          style={{ color: "oklch(var(--muted-text))" }}
        >
          This key is <strong>write-only</strong> and cannot be viewed after
          saving. Make sure you have it copied from your Stripe dashboard before
          proceeding.
        </p>

        <input
          data-ocid="stripe_secret.input"
          type="password"
          autoComplete="off"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && value.trim()) onSave(value.trim());
          }}
          className="px-3 py-2 rounded-lg text-sm font-mono"
          style={{
            backgroundColor: "oklch(var(--sidebar-left))",
            border: "1px solid oklch(var(--outline))",
            color: "oklch(var(--text))",
            outline: "none",
          }}
          placeholder={placeholder}
          // biome-ignore lint/a11y/noAutofocus: intentional for modal UX
          autoFocus
        />

        <div className="flex gap-3 justify-end">
          <button
            type="button"
            data-ocid="stripe_secret.cancel_button"
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
            data-ocid="stripe_secret.save_button"
            onClick={() => value.trim() && onSave(value.trim())}
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

// ── ImageSetCard ──────────────────────────────────────────────────────────────

interface SetCardProps {
  set: ImageSet;
  onUpload: (setId: string, files: FileList) => void;
  onRemoveImage: (setId: string, imageId: string) => void;
  onDeleteSet: (setId: string) => void;
  onSetDefault: (setId: string) => void;
  onOpenLightbox: (url: string) => void;
  uploading: UploadingFile[];
  priceUsdCents?: bigint;
  onSavePrice: (packId: string, cents: bigint) => Promise<void>;
  onSaveTags: (setId: string, tags: string[]) => Promise<void>;
  onRenameSet: (setId: string, newName: string) => Promise<void>;
}

function ImageSetCard({
  set,
  onUpload,
  onRemoveImage,
  onDeleteSet,
  onSetDefault,
  onOpenLightbox,
  uploading,
  priceUsdCents,
  onSavePrice,
  onSaveTags,
  onRenameSet,
}: SetCardProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Collapse state ─────────────────────────────────────────────────────────
  const [collapsed, setCollapsed] = useState(false);

  // ── Rename state ───────────────────────────────────────────────────────────
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameVal, setRenameVal] = useState(set.name);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [isSavingName, setIsSavingName] = useState(false);
  const [localName, setLocalName] = useState(set.name);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const handleStartRename = () => {
    setRenameVal(localName);
    setRenameError(null);
    setIsRenaming(true);
    setTimeout(() => renameInputRef.current?.select(), 0);
  };

  const handleCommitRename = async () => {
    const trimmed = renameVal.trim();
    if (!trimmed) {
      setRenameVal(localName);
      setRenameError("Name cannot be empty");
      return;
    }
    if (trimmed === localName) {
      setIsRenaming(false);
      setRenameError(null);
      return;
    }
    setIsSavingName(true);
    setRenameError(null);
    try {
      await onRenameSet(set.id, trimmed);
      setLocalName(trimmed);
      setIsRenaming(false);
    } catch {
      setRenameError("Failed to rename — try again");
    } finally {
      setIsSavingName(false);
    }
  };

  const handleCancelRename = () => {
    setRenameVal(localName);
    setRenameError(null);
    setIsRenaming(false);
  };

  // ── Tag state ──────────────────────────────────────────────────────────────
  const [localTags, setLocalTags] = useState<string[]>(set.tags ?? []);
  const [addingTag, setAddingTag] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [isSavingTags, setIsSavingTags] = useState(false);
  const [tagSaveStatus, setTagSaveStatus] = useState<
    "success" | "error" | null
  >(null);
  const tagInputRef = useRef<HTMLInputElement>(null);

  const saveTags = async (nextTags: string[]) => {
    setIsSavingTags(true);
    setTagSaveStatus(null);
    try {
      await onSaveTags(set.id, nextTags);
      setTagSaveStatus("success");
    } catch {
      setTagSaveStatus("error");
    } finally {
      setIsSavingTags(false);
      setTimeout(() => setTagSaveStatus(null), 2500);
    }
  };

  const handleAddTag = async () => {
    const normalized = tagInput.trim().toLowerCase();
    if (!normalized) {
      setAddingTag(false);
      setTagInput("");
      return;
    }
    if (localTags.includes(normalized)) {
      setAddingTag(false);
      setTagInput("");
      return;
    }
    const nextTags = [...localTags, normalized];
    setLocalTags(nextTags);
    setAddingTag(false);
    setTagInput("");
    await saveTags(nextTags);
  };

  const handleRemoveTag = async (tag: string) => {
    const nextTags = localTags.filter((t) => t !== tag);
    setLocalTags(nextTags);
    await saveTags(nextTags);
  };

  // ── Inline price state ─────────────────────────────────────────────────────
  const isDefaultFree = set.isDefault || set.isFree;
  const [editingPrice, setEditingPrice] = useState(false);
  const [priceInputVal, setPriceInputVal] = useState("");
  const [isSavingPrice, setIsSavingPrice] = useState(false);
  const [priceError, setPriceError] = useState<string | null>(null);

  const handleStartEditPrice = () => {
    const current =
      priceUsdCents !== undefined
        ? (Number(priceUsdCents) / 100).toFixed(2)
        : "";
    setPriceInputVal(current);
    setPriceError(null);
    setEditingPrice(true);
  };

  const handleSavePrice = async () => {
    const num = Number.parseFloat(priceInputVal.trim());
    if (Number.isNaN(num) || num < 0) {
      setPriceError("Enter a valid price");
      return;
    }
    const cents = BigInt(Math.round(num * 100));
    setIsSavingPrice(true);
    setPriceError(null);
    try {
      await onSavePrice(set.id, cents);
      setEditingPrice(false);
    } catch {
      setPriceError("Failed to save price");
    } finally {
      setIsSavingPrice(false);
    }
  };

  return (
    <div
      data-ocid="image_set.card"
      className="rounded-xl flex flex-col"
      style={{
        backgroundColor: "oklch(var(--sidebar-left) / 0.6)",
        border: "1px solid oklch(var(--outline))",
      }}
    >
      {/* ── Header row ───────────────────────────────────────────────────────── */}
      <div className="flex items-start gap-2 px-4 py-3 flex-wrap">
        {/* Chevron toggle */}
        <button
          type="button"
          data-ocid="image_set.toggle"
          onClick={() => setCollapsed((v) => !v)}
          className="mt-0.5 shrink-0 transition-opacity hover:opacity-70"
          aria-label={collapsed ? "Expand set" : "Collapse set"}
          style={{ color: "oklch(var(--muted-text))" }}
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
        </button>

        {/* Name — editable inline */}
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          {isRenaming ? (
            <div className="flex items-center gap-1.5 flex-1 min-w-0">
              <input
                ref={renameInputRef}
                data-ocid="image_set.rename_input"
                type="text"
                value={renameVal}
                maxLength={50}
                onChange={(e) => {
                  setRenameVal(e.target.value);
                  setRenameError(null);
                }}
                onBlur={() => void handleCommitRename()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleCommitRename();
                  if (e.key === "Escape") handleCancelRename();
                }}
                className="px-2 py-0.5 rounded-md text-sm font-semibold min-w-0 flex-1"
                style={{
                  backgroundColor: "oklch(var(--sidebar-left))",
                  border: `1px solid ${renameError ? "oklch(0.55 0.22 25)" : "oklch(var(--accent) / 0.5)"}`,
                  color: "oklch(var(--text))",
                  outline: "none",
                }}
                // biome-ignore lint/a11y/noAutofocus: intentional for inline editing
                autoFocus
              />
              {isSavingName && (
                <Loader2
                  size={12}
                  className="animate-spin shrink-0"
                  style={{ color: "oklch(var(--muted-text))" }}
                />
              )}
            </div>
          ) : (
            <button
              type="button"
              data-ocid="image_set.rename_button"
              onClick={handleStartRename}
              className="flex items-center gap-1.5 group text-left min-w-0"
              aria-label="Click to rename"
            >
              <h3
                className="text-sm font-semibold truncate"
                style={{ color: "oklch(var(--text))" }}
              >
                {localName}
              </h3>
              <Pencil
                size={11}
                className="shrink-0 opacity-0 group-hover:opacity-60 transition-opacity"
                style={{ color: "oklch(var(--muted-text))" }}
              />
            </button>
          )}
          {renameError && !isRenaming && (
            <span className="text-xs" style={{ color: "oklch(0.65 0.2 25)" }}>
              {renameError}
            </span>
          )}
        </div>

        {/* Tags + tag status */}
        <div className="flex items-center gap-1.5 flex-wrap shrink-0">
          {localTags.map((tag) => (
            <span
              key={tag}
              className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
              style={{
                backgroundColor: "oklch(var(--accent) / 0.12)",
                color: "oklch(var(--accent))",
                border: "1px solid oklch(var(--accent) / 0.25)",
              }}
            >
              {tag}
              <button
                type="button"
                onClick={() => void handleRemoveTag(tag)}
                aria-label={`Remove tag ${tag}`}
                className="transition-opacity hover:opacity-70 ml-0.5"
                disabled={isSavingTags}
              >
                <X size={9} />
              </button>
            </span>
          ))}

          {/* Add tag inline */}
          {addingTag ? (
            <div className="flex items-center gap-1">
              <input
                ref={tagInputRef}
                data-ocid="image_set.tag_input"
                type="text"
                value={tagInput}
                maxLength={32}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleAddTag();
                  if (e.key === "Escape") {
                    setAddingTag(false);
                    setTagInput("");
                  }
                }}
                onBlur={() => void handleAddTag()}
                placeholder="tag name"
                className="px-2 py-0.5 rounded-md text-xs w-24"
                style={{
                  backgroundColor: "oklch(var(--sidebar-left))",
                  border: "1px solid oklch(var(--accent) / 0.5)",
                  color: "oklch(var(--text))",
                  outline: "none",
                }}
                // biome-ignore lint/a11y/noAutofocus: intentional for inline tag entry
                autoFocus
              />
              <button
                type="button"
                data-ocid="image_set.tag_add_button"
                onClick={() => void handleAddTag()}
                className="px-2 py-0.5 rounded-md text-xs font-medium transition-opacity hover:opacity-80"
                style={{
                  backgroundColor: "oklch(var(--accent))",
                  color: "oklch(var(--accent-text))",
                }}
              >
                Add
              </button>
            </div>
          ) : (
            <button
              type="button"
              data-ocid="image_set.add_tag_button"
              onClick={() => {
                setTagInput("");
                setAddingTag(true);
                setTimeout(() => tagInputRef.current?.focus(), 0);
              }}
              className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full transition-opacity hover:opacity-80"
              style={{
                backgroundColor: "oklch(var(--sidebar-left))",
                color: "oklch(var(--muted-text))",
                border: "1px solid oklch(var(--outline))",
              }}
            >
              <Tag size={9} />
              Add Tag
            </button>
          )}

          {/* Tag save status indicator */}
          {isSavingTags && (
            <Loader2
              size={11}
              className="animate-spin"
              style={{ color: "oklch(var(--muted-text))" }}
            />
          )}
          {tagSaveStatus === "success" && (
            <CheckCircle2 size={11} style={{ color: "oklch(0.65 0.15 140)" }} />
          )}
          {tagSaveStatus === "error" && (
            <AlertCircle size={11} style={{ color: "oklch(0.65 0.2 25)" }} />
          )}
        </div>

        {/* Badges: Default, Free/Paid */}
        <div className="flex items-center gap-2 shrink-0">
          {set.isDefault && (
            <span
              className="text-xs px-2 py-0.5 rounded-full flex items-center gap-1"
              style={{
                backgroundColor: "oklch(var(--accent) / 0.15)",
                color: "oklch(var(--accent))",
                border: "1px solid oklch(var(--accent) / 0.3)",
              }}
            >
              <Star size={10} />
              Default
            </span>
          )}
          <span
            className="text-xs px-2 py-0.5 rounded-full"
            style={{
              backgroundColor: set.isFree
                ? "oklch(0.55 0.15 140 / 0.15)"
                : "oklch(0.6 0.15 60 / 0.15)",
              color: set.isFree ? "oklch(0.65 0.15 140)" : "oklch(0.7 0.15 60)",
              border: set.isFree
                ? "1px solid oklch(0.55 0.15 140 / 0.3)"
                : "1px solid oklch(0.6 0.15 60 / 0.3)",
            }}
          >
            {set.isFree ? "Free" : "Paid"}
          </span>
        </div>

        {/* Image count */}
        <span
          className="text-xs shrink-0 mt-0.5"
          style={{ color: "oklch(var(--muted-text))" }}
        >
          {Number(set.imageCount)} image
          {Number(set.imageCount) !== 1 ? "s" : ""}
        </span>

        {/* ── Inline price UI ──────────────────────────────────────────────── */}
        {!isDefaultFree && (
          <div className="flex items-center gap-1.5 shrink-0">
            {editingPrice ? (
              <>
                <div className="relative">
                  <span
                    className="absolute left-2 top-1/2 -translate-y-1/2 text-xs"
                    style={{ color: "oklch(var(--muted-text))" }}
                  >
                    $
                  </span>
                  <input
                    data-ocid="image_set.price_input"
                    type="number"
                    step="0.01"
                    min="0"
                    value={priceInputVal}
                    onChange={(e) => {
                      setPriceInputVal(e.target.value);
                      setPriceError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void handleSavePrice();
                      if (e.key === "Escape") {
                        setEditingPrice(false);
                        setPriceError(null);
                      }
                    }}
                    onBlur={() => void handleSavePrice()}
                    className="pl-5 pr-2 py-0.5 rounded-md text-xs w-20"
                    style={{
                      backgroundColor: "oklch(var(--sidebar-left))",
                      border: `1px solid ${priceError ? "oklch(0.55 0.22 25)" : "oklch(var(--accent) / 0.5)"}`,
                      color: "oklch(var(--text))",
                      outline: "none",
                    }}
                    placeholder="4.99"
                    // biome-ignore lint/a11y/noAutofocus: intentional for inline price editing
                    autoFocus
                  />
                </div>
                <button
                  type="button"
                  data-ocid="image_set.price_save_button"
                  onClick={() => void handleSavePrice()}
                  disabled={isSavingPrice}
                  className="px-2 py-0.5 rounded-md text-xs font-medium flex items-center gap-1 transition-opacity hover:opacity-80 disabled:opacity-50"
                  style={{
                    backgroundColor: "oklch(var(--accent))",
                    color: "oklch(var(--accent-text))",
                  }}
                >
                  {isSavingPrice ? (
                    <Loader2 size={10} className="animate-spin" />
                  ) : (
                    "Save"
                  )}
                </button>
                <button
                  type="button"
                  data-ocid="image_set.price_cancel_button"
                  onClick={() => {
                    setEditingPrice(false);
                    setPriceError(null);
                  }}
                  className="px-2 py-0.5 rounded-md text-xs transition-opacity hover:opacity-80"
                  style={{
                    backgroundColor: "oklch(var(--sidebar-left))",
                    color: "oklch(var(--muted-text))",
                    border: "1px solid oklch(var(--outline))",
                  }}
                >
                  ✕
                </button>
                {priceError && (
                  <span
                    className="text-xs"
                    style={{ color: "oklch(0.65 0.2 25)" }}
                  >
                    {priceError}
                  </span>
                )}
              </>
            ) : (
              <>
                <span
                  className="text-xs font-medium"
                  style={{
                    color:
                      priceUsdCents !== undefined
                        ? "oklch(0.7 0.15 60)"
                        : "oklch(var(--muted-text))",
                  }}
                >
                  {priceUsdCents !== undefined
                    ? `$${(Number(priceUsdCents) / 100).toFixed(2)}`
                    : "Not set"}
                </span>
                <button
                  type="button"
                  data-ocid="image_set.edit_price_button"
                  onClick={handleStartEditPrice}
                  className="flex items-center gap-1 px-2 py-0.5 rounded-md text-xs transition-opacity hover:opacity-80"
                  style={{
                    backgroundColor: "oklch(var(--sidebar-left))",
                    color: "oklch(var(--muted-text))",
                    border: "1px solid oklch(var(--outline))",
                  }}
                >
                  <DollarSign size={10} />
                  Edit Price
                </button>
              </>
            )}
          </div>
        )}
        {isDefaultFree && (
          <div className="flex items-center gap-1 shrink-0">
            <span
              className="text-xs px-2 py-0.5 rounded-full"
              style={{
                backgroundColor: "oklch(0.55 0.15 140 / 0.12)",
                color: "oklch(0.65 0.15 140)",
                border: "1px solid oklch(0.55 0.15 140 / 0.25)",
              }}
            >
              Free
            </span>
            <Lock size={11} style={{ color: "oklch(var(--muted-text))" }} />
          </div>
        )}

        {/* ── Action buttons ───────────────────────────────────────────────── */}
        <div className="flex items-center gap-2 shrink-0 ml-auto">
          <input
            ref={fileInputRef}
            type="file"
            accept=".jpg,.jpeg,.png"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                onUpload(set.id, e.target.files);
              }
              e.target.value = "";
            }}
          />
          <button
            type="button"
            data-ocid="image_set.upload_button"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-opacity hover:opacity-80"
            style={{
              backgroundColor: "oklch(var(--accent))",
              color: "oklch(var(--accent-text))",
            }}
          >
            <ImagePlus size={12} />
            Upload
          </button>

          {!set.isDefault && (
            <button
              type="button"
              data-ocid="image_set.set_default_button"
              onClick={() => onSetDefault(set.id)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs transition-opacity hover:opacity-80"
              style={{
                backgroundColor: "oklch(var(--sidebar-left))",
                color: "oklch(var(--accent))",
                border: "1px solid oklch(var(--accent) / 0.35)",
              }}
            >
              <Star size={11} />
              Set Default
            </button>
          )}

          {!set.isDefault && (
            <button
              type="button"
              data-ocid="image_set.delete_button"
              onClick={() => onDeleteSet(set.id)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs transition-opacity hover:opacity-80"
              style={{
                backgroundColor: "oklch(var(--sidebar-left))",
                color: "oklch(0.65 0.2 25)",
                border: "1px solid oklch(0.45 0.2 25 / 0.4)",
              }}
            >
              <Trash2 size={12} />
              Delete
            </button>
          )}
        </div>
      </div>

      {/* ── Expanded body ─────────────────────────────────────────────────────── */}
      {!collapsed && (
        <div
          className="flex flex-col gap-4 px-5 pb-5"
          style={{ borderTop: "1px solid oklch(var(--outline) / 0.5)" }}
        >
          {/* Thumbnail grid */}
          {set.images.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-4">
              {set.images.map((img, idx) => (
                <div
                  key={img.id}
                  data-ocid={`image_set.item.${idx + 1}`}
                  className="relative group"
                >
                  <button
                    type="button"
                    onClick={() => onOpenLightbox(img.assetUrl)}
                    className="block w-16 h-16 rounded-lg overflow-hidden transition-opacity hover:opacity-80 relative"
                    aria-label={`View image ${idx + 1}`}
                  >
                    <img
                      src={img.assetUrl}
                      alt={`Pose ${idx + 1}`}
                      className="w-full h-full object-cover"
                    />
                    <div
                      className="absolute inset-0 rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      style={{ background: "rgba(0,0,0,0.35)" }}
                    >
                      <ZoomIn size={14} color="#fff" />
                    </div>
                  </button>
                  {/* Remove individual image */}
                  <button
                    type="button"
                    data-ocid={`image_set.delete_button.${idx + 1}`}
                    onClick={() => onRemoveImage(set.id, img.id)}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{
                      backgroundColor: "oklch(0.45 0.2 25)",
                      color: "#fff",
                    }}
                    aria-label="Remove image"
                  >
                    <X size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {set.images.length === 0 && uploading.length === 0 && (
            <div
              data-ocid="image_set.empty_state"
              className="mt-4 py-6 flex flex-col items-center gap-2 rounded-lg"
              style={{ border: "1px dashed oklch(var(--outline))" }}
            >
              <ImagePlus
                size={20}
                style={{ color: "oklch(var(--muted-text))" }}
              />
              <p
                className="text-xs"
                style={{ color: "oklch(var(--muted-text))" }}
              >
                No images yet — upload some below
              </p>
            </div>
          )}

          {/* Upload progress */}
          {uploading.length > 0 && (
            <div className="flex flex-col gap-2 mt-4">
              {uploading.map((f, i) => (
                <div
                  key={`upload-${f.name}-${i}`}
                  className="flex flex-col gap-1"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className="text-xs truncate min-w-0"
                      style={{ color: "oklch(var(--muted-text))" }}
                    >
                      {f.name}
                    </span>
                    {f.done && !f.error && (
                      <CheckCircle2
                        size={12}
                        style={{ color: "oklch(0.65 0.15 140)" }}
                      />
                    )}
                    {f.error && (
                      <AlertCircle
                        size={12}
                        style={{ color: "oklch(0.65 0.2 25)" }}
                      />
                    )}
                  </div>
                  {f.error ? (
                    <p
                      className="text-xs"
                      style={{ color: "oklch(0.65 0.2 25)" }}
                    >
                      {f.error}
                    </p>
                  ) : (
                    <div
                      className="h-1.5 rounded-full overflow-hidden"
                      style={{ backgroundColor: "oklch(var(--outline))" }}
                    >
                      <div
                        className="h-full rounded-full transition-all duration-200"
                        style={{
                          width: `${f.progress}%`,
                          backgroundColor: f.done
                            ? "oklch(0.65 0.15 140)"
                            : "oklch(var(--accent))",
                        }}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── ImageSetManager ───────────────────────────────────────────────────────────

type StripeModal = "secret-key" | "webhook-secret" | null;

export function ImageSetManager({ identity }: ImageSetManagerProps) {
  const [sets, setSets] = useState<ImageSet[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<{
    message: string;
    onConfirm: () => void;
  } | null>(null);
  const [showNewSetDialog, setShowNewSetDialog] = useState(false);
  const [newSetForm, setNewSetForm] = useState<NewSetForm>({
    name: "",
    isFree: true,
    isDefault: false,
    price: "",
    error: null,
  });
  const [isCreatingSet, setIsCreatingSet] = useState(false);
  const [uploadingBySet, setUploadingBySet] = useState<
    Record<string, UploadingFile[]>
  >({});

  // Payments actor state
  const [packPrices, setPackPrices] = useState<Map<string, bigint>>(new Map());
  const [stripeModal, setStripeModal] = useState<StripeModal>(null);
  const [isSavingStripe, setIsSavingStripe] = useState(false);

  const actorRef = useRef<backendInterface | null>(null);
  const paymentsActorRef = useRef<paymentsInterface | null>(null);
  const identityRef = useRef(identity);

  // Reset cached actors whenever identity changes
  if (identityRef.current !== identity) {
    identityRef.current = identity;
    actorRef.current = null;
    paymentsActorRef.current = null;
  }

  const getActor = useCallback(async (): Promise<backendInterface> => {
    if (!actorRef.current) {
      actorRef.current = await createActorWithConfig({ identity });
    }
    return actorRef.current;
  }, [identity]);

  const getPaymentsActor = useCallback(async (): Promise<paymentsInterface> => {
    if (!paymentsActorRef.current) {
      paymentsActorRef.current = await createPaymentsActor(identity);
    }
    return paymentsActorRef.current;
  }, [identity]);

  const loadSets = useCallback(async () => {
    setIsLoading(true);
    setGlobalError(null);
    try {
      const actor = await getActor();
      const result = await actor.getAllImageSetsAdmin();
      setSets(result);
    } catch (err) {
      setGlobalError(
        err instanceof Error ? err.message : "Failed to load image sets",
      );
    } finally {
      setIsLoading(false);
    }
  }, [getActor]);

  const loadPackPrices = useCallback(async () => {
    try {
      const actor = await getPaymentsActor();
      const entries = await actor.getPackPrices();
      setPackPrices(new Map(entries));
    } catch (err) {
      // Silently skip when payments canister is not yet configured (e.g. env.json not populated)
      if (
        err instanceof Error &&
        err.message.includes("CANISTER_ID_PAYMENTS")
      ) {
        console.warn(
          "[ImageSetManager] Payments canister not configured — pack prices unavailable. " +
            "Deploy the payments canister and ensure payments_canister_id is set in env.json.",
        );
        return;
      }
      console.error("[ImageSetManager] Failed to load pack prices:", err);
    }
  }, [getPaymentsActor]);

  useEffect(() => {
    void loadSets();
    void loadPackPrices();
  }, [loadSets, loadPackPrices]);

  // ── Upload ─────────────────────────────────────────────────────────────────

  const handleUpload = useCallback(
    async (setId: string, files: FileList) => {
      const validFiles: File[] = [];
      const errors: string[] = [];

      for (const file of Array.from(files)) {
        if (!["image/jpeg", "image/png"].includes(file.type)) {
          errors.push(`${file.name}: must be JPEG or PNG`);
          continue;
        }
        if (file.size > MAX_FILE_SIZE) {
          errors.push(`${file.name}: exceeds 20 MB limit`);
          continue;
        }
        validFiles.push(file);
      }

      if (errors.length > 0) setGlobalError(errors.join(" | "));
      if (validFiles.length === 0) return;

      const initialEntries: UploadingFile[] = validFiles.map((f) => ({
        name: f.name,
        progress: 0,
        error: null,
        done: false,
      }));

      let baseIndex = 0;
      setUploadingBySet((prev) => {
        baseIndex = (prev[setId] ?? []).length;
        return {
          ...prev,
          [setId]: [...(prev[setId] ?? []), ...initialEntries],
        };
      });

      const freshActor = await createActorWithConfig({ identity });
      console.log(
        "[ImageSetManager] starting upload batch — files:",
        validFiles.length,
      );

      for (let i = 0; i < validFiles.length; i++) {
        const file = validFiles[i];
        const entryIndex = baseIndex + i;

        const updateEntry = (partial: Partial<UploadingFile>) => {
          setUploadingBySet((prev) => {
            const list = [...(prev[setId] ?? [])];
            list[entryIndex] = { ...list[entryIndex], ...partial };
            return { ...prev, [setId]: list };
          });
        };

        try {
          const assetUrl = await uploadFileWithProgress(file, identity, (pct) =>
            updateEntry({ progress: pct }),
          );

          const { width, height } = await getImageDimensions(file);
          const imageId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
          const imageRef: ImageReference = {
            id: imageId,
            assetUrl,
            width: BigInt(width),
            height: BigInt(height),
          };

          console.log(
            "[ImageSetManager] calling addImageToSet — setId:",
            setId,
            "imageId:",
            imageId,
            "assetUrl:",
            assetUrl,
          );
          const ok = await freshActor.addImageToSet(setId, imageRef);
          console.log("[ImageSetManager] addImageToSet returned:", ok);
          if (!ok) {
            console.error(
              "[ImageSetManager] addImageToSet returned false — likely causes: (1) actor identity is anonymous (not admin), (2) setId not found in registry. setId:",
              setId,
              "actor principal:",
              identity?.getPrincipal().toString() ?? "none",
            );
            updateEntry({
              error:
                "Upload succeeded but could not register in the image set — check that you are signed in as admin.",
              done: false,
            });
            continue;
          }

          updateEntry({ progress: 100, done: true });

          setSets((prev) =>
            prev.map((s) =>
              s.id === setId
                ? {
                    ...s,
                    imageCount: s.imageCount + BigInt(1),
                    images: [...s.images, { ...imageRef }],
                  }
                : s,
            ),
          );
        } catch (err) {
          const principal = identity?.getPrincipal().toString() ?? "none";
          const isAnon = identity?.getPrincipal().isAnonymous() ?? true;
          console.error(
            "[ImageSetManager] addImageToSet threw — setId:",
            setId,
            "principal:",
            principal,
            "isAnonymous:",
            isAnon,
            "error:",
            err,
          );
          updateEntry({
            error: err instanceof Error ? err.message : "Upload failed",
            done: false,
          });
        }
      }

      setTimeout(() => {
        setUploadingBySet((prev) => {
          const list = (prev[setId] ?? []).filter((f) => !f.done && !f.error);
          return { ...prev, [setId]: list };
        });
      }, 3000);
    },
    [identity],
  );

  // ── Remove Image ───────────────────────────────────────────────────────────

  const handleRemoveImage = useCallback(
    (setId: string, imageId: string) => {
      setConfirmState({
        message: "Remove this image from the set? This cannot be undone.",
        onConfirm: async () => {
          setConfirmState(null);
          try {
            const actor = await getActor();
            await actor.removeImageFromSet(setId, imageId);
            setSets((prev) =>
              prev.map((s) =>
                s.id === setId
                  ? {
                      ...s,
                      imageCount: s.imageCount - BigInt(1),
                      images: s.images.filter((img) => img.id !== imageId),
                    }
                  : s,
              ),
            );
          } catch (err) {
            setGlobalError(
              err instanceof Error ? err.message : "Failed to remove image",
            );
          }
        },
      });
    },
    [getActor],
  );

  // ── Delete Set ─────────────────────────────────────────────────────────────

  const handleDeleteSet = useCallback(
    (setId: string) => {
      setConfirmState({
        message:
          "Delete this entire set and all its images? This cannot be undone.",
        onConfirm: async () => {
          setConfirmState(null);
          try {
            const actor = await getActor();
            await actor.deleteImageSet(setId);
            setSets((prev) => prev.filter((s) => s.id !== setId));
          } catch (err) {
            setGlobalError(
              err instanceof Error ? err.message : "Failed to delete set",
            );
          }
        },
      });
    },
    [getActor],
  );

  // ── Set Default ────────────────────────────────────────────────────────────

  const handleSetDefault = useCallback(
    async (setId: string) => {
      try {
        const actor = await getActor();
        const ok = await actor.setImageSetDefault(setId);
        if (!ok) {
          setGlobalError(
            "Failed to set default — check that you are signed in as admin.",
          );
          return;
        }
        setSets((prev) =>
          prev.map((s) => ({ ...s, isDefault: s.id === setId })),
        );
      } catch (err) {
        setGlobalError(
          err instanceof Error ? err.message : "Failed to set default",
        );
      }
    },
    [getActor],
  );

  // ── Set Pack Price (USD cents via payments canister) ───────────────────────

  const handleSavePackPrice = useCallback(
    async (packId: string, cents: bigint) => {
      const actor = await getPaymentsActor();
      const ok = await actor.setPackPrice(packId, cents);
      if (!ok) {
        toast.error(
          "Failed to update price — check that you are signed in as admin.",
        );
        return;
      }
      setPackPrices((prev) => new Map([...prev, [packId, cents]]));
      toast.success("Price updated successfully.");
    },
    [getPaymentsActor],
  );

  // ── Update Tags ────────────────────────────────────────────────────────────

  const handleSaveTags = useCallback(
    async (setId: string, tags: string[]) => {
      const actor = await getActor();
      const ok = await actor.updateSetTags(setId, tags);
      if (!ok) {
        throw new Error("updateSetTags returned false");
      }
      setSets((prev) => prev.map((s) => (s.id === setId ? { ...s, tags } : s)));
    },
    [getActor],
  );

  // ── Rename Set ─────────────────────────────────────────────────────────────

  const handleRenameSet = useCallback(
    async (setId: string, newName: string) => {
      const actor = await getActor();
      const ok = await actor.renameSet(setId, newName);
      if (!ok) {
        throw new Error("renameSet returned false");
      }
      setSets((prev) =>
        prev.map((s) => (s.id === setId ? { ...s, name: newName } : s)),
      );
    },
    [getActor],
  );

  // ── Stripe Secret Key ──────────────────────────────────────────────────────

  const handleSaveStripeSecret = useCallback(
    async (value: string) => {
      setIsSavingStripe(true);
      try {
        const actor = await getPaymentsActor();
        const ok = await actor.setStripeSecretKey(value);
        if (!ok) {
          toast.error("Failed to save secret key — check admin access.");
          return;
        }
        toast.success("Stripe secret key saved.");
        setStripeModal(null);
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to save secret key.",
        );
      } finally {
        setIsSavingStripe(false);
      }
    },
    [getPaymentsActor],
  );

  // ── Stripe Webhook Secret ──────────────────────────────────────────────────

  const handleSaveWebhookSecret = useCallback(
    async (value: string) => {
      setIsSavingStripe(true);
      try {
        const actor = await getPaymentsActor();
        const ok = await actor.setStripeWebhookSecret(value);
        if (!ok) {
          toast.error("Failed to save webhook secret — check admin access.");
          return;
        }
        toast.success("Stripe webhook secret saved.");
        setStripeModal(null);
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to save webhook secret.",
        );
      } finally {
        setIsSavingStripe(false);
      }
    },
    [getPaymentsActor],
  );

  // ── Create Set ─────────────────────────────────────────────────────────────

  const handleCreateSet = useCallback(async () => {
    const trimmed = newSetForm.name.trim();
    if (trimmed.length < 3 || trimmed.length > 50) {
      setNewSetForm((f) => ({ ...f, error: "Name must be 3–50 characters" }));
      return;
    }

    let priceValue: string | null = null;
    if (!newSetForm.isFree) {
      const priceStr = newSetForm.price.trim();
      if (priceStr !== "") {
        const num = Number.parseFloat(priceStr);
        if (Number.isNaN(num) || num < 0) {
          setNewSetForm((f) => ({
            ...f,
            error: "Price must be a valid positive number",
          }));
          return;
        }
        priceValue = priceStr;
      }
    }

    setIsCreatingSet(true);
    try {
      const actor = await getActor();
      const newId = await actor.createImageSet(
        trimmed,
        newSetForm.isFree,
        newSetForm.isDefault,
        priceValue,
      );
      if (!newId) {
        console.error(
          "[ImageSetManager] createImageSet returned null — likely not admin or invalid name",
        );
        setNewSetForm((f) => ({
          ...f,
          error:
            "Failed to create set — make sure you are signed in as admin and the name is unique",
        }));
        return;
      }

      if (newSetForm.isDefault) {
        await actor.setImageSetDefault(newId);
      }

      setShowNewSetDialog(false);
      setNewSetForm({
        name: "",
        isFree: true,
        isDefault: false,
        price: "",
        error: null,
      });
      await loadSets();
    } catch (err) {
      setNewSetForm((f) => ({
        ...f,
        error: err instanceof Error ? err.message : "Failed to create set",
      }));
    } finally {
      setIsCreatingSet(false);
    }
  }, [newSetForm, getActor, loadSets]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      data-ocid="image_set_manager.panel"
      className="flex flex-col gap-6 h-full overflow-y-auto"
      style={{ color: "oklch(var(--text))" }}
    >
      {/* Header row */}
      <div className="flex items-center justify-between gap-4 shrink-0">
        <div>
          <h2
            className="text-base font-semibold"
            style={{ color: "oklch(var(--text))" }}
          >
            Image Sets
          </h2>
          <p
            className="text-xs mt-0.5"
            style={{ color: "oklch(var(--muted-text))" }}
          >
            Manage pose reference image sets for the Figure Drawing module
          </p>
        </div>
        <button
          type="button"
          data-ocid="image_set_manager.open_modal_button"
          onClick={() => {
            setNewSetForm({
              name: "",
              isFree: true,
              isDefault: false,
              price: "",
              error: null,
            });
            setShowNewSetDialog(true);
          }}
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium shrink-0 transition-opacity hover:opacity-80"
          style={{
            backgroundColor: "oklch(var(--accent))",
            color: "oklch(var(--accent-text))",
          }}
        >
          <Plus size={14} />
          New Image Set
        </button>
      </div>

      {/* Global error */}
      {globalError && (
        <div
          data-ocid="image_set_manager.error_state"
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

      {isLoading && (
        <div
          data-ocid="image_set_manager.loading_state"
          className="flex items-center justify-center py-16"
        >
          <Loader2
            size={24}
            className="animate-spin"
            style={{ color: "oklch(var(--muted-text))" }}
          />
        </div>
      )}

      {!isLoading && sets.length === 0 && (
        <div
          data-ocid="image_set_manager.empty_state"
          className="flex flex-col items-center gap-3 py-16"
          style={{
            border: "1px dashed oklch(var(--outline))",
            borderRadius: "12px",
          }}
        >
          <ImagePlus size={28} style={{ color: "oklch(var(--muted-text))" }} />
          <p className="text-sm" style={{ color: "oklch(var(--muted-text))" }}>
            No image sets yet
          </p>
        </div>
      )}

      {!isLoading && (
        <div className="flex flex-col gap-3">
          {sets.map((set) => (
            <ImageSetCard
              key={set.id}
              set={set}
              onUpload={handleUpload}
              onRemoveImage={handleRemoveImage}
              onDeleteSet={handleDeleteSet}
              onSetDefault={handleSetDefault}
              onOpenLightbox={(url) => setLightboxSrc(url)}
              uploading={uploadingBySet[set.id] ?? []}
              priceUsdCents={packPrices.get(set.id)}
              onSavePrice={handleSavePackPrice}
              onSaveTags={handleSaveTags}
              onRenameSet={handleRenameSet}
            />
          ))}
        </div>
      )}

      {/* ── Stripe Configuration Section ─────────────────────────────────── */}
      <div
        data-ocid="stripe_config.section"
        className="flex flex-col gap-4 pt-2"
      >
        <div
          className="pb-3"
          style={{ borderBottom: "1px solid oklch(var(--outline))" }}
        >
          <div className="flex items-center gap-2">
            <KeyRound size={15} style={{ color: "oklch(var(--accent))" }} />
            <h2
              className="text-base font-semibold"
              style={{ color: "oklch(var(--text))" }}
            >
              Stripe Configuration
            </h2>
          </div>
          <p
            className="text-xs mt-0.5"
            style={{ color: "oklch(var(--muted-text))" }}
          >
            API credentials are stored on-chain and are write-only — they cannot
            be retrieved after saving.
          </p>
        </div>

        <div
          className="flex flex-col gap-3 p-4 rounded-xl"
          style={{
            backgroundColor: "oklch(var(--sidebar-left) / 0.5)",
            border: "1px solid oklch(var(--outline))",
          }}
        >
          <div className="flex items-center justify-between gap-4">
            <div>
              <p
                className="text-sm font-medium"
                style={{ color: "oklch(var(--text))" }}
              >
                Secret Key
              </p>
              <p
                className="text-xs mt-0.5"
                style={{ color: "oklch(var(--muted-text))" }}
              >
                Your Stripe secret API key (sk_live_… or sk_test_…)
              </p>
            </div>
            <button
              type="button"
              data-ocid="stripe_config.set_secret_key_button"
              onClick={() => setStripeModal("secret-key")}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium shrink-0 transition-opacity hover:opacity-80"
              style={{
                backgroundColor: "oklch(var(--sidebar-left))",
                color: "oklch(var(--text))",
                border: "1px solid oklch(var(--outline))",
              }}
            >
              <KeyRound size={13} />
              Set Secret Key
            </button>
          </div>

          <div
            style={{ borderTop: "1px solid oklch(var(--outline))" }}
            className="pt-3 flex items-center justify-between gap-4"
          >
            <div>
              <p
                className="text-sm font-medium"
                style={{ color: "oklch(var(--text))" }}
              >
                Webhook Secret
              </p>
              <p
                className="text-xs mt-0.5"
                style={{ color: "oklch(var(--muted-text))" }}
              >
                Signing secret for verifying Stripe webhook events (whsec_…)
              </p>
            </div>
            <button
              type="button"
              data-ocid="stripe_config.set_webhook_secret_button"
              onClick={() => setStripeModal("webhook-secret")}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium shrink-0 transition-opacity hover:opacity-80"
              style={{
                backgroundColor: "oklch(var(--sidebar-left))",
                color: "oklch(var(--text))",
                border: "1px solid oklch(var(--outline))",
              }}
            >
              <KeyRound size={13} />
              Set Webhook Secret
            </button>
          </div>
        </div>
      </div>

      {/* ── Overlays ─────────────────────────────────────────────────────── */}

      {lightboxSrc && (
        <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
      )}

      {confirmState && (
        <ConfirmDialog
          message={confirmState.message}
          onConfirm={confirmState.onConfirm}
          onCancel={() => setConfirmState(null)}
        />
      )}

      {showNewSetDialog && (
        <NewSetDialog
          form={newSetForm}
          onChange={setNewSetForm}
          onConfirm={handleCreateSet}
          onCancel={() => setShowNewSetDialog(false)}
          isCreating={isCreatingSet}
        />
      )}

      {stripeModal === "secret-key" && (
        <StripeSecretModal
          title="Set Stripe Secret Key"
          placeholder="sk_live_… or sk_test_…"
          isSaving={isSavingStripe}
          onSave={(v) => void handleSaveStripeSecret(v)}
          onCancel={() => setStripeModal(null)}
        />
      )}

      {stripeModal === "webhook-secret" && (
        <StripeSecretModal
          title="Set Stripe Webhook Secret"
          placeholder="whsec_…"
          isSaving={isSavingStripe}
          onSave={(v) => void handleSaveWebhookSecret(v)}
          onCancel={() => setStripeModal(null)}
        />
      )}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function uploadFileWithProgress(
  file: File,
  identity: Identity,
  onProgress: (pct: number) => void,
): Promise<string> {
  const config = await loadConfig();

  const agent = new HttpAgent({
    identity,
    host: config.backend_host,
  });

  if (config.backend_host?.includes("localhost")) {
    await agent.fetchRootKey().catch(() => {
      console.warn("Unable to fetch root key for local replica");
    });
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
}

function getImageDimensions(
  file: File,
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to read image dimensions"));
    };
    img.src = url;
  });
}
