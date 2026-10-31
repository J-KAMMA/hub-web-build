import type { D1Database } from "@cloudflare/workers-types";

import type { Profile } from "@/lib/domain";
import type { GateAccessState } from "@/lib/server/gated-content";
import { findUserArticle } from "@/lib/server/d1-user-article-queries";
import { notifyFollowersSafely } from "@/lib/server/d1-user-article-notices";
import { indexD1ContentTags } from "@/lib/server/d1-content-tags";
import { articleSummaryFallback, normalizeArticleTags } from "@/lib/article-body";

/**
 * 人が書いた無料記事の読み書き。
 *
 * Hubが持つのは無料公開の本文だけ。限定本文と閲覧条件はVaultが所有し、
 * 購入・返金はCommerceまたは外部販売者が所有する。この関数群からVaultや
 * Commerceを呼ばず、保護本文をHubのD1へ書かない。
 */

export type UserArticleAudience = "general" | "adult";

export type UserArticle = {
  id: string;
  authorProfileId: string;
  authorName: string;
  authorHandle: string | null;
  title: string;
  summary: string;
  body: string;
  /** The author's deliberately public text above the lock line. Written separately, never derived from body. */
  publicPreface?: string;
  tags: string[];
  thumbnailUrl: string | null;
  audience: UserArticleAudience;
  createdAt: string;
  updatedAt: string;
  /** Set when a token gate hides the body from this viewer. */
  accessGate?: GateAccessState;
};

export type PublishUserArticleInput = {
  title: string;
  summary: string;
  body: string;
  publicPreface?: string;
  tags: string[];
  thumbnailUrl: string | null;
  audience: UserArticleAudience;
  clientRequestId: string | null;
};

export class UserArticleValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserArticleValidationError";
  }
}

export class UserArticleRateLimitError extends Error {
  constructor(public readonly retryAfterSeconds: number) {
    super(`記事の公開が続いています。${Math.max(1, Math.ceil(retryAfterSeconds / 60))}分ほど待ってから、もう一度お試しください。`);
    this.name = "UserArticleRateLimitError";
  }
}

export class UserArticlePublicationConflictError extends Error {
  constructor() { super("同じ公開操作で異なる記事は保存できません。"); this.name = "UserArticlePublicationConflictError"; }
}

export function isArticlePublicationRequestId(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value) && value.length === 36;
}

const TITLE_MAX = 120;
const SUMMARY_MAX = 400;
export const PUBLIC_PREFACE_MAX = 20_000;
const BODY_MAX = 100_000;

// 新しいAccountほど窓を狭くする。社会投稿と同じ考え方だが枠は別に持つ。
const PUBLISH_QUOTA = {
  established: { limit: 10, windowMs: 60 * 60 * 1000 },
  newAccount: { limit: 2, windowMs: 60 * 60 * 1000 },
} as const;

const NEW_ACCOUNT_AGE_MS = 24 * 60 * 60 * 1000;

type UserArticleRow = {
  id: string;
  author_profile_id: string;
  display_name: string | null;
  handle: string | null;
  title: string;
  summary: string;
  body: string;
  public_preface?: string | null;
  tags_json: string;
  thumbnail_url: string | null;
  audience: string;
  created_at: string;
  updated_at: string;
};

function characters(value: string): number {
  return Array.from(value).length;
}

/**
 * サムネイルはhttpsの絶対URLだけを受ける。http、data:、相対URLは
 * 混在contentと取得先の偽装を招くので、置き換えずに拒否する。
 */
export function normalizeThumbnailUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new UserArticleValidationError("サムネイルのURLが正しくありません。");
  }
  if (parsed.protocol !== "https:") {
    throw new UserArticleValidationError("サムネイルのURLはhttpsで指定してください。");
  }
  if (trimmed.length > 500) {
    throw new UserArticleValidationError("サムネイルのURLが長すぎます。");
  }
  return parsed.toString();
}

export function parsePublishInput(payload: unknown): PublishUserArticleInput {
  const body = (payload ?? {}) as Record<string, unknown>;
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const summary = typeof body.summary === "string" ? body.summary.trim() : "";
  const articleBody = typeof body.body === "string" ? body.body.replaceAll("\r\n", "\n").trim() : "";
  const audience = body.audience === "adult" ? "adult" : "general";
  if (Object.hasOwn(body, "clientRequestId") && body.clientRequestId !== null && !isArticlePublicationRequestId(body.clientRequestId)) {
    throw new UserArticleValidationError("公開操作IDが正しくありません。");
  }
  const clientRequestId = typeof body.clientRequestId === "string" ? body.clientRequestId : null;

  if (!title) throw new UserArticleValidationError("タイトルを入れてください。");
  if (characters(title) > TITLE_MAX) throw new UserArticleValidationError(`タイトルは${TITLE_MAX}文字までです。`);
  if (!articleBody) throw new UserArticleValidationError("本文を入れてください。");
  if (characters(articleBody) > BODY_MAX) throw new UserArticleValidationError(`本文は${BODY_MAX}文字までです。`);
  if (characters(summary) > SUMMARY_MAX) throw new UserArticleValidationError(`要約は${SUMMARY_MAX}文字までです。`);
  const publicPreface = typeof body.publicPreface === "string" ? body.publicPreface.replaceAll("\r\n", "\n").trim() : "";
  if (characters(publicPreface) > PUBLIC_PREFACE_MAX) throw new UserArticleValidationError(`鍵の手前に見せる部分は${PUBLIC_PREFACE_MAX}文字までです。`);

  const tags = normalizeArticleTags(
    Array.isArray(body.tags) ? body.tags.filter((tag): tag is string => typeof tag === "string") : "",
  );

  return {
    title,
    // With a public preface (gated articles), build the fallback from it so the stored summary never quotes the gated body.
    summary: summary || articleSummaryFallback(publicPreface || articleBody),
    body: articleBody,
    publicPreface,
    tags,
    thumbnailUrl: normalizeThumbnailUrl(body.thumbnailUrl),
    audience,
    clientRequestId,
  };
}

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

