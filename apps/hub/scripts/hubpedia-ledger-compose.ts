import { resolve } from "node:path";
import { ledgerCacheRoot, resolveCacheNamespace } from "../lib/encyclopedia/ledger/cache-namespace";
import { fileURLToPath } from "node:url";

import type { D1Database } from "@cloudflare/workers-types";

import { canonicalHubpediaSlug } from "../lib/encyclopedia/article-aliases";
import { auditFactoryLocalizedDraft } from "../lib/encyclopedia/factory";
import { assessArticleQuality } from "../lib/encyclopedia/article-quality-engine";
import {
  ChainExhaustedError, FilePendingError, commandCodeAdapter, completeViaChain, claudeCliAdapter, opencodeFreeAdapter, opencodeGoAdapter,
} from "../lib/encyclopedia/provider-chain";
import {
  COMPOSE_PROMPT_VERSION, TRANSLATE_PROMPT_VERSION, composeBody, computeComposeKey, deriveSummary, loadRhythmNorm,
  sha256, translateBodyOrNull, type Complete,
} from "../lib/encyclopedia/ledger/compose";
import { timed } from "../lib/encyclopedia/ledger/stage-log";
import { loadAllowedLinks } from "../lib/encyclopedia/term-net/neighbours";
import type { LedgerObjectStore } from "../lib/encyclopedia/ledger/object-store";
import { renderLedgerMarkdown } from "../lib/encyclopedia/ledger/render";
import { loadTopicClaims, selectEligibleTopics, usableClaims, type LedgerTopic } from "../lib/encyclopedia/ledger/select";
import { LEDGER_STUB_FLOOR } from "../lib/encyclopedia/ledger/topics";
import { checkLedgerArticle, stripMarkers } from "../lib/encyclopedia/ledger/sentence-check";
import {
  beginComposeRun, findRevisionByComposeKey, finishComposeRun, recordAiCall, storeLedgerArticle,
} from "../lib/encyclopedia/ledger/store";

/*
 * Lane C driver (S7-S11). DRY RUN BY DEFAULT: it composes and checks, and prints what it would store. It writes
 * to D1 only with --write, and the owner's 2026-10-29 rule is that nothing may write to any D1 (local included),
 * so --write must not be used until that rule is lifted. Reading and calling the provider chain do not write.
 *
 *   tsx scripts/hubpedia-ledger-compose.ts [--limit N] [--after TOPIC_ID] [--model NAME] [--write]
 */

/** A stub is about 600 Japanese characters; the writer is asked for that, and anything past this many plain characters is cut at a block boundary. */
export const STUB_BODY_CAP = 800;

