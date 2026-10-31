import { NextResponse } from "next/server";
import { getHubD1 } from "@/lib/server/hub-d1";
import { getOptionalHubViewerProfile } from "@/lib/server/desktop-hub-auth";
import { requireHubSessionProfile } from "@/lib/server/hub-session";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { resolveChannelReadAccess } from "@/lib/server/d1-community-channels";

type Context = { params: Promise<{ communityId: string; channelId: string }> };

const NOT_FOUND = () => NextResponse.json({ error: "not_found" }, { status: 404, headers: { "Cache-Control": "private, no-store" } });

export async function GET(request: Request, { params }: Context) {
  const { communityId, channelId } = await params; const database = getHubD1();
  try {
    const viewer = await getOptionalHubViewerProfile(request, database);
    // Same visibility rule as the channel's message list (membership, role view permission, token gate); fail closed.
    const access = await resolveChannelReadAccess(database, communityId, channelId, viewer?.id ?? null);
    if (access !== "ok") return NextResponse.json({ pins: [] }, { headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
    const viewerId = viewer?.id ?? "";
    const result = await database.prepare(`SELECT m.id, m.body, m.created_at AS createdAt, p.display_name AS authorName
      FROM community_message_pins pin JOIN community_channel_messages m ON m.id = pin.message_id AND m.channel_id = pin.channel_id
      JOIN profiles p ON p.id = m.author_profile_id WHERE pin.community_id = ? AND pin.channel_id = ?
      AND NOT EXISTS (SELECT 1 FROM profile_moderation_status moderation WHERE moderation.profile_id = m.author_profile_id AND moderation.status = 'suspended')
      AND NOT EXISTS (SELECT 1 FROM thread_user_controls control WHERE control.owner_profile_id = ? AND control.target_profile_id = m.author_profile_id AND (control.muted = 1 OR control.blocked = 1))
      AND NOT EXISTS (SELECT 1 FROM thread_user_controls incoming WHERE incoming.owner_profile_id = m.author_profile_id AND incoming.target_profile_id = ? AND incoming.blocked = 1)
      ORDER BY pin.pinned_at DESC LIMIT 50`).bind(communityId, channelId, viewerId, viewerId).all();
    return NextResponse.json({ pins: result.results }, { headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
  } catch {
    return NOT_FOUND();
  }
}

export async function POST(request: Request, { params }: Context) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  const { communityId, channelId } = await params; const payload = await request.json().catch(() => ({})) as { messageId?: string; pinned?: boolean };
  try {
    const database = getHubD1(); const actor = await requireHubSessionProfile(request, database);
    const membership = await database.prepare(`SELECT role FROM community_memberships WHERE community_id = ? AND profile_id = ? AND status = 'active'`).bind(communityId, actor.id).first<{ role: string }>();
    if (!membership || !["owner", "moderator"].includes(membership.role)) throw new Error("ピン留めを管理する権限がありません。");
    const messageId = String(payload.messageId ?? "");
    // Role in this community is not enough: the channel must belong to it and the message to the channel.
    const channel = await database.prepare("SELECT id FROM community_channels WHERE id = ? AND community_id = ?").bind(channelId, communityId).first();
    if (!channel) return NOT_FOUND();
    const message = await database.prepare("SELECT id FROM community_channel_messages WHERE id = ? AND channel_id = ?").bind(messageId, channelId).first();
    if (!message) return NOT_FOUND();
    if (payload.pinned === false) await database.prepare(`DELETE FROM community_message_pins WHERE community_id = ? AND channel_id = ? AND message_id = ?`).bind(communityId, channelId, messageId).run();
    else await database.prepare(`INSERT OR IGNORE INTO community_message_pins (community_id, channel_id, message_id, pinned_by_profile_id, pinned_at)
      SELECT ?, ?, id, ?, ? FROM community_channel_messages WHERE id = ? AND channel_id = ?`).bind(communityId, channelId, actor.id, new Date().toISOString(), messageId, channelId).run();
    return NextResponse.json({ ok: true });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "ピン留めを更新できませんでした。" }, { status: 400 }); }
}
