import { NextResponse } from "next/server";

import { getHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import {
  DesktopHubAuthenticationError,
  requireDesktopHubProfile,
} from "@/lib/server/desktop-hub-auth";
import { toggleD1FollowRouteData } from "@/lib/server/follows-route-data";
import { HubSuspendedError } from "@/lib/server/hub-session";
import { HubProfileBlockedError } from "@/lib/server/profile-blocks";
import { consumeD1PostQuota, HubPostRateLimitError } from "@/lib/server/d1-rate-limit";

/**
 * クライアント向けのフォロー切替。判定・ブロック・レート制限は
 * Web側の /api/follows/toggle と同じ関数を通す。
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as {
    target_profile_id?: unknown;
    active?: unknown;
  } | null;
  if (
    typeof body?.target_profile_id !== "string"
    || !body.target_profile_id.trim()
    || body.target_profile_id.length > 128
    || (body.active !== undefined && typeof body.active !== "boolean")
  ) {
    return NextResponse.json({ error: "リクエストの形式が正しくありません。" }, { status: 400 });
  }
  try {
    const database = getHubD1();
    const viewer = await requireDesktopHubProfile(request, database);
    await consumeD1PostQuota(database, viewer, "social_follow");
    return NextResponse.json(
      await toggleD1FollowRouteData(database, viewer.id, body.target_profile_id.trim(), body.active as boolean | undefined),
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof HubD1UnavailableError) {
      return NextResponse.json({ error: "unavailable" }, { status: 503 });
    }
    if (error instanceof HubSuspendedError) {
      return NextResponse.json({ error: "suspended" }, { status: 403 });
    }
    if (error instanceof DesktopHubAuthenticationError) {
      return NextResponse.json({ error: "desktop_authentication_failed" }, { status: 401 });
    }
    if (error instanceof HubProfileBlockedError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof HubPostRateLimitError) {
      return NextResponse.json(
        { error: error.message, retry_after: error.retryAfterSeconds },
        { status: 429, headers: { "Retry-After": String(error.retryAfterSeconds) } },
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "フォローできませんでした。" },
      { status: 400 },
    );
  }
}
