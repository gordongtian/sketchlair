import { createActorWithConfig } from "@/config";
import type { SubscriptionStatus } from "@/types/marketplace";
import type { Identity } from "@icp-sdk/core/agent";
import { useCallback, useEffect, useRef, useState } from "react";

export interface SubscriptionStatusResult extends SubscriptionStatus {
  loading: boolean;
  refetch: () => void;
}

/**
 * Returns the current user's subscription status by calling the backend.
 * Only fetches when identity is provided (authenticated).
 */
export function useSubscriptionStatus(
  identity?: Identity | null,
): SubscriptionStatusResult {
  const [status, setStatus] = useState<SubscriptionStatus>({
    active: false,
    expiryDateMs: null,
  });
  const [loading, setLoading] = useState(false);
  const identityRef = useRef(identity);
  identityRef.current = identity;

  const doFetch = useCallback(async () => {
    const currentIdentity = identityRef.current;
    if (!currentIdentity) {
      setStatus({ active: false, expiryDateMs: null });
      return;
    }
    setLoading(true);
    try {
      const actor = await createActorWithConfig({ identity: currentIdentity });
      const result = await actor.getSubscriptionStatus();
      setStatus({
        active: result.active,
        // Candid optional bigint comes as bigint | undefined
        expiryDateMs:
          result.expiryDateMs !== undefined
            ? Number(result.expiryDateMs)
            : null,
      });
    } catch {
      setStatus({ active: false, expiryDateMs: null });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void doFetch();
  }, [doFetch]);

  const refetch = useCallback(() => void doFetch(), [doFetch]);

  return { ...status, loading, refetch };
}
