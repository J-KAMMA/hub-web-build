import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalHubpediaSlug } from "../lib/encyclopedia/article-aliases";
import { ledgerCacheRoot, resolveCacheNamespace } from "../lib/encyclopedia/ledger/cache-namespace";
import { chainJudge, dedupeTopic, type Judge } from "../lib/encyclopedia/ledger/dedupe";
import {
  chainComplete, extractChunk, getLedgerPoolTopicId, jsonFileCache, loadQueue, prescreenSources, type ExtractComplete, type ExtractDeps,
} from "../lib/encyclopedia/ledger/extract";
import { getLedgerFeed } from "../lib/encyclopedia/ledger/feeds";
import { defaultIngestDeps, discoverSitemapUrls, processLedgerUrl } from "../lib/encyclopedia/ledger/ingest";
import { CallCounter, runLedgerTopics, type RunnerTopic, type TopicResult } from "../lib/encyclopedia/ledger/runner";
import { runLedgerTopicSources } from "../lib/encyclopedia/ledger/topic-sources";
import { logStage, setStageLog, timed } from "../lib/encyclopedia/ledger/stage-log";
import { buildHeadwordIndex, recomputeTopicStats, topicsOfClaims } from "../lib/encyclopedia/ledger/topics";
import {
  ChainExhaustedError, CHAIN_ORDER, DEFAULT_DAILY_CAPS, claudeConcurrency, claudeCliAdapter, commandCodeAdapter, completeViaChain, loadChainState,
  opencodeFreeAdapter, opencodeFreeConcurrency, opencodeGoAdapter, resolveChainOrder, type Adapter, type ChainCall,
} from "../lib/encyclopedia/provider-chain";
import { openHubDatabase, reexecWithServerOnlyStub } from "./hubpedia-hub-db";

/*
 * Unattended Hubpedia ledger runner (docs/hubpedia-ledger.md, "Unattended runner").
 *
 *   npx tsx scripts/hubpedia-ledger-run.ts --sqlite=<file> --objects=<dir> [--concurrency N] [--max-articles N]
 *       [--until=<ISO time | HH:MM today/tomorrow local>] [--urls-file=<json: slug -> [url]>] [--feed=owid]
 *       [--drain] [--retry-failed] [--no-topic-sources] [--stage-log=<file>] [--cache-namespace NAME]
 *   add --stub [--stub-topics N] [--stub-latency-ms M] [--stub-fetch-ms M] for a run with fake model answers and
 *   fake pages (no network, no provider).
 *
 * Topics come from the term net by (priority_rank, topic_id). Each goes through ingest (its URLs, if any), extraction of
 * its sources' chunks, dedupe, the evidence gate, compose, the sentence check, translation and storage into the SQLite
 * file. Finished topics are recorded there, so the same command resumes. The run ends when every provider is paused,
 * exhausted or at its daily cap (those caps are unchanged), at --max-articles, or at --until.
 *
 * It only ever opens a throwaway SQLite file (--sqlite): never a Wrangler D1.
 */

const here = dirname(fileURLToPath(import.meta.url));
const hubDir = resolve(here, "..");
const args = process.argv.slice(2);
/** `--name=value` or `--name value`. */
const option = (name: string) => {
  const joined = args.find((argument) => argument.startsWith(`--${name}=`));
  if (joined) return joined.slice(name.length + 3);
  const at = args.indexOf(`--${name}`);
  return at >= 0 && args[at + 1] !== undefined && !args[at + 1].startsWith("--") ? args[at + 1] : undefined;
};
const flag = (name: string) => args.includes(`--${name}`);

export function parseUntil(value: string, now = new Date()): number {
  const clock = /^(\d{1,2}):(\d{2})$/u.exec(value);
  if (clock) {
    const at = new Date(now);
    at.setHours(Number(clock[1]), Number(clock[2]), 0, 0);
    if (at.getTime() <= now.getTime()) at.setDate(at.getDate() + 1);
    return at.getTime();
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`--until must be an ISO time or HH:MM, got "${value}".`);
  return parsed;
}

