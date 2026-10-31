import { NextResponse } from "next/server";

import { toggleCommunityChannelReactionRouteData } from "@/lib/server/community-route-data";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";

const ALLOWED_EMOJI = ["👍", "❤️", "🎉"] as const;

export async function POST(request: Request, { params }: { params: Promise<{ communityId: string; channelId: string; messageId: string }> }) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  const { communityId, channelId, messageId } = await params;
  const payload = (await request.json().catch(() => ({}))) as { emoji?: string };
  if (!ALLOWED_EMOJI.includes(payload.emoji as (typeof ALLOWED_EMOJI)[number])) {
    return NextResponse.json({ error: "対応していないリアクションです。" }, { status: 400 });
  }
  try {
    return NextResponse.json(await toggleCommunityChannelReactionRouteData(request, { communityId, channelId, messageId, emoji: payload.emoji as (typeof ALLOWED_EMOJI)[number] }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "リアクションを更新できませんでした。" }, { status: 400 });
  }
}
