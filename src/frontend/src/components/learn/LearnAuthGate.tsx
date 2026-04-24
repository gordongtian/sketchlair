/**
 * LearnAuthGate — authentication + username gate for the Learn module.
 *
 * State machine:
 *   checking → (not authed) login
 *           → (authed, no username) username-setup
 *           → (authed, has username) fires onEnter()
 *
 * This gate is checked every time the user navigates to Learn.
 */

import { createActorWithConfig } from "@/config";
import { useAuth } from "@/hooks/useAuth";
import type { Identity } from "@icp-sdk/core/agent";
import { ArrowLeft, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { UsernameSetupScreen } from "./UsernameSetupScreen";

interface LearnAuthGateProps {
  onBack: () => void;
  onEnter: () => void;
}

type GateState = "checking" | "login" | "username-setup" | "ready" | "error";

export function LearnAuthGate({ onBack, onEnter }: LearnAuthGateProps) {
  const auth = useAuth();
  const [gateState, setGateState] = useState<GateState>("checking");
  const checkingRef = useRef(false);

  const runGateCheck = useCallback(async () => {
    if (checkingRef.current) return;
    checkingRef.current = true;
    setGateState("checking");

    try {
      if (!auth.isAuthenticated || !auth.identity) {
        setGateState("login");
        return;
      }

      // Authenticated — check if username exists
      const actor = await createActorWithConfig({ identity: auth.identity });
      const username = await actor.getMyUsername();
      if (username != null && username !== "") {
        console.log(`[Auth] getMyUsername: ${username}`);
        // Has username — proceed immediately
        setGateState("ready");
        onEnter();
      } else {
        setGateState("username-setup");
      }
    } catch (e) {
      console.error("[Auth] gate check error:", e);
      // If already authenticated, a username-check failure is a transient error — show retry.
      // If not authenticated, fall back to login screen.
      if (auth.isAuthenticated && auth.identity) {
        setGateState("error");
      } else {
        setGateState("login");
      }
    } finally {
      checkingRef.current = false;
    }
  }, [auth.isAuthenticated, auth.identity, onEnter]);

  // Run gate check on mount and when auth finishes initializing
  useEffect(() => {
    if (auth.isInitializing) return;
    void runGateCheck();
    return () => {
      // Reset in-flight guard on unmount so the next mount always runs fresh
      checkingRef.current = false;
    };
  }, [auth.isInitializing, runGateCheck]);

  // Re-run gate check when login succeeds
  useEffect(() => {
    if (auth.isLoginSuccess && auth.isAuthenticated) {
      checkingRef.current = false; // Always reset before retry so the guard never blocks post-login checks
      void runGateCheck();
    }
  }, [auth.isLoginSuccess, auth.isAuthenticated, runGateCheck]);

  // On login error/cancel — silently go back
  useEffect(() => {
    if (auth.isLoginError) {
      onBack();
    }
  }, [auth.isLoginError, onBack]);

  if (auth.isInitializing || gateState === "checking") {
    return <GateCheckingScreen />;
  }

  if (gateState === "login") {
    return (
      <InternetIdentityLoginScreen
        onBack={onBack}
        onLogin={auth.login}
        isLoggingIn={auth.isLoggingIn}
      />
    );
  }

  if (gateState === "username-setup" && auth.identity) {
    return (
      <UsernameSetupScreen
        identity={auth.identity as Identity}
        onComplete={() => {
          setGateState("ready");
          onEnter();
        }}
        onBack={onBack}
      />
    );
  }

  if (gateState === "error") {
    return (
      <GateErrorScreen
        onRetry={() => {
          checkingRef.current = false;
          void runGateCheck();
        }}
        onBack={onBack}
      />
    );
  }

  // "ready" state — onEnter was already called, render nothing
  return null;
}

// ── Sub-screens ──────────────────────────────────────────────────────────────

function GateCheckingScreen() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16">
      <Loader2
        size={24}
        className="animate-spin"
        style={{ color: "oklch(var(--muted-text))" }}
      />
      <p className="text-sm" style={{ color: "oklch(var(--muted-text))" }}>
        Checking authentication…
      </p>
    </div>
  );
}

