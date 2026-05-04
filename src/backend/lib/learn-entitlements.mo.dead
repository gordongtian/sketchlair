import Map "mo:core/Map";
import List "mo:core/List";
import Array "mo:core/Array";
import Principal "mo:core/Principal";
import Runtime "mo:core/Runtime";
import Types "../types/learn-entitlements";

module {
  public type ImageSet = Types.ImageSet;
  public type ImageReference = Types.ImageReference;

  // ── Registry helpers ────────────────────────────────────────────────────────

  /// Returns all image sets in the registry.
  public func getAllImageSets(
    imageSetRegistry : Map.Map<Text, ImageSet>
  ) : [ImageSet] {
    Runtime.trap("not implemented");
  };

  /// Seeds the registry with the two default starter sets if they are absent.
  public func seedDefaultSets(
    imageSetRegistry : Map.Map<Text, ImageSet>
  ) : () {
    Runtime.trap("not implemented");
  };

  /// Adds or replaces an image set in the registry. Returns the updated set.
  public func upsertImageSet(
    imageSetRegistry : Map.Map<Text, ImageSet>,
    imageSet : ImageSet,
  ) : ImageSet {
    Runtime.trap("not implemented");
  };

  // ── Entitlement helpers ─────────────────────────────────────────────────────

  /// Returns the list of non-default set IDs owned by the given principal.
  public func getEntitlements(
    entitlementsMap : Map.Map<Principal, [Text]>,
    principal : Principal,
  ) : [Text] {
    Runtime.trap("not implemented");
  };

  /// Returns all image sets accessible to the given principal:
  /// all default sets plus any sets explicitly entitled to them.
  public func getUserAccessibleSets(
    imageSetRegistry : Map.Map<Text, ImageSet>,
    entitlementsMap : Map.Map<Principal, [Text]>,
    principal : Principal,
  ) : [ImageSet] {
    Runtime.trap("not implemented");
  };

  /// Grants access to a set for a principal. Returns true if the set exists
  /// and the entitlement was added (or was already present). Returns false
  /// if the setId does not exist in the registry.
  public func grantEntitlement(
    imageSetRegistry : Map.Map<Text, ImageSet>,
    entitlementsMap : Map.Map<Principal, [Text]>,
    principal : Principal,
    setId : Text,
  ) : Bool {
    Runtime.trap("not implemented");
  };

  /// Revokes a set from a principal. Returns true if the entitlement existed
  /// and was removed; false if the principal had no such entitlement.
  public func revokeEntitlement(
    entitlementsMap : Map.Map<Principal, [Text]>,
    principal : Principal,
    setId : Text,
  ) : Bool {
    Runtime.trap("not implemented");
  };
};
