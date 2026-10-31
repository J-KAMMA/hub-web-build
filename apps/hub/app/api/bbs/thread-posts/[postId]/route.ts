import { NextResponse } from "next/server";

import { validateReplyContent } from "@/lib/bbs-content-quality";
import { deleteThreadPostRouteData, editThreadPostRouteData } from "@/lib/server/thread-post-actions-route-data";
import { HubAuthenticationError } from "@/lib/server/hub-session";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { HubD1UnavailableError } from "@/lib/server/hub-d1";

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };

export async function PATCH(request: Request, { params }: { params: Promise<{ postId: string }> }) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  const { postId } = await params;
  const body = await request.json().catch(() => null) as { body?: string; edit_reason?: string } | null;
  if (!body) return NextResponse.json({ error: "リクエストの形式が正しくありません。" }, { status: 400 });
  const contentError = validateReplyContent(body.body);
  if (contentError) return NextResponse.json({ error: contentError }, { status: 400 });
  try {
    return NextResponse.json(
      await editThreadPostRouteData(request, postId, body.body!.trim(), String(body.edit_reason ?? "").slice(0, 300)),
      { headers: PRIVATE_HEADERS },
    );
  } catch (error) {
    if (error instanceof HubAuthenticationError) return NextResponse.json({ error: "編集するにはHubへログインしてください。" }, { status: 401, headers: PRIVATE_HEADERS });
    if (error instanceof HubD1UnavailableError) return NextResponse.json({ error: "ポストを編集できません。" }, { status: 503, headers: PRIVATE_HEADERS });
    const message = error instanceof Error ? error.message : "Unexpected error.";
    return NextResponse.json({ error: message }, { status: message.startsWith("You can") ? 403 : 400, headers: PRIVATE_HEADERS });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ postId: string }> }) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  const { postId } = await params;
  try {
    return NextResponse.json(await deleteThreadPostRouteData(request, postId), { headers: PRIVATE_HEADERS });
  } catch (error) {
    if (error instanceof HubAuthenticationError) return NextResponse.json({ error: "削除するにはHubへログインしてください。" }, { status: 401, headers: PRIVATE_HEADERS });
    if (error instanceof HubD1UnavailableError) return NextResponse.json({ error: "ポストを削除できません。" }, { status: 503, headers: PRIVATE_HEADERS });
    const message = error instanceof Error ? error.message : "Unexpected error.";
    return NextResponse.json({ error: message }, { status: message.startsWith("You can") ? 403 : 400, headers: PRIVATE_HEADERS });
  }
}
