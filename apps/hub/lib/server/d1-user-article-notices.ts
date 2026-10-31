import type { D1Database } from "@cloudflare/workers-types";

/**
 * 書き手が新しい記事を公開したとき、その書き手をフォローしている人へ知らせる
 * （2026-10-14、所有者決定）。公開の経路（即時・予約）から1回だけ呼ぶ。描画では呼ばない。
 *
 * - 1文の INSERT ... SELECT で一括して作る。1人ずつ読み書きしない（D1は読んだ・書いた行数で課金）。
 * - 同期で通知するのは新しいフォロワーから最大 ARTICLE_NOTICE_FOLLOWER_CAP 人まで。
 *   それを超えるフォロワーには通知を作らない（続きの送信は持たない）。
 *   取りこぼした人も「フォロー中」の流れで読める。上限は意図した仕様。
 * - 受け手の通知設定「新しいフォロワー」（follows）が切れていれば作らない。
 *   ブロック（どちら向きでも）・ミュート（受け手が書き手を）・凍結中の受け手や書き手も除く。
 * - 同じ記事の通知は受け手ごとに1件。編集や再公開で増えない（既にあれば作らない）。
 * - 成人向けの記事は一般の通知に載せない。閲覧条件付きの記事は題名だけを載せる
 *   （要約・本文・画像は通知に入れない）。
 * - タグのフォロワーには通知しない。流れで読む。
 */

export const ARTICLE_NOTICE_FOLLOWER_CAP = 1000;

export type PublishedArticleNotice = {
  id: string;
  authorProfileId: string;
  authorName: string;
  title: string;
  audience: "general" | "adult";
};

export function articleNoticeTarget(articleId: string): string {
  return `/v2/articles/${encodeURIComponent(articleId)}#event=article-published`;
}

function noticeText(authorName: string, title: string): string {
  const name = authorName.normalize("NFKC").trim().slice(0, 40) || "フォロー中の書き手";
  const head = title.normalize("NFKC").replace(/\s+/gu, " ").trim().slice(0, 120);
  return `${name}さんが新しい記事を公開しました：${head}`;
}

/** 作った通知の数を返す。失敗しても公開そのものは失敗にしない（呼ぶ側で握る）。 */
export async function notifyFollowersOfNewArticle(
  database: D1Database,
  article: PublishedArticleNotice,
  now = new Date(),
): Promise<number> {
  if (article.audience !== "general" || !article.authorProfileId) return 0;
  const target = articleNoticeTarget(article.id);
  const text = noticeText(article.authorName, article.title);
  const author = article.authorProfileId;
  const result = await database.prepare(`INSERT INTO notifications
      (id, receiver_profile_id, actor_profile_id, notification_type, notification_context,
       target_type, target_id, text, is_read, created_at)
    SELECT lower(hex(randomblob(16))), f.follower_profile_id, ?, 'system', NULL, 'system', ?, ?, 0, ?
    FROM follows f
    JOIN profiles rp ON rp.id = f.follower_profile_id AND rp.kind = 'local'
    WHERE f.followed_profile_id = ?
      AND f.follower_profile_id <> ?
      AND COALESCE((SELECT np.follows_enabled FROM notification_preferences np WHERE np.profile_id = f.follower_profile_id), 1) = 1
      AND NOT EXISTS (SELECT 1 FROM profile_moderation_status m
        WHERE m.status = 'suspended' AND m.profile_id IN (f.follower_profile_id, ?))
      AND NOT EXISTS (SELECT 1 FROM thread_user_controls c
        WHERE (c.owner_profile_id = f.follower_profile_id AND c.target_profile_id = ? AND (c.blocked = 1 OR c.muted = 1))
           OR (c.owner_profile_id = ? AND c.target_profile_id = f.follower_profile_id AND c.blocked = 1))
      AND NOT EXISTS (SELECT 1 FROM notifications n
        WHERE n.receiver_profile_id = f.follower_profile_id AND n.notification_type = 'system'
          AND n.target_type = 'system' AND n.target_id = ?)
    ORDER BY f.created_at DESC
    LIMIT ${ARTICLE_NOTICE_FOLLOWER_CAP}`)
    .bind(author, target, text, now.toISOString(), author, author, author, author, author, target)
    .run();
  return Number(result.meta.changes ?? 0);
}

/** 公開の経路から呼ぶ入口。通知の失敗で公開を巻き戻さない。ログには記事IDも題名も出さない。 */
export async function notifyFollowersSafely(database: D1Database, article: PublishedArticleNotice, now = new Date()): Promise<void> {
  try {
    await notifyFollowersOfNewArticle(database, article, now);
  } catch {
    console.warn("article follower notice failed");
  }
}
