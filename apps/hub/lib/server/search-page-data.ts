import "server-only";

import { buildBoardCatalog } from "@/lib/bbs-board-catalog";
import { rankPopularFeed } from "@/lib/feed-ranking";
import { HUBPEDIA_RAIL_ARTICLES } from "@/lib/encyclopedia/hubpedia-rail-catalog";
import { getBbsThreadsListData } from "@/lib/server/bbs-thread-list-data";
import { getHomePageData } from "@/lib/server/home-page-data";
import type { ServerTimelinePost } from "@/lib/server/social-timeline-post";
import type { AppShellTimelinePost } from "@/lib/server/app-shell-data";
import { MOCK_IMAGE_POSTS } from "@/lib/mock-image-posts";

export interface SearchDiscoveryData {
  dedicatedNews: boolean;
  threads: Array<{
    id: string;
    title: string;
    boardTitle: string;
    postCount: number;
    updatedAt: string;
  }>;
  posts: Array<
    Pick<ServerTimelinePost, "id" | "displayName" | "body" | "score"> &
    Partial<ServerTimelinePost>
  >;
  images: Array<Pick<ServerTimelinePost, "id" | "displayName" | "body" | "score"> & Partial<ServerTimelinePost>>;
  hubpedia: Array<{
    slug: string;
    title: string;
    category: string;
    summary: string;
  }>;
}

export interface SearchPageData {
  currentProfileId: string;
  notificationCount: number;
  messageCount: number;
  discovery: SearchDiscoveryData;
}

function isNewsBoard(boardKey: string): boolean {
  return boardKey.startsWith("cat08-") || boardKey === "cat12-board02";
}

const boardTitleByKey = new Map(
  buildBoardCatalog().map((board) => [board.key, board.title]),
);

export async function getSearchPageData(): Promise<SearchPageData> {
  const [home, threadData] = await Promise.all([
    getHomePageData(),
    getBbsThreadsListData()
  ]);
  const newestThreads = [...threadData.threads].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt)
  );
  const newsThreads = newestThreads.filter((thread) => isNewsBoard(thread.boardKey));
  const displayedThreads = (newsThreads.length > 0 ? newsThreads : newestThreads).slice(0, 6);
  const popularPosts = rankPopularFeed(home.posts)
    .filter((post) => !post.replyToPostId)
    .slice(0, 5);
  const storedImages = rankPopularFeed(home.posts).filter((post) => Boolean(post.images?.length));
  const popularImages = [...storedImages, ...(process.env.NODE_ENV === "production" ? [] : MOCK_IMAGE_POSTS)]
    .filter((post, index, posts) => posts.findIndex((candidate) => candidate.id === post.id) === index)
    .slice(0, 20);
  const hubpedia = HUBPEDIA_RAIL_ARTICLES.slice(0, 4);

  return {
    currentProfileId: home.currentProfile.id,
    notificationCount: home.notificationCount,
    messageCount: home.messageCount,
    discovery: {
      dedicatedNews: newsThreads.length > 0,
      threads: displayedThreads.map((thread) => ({
        id: thread.id,
        title: thread.title,
        boardTitle: boardTitleByKey.get(thread.boardKey) ?? "スレッド",
        postCount: thread.postCount,
        updatedAt: thread.updatedAt
      })),
      posts: popularPosts,
      images: popularImages,
      hubpedia: hubpedia.map((article) => ({
        slug: article.slug,
        title: article.title,
        category: article.category,
        summary: article.summary
      }))
    }
  };
}

export async function getSearchDiscoveryData(
  posts: AppShellTimelinePost[],
  loadedThreadData?: Awaited<ReturnType<typeof getBbsThreadsListData>>
): Promise<SearchDiscoveryData> {
  const threadData = loadedThreadData ?? await getBbsThreadsListData();
  const newestThreads = [...threadData.threads].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const newsThreads = newestThreads.filter((thread) => isNewsBoard(thread.boardKey));
  const displayedThreads = (newsThreads.length > 0 ? newsThreads : newestThreads).slice(0, 6);
  const popularPosts = rankPopularFeed(posts).filter((post) => !post.replyToPostId).slice(0, 5);
  const storedImages = rankPopularFeed(posts).filter((post) => Boolean(post.images?.length));
  const popularImages = [...storedImages, ...(process.env.NODE_ENV === "production" ? [] : MOCK_IMAGE_POSTS)]
    .filter((post, index, items) => items.findIndex((candidate) => candidate.id === post.id) === index)
    .slice(0, 20);
  const hubpedia = HUBPEDIA_RAIL_ARTICLES.slice(0, 4);

  return {
    dedicatedNews: newsThreads.length > 0,
    threads: displayedThreads.map((thread) => ({
      id: thread.id,
      title: thread.title,
      boardTitle: boardTitleByKey.get(thread.boardKey) ?? "スレッド",
      postCount: thread.postCount,
      updatedAt: thread.updatedAt
    })),
    posts: popularPosts,
    images: popularImages,
    hubpedia: hubpedia.map((article) => ({
      slug: article.slug,
      title: article.title,
      category: article.category,
      summary: article.summary
    }))
  };
}
