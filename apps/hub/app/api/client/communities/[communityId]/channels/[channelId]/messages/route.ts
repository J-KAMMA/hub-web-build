import { NextResponse } from "next/server";

import {
  createCommunityChannelMessageRouteData,
  getCommunityChannelMessagesRouteData,
} from "@/lib/server/community-route-data";
import { communityApiErrorResponse } from "@/lib/server/community-api-error";
import { getOptionalHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import { getOptionalDesktopHubProfile } from "@/lib/server/desktop-hub-auth";
import { getCommunityPollOptions } from "@/lib/server/community-polls";
import { requireActiveMember } from "@/lib/server/d1-community-channels";
import { publishDueCommunityMessages } from "@/lib/server/d1-community-scheduled";

const messageKinds = new Set(["chat", "guide", "question", "party"] as const);
class ChannelMessageScopeError extends Error {}

function privateNoStore(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

/**
 * クライアント向けのチャンネルメッセージ口。読み取りは公開
 * （チャンネルの公開範囲はローダー側）、書き込みは Bearer
 * assertion の本人確認に委ねる。画像は /api/client/images で
 * 先に pending 登録してから imageIds で添付する。
 * POST { body, replyToMessageId?, kind?, imageIds?, clientRequestId? }
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ communityId: string; channelId: string }> },
) {
  const { communityId, channelId } = await params;
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(communityId) || !/^[A-Za-z0-9_-]{1,80}$/.test(channelId)) {
    return NextResponse.json({ error: "指定が正しくありません。" }, { status: 400 });
  }
  try {
    const database = getOptionalHubD1();
    // One-time assertions must be verified once, then the same viewer drives
    // channel visibility and the controls returned to the desktop.
    const viewer = database ? await getOptionalDesktopHubProfile(request, database) : null;
    if (database) await publishDueCommunityMessages(database, undefined, communityId);
    const data = await getCommunityChannelMessagesRouteData(request, communityId, channelId, { viewer });
    // メッセージはauthorProfileIdしか持たない。Webはメンバー一覧から名前を
    // 引き直しているので、ここでも投稿者のプロフィールを同じ応答に添える。
    const authorIds = [
      ...new Set(
        (data.messages ?? [])
          .map((message: { authorProfileId?: string | null }) => message.authorProfileId)
          .filter((id): id is string => typeof id === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(id)),
      ),
    ].slice(0, 100);
    let profiles: Record<string, { displayName: string; handle: string | null; avatarUrl: string | null }> = {};
    if (database && authorIds.length) {
      const marks = authorIds.map(() => "?").join(", ");
      const rows = await database.prepare(
        `SELECT id, display_name AS displayName, handle, avatar_url AS avatarUrl
          FROM profiles WHERE id IN (${marks})`,
      ).bind(...authorIds).all<{ id: string; displayName: string; handle: string | null; avatarUrl: string | null }>();
      profiles = Object.fromEntries(
        (rows.results ?? []).map((row) => [row.id, {
          displayName: row.displayName,
          handle: row.handle,
          avatarUrl: row.avatarUrl,
        }]),
      );
    }
    // ピン留め・削除はモデレーターだけの操作。viewerの役割を返して
    // クライアントがボタンを出せるようにする。
    let canModerate = false;
    let canPost = false;
    const viewerProfileId = viewer?.id ?? null;
    if (database) {
      if (viewer) {
        const role = await database.prepare(
          `SELECT role FROM community_memberships
            WHERE community_id = ? AND profile_id = ? AND status = 'active' LIMIT 1`,
        ).bind(communityId, viewer.id).first<{ role: string }>();
        canModerate = role?.role === "owner" || role?.role === "moderator";
        try { await requireActiveMember(database, communityId, viewer.id, channelId); canPost = Boolean(await database.prepare('SELECT id FROM community_channels WHERE id=? AND community_id=? AND archived_at IS NULL').bind(channelId,communityId).first()); } catch { /* Keep the readable channel, deny posting. */ }
      }
    }
    return privateNoStore(
      NextResponse.json({ ...data, profiles, canModerate, canPost, viewerProfileId,
        pollOptions: database && viewer ? await getCommunityPollOptions(database, communityId, viewer.id, data.messages.map(message => message.id)) : [],
      }),
    );
  } catch (error) {
    return privateNoStore(
      communityApiErrorResponse(error, "チャンネルを取得できませんでした。", 404),
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ communityId: string; channelId: string }> },
) {
  const { communityId, channelId } = await params;
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(communityId) || !/^[A-Za-z0-9_-]{1,80}$/.test(channelId)) {
    return NextResponse.json({ error: "指定が正しくありません。" }, { status: 400 });
  }
  // Optional for older callers; this value is a precondition, never an actor claim.
  const expectedViewer = request.headers.get("X-Hub-Expected-Viewer");
  if (expectedViewer !== null && (expectedViewer.length < 1 || expectedViewer.length > 128 || /[^A-Za-z0-9_-]/u.test(expectedViewer))) {
    return privateNoStore(NextResponse.json({ error: "bad_request" }, { status: 400 }));
  }
  const payload = (await request.json().catch(() => ({}))) as {
    body?: string;
    replyToMessageId?: string | null;
    kind?: "chat" | "guide" | "question" | "party";
    imageIds?: unknown;
    clientRequestId?: string;
  };
  if (
    payload.clientRequestId !== undefined &&
    (typeof payload.clientRequestId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.clientRequestId))
  ) {
    return NextResponse.json({ error: "投稿操作IDが正しくありません。" }, { status: 400 });
  }
  const body = payload.body?.trim() ?? "";
  if (body.length > 2000) {
    return NextResponse.json(
      { error: "メッセージは1〜2000文字で入力してください。" },
      { status: 400 },
    );
  }
  const imageIds = payload.imageIds === undefined ? [] : payload.imageIds;
  if (
    !Array.isArray(imageIds) || imageIds.length > 4 ||
    imageIds.some((id) => typeof id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
  ) {
    return NextResponse.json({ error: "画像の指定が正しくありません。" }, { status: 400 });
  }
  if (!body && !imageIds.length) {
    return NextResponse.json(
      { error: "メッセージか画像を入力してください。" },
      { status: 400 },
    );
  }
  if (payload.kind && !messageKinds.has(payload.kind)) {
    return NextResponse.json({ error: "投稿カテゴリが正しくありません。" }, { status: 400 });
  }
  try {
    return privateNoStore(
      NextResponse.json(
        await createCommunityChannelMessageRouteData(request, {
          communityId,
          channelId,
          body,
          replyToMessageId:
            typeof payload.replyToMessageId === "string" ? payload.replyToMessageId : null,
          kind: payload.kind ?? "chat",
          imageIds: imageIds as string[],
          clientRequestId: payload.clientRequestId,
        }, expectedViewer === null ? undefined : (viewer) => {
          if (viewer.id !== expectedViewer) throw new ChannelMessageScopeError();
        }),
        { status: 201 },
      ),
    );
  } catch (error) {
    if (error instanceof ChannelMessageScopeError) return privateNoStore(NextResponse.json({ error: "channel_message_scope_changed" }, { status: 409 }));
    if (error instanceof HubD1UnavailableError) return privateNoStore(NextResponse.json({ error: "unavailable" }, { status: 503 }));
    return privateNoStore(
      communityApiErrorResponse(error, "メッセージを投稿できませんでした。", 400),
    );
  }
}
