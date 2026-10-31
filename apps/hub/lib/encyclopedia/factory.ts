import { z } from "zod";

import { canonicalHubpediaSlug } from "./article-aliases";
import { assessArticleQuality } from "./article-quality-engine";
import {
  createArticleExpansionFrame,
  createTranslationFrame,
  expandedArticleSchema,
  type ExpandedArticle,
} from "./generation-frame";
import { hubpediaAiJobSchema, type HubpediaAiJob, type HubpediaAiJobMode } from "./llm-batch";
import { translationResponseSchema, validateTranslation, type TranslationResponse } from "./translation";

/*
 * The factory is the connective tissue between parts that already exist:
 * prepare-hubpedia-ai-jobs plans prompts, run-hubpedia-ai-jobs produces
 * candidate JSONL, generate-hubpedia-quality-manifest registers finished
 * reader-quality batches. Nothing consumed the JSONL until now. Everything
 * here is pure so the driver script stays a thin, resumable shell, and so
 * publication approval (publication-manifest) is never touched from here.
 */

/* A Wikipedia-style fact row for the article infobox. cite keeps the fact
 * inside the provenance graph: it names the claim index the row rests on,
 * and the display layer renumbers it onto the shown source list exactly as
 * it does for body citations. */
export interface FactoryInfoboxRow {
  label: string;
  value: string;
  cite?: number;
}

export interface FactoryLocalizedDraft {
  title: string;
  summary: string;
  bodyMarkdown: string;
  infobox?: FactoryInfoboxRow[];
}

export interface FactoryQualityDraft {
  slug: string;
  ja: FactoryLocalizedDraft;
  en: FactoryLocalizedDraft;
}

export interface FactorySeedArticleInput {
  slug: string;
  title: string;
  summary: string;
  bodyMarkdown: string;
  categoryLabel: string;
  translations?: Record<string, FactoryLocalizedDraft>;
}

export interface FactoryJobFile {
  version: 1;
  mode: HubpediaAiJobMode;
  jobs: HubpediaAiJob[];
}

export const factoryCandidateRecordSchema = z.object({
  version: z.literal(1),
  status: z.literal("candidate_review_required"),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  locale: z.string().trim().min(2).max(20),
  mode: z.enum(["expand", "translate-en"]),
  output: z.unknown(),
}).passthrough();

export interface FactoryCandidateOutputs {
  expanded: Map<string, ExpandedArticle>;
  translations: Map<string, TranslationResponse>;
  errors: string[];
}

/* Later lines win: the runner appends on resume, so a rerun supersedes. */
export function collectFactoryCandidates(jsonlTexts: readonly string[]): FactoryCandidateOutputs {
  const expanded = new Map<string, ExpandedArticle>();
  const translations = new Map<string, TranslationResponse>();
  const errors: string[] = [];
  for (const text of jsonlTexts) {
    for (const line of text.split(/\r?\n/).filter(Boolean)) {
      let record: z.infer<typeof factoryCandidateRecordSchema>;
      try {
        record = factoryCandidateRecordSchema.parse(JSON.parse(line));
      } catch {
        errors.push(`Unreadable candidate line skipped: ${line.slice(0, 120)}`);
        continue;
      }
      try {
        if (record.mode === "expand") expanded.set(record.slug, expandedArticleSchema.parse(record.output));
        else translations.set(record.slug, translationResponseSchema.parse(record.output));
      } catch (error) {
        errors.push(`${record.slug}: output does not match the ${record.mode} contract (${error instanceof Error ? error.message.slice(0, 200) : "invalid"}).`);
      }
    }
  }
  return { expanded, translations, errors };
}

