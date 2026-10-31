import { NextResponse } from "next/server";

import { reportThreadPostRouteData } from "@/lib/server/thread-post-actions-route-data";
import { isThreadReportReason } from "@/lib/thread-post-moderation";
import { HubAuthenticationError } from "@/lib/server/hub-session";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { HubD1UnavailableError } from "@/lib/server/hub-d1";

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };

export async function POST(request: Request, { params }: { params: Promise<{ postId: string }> }) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  const { postId } = await params;
  const body = await request.json().catch(() => null) as { reason?: unknown; details?: unknown } | null;
  if (!body) return NextResponse.json({ error: "リクエストの形式が正しくありません。" }, { status: 400 });
  if (!isThreadReportReason(body.reason)) {
    return NextResponse.json({ error: "通報理由を選んでください。" }, { status: 400 });
  }
  if (body.details !== undefined && (typeof body.details !== "string" || body.details.length > 500)) {
    return NextResponse.json({ error: "補足は500文字以内で入力してください。" }, { status: 400 });
  }
  try {
    return NextResponse.json(
      await reportThreadPostRouteData(request, postId, body.reason, body.details as string | undefined),
      { headers: PRIVATE_HEADERS },
    );
  } catch (error) {
    if (error instanceof HubAuthenticationError) return NextResponse.json({ error: "通報するにはHubへログインしてください。" }, { status: 401, headers: PRIVATE_HEADERS });
    if (error instanceof HubD1UnavailableError) return NextResponse.json({ error: "通報機能を利用できません。" }, { status: 503, headers: PRIVATE_HEADERS });
    const message = error instanceof Error ? error.message : "Unexpected error.";
    if (message.includes("report_rate_limit")) {
      return NextResponse.json(
        { error: "通報回数の上限に達しました。1時間後にもう一度お試しください。" },
        { status: 429, headers: { ...PRIVATE_HEADERS, "Retry-After": "3600" } },
      );
    }
    return NextResponse.json({ error: message }, { status: message.startsWith("You can") ? 403 : 404, headers: PRIVATE_HEADERS });
  }
}
