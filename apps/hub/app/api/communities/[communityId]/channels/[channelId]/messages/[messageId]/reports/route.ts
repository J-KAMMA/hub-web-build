import { NextResponse } from "next/server";

import { reportCommunityChannelMessageRouteData } from "@/lib/server/community-route-data";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";

const REASONS = ["spam", "harassment", "other"] as const;

export async function POST(request: Request, { params }: { params: Promise<{ communityId: string; channelId: string; messageId: string }> }) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  const { communityId, channelId, messageId } = await params;
  const payload = (await request.json().catch(() => ({}))) as { reason?: string };
  if (!REASONS.includes(payload.reason as (typeof REASONS)[number])) return NextResponse.json({ error: "通報理由を選択してください。" }, { status: 400 });
  try {
    const report = await reportCommunityChannelMessageRouteData(request, { communityId, channelId, messageId, reason: payload.reason as (typeof REASONS)[number] });
    return NextResponse.json(report, { status: report.submitted ? 201 : 200 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "通報を送信できませんでした。" }, { status: 400 });
  }
}
