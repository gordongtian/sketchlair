// ── ProfileScreen ─────────────────────────────────────────────────────────────
//
// Full-screen account overlay. Shows subscription status and management.
// Matches the dark design system used throughout SketchLair.

import { useSubscriptionStatus } from "@/hooks/useSubscriptionStatus";
import type { Identity } from "@icp-sdk/core/agent";
import {
  AlertTriangle,
  ArrowLeft,
  Calendar,
  CheckCircle2,
  CreditCard,
  ExternalLink,
  Loader2,
  ShoppingBag,
  User,
  X,
} from "lucide-react";
import { useState } from "react";

// ── Props ─────────────────────────────────────────────────────────────────────

interface ProfileScreenProps {
  identity: Identity;
  onClose: () => void;
  onShowMarketplace: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function formatPrincipal(identity: Identity): string {
  try {
    const text = identity.getPrincipal().toText();
    if (text.length > 24) {
      return `${text.slice(0, 10)}…${text.slice(-8)}`;
    }
    return text;
  } catch {
    return "Unknown";
  }
}

// ── ConfirmCancelDialog ───────────────────────────────────────────────────────

function ConfirmCancelDialog({
  expiryDateMs,
  onConfirm,
  onDismiss,
  isLoading,
}: {
  expiryDateMs: number | null;
  onConfirm: () => void;
  onDismiss: () => void;
  isLoading: boolean;
}) {
  return (
    <div
      data-ocid="profile.cancel_dialog"
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.7)" }}
    >
      <div
        className="relative w-full max-w-md mx-4 rounded-2xl p-6 flex flex-col gap-5"
        style={{
          backgroundColor: "oklch(var(--toolbar))",
          border: "1px solid oklch(var(--outline))",
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
        }}
      >
        {/* Warning icon */}
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: "oklch(0.55 0.22 25 / 0.15)" }}
          >
            <AlertTriangle size={20} style={{ color: "oklch(0.65 0.22 30)" }} />
          </div>
          <h3
            className="text-base font-semibold"
            style={{ color: "oklch(var(--text))" }}
          >
            Cancel Subscription?
          </h3>
        </div>

        <p
          className="text-sm leading-relaxed"
          style={{ color: "oklch(var(--muted-text))" }}
        >
          {expiryDateMs != null ? (
            <>
              You'll keep full access to all subscriber content until{" "}
              <span style={{ color: "oklch(var(--text))" }}>
                {formatDate(expiryDateMs)}
              </span>
              . After that date, subscriber-only content will no longer be
              accessible.
            </>
          ) : (
            "Your subscription will be cancelled and subscriber-only content will no longer be accessible."
          )}
        </p>

        <div className="flex gap-3 justify-end">
          <button
            type="button"
            data-ocid="profile.cancel_dialog.keep_button"
            onClick={onDismiss}
            disabled={isLoading}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-all disabled:opacity-50"
            style={{
              backgroundColor: "oklch(var(--sidebar-left))",
              border: "1px solid oklch(var(--outline))",
              color: "oklch(var(--text))",
            }}
          >
            Keep Subscription
          </button>
          <button
            type="button"
            data-ocid="profile.cancel_dialog.confirm_button"
            onClick={onConfirm}
            disabled={isLoading}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              backgroundColor: "oklch(0.55 0.22 25)",
              color: "oklch(0.95 0.01 30)",
            }}
          >
            {isLoading ? <Loader2 size={14} className="animate-spin" /> : null}
            Confirm Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ── SubscriptionSection ───────────────────────────────────────────────────────

