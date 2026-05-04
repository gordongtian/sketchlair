import Map "mo:core/Map";
import Principal "mo:core/Principal";
import Runtime "mo:core/Runtime";
import Types "../types/learn-entitlements";
import LearnEntitlementsLib "../lib/learn-entitlements";

/// Public API mixin for the Learn / Figure Drawing entitlements domain.
///
/// Inject:
///   imageSetRegistry  — Map<Text, ImageSet>         (shared with actor state)
///   entitlementsMap   — Map<Principal, [Text]>       (shared with actor state)
///   accessControlState — the authorization state from caffeineai-authorization
mixin (
  imageSetRegistry : Map.Map<Text, Types.ImageSet>,
  entitlementsMap : Map.Map<Principal, [Text]>,
  accessControlState : { isAdmin : Principal -> Bool; hasPermission : (Principal, { #user }) -> Bool },
) {
  // ── Admin: image set management ─────────────────────────────────────────────

  /// Returns every image set in the registry. Admin use only.
  public query ({ caller }) func getAvailableImageSets() : async [Types.ImageSet] {
    Runtime.trap("not implemented");
  };

  // ── User: discovery ─────────────────────────────────────────────────────────

  /// Returns the default starter sets plus any sets the caller has purchased.
  /// Unauthenticated (anonymous) callers receive only the two default sets.
  public query ({ caller }) func getUserImageSets() : async [Types.ImageSet] {
    Runtime.trap("not implemented");
  };

  /// Returns the list of non-default set IDs the caller has been granted.
  public query ({ caller }) func getUserEntitlements() : async [Text] {
    Runtime.trap("not implemented");
  };

  // ── Admin: entitlement management ───────────────────────────────────────────

  /// Grants the given setId to the principal. Returns true on success,
  /// false if the setId is unknown. Admin only.
  public shared ({ caller }) func grantEntitlement(principal : Principal, setId : Text) : async Bool {
    Runtime.trap("not implemented");
  };

  /// Revokes the given setId from the principal. Returns true if the
  /// entitlement existed and was removed. Admin only.
  public shared ({ caller }) func revokeEntitlement(principal : Principal, setId : Text) : async Bool {
    Runtime.trap("not implemented");
  };
};
