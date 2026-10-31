import type { D1Database } from "@cloudflare/workers-types";

/*
 * 誰でも見られる実績の数（2026-09-04、旦那様「ハブ全体の構想から分析して足りないものを作る」）。
 *
 * 構想（docs/HUB_SYSTEM_MAP.md 第9章）では Hub Trust は「Hub自身の公開活動と、各所有
 * サービスが発行した事実証明を文脈別に表示する層」。既に lib/hub-trust.ts に形はあるが、
 * 数を作るのは lib/creator-hub-trust.ts だけで、それは Creator Center（本人の管理画面）
 * 専用だった。**他人のプロフィールには文脈別実績が無かった。**
 *
 * ここが Creator Center の集計を流用できない理由:
 * getD1CreatorActivitySummary は本人の画面なので、非公開の投稿・未公開のコミュニティ・
 * 下書きの Listings まで数える。それを他人に見せると、非公開の物の**件数**が漏れる。
 * だから公開の行だけを数える問いを別に持つ。述語は各画面が公開判定に使っている物と同じ:
 *   投稿       audience='public' かつ moderated_at IS NULL
 *   スレッド    moderation_status='visible'（無ければ全件ではなく0にする）
 *   記事       status='published' かつ moderated_at IS NULL
 *   仕事       work_listings.status='published'
 *   掲載       public_listings.status='published'
 *   コミュニティ visibility='public' かつ lifecycle_status='active'
 *   投げ銭     公開・確認済み・有効・受け取り有効の連携が1つ以上
 *
 * 表は移行の当たり具合で無いことがある（ローカルでは profile_wallet_links が無い日が
 * あった）。1つ落ちても画面全体を落とさない。落ちた文脈は「実績なし」ではなく
 * 「確認できていない」として上の層で扱う。
 */

export type PublicTrustCounts = {
  publicPosts: number | null;
  publicThreads: number | null;
  publicArticles: number | null;
  publishedWorkListings: number | null;
  publishedPublicListings: number | null;
  publicCommunities: number | null;
  tipsEnabled: boolean | null;
};

async function count(database: D1Database, sql: string, profileId: string): Promise<number | null> {
  try {
    const row = await database.prepare(sql).bind(profileId).first<{ total: number | null }>();
    return Math.max(0, Number(row?.total ?? 0));
  } catch {
    /* その表がまだ無い、または列が違う。数えられないことと0件は別に扱う。 */
    return null;
  }
}

export async function getD1PublicTrustCounts(
  database: D1Database,
  profileId: string,
): Promise<PublicTrustCounts> {
  const [
    publicPosts,
    publicThreads,
    publicArticles,
    publishedWorkListings,
    publishedPublicListings,
    publicCommunities,
    tips,
  ] = await Promise.all([
    count(database, `SELECT COUNT(*) AS total FROM social_posts
      WHERE author_profile_id = ?1 AND audience = 'public' AND moderated_at IS NULL AND reply_to_post_id IS NULL`, profileId),
    count(database, `SELECT COUNT(*) AS total FROM threads
      WHERE created_by_profile_id = ?1 AND moderation_status = 'visible'`, profileId),
    count(database, `SELECT COUNT(*) AS total FROM hub_user_articles
      WHERE author_profile_id = ?1 AND status = 'published' AND moderated_at IS NULL`, profileId),
    count(database, `SELECT COUNT(*) AS total FROM work_listings
      WHERE owner_profile_id = ?1 AND status = 'published'`, profileId),
    count(database, `SELECT COUNT(*) AS total FROM public_listings
      WHERE owner_profile_id = ?1 AND status = 'published'`, profileId),
    count(database, `SELECT COUNT(*) AS total FROM communities
      WHERE owner_profile_id = ?1 AND visibility = 'public' AND lifecycle_status = 'active'`, profileId),
    count(database, `SELECT COUNT(*) AS total FROM profile_wallet_links
      WHERE profile_id = ?1 AND visibility = 'public' AND verified_at IS NOT NULL AND active = 1 AND tips_enabled = 1`, profileId),
  ]);

  return {
    publicPosts,
    publicThreads,
    publicArticles,
    publishedWorkListings,
    publishedPublicListings,
    publicCommunities,
    /* 受け取れるかどうかだけ。**金額も件数も出さない**（構想: 明細は初期状態で非公開）。 */
    tipsEnabled: tips === null ? null : tips > 0,
  };
}
