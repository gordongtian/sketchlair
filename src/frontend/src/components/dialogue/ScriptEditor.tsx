/**
 * ScriptEditor — monospace syntax-highlighted textarea editor for a single
 * module's dialogue script.
 *
 * Uses the "overlay" technique: a read-only <pre> with syntax-highlighted HTML
 * is positioned identically behind a transparent <textarea> so the user sees
 * highlighted text while typing in the real input.
 */

import { createActorWithConfig } from "@/config";
import type { Identity } from "@icp-sdk/core/agent";
import { BookOpen, HelpCircle, Play, Save, Square, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useDialogue } from "./DialogueContext";
import { parseDialogueScript } from "./parseDialogueScript";

// ─── Props ────────────────────────────────────────────────────────────────────

interface ScriptEditorProps {
  moduleId: string;
  moduleName: string;
  identity: Identity | null;
}

// ─── Syntax highlighting ──────────────────────────────────────────────────────

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Highlight inline MTBE markers `[[...]]` within already-escaped quoted text.
 * Returns HTML with spans for MTBE blocks and their inner property keys.
 */
function highlightMtbeInText(escaped: string): string {
  // Match [[...]] (already HTML-escaped so < > are &lt; &gt; — but [[ and ]]
  // are plain characters, so the regex works directly on the escaped string).
  return escaped.replace(/(\[\[)(.*?)(\]\])/gs, (_m, open, body, close) => {
    // Highlight property keys inside the MTBE body (key: value | key: value)
    const highlightedBody = body.replace(
      /([^|:]+)(:)/g,
      (_km: string, key: string, colon: string) =>
        `<span style="color:#fbbf24">${key}</span>${colon}`,
    );
    return `<span style="color:#f97316">${open}${highlightedBody}${close}</span>`;
  });
}

/**
 * Convert raw script text into an HTML string with syntax-colour spans.
 * Each line is processed independently; the result is joined with "\n".
 */
export function highlightScript(text: string): string {
  const lines = text.split("\n");

  return lines
    .map((rawLine) => {
      const trimmed = rawLine.trimStart();

      // ── Comment ──────────────────────────────────────────────────────────
      if (trimmed.startsWith("//")) {
        return `<span style="color:#6b7280">${escHtml(rawLine)}</span>`;
      }

      // ── [block] marker ────────────────────────────────────────────────────
      if (trimmed.toLowerCase() === "[block]") {
        return `<span style="color:#f59e0b">${escHtml(rawLine)}</span>`;
      }

      // ── [end] marker ──────────────────────────────────────────────────────
      if (trimmed.toLowerCase() === "[end]") {
        return `<span style="color:#f59e0b;opacity:0.7">${escHtml(rawLine)}</span>`;
      }

      // ── Block-level property tag [key: value] (NOT [[...]]) ───────────────
      // Must start with [ but NOT [[
      if (trimmed.startsWith("[") && !trimmed.startsWith("[[")) {
        return `<span style="color:#60a5fa">${escHtml(rawLine)}</span>`;
      }

      // ── Quoted text content ───────────────────────────────────────────────
      if (trimmed.startsWith('"')) {
        const escaped = escHtml(rawLine);
        // Highlight MTBE markers within the escaped text
        const withMtbe = highlightMtbeInText(escaped);
        return `<span style="color:#f1f5f9">${withMtbe}</span>`;
      }

      // ── Default: uncoloured ───────────────────────────────────────────────
      return escHtml(rawLine);
    })
    .join("\n");
}

// ─── Shared editor styles (applied via inline style objects) ──────────────────

const EDITOR_FONT: React.CSSProperties = {
  fontFamily: "'Courier New', Courier, monospace",
  fontSize: 14,
  lineHeight: 1.6,
};

const SHARED_LAYER: React.CSSProperties = {
  ...EDITOR_FONT,
  padding: "12px 12px 12px 0",
  whiteSpace: "pre-wrap",
  wordWrap: "break-word",
  margin: 0,
  border: "none",
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
};

// ─── Line numbers component ───────────────────────────────────────────────────

