import Debug "mo:core/Debug";

module {

  /// Variant for content category — reference image packs or structured learning modules.
  public type ContentType = { #referencepack; #learningmodule };

  /// Subscription record stored per principal.
  /// active=false means the subscription was cancelled but may still be within
  /// the paid billing window (check expiryDateMs to determine access).
  public type Subscription = {
    stripeSubId   : Text;
    expiryDateMs  : Nat64;
    active        : Bool;
  };

  /// Immutable catalog entry returned to the frontend — never includes the
  /// images array so CDN URLs are not leaked to unpurchased callers.
  public type CatalogItem = {
    id                 : Text;
    name               : Text;
    previewThumbnail   : Text;
    imageCount         : Nat;
    isFree             : Bool;
    priceUsdCents      : ?Nat;
    isSubscriberContent : Bool;
    contentType        : ContentType;
    description        : Text;
  };

  /// Lightweight subscription status type returned to the caller.
  public type SubscriptionStatus = {
    active       : Bool;
    expiryDateMs : ?Nat64;
  };

};
