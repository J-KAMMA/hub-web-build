import type { D1Database } from "@cloudflare/workers-types";

import { VIDEO_REPORT_REASONS, videoReportReasonLabel } from "@/lib/video-safety";
import {
  HubVideoError,
  bumpRevision,
  notifyChange,
  publishHubVideoRow,
  readHubVideoRow,
  syncHubVideoCatalogEntry,
  unpublishHubVideo,
  type HubVideoDeps,
} from "@/lib/server/hub-videos";

/*
 * Operator side of self-made video safety (PLAN 2.3, 5.1, 5.3): the first-videos review queue and
 * the report queue. Both read Hub tables only; the Video Worker is told through the same
 * unpublish / publish paths the owner uses, so a failure to reach it is retried by the outbox.
 */

export type PendingReviewItem = {
  videoId: string;
  title: string;
  creatorHandle: string;
  creatorDisplayName: string;
  visibility: string;
  ageRestricted: boolean;
  durationMs: number | null;
  requestedAt: string | null;
  openReports: number;
};

export type NativeVideoReportItem = {
  reportId: string;
  videoId: string;
  title: string;
  creatorHandle: string;
  reasonCode: string | null;
  reasonLabel: string;
  detail: string;
  createdAt: string;
  safetyHold: boolean;
  videoState: string;
  ageRestricted: boolean;
};

export type VideoSafetyQueue = { reviews: PendingReviewItem[]; reports: NativeVideoReportItem[] };

const RANK_SQL = `CASE r.reason_code ${VIDEO_REPORT_REASONS.map((reason) => `WHEN '${reason.code}' THEN ${reason.rank}`).join(" ")} ELSE 7 END`;

export async function listVideoSafetyQueue(database: D1Database): Promise<VideoSafetyQueue> {
  const [reviews, reports] = await Promise.all([
    database
      .prepare(`SELECT v.id, v.title, v.visibility, v.age_restricted, v.duration_ms, v.review_requested_at,
          p.handle, p.display_name,
          (SELECT COUNT(*) FROM video_reports r WHERE r.video_id = v.external_video_id AND r.status = 'open') AS open_reports
        FROM hub_videos v JOIN profiles p ON p.id = v.profile_id
        WHERE v.review_status = 'pending' AND v.state <> 'deleted'
        ORDER BY v.review_requested_at ASC LIMIT 100`)
      .all<{
        id: string; title: string; visibility: string; age_restricted: number; duration_ms: number | null;
        review_requested_at: string | null; handle: string; display_name: string; open_reports: number;
      }>(),
    database
      .prepare(`SELECT r.id, r.reason_code, r.reason, r.created_at, v.id AS video_id, v.title, v.safety_hold, v.state,
          v.age_restricted, p.handle
        FROM video_reports r
        JOIN hub_videos v ON v.external_video_id = r.video_id
        JOIN profiles p ON p.id = v.profile_id
        WHERE r.status = 'open' AND v.state <> 'deleted'
        ORDER BY ${RANK_SQL} ASC, r.created_at ASC LIMIT 100`)
      .all<{
        id: string; reason_code: string | null; reason: string; created_at: string; video_id: string; title: string;
        safety_hold: number; state: string; age_restricted: number; handle: string;
      }>(),
  ]);
  return {
    reviews: (reviews.results ?? []).map((row) => ({
      videoId: row.id,
      title: row.title,
      creatorHandle: row.handle,
      creatorDisplayName: row.display_name,
      visibility: row.visibility,
      ageRestricted: row.age_restricted === 1,
      durationMs: row.duration_ms,
      requestedAt: row.review_requested_at,
      openReports: Number(row.open_reports ?? 0),
    })),
    reports: (reports.results ?? []).map((row) => ({
      reportId: row.id,
      videoId: row.video_id,
      title: row.title,
      creatorHandle: row.handle,
      reasonCode: row.reason_code,
      reasonLabel: videoReportReasonLabel(row.reason_code),
      detail: row.reason,
      createdAt: row.created_at,
      safetyHold: row.safety_hold === 1,
      videoState: row.state,
      ageRestricted: row.age_restricted === 1,
    })),
  };
}

/** Approve (and publish, because the creator already asked to) or reject a video waiting for review. */
export async function decideVideoReview(
  database: D1Database,
  deps: HubVideoDeps,
  videoId: string,
  decision: "approve" | "reject",
): Promise<{ status: "approved" | "rejected"; published: boolean }> {
  const now = (deps.now?.() ?? new Date()).toISOString();
  const changed = await database
    .prepare(`UPDATE hub_videos SET review_status = ?, review_decided_at = ?, updated_at = ?
      WHERE id = ? AND review_status = 'pending' AND state <> 'deleted'`)
    .bind(decision === "approve" ? "approved" : "rejected", now, now, videoId)
    .run();
  if (Number(changed.meta?.changes ?? 0) !== 1) {
    throw new HubVideoError("not_pending", 409, "審査待ちの動画ではありません。");
  }
  if (decision === "reject") {
    await notifyChange(database, deps, videoId);
    return { status: "rejected", published: false };
  }
  const row = await readHubVideoRow(database, videoId);
  if (!row) return { status: "approved", published: false };
  try {
    await publishHubVideoRow(database, deps, row);
    return { status: "approved", published: true };
  } catch {
    // Held, still processing or the Worker is down: the creator can publish again, review is done.
    return { status: "approved", published: false };
  }
}

