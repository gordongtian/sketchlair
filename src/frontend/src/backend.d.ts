import type { Principal } from "@icp-sdk/core/principal";
export interface Some<T> {
    __kind__: "Some";
    value: T;
}
export interface None {
    __kind__: "None";
}
export type Option<T> = Some<T> | None;
export interface AppSettings {
    uiScale: number;
    theme: string;
    canvasBackground: string;
    modifiedAt: bigint;
    otherSettings: string;
}
export interface UserPreferences {
    brushes: Array<BrushPreset>;
    hotkeys: HotkeyAssignments;
    lastModified: bigint;
    settings: AppSettings;
    schemaVersion: bigint;
}
export type SettingsSave = string;
export interface HotkeyAssignments {
    assignments: string;
    modifiedAt: bigint;
}
export type CanvasSave = string;
export interface BrushPreset {
    id: string;
    modifiedAt: bigint;
    name: string;
    createdAt: bigint;
    settings: string;
    isDefault: boolean;
}
export interface UserProfile {
    name: string;
}
export enum UserRole {
    admin = "admin",
    user = "user",
    guest = "guest"
}
export interface backendInterface {
    assignCallerUserRole(user: Principal, role: UserRole): Promise<void>;
    /**
     * / Removes a single brush by id. No-op if the caller has no record or the
     * / brush id is not found.
     */
    deleteBrush(id: string): Promise<void>;
    getBrushPresets(): Promise<string | null>;
    getCallerUserProfile(): Promise<UserProfile | null>;
    getCallerUserRole(): Promise<UserRole>;
    getCanvasHash(): Promise<CanvasSave | null>;
    /**
     * / Returns all stored preferences for the caller, or null if none saved yet.
     */
    getPreferences(): Promise<UserPreferences | null>;
    /**
     * / Returns the schema version stored for the caller, or 0 if no record exists.
     */
    getSchemaVersion(): Promise<bigint>;
    getUserProfile(user: Principal): Promise<UserProfile | null>;
    getUserSettings(): Promise<SettingsSave | null>;
    isCallerAdmin(): Promise<boolean>;
    /**
     * / Upserts a single brush by id. Creates a default preferences record first
     * / if the caller has no existing record.
     */
    saveBrush(brush: BrushPreset): Promise<void>;
    saveBrushPresets(data: string): Promise<void>;
    saveCallerUserProfile(profile: UserProfile): Promise<void>;
    saveCanvasHash(canvasHash: CanvasSave): Promise<void>;
    /**
     * / Atomically replaces all preferences for the caller.
     * / Always overwrites lastModified with the current canister time.
     */
    savePreferences(prefs: UserPreferences): Promise<void>;
    saveUserSettings(settings: SettingsSave): Promise<void>;
}
