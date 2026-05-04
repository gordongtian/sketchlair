import Map "mo:core/Map";
import Principal "mo:core/Principal";
import Types "../types/marketplace";

/// Domain logic for the marketplace — subscription management and catalog helpers.
/// All functions are pure (stateless) and receive state as parameters.
module {

  // ── Subscription helpers ─────────────────────────────────────────────────

  /// Returns true if the subscription is currently active (not cancelled AND
  /// within its paid billing window).
  public func isSubscriptionActive(
    sub     : Types.Subscription,
    nowMs   : Nat64,
  ) : Bool {
    sub.expiryDateMs > nowMs
  };

  /// Grants or replaces a subscription for a user.
  public func grantSubscription(
    subscriptions  : Map.Map<Principal, Types.Subscription>,
    userPrincipal  : Principal,
    stripeSubId    : Text,
    expiryDateMs   : Nat64,
  ) : Bool {
    let sub : Types.Subscription = {
      stripeSubId;
      expiryDateMs;
      active = true;
    };
    subscriptions.add(userPrincipal, sub);
    true
  };

  /// Marks a subscription as inactive (cancelled).
  /// Access continues until expiryDateMs is past.
  public func revokeSubscription(
    subscriptions  : Map.Map<Principal, Types.Subscription>,
    userPrincipal  : Principal,
  ) : Bool {
    switch (subscriptions.get(userPrincipal)) {
      case null false;
      case (?existing) {
        subscriptions.add(userPrincipal, { existing with active = false });
        true
      };
    }
  };

  /// Updates the expiry timestamp of an existing subscription (renewal webhook).
  public func updateSubscriptionExpiry(
    subscriptions  : Map.Map<Principal, Types.Subscription>,
    userPrincipal  : Principal,
    newExpiryMs    : Nat64,
  ) : Bool {
    switch (subscriptions.get(userPrincipal)) {
      case null false;
      case (?existing) {
        subscriptions.add(userPrincipal, { existing with expiryDateMs = newExpiryMs; active = true });
        true
      };
    }
  };

  /// Returns the caller-facing subscription status.
  public func getSubscriptionStatus(
    subscriptions  : Map.Map<Principal, Types.Subscription>,
    userPrincipal  : Principal,
    nowMs          : Nat64,
  ) : Types.SubscriptionStatus {
    switch (subscriptions.get(userPrincipal)) {
      case null { { active = false; expiryDateMs = null } };
      case (?sub) {
        {
          active       = isSubscriptionActive(sub, nowMs);
          expiryDateMs = ?sub.expiryDateMs;
        }
      };
    }
  };

  // ── Entitlement helpers ──────────────────────────────────────────────────

  /// Returns true when the user may access the given pack:
  ///   (1) pack is free, OR
  ///   (2) user holds a permanent entitlement, OR
  ///   (3) user has an active subscription AND pack.isSubscriberContent.
  public func isEntitledTo(
    entitlements   : Map.Map<Principal, [Text]>,
    subscriptions  : Map.Map<Principal, Types.Subscription>,
    userPrincipal  : Principal,
    packId         : Text,
    isFree         : Bool,
    isSubscriberContent : Bool,
    nowMs          : Nat64,
  ) : Bool {
    if (isFree) return true;
    // Permanent entitlement
    switch (entitlements.get(userPrincipal)) {
      case (?ids) {
        if (ids.find(func(id : Text) : Bool { id == packId }) != null) return true;
      };
      case null {};
    };
    // Subscription access
    if (isSubscriberContent) {
      switch (subscriptions.get(userPrincipal)) {
        case (?sub) {
          if (isSubscriptionActive(sub, nowMs)) return true;
        };
        case null {};
      };
    };
    false
  };

};
