import type { D1Database } from "@cloudflare/workers-types";
import { getCloudflareContext } from "@opennextjs/cloudflare";

import {
  checkGateForViewer,
  createGateVerificationDeps,
  type GateVerificationDeps,
} from "@/lib/server/access-gate-verification";
import { loadGatesForTargets, toGateToVerify } from "@/lib/server/gated-content";
import { getHubStorageAccountClient } from "@/lib/server/hub-storage-account-client";
import type { HubVideoDeps, HubVideoGateOutcome, VideoWorkerSend } from "@/lib/server/hub-videos";

/**
 * Production wiring for Hub self-made videos (hub-videos.ts keeps no `@/` imports so the Video
 * Worker's tests can run it against the real Worker).
 *
 * The Video Worker is reached through the `HUB_VIDEO_WORKER` service binding when present,
 * otherwise `HUB_VIDEO_ORIGIN` (an http(s) origin that serves `/video/api/v1/*`). Neither
 * configured means no transport and every publish, unpublish and status read closes. The signing
 * key is the Hub secret `HUB_VIDEO_TICKET_PRIVATE_KEY_PKCS8`, separate from the file-ticket key.
 */

type Env = Record<string, unknown>;

function readString(env: Env | undefined, name: string): string | null {
  const fromEnv = env ? Reflect.get(env, name) : undefined;
  const value = typeof fromEnv === "string" ? fromEnv : process.env[name];
  return typeof value === "string" && value.trim() && !value.trim().startsWith("replace-with") ? value.trim() : null;
}

/** Hub's own server-side token-gate check for a viewer; client-supplied proofs never count. */
export function createHubVideoGateCheck(gateDeps?: (database: D1Database) => GateVerificationDeps): HubVideoDeps["checkGate"] {
  return async (database, { videoId, viewerProfileId }): Promise<HubVideoGateOutcome> => {
    const gate = (await loadGatesForTargets(database, "video", [videoId])).get(videoId);
    if (!gate) return "no_gate";
    if (viewerProfileId === gate.ownerProfileId) return "granted";
    const outcome = await checkGateForViewer(
      toGateToVerify(gate),
      viewerProfileId,
      gateDeps?.(database) ?? createGateVerificationDeps(database),
    );
    if (outcome.result === "granted") return "granted";
    return outcome.result === "unavailable" ? "unavailable" : "locked";
  };
}

export function hubVideoDepsFromEnv(env?: Env): HubVideoDeps {
  let bindings: Env | undefined = env;
  if (!bindings) {
    try {
      bindings = getCloudflareContext().env as unknown as Env;
    } catch {
      bindings = undefined;
    }
  }
  const binding = bindings ? Reflect.get(bindings, "HUB_VIDEO_WORKER") : undefined;
  const origin = readString(bindings, "HUB_VIDEO_ORIGIN");
  let send: VideoWorkerSend | null = null;
  if (binding && typeof (binding as { fetch?: unknown }).fetch === "function") {
    const fetcher = binding as { fetch(request: Request): Promise<Response> };
    send = (path, init) => fetcher.fetch(new Request(new URL(path, "https://video.internal"), init));
  } else if (origin && /^https?:\/\/[^/]+$/i.test(origin.replace(/\/$/, ""))) {
    const base = origin.replace(/\/$/, "");
    send = (path, init) => fetch(`${base}${path}`, { ...init, redirect: "manual" });
  }
  const deps: HubVideoDeps = {
    privateKeyPkcs8: readString(bindings, "HUB_VIDEO_TICKET_PRIVATE_KEY_PKCS8"),
    send,
    account: getHubStorageAccountClient(),
    checkGate: createHubVideoGateCheck(),
    // Federated as ActivityPub Video / Delete (PLAN 4.3); the module decides what may leave Hub.
    onChange: async (database, videoId) => {
      const { federateHubVideo } = await import("@/lib/server/federation-outbound");
      const { setPublicVideoThumbnail } = await import("@/lib/server/hub-videos");
      await federateHubVideo(database, videoId, undefined, (assetId, enable) => setPublicVideoThumbnail(deps, assetId, enable));
    },
  };
  return deps;
}
