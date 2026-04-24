import { createActorWithConfig } from "@/config";
import type { Identity } from "@icp-sdk/core/agent";
import type { Principal } from "@icp-sdk/core/principal";
import { useEffect, useRef, useState } from "react";
import { useInternetIdentity } from "./useInternetIdentity";

export interface AuthState {
  isAuthenticated: boolean;
  principal: Principal | null;
  identity: Identity | null;
  isAdmin: boolean;
  username: string | null;
  login: () => void;
  logout: () => void;
  isLoggingIn: boolean;
  isInitializing: boolean;
  isLoginSuccess: boolean;
  isLoginError: boolean;
}

const MAX_ADMIN_RETRIES = 5;
const ADMIN_RETRY_DELAY_MS = 3000;

export function useAuth(): AuthState {
  const {
    identity,
    login,
    clear,
    isLoggingIn,
    isInitializing,
    isLoginSuccess,
    isLoginError,
  } = useInternetIdentity();

  const isAuthenticated = !!identity && !identity.getPrincipal().isAnonymous();
  const principal = isAuthenticated ? identity!.getPrincipal() : null;
  // Stable string form — avoids object reference churn in effect deps
  const principalText = principal?.toString() ?? null;

  const [isAdmin, setIsAdmin] = useState(false);
  const [username, setUsername] = useState<string | null>(null);
  const [retryCounter, setRetryCounter] = useState(0);

  // Confirmed-admin ref: once true it stays true for the session.
  // React may flush isAdmin state back to false on remount — this ref
  // survives and lets the effect restore isAdmin=true instantly.
  const isAdminConfirmedRef = useRef(false);

  // In-flight guard — prevents concurrent canister calls.
  // MUST be reset in the cleanup so re-runs after a cancelled check are not blocked.
  const isCheckingRef = useRef(false);
  // Retry count — reset when principal changes
  const retryCountRef = useRef(0);
  // Keep principal and identity in refs so async callbacks can access the
  // latest value without making them (unstable object references) deps.
  const principalRef = useRef(principal);
  const identityRef = useRef(identity);
  // Track previous principalText so we can reset retry count when it changes
  const prevPrincipalTextRef = useRef<string | null>(null);
  if (principalText !== prevPrincipalTextRef.current) {
    prevPrincipalTextRef.current = principalText;
    // Principal changed (login/logout/switch) — reset retry counter so new
    // principal gets a fresh set of MAX_ADMIN_RETRIES attempts.
    retryCountRef.current = 0;
  }
  principalRef.current = principal;
  identityRef.current = identity;

  useEffect(() => {
    // ── Unauthenticated path ──────────────────────────────────────────────
    // NOTE: We check principalText only — NOT isAuthenticated.
    // isAuthenticated can flicker false transiently during the
    // useInternetIdentity double-init cycle while principalText remains valid.
    // Keying on principalText being null/empty is the only reliable signal
    // that the user is genuinely logged out.
    if (!principalText || !principalRef.current) {
      // principalText is null — user is genuinely logged out (no principal).
      if (isAdminConfirmedRef.current) {
        // Explicitly logged out — clear everything.
        isAdminConfirmedRef.current = false;
        isCheckingRef.current = false;
        retryCountRef.current = 0;
        setIsAdmin(false);
        setUsername(null);
      }
      return;
    }

    // ── Already confirmed admin (survives remounts) ───────────────────────
    // isAdminConfirmedRef persists across React state flushes.
    // BUG 4 FIX: ALWAYS call setIsAdmin(true) here — do not just return.
    // React resets state to false on remount; the ref must restore it.
    if (isAdminConfirmedRef.current) {
      setIsAdmin(true);
      return;
    }

    // ── In-flight guard ───────────────────────────────────────────────────
    if (isCheckingRef.current) {
      return;
    }
    isCheckingRef.current = true;

    let cancelled = false;

    console.log(
      "[Auth] Checking isAdmin for principal:",
      `${principalText.slice(0, 12)}…`,
      retryCounter > 0 ? `(retry ${retryCounter}/${MAX_ADMIN_RETRIES})` : "",
    );

    void (async () => {
      try {
        const currentIdentity = identityRef.current;
        const actor = await createActorWithConfig(
          currentIdentity ? { identity: currentIdentity } : undefined,
        );
        const result = await actor.isAdmin(principalRef.current!);

        if (cancelled) {
          isCheckingRef.current = false;
          return;
        }

        console.log(
          `[Auth] isAdmin(${principalText.slice(0, 12)}…) => ${result}`,
        );

        if (result === true) {
          // Lock in for the session — ref survives remounts
          isAdminConfirmedRef.current = true;
          retryCountRef.current = 0;
          isCheckingRef.current = false;
          setIsAdmin(true);
        } else {
          // Not admin yet — canister may be cold, or not an admin.
          // Schedule retry so cold-start false results self-correct.
          isCheckingRef.current = false;
          if (retryCountRef.current < MAX_ADMIN_RETRIES) {
            retryCountRef.current += 1;
            console.log(
              `[Auth] isAdmin returned false — retry ${retryCountRef.current}/${MAX_ADMIN_RETRIES} in ${ADMIN_RETRY_DELAY_MS}ms`,
            );
            setTimeout(() => {
              // BUG 5 FIX: Never call setIsAdmin(false) here. Only bump the
              // retry counter so the effect re-runs and tries again.
              if (!cancelled) setRetryCounter((c) => c + 1);
            }, ADMIN_RETRY_DELAY_MS);
          }
        }

        // Fetch username for any authenticated user, regardless of admin status.
        // Reuse the same actor — no extra construction needed.
        if (!cancelled) {
          try {
            const usernameResult = await actor.getMyUsername();
            if (!cancelled) {
              const resolvedUsername =
                Array.isArray(usernameResult) && usernameResult.length > 0
                  ? usernameResult[0]
                  : (usernameResult ?? null);
              console.log(
                `[Auth] getMyUsername() resolved → ${resolvedUsername}`,
              );
              setUsername(resolvedUsername as string | null);
            }
          } catch (usernameErr) {
            console.warn("[Auth] getMyUsername() failed:", usernameErr);
          }
        }
      } catch (err) {
        if (!cancelled) {
          console.warn("[Auth] isAdmin check error:", err);
          isCheckingRef.current = false;
          if (retryCountRef.current < MAX_ADMIN_RETRIES) {
            retryCountRef.current += 1;
            console.log(
              `[Auth] isAdmin error — retry ${retryCountRef.current}/${MAX_ADMIN_RETRIES} in ${ADMIN_RETRY_DELAY_MS}ms`,
            );
            setTimeout(() => {
              if (!cancelled) setRetryCounter((c) => c + 1);
            }, ADMIN_RETRY_DELAY_MS);
          }
        } else {
          isCheckingRef.current = false;
        }
      }
    })();

    return () => {
      cancelled = true;
      // BUG 3 / BUG 1 FIX: Reset isCheckingRef on cleanup so the NEXT run of
      // this effect (e.g. triggered by retryCounter bump) is not permanently
      // blocked by the in-flight guard. Without this reset, if the effect
      // cleanup fires before the async call resolves, isCheckingRef stays true
      // and every subsequent retry run is a no-op.
      isCheckingRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [principalText, retryCounter]);

  return {
    isAuthenticated,
    principal,
    identity: isAuthenticated ? identity! : null,
    isAdmin,
    username,
    login,
    logout: clear,
    isLoggingIn,
    isInitializing,
    isLoginSuccess,
    isLoginError,
  };
}
