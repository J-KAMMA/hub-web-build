import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { auditFactoryQualityDrafts, type FactoryQualityDraft } from "../lib/encyclopedia/factory";
import { VIEWABLE_SEED_ARTICLES } from "../lib/encyclopedia/seed";

const hubDir = resolve(import.meta.dirname, "..");
const requestedFiles = process.argv.slice(2);
if (requestedFiles.length === 0) {
  throw new Error("Usage: tsx scripts/audit-hubpedia-quality-batches.ts <batch.json> [...batch.json]");
}

function parseBatch(path: string): FactoryQualityDraft[] {
  const absolutePath = resolve(hubDir, path);
  if (!existsSync(absolutePath)) throw new Error(`Batch does not exist: ${path}`);
  const value: unknown = JSON.parse(readFileSync(absolutePath, "utf8"));
  if (!Array.isArray(value)) throw new Error(`Batch must be an array: ${path}`);
  return value.map((item, index) => {
    if (!item || typeof item !== "object") throw new Error(`${path}[${index}] must be an object.`);
    const draft = item as Partial<FactoryQualityDraft>;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(draft.slug ?? "")) throw new Error(`${path}[${index}] has an invalid slug.`);
    for (const locale of ["ja", "en"] as const) {
      const localized = draft[locale];
      if (!localized?.title?.trim() || !localized.summary?.trim() || !localized.bodyMarkdown?.trim()) {
        throw new Error(`${draft.slug}:${locale} is incomplete.`);
      }
    }
    return draft as FactoryQualityDraft;
  });
}

const drafts = requestedFiles.flatMap(parseBatch);
const allowedSlugs = new Set(VIEWABLE_SEED_ARTICLES.map((article) => article.slug));
const issues = auditFactoryQualityDrafts(drafts, allowedSlugs);
if (issues.length) {
  for (const issue of issues) console.error(issue);
  throw new Error(`Quality batch audit found ${issues.length} issue(s).`);
}

console.log(JSON.stringify({ files: requestedFiles.length, articles: drafts.length, status: "ok" }));
