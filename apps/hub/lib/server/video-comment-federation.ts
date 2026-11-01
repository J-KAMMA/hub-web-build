import type { D1Database } from "@cloudflare/workers-types";

import { DEFAULT_INSTANCE_ORIGIN } from "@/lib/instance-origin";
import { mayFederatePost } from "@/lib/server/gated-exits";

/*
 * Federation of video comments (docs/hub-video-comments/DESIGN.md, commit 4).
 *
 * A comment federates as a Note only when it is public, its effective gate is open (mayFederatePost), the
 * video owner has not hidden it, and the video itself may be talked about in public:
 *  - a Hub-hosted video that federates as a `Video` object: a top-level comment replies to that object
 *    (inReplyToHubPostId = the video id, which is also the hubPostId of its Video object);
 *  - a Hub-hosted video that does not federate (followers-only, unlisted, held, under review): no Note;
 *  - an external video: a Note whose text carries the Hub watch link.
 * A reply to a comment replies to that comment's Note. Everything fails closed.
 */

export type VideoCommentPlan =
  | { kind: "plain" }
  | { kind: "skip" }
  | { kind: "comment"; inReplyToHubPostId: string | null; appendWatchUrl: string | null };

type PostRow = { videoId: string | null; hidden: string | null; replyToPostId: string | null; audience: string; moderatedAt: string | null };

const instanceOrigin = () => new URL(process.env.HUB_PUBLIC_ORIGIN ?? DEFAULT_INSTANCE_ORIGIN).origin;

/** The same conditions federateHubVideo uses before it sends a `Video` object. */
async function hubVideoFederates(database: D1Database, videoId: string): Promise<boolean> {
  const row = await database
    .prepare(
      `SELECT 1 AS ok FROM hub_videos v
       WHERE v.id = ? AND v.state = 'published' AND v.hold_reason IS NULL
         AND v.visibility = 'public' AND v.age_restricted = 0
         AND v.safety_hold = 0 AND v.review_status IN ('none', 'approved')
         AND NOT EXISTS (SELECT 1 FROM content_access_gates g WHERE g.target_type = 'video' AND g.target_id = v.id)
         AND NOT EXISTS (SELECT 1 FROM external_videos e WHERE e.id = v.id AND e.status <> 'active')`,
    )
    .bind(videoId)
    .first<{ ok: number }>();
  return Boolean(row);
}

export async function videoCommentFederationPlan(database: D1Database, postId: string): Promise<VideoCommentPlan> {
  try {
    const post = await database
      .prepare(
        `SELECT reply_to_video_id AS videoId, hidden_by_target_owner_at AS hidden, reply_to_post_id AS replyToPostId,
                audience, moderated_at AS moderatedAt
         FROM social_posts WHERE id = ? LIMIT 1`,
      )
      .bind(postId)
      .first<PostRow>();
    if (!post) return { kind: "skip" };
    if (!post.videoId) return { kind: "plain" };
    if (post.hidden || post.moderatedAt || post.audience !== "public") return { kind: "skip" };
    const video = await database
      .prepare("SELECT provider, status FROM external_videos WHERE id = ? LIMIT 1")
      .bind(post.videoId)
      .first<{ provider: string; status: string }>();
    if (!video || video.status !== "active") return { kind: "skip" };
    if (video.provider === "hub") {
      if (!(await hubVideoFederates(database, post.videoId))) return { kind: "skip" };
      return { kind: "comment", inReplyToHubPostId: post.replyToPostId ? null : post.videoId, appendWatchUrl: null };
    }
    return {
      kind: "comment",
      inReplyToHubPostId: null,
      appendWatchUrl: post.replyToPostId ? null : `${instanceOrigin()}/v2/videos/${post.videoId}`,
    };
  } catch {
    return { kind: "skip" };
  }
}

export type FederationSender = {
  publishFederatedPost: (input: {
    profileId: string;
    hubPostId: string;
    text: string;
    inReplyToHubPostId?: string | null;
    attachments?: Array<{ url: string; mediaType: string; name?: string }>;
  }) => Promise<void>;
  deleteFederatedPost: (hubPostId: string) => Promise<void>;
};

async function defaultSender(): Promise<FederationSender> {
  const gateway = await import("@/lib/server/federation-gateway");
  return { publishFederatedPost: gateway.publishFederatedPost, deleteFederatedPost: gateway.deleteFederatedPost };
}

/** False when the comment is gone, owner-hidden, moderated, not public or (through its own or its video's gate) gated. */
async function stillFederable(database: D1Database, postId: string): Promise<boolean> {
  try {
    const row = await database
      .prepare("SELECT 1 AS ok FROM social_posts WHERE id = ? AND audience = 'public' AND moderated_at IS NULL AND hidden_by_target_owner_at IS NULL LIMIT 1")
      .bind(postId)
      .first<{ ok: number }>();
    return Boolean(row) && (await mayFederatePost(database, postId));
  } catch {
    return false; // fail closed
  }
}

