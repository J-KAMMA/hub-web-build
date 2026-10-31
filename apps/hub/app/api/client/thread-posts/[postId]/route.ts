import { NextResponse } from "next/server";

import { validateReplyContent } from "@/lib/bbs-content-quality";
import {
  deleteThreadPostRouteData,
  editThreadPostRouteData,
} from "@/lib/server/thread-post-actions-route-data";
import { DesktopHubAuthenticationError } from "@/lib/server/desktop-hub-auth";
import { HubAuthenticationError } from "@/lib/server/hub-session";
import { HubD1UnavailableError } from "@/lib/server/hub-d1";

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };
const ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;

function errorResponse(error: unknown, fallback: string) {
  if (error instanceof DesktopHubAuthenticationError) {
    return NextResponse.json(
      { error: "desktop_authentication_failed" },
      { status: 401, headers: PRIVATE_HEADERS },
    );
  }
  if (error instanceof HubAuthenticationError) {
    return NextResponse.json(
      { error: "ログインが必要です。" },
      { status: 401, headers: PRIVATE_HEADERS },
    );
  }
  if (error instanceof HubD1UnavailableError) {
    return NextResponse.json(
      { error: "ポストを操作できません。" },
      { status: 503, headers: PRIVATE_HEADERS },
    );
  }
  const message = error instanceof Error ? error.message : "Unexpected error.";
  return NextResponse.json(
    { error: message },
    { status: message.startsWith("You can") ? 403 : 400, headers: PRIVATE_HEADERS },
  );
}

/**
 * クライアント向けのスレッド投稿の編集・削除。
 * ブラウザ側は /api/bbs/thread-posts/[id] が同一オリジン前提なので、
 * assertion 経路の口を別に作る。編集権限・履歴は共通の route-data が判定する。
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ postId: string }> },
) {
  const { postId } = await params;
  if (!ID_PATTERN.test(postId)) {
    return NextResponse.json({ error: "指定が正しくありません。" }, { status: 400 });
  }
  const body = (await request.json().catch(() => null)) as {
    body?: string;
    edit_reason?: string;
  } | null;
  const contentError = validateReplyContent(body?.body);
  if (contentError) {
    return NextResponse.json({ error: contentError }, { status: 400 });
  }
  try {
    return NextResponse.json(
      await editThreadPostRouteData(
        request,
        postId,
        body!.body!.trim(),
        String(body?.edit_reason ?? "").slice(0, 300),
      ),
      { headers: PRIVATE_HEADERS },
    );
  } catch (error) {
    return errorResponse(error, "ポストを編集できませんでした。");
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ postId: string }> },
) {
  const { postId } = await params;
  if (!ID_PATTERN.test(postId)) {
    return NextResponse.json({ error: "指定が正しくありません。" }, { status: 400 });
  }
  try {
    return NextResponse.json(await deleteThreadPostRouteData(request, postId), {
      headers: PRIVATE_HEADERS,
    });
  } catch (error) {
    return errorResponse(error, "ポストを削除できませんでした。");
  }
}
