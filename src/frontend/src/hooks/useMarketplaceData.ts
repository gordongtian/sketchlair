import { createActorWithConfig } from "@/config";
import type { CatalogItem, ContentType } from "@/types/marketplace";
import type { Identity } from "@icp-sdk/core/agent";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type CatalogItem as BackendCatalogItem,
  ContentType as BackendContentType,
} from "../backend";
import { createPaymentsActor } from "../paymentsConfig";

export interface MarketplaceDataResult {
  modules: CatalogItem[];
  packs: CatalogItem[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * Fetches the full catalog by combining:
 * - getAllPublicImageSets() from the backend (catalog metadata)
 * - getPackPrices() from the payments canister (USD pricing)
 * - getUserEntitlements() from the backend (owned set IDs)
 *
 * contentType is inferred from tags:
 *   - sets tagged "learningmodule" become learningmodule
 *   - all others are referencepack
 *
 * isSubscriberContent is inferred from sets tagged "subscriber".
 * description is inferred from the "description:..." tag if present,
 * falling back to an empty string.
 */
export function useMarketplaceData(identity?: Identity): MarketplaceDataResult {
  const [modules, setModules] = useState<CatalogItem[]>([]);
  const [packs, setPacks] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const identityRef = useRef(identity);
  identityRef.current = identity;

  // cancelledRef lets us abort an in-flight fetch when refetch() fires again.
  const cancelledRef = useRef(false);

  const doFetch = useCallback(async () => {
    cancelledRef.current = false;
    setLoading(true);
    setError(null);

    try {
      const currentIdentity = identityRef.current;

      // Fetch catalog and entitlements — prices require payments canister.
      const actor = await createActorWithConfig(
        currentIdentity ? { identity: currentIdentity } : undefined,
      );

      const [catalogResult, entitlements] = await Promise.all([
        actor.getFullCatalog(),
        actor.getUserEntitlements(),
      ]);

      // Fetch prices from payments canister — fails gracefully if not configured
      const priceMap = new Map<string, number>();
      try {
        const paymentsActor = await createPaymentsActor(
          currentIdentity ?? undefined,
        );
        const rawPrices = await paymentsActor.getPackPrices();
        for (const [id, cents] of rawPrices) {
          priceMap.set(id, Number(cents));
        }
      } catch {
        // Payments canister may not be configured — prices fall back to null
      }

      if (cancelledRef.current) return;

      const ownedSet = new Set<string>(entitlements);

      function mapItem(s: BackendCatalogItem): CatalogItem {
        const priceFromPayments = priceMap.get(s.id) ?? null;
        // priceUsdCents from backend is opt nat (bigint | undefined)
        const backendPriceCents =
          s.priceUsdCents !== undefined ? Number(s.priceUsdCents) : null;
        const priceUsdCents = s.isFree
          ? null
          : (backendPriceCents ?? priceFromPayments);
        const contentType: ContentType =
          s.contentType === BackendContentType.learningmodule
            ? "learningmodule"
            : "referencepack";
        return {
          id: s.id,
          name: s.name,
          previewThumbnail: s.previewThumbnail,
          imageCount: Number(s.imageCount),
          isFree: s.isFree,
          priceUsdCents,
          isSubscriberContent: s.isSubscriberContent,
          contentType,
          description: s.description,
          isOwned: s.isFree || ownedSet.has(s.id),
        };
      }

      setModules(catalogResult.modules.map(mapItem));
      setPacks(catalogResult.packs.map(mapItem));
      setLoading(false);
    } catch (err) {
      if (!cancelledRef.current) {
        const msg =
          err instanceof Error ? err.message : "Failed to load catalog";
        setError(msg);
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void doFetch();
    return () => {
      cancelledRef.current = true;
    };
  }, [doFetch]);

  const refetch = useCallback(() => void doFetch(), [doFetch]);

  return { modules, packs, loading, error, refetch };
}
