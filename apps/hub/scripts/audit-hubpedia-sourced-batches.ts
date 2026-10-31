import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { verifyFactoryDrafts, type FactoryQualityDraft } from "../lib/encyclopedia/factory";
import { auditFactorySourcedRecord, factorySourcedRecordSchema, type FactorySourcedRecord } from "../lib/encyclopedia/factory-research";
import { buildRelatedSlugIndex } from "../lib/encyclopedia/structure-engine";
import { VIEWABLE_SEED_ARTICLES } from "../lib/encyclopedia/seed";

/*
 * Final gate for sourced-factory-*.bilingual.json seed batches: schema,
 * license policy, claim-citation integrity, bilingual reader-quality checks.
 * The factory driver runs this after packaging; it also works standalone.
 */

const hubDir = resolve(import.meta.dirname, "..");
const requestedFiles = process.argv.slice(2);
if (requestedFiles.length === 0) {
  throw new Error("Usage: tsx scripts/audit-hubpedia-sourced-batches.ts <batch.json> [...batch.json]");
}

const records: FactorySourcedRecord[] = requestedFiles.flatMap((path) => {
  const absolutePath = resolve(hubDir, path);
  if (!existsSync(absolutePath)) throw new Error(`Batch does not exist: ${path}`);
  const value: unknown = JSON.parse(readFileSync(absolutePath, "utf8"));
  if (!Array.isArray(value)) throw new Error(`Batch must be an array: ${path}`);
  return value.map((item) => factorySourcedRecordSchema.parse(item));
});

const issues: string[] = [];
const drafts: FactoryQualityDraft[] = [];
const sourcesBySlug = new Map<string, readonly unknown[]>();
for (const record of records) {
  issues.push(...auditFactorySourcedRecord(record));
  if (!record.translations?.en) {
    issues.push(`${record.slug}: packaged sourced record must carry an English translation.`);
    continue;
  }
  drafts.push({
    slug: record.slug,
    ja: { title: record.title, summary: record.summary, bodyMarkdown: record.bodyMarkdown, infobox: record.infobox },
    en: record.translations.en,
  });
  sourcesBySlug.set(record.slug, record.sources);
}

/* The batch being audited counts as existing, whether or not the generated
 * manifest has caught up with it. Reading link targets from the catalog alone
 * made this gate depend on a regeneration step running first, and when that
 * step lost a race with a parallel lane the batch's own members were reported
 * as missing targets — rejecting a batch for linking to itself. */
const allowedSlugs = new Set([
  ...VIEWABLE_SEED_ARTICLES.map((article) => article.slug),
  ...records.map((record) => record.slug),
]);
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
const verification = verifyFactoryDrafts(drafts, allowedSlugs, { sourcesBySlug, relatedSlugsBySlug });
issues.push(...verification.failed.flatMap((entry) => entry.issues));

if (issues.length) {
  for (const issue of issues) console.error(issue);
  throw new Error(`Sourced batch audit found ${issues.length} issue(s).`);
}

console.log(JSON.stringify({ files: requestedFiles.length, records: records.length, status: "ok" }));