function escapeInlineMarkdown(value: string) {
  return value.replace(/([\\[\]*_`])/g, "\\$1");
}

/* Same placement rules as article-draft.ts: allowed targets only, first
 * occurrence of the exact anchor, one link per target per article. */
export function renderExpandedArticleMarkdown(
  article: ExpandedArticle,
  allowedTargets: ReadonlyMap<string, string>,
): string {
  const linkedTargets = new Set<string>();
  return article.sections.map((section) => {
    const paragraphs = section.paragraphs.map((paragraph) => {
      const placements = paragraph.links
        .filter((link) => allowedTargets.has(link.targetSlug) && !linkedTargets.has(link.targetSlug))
        .map((link) => ({ ...link, start: paragraph.text.indexOf(link.anchor) }))
        .filter((link) => link.start >= 0)
        .sort((a, b) => a.start - b.start || b.anchor.length - a.anchor.length);
      const accepted: typeof placements = [];
      let end = 0;
      for (const placement of placements) {
        if (placement.start < end || linkedTargets.has(placement.targetSlug)) continue;
        accepted.push(placement);
        linkedTargets.add(placement.targetSlug);
        end = placement.start + placement.anchor.length;
      }
      if (!accepted.length) return escapeInlineMarkdown(paragraph.text);
      let cursor = 0;
      let output = "";
      for (const placement of accepted) {
        output += escapeInlineMarkdown(paragraph.text.slice(cursor, placement.start));
        output += `[${escapeInlineMarkdown(placement.anchor)}](/hubpedia/${placement.targetSlug})`;
        cursor = placement.start + placement.anchor.length;
      }
      return output + escapeInlineMarkdown(paragraph.text.slice(cursor));
    });
    return `## ${section.heading}\n\n${paragraphs.join("\n\n")}`;
  }).join("\n\n");
}

export function planFactoryExpandJobs(
  articles: readonly FactorySeedArticleInput[],
  shortSlugs: ReadonlySet<string>,
  minimumCharacters: number,
): FactoryJobFile {
  const linkTargets = articles.map((article) => ({ slug: article.slug, title: article.title }));
  const jobs = articles.filter((article) => shortSlugs.has(article.slug)).map((article) => {
    const frame = createArticleExpansionFrame({
      locale: "ja",
      title: article.title,
      summary: article.summary,
      bodyMarkdown: article.bodyMarkdown,
      category: article.categoryLabel,
      linkTargets: linkTargets.filter((target) => target.slug !== article.slug),
      minimumCharacters,
    });
    return hubpediaAiJobSchema.parse({ slug: article.slug, locale: "ja", system: frame.system, prompt: frame.prompt });
  });
  return { version: 1, mode: "expand", jobs };
}

/* Translating a Japanese article that cannot itself pass the reader-quality
 * audit wastes a provider call on a draft the verify stage must reject, so
 * the plan applies the same per-draft checks the scorer will. */
export function planFactoryTranslationJobs(
  articles: readonly FactorySeedArticleInput[],
  excludeSlugs: ReadonlySet<string>,
  allowedSlugs: ReadonlySet<string>,
): { file: FactoryJobFile; skipped: Array<{ slug: string; issues: string[] }> } {
  const skipped: Array<{ slug: string; issues: string[] }> = [];
  const jobs: HubpediaAiJob[] = [];
  for (const article of articles) {
    if (excludeSlugs.has(article.slug) || article.translations?.en) continue;
    const issues = auditFactoryLocalizedDraft(article.slug, "ja", article, allowedSlugs);
    const assessment = assessArticleQuality({ title: article.title, summary: article.summary, bodyMarkdown: article.bodyMarkdown });
    if (!assessment.publishable) issues.push(`${article.slug}:ja quality score ${assessment.score} below the publishable bar.`);
    if (issues.length) {
      skipped.push({ slug: article.slug, issues });
      continue;
    }
    const frame = createTranslationFrame({
      locale: "en",
      title: article.title,
      summary: article.summary,
      bodyMarkdown: article.bodyMarkdown,
    });
    jobs.push(hubpediaAiJobSchema.parse({ slug: article.slug, locale: "en", system: frame.system, prompt: frame.prompt }));
  }
  return { file: { version: 1, mode: "translate-en", jobs }, skipped };
}

export interface FactoryAssembly {
  drafts: FactoryQualityDraft[];
  needsTranslation: Array<{ slug: string; ja: FactoryLocalizedDraft }>;
  skipped: Array<{ slug: string; reason: string }>;
}

/* An expanded article invalidates any English text written for the old body,
 * so the pair is only complete once the new Japanese text has been translated. */
export function assembleFactoryDrafts(input: {
  expanded: ReadonlyMap<string, ExpandedArticle>;
  translations: ReadonlyMap<string, TranslationResponse>;
  seedArticles: readonly FactorySeedArticleInput[];
  allowedTargets: ReadonlyMap<string, string>;
}): FactoryAssembly {
  const seedBySlug = new Map(input.seedArticles.map((article) => [article.slug, article]));
  const drafts: FactoryQualityDraft[] = [];
  const needsTranslation: FactoryAssembly["needsTranslation"] = [];
  const skipped: FactoryAssembly["skipped"] = [];
  for (const [slug, article] of input.expanded) {
    const ja: FactoryLocalizedDraft = {
      title: article.title,
      summary: article.summary,
      bodyMarkdown: renderExpandedArticleMarkdown(article, input.allowedTargets),
    };
    const translation = input.translations.get(slug);
    if (translation) drafts.push({ slug, ja, en: translation });
    else needsTranslation.push({ slug, ja });
  }
  for (const [slug, translation] of input.translations) {
    if (input.expanded.has(slug)) continue;
    const seed = seedBySlug.get(slug);
    if (!seed) {
      skipped.push({ slug, reason: "Translation candidate has no seed article." });
      continue;
    }
    drafts.push({
      slug,
      ja: { title: seed.title, summary: seed.summary, bodyMarkdown: seed.bodyMarkdown },
      en: translation,
    });
  }
  return { drafts, needsTranslation, skipped };
}

export function buildFactoryTranslationJobs(
  needsTranslation: readonly { slug: string; ja: FactoryLocalizedDraft }[],
): FactoryJobFile {
  return {
    version: 1,
    mode: "translate-en",
    jobs: needsTranslation.map(({ slug, ja }) => {
      const frame = createTranslationFrame({ locale: "en", title: ja.title, summary: ja.summary, bodyMarkdown: ja.bodyMarkdown });
      return hubpediaAiJobSchema.parse({ slug, locale: "en", system: frame.system, prompt: frame.prompt });
    }),
  };
}

export const FACTORY_FORBIDDEN_FILLER = [
  "名称や定義だけでなく",
  "関連する人物、組織、作品",
  "評価や論争が存在する場合",
  "requires more than a name",
  "becomes clearer through related people",
  "読み解く補足",
  "[次の記事]",
  "Additional perspective on",
  "[Next article]",
] as const;

const internalLinkPattern = /\]\(\/hubpedia\/([a-z0-9]+(?:-[a-z0-9]+)*)\)/g;
const markdownLinkPattern = /\]\(([^)]+)\)/g;

