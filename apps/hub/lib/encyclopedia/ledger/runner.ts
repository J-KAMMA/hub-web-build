import type { D1Database } from "@cloudflare/workers-types";

import { ChainExhaustedError, FilePendingError } from "../provider-chain";
import { isProtectedSlug, type LedgerTopic } from "./select";

/*
 * Unattended runner core (docs/hubpedia-ledger.md, "Unattended runner"). It owns scheduling only: which topics, how
 * many at once, when to stop, what is recorded. What happens to one topic (ingest, extract, compose, check, store) is
 * `processTopic`, injected by scripts/hubpedia-ledger-run.ts, so this module needs no model and no network.
 *
 * Records live in a table of the throwaway SQLite file (created here, not a migration): the runner never writes a D1.
 */

export type TopicStatus = "pass" | "fail" | "waiting";
export type TopicResult = { status: TopicStatus; reason: string };

export type RunnerTopic = LedgerTopic & { rank: number; hasLedgerArticle: boolean };

export const RUNNER_TABLE_DDL = `CREATE TABLE IF NOT EXISTS hubpedia_ledger_runner_topics (
  topic_id TEXT PRIMARY KEY,
  result TEXT NOT NULL CHECK (result IN ('pass','fail','waiting')),
  reason TEXT NOT NULL,
  seconds REAL NOT NULL,
  model_calls INTEGER NOT NULL,
  retry_at INTEGER,
  finished_at INTEGER NOT NULL
)`;

export async function ensureRunnerTable(db: D1Database) {
  await db.prepare(RUNNER_TABLE_DDL).run();
}

export const WAITING_RETRY_SECONDS = 24 * 3600;

/**
 * The next topics of the term net by (priority_rank, topic_id) after the cursor that the runner has not finished:
 * no record, or `waiting` past its retry time, or `fail` when retrying failures. Protected slugs and topics owned by a
 * person are skipped (the same rule as select.ts). Walks a key range, never OFFSET.
 */
export async function nextNetTopics(
  db: D1Database,
  options: { after: { rank: number; id: string }; limit: number; nowSeconds: number; retryFailed?: boolean },
): Promise<{ topics: RunnerTopic[]; last: { rank: number; id: string } | null; exhausted: boolean }> {
  const page = await db.prepare(
    `SELECT t.id AS id, t.slug AS slug, t.canonical_name AS canonicalName, ht.priority_rank AS rank,
            cr.created_by AS currentAuthor, a.current_revision_id AS currentRevisionId
       FROM hubpedia_terms ht
       JOIN encyclopedia_topics t ON t.id = ht.topic_id
       LEFT JOIN encyclopedia_articles a ON a.topic_id = t.id
       LEFT JOIN encyclopedia_article_revisions cr ON cr.id = a.current_revision_id
       LEFT JOIN hubpedia_ledger_runner_topics r ON r.topic_id = t.id
      WHERE ht.priority_rank IS NOT NULL AND ht.topic_id IS NOT NULL AND t.topic_type <> 'ledger-pool'
        AND NOT (ht.linkable = 0 AND ht.hops > 0)
        AND (ht.priority_rank, ht.topic_id) > (?, ?)
        AND (r.topic_id IS NULL OR (r.result = 'waiting' AND COALESCE(r.retry_at, 0) <= ?) OR (r.result = 'fail' AND ? = 1))
      ORDER BY ht.priority_rank, ht.topic_id
      LIMIT ?`,
  ).bind(options.after.rank, options.after.id, options.nowSeconds, options.retryFailed ? 1 : 0, options.limit).all<{
    id: string; slug: string; canonicalName: string; rank: number; currentAuthor: string | null; currentRevisionId: string | null;
  }>();
  const rows = page.results ?? [];
  const topics: RunnerTopic[] = [];
  for (const row of rows) {
    const humanOwned = row.currentRevisionId !== null && row.currentAuthor !== "hubpedia-ledger";
    if (isProtectedSlug(row.slug) || humanOwned) continue;
    topics.push({ id: row.id, slug: row.slug, canonicalName: row.canonicalName, rank: Number(row.rank), hasLedgerArticle: row.currentRevisionId !== null });
  }
  const lastRow = rows[rows.length - 1];
  return { topics, last: lastRow ? { rank: Number(lastRow.rank), id: lastRow.id } : null, exhausted: rows.length < options.limit };
}

export async function recordTopic(db: D1Database, topicId: string, record: { result: TopicStatus; reason: string; seconds: number; modelCalls: number; nowSeconds: number }) {
  await db.prepare(
    `INSERT INTO hubpedia_ledger_runner_topics (topic_id, result, reason, seconds, model_calls, retry_at, finished_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(topic_id) DO UPDATE SET result = excluded.result, reason = excluded.reason, seconds = excluded.seconds,
       model_calls = excluded.model_calls, retry_at = excluded.retry_at, finished_at = excluded.finished_at`,
  ).bind(
    topicId, record.result, record.reason.slice(0, 300), Math.round(record.seconds * 100) / 100, record.modelCalls,
    record.result === "waiting" ? record.nowSeconds + WAITING_RETRY_SECONDS : null, record.nowSeconds,
  ).run();
}

/** Counts model calls of one topic. The CLI wraps its model functions with `count()`. */
export class CallCounter {
  calls = 0;
  count() { this.calls += 1; }
}