async function findByClientRequest(
  database: D1Database,
  authorProfileId: string,
  clientRequestId: string,
): Promise<UserArticle | null> {
  const row = await database.prepare(`SELECT ${SELECT_COLUMNS}
    FROM hub_user_articles a LEFT JOIN profiles p ON p.id = a.author_profile_id
    WHERE a.author_profile_id = ? AND a.client_request_id = ?`)
    .bind(authorProfileId, clientRequestId)
    .first<UserArticleRow>();
  return row ? mapRow(row) : null;
}

/** Only the authenticated author's operation is visible; no article body leaves this lookup. */
export async function findUserArticlePublication(database: D1Database, authorProfileId: string, clientRequestId: string) {
  if (!isArticlePublicationRequestId(clientRequestId)) throw new UserArticleValidationError("公開操作IDが正しくありません。");
  const article = await findByClientRequest(database, authorProfileId, clientRequestId);
  return article?.audience === "general" ? { id: article.id, href: `/articles/${article.id}` } : null;
}

function duplicatePublication(article: UserArticle, input: PublishUserArticleInput) {
  if (article.title !== input.title || article.summary !== input.summary || article.body !== input.body || (article.publicPreface ?? "") !== (input.publicPreface ?? "")
    || article.audience !== input.audience || article.thumbnailUrl !== input.thumbnailUrl
    || JSON.stringify(article.tags) !== JSON.stringify(input.tags)) throw new UserArticlePublicationConflictError();
  return { article, duplicate: true };
}

async function consumePublishQuota(
  database: D1Database,
  profile: Pick<Profile, "id" | "joinedAt">,
  now: Date,
) {
  const joinedAt = Date.parse(profile.joinedAt);
  const isNew = !Number.isFinite(joinedAt) || now.getTime() - joinedAt < NEW_ACCOUNT_AGE_MS;
  const quota = isNew ? PUBLISH_QUOTA.newAccount : PUBLISH_QUOTA.established;
  const windowStartMs = Math.floor(now.getTime() / quota.windowMs) * quota.windowMs;
  const result = await database.prepare(`INSERT INTO hub_user_article_rate_limit_buckets
      (profile_id, window_started_at, request_count, expires_at)
      VALUES (?, ?, 1, ?)
      ON CONFLICT(profile_id, window_started_at) DO UPDATE SET
        request_count = request_count + 1
      WHERE request_count < ?`)
    .bind(
      profile.id,
      new Date(windowStartMs).toISOString(),
      new Date(windowStartMs + quota.windowMs).toISOString(),
      quota.limit,
    )
    .run();
  if (!result.meta.changes) {
    throw new UserArticleRateLimitError(
      Math.max(1, Math.ceil((windowStartMs + quota.windowMs - now.getTime()) / 1000)),
    );
  }
}

export async function publishUserArticle(
  database: D1Database,
  author: Pick<Profile, "id" | "joinedAt">,
  input: PublishUserArticleInput,
  now = new Date(),
  options: { id?: string } = {},
): Promise<{ article: UserArticle; duplicate: boolean }> {
  if (input.clientRequestId) {
    const existing = await findByClientRequest(database, author.id, input.clientRequestId);
    if (existing) return duplicatePublication(existing, input);
  }

  await consumePublishQuota(database, author, now);

  // 下書きから公開するときは下書きのidを引き継ぐ（本文中の画像の付け先が変わらない）。
  const id = options.id ?? crypto.randomUUID();
  const timestamp = now.toISOString();
  try {
    await database.prepare(`INSERT INTO hub_user_articles (
        id, author_profile_id, title, summary, body, public_preface, tags_json, thumbnail_url,
        audience, status, client_request_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', ?, ?, ?)`)
        .bind(
          id, author.id, input.title, input.summary, input.body, input.publicPreface ?? "",
          JSON.stringify(input.tags), input.thumbnailUrl, input.audience,
          input.clientRequestId, timestamp, timestamp,
        ).run();
    await indexD1ContentTags(database, "user_article", id, input.tags);
  } catch (error) {
    // 同じ冪等キーの同時実行は、後から来た側も同じ記事へ収束させる。
    if (input.clientRequestId) {
      const existing = await findByClientRequest(database, author.id, input.clientRequestId);
      if (existing) return duplicatePublication(existing, input);
    }
    throw error;
  }

  const article = await findUserArticle(database, id, { audience: input.audience });
  if (!article) throw new Error("公開した記事を読み戻せませんでした。");
  // 下書きからの公開（options.id）は閲覧条件を付けた後で publishDraft が知らせる。ここで知らせるのは直接の公開だけ。
  if (!options.id) {
    await notifyFollowersSafely(database, {
      id: article.id, authorProfileId: article.authorProfileId, authorName: article.authorName,
      title: article.title, audience: article.audience,
    }, now);
  }
  return { article, duplicate: false };
}

// 読み取り関数は d1-user-article-queries.ts へ移した。既存の呼び出し元のため再公開する。
export { listUserArticles, findUserArticle } from "@/lib/server/d1-user-article-queries";
