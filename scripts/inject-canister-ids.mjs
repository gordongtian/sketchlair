#!/usr/bin/env node
/**
 * inject-canister-ids.mjs
 *
 * Enriches env.json with canister IDs that are not injected by the Caffeine
 * platform build system at build time.
 *
 * The Caffeine platform sets BACKEND_CANISTER_ID for the main backend canister,
 * but does NOT set a variable for the payments canister. This script tries several
 * env var names in priority order and writes the resolved value back to env.json
 * before it is copied to dist/.
 *
 * Priority order for payments_canister_id:
 *   1. PAYMENTS_CANISTER_ID  (most likely name on Caffeine platform)
 *   2. CANISTER_ID_PAYMENTS  (alternative convention)
 *   3. Existing value in env.json (if non-empty / non-placeholder)
 *   4. Leave unchanged (downstream code will warn and disable payments)
 */

import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envJsonPath = join(__dirname, "../src/frontend/env.json");

function resolveId(value) {
  if (!value || value === "undefined" || value === "null" || value === "") {
    return null;
  }
  // Reject un-expanded shell variable placeholders like "$CANISTER_ID_PAYMENTS"
  if (value.startsWith("$")) {
    return null;
  }
  return value;
}

let envJson;
try {
  envJson = JSON.parse(readFileSync(envJsonPath, "utf-8"));
} catch (err) {
  console.error(`[inject-canister-ids] Failed to read env.json: ${err.message}`);
  process.exit(1);
}

// --- Payments canister ID ---
const resolvedPaymentsId =
  resolveId(process.env.PAYMENTS_CANISTER_ID) ??
  resolveId(process.env.CANISTER_ID_PAYMENTS) ??
  resolveId(envJson.payments_canister_id);

if (resolvedPaymentsId) {
  if (resolvedPaymentsId !== envJson.payments_canister_id) {
    console.log(
      `[inject-canister-ids] payments_canister_id: "${envJson.payments_canister_id}" → "${resolvedPaymentsId}"`,
    );
  } else {
    console.log(
      `[inject-canister-ids] payments_canister_id already set: "${resolvedPaymentsId}"`,
    );
  }
  envJson.payments_canister_id = resolvedPaymentsId;
} else {
  console.warn(
    "[inject-canister-ids] WARNING: payments_canister_id could not be resolved. " +
      "Payments features will be unavailable. " +
      "Set PAYMENTS_CANISTER_ID or CANISTER_ID_PAYMENTS in the build environment.",
  );
}

// --- Backend canister ID (belt-and-suspenders) ---
const resolvedBackendId =
  resolveId(process.env.BACKEND_CANISTER_ID) ??
  resolveId(envJson.backend_canister_id);

if (resolvedBackendId && resolvedBackendId !== envJson.backend_canister_id) {
  console.log(
    `[inject-canister-ids] backend_canister_id: "${envJson.backend_canister_id}" → "${resolvedBackendId}"`,
  );
  envJson.backend_canister_id = resolvedBackendId;
}

writeFileSync(envJsonPath, JSON.stringify(envJson, null, 2) + "\n", "utf-8");
console.log("[inject-canister-ids] env.json written successfully.");
