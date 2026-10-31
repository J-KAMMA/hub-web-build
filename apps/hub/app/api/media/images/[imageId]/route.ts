import { NextResponse } from "next/server";
import type { EngagementTargetType } from "@/lib/domain";
import { getHubD1, getHubMedia } from "@/lib/server/hub-d1";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getOptionalHubSessionProfile, HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";
import { findVisibleD1SocialTarget } from "@/lib/server/social-target-visibility";
import { authorizeGatedMedia } from "@/lib/server/gated-content";
import { updatePendingImageAltText } from "@/lib/server/social-post-images";

export async function GET(request: Request, { params }: { params: Promise<{ imageId: string }> }) {
  const { imageId } = await params;
  const variant = new URL(request.url).searchParams.get("variant") === "full" ? "full" : "thumbnail";
  /*
   * 画像は社交投稿・スレッド返信・コミュニティのメッセージの3種に付く。
   * 以前は social_posts にしか結合せず、後の2種の画像は付いていても404だった
   * （2026-09-02、v2 のコミュニティの欄から送って判明）。3つを外部結合し、
   * どれかに当たること、運営非表示や削除でないことを見る。
   * コミュニティのメッセージは消すと行ごと消え、画像は status='deleted' になる。
   */
  const database = getHubD1();
  const row = await database.prepare(`SELECT i.object_key, i.thumbnail_object_key, i.mime_type, i.post_id,
      CASE
        WHEN p.id IS NOT NULL THEN 'social_post'
        WHEN t.id IS NOT NULL THEN 'thread_post'
        ELSE 'community_message'
      END AS target_type
    FROM social_post_images i
    LEFT JOIN social_posts p ON p.id = i.post_id
    LEFT JOIN thread_posts t ON t.id = i.post_id
    LEFT JOIN community_channel_messages m ON m.id = i.post_id
    WHERE i.id = ? AND i.status = 'published'
      AND i.safety_status = 'clean'
      AND i.metadata_stripped_at IS NOT NULL
      AND i.post_id IS NOT NULL
      AND (p.id IS NOT NULL OR t.id IS NOT NULL OR m.id IS NOT NULL)
      AND p.moderated_at IS NULL
      AND t.moderated_at IS NULL
      AND t.deleted_at IS NULL
    LIMIT 1`)
    .bind(imageId).first<{ object_key: string; thumbnail_object_key: string | null; mime_type: string; post_id: string; target_type: EngagementTargetType }>();
  if (!row) return NextResponse.json({ error: "画像が見つかりません。" }, { status: 404 });

  /*
   * 閲覧者が付け先を見られるかを確かめる（2026-09-03、旦那様の判断で追加）。
   * それまでは**誰でも見られた**。idが当てにくいだけで、限定公開の投稿の画像も、
   * 非公開コミュニティのメッセージの画像も、idを知っていれば誰にでも返していた。
   * 判定は既存の findVisibleD1SocialTarget に任せる（限定公開のフォロー確認、
   * コミュニティの公開範囲・参加・追放・チャンネルの権限まで見る）。
   * 見えないときは 403 ではなく 404。あるかどうかも知らせない。
   */
  const viewer = await getOptionalHubSessionProfile(request, database);
  const visible = await findVisibleD1SocialTarget(database, viewer?.id ?? null, row.target_type, row.post_id);
  if (!visible) return NextResponse.json({ error: "画像が見つかりません。" }, { status: 404 });

  /* Token gates: media of gated content is authorized per request and never cached. */
  const gateAccess = await authorizeGatedMedia(database, viewer?.id ?? null, row.target_type as "social_post" | "thread_post" | "community_message", row.post_id);
  if (gateAccess === "denied") {
    return NextResponse.json({ error: "この画像を表示する権限がありません。" }, { status: 403, headers: { "Cache-Control": "private, no-store" } });
  }

  const key = variant === "full" ? row.object_key : row.thumbnail_object_key;
  if (!key) return NextResponse.json({ error: "画像が見つかりません。" }, { status: 404 });
  const object = await getHubMedia().get(key);
  if (!object) return NextResponse.json({ error: "画像が見つかりません。" }, { status: 404 });
  /*
   * 残させない（2026-09-03）。一度は公開の投稿だけ public な札にしたが、
   * lib/social-post-action-safety.test.ts が「消した投稿の画像は配らない・残さない」を
   * 契約として書いていた。札を付けると、消した後も期限のぶん出続ける。
   * 取り下げが即時に効くことを、配りの安さより上に置く。
   */
  return new Response(await object.arrayBuffer(), { headers: { "Content-Type": row.mime_type, "Content-Length": String(object.size),
    "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox" } });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ imageId: string }> }) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "許可されていない操作です。" }, { status: 403 });
  try {
    const database = getHubD1();
    const profile = await requireHubSessionProfile(request, database);
    const { imageId } = await params;
    const body = await request.json().catch(() => null) as { altText?: unknown } | null;
    if (typeof body?.altText !== "string" || body.altText.length > 300) {
      return NextResponse.json({ error: "画像の説明は300文字以内で入力してください。" }, { status: 400 });
    }
    const updated = await updatePendingImageAltText(database, profile.id, imageId, body.altText);
    if (!updated) return NextResponse.json({ error: "編集できる画像が見つかりません。" }, { status: 404 });
    return NextResponse.json({ image: { id: imageId, altText: body.altText.trim() } });
  } catch (error) {
    if (error instanceof HubAuthenticationError) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
    throw error;
  }
}
