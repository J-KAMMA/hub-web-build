import type { D1Database } from "@cloudflare/workers-types";
import { matchesThreadPostKnowledge, prepareThreadPostKnowledge, type ThreadPostKnowledgeInput } from "@/lib/server/d1-thread-knowledge";

import type { Board, Profile, ThreadPost, ThreadSummary, ThreadTracking } from "@/lib/domain";
import { consumeD1PostQuota, HubPostRateLimitError } from "@/lib/server/d1-rate-limit";
import { requireNoD1BlockBetween } from "@/lib/server/profile-blocks";
import { createD1SocialNotification } from "@/lib/server/d1-social-notifications";
import type { ThreadLanguage, ThreadRegion } from "@/lib/thread-scope";
import type { ThreadType } from "@/lib/thread-type";
import { normalizeThreadTags, type ThreadTagSummary } from "@/lib/thread-tags";
import { queueThreadFollowerNotifications } from "@/lib/server/thread-notification-delivery";
import { tagKey } from "@jkamma/content-tags";
import { replaceD1ContentTags } from "@/lib/server/d1-content-tags";
import { notGatedSql } from "@/lib/server/gated-exits";
import { inferContentTagSignals } from "@/lib/content-tagging";
import { parseStoredThreadLanguages } from "@/lib/thread-scope-policy";
import { normalizeThreadCountries, normalizeThreadLanguageTags, type ThreadLanguageTag } from "@/lib/thread-fine-scope";
import { parseStoredThreadIpPolicy, type ThreadIpPolicy } from "@/lib/server/thread-ip-policy";

export type D1ThreadPostView = ThreadPost & { authorHandle?: string; authorAvatarUrl?: string; replyTargetNo?: number; replyTargetDisplayName?: string };

type ThreadRow = {
  id: string;
  board_key: string;
  title: string;
  post_count: number;
  updated_at: string;
  pinned: number;
  best_answer_post_id: string | null;
  solved_at: string | null;
  language: ThreadLanguage;
  allowed_languages_json: string;
  allowed_language_tags_json: string;
  allowed_country_codes_json: string;
  write_ip_policy_json: string;
  region: ThreadRegion;
  thread_type: ThreadType;
  thread_format: ThreadType | null;
  deadline: string | null;
  tags_json: string;
  slow_mode_seconds: number;
  status: "open" | "closed" | "archived";
  moderation_status: "active" | "frozen";
  merged_into_thread_id: string | null;
};

type PostRow = {
  id: string;
  thread_id: string;
  post_no: number;
  author_profile_id: string | null;
  display_name: string;
  body: string;
  reply_to_post_id: string | null;
  created_at: string;
  is_anonymous: number;
  edited_at: string | null;
  deleted_at: string | null;
  moderated_at: string | null;
  moderation_reason: string | null;
  author_handle: string | null;
  author_avatar_url: string | null;
  reply_target_no: number | null;
  reply_target_display_name: string | null;
};

function mapThread(row: ThreadRow): ThreadSummary {
  return {
    id: row.id,
    boardKey: row.board_key,
    title: row.title,
    postCount: Number(row.post_count),
    updatedAt: row.updated_at,
    pinned: Boolean(row.pinned),
    bestAnswerPostId: row.best_answer_post_id ?? undefined,
    solvedAt: row.solved_at ?? undefined,
    language: row.language,
    allowedLanguages: parseStoredThreadLanguages(row.allowed_languages_json, row.language),
    allowedLanguageTags: normalizeThreadLanguageTags(JSON.parse(row.allowed_language_tags_json || "[]")),
    allowedCountryCodes: normalizeThreadCountries(JSON.parse(row.allowed_country_codes_json || "[]")),
    writeIpPolicy: parseStoredThreadIpPolicy(row.write_ip_policy_json),
    region: row.region,
    threadType: row.thread_format ?? row.thread_type,
    deadline: row.deadline ?? undefined,
    tags: normalizeThreadTags(JSON.parse(row.tags_json || "[]")),
    slowModeSeconds: Number(row.slow_mode_seconds ?? 0)
    ,status: row.status ?? "open",
    moderationStatus: row.moderation_status ?? "active",
    mergedIntoThreadId: row.merged_into_thread_id ?? undefined
  };
}

function mapPost(row: PostRow): D1ThreadPostView {
  const hidden = Boolean(row.deleted_at || row.moderated_at);
  const anonymous = Boolean(row.is_anonymous);
  return {
    id: row.id,
    threadId: row.thread_id,
    no: Number(row.post_no),
    authorProfileId: row.author_profile_id,
    displayName: anonymous ? "名無しさん" : row.display_name,
    body: hidden ? "" : row.body,
    replyToPostId: row.reply_to_post_id,
    createdAt: row.created_at,
    isAnonymous: anonymous,
    editedAt: row.edited_at ?? undefined,
    deletedAt: row.deleted_at ?? undefined,
    moderatedAt: row.moderated_at ?? undefined,
    moderationReason: row.moderation_reason ?? undefined,
    authorHandle: anonymous ? undefined : row.author_handle ?? undefined,
    authorAvatarUrl: anonymous ? undefined : row.author_avatar_url ?? undefined
    ,replyTargetNo: row.reply_target_no == null ? undefined : Number(row.reply_target_no)
    ,replyTargetDisplayName: row.reply_target_display_name ?? undefined
  };
}

