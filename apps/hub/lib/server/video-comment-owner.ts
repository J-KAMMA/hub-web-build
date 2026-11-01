import type { D1Database } from "@cloudflare/workers-types";

import { hubVideoCommentOwner, type VideoCommentPolicy } from "@/lib/server/video-comment-access";

/*
 * Owner controls for a video's comments (docs/hub-video-comments/DESIGN.md). Only the owner of a Hub-hosted
 * video has them. External videos (YouTube and every other provider) have no owner for comment purposes:
 * these functions answer not_found for them, even to the profile that shared the link, and moderation of
 * their comments goes through reports.
 */

export class VideoCommentOwnerError extends Error {
  constructor(readonly reason: "not_found" | "forbidden") {
    super(reason);
    this.name = "VideoCommentOwnerError";
  }
}

export const VIDEO_COMMENT_POLICIES: readonly VideoCommentPolicy[] = ["everyone", "followers", "nobody"];

async function requireOwner(database: D1Database, viewerProfileId: string, videoId: string) {
  const owner = await hubVideoCommentOwner(database, videoId);
  if (!owner) throw new VideoCommentOwnerError("not_found");
  if (owner !== viewerProfileId) throw new VideoCommentOwnerError("forbidden");
}

export async function setVideoCommentPolicy(
  database: D1Database,
  viewerProfileId: string,
  videoId: string,
  policy: VideoCommentPolicy,
): Promise<void> {
  if (!VIDEO_COMMENT_POLICIES.includes(policy)) throw new Error("invalid_policy");
  await requireOwner(database, viewerProfileId, videoId);
  await database
    .prepare("UPDATE external_videos SET comment_policy = ? WHERE id = ? AND provider = 'hub'")
    .bind(policy, videoId)
    .run();
}

/** Hide or show one comment of the owner's Hub video. The comment's author is not told. */
export async function setCommentHiddenByVideoOwner(
  database: D1Database,
  viewerProfileId: string,
  postId: string,
  hidden: boolean,
  now = new Date(),
): Promise<void> {
  const post = await database
    .prepare("SELECT reply_to_video_id AS videoId FROM social_posts WHERE id = ? LIMIT 1")
    .bind(postId)
    .first<{ videoId: string | null }>();
  if (!post?.videoId) throw new VideoCommentOwnerError("not_found");
  await requireOwner(database, viewerProfileId, post.videoId);
  await database
    .prepare("UPDATE social_posts SET hidden_by_target_owner_at = ? WHERE id = ? AND reply_to_video_id = ?")
    .bind(hidden ? now.toISOString() : null, postId, post.videoId)
    .run();
}