function SubscriptionSection({
  onShowMarketplace,
}: {
  onShowMarketplace: () => void;
}) {
  const { active, expiryDateMs, loading, refetch } = useSubscriptionStatus();
  const [showConfirm, setShowConfirm] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelResult, setCancelResult] = useState<
    "cancelled" | "error" | null
  >(null);
  const [cancelError, setCancelError] = useState<string | null>(null);

  // Determine if we're in a grace period: subscription cancelled but expiry in future
  const now = Date.now();
  const inGracePeriod = !active && expiryDateMs != null && expiryDateMs > now;

  const handleConfirmCancel = async () => {
    setCancelling(true);
    setCancelError(null);
    try {
      // cancelSubscription is not yet available on the backend.
      // Direct the user to manage via Stripe dashboard.
      throw new Error("not_implemented");
    } catch (err) {
      const isNotImpl =
        err instanceof Error && err.message === "not_implemented";
      if (isNotImpl) {
        // Show Stripe management instructions
        setCancelResult("cancelled");
      } else {
        setCancelResult("error");
        setCancelError(
          err instanceof Error ? err.message : "An unknown error occurred.",
        );
      }
    } finally {
      setCancelling(false);
      setShowConfirm(false);
      refetch();
    }
  };

  // ── Loading state ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div
        data-ocid="profile.subscription_loading_state"
        className="flex items-center gap-3 py-4"
      >
        <Loader2
          size={18}
          className="animate-spin"
          style={{ color: "oklch(var(--accent))" }}
        />
        <span className="text-sm" style={{ color: "oklch(var(--muted-text))" }}>
          Loading subscription status…
        </span>
      </div>
    );
  }

  // ── Post-cancel success (no backend endpoint yet) ──────────────────────────
  if (cancelResult === "cancelled") {
    return (
      <div
        data-ocid="profile.subscription_cancelled_success"
        className="flex flex-col gap-4"
      >
        <div
          className="rounded-xl p-4 flex flex-col gap-3"
          style={{
            backgroundColor: "oklch(var(--sidebar-left))",
            border: "1px solid oklch(var(--outline))",
          }}
        >
          <p
            className="text-sm font-medium"
            style={{ color: "oklch(var(--text))" }}
          >
            To cancel your subscription, please visit the Stripe customer
            portal.
          </p>
          <p
            className="text-sm leading-relaxed"
            style={{ color: "oklch(var(--muted-text))" }}
          >
            You can manage billing, update payment methods, and cancel recurring
            charges directly from the Stripe dashboard.
            {expiryDateMs != null && (
              <>
                {" "}
                Your access will remain active until{" "}
                <span style={{ color: "oklch(var(--text))" }}>
                  {formatDate(expiryDateMs)}
                </span>
                .
              </>
            )}
          </p>
          <a
            href="https://billing.stripe.com/p/login"
            target="_blank"
            rel="noopener noreferrer"
            data-ocid="profile.stripe_portal_link"
            className="inline-flex items-center gap-1.5 text-sm font-semibold"
            style={{ color: "oklch(var(--accent))" }}
          >
            <ExternalLink size={14} />
            Open Stripe Customer Portal
          </a>
        </div>
        <button
          type="button"
          data-ocid="profile.back_to_subscription_button"
          onClick={() => {
            setCancelResult(null);
            refetch();
          }}
          className="self-start text-xs px-3 py-1.5 rounded-lg transition-all"
          style={{
            backgroundColor: "oklch(var(--sidebar-left))",
            border: "1px solid oklch(var(--outline))",
            color: "oklch(var(--muted-text))",
          }}
        >
          Back
        </button>
      </div>
    );
  }

  // ── Error state ────────────────────────────────────────────────────────────
  if (cancelResult === "error") {
    return (
      <div
        data-ocid="profile.subscription_error_state"
        className="flex flex-col gap-3"
      >
        <p className="text-sm" style={{ color: "oklch(0.65 0.22 30)" }}>
          Failed to cancel subscription: {cancelError}
        </p>
        <button
          type="button"
          data-ocid="profile.retry_button"
          onClick={() => {
            setCancelResult(null);
            setCancelError(null);
          }}
          className="self-start text-xs px-3 py-1.5 rounded-lg transition-all"
          style={{
            backgroundColor: "oklch(var(--sidebar-left))",
            border: "1px solid oklch(var(--outline))",
            color: "oklch(var(--text))",
          }}
        >
          Try Again
        </button>
      </div>
    );
  }

  // ── Active subscription ────────────────────────────────────────────────────
  if (active) {
    return (
      <>
        {showConfirm && (
          <ConfirmCancelDialog
            expiryDateMs={expiryDateMs}
            onConfirm={handleConfirmCancel}
            onDismiss={() => setShowConfirm(false)}
            isLoading={cancelling}
          />
        )}
        <div
          data-ocid="profile.subscription_active_state"
          className="rounded-xl p-4 flex flex-col gap-4"
          style={{
            backgroundColor: "oklch(var(--sidebar-left))",
            border: "1px solid oklch(var(--accent) / 0.3)",
          }}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: "oklch(var(--accent) / 0.15)" }}
              >
                <CheckCircle2
                  size={18}
                  style={{ color: "oklch(var(--accent))" }}
                />
              </div>
              <div>
                <div
                  className="text-sm font-semibold"
                  style={{ color: "oklch(var(--text))" }}
                >
                  Subscription Active
                </div>
                {expiryDateMs != null && (
                  <div
                    className="flex items-center gap-1 text-xs mt-0.5"
                    style={{ color: "oklch(var(--muted-text))" }}
                  >
                    <Calendar size={11} />
                    Renews {formatDate(expiryDateMs)}
                  </div>
                )}
              </div>
            </div>

            <button
              type="button"
              data-ocid="profile.cancel_subscription_button"
              onClick={() => setShowConfirm(true)}
              className="flex-shrink-0 text-xs px-3 py-1.5 rounded-lg font-medium transition-all"
              style={{
                backgroundColor: "oklch(0.55 0.22 25 / 0.15)",
                border: "1px solid oklch(0.55 0.22 25 / 0.4)",
                color: "oklch(0.7 0.18 30)",
              }}
            >
              Cancel Subscription
            </button>
          </div>

          <p className="text-xs" style={{ color: "oklch(var(--muted-text))" }}>
            You have access to all subscriber content in the Learn module and
            reference packs.
          </p>
        </div>
      </>
    );
  }

  // ── Grace period (cancelled, still has access) ─────────────────────────────
  if (inGracePeriod && expiryDateMs != null) {
    return (
      <div
        data-ocid="profile.subscription_grace_period_state"
        className="rounded-xl p-4 flex flex-col gap-4"
        style={{
          backgroundColor: "oklch(var(--sidebar-left))",
          border: "1px solid oklch(0.6 0.15 60 / 0.4)",
        }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: "oklch(0.6 0.15 60 / 0.12)" }}
          >
            <Calendar size={18} style={{ color: "oklch(0.7 0.14 65)" }} />
          </div>
          <div>
            <div
              className="text-sm font-semibold"
              style={{ color: "oklch(var(--text))" }}
            >
              Subscription Cancelled
            </div>
            <div
              className="text-xs mt-0.5"
              style={{ color: "oklch(0.7 0.14 65)" }}
            >
              Access ends {formatDate(expiryDateMs)}
            </div>
          </div>
        </div>
        <p className="text-xs" style={{ color: "oklch(var(--muted-text))" }}>
          Subscriber content remains available until your billing period ends.
          Resubscribe anytime to restore full access.
        </p>
        <button
          type="button"
          data-ocid="profile.resubscribe_button"
          onClick={onShowMarketplace}
          className="self-start flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all"
          style={{
            backgroundColor: "oklch(var(--accent))",
            color: "oklch(var(--accent-text))",
          }}
        >
          <ShoppingBag size={14} />
          Resubscribe
        </button>
      </div>
    );
  }

  // ── No subscription ────────────────────────────────────────────────────────
  return (
    <div
      data-ocid="profile.no_subscription_state"
      className="rounded-xl p-4 flex flex-col gap-4"
      style={{
        backgroundColor: "oklch(var(--sidebar-left))",
        border: "1px solid oklch(var(--outline))",
      }}
    >
      <div className="flex items-center gap-3">
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: "oklch(var(--sidebar-item))" }}
        >
          <CreditCard size={18} style={{ color: "oklch(var(--muted-text))" }} />
        </div>
        <div>
          <div
            className="text-sm font-semibold"
            style={{ color: "oklch(var(--text))" }}
          >
            No Active Subscription
          </div>
          <div
            className="text-xs mt-0.5"
            style={{ color: "oklch(var(--muted-text))" }}
          >
            Subscribe to unlock all modules and reference packs
          </div>
        </div>
      </div>
      <button
        type="button"
        data-ocid="profile.browse_plans_button"
        onClick={onShowMarketplace}
        className="self-start flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all"
        style={{
          backgroundColor: "oklch(var(--accent))",
          color: "oklch(var(--accent-text))",
        }}
      >
        <ShoppingBag size={14} />
        Browse Plans
      </button>
    </div>
  );
}

