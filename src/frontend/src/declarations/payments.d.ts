import type { Principal } from "@icp-sdk/core/principal";
export interface Some<T> {
    __kind__: "Some";
    value: T;
}
export interface None {
    __kind__: "None";
}
export type Option<T> = Some<T> | None;
export interface TransformArgs {
    context: Uint8Array;
    response: HttpRequestResult;
}
export interface HttpRequestResult {
    status: bigint;
    body: Uint8Array;
    headers: Array<HttpHeader>;
}
export interface HttpResponse {
    body: Uint8Array;
    headers: Array<[string, string]>;
    upgrade?: boolean;
    status_code: number;
}
export interface HttpRequest {
    url: string;
    method: string;
    body: Uint8Array;
    headers: Array<[string, string]>;
}
export interface HttpHeader {
    value: string;
    name: string;
}
export enum UserRole {
    admin = "admin",
    user = "user",
    guest = "guest"
}
export interface paymentsInterface {
    addPaymentsAdmin(principal: string): Promise<boolean>;
    assignCallerUserRole(user: Principal, role: UserRole): Promise<void>;
    /**
     * / Create a Stripe Checkout session.
     * / - When isSubscription = true: recurring monthly subscription at global price.
     * / - When isSubscription = false: one-time purchase for the given packId.
     * / Returns #ok with the Stripe-hosted URL, or #err with a reason.
     */
    createCheckoutSession(packId: string, successUrl: string, cancelUrl: string, isSubscription: boolean): Promise<{
        __kind__: "ok";
        ok: string;
    } | {
        __kind__: "err";
        err: string;
    }>;
    getCallerUserRole(): Promise<UserRole>;
    getCanisterHealth(): Promise<{
        hasBackendCanisterId: boolean;
        hasWebhookSecret: boolean;
        deployTimestamp: bigint;
        isConfigured: boolean;
        hasStripeSecretKey: boolean;
        missingConfig: Array<string>;
        initWindowOpen: boolean;
    }>;
    getPackPrices(): Promise<Array<[string, bigint]>>;
    getStripeKeyAudit(): Promise<{
        webhookSecret?: {
            setter: string;
            timestamp: bigint;
        };
        secretKey?: {
            setter: string;
            timestamp: bigint;
        };
    }>;
    getSubscriptionPrice(): Promise<bigint>;
    http_request(request: HttpRequest): Promise<HttpResponse>;
    /**
     * / Update handler for POST /stripe/webhook.
     * / Verifies Stripe HMAC-SHA256 signature on ALL events before processing.
     * / Handles: checkout.session.completed, customer.subscription.created/updated/deleted,
     * / invoice.payment_succeeded.
     */
    http_request_update(request: HttpRequest): Promise<HttpResponse>;
    initFromEnv(backendId: string): Promise<{
        __kind__: "ok";
        ok: null;
    } | {
        __kind__: "err";
        err: string;
    }>;
    isCallerAdmin(): Promise<boolean>;
    listPaymentsAdmins(): Promise<Array<string>>;
    removePaymentsAdmin(principal: string): Promise<boolean>;
    setBackendCanisterId(canisterId: string): Promise<boolean>;
    /**
     * / Set the price (in USD cents) for a purchasable pack. Admin only.
     */
    setPackPrice(packId: string, priceUsdCents: bigint): Promise<{
        __kind__: "ok";
        ok: null;
    } | {
        __kind__: "err";
        err: string;
    }>;
    setStripeSecretKey(key: string): Promise<boolean>;
    setStripeWebhookSecret(secret: string): Promise<boolean>;
    setSubscriptionPrice(priceUsdCents: bigint): Promise<{
        __kind__: "ok";
        ok: null;
    } | {
        __kind__: "err";
        err: string;
    }>;
    transformStripeResponse(args: TransformArgs): Promise<HttpRequestResult>;
}
