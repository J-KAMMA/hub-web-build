import type { D1Database } from "@cloudflare/workers-types";
import { listD1TimelinePosts, type D1TimelinePost } from "@/lib/server/d1-social-posts";
import { decodeTimelineCursor, encodeTimelineCursor } from "@/lib/timeline-cursor";

export const MUSIC_POSTS_PAGE_SIZE = 20;

export class InvalidMusicPostCursorError extends Error {
  constructor() {
    super("invalid_cursor");
    this.name = "InvalidMusicPostCursorError";
  }
}

/**
 * 音楽作品に紐づくポストを新しい順に1ページ返す。
 * 見える範囲（公開・フォロワー限定・ブロック・ミュート）はタイムラインと同じ
 * SQLに任せる。続きは (created_at, id) の鍵で引き、OFFSETは使わない。
 */
export async function listD1MusicPosts(
  database: D1Database,
  workId: string,
  viewerProfileId: string | null,
  rawCursor?: string | null,
): Promise<{ posts: D1TimelinePost[]; nextCursor: string | null }> {
  const cursor = rawCursor ? decodeTimelineCursor(rawCursor) : null;
  if (rawCursor && !cursor) throw new InvalidMusicPostCursorError();
  // 1件多く引いて、次のページがあるかを空振りなしで決める。
  const rows = await listD1TimelinePosts(
    database, viewerProfileId, undefined, MUSIC_POSTS_PAGE_SIZE + 1, 0, undefined,
    cursor, "latest", undefined, "all", false, null, workId,
  );
  const posts = rows.slice(0, MUSIC_POSTS_PAGE_SIZE);
  const last = posts.at(-1);
  return {
    posts,
    nextCursor: rows.length > MUSIC_POSTS_PAGE_SIZE && last
      ? encodeTimelineCursor({ createdAt: last.createdAt, id: last.id })
      : null,
  };
}