export function factoryPlainLength(markdown: string) {
  return markdown
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[-*>]\s*/gm, "")
    .replace(/\s+/g, "")
    .length;
}

/* Two internal links keep articles from becoming orphans — but only where a
 * link would mean something. An article cannot link to neighbours that do not
 * exist, and it should not link to unrelated ones just to satisfy a count:
 * asked to link ゲノム into a catalog of 太陽 and 地震, the model rightly
 * declined, and failing it for that would have bought a bad link. So the
 * requirement follows the related articles that actually exist — callers pass
 * the ones sharing a category — and falls back to the whole catalog only when
 * relatedness is unknown. */
/* Turns a link to an article that will not exist back into plain text. The
 * reader never meets a dead internal link — seed/index.ts enforces the same
 * invariant at build time — and an article is not failed for having pointed
 * at a sibling that later failed its own checks. What it does not do is
 * excuse the article from linking: after unwrapping, the link requirement is
 * measured again on what is left. */
export function unwrapUnresolvableInternalLinks(markdown: string, allowedSlugs: ReadonlySet<string>) {
  return markdown.replace(
    /\[([^\]]+)\]\(\/hubpedia\/([a-z0-9]+(?:-[a-z0-9]+)*)\)/g,
    (match, anchor: string, target: string) => (allowedSlugs.has(target) ? match : anchor),
  );
}

/* One link is what connectedness actually requires; two is a nicety that
 * only a populated neighbourhood can afford. Demanding two from a small new
 * cluster caused a cascade: in a batch of four mutually-linked concepts, the
 * two that made a single link failed, which stripped the links from the two
 * that had made two, and the whole cluster collapsed. */
const RICH_NEIGHBOURHOOD = 4;

export function requiredInternalLinkCount(
  slug: string,
  allowedSlugs: ReadonlySet<string>,
  relatedSlugs?: ReadonlySet<string>,
) {
  const pool = relatedSlugs ?? allowedSlugs;
  const available = [...pool].filter((candidate) => candidate !== slug).length;
  if (available === 0) return 0;
  return available >= RICH_NEIGHBOURHOOD ? 2 : 1;
}

