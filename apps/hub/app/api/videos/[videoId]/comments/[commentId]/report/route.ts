import { NextResponse } from "next/server";

import {
  InvalidVideoThreadCommentError,
  reportD1VideoThreadComment,
  VideoThreadTargetNotFoundError,
} from "@/lib/server/d1-video-thread-comments";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getHubD1 } from "@/lib/server/hub-d1";
import { HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ videoId: string; commentId: string }> },
) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }
  try {
    const { videoId, commentId } = await params;
    const database = getHubD1();
    const viewer = await requireHubSessionProfile(request, database);
    const payload = await request.json().catch(() => null) as { reason?: unknown } | null;
    await reportD1VideoThreadComment(database, {
      videoId,
      commentId,
      profileId: viewer.id,
      reason: typeof payload?.reason === "string" ? payload.reason : "",
    });
    return NextResponse.json({ message: "コメントを通報しました。" }, { status: 201 });
  } catch (error) {
    if (error instanceof HubAuthenticationError) {
      return NextResponse.json({ error: "通報にはログインが必要です。" }, { status: 401 });
    }
    if (error instanceof InvalidVideoThreadCommentError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof VideoThreadTargetNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    return NextResponse.json({ error: "コメントを通報できませんでした。" }, { status: 500 });
  }
}
