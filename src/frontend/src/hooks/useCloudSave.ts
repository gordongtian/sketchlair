import type { Identity } from "@icp-sdk/core/agent";
import { HttpAgent } from "@icp-sdk/core/agent";
import { useCallback, useRef } from "react";
import { toast } from "sonner";
import { loadConfig } from "../config";
import { createActorWithConfig } from "../config";
import { StorageClient } from "../utils/StorageClient";

export interface CloudSaveHandlers {
  cloudSave: (getBlob: () => Promise<Blob>) => Promise<void>;
  cloudLoad: () => Promise<File | null>;
  getCanvasHash: () => Promise<string | null>;
}

export function useCloudSave(
  identity: Identity | undefined,
): CloudSaveHandlers {
  const storageClientRef = useRef<StorageClient | null>(null);

  const getStorageClient =
    useCallback(async (): Promise<StorageClient | null> => {
      if (!identity) return null;
      if (storageClientRef.current) return storageClientRef.current;
      const config = await loadConfig();
      const agent = new HttpAgent({
        identity,
        host: config.backend_host,
      });
      if (config.backend_host?.includes("localhost")) {
        await agent.fetchRootKey().catch(console.error);
      }
      const client = new StorageClient(
        config.bucket_name,
        config.storage_gateway_url,
        config.backend_canister_id,
        config.project_id,
        agent,
      );
      storageClientRef.current = client;
      return client;
    }, [identity]);

  // Reset client when identity changes
  const prevIdentityRef = useRef(identity);
  if (prevIdentityRef.current !== identity) {
    prevIdentityRef.current = identity;
    storageClientRef.current = null;
  }

  const cloudSave = useCallback(
    async (getBlob: () => Promise<Blob>) => {
      if (!identity) {
        toast.error(
          "Log in to save to cloud — click the login button in Settings",
        );
        return;
      }
      const toastId = toast.loading("Saving to cloud…");
      try {
        const blob = await getBlob();
        const bytes = new Uint8Array(await blob.arrayBuffer());

        const storageClient = await getStorageClient();
        if (!storageClient) throw new Error("Storage client unavailable");

        const { hash } = await storageClient.putFile(bytes);

        const actor = await createActorWithConfig({ identity });
        await actor.saveCanvasHash(hash);

        toast.success("Saved to cloud", { id: toastId });
      } catch (e) {
        console.error("Cloud save failed", e);
        toast.error("Cloud save failed", { id: toastId });
      }
    },
    [identity, getStorageClient],
  );

  const getCanvasHash = useCallback(async (): Promise<string | null> => {
    if (!identity) return null;
    try {
      const actor = await createActorWithConfig({ identity });
      return await actor.getCanvasHash();
    } catch {
      return null;
    }
  }, [identity]);

  const cloudLoad = useCallback(async (): Promise<File | null> => {
    if (!identity) return null;
    const toastId = toast.loading("Loading from cloud…");
    try {
      const hash = await getCanvasHash();
      if (!hash) {
        toast.error("No saved canvas found", { id: toastId });
        return null;
      }

      const storageClient = await getStorageClient();
      if (!storageClient) throw new Error("Storage client unavailable");

      const url = await storageClient.getDirectURL(hash);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const arrayBuffer = await response.arrayBuffer();
      const file = new File([arrayBuffer], "cloud-save.sktch", {
        type: "application/octet-stream",
      });
      toast.dismiss(toastId);
      return file;
    } catch (e) {
      console.error("Cloud load failed", e);
      toast.error("Cloud load failed", { id: toastId });
      return null;
    }
  }, [identity, getStorageClient, getCanvasHash]);

  return { cloudSave, cloudLoad, getCanvasHash };
}
