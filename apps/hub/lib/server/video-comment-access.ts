import type { D1Database } from "@cloudflare/workers-types";

import { checkTargetGateStatus, loadGatesForTargets, redactGated } from "@/lib/server/gated-content";
import { HubProfileBlockedError } from "@/lib/server/profile-blocks";

/*
 * Who may see and write comments of a video (docs/hub-video-comments/DESIGN.md).
 * A comment's effective gate is its own gate, or else its video's gate. Everything here fails closed:
 * an unknown gate state counts as locked.
 */

export type VideoCommentRefusal = "video_locked" | "comments_closed" | "comments_followers_only";

/** Extends the block error so routes that already map it answer 403 for a refused video comment. */
export class VideoCommentRefusedError extends HubProfileBlockedError {
  readonly reason: VideoCommentRefusal;
  constructor(reason: VideoCommentRefusal) {
    super();
    this.name = "VideoCommentRefusedError";
    this.message = reason;
    this.reason = reason;
  }
}

/** True when a gate sits on the video, whoever the viewer is. Errors count as gated. */
export async function isVideoGated(database: D1Database, videoId: string): Promise<boolean> {
  try {
    return (await loadGatesForTargets(database, "video", [videoId])).has(videoId);
  } catch {
    return true;
  }
}

/**
 * True only for a video that is active and neither deleted nor taken down. Anything unverifiable is false.
 * A deleted or taken-down video keeps no readable or writable comments, whatever its gate says.
 */
export async function isVideoCommentable(database: D1Database, videoId: string): Promise<boolean> {
  try {
    const row = await database
      .prepare(
        `SELECT 1 AS ok FROM external_videos v
         WHERE v.id = ? AND v.status = 'active'
           AND NOT EXISTS (SELECT 1 FROM hub_videos h WHERE h.id = v.id AND (h.state = 'deleted' OR h.hold_reason IS NOT NULL))
         LIMIT 1`,
      )
      .bind(videoId)
      .first<{ ok: number }>();
    return Boolean(row);
  } catch {
    return false;
  }
}

/**
 * May this viewer see the comments of the video? True when the video has no gate or the viewer passes it
 * (the gate owner always does). Anything unverifiable is false.
 */
export async function mayViewVideoComments(
  database: D1Database,
  viewerProfileId: string | null,
  videoId: string,
): Promise<boolean> {
  if (!(await isVideoCommentable(database, videoId))) return false;
  try {
    const [view] = await redactGated(database, viewerProfileId, [{ id: videoId }], "video", { context: "detail" });
    return Boolean(view) && !(view as { accessGate?: unknown }).accessGate;
  } catch {
    return false;
  }
}

/** Write-side gate check with a fresh gate evaluation. Throws VideoCommentRefusedError('video_locked'). */
export async function requireVideoGateOpen(database: D1Database, viewerProfileId: string, videoId: string): Promise<{ gated: boolean }> {
  if (!(await isVideoCommentable(database, videoId))) throw new VideoCommentRefusedError("video_locked");
  let gated: boolean;
  try {
    gated = (await loadGatesForTargets(database, "video", [videoId])).has(videoId);
  } catch {
    throw new VideoCommentRefusedError("video_locked");
  }
  if (!gated) return { gated: false };
  let status: "open" | "locked" | "unavailable";
  try {
    status = await checkTargetGateStatus(database, viewerProfileId, { targetType: "video", targetId: videoId });
  } catch {
    status = "unavailable";
  }
  if (status !== "open") throw new VideoCommentRefusedError("video_locked");
  return { gated: true };
}

/* ---- who owns a video's comments, and who may write ---- */

export type VideoCommentPolicy = "everyone" | "followers" | "nobody";

export type VideoCommentContext = {
  /** The Hub-hosted video's owner. Null for external videos: they have none (docs/hub-video-comments/DESIGN.md). */
  ownerProfileId: string | null;
  /** Always 'everyone' for external videos. */
  policy: VideoCommentPolicy;
};

/** Reads the video's comment settings; null when the video does not exist. */
export async function readVideoCommentContext(database: D1Database, videoId: string): Promise<VideoCommentContext | null> {
  const row = await database
    .prepare(
      `SELECT v.provider AS provider, v.comment_policy AS policy, h.profile_id AS owner, h.comments_enabled AS enabled
       FROM external_videos v
       LEFT JOIN hub_videos h ON h.id = v.id AND h.state <> 'deleted'
       WHERE v.id = ? AND v.status = 'active' LIMIT 1`,
    )
    .bind(videoId)
    .first<{ provider?: string; policy?: string; owner?: string | null; enabled?: number | null }>();
  if (!row) return null;
  if (row.provider !== "hub" || !row.owner) return { ownerProfileId: null, policy: "everyone" };
  const policy: VideoCommentPolicy =
    Number(row.enabled ?? 1) === 0 ? "nobody" : row.policy === "followers" || row.policy === "nobody" ? row.policy : "everyone";
  return { ownerProfileId: row.owner, policy };
}

/** The owner may always comment; 'followers' needs a follow of the owner; 'nobody' closes the video to everyone else. */
export async function requireCommentPolicy(
  database: D1Database,
  viewerProfileId: string,
  context: VideoCommentContext,
): Promise<void> {
  if (context.policy === "everyone" || context.ownerProfileId === viewerProfileId) return;
  if (context.policy === "nobody" || !context.ownerProfileId) throw new VideoCommentRefusedError("comments_closed");
  const follows = await database
    .prepare("SELECT 1 AS ok FROM follows WHERE follower_profile_id = ? AND followed_profile_id = ? LIMIT 1")
    .bind(viewerProfileId, context.ownerProfileId)
    .first<{ ok: number }>();
  if (!follows) throw new VideoCommentRefusedError("comments_followers_only");
}

/** Owner of a Hub-hosted video, or null (external or unknown videos have no owner and nobody may moderate them). */
export async function hubVideoCommentOwner(database: D1Database, videoId: string): Promise<string | null> {
  return (await readVideoCommentContext(database, videoId))?.ownerProfileId ?? null;
}
