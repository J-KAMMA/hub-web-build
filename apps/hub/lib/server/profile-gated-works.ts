import type { D1Database } from "@cloudflare/workers-types";

import type { PublicAccessGate } from "@/lib/access-gates/types";
import { toPublicAccessGate } from "@/lib/server/access-gates";
import { listD1TimelinePosts, type D1TimelinePost } from "@/lib/server/d1-social-posts";
import { loadGatesForTargets } from "@/lib/server/gated-content";
import type { WorkCursor } from "@/lib/server/profile-works";
import { publicVideoOriginSql } from "@/lib/server/video-public-origin";

/*
 * The profile 「鍵つきの作品」 tab: every gated post, article and Hub video of one creator, newest
 * first, in one keyset list. Step 1 reads ids and timestamps only (no body, summary or title
 * column); step 2 hydrates each kind for the page. Posts go through listD1TimelinePosts, which
 * strips locked bodies; articles and videos read a title and nothing else. The creator never
 * learns who unlocked what: nothing here reads viewer-specific gate state beyond the redaction.
 */

export const PROFILE_GATED_PAGE = 24;

export type GatedWorkKind = "post" | "article" | "video";
export type GatedWorkKey = { type: GatedWorkKind; id: string; at: string };

export type GatedWorkItem =
  | { type: "post"; id: string; at: string; post: D1TimelinePost; gate: PublicAccessGate }
  | { type: "article" | "video"; id: string; at: string; href: string; label: string; gate: PublicAccessGate };

const videoOrigin = publicVideoOriginSql("v");

/** One page of (type, id, at), newest first. Uses at most one query and reads no content column. */
export async function listProfileGatedWorkKeys(
  database: D1Database,
  authorProfileId: string,
  viewerProfileId: string | null,
  options: { limit?: number; before?: WorkCursor | null } = {},
): Promise<{ keys: GatedWorkKey[]; nextCursor: WorkCursor | null }> {
  const limit = Math.max(1, Math.min(50, Math.trunc(options.limit ?? PROFILE_GATED_PAGE)));
  const before = options.before ?? null;
  const viewer = viewerProfileId ?? "";
  const cursorSql = (column: string, idColumn: string) => (before ? `AND (${column} < ? OR (${column} = ? AND ${idColumn} < ?))` : "");
  const cursorValues = before ? [before.at, before.at, before.id] : [];
  const { results } = await database.prepare(`SELECT type, id, at FROM (
      SELECT 'post' AS type, s.id AS id, s.created_at AS at
      FROM content_access_gates g JOIN social_posts s ON s.id = g.target_id
      WHERE g.target_type = 'post' AND s.author_profile_id = ? AND s.moderated_at IS NULL AND s.reply_to_post_id IS NULL
        AND (s.audience = 'public' OR s.author_profile_id = ?
          OR (s.audience = 'followers' AND EXISTS (
            SELECT 1 FROM follows f WHERE f.follower_profile_id = ? AND f.followed_profile_id = s.author_profile_id)))
        ${cursorSql("s.created_at", "s.id")}
      UNION ALL
      SELECT 'article', a.id, a.created_at
      FROM content_access_gates g JOIN hub_user_articles a ON a.id = g.target_id
      WHERE g.target_type = 'article' AND a.author_profile_id = ? AND a.status = 'published' AND a.audience = 'general' AND a.moderated_at IS NULL
        ${cursorSql("a.created_at", "a.id")}
      UNION ALL
      SELECT 'video', v.id, v.created_at
      FROM content_access_gates g JOIN external_videos v ON v.id = g.target_id
      WHERE g.target_type = 'video' AND v.submitted_by_profile_id = ? AND v.provider = 'hub' AND v.status = 'active' AND ${videoOrigin}
        ${cursorSql("v.created_at", "v.id")}
    ) ORDER BY at DESC, id DESC LIMIT ?`)
    .bind(authorProfileId, viewer, viewer, ...cursorValues, authorProfileId, ...cursorValues, authorProfileId, ...cursorValues, limit + 1)
    .all<GatedWorkKey>();
  const rows = results ?? [];
  const keys = rows.slice(0, limit);
  const last = keys.at(-1);
  return { keys, nextCursor: rows.length > limit && last ? { at: last.at, id: last.id } : null };
}

