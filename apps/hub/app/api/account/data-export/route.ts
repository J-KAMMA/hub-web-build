import { NextResponse } from "next/server";

import { readOwnSocialExport } from "@/lib/server/account-export-social";
import { readOwnWorksExport } from "@/lib/server/account-export-works";
import { readOwnGateUnlocksExport } from "@/lib/server/gate-unlock-library";
import { readOwnNavOrderExport } from "@/lib/server/v2-nav-registered";
import { listConsentRecords } from "@/lib/server/hub-consent-records";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";
import { publicImageUrl } from "@/lib/server/social-post-images";

/*
 * 自分のデータの書き出し。
 *
 * **これは出口である**。Personal Node の値打ちは日々使われることではなく、
 * 持ち出して自分の機械で動かせると分かっていることにある（2026-09-03、旦那様との話）。
 * 出口が痩せていると、預けたままでいる理由も痩せる。
 *
 * 2026-10-14 に足したもの: 記事の下書き（articleDrafts）と公開後の編集履歴（articleRevisions）。
 *   下書きはHubのD1にあるので、削除要求のときも書き出しのときも対象に入る。
 *
 * 2026-09-03 に足したもの: 書いた記事、上げた画像。
 * それまでは 投稿・スレッドの返信・フォロー・保存・投げ銭 の5つだけで、
 * 記事（長文）と画像（写真）が出てこなかった。手元に残らないまま消せてしまう。
 *
 * 2026-10-17 に足したもの（AUDIT.md 8.3-2）: DM・いいね・リスト・ミュートの語・通知と通知の設定・
 *   コミュニティの所属・記事へのコメント・ウォレットの連携・ブロックとミュート・連合のフォロー
 *   （account-export-social.ts）。DM は本人が送受信した範囲で、相手は表示名だけで示す。
 *   これは本人のダウンロードで、引っ越しの束（hub.account.bundle）とは別。束には DM もウォレットも入れない。
 *   問い合わせが1つでも失敗したら書き出し全体を失敗にする。黙って空の欄を返さない。
 *
 * まだ入れていないもの:
 *   - コミュニティの発言 … 非公開の場の他人の発言が混ざる
 * 画像は鍵ではなくURLで出す。持ち出した先から引ける形にするため。
 */
/* 下書き・編集履歴のタグ列（JSON文字列）を配列にして書き出す。壊れていれば空。 */
function withTags<T extends { tags_json: string }>(row: T) {
  const { tags_json: tagsJson, ...rest } = row;
  let tags: string[] = [];
  try {
    const parsed = JSON.parse(tagsJson ?? "[]") as unknown;
    if (Array.isArray(parsed)) tags = parsed.filter((tag): tag is string => typeof tag === "string");
  } catch {
    /* 壊れていれば空。書き出しは止めない */
  }
  return { ...rest, tags };
}

/*
 * 記事（下書き・公開後の版を含む）に付いた画像は /api/articles/images/ から返る。/api/media/images/ は
 * 投稿・スレッド・コミュニティの画像用で、記事の画像は404になる。付け先で道を選ぶ。
 */
function articleImageUrl(id: string, variant: "full" | "thumbnail") {
  const base = `/api/articles/images/${encodeURIComponent(id)}`;
  return variant === "full" ? base : `${base}?variant=${variant}`;
}

