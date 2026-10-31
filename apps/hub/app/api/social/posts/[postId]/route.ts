import { NextResponse } from "next/server";

import { unpublishAttachedFiles } from "@/lib/server/content-files";
import { getHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import {
  HubAuthenticationError,
  requireHubSessionProfile,
} from "@/lib/server/hub-session";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import {
  deleteD1SocialPost,
  editD1SocialPost,
  SocialPostActionError,
} from "@/lib/server/social-post-actions";
import { mayFederatePost } from "@/lib/server/gated-exits";
import {
  deleteFederatedPost,
  updateFederatedPost,
} from "@/lib/server/federation-gateway";

type RouteContext = { params: Promise<{ postId: string }> };

function actionError(error: unknown) {
  if (error instanceof HubAuthenticationError) {
    return NextResponse.json(
      { error: "ログインが必要です。" },
      { status: 401 },
    );
  }
  if (error instanceof SocialPostActionError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof HubD1UnavailableError) {
    return NextResponse.json(
      { error: "Social post service is unavailable." },
      { status: 503 },
    );
  }
  throw error;
}

export async function PATCH(request: Request, context: RouteContext) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  }
  try {
    const database = getHubD1();
    const viewer = await requireHubSessionProfile(request, database);
    const { postId } = await context.params;
    const payload = await request.json().catch(() => null) as {
      body?: unknown;
    } | null;
    if (!payload || typeof payload.body !== "string") {
      return NextResponse.json(
        { error: "本文が必要です。" },
        { status: 400 },
      );
    }
    const post = await editD1SocialPost(
        database,
        postId,
        viewer.id,
        payload.body,
      );
    if (await mayFederatePost(database, postId)) await updateFederatedPost(postId, post.body);
    return NextResponse.json({ post });
  } catch (error) {
    return actionError(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  }
  try {
    const database = getHubD1();
    const viewer = await requireHubSessionProfile(request, database);
    const { postId } = await context.params;
    const post = await deleteD1SocialPost(database, postId, viewer.id);
    await unpublishAttachedFiles(database, { targetType: "post", targetId: postId });
    await deleteFederatedPost(postId);
    return NextResponse.json({ post });
  } catch (error) {
    return actionError(error);
  }
}
