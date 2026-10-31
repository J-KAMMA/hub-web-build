import type { D1Database } from "@cloudflare/workers-types";

import type { Profile } from "@/lib/domain";
import { getHubD1 } from "@/lib/server/hub-d1";
import { AUTHOR_HANDLE, decodeWorkCursor } from "@/lib/server/profile-works";
import { getD1VideoChannel } from "@/lib/server/video-channel";

const HEADERS = { "cache-control": "no-store" };

/** Shared GET body for the Web and desktop channel routes; only the viewer lookup differs. */
export async function videoChannelResponse(
  request: Request,
  handle: string,
  resolveViewer: (request: Request, database: D1Database) => Promise<Pick<Profile, "id"> | null>,
): Promise<Response> {
  if (!AUTHOR_HANDLE.test(handle)) return Response.json({ error: "invalid_handle" }, { status: 400, headers: HEADERS });
  const raw = new URL(request.url).searchParams.get("cursor");
  const cursor = raw === null ? null : decodeWorkCursor(raw);
  if (raw !== null && !cursor) return Response.json({ error: "invalid_cursor" }, { status: 400, headers: HEADERS });
  try {
    const database = getHubD1();
    const viewer = await resolveViewer(request, database).catch(() => null);
    const channel = await getD1VideoChannel(database, handle, viewer?.id || null, cursor);
    if (!channel) return Response.json({ error: "not_found" }, { status: 404, headers: HEADERS });
    return Response.json(channel, { headers: HEADERS });
  } catch {
    return Response.json({ error: "unavailable" }, { status: 503, headers: HEADERS });
  }
}
