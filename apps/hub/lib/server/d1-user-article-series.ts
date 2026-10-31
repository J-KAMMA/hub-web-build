import type { D1Database } from "@cloudflare/workers-types";

import { UserArticleLimitError, UserArticleNotFoundError, isArticleIdentifier } from "@/lib/server/d1-user-article-drafts";
import { UserArticleValidationError } from "@/lib/server/d1-user-articles";

/**
 * 利用者記事のシリーズ。著者1人が、自分の公開記事だけを順番に束ねる。
 * 他人の記事は入れられない（マガジン型は作らない）。記事は高々1つのシリーズに入る。
 *
 * 書き込みはすべて owner_profile_id で絞る。他人のシリーズは「見つからない」として扱い、
 * 存在を教えない。公開側は一般区分・公開中・未モデレーションの記事だけを返す。
 * 返すのは題・id・日付だけで、本文と要約は読まない。条件付きの記事も題だけが並ぶ
 * （記事一覧が題を出すのと同じ。本文は記事の画面側で条件を満たした人にだけ開く）。
 */

export const SERIES_LIMIT_PER_OWNER = 50;
export const SERIES_ITEM_LIMIT = 100;
const TITLE_MAX = 100;
const DESCRIPTION_MAX = 400;

export type SeriesInput = { title: string; description: string };

export type SeriesSummary = {
  id: string;
  title: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  /** 公開中で一般区分の記事数。 */
  articleCount: number;
};

export type SeriesArticle = { id: string; title: string; createdAt: string };

export type PublicSeries = {
  id: string;
  title: string;
  description: string;
  ownerProfileId: string;
  ownerName: string;
  ownerHandle: string | null;
  createdAt: string;
  updatedAt: string;
  articles: SeriesArticle[];
};

export type OwnSeriesDetail = {
  id: string;
  title: string;
  description: string;
  /** 並び順どおり。取り下げ中の記事も含める（著者が整理できるように）。 */
  articles: Array<SeriesArticle & { status: string; audience: string }>;
};

export type ArticleSeriesContext = {
  id: string;
  title: string;
  position: number;
  total: number;
  previous: SeriesArticle | null;
  next: SeriesArticle | null;
};

function characters(value: string): number {
  return Array.from(value).length;
}

export function parseSeriesInput(value: unknown): SeriesInput {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const title = typeof record.title === "string" ? record.title.normalize("NFKC").trim() : "";
  const description = typeof record.description === "string" ? record.description.trim() : "";
  if (characters(title) < 1) throw new UserArticleValidationError("シリーズの題を入力してください。");
  if (characters(title) > TITLE_MAX) throw new UserArticleValidationError(`シリーズの題は${TITLE_MAX}文字までです。`);
  if (characters(description) > DESCRIPTION_MAX) throw new UserArticleValidationError(`シリーズの説明は${DESCRIPTION_MAX}文字までです。`);
  return { title, description };
}

export function isSeriesIdentifier(value: unknown): value is string {
  return isArticleIdentifier(value);
}

const VISIBLE = "a.status = 'published' AND a.audience = 'general' AND a.moderated_at IS NULL";

async function requireOwnSeries(database: D1Database, ownerId: string, seriesId: string): Promise<void> {
  if (!isSeriesIdentifier(seriesId)) throw new UserArticleNotFoundError();
  const row = await database.prepare("SELECT 1 AS ok FROM hub_user_article_series WHERE id = ? AND owner_profile_id = ?")
    .bind(seriesId, ownerId).first();
  if (!row) throw new UserArticleNotFoundError();
}

