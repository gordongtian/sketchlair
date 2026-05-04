import { HttpAgent, type Identity } from "@icp-sdk/core/agent";
import { loadConfig } from "./config";
import { createActor, type paymentsInterface } from "./payments";

function extractAgentErrorMessage(error: string): string {
  const errorString = String(error);
  const match = errorString.match(/with message:\s*'([^']+)'/s);
  return match ? match[1] : errorString;
}

function processError(e: unknown): never {
  if (e && typeof e === "object" && "message" in e) {
    throw new Error(
      extractAgentErrorMessage(`${(e as { message: string }).message}`),
    );
  }
  throw e;
}

// No-op upload/download — payments canister has no blob storage
const noopUpload = async (_file: unknown): Promise<Uint8Array> =>
  new Uint8Array();
const noopDownload = async (_bytes: Uint8Array): Promise<unknown> => ({
  directURL: "",
  getBytes: async () => new Uint8Array(),
  getDirectURL: () => "",
  withUploadProgress: () => ({}),
});

export async function createPaymentsActor(
  identity?: Identity,
): Promise<paymentsInterface> {
  const config = await loadConfig();
  // Resolve payments canister ID — same multi-tier chain as config.ts.
  // loadConfig() already handles the resolution, but we re-check here as a
  // safety net in case env.json was fetched with stale data.
  function resolveId(value: string | undefined): string | null {
    if (!value || value === "undefined" || value === "null") return null;
    // Reject un-expanded shell variable placeholders like "$CANISTER_ID_PAYMENTS"
    if (value.startsWith("$")) return null;
    return value;
  }
  const paymentsCanisterId =
    resolveId(config.payments_canister_id) ??
    resolveId(process.env.PAYMENTS_CANISTER_ID) ??
    resolveId(process.env.CANISTER_ID_PAYMENTS) ??
    resolveId(
      (import.meta.env as Record<string, string>).PAYMENTS_CANISTER_ID,
    ) ??
    resolveId(
      (import.meta.env as Record<string, string>).CANISTER_ID_PAYMENTS,
    ) ??
    "";
  if (!paymentsCanisterId) {
    console.warn(
      "[PaymentsActor] payments_canister_id is not configured — payments features will be unavailable. " +
        "Deploy the payments canister and ensure CANISTER_ID_PAYMENTS is set in env.json or build environment.",
    );
    throw new Error("CANISTER_ID_PAYMENTS is not set");
  }

  const agent = new HttpAgent({
    identity,
    host: config.backend_host,
  });

  if (config.backend_host?.includes("localhost")) {
    await agent.fetchRootKey().catch((err) => {
      console.warn("[PaymentsActor] Unable to fetch root key:", err);
    });
  }

  // biome-ignore lint/suspicious/noExplicitAny: noopDownload returns a compatible shape at runtime
  return createActor(
    paymentsCanisterId,
    noopUpload as never,
    noopDownload as never,
    {
      agent,
      processError,
    },
  );
}
