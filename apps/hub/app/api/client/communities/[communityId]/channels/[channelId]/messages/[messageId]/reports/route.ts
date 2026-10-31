import { NextResponse } from "next/server";
import { isCommunityMessageId } from "@/lib/server/community-message-request";

import { reportCommunityChannelMessageRouteData } from "@/lib/server/community-route-data";
import { communityApiErrorResponse } from "@/lib/server/community-api-error";

const REASONS = ["spam", "harassment", "other"] as const;
const idPattern = /^[A-Za-z0-9_-]{1,80}$/;

/**
 * クライアント向けのチャンネルメッセージ通報口。
 * ブラウザ側の /api/communities/.../reports は同一オリジン前提なので
 * 別口にする。記録と閾値の判定は共通の reportCommunityChannelMessageRouteData。
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ communityId: string; channelId: string; messageId: string }> },
) {
  const { communityId, channelId, messageId } = await params;
  if (!idPattern.test(communityId) || !idPattern.test(channelId) || !isCommunityMessageId(messageId)) {
    return NextResponse.json({ error: "指定が正しくありません。" }, { status: 400 });
  }
  const payload = (await request.json().catch(() => ({}))) as { reason?: string };
  if (!REASONS.includes(payload.reason as (typeof REASONS)[number])) {
    return NextResponse.json({ error: "通報理由を選択してください。" }, { status: 400 });
  }
  try {
    const report = await reportCommunityChannelMessageRouteData(request, {
      communityId,
      channelId,
      messageId,
      reason: payload.reason as (typeof REASONS)[number],
    });
    return NextResponse.json(report, { status: report.submitted ? 201 : 200 });
  } catch (error) {
    return communityApiErrorResponse(error, "通報を送信できませんでした。", 400);
  }
}
