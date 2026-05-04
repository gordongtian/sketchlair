/**
 * AdminPortal — full-screen admin view.
 *
 * Only accessible to principals with admin status (isCallerAdmin).
 * Currently contains one section: Image Set Manager.
 * Sidebar nav is structured for future expansion.
 */

import { ImageSetManager } from "@/components/ImageSetManager";
import { MascotManager } from "@/components/MascotManager";
import { ModuleScriptAdmin } from "@/components/dialogue/ModuleScriptAdmin";
import { useAuth } from "@/hooks/useAuth";
import type { paymentsInterface } from "@/payments.d";
import { createPaymentsActor } from "@/paymentsConfig";
import {
  ArrowLeft,
  BookOpen,
  Bot,
  Image,
  Loader2,
  ShieldCheck,
  ShoppingBag,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

interface AdminPortalProps {
  onBack: () => void;
}

type AdminSection = "image-sets" | "mascots" | "modules" | "marketplace";

const NAV_ITEMS: { id: AdminSection; label: string; icon: typeof Image }[] = [
  { id: "image-sets", label: "Image Sets", icon: Image },
  { id: "mascots", label: "Mascot Assets", icon: Bot },
  { id: "modules", label: "Module Scripts", icon: BookOpen },
  { id: "marketplace", label: "Marketplace", icon: ShoppingBag },
];

export function AdminPortal({ onBack }: AdminPortalProps) {
  const { identity } = useAuth();
  const [activeSection, setActiveSection] =
    useState<AdminSection>("image-sets");

  // ── Subscription price state ────────────────────────────────────────────────
  const paymentsActorRef = useRef<paymentsInterface | null>(null);
  const [subPriceDollars, setSubPriceDollars] = useState("");
  const [subPriceLoading, setSubPriceLoading] = useState(false);
  const [subPriceSaving, setSubPriceSaving] = useState(false);
  const [subPriceError, setSubPriceError] = useState<string | null>(null);
  const [subPriceLoaded, setSubPriceLoaded] = useState(false);

  const getPaymentsActor =
    useCallback(async (): Promise<paymentsInterface | null> => {
      if (!identity) return null;
      if (!paymentsActorRef.current) {
        try {
          paymentsActorRef.current = await createPaymentsActor(identity);
        } catch (err) {
          console.warn("[AdminPortal] Payments canister not configured:", err);
          return null;
        }
      }
      return paymentsActorRef.current;
    }, [identity]);

  const loadSubscriptionPrice = useCallback(async () => {
    setSubPriceLoading(true);
    setSubPriceError(null);
    try {
      const actor = await getPaymentsActor();
      if (!actor) return;
      const cents = await actor.getSubscriptionPrice();
      setSubPriceDollars((Number(cents) / 100).toFixed(2));
      setSubPriceLoaded(true);
    } catch (err) {
      setSubPriceError(
        err instanceof Error
          ? err.message
          : "Failed to load subscription price",
      );
    } finally {
      setSubPriceLoading(false);
    }
  }, [getPaymentsActor]);

  useEffect(() => {
    if (activeSection === "marketplace" && !subPriceLoaded) {
      void loadSubscriptionPrice();
    }
  }, [activeSection, subPriceLoaded, loadSubscriptionPrice]);

  const handleSaveSubscriptionPrice = async () => {
    const num = Number.parseFloat(subPriceDollars.trim());
    if (Number.isNaN(num) || num < 0) {
      setSubPriceError("Enter a valid price (e.g. 9.99)");
      return;
    }
    const cents = BigInt(Math.round(num * 100));
    setSubPriceSaving(true);
    setSubPriceError(null);
    try {
      const actor = await getPaymentsActor();
      if (!actor) {
        setSubPriceError("Payments canister not configured");
        return;
      }
      const result = await actor.setSubscriptionPrice(cents);
      if ("err" in result) {
        setSubPriceError(result.err || "Failed to update subscription price");
        return;
      }
      toast.success("Subscription price updated.");
    } catch (err) {
      setSubPriceError(
        err instanceof Error ? err.message : "Failed to save price",
      );
    } finally {
      setSubPriceSaving(false);
    }
  };

  return (
    <div
      data-ocid="admin_portal.panel"
      className="fixed inset-0 z-[9500] flex flex-col"
      style={{
        backgroundColor: "oklch(var(--canvas-bg) / 0.98)",
        backdropFilter: "blur(12px)",
      }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-4 px-6 py-4 shrink-0 border-b"
        style={{
          backgroundColor: "oklch(var(--toolbar))",
          borderColor: "oklch(var(--outline))",
        }}
      >
        <button
          type="button"
          data-ocid="admin_portal.back_button"
          onClick={onBack}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-opacity hover:opacity-80"
          style={{
            backgroundColor: "oklch(var(--sidebar-left))",
            color: "oklch(var(--text))",
            border: "1px solid oklch(var(--outline))",
          }}
          aria-label="Back to splash screen"
        >
          <ArrowLeft size={14} />
          Back
        </button>

        <div className="flex items-center gap-3">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: "oklch(var(--accent) / 0.2)" }}
          >
            <ShieldCheck size={14} style={{ color: "oklch(var(--accent))" }} />
          </div>
          <h1
            className="text-sm font-semibold"
            style={{ color: "oklch(var(--text))" }}
          >
            Admin Portal
          </h1>
        </div>
      </div>

      {/* Body: sidebar + content */}
      <div className="flex flex-1 min-h-0">
        {/* Left sidebar nav */}
        <nav
          className="flex flex-col gap-1 p-4 w-52 shrink-0 border-r"
          style={{
            backgroundColor: "oklch(var(--toolbar))",
            borderColor: "oklch(var(--outline))",
          }}
          aria-label="Admin sections"
        >
          <p
            className="text-xs font-semibold uppercase tracking-wider mb-2 px-2"
            style={{ color: "oklch(var(--muted-text))" }}
          >
            Sections
          </p>
          {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              data-ocid={`admin_portal.tab.${id}`}
              onClick={() => setActiveSection(id)}
              className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-left transition-all"
              style={{
                backgroundColor:
                  activeSection === id
                    ? "oklch(var(--accent) / 0.15)"
                    : "transparent",
                color:
                  activeSection === id
                    ? "oklch(var(--accent))"
                    : "oklch(var(--text))",
                border:
                  activeSection === id
                    ? "1px solid oklch(var(--accent) / 0.3)"
                    : "1px solid transparent",
              }}
            >
              <Icon
                size={14}
                style={{
                  color:
                    activeSection === id
                      ? "oklch(var(--accent))"
                      : "oklch(var(--muted-text))",
                }}
              />
              {label}
            </button>
          ))}
        </nav>

        {/* Main content */}
        <main
          className="flex-1 min-w-0 p-6 overflow-y-auto"
          style={{ backgroundColor: "oklch(var(--canvas-bg))" }}
        >
          {activeSection === "image-sets" && (
            <ImageSetManager identity={identity!} />
          )}
          {activeSection === "mascots" && <MascotManager identity={identity} />}
          {activeSection === "modules" && (
            <ModuleScriptAdmin identity={identity} />
          )}
          {activeSection === "marketplace" && (
            <div
              data-ocid="marketplace_admin.panel"
              className="flex flex-col gap-6"
            >
              <div>
                <h2
                  className="text-base font-semibold"
                  style={{ color: "oklch(var(--text))" }}
                >
                  Marketplace Settings
                </h2>
                <p
                  className="text-xs mt-0.5"
                  style={{ color: "oklch(var(--muted-text))" }}
                >
                  Global configuration for the SketchLair marketplace
                </p>
              </div>

              {/* Subscription Price */}
              <div
                className="flex flex-col gap-4 p-5 rounded-xl"
                style={{
                  backgroundColor: "oklch(var(--sidebar-left) / 0.6)",
                  border: "1px solid oklch(var(--outline))",
                }}
              >
                <div className="flex items-center gap-2">
                  <ShoppingBag
                    size={14}
                    style={{ color: "oklch(var(--accent))" }}
                  />
                  <h3
                    className="text-sm font-semibold"
                    style={{ color: "oklch(var(--text))" }}
                  >
                    Subscription Price
                  </h3>
                </div>
                <p
                  className="text-xs"
                  style={{ color: "oklch(var(--muted-text))" }}
                >
                  Monthly subscription price in USD. Unlocks all content tagged
                  as Subscriber Content.
                </p>

                {subPriceLoading && (
                  <div
                    data-ocid="marketplace_admin.sub_price_loading_state"
                    className="flex items-center gap-2 text-xs"
                    style={{ color: "oklch(var(--muted-text))" }}
                  >
                    <Loader2 size={13} className="animate-spin" />
                    Loading…
                  </div>
                )}

                {!subPriceLoading && (
                  <div className="flex items-end gap-3 flex-wrap">
                    <div className="flex flex-col gap-1">
                      <label
                        htmlFor="sub-price-input"
                        className="text-xs"
                        style={{ color: "oklch(var(--muted-text))" }}
                      >
                        Price (USD / month)
                      </label>
                      <div className="relative">
                        <span
                          className="absolute left-3 top-1/2 -translate-y-1/2 text-sm"
                          style={{ color: "oklch(var(--muted-text))" }}
                        >
                          $
                        </span>
                        <input
                          id="sub-price-input"
                          data-ocid="marketplace_admin.sub_price_input"
                          type="number"
                          step="0.01"
                          min="0"
                          value={subPriceDollars}
                          onChange={(e) => {
                            setSubPriceDollars(e.target.value);
                            setSubPriceError(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter")
                              void handleSaveSubscriptionPrice();
                          }}
                          className="pl-7 pr-3 py-2 rounded-lg text-sm w-36"
                          style={{
                            backgroundColor: "oklch(var(--sidebar-left))",
                            border: `1px solid ${
                              subPriceError
                                ? "oklch(0.55 0.22 25)"
                                : "oklch(var(--outline))"
                            }`,
                            color: "oklch(var(--text))",
                            outline: "none",
                          }}
                          placeholder="9.99"
                        />
                      </div>
                    </div>
                    <button
                      type="button"
                      data-ocid="marketplace_admin.sub_price_save_button"
                      onClick={() => void handleSaveSubscriptionPrice()}
                      disabled={subPriceSaving}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-opacity hover:opacity-80 disabled:opacity-50"
                      style={{
                        backgroundColor: "oklch(var(--accent))",
                        color: "oklch(var(--accent-text))",
                      }}
                    >
                      {subPriceSaving && (
                        <Loader2 size={13} className="animate-spin" />
                      )}
                      Save
                    </button>
                  </div>
                )}

                {subPriceError && (
                  <p
                    data-ocid="marketplace_admin.sub_price_error_state"
                    className="text-xs"
                    style={{ color: "oklch(0.65 0.2 25)" }}
                  >
                    {subPriceError}
                  </p>
                )}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
