import { NextResponse } from "next/server";

import { getHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import { getOptionalHubSessionProfile } from "@/lib/server/hub-session";
import { readListPagination } from "@/lib/server/list-pagination";
import { decodeTimelineCursor, encodeTimelineCursor } from "@/lib/timeline-cursor";

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie",
};

type RouteContext = {
  params: Promise<{ handle: string }>;
};

type ProfileRow = { id: string };
type ConnectionRow = {
  id: string;
  handle: string;
  display_name: string;
  avatar_url: string | null;
  connected_at: string;
};

function privateJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: PRIVATE_HEADERS });
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const { handle: rawHandle } = await context.params;
    const handle = rawHandle.trim();
    const url = new URL(request.url);
    const kind = url.searchParams.get("kind");
    if (!handle || handle.length > 64) return privateJson({ error: "invalid_handle" }, 400);
    if (kind !== "followers" && kind !== "following") {
      return privateJson({ error: "kind must be followers or following." }, 400);
    }
    const rawCursor = url.searchParams.get("cursor");
    const cursor = decodeTimelineCursor(rawCursor);
    if (rawCursor && !cursor) return privateJson({ error: "invalid_cursor" }, 400);
    const { limit } = readListPagination(url);
    const database = getHubD1();
    const viewer = await getOptionalHubSessionProfile(request, database);
    const viewerId = viewer?.id ?? "";
    const profile = await database.prepare(`SELECT p.id
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

    const ownerColumn = kind === "followers" ? "followed_profile_id" : "follower_profile_id";
    const connectionColumn = kind === "followers" ? "follower_profile_id" : "followed_profile_id";
    const result = await database.prepare(`SELECT
        connection_profile.id,
        connection_profile.handle,
        connection_profile.display_name,
        connection_profile.avatar_url,
        f.created_at AS connected_at
      FROM follows f
      JOIN profiles connection_profile ON connection_profile.id = f.${connectionColumn}
      WHERE f.${ownerColumn} = ?
        AND NOT EXISTS (
          SELECT 1 FROM profile_moderation_status moderation
          WHERE moderation.profile_id = connection_profile.id AND moderation.status = 'suspended'
        )
        AND (
          ? = ''
          OR (
            NOT EXISTS (
              SELECT 1 FROM thread_user_controls control
              WHERE control.blocked = 1
                AND (
                  (control.owner_profile_id = ? AND control.target_profile_id = connection_profile.id)
                  OR (control.owner_profile_id = connection_profile.id AND control.target_profile_id = ?)
                )
            )
            AND NOT EXISTS (
              SELECT 1 FROM thread_user_controls mute
              WHERE mute.owner_profile_id = ?
                AND mute.target_profile_id = connection_profile.id
                AND mute.muted = 1
            )
          )
        )
        ${cursor ? `AND (
          f.created_at < ?
          OR (f.created_at = ? AND connection_profile.id < ?)
        )` : ""}
      ORDER BY f.created_at DESC, connection_profile.id DESC
      LIMIT ?`)
      .bind(
        profile.id,
        viewerId,
        viewerId,
        viewerId,
        viewerId,
        ...(cursor ? [cursor.createdAt, cursor.createdAt, cursor.id] : []),
        limit,
      )
      .all<ConnectionRow>();

    const last = result.results.at(-1);
    return privateJson({
      kind,
      profiles: result.results.map((item) => ({
        id: item.id,
        handle: item.handle,
        displayName: item.display_name,
        avatarUrl: item.avatar_url ?? undefined,
      })),
      hasMore: result.results.length === limit,
      nextCursor: last
        ? encodeTimelineCursor({ createdAt: last.connected_at, id: last.id })
        : null,
      limit,
    });
  } catch (error) {
    if (error instanceof HubD1UnavailableError) {
      return privateJson({ error: "profile_connections_unavailable" }, 503);
    }
    return privateJson({ error: "profile_connections_failed" }, 500);
  }
}
