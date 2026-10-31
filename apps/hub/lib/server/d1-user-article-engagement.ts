import type { D1Database } from "@cloudflare/workers-types";

import type { Profile } from "@/lib/domain";
import { createD1HubNotification } from "@/lib/server/d1-notification-events";
import { checkTargetGateStatus } from "@/lib/server/gated-content";
import { recordArticleLike } from "@/lib/server/d1-user-article-stats";
import { GATED_NOTIFICATION_TEXT, isTargetGated } from "@/lib/server/gated-exits";
import { requireNoD1BlockBetween } from "@/lib/server/profile-blocks";
import { isNewHubAccount } from "@/lib/thread-abuse-controls";

/*
 * 記事のいいね・コメント（レーンD）。
 * - いいねは reactions（target_type='user_article'）。数は誰にでも見せる。
 *   いいねは書き手へ匿名で通知する（0135 の方針）。
 * - コメントは hub_user_article_comments。記事ごとに書き手がオフにできる（既定はオン）。
 *   削除できるのはコメント本人・記事の書き手・運営。
 * - 鍵付きの記事は、条件を満たす閲覧者だけが見て・書ける。判定できなければ閉じる。
 */

export const COMMENT_MAX_LENGTH = 2000;
export const COMMENT_PAGE_SIZE = 20;
export const COMMENT_REPORT_REASON_MAX = 300;
const ARTICLE_TARGET = "user_article";
const IDENTIFIER = /^[A-Za-z0-9_-]{1,80}$/;

export class ArticleEngagementNotFoundError extends Error {
  constructor(message = "記事が見つかりません。") { super(message); this.name = "ArticleEngagementNotFoundError"; }
}
export class ArticleEngagementValidationError extends Error {
  constructor(message: string) { super(message); this.name = "ArticleEngagementValidationError"; }
}
export class ArticleEngagementForbiddenError extends Error {
  constructor(message: string) { super(message); this.name = "ArticleEngagementForbiddenError"; }
}
export class ArticleCommentRateLimitError extends Error {
  constructor(public readonly retryAfterSeconds: number, what = "コメント") {
    super(`${what}が集中しています。約${Math.max(1, Math.ceil(retryAfterSeconds / 60))}分後にもう一度お試しください。`);
    this.name = "ArticleCommentRateLimitError";
  }
}

export function isEngagementArticleId(value: unknown): value is string {
  return typeof value === "string" && IDENTIFIER.test(value);
}

type ArticleRow = { id: string; author_profile_id: string };

/** 公開中・一般区分・運営が隠していない記事。 */
async function visibleArticle(database: D1Database, articleId: string): Promise<ArticleRow | null> {
  if (!isEngagementArticleId(articleId)) return null;
  return database.prepare(`SELECT id, author_profile_id FROM hub_user_articles
      WHERE id = ? AND status = 'published' AND audience = 'general' AND moderated_at IS NULL`)
    .bind(articleId).first<ArticleRow>();
}

/** 鍵が無い、または閲覧者が満たしている。判定できないときは閉じる。 */
export async function viewerPassesGate(database: D1Database, articleId: string, viewerProfileId: string | null): Promise<boolean> {
  try {
    if (!(await isTargetGated(database, "article", articleId))) return true;
    if (!viewerProfileId) return false;
    return (await checkTargetGateStatus(database, viewerProfileId, { targetType: "article", targetId: articleId })) === "open";
  } catch {
    return false;
  }
}

async function suspended(database: D1Database, profileId: string): Promise<boolean> {
  return Boolean(await database.prepare(`SELECT 1 AS s FROM profile_moderation_status
      WHERE profile_id = ? AND status = 'suspended' LIMIT 1`).bind(profileId).first());
}

/* ------------------------------------------------------------------ */
/* いいね                                                              */
/* ------------------------------------------------------------------ */

export type LikeState = { likeCount: number; liked: boolean };

export async function likeCountsForArticles(database: D1Database, articleIds: readonly string[]): Promise<Map<string, number>> {
  const ids = [...new Set(articleIds.filter(isEngagementArticleId))];
  const counts = new Map<string, number>();
  if (ids.length === 0) return counts;
  try {
    for (let offset = 0; offset < ids.length; offset += 80) {
      const chunk = ids.slice(offset, offset + 80);
      const result = await database.prepare(`SELECT target_id, COUNT(*) AS n FROM reactions
          WHERE target_type = '${ARTICLE_TARGET}' AND kind = 'like' AND target_id IN (${chunk.map(() => "?").join(",")})
          GROUP BY target_id`)
        .bind(...chunk).all<{ target_id: string; n: number }>();
      for (const row of result.results ?? []) counts.set(row.target_id, Number(row.n));
    }
  } catch { /* 反応の表が無い環境では 0 として扱う */ }
  return counts;
}

