import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { PurchaseConfirmationData } from "@/types/marketplace";
import { CheckCircle2, ShoppingBag } from "lucide-react";
import { motion } from "motion/react";

interface PurchaseConfirmationProps {
  data: PurchaseConfirmationData | null;
  onViewInLearn: () => void;
  onBackToShop: () => void;
}

function formatExpiryDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function PurchaseConfirmation({
  data,
  onViewInLearn,
  onBackToShop,
}: PurchaseConfirmationProps) {
  const isSubscription = data?.purchaseType === "subscription";
  const hasItem = !!data?.item;

  return (
    <div
      data-ocid="purchase_confirmation.dialog"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.92, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
        className="relative w-full max-w-md rounded-xl border border-border bg-card shadow-2xl overflow-hidden"
      >
        {/* ── Thumbnail ─────────────────────────────── */}
        {hasItem && data.item.previewThumbnail ? (
          <div className="relative w-full aspect-video overflow-hidden">
            <img
              src={data.item.previewThumbnail}
              alt={data.item.name}
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-card via-card/20 to-transparent" />
            <div className="absolute bottom-3 left-4">
              <Badge
                className="text-xs font-semibold"
                style={{
                  background: "oklch(var(--accent))",
                  color: "oklch(var(--accent-text))",
                }}
              >
                {isSubscription ? "Subscription" : "Purchased"}
              </Badge>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center w-full aspect-video bg-muted">
            <ShoppingBag className="w-16 h-16 text-muted-foreground opacity-40" />
          </div>
        )}

        {/* ── Content ───────────────────────────────── */}
        <div className="px-6 pb-6 pt-4 flex flex-col gap-4">
          {/* Success icon + title */}
          <div className="flex items-start gap-3">
            <CheckCircle2
              className="mt-0.5 shrink-0 w-6 h-6"
              style={{ color: "oklch(var(--accent))" }}
            />
            <div className="min-w-0">
              {hasItem ? (
                <>
                  <h2 className="text-lg font-semibold text-foreground leading-snug truncate">
                    {isSubscription
                      ? "Your subscription is now active"
                      : `You now own ${data.item.name}`}
                  </h2>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {isSubscription && data.expiryDateMs
                      ? `Access expires ${formatExpiryDate(data.expiryDateMs)} unless renewed`
                      : isSubscription
                        ? "Your subscription is active"
                        : "Lifetime access"}
                  </p>
                </>
              ) : (
                <h2 className="text-lg font-semibold text-foreground leading-snug">
                  Purchase successful
                </h2>
              )}
            </div>
          </div>

          {/* Item name pill (when we have item data) */}
          {hasItem && (
            <div className="rounded-lg bg-muted px-4 py-3 flex items-center gap-3">
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">
                  {data.item.contentType === "learningmodule"
                    ? "Learning Module"
                    : "Reference Pack"}
                </p>
                <p className="text-sm font-semibold text-foreground truncate">
                  {data.item.name}
                </p>
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex flex-col gap-2 pt-1">
            {hasItem && (
              <Button
                data-ocid="purchase_confirmation.primary_button"
                onClick={onViewInLearn}
                className="w-full font-semibold"
                style={{
                  background: "oklch(var(--accent))",
                  color: "oklch(var(--accent-text))",
                }}
              >
                View in Learn
              </Button>
            )}
            <Button
              data-ocid="purchase_confirmation.close_button"
              variant="outline"
              onClick={onBackToShop}
              className="w-full"
            >
              Back to Shop
            </Button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
