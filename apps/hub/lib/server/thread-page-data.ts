import "server-only";

import { Board, EngagementSummary, Profile, ThreadPost, ThreadSummary, ThreadTracking } from "@/lib/domain";
import { buildBoardCatalog, normalizeBoardKey } from "@/lib/bbs-board-catalog";
import { toPublicThreadPost } from "@/lib/thread-privacy";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { getD1UserControls } from "@/lib/server/thread-moderation-repository";
import { redactGated, type GateAccessState } from "@/lib/server/gated-content";
import { getD1Thread, getD1ThreadTracking, listD1ThreadPosts, listD1Threads } from "@/lib/server/d1-threads";
import { findSimilarThreads } from "@/lib/thread-abuse-controls";
import { getHubViewer } from "@/lib/server/hub-viewer";
import { getD1ThreadPostEngagementSummaries } from "@/lib/server/d1-engagements";
import { countD1VisibleUnreadNotifications } from "@/lib/server/visible-notification-count";
import { countD1VisibleUnreadMessages } from "@/lib/server/visible-message-count";
import { getBbsDirectoryGroups, getBbsDirectoryTags } from "@/lib/server/bbs-page-data";
import type { ThreadTagSummary } from "@/lib/thread-tags";
import { attachImagesToPosts, type SocialPostImage } from "@/lib/server/social-post-images";
import { getD1ThreadPostVoteSummaries, getD1TrustedThreadPostVoteScores } from "@/lib/server/d1-thread-post-votes";
import { listThreadPostKnowledge, type ThreadPostKnowledge } from "@/lib/server/d1-thread-knowledge";
import type { ThreadWorkflowState } from "@/lib/thread-knowledge";
import { getThreadAnonymousLabel } from "@/lib/thread-anonymous-label";

interface ThreadPagePost extends ThreadPost {
  accessGate?: GateAccessState;
  engagement: EngagementSummary;
  authorAvatarUrl?: string;
  authorHandle?: string;
  viewerIsAuthor: boolean;
  canControlAuthor: boolean;
  viewerMuted: boolean;
  viewerBlocked: boolean;
  spotlightScore?: number;
  images?: SocialPostImage[];
  replyTargetNo?: number;
  replyTargetDisplayName?: string;
  knowledge?: ThreadPostKnowledge;
}

export interface ThreadPageData {
  notificationCount: number;
  messageCount: number;
  thread: ThreadSummary | undefined;
  board: Board | undefined;
  posts: ThreadPagePost[];
  tracking: ThreadTracking | undefined;
  canManageThread: boolean;
  authenticated: boolean;
  boardGroups: Awaited<ReturnType<typeof getBbsDirectoryGroups>>;
  tagSummaries: ThreadTagSummary[];
  totalThreadCount: number;
  workflowState: ThreadWorkflowState;
  relatedThreads: Array<{id:string;title:string;relation:string}>;
  suggestedThreads:Array<{id:string;title:string}>;
}

async function getHiddenThreadAuthorIds(
  database: NonNullable<ReturnType<typeof getOptionalHubD1>>,
  viewerProfileId: string | null,
  authorProfileIds: readonly string[],
) {
  const uniqueAuthorIds = [...new Set(authorProfileIds.filter(Boolean))];
  if (uniqueAuthorIds.length === 0) return new Set<string>();

  const placeholders = uniqueAuthorIds.map(() => "?").join(", ");
  const viewerId = viewerProfileId ?? "";
  const result = await database.prepare(`SELECT p.id
    FROM profiles p
    WHERE p.id IN (${placeholders})
      AND (
        EXISTS (
          SELECT 1
          FROM profile_moderation_status moderation
          WHERE moderation.profile_id = p.id
            AND moderation.status = 'suspended'
        )
        OR (
          ? <> ''
          AND (
            EXISTS (
              SELECT 1
              FROM thread_user_controls outgoing_control
              WHERE outgoing_control.owner_profile_id = ?
                AND outgoing_control.target_profile_id = p.id
                AND (outgoing_control.muted = 1 OR outgoing_control.blocked = 1)
            )
            OR EXISTS (
              SELECT 1
              FROM thread_user_controls incoming_control
              WHERE incoming_control.owner_profile_id = p.id
                AND incoming_control.target_profile_id = ?
                AND incoming_control.blocked = 1
            )
          )
        )
      )`)
    .bind(...uniqueAuthorIds, viewerId, viewerId, viewerId)
    .all<{ id: string }>();
  return new Set(result.results.map((row) => row.id));
}

