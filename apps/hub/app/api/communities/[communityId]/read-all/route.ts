import { NextResponse } from "next/server";

import { getHubD1 } from "@/lib/server/hub-d1";
import { requireHubSessionProfile } from "@/lib/server/hub-session";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ communityId: string }> },
) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  const { communityId } = await params;
  try {
    const database = getHubD1();
    const viewer = await requireHubSessionProfile(request, database);
    const membership = await database.prepare(`SELECT 1 AS allowed FROM community_memberships
      WHERE community_id = ? AND profile_id = ? AND status != 'banned' LIMIT 1`)
      .bind(communityId, viewer.id).first();
    if (!membership) throw new Error("参加中のコミュニティだけ既読にできます。");
    const now = new Date().toISOString();
    await database.prepare(`INSERT INTO community_channel_read_states
      (channel_id, profile_id, last_read_message_id, updated_at)
      SELECT c.id, ?, (
        SELECT m.id FROM community_channel_messages m
        WHERE m.channel_id = c.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1
      ), ?
      FROM community_channels c WHERE c.community_id = ?
      ON CONFLICT(channel_id, profile_id) DO UPDATE SET
        last_read_message_id = excluded.last_read_message_id,
        updated_at = excluded.updated_at`)
      .bind(viewer.id, now, communityId).run();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "既読状態を更新できませんでした。" },
      { status: 400 },
    );
  }
}
