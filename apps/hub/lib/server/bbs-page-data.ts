import "server-only";

import { buildBoardCatalog, getBoardGroups, normalizeBoardKey, syncBoardThreadCounts } from "@/lib/bbs-board-catalog";
import type { Board, Profile, ThreadSummary } from "@/lib/domain";
import { rankPopularThreads } from "@/lib/popular-threads";
import { THREAD_LANGUAGE_LABELS, THREAD_REGION_LABELS } from "@/lib/thread-scope";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { getHubViewer } from "@/lib/server/hub-viewer";
import { getBbsThreadPostsRouteData, getBbsThreadsRouteData } from "@/lib/server/bbs-route-data";
import { getD1BoardThreadCounts, listD1ThreadTagCounts } from "@/lib/server/d1-threads";
import { summarizeThreadTags, type ThreadTagSummary } from "@/lib/thread-tags";
import { countD1VisibleUnreadMessages } from "@/lib/server/visible-message-count";
import { countD1VisibleUnreadNotifications } from "@/lib/server/visible-notification-count";

export interface BbsPageData {
  currentProfile: Profile;
  notificationCount: number;
  messageCount: number;
  boards: Board[];
  boardGroups: ReturnType<typeof getBoardGroups>;
  tagSummaries: ThreadTagSummary[];
  popularThreads: BbsThreadItem[];
  allThreads: BbsThreadItem[];
  totalPostCount: number;
  totalThreadCount: number;
  authenticated: boolean;
}

export interface BbsThreadItem extends ThreadSummary {
  excerpt: string;
  searchText: string;
  recentPostCount: number;
  recentParticipantCount: number;
  activityPerHour: number;
}

export interface BbsBoardPageData {
  currentProfile: Profile;
  notificationCount: number;
  messageCount: number;
  board: Board | undefined;
  threads: ThreadSummary[];
  boardGroups: ReturnType<typeof getBoardGroups>;
  authenticated: boolean;
}

export async function getBbsDirectoryGroups() {
  const boards = buildBoardCatalog();
  const database = getOptionalHubD1();
  if (database) {
    const counts = await getD1BoardThreadCounts(database);
    for (const board of boards) board.threadCount = counts.get(board.key) ?? 0;
  } else {
    const threads = (await getBbsThreadsRouteData()).threads;
    syncBoardThreadCounts(boards, threads);
  }
  return getBoardGroups(boards);
}

export async function getBbsDirectoryTags(): Promise<ThreadTagSummary[]> {
  const database = getOptionalHubD1();
  if (database) return listD1ThreadTagCounts(database);
  const { getThreads } = await import("@/lib/mock-data");
  return summarizeThreadTags(getThreads());
}

