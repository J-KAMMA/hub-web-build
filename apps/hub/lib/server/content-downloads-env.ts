import type { D1Database } from "@cloudflare/workers-types";
import { getCloudflareContext } from "@opennextjs/cloudflare";

import { musicTrackReader, type ContentDownloadDeps } from "@/lib/server/content-downloads";
import { createHubVideoGateCheck } from "@/lib/server/hub-videos-env";

/**
 * Production wiring for content downloads (content-downloads.ts keeps no `@/` imports).
 * Music is read through the `MUSIC_SERVICE` binding, or `HUB_MUSIC_ORIGIN` when set.
 * A missing key or transport closes that kind of download.
 */
type Env = Record<string, unknown>;

function readString(env: Env | undefined, name: string): string | null {
  const fromEnv = env ? Reflect.get(env, name) : undefined;
  const value = typeof fromEnv === "string" ? fromEnv : process.env[name];
  return typeof value === "string" && value.trim() && !value.trim().startsWith("replace-with") ? value.trim() : null;
}

export function contentDownloadDepsFromEnv(env?: Env): ContentDownloadDeps {
  let bindings: Env | undefined = env;
  if (!bindings) {
    try {
      bindings = getCloudflareContext().env as unknown as Env;
    } catch {
      bindings = undefined;
    }
  }
  const binding = bindings ? Reflect.get(bindings, "MUSIC_SERVICE") : undefined;
  const origin = readString(bindings, "HUB_MUSIC_ORIGIN");
  let send: ((path: string) => Promise<Response>) | null = null;
  if (binding && typeof (binding as { fetch?: unknown }).fetch === "function") {
    const fetcher = binding as { fetch(request: Request): Promise<Response> };
    send = (path) => fetcher.fetch(new Request(new URL(path, "https://music.internal")));
  } else if (origin && /^https?:\/\/[^/]+$/i.test(origin.replace(/\/$/, ""))) {
    const base = origin.replace(/\/$/, "");
    send = (path) => fetch(`${base}${path}`, { redirect: "manual" });
  }
  const checkGate = createHubVideoGateCheck();
  return {
    videoTicketKey: readString(bindings, "HUB_VIDEO_TICKET_PRIVATE_KEY_PKCS8"),
    musicTicketKey: readString(bindings, "HUB_MUSIC_TICKET_PRIVATE_KEY_PKCS8"),
    checkVideoGate: (database: D1Database, input) => checkGate(database, input),
    readMusicTrack: musicTrackReader(send),
  };
}
