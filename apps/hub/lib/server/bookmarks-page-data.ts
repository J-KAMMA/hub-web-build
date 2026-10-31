import "server-only";

import type { D1Database } from "@cloudflare/workers-types";

import type { Profile } from "@/lib/domain";
import type { ServerTimelinePost } from "@/lib/server/social-timeline-post";
import { getHubD1 } from "@/lib/server/hub-d1";
import { getHubViewer } from "@/lib/server/hub-viewer";
import { listD1TimelinePosts } from "@/lib/server/d1-social-posts";
import { getD1Thread, getD1VisibleThreadPost } from "@/lib/server/d1-threads";
import { countD1VisibleUnreadMessages } from "@/lib/server/visible-message-count";
import { countD1VisibleUnreadNotifications } from "@/lib/server/visible-notification-count";
import { redactGated } from "@/lib/server/gated-content";

export type BookmarksPageItem =
  | {
      kind: "thread";
      id: string;
      href: string;
      title: string;
      note: string;
    }
  | {
      kind: "social";
      id: string;
      note: string;
      post: ServerTimelinePost;
    }
  | {
      kind: "reply";
      id: string;
      href: string;
      displayName: string;
      body: string;
      threadTitle: string;
      note: string;
    };

export interface BookmarksPageData {
  currentProfileId: string;
  notificationCount: number;
  messageCount: number;
  items: BookmarksPageItem[];
}

type D1BookmarkRow = {
  id: string;
  target_type: "thread" | "thread_post" | "social_post";
  target_id: string;
  note: string;
};

export async function getBookmarksPageData(): Promise<BookmarksPageData> {
  const database = getHubD1();
  const viewer = await getHubViewer();
  if (!viewer) {
    return {
      currentProfileId: "",
      notificationCount: 0,
      messageCount: 0,
      items: [],
    };
  }
  return getBookmarksPageDataForViewer(database, viewer);
}

export async function getBookmarksPageDataForViewer(
  database: D1Database,
  viewer: Profile,
): Promise<BookmarksPageData> {
  const [bookmarkResult, notificationCount, messageCount] = await Promise.all([
    database.prepare(`SELECT id, target_type, target_id, note
      FROM bookmarks
      WHERE profile_id = ?
        AND target_type IN ('thread', 'thread_post', 'social_post')
      ORDER BY created_at DESC
      LIMIT 50`)
      .bind(viewer.id)
      .all<D1BookmarkRow>(),
    countD1VisibleUnreadNotifications(database, viewer.id, { excludeMessages: true }),
    countD1VisibleUnreadMessages(database, viewer.id),
  ]);
  const bookmarks = bookmarkResult.results ?? [];
  const socialIds = bookmarks
    .filter((bookmark) => bookmark.target_type === "social_post")
    .map((bookmark) => bookmark.target_id);
  const socialPosts = await listD1TimelinePosts(
    database,
    viewer.id,
    undefined,
    Math.max(1, socialIds.length),
    0,
    socialIds,
  );
  const socialById = new Map(socialPosts.map((post) => [post.id, post]));
  const items = (await Promise.all(bookmarks.map(
    async (bookmark): Promise<BookmarksPageItem | null> => {
        if (bookmark.target_type === "social_post") {
          const post = socialById.get(bookmark.target_id);
          return post
            ? { kind: "social", id: bookmark.id, note: bookmark.note, post }
            : null;
        }
        if (bookmark.target_type === "thread") {
          const thread = await getD1Thread(database, bookmark.target_id);
          return thread && thread.status !== "archived"
            ? {
                kind: "thread",
                id: bookmark.id,
                href: `/threads/${thread.id}`,
                title: thread.title,
                note: bookmark.note,
              }
            : null;
        }
        const visiblePost = await getD1VisibleThreadPost(
          database,
          bookmark.target_id,
          viewer.id,
        );
        const [post] = visiblePost
          ? await redactGated(database, viewer.id, [visiblePost], "thread", { keyOf: (item: { threadId: string }) => item.threadId })
          : [];
        const thread = post
          ? await getD1Thread(database, post.threadId)
          : undefined;
        return post && thread && thread.status !== "archived"
          ? {
              kind: "reply",
              id: bookmark.id,
              href: `/threads/${thread.id}`,
              displayName: post.displayName,
              body: post.body,
              threadTitle: thread.title,
              note: bookmark.note,
            }
          : null;
    },
  ))).filter((item): item is BookmarksPageItem => item !== null);

  return {
    currentProfileId: viewer.id,
    notificationCount: Number(notificationCount ?? 0),
    messageCount: Number(messageCount ?? 0),
    items,
  };
}
