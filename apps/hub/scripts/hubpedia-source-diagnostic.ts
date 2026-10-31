/*
 * Read-only per-topic source-yield diagnostic for a finished research run.
 * No network, no model calls: it joins the plan with the run directory's
 * chunks.json, claims.candidates.jsonl and claims.json and prints how many
 * candidates survive each stage, so the largest loss stage is measured
 * rather than guessed.
 *
 * Usage: tsx scripts/hubpedia-source-diagnostic.ts --plan=<plan.json> --run=<runDir>
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { assessEvidenceSufficiency, factoryResearchPlanSchema, gateResearchPlan, type VerifiedFactoryClaim } from "../lib/encyclopedia/factory-research";

function option(name: string) {
  return process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
}

const planPath = option("plan");
const runDir = option("run");
if (!planPath || !runDir) throw new Error("Usage: tsx scripts/hubpedia-source-diagnostic.ts --plan=<plan.json> --run=<runDir>");

const gate = gateResearchPlan(factoryResearchPlanSchema.parse(JSON.parse(readFileSync(resolve(planPath), "utf8"))));
const pages = new Map<string, { chunks: Array<{ textContent: string }>; fetchError: string | null }>();
for (const entry of JSON.parse(readFileSync(resolve(runDir, "chunks.json"), "utf8")) as Array<{ url: string; chunks: Array<{ textContent: string }>; fetchError: string | null }>) {
  pages.set(entry.url, entry);
}
const rawBySlug = new Map<string, number>();
const candidatesPath = resolve(runDir, "claims.candidates.jsonl");
if (existsSync(candidatesPath)) {
  for (const line of readFileSync(candidatesPath, "utf8").split(/\r?\n/).filter(Boolean)) {
    try {
      const record = JSON.parse(line) as { slug: string; output?: { claims?: unknown[] } };
      const topic = /^(.+)-claims-\d+$/.exec(record.slug)?.[1];
      if (topic) rawBySlug.set(topic, (rawBySlug.get(topic) ?? 0) + (record.output?.claims?.length ?? 0));
    } catch { /* unreadable line: ignore */ }
  }
}
const verified = new Map<string, VerifiedFactoryClaim[]>();
for (const entry of JSON.parse(readFileSync(resolve(runDir, "claims.json"), "utf8")) as Array<{ slug: string; claims: Array<{ statement: string; confidence: number; evidence: Array<{ chunkId: string; quote: string; sourceUrl: string; sourceTitle: string }> }> }>) {
  verified.set(entry.slug, entry.claims);
}

const rows = gate.accepted.filter((entry) => verified.has(entry.topic.slug) || rawBySlug.has(entry.topic.slug)).map((entry) => {
  const slug = entry.topic.slug;
  const claims = verified.get(slug) ?? [];
  const perSource = entry.approvedSources.map((source) => {
    const page = pages.get(source.url);
    return {
      url: source.url,
      fetched: Boolean(page && !page.fetchError),
      chars: page?.chunks.reduce((sum, chunk) => sum + chunk.textContent.length, 0) ?? 0,
      chunks: page?.chunks.length ?? 0,
      claims: claims.filter((claim) => claim.evidence.some((item) => item.sourceUrl === source.url)).length,
    };
  });
  const sufficiency = assessEvidenceSufficiency(claims);
  return {
    slug,
    planned: entry.topic.sources.length,
    licenceOk: entry.approvedSources.length,
    fetchedOk: perSource.filter((source) => source.fetched).length,
    withChunks: perSource.filter((source) => source.chunks > 0).length,
    chunks: perSource.reduce((sum, source) => sum + source.chunks, 0),
    rawClaims: rawBySlug.get(slug) ?? null,
    verifiedClaims: claims.length,
    sourcesWithClaims: sufficiency.sourcesWithClaims,
    pass: sufficiency.sufficient,
    perSource,
  };
});
console.log(JSON.stringify(rows, null, 1));
console.table(rows.map(({ perSource: _perSource, ...row }) => row));
console.log(`pass ${rows.filter((row) => row.pass).length}/${rows.length}`);