const THREAD_SELECT = `SELECT t.id, b.board_key, t.title,
  (SELECT count(*) FROM thread_posts p WHERE p.thread_id = t.id) AS post_count,
  t.updated_at, t.pinned, t.best_answer_post_id, t.solved_at, t.language, t.allowed_languages_json,
  t.allowed_language_tags_json, t.allowed_country_codes_json, t.write_ip_policy_json, t.region, t.thread_type, t.thread_format, t.deadline, t.tags_json,
  t.slow_mode_seconds, t.status, t.moderation_status, t.merged_into_thread_id
  FROM threads t JOIN boards b ON b.id = t.board_id`;

const POST_SELECT = `SELECT p.id, p.thread_id, p.post_no, p.author_profile_id, p.display_name, p.body,
  p.reply_to_post_id, p.created_at, p.is_anonymous, p.edited_at, p.deleted_at,
  p.moderated_at, p.moderation_reason, profile.handle AS author_handle,
  profile.avatar_url AS author_avatar_url, reply_target.post_no AS reply_target_no,
  reply_target.display_name AS reply_target_display_name
  FROM thread_posts p LEFT JOIN profiles profile ON profile.id = p.author_profile_id
  LEFT JOIN thread_posts reply_target ON reply_target.id = p.reply_to_post_id`;

export async function listD1Threads(database: D1Database, boardKey?: string, limit = 500, offset = 0): Promise<ThreadSummary[]> {
  const statement = database.prepare(`${THREAD_SELECT} WHERE t.status <> 'archived'${boardKey ? " AND b.board_key = ? COLLATE NOCASE" : ""}
    ORDER BY CASE WHEN t.id LIKE 'category-mock-%' THEN 1 ELSE 0 END ASC, t.pinned DESC, t.updated_at DESC LIMIT ? OFFSET ?`);
  const safeLimit = Math.max(1, Math.min(50, Math.trunc(limit)));
  const safeOffset = Math.max(0, Math.trunc(offset));
  const result = boardKey ? await statement.bind(boardKey, safeLimit, safeOffset).all<ThreadRow>() : await statement.bind(safeLimit, safeOffset).all<ThreadRow>();
  return (result.results ?? []).map(mapThread);
}

export type D1ThreadListView = "popular" | "latest" | "rising" | "unanswered" | "solved" | "quality";

export interface D1ThreadListOptions {
  boardKeys?: string[];
  tags?: string[];
  query?: string;
  view?: D1ThreadListView;
  limit?: number;
  offset?: number;
  /** Internal discovery traversal; undefined retains normal list ordering. */
  discoveryAfter?: string | null;
  /** Callers that only read `threads` skip the full-table count; `total` is then 0. */
  skipTotal?: boolean;
  /** Hydrate exactly these threads (tag pages page by link keyset, then load rows by id). */
  ids?: string[];
}

export async function listD1ThreadsPage(database: D1Database, options: D1ThreadListOptions = {}) {
  const boardKeys = [...new Set((options.boardKeys ?? []).map((key) => key.trim()).filter(Boolean))].slice(0, 50);
  const tags = normalizeThreadTags(options.tags ?? []);
  const query = (options.query ?? "").normalize("NFKC").trim().slice(0, 100);
  const view = options.view ?? "popular";
  const limit = Math.max(1, Math.min(50, Math.trunc(options.limit ?? 50)));
  const offset = Math.max(0, Math.trunc(options.offset ?? 0));
  const conditions: string[] = ["t.status <> 'archived'"];
  const bindings: Array<string | number> = [];
  if (options.discoveryAfter) { conditions.push("t.id > ?"); bindings.push(options.discoveryAfter); }
  if (options.ids) {
    const wanted = [...new Set(options.ids)].slice(0, 50);
    if (!wanted.length) return { threads: [] as ThreadSummary[], total: 0, limit, offset };
    conditions.push(`t.id IN (${wanted.map(() => "?").join(",")})`);
    bindings.push(...wanted);
  }

  if (boardKeys.length) {
    conditions.push(`b.board_key IN (${boardKeys.map(() => "?").join(",")})`);
    bindings.push(...boardKeys);
  }
  if (tags.length) {
    // Keys come from the shared normaliser (full Unicode case folding); SQLite lower() is ASCII-only, so the
    // match goes through content_tag_links. The tags_json clause only covers threads not yet backfilled
    // (ASCII case-insensitive, as before) and can be dropped once the backfill has run everywhere.
    const keys = tags.map((tag) => tagKey(tag)).filter((key): key is string => Boolean(key));
    conditions.push(`(EXISTS (
      SELECT 1 FROM content_tag_links thread_link JOIN content_tags thread_ct ON thread_ct.id = thread_link.tag_id
      WHERE thread_link.target_type = 'thread' AND thread_link.target_id = t.id
        AND thread_ct.normalized_key IN (${keys.map(() => "?").join(",")})
    ) OR (NOT EXISTS (SELECT 1 FROM content_tag_links any_link WHERE any_link.target_type = 'thread' AND any_link.target_id = t.id)
      AND EXISTS (
        SELECT 1 FROM json_each(CASE WHEN json_valid(t.tags_json) THEN t.tags_json ELSE '[]' END) thread_tag
        WHERE CAST(thread_tag.value AS TEXT) COLLATE NOCASE IN (${tags.map(() => "?").join(",")})
      )))`);
    bindings.push(...keys, ...tags);
  }
  if (query) {
    conditions.push(`(t.title LIKE ? ESCAPE '\\' COLLATE NOCASE
      OR EXISTS (SELECT 1 FROM thread_posts search_post WHERE search_post.thread_id=t.id
        AND search_post.body LIKE ? ESCAPE '\\' COLLATE NOCASE)
      OR EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(t.tags_json) THEN t.tags_json ELSE '[]' END) search_tag
        WHERE CAST(search_tag.value AS TEXT) LIKE ? ESCAPE '\\' COLLATE NOCASE))`);
    const escaped = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
    bindings.push(escaped, escaped, escaped);
  }
  if (view === "unanswered") conditions.push("t.thread_type='question' AND NOT EXISTS (SELECT 1 FROM thread_posts answer_post WHERE answer_post.thread_id=t.id AND answer_post.post_no>1)");
  if (view === "solved") conditions.push("t.solved_at IS NOT NULL");

  const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
  const sourcePriority = "CASE WHEN t.id LIKE 'mock-thread-%' OR t.id LIKE 'category-mock-%' THEN 1 ELSE 0 END ASC";
  const order = view === "latest"
    ? "t.updated_at DESC"
    : view === "rising"
      ? "(SELECT count(*) FROM thread_posts recent_post WHERE recent_post.thread_id=t.id AND recent_post.created_at >= datetime('now','-24 hours')) DESC, t.updated_at DESC"
      : view === "quality"
        ? "(SELECT count(*) FROM thread_post_quality_votes quality_vote JOIN thread_posts quality_post ON quality_post.id=quality_vote.post_id WHERE quality_post.thread_id=t.id AND quality_vote.dimension='helpful' AND quality_vote.value=1) DESC, t.updated_at DESC"
        : view === "unanswered"
          ? "t.updated_at DESC"
          : "t.pinned DESC, (SELECT count(*) FROM thread_posts popularity_post WHERE popularity_post.thread_id=t.id) DESC, t.updated_at DESC";

  const [rows, countRow] = await Promise.all([
    database.prepare(`${THREAD_SELECT}${where} ORDER BY ${options.discoveryAfter !== undefined ? "t.id ASC" : `${sourcePriority}, ${order}, t.id ASC`} LIMIT ? OFFSET ?`)
      .bind(...bindings, limit, offset).all<ThreadRow>(),
    options.skipTotal ? Promise.resolve(null) : database.prepare(`SELECT count(*) AS total FROM threads t JOIN boards b ON b.id=t.board_id${where}`)
      .bind(...bindings).first<{ total: number }>(),
  ]);
  return {
    threads: (rows.results ?? []).map(mapThread),
    total: Number(countRow?.total ?? 0),
    limit,
    offset,
  };
}

