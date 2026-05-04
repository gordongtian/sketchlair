import {
  createActor,
  type backendInterface,
  type CreateActorOptions,
  ExternalBlob,
} from "./backend";
import { StorageClient } from "./utils/StorageClient";
import { HttpAgent, type Identity } from "@icp-sdk/core/agent";

const DEFAULT_STORAGE_GATEWAY_URL = "https://blob.caffeine.ai";
const DEFAULT_BUCKET_NAME = "default-bucket";
const DEFAULT_PROJECT_ID = "0000000-0000-0000-0000-00000000000";

interface JsonConfig {
  backend_host: string;
  backend_canister_id: string;
  payments_canister_id: string;
  project_id: string;
  ii_derivation_origin: string;
}

interface Config {
  backend_host?: string;
  backend_canister_id: string;
  payments_canister_id: string;
  storage_gateway_url: string;
  bucket_name: string;
  project_id: string;
  ii_derivation_origin?: string;
}

let configCache: Config | null = null;

export function clearConfigCache(): void {
  configCache = null;
}

export async function loadConfig(): Promise<Config> {
  if (configCache) {
    return configCache;
  }
  const backendCanisterId = process.env.CANISTER_ID_BACKEND;
  const envBaseUrl = process.env.BASE_URL || "/";
  const baseUrl = envBaseUrl.endsWith("/") ? envBaseUrl : `${envBaseUrl}/`;
  try {
    const response = await fetch(`${baseUrl}env.json`);
    const config = (await response.json()) as JsonConfig;
    if (!backendCanisterId && config.backend_canister_id === "undefined") {
      console.error("CANISTER_ID_BACKEND is not set");
      throw new Error("CANISTER_ID_BACKEND is not set");
    }

    // Resolve payments canister ID from multiple sources in priority order:
    //   1. env.json (runtime-fetched) — skip if empty, "undefined", "null", or shell placeholder
    //   2. process.env.PAYMENTS_CANISTER_ID — Caffeine platform env var (most likely name)
    //   3. process.env.CANISTER_ID_PAYMENTS — alternative Vite build-time injection
    //   4. import.meta.env.PAYMENTS_CANISTER_ID — Vite env var (PAYMENTS_CANISTER_ID)
    //   5. import.meta.env.CANISTER_ID_PAYMENTS — Vite env var alternative
    // The env.json placeholder ships as "" (empty) — never trust the literal strings
    // "undefined", "null", or "$…" (un-expanded shell variable) from any source.
    function resolveCanisterId(value: string | undefined): string | null {
      if (!value || value === "undefined" || value === "null") return null;
      // Reject un-expanded shell variable placeholders like "$CANISTER_ID_PAYMENTS"
      if (value.startsWith("$")) return null;
      return value;
    }
    const resolvedPaymentsCanisterId =
      resolveCanisterId(config.payments_canister_id) ??
      resolveCanisterId(process.env.PAYMENTS_CANISTER_ID) ??
      resolveCanisterId(process.env.CANISTER_ID_PAYMENTS) ??
      resolveCanisterId(
        (import.meta.env as Record<string, string>).PAYMENTS_CANISTER_ID,
      ) ??
      resolveCanisterId(
        (import.meta.env as Record<string, string>).CANISTER_ID_PAYMENTS,
      ) ??
      "";
    if (!resolvedPaymentsCanisterId) {
      console.warn(
        "[Config] payments_canister_id is not set — payments features will be unavailable. " +
          "Deploy the payments canister and ensure CANISTER_ID_PAYMENTS is set in env.json or build environment.",
      );
    }

    const fullConfig = {
      backend_host:
        config.backend_host === "undefined" ? undefined : config.backend_host,
      backend_canister_id: (config.backend_canister_id === "undefined"
        ? backendCanisterId
        : config.backend_canister_id) as string,
      payments_canister_id: resolvedPaymentsCanisterId,
      storage_gateway_url: process.env.STORAGE_GATEWAY_URL ?? "nogateway",
      bucket_name: DEFAULT_BUCKET_NAME,
      project_id:
        config.project_id !== "undefined"
          ? config.project_id
          : DEFAULT_PROJECT_ID,
      ii_derivation_origin:
        config.ii_derivation_origin === "undefined"
          ? undefined
          : config.ii_derivation_origin,
    };
    configCache = fullConfig;
    return fullConfig;
  } catch {
    if (!backendCanisterId) {
      console.error("CANISTER_ID_BACKEND is not set");
      throw new Error("CANISTER_ID_BACKEND is not set");
    }
    const fallbackConfig = {
      backend_host: undefined,
      backend_canister_id: backendCanisterId,
      payments_canister_id: process.env.CANISTER_ID_PAYMENTS ?? "",
      storage_gateway_url: DEFAULT_STORAGE_GATEWAY_URL,
      bucket_name: DEFAULT_BUCKET_NAME,
      project_id: DEFAULT_PROJECT_ID,
      ii_derivation_origin: undefined,
    };
    return fallbackConfig;
  }
}

