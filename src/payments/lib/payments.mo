import Map "mo:core/Map";
import Types "../types/payments";

/// Payments domain logic — subscription price management and session helpers.
/// All functions are stateless; state (maps, vars) is injected by the caller.
module {

  // ── Subscription price ─────────────────────────────────────────────────────

  /// Validate and store a new subscription price in cents.
  /// priceUsdCents must be > 0 and <= 9_999_999.
  /// The caller is responsible for admin-checking before invoking this.
  public func setSubscriptionPrice(
    priceRef      : { var val : Nat },
    priceUsdCents : Nat
  ) : Types.Result {
    if (priceUsdCents == 0) return #err "Price cannot be zero. Use a positive value in USD cents (e.g. 999 for $9.99)";
    if (priceUsdCents > 9_999_999) return #err "Price exceeds the maximum allowed value of $99,999.99 (9999999 cents)";
    priceRef.val := priceUsdCents;
    #ok;
  };

  /// Return the current subscription price in USD cents.
  public func getSubscriptionPrice(priceRef : { var val : Nat }) : Nat {
    priceRef.val;
  };

  // ── Idempotency helpers ────────────────────────────────────────────────────

  /// Return an existing pending subscription session URL for `buyer`, if any.
  /// Used by createCheckoutSession to avoid creating duplicate Stripe sessions.
  public func findPendingSubscriptionSession(
    pendingSessions : Map.Map<Text, Types.PendingSession>,
    buyer           : Principal
  ) : ?Text {
    for ((_, session) in pendingSessions.entries()) {
      if (session.buyer == buyer and session.isSubscription) {
        return ?session.sessionUrl;
      };
    };
    null;
  };

  // ── Customer principal map ─────────────────────────────────────────────────

  /// Record a Stripe customer_id → principal mapping.
  /// Called after a successful checkout so that subsequent
  /// subscription lifecycle webhooks can resolve the owner.
  /// Only records on first encounter — first mapping wins.
  public func recordCustomerPrincipal(
    customerMap   : Map.Map<Text, Text>,
    customerId    : Text,
    principalText : Text
  ) : () {
    if (customerMap.get(customerId) == null) {
      customerMap.add(customerId, principalText);
    };
  };

  /// Look up the principal text for a Stripe customer ID.
  /// Returns null if no mapping has been recorded yet.
  public func resolveCustomerPrincipal(
    customerMap : Map.Map<Text, Text>,
    customerId  : Text
  ) : ?Text {
    customerMap.get(customerId);
  };

  // ── Stripe form-body builders ──────────────────────────────────────────────

  /// Build the application/x-www-form-urlencoded body for a Stripe Checkout
  /// session in subscription mode.
  public func buildSubscriptionFormBody(
    callerText    : Text,
    priceUsdCents : Nat,
    successUrl    : Text,
    cancelUrl     : Text
  ) : Text {
    "mode=subscription"
    # "&success_url=" # successUrl
    # "&cancel_url=" # cancelUrl
    # "&line_items[0][price_data][currency]=usd"
    # "&line_items[0][price_data][unit_amount]=" # priceUsdCents.toText()
    # "&line_items[0][price_data][recurring][interval]=month"
    # "&line_items[0][price_data][product_data][name]=SketchLair Subscription"
    # "&line_items[0][quantity]=1"
    # "&metadata[principal]=" # callerText
    # "&metadata[itemType]=subscription"
    # "&metadata[itemId]=subscription";
  };

};
