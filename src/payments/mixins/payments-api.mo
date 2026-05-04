import Principal "mo:core/Principal";
import Map "mo:core/Map";
import PaymentsLib "../lib/payments";
import Types "../types/payments";

/// Payments domain — new public API endpoints for subscription management.
/// These functions are meant to be included by the payments actor (main.mo)
/// alongside the existing checkout and webhook handling code.
///
/// State injected:
///   subscriptionPrice  : { var val : Nat }  — current price in USD cents (default 0)
///   isAdmin_           : (Principal) -> async Bool  — admin-check forwarded from actor
mixin (
  subscriptionPrice : { var val : Nat },
  isAdmin_          : Principal -> async Bool,
) {

  // ── Admin: subscription price ──────────────────────────────────────────────

  /// Admin only — set the global monthly subscription price in USD cents.
  /// Returns #ok on success, #err with a descriptive message on failure.
  /// Price must be > 0 and <= 9_999_999.
  public shared ({ caller }) func setSubscriptionPrice(
    priceUsdCents : Nat
  ) : async { #ok; #err : Text } {
    if (not (await isAdmin_(caller))) return #err "Unauthorized";
    PaymentsLib.setSubscriptionPrice(subscriptionPrice, priceUsdCents);
  };

  /// Public query — return the current monthly subscription price in USD cents.
  public query func getSubscriptionPrice() : async Nat {
    PaymentsLib.getSubscriptionPrice(subscriptionPrice);
  };

};
