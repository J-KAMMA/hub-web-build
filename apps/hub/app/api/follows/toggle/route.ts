import { NextResponse } from "next/server";

import { toggleD1FollowRouteData } from "@/lib/server/follows-route-data";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import { HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";
import { HubProfileBlockedError } from "@/lib/server/profile-blocks";
import { consumeD1PostQuota, HubPostRateLimitError } from "@/lib/server/d1-rate-limit";

async function setFollow(request: Request, forcedActive?: boolean) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "不正なリクエストです。" }, { status: 403 });
  const body = await request.json().catch(() => null) as {
    target_profile_id?: unknown;
    active?: unknown;
  } | null;

  if (
    typeof body?.target_profile_id !== "string"
    || !body.target_profile_id.trim()
    || body.target_profile_id.length > 128
  ) {
    return NextResponse.json({ error: "target_profile_id is required." }, { status: 400 });
  }
  if (body.active !== undefined && typeof body.active !== "boolean") {
    return NextResponse.json({ error: "active must be a boolean." }, { status: 400 });
  }

  try {
    const database = getHubD1();
    const viewer = await requireHubSessionProfile(request, database);
    await consumeD1PostQuota(database, viewer, "social_follow");
    return NextResponse.json(await toggleD1FollowRouteData(
      database,
      viewer.id,
      body.target_profile_id.trim(),
      forcedActive ?? (body.active as boolean | undefined),
    ));
  } catch (error) {
    if (error instanceof HubAuthenticationError) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
    if (error instanceof HubProfileBlockedError) return NextResponse.json({ error: error.message }, { status: 403 });
    if (error instanceof HubPostRateLimitError) {
      return NextResponse.json(
        {
          error: "フォロー操作の回数が上限に達しました。時間をおいて再試行してください。",
          retry_after: error.retryAfterSeconds,
        },
        {
          status: 429,
          headers: { "Retry-After": String(error.retryAfterSeconds) },
        },
      );
    }
    if (error instanceof HubD1UnavailableError) {
      return NextResponse.json({ error: "Follow service is unavailable." }, { status: 503 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected error." },
      { status: 400 }
    );
  }
}

export async function POST(request: Request) {
  return setFollow(request);
}

export async function PUT(request: Request) {
  return setFollow(request, true);
}

export async function DELETE(request: Request) {
  return setFollow(request, false);
}
