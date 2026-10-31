import type { D1Database, Queue } from "@cloudflare/workers-types";

import { createD1ExternalVideo } from "@/lib/server/d1-videos";
import { lookupYouTubeVideoBatch } from "@/lib/server/youtube-video-batch";
import { normalizeVideoSource } from "@/lib/video-source";

type VideoImportPayload = {
  sourceUrls: string[];
  category: string;
  purpose: "other";
  topic: string;
  relatedHubpediaSlug?: string;
};

export async function requeuePendingVideoImports(database: D1Database, queue: Queue) {
  const pending = await database.prepare(
    `SELECT id FROM video_import_jobs
     WHERE status = 'queued' AND control_state = 'active'
     ORDER BY created_at LIMIT 100`,
  ).all<{ id: string }>();
  if (pending.results.length) {
    await queue.sendBatch(pending.results.map(({ id }) => ({ body: { type: "hub.video.import", jobId: id } })));
  }
  return { queued: pending.results.length };
}

export async function processVideoImportJob(
  database: D1Database,
  jobId: string,
  apiKey: string | undefined,
): Promise<{ succeeded: number; failed: number }> {
  const claimed = await database.prepare(
    `UPDATE video_import_jobs SET status = 'running', started_at = ?, error_message = NULL,
      attempt_count = attempt_count + 1
     WHERE id = ? AND status = 'queued' AND control_state = 'active'`,
  ).bind(new Date().toISOString(), jobId).run();
  if (Number(claimed.meta.changes ?? 0) === 0) return { succeeded: 0, failed: 0 };
  const job = await database.prepare(
    `SELECT j.payload_json payloadJson, j.profile_id profileId, j.attempt_count attemptCount,
            p.display_name displayName
     FROM video_import_jobs j JOIN profiles p ON p.id = j.profile_id
     WHERE j.id = ? AND j.status = 'running' LIMIT 1`,
  ).bind(jobId).first<{ payloadJson: string; profileId: string; displayName: string; attemptCount: number }>();
  if (!job) return { succeeded: 0, failed: 0 };

  try {
    const payload = JSON.parse(job.payloadJson) as VideoImportPayload;
    const sources = payload.sourceUrls.map(normalizeVideoSource);
    const placeholders = sources.map(() => "?").join(",");
    const existing = await database.prepare(
      `SELECT external_video_id externalVideoId FROM external_videos
       WHERE provider = 'youtube' AND status = 'active' AND external_video_id IN (${placeholders})`,
    ).bind(...sources.map((source) => source.externalVideoId)).all<{ externalVideoId: string }>();
    const existingIds = new Set(existing.results.map((row) => row.externalVideoId));
    const freshSources = sources.filter((source) => !existingIds.has(source.externalVideoId));
    const details = await lookupYouTubeVideoBatch(database, freshSources, apiKey);
    let succeeded = 0;
    let failed = existingIds.size;
    for (const source of freshSources) {
      const detail = details.get(source.externalVideoId);
      if (!detail?.allowed) {
        failed += 1;
        continue;
      }
      try {
        await createD1ExternalVideo(database, { id: job.profileId, displayName: job.displayName }, {
          source: { ...source, thumbnailUrl: detail.thumbnailUrl ?? source.thumbnailUrl },
          title: detail.title,
          channel: detail.channel,
          category: payload.category,
          purpose: payload.purpose,
          topic: payload.topic,
          relatedHubpediaSlug: payload.relatedHubpediaSlug,
          ingestSource: "manual",
        });
        succeeded += 1;
      } catch {
        failed += 1;
      }
    }
    await database.prepare(
      `UPDATE video_import_jobs SET status = 'completed', succeeded_count = ?, failed_count = ?, completed_at = ? WHERE id = ?`,
    ).bind(succeeded, failed, new Date().toISOString(), jobId).run();
    return { succeeded, failed };
  } catch (error) {
    const retryable = job.attemptCount < 3;
    await database.prepare(
      `UPDATE video_import_jobs SET status = ?, error_message = ?, completed_at = ? WHERE id = ?`,
    ).bind(retryable ? "queued" : "failed", error instanceof Error ? error.message.slice(0, 500) : "Import failed.", retryable ? null : new Date().toISOString(), jobId).run();
    throw error;
  }
}