export async function getLikeState(database: D1Database, articleId: string, viewerProfileId: string | null): Promise<LikeState> {
  const [count, mine] = await Promise.all([
    database.prepare(`SELECT COUNT(*) AS n FROM reactions WHERE target_type = '${ARTICLE_TARGET}' AND target_id = ? AND kind = 'like'`)
      .bind(articleId).first<{ n: number }>(),
    viewerProfileId
      ? database.prepare(`SELECT 1 AS x FROM reactions WHERE target_type = '${ARTICLE_TARGET}' AND target_id = ? AND profile_id = ?`)
        .bind(articleId, viewerProfileId).first()
      : Promise.resolve(null),
  ]);
  return { likeCount: Number(count?.n ?? 0), liked: Boolean(mine) };
}

const LIKE_WINDOW_MS = 10 * 60 * 1000;

async function consumeLikeQuota(database: D1Database, profile: Pick<Profile, "id" | "joinedAt">, now: Date) {
  // 他の反応と同じ枠（hub_reaction_rate_limit_buckets）を使う。
  const limit = isNewHubAccount({ joinedAt: profile.joinedAt }, now) ? 5 : 20;
  const windowStartMs = Math.floor(now.getTime() / LIKE_WINDOW_MS) * LIKE_WINDOW_MS;
  const result = await database.prepare(`INSERT INTO hub_reaction_rate_limit_buckets
      (profile_id, window_started_at, request_count, expires_at) VALUES (?, ?, 1, ?)
      ON CONFLICT(profile_id, window_started_at) DO UPDATE SET request_count = request_count + 1
      WHERE request_count < ?`)
    .bind(profile.id, new Date(windowStartMs).toISOString(), new Date(windowStartMs + LIKE_WINDOW_MS).toISOString(), limit).run();
  if (!result.meta.changes) {
    throw new ArticleCommentRateLimitError(Math.max(1, Math.ceil((windowStartMs + LIKE_WINDOW_MS - now.getTime()) / 1000)), "反応");
  }
}

/** いいねを付ける／外す。希望の状態を送る形なので何度送っても同じ結果になる。 */
export async function setArticleLike(
  database: D1Database,
  profile: Pick<Profile, "id" | "joinedAt">,
  articleId: string,
  liked: boolean,
  now = new Date(),
): Promise<LikeState> {
  if (!liked) {
    await database.prepare(`DELETE FROM reactions WHERE target_type = '${ARTICLE_TARGET}' AND target_id = ? AND profile_id = ?`)
      .bind(articleId, profile.id).run();
    return getLikeState(database, articleId, profile.id);
  }
  const article = await visibleArticle(database, articleId);
  if (!article) throw new ArticleEngagementNotFoundError();
  if (article.author_profile_id === profile.id) throw new ArticleEngagementForbiddenError("自分の記事にはいいねできません。");
  if (await suspended(database, profile.id)) throw new ArticleEngagementForbiddenError("このアカウントは現在、反応できません。");
  await requireNoD1BlockBetween(database, profile.id, article.author_profile_id);
  if (!(await viewerPassesGate(database, articleId, profile.id))) throw new ArticleEngagementForbiddenError("閲覧条件を満たすと反応できます。");

  const existing = await database.prepare(`SELECT id FROM reactions WHERE target_type = '${ARTICLE_TARGET}' AND target_id = ? AND profile_id = ?`)
    .bind(articleId, profile.id).first();
  if (!existing) {
    await consumeLikeQuota(database, profile, now);
    const inserted = await database.prepare(`INSERT INTO reactions (id, target_type, target_id, profile_id, kind, created_at)
        VALUES (?, '${ARTICLE_TARGET}', ?, ?, 'like', ?)
        ON CONFLICT(profile_id, target_type, target_id) DO NOTHING`)
      .bind(crypto.randomUUID(), articleId, profile.id, now.toISOString()).run();
    if (inserted.meta.changes) {
      // いいねは書き手へ匿名で届ける（actor は残さない）。記事ごとに通知は1件。
      await notifyAuthor(database, article.author_profile_id, articleId, null, "like", now);
      await recordArticleLike(database, articleId, now);
    }
  }
  return getLikeState(database, articleId, profile.id);
}

type NoticeKind = "like" | "comment" | "reply" | "comment-like";

/** 通知の設定（notification_preferences）。行が無い・読めないときは受け取る側に倒す。 */
async function noticeAllowed(database: D1Database, receiverProfileId: string, kind: NoticeKind): Promise<boolean> {
  if (kind !== "reply" && kind !== "comment-like") return true;
  try {
    const row = await database.prepare("SELECT replies_enabled, reactions_enabled FROM notification_preferences WHERE profile_id = ? LIMIT 1")
      .bind(receiverProfileId).first<{ replies_enabled: number; reactions_enabled: number }>();
    if (!row) return true;
    return Number(kind === "reply" ? row.replies_enabled : row.reactions_enabled) === 1;
  } catch {
    return true;
  }
}

