import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildFactoryTranslationJobs,
  collectFactoryCandidates,
  unwrapUnresolvableInternalLinks,
  verifyFactoryDrafts,
  verifyFactoryDraftsToFixedPoint,
  type FactoryQualityDraft,
} from "../lib/encyclopedia/factory";
import { factoryUnsourcedRecordSchema, type FactoryUnsourcedRecord } from "../lib/encyclopedia/factory-research";
import {
  assembleUnsourcedRecord,
  auditUnsourcedRecord,
  gateUnsourcedPlan,
  planUnsourcedArticleJob,
  unsourcedPlanSchema,
} from "../lib/encyclopedia/factory-unsourced";
import { VIEWABLE_SEED_ARTICLES } from "../lib/encyclopedia/seed";
import { buildRelatedSlugIndex } from "../lib/encyclopedia/structure-engine";

/*
 * Source-free explanations, produced and packaged into their own tier.
 *
 * A separate entry point rather than another branch of the research driver:
 * the two share the assembly and verification helpers but nothing of their
 * evidence handling, and keeping them apart means no future edit can let a
 * source-free article inherit the sourced path's citation machinery.
 *
 * The eligibility gate runs before generation, and again on the finished
 * article. Everything that reaches the seed carries a notice and lands in the
 * unsourced collection, which is excluded from the reader-ready set.
 */

const scriptDir = dirname(fileURLToPath(import.meta.url));
const hubDir = resolve(scriptDir, "..");

export interface UnsourcedModeOptions {
  planPath: string;
  batch: string;
  runDir: string;
  limit: number;
  dryRun: boolean;
  noPackage: boolean;
  generate: (jobsPath: string, outputPath: string, jobCount: number, extraArgs?: string[]) => { exitCode: number };
  runScript: (script: string, args: string[], label: string) => { exitCode: number };
}

