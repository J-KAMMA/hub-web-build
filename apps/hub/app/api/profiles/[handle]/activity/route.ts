import { NextResponse } from "next/server";

import { getHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import { getOptionalHubSessionProfile } from "@/lib/server/hub-session";
import { listD1TimelinePosts } from "@/lib/server/d1-social-posts";
import { readListPagination } from "@/lib/server/list-pagination";
import { decodeTimelineCursor, encodeTimelineCursor } from "@/lib/timeline-cursor";

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie",
};

type RouteContext = {
  params: Promise<{ handle: string }>;
};

type ProfileRow = {
  id: string;
  handle: string;
  display_name: string;
};

function privateJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: PRIVATE_HEADERS });
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const { handle: rawHandle } = await context.params;
    const handle = rawHandle.trim();
    if (!handle || handle.length > 64) {
      return privateJson({ error: "invalid_handle" }, 400);
    }

    const url = new URL(request.url);
    const activity = url.searchParams.get("activity");
    if (activity !== "posts" && activity !== "replies") {
      return privateJson({ error: "activity must be posts or replies." }, 400);
    }
    const rawCursor = url.searchParams.get("cursor");
    const cursor = decodeTimelineCursor(rawCursor);
    if (rawCursor && !cursor) {
      return privateJson({ error: "invalid_cursor" }, 400);
    }
    const { limit } = readListPagination(url);
    const database = getHubD1();
    const viewer = await getOptionalHubSessionProfile(request, database);
    const viewerId = viewer?.id ?? "";
    const profile = await database.prepare(`SELECT p.id, p.handle, p.display_name
      FROM profiles p
      WHERE p.handle = ? COLLATE NOCASE
        AND NOT EXISTS (
          SELECT 1 FROM profile_moderation_status moderation
          WHERE moderation.profile_id = p.id AND moderation.status = 'suspended'
        )
        AND (
          ? = ''
          OR NOT EXISTS (
            SELECT 1 FROM thread_user_controls control
            WHERE control.blocked = 1
              AND (
                (control.owner_profile_id = ? AND control.target_profile_id = p.id)
                OR (control.owner_profile_id = p.id AND control.target_profile_id = ?)
              )
          )
        )
      LIMIT 1`)
      .bind(handle, viewerId, viewerId, viewerId)
      .first<ProfileRow>();
    if (!profile) return privateJson({ error: "profile_not_found" }, 404);

    const pageScan = {
      count: 0,
      lastCreatedAt: null as string | null,
      lastId: null as string | null,
    };
    const posts = await listD1TimelinePosts(
      database,
      viewer?.id ?? null,
      profile.id,
      limit,
      0,
      undefined,
      cursor,
      "latest",
      pageScan,
      activity,
    );

    return privateJson({
      profile: {
        id: profile.id,
        handle: profile.handle,
        displayName: profile.display_name,
      },
      activity,
      posts,
      hasMore: pageScan.count === limit,
      nextCursor: pageScan.lastCreatedAt && pageScan.lastId
        ? encodeTimelineCursor({
            createdAt: pageScan.lastCreatedAt,
            id: pageScan.lastId,
          })
        : null,
      limit,
    });
  } catch (error) {
    if (error instanceof HubD1UnavailableError) {
      return privateJson({ error: "profile_activity_unavailable" }, 503);
    }
    return privateJson({ error: "profile_activity_failed" }, 500);
  }
}