/** 日本時間の日付。コメントへのいいね通知は、コメントごとに1日1件までにする。 */
function jstDay(now: Date): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function notifyAuthor(
  database: D1Database,
  receiverProfileId: string,
  articleId: string,
  actorProfileId: string | null,
  kind: NoticeKind,
  now: Date,
  dedupeSuffix = "",
) {
  try {
    if (!(await noticeAllowed(database, receiverProfileId, kind))) return;
    // 鍵付きの記事は一般的な文面だけ。コメントの引用は載せない。
    const gated = await isTargetGated(database, "article", articleId).catch(() => true);
    const plain: Record<NoticeKind, string> = {
      like: "あなたの記事にいいねが付きました。",
      comment: "あなたの記事にコメントが届きました。",
      reply: "あなたのコメントに返信が届きました。",
      "comment-like": "あなたのコメントにいいねが付きました。",
    };
    await createD1HubNotification(database, {
      receiverProfileId,
      actorProfileId,
      text: gated ? GATED_NOTIFICATION_TEXT : plain[kind],
      route: `/articles/${encodeURIComponent(articleId)}`,
      dedupeKey: `article-${kind}:${articleId}${dedupeSuffix}`,
      createdAt: now.toISOString(),
    });
  } catch { /* 通知に失敗しても反応そのものは成立させる */ }
}

/* ------------------------------------------------------------------ */
/* コメントの受け付け設定                                              */
/* ------------------------------------------------------------------ */

export async function commentsEnabledFor(database: D1Database, articleId: string): Promise<boolean> {
  const row = await database.prepare("SELECT comments_enabled FROM hub_user_article_comment_settings WHERE article_id = ?")
    .bind(articleId).first<{ comments_enabled: number }>().catch(() => null);
  return row ? Number(row.comments_enabled) === 1 : true;
}

async function ownsArticleOrDraft(database: D1Database, profileId: string, id: string): Promise<boolean> {
  const article = await database.prepare("SELECT 1 AS x FROM hub_user_articles WHERE id = ? AND author_profile_id = ?").bind(id, profileId).first();
  if (article) return true;
  const draft = await database.prepare("SELECT 1 AS x FROM hub_user_article_drafts WHERE id = ? AND author_profile_id = ?").bind(id, profileId).first().catch(() => null);
  return Boolean(draft);
}

/** 書き手本人だけ。下書きのidでも設定でき、公開後もそのまま引き継がれる。 */
export async function setCommentsEnabled(database: D1Database, profileId: string, id: string, enabled: boolean, now = new Date()): Promise<boolean> {
  if (!isEngagementArticleId(id) || !(await ownsArticleOrDraft(database, profileId, id))) throw new ArticleEngagementNotFoundError();
  await database.prepare(`INSERT INTO hub_user_article_comment_settings (article_id, owner_profile_id, comments_enabled, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(article_id) DO UPDATE SET comments_enabled = excluded.comments_enabled, updated_at = excluded.updated_at
      WHERE owner_profile_id = excluded.owner_profile_id`)
    .bind(id, profileId, enabled ? 1 : 0, now.toISOString()).run();
  return enabled;
}

export async function getCommentsEnabledForOwner(database: D1Database, profileId: string, id: string): Promise<boolean> {
  if (!isEngagementArticleId(id) || !(await ownsArticleOrDraft(database, profileId, id))) throw new ArticleEngagementNotFoundError();
  return commentsEnabledFor(database, id);
}

/* ------------------------------------------------------------------ */
/* コメント                                                            */
/* ------------------------------------------------------------------ */

export type ArticleComment = {
  id: string;
  body: string;
  createdAt: string;
  author: { id: string; handle: string; displayName: string; avatarUrl: string | null };
  mine: boolean;
  /** 本人・記事の書き手なら true。運営の削除は経路側（管理セッション）で別に判断する。 */
  canDelete: boolean;
  /** 返信なら最上位コメントのid。最上位は null（深さは1段まで）。 */
  parentId: string | null;
  /** 削除済み。返信が残っているときだけ「削除されたコメント」として親の位置に出る。本文と書き手は空。 */
  removed: boolean;
  /** 書き手がピン留めした1件。 */
  pinned: boolean;
  likeCount: number;
  liked: boolean;
  /** 最上位コメントだけが持つ。古い順。 */
  replies: ArticleComment[];
};

export type ArticleCommentPage = { comments: ArticleComment[]; nextCursor: string | null; total: number };

type CommentRow = {
  id: string; body: string; status: string; created_at: string; author_profile_id: string; parent_id: string | null;
  handle: string; display_name: string; avatar_url: string | null;
};

