import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { auditCatalog } from "../lib/encyclopedia/catalog-audit";
import { createArticleExpansionFrame, createTranslationFrame } from "../lib/encyclopedia/generation-frame";
import { VIEWABLE_SEED_ARTICLES } from "../lib/encyclopedia/seed";

const mode = process.argv[2];
const outputArg = process.argv.find((argument) => argument.startsWith("--output="))?.slice("--output=".length);
const countOnly = process.argv.includes("--count-only");
if (mode !== "expand" && mode !== "translate-en") {
  throw new Error("Usage: tsx scripts/prepare-hubpedia-ai-jobs.ts <expand|translate-en> [--count-only|--output=path]");
}
if (!countOnly && !outputArg) throw new Error("Provide --output=path or use --count-only.");

const audit = auditCatalog(VIEWABLE_SEED_ARTICLES);
const shortSlugs = new Set(audit.shortJapaneseArticles);
const linkTargets = VIEWABLE_SEED_ARTICLES.map((article) => ({ slug: article.slug, title: article.title }));
const jobs = mode === "expand"
  ? VIEWABLE_SEED_ARTICLES.filter((article) => shortSlugs.has(article.slug)).map((article) => {
    const frame = createArticleExpansionFrame({
      locale: "ja",
      title: article.title,
      summary: article.summary,
      bodyMarkdown: article.bodyMarkdown,
      category: article.categoryLabel,
      linkTargets: linkTargets.filter((target) => target.slug !== article.slug),
    });
    return { slug: article.slug, locale: "ja", system: frame.system, prompt: frame.prompt };
  })
  : VIEWABLE_SEED_ARTICLES.filter((article) => !article.translations?.en).map((article) => {
    const frame = createTranslationFrame({
      locale: "en",
      title: article.title,
      summary: article.summary,
      bodyMarkdown: article.bodyMarkdown,
    });
    return { slug: article.slug, locale: "en", system: frame.system, prompt: frame.prompt };
  });

if (!countOnly && outputArg) writeFileSync(resolve(outputArg), `${JSON.stringify({ version: 1, mode, jobs }, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ mode, jobCount: jobs.length, output: outputArg ? resolve(outputArg) : null }, null, 2));
