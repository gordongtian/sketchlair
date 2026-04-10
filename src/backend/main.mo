import Principal "mo:core/Principal";
import Map "mo:core/Map";
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

  // User settings functions - require authenticated user
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

  // INSTANT COMPONENT BLOB STORAGE
  include MixinObjectStorage();
};
