import { NextResponse } from "next/server";

import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import { HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";
import { setD1CommunityProfileVisibility } from "@/lib/server/profile-public-details";

export async function PATCH(request: Request) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: "不正なリクエストです。" }, { status: 403 });
  }

  try {
    const body = await request.json() as { communityId?: unknown; published?: unknown };
    if (
      typeof body.communityId !== "string"
      || !body.communityId.trim()
      || body.communityId.length > 100
      || typeof body.published !== "boolean"
    ) {
      return NextResponse.json({ error: "入力内容を確認してください。" }, { status: 400 });
    }

    const database = getHubD1();
    const viewer = await requireHubSessionProfile(request, database);
    return NextResponse.json({
      published: await setD1CommunityProfileVisibility(
        database,
        viewer.id,
        body.communityId,
        body.published,
      ),
    });
  } catch (error) {
    if (error instanceof HubAuthenticationError) {
      return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
    }
    if (error instanceof HubD1UnavailableError) {
      return NextResponse.json(
        { error: "公開設定を更新できません。しばらくしてから再度お試しください。" },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "公開設定を更新できませんでした。" },
      { status: 400 },
    );
  }
}
