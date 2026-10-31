import "server-only";

import type { UserList } from "@/lib/domain";
import { getBookmarksPageData } from "@/lib/server/bookmarks-page-data";
import { getD1ViewerData } from "@/lib/server/d1-viewer-data";

interface ListsPageThreadItem {
  id: string;
  href: string;
  title: string;
  boardTitle?: string;
}

interface ListsPageProfileItem {
  id: string;
  href: string;
  displayName: string;
  handle: string;
}

interface ListsPageList extends UserList {
  threadItems: ListsPageThreadItem[];
  profileItems: ListsPageProfileItem[];
}

type ListsPageBookmarkItem =
  | {
      kind: "thread";
      id: string;
      href: string;
      title: string;
    }
  | {
      kind: "thread_post";
      id: string;
      href: string;
      displayName: string;
      bodyPreview: string;
    }
  | {
      kind: "social_post";
      id: string;
      href: string;
      displayName: string;
      bodyPreview: string;
    };

export interface ListsPageData {
  notificationCount: number;
  messageCount: number;
  lists: ListsPageList[];
  bookmarkCount: number;
  bookmarkItems: ListsPageBookmarkItem[];
}

export async function getListsPageData(): Promise<ListsPageData> {
  const [data, bookmarks] = await Promise.all([
    getD1ViewerData(),
    getBookmarksPageData(),
  ]);
  const bookmarkItems = bookmarks.items.map((bookmark): ListsPageBookmarkItem => {
    if (bookmark.kind === "thread") {
      return {
        kind: "thread",
        id: bookmark.id,
        href: bookmark.href,
        title: bookmark.title,
      };
    }
    if (bookmark.kind === "reply") {
      return {
        kind: "thread_post",
        id: bookmark.id,
        href: bookmark.href,
        displayName: bookmark.displayName,
        bodyPreview: bookmark.body.slice(0, 48),
      };
    }
    return {
      kind: "social_post",
      id: bookmark.id,
      href: `/posts/${bookmark.post.id}`,
      displayName: bookmark.post.displayName,
      bodyPreview: bookmark.post.body.slice(0, 48),
    };
  });

  return {
    notificationCount: data.notificationCount,
    messageCount: data.messageCount,
    lists: data.lists.map((list) => ({
      ...list,
      threadItems: list.threadItems.map((thread) => ({
        id: thread.id,
        href: `/threads/${thread.id}`,
        title: thread.title,
      })),
      profileItems: list.profileItems.map((profile) => ({
        id: profile.id,
        href: `/profile/${profile.handle}`,
        displayName: profile.displayName,
        handle: profile.handle,
      })),
    })),
    bookmarkCount: bookmarkItems.length,
    bookmarkItems,
  };
}