export function encodeCommentCursor(createdAt: string, id: string): string {
  return `${createdAt}|${id}`;
}

export function decodeCommentCursor(value: unknown): { createdAt: string; id: string } | null {
  if (typeof value !== "string" || value.length > 120) return null;
  const [createdAt, id] = value.split("|");
  if (!createdAt || !id || !Number.isFinite(Date.parse(createdAt)) || !IDENTIFIER.test(id)) return null;
  return { createdAt, id };
}

/** 凍結中の書き手、閲覧者がミュート・ブロックした相手、閲覧者をブロックした相手の発言を除く条件。bind は (viewer, viewer)。 */
function visibleAuthorSql(alias: string): string {
  return `NOT EXISTS (SELECT 1 FROM profile_moderation_status s WHERE s.profile_id = ${alias}.author_profile_id AND s.status = 'suspended')
      AND NOT EXISTS (
        SELECT 1 FROM thread_user_controls control
        WHERE (control.owner_profile_id = ? AND control.target_profile_id = ${alias}.author_profile_id AND (control.muted = 1 OR control.blocked = 1))
          OR (control.owner_profile_id = ${alias}.author_profile_id AND control.target_profile_id = ? AND control.blocked = 1)
      )`;
}

const COMMENT_COLUMNS = "c.id, c.body, c.status, c.created_at, c.author_profile_id, c.parent_id, p.handle, p.display_name, p.avatar_url";
const REPLY_FETCH_LIMIT = 1000;

function chunked<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let offset = 0; offset < items.length; offset += size) out.push(items.slice(offset, offset + size));
  return out;
}

/** コメントごとのいいね数と、閲覧者が付けたか。 */
async function commentLikeInfo(database: D1Database, ids: readonly string[], viewerProfileId: string | null) {
  const counts = new Map<string, number>();
  const mine = new Set<string>();
  for (const chunk of chunked([...new Set(ids)], 80)) {
    const marks = chunk.map(() => "?").join(",");
    const result = await database.prepare(`SELECT comment_id, COUNT(*) AS n FROM hub_user_article_comment_likes
        WHERE comment_id IN (${marks}) GROUP BY comment_id`).bind(...chunk).all<{ comment_id: string; n: number }>();
    for (const row of result.results ?? []) counts.set(row.comment_id, Number(row.n));
    if (viewerProfileId) {
      const own = await database.prepare(`SELECT comment_id FROM hub_user_article_comment_likes
          WHERE profile_id = ? AND comment_id IN (${marks})`).bind(viewerProfileId, ...chunk).all<{ comment_id: string }>();
      for (const row of own.results ?? []) mine.add(row.comment_id);
    }
  }
  return { counts, mine };
}

async function pinnedCommentId(database: D1Database, articleId: string): Promise<string | null> {
  const row = await database.prepare("SELECT pinned_comment_id FROM hub_user_article_comment_settings WHERE article_id = ?")
    .bind(articleId).first<{ pinned_comment_id: string | null }>().catch(() => null);
  return row?.pinned_comment_id ?? null;
}

/**
 * コメントを古い順に1ページ（最上位コメント単位）。返信は親の下にまとめて返す。
 * ピン留めは最初のページの先頭に1件だけ置き、以降のページには出さない。
 * 削除済みの親は、見える返信があるときだけ「削除されたコメント」として残す。
 * ミュート・ブロックした相手と、凍結中の書き手の発言は出さない（その人の親コメントの下の返信も出さない）。
 * 鍵付きの記事で条件を満たさない閲覧者には、中身を返さず 403 相当の例外にする。
 */