/** One profile's child-sexual reports may hold at most this many videos in a rolling day. */
export const INSTANT_HOLD_REPORTER_LIMIT_PER_DAY = 3;

/**
 * The instant stop for a child-sexual report (PLAN 2.3, 5.1). Abuse guard: a profile whose reports
 * already held INSTANT_HOLD_REPORTER_LIMIT_PER_DAY videos today still files the report (it sits in
 * the operator queue) but does not hold more. Reporters never learn which happened; the owner of the
 * video cannot hold their own video, and only a live Hub video is held. Never throws.
 */
export async function applyInstantSafetyHold(
  database: D1Database,
  deps: HubVideoDeps,
  input: { videoId: string; reporterProfileId: string },
): Promise<"held" | "queued"> {
  try {
    const video = await readHubVideoRow(database, input.videoId);
    if (!video || video.state !== "published" || video.profile_id === input.reporterProfileId) return "queued";
    const since = new Date((deps.now?.() ?? new Date()).getTime() - 24 * 60 * 60 * 1000).toISOString();
    const held = await database
      .prepare(`SELECT COUNT(*) AS n FROM video_reports r JOIN hub_videos v ON v.external_video_id = r.video_id
        WHERE r.reporter_profile_id = ? AND r.reason_code = 'child_sexual' AND r.created_at >= ?
          AND r.video_id <> ? AND v.safety_hold = 1`)
      .bind(input.reporterProfileId, since, input.videoId)
      .first<{ n: number }>();
    if (Number(held?.n ?? 0) >= INSTANT_HOLD_REPORTER_LIMIT_PER_DAY) return "queued";
    await unpublishHubVideo(database, deps, input.videoId, { reason: "safety" });
    return "held";
  } catch {
    console.warn(JSON.stringify({ event: "hub_video_instant_hold_failed" }));
    return "queued";
  }
}

export type ReportResolution = "dismiss" | "remove" | "age_restrict";

/** Close one report. `remove` keeps the video down (safety hold); `dismiss` lifts a hold set by that report. */
export async function resolveVideoReport(
  database: D1Database,
  deps: HubVideoDeps,
  reportId: string,
  resolution: ReportResolution,
): Promise<void> {
  const report = await database
    .prepare(`SELECT r.id, v.id AS video_id FROM video_reports r JOIN hub_videos v ON v.external_video_id = r.video_id
      WHERE r.id = ? AND r.status = 'open'`)
    .bind(reportId)
    .first<{ id: string; video_id: string }>();
  if (!report) throw new HubVideoError("not_found", 404, "通報が見つかりません。");
  const now = (deps.now?.() ?? new Date()).toISOString();
  if (resolution === "remove") {
    await unpublishHubVideo(database, deps, report.video_id, { reason: "safety" });
  } else if (resolution === "age_restrict") {
    const before = await readHubVideoRow(database, report.video_id);
    await database
      .prepare("UPDATE hub_videos SET age_restricted = 1, safety_hold = 0, updated_at = ? WHERE id = ? AND state <> 'deleted'")
      .bind(now, report.video_id)
      .run();
    await syncHubVideoCatalogEntry(database, report.video_id, deps.now?.());
    // Playback tokens issued before the restriction must not outlive it.
    if (before?.state === "published" && before.age_restricted === 0) await bumpRevision(database, deps, before).catch(() => undefined);
    await notifyChange(database, deps, report.video_id);
  } else {
    await dismissHold(database, deps, report.video_id, reportId, now);
  }
  await database
    .prepare("UPDATE video_reports SET status = ? WHERE id = ?")
    .bind(resolution === "dismiss" ? "dismissed" : "resolved", reportId)
    .run();
}

/**
 * Dismissal lifts the safety hold, unless another open child-sexual report on the same video still
 * stands. If the hold took a live video down, it goes back up.
 */
async function dismissHold(database: D1Database, deps: HubVideoDeps, videoId: string, reportId: string, now: string) {
  const other = await database
    .prepare(`SELECT 1 AS ok FROM video_reports r JOIN hub_videos v ON v.external_video_id = r.video_id
      WHERE v.id = ? AND r.id <> ? AND r.status = 'open' AND r.reason_code = 'child_sexual' LIMIT 1`)
    .bind(videoId, reportId)
    .first<{ ok: number }>();
  if (other) return;
  const row = await readHubVideoRow(database, videoId);
  if (!row || row.safety_hold !== 1) return;
  await database
    .prepare("UPDATE hub_videos SET safety_hold = 0, safety_hold_was_live = 0, updated_at = ? WHERE id = ? AND state <> 'deleted'")
    .bind(now, videoId)
    .run();
  if (row.safety_hold_was_live !== 1 || row.state !== "unpublished") return;
  // It was live before the hold, so it passed any first-videos review already.
  await database
    .prepare("UPDATE hub_videos SET review_status = 'approved', updated_at = ? WHERE id = ? AND review_status = 'none'")
    .bind(now, videoId)
    .run();
  const fresh = await readHubVideoRow(database, videoId);
  if (!fresh) return;
  try {
    await publishHubVideoRow(database, deps, fresh);
  } catch {
    // Still held for another reason, or the Worker is down: the owner can publish again.
  }
}
