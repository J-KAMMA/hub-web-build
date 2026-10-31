import type { D1Database } from "@cloudflare/workers-types";
import { indexD1ContentTags } from "@/lib/server/d1-content-tags";

import type { Profile } from "@/lib/domain";
import { normalizeArticleTags } from "@/lib/article-body";
import { DEFAULT_CONTENT_LICENSE, normalizeContentLicense, type ContentLicenseId } from "@/lib/content-license";
import { attachAccessGate } from "@/lib/server/access-gates";
import { notifyFollowersSafely } from "@/lib/server/d1-user-article-notices";
import {
  UserArticleValidationError,
  PUBLIC_PREFACE_MAX,
  normalizeThumbnailUrl,
  parsePublishInput,
  publishUserArticle,
  type UserArticleAudience,
} from "@/lib/server/d1-user-articles";

/**
 * 記事の下書き・公開後の編集・取り下げ・予約公開の書き込み側。
 *
 * 下書きは hub_user_article_drafts（0244）に置く。公開記事の表へ混ぜないので、
 * 未公開の文章が一覧・検索・推薦・連合へ出る経路が無い。下書きの id は公開時に
 * そのまま記事の id と公開操作の冪等キーになる。
 * 読み取りはここでも自分の下書き・自分の記事だけ。公開側の読み取りは
 * d1-user-article-queries.ts が持つ。
 */

