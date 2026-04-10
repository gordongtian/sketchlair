import type { Principal } from "@icp-sdk/core/principal";
export interface Some<T> {
    __kind__: "Some";
    value: T;
}
export interface None {
    __kind__: "None";
}
export type Option<T> = Some<T> | None;
export type SettingsSave = string;
export type CanvasSave = string;
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
    getCallerUserProfile(): Promise<UserProfile | null>;
    getCallerUserRole(): Promise<UserRole>;
    getCanvasHash(): Promise<CanvasSave | null>;
    getUserProfile(user: Principal): Promise<UserProfile | null>;
    getUserSettings(): Promise<SettingsSave | null>;
    isCallerAdmin(): Promise<boolean>;
    saveCallerUserProfile(profile: UserProfile): Promise<void>;
    saveCanvasHash(canvasHash: CanvasSave): Promise<void>;
    saveUserSettings(settings: SettingsSave): Promise<void>;
}
