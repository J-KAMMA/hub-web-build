import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { articleDraftSchema } from "../lib/encyclopedia/article-draft";
import {
  assembleFactorySourcedRecord,
  auditFactorySourcedRecord,
  factoryResearchPlanSchema,
} from "../lib/encyclopedia/factory-research";
import { VIEWABLE_SEED_ARTICLES } from "../lib/encyclopedia/seed";

/*
 * Scores one candidate article draft against the gates it would meet in a real
 * run, without running one.
 *
 * A draft is not judged by how it reads. It has to parse as the draft
 * contract, cite only claims the run actually verified, and survive the
 * sourced-record audit — the same three that decide whether a batch reaches
 * the catalog. That makes the output comparable across whoever or whatever
 * wrote it, which is the point: a second writer is worth using only if its
 * drafts clear the same bar.
 *
 *   npm run hubpedia:score -- --batch=batch-n1-cell --slug=telomere \
 *     --draft=data/factory/batch-n1-cell/codex-telomere.json
 */

const hubDir = resolve(import.meta.dirname, "..");

function option(name: string) {
  return process.argv.find((argument) => argument.startsWith(`--${name}=`))?.slice(name.length + 3);
}

const batch = option("batch");
const slug = option("slug");
const draftPath = option("draft");
if (!batch || !slug || !draftPath) {
  throw new Error("Usage: tsx scripts/score-sourced-article-draft.ts --batch=name --slug=topic --draft=draft.json");
}

const runDir = resolve(hubDir, "data", "factory", batch);
const claimsPath = resolve(runDir, "claims.json");
const planPath = resolve(hubDir, "data", "factory", "plans", `${batch}.plan.json`);
for (const path of [claimsPath, planPath, resolve(hubDir, draftPath)]) {
  if (!existsSync(path)) throw new Error(`Missing input: ${path}`);
}

const claimsByTopic = JSON.parse(readFileSync(claimsPath, "utf8")) as Array<{ slug: string; claims: unknown[] }>;
const claims = claimsByTopic.find((entry) => entry.slug === slug)?.claims;
if (!claims?.length) throw new Error(`No verified claims recorded for ${slug} in ${claimsPath}`);

const plan = factoryResearchPlanSchema.parse(JSON.parse(readFileSync(planPath, "utf8")));
const topic = plan.topics.find((entry) => entry.slug === slug);
if (!topic) throw new Error(`${slug} is not in ${planPath}`);

/* The draft file may be the raw contract object or a candidate JSONL line
 * carrying it under "output"; both are what a writer actually produces. */
const raw: unknown = JSON.parse(readFileSync(resolve(hubDir, draftPath), "utf8"));
const candidate = raw && typeof raw === "object" && "output" in raw ? (raw as { output: unknown }).output : raw;

const parsed = articleDraftSchema.safeParse(candidate);
if (!parsed.success) {
  console.log(JSON.stringify({
    slug,
    stage: "contract",
    ok: false,
    issues: parsed.error.issues.slice(0, 10).map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`),
  }, null, 2));
  process.exit(1);
}

const allowedTargets = new Map<string, string>(VIEWABLE_SEED_ARTICLES.map((article) => [article.slug, article.title]));
let record;
try {
  record = assembleFactorySourcedRecord({
    topic,
    approvedSources: topic.sources,
    claims: claims as never,
    draft: parsed.data,
    allowedTargets,
  });
} catch (error) {
  console.log(JSON.stringify({
    slug,
    stage: "assemble",
    ok: false,
    issues: [error instanceof Error ? error.message : "assembly failed"],
  }, null, 2));
  process.exit(1);
}

const issues = auditFactorySourcedRecord(record);
console.log(JSON.stringify({
  slug,
  stage: issues.length ? "audit" : "passed",
  ok: issues.length === 0,
  issues,
  japaneseCharacters: record.bodyMarkdown.length,
  sections: (record.bodyMarkdown.match(/^## /gmu) ?? []).length,
  citedClaims: record.provenance.claims.length,
  availableClaims: claims.length,
  sourcesUsed: record.sources.length,
}, null, 2));
if (issues.length) process.exit(1);