function placeholders(ids: readonly string[]): string {
  return ids.map(() => "?").join(",");
}

/** Hydrates a page of keys, keeping their order. Items a reader does not return are dropped. */
export async function hydrateProfileGatedWorks(
  database: D1Database,
  authorProfileId: string,
  viewerProfileId: string | null,
  keys: readonly GatedWorkKey[],
): Promise<GatedWorkItem[]> {
  const idsOf = (type: GatedWorkKind) => keys.filter((key) => key.type === type).map((key) => key.id);
  const postIds = idsOf("post");
  const articleIds = idsOf("article");
  const videoIds = idsOf("video");
  const [posts, articles, videos, postGates, articleGates, videoGates] = await Promise.all([
    postIds.length ? listD1TimelinePosts(database, viewerProfileId, authorProfileId, postIds.length, 0, postIds) : Promise.resolve([] as D1TimelinePost[]),
    articleIds.length
      ? database.prepare(`SELECT a.id, a.title FROM hub_user_articles a
          WHERE a.id IN (${placeholders(articleIds)}) AND a.author_profile_id = ? AND a.status = 'published' AND a.audience = 'general' AND a.moderated_at IS NULL`)
          .bind(...articleIds, authorProfileId).all<{ id: string; title: string }>().then((result) => result.results ?? [])
      : Promise.resolve([] as { id: string; title: string }[]),
    videoIds.length
      ? database.prepare(`SELECT v.id, v.title FROM external_videos v
          WHERE v.id IN (${placeholders(videoIds)}) AND v.submitted_by_profile_id = ? AND v.provider = 'hub' AND v.status = 'active' AND ${videoOrigin}`)
          .bind(...videoIds, authorProfileId).all<{ id: string; title: string }>().then((result) => result.results ?? [])
      : Promise.resolve([] as { id: string; title: string }[]),
    postIds.length ? loadGatesForTargets(database, "post", postIds) : Promise.resolve(new Map()),
    articleIds.length ? loadGatesForTargets(database, "article", articleIds) : Promise.resolve(new Map()),
    videoIds.length ? loadGatesForTargets(database, "video", videoIds) : Promise.resolve(new Map()),
  ]);
  const postById = new Map(posts.map((post) => [post.id, post]));
  const articleById = new Map(articles.map((row) => [row.id, row]));
  const videoById = new Map(videos.map((row) => [row.id, row]));
  const items: GatedWorkItem[] = [];
  for (const key of keys) {
    if (key.type === "post") {
      const post = postById.get(key.id);
      const gate = postGates.get(key.id);
      if (post && gate) items.push({ type: "post", id: key.id, at: key.at, post, gate: toPublicAccessGate(gate) });
    } else if (key.type === "article") {
      const row = articleById.get(key.id);
      const gate = articleGates.get(key.id);
      if (row && gate) items.push({ type: "article", id: key.id, at: key.at, href: `/v2/articles/${row.id}`, label: row.title, gate: toPublicAccessGate(gate) });
    } else {
      const row = videoById.get(key.id);
      const gate = videoGates.get(key.id);
      if (row && gate) items.push({ type: "video", id: key.id, at: key.at, href: `/v2/videos/${encodeURIComponent(row.id)}`, label: row.title, gate: toPublicAccessGate(gate) });
    }
  }
  return items;
}

export async function listProfileGatedWorks(
  database: D1Database,
  authorProfileId: string,
  viewerProfileId: string | null,
  options: { limit?: number; before?: WorkCursor | null } = {},
): Promise<{ items: GatedWorkItem[]; nextCursor: WorkCursor | null }> {
  const { keys, nextCursor } = await listProfileGatedWorkKeys(database, authorProfileId, viewerProfileId, options);
  return { items: await hydrateProfileGatedWorks(database, authorProfileId, viewerProfileId, keys), nextCursor };
}