export async function listArticleComments(
  database: D1Database,
  articleId: string,
  viewerProfileId: string | null,
  options: { cursor?: string | null; limit?: number } = {},
): Promise<ArticleCommentPage> {
  const article = await visibleArticle(database, articleId);
  if (!article) throw new ArticleEngagementNotFoundError();
  if (!(await viewerPassesGate(database, articleId, viewerProfileId))) {
    throw new ArticleEngagementForbiddenError("閲覧条件を満たすとコメントを読めます。");
  }
  const limit = Math.max(1, Math.min(COMMENT_PAGE_SIZE, Math.trunc(options.limit ?? COMMENT_PAGE_SIZE)));
  const cursor = decodeCommentCursor(options.cursor);
  const viewer = viewerProfileId ?? "";
  const pinnedId = await pinnedCommentId(database, articleId);

  const pinnedRows: CommentRow[] = pinnedId && !cursor
    ? (await database.prepare(`SELECT ${COMMENT_COLUMNS} FROM hub_user_article_comments c JOIN profiles p ON p.id = c.author_profile_id
        WHERE c.id = ? AND c.article_id = ? AND c.parent_id IS NULL AND c.status = 'published' AND ${visibleAuthorSql("c")}`)
      .bind(pinnedId, articleId, viewer, viewer).all<CommentRow>()).results ?? []
    : [];

  const rows = await database.prepare(`SELECT ${COMMENT_COLUMNS}
      FROM hub_user_article_comments c JOIN profiles p ON p.id = c.author_profile_id
      WHERE c.article_id = ? AND c.parent_id IS NULL AND c.id <> ?
        AND ((c.status = 'published' AND ${visibleAuthorSql("c")})
          OR (c.status = 'removed' AND EXISTS (
            SELECT 1 FROM hub_user_article_comments r
            WHERE r.parent_id = c.id AND r.status = 'published' AND ${visibleAuthorSql("r")})))
        ${cursor ? "AND (c.created_at > ? OR (c.created_at = ? AND c.id > ?))" : ""}
      ORDER BY c.created_at ASC, c.id ASC LIMIT ?`)
    .bind(...[articleId, pinnedId ?? "", viewer, viewer, viewer, viewer, ...(cursor ? [cursor.createdAt, cursor.createdAt, cursor.id] : []), limit + 1])
    .all<CommentRow>();
  const total = await database.prepare(`SELECT COUNT(*) AS n FROM hub_user_article_comments c
      WHERE c.article_id = ? AND c.status = 'published' AND ${visibleAuthorSql("c")}`)
    .bind(articleId, viewer, viewer).first<{ n: number }>();

  const all = rows.results ?? [];
  const page = all.slice(0, limit);
  const parents = [...pinnedRows, ...page];

  const replyRows: CommentRow[] = [];
  for (const chunk of chunked(parents.map((row) => row.id), 80)) {
    const result = await database.prepare(`SELECT ${COMMENT_COLUMNS} FROM hub_user_article_comments c JOIN profiles p ON p.id = c.author_profile_id
        WHERE c.article_id = ? AND c.parent_id IN (${chunk.map(() => "?").join(",")}) AND c.status = 'published' AND ${visibleAuthorSql("c")}
        ORDER BY c.created_at ASC, c.id ASC LIMIT ?`)
      .bind(articleId, ...chunk, viewer, viewer, REPLY_FETCH_LIMIT).all<CommentRow>();
    replyRows.push(...(result.results ?? []));
  }

  const { counts, mine: likedSet } = await commentLikeInfo(database, [...parents, ...replyRows].map((row) => row.id), viewerProfileId);
  const isArticleAuthor = Boolean(viewerProfileId) && viewerProfileId === article.author_profile_id;
  const toComment = (row: CommentRow): ArticleComment => {
    if (row.status !== "published") {
      return {
        id: row.id, body: "", createdAt: row.created_at, author: { id: "", handle: "", displayName: "", avatarUrl: null },
        mine: false, canDelete: false, parentId: row.parent_id, removed: true, pinned: false, likeCount: 0, liked: false, replies: [],
      };
    }
    const mine = Boolean(viewerProfileId) && row.author_profile_id === viewerProfileId;
    return {
      id: row.id,
      body: row.body,
      createdAt: row.created_at,
      author: { id: row.author_profile_id, handle: row.handle, displayName: row.display_name, avatarUrl: row.avatar_url },
      mine,
      canDelete: mine || isArticleAuthor,
      parentId: row.parent_id,
      removed: false,
      pinned: row.id === pinnedId && !row.parent_id,
      likeCount: counts.get(row.id) ?? 0,
      liked: likedSet.has(row.id),
      replies: [],
    };
  };
  const byParent = new Map<string, ArticleComment[]>();
  for (const row of replyRows) {
    const list = byParent.get(row.parent_id ?? "") ?? [];
    list.push(toComment(row));
    byParent.set(row.parent_id ?? "", list);
  }
  return {
    comments: parents.map((row) => ({ ...toComment(row), replies: byParent.get(row.id) ?? [] })),
    nextCursor: all.length > limit && page.length ? encodeCommentCursor(page[page.length - 1]!.created_at, page[page.length - 1]!.id) : null,
    total: Number(total?.n ?? 0),
  };
}

export function parseCommentBody(value: unknown): string {
  const body = typeof value === "string" ? value.normalize("NFKC").replace(/\r\n?/g, "\n").trim() : "";
  if (!body) throw new ArticleEngagementValidationError("コメントを入力してください。");
  if (Array.from(body).length > COMMENT_MAX_LENGTH) {
    throw new ArticleEngagementValidationError(`コメントは${COMMENT_MAX_LENGTH}文字以内で入力してください。`);
  }
  // 制御文字は通さない（改行とタブは除く）。
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(body)) throw new ArticleEngagementValidationError("使えない文字が含まれています。");
  return body;
}