function LineNumbers({ text }: { text: string }) {
  const count = (text.match(/\n/g)?.length ?? 0) + 1;
  return (
    <div
      aria-hidden="true"
      style={{
        ...EDITOR_FONT,
        padding: "12px 8px",
        width: 40,
        flexShrink: 0,
        textAlign: "right",
        color: "#4b5563",
        backgroundColor: "#12121e",
        userSelect: "none",
        lineHeight: 1.6,
        overflowY: "hidden",
        whiteSpace: "pre",
      }}
    >
      {Array.from({ length: count }, (_, i) => i + 1).join("\n")}
    </div>
  );
}

// ─── Syntax Reference Panel ───────────────────────────────────────────────────

const SYNTAX_SECTIONS = [
  {
    heading: "Block structure",
    body: `A script is a sequence of blocks. Each block begins with [block], followed by optional property tags, then a quoted text string.

[block]
[expression: happy]
[entrance: fade_in]
[mode: blocking]
"The text the character speaks."`,
  },
  {
    heading: "Block-level properties",
    rows: [
      ["expression", "any uploaded expression name"],
      ["entrance", "fade_in · slide_up · pop_in · none"],
      ["exit", "fade_out · slide_down · none"],
      ["mode", "blocking · hint"],
      ["animation", "any uploaded animation name"],
      ["sfx", "any uploaded audio name (stub \u2014 not played)"],
      ["music", 'any uploaded audio name or "none" (stub)'],
    ] as [string, string][],
    note: "Any property not declared inherits from the previous block.",
  },
  {
    heading: "Inline events (MTBEs)",
    body: `Embed mid-text events inside quoted text using double brackets:

"The character says [[expression: excited | animation: shake]] something here."

The word immediately before [[...]] appears all at once.`,
    rows: [
      ["expression", "change mascot expression"],
      ["animation", "play a one-shot animation"],
      ["sfx", "audio cue (stub)"],
      ["music", "music change (stub)"],
    ] as [string, string][],
  },
  {
    heading: "Comments",
    body: `Any line starting with // is ignored by the parser:

// This is a comment`,
  },
  {
    heading: "Ending a script",
    body: `Use [end] as a standalone top-level tag to mark the end of a script.
Everything after [end] is ignored by the parser.

[end]

In admin preview: clears the preview and returns to the script editor.
In a Learn session: navigates back to the Learn menu.`,
  },
  {
    heading: "Example",
    body: `[block]
[expression: neutral]
[entrance: fade_in]
[mode: blocking]
"Welcome! Let's [[expression: happy | animation: wave]] get started."

[block]
[exit: fade_out]
"Take your time with each pose."

[end]`,
  },
];