export async function GET(request: Request) {
  const database = getOptionalHubD1();
  if (!database) return NextResponse.json({ error: "DB unavailable" }, { status: 503 });
  try {
    const profile = await requireHubSessionProfile(request, database);
    const [posts, threads, follows, bookmarks, tips, articles, images, articleDrafts, articleRevisions, seriesRows, seriesItems, tagFollows, magazineRows, magazineItems] = await Promise.all([
      database.prepare("SELECT id,body,created_at FROM social_posts WHERE author_profile_id=? ORDER BY created_at").bind(profile.id).all(),
      database.prepare("SELECT id,thread_id,body,created_at FROM thread_posts WHERE author_profile_id=? ORDER BY created_at").bind(profile.id).all(),
      database.prepare("SELECT followed_profile_id,created_at FROM follows WHERE follower_profile_id=?").bind(profile.id).all(),
      database.prepare("SELECT target_type,target_id,note,created_at FROM bookmarks WHERE profile_id=?").bind(profile.id).all(),
      database.prepare("SELECT tx_hash,chain_id,network,asset_symbol,amount_wei,sender_profile_id,recipient_profile_id,confirmed_at FROM wallet_tip_transactions WHERE sender_profile_id=? OR recipient_profile_id=?").bind(profile.id, profile.id).all(),
      database.prepare("SELECT id,title,summary,body,tags_json,thumbnail_url,audience,created_at,updated_at FROM hub_user_articles WHERE author_profile_id=? AND moderated_at IS NULL ORDER BY created_at").bind(profile.id).all<{ id: string; tags_json: string }>(),
      database.prepare("SELECT id,post_id,mime_type,width,height,alt_text,content_hash,created_at FROM social_post_images WHERE owner_profile_id=? AND status='published' ORDER BY created_at").bind(profile.id).all<{ id: string; post_id: string | null }>(),
      database.prepare("SELECT id,title,summary,body,tags_json,thumbnail_url,cover_image_id,audience,publish_at,status,created_at,updated_at FROM hub_user_article_drafts WHERE author_profile_id=? ORDER BY created_at").bind(profile.id).all<{ id: string; tags_json: string }>(),
      database.prepare("SELECT article_id,revision,reason,title,summary,body,tags_json,thumbnail_url,audience,status,created_at FROM hub_user_article_revisions WHERE author_profile_id=? ORDER BY article_id,revision").bind(profile.id).all<{ article_id: string; tags_json: string }>(),
      /* シリーズ（2026-10-14）。所有者のIDは書き出さない。 */
      database.prepare("SELECT id,title,description,created_at,updated_at FROM hub_user_article_series WHERE owner_profile_id=? ORDER BY created_at").bind(profile.id).all<{ id: string }>(),
      database.prepare("SELECT i.series_id,i.article_id,i.position FROM hub_user_article_series_items i JOIN hub_user_article_series s ON s.id=i.series_id WHERE s.owner_profile_id=? ORDER BY i.series_id,i.position").bind(profile.id).all<{ series_id: string; article_id: string; position: number }>(),
      /* フォロー中の記事タグ（2026-10-14）。 */
      database.prepare("SELECT tag,created_at FROM hub_article_tag_follows WHERE profile_id=? ORDER BY created_at,tag").bind(profile.id).all<{ tag: string; created_at: string }>(),
      /* マガジン（2026-10-14）。記事は id だけ（他人の記事の中身と書き手のIDは含めない）。所有者のIDも書き出さない。 */
      database.prepare("SELECT id,title,description,created_at,updated_at FROM hub_user_article_magazines WHERE owner_profile_id=? ORDER BY created_at").bind(profile.id).all<{ id: string }>(),
      database.prepare("SELECT i.magazine_id,i.article_id,i.position FROM hub_user_article_magazine_items i JOIN hub_user_article_magazines m ON m.id=i.magazine_id WHERE m.owner_profile_id=? ORDER BY i.magazine_id,i.position").bind(profile.id).all<{ magazine_id: string; article_id: string; position: number }>(),
    ]);
    /* 登録時に同意した規約・ポリシーの版と日時（2026-10-14）。既存の利用者では空。 */
    const [consentRecords, works, social, gateUnlocks, navOrder] = await Promise.all([
      listConsentRecords(database, profile.id),
      readOwnWorksExport(database, profile.id),
      readOwnSocialExport(database, profile.id),
      /* 入手した作品（2026-10-26）。本人の行だけ。ゲートID・ウォレット・残高は元から持たない。 */
      readOwnGateUnlocksExport(database, profile.id),
      readOwnNavOrderExport(database, profile.id),
    ]);
    const articleIds = new Set<string>([
      ...(articles.results ?? []).map((row) => row.id),
      ...(articleDrafts.results ?? []).map((row) => row.id),
      ...(articleRevisions.results ?? []).map((row) => row.article_id),
    ]);
    return NextResponse.json({
      exportedAt: new Date().toISOString(),
      profile: { handle: profile.handle, displayName: profile.displayName, bio: profile.bio, joinedAt: profile.joinedAt },
      consentRecords,
      ...works,
      ...social,
      gateUnlocks,
      navOrder,
      posts: posts.results,
      threadPosts: threads.results,
      follows: follows.results,
      articleTagFollows: tagFollows.results ?? [],
      bookmarks: bookmarks.results,
      tips: tips.results,
      articles: (articles.results ?? []).map((row) => {
        const { tags_json: tagsJson, ...rest } = row;
        let tags: string[] = [];
        try {
          const parsed = JSON.parse(tagsJson ?? "[]") as unknown;
          if (Array.isArray(parsed)) tags = parsed.filter((tag): tag is string => typeof tag === "string");
        } catch {
          /* 壊れていれば空。書き出しは止めない */
        }
        return { ...rest, tags };
      }),
      articleDrafts: (articleDrafts.results ?? []).map(withTags),
      articleRevisions: (articleRevisions.results ?? []).map(withTags),
      articleSeries: (seriesRows.results ?? []).map((row) => ({
        ...row,
        articleIds: (seriesItems.results ?? []).filter((item) => item.series_id === row.id).map((item) => item.article_id),
      })),
      articleMagazines: (magazineRows.results ?? []).map((row) => ({
        ...row,
        articleIds: (magazineItems.results ?? []).filter((item) => item.magazine_id === row.id).map((item) => item.article_id),
      })),
      images: (images.results ?? []).map((row) => {
        const forArticle = row.post_id !== null && articleIds.has(row.post_id);
        return {
          ...row,
          url: forArticle ? articleImageUrl(row.id, "full") : publicImageUrl(row.id, "full"),
          thumbnailUrl: forArticle ? articleImageUrl(row.id, "thumbnail") : publicImageUrl(row.id, "thumbnail"),
        };
      }),
    }, {
      headers: {
        "Content-Disposition": `attachment; filename="hub-${profile.handle}-export.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof HubAuthenticationError) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
    throw error;
  }
}
