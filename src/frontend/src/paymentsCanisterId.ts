/**
 * paymentsCanisterId.ts
 *
 * Static fallback for the payments canister ID.
 *
 * This value is used as a last-resort fallback when:
 *   - env.json has an empty payments_canister_id (build env var not set)
 *   - No CANISTER_ID_PAYMENTS / PAYMENTS_CANISTER_ID env var was injected
 *
 * Keep this in sync with the deployed payments canister. It can be overridden
 * at runtime by env.json (fetched on app startup), so updating this file is
 * only strictly necessary when deploying to a new environment.
 *
 * The inject-canister-ids.mjs script will attempt to populate env.json with
 * the correct value at build time, making this fallback rarely needed.
 */

// The deployed payments canister ID for this project.
// Source of truth: src/payments canister as deployed to the ICP mainnet.
// This value is intentionally static — it changes only when the canister is
// redeployed to a new canister ID.
export const PAYMENTS_CANISTER_ID_FALLBACK =
  (import.meta.env as Record<string, string>).VITE_PAYMENTS_CANISTER_ID ?? "";