function SyntaxReferencePanel({ onClose }: { onClose: () => void }) {
  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      data-ocid="script_editor.syntax_panel"
      aria-label="Script syntax reference"
      style={{
        backgroundColor: "#0d0d1c",
        border: "1px solid #2a2a3e",
        borderRadius: 8,
        padding: "14px 16px 16px",
        marginBottom: 0,
        flexShrink: 0,
        maxHeight: 340,
        overflowY: "auto",
        position: "relative",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
        }}
      >
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: "oklch(var(--accent))",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
          }}
        >
          Script Syntax Reference
        </span>
        <button
          type="button"
          data-ocid="script_editor.syntax_close_button"
          onClick={onClose}
          aria-label="Close syntax reference"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 20,
            height: 20,
            borderRadius: 4,
            border: "none",
            background: "transparent",
            color: "#4b5563",
            cursor: "pointer",
            padding: 0,
          }}
        >
          <X size={13} />
        </button>
      </div>

      {/* Sections */}
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {SYNTAX_SECTIONS.map((sec) => (
          <div key={sec.heading}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: "#94a3b8",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                marginBottom: 6,
              }}
            >
              {sec.heading}
            </div>

            {/* property table */}
            {sec.rows && (
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  marginBottom: sec.body ? 8 : 0,
                }}
              >
                <tbody>
                  {sec.rows.map(([key, val]) => (
                    <tr key={key}>
                      <td
                        style={{
                          fontFamily: "'Courier New', monospace",
                          fontSize: 12,
                          color: "#60a5fa",
                          paddingRight: 12,
                          paddingBottom: 3,
                          whiteSpace: "nowrap",
                          verticalAlign: "top",
                        }}
                      >
                        {key}
                      </td>
                      <td
                        style={{
                          fontSize: 12,
                          color: "#94a3b8",
                          paddingBottom: 3,
                          verticalAlign: "top",
                        }}
                      >
                        {val}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* note */}
            {"note" in sec && sec.note && (
              <div
                style={{
                  fontSize: 11,
                  color: "#6b7280",
                  fontStyle: "italic",
                  marginTop: 2,
                  marginBottom: sec.body ? 6 : 0,
                }}
              >
                {sec.note}
              </div>
            )}

            {/* code block */}
            {sec.body && (
              <pre
                style={{
                  fontFamily: "'Courier New', monospace",
                  fontSize: 12,
                  color: "#e2e8f0",
                  backgroundColor: "#0f0f1a",
                  border: "1px solid #1e1e2e",
                  borderRadius: 6,
                  padding: "8px 10px",
                  margin: 0,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  lineHeight: 1.6,
                }}
              >
                {sec.body}
              </pre>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── ScriptEditor ─────────────────────────────────────────────────────────────

export function ScriptEditor({
  moduleId,
  moduleName,
  identity,
}: ScriptEditorProps) {
  const { play, stop, activeBlocks } = useDialogue();
  const isPlaying = activeBlocks !== null;

  const [script, setScript] = useState("");
  const [savedScript, setSavedScript] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<{
    kind: "saved" | "unsaved" | "error";
    timestamp?: Date;
  }>({ kind: "saved" });
  const [toast, setToast] = useState<string | null>(null);
  const [showSyntax, setShowSyntax] = useState(false);

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

  // ── Load script on mount / moduleId change ────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setScript("");
    setSavedScript("");
    setSaveStatus({ kind: "saved" });

    void (async () => {
      try {
        const actor = await getActor();
        const result = await actor.getModuleScript(moduleId);
        if (!cancelled) {
          const text = result ?? "";
          setScript(text);
          setSavedScript(text);
          setSaveStatus({ kind: "saved" });
        }
      } catch {
        if (!cancelled) {
          setToast("Failed to load script.");
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [moduleId, getActor]);

  // ── Track unsaved changes ─────────────────────────────────────────────────
  useEffect(() => {
    if (!isLoading) {
      setSaveStatus((prev) =>
        script === savedScript
          ? {
              kind: "saved",
              timestamp: prev.kind === "saved" ? prev.timestamp : undefined,
            }
          : { kind: "unsaved" },
      );
    }
  }, [script, savedScript, isLoading]);

  // ── Refocus textarea when preview ends ───────────────────────────────────
  const wasPlayingRef = useRef(false);
  useEffect(() => {
    if (wasPlayingRef.current && !isPlaying) {
      // Preview just ended — restore focus to the editor
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
      });
    }
    wasPlayingRef.current = isPlaying;
  }, [isPlaying]);

  // ── Auto-dismiss toast ────────────────────────────────────────────────────
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  // ── Play handler — isPreview: true so missing assets stop preview ─────────
  // Play is allowed even when already playing — context.play() calls fullReset
  // synchronously before starting the new run so stale state is always cleared.
  const handlePlay = useCallback(() => {
    const { blocks, error, hasEndTag } = parseDialogueScript(script);
    if (error) {
      // Structural syntax error — show a native alert and do NOT start preview
      alert(error);
      return;
    }
    // [end] with no preceding blocks — nothing to play, just return to editor
    if (blocks.length === 0) {
      if (hasEndTag) {
        setToast("Script ended immediately — no blocks before [end].");
      } else {
        setToast("No dialogue blocks found in script.");
      }
      return;
    }
    // onComplete fires when the player exhausts all blocks naturally (including
    // when [end] caused the parser to stop early), returning the editor to its
    // idle/stopped state exactly like Stop.
    // NOTE: play() calls fullReset() synchronously before setting activeBlocks,
    // so pressing Play a second time always starts fresh from block 0 with no
    // residual state from the previous run.
    play(blocks, { isPreview: true, onComplete: () => stop() });
  }, [script, play, stop]);

  // ── Stop handler ─────────────────────────────────────────────────────────
  const handleStop = useCallback(() => {
    stop();
  }, [stop]);

  // ── Save handler ──────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (isSaving || !identity) return;
    setIsSaving(true);
    try {
      const actor = await getActor();
      const ok = await actor.saveModuleScript(moduleId, script);
      if (ok) {
        setSavedScript(script);
        setSaveStatus({ kind: "saved", timestamp: new Date() });
      } else {
        setSaveStatus({ kind: "error" });
        setToast("Save failed — check admin permissions.");
      }
    } catch {
      setSaveStatus({ kind: "error" });
      setToast("Save failed — network error.");
    } finally {
      setIsSaving(false);
    }
  }, [isSaving, identity, getActor, moduleId, script]);

  // ── Sync textarea scroll with highlight overlay ───────────────────────────
  const preRef = useRef<HTMLPreElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const syncScroll = useCallback(() => {
    if (preRef.current && textareaRef.current) {
      preRef.current.scrollTop = textareaRef.current.scrollTop;
      preRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  }, []);

  const highlighted = highlightScript(script);

  // ── Status label ──────────────────────────────────────────────────────────
  const statusLabel = (() => {
    if (isLoading) return "Loading…";
    if (isSaving) return "Saving…";
    if (saveStatus.kind === "saved" && saveStatus.timestamp) {
      const t = saveStatus.timestamp;
      const hh = String(t.getHours()).padStart(2, "0");
      const mm = String(t.getMinutes()).padStart(2, "0");
      return `Saved at ${hh}:${mm}`;
    }
    if (saveStatus.kind === "unsaved") return "Unsaved changes";
    if (saveStatus.kind === "error") return "Save error";
    return "Saved";
  })();

  const statusColor = (() => {
    if (saveStatus.kind === "unsaved") return "#f59e0b";
    if (saveStatus.kind === "error") return "#f87171";
    return "#6b7280";
  })();

  return (
    <div
      data-ocid="script_editor.panel"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        gap: 0,
      }}
    >
      {/* Module header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 12,
        }}
      >
        <BookOpen size={14} style={{ color: "oklch(var(--accent))" }} />
        <span
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: "oklch(var(--accent))",
          }}
        >
          {moduleName}
        </span>
      </div>

      {/* Toolbar */}
      <div
        data-ocid="script_editor.toolbar"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 10px",
          backgroundColor: "#12121e",
          borderRadius: "8px 8px 0 0",
          borderBottom: "1px solid #2a2a3e",
          flexShrink: 0,
        }}
      >
        {/* Play */}
        <button
          type="button"
          data-ocid="script_editor.play_button"
          onClick={handlePlay}
          disabled={isLoading}
          title={
            isPlaying
              ? "Restart preview from beginning"
              : "Parse and preview dialogue"
          }
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            padding: "5px 12px",
            borderRadius: 6,
            border: "1px solid #3a3a5e",
            backgroundColor: isPlaying ? "#1e2a1e" : "#1a2a1a",
            color: "#4ade80",
            fontSize: 12,
            fontWeight: 600,
            cursor: isLoading ? "default" : "pointer",
            opacity: isLoading ? 0.5 : 1,
            transition: "opacity 0.15s",
          }}
        >
          <Play size={11} />
          {isPlaying ? "Restart" : "Play"}
        </button>

        {/* Stop */}
        <button
          type="button"
          data-ocid="script_editor.stop_button"
          onClick={handleStop}
          disabled={!isPlaying}
          title="Stop preview"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            padding: "5px 12px",
            borderRadius: 6,
            border: "1px solid #3a3a5e",
            backgroundColor: isPlaying ? "#2a1a1a" : "transparent",
            color: isPlaying ? "#f87171" : "#4b5563",
            fontSize: 12,
            fontWeight: 600,
            cursor: isPlaying ? "pointer" : "default",
            transition: "opacity 0.15s",
          }}
        >
          <Square size={11} />
          Stop
        </button>

        {/* Save */}
        <button
          type="button"
          data-ocid="script_editor.save_button"
          onClick={() => void handleSave()}
          disabled={isSaving || isLoading || !identity}
          title="Save script to canister"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            padding: "5px 12px",
            borderRadius: 6,
            border: "1px solid oklch(var(--accent) / 0.4)",
            backgroundColor: "oklch(var(--accent) / 0.15)",
            color: "oklch(var(--accent))",
            fontSize: 12,
            fontWeight: 600,
            cursor: isSaving || isLoading || !identity ? "default" : "pointer",
            opacity: isSaving || isLoading || !identity ? 0.5 : 1,
            transition: "opacity 0.15s",
          }}
        >
          <Save size={11} />
          {isSaving ? "Saving…" : "Save"}
        </button>

        {/* Preview indicator */}
        {isPlaying && (
          <span
            data-ocid="script_editor.preview_active"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              fontSize: 11,
              color: "#4ade80",
              marginLeft: 4,
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                backgroundColor: "#4ade80",
                animation: "pulse 1.4s ease-in-out infinite",
              }}
            />
            Preview active
          </span>
        )}

        {/* Status text */}
        <span
          data-ocid="script_editor.save_status"
          style={{
            marginLeft: "auto",
            fontSize: 11,
            color: statusColor,
            whiteSpace: "nowrap",
          }}
        >
          {statusLabel}
        </span>

        {/* Syntax reference button */}
        <button
          type="button"
          data-ocid="script_editor.syntax_help_button"
          onClick={() => setShowSyntax((v) => !v)}
          title="Script syntax reference"
          aria-label="Open script syntax reference"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 26,
            height: 26,
            borderRadius: 6,
            border: showSyntax
              ? "1px solid oklch(var(--accent) / 0.6)"
              : "1px solid #3a3a5e",
            backgroundColor: showSyntax
              ? "oklch(var(--accent) / 0.2)"
              : "transparent",
            color: showSyntax ? "oklch(var(--accent))" : "#6b7280",
            cursor: "pointer",
            flexShrink: 0,
            transition: "all 0.15s",
          }}
        >
          <HelpCircle size={13} />
        </button>
      </div>

      {/* Syntax reference popup */}
      {showSyntax && (
        <SyntaxReferencePanel onClose={() => setShowSyntax(false)} />
      )}

      {/* Editor area */}
      <div
        style={{
          display: "flex",
          flex: 1,
          minHeight: 0,
          borderRadius: "0 0 8px 8px",
          overflow: "hidden",
          border: "1px solid #2a2a3e",
          borderTop: "none",
          backgroundColor: "#0f0f1a",
        }}
      >
        {/* Line numbers */}
        {!isLoading && <LineNumbers text={script} />}

        {/* Overlay + textarea container */}
        <div style={{ position: "relative", flex: 1, overflow: "hidden" }}>
          {isLoading ? (
            <div
              data-ocid="script_editor.loading_state"
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#4b5563",
                fontSize: 13,
              }}
            >
              Loading script…
            </div>
          ) : (
            <>
              {/* Highlighted overlay (read-only, pointer-events: none) */}
              <pre
                ref={preRef}
                aria-hidden="true"
                style={{
                  ...SHARED_LAYER,
                  position: "absolute",
                  inset: 0,
                  zIndex: 0,
                  pointerEvents: "none",
                  overflow: "hidden",
                  backgroundColor: "#0f0f1a",
                  color: "#f1f5f9",
                  paddingLeft: 12,
                }}
                // biome-ignore lint/security/noDangerouslySetInnerHtml: syntax highlighting
                dangerouslySetInnerHTML={{ __html: highlighted }}
              />

              {/* Actual textarea */}
              <textarea
                ref={textareaRef}
                data-ocid="script_editor.textarea"
                value={script}
                onChange={(e) => setScript(e.target.value)}
                onScroll={syncScroll}
                spellCheck={false}
                aria-label={`Dialogue script for ${moduleName}`}
                style={{
                  ...SHARED_LAYER,
                  position: "absolute",
                  inset: 0,
                  zIndex: 1,
                  background: "transparent",
                  color: "transparent",
                  caretColor: "#e2e8f0",
                  resize: "none",
                  paddingLeft: 12,
                  overflowY: "auto",
                  overflowX: "auto",
                }}
              />
            </>
          )}
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div
          data-ocid="script_editor.toast"
          role="alert"
          style={{
            position: "fixed",
            bottom: 24,
            right: 24,
            backgroundColor: "#1e293b",
            border: "1px solid #334155",
            color: "#f1f5f9",
            fontSize: 13,
            padding: "10px 16px",
            borderRadius: 8,
            boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
            zIndex: 99999,
            maxWidth: 320,
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}
