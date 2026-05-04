import type { Principal } from "@icp-sdk/core/principal";
export interface Some<T> {
    __kind__: "Some";
    value: T;
}
export interface None {
    __kind__: "None";
}
export type Option<T> = Some<T> | None;
export interface UserPreferences {
    brushes: Array<BrushPreset>;
    hotkeys: HotkeyAssignments;
    lastModified: bigint;
    settings: AppSettings;
    schemaVersion: bigint;
}
export interface PublicImageSet {
    id: string;
    name: string;
    imageCount: bigint;
    isFree: boolean;
    previewThumbnail: string;
    isDefault: boolean;
}
export interface ImageReference {
    id: string;
    height: bigint;
    assetUrl: string;
    width: bigint;
}
export interface HotkeyAssignments {
    assignments: string;
    modifiedAt: bigint;
}
export type CanvasSave = string;
export interface AppSettings {
    uiScale: number;
    theme: string;
    canvasBackground: string;
    modifiedAt: bigint;
    otherSettings: string;
}
export type SettingsSave = string;
export interface BrushPreset {
    id: string;
    modifiedAt: bigint;
    name: string;
    createdAt: bigint;
    settings: string;
    isDefault: boolean;
}
export interface CatalogItem {
    id: string;
    contentType: ContentType;
    name: string;
    imageCount: bigint;
    description: string;
    isFree: boolean;
    previewThumbnail: string;
    isSubscriberContent: boolean;
    priceUsdCents?: bigint;
}
export interface SubscriptionStatus {
    active: boolean;
    expiryDateMs?: bigint;
}
export interface UserProfile {
    name: string;
}
export interface ImageSet {
    id: string;
    contentType: ContentType;
    name: string;
    tags: Array<string>;
    imageCount: bigint;
    description: string;
    isFree: boolean;
    previewThumbnail: string;
    isDefault: boolean;
    isSubscriberContent: boolean;
    priceUsdCents?: bigint;
    priceICP?: string;
    images: Array<ImageReference>;
}
export enum ContentType {
    learningmodule = "learningmodule",
    referencepack = "referencepack"
}
export enum UserRole {
    admin = "admin",
    user = "user",
    guest = "guest"
}
export interface backendInterface {
    /**
     * / Adds a new admin. Only an existing admin may call this.
     * / Returns false if the caller is not an admin.
     */
    addAdmin(newAdmin: Principal): Promise<boolean>;
    /**
     * / Admin only — add an image reference to a set.
     * / Returns false if caller is not admin or setId doesn't exist.
     */
    addImageToSet(setId: string, image: ImageReference): Promise<boolean>;
    assignCallerUserRole(user: Principal, role: UserRole): Promise<void>;
    /**
     * / Returns true if the username is not yet taken — free query call.
     */
    checkUsernameAvailable(username: string): Promise<boolean>;
    /**
     * / Admin only — create a new image set.
     * / Returns the new set's ID on success, null if caller is not admin or
     * / name is invalid (must be 3–50 characters).
     * / If isFree is true, priceICP is ignored and stored as null.
     * / If isDefault is true, all other sets are unset as default.
     */
    createImageSet(name: string, isFree: boolean, isDefault: boolean, priceICP: string | null): Promise<string | null>;
    deleteBrush(id: string): Promise<void>;
    /**
     * / Admin only — delete an entire image set.
     * / Cannot delete default sets (isDefault == true).
     * / Returns false if caller is not admin, setId doesn't exist, or set is a default.
     */
    deleteImageSet(setId: string): Promise<boolean>;
    /**
     * / Admin only — remove an animation from the mascot registry.
     * / If the deleted animation was the default idle, clears defaultIdleAnimationName.
     * / Returns true on success, false if caller is not admin or name not found.
     */
    deleteMascotAnimation(name: string): Promise<boolean>;
    /**
     * / Admin only — remove an expression from the mascot registry.
     * / If the deleted expression was the default, clears defaultExpressionName.
     * / Returns true on success, false if caller is not admin or name not found.
     */
    deleteMascotExpression(name: string): Promise<boolean>;
    /**
     * / Admin only — get all image sets including paid ones, for admin management UI.
     * / Returns an empty array if caller is not admin.
     * / Uses an update call (not query) so it can run ensureStarterSetsCleared()
     * / to strip any legacy dummy placeholder images on first access after a deploy.
     */
    getAllImageSetsAdmin(): Promise<Array<ImageSet>>;
    /**
     * / Public query — returns ALL image sets as catalog entries (no images array).
     * / Used by the marketplace to build the full grid so users can see and purchase
     * / packs they do not yet own. Diff against getAvailableImageSets() for owned state.
     */
    getAllPublicImageSets(): Promise<Array<PublicImageSet>>;
    /**
     * / Public query — returns all free sets plus sets the caller has purchased entitlements for.
     * / Also includes subscriber-tagged sets if the caller has an active subscription.
     */
    getAvailableImageSets(): Promise<Array<ImageSet>>;
    getBrushPresets(): Promise<string | null>;
    getCallerUserProfile(): Promise<UserProfile | null>;
    getCallerUserRole(): Promise<UserRole>;
    getCanvasHash(): Promise<CanvasSave | null>;
    getFullCatalog(): Promise<{
        packs: Array<CatalogItem>;
        modules: Array<CatalogItem>;
    }>;
    /**
     * / Public query — returns the in-app guide script, or null if not yet set.
     * / Equivalent to getModuleScript("guide").
     */
    getGuideScript(): Promise<string | null>;
    /**
     * / Public query — returns all mascot registry data: expressions, animations, and defaults.
     * / Returns empty arrays and null defaults if nothing has been uploaded yet.
     */
    getMascotAssets(): Promise<{
        defaultIdleAnimationName?: string;
        animations: Array<[string, string]>;
        expressions: Array<[string, string]>;
        defaultExpressionName?: string;
    }>;
    /**
     * / Public query — returns the script text for a module, or null if not stored.
     */
    getModuleScript(moduleId: string): Promise<string | null>;
    /**
     * / Returns the username for the caller's principal, or null if none registered.
     */
    getMyUsername(): Promise<string | null>;
    getPreferences(): Promise<UserPreferences | null>;
    getSchemaVersion(): Promise<bigint>;
    /**
     * / Adds a new admin. Only an existing admin may call this.
     * / Returns false if the caller is not an admin.
     */
    getSubscriptionStatus(): Promise<SubscriptionStatus>;
    /**
     * / Returns the set IDs the caller has been explicitly granted.
     */
    getUserEntitlements(): Promise<Array<string>>;
    /**
     * / Returns all default image sets plus any sets the caller has been granted.
     */
    getUserImageSets(): Promise<Array<ImageSet>>;
    getUserProfile(user: Principal): Promise<UserProfile | null>;
    getUserSettings(): Promise<SettingsSave | null>;
    /**
     * / Returns the username for any given principal — for display purposes.
     */
    getUsernameForPrincipal(p: Principal): Promise<string | null>;
    /**
     * / Admin: grant a set to a principal. Returns false if the set does not exist.
     */
    grantEntitlement(principal: Principal, setId: string): Promise<boolean>;
    /**
     * / Called by the payments canister to grant a pack entitlement to a user.
     * / Only the stored payments canister principal is allowed to call this.
     * / Idempotent — adding an entitlement the user already has is a no-op.
     * / Returns false if the caller is not the trusted payments canister,
     * / if no payments canister principal has been configured, or if the
     * / pack does not exist in the image set registry.
     */
    grantPackEntitlement(userPrincipal: Principal, packId: string): Promise<boolean>;
    grantSubscription(userPrincipal: Principal, stripeSubId: string, expiryDateMs: bigint): Promise<boolean>;
    /**
     * / Returns true if the given principal is in the admin set.
     * / Safe as a query because isAdminPrincipal() never mutates state.
     */
    isAdmin(p: Principal): Promise<boolean>;
    isCallerAdmin(): Promise<boolean>;
    isEntitledTo(userPrincipal: Principal, packId: string): Promise<boolean>;
    /**
     * / Registers a username for the caller's principal.
     * / Returns true on success, false if the caller already has a username
     * / or if the username is already taken (race condition guard).
     */
    registerUsername(username: string): Promise<boolean>;
    /**
     * / Removes an admin. Only an existing admin may call this.
     * / Returns false if the caller is not an admin or if the caller tries
     * / to remove themselves.
     */
    removeAdmin(target: Principal): Promise<boolean>;
    /**
     * / Admin only — remove an image reference from a set.
     * / Returns false if caller is not admin, setId doesn't exist, or imageId not found.
     */
    removeImageFromSet(setId: string, imageId: string): Promise<boolean>;
    /**
     * / Admin only — rename an image set.
     * / newName must not be empty. Returns false if caller is not admin,
     * / setId doesn't exist, or newName is empty.
     */
    renameSet(setId: string, newName: string): Promise<boolean>;
    /**
     * / Admin: revoke a set from a principal. Returns false if the set does not exist.
     */
    revokeEntitlement(principal: Principal, setId: string): Promise<boolean>;
    revokeSubscription(userPrincipal: Principal): Promise<boolean>;
    saveBrush(brush: BrushPreset): Promise<void>;
    saveBrushPresets(data: string): Promise<void>;
    saveCallerUserProfile(profile: UserProfile): Promise<void>;
    saveCanvasHash(canvasHash: CanvasSave): Promise<void>;
    /**
     * / Admin only — save or overwrite the in-app guide dialogue script.
     * / Equivalent to saveModuleScript("guide", scriptText).
     * / Returns true on success, false if caller is not admin.
     */
    saveGuideScript(scriptText: string): Promise<boolean>;
    /**
     * / Admin only — save or overwrite the dialogue script for a module.
     * / Module IDs are simple strings like "figure-drawing" or "still-life".
     * / Use moduleId = "guide" to set the in-app guide script.
     * / Returns true on success, false if caller is not admin.
     */
    saveModuleScript(moduleId: string, scriptText: string): Promise<boolean>;
    savePreferences(prefs: UserPreferences): Promise<void>;
    saveUserSettings(settings: SettingsSave): Promise<void>;
    setContentType(setId: string, contentType: ContentType): Promise<boolean>;
    /**
     * / Admin only — set the default expression name.
     * / Returns false if no expression with that name exists or caller is not admin.
     */
    setDefaultExpression(name: string): Promise<boolean>;
    /**
     * / Admin only — set the default idle animation name.
     * / Returns false if no animation with that name exists or caller is not admin.
     */
    setDefaultIdleAnimation(name: string): Promise<boolean>;
    setDescription(setId: string, description: string): Promise<boolean>;
    /**
     * / Admin only — mark a set as the sole default set.
     * / Unsets isDefault on all other sets. Returns false if caller is not admin
     * / or the setId does not exist.
     */
    setImageSetDefault(setId: string): Promise<boolean>;
    /**
     * / Admin only — set or clear the price of a set.
     * / Pass null to clear the price (make free). Returns false if caller is not admin
     * / or the setId does not exist.
     */
    setImageSetPrice(setId: string, priceICP: string | null): Promise<boolean>;
    /**
     * / Admin only — store the trusted payments canister principal.
     * / grantPackEntitlement will only accept calls from this principal.
     * / Returns false if the caller is not an admin.
     */
    setPaymentsCanisterPrincipal(p: Principal): Promise<boolean>;
    setPriceUsdCents(setId: string, priceUsdCents: bigint | null): Promise<boolean>;
    setSubscriberContent(setId: string, isSubscriberContent: boolean): Promise<boolean>;
    /**
     * / Admin only — update the tags for an image set.
     * / All tags are normalized to lowercase before storing.
     * / Returns false if caller is not admin or setId doesn't exist.
     */
    updateSetTags(setId: string, tags: Array<string>): Promise<boolean>;
    updateSubscriptionExpiry(userPrincipal: Principal, newExpiryMs: bigint): Promise<boolean>;
    /**
     * / Admin only — add or replace an animation (Lottie JSON) in the mascot registry.
     * / If an animation with the same name already exists, its blobUrl is replaced.
     * / Returns true on success, false if caller is not admin.
     */
    uploadMascotAnimation(name: string, blobUrl: string): Promise<boolean>;
    /**
     * / Admin only — add or replace an expression (PNG) in the mascot registry.
     * / If an expression with the same name already exists, its blobUrl is replaced.
     * / Returns true on success, false if caller is not admin.
     */
    uploadMascotExpression(name: string, blobUrl: string): Promise<boolean>;
}
