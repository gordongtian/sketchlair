import Map "mo:core/Map";
import Time "mo:core/Time";
import Nat64 "mo:core/Nat64";
import Principal "mo:core/Principal";
import Runtime "mo:core/Runtime";
import Types "../types/marketplace";
import MarketplaceLib "../lib/marketplace";
import Int "mo:core/Int";

/// Public API surface for the marketplace domain.
/// Injected state:
///   subscriptions       — Map<Principal, Subscription>
///   entitlements        — Map<Principal, [Text]>  (permanent pack entitlements)
///   imageSets           — the shared image set registry from main.mo
///   isAdmin             — function to check admin by principal
///   isPaymentsCaller    — function to check if a principal is the payments canister
mixin (
  subscriptions       : Map.Map<Principal, Types.Subscription>,
  entitlements        : Map.Map<Principal, [Text]>,
  imageSets           : Map.Map<Text, { id : Text; name : Text; previewThumbnail : Text;
                          imageCount : Nat; isDefault : Bool; isFree : Bool;
                          images : [{ id : Text; assetUrl : Text; width : Nat; height : Nat }];
                          priceICP : ?Text; tags : [Text];
                          contentType : Types.ContentType;
                          isSubscriberContent : Bool;
                          description : Text;
                          priceUsdCents : ?Nat }>,
  isAdmin             : Principal -> Bool,
  isPaymentsCaller    : Principal -> Bool,
) {

  // Helper: current time in milliseconds (Nat64)
  func nowMs() : Nat64 {
    let ns : Int = Time.now();
    let ms : Int = ns / 1_000_000;
    Nat64.fromNat(Int.abs(ms))
  };

  // ── Catalog ──────────────────────────────────────────────────────────────

  /// Returns the full catalog split by content type.
  /// No images array is included — CDN URLs are not leaked to unpurchased callers.
  public query func getFullCatalog() : async {
    modules : [Types.CatalogItem];
    packs   : [Types.CatalogItem];
  } {
    var modules : [Types.CatalogItem] = [];
    var packs   : [Types.CatalogItem] = [];
    for ((_id, s) in imageSets.entries()) {
      let item : Types.CatalogItem = {
        id                  = s.id;
        name                = s.name;
        previewThumbnail    = s.previewThumbnail;
        imageCount          = s.imageCount;
        isFree              = s.isFree;
        priceUsdCents       = s.priceUsdCents;
        isSubscriberContent = s.isSubscriberContent;
        contentType         = s.contentType;
        description         = s.description;
      };
      switch (s.contentType) {
        case (#learningmodule) { modules := modules.concat([item]) };
        case (#referencepack)  { packs   := packs.concat([item])   };
      };
    };
    { modules; packs }
  };

  // ── Per-user entitlement check ────────────────────────────────────────────

  /// Returns true if the given principal may access packId:
  ///   (1) pack.isFree, OR
  ///   (2) permanent entitlement exists, OR
  ///   (3) active subscription AND pack.isSubscriberContent.
  public query func isEntitledTo(userPrincipal : Principal, packId : Text) : async Bool {
    switch (imageSets.get(packId)) {
      case null false;
      case (?s) {
        MarketplaceLib.isEntitledTo(
          entitlements, subscriptions, userPrincipal,
          packId, s.isFree, s.isSubscriberContent, nowMs()
        )
      };
    }
  };

  // ── Subscription queries ──────────────────────────────────────────────────

  /// Returns the caller's current subscription status.
  public shared query ({ caller }) func getSubscriptionStatus() : async Types.SubscriptionStatus {
    MarketplaceLib.getSubscriptionStatus(subscriptions, caller, nowMs())
  };

  // ── Subscription mutations (payments canister only) ──────────────────────

  /// Grants or replaces a subscription. Only callable by the payments canister.
  public shared ({ caller }) func grantSubscription(
    userPrincipal : Principal,
    stripeSubId   : Text,
    expiryDateMs  : Nat64,
  ) : async Bool {
    if (not isPaymentsCaller(caller)) {
      Runtime.trap("Unauthorized: Only the payments canister can grant subscriptions");
    };
    MarketplaceLib.grantSubscription(subscriptions, userPrincipal, stripeSubId, expiryDateMs)
  };

  /// Marks a subscription as cancelled. Only callable by the payments canister.
  /// Access continues until expiryDateMs is past.
  public shared ({ caller }) func revokeSubscription(userPrincipal : Principal) : async Bool {
    if (not isPaymentsCaller(caller)) {
      Runtime.trap("Unauthorized: Only the payments canister can revoke subscriptions");
    };
    MarketplaceLib.revokeSubscription(subscriptions, userPrincipal)
  };

  /// Updates the expiry date of an existing subscription (renewal webhook).
  /// Only callable by the payments canister.
  public shared ({ caller }) func updateSubscriptionExpiry(
    userPrincipal : Principal,
    newExpiryMs   : Nat64,
  ) : async Bool {
    if (not isPaymentsCaller(caller)) {
      Runtime.trap("Unauthorized: Only the payments canister can update subscription expiry");
    };
    MarketplaceLib.updateSubscriptionExpiry(subscriptions, userPrincipal, newExpiryMs)
  };

  // ── Admin — content metadata setters ─────────────────────────────────────

  /// Admin only — set the contentType of an image set.
  public shared ({ caller }) func setContentType(
    setId       : Text,
    contentType : Types.ContentType,
  ) : async Bool {
    if (not isAdmin(caller)) {
      Runtime.trap("Unauthorized: Only admins can set content type");
    };
    switch (imageSets.get(setId)) {
      case null false;
      case (?existing) {
        imageSets.add(setId, { existing with contentType });
        true
      };
    }
  };

  /// Admin only — mark or unmark an image set as subscriber content.
  public shared ({ caller }) func setSubscriberContent(
    setId               : Text,
    isSubscriberContent : Bool,
  ) : async Bool {
    if (not isAdmin(caller)) {
      Runtime.trap("Unauthorized: Only admins can set subscriber content flag");
    };
    switch (imageSets.get(setId)) {
      case null false;
      case (?existing) {
        imageSets.add(setId, { existing with isSubscriberContent });
        true
      };
    }
  };

  /// Admin only — set the description text for an image set.
  public shared ({ caller }) func setDescription(
    setId       : Text,
    description : Text,
  ) : async Bool {
    if (not isAdmin(caller)) {
      Runtime.trap("Unauthorized: Only admins can set description");
    };
    switch (imageSets.get(setId)) {
      case null false;
      case (?existing) {
        imageSets.add(setId, { existing with description });
        true
      };
    }
  };

  /// Admin only — set the USD price in cents for an image set.
  /// Pass null to clear the price (mark as free).
  public shared ({ caller }) func setPriceUsdCents(
    setId         : Text,
    priceUsdCents : ?Nat,
  ) : async Bool {
    if (not isAdmin(caller)) {
      Runtime.trap("Unauthorized: Only admins can set price");
    };
    switch (imageSets.get(setId)) {
      case null false;
      case (?existing) {
        imageSets.add(setId, { existing with priceUsdCents });
        true
      };
    }
  };

};
