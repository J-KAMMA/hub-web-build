import type { D1Database } from "@cloudflare/workers-types";

import { redactGated } from "@/lib/server/gated-content";
import { notGatedSql } from "@/lib/server/gated-exits";
import type { UserArticle, UserArticleAudience } from "@/lib/server/d1-user-articles";

/**
 * 利用者記事の読み取り側。書き込み（公開・下書き・編集）は d1-user-articles.ts が持つ。
 * d1-user-articles.ts は互換のため listUserArticles / findUserArticle をここから再公開する。
 * 型だけを d1-user-articles.ts から借りる（実行時の循環参照を作らない）。
 */

type UserArticleRow = {
  id: string;
  author_profile_id: string;
  display_name: string | null;
  handle: string | null;
  avatar_url?: string | null;
  title: string;
  summary: string;
  body: string;
  public_preface?: string | null;
  tags_json: string;
  thumbnail_url: string | null;
  audience: string;
  created_at: string;
  updated_at: string;
  body_chars?: number | null;
};

function mapRow(row: UserArticleRow): UserArticle {
  let tags: string[] = [];
  try {
    const parsed = JSON.parse(row.tags_json) as unknown;
    if (Array.isArray(parsed)) tags = parsed.filter((tag): tag is string => typeof tag === "string");
  } catch {
    // 壊れたタグで記事そのものを読めなくしない。タグだけ落とす。
    tags = [];
  }
  return {
    id: row.id,
    authorProfileId: row.author_profile_id,
    authorName: row.display_name?.trim() || "Hubの書き手",
    authorHandle: row.handle,
    title: row.title,
    summary: row.summary,
    body: row.body,
    publicPreface: row.public_preface ?? "",
    tags,
    thumbnailUrl: row.thumbnail_url,
    audience: row.audience === "adult" ? "adult" : "general",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT_COLUMNS = `a.id, a.author_profile_id, p.display_name, p.handle, a.title, a.summary,
  a.body, a.public_preface, a.tags_json, a.thumbnail_url, a.audience, a.created_at, a.updated_at`;

/* 一覧用。本文は読まず、長さだけを返す（読了時間のため）。 */
const CARD_COLUMNS = `a.id, a.author_profile_id, p.display_name, p.handle, p.avatar_url, a.title, a.summary,
  '' AS body, a.tags_json, a.thumbnail_url, a.audience, a.created_at, a.updated_at, length(a.body) AS body_chars`;

export type UserArticleCursor = { createdAt: string; id: string };

export type ListUserArticlesOptions = {
  audience: UserArticleAudience;
  limit?: number;
  /** 旧来の呼び出し専用。新しい経路は before（keyset）を使う。 */
  offset?: number;
  query?: string;
  viewerProfileId?: string | null;
  authorProfileId?: string | null;
  /** この利用者がフォローしている書き手の記事だけ。 */
  followedBy?: string | null;
  /**
   * 「フォロー中」の流れ。この利用者がフォローしている書き手の記事、または
   * フォローしているタグが付いた記事。タグのフォロー表が無い環境では書き手だけで引く。
   */
  followingFeed?: string | null;
  tag?: string | null;
  /** Leave gated articles out in SQL, before LIMIT, so they cannot take result slots (search). */
  excludeGated?: boolean;
  /** Hydrate exactly these articles (tag pages page by link keyset, then load rows by id). */
  ids?: readonly string[];
  /** この位置より古い記事。(created_at, id) の keyset。 */
  before?: UserArticleCursor | null;
};

export function encodeArticleCursor(cursor: UserArticleCursor): string {
  return `${cursor.createdAt}~${cursor.id}`;
}

/** URLから来た値は信用しない。形が崩れていれば先頭ページとして扱う。 */
export function decodeArticleCursor(value: string | null | undefined): UserArticleCursor | null {
  if (!value || value.length > 300) return null;
  const index = value.indexOf("~");
  if (index <= 0) return null;
  const createdAt = value.slice(0, index);
  const id = value.slice(index + 1);
  if (!id || !Number.isFinite(Date.parse(createdAt))) return null;
  return { createdAt, id };
}

function isMissingTagTable(error: unknown): boolean {
  return error instanceof Error && /no such table: *hub_user_article_tags/i.test(error.message);
}

function isMissingTagFollowTable(error: unknown): boolean {
  return error instanceof Error && /no such table: *hub_article_tag_follows/i.test(error.message);
}

function buildFilter(options: ListUserArticlesOptions, tagMode: "table" | "json", feedTags = true) {
  const where: string[] = ["a.status = 'published'", "a.audience = ?", "a.moderated_at IS NULL"];
  const values: unknown[] = [options.audience];

  const terms = (options.query ?? "").trim().slice(0, 100).split(/\s+/u).filter(Boolean).slice(0, 8);
  for (const term of terms) {
    where.push("instr(lower(a.title || ' ' || a.summary || ' ' || a.tags_json || ' ' || coalesce(p.display_name, '') || ' ' || coalesce(p.handle, '')), lower(?)) > 0");
    values.push(term);
  }
  if (options.excludeGated) where.push(notGatedSql("article", "a.id"));
  if (options.authorProfileId) {
    where.push("a.author_profile_id = ?");
    values.push(options.authorProfileId);
  }
  if (options.followedBy) {
    where.push("a.author_profile_id IN (SELECT followed_profile_id FROM follows WHERE follower_profile_id = ?)");
    values.push(options.followedBy);
  }
  if (options.followingFeed) {
    const authors = "a.author_profile_id IN (SELECT followed_profile_id FROM follows WHERE follower_profile_id = ?)";
    if (feedTags && tagMode === "table") {
      // タグのフォロー経由では鍵つき記事を流さない（書き手のフォロー経由は従来どおり鍵つきカードで出る）。
      // 2026-10-29: follows match by tag key (content_tag_links); the raw-tag branch only serves follows and articles not yet backfilled.
      where.push(`(${authors} OR a.id IN (SELECT hat.article_id FROM hub_user_article_tags hat WHERE hat.tag IN (SELECT tag FROM hub_article_tag_follows WHERE profile_id = ?) AND ${notGatedSql("article", "hat.article_id")})
        OR a.id IN (SELECT l.target_id FROM content_tag_links l JOIN content_tags ct ON ct.id = l.tag_id WHERE l.target_type = 'user_article' AND l.public_visible = 1
          AND ct.normalized_key IN (SELECT tag_key FROM hub_article_tag_follows WHERE profile_id = ? AND tag_key IS NOT NULL) AND ${notGatedSql("article", "l.target_id")}))`);
      values.push(options.followingFeed, options.followingFeed, options.followingFeed);
    } else {
      where.push(authors);
      values.push(options.followingFeed);
    }
  }
  if (options.ids) {
    const wanted = [...new Set(options.ids)].slice(0, 100);
    where.push(wanted.length ? `a.id IN (${wanted.map(() => "?").join(",")})` : "0");
    values.push(...wanted);
  }
  const tag = (options.tag ?? "").trim();
  if (tag) {
    // タグ一覧に鍵つき記事を出さない（出ると本文のタグが分かる）。
    where.push(notGatedSql("article", "a.id"));
    if (tagMode === "table") {
      where.push("a.id IN (SELECT article_id FROM hub_user_article_tags WHERE tag = ?)");
    } else {
      where.push("EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(a.tags_json) THEN a.tags_json ELSE '[]' END) t WHERE t.value = ?)");
    }
    values.push(tag);
  }
  if (options.before) {
    where.push("(a.created_at < ? OR (a.created_at = ? AND a.id < ?))");
    values.push(options.before.createdAt, options.before.createdAt, options.before.id);
  }
  return { where: where.join(" AND "), values };
}

async function selectRows(
  database: D1Database,
  columns: string,
  options: ListUserArticlesOptions,
  limit: number,
  offset: number,
): Promise<UserArticleRow[]> {
  const run = async (tagMode: "table" | "json", feedTags = true) => {
    const { where, values } = buildFilter(options, tagMode, feedTags);
    const sql = `SELECT ${columns}
      FROM hub_user_articles a LEFT JOIN profiles p ON p.id = a.author_profile_id
      WHERE ${where}
      ORDER BY a.created_at DESC, a.id DESC LIMIT ?${offset ? " OFFSET ?" : ""}`;
    const result = await database.prepare(sql).bind(...values, limit, ...(offset ? [offset] : [])).all<UserArticleRow>();
    return result.results ?? [];
  };
  try {
    return await run("table");
  } catch (error) {
    // 列・表が本番へ入る前でも一覧を落とさない。正規化表が無ければJSONから探す。
    if (options.tag && isMissingTagTable(error)) return run("json");
    // タグのフォロー表が本番へ入る前は、書き手のフォローだけで流れを作る。
    if (options.followingFeed && (isMissingTagFollowTable(error) || isMissingTagTable(error))) return run("table", false);
    throw error;
  }
}

export async function listUserArticles(
  database: D1Database,
  options: ListUserArticlesOptions = { audience: "general" },
): Promise<UserArticle[]> {
  const limit = Math.min(Math.max(options.limit ?? 24, 1), 100);
  const offset = Math.max(0, Math.trunc(options.offset ?? 0));
  const rows = await selectRows(database, SELECT_COLUMNS, options, limit, offset);
  return redactGated(database, options.viewerProfileId ?? null, rows.map(mapRow), "article");
}

export type UserArticleCard = UserArticle & {
  authorAvatarUrl: string | null;
  /** 本文の文字数。本文そのものは一覧へ渡さない。 */
  bodyChars: number;
};

/**
 * 一覧用の1ページ。本文は読まない。keyset (created_at, id) で次のページを引き、
 * OFFSET で読み捨てない（D1は読んだ行数で課金される）。
 */
export async function listUserArticlePage(
  database: D1Database,
  options: Omit<ListUserArticlesOptions, "offset">,
): Promise<{ articles: UserArticleCard[]; nextCursor: UserArticleCursor | null }> {
  const limit = Math.min(Math.max(options.limit ?? 24, 1), 100);
  const rows = await selectRows(database, CARD_COLUMNS, options, limit + 1, 0);
  const page = rows.slice(0, limit);
  const cards: UserArticleCard[] = page.map((row) => ({
    ...mapRow(row),
    authorAvatarUrl: row.avatar_url ?? null,
    bodyChars: Math.max(0, Number(row.body_chars ?? 0)),
  }));
  const articles = await redactGated(database, options.viewerProfileId ?? null, cards, "article");
  const last = page.at(-1);
  return { articles, nextCursor: rows.length > limit && last ? { createdAt: last.created_at, id: last.id } : null };
}

/** プロフィールの記事タブの件数。 */
export async function countUserArticlesByAuthor(database: D1Database, authorProfileId: string): Promise<number> {
  const row = await database.prepare(`SELECT count(*) AS n FROM hub_user_articles
    WHERE author_profile_id = ? AND status = 'published' AND audience = 'general' AND moderated_at IS NULL`)
    .bind(authorProfileId).first<{ n: number }>();
  return Number(row?.n ?? 0);
}

/**
 * 1本を読む。成人向けの記事は、成人区分を指定した経路からしか返さない。
 * 一般側のURLで開かれても本文を渡さないので、成人表示が無効な画面へ
 * 題名や本文が漏れない。
 */
export async function findUserArticle(
  database: D1Database,
  id: string,
  options: { audience: UserArticleAudience; viewerProfileId?: string | null },
): Promise<UserArticle | null> {
  const row = await database.prepare(`SELECT ${SELECT_COLUMNS}
    FROM hub_user_articles a LEFT JOIN profiles p ON p.id = a.author_profile_id
    WHERE a.id = ? AND a.status = 'published' AND a.audience = ? AND a.moderated_at IS NULL`)
    .bind(id, options.audience)
    .first<UserArticleRow>();
  if (!row) return null;
  const [article] = await redactGated(database, options.viewerProfileId ?? null, [mapRow(row)], "article", { context: "detail" });
  return article ?? null;
}

/** タグ頁の見出し用。公開中の記事数。正規化表が無ければJSONから数える。 */
export async function countArticlesWithTag(database: D1Database, tag: string): Promise<number> {
  try {
    const row = await database.prepare(`SELECT count(*) AS n FROM hub_user_article_tags t
      JOIN hub_user_articles a ON a.id = t.article_id
      WHERE t.tag = ? AND a.status = 'published' AND a.audience = 'general' AND a.moderated_at IS NULL`)
      .bind(tag).first<{ n: number }>();
    return Number(row?.n ?? 0);
  } catch (error) {
    if (!isMissingTagTable(error)) throw error;
    const row = await database.prepare(`SELECT count(*) AS n FROM hub_user_articles a
      WHERE a.status = 'published' AND a.audience = 'general' AND a.moderated_at IS NULL
      AND EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(a.tags_json) THEN a.tags_json ELSE '[]' END) t WHERE t.value = ?)`)
      .bind(tag).first<{ n: number }>();
    return Number(row?.n ?? 0);
  }
}