export async function listD1ThreadDiscoveryPage(database: D1Database, options: Pick<D1ThreadListOptions, "boardKeys" | "tags" | "query">, after: string | null = null) {
  const page = await listD1ThreadsPage(database, { ...options, discoveryAfter: after, limit: 50 });
  const ids = page.threads.map(thread => thread.id);
  const excerpts: Record<string, string> = {};
  if (ids.length) {
    const rows = await database.prepare(`SELECT p.thread_id,substr(p.body,1,500) AS excerpt FROM thread_posts p
      WHERE p.thread_id IN (${ids.map(() => "?").join(",")}) AND p.post_no=1
      AND p.deleted_at IS NULL AND p.moderated_at IS NULL AND ${notGatedSql("thread", "p.thread_id")}`).bind(...ids).all<{thread_id: string; excerpt: string}>();
    for (const row of rows.results) excerpts[row.thread_id] = row.excerpt;
  }
  return { threads: page.threads, excerpts, nextCursor: page.total > ids.length ? ids.at(-1) ?? null : null };
}

// Counts per tag key from the unified link table (full Unicode case folding; public threads only).
export async function listD1ThreadTagCounts(database: D1Database): Promise<ThreadTagSummary[]> {
  const result = await database.prepare(`SELECT ct.display_name AS name, count(DISTINCT l.target_id) AS count
    FROM content_tag_links l JOIN content_tags ct ON ct.id = l.tag_id
    WHERE l.target_type = 'thread' AND l.public_visible = 1 AND l.provenance = 'publisher'
    GROUP BY ct.id
    ORDER BY count DESC, ct.normalized_key ASC`).all<{ name: string; count: number }>();
  return (result.results ?? []).map((row) => ({ name: row.name, count: Number(row.count) }));
}

export async function getD1BoardThreadCounts(database: D1Database): Promise<Map<string, number>> {
  const result = await database.prepare(`SELECT b.board_key, count(t.id) AS thread_count
    FROM boards b LEFT JOIN threads t ON t.board_id=b.id AND t.status <> 'archived'
    GROUP BY b.board_key`).all<{ board_key: string; thread_count: number }>();
  return new Map((result.results ?? []).map((row) => [row.board_key, Number(row.thread_count)]));
}

export async function listD1BoardKeys(database: D1Database): Promise<string[]> {
  const result = await database.prepare(
    "SELECT board_key FROM boards ORDER BY board_key LIMIT 500",
  ).all<{ board_key: string }>();
  return (result.results ?? []).map((row) => row.board_key);
}

export async function getD1Thread(database: D1Database, threadId: string): Promise<ThreadSummary | undefined> {
  const row = await database.prepare(`${THREAD_SELECT} WHERE t.id = ? LIMIT 1`).bind(threadId).first<ThreadRow>();
  return row ? mapThread(row) : undefined;
}

export async function listD1ThreadPosts(database: D1Database, threadId: string, limit?: number, offset = 0): Promise<D1ThreadPostView[]> {
  const paged = typeof limit === "number";
  const statement = database.prepare(`${POST_SELECT} WHERE p.thread_id = ? ORDER BY p.post_no${paged ? " LIMIT ? OFFSET ?" : ""}`);
  const result = paged
    ? await statement.bind(threadId, Math.max(1, Math.min(100, Math.trunc(limit))), Math.max(0, Math.trunc(offset))).all<PostRow>()
    : await statement.bind(threadId).all<PostRow>();
  return (result.results ?? []).map(mapPost);
}

