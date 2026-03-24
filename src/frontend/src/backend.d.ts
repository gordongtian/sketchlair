import type { Principal } from "@icp-sdk/core/principal";
export interface Some<T> {
    __kind__: "Some";
    value: T;
}
export interface None {
    __kind__: "None";
}
export type Option<T> = Some<T> | None;
export class ExternalBlob {
    getBytes(): Promise<Uint8Array<ArrayBuffer>>;
    getDirectURL(): string;
    static fromURL(url: string): ExternalBlob;
    static fromBytes(blob: Uint8Array<ArrayBuffer>): ExternalBlob;
    withUploadProgress(onProgress: (percentage: number) => void): ExternalBlob;
}
export interface UserSettings {
    accentColor: string;
    darkMode: boolean;
}
export interface BrushPreset {
    tip: ExternalBlob;
    name: string;
    settings: string;
}
export interface backendInterface {
    deleteBrushPreset(userId: string, presetId: bigint): Promise<BrushPreset | null>;
    getAllBrushPresetIds(userId: string): Promise<Array<bigint>>;
    getBrushPreset(userId: string, presetId: bigint): Promise<BrushPreset | null>;
    getUserSettings(userId: string): Promise<UserSettings>;
    setUserSettings(userId: string, settings: UserSettings): Promise<void>;
    storeBrushPreset(userId: string, presetId: bigint, name: string, settings: string, tip: ExternalBlob): Promise<void>;
}
