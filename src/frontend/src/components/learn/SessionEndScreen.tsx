// ── SessionEndScreen ────────────────────────────────────────────────────────────
//
// Shown after figure drawing session completes.
// Compiles snapshots into a collage and provides download/share/copy controls.

import { compileCollage } from "@/components/learn/primitives/CanvasCompiler";
import { Check, Clipboard, Download, Loader2, Share2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export interface SessionEndScreenProps {
  snapshots: ImageData[];
  onDismiss: () => void;
}

type CompileState =
  | { status: "compiling" }
  | { status: "done"; blob: Blob; url: string }
  | { status: "error"; message: string };

function isMobileDevice(): boolean {
  return navigator.maxTouchPoints > 0 || window.innerWidth < 768;
}

export function SessionEndScreen({
  snapshots,
  onDismiss,
}: SessionEndScreenProps) {
  const [state, setState] = useState<CompileState>({ status: "compiling" });
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const blobRef = useRef<Blob | null>(null);
  const urlRef = useRef<string | null>(null);
  const snapshotsRef = useRef(snapshots);

  // Compile collage on mount (snapshots captured in ref — effect runs once)
  useEffect(() => {
    const snaps = snapshotsRef.current;
    if (snaps.length === 0) {
      setState({ status: "error", message: "No poses to compile." });
      return;
    }

    compileCollage({ snapshots: snaps, maxSize: 5000 })
      .then(({ blob }) => {
        const url = URL.createObjectURL(blob);
        blobRef.current = blob;
        urlRef.current = url;
        setState({ status: "done", blob, url });
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : "Compilation failed.";
        setState({ status: "error", message: msg });
      })
      .finally(() => {
        // Release snapshot ImageData objects after the collage is compiled.
        // The compiler has finished reading from them — clearing the array
        // lets GC reclaim the pixel buffers (one full-canvas ImageData per pose).
        snapshotsRef.current.length = 0;
      });

    return () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, []);

  const handleDownload = async () => {
    const blob = blobRef.current;
    if (!blob) return;
    // FIX 6: use JPEG extension (was PNG)
    const filename = `sketchlair-session-${Date.now()}.jpg`;

    if ("showSaveFilePicker" in window) {
      try {
        const handle = await (
          window as Window &
            typeof globalThis & {
              showSaveFilePicker: (
                opts: unknown,
              ) => Promise<FileSystemFileHandle>;
            }
        ).showSaveFilePicker({
          suggestedName: filename,
          types: [
            { description: "JPEG image", accept: { "image/jpeg": [".jpg"] } },
          ],
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return;
      } catch {
        // Fallback to anchor
      }
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  const handleShare = async () => {
    const blob = blobRef.current;
    if (!blob) return;
    // FIX 6: use JPEG extension and MIME type (was PNG)
    const filename = `sketchlair-session-${Date.now()}.jpg`;
    const file = new File([blob], filename, { type: "image/jpeg" });

    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({
          files: [file],
          title: "My SketchLair Session",
        });
        return;
      } catch {
        // Fallback to download
      }
    }
    await handleDownload();
  };

  const handleCopy = async () => {
    const blob = blobRef.current;
    if (!blob) return;

    // Primary path: ClipboardItem API (modern browsers, requires HTTPS / localhost)
    const tryClipboardItem = async (): Promise<boolean> => {
      try {
        await navigator.clipboard.write([
          new ClipboardItem({ "image/png": blob }),
        ]);
        return true;
      } catch {
        return false;
      }
    };

    // Fallback path: best-effort last resort using execCommand('copy').
    // This rarely works for images in modern browsers but doesn't hurt to try.
    const tryExecCommand = (): boolean => {
      try {
        const tmp = document.createElement("textarea");
        tmp.value = ""; // empty fallback
        document.body.appendChild(tmp);
        tmp.focus();
        tmp.select();
        const result = document.execCommand("copy");
        document.body.removeChild(tmp);
        return result;
      } catch {
        return false;
      }
    };

    const succeeded = (await tryClipboardItem()) || tryExecCommand();

    if (succeeded) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } else {
      // Show a brief failure message using the copied state as a tri-state:
      // null = idle, true = success, false = failure
      setCopyFailed(true);
      setTimeout(() => setCopyFailed(false), 4000);
    }
  };

  return (
    <div
      data-ocid="session_end.panel"
      className="fixed inset-0 z-[9100] flex flex-col"
      style={{
        backgroundColor: "oklch(var(--canvas-bg) / 0.97)",
        backdropFilter: "blur(12px)",
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-6 py-4 shrink-0"
        style={{
          backgroundColor: "oklch(var(--toolbar))",
          borderBottom: "1px solid oklch(var(--outline))",
        }}
      >
        <div>
          <h2
            className="text-base font-bold"
            style={{ color: "oklch(var(--text))" }}
          >
            Session Complete
          </h2>
          <p
            className="text-xs mt-0.5"
            style={{ color: "oklch(var(--muted-text))" }}
          >
            {snapshots.length} pose{snapshots.length !== 1 ? "s" : ""} completed
          </p>
        </div>

        <div className="flex items-center gap-2">
          {state.status === "done" && isMobileDevice() && (
            <button
              type="button"
              data-ocid="session_end.share_button"
              onClick={() => {
                void handleShare();
              }}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-opacity hover:opacity-80"
              style={{
                backgroundColor: "oklch(var(--accent))",
                color: "oklch(var(--accent-text))",
              }}
            >
              <Share2 size={14} />
              Share
            </button>
          )}
          {state.status === "done" && !isMobileDevice() && (
            <>
              <button
                type="button"
                data-ocid="session_end.copy_button"
                onClick={() => {
                  void handleCopy();
                }}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-opacity hover:opacity-80"
                style={{
                  backgroundColor: copyFailed
                    ? "oklch(var(--sidebar-left))"
                    : "oklch(var(--sidebar-left))",
                  color: copyFailed
                    ? "oklch(var(--accent))"
                    : "oklch(var(--text))",
                  border: `1px solid ${copyFailed ? "oklch(var(--accent) / 0.5)" : "oklch(var(--outline))"}`,
                }}
                title={
                  copyFailed
                    ? "Copy failed — please use the Download button instead"
                    : undefined
                }
              >
                {copied ? <Check size={14} /> : <Clipboard size={14} />}
                {copied
                  ? "Copied to clipboard"
                  : copyFailed
                    ? "Copy failed"
                    : "Copy"}
              </button>
              <button
                type="button"
                data-ocid="session_end.download_button"
                onClick={() => {
                  void handleDownload();
                }}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-opacity hover:opacity-80"
                style={{
                  backgroundColor: "oklch(var(--accent))",
                  color: "oklch(var(--accent-text))",
                }}
              >
                <Download size={14} />
                Download
              </button>
            </>
          )}

          <button
            type="button"
            data-ocid="session_end.done_button"
            onClick={onDismiss}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-opacity hover:opacity-80"
            style={{
              backgroundColor: "oklch(var(--sidebar-left))",
              color: "oklch(var(--text))",
              border: "1px solid oklch(var(--outline))",
            }}
          >
            Done
          </button>
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-auto flex items-center justify-center p-6">
        {state.status === "compiling" && (
          <div
            data-ocid="session_end.loading_state"
            className="flex flex-col items-center gap-4"
          >
            <Loader2
              size={32}
              className="animate-spin"
              style={{ color: "oklch(var(--accent))" }}
            />
            <p
              className="text-sm font-medium"
              style={{ color: "oklch(var(--text))" }}
            >
              Compiling your drawings…
            </p>
          </div>
        )}

        {state.status === "error" && (
          <div
            data-ocid="session_end.error_state"
            className="flex flex-col items-center gap-3 max-w-sm text-center"
          >
            <p className="text-sm" style={{ color: "oklch(var(--text))" }}>
              {state.message}
            </p>
            <button
              type="button"
              data-ocid="session_end.dismiss_error_button"
              onClick={onDismiss}
              className="px-4 py-2 rounded-lg text-sm font-medium"
              style={{
                backgroundColor: "oklch(var(--accent))",
                color: "oklch(var(--accent-text))",
              }}
            >
              Back to Start
            </button>
          </div>
        )}

        {state.status === "done" && (
          <div
            data-ocid="session_end.success_state"
            className="flex items-center justify-center w-full h-full"
          >
            <img
              src={state.url}
              alt="Session collage"
              className="max-w-full max-h-full rounded-xl shadow-2xl"
              style={{
                objectFit: "contain",
                border: "1px solid oklch(var(--outline))",
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