const COMMENT_WINDOW_MS = 10 * 60 * 1000;

async function consumeCommentQuota(database: D1Database, profile: Pick<Profile, "id" | "joinedAt">, now: Date) {
  const limit = isNewHubAccount({ joinedAt: profile.joinedAt }, now) ? 3 : 10;
  const windowStartMs = Math.floor(now.getTime() / COMMENT_WINDOW_MS) * COMMENT_WINDOW_MS;
  const result = await database.prepare(`INSERT INTO hub_user_article_comment_rate_limit_buckets
      (profile_id, window_started_at, request_count, expires_at) VALUES (?, ?, 1, ?)
      ON CONFLICT(profile_id, window_started_at) DO UPDATE SET request_count = request_count + 1
      WHERE request_count < ?`)
    .bind(profile.id, new Date(windowStartMs).toISOString(), new Date(windowStartMs + COMMENT_WINDOW_MS).toISOString(), limit).run();
  if (!result.meta.changes) {
    throw new ArticleCommentRateLimitError(Math.max(1, Math.ceil((windowStartMs + COMMENT_WINDOW_MS - now.getTime()) / 1000)));
  }
}

export async function createArticleComment(
  database: D1Database,
  profile: Pick<Profile, "id" | "joinedAt">,
  articleId: string,
  rawBody: unknown,
  now = new Date(),
  rawParentId: unknown = null,
): Promise<ArticleComment> {
  const body = parseCommentBody(rawBody);
  const article = await visibleArticle(database, articleId);
  if (!article) throw new ArticleEngagementNotFoundError();
  if (!(await commentsEnabledFor(database, articleId))) throw new ArticleEngagementForbiddenError("この記事はコメントを受け付けていません。");
  if (await suspended(database, profile.id)) throw new ArticleEngagementForbiddenError("このアカウントは現在、コメントできません。");
  await requireNoD1BlockBetween(database, profile.id, article.author_profile_id);
  if (!(await viewerPassesGate(database, articleId, profile.id))) throw new ArticleEngagementForbiddenError("閲覧条件を満たすとコメントできます。");

  // 返信先。返信への返信は最上位コメントへ付け替える（深さは1段）。削除済みのコメントには返信できない。
  let rootId: string | null = null;
  let targetAuthor: string | null = null;
  if (rawParentId !== null && rawParentId !== undefined && rawParentId !== "") {
    if (!isEngagementArticleId(rawParentId)) throw new ArticleEngagementNotFoundError("返信先のコメントが見つかりません。");
    const target = await database.prepare(`SELECT id, author_profile_id, parent_id FROM hub_user_article_comments
        WHERE id = ? AND article_id = ? AND status = 'published'`)
      .bind(rawParentId, articleId).first<{ id: string; author_profile_id: string; parent_id: string | null }>();
    if (!target) throw new ArticleEngagementNotFoundError("返信先のコメントが見つかりません。");
    await requireNoD1BlockBetween(database, profile.id, target.author_profile_id);
    rootId = target.parent_id ?? target.id;
    targetAuthor = target.author_profile_id;
  }
  await consumeCommentQuota(database, profile, now);

  const id = crypto.randomUUID();
  const createdAt = now.toISOString();
  await database.prepare(`INSERT INTO hub_user_article_comments (id, article_id, author_profile_id, body, status, created_at, parent_id)
      VALUES (?, ?, ?, ?, 'published', ?, ?)`).bind(id, articleId, profile.id, body, createdAt, rootId).run();
  if (targetAuthor) await notifyAuthor(database, targetAuthor, articleId, profile.id, "reply", now, `:${id}`);
  // 返信先が記事の書き手なら、返信の通知だけにして二重に送らない。
  if (targetAuthor !== article.author_profile_id) await notifyAuthor(database, article.author_profile_id, articleId, profile.id, "comment", now, `:${id}`);
  const author = await database.prepare("SELECT handle, display_name, avatar_url FROM profiles WHERE id = ?")
    .bind(profile.id).first<{ handle: string; display_name: string; avatar_url: string | null }>();
  return {
    id, body, createdAt,
    author: { id: profile.id, handle: author?.handle ?? "", displayName: author?.display_name ?? "", avatarUrl: author?.avatar_url ?? null },
    mine: true,
    canDelete: true,
    parentId: rootId, removed: false, pinned: false, likeCount: 0, liked: false, replies: [],
  };
}

/**
 * コメントにいいねを付ける／外す。希望の状態を送る形なので何度送っても同じ結果になる。
 * 自分のコメントには付けられない。数は誰にでも見せる。通知は書き手へ匿名で、コメントごとに1日1件まで。
 */
