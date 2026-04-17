import Principal "mo:core/Principal";
import Map "mo:core/Map";
import Array "mo:core/Array";
import Time "mo:core/Time";
import Runtime "mo:core/Runtime";

import MixinAuthorization "mo:caffeineai-authorization/MixinAuthorization";
import MixinObjectStorage "mo:caffeineai-object-storage/Mixin";
import AccessControl "mo:caffeineai-authorization/access-control";


actor {
  // Initialize the access control system
  let accessControlState = AccessControl.initState();
  include MixinAuthorization(accessControlState);

  // User profile type as required by frontend
  public type UserProfile = {
    name : Text;
  };

  let userProfiles = Map.empty<Principal, UserProfile>();

  // Required user profile functions
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

  // Canvas and settings storage
  type CanvasSave = Text;
  type SettingsSave = Text;
  let canvasSaveMap = Map.empty<Principal, CanvasSave>();
  let settingsMap = Map.empty<Principal, SettingsSave>();
  let brushPresetsMap = Map.empty<Principal, Text>();

  // Canvas hash functions - require authenticated user
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

  // User settings functions - require authenticated user (legacy, kept for backward compatibility)
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

  // Brush presets storage (legacy) — kept for backward compatibility
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
    settings : Text;   // JSON-serialized brush parameters
    createdAt : Int;
    modifiedAt : Int;
  };

  public type AppSettings = {
    theme : Text;
    canvasBackground : Text;
    uiScale : Float;
    otherSettings : Text;  // JSON-serialized remaining settings
    modifiedAt : Int;
  };

  public type HotkeyAssignments = {
    assignments : Text;  // JSON-serialized hotkey map
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

  // Default preferences used when a caller has no record yet
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

  /// Returns all stored preferences for the caller, or null if none saved yet.
  public query ({ caller }) func getPreferences() : async ?UserPreferences {
    if (not (AccessControl.hasPermission(accessControlState, caller, #user))) {
      Runtime.trap("Unauthorized: Only users can retrieve preferences");
    };
    preferencesMap.get(caller);
  };

  /// Atomically replaces all preferences for the caller.
  /// Always overwrites lastModified with the current canister time.
  public shared ({ caller }) func savePreferences(prefs : UserPreferences) : async () {
    if (not (AccessControl.hasPermission(accessControlState, caller, #user))) {
      Runtime.trap("Unauthorized: Only users can save preferences");
    };
    let updated : UserPreferences = { prefs with lastModified = Time.now() };
    preferencesMap.add(caller, updated);
  };

  /// Upserts a single brush by id. Creates a default preferences record first
  /// if the caller has no existing record.
  public shared ({ caller }) func saveBrush(brush : BrushPreset) : async () {
    if (not (AccessControl.hasPermission(accessControlState, caller, #user))) {
      Runtime.trap("Unauthorized: Only users can save brushes");
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

  /// Removes a single brush by id. No-op if the caller has no record or the
  /// brush id is not found.
  public shared ({ caller }) func deleteBrush(id : Text) : async () {
    if (not (AccessControl.hasPermission(accessControlState, caller, #user))) {
      Runtime.trap("Unauthorized: Only users can delete brushes");
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

  /// Returns the schema version stored for the caller, or 0 if no record exists.
  public query ({ caller }) func getSchemaVersion() : async Nat {
    switch (preferencesMap.get(caller)) {
      case (?prefs) prefs.schemaVersion;
      case null 0;
    };
  };

  // INSTANT COMPONENT BLOB STORAGE
  include MixinObjectStorage();
};
