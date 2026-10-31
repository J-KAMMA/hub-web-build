import type { D1Database } from "@cloudflare/workers-types";

import { JOBS } from "@/lib/encyclopedia/job-types";
import { monitorDueHubAdLandings } from "@/lib/server/hub-ads-landing-monitor";
import { runHubAdReportingMaintenance } from "@/lib/server/hub-ads-reporting";
import { deliverPendingThreadNotifications } from "@/lib/server/thread-notification-delivery";
import { monitorDueWikiSources } from "@/lib/server/hubpedia-wiki-ai-review";
import { maintainVideoAvailability } from "@/lib/server/video-availability-maintenance";
import { publishDueSocialPosts } from "@/lib/server/d1-social-scheduled";
import { publishDueArticleDrafts } from "@/lib/server/d1-user-article-drafts";
import { maintainExpiredWorkListings } from "@/lib/server/work-listing-maintenance";
import { anonymizeExpiredJobApplications } from "@/lib/server/d1-job-recruiting";
import { processVideoImportJob, requeuePendingVideoImports } from "@/lib/server/video-import-job";
import { synchronizeHubpediaCategoryRegistry } from "@/lib/server/hubpedia-category-registry";
import { getPublicReaderReadySeedArticles } from "@/lib/encyclopedia/public-seed";
import type { WorkerDataEnv } from "@/lib/server/worker-data";
import { pruneExpiredD1PostRateLimits } from "@/lib/server/d1-rate-limit";
import { pruneExpiredSocialPostImages } from "@/lib/server/social-post-images";
import { drainHubStorageOutbox } from "@/lib/server/hub-storage-usage";
import { drainHubVideoOutbox } from "@/lib/server/hub-videos";
import { hubVideoDepsFromEnv } from "@/lib/server/hub-videos-env";
import { pruneExpiredDirectMessageImages } from "@/lib/server/direct-message-images";
import { refreshActivityPubNodeRegistry } from "@/lib/server/activitypub-node-registry";
import { refreshMusicTagFacets } from "@/lib/server/d1-music";
import { runScheduledHubEvidenceRevalidation } from "@/lib/server/hubpedia-hub-evidence";
import { databaseCoverageCheck, runScheduledHubTopicScan } from "@/lib/server/hubpedia-hub-topics";
import { embedPendingMusicWorks } from "@/lib/server/music-embedding";
import { federationConfiguration } from "@/lib/server/federation-gateway";
import { pullFederationAll } from "@/lib/server/federation-group-inbound";
import { runCopyrightDeadlines } from "@/lib/server/copyright-cases";
import { isOptionalServiceEnabled } from "@/lib/optional-services";

export const HUB_MAINTENANCE_JOBS = {
  notifications: "hub.maintenance.notifications",
  scheduledPosts: "hub.maintenance.scheduled-posts",
  scheduledArticles: "hub.maintenance.scheduled-articles",
  workListings: "hub.maintenance.work-listings",
  jobApplications: "hub.maintenance.job-applications",
  adLandings: "hub.maintenance.ad-landings",
  adReports: "hub.maintenance.ad-reports",
  hubpediaSources: "hub.maintenance.hubpedia-sources",
  hubpediaCategories: "hub.maintenance.hubpedia-categories",
  videoAvailability: "hub.maintenance.video-availability",
  videoImports: "hub.maintenance.video-imports",
  rateLimits: "hub.maintenance.rate-limits",
  expiredTechnicalRows: "hub.maintenance.expired-technical-rows",
  socialImages: "hub.maintenance.social-images",
  directMessageImages: "hub.maintenance.dm-images",
  activityPubNodes: "hub.maintenance.activitypub-nodes",
  musicTagFacets: "hub.maintenance.music-tag-facets",
  musicEmbeddings: "hub.maintenance.music-embeddings",
  hubpediaHubEvidence: "hub.maintenance.hubpedia-hub-evidence",
  hubpediaHubTopics: "hub.maintenance.hubpedia-hub-topics",
  federationInbound: "hub.maintenance.federation-inbound",
  copyrightCases: "hub.maintenance.copyright-cases",
  fileUnpublishRetry: "hub.maintenance.file-unpublish-retry",
  profileDeletions: "hub.maintenance.profile-deletions",
  privacyRetention: "hub.maintenance.privacy-retention",
  workCommissions: "hub.maintenance.work-commissions",
} as const;

