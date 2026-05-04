import Debug "mo:core/Debug";

/// Payments domain — subscription and checkout types.
/// Used by lib/payments.mo and mixins/payments-api.mo.
module {

  // ── Pending checkout session record ────────────────────────────────────────
  // Extends the existing PendingSession shape to carry subscription context.
  // itemId is "subscription" when isSubscription = true.
  public type PendingSession = {
    sessionId     : Text;
    buyer         : Principal;
    itemType      : Text;   // "image_pack" | "subscription"
    itemId        : Text;   // packId for purchases; "subscription" for subscriptions
    sessionUrl    : Text;
    isSubscription : Bool;
  };

  // ── Subscription state stored per-principal on the backend canister ────────
  // Passed to backend.grantSubscription / backend.updateSubscriptionExpiry.
  public type SubscriptionGrant = {
    stripeSubId   : Text;   // Stripe subscription ID (sub_...)
    expiryDateMs  : Int;    // current_period_end * 1000 (epoch ms)
  };

  // ── Stripe customer → principal reverse-lookup entry ───────────────────────
  // Stored in customerPrincipalMap_ so subscription events (which carry
  // customer_id but not principal metadata) can resolve the owner.
  public type CustomerEntry = {
    customerId    : Text;   // Stripe customer ID (cus_...)
    principalText : Text;   // Internet Identity principal as Text
  };

  // ── Result variants ────────────────────────────────────────────────────────
  public type Result = { #ok; #err : Text };
  public type ResultText = { #ok : Text; #err : Text };

};
