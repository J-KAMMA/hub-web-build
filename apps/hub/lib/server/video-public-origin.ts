/*
 * The one rule for "may this external video appear in a public place?".
 *
 * A video that was auto-ingested from a social post (ingest_source =
 * 'social_post') inherits that post's audience: having the link in the catalog
 * must not reveal a followers-only post. It is public only while some public,
 * unmoderated (not user-deleted) post refers to it, either through the
 * auto-ingest origin table or the video-page post reference. Manual, thread and
 * thread_reply videos are unaffected. Evaluated at read time, so a post that
 * turns followers-only or is deleted drops the video unless another public
 * origin remains.
 *
 * Used by every public video reader (lists, search, detail, federated catalog)
 * and by Hubpedia's evidence loader.
 */

const SOCIAL_POST_VIDEO_PUBLIC_ORIGIN = (video: string) => `EXISTS (
  SELECT 1 FROM social_post_video_origins origin
  JOIN social_posts origin_post ON origin_post.id = origin.post_id
  WHERE origin.video_id = ${video}.id AND origin_post.audience = 'public' AND origin_post.moderated_at IS NULL
) OR EXISTS (
  SELECT 1 FROM social_post_video_refs ref
  JOIN social_posts ref_post ON ref_post.id = ref.post_id
  WHERE ref.video_id = ${video}.id AND ref_post.audience = 'public' AND ref_post.moderated_at IS NULL
)`;

/**
 * A Hub self-made video has a catalog row whose ID is the hub video's own ID. Such a row is listed
 * only while the video is published, not on a copyright hold, public and not age-restricted.
 * Evaluated at read time, so an unpublish, a hold, a deletion or a narrowed audience drops it from
 * every list without a second write. Rows with no counterpart in hub_videos are not affected.
 */
const NATIVE_VIDEO_LISTED = (video: string) => `NOT EXISTS (
  SELECT 1 FROM hub_videos native
  WHERE native.id = ${video}.id
    AND NOT (native.state = 'published' AND native.hold_reason IS NULL
      AND native.visibility = 'public' AND native.age_restricted = 0)
)`;

/**
 * The watch page may also open a published self-made video that is unlisted, age-restricted, gated
 * or followers-only: unlisted and gated (the play ticket decides) for anyone, followers-only for the
 * owner and followers. `viewer` is a bound-parameter placeholder (for example `?2`) holding the
 * viewer's profile ID or NULL.
 */
const NATIVE_VIDEO_WATCHABLE = (video: string, viewer: string) => `NOT EXISTS (
  SELECT 1 FROM hub_videos native
  WHERE native.id = ${video}.id
    AND NOT (native.state = 'published' AND native.hold_reason IS NULL
      AND (native.visibility IN ('public', 'unlisted', 'gated')
        OR (${viewer} IS NOT NULL AND (native.profile_id = ${viewer} OR EXISTS (
          SELECT 1 FROM follows f WHERE f.follower_profile_id = ${viewer} AND f.followed_profile_id = native.profile_id)))))
)`;

/** SQL boolean expression for an `external_videos` row aliased as `alias`. */
export function publicVideoOriginSql(alias = "v"): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(alias)) throw new Error("invalid_alias");
  return `((${alias}.ingest_source <> 'social_post' OR ${SOCIAL_POST_VIDEO_PUBLIC_ORIGIN(alias)}) AND (${NATIVE_VIDEO_LISTED(alias)}))`;
}

/** Like publicVideoOriginSql, but for opening one video's watch page (see NATIVE_VIDEO_WATCHABLE). */
export function watchableVideoOriginSql(alias = "v", viewer = "?2"): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(alias)) throw new Error("invalid_alias");
  if (!/^[?][0-9]{1,2}$/u.test(viewer)) throw new Error("invalid_placeholder");
  return `((${alias}.ingest_source <> 'social_post' OR ${SOCIAL_POST_VIDEO_PUBLIC_ORIGIN(alias)}) AND (${NATIVE_VIDEO_WATCHABLE(alias, viewer)}))`;
}

/** The social_post-only half, for callers that already branched on ingest_source. */
export function hasPublicSocialPostOriginSql(alias = "v"): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(alias)) throw new Error("invalid_alias");
  return `(${SOCIAL_POST_VIDEO_PUBLIC_ORIGIN(alias)})`;
}

type Statement = { bind(...values: unknown[]): { first<T = unknown>(): Promise<T | null> } };
type Database = { prepare(sql: string): Statement };

/** Point check used by single-row loaders. Fails closed on a missing origin. */
export async function hasPublicSocialPostOrigin(db: Database, videoId: string): Promise<boolean> {
  const row = await db
    .prepare(`SELECT 1 AS found FROM external_videos v WHERE v.id = ? AND ${hasPublicSocialPostOriginSql("v")}`)
    .bind(videoId)
    .first();
  return Boolean(row);
}

/** Record that a post (any audience) carried this video; visibility is decided at read time. */
export async function recordVideoPostOrigin(
  db: { prepare(sql: string): { bind(...values: unknown[]): { run(): Promise<unknown> } } },
  videoId: string,
  postId: string,
  now = new Date(),
): Promise<void> {
  await db
    .prepare("INSERT OR IGNORE INTO social_post_video_origins (video_id, post_id, created_at) VALUES (?, ?, ?)")
    .bind(videoId, postId, now.toISOString())
    .run();
}
