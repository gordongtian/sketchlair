// ── MarketplaceScreen ─────────────────────────────────────────────────────────
//
// Full-screen marketplace overlay.
// Two tabs: Learning Modules | Reference Packs
// Desktop: card grid with expand-in-place detail panel
// Mobile: card grid that navigates to a full-screen detail page
// URL params: ?purchase=success&type=subscription | ?purchase=success&pack=<id> | ?purchase=cancelled

import { useMarketplaceData } from "@/hooks/useMarketplaceData";
import { createPaymentsActor } from "@/paymentsConfig";
import type { CatalogItem, PurchaseType } from "@/types/marketplace";
import type { Identity } from "@icp-sdk/core/agent";
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  ChevronLeft,
  ImageIcon,
  Loader2,
  ShoppingBag,
  Sparkles,
  Star,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

type Tab = "modules" | "packs";
type CheckoutState = "idle" | "loading" | "redirecting";

interface MarketplaceScreenProps {
  identity?: Identity;
  onClose: () => void;
  onPurchaseSuccess: (data: {
    purchaseType: PurchaseType;
    packId?: string;
  }) => void;
  subscriptionActive: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatPrice(cents: number | null, isFree?: boolean): string {
  if (isFree) return "Free";
  if (cents === null) return "--";
  if (cents === 0) return "Free";
  return `${(cents / 100).toFixed(0)} USD`;
}

function formatPriceShort(cents: number | null, isFree?: boolean): string {
  if (isFree) return "Free";
  if (cents === null) return "--";
  if (cents === 0) return "Free";
  return `${(cents / 100).toFixed(0)}`;
}

function getQueryParam(key: string): string | null {
  try {
    return new URLSearchParams(window.location.search).get(key);
  } catch {
    return null;
  }
}

// ── SkeletonCard ──────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div
      className="rounded-xl overflow-hidden animate-pulse"
      style={{
        backgroundColor: "oklch(var(--toolbar))",
        border: "1px solid oklch(var(--outline))",
      }}
    >
      <div
        className="w-full aspect-video"
        style={{ backgroundColor: "oklch(var(--sidebar-left))" }}
      />
      <div className="p-4 flex flex-col gap-2">
        <div
          className="h-3 rounded w-3/4"
          style={{ backgroundColor: "oklch(var(--sidebar-item))" }}
        />
        <div
          className="h-2.5 rounded w-full"
          style={{ backgroundColor: "oklch(var(--sidebar-item))" }}
        />
        <div
          className="h-2.5 rounded w-2/3"
          style={{ backgroundColor: "oklch(var(--sidebar-item))" }}
        />
        <div
          className="h-7 rounded mt-2"
          style={{ backgroundColor: "oklch(var(--sidebar-item))" }}
        />
      </div>
    </div>
  );
}

// ── SubscriberBadge ───────────────────────────────────────────────────────────

function SubscriberBadge() {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold leading-none"
      style={{
        backgroundColor: "oklch(var(--accent) / 0.18)",
        color: "oklch(var(--accent))",
        border: "1px solid oklch(var(--accent) / 0.3)",
      }}
    >
      <Star size={8} />
      Subscription
    </span>
  );
}

// ── OwnedBadge ───────────────────────────────────────────────────────────────

function OwnedBadge({ withSubscription }: { withSubscription?: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold leading-none"
      style={{
        backgroundColor: "oklch(0.4 0.14 145 / 0.18)",
        color: "oklch(0.7 0.14 145)",
        border: "1px solid oklch(0.4 0.14 145 / 0.3)",
      }}
    >
      <CheckCircle2 size={8} />
      {withSubscription ? "Active with Subscription" : "Owned"}
    </span>
  );
}

// ── CatalogCard ───────────────────────────────────────────────────────────────