export type HubMaintenanceJobType = typeof HUB_MAINTENANCE_JOBS[keyof typeof HUB_MAINTENANCE_JOBS];
export type HubMaintenanceJob = { type: HubMaintenanceJobType; scheduledAt: string };
type EncyclopediaJob =
  | { type: typeof JOBS.fetch; runId: string; sourceId: string; topicId?: string }
  | { type: typeof JOBS.refresh; runId: string; topicId: string }
  | { type: typeof JOBS.discover; runId: string; scheduledAt?: string };
type VideoImportJob = { type: "hub.video.import"; jobId: string };

export type HubQueueJob = HubMaintenanceJob | EncyclopediaJob | VideoImportJob;
type HubMaintenanceEnv = {
  HUB_DATABASE: D1Database;
  HUB_MEDIA: import("@cloudflare/workers-types").R2Bucket;
  HUB_JOBS?: import("@cloudflare/workers-types").Queue;
  /** Static assets: the Hubpedia seed is read from here (lib/server/worker-data.ts). */
  ASSETS?: WorkerDataEnv["ASSETS"];
};

export type D1CostMetrics = { rowsRead?: number; rowsWritten?: number };

/** Extracts only aggregate D1 billing counters; row data is never logged. */
export function d1CostMetrics(value: unknown): D1CostMetrics {
  if (!value || typeof value !== "object") return {};
  const meta = (value as { meta?: unknown }).meta;
  if (!meta || typeof meta !== "object") return {};
  const rowsRead = (meta as { rows_read?: unknown }).rows_read;
  const rowsWritten = (meta as { rows_written?: unknown }).rows_written;
  return {
    ...(typeof rowsRead === "number" ? { rowsRead } : {}),
    ...(typeof rowsWritten === "number" ? { rowsWritten } : {}),
  };
}

const maintenanceTypes = new Set<string>(Object.values(HUB_MAINTENANCE_JOBS));

export function isHubQueueJob(value: unknown): value is HubQueueJob {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (typeof record.type !== "string") return false;
  if (maintenanceTypes.has(record.type)) return typeof record.scheduledAt === "string";
  if (record.type === JOBS.fetch) return typeof record.runId === "string" && typeof record.sourceId === "string";
  if (record.type === JOBS.refresh) return typeof record.runId === "string" && typeof record.topicId === "string";
  if (record.type === JOBS.discover) return typeof record.runId === "string";
  if (record.type === "hub.video.import") return typeof record.jobId === "string";
  return false;
}

