import { NextResponse } from "next/server";

import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import { HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";
import { setD1PinnedProfilePost } from "@/lib/server/profile-pinned-posts";

export async function PATCH(request: Request) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: "不正なリクエストです。" }, { status: 403 });
  }

  try {
    const payload = await request.json() as { postId?: unknown };
    if (payload.postId !== null && typeof payload.postId !== "string") {
      return NextResponse.json({ error: "ポストを選択してください。" }, { status: 400 });
    }
    const postId = typeof payload.postId === "string" ? payload.postId.trim() : null;
    if (postId !== null && (!postId || postId.length > 100)) {
      return NextResponse.json({ error: "ポストを選択してください。" }, { status: 400 });
    }

    const database = getHubD1();
    const viewer = await requireHubSessionProfile(request, database);
    return NextResponse.json({
      pinnedPostId: await setD1PinnedProfilePost(database, viewer.id, postId),
    });
  } catch (error) {
    const status = error instanceof HubAuthenticationError
      ? 401
      : error instanceof HubD1UnavailableError
        ? 503
        : 400;
    const message = error instanceof HubD1UnavailableError
      ? "固定ポストを更新できません。しばらくしてから再度お試しください。"
      : error instanceof Error
        ? error.message
        : "固定ポストを更新できませんでした。";
    return NextResponse.json({ error: message }, { status });
  }
}
