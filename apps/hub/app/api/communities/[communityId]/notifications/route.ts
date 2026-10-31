import { NextResponse } from "next/server";

import {
  getD1CommunityNotificationPreferences,
  updateD1CommunityNotificationPreferences,
} from "@/lib/server/d1-community-management";
import { getHubD1 } from "@/lib/server/hub-d1";
import { requireHubSessionProfile } from "@/lib/server/hub-session";
import { requireSameOrigin } from "@/lib/server/moderation-admin-auth";

type Context = { params: Promise<{ communityId: string }> };

function privateNoStore(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Vary", "Cookie");
  return response;
}

export async function GET(request: Request, { params }: Context) {
  const { communityId } = await params;
  try {
    const database = getHubD1();
    const actor = await requireHubSessionProfile(request, database);
    const [preferences, channels] = await Promise.all([
      getD1CommunityNotificationPreferences(database, actor, communityId),
      database.prepare(`SELECT c.id AS channelId, coalesce(p.mode, 'mentions') AS mode, p.muted_until AS mutedUntil
        FROM community_channels c LEFT JOIN community_channel_notification_preferences p
        ON p.channel_id = c.id AND p.profile_id = ? WHERE c.community_id = ?
        AND NOT EXISTS (
          SELECT 1 FROM community_member_custom_roles member_role
          JOIN community_channel_permissions permission
            ON permission.role_id = member_role.role_id AND permission.channel_id = c.id
          WHERE member_role.community_id = c.community_id
            AND member_role.profile_id = ? AND permission.can_view = 0
        )
        ORDER BY c.position, c.created_at`)
        .bind(actor.id, communityId, actor.id).all(),
    ]);
    return privateNoStore(NextResponse.json({ preferences, channels: channels.results }));
  } catch (error) {
    return privateNoStore(NextResponse.json(
      { error: error instanceof Error ? error.message : "通知設定を取得できませんでした。" },
      { status: 403 },
    ));
  }
}

export async function PATCH(request: Request, { params }: Context) {
  const originDenied = requireSameOrigin(request);
  if (originDenied) return originDenied;
  const { communityId } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const database = getHubD1();
    const actor = await requireHubSessionProfile(request, database);
    const preferences = {
      mentions: body.mentions !== false,
      replies: body.replies !== false,
      guideUpdates: body.guideUpdates !== false,
      governance: body.governance !== false,
      membership: body.membership !== false,
    };
    const updated = await updateD1CommunityNotificationPreferences(database, actor, communityId, preferences);
    const channels = Array.isArray(body.channels) ? body.channels.slice(0, 100) as Array<Record<string, unknown>> : [];
    if (channels.length) await database.batch(channels.map((item) => {
      const mode = ["all", "mentions", "none"].includes(String(item.mode)) ? String(item.mode) : "mentions";
      return database.prepare(`INSERT INTO community_channel_notification_preferences (channel_id, profile_id, mode, muted_until, updated_at)
        SELECT c.id, ?, ?, NULL, ? FROM community_channels c
        WHERE c.id = ? AND c.community_id = ?
        AND NOT EXISTS (
          SELECT 1 FROM community_member_custom_roles member_role
          JOIN community_channel_permissions permission
            ON permission.role_id = member_role.role_id AND permission.channel_id = c.id
          WHERE member_role.community_id = c.community_id
            AND member_role.profile_id = ? AND permission.can_view = 0
        )
        ON CONFLICT(channel_id, profile_id) DO UPDATE SET mode = excluded.mode, muted_until = NULL, updated_at = excluded.updated_at`)
        .bind(actor.id, mode, new Date().toISOString(), String(item.channelId ?? ""), communityId, actor.id);
    }));
    return privateNoStore(NextResponse.json({ preferences: updated }));
  } catch (error) {
    return privateNoStore(NextResponse.json(
      { error: error instanceof Error ? error.message : "通知設定を更新できませんでした。" },
      { status: 403 },
    ));
  }
}
