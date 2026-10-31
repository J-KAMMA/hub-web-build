import "server-only";
import { eq } from "drizzle-orm";
import { getEncyclopediaConfig } from "./config";
import { chunkText } from "./chunk";
import { getDb } from "./db/client";
import { extractHtml } from "./extract";
import { fetchSource } from "./fetcher";
import { encyclopediaPipelineRuns, encyclopediaSourceChunks, encyclopediaSourceSnapshots, encyclopediaSources } from "./db/schema";
import { R2ObjectStore, type ObjectStore } from "./storage";
import { JOBS } from "./job-types";

export { JOBS };
type RunType = typeof JOBS[keyof typeof JOBS];
export async function runPipelineStep<T>(runId: string, work: () => Promise<T>) { const db = getDb(); await db.update(encyclopediaPipelineRuns).set({ status: "running", startedAt: new Date(), error: null }).where(eq(encyclopediaPipelineRuns.id, runId)); try { const output = await work(); await db.update(encyclopediaPipelineRuns).set({ status: "succeeded", output: output as Record<string, unknown>, completedAt: new Date() }).where(eq(encyclopediaPipelineRuns.id, runId)); return output; } catch (error) { await db.update(encyclopediaPipelineRuns).set({ status: "failed", error: { code: error instanceof Error && "code" in error ? String(error.code) : "pipeline_failed", message: error instanceof Error ? error.message.slice(0, 1000) : "Pipeline failed." }, completedAt: new Date() }).where(eq(encyclopediaPipelineRuns.id, runId)); throw error; } }
export async function createPipelineRun(runType: RunType, input: Record<string, unknown>, idempotencyKey?: string) {
  const db = getDb();
  const [created] = await db.insert(encyclopediaPipelineRuns).values({ runType, input, idempotencyKey, sourceId: typeof input.sourceId === "string" ? input.sourceId : null, topicId: typeof input.topicId === "string" ? input.topicId : null }).onConflictDoNothing().returning();
  if (created) return created;
  if (!idempotencyKey) throw new Error("Pipeline run could not be created.");
  const [existing] = await db.select().from(encyclopediaPipelineRuns).where(eq(encyclopediaPipelineRuns.idempotencyKey, idempotencyKey));
  if (!existing) throw new Error("Idempotent pipeline run could not be loaded.");
  return existing;
}

export async function processFetch(runId: string, sourceId: string, store: ObjectStore = new R2ObjectStore()) { return runPipelineStep(runId, async () => { const db = getDb(); const [source] = await db.select().from(encyclopediaSources).where(eq(encyclopediaSources.id, sourceId)); if (!source) throw new Error("Source not found."); const config = getEncyclopediaConfig(); const fetched = await fetchSource(source.url, { timeoutMs: config.ENCYCLOPEDIA_FETCH_TIMEOUT_MS, maxBytes: config.ENCYCLOPEDIA_MAX_SOURCE_BYTES }); const existing = await db.select().from(encyclopediaSourceSnapshots).where(eq(encyclopediaSourceSnapshots.sourceId, sourceId)); const duplicate = existing.find((s) => s.contentHash === fetched.contentHash); if (duplicate) return { sourceId, snapshotId: duplicate.id, duplicate: true };
    const key = await store.put(fetched.body, fetched.mimeType); const decoded = new TextDecoder().decode(fetched.body); let extractedText: string | null = null; let metadata: Record<string, unknown> = {}; let status: "completed" | "failed" = "completed"; try { const extracted = fetched.mimeType === "text/html" || fetched.mimeType === "application/xhtml+xml" ? extractHtml(decoded, fetched.finalUrl) : { text: decoded, title: null, canonicalUrl: null, headings: [], language: null, publishedAt: null, authors: [] }; extractedText = extracted.text; metadata = { ...extracted }; } catch (error) { status = "failed"; metadata = { error: error instanceof Error ? error.message : "Extraction failed." }; }
    const [snapshot] = await db.insert(encyclopediaSourceSnapshots).values({ sourceId, contentHash: fetched.contentHash, mimeType: fetched.mimeType, objectStorageKey: key, extractedText, extractionStatus: status === "completed" ? "succeeded" : "failed", extractionMetadata: metadata, canonicalUrl: fetched.finalUrl }).onConflictDoNothing().returning(); const saved = snapshot ?? (await db.select().from(encyclopediaSourceSnapshots).where(eq(encyclopediaSourceSnapshots.sourceId, sourceId))).find((s) => s.contentHash === fetched.contentHash); if (!saved) throw new Error("Snapshot could not be persisted."); if (extractedText) await replaceChunks(saved.id, extractedText); return { sourceId, snapshotId: saved.id, contentHash: fetched.contentHash, extractionStatus: status, duplicate: !snapshot }; }); }
export async function replaceChunks(snapshotId: string, text: string) {
  const config = getEncyclopediaConfig();
  const chunks = chunkText(text, config.ENCYCLOPEDIA_CHUNK_MAX_TOKENS, config.ENCYCLOPEDIA_CHUNK_OVERLAP_TOKENS);
  const db = getDb();
  const removeExisting = db.delete(encyclopediaSourceChunks).where(eq(encyclopediaSourceChunks.snapshotId, snapshotId));
  if (chunks.length) {
    await db.batch([
      removeExisting,
      db.insert(encyclopediaSourceChunks).values(chunks.map((chunk) => ({ ...chunk, snapshotId }))),
    ]);
  } else {
    await removeExisting;
  }
  return chunks;
}