export async function getThreadPageData(threadId: string, options: { limit?: number; offset?: number; viewer?: Profile | null; skipCounts?: boolean } = {}): Promise<ThreadPageData> {
  const database = getOptionalHubD1();
  const currentProfile = options.viewer === undefined ? await getHubViewer() : options.viewer;
  const mockData = database ? null : await import("@/lib/mock-data");
  const persistedThread = database ? await getD1Thread(database, threadId) : undefined;
  const thread = persistedThread ?? mockData?.getThreadById(threadId);
  const board = thread
    ? buildBoardCatalog().find(
      (candidate) =>
        normalizeBoardKey(candidate.key) === normalizeBoardKey(thread.boardKey),
    )
    : undefined;
  /*
   * Everything below the thread row except the posts themselves (unread counts, workflow
   * state, related and similar threads, the board directory, tracking) does not depend on the
   * posts, so it loads concurrently with them instead of after them.
   */
  const sidePromise = (async () => {
    const [d1Counts, workflow, related, similarCandidates, boardGroups, tagSummaries, tracking] = await Promise.all([
      database && currentProfile && !options.skipCounts ? Promise.all([
        countD1VisibleUnreadNotifications(database, currentProfile.id),
        countD1VisibleUnreadMessages(database, currentProfile.id)
      ]) : null,
      database && thread ? database.prepare("SELECT state FROM thread_workflow_states WHERE thread_id=?").bind(thread.id).first<{state:ThreadWorkflowState}>() : null,
      database && thread ? database.prepare(`SELECT t.id,t.title,r.relation FROM thread_relations r JOIN threads t ON t.id=r.target_thread_id WHERE r.source_thread_id=? UNION SELECT t.id,t.title,r.relation FROM thread_relations r JOIN threads t ON t.id=r.source_thread_id WHERE r.target_thread_id=? LIMIT 12`).bind(thread.id,thread.id).all<{id:string;title:string;relation:string}>() : null,
      database && thread ? listD1Threads(database,undefined,50) : null,
      getBbsDirectoryGroups(),
      getBbsDirectoryTags(),
      thread && currentProfile
        ? database
          ? getD1ThreadTracking(database, thread.id, currentProfile.id)
          : mockData?.getThreadTracking(thread.id, currentProfile.id)
        : undefined,
    ]);
    const suggestions = thread && similarCandidates
      ? findSimilarThreads(thread.title, similarCandidates.filter(item=>item.id!==thread.id)).slice(0,5).map(item=>({id:item.id,title:item.title}))
      : [];
    return { d1Counts, workflow, related, suggestions, boardGroups, tagSummaries, tracking };
  })();
  const postsPromise = (async () => {
  // Token gates: a gated thread hides every post body and image from viewers who do not pass the gate.
  const persistedThreadPosts = database && persistedThread
    ? await redactGated(database, currentProfile?.id ?? null, await listD1ThreadPosts(database, threadId, options.limit, options.offset), "thread", { context: "detail", keyOf: (post: { threadId: string }) => post.threadId })
    : null;
  const allMockPosts = thread && mockData ? mockData.getPostsForThread(thread.id) : [];
  const rawPosts = persistedThreadPosts ?? allMockPosts.slice(options.offset ?? 0, options.limit ? (options.offset ?? 0) + options.limit : undefined);
  const ownerPost = options.offset && database && persistedThread ? (await listD1ThreadPosts(database, threadId, 1, 0))[0] : rawPosts[0];
  const hiddenAuthorIds = database
    ? await getHiddenThreadAuthorIds(
        database,
        currentProfile?.id ?? null,
        rawPosts.flatMap((post) => post.authorProfileId ? [post.authorProfileId] : []),
      )
    : new Set<string>();
  const persistedControls = database && currentProfile
    ? await getD1UserControls(database, currentProfile.id)
    : new Map();
  const [spotlightScores, voteSummaries, knowledgeByPost, engagementByPost] = database && persistedThread
    ? await Promise.all([
        getD1TrustedThreadPostVoteScores(database, threadId),
        getD1ThreadPostVoteSummaries(database, threadId, currentProfile?.id ?? null),
        listThreadPostKnowledge(database, threadId),
        getD1ThreadPostEngagementSummaries(
          database,
          rawPosts.map((post) => post.id),
          currentProfile?.id ?? null,
        ),
      ])
    : [new Map<string, number>(), new Map(), new Map(), new Map<string, EngagementSummary>()];
  const posts: ThreadPagePost[] = rawPosts.map((rawPost): ThreadPagePost => {
        const storedControl = rawPost.authorProfileId && currentProfile ? persistedControls.get(rawPost.authorProfileId) : undefined;
        const control = storedControl
          ? { canControl: rawPost.authorProfileId !== currentProfile?.id, ...storedControl }
          : database && currentProfile
            ? { canControl: Boolean(rawPost.authorProfileId && rawPost.authorProfileId !== currentProfile.id), muted: false, blocked: false }
          : currentProfile && mockData
            ? mockData.getThreadUserControlForPost(rawPost.id, currentProfile.id)
            : { canControl: false, muted: false, blocked: false };
        const post = toPublicThreadPost(rawPost);
        const author = post.authorProfileId && mockData
          ? mockData.getProfileById(post.authorProfileId)
          : undefined;
        const hiddenBySafety = Boolean(
          rawPost.authorProfileId
          && (
            hiddenAuthorIds.has(rawPost.authorProfileId)
            || control.muted
            || control.blocked
          )
        );

        const engagement = engagementByPost.get(post.id)
          ?? mockData?.getEngagementSummary("thread_post", post.id)
          ?? {
            targetType: "thread_post",
            targetId: post.id,
            replyCount: 0,
            repostCount: 0,
            quoteRepostCount: 0,
            likeCount: 0,
            score: 0,
            bookmarked: false,
            viewerReaction: null,
          };
        return {
          ...post,
          body: hiddenBySafety ? "" : post.body,
          displayName: hiddenBySafety
            ? "表示できないユーザー"
            : post.isAnonymous && rawPost.authorProfileId
            ? `${getThreadAnonymousLabel(threadId, rawPost.authorProfileId)}${currentProfile && rawPost.authorProfileId === currentProfile.id ? "（自分）" : ""}`
            : post.displayName,
          engagement,
          spotlightScore: spotlightScores.get(post.id) ?? engagement.score,
          voteSummary: voteSummaries.get(post.id) ?? { up: 0, down: 0, score: 0, viewerVote: null },
          knowledge: hiddenBySafety || (rawPost as { accessGate?: unknown }).accessGate ? undefined : knowledgeByPost.get(post.id),
          authorAvatarUrl: hiddenBySafety || post.isAnonymous
            ? undefined
            : "authorAvatarUrl" in rawPost && typeof rawPost.authorAvatarUrl === "string"
              ? rawPost.authorAvatarUrl
              : author?.avatarUrl,
          authorHandle: hiddenBySafety || post.isAnonymous
            ? undefined
            : "authorHandle" in rawPost && typeof rawPost.authorHandle === "string"
              ? rawPost.authorHandle
              : author?.handle,
          viewerIsAuthor: Boolean(currentProfile && rawPost.authorProfileId === currentProfile.id),
          canControlAuthor: control.canControl,
          viewerMuted: control.muted,
          viewerBlocked: control.blocked || Boolean(
            rawPost.authorProfileId
            && hiddenAuthorIds.has(rawPost.authorProfileId)
          )
        };
      });
  if (database) {
    await attachImagesToPosts(database, posts);
    for (const post of posts) {
      if (post.viewerMuted || post.viewerBlocked || post.accessGate) post.images = undefined;
    }
  }

  return { posts, ownerPost };
  })();
  const [{ posts, ownerPost }, { d1Counts, workflow, related, suggestions, boardGroups, tagSummaries, tracking }] = await Promise.all([postsPromise, sidePromise]);
  return {
    notificationCount: d1Counts ? Number(d1Counts[0] ?? 0) : 0,
    messageCount: d1Counts ? Number(d1Counts[1] ?? 0) : 0,
    thread,
    board,
    posts,
    tracking,
    canManageThread: Boolean(currentProfile && ownerPost?.authorProfileId === currentProfile.id),
    authenticated: Boolean(currentProfile),
    boardGroups,
    tagSummaries,
    totalThreadCount: boardGroups.reduce((total, group) => total + group.boards.reduce((sum, item) => sum + item.threadCount, 0), 0)
    ,workflowState: workflow?.state ?? "open"
    ,relatedThreads: related?.results ?? []
    ,suggestedThreads:suggestions
  };
}