export type ArticleDraft = {
  id: string;
  title: string;
  summary: string;
  body: string;
  publicPreface: string;
  tags: string[];
  thumbnailUrl: string | null;
  coverImageId: string | null;
  audience: UserArticleAudience;
  accessGateId: string | null;
  license: ContentLicenseId;
  publishAt: string | null;
  status: "draft" | "scheduled";
  scheduleError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DraftInput = {
  title: string;
  summary: string;
  body: string;
  publicPreface: string;
  tags: string[];
  coverImageId: string | null;
  audience: UserArticleAudience;
  accessGateId: string | null;
  license: ContentLicenseId;
};

export type OwnArticleSummary = {
  id: string;
  title: string;
  status: "published" | "withdrawn";
  audience: UserArticleAudience;
  createdAt: string;
  updatedAt: string;
  moderated: boolean;
};

export type OwnArticle = OwnArticleSummary & {
  summary: string;
  body: string;
  publicPreface: string;
  tags: string[];
  thumbnailUrl: string | null;
  coverImageId: string | null;
  accessGateId: string | null;
  license: ContentLicenseId;
};

export class UserArticleNotFoundError extends Error {
  constructor() { super("記事が見つかりません。"); this.name = "UserArticleNotFoundError"; }
}

export class UserArticleLimitError extends Error {
  constructor(message: string) { super(message); this.name = "UserArticleLimitError"; }
}

export const DRAFT_LIMIT_PER_AUTHOR = 50;
export const ARTICLE_IMAGE_LIMIT = 40;
const REVISION_KEEP = 50;
const TITLE_MAX = 120;
const SUMMARY_MAX = 400;
const BODY_MAX = 100_000;
const SCHEDULE_MIN_MS = 60 * 1000;
const SCHEDULE_MAX_MS = 366 * 24 * 60 * 60 * 1000;
const IMAGE_ID = /^[A-Za-z0-9_-]{8,80}$/;
const ARTICLE_ID = /^[A-Za-z0-9_-]{1,80}$/;

export function isArticleIdentifier(value: unknown): value is string {
  return typeof value === "string" && ARTICLE_ID.test(value);
}

export function articleImagePath(imageId: string, variant: "full" | "thumbnail" = "full"): string {
  // 本文の画像記法（lib/article-body.ts）は検索文字列なしの道だけを受ける。full は既定。
  return variant === "full" ? `/api/articles/images/${encodeURIComponent(imageId)}` : `/api/articles/images/${encodeURIComponent(imageId)}?variant=${variant}`;
}

function characters(value: string): number {
  return Array.from(value).length;
}

/* ---------- 入力 ---------- */

/** 下書きは空でもよい。上限だけを見る（公開時に parsePublishInput が必須項目を見る）。 */
export function parseDraftInput(payload: unknown): DraftInput {
  const body = (payload ?? {}) as Record<string, unknown>;
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const summary = typeof body.summary === "string" ? body.summary.trim() : "";
  const articleBody = typeof body.body === "string" ? body.body.replaceAll("\r\n", "\n") : "";
  if (characters(title) > TITLE_MAX) throw new UserArticleValidationError(`タイトルは${TITLE_MAX}文字までです。`);
  if (characters(summary) > SUMMARY_MAX) throw new UserArticleValidationError(`要約は${SUMMARY_MAX}文字までです。`);
  if (characters(articleBody) > BODY_MAX) throw new UserArticleValidationError(`本文は${BODY_MAX}文字までです。`);
  const publicPreface = typeof body.publicPreface === "string" ? body.publicPreface.replaceAll("\r\n", "\n") : "";
  if (characters(publicPreface) > PUBLIC_PREFACE_MAX) throw new UserArticleValidationError(`鍵の手前に見せる部分は${PUBLIC_PREFACE_MAX}文字までです。`);
  const coverImageId = body.coverImageId === null || body.coverImageId === undefined || body.coverImageId === ""
    ? null : body.coverImageId;
  if (coverImageId !== null && (typeof coverImageId !== "string" || !IMAGE_ID.test(coverImageId))) {
    throw new UserArticleValidationError("表紙の画像が正しくありません。");
  }
  const gate = body.accessGateId === null || body.accessGateId === undefined || body.accessGateId === ""
    ? null : body.accessGateId;
  if (gate !== null && (typeof gate !== "string" || gate.length > 100 || /[\u0000-\u001f]/.test(gate))) {
    throw new UserArticleValidationError("閲覧条件の指定が正しくありません。");
  }
  const license = normalizeContentLicense(body.license);
  if (!license) throw new UserArticleValidationError("ライセンスの指定が正しくありません。");
  if (gate !== null && license !== DEFAULT_CONTENT_LICENSE) {
    throw new UserArticleValidationError("閲覧条件が付く記事には、CCライセンスを付けられません。");
  }
  return {
    title,
    summary,
    body: articleBody,
    publicPreface,
    tags: normalizeArticleTags(Array.isArray(body.tags) ? body.tags.filter((tag): tag is string => typeof tag === "string") : ""),
    coverImageId: coverImageId as string | null,
    audience: body.audience === "adult" ? "adult" : "general",
    accessGateId: gate as string | null,
    license,
  };
}

/** 予約時刻。1分以上先、1年以内。 */
export function parsePublishAt(value: unknown, now = new Date()): string {
  if (typeof value !== "string") throw new UserArticleValidationError("公開日時を指定してください。");
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new UserArticleValidationError("公開日時が正しくありません。");
  if (time < now.getTime() + SCHEDULE_MIN_MS) throw new UserArticleValidationError("公開日時は1分以上先にしてください。");
  if (time > now.getTime() + SCHEDULE_MAX_MS) throw new UserArticleValidationError("公開日時は1年以内にしてください。");
  return new Date(time).toISOString();
}

/** 表紙のURL。公開記事の表は https の絶対URLしか持てないので、https の面でだけ作る。 */
export function coverUrlFor(origin: string | null, coverImageId: string | null): string | null {
  if (!coverImageId || !origin) return null;
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
    return normalizeThumbnailUrl(`${parsed.origin}${articleImagePath(coverImageId)}`);
  } catch {
    return null;
  }
}

/* ---------- 行 ---------- */

type DraftRow = {
  id: string;
  title: string;
  summary: string;
  body: string;
  public_preface?: string | null;
  tags_json: string;
  thumbnail_url: string | null;
  cover_image_id: string | null;
  audience: string;
  access_gate_id: string | null;
  license: string;
  publish_at: string | null;
  status: string;
  schedule_error: string | null;
  created_at: string;
  updated_at: string;
};

const DRAFT_COLUMNS = `id, title, summary, body, public_preface, tags_json, thumbnail_url, cover_image_id, audience,
  access_gate_id, license, publish_at, status, schedule_error, created_at, updated_at`;

function parseTags(json: string): string[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === "string") : [];
  } catch {
    return [];
  }
}