export function jobsForCron(cron: string, now = new Date()): HubMaintenanceJob[] {
  const types: HubMaintenanceJobType[] = cron === "* * * * *" ? [
    /* 他のハブからの投稿・返信・いいねを Federation の受信箱から取り込む（DESIGN.md 4.1）。 */
    HUB_MAINTENANCE_JOBS.federationInbound,
    /* 予約公開の記事。1分ごとに時刻を過ぎた下書きだけを拾う（索引つきの1回の検索）。 */
    HUB_MAINTENANCE_JOBS.scheduledArticles,
  ] : cron === "0 * * * *" ? [
    HUB_MAINTENANCE_JOBS.notifications,
    HUB_MAINTENANCE_JOBS.scheduledPosts,
    HUB_MAINTENANCE_JOBS.workListings,
    HUB_MAINTENANCE_JOBS.jobApplications,
    HUB_MAINTENANCE_JOBS.videoImports,
    HUB_MAINTENANCE_JOBS.rateLimits,
    HUB_MAINTENANCE_JOBS.expiredTechnicalRows,
    HUB_MAINTENANCE_JOBS.socialImages,
    HUB_MAINTENANCE_JOBS.directMessageImages,
    /* 著作権の事件：照会から7日の非公開、非公開から14日の確定、閉じてから3年の申告者ID消去（索引つき・LIMITつき）。 */
    HUB_MAINTENANCE_JOBS.copyrightCases,
    /* Gated files whose unpublish could not reach the file component (Hub already stopped tickets). */
    HUB_MAINTENANCE_JOBS.fileUnpublishRetry,
    /* Profile deletions whose 30-day cancel window has passed (resumable, bounded; docs/hub-privacy/AUDIT.md 2.1). */
    HUB_MAINTENANCE_JOBS.profileDeletions,
    /* Viewer and IP hashes after 90 days, wallet senders 1 year after confirmation (bounded; docs/hub-privacy/AUDIT.md 8.8). */
    HUB_MAINTENANCE_JOBS.privacyRetention,
    /* 指名依頼：確認期間が24時間以内に終わる通知、終了から1年を過ぎたスレッドの削除（索引つき・キーセット・上限つき）。 */
    HUB_MAINTENANCE_JOBS.workCommissions,
  ] : cron === "17 */6 * * *" ? [
    HUB_MAINTENANCE_JOBS.adLandings,
    HUB_MAINTENANCE_JOBS.adReports,
  ] : cron === "27 */6 * * *" ? [
    HUB_MAINTENANCE_JOBS.hubpediaSources,
    HUB_MAINTENANCE_JOBS.hubpediaCategories,
    HUB_MAINTENANCE_JOBS.videoAvailability,
    HUB_MAINTENANCE_JOBS.activityPubNodes,
    /* Counting the tags is the one query on /music that grows with the catalogue. */
    HUB_MAINTENANCE_JOBS.musicTagFacets,
    /* New works get vectors here rather than from a public endpoint. */
    HUB_MAINTENANCE_JOBS.musicEmbeddings,
    /* Hub items cited as Hubpedia evidence: deleted, private, opted-out or edited ones. */
    HUB_MAINTENANCE_JOBS.hubpediaHubEvidence,
    /* Topics several members wrote about: candidates only, never articles (DESIGN.md section 7). */
    HUB_MAINTENANCE_JOBS.hubpediaHubTopics,
  ] : [];
  const scheduledAt = now.toISOString();
  return types.map((type) => ({ type, scheduledAt }));
}

/** A topic is covered when the database or the code-based catalog already has an entry by that name. */
function hubTopicCoverage(db: D1Database, env: HubMaintenanceEnv) {
  const inDatabase = databaseCoverageCheck(db);
  let catalog: Set<string> | null = null;
  return async (label: string) => {
    catalog ??= new Set((await getPublicReaderReadySeedArticles(env)).flatMap((article) => [article.slug, article.title.normalize("NFKC").toLocaleLowerCase("ja")]));
    const lower = label.normalize("NFKC").toLocaleLowerCase("ja");
    return catalog.has(lower) || inDatabase(label);
  };
}