export type ProgressLine = { topic: string; result: TopicStatus | "paused"; reason: string; seconds: number; modelCalls: number };

export interface RunnerDeps {
  db: D1Database;
  /** One topic, start to finish. Throws ChainExhaustedError when no provider can serve. */
  processTopic: (topic: RunnerTopic, counter: CallCounter) => Promise<TopicResult>;
  /** False when every provider of the chain is paused, exhausted or capped right now. */
  chainAvailable: () => boolean;
  progress: (line: ProgressLine) => void;
  nowMs?: () => number;
}

export interface RunnerOptions {
  concurrency: number;
  maxArticles?: number;
  untilMs?: number;
  retryFailed?: boolean;
  pageSize?: number;
}

export interface RunSummary {
  started: number; pass: number; fail: number; waiting: number; paused: number;
  stopReason: "no-more-topics" | "max-articles" | "until" | "providers-exhausted";
  modelCalls: number; peakInFlight: number;
}

const sleep = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export async function runLedgerTopics(deps: RunnerDeps, options: RunnerOptions): Promise<RunSummary> {
  const now = deps.nowMs ?? Date.now;
  await ensureRunnerTable(deps.db);
  const summary: RunSummary = { started: 0, pass: 0, fail: 0, waiting: 0, paused: 0, stopReason: "no-more-topics", modelCalls: 0, peakInFlight: 0 };
  const pageSize = options.pageSize ?? Math.max(options.concurrency * 2, 8);
  let cursor = { rank: -1, id: "" };
  const buffer: RunnerTopic[] = [];
  let netDone = false;
  let stop: RunSummary["stopReason"] | null = null;
  let inFlight = 0;
  let refill: Promise<void> | null = null;

  const fill = async () => {
    const page = await nextNetTopics(deps.db, { after: cursor, limit: pageSize, nowSeconds: Math.floor(now() / 1000), retryFailed: options.retryFailed });
    if (page.last) cursor = page.last;
    buffer.push(...page.topics);
    if (page.exhausted) netDone = true;
  };
  const take = async (): Promise<RunnerTopic | null> => {
    while (!buffer.length && !netDone) {
      refill ??= fill().finally(() => { refill = null; });
      await refill;
    }
    return buffer.shift() ?? null;
  };
  /** Why no new topic may start now; null when one may. */
  const blocked = (): RunSummary["stopReason"] | null => {
    if (stop) return stop;
    if (options.maxArticles !== undefined && summary.pass + inFlight >= options.maxArticles) return "max-articles";
    if (options.untilMs !== undefined && now() >= options.untilMs) return "until";
    if (!deps.chainAvailable()) return "providers-exhausted";
    return null;
  };

  const worker = async () => {
    for (;;) {
      const why = blocked();
      if (why === "max-articles") {
        // In-flight topics may still fail and free a slot; wait for them, then decide again.
        if (inFlight === 0) { stop ??= "max-articles"; return; }
        await sleep(10);
        continue;
      }
      if (why) { stop ??= why; return; }
      const topic = await take();
      if (!topic) return;
      // The check above ran before take() may have waited; decide again, with no await before the start below.
      if (blocked()) { buffer.unshift(topic); continue; }
      inFlight += 1; summary.started += 1; summary.peakInFlight = Math.max(summary.peakInFlight, inFlight);
      const counter = new CallCounter();
      const started = now();
      let outcome: TopicResult;
      try {
        outcome = topic.hasLedgerArticle ? { status: "pass", reason: "existing-ledger-article" } : await deps.processTopic(topic, counter);
      } catch (error) {
        const seconds = (now() - started) / 1000;
        summary.modelCalls += counter.calls;
        if (error instanceof FilePendingError) {
          inFlight -= 1; summary.paused += 1;
          deps.progress({ topic: topic.slug, result: "paused", reason: "file-pending", seconds, modelCalls: counter.calls });
          continue;
        }
        if (error instanceof ChainExhaustedError) {
          inFlight -= 1; summary.paused += 1; stop = "providers-exhausted";
          deps.progress({ topic: topic.slug, result: "paused", reason: "providers exhausted; rerun later", seconds, modelCalls: counter.calls });
          return;
        }
        const reason = `error: ${error instanceof Error ? error.message : String(error)}`.replace(/\s+/g, " ").slice(0, 200);
        await recordTopic(deps.db, topic.id, { result: "fail", reason, seconds, modelCalls: counter.calls, nowSeconds: Math.floor(now() / 1000) });
        inFlight -= 1; summary.fail += 1;
        deps.progress({ topic: topic.slug, result: "fail", reason, seconds, modelCalls: counter.calls });
        continue;
      }
      const seconds = (now() - started) / 1000;
      summary.modelCalls += counter.calls;
      await recordTopic(deps.db, topic.id, { result: outcome.status, reason: outcome.reason, seconds, modelCalls: counter.calls, nowSeconds: Math.floor(now() / 1000) });
      inFlight -= 1; summary[outcome.status] += 1;
      deps.progress({ topic: topic.slug, result: outcome.status, reason: outcome.reason, seconds, modelCalls: counter.calls });
    }
  };

  await Promise.all(Array.from({ length: Math.max(1, options.concurrency) }, worker));
  if (stop) summary.stopReason = stop;
  return summary;
}
