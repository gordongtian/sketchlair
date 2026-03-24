import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Text "mo:core/Text";
import List "mo:core/List";
import Iter "mo:core/Iter";
import Storage "blob-storage/Storage";
import MixinStorage "blob-storage/Mixin";



actor {
  type BrushPreset = {
    name : Text;
    settings : Text;
    tip : Storage.ExternalBlob;
  };

  type UserSettings = {
    darkMode : Bool;
    accentColor : Text;
  };

  let emptyList = List.empty<Storage.ExternalBlob>();

  let emptyUserSettings = {
    darkMode = false;
    accentColor = "blue";
  };

  let brushPresetsMap = Map.empty<Nat, BrushPreset>();
  let userSettingsMap = Map.empty<Text, UserSettings>();

  public shared ({ caller }) func storeBrushPreset(userId : Text, presetId : Nat, name : Text, settings : Text, tip : Storage.ExternalBlob) : async () {
    let brushPreset : BrushPreset = {
      name;
      settings;
      tip;
    };
    brushPresetsMap.add(presetId, brushPreset);
  };

  public query ({ caller }) func getBrushPreset(userId : Text, presetId : Nat) : async ?BrushPreset {
    brushPresetsMap.get(presetId);
  };

  public query ({ caller }) func getAllBrushPresetIds(userId : Text) : async [Nat] {
    brushPresetsMap.keys().toArray();
  };

  public shared ({ caller }) func deleteBrushPreset(userId : Text, presetId : Nat) : async ?BrushPreset {
    let deleted = brushPresetsMap.get(presetId);
    brushPresetsMap.remove(presetId);
    deleted;
  };

  public shared ({ caller }) func setUserSettings(userId : Text, settings : UserSettings) : async () {
    userSettingsMap.add(userId, settings);
  };

  public query ({ caller }) func getUserSettings(userId : Text) : async UserSettings {
    switch (userSettingsMap.get(userId)) {
      case (null) { emptyUserSettings };
      case (?settings) { settings };
    };
  };

  include MixinStorage();
};