/** Sum of the concurrency the available providers allow, within 1..16. */
export function defaultConcurrency(adapters: readonly Adapter[], order = resolveChainOrder()): number {
  let total = 0;
  for (const id of order) {
    const adapter = adapters.find((candidate) => candidate.id === id);
    if (!adapter?.available()) continue;
    total += id === "claude-cli" ? claudeConcurrency() : id === "opencode-free" ? opencodeFreeConcurrency() : 1;
  }
  return Math.min(16, Math.max(1, total));
}

/** True while at least one provider of the order can take a call now (not paused, exhausted or at its cap). */
export function chainHasCapacity(statePath: string, adapters: readonly Adapter[], now = new Date()): boolean {
  if (process.env.HUBPEDIA_FILE_PROVIDER_DIR) return true;
  const state = loadChainState(statePath, now);
  for (const id of resolveChainOrder()) {
    const adapter = adapters.find((candidate) => candidate.id === id);
    if (!adapter?.available()) continue;
    const provider = state.providers[id];
    const cap = DEFAULT_DAILY_CAPS[id];
    if (provider.exhaustedToday || provider.pausedUntil > now.getTime()) continue;
    if (cap !== null && cap !== undefined && provider.calls >= cap) continue;
    return true;
  }
  return false;
}

function mutex() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T,>(work: () => Promise<T>): Promise<T> => {
    const result = tail.then(work, work);
    tail = result.catch(() => undefined);
    return result;
  };
}