export async function getD1VisibleThreadPostsByIds(
  database: D1Database,
  postIds: readonly string[],
  viewerProfileId: string,
): Promise<D1ThreadPostView[]> {
  const ids = [...new Set(postIds.map((id) => id.trim()).filter(Boolean))].slice(0, 50);
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(", ");
  const result = await database.prepare(`${POST_SELECT}
    WHERE p.id IN (${placeholders})
      AND p.deleted_at IS NULL
      AND p.moderated_at IS NULL
      AND p.is_anonymous = 0
      AND (p.author_profile_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM profile_moderation_status moderation
        WHERE moderation.profile_id = p.author_profile_id
          AND moderation.status = 'suspended'
      ))
      AND (p.author_profile_id IS NULL OR p.author_profile_id = ? OR (
        NOT EXISTS (
          SELECT 1 FROM thread_user_controls outgoing_control
          WHERE outgoing_control.owner_profile_id = ?
            AND outgoing_control.target_profile_id = p.author_profile_id
            AND (outgoing_control.muted = 1 OR outgoing_control.blocked = 1)
        )
        AND NOT EXISTS (
          SELECT 1 FROM thread_user_controls incoming_control
          WHERE incoming_control.owner_profile_id = p.author_profile_id
            AND incoming_control.target_profile_id = ?
            AND incoming_control.blocked = 1
        )
      ))`)
    .bind(...ids, viewerProfileId, viewerProfileId, viewerProfileId)
    .all<PostRow>();
  return (result.results ?? []).map(mapPost);
}

export async function getD1VisibleThreadPost(
  database: D1Database,
  postId: string,
  viewerProfileId: string,
): Promise<D1ThreadPostView | undefined> {
  const row = await database.prepare(`${POST_SELECT}
    WHERE p.id = ?
      AND p.deleted_at IS NULL
      AND p.moderated_at IS NULL
      AND (p.author_profile_id IS NULL OR NOT EXISTS (
        SELECT 1
        FROM profile_moderation_status moderation
        WHERE moderation.profile_id = p.author_profile_id
          AND moderation.status = 'suspended'
      ))
      AND (p.author_profile_id IS NULL OR p.author_profile_id = ? OR (
        NOT EXISTS (
          SELECT 1
          FROM thread_user_controls outgoing_control
          WHERE outgoing_control.owner_profile_id = ?
            AND outgoing_control.target_profile_id = p.author_profile_id
            AND (outgoing_control.muted = 1 OR outgoing_control.blocked = 1)
        )
        AND NOT EXISTS (
          SELECT 1
          FROM thread_user_controls incoming_control
          WHERE incoming_control.owner_profile_id = p.author_profile_id
            AND incoming_control.target_profile_id = ?
            AND incoming_control.blocked = 1
        )
      ))
    LIMIT 1`)
    .bind(postId, viewerProfileId, viewerProfileId, viewerProfileId)
    .first<PostRow>();
  return row ? mapPost(row) : undefined;
}

export async function getD1Board(database: D1Database, boardKey: string): Promise<Board | undefined> {
  const row = await database.prepare(`SELECT b.id, b.board_key, b.title, b.slug, b.description,
    (SELECT count(*) FROM threads t WHERE t.board_id = b.id) AS thread_count
    FROM boards b WHERE b.board_key = ? COLLATE NOCASE LIMIT 1`).bind(boardKey).first<{
      id: string; board_key: string; title: string; slug: string; description: string; thread_count: number;
    }>();
  return row ? { id: row.id, key: row.board_key, title: row.title, slug: row.slug, description: row.description, threadCount: Number(row.thread_count) } : undefined;
}

async function ensureBoard(database: D1Database, board: Board, now: string) {
  await database.prepare(`INSERT INTO boards (id, board_key, title, slug, description, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(board_key) DO UPDATE SET title = excluded.title, slug = excluded.slug,
      description = excluded.description, updated_at = excluded.updated_at`).bind(
        board.id, board.key, board.title, board.slug, board.description, now, now
      ).run();
  const stored = await database.prepare("SELECT id FROM boards WHERE board_key = ? COLLATE NOCASE")
    .bind(board.key).first<{ id: string }>();
  if (!stored) throw new Error("Board could not be saved.");
  return stored.id;
}

