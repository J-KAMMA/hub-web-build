import { NextResponse } from "next/server";

import {
  createD1VideoThreadComment,
  InvalidVideoThreadCommentError,
  listD1VideoThreadComments,
  parseVideoThreadCommentInput,
  VideoThreadTargetNotFoundError,
} from "@/lib/server/d1-video-thread-comments";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getHubD1 } from "@/lib/server/hub-d1";
import { HubProfileBlockedError } from "@/lib/server/profile-blocks";
import {
  getOptionalHubSessionProfile,
  HubAuthenticationError,
  requireHubSessionProfile,
} from "@/lib/server/hub-session";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ videoId: string }> },
) {
  const { videoId } = await params;
  const database = getHubD1();
  const viewer = await getOptionalHubSessionProfile(request, database);
  return NextResponse.json({
    comments: await listD1VideoThreadComments(database, videoId, viewer?.id),
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ videoId: string }> },
) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }
  try {
    const { videoId } = await params;
    const database = getHubD1();
    const viewer = await requireHubSessionProfile(request, database);
    const input = parseVideoThreadCommentInput(await request.json().catch(() => null));
    const comments = await createD1VideoThreadComment(database, {
      videoId,
      profileId: viewer.id,
      ...input,
    });
    return NextResponse.json({ comments }, { status: 201 });
  } catch (error) {
    if (error instanceof HubAuthenticationError) {
      return NextResponse.json({ error: "コメントの投稿にはログインが必要です。" }, { status: 401 });
    }
    if (error instanceof InvalidVideoThreadCommentError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof VideoThreadTargetNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof HubProfileBlockedError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return NextResponse.json({ error: "コメントを投稿できませんでした。" }, { status: 500 });
  }
}
