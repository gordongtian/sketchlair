import Principal "mo:core/Principal";
import Map "mo:core/Map";
import Set "mo:core/Set";
import Time "mo:core/Time";
import Runtime "mo:core/Runtime";
import Nat "mo:core/Nat";
import Text "mo:core/Text";

import MixinAuthorization "mo:caffeineai-authorization/MixinAuthorization";
import MixinObjectStorage "mo:caffeineai-object-storage/Mixin";
import AccessControl "mo:caffeineai-authorization/access-control";



actor {
  // Initialize the access control system
  let accessControlState = AccessControl.initState();
  include MixinAuthorization(accessControlState);

  // ─────────────────────────────────────────────────────────────────────────
  // Upgrade migration tombstones — stable vars that existed in a previous
  // version and were removed. Kept here as dummy stable vars so Motoko's
  // upgrade compatibility checker does not reject the upgrade with M0169.
  // They hold no data of interest and will never be written to again.
  // ─────────────────────────────────────────────────────────────────────────
  stable var ADMIN_PRINCIPAL_GEN : Text = "";
  stable var ADMIN_PRINCIPAL_DRAFT : Text = "";
  stable var adminSeedApplied : Bool = false;

  // ─────────────────────────────────────────────────────────────────────────
  // Admin Principal Registry
  // Custom admin set keyed by principal — separate from the caffeineai-authorization
  // extension's admin system. Stored as a Set<Principal> using mo:core/Set.
  // Enhanced orthogonal persistence: state survives upgrades automatically
  // without stable variables or preupgrade/postupgrade hooks.
  //
  // HARDCODED ADMIN PRINCIPALS — both are guaranteed to be in the admin set
  // after every deploy, seeded lazily on first admin access:
  //   1. l4bkr-kc7sl-rwtfp-35m3x-tehtd-ncdll-3lkn3-6im7y-uabuj-wci4d-tae  (gen / production account)
  //   2. 4oonm-seqtd-whea7-bwcol-elxvd-dlik6-lha53-v6irf-oq6ao-ygjes-eqe  (draft / preview account)
  //
  // No manual principal replacement is needed — both are already hardcoded.
  // ─────────────────────────────────────────────────────────────────────────

  // Hardcoded admin principals — checked via pure text comparison, no mutation needed.
  // Safe to call from query functions because no state is ever mutated.
  // Both principals are always admins regardless of canister upgrade history.
  //   1. l4bkr-kc7sl-rwtfp-35m3x-tehtd-ncdll-3lkn3-6im7y-uabuj-wci4d-tae  (gen / production)
  //   2. 4oonm-seqtd-whea7-bwcol-elxvd-dlik6-lha53-v6irf-oq6ao-ygjes-eqe  (draft / preview)
  let HARDCODED_ADMINS : [Text] = [
    "l4bkr-kc7sl-rwtfp-35m3x-tehtd-ncdll-3lkn3-6im7y-uabuj-wci4d-tae",
    "4oonm-seqtd-whea7-bwcol-elxvd-dlik6-lha53-v6irf-oq6ao-ygjes-eqe",
  ];

  // Dynamic admin set — for admins added at runtime via addAdmin().
  // Hardcoded admins above are always admins regardless of this set.
  let admins = Set.empty<Principal>();

  /// Returns true if principal is one of the hardcoded admins.
  /// Pure text comparison — no state mutation, safe for query functions.
  func isHardcodedAdmin(p : Principal) : Bool {
    let pText = p.toText();
    for (adminText in HARDCODED_ADMINS.vals()) {
      if (pText == adminText) return true;
    };
    false
  };

  /// Internal helper — synchronous admin check (no async, no mutation).
  /// Checks hardcoded admins first (pure read), then dynamic set.
  func isAdminPrincipal(p : Principal) : Bool {
    if (isHardcodedAdmin(p)) return true;
    admins.contains(p)
  };

  /// Returns true if the given principal is in the admin set.
  /// Safe as a query because isAdminPrincipal() never mutates state.
  public query func isAdmin(p : Principal) : async Bool {
    isAdminPrincipal(p)
  };

  /// Adds a new admin. Only an existing admin may call this.
  /// Returns false if the caller is not an admin.
  public shared ({ caller }) func addAdmin(newAdmin : Principal) : async Bool {
    if (not isAdminPrincipal(caller)) {
      return false;
    };
    admins.add(newAdmin);
    true
  };

  /// Removes an admin. Only an existing admin may call this.
  /// Returns false if the caller is not an admin or if the caller tries
  /// to remove themselves.
  public shared ({ caller }) func removeAdmin(target : Principal) : async Bool {
    if (not isAdminPrincipal(caller)) {
      return false;
    };
    if (Principal.equal(caller, target)) {
      return false; // cannot remove self
    };
    admins.remove(target);
    true
  };

  // ─────────────────────────────────────────────────────────────────────────
  // User Profile
  // ─────────────────────────────────────────────────────────────────────────

  public type UserProfile = {
    name : Text;
  };

  let userProfiles = Map.empty<Principal, UserProfile>();

  public query ({ caller }) func getCallerUserProfile() : async ?UserProfile {
    if (not (AccessControl.hasPermission(accessControlState, caller, #user))) {
      Runtime.trap("Unauthorized: Only users can access profiles");
    };
    userProfiles.get(caller);
  };

  public query ({ caller }) func getUserProfile(user : Principal) : async ?UserProfile {
    if (caller != user and not AccessControl.isAdmin(accessControlState, caller)) {
      Runtime.trap("Unauthorized: Can only view your own profile");
    };
    userProfiles.get(user);
  };

  public shared ({ caller }) func saveCallerUserProfile(profile : UserProfile) : async () {
    if (not (AccessControl.hasPermission(accessControlState, caller, #user))) {
      Runtime.trap("Unauthorized: Only users can save profiles");
    };
    userProfiles.add(caller, profile);
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Canvas and Settings Storage (legacy)
  // ─────────────────────────────────────────────────────────────────────────

  type CanvasSave = Text;
  type SettingsSave = Text;
  let canvasSaveMap = Map.empty<Principal, CanvasSave>();
  let settingsMap = Map.empty<Principal, SettingsSave>();
  let brushPresetsMap = Map.empty<Principal, Text>();

  public shared ({ caller }) func saveCanvasHash(canvasHash : CanvasSave) : async () {
    if (not (AccessControl.hasPermission(accessControlState, caller, #user))) {
      Runtime.trap("Unauthorized: Only users can save canvas data");
    };
    canvasSaveMap.add(caller, canvasHash);
  };

  public query ({ caller }) func getCanvasHash() : async ?CanvasSave {
    if (not (AccessControl.hasPermission(accessControlState, caller, #user))) {
      Runtime.trap("Unauthorized: Only users can retrieve canvas data");
    };
    canvasSaveMap.get(caller);
  };

  public shared ({ caller }) func saveUserSettings(settings : SettingsSave) : async () {
    if (not (AccessControl.hasPermission(accessControlState, caller, #user))) {
      Runtime.trap("Unauthorized: Only users can save settings");
    };
    settingsMap.add(caller, settings);
  };

  public query ({ caller }) func getUserSettings() : async ?SettingsSave {
    if (not (AccessControl.hasPermission(accessControlState, caller, #user))) {
      Runtime.trap("Unauthorized: Only users can retrieve settings");
    };
    settingsMap.get(caller);
  };

  public shared ({ caller }) func saveBrushPresets(data : Text) : async () {
    if (not (AccessControl.hasPermission(accessControlState, caller, #user))) {
      Runtime.trap("Unauthorized: Only users can save brush presets");
    };
    brushPresetsMap.add(caller, data);
  };

  public query ({ caller }) func getBrushPresets() : async ?Text {
    if (not (AccessControl.hasPermission(accessControlState, caller, #user))) {
      Runtime.trap("Unauthorized: Only users can retrieve brush presets");
    };
    brushPresetsMap.get(caller);
  };

  // ─────────────────────────────────────────────────────────────────────────
  // User Preferences — structured, per-principal, upgrade-safe persistence
  // ─────────────────────────────────────────────────────────────────────────

  public type BrushPreset = {
    id : Text;
    name : Text;
    isDefault : Bool;
    settings : Text;
    createdAt : Int;
    modifiedAt : Int;
  };

  public type AppSettings = {
    theme : Text;
    canvasBackground : Text;
    uiScale : Float;
    otherSettings : Text;
    modifiedAt : Int;
  };

  public type HotkeyAssignments = {
    assignments : Text;
    modifiedAt : Int;
  };

  public type UserPreferences = {
    brushes : [BrushPreset];
    settings : AppSettings;
    hotkeys : HotkeyAssignments;
    schemaVersion : Nat;
    lastModified : Int;
  };

  let preferencesMap = Map.empty<Principal, UserPreferences>();

  func defaultPreferences() : UserPreferences {
    {
      brushes = [];
      settings = {
        theme = "dark";
        canvasBackground = "#ffffff";
        uiScale = 1.0;
        otherSettings = "{}";
        modifiedAt = Time.now();
      };
      hotkeys = {
        assignments = "{}";
        modifiedAt = Time.now();
      };
      schemaVersion = 1;
      lastModified = Time.now();
    };
  };

  public shared ({ caller }) func getPreferences() : async ?UserPreferences {
    // Reject anonymous callers — they have no principal to key preferences on.
    if (caller.isAnonymous()) {
      return null;
    };
    switch (preferencesMap.get(caller)) {
      case (?prefs) ?prefs;
      case null {
        // First-time user — auto-initialize with defaults and return them.
        // This is idempotent: subsequent calls will find the entry and return it.
        let defaults = defaultPreferences();
        preferencesMap.add(caller, defaults);
        ?defaults
      };
    }
  };

  public shared ({ caller }) func savePreferences(prefs : UserPreferences) : async () {
    if (caller.isAnonymous()) {
      Runtime.trap("Unauthorized: Anonymous callers cannot save preferences");
    };
    let updated : UserPreferences = { prefs with lastModified = Time.now() };
    preferencesMap.add(caller, updated);
  };

  public shared ({ caller }) func saveBrush(brush : BrushPreset) : async () {
    if (caller.isAnonymous()) {
      Runtime.trap("Unauthorized: Anonymous callers cannot save brushes");
    };
    let existing = switch (preferencesMap.get(caller)) {
      case (?p) p;
      case null defaultPreferences();
    };
    let filtered = existing.brushes.filter(func(b : BrushPreset) : Bool { b.id != brush.id });
    let updatedBrushes = filtered.concat([brush]);
    let updated : UserPreferences = {
      existing with
      brushes = updatedBrushes;
      lastModified = Time.now();
    };
    preferencesMap.add(caller, updated);
  };

  public shared ({ caller }) func deleteBrush(id : Text) : async () {
    if (caller.isAnonymous()) {
      Runtime.trap("Unauthorized: Anonymous callers cannot delete brushes");
    };
    switch (preferencesMap.get(caller)) {
      case null {};
      case (?existing) {
        let filtered = existing.brushes.filter(func(b : BrushPreset) : Bool { b.id != id });
        let updated : UserPreferences = {
          existing with
          brushes = filtered;
          lastModified = Time.now();
        };
        preferencesMap.add(caller, updated);
      };
    };
  };

  public query ({ caller }) func getSchemaVersion() : async Nat {
    if (caller.isAnonymous()) return 0;
    switch (preferencesMap.get(caller)) {
      case (?prefs) prefs.schemaVersion;
      case null 0;
    };
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Learn / Figure Drawing — Image Sets & Entitlements
  // ─────────────────────────────────────────────────────────────────────────

  public type ImageReference = {
    id : Text;
    assetUrl : Text;
    width : Nat;
    height : Nat;
  };

  public type ImageSet = {
    id : Text;
    name : Text;
    previewThumbnail : Text;
    imageCount : Nat;
    isDefault : Bool;
    isFree : Bool;
    images : [ImageReference];
    priceICP : ?Text;   // null for free sets; "0.5" = 0.5 ICP for paid sets
    tags : [Text];
  };

  // Counter for generating unique IDs for user-created image sets
  var imageSetIdCounter : Nat = 0;

  func buildStarterSet(gender : Text) : ImageSet {
    {
      id = "starter-" # gender;
      name = "Starter Set \u{2014} " # (if (gender == "male") "Male" else "Female");
      previewThumbnail = "";
      imageCount = 0;
      isDefault = true;
      isFree = true;
      images = [];
      priceICP = null;
      tags = [];
    }
  };

  let imageSetRegistry = Map.empty<Text, ImageSet>();
  let entitlementsMap = Map.empty<Principal, [Text]>();

  // Seed default sets only when the registry is empty (first canister start)
  do {
    if (imageSetRegistry.isEmpty()) {
      let male = buildStarterSet("male");
      let female = buildStarterSet("female");
      imageSetRegistry.add(male.id, male);
      imageSetRegistry.add(female.id, female);
    };
  };

  // One-time migration flag: clears dummy placeholder images from both starter
  // sets that were seeded in a prior deploy. Checked lazily so it runs on the
  // first canister access after --mode upgrade, not only on fresh install.
  var starterSetsCleared : Bool = false;

  func ensureStarterSetsCleared() {
    if (not starterSetsCleared) {
      for (setId in ["starter-male", "starter-female"].vals()) {
        switch (imageSetRegistry.get(setId)) {
          case null {};
          case (?existing) {
            let cleared : ImageSet = {
              existing with
              images = [];
              imageCount = 0;
              previewThumbnail = "";
              priceICP = null;
              tags = [];
            };
            imageSetRegistry.add(setId, cleared);
          };
        };
      };
      starterSetsCleared := true;
    };
  };

  /// Returns all default image sets plus any sets the caller has been granted.
  public shared ({ caller }) func getUserImageSets() : async [ImageSet] {
    ensureStarterSetsCleared();
    let defaults : [ImageSet] = imageSetRegistry.foldLeft([], func(acc : [ImageSet], _id : Text, s : ImageSet) : [ImageSet] {
      if (s.isDefault) acc.concat([s]) else acc
    });
    let entitlements : [Text] = switch (entitlementsMap.get(caller)) {
      case (?ids) ids;
      case null [];
    };
    let purchased = entitlements.filterMap(func(setId : Text) : ?ImageSet {
      imageSetRegistry.get(setId)
    });
    let defaultIds = defaults.map(func(s : ImageSet) : Text { s.id });
    let extra = purchased.filter(func(s : ImageSet) : Bool {
      defaultIds.find(func(id : Text) : Bool { id == s.id }) == null
    });
    defaults.concat(extra)
  };

  /// Public type for the marketplace catalog — omits the images array to avoid
  /// leaking CDN URLs for packs the caller does not own.
  public type PublicImageSet = {
    id             : Text;
    name           : Text;
    previewThumbnail : Text;
    imageCount     : Nat;
    isFree         : Bool;
    isDefault      : Bool;
  };

  /// Public query — returns ALL image sets as catalog entries (no images array).
  /// Used by the marketplace to build the full grid so users can see and purchase
  /// packs they do not yet own. Diff against getAvailableImageSets() for owned state.
  public query func getAllPublicImageSets() : async [PublicImageSet] {
    imageSetRegistry.foldLeft([], func(acc : [PublicImageSet], _id : Text, s : ImageSet) : [PublicImageSet] {
      let entry : PublicImageSet = {
        id               = s.id;
        name             = s.name;
        previewThumbnail = s.previewThumbnail;
        imageCount       = s.imageCount;
        isFree           = s.isFree;
        isDefault        = s.isDefault;
      };
      acc.concat([entry])
    })
  };

  /// Public query — returns all free sets plus sets the caller has purchased entitlements for.
  public query ({ caller }) func getAvailableImageSets() : async [ImageSet] {
    let entitlements : [Text] = switch (entitlementsMap.get(caller)) {
      case (?ids) ids;
      case null [];
    };
    imageSetRegistry.foldLeft([], func(acc : [ImageSet], _id : Text, s : ImageSet) : [ImageSet] {
      if (s.isFree) {
        acc.concat([s])
      } else {
        let hasEntitlement = entitlements.find(func(eid : Text) : Bool { eid == s.id }) != null;
        if (hasEntitlement) acc.concat([s]) else acc
      }
    })
  };

  /// Returns the set IDs the caller has been explicitly granted.
  public query ({ caller }) func getUserEntitlements() : async [Text] {
    switch (entitlementsMap.get(caller)) {
      case (?ids) ids;
      case null [];
    }
  };

  /// Admin: grant a set to a principal. Returns false if the set does not exist.
  public shared ({ caller }) func grantEntitlement(principal : Principal, setId : Text) : async Bool {
    if (not AccessControl.isAdmin(accessControlState, caller)) {
      Runtime.trap("Unauthorized: Only admins can grant entitlements");
    };
    switch (imageSetRegistry.get(setId)) {
      case null false;
      case (?_) {
        let existing : [Text] = switch (entitlementsMap.get(principal)) {
          case (?ids) ids;
          case null [];
        };
        let alreadyOwned = existing.find(func(id : Text) : Bool { id == setId }) != null;
        if (not alreadyOwned) {
          entitlementsMap.add(principal, existing.concat([setId]));
        };
        true
      };
    }
  };

  /// Admin: revoke a set from a principal. Returns false if the set does not exist.
  public shared ({ caller }) func revokeEntitlement(principal : Principal, setId : Text) : async Bool {
    if (not AccessControl.isAdmin(accessControlState, caller)) {
      Runtime.trap("Unauthorized: Only admins can revoke entitlements");
    };
    switch (imageSetRegistry.get(setId)) {
      case null false;
      case (?_) {
        let existing : [Text] = switch (entitlementsMap.get(principal)) {
          case (?ids) ids;
          case null [];
        };
        let filtered = existing.filter(func(id : Text) : Bool { id != setId });
        entitlementsMap.add(principal, filtered);
        true
      };
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Image Set Management — Admin Functions
  // All write operations verify msg.caller is in the custom admin set.
  // Image uploads go directly to the ICP asset canister — these functions
  // only manage metadata (references). Never route image bytes here.
  // ─────────────────────────────────────────────────────────────────────────

  /// Admin only — create a new image set.
  /// Returns the new set's ID on success, null if caller is not admin or
  /// name is invalid (must be 3–50 characters).
  /// If isFree is true, priceICP is ignored and stored as null.
  /// If isDefault is true, all other sets are unset as default.
  public shared ({ caller }) func createImageSet(name : Text, isFree : Bool, isDefault : Bool, priceICP : ?Text) : async ?Text {
    if (not isAdminPrincipal(caller)) {
      return null;
    };
    let nameLen = name.size();
    if (nameLen < 3 or nameLen > 50) {
      return null;
    };
    // If this set is the new default, unset isDefault on all existing sets
    if (isDefault) {
      imageSetRegistry.forEach(func(id : Text, s : ImageSet) {
        if (s.isDefault) {
          imageSetRegistry.add(id, { s with isDefault = false });
        };
      });
    };
    imageSetIdCounter += 1;
    let newId = "set-" # imageSetIdCounter.toText();
    let resolvedPrice : ?Text = if (isFree) null else priceICP;
    let newSet : ImageSet = {
      id = newId;
      name;
      previewThumbnail = "";
      imageCount = 0;
      isDefault;
      isFree;
      images = [];
      priceICP = resolvedPrice;
      tags = [];
    };
    imageSetRegistry.add(newId, newSet);
    ?newId
  };

  /// Admin only — mark a set as the sole default set.
  /// Unsets isDefault on all other sets. Returns false if caller is not admin
  /// or the setId does not exist.
  public shared ({ caller }) func setImageSetDefault(setId : Text) : async Bool {
    if (not isAdminPrincipal(caller)) {
      return false;
    };
    switch (imageSetRegistry.get(setId)) {
      case null false;
      case (?_) {
        // Unset all existing defaults
        imageSetRegistry.forEach(func(id : Text, s : ImageSet) {
          if (s.isDefault) {
            imageSetRegistry.add(id, { s with isDefault = false });
          };
        });
        // Set the target as default
        switch (imageSetRegistry.get(setId)) {
          case null false;
          case (?s) {
            imageSetRegistry.add(setId, { s with isDefault = true });
            true
          };
        }
      };
    }
  };

  /// Admin only — set or clear the price of a set.
  /// Pass null to clear the price (make free). Returns false if caller is not admin
  /// or the setId does not exist.
  public shared ({ caller }) func setImageSetPrice(setId : Text, priceICP : ?Text) : async Bool {
    if (not isAdminPrincipal(caller)) {
      return false;
    };
    switch (imageSetRegistry.get(setId)) {
      case null false;
      case (?existing) {
        imageSetRegistry.add(setId, { existing with priceICP });
        true
      };
    }
  };

  /// Admin only — add an image reference to a set.
  /// Returns false if caller is not admin or setId doesn't exist.
  public shared ({ caller }) func addImageToSet(setId : Text, image : ImageReference) : async Bool {
    if (not isAdminPrincipal(caller)) {
      return false;
    };
    ensureStarterSetsCleared();
    switch (imageSetRegistry.get(setId)) {
      case null false;
      case (?existing) {
        // Prevent duplicate image IDs within the same set
        let alreadyPresent = existing.images.find(func(img : ImageReference) : Bool { img.id == image.id }) != null;
        if (alreadyPresent) {
          return false;
        };
        let newImages = existing.images.concat([image]);
        let updated : ImageSet = {
          existing with
          images = newImages;
          imageCount = newImages.size();
        };
        imageSetRegistry.add(setId, updated);
        true
      };
    }
  };

  /// Admin only — remove an image reference from a set.
  /// Returns false if caller is not admin, setId doesn't exist, or imageId not found.
  public shared ({ caller }) func removeImageFromSet(setId : Text, imageId : Text) : async Bool {
    if (not isAdminPrincipal(caller)) {
      return false;
    };
    switch (imageSetRegistry.get(setId)) {
      case null false;
      case (?existing) {
        let imageExists = existing.images.find(func(img : ImageReference) : Bool { img.id == imageId }) != null;
        if (not imageExists) {
          return false;
        };
        let newImages = existing.images.filter(func(img : ImageReference) : Bool { img.id != imageId });
        let updated : ImageSet = {
          existing with
          images = newImages;
          imageCount = newImages.size();
        };
        imageSetRegistry.add(setId, updated);
        true
      };
    }
  };

  /// Admin only — delete an entire image set.
  /// Cannot delete default sets (isDefault == true).
  /// Returns false if caller is not admin, setId doesn't exist, or set is a default.
  public shared ({ caller }) func deleteImageSet(setId : Text) : async Bool {
    if (not isAdminPrincipal(caller)) {
      return false;
    };
    switch (imageSetRegistry.get(setId)) {
      case null false;
      case (?existing) {
        if (existing.isDefault) {
          return false; // default sets cannot be deleted
        };
        imageSetRegistry.remove(setId);
        true
      };
    }
  };

  /// Admin only — update the tags for an image set.
  /// All tags are normalized to lowercase before storing.
  /// Returns false if caller is not admin or setId doesn't exist.
  public shared ({ caller }) func updateSetTags(setId : Text, tags : [Text]) : async Bool {
    if (not isAdminPrincipal(caller)) {
      return false;
    };
    switch (imageSetRegistry.get(setId)) {
      case null false;
      case (?existing) {
        let normalizedTags = tags.map(func(t : Text) : Text { t.toLower() });
        imageSetRegistry.add(setId, { existing with tags = normalizedTags });
        true
      };
    }
  };

  /// Admin only — rename an image set.
  /// newName must not be empty. Returns false if caller is not admin,
  /// setId doesn't exist, or newName is empty.
  public shared ({ caller }) func renameSet(setId : Text, newName : Text) : async Bool {
    if (not isAdminPrincipal(caller)) {
      return false;
    };
    if (newName.size() == 0) {
      return false;
    };
    switch (imageSetRegistry.get(setId)) {
      case null false;
      case (?existing) {
        imageSetRegistry.add(setId, { existing with name = newName });
        true
      };
    }
  };

  /// Admin only — get all image sets including paid ones, for admin management UI.
  /// Returns an empty array if caller is not admin.
  /// Uses an update call (not query) so it can run ensureStarterSetsCleared()
  /// to strip any legacy dummy placeholder images on first access after a deploy.
  public shared ({ caller }) func getAllImageSetsAdmin() : async [ImageSet] {
    if (not isAdminPrincipal(caller)) {
      return [];
    };
    ensureStarterSetsCleared();
    imageSetRegistry.foldLeft([], func(acc : [ImageSet], _id : Text, s : ImageSet) : [ImageSet] {
      acc.concat([s])
    })
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Username Registry — bidirectional principal ↔ username mapping
  // Enhanced orthogonal persistence: state survives upgrades automatically.
  // All write operations use msg.caller — no principal accepted as parameter.
  // ─────────────────────────────────────────────────────────────────────────

  let usernameToPrincipal = Map.empty<Text, Principal>();
  let principalToUsername = Map.empty<Principal, Text>();

  /// Returns true if the username is not yet taken — free query call.
  public query func checkUsernameAvailable(username : Text) : async Bool {
    usernameToPrincipal.get(username) == null
  };

  /// Registers a username for the caller's principal.
  /// Returns true on success, false if the caller already has a username
  /// or if the username is already taken (race condition guard).
  public shared ({ caller }) func registerUsername(username : Text) : async Bool {
    // Reject if caller already has a username
    if (principalToUsername.get(caller) != null) {
      return false;
    };
    // Reject if username is already taken
    if (usernameToPrincipal.get(username) != null) {
      return false;
    };
    // Register atomically in both maps
    usernameToPrincipal.add(username, caller);
    principalToUsername.add(caller, username);
    true
  };

  /// Returns the username for the caller's principal, or null if none registered.
  public query ({ caller }) func getMyUsername() : async ?Text {
    principalToUsername.get(caller)
  };

  /// Returns the username for any given principal — for display purposes.
  public query func getUsernameForPrincipal(p : Principal) : async ?Text {
    principalToUsername.get(p)
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Payments Canister Integration
  // The payments canister principal is stored here so grantPackEntitlement
  // can verify the caller is the trusted payments canister.
  // Only admins may set this value. The secret key never leaves the
  // payments canister — this is only the canister's own principal ID.
  // ─────────────────────────────────────────────────────────────────────────

  var paymentsCanisterPrincipal : ?Principal = null;

  /// Admin only — store the trusted payments canister principal.
  /// grantPackEntitlement will only accept calls from this principal.
  /// Returns false if the caller is not an admin.
  public shared ({ caller }) func setPaymentsCanisterPrincipal(p : Principal) : async Bool {
    if (not isAdminPrincipal(caller)) {
      return false;
    };
    paymentsCanisterPrincipal := ?p;
    true
  };

  /// Called by the payments canister to grant a pack entitlement to a user.
  /// Only the stored payments canister principal is allowed to call this.
  /// Idempotent — adding an entitlement the user already has is a no-op.
  /// Returns false if the caller is not the trusted payments canister,
  /// if no payments canister principal has been configured, or if the
  /// pack does not exist in the image set registry.
  public shared ({ caller }) func grantPackEntitlement(userPrincipal : Principal, packId : Text) : async Bool {
    // Reject if no payments canister has been configured
    let trustedPrincipal = switch (paymentsCanisterPrincipal) {
      case null { return false };
      case (?p) p;
    };
    // Reject if caller is not the trusted payments canister
    if (not Principal.equal(caller, trustedPrincipal)) {
      return false;
    };
    // Reject if the pack does not exist
    switch (imageSetRegistry.get(packId)) {
      case null { return false };
      case (?_) {
        let existing : [Text] = switch (entitlementsMap.get(userPrincipal)) {
          case (?ids) ids;
          case null [];
        };
        let alreadyOwned = existing.find(func(id : Text) : Bool { id == packId }) != null;
        if (not alreadyOwned) {
          entitlementsMap.add(userPrincipal, existing.concat([packId]));
        };
        true
      };
    }
  };

  // INSTANT COMPONENT BLOB STORAGE
  include MixinObjectStorage();
};
