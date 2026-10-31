import { NextResponse } from "next/server";
import { getHubD1 } from "@/lib/server/hub-d1";
import { requireHubViewerProfile } from "@/lib/server/desktop-hub-auth";
import { requireActiveMember } from "@/lib/server/d1-community-channels";
import { communityApiErrorResponse } from "@/lib/server/community-api-error";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { communityExpectedViewerError } from "@/lib/server/client-community-operation";

type Context = { params: Promise<{ communityId: string }> };
export async function POST(request: Request, { params }: Context) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  const { communityId } = await params; const body = await request.json().catch(() => ({})) as { channelId?: string; body?: string; kind?: string; scheduledAt?: string; clientRequestId?: string };
  try {
    const database = getHubD1(); const actor = await requireHubViewerProfile(request, database);
    const mismatch = communityExpectedViewerError(request, actor.id); if (mismatch) return mismatch;
    if (!body || typeof body.body !== "string" || typeof body.channelId !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(body.channelId)) throw new Error("本文とチャンネルを確認してください。");
    await requireActiveMember(database, communityId, actor.id, body.channelId);
    const content = body.body?.normalize("NFKC").trim().slice(0, 2000) ?? ""; const scheduledAt = new Date(body.scheduledAt ?? "");
    if (!content || !Number.isFinite(scheduledAt.getTime())) throw new Error("公開日時と本文を入力してください。");
    const kind = ["chat","guide","question","party"].includes(body.kind ?? "") ? body.kind : "chat";
    if (body.clientRequestId !== undefined && (typeof body.clientRequestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.clientRequestId))) throw new Error("操作IDが正しくありません。");
    const id = body.clientRequestId ?? crypto.randomUUID();
    const existing = body.clientRequestId ? await database.prepare("SELECT community_id, channel_id, author_profile_id, body, kind, scheduled_at FROM community_scheduled_messages WHERE id = ?").bind(id).first<{community_id:string;channel_id:string;author_profile_id:string;body:string;kind:string;scheduled_at:string}>() : null;
    if (existing) {
      if (existing.community_id !== communityId || existing.channel_id !== body.channelId || existing.author_profile_id !== actor.id || existing.body !== content || existing.kind !== kind || existing.scheduled_at !== scheduledAt.toISOString()) throw new Error("操作IDが別の予約に使用されています。");
      return NextResponse.json({ scheduled: true });
    }
    if (scheduledAt.getTime() < Date.now() + 60000) throw new Error("1分後以降の公開日時を入力してください。");
    const channel = await database.prepare(`SELECT 1 AS present FROM community_channels WHERE id = ? AND community_id = ? LIMIT 1`).bind(body.channelId, communityId).first();
    if (!channel) throw new Error("チャンネルが見つかりません。");
    await database.prepare(`INSERT INTO community_scheduled_messages (id, community_id, channel_id, author_profile_id, body, kind, scheduled_at, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'scheduled', ?)`)
      .bind(id, communityId, body.channelId, actor.id, content, kind, scheduledAt.toISOString(), new Date().toISOString()).run();
    return NextResponse.json({ scheduled: true }, { status: 201 });
  } catch (error) { return communityApiErrorResponse(error, "予約投稿を作成できませんでした。"); }
}
