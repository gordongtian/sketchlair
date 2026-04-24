module {
  /// A single reference to a CDN-hosted image asset.
  /// assetUrl is the full CDN URL (e.g. https://blob.caffeine.ai/<hash>).
  public type ImageReference = {
    id : Text;
    assetUrl : Text;
    width : Nat;
    height : Nat;
  };

  /// An image set available for Figure Drawing sessions.
  /// isDefault = true for the two built-in starter sets that every user can access.
  /// priceICP = null for free sets; "0.5" means 0.5 ICP for paid sets.
  public type ImageSet = {
    id : Text;
    name : Text;
    previewThumbnail : Text;   // CDN URL for the thumbnail
    imageCount : Nat;
    isDefault : Bool;
    images : [ImageReference];
    priceICP : ?Text;
  };
};