/**
 * Sends a new public post to the federation unless a gate or the video rules say no. Never throws.
 * Callers have already checked that the post is public and has an accountable author.
 */
export async function federateNewPost(
  database: D1Database,
  post: { id: string; authorProfileId: string | null; body: string; replyToPostId?: string | null },
  options: { attachments?: Array<{ url: string; mediaType: string; name?: string }>; sender?: FederationSender } = {},
): Promise<boolean> {
  try {
    if (!post.authorProfileId) return false;
    if (!(await mayFederatePost(database, post.id))) return false;
    const plan = await videoCommentFederationPlan(database, post.id);
    if (plan.kind === "skip") return false;
    const sender = options.sender ?? (await defaultSender());
    const text = plan.kind === "comment" && plan.appendWatchUrl ? `${post.body}${post.body ? "\n\n" : ""}${plan.appendWatchUrl}` : post.body;
    await sender.publishFederatedPost({
      profileId: post.authorProfileId,
      hubPostId: post.id,
      text,
      inReplyToHubPostId: plan.kind === "comment" && plan.inReplyToHubPostId ? plan.inReplyToHubPostId : post.replyToPostId ?? null,
      ...(options.attachments?.length ? { attachments: options.attachments } : {}),
    });
    // A gate (or an owner hide, or a delete) can land between the check above and the publish. The gate's own Delete may
    // already have run before this Create arrived, so look again and withdraw at once when the comment is no longer public.
    if (!(await stillFederable(database, post.id))) {
      await sender.deleteFederatedPost(post.id).catch(() => {
        console.warn(JSON.stringify({ event: "video_comment_federation_delete_failed", phase: "post_publish_recheck" }));
      });
      return false;
    }
    return true;
  } catch {
    console.warn(JSON.stringify({ event: "video_comment_federation_failed" }));
    return false;
  }
}

const BATCH = 50;
const PARALLEL = 10;

type CommentRow = { id: string; authorProfileId: string | null; body: string; replyToPostId: string | null; createdAt: string };

/**
 * Walks the comments of a video in keyset batches (created_at, id), newest first, and calls `each` for them.
 * The loop runs directly; above roughly 500 comments it should move to a queue (design default 3).
 */
async function forEachVideoComment(database: D1Database, videoId: string, each: (comment: CommentRow) => Promise<void>): Promise<number> {
  let cursor: { createdAt: string; id: string } | null = null;
  let total = 0;
  for (;;) {
    const result: { results?: CommentRow[] } = await database
      .prepare(
        `SELECT id, author_profile_id AS authorProfileId, body, reply_to_post_id AS replyToPostId, created_at AS createdAt
         FROM social_posts
         WHERE reply_to_video_id = ?
           ${cursor ? "AND (created_at < ? OR (created_at = ? AND id < ?))" : ""}
         ORDER BY created_at DESC, id DESC LIMIT ?`,
      )
      .bind(videoId, ...(cursor ? [cursor.createdAt, cursor.createdAt, cursor.id] : []), BATCH)
      .all<CommentRow>();
    const rows = result.results ?? [];
    for (let index = 0; index < rows.length; index += PARALLEL) {
      await Promise.allSettled(rows.slice(index, index + PARALLEL).map(each));
    }
    total += rows.length;
    const last: CommentRow | undefined = rows.at(-1);
    if (rows.length < BATCH || !last) return total;
    cursor = { createdAt: last.createdAt, id: last.id };
  }
}

/** A gate was attached to a video (or the video stopped being public): every comment of it is withdrawn. */
export async function withdrawVideoComments(database: D1Database, videoId: string, sender?: FederationSender): Promise<number> {
  const send = sender ?? (await defaultSender());
  return forEachVideoComment(database, videoId, async (comment) => {
    // A 404/409 from the federation just means the comment never left this Hub.
    await send.deleteFederatedPost(comment.id).catch(() => {
      // No federation retry queue exists for post Deletes, so only the category is logged (never ids or bodies).
      console.warn(JSON.stringify({ event: "video_comment_federation_delete_failed", phase: "gate_attached" }));
    });
  });
}

/** The gate came off: public comments that may federate now are published (oldest-first order is not required). */
export async function republishVideoComments(database: D1Database, videoId: string, sender?: FederationSender): Promise<number> {
  const send = sender ?? (await defaultSender());
  return forEachVideoComment(database, videoId, async (comment) => {
    if (!comment.authorProfileId || !comment.body) return;
    const row = await database
      .prepare("SELECT 1 AS ok FROM social_posts WHERE id = ? AND audience = 'public' AND moderated_at IS NULL AND origin = 'local' LIMIT 1")
      .bind(comment.id)
      .first<{ ok: number }>();
    if (!row) return;
    await federateNewPost(database, comment, { sender: send });
  });
}
