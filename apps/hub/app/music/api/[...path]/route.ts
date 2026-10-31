import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { Fetcher } from "@cloudflare/workers-types";

/*
 * Relays /music/api/* to the music Worker.
 *
 * Music is a separate owner-service in apps/music, so the Hub does not hold
 * the catalogue. In production the zone routes hub.jkamma.com/music/api/* to
 * that Worker directly and this file never runs. Staging is on workers.dev,
 * which cannot route a path prefix to a second Worker, so the Hub relays over
 * a service binding instead — and the client keeps calling the one path it has
 * always called.
 *
 * In development the next.config rewrite wins: it is declared in beforeFiles,
 * which is matched ahead of the filesystem, so the local Worker on 127.0.0.1
 * still answers and this route stays out of the way.
 */

export const dynamic = "force-dynamic";

function musicService(): Fetcher | null {
  try {
    const binding = Reflect.get(getCloudflareContext().env, "MUSIC_SERVICE");
    return typeof binding === "object" && binding !== null
      && typeof Reflect.get(binding, "fetch") === "function"
      ? binding as Fetcher
      : null;
  } catch {
    /* No Worker context: a node runtime, where the rewrite handles this. */
    return null;
  }
}

async function relay(request: Request): Promise<Response> {
  const service = musicService();
  if (!service) {
    return Response.json(
      { error: "music_service_unavailable" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
  /*
   * The path is passed through unchanged. The music Worker matches on the full
   * /music/api/... pathname, not on a stripped suffix.
   */
  return service.fetch(request as unknown as Parameters<Fetcher["fetch"]>[0]) as unknown as Promise<Response>;
}

export const GET = relay;
export const POST = relay;
export const PUT = relay;
export const PATCH = relay;
export const DELETE = relay;