export async function createD1Thread(database: D1Database, viewer: Profile, board: Board, input: {
  knowledge?: ThreadPostKnowledgeInput;
  researchSource?: import("@/lib/research-workspace").ResearchDiscussionSource;
  researchGitSource?: import("@/lib/research-git-discussion").ResearchGitDiscussionSource;
  continuationFrom?: string;
  requestId?: string;
  title: string;
  body: string;
  identityMode: "anonymous" | "account";
  language: ThreadLanguage;
  allowedLanguages: ThreadLanguage[];
  allowedLanguageTags: ThreadLanguageTag[];
  allowedCountryCodes: string[];
  writeIpPolicy: ThreadIpPolicy;
  region: ThreadRegion;
  threadType: ThreadType;
  deadline?: string | null;
  tags: string[];
}) {
  if (input.requestId) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.requestId)) throw new Error("操作IDが正しくありません。");
    const previous = await database.prepare(`SELECT p.id AS post_id,t.title,p.body,p.author_profile_id,r.source_thread_id,b.board_key,t.thread_format,p.is_anonymous,t.language,t.region,t.allowed_languages_json,t.allowed_language_tags_json,t.allowed_country_codes_json,t.write_ip_policy_json,t.deadline,t.tags_json
      FROM threads t JOIN thread_posts p ON p.thread_id=t.id AND p.post_no=1
      JOIN boards b ON b.id=t.board_id
      LEFT JOIN thread_relations r ON r.target_thread_id=t.id AND r.relation='continuation' WHERE t.id=?`).bind(input.requestId).first<{post_id:string;title:string;body:string;author_profile_id:string;source_thread_id:string|null;board_key:string;thread_format:string;is_anonymous:number;language:string;region:string;allowed_languages_json:string;allowed_language_tags_json:string;allowed_country_codes_json:string;write_ip_policy_json:string;deadline:string|null;tags_json:string}>();
    if (previous) {
      if (previous.title !== input.title || previous.body !== input.body || previous.author_profile_id !== viewer.id || previous.source_thread_id !== (input.continuationFrom ?? null) || previous.board_key !== board.key || previous.thread_format !== input.threadType || Boolean(previous.is_anonymous) !== (input.identityMode === "anonymous") || previous.language !== input.language || previous.region !== input.region) throw new Error("操作IDが別のスレッドで使用されています。");
      if (previous.allowed_languages_json !== JSON.stringify(input.allowedLanguages) || previous.allowed_language_tags_json !== JSON.stringify(input.allowedLanguageTags) || previous.allowed_country_codes_json !== JSON.stringify(input.allowedCountryCodes) || previous.write_ip_policy_json !== JSON.stringify(input.writeIpPolicy) || previous.deadline !== (input.deadline ?? null) || previous.tags_json !== JSON.stringify(normalizeThreadTags(input.tags))) throw new Error("操作IDが別のスレッドで使用されています。");
      if (!await matchesThreadPostKnowledge(database, { postId: previous.post_id, threadId: input.requestId, profileId: viewer.id, knowledge: input.knowledge })) throw new Error("操作IDが別のスレッドで使用されています。");
      const thread = await getD1Thread(database,input.requestId), posts = await listD1ThreadPosts(database,input.requestId);
      if (!thread || !posts[0]) throw new Error("作成結果を確認できませんでした。");
      return {thread,post:posts[0]};
    }
  }
  const now = new Date().toISOString();
  const threadId = input.requestId ?? crypto.randomUUID();
  const postId = crypto.randomUUID();
  const knowledge = input.knowledge ? await prepareThreadPostKnowledge(database, { ...input.knowledge, postId, threadId, profileId: viewer.id }, now) : [];
  await consumeD1PostQuota(database, viewer, "thread_create");
  const boardId = await ensureBoard(database, board, now);
  const anonymous = input.identityMode === "anonymous";
  await database.batch([
    database.prepare(`INSERT INTO threads
      (id, board_id, created_by_profile_id, title, language, allowed_languages_json, allowed_language_tags_json,
       allowed_country_codes_json, write_ip_policy_json, region, thread_type, thread_format, deadline, tags_json, slow_mode_seconds, pinned, created_at, updated_at,
       best_answer_post_id, solved_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, NULL, NULL${input.researchSource ? ` WHERE EXISTS(SELECT 1 FROM research_projects rp JOIN research_documents rd ON rd.project_id=rp.id JOIN research_document_revisions rr ON rr.document_id=rd.id WHERE rp.id=? AND rp.visibility='public' AND rp.status<>'withdrawn' AND rp.title=? AND rd.id=? AND rd.visibility='public' AND rd.title=? AND rr.version=? AND rr.content_hash=?)` : input.researchGitSource ? ` WHERE EXISTS(SELECT 1 FROM research_projects rp JOIN research_git_repositories rg ON rg.project_id=rp.id WHERE rp.id=? AND rp.title=? AND rp.visibility='public' AND rp.status<>'withdrawn' AND rg.visibility='public')` : ""}`).bind(
        threadId, boardId, viewer.id, input.title, input.language, JSON.stringify(input.allowedLanguages),
        JSON.stringify(input.allowedLanguageTags), JSON.stringify(input.allowedCountryCodes), JSON.stringify(input.writeIpPolicy), input.region,
        input.threadType === "discussion" || input.threadType === "issue" ? "information" : input.threadType, input.threadType, input.deadline ?? null,
        JSON.stringify(normalizeThreadTags(input.tags)), now, now,
        ...(input.researchSource ? [input.researchSource.projectId,input.researchSource.projectTitle,input.researchSource.documentId,input.researchSource.title,input.researchSource.version,input.researchSource.contentHash] : input.researchGitSource ? [input.researchGitSource.projectId,input.researchGitSource.projectTitle] : [])
      ),
    database.prepare(`INSERT INTO thread_posts
      (id, thread_id, post_no, author_profile_id, display_name, body, reply_to_post_id, created_at, declared_language, declared_region,
       is_anonymous, edited_at, deleted_at, moderated_at, moderation_reason)
      VALUES (?, ${input.researchGitSource ? `(SELECT id FROM threads WHERE id=? AND EXISTS(SELECT 1 FROM research_projects rp JOIN research_git_repositories rg ON rg.project_id=rp.id WHERE rp.id=? AND rp.title=? AND rp.visibility='public' AND rp.status<>'withdrawn' AND rg.visibility='public'))` : input.researchSource ? '(SELECT id FROM threads WHERE id=?)' : '?'}, 1, ?, ?, ?, NULL, ?, ?, ?, ?, NULL, NULL, NULL, NULL)`).bind(
        postId, threadId, ...(input.researchGitSource ? [input.researchGitSource.projectId,input.researchGitSource.projectTitle] : []), viewer.id, anonymous ? "名無しさん" : viewer.displayName, input.body, now, input.language, input.region, anonymous ? 1 : 0
      ),
    ...knowledge,
    ...(input.researchGitSource ? [database.prepare(`UPDATE threads SET title=NULL WHERE id=? AND (
      NOT EXISTS(SELECT 1 FROM threads t WHERE t.id=? AND t.created_by_profile_id=? AND t.title=? AND t.board_id=? AND t.thread_format=? AND t.thread_type=? AND t.language=? AND t.region=? AND t.allowed_languages_json=? AND t.allowed_language_tags_json=? AND t.allowed_country_codes_json=? AND t.write_ip_policy_json=? AND t.deadline IS ? AND t.tags_json=?)
      OR NOT EXISTS(SELECT 1 FROM thread_posts WHERE thread_id=? AND post_no=1 AND author_profile_id=? AND body=? AND is_anonymous=? AND declared_language=? AND declared_region=?)
      OR NOT EXISTS(SELECT 1 FROM research_projects rp JOIN research_git_repositories rg ON rg.project_id=rp.id WHERE rp.id=? AND rp.title=? AND rp.visibility='public' AND rp.status<>'withdrawn' AND rg.visibility='public'))`).bind(
        threadId,threadId,viewer.id,input.title,boardId,input.threadType,input.threadType === "discussion" || input.threadType === "issue" ? "information" : input.threadType,input.language,input.region,
        JSON.stringify(input.allowedLanguages),JSON.stringify(input.allowedLanguageTags),JSON.stringify(input.allowedCountryCodes),JSON.stringify(input.writeIpPolicy),input.deadline ?? null,JSON.stringify(normalizeThreadTags(input.tags)),
        threadId,viewer.id,input.body,anonymous ? 1 : 0,input.language,input.region,input.researchGitSource.projectId,input.researchGitSource.projectTitle)] : []),
    ...(input.continuationFrom ? [
      database.prepare(`INSERT INTO thread_relations(source_thread_id,target_thread_id,relation,created_by_profile_id,created_at)
        VALUES ((SELECT id FROM threads WHERE id=? AND board_id=? AND moderation_status!='frozen' AND merged_into_thread_id IS NULL
          AND (SELECT COUNT(*) FROM thread_posts WHERE thread_id=threads.id)>=900),?,'continuation',?,?)`)
        .bind(input.continuationFrom,boardId,threadId,viewer.id,now),
      database.prepare("INSERT INTO thread_operational_events(id,thread_id,event_type,occurred_at) VALUES(?,?,'continued',?)")
        .bind(`continued:${threadId}`,input.continuationFrom,now),
    ] : [])
  ]);
  await replaceD1ContentTags(database, "thread", threadId, inferContentTagSignals({
    target: "thread",
    title: input.title,
    body: input.body,
    board: board.title,
    existingCategory: input.threadType,
    publisherTags: input.tags,
  }));
  const thread = await getD1Thread(database, threadId);
  const posts = await listD1ThreadPosts(database, threadId);
  if (!thread || !posts[0]) throw new Error("Thread could not be created.");
  return { thread, post: posts[0] };
}

