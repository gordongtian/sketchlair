// Marketplace types shared across the marketplace feature

/** Legacy type — kept for backwards compatibility */
export interface PackItem {
  id: string;
  name: string;
  imageCount: number;
  previewThumbnail: string;
  isFree: boolean;
  isDefault: boolean;
  /** Price in USD cents — undefined if free or not set */
  priceUsdCents?: number;
  isOwned: boolean;
}

export type CheckoutState =
  | "idle"
  | "loading"
  | "redirecting"
  | "success"
  | "cancelled";

// ── New marketplace types ────────────────────────────────────────────────────

export type ContentType = "referencepack" | "learningmodule";

export type PurchaseType = "permanent" | "subscription";

/**
 * Enriched catalog item — combines PublicImageSet data from the backend
 * with pricing data from the payments canister and owned status from entitlements.
 */
export interface CatalogItem {
  id: string;
  name: string;
  previewThumbnail: string;
  imageCount: number;
  isFree: boolean;
  /** Price in USD cents — null means free */
  priceUsdCents: number | null;
  /** True if this item is included in the subscription tier */
  isSubscriberContent: boolean;
  contentType: ContentType;
  description: string;
  /** True if the user currently owns or has access to this item */
  isOwned?: boolean;
}

export interface SubscriptionStatus {
  active: boolean;
  /** Unix timestamp in milliseconds when the subscription expires — null if not active */
  expiryDateMs: number | null;
}

export interface PurchaseConfirmationData {
  item: CatalogItem;
  purchaseType: PurchaseType;
  /** Unix timestamp in ms when a subscription expires — undefined for permanent */
  expiryDateMs?: number;
}
