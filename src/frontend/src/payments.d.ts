import type { Principal } from "@icp-sdk/core/principal";
export interface Some<T> {
    __kind__: "Some";
    value: T;
}
export interface None {
    __kind__: "None";
}
export type Option<T> = Some<T> | None;
export interface HttpRequest {
    url: string;
    method: string;
    body: Uint8Array;
    headers: Array<[string, string]>;
}
export interface HttpResponse {
    body: Uint8Array;
    headers: Array<[string, string]>;
    upgrade?: boolean;
    status_code: number;
}
export enum UserRole {
    admin = "admin",
    user = "user",
    guest = "guest"
}
export interface paymentsInterface {
    assignCallerUserRole(user: Principal, role: UserRole): Promise<void>;
    /**
     * / Create a Stripe Checkout session for a given pack.
     * / - Rejects anonymous callers.
     * / - Uses ICP HTTPS outcalls to POST to the Stripe API.
     * / - Stores the session → (principal, itemType, itemId) mapping.
     * / - Returns the Stripe-hosted Checkout URL on success.
     * / - successUrl and cancelUrl must be provided by the frontend (window.location.origin-based).
     */
    createCheckoutSession(packId: string, successUrl: string, cancelUrl: string): Promise<{
        __kind__: "ok";
        ok: string;
    } | {
        __kind__: "err";
        err: string;
    }>;
    getCallerUserRole(): Promise<UserRole>;
    /**
     * / Return all pack IDs and their current prices (USD cents). Public.
     */
    getPackPrices(): Promise<Array<[string, bigint]>>;
    /**
     * / Standard ICP HTTP query handler.
     * / For POST /stripe/webhook, upgrades to http_request_update.
     */
    http_request(request: HttpRequest): Promise<HttpResponse>;
    /**
     * / Update handler for POST /stripe/webhook.
     * / - Verifies HMAC-SHA256 Stripe signature.
     * / - Handles checkout.session.completed events.
     * / - Idempotency: skips already-processed sessions.
     * / - Calls imageSets canister to grant entitlement to buyer.
     * / - Returns HTTP 200 on success, 400/500 on failure.
     */
    http_request_update(request: HttpRequest): Promise<HttpResponse>;
    isCallerAdmin(): Promise<boolean>;
    /**
     * / Set the price (in USD cents) for a purchasable pack. Admin only.
     */
    setPackPrice(packId: string, priceUsdCents: bigint): Promise<boolean>;
    /**
     * / Store the Stripe secret key. Admin only. Write-only — never returned.
     */
    setStripeSecretKey(key: string): Promise<boolean>;
    /**
     * / Store the Stripe webhook signing secret. Admin only. Write-only — never returned.
     */
    setStripeWebhookSecret(secret: string): Promise<boolean>;
}
