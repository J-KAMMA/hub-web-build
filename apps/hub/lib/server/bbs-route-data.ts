import "server-only";

import type { D1Database } from "@cloudflare/workers-types";
import type { Profile, ThreadPost, ThreadSummary } from "@/lib/domain";
import { toPublicThreadPost } from "@/lib/thread-privacy";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { requireHubViewerProfile } from "@/lib/server/desktop-hub-auth";
import { HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";
import { createD1Thread, createD1ThreadReply, getD1Thread, importThreadIntoD1, listD1ThreadPosts, listD1ThreadsPage, type D1ThreadListView } from "@/lib/server/d1-threads";
import { safelyIngestVideosFromPublicBody } from "@/lib/server/auto-ingest-post-videos";
import { findSimilarThreads } from "@/lib/thread-abuse-controls";
import type { ThreadPostRole, ThreadSource } from "@/lib/thread-knowledge";
import type { ThreadLanguage, ThreadRegion } from "@/lib/thread-scope";
import { validateThreadReplyScope } from "@/lib/thread-scope-policy";
import { normalizeThreadCountries, normalizeThreadLanguageTags, type ThreadLanguageTag } from "@/lib/thread-fine-scope";
import { enforceThreadIpPolicy, normalizeThreadIpPolicy, requestClientIp, type ThreadIpPolicy } from "@/lib/server/thread-ip-policy";
import { getBbsThreadsListData, type BbsThreadsListData } from "@/lib/server/bbs-thread-list-data";
import { redactGated } from "@/lib/server/gated-content";

type ThreadPosts = ThreadPost[];
type CreateThreadInput = {
  researchSource?: import("@/lib/research-workspace").ResearchDiscussionSource;
  researchGitSource?: import("@/lib/research-git-discussion").ResearchGitDiscussionSource;
  boardKey: string;
  continuationFrom?: string;
  requestId?: string;
  title: string;
  body: string;
  identityMode?: "anonymous" | "account";
  authorProfileId?: string;
  language?: ThreadLanguage;
  region?: ThreadRegion;
  threadType?: import("@/lib/thread-type").ThreadType;
  deadline?: string | null;
  tags?: string[];
  allowedLanguages?: ThreadLanguage[];
  allowedLanguageTags?: ThreadLanguageTag[];
  allowedCountryCodes?: string[];
  writeIpPolicy?: ThreadIpPolicy;
};
type CreateThreadResult = { thread: ThreadSummary; post: ThreadPost };
type CreateThreadReplyInput = {
  threadId: string;
  body: string;
  identityMode?: "anonymous" | "account";
  displayName?: string;
  authorProfileId?: string;
  replyToPostId?: string | null;
  imageIds?: string[];
  role?: ThreadPostRole;
  supersedesPostId?: string | null;
  sources?: ThreadSource[];
  declaredLanguage: ThreadLanguage;
  declaredRegion: ThreadRegion;
  declaredLanguageTag?: ThreadLanguageTag;
  declaredCountryCode?: string | null;
};

export async function getMockBbsData() {
  return import("@/lib/mock-data");
}

export interface BbsThreadsRouteData extends BbsThreadsListData {}

export interface BbsThreadPostsRouteData {
  posts: ThreadPosts;
}

export interface CreateThreadReplyRouteData {
  post: ThreadPost;
}

export async function getBbsThreadsRouteData(boardKey?: string, limit = 50, offset = 0): Promise<BbsThreadsRouteData> {
  return getBbsThreadsListData(boardKey, limit, offset);
}

export async function searchBbsThreadsRouteData(options: {
  boardKeys?: string[];
  query?: string;
  view?: D1ThreadListView;
  limit?: number;
  offset?: number;
}): Promise<BbsThreadsRouteData> {
  const database = getOptionalHubD1();
  if (database) return listD1ThreadsPage(database, options);
  const { getThreads } = await getMockBbsData();
  const boardKeys = new Set(options.boardKeys ?? []);
  const query = (options.query ?? "").normalize("NFKC").trim().toLocaleLowerCase();
  const filtered = getThreads().filter((thread) => {
    if (boardKeys.size && !boardKeys.has(thread.boardKey)) return false;
    if (query && !thread.title.normalize("NFKC").toLocaleLowerCase().includes(query)) return false;
    if (options.view === "unanswered" && (thread.threadType !== "question" || thread.postCount > 1)) return false;
    if (options.view === "solved" && !thread.solvedAt) return false;
    return true;
  });
  const sorted = [...filtered].sort((left, right) => options.view === "latest"
    ? right.updatedAt.localeCompare(left.updatedAt)
    : right.postCount - left.postCount || right.updatedAt.localeCompare(left.updatedAt));
  const limit = Math.max(1, Math.min(50, Math.trunc(options.limit ?? 50)));
  const offset = Math.max(0, Math.trunc(options.offset ?? 0));
  return { threads: sorted.slice(offset, offset + limit), total: sorted.length, limit, offset };
}

export async function getSimilarBbsThreadsRouteData(title: string) {
  const normalizedTitle = title.trim().slice(0, 240);
  if (normalizedTitle.length < 4) return { threads: [] };
  const { threads } = await getBbsThreadsRouteData();
  const { getBoardByKey } = await getMockBbsData();
  return {
    threads: findSimilarThreads(normalizedTitle, threads).map((thread) => ({
      id: thread.id,
      title: thread.title,
      boardKey: thread.boardKey,
      boardTitle: getBoardByKey(thread.boardKey)?.title ?? "スレッド",
      updatedAt: thread.updatedAt,
    })),
  };
}

export async function createBbsThreadRouteData(request: Request, input: CreateThreadInput): Promise<CreateThreadResult> {
  const database = getOptionalHubD1();
  if (!database) throw new HubAuthenticationError("Hub D1 session is required.");
  const viewer = await requireHubSessionProfile(request, database);
  return createBbsThreadForViewer(database, viewer, input);
}

/** viewerを外から渡す版——desktop assertionのクライアントAPIからも同じ作成経路を通す。 */
export async function createBbsThreadForViewer(
  database: D1Database,
  viewer: Profile,
  input: CreateThreadInput,
): Promise<CreateThreadResult> {
  if (input.continuationFrom) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(input.continuationFrom)) throw new Error("前スレッドの指定が正しくありません。");
    const source = await getD1Thread(database, input.continuationFrom);
    if (!source || source.postCount < 900 || source.moderationStatus === "frozen" || source.mergedIntoThreadId || source.boardKey !== input.boardKey) throw new Error("このスレッドから続きは作成できません。");
    input = { ...input, language: source.language, region: source.region, threadType: source.threadType,
      allowedLanguages: source.allowedLanguages, allowedLanguageTags: source.allowedLanguageTags,
      allowedCountryCodes: source.allowedCountryCodes, writeIpPolicy: source.writeIpPolicy, tags: source.tags };
  }
  const { getBoardByKey } = await getMockBbsData();
  const board = getBoardByKey(input.boardKey);
  if (!board) throw new Error("Board does not exist.");
  const identityMode = input.identityMode === "anonymous" ? "anonymous" : "account";
  const result = await createD1Thread(database, viewer, board, {
    title: input.title,
    body: input.body,
    continuationFrom: input.continuationFrom,
    requestId: input.requestId,
    researchSource: input.researchSource,
    researchGitSource: input.researchGitSource,
    identityMode,
    language: input.language ?? "ja",
    allowedLanguages: input.allowedLanguages ?? [input.language ?? "ja"],
    allowedLanguageTags: normalizeThreadLanguageTags(input.allowedLanguageTags),
    allowedCountryCodes: normalizeThreadCountries(input.allowedCountryCodes),
    writeIpPolicy: normalizeThreadIpPolicy(input.writeIpPolicy),
    region: input.region ?? "global",
    threadType: input.threadType ?? "chat",
    deadline: input.deadline ?? null,
    tags: input.tags ?? []
  });
  await safelyIngestVideosFromPublicBody(database, viewer, input.body, {
    identityMode,
    ingestSource: "thread"
  });
  return { ...result, post: toPublicThreadPost(result.post) };
}