export async function setCommentLike(
  database: D1Database,
  profile: Pick<Profile, "id" | "joinedAt">,
  articleId: string,
  commentId: string,
  liked: boolean,
  now = new Date(),
): Promise<{ likeCount: number; liked: boolean }> {
  if (!isEngagementArticleId(articleId) || !isEngagementArticleId(commentId)) throw new ArticleEngagementNotFoundError("コメントが見つかりません。");
  const state = async () => {
    const [count, mine] = await Promise.all([
      database.prepare("SELECT COUNT(*) AS n FROM hub_user_article_comment_likes WHERE comment_id = ?").bind(commentId).first<{ n: number }>(),
      database.prepare("SELECT 1 AS x FROM hub_user_article_comment_likes WHERE comment_id = ? AND profile_id = ?").bind(commentId, profile.id).first(),
    ]);
    return { likeCount: Number(count?.n ?? 0), liked: Boolean(mine) };
  };
  if (!liked) {
    await database.prepare("DELETE FROM hub_user_article_comment_likes WHERE comment_id = ? AND profile_id = ?").bind(commentId, profile.id).run();
    return state();
  }
  const article = await visibleArticle(database, articleId);
  if (!article) throw new ArticleEngagementNotFoundError();
  const comment = await database.prepare(`SELECT author_profile_id FROM hub_user_article_comments
      WHERE id = ? AND article_id = ? AND status = 'published'`).bind(commentId, articleId).first<{ author_profile_id: string }>();
  if (!comment) throw new ArticleEngagementNotFoundError("コメントが見つかりません。");
  if (comment.author_profile_id === profile.id) throw new ArticleEngagementForbiddenError("自分のコメントにはいいねできません。");
  if (!(await commentsEnabledFor(database, articleId))) throw new ArticleEngagementForbiddenError("この記事はコメントを受け付けていません。");
  if (await suspended(database, profile.id)) throw new ArticleEngagementForbiddenError("このアカウントは現在、反応できません。");
  await requireNoD1BlockBetween(database, profile.id, comment.author_profile_id);
  if (!(await viewerPassesGate(database, articleId, profile.id))) throw new ArticleEngagementForbiddenError("閲覧条件を満たすと反応できます。");

  const existing = await database.prepare("SELECT 1 AS x FROM hub_user_article_comment_likes WHERE comment_id = ? AND profile_id = ?")
    .bind(commentId, profile.id).first();
  if (!existing) {
    await consumeLikeQuota(database, profile, now);
    const inserted = await database.prepare(`INSERT INTO hub_user_article_comment_likes (comment_id, profile_id, created_at)
        VALUES (?, ?, ?) ON CONFLICT(comment_id, profile_id) DO NOTHING`).bind(commentId, profile.id, now.toISOString()).run();
    if (inserted.meta.changes) {
      // actor は残さない。同じコメントへの通知は日本時間の1日につき1件（取り消して付け直しても増えない）。
      await notifyAuthor(database, comment.author_profile_id, articleId, null, "comment-like", now, `:${commentId}:${jstDay(now)}`);
    }
  }
  return state();
}

/**
 * ピン留め。記事の書き手本人だけ。公開済みの最上位コメントを1件だけ（付け替えると前のは外れる）。
 * commentId=null で外す。
 */
export async function setPinnedComment(
  database: D1Database,
  profileId: string,
  articleId: string,
  commentId: string | null,
  now = new Date(),
): Promise<string | null> {
  const article = await visibleArticle(database, articleId);
  if (!article) throw new ArticleEngagementNotFoundError();
  if (article.author_profile_id !== profileId) throw new ArticleEngagementForbiddenError("ピン留めできるのは記事の書き手だけです。");
  if (commentId !== null) {
    if (!isEngagementArticleId(commentId)) throw new ArticleEngagementNotFoundError("コメントが見つかりません。");
    const comment = await database.prepare(`SELECT parent_id FROM hub_user_article_comments
        WHERE id = ? AND article_id = ? AND status = 'published'`).bind(commentId, articleId).first<{ parent_id: string | null }>();
    if (!comment) throw new ArticleEngagementNotFoundError("コメントが見つかりません。");
    if (comment.parent_id) throw new ArticleEngagementValidationError("ピン留めできるのは返信ではないコメントだけです。");
  }
  await database.prepare(`INSERT INTO hub_user_article_comment_settings (article_id, owner_profile_id, comments_enabled, updated_at, pinned_comment_id)
      VALUES (?, ?, 1, ?, ?)
      ON CONFLICT(article_id) DO UPDATE SET pinned_comment_id = excluded.pinned_comment_id, updated_at = excluded.updated_at
      WHERE owner_profile_id = excluded.owner_profile_id`)
    .bind(articleId, profileId, now.toISOString(), commentId).run();
  return commentId;
}

/**
 * 削除。コメント本人・記事の書き手・運営（moderator=true は経路側が管理セッションを確認済みのとき）。
 * 行は残して本文を空にする。通報の抜粋は通報時点のものが残る。
 */
