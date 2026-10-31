import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolveCacheNamespace } from "../lib/encyclopedia/ledger/cache-namespace";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { TERM_NET_CAPS } from "../lib/encyclopedia/term-net/config";
import { fileLinkCache, buildLexicon, linkClaimsBatch, LINKER_VERSION, type LinkLlm } from "../lib/encyclopedia/term-net/linker";
import { loadSnapshot } from "../lib/encyclopedia/term-net/load";
import { mergeSeedInputs, readSeedInputsFromDb, resolveSeeds, type SeedInput } from "../lib/encyclopedia/term-net/seeds";
import { assembleSnapshot, buildManifest, parseSnapshot, serializeSnapshot, traverse, type NetSeed, type SnapshotManifest } from "../lib/encyclopedia/term-net/snapshot";
import { createWikidataClient } from "../lib/encyclopedia/term-net/wikidata-client";

/*
 * Term net driver (docs/hubpedia-ledger.md section 11). Everything is a DRY RUN by default and the only files it
 * writes are under data/ledger/term-net/ (git-ignored). Nothing writes to D1 unless --apply is given AND
 * HUBPEDIA_LEDGER_ALLOW_D1_WRITE=1 is set; the owner's 2026-10-29 rule forbids any D1 write until it is lifted.
 *
 *   seed   collect seeds from code (and --from-db: SELECT only) -> seeds.json
 *   fetch  resolve seeds, then cache Wikidata responses     [--max-terms N] [--limit-seeds N] [--qids Q1,Q2,...]
 *   build  offline: cache -> snapshot-<date>.jsonl + manifest.json   [--date YYYYMMDD]
 *   link   claims -> terms (reads D1; writes with --apply)  [--limit N] [--llm]
 *   load   snapshot -> D1 tables (counts only without --apply)
 */

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, "..", "data", "ledger", "term-net");
const CACHE = join(ROOT, "cache");

const args = process.argv.slice(2);
const command = args[0];
const option = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const flag = (name: string) => args.includes(name);