export async function getBbsPageData(): Promise<BbsPageData> {
  const database = getOptionalHubD1();
  const viewer = await getHubViewer();
  const currentProfile = viewer ?? { id: "", handle: "guest", displayName: "ゲスト", bio: "", joinedAt: "" };
  let notificationCount = 0;
  let messageCount = 0;
  let threads: ThreadSummary[];
  let getFallbackPostsForThread:
    | ((threadId: string) => Awaited<ReturnType<typeof getBbsThreadPostsRouteData>>["posts"])
    | undefined;
  if (database) {
    [threads, notificationCount, messageCount] = await Promise.all([
      getBbsThreadsRouteData().then((data) => data.threads),
      viewer
        ? countD1VisibleUnreadNotifications(database, viewer.id, { excludeMessages: true })
          .then((count) => Number(count ?? 0))
        : Promise.resolve(0),
      viewer
        ? countD1VisibleUnreadMessages(database, viewer.id)
          .then((count) => Number(count ?? 0))
        : Promise.resolve(0),
    ]);
  } else {
    const {
      getConversations,
      getNotifications,
      getPostsForThread,
      getThreads,
    } = await import("@/lib/mock-data");
    const notifications = getNotifications();
    const conversations = getConversations();
    threads = getThreads();
    notificationCount = notifications.filter((item) => !item.isRead).length;
    messageCount = conversations.reduce(
      (total, conversation) =>
        total + (conversation.unreadCountByProfileId[currentProfile.id] ?? 0),
      0,
    );
    getFallbackPostsForThread = getPostsForThread;
  }
  const boards = buildBoardCatalog();
  if (database) {
    const counts = await getD1BoardThreadCounts(database);
    for (const board of boards) board.threadCount = counts.get(board.key) ?? 0;
  } else {
    syncBoardThreadCounts(boards, threads);
  }
  const recentThreshold = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const enrichedThreads = await Promise.all(threads.map(async (thread) => {
    const posts = database
      ? (await getBbsThreadPostsRouteData(thread.id)).posts
      : getFallbackPostsForThread?.(thread.id) ?? [];
    const recentPosts = posts.filter((post) => new Date(post.createdAt).getTime() >= recentThreshold);
    return {
      ...thread,
      recentPostCount: recentPosts.length,
      recentParticipantCount: new Set(
        recentPosts.map((post) => post.authorProfileId ?? `anonymous:${post.displayName}`)
      ).size,
      activityPerHour: recentPosts.length / (7 * 24),
      excerpt: posts[0]?.body ?? "",
      searchText: [
        posts.map((post) => post.body).join(" "),
        thread.language ? THREAD_LANGUAGE_LABELS[thread.language] : "",
        thread.region ? THREAD_REGION_LABELS[thread.region] : "",
        ...(thread.tags ?? [])
      ].join(" ")
    };
  }));

  const tagSummaries = database
    ? await listD1ThreadTagCounts(database)
    : summarizeThreadTags(threads);

  return {
    currentProfile,
    notificationCount,
    messageCount,
    boards,
    boardGroups: getBoardGroups(boards),
    tagSummaries,
    popularThreads: rankPopularThreads(enrichedThreads, 50),
    allThreads: enrichedThreads,
    totalPostCount: threads.reduce((total, thread) => total + thread.postCount, 0),
    totalThreadCount: boards.reduce((total, board) => total + board.threadCount, 0),
    authenticated: Boolean(viewer)
  };
}

export async function getBbsBoardPageData(boardKey: string): Promise<BbsBoardPageData> {
  const database = getOptionalHubD1();
  const viewer = await getHubViewer();
  const currentProfile = viewer ?? { id: "", handle: "guest", displayName: "ゲスト", bio: "", joinedAt: "" };
  let notificationCount = 0;
  let messageCount = 0;
  let allThreads: ThreadSummary[];
  if (database) {
    [allThreads, notificationCount, messageCount] = await Promise.all([
      getBbsThreadsRouteData().then((data) => data.threads),
      viewer
        ? countD1VisibleUnreadNotifications(database, viewer.id, { excludeMessages: true })
          .then((count) => Number(count ?? 0))
        : Promise.resolve(0),
      viewer
        ? countD1VisibleUnreadMessages(database, viewer.id)
          .then((count) => Number(count ?? 0))
        : Promise.resolve(0),
    ]);
  } else {
    const {
      getConversations,
      getNotifications,
      getThreads,
    } = await import("@/lib/mock-data");
    const notifications = getNotifications();
    const conversations = getConversations();
    allThreads = getThreads();
    notificationCount = notifications.filter((item) => !item.isRead).length;
    messageCount = conversations.reduce(
      (total, conversation) =>
        total + (conversation.unreadCountByProfileId[currentProfile.id] ?? 0),
      0,
    );
  }
  const boards = buildBoardCatalog();
  const board = boards.find(
    (candidate) => normalizeBoardKey(candidate.key) === normalizeBoardKey(boardKey),
  );
  syncBoardThreadCounts(boards, allThreads);
  const normalizedBoardKey = normalizeBoardKey(boardKey);

  return {
    currentProfile,
    notificationCount,
    messageCount,
    board,
    threads: allThreads.filter((thread) => normalizeBoardKey(thread.boardKey) === normalizedBoardKey),
    boardGroups: getBoardGroups(boards),
    authenticated: Boolean(viewer)
  };
}
