import { NextResponse } from "next/server";

import { toggleThreadUserControlRouteData } from "@/lib/server/thread-post-actions-route-data";
import { HubAuthenticationError } from "@/lib/server/hub-session";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { HubD1UnavailableError } from "@/lib/server/hub-d1";
import { webThreadPostControls } from "@/lib/server/web-thread-post-controls";

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie, Authorization" };

export async function GET(request: Request, { params }: { params: Promise<{ postId: string }> }) {
  return webThreadPostControls(request, (await params).postId);
}
export async function PUT(request: Request, { params }: { params: Promise<{ postId: string }> }) {
  return webThreadPostControls(request, (await params).postId, true);
}

export async function POST(request: Request, { params }: { params: Promise<{ postId: string }> }) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  const { postId } = await params;
  const body = await request.json().catch(() => null) as { action?: unknown } | null;
  if (!body) return NextResponse.json({ error: "リクエストの形式が正しくありません。" }, { status: 400 });
  if (body.action !== "mute" && body.action !== "block") {
    return NextResponse.json({ error: "操作が正しくありません。" }, { status: 400 });
  }
  try {
    return NextResponse.json(
      await toggleThreadUserControlRouteData(request, postId, body.action),
      { headers: PRIVATE_HEADERS },
    );
  } catch (error) {
    if (error instanceof HubAuthenticationError) return NextResponse.json({ error: "この操作にはHubへのログインが必要です。" }, { status: 401, headers: PRIVATE_HEADERS });
    if (error instanceof HubD1UnavailableError) return NextResponse.json({ error: "安全設定を利用できません。" }, { status: 503, headers: PRIVATE_HEADERS });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unexpected error." }, { status: 400, headers: PRIVATE_HEADERS });
  }
}