const readJson = <T,>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;
const writeJson = (path: string, value: unknown) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`); };

function latestSnapshot(): { file: string; manifest: SnapshotManifest } {
  const manifestPath = join(ROOT, "manifest.json");
  if (!existsSync(manifestPath)) throw new Error("No manifest.json; run build first.");
  const manifest = readJson<SnapshotManifest>(manifestPath);
  return { file: join(ROOT, manifest.file), manifest };
}

async function seedCommand() {
  const { VIEWABLE_SEED_ARTICLES, HUBPEDIA_UNRESOLVED_LINK_TARGETS } = await import("../lib/encyclopedia/seed");
  const inputs: SeedInput[] = [];
  for (const article of VIEWABLE_SEED_ARTICLES) {
    const title = (article as { title?: string }).title ?? "";
    const cjk = /[぀-ヿ㐀-鿿]/u.test(title);
    inputs.push({ slug: article.slug, kind: "seed-article", labelJa: cjk ? title : null, labelEn: cjk ? null : title || null });
  }
  for (const entry of HUBPEDIA_UNRESOLVED_LINK_TARGETS) inputs.push({ slug: entry.target, kind: "unresolved-link" });
  if (flag("--from-db")) {
    const { openHubDatabase } = await import("./hubpedia-hub-db");
    const { db, dispose } = await openHubDatabase();
    try { inputs.push(...(await readSeedInputsFromDb(db))); } finally { await dispose(); }
  }
  const seeds = mergeSeedInputs(inputs);
  writeJson(join(ROOT, "seeds.json"), seeds);
  console.log(JSON.stringify({ seeds: seeds.length, fromDb: flag("--from-db") }));
}

async function fetchCommand() {
  const maxTerms = Number(option("--max-terms") ?? TERM_NET_CAPS.maxTerms);
  const client = createWikidataClient({ cacheDir: CACHE, minIntervalMs: Number(option("--min-interval") ?? 1000) });
  let matched: NetSeed[];
  let unmatched: unknown[] = [];
  if (option("--qids")) {
    matched = option("--qids")!.split(",").map((qid) => ({ slug: qid.toLowerCase(), qid: qid.trim(), kind: "topic" }));
  } else {
    let inputs = readJson<SeedInput[]>(join(ROOT, "seeds.json"));
    if (option("--limit-seeds")) inputs = inputs.slice(0, Number(option("--limit-seeds")));
    const resolved = await resolveSeeds(inputs, client);
    matched = resolved.matched;
    unmatched = resolved.unmatched;
  }
  writeJson(join(ROOT, "seeds.resolved.json"), { matched, unmatched });
  const raw = await traverse(client, matched, { maxTerms });
  console.log(JSON.stringify({ seeds: matched.length, unmatched: unmatched.length, discovered: raw.hops.size, stoppedAtCap: raw.stoppedAtCap, requests: client.stats.requests }));
}

async function buildCommand() {
  const { matched, unmatched } = readJson<{ matched: NetSeed[]; unmatched: Array<{ slug: string; reason: string }> }>(join(ROOT, "seeds.resolved.json"));
  const client = createWikidataClient({ cacheDir: CACHE, offline: true });
  const raw = await traverse(client, matched);
  const snapshot = assembleSnapshot(raw, { unmatchedSeeds: unmatched.map((u) => ({ slug: u.slug, reason: u.reason })) });
  const text = serializeSnapshot(snapshot.terms, snapshot.edges);
  const date = option("--date") ?? new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const file = `snapshot-${date}.jsonl`;
  writeFileSync(join(ROOT, file), text);
  const manifest = buildManifest({ file, retrievedAt: `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`, text, snapshot, stoppedAtCap: raw.stoppedAtCap });
  writeJson(join(ROOT, "manifest.json"), manifest);
  // The file is also an immutable object keyed by its hash when an object directory is given (--objects=<dir>).
  const { objectsDirectory } = await import("./hubpedia-hub-db");
  const directory = objectsDirectory();
  if (directory) {
    const [{ putTermNetSnapshot }, { fsObjectStore }] = await Promise.all([import("../lib/encyclopedia/ledger/object-store"), import("../lib/encyclopedia/ledger/object-store-fs")]);
    await putTermNetSnapshot(fsObjectStore(directory), text);
  }
  console.log(JSON.stringify({ file, terms: manifest.termCount, edges: manifest.edgeCount, sha256: manifest.sha256 }));
}

import { throwawaySqlitePath } from "./hubpedia-hub-db";
const hasThrowawaySqlite = () => throwawaySqlitePath() !== null;

function writeAllowed(apply: boolean) {
  if (apply && !hasThrowawaySqlite() && process.env.HUBPEDIA_LEDGER_ALLOW_D1_WRITE !== "1") {
    console.error("Refusing to write to D1: set HUBPEDIA_LEDGER_ALLOW_D1_WRITE=1 once D1 writes are allowed.");
    process.exitCode = 2;
    return false;
  }
  return true;
}

async function linkCommand() {
  const apply = flag("--apply");
  if (!writeAllowed(apply)) return;
  const { file, manifest } = latestSnapshot();
  const { terms, edges } = parseSnapshot(readFileSync(file, "utf8"));
  const lexicon = buildLexicon(terms, edges);
  let complete: LinkLlm | undefined;
  if (flag("--llm")) {
    const { completeViaChain, commandCodeAdapter, claudeCliAdapter, opencodeFreeAdapter, opencodeGoAdapter } = await import("../lib/encyclopedia/provider-chain");
    const statePath = resolve(here, "..", "data", "factory", ".hubpedia-provider-state.json");
    const adapters = [claudeCliAdapter(), opencodeFreeAdapter(), commandCodeAdapter(), opencodeGoAdapter()];
    complete = (call) => completeViaChain(call, { statePath, adapters });
  }
  const { openHubDatabase } = await import("./hubpedia-hub-db");
  const { db, objects, dispose } = await openHubDatabase();
  try {
    const summary = await linkClaimsBatch(db, {
      lexicon, objects, snapshotSha: manifest.sha256, complete, cache: fileLinkCache(join(ROOT, `linker-cache-${resolveCacheNamespace(option("--cache-namespace"))}.jsonl`)),
      apply, limit: Number(option("--limit") ?? 200),
    });
    console.log(JSON.stringify({ linkerVersion: LINKER_VERSION, ...summary }));
  } finally {
    await dispose();
  }
}

async function loadCommand() {
  const apply = flag("--apply");
  if (!writeAllowed(apply)) return;
  const { file, manifest } = latestSnapshot();
  const text = readFileSync(file, "utf8");
  const { HUBPEDIA_UNRESOLVED_LINK_TARGETS, VIEWABLE_SEED_ARTICLES } = await import("../lib/encyclopedia/seed");
  const { openHubDatabase } = await import("./hubpedia-hub-db");
  const { db, objects, dispose } = await openHubDatabase();
  try {
    // Keep the snapshot file as an object keyed by its hash (deduplicated); D1 records only the key and length.
    const { putTermNetSnapshot } = await import("../lib/encyclopedia/ledger/object-store");
    const stored = apply ? await putTermNetSnapshot(objects, text) : null;
    const submissions = new Map<string, number>();
    for (const row of (await db.prepare("SELECT slug, COUNT(*) AS n FROM hubpedia_topic_submissions WHERE status IN ('screened','queued') GROUP BY slug").all<{ slug: string; n: number }>()).results ?? []) submissions.set(row.slug, row.n);
    const articleSlugs = new Set<string>(VIEWABLE_SEED_ARTICLES.map((a) => a.slug));
    for (const row of (await db.prepare("SELECT slug FROM encyclopedia_articles WHERE current_revision_id IS NOT NULL AND status <> 'archived'").all<{ slug: string }>()).results ?? []) articleSlugs.add(row.slug);
    const report = await loadSnapshot(db, {
      text, manifest, object: stored ? { key: stored.key, bytes: stored.bytes } : undefined,
      demand: { unresolvedReferrers: new Map(HUBPEDIA_UNRESOLVED_LINK_TARGETS.map((e) => [e.target, e.referrers.length])), submissions, articleSlugs },
    }, { apply });
    console.log(JSON.stringify(report, null, 2));
    if (!apply) console.log("Dry run: no statement was executed. Re-run with --apply (and HUBPEDIA_LEDGER_ALLOW_D1_WRITE=1) once the owner approves.");
  } finally {
    await dispose();
  }
}

async function main() {
  if (command === "seed" || command === "load" || command === "link") {
    const { reexecWithServerOnlyStub } = await import("./hubpedia-hub-db");
    if (reexecWithServerOnlyStub()) return;
  }
  switch (command) {
    case "seed": return seedCommand();
    case "fetch": return fetchCommand();
    case "build": return buildCommand();
    case "link": return linkCommand();
    case "load": return loadCommand();
    default:
      console.error("usage: hubpedia-term-net.ts seed|fetch|build|link|load [options]");
      process.exitCode = 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}