export async function getBbsThreadPostsRouteData(threadId: string, viewerProfileId: string | null = null): Promise<BbsThreadPostsRouteData> {
  const database = getOptionalHubD1();
  if (database && await getD1Thread(database, threadId)) {
    // Token gates: viewers who do not pass a thread's gate get posts without bodies.
    const posts = await redactGated(database, viewerProfileId, await listD1ThreadPosts(database, threadId), "thread", { context: "detail", keyOf: (post: { threadId: string }) => post.threadId });
    return { posts: posts.map(toPublicThreadPost) };
  }
  const { getPostsForThread } = await getMockBbsData();
  return {
    posts: getPostsForThread(threadId).map(toPublicThreadPost)
  };
}

export async function ensureD1ThreadAvailable(threadId: string) {
  const database = getOptionalHubD1();
  if (!database) return null;
  if (await getD1Thread(database, threadId)) return database;
  const { getBoardByKey, getPostsForThread, getProfileById, getThreadById } = await getMockBbsData();
  const thread = getThreadById(threadId);
  const board = thread ? getBoardByKey(thread.boardKey) : undefined;
  if (!thread || !board) return database;
  const posts = getPostsForThread(threadId);
  const profiles = [...new Set(posts.flatMap((post) => post.authorProfileId ? [post.authorProfileId] : []))]
    .map((id) => getProfileById(id))
    .filter((profile): profile is NonNullable<typeof profile> => Boolean(profile));
  await importThreadIntoD1(database, { board, thread, posts, profiles });
  return database;
}