export async function createSeries(database: D1Database, ownerId: string, input: SeriesInput, now = new Date()): Promise<SeriesSummary> {
  const count = await database.prepare("SELECT COUNT(*) AS n FROM hub_user_article_series WHERE owner_profile_id = ?")
    .bind(ownerId).first<{ n: number }>();
  if (Number(count?.n ?? 0) >= SERIES_LIMIT_PER_OWNER) {
    throw new UserArticleLimitError(`シリーズは${SERIES_LIMIT_PER_OWNER}本までです。`);
  }
  const id = crypto.randomUUID();
  const timestamp = now.toISOString();
  await database.prepare(`INSERT INTO hub_user_article_series (id, owner_profile_id, title, description, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(id, ownerId, input.title, input.description, timestamp, timestamp).run();
  return { id, title: input.title, description: input.description, createdAt: timestamp, updatedAt: timestamp, articleCount: 0 };
}

export async function updateSeries(database: D1Database, ownerId: string, seriesId: string, input: SeriesInput, now = new Date()): Promise<void> {
  await requireOwnSeries(database, ownerId, seriesId);
  await database.prepare("UPDATE hub_user_article_series SET title = ?, description = ?, updated_at = ? WHERE id = ? AND owner_profile_id = ?")
    .bind(input.title, input.description, now.toISOString(), seriesId, ownerId).run();
}

/** シリーズを消す。記事は消えない（束ねが解けるだけ）。 */
export async function deleteSeries(database: D1Database, ownerId: string, seriesId: string): Promise<boolean> {
  if (!isSeriesIdentifier(seriesId)) return false;
  const result = await database.prepare("DELETE FROM hub_user_article_series WHERE id = ? AND owner_profile_id = ?")
    .bind(seriesId, ownerId).run();
  return Number((result as { meta?: { changes?: number } }).meta?.changes ?? 0) > 0;
}

/** 自分のシリーズ一覧。公開中の記事数つき。 */
export async function listOwnSeries(database: D1Database, ownerId: string): Promise<SeriesSummary[]> {
  const result = await database.prepare(`SELECT s.id, s.title, s.description, s.created_at, s.updated_at,
      (SELECT COUNT(*) FROM hub_user_article_series_items i JOIN hub_user_articles a ON a.id = i.article_id
        WHERE i.series_id = s.id AND ${VISIBLE}) AS article_count
    FROM hub_user_article_series s WHERE s.owner_profile_id = ?
    ORDER BY s.created_at DESC, s.id DESC LIMIT ${SERIES_LIMIT_PER_OWNER}`)
    .bind(ownerId)
    .all<{ id: string; title: string; description: string; created_at: string; updated_at: string; article_count: number }>();
  return (result.results ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    articleCount: Number(row.article_count ?? 0),
  }));
}

/** 著者向けの詳細。取り下げ中の記事も並びに含める。 */
export async function getOwnSeries(database: D1Database, ownerId: string, seriesId: string): Promise<OwnSeriesDetail | null> {
  if (!isSeriesIdentifier(seriesId)) return null;
  const series = await database.prepare("SELECT id, title, description FROM hub_user_article_series WHERE id = ? AND owner_profile_id = ?")
    .bind(seriesId, ownerId).first<{ id: string; title: string; description: string }>();
  if (!series) return null;
  const items = await database.prepare(`SELECT a.id, a.title, a.created_at, a.status, a.audience
      FROM hub_user_article_series_items i JOIN hub_user_articles a ON a.id = i.article_id
      WHERE i.series_id = ? ORDER BY i.position ASC, i.article_id ASC LIMIT ${SERIES_ITEM_LIMIT}`)
    .bind(seriesId).all<{ id: string; title: string; created_at: string; status: string; audience: string }>();
  return {
    id: series.id,
    title: series.title,
    description: series.description,
    articles: (items.results ?? []).map((row) => ({ id: row.id, title: row.title, createdAt: row.created_at, status: row.status, audience: row.audience })),
  };
}

/** 自分の公開記事のうち、まだどのシリーズにも入っていないもの（追加の候補）。 */
export async function listAddableArticles(database: D1Database, ownerId: string, limit = 100): Promise<SeriesArticle[]> {
  const result = await database.prepare(`SELECT a.id, a.title, a.created_at FROM hub_user_articles a
      WHERE a.author_profile_id = ? AND ${VISIBLE}
        AND NOT EXISTS (SELECT 1 FROM hub_user_article_series_items i WHERE i.article_id = a.id)
      ORDER BY a.created_at DESC, a.id DESC LIMIT ?`)
    .bind(ownerId, Math.min(Math.max(limit, 1), 200))
    .all<{ id: string; title: string; created_at: string }>();
  return (result.results ?? []).map((row) => ({ id: row.id, title: row.title, createdAt: row.created_at }));
}

/** 自分の公開記事をシリーズの末尾へ足す。他人の記事・未公開の記事・別シリーズの記事は足せない。 */
export async function addArticleToSeries(
  database: D1Database,
  ownerId: string,
  seriesId: string,
  articleId: string,
  now = new Date(),
): Promise<void> {
  await requireOwnSeries(database, ownerId, seriesId);
  if (!isArticleIdentifier(articleId)) throw new UserArticleNotFoundError();
  const article = await database.prepare(`SELECT a.id FROM hub_user_articles a
      WHERE a.id = ? AND a.author_profile_id = ? AND a.status = 'published' AND a.moderated_at IS NULL`)
    .bind(articleId, ownerId).first();
  if (!article) throw new UserArticleNotFoundError();
  const existing = await database.prepare("SELECT series_id FROM hub_user_article_series_items WHERE article_id = ?")
    .bind(articleId).first<{ series_id: string }>();
  if (existing) {
    if (existing.series_id === seriesId) return;
    throw new UserArticleLimitError("この記事はすでに別のシリーズに入っています。先にそちらから外してください。");
  }
  const stats = await database.prepare("SELECT COUNT(*) AS n, COALESCE(MAX(position), -1) AS top FROM hub_user_article_series_items WHERE series_id = ?")
    .bind(seriesId).first<{ n: number; top: number }>();
  if (Number(stats?.n ?? 0) >= SERIES_ITEM_LIMIT) throw new UserArticleLimitError(`1つのシリーズに入れられる記事は${SERIES_ITEM_LIMIT}本までです。`);
  const timestamp = now.toISOString();
  // article_id が主キーなので、同時に別のシリーズへ入れようとした側は制約で落ちる。
  try {
    await database.prepare("INSERT INTO hub_user_article_series_items (article_id, series_id, position, added_at) VALUES (?, ?, ?, ?)")
      .bind(articleId, seriesId, Number(stats?.top ?? -1) + 1, timestamp).run();
  } catch (error) {
    if (error instanceof Error && /UNIQUE|constraint/i.test(error.message)) {
      throw new UserArticleLimitError("この記事はすでに別のシリーズに入っています。先にそちらから外してください。");
    }
    throw error;
  }
  await database.prepare("UPDATE hub_user_article_series SET updated_at = ? WHERE id = ?").bind(timestamp, seriesId).run();
}

/** 記事をシリーズから外す。残りの並びは詰め直す。 */
export async function removeArticleFromSeries(
  database: D1Database,
  ownerId: string,
  seriesId: string,
  articleId: string,
  now = new Date(),
): Promise<boolean> {
  await requireOwnSeries(database, ownerId, seriesId);
  if (!isArticleIdentifier(articleId)) return false;
  const result = await database.prepare("DELETE FROM hub_user_article_series_items WHERE series_id = ? AND article_id = ?")
    .bind(seriesId, articleId).run();
  const removed = Number((result as { meta?: { changes?: number } }).meta?.changes ?? 0) > 0;
  if (removed) await renumber(database, seriesId, now);
  return removed;
}

async function currentOrder(database: D1Database, seriesId: string): Promise<string[]> {
  const result = await database.prepare("SELECT article_id FROM hub_user_article_series_items WHERE series_id = ? ORDER BY position ASC, article_id ASC")
    .bind(seriesId).all<{ article_id: string }>();
  return (result.results ?? []).map((row) => row.article_id);
}

async function writeOrder(database: D1Database, seriesId: string, ids: string[], now: Date): Promise<void> {
  const statements = ids.map((id, index) =>
    database.prepare("UPDATE hub_user_article_series_items SET position = ? WHERE series_id = ? AND article_id = ?").bind(index, seriesId, id));
  statements.push(database.prepare("UPDATE hub_user_article_series SET updated_at = ? WHERE id = ?").bind(now.toISOString(), seriesId));
  await database.batch(statements);
}

async function renumber(database: D1Database, seriesId: string, now: Date): Promise<void> {
  await writeOrder(database, seriesId, await currentOrder(database, seriesId), now);
}

/**
 * 並びを置き換える。渡す配列は、いま入っている記事の全件を過不足なく含むこと。
 * （足りない・余る・重複があれば拒む。並べ替えで記事が消えたり増えたりしない。）
 */
export async function reorderSeries(
  database: D1Database,
  ownerId: string,
  seriesId: string,
  orderedArticleIds: unknown,
  now = new Date(),
): Promise<void> {
  await requireOwnSeries(database, ownerId, seriesId);
  if (!Array.isArray(orderedArticleIds) || orderedArticleIds.some((id) => !isArticleIdentifier(id))) {
    throw new UserArticleValidationError("並び順の指定が正しくありません。");
  }
  const next = orderedArticleIds as string[];
  const current = await currentOrder(database, seriesId);
  if (next.length !== current.length || new Set(next).size !== next.length || next.some((id) => !current.includes(id))) {
    throw new UserArticleValidationError("並び順の指定が、いまのシリーズの記事と合いません。画面を読み込み直してください。");
  }
  await writeOrder(database, seriesId, next, now);
}

/** 公開のシリーズ。見える記事（公開中・一般・未モデレーション）だけを順番どおりに返す。 */
export async function getPublicSeries(database: D1Database, seriesId: string): Promise<PublicSeries | null> {
  if (!isSeriesIdentifier(seriesId)) return null;
  const series = await database.prepare(`SELECT s.id, s.title, s.description, s.owner_profile_id, s.created_at, s.updated_at,
      p.display_name, p.handle
    FROM hub_user_article_series s LEFT JOIN profiles p ON p.id = s.owner_profile_id WHERE s.id = ?`)
    .bind(seriesId)
    .first<{ id: string; title: string; description: string; owner_profile_id: string; created_at: string; updated_at: string; display_name: string | null; handle: string | null }>();
  if (!series) return null;
  const items = await database.prepare(`SELECT a.id, a.title, a.created_at
      FROM hub_user_article_series_items i JOIN hub_user_articles a ON a.id = i.article_id
      WHERE i.series_id = ? AND ${VISIBLE}
      ORDER BY i.position ASC, i.article_id ASC LIMIT ${SERIES_ITEM_LIMIT}`)
    .bind(seriesId).all<{ id: string; title: string; created_at: string }>();
  return {
    id: series.id,
    title: series.title,
    description: series.description,
    ownerProfileId: series.owner_profile_id,
    ownerName: series.display_name?.trim() || "Hubの書き手",
    ownerHandle: series.handle,
    createdAt: series.created_at,
    updatedAt: series.updated_at,
    articles: (items.results ?? []).map((row) => ({ id: row.id, title: row.title, createdAt: row.created_at })),
  };
}

/** 記事が入っているシリーズの文脈（前後の記事）。入っていなければ null。表が無い環境でも落とさない。 */
export async function getArticleSeriesContext(database: D1Database, articleId: string): Promise<ArticleSeriesContext | null> {
  if (!isArticleIdentifier(articleId)) return null;
  try {
    const own = await database.prepare(`SELECT s.id, s.title FROM hub_user_article_series_items i
        JOIN hub_user_article_series s ON s.id = i.series_id WHERE i.article_id = ?`)
      .bind(articleId).first<{ id: string; title: string }>();
    if (!own) return null;
    const items = await database.prepare(`SELECT a.id, a.title, a.created_at
        FROM hub_user_article_series_items i JOIN hub_user_articles a ON a.id = i.article_id
        WHERE i.series_id = ? AND ${VISIBLE}
        ORDER BY i.position ASC, i.article_id ASC LIMIT ${SERIES_ITEM_LIMIT}`)
      .bind(own.id).all<{ id: string; title: string; created_at: string }>();
    const list = (items.results ?? []).map((row): SeriesArticle => ({ id: row.id, title: row.title, createdAt: row.created_at }));
    const index = list.findIndex((item) => item.id === articleId);
    if (index < 0) return null;
    return {
      id: own.id,
      title: own.title,
      position: index + 1,
      total: list.length,
      previous: index > 0 ? list[index - 1] : null,
      next: index < list.length - 1 ? list[index + 1] : null,
    };
  } catch (error) {
    if (error instanceof Error && /no such table/i.test(error.message)) return null;
    throw error;
  }
}