function CatalogCard({
  item,
  isExpanded,
  onExpand,
  subscriptionActive,
}: {
  item: CatalogItem;
  isExpanded: boolean;
  onExpand: (item: CatalogItem) => void;
  subscriptionActive: boolean;
}) {
  const isUnlocked =
    item.isOwned || (subscriptionActive && item.isSubscriberContent);

  return (
    <button
      type="button"
      data-ocid={`marketplace.card.${item.id}`}
      tabIndex={0}
      onClick={() => onExpand(item)}
      aria-expanded={isExpanded}
      className="rounded-xl overflow-hidden flex flex-col cursor-pointer transition-all duration-200 text-left w-full"
      style={{
        backgroundColor: "oklch(var(--toolbar))",
        border: isExpanded
          ? "1px solid oklch(var(--accent) / 0.7)"
          : "1px solid oklch(var(--outline))",
        boxShadow: isExpanded ? "0 0 0 1px oklch(var(--accent) / 0.2)" : "none",
        background: "none",
        padding: 0,
      }}
    >
      {/* Thumbnail */}
      <div
        className="w-full relative overflow-hidden"
        style={{
          aspectRatio: "4/3",
          backgroundColor: "oklch(var(--sidebar-left))",
        }}
      >
        {item.previewThumbnail ? (
          <img
            src={item.previewThumbnail}
            alt={item.name}
            className="w-full h-full object-cover transition-transform duration-300 hover:scale-105"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            {item.contentType === "learningmodule" ? (
              <BookOpen
                size={28}
                style={{ color: "oklch(var(--muted-text))" }}
              />
            ) : (
              <ImageIcon
                size={28}
                style={{ color: "oklch(var(--muted-text))" }}
              />
            )}
          </div>
        )}
        {/* Subscriber badge overlay */}
        {item.isSubscriberContent && (
          <div className="absolute top-2 left-2">
            <SubscriberBadge />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-3 flex flex-col gap-2 flex-1">
        <div className="flex items-start justify-between gap-2">
          <span
            className="text-sm font-semibold leading-tight line-clamp-1"
            style={{ color: "oklch(var(--text))" }}
          >
            {item.name}
          </span>
          <span
            className="text-xs font-bold shrink-0"
            style={{
              color: item.isFree ? "oklch(0.7 0.14 145)" : "oklch(var(--text))",
            }}
          >
            {item.isFree ? "Free" : formatPriceShort(item.priceUsdCents)}
          </span>
        </div>

        {item.description && (
          <p
            className="text-xs line-clamp-2 leading-relaxed"
            style={{ color: "oklch(var(--muted-text))" }}
          >
            {item.description}
          </p>
        )}

        <div className="mt-auto pt-1">
          {isUnlocked ? (
            <OwnedBadge
              withSubscription={
                subscriptionActive && item.isSubscriberContent && !item.isOwned
              }
            />
          ) : (
            <span className="text-xs" style={{ color: "oklch(var(--accent))" }}>
              {item.isFree ? "Get Free →" : "Buy Now →"}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

// ── PurchaseButtons ───────────────────────────────────────────────────────────

function PurchaseButtons({
  item,
  subscriptionActive,
  checkoutState,
  onBuy,
  onSubscribe,
}: {
  item: CatalogItem;
  subscriptionActive: boolean;
  checkoutState: CheckoutState;
  onBuy: (item: CatalogItem) => void;
  onSubscribe: (item: CatalogItem) => void;
}) {
  const isLoading =
    checkoutState === "loading" || checkoutState === "redirecting";
  const isUnlocked =
    item.isOwned || (subscriptionActive && item.isSubscriberContent);

  if (isUnlocked) {
    return (
      <button
        type="button"
        disabled
        data-ocid="marketplace.owned_button"
        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold opacity-60 cursor-not-allowed"
        style={{
          backgroundColor: "oklch(0.4 0.14 145 / 0.15)",
          color: "oklch(0.7 0.14 145)",
          border: "1px solid oklch(0.4 0.14 145 / 0.3)",
        }}
      >
        <CheckCircle2 size={15} />
        {item.isOwned ? "Already Owned" : "Included with Subscription"}
      </button>
    );
  }

  if (item.isFree) {
    return (
      <button
        type="button"
        data-ocid="marketplace.get_free_button"
        onClick={() => onBuy(item)}
        disabled={isLoading}
        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-all disabled:opacity-50"
        style={{
          backgroundColor: "oklch(var(--accent))",
          color: "oklch(var(--accent-text))",
        }}
      >
        {isLoading && <Loader2 size={14} className="animate-spin" />}
        Get Free
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        data-ocid="marketplace.buy_button"
        onClick={() => onBuy(item)}
        disabled={isLoading}
        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-all disabled:opacity-50"
        style={{
          backgroundColor: "oklch(var(--accent))",
          color: "oklch(var(--accent-text))",
        }}
      >
        {isLoading && <Loader2 size={14} className="animate-spin" />}
        Buy Outright — {formatPrice(item.priceUsdCents, item.isFree)}
      </button>

      {item.isSubscriberContent && !subscriptionActive && (
        <button
          type="button"
          data-ocid="marketplace.subscribe_button"
          onClick={() => onSubscribe(item)}
          disabled={isLoading}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all disabled:opacity-50"
          style={{
            backgroundColor: "oklch(var(--accent) / 0.12)",
            color: "oklch(var(--accent))",
            border: "1px solid oklch(var(--accent) / 0.3)",
          }}
        >
          <Star size={14} />
          {isLoading && <Loader2 size={14} className="animate-spin" />}
          Start Subscription — Unlocks All Content
        </button>
      )}
    </div>
  );
}

// ── DetailPanel (desktop expand-in-place) ──────────────────────────────────────

function DetailPanel({
  item,
  subscriptionActive,
  checkoutState,
  onClose,
  onBuy,
  onSubscribe,
}: {
  item: CatalogItem;
  subscriptionActive: boolean;
  checkoutState: CheckoutState;
  onClose: () => void;
  onBuy: (item: CatalogItem) => void;
  onSubscribe: (item: CatalogItem) => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    // Slight delay so the opening click doesn't immediately close
    const tid = setTimeout(
      () => document.addEventListener("mousedown", handleClick),
      100,
    );
    return () => {
      clearTimeout(tid);
      document.removeEventListener("mousedown", handleClick);
    };
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div
      ref={panelRef}
      data-ocid="marketplace.detail_panel"
      className="absolute z-10 rounded-xl overflow-hidden flex flex-col"
      style={{
        backgroundColor: "oklch(var(--toolbar))",
        border: "1px solid oklch(var(--accent) / 0.5)",
        boxShadow: "0 8px 40px oklch(0 0 0 / 0.6)",
        width: "320px",
        top: 0,
        right: "-336px",
        maxHeight: "90vh",
        overflow: "auto",
      }}
    >
      <button
        type="button"
        data-ocid="marketplace.detail_close_button"
        onClick={onClose}
        aria-label="Close detail"
        className="absolute top-2 right-2 z-10 p-1.5 rounded-lg transition-opacity hover:opacity-70"
        style={{
          backgroundColor: "oklch(var(--sidebar-left))",
          color: "oklch(var(--muted-text))",
        }}
      >
        <X size={14} />
      </button>

      {item.previewThumbnail && (
        <div className="w-full" style={{ aspectRatio: "4/3" }}>
          <img
            src={item.previewThumbnail}
            alt={item.name}
            className="w-full h-full object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        </div>
      )}

      <div className="p-4 flex flex-col gap-4">
        <div>
          <div className="flex items-start gap-2 flex-wrap mb-1">
            {item.isSubscriberContent && <SubscriberBadge />}
            {(item.isOwned ||
              (subscriptionActive && item.isSubscriberContent)) && (
              <OwnedBadge
                withSubscription={
                  subscriptionActive &&
                  item.isSubscriberContent &&
                  !item.isOwned
                }
              />
            )}
          </div>
          <h3
            className="text-base font-bold leading-snug mt-1"
            style={{ color: "oklch(var(--text))" }}
          >
            {item.name}
          </h3>
          {item.priceUsdCents !== null && !item.isFree && (
            <p
              className="text-sm font-semibold mt-0.5"
              style={{ color: "oklch(var(--accent))" }}
            >
              {formatPrice(item.priceUsdCents, item.isFree)}
            </p>
          )}
        </div>

        {item.description && (
          <p
            className="text-sm leading-relaxed"
            style={{ color: "oklch(var(--muted-text))" }}
          >
            {item.description}
          </p>
        )}

        {item.imageCount > 0 && (
          <p className="text-xs" style={{ color: "oklch(var(--muted-text))" }}>
            {item.imageCount}{" "}
            {item.contentType === "learningmodule" ? "lessons" : "images"}
          </p>
        )}

        {item.isSubscriberContent && !item.isOwned && !subscriptionActive && (
          <div
            className="text-xs px-3 py-2 rounded-lg flex items-center gap-2"
            style={{
              backgroundColor: "oklch(var(--accent) / 0.08)",
              color: "oklch(var(--accent))",
              border: "1px solid oklch(var(--accent) / 0.2)",
            }}
          >
            <Star size={12} />
            Included with Subscription
          </div>
        )}

        <PurchaseButtons
          item={item}
          subscriptionActive={subscriptionActive}
          checkoutState={checkoutState}
          onBuy={onBuy}
          onSubscribe={onSubscribe}
        />
      </div>
    </div>
  );
}

// ── DetailPage (mobile full-screen) ───────────────────────────────────────────

function DetailPage({
  item,
  subscriptionActive,
  checkoutState,
  checkoutError,
  onBack,
  onBuy,
  onSubscribe,
}: {
  item: CatalogItem;
  subscriptionActive: boolean;
  checkoutState: CheckoutState;
  checkoutError: string | null;
  onBack: () => void;
  onBuy: (item: CatalogItem) => void;
  onSubscribe: (item: CatalogItem) => void;
}) {
  return (
    <div
      data-ocid="marketplace.detail_page"
      className="flex flex-col flex-1 overflow-y-auto"
    >
      {/* Mobile detail header */}
      <div
        className="flex items-center gap-3 px-4 py-3 shrink-0"
        style={{
          backgroundColor: "oklch(var(--toolbar))",
          borderBottom: "1px solid oklch(var(--outline))",
        }}
      >
        <button
          type="button"
          data-ocid="marketplace.detail_back_button"
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm px-2.5 py-1.5 rounded-lg transition-opacity hover:opacity-70"
          style={{
            color: "oklch(var(--muted-text))",
            backgroundColor: "oklch(var(--sidebar-left))",
            border: "1px solid oklch(var(--outline))",
          }}
        >
          <ChevronLeft size={15} />
          Back
        </button>
        <span
          className="text-sm font-semibold line-clamp-1"
          style={{ color: "oklch(var(--text))" }}
        >
          {item.name}
        </span>
      </div>

      {/* Thumbnail */}
      {item.previewThumbnail && (
        <div
          className="w-full shrink-0"
          style={{ aspectRatio: "4/3", maxHeight: "260px", overflow: "hidden" }}
        >
          <img
            src={item.previewThumbnail}
            alt={item.name}
            className="w-full h-full object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        </div>
      )}

      {/* Content */}
      <div className="px-5 py-5 flex flex-col gap-5 flex-1">
        <div>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {item.isSubscriberContent && <SubscriberBadge />}
            {(item.isOwned ||
              (subscriptionActive && item.isSubscriberContent)) && (
              <OwnedBadge
                withSubscription={
                  subscriptionActive &&
                  item.isSubscriberContent &&
                  !item.isOwned
                }
              />
            )}
          </div>
          <h2
            className="text-xl font-bold leading-snug"
            style={{ color: "oklch(var(--text))" }}
          >
            {item.name}
          </h2>
          {item.priceUsdCents !== null && !item.isFree && (
            <p
              className="text-lg font-bold mt-1"
              style={{ color: "oklch(var(--accent))" }}
            >
              {formatPrice(item.priceUsdCents, item.isFree)}
            </p>
          )}
        </div>

        {item.description && (
          <p
            className="text-sm leading-relaxed"
            style={{ color: "oklch(var(--muted-text))" }}
          >
            {item.description}
          </p>
        )}

        {item.imageCount > 0 && (
          <p className="text-sm" style={{ color: "oklch(var(--muted-text))" }}>
            {item.imageCount}{" "}
            {item.contentType === "learningmodule"
              ? "lessons"
              : "reference images"}
          </p>
        )}

        {item.isSubscriberContent && !item.isOwned && !subscriptionActive && (
          <div
            className="text-sm px-4 py-3 rounded-lg flex items-center gap-2"
            style={{
              backgroundColor: "oklch(var(--accent) / 0.08)",
              color: "oklch(var(--accent))",
              border: "1px solid oklch(var(--accent) / 0.2)",
            }}
          >
            <Star size={14} />
            Included with Subscription
          </div>
        )}

        {checkoutError && (
          <div
            data-ocid="marketplace.checkout_error_state"
            className="text-sm px-4 py-3 rounded-lg"
            style={{
              backgroundColor: "oklch(0.4 0.15 20 / 0.15)",
              color: "oklch(0.75 0.1 20)",
              border: "1px solid oklch(0.4 0.15 20 / 0.3)",
            }}
          >
            {checkoutError}
          </div>
        )}

        <PurchaseButtons
          item={item}
          subscriptionActive={subscriptionActive}
          checkoutState={checkoutState}
          onBuy={onBuy}
          onSubscribe={onSubscribe}
        />
      </div>
    </div>
  );
}

// ── SuccessScreen ─────────────────────────────────────────────────────────────

function SuccessScreen({
  purchaseType,
  packId,
  items,
  onGoToLearn,
  onBackToShop,
}: {
  purchaseType: PurchaseType | null;
  packId: string | null;
  items: CatalogItem[];
  onGoToLearn: () => void;
  onBackToShop: () => void;
}) {
  const item = packId ? (items.find((i) => i.id === packId) ?? null) : null;

  return (
    <div
      data-ocid="marketplace.success_state"
      className="flex-1 flex flex-col items-center justify-center px-6 py-12 gap-6 text-center"
    >
      {item?.previewThumbnail && (
        <div
          className="rounded-xl overflow-hidden"
          style={{ width: "200px", aspectRatio: "4/3" }}
        >
          <img
            src={item.previewThumbnail}
            alt={item.name}
            className="w-full h-full object-cover"
          />
        </div>
      )}

      <div
        className="w-14 h-14 rounded-full flex items-center justify-center"
        style={{ backgroundColor: "oklch(var(--accent) / 0.15)" }}
      >
        <CheckCircle2 size={28} style={{ color: "oklch(var(--accent))" }} />
      </div>

      <div className="flex flex-col gap-2 max-w-sm">
        <h2
          className="text-lg font-bold"
          style={{ color: "oklch(var(--text))" }}
        >
          {purchaseType === "subscription"
            ? "Subscription Active!"
            : "Purchase Complete!"}
        </h2>
        <p
          className="text-sm leading-relaxed"
          style={{ color: "oklch(var(--muted-text))" }}
        >
          {purchaseType === "subscription" ? (
            "Your subscription is now active. All subscriber content is unlocked."
          ) : item ? (
            <>
              <span style={{ color: "oklch(var(--text))" }}>{item.name}</span>{" "}
              is now available in your library.
            </>
          ) : (
            "Your purchase is now available in your library."
          )}
        </p>
        <p
          className="text-xs"
          style={{ color: "oklch(var(--muted-text) / 0.7)" }}
        >
          Entitlements are granted via webhook — if content doesn't appear
          immediately, it will show up within a few seconds.
        </p>
      </div>

      <div className="flex gap-3">
        <button
          type="button"
          data-ocid="marketplace.go_to_learn_button"
          onClick={onGoToLearn}
          className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-all"
          style={{
            backgroundColor: "oklch(var(--accent))",
            color: "oklch(var(--accent-text))",
          }}
        >
          <Sparkles size={14} />
          Go to Learn
        </button>
        <button
          type="button"
          data-ocid="marketplace.back_to_shop_button"
          onClick={onBackToShop}
          className="px-5 py-2.5 rounded-lg text-sm font-medium transition-all"
          style={{
            backgroundColor: "oklch(var(--sidebar-left))",
            border: "1px solid oklch(var(--outline))",
            color: "oklch(var(--muted-text))",
          }}
        >
          Back to Shop
        </button>
      </div>
    </div>
  );
}

// ── CatalogGrid ───────────────────────────────────────────────────────────────

function CatalogGrid({
  items,
  loading,
  error,
  emptyLabel,
  expandedId,
  onExpand,
  onCloseExpanded,
  subscriptionActive,
  checkoutState,
  isMobile,
  onBuy,
  onSubscribe,
}: {
  items: CatalogItem[];
  loading: boolean;
  error: string | null;
  emptyLabel: string;
  expandedId: string | null;
  onExpand: (item: CatalogItem) => void;
  onCloseExpanded: () => void;
  subscriptionActive: boolean;
  checkoutState: CheckoutState;
  checkoutError?: string | null;
  isMobile: boolean;
  onBuy: (item: CatalogItem) => void;
  onSubscribe: (item: CatalogItem) => void;
}) {
  if (loading) {
    return (
      <div
        data-ocid="marketplace.loading_state"
        className="grid gap-4 p-6"
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))" }}
      >
        {Array.from({ length: 6 }, (_, i) => (
          <SkeletonCard key={`skel-${i + 1}`} />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div
        data-ocid="marketplace.error_state"
        className="flex flex-col items-center justify-center py-20 gap-3 text-center"
      >
        <p className="text-sm" style={{ color: "oklch(var(--muted-text))" }}>
          Failed to load catalog: {error}
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
    );
  }

  if (items.length === 0) {
    return (
      <div
        data-ocid="marketplace.empty_state"
        className="flex flex-col items-center justify-center py-20 gap-3 text-center"
      >
        <ShoppingBag size={32} style={{ color: "oklch(var(--muted-text))" }} />
        <p className="text-sm" style={{ color: "oklch(var(--muted-text))" }}>
          {emptyLabel}
        </p>
      </div>
    );
  }

  const expandedItem = expandedId
    ? (items.find((i) => i.id === expandedId) ?? null)
    : null;

  return (
    <div
      data-ocid="marketplace.grid"
      className="grid gap-4 p-6"
      style={{ gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))" }}
    >
      {items.map((item, idx) => (
        <div
          key={item.id}
          data-ocid={`marketplace.item.${idx + 1}`}
          className="relative"
        >
          <CatalogCard
            item={item}
            isExpanded={expandedId === item.id}
            onExpand={onExpand}
            subscriptionActive={subscriptionActive}
          />
          {/* Desktop detail panel anchored to the card */}
          {!isMobile && expandedItem && expandedId === item.id && (
            <DetailPanel
              item={expandedItem}
              subscriptionActive={subscriptionActive}
              checkoutState={checkoutState}
              onClose={onCloseExpanded}
              onBuy={onBuy}
              onSubscribe={onSubscribe}
            />
          )}
        </div>
      ))}
    </div>
  );
}

// ── MarketplaceScreen ─────────────────────────────────────────────────────────

export function MarketplaceScreen({
  identity,
  onClose,
  onPurchaseSuccess,
  subscriptionActive,
}: MarketplaceScreenProps) {
  const [activeTab, setActiveTab] = useState<Tab>("modules");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [mobileDetailItem, setMobileDetailItem] = useState<CatalogItem | null>(
    null,
  );
  const [checkoutState, setCheckoutState] = useState<CheckoutState>("idle");
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const [successPurchaseType, setSuccessPurchaseType] =
    useState<PurchaseType | null>(null);
  const [successPackId, setSuccessPackId] = useState<string | null>(null);

  // Detect mobile
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const ua = navigator.userAgent;
    const pointerCoarse = window.matchMedia("(pointer: coarse)").matches;
    const mobile =
      /iPhone|iPad|iPod|Android/i.test(ua) ||
      pointerCoarse ||
      (navigator.maxTouchPoints > 0 && window.screen.width <= 1024);
    setIsMobile(mobile);
  }, []);

  const { modules, packs, loading, error } = useMarketplaceData(identity);
  const allItems = [...modules, ...packs];

  // Handle Stripe return URL params on mount
  useEffect(() => {
    const purchaseParam = getQueryParam("purchase");
    const typeParam = getQueryParam("type");
    const packId = getQueryParam("pack");

    if (purchaseParam === "success") {
      const pType: PurchaseType =
        typeParam === "subscription" ? "subscription" : "permanent";
      setSuccessPurchaseType(pType);
      setSuccessPackId(packId);
      setShowSuccess(true);
      onPurchaseSuccess({ purchaseType: pType, packId: packId ?? undefined });
    }

    // Clear URL params
    if (purchaseParam) {
      const url = new URL(window.location.href);
      url.searchParams.delete("purchase");
      url.searchParams.delete("type");
      url.searchParams.delete("pack");
      window.history.replaceState({}, "", url.toString());
    }
  }, [onPurchaseSuccess]);

  const handleExpand = useCallback(
    (item: CatalogItem) => {
      if (isMobile) {
        setMobileDetailItem(item);
      } else {
        setExpandedId((prev) => (prev === item.id ? null : item.id));
      }
      setCheckoutError(null);
    },
    [isMobile],
  );

  const handleCloseExpanded = useCallback(() => {
    setExpandedId(null);
    setCheckoutError(null);
  }, []);

  const handleBuy = useCallback(
    async (item: CatalogItem) => {
      if (!identity) {
        setCheckoutError("Please log in to purchase.");
        return;
      }
      setCheckoutState("loading");
      setCheckoutError(null);
      try {
        const actor = await createPaymentsActor(identity);
        const origin = window.location.origin;
        const successUrl = `${origin}?purchase=success&pack=${encodeURIComponent(item.id)}`;
        const cancelUrl = `${origin}?purchase=cancelled`;
        const result = await actor.createCheckoutSession(
          item.id,
          successUrl,
          cancelUrl,
          false,
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
    },
    [identity],
  );

  const handleSubscribe = useCallback(
    async (item: CatalogItem) => {
      if (!identity) {
        setCheckoutError("Please log in to subscribe.");
        return;
      }
      setCheckoutState("loading");
      setCheckoutError(null);
      try {
        const actor = await createPaymentsActor(identity);
        const origin = window.location.origin;
        const successUrl = `${origin}?purchase=success&type=subscription`;
        const cancelUrl = `${origin}?purchase=cancelled`;
        const result = await actor.createCheckoutSession(
          item.id,
          successUrl,
          cancelUrl,
          true,
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
    },
    [identity],
  );

  const displayItems = activeTab === "modules" ? modules : packs;
  const emptyLabel =
    activeTab === "modules"
      ? "No learning modules available yet."
      : "No reference packs available yet.";

  return (
    <div
      data-ocid="marketplace.panel"
      className="fixed inset-0 z-[9500] flex flex-col"
      style={{ backgroundColor: "oklch(var(--canvas-bg))" }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-5 py-3 shrink-0"
        style={{
          backgroundColor: "oklch(var(--toolbar))",
          borderBottom: "1px solid oklch(var(--outline))",
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
            {isMobile ? null : "Back"}
          </button>
          <h1
            className="text-base font-bold"
            style={{ color: "oklch(var(--text))" }}
          >
            Shop
          </h1>
        </div>

        {/* Checkout status */}
        {checkoutState === "redirecting" && (
          <div
            className="flex items-center gap-2 text-xs"
            style={{ color: "oklch(var(--muted-text))" }}
          >
            <Loader2 size={12} className="animate-spin" />
            Redirecting to Stripe…
          </div>
        )}

        <button
          type="button"
          data-ocid="marketplace.close_x_button"
          onClick={onClose}
          className="p-1.5 rounded-lg transition-opacity hover:opacity-80"
          style={{ color: "oklch(var(--muted-text))" }}
          aria-label="Close shop"
        >
          <X size={18} />
        </button>
      </div>

      {/* Checkout error banner */}
      {checkoutError && !mobileDetailItem && (
        <div
          data-ocid="marketplace.error_state"
          className="flex items-center justify-between gap-2 px-5 py-2.5 text-sm shrink-0"
          style={{
            backgroundColor: "oklch(0.4 0.15 20 / 0.15)",
            borderBottom: "1px solid oklch(0.4 0.15 20 / 0.3)",
            color: "oklch(0.75 0.1 20)",
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

      {/* Success screen */}
      {showSuccess ? (
        <SuccessScreen
          purchaseType={successPurchaseType}
          packId={successPackId}
          items={allItems}
          onGoToLearn={onClose}
          onBackToShop={() => setShowSuccess(false)}
        />
      ) : mobileDetailItem ? (
        /* Mobile detail page */
        <DetailPage
          item={mobileDetailItem}
          subscriptionActive={subscriptionActive}
          checkoutState={checkoutState}
          checkoutError={checkoutError}
          onBack={() => {
            setMobileDetailItem(null);
            setCheckoutError(null);
          }}
          onBuy={handleBuy}
          onSubscribe={handleSubscribe}
        />
      ) : (
        /* Main shop content */
        <div className="flex flex-col flex-1 overflow-hidden">
          {/* Tabs */}
          <div
            className="flex gap-1 px-5 pt-4 pb-0 shrink-0"
            style={{ backgroundColor: "oklch(var(--toolbar))" }}
          >
            {(["modules", "packs"] as Tab[]).map((tab) => (
              <button
                key={tab}
                type="button"
                data-ocid={`marketplace.${tab}_tab`}
                onClick={() => {
                  setActiveTab(tab);
                  setExpandedId(null);
                }}
                className="px-4 py-2 text-sm font-semibold rounded-t-lg transition-all relative"
                style={{
                  color:
                    activeTab === tab
                      ? "oklch(var(--accent))"
                      : "oklch(var(--muted-text))",
                  backgroundColor:
                    activeTab === tab
                      ? "oklch(var(--canvas-bg))"
                      : "transparent",
                }}
              >
                {tab === "modules" ? "Learning Modules" : "Reference Packs"}
                {activeTab === tab && (
                  <span
                    className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full"
                    style={{ backgroundColor: "oklch(var(--accent))" }}
                  />
                )}
              </button>
            ))}
          </div>

          {/* Divider */}
          <div
            className="shrink-0 h-px"
            style={{ backgroundColor: "oklch(var(--outline))" }}
          />

          {/* Grid */}
          <div className="flex-1 overflow-y-auto">
            <CatalogGrid
              items={displayItems}
              loading={loading}
              error={error}
              emptyLabel={emptyLabel}
              expandedId={expandedId}
              onExpand={handleExpand}
              onCloseExpanded={handleCloseExpanded}
              subscriptionActive={subscriptionActive}
              checkoutState={checkoutState}
              checkoutError={checkoutError}
              isMobile={isMobile}
              onBuy={handleBuy}
              onSubscribe={handleSubscribe}
            />
          </div>

          {/* Not logged in hint */}
          {!identity && !loading && (
            <div
              className="px-5 py-3 text-xs text-center shrink-0"
              style={{
                backgroundColor: "oklch(var(--toolbar))",
                borderTop: "1px solid oklch(var(--outline))",
                color: "oklch(var(--muted-text))",
              }}
            >
              Log in to purchase content
            </div>
          )}
        </div>
      )}
    </div>
  );
}
