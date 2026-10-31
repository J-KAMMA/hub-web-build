import { NextResponse } from "next/server";
import { isCommunityMessageId } from "@/lib/server/community-message-request";

import { toggleCommunityChannelReactionRouteData } from "@/lib/server/community-route-data";
import { communityApiErrorResponse } from "@/lib/server/community-api-error";

const ALLOWED_EMOJI = ["👍", "❤️", "🎉"] as const;

/**
 * クライアント向けのメッセージリアクション。同一オリジン確認の
 * 代わりに Bearer assertion で本人確認する。
 * { emoji: "👍" | "❤️" | "🎉" }
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ communityId: string; channelId: string; messageId: string }> },
) {
  const { communityId, channelId, messageId } = await params;
  if (![communityId, channelId].every(id => /^[A-Za-z0-9_-]{1,80}$/.test(id)) || !isCommunityMessageId(messageId)) {
    return NextResponse.json({ error: "指定が正しくありません。" }, { status: 400 });
  }
  const payload = (await request.json().catch(() => ({}))) as { emoji?: string };
  if (!ALLOWED_EMOJI.includes(payload.emoji as (typeof ALLOWED_EMOJI)[number])) {
    return NextResponse.json({ error: "対応していないリアクションです。" }, { status: 400 });
  }
  try {
    const result = await toggleCommunityChannelReactionRouteData(request, {
      communityId,
      channelId,
      messageId,
      emoji: payload.emoji as (typeof ALLOWED_EMOJI)[number],
    });
    return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return communityApiErrorResponse(error, "リアクションを更新できませんでした。", 400);
  }
}
