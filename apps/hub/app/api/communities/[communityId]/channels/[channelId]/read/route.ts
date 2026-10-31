import { NextResponse } from "next/server";

import { getHubD1 } from "@/lib/server/hub-d1";
import { requireHubSessionProfile } from "@/lib/server/hub-session";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";

export async function POST(request: Request, { params }: { params: Promise<{ communityId: string; channelId: string }> }) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  const { communityId, channelId } = await params;
  const payload = (await request.json().catch(() => ({}))) as { last_message_id?: string | null };
  try {
    const database = getHubD1();
    const viewer = await requireHubSessionProfile(request, database);
    const lastMessageId = payload.last_message_id ?? null;
    const allowed = await database.prepare(`SELECT c.id FROM community_channels c
      JOIN community_memberships m ON m.community_id = c.community_id
      WHERE c.id = ? AND c.community_id = ? AND m.profile_id = ? AND m.status != 'banned'
      AND (? IS NULL OR EXISTS (
        SELECT 1 FROM community_channel_messages message
        WHERE message.id = ? AND message.channel_id = c.id
      )) LIMIT 1`)
      .bind(channelId, communityId, viewer.id, lastMessageId, lastMessageId).first();
    if (!allowed) throw new Error("既読にできるチャンネルが見つかりません。");
    await database.prepare(`INSERT INTO community_channel_read_states
      (channel_id, profile_id, last_read_message_id, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(channel_id, profile_id) DO UPDATE SET
        last_read_message_id = excluded.last_read_message_id,
        updated_at = excluded.updated_at`)
      .bind(channelId, viewer.id, lastMessageId, new Date().toISOString()).run();
    return NextResponse.json({ ok: true, channelId, lastReadMessageId: lastMessageId });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "既読状態を更新できませんでした。" }, { status: 400 });
  }
}
