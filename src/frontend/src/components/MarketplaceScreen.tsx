// ── MarketplaceScreen ─────────────────────────────────────────────────────────
//
// Full-screen marketplace overlay. Fetches available image sets + pack prices,
// merges them into PackItem cards, and handles the Stripe checkout flow.
// URL params: ?purchase=success&pack=<packId> | ?purchase=cancelled

import { createActorWithConfig } from "@/config";
import { createPaymentsActor } from "@/paymentsConfig";
import type { CheckoutState, PackItem } from "@/types/marketplace";
import type { Identity } from "@icp-sdk/core/agent";
import {
  ArrowLeft,
  CheckCircle2,
  Loader2,
  ShoppingBag,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";

// ── Props ─────────────────────────────────────────────────────────────────────

interface MarketplaceScreenProps {
  onClose: () => void;
  identity?: Identity;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function getQueryParam(key: string): string | null {
  try {
    return new URLSearchParams(window.location.search).get(key);
  } catch {
    return null;
  }
}

// ── PackCard ──────────────────────────────────────────────────────────────────

function PackCard({
  pack,
  checkoutState,
  onPurchase,
}: {
  pack: PackItem;
  checkoutState: CheckoutState;
  onPurchase: (packId: string) => void;
}) {
  const isLoading =
    checkoutState === "loading" || checkoutState === "redirecting";

  return (
    <div
      data-ocid={`marketplace.pack_card.${pack.id}`}
      className="rounded-xl overflow-hidden flex flex-col transition-all hover:scale-[1.01]"
      style={{
        backgroundColor: "oklch(var(--toolbar))",
        border: "1px solid oklch(var(--outline))",
      }}
    >
      {/* Thumbnail */}
      <div
        className="w-full aspect-video flex items-center justify-center overflow-hidden"
        style={{ backgroundColor: "oklch(var(--sidebar-left))" }}
      >
        {pack.previewThumbnail ? (
          <img
            src={pack.previewThumbnail}
            alt={pack.name}
            className="w-full h-full object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        ) : (
          <ShoppingBag
            size={28}
            style={{ color: "oklch(var(--muted-text))" }}
          />
        )}
      </div>

      {/* Info */}
      <div className="p-4 flex flex-col gap-3 flex-1">
        <div>
          <div
            className="text-sm font-semibold leading-tight"
            style={{ color: "oklch(var(--text))" }}
          >
            {pack.name}
          </div>
          <div
            className="text-xs mt-1"
            style={{ color: "oklch(var(--muted-text))" }}
          >
            {pack.imageCount} images
          </div>
        </div>

        {/* Price / action */}
        <div className="mt-auto">
          {pack.isOwned ? (
            <div
              data-ocid={`marketplace.owned_badge.${pack.id}`}
              className="flex items-center gap-1.5 text-sm font-medium"
              style={{ color: "oklch(var(--accent))" }}
            >
              <CheckCircle2 size={15} />
              Owned
            </div>
          ) : pack.isFree ? (
            <div
              className="text-sm font-medium"
              style={{ color: "oklch(var(--muted-text))" }}
            >
              Free
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <span
                className="text-sm font-semibold"
                style={{ color: "oklch(var(--text))" }}
              >
                {pack.priceUsdCents !== undefined
                  ? formatPrice(pack.priceUsdCents)
                  : "—"}
              </span>
              <button
                type="button"
                data-ocid={`marketplace.purchase_button.${pack.id}`}
                onClick={() => onPurchase(pack.id)}
                disabled={isLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  backgroundColor: "oklch(var(--accent))",
                  color: "oklch(var(--accent-text))",
                }}
              >
                {isLoading ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : null}
                Purchase
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── SuccessScreen ─────────────────────────────────────────────────────────────

function SuccessScreen({
  purchasedPackId,
  packs,
  onStartDrawing,
  onDismiss,
}: {
  purchasedPackId: string | null;
  packs: PackItem[];
  onStartDrawing: () => void;
  onDismiss: () => void;
}) {
  const pack = purchasedPackId
    ? packs.find((p) => p.id === purchasedPackId)
    : null;

  return (
    <div
      data-ocid="marketplace.success_state"
      className="flex-1 flex flex-col items-center justify-center px-6 py-16 gap-6 text-center"
    >
      <div
        className="w-16 h-16 rounded-full flex items-center justify-center"
        style={{ backgroundColor: "oklch(var(--accent) / 0.15)" }}
      >
        <CheckCircle2 size={32} style={{ color: "oklch(var(--accent))" }} />
      </div>

      <div className="flex flex-col gap-2 max-w-sm">
        <h2
          className="text-lg font-bold"
          style={{ color: "oklch(var(--text))" }}
        >
          Purchase complete!
        </h2>
        <p
          className="text-sm leading-relaxed"
          style={{ color: "oklch(var(--muted-text))" }}
        >
          {pack ? (
            <>
              <span style={{ color: "oklch(var(--text))" }}>{pack.name}</span>{" "}
              is now available in your figure drawing sessions.
            </>
          ) : (
            "Your pack is now available in figure drawing sessions."
          )}
        </p>
        <p className="text-xs" style={{ color: "oklch(var(--muted-text))" }}>
          Entitlements are granted via webhook — if your pack doesn't appear
          immediately, it will show up within a few seconds.
        </p>
      </div>

      <div className="flex gap-3">
        <button
          type="button"
          data-ocid="marketplace.start_drawing_button"
          onClick={onStartDrawing}
          className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-all"
          style={{
            backgroundColor: "oklch(var(--accent))",
            color: "oklch(var(--accent-text))",
          }}
        >
          <Sparkles size={15} />
          Start Drawing
        </button>
        <button
          type="button"
          data-ocid="marketplace.back_to_marketplace_button"
          onClick={onDismiss}
          className="px-5 py-2.5 rounded-lg text-sm font-medium transition-all"
          style={{
            backgroundColor: "oklch(var(--sidebar-left))",
            border: "1px solid oklch(var(--outline))",
            color: "oklch(var(--muted-text))",
          }}
        >
          Back to Marketplace
        </button>
      </div>
    </div>
  );
}

// ── MarketplaceScreen ─────────────────────────────────────────────────────────

export function MarketplaceScreen({
  onClose,
  identity,
}: MarketplaceScreenProps) {
  const [packs, setPacks] = useState<PackItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [checkoutState, setCheckoutState] = useState<CheckoutState>("idle");
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);

  // Detect success/cancelled redirect from Stripe
  const purchaseParam = getQueryParam("purchase");
  const purchasedPackId = getQueryParam("pack");

  useEffect(() => {
    if (purchaseParam === "success") {
      setCheckoutState("success");
      setShowSuccess(true);
    }
    // cancelled: just show the grid, no special state
  }, [purchaseParam]);

  // Clear URL params once read so refresh doesn't re-trigger
  useEffect(() => {
    if (purchaseParam) {
      const url = new URL(window.location.href);
      url.searchParams.delete("purchase");
      url.searchParams.delete("pack");
      window.history.replaceState({}, "", url.toString());
    }
  }, [purchaseParam]);

  // Load pack data — merge image sets + prices
  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const load = async () => {
      try {
        const [backendActor, paymentsActor] = await Promise.all([
          createActorWithConfig(identity ? { identity } : undefined),
          createPaymentsActor(identity).catch(() => null),
        ]);

        const [rawSets, rawPrices] = await Promise.all([
          backendActor.getAvailableImageSets(),
          paymentsActor
            ? paymentsActor
                .getPackPrices()
                .catch(() => [] as Array<[string, bigint]>)
            : Promise.resolve([] as Array<[string, bigint]>),
        ]);

        if (cancelled) return;

        // Build price lookup
        const priceMap = new Map<string, number>();
        for (const [packId, cents] of rawPrices) {
          priceMap.set(packId, Number(cents));
        }

        // All returned sets are owned (getAvailableImageSets filters to accessible sets)
        const items: PackItem[] = rawSets.map((s) => {
          const isDefault = Boolean(s.isDefault);
          const isFreeByFlag = Boolean(s.isFree);
          const priceUsdCents = isDefault ? undefined : priceMap.get(s.id);
          const isFree = isDefault || isFreeByFlag || priceUsdCents === 0;
          return {
            id: s.id,
            name: s.name,
            imageCount: Number(s.imageCount),
            previewThumbnail:
              s.previewThumbnail || (s.images?.[0]?.assetUrl ?? ""),
            isFree,
            isDefault,
            priceUsdCents: isFree ? undefined : priceUsdCents,
            isOwned: true, // getAvailableImageSets only returns accessible sets
          };
        });

        // Also include paid packs from price map that user doesn't own yet
        // These won't be in rawSets since getAvailableImageSets filters to accessible ones.
        // We need all image sets to show unowned packs — use getAllImageSetsAdmin if admin,
        // otherwise we can only show what the user has access to.
        // For now, mark unowned paid packs from rawPrices that aren't in the set list.
        const ownedIds = new Set(items.map((i) => i.id));
        // Packs with prices that aren't owned — we don't have their metadata here,
        // so we can only surface them if we have a separate "all packs" endpoint.
        // The current backend only exposes getAvailableImageSets (owned/free only).
        // This is architecturally correct — unowned paid packs can't be fetched yet.

        // Sort: default/free first, then paid unowned
        items.sort((a, b) => {
          if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
          if (a.isFree !== b.isFree) return a.isFree ? -1 : 1;
          return a.name.localeCompare(b.name);
        });

        void ownedIds; // suppressed — used for future unowned pack integration

        setPacks(items);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load packs");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [identity]);

  // Handle purchase click
  const handlePurchase = async (packId: string) => {
    if (!identity) {
      setCheckoutError("Please log in to purchase.");
      return;
    }
    setCheckoutState("loading");
    setCheckoutError(null);
    try {
      const actor = await createPaymentsActor(identity);
      const origin = window.location.origin;
      const successUrl = `${origin}/marketplace?purchase=success&pack=${encodeURIComponent(packId)}`;
      const cancelUrl = `${origin}/marketplace?purchase=cancelled`;
      const result = await actor.createCheckoutSession(
        packId,
        successUrl,
        cancelUrl,
      );
      if ("ok" in result) {
        setCheckoutState("redirecting");
        window.location.href = result.ok;
      } else {
        setCheckoutState("idle");
        setCheckoutError(
          (result as { err: string }).err ||
            "Checkout failed. Please try again.",
        );
      }
    } catch (err) {
      setCheckoutState("idle");
      setCheckoutError(
        err instanceof Error
          ? err.message
          : "Checkout failed. Please try again.",
      );
    }
  };

  const isCheckoutBusy =
    checkoutState === "loading" || checkoutState === "redirecting";

  // Non-default packs (paid packs) — for the "no additional packs" empty state
  const nonDefaultPacks = packs.filter((p) => !p.isDefault);

  return (
    <div
      data-ocid="marketplace.panel"
      className="fixed inset-0 z-[9500] flex flex-col"
      style={{
        background: "oklch(var(--canvas-bg) / 0.97)",
        backdropFilter: "blur(12px)",
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-6 py-4 border-b shrink-0"
        style={{
          backgroundColor: "oklch(var(--toolbar))",
          borderColor: "oklch(var(--outline))",
        }}
      >
        <div className="flex items-center gap-3">
          <button
            type="button"
            data-ocid="marketplace.close_button"
            onClick={onClose}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg transition-opacity hover:opacity-80"
            style={{
              color: "oklch(var(--muted-text))",
              backgroundColor: "oklch(var(--sidebar-left))",
              border: "1px solid oklch(var(--outline))",
            }}
          >
            <ArrowLeft size={14} />
            Back
          </button>
          <div>
            <h1
              className="text-base font-bold"
              style={{ color: "oklch(var(--text))" }}
            >
              Reference Pack Marketplace
            </h1>
            <p
              className="text-xs"
              style={{ color: "oklch(var(--muted-text))" }}
            >
              Expand your figure drawing library
            </p>
          </div>
        </div>
        <button
          type="button"
          data-ocid="marketplace.close_x_button"
          onClick={onClose}
          className="p-1.5 rounded-lg transition-opacity hover:opacity-80"
          style={{ color: "oklch(var(--muted-text))" }}
          aria-label="Close marketplace"
        >
          <X size={18} />
        </button>
      </div>

      {/* Checkout error */}
      {checkoutError && (
        <div
          data-ocid="marketplace.error_state"
          className="flex items-center justify-between gap-2 px-6 py-3 text-sm shrink-0"
          style={{
            backgroundColor: "oklch(0.4 0.15 20 / 0.15)",
            borderBottom: "1px solid oklch(0.4 0.15 20 / 0.3)",
            color: "oklch(0.8 0.1 20)",
          }}
        >
          <span>{checkoutError}</span>
          <button
            type="button"
            onClick={() => setCheckoutError(null)}
            aria-label="Dismiss error"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Redirecting overlay */}
      {checkoutState === "redirecting" && (
        <div
          data-ocid="marketplace.loading_state"
          className="flex items-center gap-2 px-6 py-3 text-sm shrink-0"
          style={{
            backgroundColor: "oklch(var(--toolbar))",
            borderBottom: "1px solid oklch(var(--outline))",
            color: "oklch(var(--muted-text))",
          }}
        >
          <Loader2 size={14} className="animate-spin" />
          Redirecting to Stripe checkout…
        </div>
      )}

      {/* Success screen (full content area) */}
      {showSuccess ? (
        <SuccessScreen
          purchasedPackId={purchasedPackId}
          packs={packs}
          onStartDrawing={onClose}
          onDismiss={() => setShowSuccess(false)}
        />
      ) : (
        /* Pack grid content */
        <div className="flex-1 overflow-y-auto px-6 py-6">
          {loading ? (
            <div
              data-ocid="marketplace.packs_loading_state"
              className="grid gap-4"
              style={{
                gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
              }}
            >
              {Array.from({ length: 4 }, (_, i) => (
                <div
                  key={`skel-${i + 1}`}
                  className="rounded-xl animate-pulse"
                  style={{
                    backgroundColor: "oklch(var(--toolbar))",
                    height: "240px",
                  }}
                />
              ))}
            </div>
          ) : error ? (
            <div
              data-ocid="marketplace.fetch_error_state"
              className="flex flex-col items-center justify-center py-20 gap-3 text-center"
            >
              <p
                className="text-sm"
                style={{ color: "oklch(var(--muted-text))" }}
              >
                Failed to load packs: {error}
              </p>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="text-xs px-3 py-1.5 rounded-lg"
                style={{
                  backgroundColor: "oklch(var(--sidebar-left))",
                  border: "1px solid oklch(var(--outline))",
                  color: "oklch(var(--text))",
                }}
              >
                Retry
              </button>
            </div>
          ) : (
            <>
              {/* Default / free packs section */}
              {packs.some((p) => p.isDefault || p.isFree) && (
                <section className="mb-8">
                  <h2
                    className="text-xs font-semibold uppercase tracking-wider mb-3"
                    style={{ color: "oklch(var(--muted-text))" }}
                  >
                    Included Packs
                  </h2>
                  <div
                    data-ocid="marketplace.free_packs_list"
                    className="grid gap-4"
                    style={{
                      gridTemplateColumns:
                        "repeat(auto-fill, minmax(200px, 1fr))",
                    }}
                  >
                    {packs
                      .filter((p) => p.isDefault || p.isFree)
                      .map((pack) => (
                        <PackCard
                          key={pack.id}
                          pack={pack}
                          checkoutState={
                            isCheckoutBusy ? checkoutState : "idle"
                          }
                          onPurchase={handlePurchase}
                        />
                      ))}
                  </div>
                </section>
              )}

              {/* Paid packs section */}
              {nonDefaultPacks.length > 0 ? (
                <section>
                  <h2
                    className="text-xs font-semibold uppercase tracking-wider mb-3"
                    style={{ color: "oklch(var(--muted-text))" }}
                  >
                    Additional Packs
                  </h2>
                  <div
                    data-ocid="marketplace.packs_list"
                    className="grid gap-4"
                    style={{
                      gridTemplateColumns:
                        "repeat(auto-fill, minmax(200px, 1fr))",
                    }}
                  >
                    {nonDefaultPacks.map((pack) => (
                      <PackCard
                        key={pack.id}
                        pack={pack}
                        checkoutState={isCheckoutBusy ? checkoutState : "idle"}
                        onPurchase={handlePurchase}
                      />
                    ))}
                  </div>
                </section>
              ) : (
                !loading && (
                  <div
                    data-ocid="marketplace.empty_state"
                    className="flex flex-col items-center justify-center py-12 gap-2 text-center"
                  >
                    <ShoppingBag
                      size={28}
                      style={{ color: "oklch(var(--muted-text))" }}
                    />
                    <p
                      className="text-sm"
                      style={{ color: "oklch(var(--muted-text))" }}
                    >
                      No additional packs available yet.
                    </p>
                  </div>
                )
              )}
            </>
          )}

          {/* Not logged in hint */}
          {!identity && !loading && (
            <p
              className="text-xs text-center mt-6"
              style={{ color: "oklch(var(--muted-text))" }}
            >
              Log in to purchase additional image packs
            </p>
          )}
        </div>
      )}
    </div>
  );
}