export async function processHubQueueJob(job: HubQueueJob, env: HubMaintenanceEnv): Promise<unknown> {
  /*
   * Ingestion pulls in jsdom, Readability and the charset tables (about 6 MiB of
   * script). These imports are dynamic so the Worker does not evaluate that
   * stack when it starts, only when a queue message actually needs it.
   */
  if (job.type === JOBS.fetch) return (await import("@/lib/encyclopedia/pipeline")).processFetch(job.runId, job.sourceId);
  if (job.type === JOBS.refresh) return (await import("@/lib/encyclopedia/research")).processTopicRefresh(job.runId, job.topicId);
  if (job.type === JOBS.discover) return (await import("@/lib/encyclopedia/corpus-discovery")).processCorpusDiscovery(job.runId);
  if (job.type === "hub.video.import") {
    const apiKey = Reflect.get(env, "YOUTUBE_DATA_API_KEY");
    return processVideoImportJob(env.HUB_DATABASE, job.jobId, typeof apiKey === "string" ? apiKey : undefined);
  }
  const db: D1Database = env.HUB_DATABASE;
  switch (job.type) {
    case HUB_MAINTENANCE_JOBS.notifications: return deliverPendingThreadNotifications(db);
    case HUB_MAINTENANCE_JOBS.scheduledPosts: return publishDueSocialPosts(db);
    case HUB_MAINTENANCE_JOBS.scheduledArticles: return publishDueArticleDrafts(db);
    case HUB_MAINTENANCE_JOBS.workListings: return maintainExpiredWorkListings(db);
    case HUB_MAINTENANCE_JOBS.jobApplications: return anonymizeExpiredJobApplications(db);
    case HUB_MAINTENANCE_JOBS.adLandings: return monitorDueHubAdLandings(db);
    case HUB_MAINTENANCE_JOBS.adReports: return runHubAdReportingMaintenance(db);
    case HUB_MAINTENANCE_JOBS.hubpediaSources: return monitorDueWikiSources(db, fetch, 25);
    case HUB_MAINTENANCE_JOBS.hubpediaCategories: return synchronizeHubpediaCategoryRegistry(db, await getPublicReaderReadySeedArticles(env));
    case HUB_MAINTENANCE_JOBS.videoAvailability: return maintainVideoAvailability(db);
    case HUB_MAINTENANCE_JOBS.videoImports:
      if (!env.HUB_JOBS) throw new Error("HUB_JOBS Queue binding is not configured.");
      return requeuePendingVideoImports(db, env.HUB_JOBS);
    case HUB_MAINTENANCE_JOBS.rateLimits: return pruneExpiredD1PostRateLimits(db);
    case HUB_MAINTENANCE_JOBS.expiredTechnicalRows: return (await import("@/lib/server/d1-expired-rows")).pruneExpiredTechnicalRows(db);
    case HUB_MAINTENANCE_JOBS.socialImages: {
      const pruned = await pruneExpiredSocialPostImages(db, env.HUB_MEDIA);
      // Re-send unacknowledged storage commits/releases to Account and expire stale reservations. Never fails the prune.
      await drainHubStorageOutbox(db).catch(() => undefined);
      // Tell the Video Worker about unpublishes and deletes it missed, and finish video storage steps.
      await drainHubVideoOutbox(db, hubVideoDepsFromEnv(env as unknown as Record<string, unknown>)).catch(() => undefined);
      return pruned;
    }
    case HUB_MAINTENANCE_JOBS.directMessageImages: return pruneExpiredDirectMessageImages(db, env.HUB_MEDIA);
    case HUB_MAINTENANCE_JOBS.activityPubNodes: return refreshActivityPubNodeRegistry(db);
    case HUB_MAINTENANCE_JOBS.musicTagFacets: return refreshMusicTagFacets(db);
    case HUB_MAINTENANCE_JOBS.musicEmbeddings: return embedPendingMusicWorks(db, env);
    case HUB_MAINTENANCE_JOBS.hubpediaHubEvidence: return runScheduledHubEvidenceRevalidation(db);
    case HUB_MAINTENANCE_JOBS.hubpediaHubTopics: return runScheduledHubTopicScan(db, { isCovered: hubTopicCoverage(db, env) });
    case HUB_MAINTENANCE_JOBS.copyrightCases: return runCopyrightDeadlines(db, { media: env.HUB_MEDIA });
    case HUB_MAINTENANCE_JOBS.fileUnpublishRetry: {
      const files = await import("@/lib/server/content-files");
      return files.retryPendingFileUnpublishes(db, files.contentFileDepsFromEnv(env as unknown as Record<string, unknown>));
    }
    case HUB_MAINTENANCE_JOBS.profileDeletions: return (await import("@/lib/server/profile-deletion")).runProfileDeletions(db);
    case HUB_MAINTENANCE_JOBS.privacyRetention: return (await import("@/lib/server/privacy-retention")).runPrivacyRetention(db);
    case HUB_MAINTENANCE_JOBS.workCommissions: {
      /* Off unless HUB_WORK_COMMISSIONS_ENABLED: production runs nothing and reads no commission table. */
      if (!isOptionalServiceEnabled("work-commissions", env as unknown as Record<string, string | undefined>)) return { skipped: "work_commissions_disabled" };
      return (await import("@/lib/server/work-maintenance")).runWorkCommissionMaintenance(db);
    }
    case HUB_MAINTENANCE_JOBS.federationInbound: return federationConfiguration() ? pullFederationAll(db) : { skipped: "federation_not_configured" };
  }
}
