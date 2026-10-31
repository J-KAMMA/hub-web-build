import type { D1Database } from "@cloudflare/workers-types";

/*
 * 書き手向けの日別の合計（レーンF）。閲覧数といいね数だけ。
 * - 書く側は1行の UPSERT（記事 × 日本時間の日付）。描画のたびの集計はしない。
 * - 閲覧者のID・IP・UA・流入元は持たない。見られるのは書き手本人だけ。
 */

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
export const STATS_DAYS = 30;

/** 日本時間の日付（YYYY-MM-DD）。 */
export function jstDay(date: Date): string {
  return new Date(date.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/* 明らかな巡回プログラムだけ除く。大きな判定は作らない。 */
const CRAWLER_UA = /bot|crawl|spider|slurp|facebookexternalhit|preview|headless|curl\/|wget\/|python-requests|node-fetch|undici/i;
export function isCrawlerUserAgent(userAgent: string | null | undefined): boolean {
  if (!userAgent) return true;
  return CRAWLER_UA.test(userAgent);
}

/** 公開中・一般区分・運営が隠していない記事の書き手。見つからなければ null。 */
async function countableArticleAuthor(database: D1Database, articleId: string): Promise<string | null> {
  const row = await database.prepare(`SELECT author_profile_id FROM hub_user_articles
      WHERE id = ? AND status = 'published' AND audience = 'general' AND moderated_at IS NULL`)
    .bind(articleId).first<{ author_profile_id: string }>();
  return row?.author_profile_id ?? null;
}

async function bump(database: D1Database, articleId: string, column: "views" | "likes", now: Date) {
  await database.prepare(`INSERT INTO hub_user_article_daily_stats (article_id, day, ${column})
      VALUES (?, ?, 1)
      ON CONFLICT(article_id, day) DO UPDATE SET ${column} = ${column} + 1`)
    .bind(articleId, jstDay(now)).run();
}

/** 閲覧を1つ数える。書き手本人・巡回プログラム・存在しない記事は数えない。数えたら true。 */
export async function recordArticleView(
  database: D1Database,
  articleId: string,
  viewerProfileId: string | null,
  userAgent: string | null,
  now = new Date(),
): Promise<boolean> {
  if (isCrawlerUserAgent(userAgent)) return false;
  const author = await countableArticleAuthor(database, articleId);
  if (!author || (viewerProfileId && viewerProfileId === author)) return false;
  await bump(database, articleId, "views", now);
  return true;
}

/** いいねを1つ数える（外した分は引かない）。統計の失敗でいいねを失敗させない。 */
export async function recordArticleLike(database: D1Database, articleId: string, now = new Date()): Promise<void> {
  try { await bump(database, articleId, "likes", now); } catch { /* 統計の表が無い環境では何もしない */ }
}

export type ArticleStatsDay = { day: string; views: number; likes: number };
export type ArticleStatsRow = {
  articleId: string;
  title: string;
  views: number;
  likes: number;
  days: ArticleStatsDay[];
};

/** 日付の並び（古い順、今日を含む STATS_DAYS 日）。 */
export function statsDayRange(now: Date, days = STATS_DAYS): string[] {
  return Array.from({ length: days }, (_, index) => jstDay(new Date(now.getTime() - (days - 1 - index) * DAY_MS)));
}

/** 書き手本人の公開中の記事ごとの直近30日。行数は「記事数 × 30」以下。 */
export async function loadAuthorArticleStats(
  database: D1Database,
  authorProfileId: string,
  now = new Date(),
): Promise<ArticleStatsRow[]> {
  const range = statsDayRange(now);
  const articles = await database.prepare(`SELECT id, title FROM hub_user_articles
      WHERE author_profile_id = ? AND status = 'published' AND moderated_at IS NULL
      ORDER BY created_at DESC, id DESC LIMIT 100`)
    .bind(authorProfileId).all<{ id: string; title: string }>();
  const rows = articles.results ?? [];
  if (rows.length === 0) return [];
  const stats = await database.prepare(`SELECT s.article_id, s.day, s.views, s.likes
      FROM hub_user_articles a JOIN hub_user_article_daily_stats s ON s.article_id = a.id
      WHERE a.author_profile_id = ? AND a.status = 'published' AND a.moderated_at IS NULL AND s.day >= ?`)
    .bind(authorProfileId, range[0]).all<{ article_id: string; day: string; views: number; likes: number }>();
  const byArticle = new Map<string, Map<string, { views: number; likes: number }>>();
  for (const row of stats.results ?? []) {
    const days = byArticle.get(row.article_id) ?? new Map();
    days.set(row.day, { views: Number(row.views), likes: Number(row.likes) });
    byArticle.set(row.article_id, days);
  }
  return rows.map((article) => {
    const days = range.map((day) => ({ day, views: byArticle.get(article.id)?.get(day)?.views ?? 0, likes: byArticle.get(article.id)?.get(day)?.likes ?? 0 }));
    return {
      articleId: article.id,
      title: article.title,
      views: days.reduce((sum, d) => sum + d.views, 0),
      likes: days.reduce((sum, d) => sum + d.likes, 0),
      days,
    };
  });
}