function readIfPresent(path: string) {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

export async function runUnsourcedMode(options: UnsourcedModeOptions) {
  const plan = unsourcedPlanSchema.parse(JSON.parse(readFileSync(resolve(options.planPath), "utf8")));
  const gate = gateUnsourcedPlan(plan);
  const topics = gate.accepted.slice(0, options.limit);
  mkdirSync(options.runDir, { recursive: true });

  const batchTargets = topics.map((entry) => ({ slug: entry.slug, title: entry.title }));
  const linkTargets = [
    ...VIEWABLE_SEED_ARTICLES.map((article) => ({ slug: article.slug, title: article.title })),
    ...batchTargets,
  ];
  const allowedTargets = new Map<string, string>(linkTargets.map((target) => [target.slug, target.title]));
  const catalogSlugs = new Set(linkTargets.map((target) => target.slug));

  const planSummary = {
    batch: options.batch,
    runDir: options.runDir,
    mode: "unsourced",
    plannedTopics: plan.topics.length,
    eligibleTopics: topics.map((entry) => entry.slug),
    /* Recorded, not merely counted: a refusal is a judgement about the
     * subject that whoever plans topics next needs to see. */
    refused: gate.rejected,
  };
  console.log(JSON.stringify({ stage: "unsourced-plan", ...planSummary }, null, 2));
  if (options.dryRun || !topics.length) return;

  const failures: string[] = [];
  const articleJobs = topics.map((entry) => planUnsourcedArticleJob(entry, linkTargets));
  const articleJobsPath = join(options.runDir, "unsourced-article.jobs.json");
  const articleCandidatesPath = join(options.runDir, "unsourced-article.candidates.jsonl");
  writeFileSync(articleJobsPath, `${JSON.stringify({ version: 1, mode: "expand", jobs: articleJobs }, null, 2)}\n`, "utf8");
  if (options.generate(articleJobsPath, articleCandidatesPath, articleJobs.length, ["--max-tokens=8192"]).exitCode !== 0) {
    failures.push("Some unsourced-article jobs failed; rerun the same command to resume them.");
  }

  const drafted = collectFactoryCandidates([readIfPresent(articleCandidatesPath)]);
  const records: FactoryUnsourcedRecord[] = [];
  const assemblyFailures: Array<{ slug: string; issues: string[] }> = [];
  for (const entry of topics) {
    const draft = drafted.expanded.get(entry.slug);
    if (!draft) continue;
    try {
      records.push(assembleUnsourcedRecord({
        topic: entry,
        draft,
        allowedTargets,
        eligibility: "Subject is carried by explanation rather than by verifiable particulars.",
      }));
    } catch (error) {
      assemblyFailures.push({ slug: entry.slug, issues: [error instanceof Error ? error.message : "assembly failed"] });
    }
  }

  const followUp = buildFactoryTranslationJobs(records.map((record) => ({
    slug: record.slug,
    ja: { title: record.title, summary: record.summary, bodyMarkdown: record.bodyMarkdown },
  })));
  const followUpJobsPath = join(options.runDir, "unsourced-translate.jobs.json");
  const followUpCandidatesPath = join(options.runDir, "unsourced-translate.candidates.jsonl");
  writeFileSync(followUpJobsPath, `${JSON.stringify(followUp, null, 2)}\n`, "utf8");
  if (options.generate(followUpJobsPath, followUpCandidatesPath, followUp.jobs.length, ["--max-tokens=8192"]).exitCode !== 0) {
    failures.push("Some unsourced translation jobs failed; rerun the same command to resume them.");
  }
  const translated = collectFactoryCandidates([readIfPresent(followUpCandidatesPath)]);
  for (const record of records) {
    const english = translated.translations.get(record.slug);
    if (english) record.translations = { en: english };
  }

  const drafts: FactoryQualityDraft[] = [];
  const recordIssues = new Map<string, string[]>();
  for (const record of records) {
    const issues = auditUnsourcedRecord(record);
    if (!record.translations?.en) issues.push(`${record.slug}: English translation is not available yet.`);
    if (issues.length) {
      recordIssues.set(record.slug, issues);
      continue;
    }
    drafts.push({
      slug: record.slug,
      ja: { title: record.title, summary: record.summary, bodyMarkdown: record.bodyMarkdown },
      en: record.translations!.en,
    });
  }

  const relatedSlugsBySlug = buildRelatedSlugIndex([
    ...VIEWABLE_SEED_ARTICLES,
    ...records.map((record) => ({
      slug: record.slug,
      title: record.title,
      summary: record.summary,
      bodyMarkdown: record.bodyMarkdown,
      topicType: record.topicType,
      categoryLabel: record.categoryLabel,
    })),
  ]);
  /* Same fixed point as the sourced path: a closed cluster of concepts that
   * all link to each other collapses under a single removal pass. */
  const verification = verifyFactoryDraftsToFixedPoint(drafts, catalogSlugs, { relatedSlugsBySlug });
  const survivingSlugs = new Set([
    ...VIEWABLE_SEED_ARTICLES.map((article) => article.slug),
    ...verification.passed.map((draft) => draft.slug),
  ]);
  for (const record of records) {
    const draft = verification.passed.find((entry) => entry.slug === record.slug);
    if (!draft) continue;
    record.bodyMarkdown = unwrapUnresolvableInternalLinks(record.bodyMarkdown, survivingSlugs);
    if (record.translations?.en) {
      record.translations = { en: { ...record.translations.en, bodyMarkdown: unwrapUnresolvableInternalLinks(record.translations.en.bodyMarkdown, survivingSlugs) } };
    }
  }

  const passedRecords = records.filter((record) => verification.passed.some((draft) => draft.slug === record.slug));

  const report = {
    stage: "unsourced-report",
    ...planSummary,
    generationFailures: failures,
    candidateErrors: [...drafted.errors, ...translated.errors],
    assembled: records.length,
    passed: passedRecords.map((record) => record.slug),
    failed: [
      ...assemblyFailures,
      ...[...recordIssues.entries()].map(([slug, issues]) => ({ slug, issues })),
      ...verification.failed,
    ],
    packagedFile: null as string | null,
    publication: "Unsourced tier: carries a notice, never reader-ready on its own, and publication approval stays manual in publication-manifest.ts.",
  };
  writeFileSync(join(options.runDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");

  if (!options.noPackage && passedRecords.length) {
    const batchFileName = `unsourced-factory-${options.batch}.bilingual.json`;
    const batchPath = join(hubDir, "lib", "encyclopedia", "seed", batchFileName);
    writeFileSync(batchPath, `${JSON.stringify(passedRecords.map((record) => factoryUnsourcedRecordSchema.parse(record)), null, 2)}\n`, "utf8");
    options.runScript("scripts/generate-hubpedia-quality-manifest.mjs", [], "manifest");
    report.packagedFile = `lib/encyclopedia/seed/${batchFileName}`;
    writeFileSync(join(options.runDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }

  console.log(JSON.stringify(report, null, 2));
  if (failures.length) process.exitCode = 1;
}