/** Keeps whole blocks (split at blank lines) while the plain text fits the cap; always keeps the lead block; drops a trailing heading. */
export function capStubBody(markdown: string, cap = STUB_BODY_CAP): string {
  const blocks = markdown.split(/\n{2,}/u);
  const kept: string[] = [];
  let length = 0;
  for (const block of blocks) {
    const size = stripMarkers(block).replace(/\s+/gu, "").length;
    if (kept.length > 0 && length + size > cap) break;
    kept.push(block);
    length += size;
  }
  while (kept.length > 1 && /^#{1,6}\s/u.test(kept[kept.length - 1].trim())) kept.pop();
  return kept.join("\n\n");
}

export type ComposeOutcome =
  | { topic: string; status: "stored" | "would-store"; claims: number; sources: number; dropped: number; english: boolean }
  | { topic: string; status: "duplicate" | "skipped" | "not-eligible" | "failed-audit" | "insufficient-after-check"; detail?: string };

export async function composeTopic(
  db: D1Database,
  topic: LedgerTopic,
  deps: { complete: Complete; model: string; allowedSlugs: ReadonlySet<string>; /** Net neighbours with an article, with titles (term-net/neighbours). */ links?: ReadonlyArray<{ slug: string; title: string }>; cacheDir: string | null; rhythmNorm: string; write: boolean; objects?: LedgerObjectStore },
): Promise<ComposeOutcome> {
  const given = usableClaims(await timed("select", () => loadTopicClaims(db, topic.id, undefined, deps.objects)));
  const refs = given.map((claim) => claim.ledgerRef);
  const stub = topic.stub === true;
  const floor = stub ? LEDGER_STUB_FLOOR : undefined;
  if (given.length < (stub ? LEDGER_STUB_FLOOR.minimumClaims : 8)) return { topic: topic.slug, status: "not-eligible", detail: `${given.length} usable claims` };
  const composeKey = computeComposeKey({ topicId: topic.id, ledgerRefs: refs, promptVersion: COMPOSE_PROMPT_VERSION, model: deps.model, stub });
  if (await findRevisionByComposeKey(db, topic.id, composeKey)) return { topic: topic.slug, status: "duplicate" };

  const composed = await timed("compose", () => composeBody({
    title: topic.canonicalName, claims: given, rhythmNorm: deps.rhythmNorm, complete: deps.complete,
    allowedLinks: (deps.links ?? [...deps.allowedSlugs].map((slug) => ({ slug, title: slug }))).filter((link) => link.slug !== topic.slug).slice(0, 40),
    cacheDir: deps.cacheDir, composeKey, stub,
  }));

  /* Reload: the check judges the claims as they are now, not as they were when the writer was prompted. */
  const fresh = new Map((await loadTopicClaims(db, topic.id, undefined, deps.objects)).map((claim) => [claim.ledgerRef, claim]));
  const checked = await timed("sentence-check", async () => checkLedgerArticle(
    { bodyMarkdown: stub ? capStubBody(composed.response.bodyMarkdown) : composed.response.bodyMarkdown, infobox: composed.response.infobox },
    { claims: fresh, allowedRefs: new Set(refs) },
    floor,
  ));
  if (!checked.storable) return { topic: topic.slug, status: "insufficient-after-check", detail: checked.reasons.join(" ") };

  const summary = deriveSummary(checked.body);
  const plainBody = stripMarkers(checked.body);
  const issues = auditFactoryLocalizedDraft(topic.slug, "ja", { title: topic.canonicalName, summary, bodyMarkdown: plainBody }, deps.allowedSlugs);
  if (issues.length) return { topic: topic.slug, status: "failed-audit", detail: issues.join(" | ") };

  const cited = checked.citedRefs.map((ref) => fresh.get(ref)!);
  const rendered = renderLedgerMarkdown(checked.body, cited);
  const quality = assessArticleQuality({ title: topic.canonicalName, summary, bodyMarkdown: rendered.markdownWithSources, sources: rendered.sources });

  const translated = await timed("translate", () => translateBodyOrNull({
    title: topic.canonicalName, checkedBody: checked.body, complete: deps.complete, cacheDir: deps.cacheDir, cacheKey: sha256(`${composeKey}:${TRANSLATE_PROMPT_VERSION}`),
  }));
  const english = translated ? { title: translated.title, summary: deriveSummary(translated.bodyMarkdown), bodyMarkdown: translated.bodyMarkdown } : null;

  const droppedByRule: Record<string, number> = {};
  for (const unit of checked.dropped) droppedByRule[String(unit.rule)] = (droppedByRule[String(unit.rule)] ?? 0) + 1;
  const summaryLine = { claims: checked.citedRefs.length, sources: checked.sourceUrls.length, dropped: checked.dropped.length, english: Boolean(english) };
  if (!deps.write) return { topic: topic.slug, status: "would-store", ...summaryLine };

  const run = await beginComposeRun(db, { topicId: topic.id, composeKey, promptVersion: COMPOSE_PROMPT_VERSION });
  if (run.state === "done") return { topic: topic.slug, status: "duplicate" };
  await recordAiCall(db, { runId: run.runId, provider: composed.servedBy, model: deps.model, purpose: "ledger-compose", totalTokens: composed.tokens, status: "succeeded" });
  const result = await timed("store", () => storeLedgerArticle(db, {
    topic, title: topic.canonicalName, summary, bodyMarkdown: checked.body, infobox: checked.infobox, citedClaims: cited,
    composeKey, stub, promptVersion: COMPOSE_PROMPT_VERSION, model: deps.model, servedBy: composed.servedBy, runId: run.runId,
    droppedByRule, quality: { score: quality.score, publishable: quality.publishable }, english,
  }));
  await finishComposeRun(db, run.runId, { status: "succeeded", output: { result: result.status } });
  if (result.status !== "stored") return { topic: topic.slug, status: result.status === "duplicate" ? "duplicate" : "skipped", detail: result.status === "skipped" ? result.reason : undefined };
  return { topic: topic.slug, status: "stored", ...summaryLine };
}

async function main() {
  const { reexecWithServerOnlyStub, openHubDatabase, throwawaySqlitePath } = await import("./hubpedia-hub-db");
  if (reexecWithServerOnlyStub()) return;
  const args = process.argv.slice(2);
  const option = (name: string) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
  const write = args.includes("--write");
  if (write && !throwawaySqlitePath()) throw new Error("--write is disabled for D1 (owner rule); use --sqlite=<throwaway file>.");
  const model = option("--model") ?? "chain";
  const adapters = [claudeCliAdapter(), opencodeFreeAdapter(), commandCodeAdapter(), opencodeGoAdapter()];
  const statePath = resolve(__dirname_(), "..", "data", "factory", ".hubpedia-provider-state.json");
  const complete: Complete = (call) => completeViaChain(call, { statePath, adapters });
  const { db, objects, dispose } = await openHubDatabase();
  try {
    const selection = await selectEligibleTopics(db, { limit: Number(option("--limit") ?? 5), afterTopicId: option("--after"), includeStubs: true });
    const { VIEWABLE_SEED_ARTICLES } = await import("../lib/encyclopedia/seed");
    const seedArticleSlugs = new Set<string>(VIEWABLE_SEED_ARTICLES.map((article) => article.slug));
    for (const topic of selection.topics) {
      try {
        /* Internal links: only terms joined to this one by a net edge that already have an article (section 4). */
        const links = await loadAllowedLinks(db, topic.id, { seedArticleSlugs });
        const outcome = await composeTopic(db, topic, {
          complete, model, links, objects, allowedSlugs: new Set(links.map((link) => canonicalHubpediaSlug(link.slug))), write,
          cacheDir: ledgerCacheRoot(resolve(__dirname_(), "..", "data", "ledger", "cache"), resolveCacheNamespace(option("--cache-namespace"))), rhythmNorm: loadRhythmNorm(resolve(__dirname_(), "..")),
        });
        console.log(JSON.stringify(outcome));
      } catch (error) {
        if (error instanceof FilePendingError) { console.log(JSON.stringify({ topic: topic.slug, status: "file-pending", hash: error.requestHash })); continue; }
        if (error instanceof ChainExhaustedError) { console.log(JSON.stringify({ topic: topic.slug, status: "paused", detail: "providers exhausted; rerun later" })); break; }
        throw error;
      }
    }
    console.log(JSON.stringify({ nextCursor: selection.nextCursor, skippedProtected: selection.skippedProtected }));
  } finally {
    await dispose();
  }
}

function __dirname_() { return resolve(fileURLToPath(import.meta.url), ".."); }

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
