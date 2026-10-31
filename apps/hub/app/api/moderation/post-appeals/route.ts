import { NextResponse } from "next/server";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getHubD1 } from "@/lib/server/hub-d1";
import { HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";
import { submitSocialPostAppeal } from "@/lib/server/social-post-moderation";

export async function GET(request: Request) {
  try {
    const database = getHubD1();
    const profile = await requireHubSessionProfile(request, database);
    const result = await database.prepare(`SELECT a.id appealId,a.post_id postId,a.message,a.status,
      a.resolution_note resolutionNote,a.created_at createdAt,a.resolved_at resolvedAt,
      substr(p.body,1,280) preview,c.status moderationStatus
      FROM social_post_moderation_appeals a
      JOIN social_posts p ON p.id=a.post_id
      JOIN social_post_moderation_cases c ON c.post_id=a.post_id
      WHERE a.author_profile_id=? ORDER BY a.created_at DESC LIMIT 50`).bind(profile.id).all();
    const eligible = await database.prepare(`SELECT p.id postId,substr(p.body,1,280) preview,c.status moderationStatus,
      c.reason,c.updated_at updatedAt
      FROM social_posts p JOIN social_post_moderation_cases c ON c.post_id=p.id
      WHERE p.author_profile_id=? AND c.status IN ('auto_held','hidden')
      ORDER BY c.updated_at DESC LIMIT 50`).bind(profile.id).all();
    return NextResponse.json({ appeals: result.results, eligiblePosts: eligible.results });
  } catch (error) {
    if (error instanceof HubAuthenticationError) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
    return NextResponse.json({ error: "異議申立てを読み込めませんでした。" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "不正なリクエストです。" }, { status: 403 });
  try {
    const database = getHubD1();
    const profile = await requireHubSessionProfile(request, database);
    const body = await request.json().catch(() => null) as { postId?: unknown; message?: unknown } | null;
    const postId = typeof body?.postId === "string" ? body.postId : "";
    const message = typeof body?.message === "string" ? body.message.trim() : "";
    if (!postId || message.length < 20 || message.length > 2000) {
      return NextResponse.json({ error: "対象のポストと、20〜2000文字の説明を入力してください。" }, { status: 400 });
    }
    const receipt = await submitSocialPostAppeal(database, { postId, authorProfileId: profile.id, message });
    return NextResponse.json({ submitted: true, receipt }, { status: receipt.duplicate ? 200 : 201 });
  } catch (error) {
    if (error instanceof HubAuthenticationError) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
    const message = error instanceof Error ? error.message : "異議申立てを送信できませんでした。";
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
