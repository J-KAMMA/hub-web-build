import { NextResponse } from "next/server";

import { getHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import {
  DesktopHubAuthenticationError,
  requireDesktopHubProfile,
} from "@/lib/server/desktop-hub-auth";
import { sendFlagForRemotePost } from "@/lib/server/federation-flag";
import { reportSocialPost } from "@/lib/server/social-post-moderation";
import { reportD1Profile } from "@/lib/server/profile-public-details";

const POST_REASONS = new Set([
  "image_safety", "sexual", "violence", "copyright", "privacy", "harassment", "spam", "other",
]);
const PROFILE_REASONS = new Set([
  "harassment", "spam", "impersonation", "privacy", "other",
]);

/**
 * クライアント（デスクトップ・モバイル）専用の通報口。
 *
 * /api/social/posts/[id]/report と /api/profile/safety POST は
 * セッションCookie＋同一オリジン前提。端末は assertion をBearerで
 * 持って来るので別口にする。判定・記録・自動保留の閾値は呼ぶ関数が
 * 共通なので、どちら側から来ても同じ扱いになる。
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    targetType?: string;
    targetId?: string;
    reason?: string;
    details?: string;
    sendToOrigin?: boolean;
  } | null;
  const targetType = body?.targetType;
  const targetId = typeof body?.targetId === "string" ? body.targetId.trim() : "";
  const reason = typeof body?.reason === "string" ? body.reason : "";
  const details = typeof body?.details === "string" ? body.details.trim().slice(0, 500) : "";
  if (!targetId || targetId.length > 100) {
    return NextResponse.json({ error: "対象の指定が正しくありません。" }, { status: 400 });
  }
  try {
    const database = getHubD1();
    const viewer = await requireDesktopHubProfile(request, database);
    if (targetType === "social_post") {
      if (!POST_REASONS.has(reason)) {
        return NextResponse.json({ error: "通報理由を確認してください。" }, { status: 400 });
      }
      const post = await database
        .prepare("SELECT author_profile_id FROM social_posts WHERE id = ? LIMIT 1")
        .bind(targetId)
        .first<{ author_profile_id: string | null }>();
      if (!post) {
        return NextResponse.json({ error: "ポストが見つかりません。" }, { status: 404 });
      }
      if (post.author_profile_id === viewer.id) {
        return NextResponse.json({ error: "自分のポストは通報できません。" }, { status: 400 });
      }
      const receipt = await reportSocialPost(database, {
        postId: targetId, reporterProfileId: viewer.id, reason, details,
      });
      // 外部のハブの投稿は、利用者が明示的に選んだときだけ、元のハブにも通報を送る（既定は送らない）。
      const forwarded = body?.sendToOrigin === true && !receipt.duplicate
        ? await sendFlagForRemotePost(database, { postId: targetId, reason })
        : false;
      return NextResponse.json(
        { reported: true, receipt, forwarded },
        { status: receipt.duplicate ? 200 : 201, headers: { "cache-control": "no-store" } },
      );
    }
    if (targetType === "profile") {
      if (!PROFILE_REASONS.has(reason)) {
        return NextResponse.json({ error: "通報理由を確認してください。" }, { status: 400 });
      }
      await reportD1Profile(database, viewer.id, targetId, reason, details);
      return NextResponse.json({ reported: true }, { headers: { "cache-control": "no-store" } });
    }
    return NextResponse.json({ error: "対象の種類が正しくありません。" }, { status: 400 });
  } catch (error) {
    if (error instanceof DesktopHubAuthenticationError) {
      return NextResponse.json({ error: "desktop_authentication_failed" }, { status: 401 });
    }
    if (error instanceof HubD1UnavailableError) throw error;
    if (error instanceof Error && error.message.includes("report_rate_limit")) {
      return NextResponse.json(
        { error: "通報回数の上限に達しました。1時間後にもう一度お試しください。" },
        { status: 429, headers: { "Retry-After": "3600" } },
      );
    }
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
