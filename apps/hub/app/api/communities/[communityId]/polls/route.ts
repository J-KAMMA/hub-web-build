import { NextResponse } from "next/server";

import { createD1CommunityChannelMessage, requireActiveMember, listD1CommunityChannelMessages } from "@/lib/server/d1-community-channels";
import { getHubD1 } from "@/lib/server/hub-d1";
import { requireHubViewerProfile } from "@/lib/server/desktop-hub-auth";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getCommunityPollOptions } from "@/lib/server/community-polls";
import { communityApiErrorResponse } from "@/lib/server/community-api-error";
import { communityExpectedViewerError } from "@/lib/server/client-community-operation";

type Context = { params: Promise<{ communityId: string }> };

export async function GET(request: Request, { params }: Context) {
  const { communityId } = await params;
  try {
    const database = getHubD1();
    const viewer = await requireHubViewerProfile(request, database);
    return NextResponse.json({ options: await getCommunityPollOptions(database, communityId, viewer.id) }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) { return communityApiErrorResponse(error, "アンケートを取得できませんでした。"); }
}

export async function POST(request: Request, { params }: Context) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  const { communityId } = await params;
  const body = await request.json().catch(() => ({})) as { channelId?: string; question?: string; options?: string[]; closesInHours?: number; clientRequestId?: string };
  if (!body || typeof body.question !== "string" || !Array.isArray(body.options) || body.options.some(item => typeof item !== "string") || !/^[A-Za-z0-9_-]{1,80}$/.test(body.channelId ?? "")) return NextResponse.json({ error: "質問と選択肢を確認してください。" }, { status: 400 });
  const question = body.question.normalize("NFKC").trim().slice(0, 200);
  const options = [...new Set(body.options.map(item => item.normalize("NFKC").trim().slice(0, 100)).filter(Boolean))].slice(0, 10);
  if (!body.channelId || !question || options.length < 2) return NextResponse.json({ error: "質問と2件以上の選択肢が必要です。" }, { status: 400 });
  try {
    const database = getHubD1();
    const actor = await requireHubViewerProfile(request, database);
    const mismatch = communityExpectedViewerError(request, actor.id); if (mismatch) return mismatch;
    const message = await createD1CommunityChannelMessage(database, actor, { communityId, channelId: body.channelId, body: question, kind: "chat", clientRequestId: body.clientRequestId });
    if (await database.prepare("SELECT message_id FROM community_message_polls WHERE message_id = ?").bind(message.id).first()) return NextResponse.json({ message });
    const now = new Date().toISOString();
    const hours = typeof body.closesInHours === "number" && Number.isFinite(body.closesInHours) ? Math.min(Math.max(body.closesInHours, 1), 24 * 30) : 72;
    await database.batch([
      database.prepare(`INSERT INTO community_message_polls (message_id, closes_at, multiple_choice, created_at) VALUES (?, ?, 0, ?)`).bind(message.id, new Date(Date.now() + hours * 3600000).toISOString(), now),
      ...options.map((label, position) => database.prepare(`INSERT INTO community_message_poll_options (id, message_id, label, position) VALUES (?, ?, ?, ?)`).bind(crypto.randomUUID(), message.id, label, position)),
    ]);
    return NextResponse.json({ message }, { status: 201 });
  } catch (error) { return communityApiErrorResponse(error, "アンケートを作成できませんでした。"); }
}

export async function PATCH(request: Request, { params }: Context) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  const { communityId } = await params;
  const body = await request.json().catch(() => ({})) as { optionId?: string };
  try {
    const database = getHubD1(); const actor = await requireHubViewerProfile(request, database);
    const mismatch = communityExpectedViewerError(request, actor.id); if (mismatch) return mismatch;
    if (!body || typeof body.optionId !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(body.optionId)) throw new Error("選択肢の指定が正しくありません。");
    const option = await database.prepare(`SELECT o.id, o.message_id AS messageId, m.channel_id AS channelId FROM community_message_poll_options o
      JOIN community_message_polls p ON p.message_id = o.message_id JOIN community_channel_messages m ON m.id = o.message_id
      JOIN community_channels c ON c.id = m.channel_id WHERE o.id = ? AND c.community_id = ? AND (p.closes_at IS NULL OR p.closes_at > ?) LIMIT 1`)
      .bind(body.optionId, communityId, new Date().toISOString()).first<{ id: string; messageId: string; channelId: string }>();
    if (!option) throw new Error("投票できない選択肢です。");
    await requireActiveMember(database, communityId, actor.id, option.channelId);
    if (!(await listD1CommunityChannelMessages(database, communityId, option.channelId, actor.id, option.messageId)).length) throw new Error("投票できない投稿です。");
    await database.batch([
      database.prepare(`DELETE FROM community_message_poll_votes WHERE profile_id = ? AND option_id IN (SELECT id FROM community_message_poll_options WHERE message_id = ?)`).bind(actor.id, option.messageId),
      database.prepare(`INSERT INTO community_message_poll_votes (option_id, profile_id, created_at) VALUES (?, ?, ?)`).bind(option.id, actor.id, new Date().toISOString()),
    ]);
    return NextResponse.json({ voted: true });
  } catch (error) { return communityApiErrorResponse(error, "投票できませんでした。"); }
}
