import { NextResponse } from "next/server";

import {
  setD1VideoThreadCommentLike,
  VideoThreadTargetNotFoundError,
} from "@/lib/server/d1-video-thread-comments";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getHubD1 } from "@/lib/server/hub-d1";
import { HubProfileBlockedError } from "@/lib/server/profile-blocks";
import { HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";

async function mutate(
  request: Request,
  params: Promise<{ videoId: string; commentId: string }>,
  liked: boolean,
) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }
  try {
    const { videoId, commentId } = await params;
    const database = getHubD1();
    const viewer = await requireHubSessionProfile(request, database);
    const comments = await setD1VideoThreadCommentLike(database, {
      videoId,
      commentId,
      profileId: viewer.id,
      liked,
    });
    return NextResponse.json({ comments });
  } catch (error) {
    if (error instanceof HubAuthenticationError) {
      return NextResponse.json({ error: "いいねにはログインが必要です。" }, { status: 401 });
    }
    if (error instanceof VideoThreadTargetNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof HubProfileBlockedError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return NextResponse.json({ error: "いいねを更新できませんでした。" }, { status: 500 });
  }
}

export function POST(
  request: Request,
  { params }: { params: Promise<{ videoId: string; commentId: string }> },
) {
  return mutate(request, params, true);
}

export function DELETE(
  request: Request,
  { params }: { params: Promise<{ videoId: string; commentId: string }> },
) {
  return mutate(request, params, false);
}