async function main() {
  if (reexecWithServerOnlyStub()) return;
  const stub = flag("stub");
  if (option("stage-log")) setStageLog(resolve(option("stage-log")!));
  const adapters = [claudeCliAdapter(), opencodeFreeAdapter(), commandCodeAdapter(), opencodeGoAdapter()];
  const statePath = resolve(hubDir, "data", "factory", ".hubpedia-provider-state.json");
  const chain = { statePath, adapters };
  const { db, objects, dispose, throwaway } = await openHubDatabase();
  try {
    if (!throwaway) throw new Error("The runner writes articles: give --sqlite=<throwaway file>. It never opens a Wrangler D1.");
    const feed = getLedgerFeed(option("feed") ?? "owid");
    if (!feed) throw new Error("Unknown --feed.");
    const concurrency = Number(option("concurrency") ?? (stub ? 1 : defaultConcurrency(adapters)));
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) throw new Error("--concurrency must be 1 to 16.");

    const stubKit = stub ? await import("../lib/encyclopedia/ledger/stub-model") : null;
    if (stubKit) await stubKit.seedStubTermNet(db, Number(option("stub-topics") ?? 5));
    const stubModel = stubKit?.createStubModel({ latencyMs: Number(option("stub-latency-ms") ?? 0), exhaustAfterCalls: option("stub-exhaust-after") ? Number(option("stub-exhaust-after")) : undefined });

    const urlsFile = option("urls-file") ? (JSON.parse(readFileSync(resolve(option("urls-file")!), "utf8")) as Record<string, string[]>) : {};
    const urlsFor = (topic: RunnerTopic): string[] => {
      if (stubKit) { const key = /^stub-(.+)$/u.exec(topic.slug)?.[1]; return key ? stubKit.stubTopicUrls(key) : []; }
      return urlsFile[topic.slug] ?? [];
    };

    const namespace = resolveCacheNamespace(option("cache-namespace"));
    const cacheRoot = ledgerCacheRoot(resolve(hubDir, "data", "ledger", "cache"), namespace);
    const caching = !stub;
    const poolTopicId = await getLedgerPoolTopicId(db);
    const { results: topicRows } = await db.prepare("SELECT id, canonical_name AS name FROM encyclopedia_topics WHERE topic_type <> 'ledger-pool' AND status <> 'archived'").all<{ id: string; name: string }>();
    const headwords = buildHeadwordIndex(topicRows);
    const ingestDeps = { ...defaultIngestDeps(db, objects), ...(stubKit ? { fetchPage: stubKit.stubFetchPage(Number(option("stub-fetch-ms") ?? 0)) } : {}) };
    const { loadAllowedLinks } = await import("../lib/encyclopedia/term-net/neighbours");
    const { VIEWABLE_SEED_ARTICLES } = await import("../lib/encyclopedia/seed");
    const seedArticleSlugs = new Set<string>(VIEWABLE_SEED_ARTICLES.map((article) => article.slug));
    const { composeTopic } = await import("./hubpedia-ledger-compose");
    const { loadRhythmNorm } = await import("../lib/encyclopedia/ledger/compose");
    const rhythmNorm = loadRhythmNorm(hubDir);
    const prescreenLock = mutex();
    /** Sources being extracted by some topic right now: another topic that lists the same URL leaves them to it. */
    const claimedSources = new Set<string>();

    /* Model entry points, counted per topic and timed as stage "model". */
    const complete = (counter: CallCounter) => async (call: ChainCall) => {
      counter.count();
      return timed("model", () => (stubModel ? stubModel.complete(call) : completeViaChain(call, chain)), { callStage: call.stage ?? "" });
    };
    const extractComplete = (counter: CallCounter): ExtractComplete => {
      if (stubModel) return async (call) => { counter.count(); const served = await timed("model", () => stubModel.complete(call), { callStage: "extract" }); return { ...served, cached: false }; };
      const base = chainComplete(chain, caching ? resolve(cacheRoot, "extract") : undefined);
      return async (call, context) => {
        const served = await timed("model", () => base(call, context), { callStage: "extract" });
        if (!served.cached) counter.count();
        return served;
      };
    };
    const judgeFor = (counter: CallCounter): Judge => {
      if (stubModel) return async (a, b) => { counter.count(); const served = await timed("model", () => stubModel.complete({ system: "", prompt: JSON.stringify({ claimA: a, claimB: b }), maxTokens: 50, stage: "judge" }), { callStage: "judge" }); return (served.output as { verdict: "distinct" }).verdict; };
      const base = chainJudge(chain, caching ? jsonFileCache(resolve(cacheRoot, "judge")) : undefined);
      return async (a, b) => { counter.count(); return timed("model", () => base(a, b), { callStage: "judge" }); };
    };

    /** Two topics may store the same sentence at the same moment; the loser sees the winner's row on a second try (the model answer is cached). */
    const extractWithRace = async (chunk: Parameters<typeof extractChunk>[0], deps: ExtractDeps) => {
      for (let attempt = 0; ; attempt += 1) {
        try { return await extractChunk(chunk, deps); } catch (error) {
          if (attempt < 2 && /claim_key/u.test(error instanceof Error ? error.message : "")) continue;
          throw error;
        }
      }
    };

    /* Sitemap discovery: pages of the feed whose URL slug names the term (topic-sources.ts). Candidates only: they go through processLedgerUrl like any feed page. */
    let sitemapUrls: Promise<string[]> | null = null;
    const discoverFor = async (topic: RunnerTopic): Promise<string[]> => {
      if (stub || flag("no-topic-sources")) return [];
      const row = await db.prepare("SELECT label_en AS labelEn FROM hubpedia_terms WHERE topic_id = ?").bind(topic.id).first<{ labelEn: string | null }>();
      sitemapUrls ??= timed("discover", () => discoverSitemapUrls(ingestDeps, feed)).catch(() => []);
      const run = await timed("discover", async () => runLedgerTopicSources(ingestDeps, feed, [{ slug: topic.slug, labelEn: row?.labelEn ?? null, aliasesEn: [] }], { urls: await sitemapUrls! }));
      return run.perTopic[topic.slug] ?? [];
    };

    const processTopic = async (topic: RunnerTopic, counter: CallCounter): Promise<TopicResult> => {
      const urls = urlsFor(topic);
      const discovered = (await discoverFor(topic)).filter((url) => !urls.includes(url));
      const allUrls = [...urls, ...discovered];
      let claimIds: string[] = [];
      if (allUrls.length) {
        for (const url of urls) await processLedgerUrl(ingestDeps, feed, url);
        const marks = allUrls.map(() => "?").join(",");
        const sources = (await db.prepare(`SELECT id FROM encyclopedia_sources WHERE url IN (${marks}) OR normalized_url IN (${marks})`).bind(...allUrls, ...allUrls).all<{ id: string }>()).results ?? [];
        await prescreenLock(async () => {
          let after = "";
          for (;;) {
            const part = await timed("prescreen", () => prescreenSources(db, { afterSourceId: after, objects }));
            if (!part.sources) break;
            after = part.nextAfterSourceId ?? "";
          }
        });
        const mine = sources.map((source) => source.id).filter((id) => !claimedSources.has(id));
        for (const id of mine) claimedSources.add(id);
        try {
        const deps: ExtractDeps = { db, complete: extractComplete(counter), poolTopicId, headwords, objects };
        let afterHash = "";
        for (;;) {
          const queue = await loadQueue(db, { afterHash, limit: 50, objects, sourceIds: mine });
          if (!queue.length) break;
          for (const chunk of queue) {
            afterHash = chunk.chunkHash;
            const outcome = await extractWithRace(chunk, deps);
            if (outcome.status === "succeeded") claimIds.push(...outcome.claimIds);
          }
        }
        } finally {
          for (const id of mine) claimedSources.delete(id);
        }
        const affected = await topicsOfClaims(db, claimIds);
        const judge = judgeFor(counter);
        for (const topicId of new Set([topic.id, ...affected])) await timed("dedupe", () => dedupeTopic(db, topicId, { judge, maxJudgements: 200 }));
        await timed("stats", () => recomputeTopicStats(db, new Set([topic.id, ...affected])));
        claimIds = [];
      }
      const stats = await db.prepare("SELECT usable_claims AS claims, usable_sources AS sources, eligible, stub_eligible AS stubEligible FROM hubpedia_ledger_topic_stats WHERE topic_id = ?").bind(topic.id).first<{ claims: number; sources: number; eligible: number; stubEligible: number }>();
      if (!stats?.eligible && !stats?.stubEligible) return { status: "waiting", reason: `not eligible: ${stats?.claims ?? 0} claims, ${stats?.sources ?? 0} sources` };
      const links = await loadAllowedLinks(db, topic.id, { seedArticleSlugs });
      const outcome = await composeTopic(db, topic.stub === undefined && !stats.eligible ? { ...topic, stub: true } : topic, {
        complete: complete(counter), model: stub ? "stub" : "chain", links, objects, allowedSlugs: new Set(links.map((link) => canonicalHubpediaSlug(link.slug))), write: true,
        cacheDir: caching ? cacheRoot : null, rhythmNorm,
      });
      if (outcome.status === "stored") return { status: "pass", reason: `stored${stats.eligible ? "" : " stub"}: ${outcome.claims} claims, ${outcome.sources} sources${outcome.english ? ", en" : ""}` };
      if (outcome.status === "duplicate") return { status: "pass", reason: "duplicate: already stored" };
      if (outcome.status === "not-eligible") return { status: "waiting", reason: outcome.detail ?? "not eligible" };
      return { status: "fail", reason: `${outcome.status}: ${("detail" in outcome ? outcome.detail : "") ?? ""}`.slice(0, 250) };
    };

    const started = Date.now();
    const summary = await runLedgerTopics({
      db, processTopic, chainAvailable: () => stub || chainHasCapacity(statePath, adapters),
      progress: (line) => { console.log(JSON.stringify(line)); logStage("topic", line.seconds * 1000, { topic: line.topic, result: line.result, modelCalls: line.modelCalls }); },
    }, {
      concurrency, maxArticles: option("max-articles") ? Number(option("max-articles")) : undefined,
      untilMs: option("until") ? parseUntil(option("until")!) : undefined, retryFailed: flag("retry-failed"),
    });
    console.log(JSON.stringify({ summary, concurrency, wallSeconds: Math.round((Date.now() - started) / 100) / 10, chain: resolveChainOrder(), defaultOrder: CHAIN_ORDER }));
  } finally {
    await dispose();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = error instanceof ChainExhaustedError ? 0 : 1;
  });
}
