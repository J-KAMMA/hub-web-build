import { NextResponse } from "next/server";

import { getHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import { requireHubViewerProfile } from "@/lib/server/desktop-hub-auth";
import { HubAuthenticationError } from "@/lib/server/hub-session";
import { listD1UserListFeed } from "@/lib/server/d1-user-list-feed";
import { readListPagination } from "@/lib/server/list-pagination";
import { decodeTimelineCursor, encodeTimelineCursor } from "@/lib/timeline-cursor";

type RouteContext = { params: Promise<{ listId: string }> };

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie, Authorization",
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const database = getHubD1();
    const viewer = await requireHubViewerProfile(request, database);
    const { listId } = await context.params;
    const url = new URL(request.url);
    const { limit } = readListPagination(url);
    const rawCursor = url.searchParams.get("cursor");
    const cursor = decodeTimelineCursor(rawCursor);
    if (rawCursor && !cursor) {
      return NextResponse.json({ error: "invalid_cursor" }, { status: 400 });
    }
    const items = await listD1UserListFeed(database, viewer.id, listId, limit, cursor);
    const last = items.at(-1);
    const lastKey = last
      ? `${last.kind === "social" ? "social" : "thread"}_${last.kind === "social" ? last.post.id : last.response.id}`
      : null;
    return NextResponse.json(
      {
        items,
        hasMore: items.length === limit,
        nextCursor: last && lastKey
          ? encodeTimelineCursor({ createdAt: last.createdAt, id: lastKey })
          : null,
      },
      { headers: PRIVATE_HEADERS },
    );
  } catch (error) {
    if (error instanceof HubAuthenticationError) {
      return NextResponse.json({ error: "authentication_required" }, { status: 401, headers: PRIVATE_HEADERS });
    }
    if (error instanceof HubD1UnavailableError) {
      return NextResponse.json({ error: "List feed is unavailable." }, { status: 503, headers: PRIVATE_HEADERS });
    }
    throw error;
  }
}