export async function ensureD1ThreadPostAvailable(postId: string) {
  const { getThreadPostById } = await getMockBbsData();
  const mockPost = getThreadPostById(postId);
  if (mockPost) await ensureD1ThreadAvailable(mockPost.threadId);
}

export async function createBbsThreadReplyRouteData(request: Request, input: CreateThreadReplyInput): Promise<CreateThreadReplyRouteData> {
  const database = await ensureD1ThreadAvailable(input.threadId);
  if (!database) throw new HubAuthenticationError("Hub D1 session is required.");
  const thread = await getD1Thread(database, input.threadId);
  if (!thread) throw new Error("Thread does not exist.");
  const ipError = enforceThreadIpPolicy(thread.writeIpPolicy ?? { mode: "none", cidrs: [] }, requestClientIp(request));
  if (ipError) throw new Error(ipError);
  const languageTags = thread.allowedLanguageTags ?? normalizeThreadLanguageTags([], "ja-JP");
  if (!input.declaredLanguageTag || !languageTags.includes(input.declaredLanguageTag)) {
    throw new Error("このスレッドでは選択した言語・方言を使用できません。");
  }
  const countries = thread.allowedCountryCodes ?? [];
  if (countries.length && (!input.declaredCountryCode || !countries.includes(input.declaredCountryCode))) {
    throw new Error("このスレッドの対象国・地域外の内容は投稿できません。");
  }
  const scopeError = validateThreadReplyScope({
    body: input.body,
    declaredLanguage: input.declaredLanguage,
    declaredRegion: input.declaredRegion,
    allowedLanguages: thread.allowedLanguages ?? [thread.language ?? "ja"],
    targetRegion: thread.region ?? "global",
  });
  if (scopeError) throw new Error(scopeError);
  const viewer = await requireHubViewerProfile(request, database);
  const { validatePendingImages, publishImages } = await import("@/lib/server/social-post-images");
  const imageIds = input.imageIds ?? [];
  await validatePendingImages(database, viewer.id, imageIds);
  const identityMode = input.identityMode === "anonymous" ? "anonymous" : "account";
  const post = await createD1ThreadReply(database, viewer, {
    threadId: input.threadId,
    body: input.body,
    identityMode,
    replyToPostId: input.replyToPostId,
    declaredLanguage: input.declaredLanguage,
    declaredRegion: input.declaredRegion,
    knowledge: input.role !== undefined || input.supersedesPostId !== undefined || input.sources !== undefined
      ? { role: input.role ?? "unspecified", supersedesPostId: input.supersedesPostId, sources: input.sources ?? [] } : undefined,
  });
  await publishImages(database, viewer.id, post.id, imageIds);
  const eventType = input.role === "correction" ? "correction" : post.no === 2 ? "first_reply" : null;
  if (eventType) await database.prepare("INSERT INTO thread_operational_events(id,thread_id,event_type,post_id,occurred_at) VALUES(?,?,?,?,?)")
    .bind(crypto.randomUUID(), input.threadId, eventType, post.id, post.createdAt).run().catch(() => undefined);
  await safelyIngestVideosFromPublicBody(database, viewer, input.body, {
    identityMode,
    ingestSource: "thread_reply"
  });
  return { post: toPublicThreadPost(post) };
}