export async function deleteArticleComment(
  database: D1Database,
  articleId: string,
  commentId: string,
  actor: { profileId: string | null; moderator: boolean },
  now = new Date(),
): Promise<boolean> {
  if (!isEngagementArticleId(articleId) || !isEngagementArticleId(commentId)) throw new ArticleEngagementNotFoundError("コメントが見つかりません。");
  const row = await database.prepare(`SELECT c.author_profile_id, a.author_profile_id AS article_author
      FROM hub_user_article_comments c JOIN hub_user_articles a ON a.id = c.article_id
      WHERE c.id = ? AND c.article_id = ? AND c.status = 'published'`)
    .bind(commentId, articleId).first<{ author_profile_id: string; article_author: string }>();
  if (!row) throw new ArticleEngagementNotFoundError("コメントが見つかりません。");
  const removedBy = actor.profileId && row.author_profile_id === actor.profileId ? "author"
    : actor.profileId && row.article_author === actor.profileId ? "article_author"
    : actor.moderator ? "moderator" : null;
  if (!removedBy) throw new ArticleEngagementForbiddenError("このコメントは削除できません。");
  const result = await database.prepare(`UPDATE hub_user_article_comments
      SET status = 'removed', body = '', removed_by = ?, removed_at = ? WHERE id = ? AND status = 'published'`)
    .bind(removedBy, now.toISOString(), commentId).run();
  await database.prepare("UPDATE hub_user_article_comment_settings SET pinned_comment_id = NULL WHERE pinned_comment_id = ?").bind(commentId).run();
  if (removedBy === "moderator") {
    await database.prepare("UPDATE hub_user_article_comment_reports SET status = 'resolved' WHERE comment_id = ? AND status = 'open'").bind(commentId).run();
  }
  return Boolean(result.meta.changes);
}

/** 通報。同じ人が同じコメントを再通報すると理由を更新する。 */
export async function reportArticleComment(
  database: D1Database,
  profile: Pick<Profile, "id">,
  articleId: string,
  commentId: string,
  rawReason: unknown,
  now = new Date(),
): Promise<void> {
  const reason = typeof rawReason === "string" ? rawReason.normalize("NFKC").trim() : "";
  if (!reason || Array.from(reason).length > COMMENT_REPORT_REASON_MAX) {
    throw new ArticleEngagementValidationError(`通報の理由は1〜${COMMENT_REPORT_REASON_MAX}文字で入力してください。`);
  }
  if (!isEngagementArticleId(articleId) || !isEngagementArticleId(commentId)) throw new ArticleEngagementNotFoundError("コメントが見つかりません。");
  const comment = await database.prepare(`SELECT c.body, c.author_profile_id FROM hub_user_article_comments c
      WHERE c.id = ? AND c.article_id = ? AND c.status = 'published'`)
    .bind(commentId, articleId).first<{ body: string; author_profile_id: string }>();
  if (!comment) throw new ArticleEngagementNotFoundError("コメントが見つかりません。");
  if (comment.author_profile_id === profile.id) throw new ArticleEngagementForbiddenError("自分のコメントは通報できません。削除してください。");
  if (!(await viewerPassesGate(database, articleId, profile.id))) throw new ArticleEngagementForbiddenError("閲覧条件を満たすと通報できます。");
  await database.prepare(`INSERT INTO hub_user_article_comment_reports
      (id, comment_id, article_id, reporter_profile_id, reason, excerpt, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'open', ?)
      ON CONFLICT(comment_id, reporter_profile_id) DO UPDATE SET reason = excluded.reason, status = 'open', created_at = excluded.created_at`)
    .bind(crypto.randomUUID(), commentId, articleId, profile.id, reason, Array.from(comment.body).slice(0, 300).join(""), now.toISOString()).run();
}

/* ------------------------------------------------------------------ */
/* 記事ページ用の初期状態                                              */
/* ------------------------------------------------------------------ */

export type ArticleEngagementState = LikeState & {
  commentsEnabled: boolean;
  isAuthor: boolean;
  comments: ArticleCommentPage;
};

export async function loadArticleEngagement(
  database: D1Database,
  articleId: string,
  authorProfileId: string,
  viewerProfileId: string | null,
): Promise<ArticleEngagementState> {
  const [like, commentsEnabled] = await Promise.all([
    getLikeState(database, articleId, viewerProfileId),
    commentsEnabledFor(database, articleId),
  ]);
  const comments = await listArticleComments(database, articleId, viewerProfileId).catch((): ArticleCommentPage => ({ comments: [], nextCursor: null, total: 0 }));
  return { ...like, commentsEnabled, isAuthor: Boolean(viewerProfileId) && viewerProfileId === authorProfileId, comments };
}
