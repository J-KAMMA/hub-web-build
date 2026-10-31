import type { D1Database } from "@cloudflare/workers-types";

import { UserArticleLimitError, UserArticleNotFoundError, isArticleIdentifier } from "@/lib/server/d1-user-article-drafts";
import { UserArticleValidationError } from "@/lib/server/d1-user-articles";
import { createD1HubNotification } from "@/lib/server/d1-notification-events";
import { getD1NotificationPreferences } from "@/lib/server/d1-direct-messages";
import { loadGatesForTargets } from "@/lib/server/gated-content";
import { hasD1BlockBetween } from "@/lib/server/profile-blocks";

/**
 * 利用者記事のマガジン。キュレーターが、誰の記事でも公開中の記事を集める。
 * シリーズ（d1-user-article-series.ts）は著者1人が自分の記事だけを束ねるもので、別物。
 *
 * - 書き込みはすべて owner_profile_id で絞る。他人のマガジンは「見つからない」として扱い、存在を教えない。
 * - 入れられるのは公開中・一般区分・未モデレーションの記事だけ。ブロック関係にある書き手の記事、
 *   受け入れを切った書き手の記事（本人を除く）は入れられない。
 * - 公開側が返すのは題・id・書き手の表示名・日付だけ。本文と要約は読まない。
 *   条件付き（トークンゲート）の記事も題だけが並び、本文は記事の画面で条件を満たした人にだけ開く。
 * - 書き手は、自分の記事を自分以外のマガジンからいつでも外せる。
 */

export const MAGAZINE_LIMIT_PER_OWNER = 30;
export const MAGAZINE_ITEM_LIMIT = 500;
const TITLE_MAX = 100;
const DESCRIPTION_MAX = 400;

export type MagazineInput = { title: string; description: string };

export type MagazineSummary = {
  id: string;
  title: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  /** 公開中で一般区分の記事数。 */
  articleCount: number;
  /** 記事idを指定して読んだとき、その記事がこのマガジンに入っているか。 */
  containsArticle?: boolean;
};

export type MagazineArticle = {
  id: string;
  title: string;
  createdAt: string;
  authorName: string;
  authorHandle: string | null;
  /** 条件付き（トークンゲート）の記事。題だけを出す。 */
  gated: boolean;
};

export type PublicMagazine = {
  id: string;
  title: string;
  description: string;
  ownerProfileId: string;
  ownerName: string;
  ownerHandle: string | null;
  createdAt: string;
  updatedAt: string;
  articles: Array<MagazineArticle & { authorProfileId: string }>;
};

export type OwnMagazineDetail = {
  id: string;
  title: string;
  description: string;
  /** 並び順どおり。取り下げ中の記事も含める（キュレーターが整理できるように）。 */
  articles: Array<{ id: string; title: string; status: string; audience: string; authorName: string }>;
};

function characters(value: string): number {
  return Array.from(value).length;
}

export function parseMagazineInput(value: unknown): MagazineInput {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const title = typeof record.title === "string" ? record.title.normalize("NFKC").trim() : "";
  const description = typeof record.description === "string" ? record.description.trim() : "";
  if (characters(title) < 1) throw new UserArticleValidationError("マガジンの題を入力してください。");
  if (characters(title) > TITLE_MAX) throw new UserArticleValidationError(`マガジンの題は${TITLE_MAX}文字までです。`);
  if (characters(description) > DESCRIPTION_MAX) throw new UserArticleValidationError(`マガジンの説明は${DESCRIPTION_MAX}文字までです。`);
  return { title, description };
}

export function isMagazineIdentifier(value: unknown): value is string {
  return isArticleIdentifier(value);
}

const VISIBLE = "a.status = 'published' AND a.audience = 'general' AND a.moderated_at IS NULL";

function changed(result: unknown): boolean {
  return Number((result as { meta?: { changes?: number } }).meta?.changes ?? 0) > 0;
}

