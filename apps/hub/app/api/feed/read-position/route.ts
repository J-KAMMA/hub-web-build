import { NextResponse } from "next/server";

import { normalizeFeedReadPositionInput } from "@/lib/feed-read-position";
import { canStoreFeedReadPosition } from "@/lib/server/feed-read-position";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";

type PositionRow = { view_key: string; last_seen_item_id: string; updated_at: string };

export async function GET(request: Request) {
  const database = getOptionalHubD1();
  if (!database) return NextResponse.json({ lastSeenPostId: null, positions: {}, synchronized: false });
  try {
    const profile = await requireHubSessionProfile(request, database);
    const [legacy, positionRows] = await Promise.all([
      database.prepare("SELECT last_seen_post_id AS lastSeenPostId, updated_at AS updatedAt FROM home_feed_read_positions WHERE profile_id = ? LIMIT 1")
        .bind(profile.id).first<{ lastSeenPostId: string | null; updatedAt: string }>(),
      database.prepare(`
        SELECT view_key, last_seen_item_id, updated_at
        FROM home_feed_view_read_positions
        WHERE profile_id = ?
        ORDER BY updated_at DESC
        LIMIT 50
      `).bind(profile.id).all<PositionRow>(),
    ]);
    const positions = Object.fromEntries(
      (positionRows.results ?? [])
        .map((row) => normalizeFeedReadPositionInput({ view: row.view_key, itemId: row.last_seen_item_id }))
        .filter((position): position is NonNullable<typeof position> => Boolean(position))
        .map((position) => {
          const row = (positionRows.results ?? []).find((candidate) =>
            candidate.view_key === position.view && candidate.last_seen_item_id === position.itemId);
          return [position.view, {
            itemId: position.itemId,
            updatedAt: Date.parse(row?.updated_at ?? "") || 0,
          }];
        }),
    );
    if (!positions.recommended && legacy?.lastSeenPostId) {
      positions.recommended = {
        itemId: legacy.lastSeenPostId,
        updatedAt: Date.parse(legacy.updatedAt) || 0,
      };
    }
    return NextResponse.json({
      lastSeenPostId: positions.recommended?.itemId ?? legacy?.lastSeenPostId ?? null,
      positions,
      synchronized: true,
    });
  } catch (error) {
    if (error instanceof HubAuthenticationError) {
      return NextResponse.json({ lastSeenPostId: null, positions: {}, synchronized: false }, { status: 401 });
    }
    throw error;
  }
}

export async function PATCH(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "untrusted_origin" }, { status: 403 });
  const database = getOptionalHubD1();
  if (!database) return NextResponse.json({ synchronized: false });
  try {
    const profile = await requireHubSessionProfile(request, database);
    const body = await request.json().catch(() => null) as {
      view?: unknown;
      itemId?: unknown;
      lastSeenPostId?: unknown;
    } | null;
    const input = normalizeFeedReadPositionInput(body?.view === undefined && typeof body?.lastSeenPostId === "string"
      ? { view: "recommended", itemId: body.lastSeenPostId }
      : body);
    if (!input) return NextResponse.json({ error: "invalid_read_position" }, { status: 400 });
    if (!await canStoreFeedReadPosition(database, profile.id, input)) {
      return NextResponse.json({ error: "feed_item_not_available" }, { status: 404 });
    }

    const now = new Date().toISOString();
    const statements = [
      database.prepare(`
        INSERT INTO home_feed_view_read_positions (profile_id, view_key, last_seen_item_id, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(profile_id, view_key) DO UPDATE SET
          last_seen_item_id = excluded.last_seen_item_id,
          updated_at = excluded.updated_at
      `).bind(profile.id, input.view, input.itemId, now),
    ];
    if (input.view === "recommended" && input.itemType === "social") {
      statements.push(database.prepare(`
        INSERT INTO home_feed_read_positions (profile_id, last_seen_post_id, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(profile_id) DO UPDATE SET
          last_seen_post_id = excluded.last_seen_post_id,
          updated_at = excluded.updated_at
      `).bind(profile.id, input.sourceItemId, now));
    }
    await database.batch(statements);
    return NextResponse.json({
      view: input.view,
      itemId: input.itemId,
      lastSeenPostId: input.view === "recommended" ? input.sourceItemId : undefined,
      synchronized: true,
    });
  } catch (error) {
    if (error instanceof HubAuthenticationError) {
      return NextResponse.json({ error: "authentication_required" }, { status: 401 });
    }
    throw error;
  }
}