function extractAgentErrorMessage(error: string): string {
  const errorString = String(error);
  const match = errorString.match(/with message:\s*'([^']+)'/s);
  return match ? match[1] : errorString;
}

function processError(e: unknown): never {
  if (e && typeof e === "object" && "message" in e) {
    throw new Error(extractAgentErrorMessage(`${e.message}`));
  }
  throw e;
}

async function maybeLoadMockBackend(): Promise<backendInterface | null> {
  if (import.meta.env.VITE_USE_MOCK !== "true") {
    return null;
  }

  try {
    // If VITE_USE_MOCK is enabled, try to load a mock backend module *if it exists*.
    // We use import.meta.glob so builds don't fail when the mock file is absent.
    const mockModules = import.meta.glob("./mocks/backend.{ts,tsx,js,jsx}");

    const path = Object.keys(mockModules)[0];
    if (!path) return null;

    const mod = (await mockModules[path]()) as {
      mockBackend?: backendInterface;
    };

    return mod.mockBackend ?? null;
  } catch {
    return null;
  }
}

export async function createActorWithConfig(
  options?: CreateActorOptions & { identity?: Identity },
): Promise<backendInterface> {
  // Attempt to load mock backend if enabled
  const mock = await maybeLoadMockBackend();
  if (mock) {
    return mock;
  }

  const config = await loadConfig();
  const resolvedOptions = options ?? {};
  const agent = new HttpAgent({
    identity: resolvedOptions.identity,
    host: config.backend_host,
  });
  if (config.backend_host?.includes("localhost")) {
    await agent.fetchRootKey().catch((err) => {
      console.warn(
        "Unable to fetch root key. Check to ensure that your local replica is running",
      );
      console.error(err);
    });
  }
  // Pass ONLY the agent — do NOT spread resolvedOptions (which may contain agentOptions)
  // because passing both `agent` and `agentOptions` to createActor simultaneously
  // triggers "Detected both agent and agentOptions" and the identity in agentOptions
  // is silently dropped. The identity is already baked into the HttpAgent above.
  const actorOptions = {
    agent,
    processError,
  };



  const storageClient = new StorageClient(
    config.bucket_name,
    config.storage_gateway_url,
    config.backend_canister_id,
    config.project_id,
    agent,
  );

  const MOTOKO_DEDUPLICATION_SENTINEL = "!caf!";

  const uploadFile = async (file: ExternalBlob): Promise<Uint8Array> => {
    const { hash } = await storageClient.putFile(
      await file.getBytes(),
      file.onProgress,
    );
    return new TextEncoder().encode(MOTOKO_DEDUPLICATION_SENTINEL + hash);
  };

  const downloadFile = async (bytes: Uint8Array): Promise<ExternalBlob> => {
    const hashWithPrefix = new TextDecoder().decode(new Uint8Array(bytes));
    const hash = hashWithPrefix.substring(MOTOKO_DEDUPLICATION_SENTINEL.length);
    const url = await storageClient.getDirectURL(hash);
    return ExternalBlob.fromURL(url);
  };

  return createActor(
    config.backend_canister_id,
    uploadFile,
    downloadFile,
    actorOptions,
  );
}
