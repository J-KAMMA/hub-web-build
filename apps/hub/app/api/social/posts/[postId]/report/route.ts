import { NextResponse } from "next/server";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getHubD1 } from "@/lib/server/hub-d1";
import { HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";
import { sendFlagForRemotePost } from "@/lib/server/federation-flag";
import { reportSocialPost } from "@/lib/server/social-post-moderation";

const REASONS = new Set(["image_safety", "sexual", "violence", "copyright", "privacy", "harassment", "spam", "other"]);

export async function POST(request: Request, { params }: { params: Promise<{ postId: string }> }) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "不正なリクエストです。" }, { status: 403 });
  try {
    const database = getHubD1();
    const viewer = await requireHubSessionProfile(request, database);
    const { postId } = await params;
    const body = await request.json().catch(() => null) as { reason?: unknown; details?: unknown; sendToOrigin?: unknown } | null;
    const reason = typeof body?.reason === "string" ? body.reason : "";
    const details = typeof body?.details === "string" ? body.details.trim().slice(0, 500) : "";
    if (!REASONS.has(reason)) return NextResponse.json({ error: "通報理由を確認してください。" }, { status: 400 });
    const post = await database.prepare("SELECT author_profile_id FROM social_posts WHERE id = ? LIMIT 1").bind(postId).first<{ author_profile_id: string | null }>();
    if (!post) return NextResponse.json({ error: "ポストが見つかりません。" }, { status: 404 });
    if (post.author_profile_id === viewer.id) return NextResponse.json({ error: "自分のポストは通報できません。" }, { status: 400 });
    const receipt = await reportSocialPost(database, {
      postId, reporterProfileId: viewer.id, reason, details,
    });
    // 外部のハブの投稿は、利用者が明示的に選んだときだけ、元のハブにも通報を送る（既定は送らない）。
    const forwarded = body?.sendToOrigin === true && !receipt.duplicate
      ? await sendFlagForRemotePost(database, { postId, reason })
      : false;
    return NextResponse.json({ reported: true, receipt, forwarded }, { status: receipt.duplicate ? 200 : 201 });
  } catch (error) {
    if (error instanceof HubAuthenticationError) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
    if (error instanceof Error && error.message.includes("report_rate_limit")) {
      return NextResponse.json(
        { error: "通報回数の上限に達しました。1時間後にもう一度お試しください。" },
        { status: 429, headers: { "Retry-After": "3600" } },
      );
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "通報できませんでした。" }, { status: 400 });
  }
}