// ── ProfileScreen ─────────────────────────────────────────────────────────────

export function ProfileScreen({
  identity,
  onClose,
  onShowMarketplace,
}: ProfileScreenProps) {
  return (
    <div
      data-ocid="profile.page"
      className="fixed inset-0 z-[9990] flex flex-col"
      style={{ backgroundColor: "oklch(var(--canvas-bg))" }}
    >
      {/* Header */}
      <header
        className="flex items-center gap-3 px-5 py-4 flex-shrink-0"
        style={{
          backgroundColor: "oklch(var(--toolbar))",
          borderBottom: "1px solid oklch(var(--outline))",
        }}
      >
        <button
          type="button"
          data-ocid="profile.close_button"
          onClick={onClose}
          className="flex items-center justify-center w-8 h-8 rounded-lg transition-all"
          aria-label="Go back"
          style={{
            backgroundColor: "oklch(var(--sidebar-item))",
            border: "1px solid oklch(var(--outline))",
            color: "oklch(var(--muted-text))",
          }}
        >
          <ArrowLeft size={16} />
        </button>

        <h1
          className="text-base font-semibold"
          style={{ color: "oklch(var(--text))" }}
        >
          Your Account
        </h1>

        <button
          type="button"
          data-ocid="profile.close_x_button"
          onClick={onClose}
          className="ml-auto flex items-center justify-center w-8 h-8 rounded-lg transition-all"
          aria-label="Close profile"
          style={{
            backgroundColor: "oklch(var(--sidebar-item))",
            border: "1px solid oklch(var(--outline))",
            color: "oklch(var(--muted-text))",
          }}
        >
          <X size={16} />
        </button>
      </header>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-5 py-8 flex flex-col gap-8">
          {/* Account identity card */}
          <section data-ocid="profile.identity_section">
            <div
              className="rounded-xl p-4 flex items-center gap-4"
              style={{
                backgroundColor: "oklch(var(--toolbar))",
                border: "1px solid oklch(var(--outline))",
              }}
            >
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: "oklch(var(--accent) / 0.15)" }}
              >
                <User size={22} style={{ color: "oklch(var(--accent))" }} />
              </div>
              <div className="flex flex-col min-w-0">
                <span
                  className="text-sm font-semibold"
                  style={{ color: "oklch(var(--text))" }}
                >
                  Internet Identity
                </span>
                <span
                  className="text-xs font-mono truncate mt-0.5"
                  style={{ color: "oklch(var(--muted-text))" }}
                  title={identity.getPrincipal().toText()}
                >
                  {formatPrincipal(identity)}
                </span>
              </div>
            </div>
          </section>

          {/* Subscription section */}
          <section data-ocid="profile.subscription_section">
            <h2
              className="text-xs font-semibold uppercase tracking-wider mb-3"
              style={{ color: "oklch(var(--muted-text))" }}
            >
              Subscription
            </h2>
            <SubscriptionSection onShowMarketplace={onShowMarketplace} />
          </section>

          {/* Purchases section (deferred) */}
          <section data-ocid="profile.purchases_section">
            <h2
              className="text-xs font-semibold uppercase tracking-wider mb-3"
              style={{ color: "oklch(var(--muted-text))" }}
            >
              Purchases
            </h2>
            <div
              className="rounded-xl p-4"
              style={{
                backgroundColor: "oklch(var(--toolbar))",
                border: "1px solid oklch(var(--outline))",
              }}
            >
              <p
                className="text-sm"
                style={{ color: "oklch(var(--muted-text))" }}
              >
                Manage individual purchases — coming soon.
              </p>
            </div>
          </section>

          {/* Shop link */}
          <section className="flex justify-center pb-4">
            <button
              type="button"
              data-ocid="profile.browse_shop_button"
              onClick={() => {
                onClose();
                onShowMarketplace();
              }}
              className="flex items-center gap-2 text-sm font-medium transition-all"
              style={{ color: "oklch(var(--accent))" }}
            >
              <ShoppingBag size={15} />
              Browse the Shop
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}