async function requireOwnMagazine(database: D1Database, ownerId: string, magazineId: string): Promise<{ title: string }> {
  if (!isMagazineIdentifier(magazineId)) throw new UserArticleNotFoundError();
  const row = await database.prepare("SELECT title FROM hub_user_article_magazines WHERE id = ? AND owner_profile_id = ?")
    .bind(magazineId, ownerId).first<{ title: string }>();
  if (!row) throw new UserArticleNotFoundError();
  return row;
}

export async function createMagazine(database: D1Database, ownerId: string, input: MagazineInput, now = new Date()): Promise<MagazineSummary> {
  const count = await database.prepare("SELECT COUNT(*) AS n FROM hub_user_article_magazines WHERE owner_profile_id = ?")
    .bind(ownerId).first<{ n: number }>();
  if (Number(count?.n ?? 0) >= MAGAZINE_LIMIT_PER_OWNER) {
    throw new UserArticleLimitError(`マガジンは${MAGAZINE_LIMIT_PER_OWNER}本までです。`);
  }
  const id = crypto.randomUUID();
  const timestamp = now.toISOString();
  await database.prepare(`INSERT INTO hub_user_article_magazines (id, owner_profile_id, title, description, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(id, ownerId, input.title, input.description, timestamp, timestamp).run();
  return { id, title: input.title, description: input.description, createdAt: timestamp, updatedAt: timestamp, articleCount: 0 };
}

export async function updateMagazine(database: D1Database, ownerId: string, magazineId: string, input: MagazineInput, now = new Date()): Promise<void> {
  await requireOwnMagazine(database, ownerId, magazineId);
  await database.prepare("UPDATE hub_user_article_magazines SET title = ?, description = ?, updated_at = ? WHERE id = ? AND owner_profile_id = ?")
    .bind(input.title, input.description, now.toISOString(), magazineId, ownerId).run();
}

/** マガジンを消す。記事は消えない（集めが解けるだけ）。 */
export async function deleteMagazine(database: D1Database, ownerId: string, magazineId: string): Promise<boolean> {
  if (!isMagazineIdentifier(magazineId)) return false;
  return changed(await database.prepare("DELETE FROM hub_user_article_magazines WHERE id = ? AND owner_profile_id = ?")
    .bind(magazineId, ownerId).run());
}

/** 自分のマガジン一覧。articleId を渡すと、その記事が入っているかも付ける。 */
export async function listOwnMagazines(database: D1Database, ownerId: string, articleId?: string): Promise<MagazineSummary[]> {
  const withArticle = typeof articleId === "string" && isArticleIdentifier(articleId);
  const result = await database.prepare(`SELECT m.id, m.title, m.description, m.created_at, m.updated_at,
      (SELECT COUNT(*) FROM hub_user_article_magazine_items i JOIN hub_user_articles a ON a.id = i.article_id
        WHERE i.magazine_id = m.id AND ${VISIBLE}) AS article_count,
      ${withArticle ? "(SELECT 1 FROM hub_user_article_magazine_items x WHERE x.magazine_id = m.id AND x.article_id = ?)" : "NULL"} AS has_article
    FROM hub_user_article_magazines m WHERE m.owner_profile_id = ?
    ORDER BY m.created_at DESC, m.id DESC LIMIT ${MAGAZINE_LIMIT_PER_OWNER}`)
    .bind(...(withArticle ? [articleId, ownerId] : [ownerId]))
    .all<{ id: string; title: string; description: string; created_at: string; updated_at: string; article_count: number; has_article: number | null }>();
  return (result.results ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    articleCount: Number(row.article_count ?? 0),
    ...(withArticle ? { containsArticle: Boolean(row.has_article) } : {}),
  }));
}

/** キュレーター向けの詳細。取り下げ中の記事も並びに含める。 */
export async function getOwnMagazine(database: D1Database, ownerId: string, magazineId: string): Promise<OwnMagazineDetail | null> {
  if (!isMagazineIdentifier(magazineId)) return null;
  const magazine = await database.prepare("SELECT id, title, description FROM hub_user_article_magazines WHERE id = ? AND owner_profile_id = ?")
    .bind(magazineId, ownerId).first<{ id: string; title: string; description: string }>();
  if (!magazine) return null;
  const items = await database.prepare(`SELECT a.id, a.title, a.status, a.audience, p.display_name
      FROM hub_user_article_magazine_items i JOIN hub_user_articles a ON a.id = i.article_id
      LEFT JOIN profiles p ON p.id = a.author_profile_id
      WHERE i.magazine_id = ? ORDER BY i.position ASC, i.article_id ASC LIMIT ${MAGAZINE_ITEM_LIMIT}`)
    .bind(magazineId).all<{ id: string; title: string; status: string; audience: string; display_name: string | null }>();
  return {
    id: magazine.id,
    title: magazine.title,
    description: magazine.description,
    articles: (items.results ?? []).map((row) => ({
      id: row.id,
      title: row.title,
      status: row.status,
      audience: row.audience,
      authorName: row.display_name?.trim() || "Hubの書き手",
    })),
  };
}

/* ------------------------------------------------------------------ */
/* 書き手の受け入れ設定                                                */
/* ------------------------------------------------------------------ */

/** マガジンへの追加を受け入れるか。行が無い・表が無いときは受け入れる側に倒す。 */
export async function getAllowAdding(database: D1Database, profileId: string): Promise<boolean> {
  try {
    const row = await database.prepare("SELECT allow_adding FROM hub_user_article_magazine_settings WHERE profile_id = ?")
      .bind(profileId).first<{ allow_adding: number }>();
    return row ? Number(row.allow_adding) === 1 : true;
  } catch (error) {
    if (error instanceof Error && /no such table/i.test(error.message)) return true;
    throw error;
  }
}

export async function setAllowAdding(database: D1Database, profileId: string, allow: boolean, now = new Date()): Promise<boolean> {
  await database.prepare(`INSERT INTO hub_user_article_magazine_settings (profile_id, allow_adding, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(profile_id) DO UPDATE SET allow_adding = excluded.allow_adding, updated_at = excluded.updated_at`)
    .bind(profileId, allow ? 1 : 0, now.toISOString()).run();
  return allow;
}

/* ------------------------------------------------------------------ */
/* 追加・外す・並べ替え                                                */
/* ------------------------------------------------------------------ */

async function notifyAuthorOfAddition(
  database: D1Database,
  authorProfileId: string,
  ownerId: string,
  magazineId: string,
  magazineTitle: string,
  articleId: string,
  now: Date,
) {
  try {
    // 既存の通知設定に従う。マガジンへの追加は「反応」の一種として扱う。
    const preferences = await getD1NotificationPreferences(database, authorProfileId);
    if (!preferences.reactions) return;
    // 鍵付きの記事は一般的な文面だけ。マガジンの題は載せない。
    const gates = await loadGatesForTargets(database, "article", [articleId]).catch(() => null);
    const gated = !gates || gates.size > 0;
    await createD1HubNotification(database, {
      receiverProfileId: authorProfileId,
      actorProfileId: ownerId,
      text: gated ? "あなたの記事がマガジンに追加されました。" : `あなたの記事がマガジン「${magazineTitle}」に追加されました。`,
      route: `/articles/${encodeURIComponent(articleId)}`,
      // マガジンと記事の組ごとに1通だけ。外して入れ直しても、並べ替えても、再通知しない。
      dedupeKey: `article-magazine:${magazineId}:${articleId}`,
      createdAt: now.toISOString(),
    });
  } catch { /* 通知に失敗しても追加そのものは成立させる */ }
}

/**
 * 記事をマガジンの末尾へ足す。誰の記事でもよいが、公開中・一般区分・未モデレーションに限る。
 * すでに入っていれば何もしない（通知も出さない）。
 */
export async function addArticleToMagazine(
  database: D1Database,
  ownerId: string,
  magazineId: string,
  articleId: string,
  now = new Date(),
): Promise<void> {
  const magazine = await requireOwnMagazine(database, ownerId, magazineId);
  if (!isArticleIdentifier(articleId)) throw new UserArticleNotFoundError();
  const article = await database.prepare(`SELECT a.id, a.author_profile_id FROM hub_user_articles a WHERE a.id = ? AND ${VISIBLE}`)
    .bind(articleId).first<{ id: string; author_profile_id: string }>();
  if (!article) throw new UserArticleNotFoundError();
  const authorId = article.author_profile_id;
  const ownArticle = authorId === ownerId;
  if (!ownArticle) {
    if (await hasD1BlockBetween(database, ownerId, authorId)) {
      throw new UserArticleLimitError("この書き手の記事はマガジンに追加できません。");
    }
    if (!(await getAllowAdding(database, authorId))) {
      throw new UserArticleLimitError("この書き手は、記事のマガジンへの追加を受け付けていません。");
    }
  }
  const existing = await database.prepare("SELECT 1 AS x FROM hub_user_article_magazine_items WHERE magazine_id = ? AND article_id = ?")
    .bind(magazineId, articleId).first();
  if (existing) return;
  const stats = await database.prepare("SELECT COUNT(*) AS n, COALESCE(MAX(position), -1) AS top FROM hub_user_article_magazine_items WHERE magazine_id = ?")
    .bind(magazineId).first<{ n: number; top: number }>();
  if (Number(stats?.n ?? 0) >= MAGAZINE_ITEM_LIMIT) throw new UserArticleLimitError(`1つのマガジンに入れられる記事は${MAGAZINE_ITEM_LIMIT}本までです。`);
  const timestamp = now.toISOString();
  try {
    await database.prepare("INSERT INTO hub_user_article_magazine_items (magazine_id, article_id, position, added_at) VALUES (?, ?, ?, ?)")
      .bind(magazineId, articleId, Number(stats?.top ?? -1) + 1, timestamp).run();
  } catch (error) {
    // 同時に同じ記事を入れた側は主キーで落ちる。すでに入っているので成功として扱う。
    if (error instanceof Error && /UNIQUE|constraint/i.test(error.message)) return;
    throw error;
  }
  await database.prepare("UPDATE hub_user_article_magazines SET updated_at = ? WHERE id = ?").bind(timestamp, magazineId).run();
  if (!ownArticle) await notifyAuthorOfAddition(database, authorId, ownerId, magazineId, magazine.title, articleId, now);
}

/** キュレーターが記事を外す。残りの並びは詰め直す。 */
export async function removeArticleFromMagazine(
  database: D1Database,
  ownerId: string,
  magazineId: string,
  articleId: string,
  now = new Date(),
): Promise<boolean> {
  await requireOwnMagazine(database, ownerId, magazineId);
  if (!isArticleIdentifier(articleId)) return false;
  const removed = changed(await database.prepare("DELETE FROM hub_user_article_magazine_items WHERE magazine_id = ? AND article_id = ?")
    .bind(magazineId, articleId).run());
  if (removed) await renumber(database, magazineId, now);
  return removed;
}

/**
 * 書き手が、自分の記事をマガジンから外す。マガジンの所有者でなくてよい。
 * 他人の記事は外せない（その場合は「見つからない」として扱う）。
 */
export async function removeOwnArticleFromAnyMagazine(
  database: D1Database,
  authorId: string,
  magazineId: string,
  articleId: string,
  now = new Date(),
): Promise<boolean> {
  if (!isMagazineIdentifier(magazineId) || !isArticleIdentifier(articleId)) return false;
  const mine = await database.prepare("SELECT 1 AS x FROM hub_user_articles WHERE id = ? AND author_profile_id = ?")
    .bind(articleId, authorId).first();
  if (!mine) throw new UserArticleNotFoundError();
  const removed = changed(await database.prepare("DELETE FROM hub_user_article_magazine_items WHERE magazine_id = ? AND article_id = ?")
    .bind(magazineId, articleId).run());
  if (removed) await renumber(database, magazineId, now);
  return removed;
}

async function currentOrder(database: D1Database, magazineId: string): Promise<string[]> {
  const result = await database.prepare("SELECT article_id FROM hub_user_article_magazine_items WHERE magazine_id = ? ORDER BY position ASC, article_id ASC")
    .bind(magazineId).all<{ article_id: string }>();
  return (result.results ?? []).map((row) => row.article_id);
}

async function writeOrder(database: D1Database, magazineId: string, ids: string[], now: Date): Promise<void> {
  const statements = ids.map((id, index) =>
    database.prepare("UPDATE hub_user_article_magazine_items SET position = ? WHERE magazine_id = ? AND article_id = ?").bind(index, magazineId, id));
  statements.push(database.prepare("UPDATE hub_user_article_magazines SET updated_at = ? WHERE id = ?").bind(now.toISOString(), magazineId));
  await database.batch(statements);
}

async function renumber(database: D1Database, magazineId: string, now: Date): Promise<void> {
  await writeOrder(database, magazineId, await currentOrder(database, magazineId), now);
}

/**
 * 並びを置き換える。渡す配列は、いま入っている記事の全件を過不足なく含むこと。
 * 並べ替えは通知を出さない。
 */
export async function reorderMagazine(
  database: D1Database,
  ownerId: string,
  magazineId: string,
  orderedArticleIds: unknown,
  now = new Date(),
): Promise<void> {
  await requireOwnMagazine(database, ownerId, magazineId);
  if (!Array.isArray(orderedArticleIds) || orderedArticleIds.some((id) => !isArticleIdentifier(id))) {
    throw new UserArticleValidationError("並び順の指定が正しくありません。");
  }
  const next = orderedArticleIds as string[];
  const current = await currentOrder(database, magazineId);
  if (next.length !== current.length || new Set(next).size !== next.length || next.some((id) => !current.includes(id))) {
    throw new UserArticleValidationError("並び順の指定が、いまのマガジンの記事と合いません。画面を読み込み直してください。");
  }
  await writeOrder(database, magazineId, next, now);
}

/* ------------------------------------------------------------------ */
/* 公開側                                                              */
/* ------------------------------------------------------------------ */

/** 公開のマガジン。見える記事（公開中・一般・未モデレーション）だけを順番どおりに返す。本文と要約は読まない。 */
export async function getPublicMagazine(database: D1Database, magazineId: string): Promise<PublicMagazine | null> {
  if (!isMagazineIdentifier(magazineId)) return null;
  const magazine = await database.prepare(`SELECT m.id, m.title, m.description, m.owner_profile_id, m.created_at, m.updated_at,
      p.display_name, p.handle
    FROM hub_user_article_magazines m LEFT JOIN profiles p ON p.id = m.owner_profile_id WHERE m.id = ?`)
    .bind(magazineId)
    .first<{ id: string; title: string; description: string; owner_profile_id: string; created_at: string; updated_at: string; display_name: string | null; handle: string | null }>();
  if (!magazine) return null;
  const items = await database.prepare(`SELECT a.id, a.title, a.created_at, a.author_profile_id, ap.display_name AS author_name, ap.handle AS author_handle
      FROM hub_user_article_magazine_items i JOIN hub_user_articles a ON a.id = i.article_id
      LEFT JOIN profiles ap ON ap.id = a.author_profile_id
      WHERE i.magazine_id = ? AND ${VISIBLE}
      ORDER BY i.position ASC, i.article_id ASC LIMIT ${MAGAZINE_ITEM_LIMIT}`)
    .bind(magazineId)
    .all<{ id: string; title: string; created_at: string; author_profile_id: string; author_name: string | null; author_handle: string | null }>();
  const rows = items.results ?? [];
  // 条件付きかどうかだけを知りたい。本文は読んでいない。読めなければ条件付き扱い（印だけの話で、題以外は出さない）。
  const gates = rows.length
    ? await loadGatesForTargets(database, "article", rows.map((row) => row.id)).catch(() => null)
    : new Map();
  return {
    id: magazine.id,
    title: magazine.title,
    description: magazine.description,
    ownerProfileId: magazine.owner_profile_id,
    ownerName: magazine.display_name?.trim() || "Hubの書き手",
    ownerHandle: magazine.handle,
    createdAt: magazine.created_at,
    updatedAt: magazine.updated_at,
    articles: rows.map((row) => ({
      id: row.id,
      title: row.title,
      createdAt: row.created_at,
      authorProfileId: row.author_profile_id,
      authorName: row.author_name?.trim() || "Hubの書き手",
      authorHandle: row.author_handle,
      gated: gates ? gates.has(row.id) : true,
    })),
  };
}