function mapDraft(row: DraftRow): ArticleDraft {
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    body: row.body,
    publicPreface: row.public_preface ?? "",
    tags: parseTags(row.tags_json),
    thumbnailUrl: row.thumbnail_url,
    coverImageId: row.cover_image_id,
    audience: row.audience === "adult" ? "adult" : "general",
    accessGateId: row.access_gate_id,
    license: normalizeContentLicense(row.license) ?? DEFAULT_CONTENT_LICENSE,
    publishAt: row.publish_at,
    status: row.status === "scheduled" ? "scheduled" : "draft",
    scheduleError: row.schedule_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/* ---------- 画像 ---------- */

async function ownsDraftOrArticle(database: D1Database, profileId: string, targetId: string): Promise<boolean> {
  const row = await database.prepare(`SELECT 1 AS ok FROM hub_user_article_drafts WHERE id = ? AND author_profile_id = ?
    UNION ALL SELECT 1 FROM hub_user_articles WHERE id = ? AND author_profile_id = ? LIMIT 1`)
    .bind(targetId, profileId, targetId, profileId).first<{ ok: number }>();
  return row !== null;
}

/**
 * 既に上げた保留中の画像（POST /api/media/images）を、この下書き・記事の画像にする。
 * 保留のままだと24時間で掃除されるので、公開済みの状態へ進めて付け先を記録する。
 */
export async function claimArticleImage(
  database: D1Database,
  profileId: string,
  targetId: string,
  imageId: string,
): Promise<{ id: string; url: string; width: number; height: number; altText: string }> {
  if (!isArticleIdentifier(targetId) || !IMAGE_ID.test(imageId)) throw new UserArticleValidationError("画像の指定が正しくありません。");
  if (!(await ownsDraftOrArticle(database, profileId, targetId))) throw new UserArticleNotFoundError();
  const count = await database.prepare("SELECT COUNT(*) AS n FROM social_post_images WHERE post_id = ? AND owner_profile_id = ? AND status = 'published'")
    .bind(targetId, profileId).first<{ n: number }>();
  if ((count?.n ?? 0) >= ARTICLE_IMAGE_LIMIT) throw new UserArticleLimitError(`1本の記事に使える画像は${ARTICLE_IMAGE_LIMIT}枚までです。`);
  await database.prepare(`UPDATE social_post_images SET post_id = ?, status = 'published', published_at = ?
      WHERE id = ? AND owner_profile_id = ? AND post_id IS NULL AND status = 'pending'
        AND safety_status = 'clean' AND metadata_stripped_at IS NOT NULL`)
    .bind(targetId, new Date().toISOString(), imageId, profileId).run();
  const row = await database.prepare(`SELECT id, width, height, alt_text FROM social_post_images
      WHERE id = ? AND owner_profile_id = ? AND post_id = ? AND status = 'published'`)
    .bind(imageId, profileId, targetId).first<{ id: string; width: number; height: number; alt_text: string }>();
  if (!row) throw new UserArticleValidationError("この画像は使えません。もう一度アップロードしてください。");
  return { id: row.id, url: articleImagePath(row.id), width: row.width, height: row.height, altText: row.alt_text };
}

async function coverBelongsTo(database: D1Database, profileId: string, targetId: string, imageId: string): Promise<boolean> {
  const row = await database.prepare(`SELECT 1 AS ok FROM social_post_images
      WHERE id = ? AND owner_profile_id = ? AND post_id = ? AND status = 'published'`)
    .bind(imageId, profileId, targetId).first<{ ok: number }>();
  return row !== null;
}

export type ServableArticleImage = {
  objectKey: string;
  thumbnailObjectKey: string | null;
  mimeType: string;
  audience: UserArticleAudience;
};

/**
 * 記事の画像を返してよいか。著者本人は自分の画像を常に見られる（下書きの編集中）。
 * 他の人には、公開中・運営非表示でない記事の画像だけ。閲覧条件の付いた記事の
 * 画像は著者以外へ返さない（条件の確認を画像の経路へ持ち込まず、閉じる側へ倒す）。
 */
export async function findServableArticleImage(
  database: D1Database,
  imageId: string,
  viewerProfileId: string | null,
): Promise<ServableArticleImage | null> {
  if (!IMAGE_ID.test(imageId)) return null;
  const image = await database.prepare(`SELECT object_key, thumbnail_object_key, mime_type, post_id, owner_profile_id
      FROM social_post_images
      WHERE id = ? AND status = 'published' AND safety_status = 'clean'
        AND metadata_stripped_at IS NOT NULL AND post_id IS NOT NULL`)
    .bind(imageId)
    .first<{ object_key: string; thumbnail_object_key: string | null; mime_type: string; post_id: string; owner_profile_id: string }>();
  if (!image) return null;
  const article = await database.prepare("SELECT audience, status, moderated_at, author_profile_id FROM hub_user_articles WHERE id = ?")
    .bind(image.post_id).first<{ audience: string; status: string; moderated_at: string | null; author_profile_id: string }>();
  const owner = viewerProfileId !== null && viewerProfileId === image.owner_profile_id;
  if (!article) {
    // 下書きの画像は本人だけ。
    if (!owner) return null;
    const draft = await database.prepare("SELECT audience FROM hub_user_article_drafts WHERE id = ? AND author_profile_id = ?")
      .bind(image.post_id, viewerProfileId).first<{ audience: string }>();
    if (!draft) return null;
    return { objectKey: image.object_key, thumbnailObjectKey: image.thumbnail_object_key, mimeType: image.mime_type, audience: draft.audience === "adult" ? "adult" : "general" };
  }
  const audience: UserArticleAudience = article.audience === "adult" ? "adult" : "general";
  if (!owner) {
    if (article.status !== "published" || article.moderated_at !== null) return null;
    try {
      const gate = await database.prepare("SELECT 1 AS gated FROM content_access_gates WHERE target_type = 'article' AND target_id = ? LIMIT 1")
        .bind(image.post_id).first<{ gated: number }>();
      if (gate) return null;
    } catch {
      return null;
    }
  }
  return { objectKey: image.object_key, thumbnailObjectKey: image.thumbnail_object_key, mimeType: image.mime_type, audience };
}

/* ---------- 下書き ---------- */

export async function listDrafts(database: D1Database, profileId: string): Promise<ArticleDraft[]> {
  const result = await database.prepare(`SELECT ${DRAFT_COLUMNS} FROM hub_user_article_drafts
      WHERE author_profile_id = ? ORDER BY updated_at DESC, id DESC LIMIT ${DRAFT_LIMIT_PER_AUTHOR}`)
    .bind(profileId).all<DraftRow>();
  return (result.results ?? []).map(mapDraft);
}

export async function getDraft(database: D1Database, profileId: string, id: string): Promise<ArticleDraft | null> {
  if (!isArticleIdentifier(id)) return null;
  const row = await database.prepare(`SELECT ${DRAFT_COLUMNS} FROM hub_user_article_drafts WHERE id = ? AND author_profile_id = ?`)
    .bind(id, profileId).first<DraftRow>();
  return row ? mapDraft(row) : null;
}

export async function createDraft(
  database: D1Database,
  profileId: string,
  input: DraftInput,
  now = new Date(),
): Promise<ArticleDraft> {
  const count = await database.prepare("SELECT COUNT(*) AS n FROM hub_user_article_drafts WHERE author_profile_id = ?")
    .bind(profileId).first<{ n: number }>();
  if ((count?.n ?? 0) >= DRAFT_LIMIT_PER_AUTHOR) {
    throw new UserArticleLimitError(`下書きは${DRAFT_LIMIT_PER_AUTHOR}本までです。不要な下書きを消してください。`);
  }
  // 画像は下書きができてから付くので、作る時点の表紙は受けない。
  const id = crypto.randomUUID();
  const timestamp = now.toISOString();
  await database.prepare(`INSERT INTO hub_user_article_drafts (
      id, author_profile_id, title, summary, body, public_preface, tags_json, thumbnail_url, cover_image_id,
      audience, access_gate_id, license, publish_at, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, NULL, 'draft', ?, ?)`)
    .bind(id, profileId, input.title, input.summary, input.body, input.publicPreface, JSON.stringify(input.tags),
      input.audience, input.accessGateId, input.license, timestamp, timestamp)
    .run();
  const draft = await getDraft(database, profileId, id);
  if (!draft) throw new Error("下書きを読み戻せませんでした。");
  return draft;
}

export async function saveDraft(
  database: D1Database,
  profileId: string,
  id: string,
  input: DraftInput,
  options: { origin: string | null; now?: Date },
): Promise<ArticleDraft> {
  const existing = await getDraft(database, profileId, id);
  if (!existing) throw new UserArticleNotFoundError();
  if (input.coverImageId && !(await coverBelongsTo(database, profileId, id, input.coverImageId))) {
    throw new UserArticleValidationError("表紙の画像が見つかりません。もう一度アップロードしてください。");
  }
  await database.prepare(`UPDATE hub_user_article_drafts SET title = ?, summary = ?, body = ?, public_preface = ?, tags_json = ?,
      thumbnail_url = ?, cover_image_id = ?, audience = ?, access_gate_id = ?, license = ?, updated_at = ?
      WHERE id = ? AND author_profile_id = ?`)
    .bind(input.title, input.summary, input.body, input.publicPreface, JSON.stringify(input.tags),
      coverUrlFor(options.origin, input.coverImageId), input.coverImageId, input.audience, input.accessGateId, input.license,
      (options.now ?? new Date()).toISOString(), id, profileId)
    .run();
  const draft = await getDraft(database, profileId, id);
  if (!draft) throw new UserArticleNotFoundError();
  return draft;
}

/** 下書きを消す。付けた画像は掃除の対象へ回す。 */
export async function deleteDraft(database: D1Database, profileId: string, id: string): Promise<boolean> {
  if (!isArticleIdentifier(id)) return false;
  const result = await database.batch([
    database.prepare(`UPDATE social_post_images SET status = 'deleted'
      WHERE post_id = ? AND owner_profile_id = ?
        AND NOT EXISTS (SELECT 1 FROM hub_user_articles WHERE id = ?)
        AND EXISTS (SELECT 1 FROM hub_user_article_drafts WHERE id = ? AND author_profile_id = ?)`)
      .bind(id, profileId, id, id, profileId),
    database.prepare("DELETE FROM hub_user_article_drafts WHERE id = ? AND author_profile_id = ?").bind(id, profileId),
  ]);
  return Number(result[1]?.meta?.changes ?? 0) > 0;
}

/** 公開の予約。内容が公開できる形かをここで確かめ、時刻を持たせる。 */
export async function scheduleDraft(
  database: D1Database,
  profileId: string,
  id: string,
  publishAt: string,
  now = new Date(),
): Promise<ArticleDraft> {
  const draft = await getDraft(database, profileId, id);
  if (!draft) throw new UserArticleNotFoundError();
  assertPublishable(draft);
  const at = parsePublishAt(publishAt, now);
  await database.prepare(`UPDATE hub_user_article_drafts SET status = 'scheduled', publish_at = ?, schedule_error = NULL, updated_at = ?
      WHERE id = ? AND author_profile_id = ?`)
    .bind(at, now.toISOString(), id, profileId).run();
  const next = await getDraft(database, profileId, id);
  if (!next) throw new UserArticleNotFoundError();
  return next;
}

export async function unscheduleDraft(database: D1Database, profileId: string, id: string, now = new Date()): Promise<ArticleDraft> {
  const result = await database.prepare(`UPDATE hub_user_article_drafts SET status = 'draft', publish_at = NULL, updated_at = ?
      WHERE id = ? AND author_profile_id = ?`)
    .bind(now.toISOString(), id, profileId).run();
  if (!Number(result.meta.changes ?? 0)) throw new UserArticleNotFoundError();
  const draft = await getDraft(database, profileId, id);
  if (!draft) throw new UserArticleNotFoundError();
  return draft;
}

function publishPayload(draft: ArticleDraft) {
  return {
    title: draft.title,
    summary: draft.summary,
    body: draft.body,
    publicPreface: draft.publicPreface,
    tags: draft.tags,
    thumbnailUrl: draft.thumbnailUrl,
    audience: draft.audience,
    clientRequestId: draft.id,
  };
}

function assertPublishable(draft: ArticleDraft) {
  parsePublishInput(publishPayload(draft));
}

export type PublishedFromDraft = { id: string; audience: UserArticleAudience; duplicate: boolean };

/**
 * 下書きを公開する。下書きの id が記事の id と冪等キーになるので、再送しても記事は1本。
 * 閲覧条件は公開の直後に同じ処理の中で付ける。付けられなければ記事を残さず
 * 失敗にする（条件付きのつもりの本文が一瞬でも誰にでも読める状態で残らない）。
 */
export async function publishDraft(
  database: D1Database,
  author: Pick<Profile, "id" | "joinedAt">,
  id: string,
  now = new Date(),
): Promise<PublishedFromDraft> {
  if (!isArticleIdentifier(id)) throw new UserArticleNotFoundError();
  const done = await database.prepare("SELECT id, audience FROM hub_user_articles WHERE id = ? AND author_profile_id = ? AND client_request_id = ?")
    .bind(id, author.id, id).first<{ id: string; audience: string }>();
  if (done) {
    await database.prepare("DELETE FROM hub_user_article_drafts WHERE id = ? AND author_profile_id = ?").bind(id, author.id).run();
    return { id: done.id, audience: done.audience === "adult" ? "adult" : "general", duplicate: true };
  }
  const draft = await getDraft(database, author.id, id);
  if (!draft) throw new UserArticleNotFoundError();
  const input = parsePublishInput(publishPayload(draft));
  // A gated article stays all rights reserved (checked again by the database).
  if (draft.accessGateId && draft.license !== DEFAULT_CONTENT_LICENSE) {
    throw new UserArticleValidationError("閲覧条件が付く記事には、CCライセンスを付けられません。");
  }
  const { article, duplicate } = await publishUserArticle(database, author, input, now, { id });
  if (draft.license !== DEFAULT_CONTENT_LICENSE) {
    await database.prepare(`INSERT INTO content_licenses (target_type, target_id, license, updated_at) VALUES ('article', ?, ?, ?)
        ON CONFLICT(target_type, target_id) DO UPDATE SET license = excluded.license, updated_at = excluded.updated_at`)
      .bind(article.id, draft.license, now.toISOString()).run();
  }
  if (draft.accessGateId) {
    try {
      await attachAccessGate(database, author.id, { targetType: "article", targetId: article.id }, draft.accessGateId);
    } catch (error) {
      if (!duplicate) await database.prepare("DELETE FROM hub_user_articles WHERE id = ? AND author_profile_id = ?").bind(article.id, author.id).run();
      if (error instanceof Error && /権限|見つかりません|門/.test(error.message)) {
        throw new UserArticleValidationError("閲覧条件を付けられませんでした。条件を選び直してください。");
      }
      throw error;
    }
  }
  await database.prepare("DELETE FROM hub_user_article_drafts WHERE id = ? AND author_profile_id = ?").bind(id, author.id).run();
  // 閲覧条件を付け終えた後に、フォロワーへ1回だけ知らせる。再送（duplicate）では知らせない。
  if (!duplicate) {
    await notifyFollowersSafely(database, {
      id: article.id, authorProfileId: article.authorProfileId, authorName: article.authorName,
      title: article.title, audience: article.audience,
    }, now);
  }
  return { id: article.id, audience: article.audience, duplicate };
}

/**
 * 予約の時刻を過ぎた下書きを公開する（定期処理）。公開できなかったものは
 * 下書きへ戻して理由を残し、他の予約を止めない。
 */
export async function publishDueArticleDrafts(
  database: D1Database,
  now = new Date(),
  limit = 20,
): Promise<{ due: number; published: number; failed: number }> {
  const bounded = Math.min(50, Math.max(1, Math.trunc(limit)));
  const due = await database.prepare(`SELECT d.id AS id, d.author_profile_id AS author_id, p.joined_at AS joined_at
      FROM hub_user_article_drafts d JOIN profiles p ON p.id = d.author_profile_id
      WHERE d.status = 'scheduled' AND d.publish_at <= ? ORDER BY d.publish_at LIMIT ${bounded}`)
    .bind(now.toISOString()).all<{ id: string; author_id: string; joined_at: string }>();
  let published = 0;
  let failed = 0;
  for (const row of due.results ?? []) {
    try {
      await publishDraft(database, { id: row.author_id, joinedAt: row.joined_at }, row.id, now);
      published += 1;
    } catch (error) {
      failed += 1;
      const reason = error instanceof Error ? error.message.slice(0, 200) : "公開できませんでした。";
      await database.prepare(`UPDATE hub_user_article_drafts SET status = 'draft', publish_at = NULL, schedule_error = ?, updated_at = ?
          WHERE id = ? AND status = 'scheduled'`)
        .bind(reason, now.toISOString(), row.id).run();
    }
  }
  return { due: (due.results ?? []).length, published, failed };
}

/* ---------- 公開後の記事（自分の） ---------- */

type OwnArticleRow = {
  id: string; title: string; summary: string; body: string; public_preface?: string | null; tags_json: string; thumbnail_url: string | null;
  audience: string; status: string; moderated_at: string | null; created_at: string; updated_at: string;
};

function mapOwn(row: OwnArticleRow): OwnArticle {
  const prefix = "/api/articles/images/";
  let coverImageId: string | null = null;
  if (row.thumbnail_url) {
    try {
      const parsed = new URL(row.thumbnail_url);
      if (parsed.pathname.startsWith(prefix)) coverImageId = decodeURIComponent(parsed.pathname.slice(prefix.length));
    } catch { /* 外部URLの表紙 */ }
  }
  return {
    id: row.id, title: row.title, status: row.status === "withdrawn" ? "withdrawn" : "published",
    audience: row.audience === "adult" ? "adult" : "general",
    createdAt: row.created_at, updatedAt: row.updated_at, moderated: row.moderated_at !== null,
    summary: row.summary, body: row.body, publicPreface: row.public_preface ?? "", tags: parseTags(row.tags_json), thumbnailUrl: row.thumbnail_url,
    coverImageId, accessGateId: null, license: DEFAULT_CONTENT_LICENSE,
  };
}

export async function listOwnArticles(database: D1Database, profileId: string, limit = 100): Promise<OwnArticleSummary[]> {
  const result = await database.prepare(`SELECT id, title, summary, body, tags_json, thumbnail_url, audience, status, moderated_at, created_at, updated_at
      FROM hub_user_articles WHERE author_profile_id = ? ORDER BY updated_at DESC, id DESC LIMIT ?`)
    .bind(profileId, Math.min(Math.max(1, limit), 200)).all<OwnArticleRow>();
  return (result.results ?? []).map((row): OwnArticleSummary => {
    const own = mapOwn(row);
    return {
      id: own.id, title: own.title, status: own.status, audience: own.audience,
      createdAt: own.createdAt, updatedAt: own.updatedAt, moderated: own.moderated,
    };
  });
}

export async function getOwnArticle(database: D1Database, profileId: string, id: string): Promise<OwnArticle | null> {
  if (!isArticleIdentifier(id)) return null;
  const row = await database.prepare(`SELECT id, title, summary, body, public_preface, tags_json, thumbnail_url, audience, status, moderated_at, created_at, updated_at
      FROM hub_user_articles WHERE id = ? AND author_profile_id = ?`)
    .bind(id, profileId).first<OwnArticleRow>();
  if (!row) return null;
  const article = mapOwn(row);
  try {
    const gate = await database.prepare("SELECT gate_id FROM content_access_gates WHERE target_type = 'article' AND target_id = ?")
      .bind(id).first<{ gate_id: string }>();
    article.accessGateId = gate?.gate_id ?? null;
  } catch { /* 門の表が無い環境 */ }
  try {
    const licensed = await database.prepare("SELECT license FROM content_licenses WHERE target_type = 'article' AND target_id = ? LIMIT 1")
      .bind(id).first<{ license: string }>();
    article.license = normalizeContentLicense(licensed?.license) ?? DEFAULT_CONTENT_LICENSE;
  } catch { /* ライセンスの表が無い環境 */ }
  return article;
}

function revisionStatement(database: D1Database, articleId: string, profileId: string, reason: "edit" | "unpublish" | "republish", now: string) {
  return database.prepare(`INSERT INTO hub_user_article_revisions (
      id, article_id, author_profile_id, revision, reason, title, summary, body, tags_json, thumbnail_url, audience, status, created_at)
    SELECT ?, a.id, a.author_profile_id,
      (SELECT COALESCE(MAX(revision), 0) + 1 FROM hub_user_article_revisions WHERE article_id = a.id),
      ?, a.title, a.summary, a.body, a.tags_json, a.thumbnail_url, a.audience, a.status, ?
    FROM hub_user_articles a WHERE a.id = ? AND a.author_profile_id = ?`)
    .bind(crypto.randomUUID(), reason, now, articleId, profileId);
}

function pruneRevisionsStatement(database: D1Database, articleId: string) {
  return database.prepare(`DELETE FROM hub_user_article_revisions WHERE article_id = ? AND revision <= (
      SELECT COALESCE(MAX(revision), 0) - ${REVISION_KEEP} FROM hub_user_article_revisions WHERE article_id = ?)`)
    .bind(articleId, articleId);
}

/**
 * 公開中の記事を直す。直前の内容を履歴に残してから上書きする（同じ batch の中）。
 * 公開日時・著者・冪等キーは変えない。運営が非表示にした記事は直せない。
 */
export async function updateUserArticle(
  database: D1Database,
  profileId: string,
  id: string,
  payload: unknown,
  options: { origin: string | null; now?: Date },
): Promise<OwnArticle> {
  const current = await getOwnArticle(database, profileId, id);
  if (!current) throw new UserArticleNotFoundError();
  if (current.moderated) throw new UserArticleValidationError("運営が非表示にした記事は編集できません。");
  if (current.status !== "published") throw new UserArticleValidationError("取り下げた記事は編集できません。");
  const body = (payload ?? {}) as Record<string, unknown>;
  const coverImageId = typeof body.coverImageId === "string" && body.coverImageId ? body.coverImageId : null;
  if (coverImageId !== null && !IMAGE_ID.test(coverImageId)) throw new UserArticleValidationError("表紙の画像が正しくありません。");
  if (coverImageId && !(await coverBelongsTo(database, profileId, id, coverImageId))) {
    throw new UserArticleValidationError("表紙の画像が見つかりません。もう一度アップロードしてください。");
  }
  const thumbnailUrl = coverImageId
    ? coverUrlFor(options.origin, coverImageId)
    : (Object.hasOwn(body, "coverImageId") ? null : normalizeThumbnailUrl(body.thumbnailUrl ?? current.thumbnailUrl));
  const input = parsePublishInput({
    title: body.title, summary: body.summary, body: body.body, tags: body.tags,
    publicPreface: Object.hasOwn(body, "publicPreface") ? body.publicPreface : current.publicPreface,
    audience: body.audience ?? current.audience, thumbnailUrl, clientRequestId: null,
  });
  const timestamp = (options.now ?? new Date()).toISOString();
  await database.batch([
    revisionStatement(database, id, profileId, "edit", timestamp),
    database.prepare(`UPDATE hub_user_articles SET title = ?, summary = ?, body = ?, public_preface = ?, tags_json = ?, thumbnail_url = ?, audience = ?, updated_at = ?
        WHERE id = ? AND author_profile_id = ? AND status = 'published' AND moderated_at IS NULL`)
      .bind(input.title, input.summary, input.body, input.publicPreface ?? "", JSON.stringify(input.tags), input.thumbnailUrl, input.audience, timestamp, id, profileId),
    pruneRevisionsStatement(database, id),
  ]);
  await indexD1ContentTags(database, "user_article", id, input.tags);
  const article = await getOwnArticle(database, profileId, id);
  if (!article) throw new UserArticleNotFoundError();
  return article;
}

/** 取り下げる。記事は消さず status='withdrawn' にし、直前の内容を履歴へ残す。 */
export async function withdrawUserArticle(database: D1Database, profileId: string, id: string, now = new Date()): Promise<boolean> {
  const current = await getOwnArticle(database, profileId, id);
  if (!current) throw new UserArticleNotFoundError();
  if (current.status === "withdrawn") return false;
  const timestamp = now.toISOString();
  const results = await database.batch([
    revisionStatement(database, id, profileId, "unpublish", timestamp),
    database.prepare(`UPDATE hub_user_articles SET status = 'withdrawn', updated_at = ?
        WHERE id = ? AND author_profile_id = ? AND status = 'published'`)
      .bind(timestamp, id, profileId),
    pruneRevisionsStatement(database, id),
  ]);
  return Number(results[1]?.meta?.changes ?? 0) > 0;
}

export async function listArticleRevisions(database: D1Database, profileId: string, id: string, limit = 20) {
  const result = await database.prepare(`SELECT revision, reason, title, created_at FROM hub_user_article_revisions
      WHERE article_id = ? AND author_profile_id = ? ORDER BY revision DESC LIMIT ?`)
    .bind(id, profileId, Math.min(Math.max(1, limit), 50)).all<{ revision: number; reason: string; title: string; created_at: string }>();
  return (result.results ?? []).map((row) => ({ revision: row.revision, reason: row.reason, title: row.title, createdAt: row.created_at }));
}