interface GateErrorScreenProps {
  onRetry: () => void;
  onBack: () => void;
}

function GateErrorScreen({ onRetry, onBack }: GateErrorScreenProps) {
  return (
    <div className="flex flex-col gap-6 w-full max-w-sm">
      <div>
        <button
          type="button"
          data-ocid="learn_auth.back_button"
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

      <div className="flex flex-col items-center gap-3 py-4 text-center">
        <p
          className="text-sm leading-relaxed"
          style={{ color: "oklch(var(--muted-text))" }}
        >
          Something went wrong connecting to the server. Please try again.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <button
          type="button"
          data-ocid="learn_auth.retry_button"
          onClick={onRetry}
          className="w-full py-2.5 rounded-lg text-sm font-semibold transition-opacity hover:opacity-90 flex items-center justify-center gap-2"
          style={{
            backgroundColor: "oklch(var(--accent))",
            color: "oklch(var(--accent-text))",
          }}
        >
          <RefreshCw size={14} />
          Try Again
        </button>

        <button
          type="button"
          data-ocid="learn_auth.cancel_button"
          onClick={onBack}
          className="w-full py-2.5 rounded-lg text-sm font-medium transition-opacity hover:opacity-80"
          style={{
            backgroundColor: "oklch(var(--sidebar-left))",
            border: "1px solid oklch(var(--outline))",
            color: "oklch(var(--text))",
          }}
        >
          Back
        </button>
      </div>
    </div>
  );
}

interface LoginScreenProps {
  onBack: () => void;
  onLogin: () => void;
  isLoggingIn: boolean;
}

function InternetIdentityLoginScreen({
  onBack,
  onLogin,
  isLoggingIn,
}: LoginScreenProps) {
  return (
    <div className="flex flex-col gap-6 w-full max-w-sm">
      {/* Back */}
      <div>
        <button
          type="button"
          data-ocid="learn_auth.back_button"
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

      {/* Icon + heading */}
      <div className="flex flex-col items-center gap-3 py-4">
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center"
          style={{ backgroundColor: "oklch(var(--accent) / 0.15)" }}
        >
          <ShieldCheck size={28} style={{ color: "oklch(var(--accent))" }} />
        </div>
        <div className="text-center">
          <h2
            className="text-xl font-bold"
            style={{ color: "oklch(var(--text))" }}
          >
            SketchLair Learn
          </h2>
          <p
            className="text-sm mt-1 leading-relaxed"
            style={{ color: "oklch(var(--muted-text))" }}
          >
            A free account is required to access Learn features.
          </p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-3">
        <button
          type="button"
          data-ocid="learn_auth.login_button"
          onClick={onLogin}
          disabled={isLoggingIn}
          className="w-full py-2.5 rounded-lg text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-60 flex items-center justify-center gap-2"
          style={{
            backgroundColor: "oklch(var(--accent))",
            color: "oklch(var(--accent-text))",
          }}
        >
          {isLoggingIn ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              Opening Internet Identity…
            </>
          ) : (
            "Sign In with Internet Identity"
          )}
        </button>

        <button
          type="button"
          data-ocid="learn_auth.cancel_button"
          onClick={onBack}
          className="w-full py-2.5 rounded-lg text-sm font-medium transition-opacity hover:opacity-80"
          style={{
            backgroundColor: "oklch(var(--sidebar-left))",
            border: "1px solid oklch(var(--outline))",
            color: "oklch(var(--text))",
          }}
        >
          Back
        </button>
      </div>

      <p
        className="text-xs text-center"
        style={{ color: "oklch(var(--muted-text))" }}
      >
        Internet Identity is a secure, privacy-preserving login system for the
        Internet Computer. No email or password required.
      </p>
    </div>
  );
}
