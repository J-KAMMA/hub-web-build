import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ChainExhaustedError, FilePendingError, commandCodeAdapter, claudeCliAdapter, opencodeFreeAdapter, opencodeGoAdapter } from "../lib/encyclopedia/provider-chain";
import { ledgerCacheRoot, resolveCacheNamespace } from "../lib/encyclopedia/ledger/cache-namespace";
import { chainJudge, dedupeTopic } from "../lib/encyclopedia/ledger/dedupe";
import {
  chainComplete, finishPipelineRun, getLedgerPoolTopicId, jsonFileCache, prescreenSources, runExtraction, startPipelineRun, summarizeSources,
} from "../lib/encyclopedia/ledger/extract";
import { timed } from "../lib/encyclopedia/ledger/stage-log";
import { buildHeadwordIndex, recomputeTopicStats, topicsOfClaims } from "../lib/encyclopedia/ledger/topics";
import { openHubDatabase, reexecWithServerOnlyStub } from "./hubpedia-hub-db";

/*
 * Claim ledger, S4-S6, against the LOCAL Wrangler D1 (wrangler.dev.jsonc only). Never a remote database.
 * This writes to the local D1: run it only when the owner has allowed ledger writes, or point it at a
 * throwaway SQLite file with --sqlite=<file>.
 *
 *   npx tsx scripts/hubpedia-ledger-claims.ts [--max-chunks N] [--max-judgements N] [--prescreen-only] [--cache-namespace NAME]
 *
 * Model answers are cached under data/ledger/cache/<namespace>/. The namespace defaults to "chain", or to
 * "file-<dir>" when HUBPEDIA_FILE_PROVIDER_DIR is set, so one provider's or trial's answers are not reused as another's.
 *
 * Resumable: rerun the same command. A paused or exhausted provider chain ends the run normally.
 */

const scriptDir = dirname(fileURLToPath(import.meta.url));
const hubDir = resolve(scriptDir, "..");
const arg = (name: string) => {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? process.argv[at + 1] : undefined;
};
const flag = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  const { db, objects, dispose } = await openHubDatabase();
  try {
    const namespace = resolveCacheNamespace(arg("cache-namespace"));
    const cacheRoot = ledgerCacheRoot(resolve(hubDir, "data", "ledger", "cache"), namespace);
    console.log("cache", cacheRoot);
    const chain = {
      statePath: resolve(hubDir, "data", "factory", ".hubpedia-provider-state.json"),
      adapters: [claudeCliAdapter(), opencodeFreeAdapter(), commandCodeAdapter(), opencodeGoAdapter()],
    };
    const run = await startPipelineRun(db, {
      runType: "ledger_claims",
      idempotencyKey: `ledger-claims:local:${new Date().toISOString()}:ledger-extract-v1`,
      input: { maxChunks: arg("max-chunks") ?? null },
    });

    let prescreenAfter = "";
    const prescreen = { sources: 0, pending: 0, skipped: 0, inherited: 0, disallowedSources: 0 };
    for (;;) {
      const part = await timed("prescreen", () => prescreenSources(db, { afterSourceId: prescreenAfter, objects }));
      if (!part.sources) break;
      prescreen.sources += part.sources; prescreen.pending += part.pending; prescreen.skipped += part.skipped;
      prescreen.inherited += part.inherited; prescreen.disallowedSources += part.disallowedSources;
      prescreenAfter = part.nextAfterSourceId ?? "";
    }
    console.log("prescreen", prescreen);
    if (flag("prescreen-only")) { await finishPipelineRun(db, run, "succeeded", { prescreen }); return; }

    const { results: topicRows } = await db.prepare(
      "SELECT id, canonical_name AS name FROM encyclopedia_topics WHERE topic_type <> 'ledger-pool' AND status <> 'archived'",
    ).all<{ id: string; name: string }>();
    const extraction = await runExtraction({
      db, complete: chainComplete(chain, resolve(cacheRoot, "extract")), poolTopicId: await getLedgerPoolTopicId(db),
      headwords: buildHeadwordIndex(topicRows), runId: run.id, objects,
    }, { maxChunks: arg("max-chunks") ? Number(arg("max-chunks")) : undefined });

    // --all-topics re-runs the (idempotent) dedupe over every topic, e.g. after file-provider judge answers arrive.
    const topics = flag("all-topics") ? topicRows.map((row) => row.id) : await topicsOfClaims(db, extraction.claimIds);
    let merged = 0;
    let stoppedInJudge = false;
    const judge = chainJudge(chain, jsonFileCache(resolve(cacheRoot, "judge")));
    for (const topicId of topics) {
      try {
        const result = await timed("dedupe", () => dedupeTopic(db, topicId, { judge, maxJudgements: arg("max-judgements") ? Number(arg("max-judgements")) : 200 }));
        merged += result.merged;
      } catch (error) {
        if (error instanceof FilePendingError) { stoppedInJudge = true; continue; } // request written; try the next topic
        if (!(error instanceof ChainExhaustedError)) throw error;
        stoppedInJudge = true;
        break;
      }
    }
    const affected = await topicsOfClaims(db, extraction.claimIds);
    await timed("stats", () => recomputeTopicStats(db, new Set([...topics, ...affected])));
    const sources = await summarizeSources(db);
    const zeroClaimSources = sources.filter((source) => source.zeroClaims).map((source) => source.url);
    const output = { prescreen, extraction: { ...extraction, claimIds: extraction.claimIds.length }, merged, stoppedInJudge, zeroClaimSources };
    await finishPipelineRun(db, run, "succeeded", output);
    console.log(JSON.stringify(output, null, 2));
    // Large bulk writes are followed by one ANALYZE (docs section 1).
    await db.prepare("ANALYZE").run();
  } finally {
    await dispose();
  }
}

if (!reexecWithServerOnlyStub()) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