export function auditFactoryLocalizedDraft(
  slug: string,
  locale: "ja" | "en",
  draft: FactoryLocalizedDraft,
  allowedSlugs: ReadonlySet<string>,
  relatedSlugs?: ReadonlySet<string>,
): string[] {
  const issues: string[] = [];
  const document = draft.bodyMarkdown;
  const minimumLength = locale === "ja" ? 350 : 550;
  if (!draft.title.trim() || !draft.summary.trim() || !document.trim()) issues.push(`${slug}:${locale} is incomplete.`);
  if (factoryPlainLength(document) < minimumLength) issues.push(`${slug}:${locale} is too short.`);
  if ((document.match(/^## /gm)?.length ?? 0) < 4) issues.push(`${slug}:${locale} needs at least four sections.`);
  if (FACTORY_FORBIDDEN_FILLER.some((phrase) => document.includes(phrase))) issues.push(`${slug}:${locale} contains generic filler.`);
  if (document.includes("�") || /\?{3,}/.test(document)) issues.push(`${slug}:${locale} contains corrupted text.`);
  for (const match of document.matchAll(markdownLinkPattern)) {
    if (!match[1].startsWith("/hubpedia/") && !/^https?:\/\//.test(match[1])) {
      issues.push(`${slug}:${locale} contains an invalid relative link: ${match[1]}.`);
    }
  }
  const internalMatches = [...document.matchAll(internalLinkPattern)];
  const requiredLinks = requiredInternalLinkCount(slug, allowedSlugs, relatedSlugs);
  if (internalMatches.length < requiredLinks) {
    issues.push(`${slug}:${locale} needs at least ${requiredLinks === 1 ? "one internal link" : `${requiredLinks} internal links`}.`);
  }
  for (const match of internalMatches) {
    if (!allowedSlugs.has(canonicalHubpediaSlug(match[1]))) issues.push(`${slug}:${locale} links to missing ${match[1]}.`);
  }
  return issues;
}

export function findRepeatedFactoryParagraphs(drafts: readonly FactoryQualityDraft[]): string[] {
  const reused = new Map<string, string[]>();
  for (const draft of drafts) {
    for (const locale of ["ja", "en"] as const) {
      for (const paragraph of draft[locale].bodyMarkdown.split(/\n\s*\n/)) {
        if (/^(?:-\s+\[[^\]]+\]\([^)]+\)\s*)+$/.test(paragraph.trim())) continue;
        const normalized = paragraph
          .replace(/^#{1,6}\s+/, "")
          .replaceAll(draft[locale].title, "{topic}")
          .replace(/\s+/g, " ")
          .trim();
        if (normalized.length < 80) continue;
        const key = `${locale}:${normalized}`;
        reused.set(key, [...(reused.get(key) ?? []), draft.slug]);
      }
    }
  }
  return [...reused.values()]
    .filter((slugs) => new Set(slugs).size > 1)
    .map((slugs) => `Repeated template paragraph across articles: ${[...new Set(slugs)].join(", ")}.`);
}

export function auditFactoryQualityDrafts(
  drafts: readonly FactoryQualityDraft[],
  allowedSlugs: ReadonlySet<string>,
): string[] {
  const issues: string[] = [];
  const seen = new Set<string>();
  for (const draft of drafts) {
    if (seen.has(draft.slug)) issues.push(`Duplicate quality draft slug: ${draft.slug}`);
    seen.add(draft.slug);
    issues.push(...auditFactoryLocalizedDraft(draft.slug, "ja", draft.ja, allowedSlugs));
    issues.push(...auditFactoryLocalizedDraft(draft.slug, "en", draft.en, allowedSlugs));
  }
  issues.push(...findRepeatedFactoryParagraphs(drafts));
  return issues;
}

export interface FactoryVerification {
  passed: FactoryQualityDraft[];
  failed: Array<{ slug: string; issues: string[] }>;
}

/*
 * Verification to a fixed point.
 *
 * Articles in a batch link to each other, so removing one can strip links
 * from the rest — and a single extra pass is not enough, because the second
 * removal can strip a third. Repeat until the surviving set stops shrinking,
 * which it must, since the set only ever loses members. Links to articles
 * that did not survive become plain text rather than failing their article,
 * and the link requirement is then measured on what is left.
 *
 * The result matches what the independent audit gate sees, which is the point:
 * a batch that passes here is not rejected there for a dangling link.
 */
export function verifyFactoryDraftsToFixedPoint(
  drafts: readonly FactoryQualityDraft[],
  catalogSlugs: ReadonlySet<string>,
  options: {
    sourcesBySlug?: ReadonlyMap<string, readonly unknown[]>;
    relatedSlugsBySlug?: ReadonlyMap<string, ReadonlySet<string>>;
  } = {},
): FactoryVerification {
  const failed: FactoryVerification["failed"] = [];
  let candidates = [...drafts];
  for (let round = 0; round < drafts.length + 1; round += 1) {
    const surviving = new Set([...catalogSlugs, ...candidates.map((draft) => draft.slug)]);
    const settled = candidates.map((draft) => ({
      slug: draft.slug,
      ja: { ...draft.ja, bodyMarkdown: unwrapUnresolvableInternalLinks(draft.ja.bodyMarkdown, surviving) },
      en: { ...draft.en, bodyMarkdown: unwrapUnresolvableInternalLinks(draft.en.bodyMarkdown, surviving) },
    }));
    const verification = verifyFactoryDrafts(settled, surviving, options);
    if (verification.failed.length === 0) return { passed: verification.passed, failed };
    failed.push(...verification.failed);
    const rejected = new Set(verification.failed.map((entry) => entry.slug));
    candidates = candidates.filter((draft) => !rejected.has(draft.slug));
    if (!candidates.length) return { passed: [], failed };
  }
  return { passed: [], failed };
}

export function verifyFactoryDrafts(
  drafts: readonly FactoryQualityDraft[],
  allowedSlugs: ReadonlySet<string>,
  options: {
    sourcesBySlug?: ReadonlyMap<string, readonly unknown[]>;
    /* Slugs sharing a category with each draft. Without it every article in
     * the catalog counts as a possible link target, which demands links an
     * article has no honest reason to make. */
    relatedSlugsBySlug?: ReadonlyMap<string, ReadonlySet<string>>;
  } = {},
): FactoryVerification {
  const issuesBySlug = new Map<string, string[]>(drafts.map((draft) => [draft.slug, []]));
  const record = (slug: string, issue: string) => issuesBySlug.get(slug)?.push(issue);
  const seen = new Set<string>();
  for (const draft of drafts) {
    if (seen.has(draft.slug)) record(draft.slug, `Duplicate quality draft slug: ${draft.slug}`);
    seen.add(draft.slug);
    const related = options.relatedSlugsBySlug?.get(draft.slug);
    for (const issue of auditFactoryLocalizedDraft(draft.slug, "ja", draft.ja, allowedSlugs, related)) record(draft.slug, issue);
    for (const issue of auditFactoryLocalizedDraft(draft.slug, "en", draft.en, allowedSlugs, related)) record(draft.slug, issue);
    try {
      validateTranslation(draft.ja.bodyMarkdown, draft.en);
    } catch (error) {
      record(draft.slug, `${draft.slug}:en ${error instanceof Error ? error.message : "does not mirror the Japanese citations and links."}`);
    }
    /* Infobox parity: both languages show the same fact rows citing the same
     * claims. Labels and values may differ in wording; shape may not. */
    const jaInfobox = draft.ja.infobox ?? [];
    const enInfobox = draft.en.infobox ?? [];
    if (jaInfobox.length !== enInfobox.length) {
      record(draft.slug, `${draft.slug}:en infobox must carry the same rows as the Japanese infobox.`);
    } else if (jaInfobox.length) {
      const citeMultiset = (rows: readonly { cite?: number }[]) => rows.map((row) => row.cite ?? 0).sort((left, right) => left - right);
      const jaCites = citeMultiset(jaInfobox);
      const enCites = citeMultiset(enInfobox);
      if (jaCites.some((cite, index) => cite !== enCites[index])) {
        record(draft.slug, `${draft.slug}:en infobox must cite the same claims as the Japanese infobox.`);
      }
    }
    const assessment = assessArticleQuality({ title: draft.ja.title, summary: draft.ja.summary, bodyMarkdown: draft.ja.bodyMarkdown, sources: options.sourcesBySlug?.get(draft.slug) });
    if (!assessment.publishable) {
      const blockers = assessment.structureIssues
        .filter((issue) => issue.severity === "blocker")
        .map((issue) => issue.code)
        .join(", ");
      record(draft.slug, `${draft.slug}:ja quality score ${assessment.score} below the publishable bar${blockers ? ` (${blockers})` : ""}.`);
    }
  }
  /* A shared template paragraph disqualifies every article carrying it. */
  const repeatedIssues = findRepeatedFactoryParagraphs(drafts);
  for (const issue of repeatedIssues) {
    const slugs = issue.match(/: (.+)\.$/)?.[1]?.split(", ") ?? [];
    for (const slug of slugs) record(slug, issue);
  }
  const passed: FactoryQualityDraft[] = [];
  const failed: FactoryVerification["failed"] = [];
  const emitted = new Set<string>();
  for (const draft of drafts) {
    if (emitted.has(draft.slug)) continue;
    emitted.add(draft.slug);
    const issues = issuesBySlug.get(draft.slug) ?? [];
    if (issues.length) failed.push({ slug: draft.slug, issues });
    else passed.push(draft);
  }
  return { passed, failed };
}
