// Marketplace types shared across the marketplace feature

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
