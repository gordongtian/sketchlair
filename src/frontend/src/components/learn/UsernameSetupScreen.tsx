/**
 * UsernameSetupScreen — shown after authentication when the user has no username yet.
 *
 * Validates format client-side, checks availability against the canister,
 * and registers the username on Continue.
 */

import { createActorWithConfig } from "@/config";
import type { Identity } from "@icp-sdk/core/agent";
import { ArrowLeft, Check, Loader2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

interface UsernameSetupScreenProps {
  identity: Identity;
  onComplete: () => void;
  onBack: () => void;
}

type AvailabilityStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "available" }
  | { kind: "taken" }
  | { kind: "invalid"; message: string }
  | { kind: "error"; message: string };

/** Validate username format — returns null if valid, error string if not */
function validateFormat(username: string): string | null {
  if (username.length < 3) return "Username must be at least 3 characters";
  if (username.length > 20) return "Username must be 20 characters or fewer";
  if (!/^[a-zA-Z0-9]/.test(username))
    return "Username must start with a letter or number";
  if (!/^[a-zA-Z0-9_-]+$/.test(username))
    return "Only letters, numbers, underscores, and hyphens are allowed";
  return null;
}

export function UsernameSetupScreen({
  identity,
  onComplete,
  onBack,
}: UsernameSetupScreenProps) {
  const [value, setValue] = useState("");
  const [status, setStatus] = useState<AvailabilityStatus>({ kind: "idle" });
  const [isRegistering, setIsRegistering] = useState(false);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced availability check
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    const trimmed = value.trim();
    if (!trimmed) {
      setStatus({ kind: "idle" });
      return;
    }

    const formatError = validateFormat(trimmed);
    if (formatError) {
      setStatus({ kind: "invalid", message: formatError });
      return;
    }

    debounceTimerRef.current = setTimeout(() => {
      void checkAvailability(trimmed.toLowerCase());
    }, 500);

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [value]);

  const checkAvailability = useCallback(
    async (username: string) => {
      setStatus({ kind: "checking" });
      try {
        const actor = await createActorWithConfig({ identity });
        const available = await actor.checkUsernameAvailable(username);
        console.log(
          `[Auth] checkUsernameAvailable: ${username} -> ${available}`,
        );
        setStatus(available ? { kind: "available" } : { kind: "taken" });
      } catch (e) {
        console.error("[Auth] checkUsernameAvailable error:", e);
        setStatus({
          kind: "error",
          message: "Could not check availability. Please try again.",
        });
      }
    },
    [identity],
  );

  const handleContinue = useCallback(async () => {
    const username = value.trim().toLowerCase();
    if (!username || status.kind !== "available") return;

    setIsRegistering(true);
    try {
      const actor = await createActorWithConfig({ identity });
      const success = await actor.registerUsername(username);
      console.log(`[Auth] registerUsername: ${username} -> ${success}`);
      if (success) {
        onComplete();
      } else {
        // Race condition — another user registered the same name
        setStatus({
          kind: "taken",
        });
        // Show a more descriptive inline error
        setStatus({
          kind: "error",
          message: "This username was just taken. Please choose another.",
        });
      }
    } catch (e) {
      console.error("[Auth] registerUsername error:", e);
      setStatus({
        kind: "error",
        message: "Registration failed. Please try again.",
      });
    } finally {
      setIsRegistering(false);
    }
  }, [value, status.kind, onComplete, identity]);

  const handleRetry = useCallback(() => {
    const trimmed = value.trim();
    if (trimmed) void checkAvailability(trimmed.toLowerCase());
  }, [value, checkAvailability]);

  const canContinue =
    status.kind === "available" && !isRegistering && value.trim().length > 0;

  return (
    <div className="flex flex-col gap-6 w-full max-w-sm">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          data-ocid="username_setup.back_button"
          onClick={onBack}
          className="flex items-center gap-1.5 text-xs px-2 py-1 rounded transition-opacity hover:opacity-80"
          style={{
            color: "oklch(var(--muted-text))",
            backgroundColor: "oklch(var(--sidebar-left))",
          }}
        >
          <ArrowLeft size={12} />
          Back
        </button>
      </div>

      <div>
        <h2
          className="text-xl font-bold mb-1"
          style={{ color: "oklch(var(--text))" }}
        >
          Choose a username
        </h2>
        <p className="text-sm" style={{ color: "oklch(var(--muted-text))" }}>
          Your username is permanent and cannot be changed later.
        </p>
      </div>

      {/* Input row */}
      <div className="flex gap-2">
        <input
          type="text"
          data-ocid="username_setup.input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canContinue) void handleContinue();
          }}
          placeholder="e.g. sketcher_42"
          maxLength={20}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          className="flex-1 px-3 py-2 rounded-lg text-sm focus:outline-none"
          style={{
            backgroundColor: "oklch(var(--sidebar-left))",
            border: "1px solid oklch(var(--outline))",
            color: "oklch(var(--text))",
          }}
        />
        <button
          type="button"
          data-ocid="username_setup.check_button"
          onClick={() => {
            const trimmed = value.trim();
            const err = validateFormat(trimmed);
            if (err) {
              setStatus({ kind: "invalid", message: err });
              return;
            }
            void checkAvailability(trimmed.toLowerCase());
          }}
          disabled={!value.trim() || status.kind === "checking"}
          className="px-3 py-2 rounded-lg text-sm font-medium transition-opacity hover:opacity-80 disabled:opacity-40"
          style={{
            backgroundColor: "oklch(var(--sidebar-left))",
            border: "1px solid oklch(var(--outline))",
            color: "oklch(var(--text))",
          }}
        >
          {status.kind === "checking" ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            "Check"
          )}
        </button>
      </div>

      {/* Status message */}
      <div className="min-h-[20px]">
        {status.kind === "checking" && (
          <div
            className="flex items-center gap-2 text-sm"
            style={{ color: "oklch(var(--muted-text))" }}
          >
            <Loader2 size={13} className="animate-spin" />
            Checking availability…
          </div>
        )}
        {status.kind === "available" && (
          <div
            data-ocid="username_setup.success_state"
            className="flex items-center gap-2 text-sm"
            style={{ color: "oklch(0.65 0.18 145)" }}
          >
            <Check size={13} />
            Username is available
          </div>
        )}
        {status.kind === "taken" && (
          <div
            data-ocid="username_setup.error_state"
            className="flex items-center gap-2 text-sm"
            style={{ color: "oklch(0.65 0.22 25)" }}
          >
            <X size={13} />
            Username is taken
          </div>
        )}
        {status.kind === "invalid" && (
          <div
            data-ocid="username_setup.error_state"
            className="flex items-center gap-2 text-sm"
            style={{ color: "oklch(0.65 0.22 25)" }}
          >
            <X size={13} />
            {status.message}
          </div>
        )}
        {status.kind === "error" && (
          <div
            data-ocid="username_setup.error_state"
            className="flex flex-col gap-1"
          >
            <div
              className="flex items-center gap-2 text-sm"
              style={{ color: "oklch(0.65 0.22 25)" }}
            >
              <X size={13} />
              {status.message}
            </div>
            {status.message.includes("availability") && (
              <button
                type="button"
                onClick={handleRetry}
                className="text-xs underline text-left transition-opacity hover:opacity-70"
                style={{ color: "oklch(var(--muted-text))" }}
              >
                Retry
              </button>
            )}
          </div>
        )}
      </div>

      {/* Continue */}
      <button
        type="button"
        data-ocid="username_setup.submit_button"
        onClick={() => void handleContinue()}
        disabled={!canContinue}
        className="w-full py-2.5 rounded-lg text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        style={{
          backgroundColor: "oklch(var(--accent))",
          color: "oklch(var(--accent-text))",
        }}
      >
        {isRegistering ? (
          <>
            <Loader2 size={14} className="animate-spin" />
            Registering…
          </>
        ) : (
          "Continue"
        )}
      </button>
    </div>
  );
}
