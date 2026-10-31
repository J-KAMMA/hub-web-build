import { NextResponse } from "next/server";

import { getHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import {
  DesktopHubAuthenticationError,
  requireDesktopHubProfile,
} from "@/lib/server/desktop-hub-auth";
import {
  HubReactionRateLimitError,
  HubSelfReactionError,
  toggleD1Bookmark,
  toggleD1Reaction,
} from "@/lib/server/d1-engagements";
import { HubProfileBlockedError } from "@/lib/server/profile-blocks";
import { HubSuspendedError } from "@/lib/server/hub-session";

/**
 * クライアント（デスクトップ・モバイル）向けのリアクション口。
 *
 * /api/engagements/* はブラウザのセッションCookieと同一オリジン確認を
 * 前提にする。端末は assertion をBearerで持って来るので、本人確認の強さを
 * 保ったまま別の口を用意する。対象はクライアント画面が描く social_post
 * だけに絞る——この口が広くなると、守りの確認範囲も広がる。
 *
 * { kind: "like" | "bookmark", targetId, active? }
 *   active を省略すると現在の状態を反転する（トグル）。
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    kind?: string;
    targetId?: string;
    active?: boolean;
  } | null;
  if (
    !body ||
    (body.kind !== "like" && body.kind !== "bookmark") ||
    typeof body.targetId !== "string" ||
    !body.targetId
  ) {
    return NextResponse.json(
      { error: "kind (like|bookmark) and targetId are required." },
      { status: 400 },
    );
  }
  try {
    const database = getHubD1();
    const profile = await requireDesktopHubProfile(request, database);
    const active = typeof body.active === "boolean" ? body.active : undefined;
    const summary =
      body.kind === "like"
        ? await toggleD1Reaction(database, {
            targetType: "social_post",
            targetId: body.targetId,
            kind: "like",
            profileId: profile.id,
            profileJoinedAt: profile.joinedAt,
            active,
          })
        : await toggleD1Bookmark(database, {
            targetType: "social_post",
            targetId: body.targetId,
            profileId: profile.id,
            active,
          });
    return NextResponse.json(
      { summary },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof DesktopHubAuthenticationError) {
      return NextResponse.json({ error: "desktop_authentication_failed" }, { status: 401 });
    }
    if (error instanceof HubSuspendedError) {
      return NextResponse.json({ error: "suspended" }, { status: 403 });
    }
    if (error instanceof HubSelfReactionError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof HubProfileBlockedError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof HubReactionRateLimitError) {
      return NextResponse.json(
        { error: error.message, retryAfter: error.retryAfterSeconds },
        { status: 429, headers: { "Retry-After": String(error.retryAfterSeconds) } },
      );
    }
    if (error instanceof HubD1UnavailableError) {
      return NextResponse.json({ error: "unavailable" }, { status: 503 });
    }
    if (error instanceof Error && /target|exist/i.test(error.message)) {
      return NextResponse.json({ error: "対象の投稿が見つかりません" }, { status: 404 });
    }
    throw error;
  }
}
