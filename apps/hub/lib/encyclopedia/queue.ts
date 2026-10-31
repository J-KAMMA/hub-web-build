import "server-only";

import { and, eq, ne, or, sql } from "drizzle-orm";

import { getHubJobsQueue } from "@/lib/server/hub-d1";
import { getHubD1 } from "@/lib/server/hub-d1";
import { getAutomationControl } from "@/lib/server/hubpedia-quality-operations";
import { getEncyclopediaAiConfig } from "./config";
import { getDb } from "./db/client";
import { encyclopediaPipelineRuns, encyclopediaSources, encyclopediaTopics } from "./db/schema";
import { createPipelineRun, JOBS } from "./pipeline";

export async function enqueueSourceFetch(sourceId: string, topicId: string) {
  const run = await createPipelineRun(JOBS.fetch, { sourceId, topicId });
  await getHubJobsQueue().send({ type: JOBS.fetch, sourceId, topicId, runId: run.id });
  return run;
}

export async function enqueueDueTopicRefreshes(now = new Date()) {
  const control = await getAutomationControl(getHubD1());
  if (!control.enabled) return 0;
  const db = getDb();
  const limit = getEncyclopediaAiConfig().ENCYCLOPEDIA_REFRESH_SCAN_LIMIT;
  const due = await db.select().from(encyclopediaTopics).where(and(
    ne(encyclopediaTopics.status, "archived"),
    ne(encyclopediaTopics.topicType, "ledger-pool"),
    ne(encyclopediaTopics.status, "researching"),
    sql`exists (select 1 from ${encyclopediaSources} where ${encyclopediaSources.topicId} = ${encyclopediaTopics.id} and ${encyclopediaSources.isActive} = 1)`,
    or(
      sql`${encyclopediaTopics.lastResearchedAt} is null`,
      sql`${encyclopediaTopics.lastResearchedAt} + (${encyclopediaTopics.freshnessIntervalHours} * 3600) <= ${now}`
    )
  )).limit(limit);

  let enqueued = 0;
  for (const topic of due) {
    const [reserved] = await db.update(encyclopediaTopics).set({ status: "researching", updatedAt: now })
      .where(and(eq(encyclopediaTopics.id, topic.id), eq(encyclopediaTopics.status, topic.status))).returning({ id: encyclopediaTopics.id });
    if (!reserved) continue;
    const run = await createPipelineRun(JOBS.refresh, { topicId: topic.id });
    try {
      await getHubJobsQueue().send({ type: JOBS.refresh, topicId: topic.id, runId: run.id });
      enqueued += 1;
    } catch (error) {
      await db.update(encyclopediaPipelineRuns).set({ status: "failed", completedAt: new Date(), error: { code: "queue_failed", message: error instanceof Error ? error.message.slice(0, 1000) : "Queue operation failed." } }).where(eq(encyclopediaPipelineRuns.id, run.id));
      await db.update(encyclopediaTopics).set({ status: "stale", updatedAt: new Date() }).where(eq(encyclopediaTopics.id, topic.id));
      throw error;
    }
  }
  return enqueued;
}

export async function enqueueCorpusDiscovery(now = new Date()) {
  const control = await getAutomationControl(getHubD1());
  if (!control.enabled) return { status: "cancelled", reason: control.reason };
  const config = getEncyclopediaAiConfig();
  const bucket = Math.floor(now.getTime() / config.ENCYCLOPEDIA_REFRESH_SCAN_INTERVAL_MS);
  const run = await createPipelineRun(JOBS.discover, { scheduledAt: now.toISOString() }, `corpus-discovery:${bucket}`);
  if (run.status !== "queued") return run;
  await getHubJobsQueue().send({ type: JOBS.discover, runId: run.id, scheduledAt: now.toISOString() });
  return run;
}