export async function importThreadIntoD1(database: D1Database, input: {
  board: Board;
  thread: ThreadSummary;
  posts: ThreadPost[];
  profiles: Profile[];
}): Promise<void> {
  if (await getD1Thread(database, input.thread.id)) return;
  const createdAt = input.posts[0]?.createdAt ?? input.thread.updatedAt;
  const boardId = await ensureBoard(database, input.board, createdAt);
  for (const profile of input.profiles) {
    if (await database.prepare("SELECT id FROM profiles WHERE id = ?").bind(profile.id).first()) continue;
    const handleOwner = await database.prepare("SELECT id FROM profiles WHERE handle = ? COLLATE NOCASE").bind(profile.handle).first<{ id: string }>();
    const importHandle = handleOwner && handleOwner.id !== profile.id
      ? `legacy_${profile.id.replace(/[^a-z0-9_]/gi, "_").slice(-20)}`
      : profile.handle;
    await database.prepare(`INSERT INTO profiles
      (id, handle, display_name, bio, avatar_url, joined_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(
        profile.id, importHandle, profile.displayName, profile.bio, profile.avatarUrl ?? null,
        profile.joinedAt, profile.joinedAt, profile.joinedAt
      ).run();
  }
  const creatorId = input.posts[0]?.authorProfileId ?? null;
  await database.prepare(`INSERT OR IGNORE INTO threads
    (id, board_id, created_by_profile_id, title, language, region, thread_type, tags_json, slow_mode_seconds, pinned, created_at, updated_at,
     best_answer_post_id, solved_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`).bind(
      input.thread.id, boardId, creatorId, input.thread.title, input.thread.language ?? "ja",
      input.thread.region ?? "global", input.thread.threadType ?? (input.thread.bestAnswerPostId ? "question" : "chat"),
      JSON.stringify(normalizeThreadTags(input.thread.tags)), input.thread.slowModeSeconds ?? 0,
      input.thread.pinned ? 1 : 0, createdAt, input.thread.updatedAt
    ).run();
  await replaceD1ContentTags(database, "thread", input.thread.id, inferContentTagSignals({
    target: "thread",
    title: input.thread.title,
    body: input.posts[0]?.body ?? "",
    board: input.board.title,
    solved: Boolean(input.thread.solvedAt || input.thread.bestAnswerPostId),
    existingCategory: input.thread.threadType,
    publisherTags: input.thread.tags,
  }));
  for (const post of input.posts) {
    await database.prepare(`INSERT OR IGNORE INTO thread_posts
      (id, thread_id, post_no, author_profile_id, display_name, body, reply_to_post_id, created_at,
       is_anonymous, edited_at, deleted_at, moderated_at, moderation_reason)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
        post.id, post.threadId, post.no, post.authorProfileId, post.displayName,
        post.body || "削除された投稿です。", post.replyToPostId ?? null, post.createdAt,
        post.isAnonymous ? 1 : 0, post.editedAt ?? null, post.deletedAt ?? null,
        post.moderatedAt ?? null, post.moderationReason ?? null
      ).run();
  }
  if (input.thread.bestAnswerPostId) {
    await database.prepare("UPDATE threads SET best_answer_post_id = ?, solved_at = ? WHERE id = ?")
      .bind(input.thread.bestAnswerPostId, input.thread.solvedAt ?? input.thread.updatedAt, input.thread.id).run();
  }
}

export async function createD1ThreadReply(database: D1Database, viewer: Profile, input: {
  knowledge?: ThreadPostKnowledgeInput;
  threadId: string;
  body: string;
  identityMode: "anonymous" | "account";
  replyToPostId?: string | null;
  declaredLanguage: ThreadLanguage;
  declaredRegion: ThreadRegion;
}): Promise<D1ThreadPostView> {
  const thread = await getD1Thread(database, input.threadId);
  if (!thread) throw new Error("Thread does not exist.");
  if ((thread.status ?? "open") !== "open") throw new Error("このスレッドは返信を受け付けていません。");
  if (thread.threadType === "recruitment" && thread.deadline && Date.parse(`${thread.deadline}T23:59:59Z`) < Date.now()) {
    throw new Error("この募集は期限を過ぎたため受付を終了しました。");
  }
  if (thread.moderationStatus === "frozen") throw new Error("このスレッドは運営により凍結されています。");
  if (thread.mergedIntoThreadId) throw new Error("このスレッドは別のスレッドへ統合されています。");
  const slowModeSeconds = thread.slowModeSeconds ?? 0;
  if (slowModeSeconds > 0) {
    const latest = await database.prepare(`SELECT created_at FROM thread_posts
      WHERE thread_id = ? AND author_profile_id = ? ORDER BY created_at DESC LIMIT 1`)
      .bind(input.threadId, viewer.id).first<{ created_at: string }>();
    if (latest) {
      const remainingMs = Date.parse(latest.created_at) + slowModeSeconds * 1000 - Date.now();
      if (remainingMs > 0) throw new HubPostRateLimitError(Math.ceil(remainingMs / 1000));
    }
  }
  if (input.replyToPostId) {
    const target = await database.prepare("SELECT id FROM thread_posts WHERE id = ? AND thread_id = ?")
      .bind(input.replyToPostId, input.threadId).first<{ id: string }>();
    if (!target) throw new Error("Reply target does not exist.");
  }
  const targetOwner = await database.prepare(`SELECT author_profile_id FROM thread_posts
    WHERE id = COALESCE(?, (SELECT id FROM thread_posts WHERE thread_id = ? AND post_no = 1))`)
    .bind(input.replyToPostId ?? null, input.threadId).first<{ author_profile_id: string | null }>();
  await requireNoD1BlockBetween(database, viewer.id, targetOwner?.author_profile_id);
  const postId = crypto.randomUUID();
  const now = new Date().toISOString();
  const knowledge = input.knowledge ? await prepareThreadPostKnowledge(database, { ...input.knowledge, postId, threadId: input.threadId, profileId: viewer.id }, now) : [];
  await consumeD1PostQuota(database, viewer, "thread_reply");
  const anonymous = input.identityMode === "anonymous";
  await database.batch([
    database.prepare(`INSERT INTO thread_posts
      (id, thread_id, post_no, author_profile_id, display_name, body, reply_to_post_id, created_at, declared_language, declared_region,
       is_anonymous, edited_at, deleted_at, moderated_at, moderation_reason)
      SELECT ?, ?, COALESCE(MAX(post_no), 0) + 1, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL
      FROM thread_posts WHERE thread_id = ?`).bind(
        postId, input.threadId, viewer.id, anonymous ? "名無しさん" : viewer.displayName, input.body,
        input.replyToPostId ?? null, now, input.declaredLanguage, input.declaredRegion, anonymous ? 1 : 0, input.threadId
      ),
    database.prepare("UPDATE threads SET updated_at = ? WHERE id = ?").bind(now, input.threadId),
    ...knowledge,
  ]);

  if (targetOwner?.author_profile_id && targetOwner.author_profile_id !== viewer.id) {
    await createD1SocialNotification(database, {
      receiverProfileId: targetOwner.author_profile_id,
      actorProfileId: anonymous ? null : viewer.id,
      safetyActorProfileId: viewer.id,
      type: "thread_reply",
      targetType: "thread_post",
      targetId: postId,
      text: anonymous
        ? "スレッドに匿名の返信があります。"
        : `${viewer.displayName}さんから返信があります。`,
      preference: "replies",
      createdAt: now,
    });
  }
  await queueThreadFollowerNotifications(database, { threadId: input.threadId, postId, actorProfileId: viewer.id, excludedProfileId: targetOwner?.author_profile_id, createdAt: now });
  const posts = await listD1ThreadPosts(database, input.threadId);
  const created = posts.find((post) => post.id === postId);
  if (!created) throw new Error("Reply could not be created.");
  return created;
}

export const THREAD_SLOW_MODE_OPTIONS = [0, 30, 60, 300, 900, 3600] as const;

export async function setD1ThreadStatus(database: D1Database, threadId: string, profileId: string, status: "open" | "closed" | "archived") {
  const owner = await database.prepare("SELECT created_by_profile_id FROM threads WHERE id = ?")
    .bind(threadId).first<{ created_by_profile_id: string | null }>();
  if (!owner) throw new Error("Thread does not exist.");
  if (owner.created_by_profile_id !== profileId) throw new Error("スレッド作成者だけが状態を変更できます。");
  await database.prepare("UPDATE threads SET status = ?, updated_at = ? WHERE id = ?")
    .bind(status, new Date().toISOString(), threadId).run();
  return getD1Thread(database, threadId);
}

export async function setD1ThreadSlowMode(
  database: D1Database,
  threadId: string,
  profileId: string,
  seconds: number,
): Promise<ThreadSummary> {
  if (!THREAD_SLOW_MODE_OPTIONS.includes(seconds as (typeof THREAD_SLOW_MODE_OPTIONS)[number])) {
    throw new Error("スローモードの設定値が正しくありません。");
  }
  const owner = await database.prepare("SELECT created_by_profile_id FROM threads WHERE id = ?")
    .bind(threadId).first<{ created_by_profile_id: string | null }>();
  if (!owner) throw new Error("Thread does not exist.");
  if (owner.created_by_profile_id !== profileId) throw new Error("Only the thread author can change slow mode.");
  await database.prepare("UPDATE threads SET slow_mode_seconds = ? WHERE id = ?").bind(seconds, threadId).run();
  const thread = await getD1Thread(database, threadId);
  if (!thread) throw new Error("Thread does not exist.");
  return thread;
}

export async function getD1ThreadTracking(database: D1Database, threadId: string, profileId: string): Promise<ThreadTracking | undefined> {
  const row = await database.prepare(`SELECT following, last_read_post_no, updated_at, notification_mode FROM thread_tracking
    WHERE thread_id = ? AND profile_id = ?`).bind(threadId, profileId).first<{ following: number; last_read_post_no: number; updated_at: string; notification_mode: ThreadTracking["notificationMode"] }>();
  return row ? { threadId, profileId, following: Boolean(row.following), lastReadPostNo: Number(row.last_read_post_no), updatedAt: row.updated_at, notificationMode: row.notification_mode ?? "instant" } : undefined;
}

export async function setD1ThreadNotificationMode(database: D1Database, threadId: string, profileId: string, mode: NonNullable<ThreadTracking["notificationMode"]>) {
  if (!["instant", "digest", "important", "none"].includes(mode)) throw new Error("通知頻度が正しくありません。");
  const now = new Date().toISOString();
  await database.prepare(`INSERT INTO thread_tracking(thread_id,profile_id,following,last_read_post_no,updated_at,notification_mode)
    VALUES(?,?,?,0,?,?) ON CONFLICT(thread_id,profile_id) DO UPDATE SET following=excluded.following,notification_mode=excluded.notification_mode,updated_at=excluded.updated_at`)
    .bind(threadId,profileId,mode === "none" ? 0 : 1,now,mode).run();
  return getD1ThreadTracking(database,threadId,profileId);
}

export async function toggleD1ThreadFollowing(database: D1Database, threadId: string, profileId: string): Promise<ThreadTracking> {
  if (!await getD1Thread(database, threadId)) throw new Error("Thread does not exist.");
  const now = new Date().toISOString();
  await database.prepare(`INSERT INTO thread_tracking (thread_id, profile_id, following, last_read_post_no, updated_at)
    VALUES (?, ?, 1, 0, ?) ON CONFLICT(thread_id, profile_id) DO UPDATE SET
    following = 1 - following, updated_at = excluded.updated_at`).bind(threadId, profileId, now).run();
  return (await getD1ThreadTracking(database, threadId, profileId))!;
}

export async function markD1ThreadRead(database: D1Database, threadId: string, profileId: string, requestedPostNo: number): Promise<ThreadTracking> {
  const thread = await getD1Thread(database, threadId);
  if (!thread) throw new Error("Thread does not exist.");
  const lastReadPostNo = Math.max(0, Math.min(requestedPostNo, thread.postCount));
  const now = new Date().toISOString();
  await database.prepare(`INSERT INTO thread_tracking (thread_id, profile_id, following, last_read_post_no, updated_at)
    VALUES (?, ?, 0, ?, ?) ON CONFLICT(thread_id, profile_id) DO UPDATE SET
    last_read_post_no = MAX(last_read_post_no, excluded.last_read_post_no), updated_at = excluded.updated_at`)
    .bind(threadId, profileId, lastReadPostNo, now).run();
  return (await getD1ThreadTracking(database, threadId, profileId))!;
}

export async function setD1ThreadBestAnswer(database: D1Database, threadId: string, postId: string | null, profileId: string): Promise<ThreadSummary> {
  const owner = await database.prepare("SELECT created_by_profile_id, thread_type FROM threads WHERE id = ?")
    .bind(threadId).first<{ created_by_profile_id: string | null; thread_type: ThreadType }>();
  if (!owner) throw new Error("Thread does not exist.");
  if (owner.thread_type !== "question") throw new Error("ベスト回答を選べるのは質問スレッドだけです。");
  if (owner.created_by_profile_id !== profileId) throw new Error("Only the thread author can select the best answer.");
  if (postId) {
    const post = await database.prepare("SELECT post_no FROM thread_posts WHERE id = ? AND thread_id = ? AND deleted_at IS NULL AND moderated_at IS NULL")
      .bind(postId, threadId).first<{ post_no: number }>();
    if (!post || post.post_no <= 1) throw new Error("Best answer must be a visible reply in this thread.");
  }
  const solvedAt = postId ? new Date().toISOString() : null;
  await database.prepare("UPDATE threads SET best_answer_post_id = ?, solved_at = ? WHERE id = ?")
    .bind(postId, solvedAt, threadId).run();
  const thread = await getD1Thread(database, threadId);
  if (!thread) throw new Error("Thread does not exist.");
  return thread;
}
