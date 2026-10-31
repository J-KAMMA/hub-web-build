import { assessArticleQuality } from "./article-quality-engine";
import { getLinkedArticleSlugs } from "./article-relations";
import { inferArticleEntityType } from "./article-structure-policy";
import type { ViewableSeedArticle } from "./seed";
import { assessEvidenceUse } from "./source-license-policy";

export type SourceLicenseStatus = "allowed" | "attribution-required" | "review-required" | "blocked";
export type PublicationBlockerCode =
  | "quality"
  | "structure"
  | "broken-link"
  | "duplicate"
  | "source-license"
  | "high-risk-unsourced";

const allowedLicense = /(?:public domain|cc0|cc by(?:-sa)?|creativecommons\.org\/licenses\/(?:by|by-sa|zero)|government work|open government licence)/iu;
const attributionLicense = /(?:wikipedia|wikimedia|cc by|cc-by)/iu;
const highRiskTopic = /(?:medical|medicine|health|law|legal|finance|investment|election|\u533b\u7642|\u5065\u5eb7|\u6cd5\u5f8b|\u6295\u8cc7|\u9078\u6319)/iu;

export function classifySourceLicense(source: { url?: string; publisher?: string; license?: string; sourceType?: string; reliabilityTier?: string; metadata?: Record<string, unknown> }): SourceLicenseStatus {
  const decision = assessEvidenceUse(source);
  if (!decision.allowed) return decision.mode === "discovery-only" || decision.reason === "review-missing" ? "review-required" : "blocked";
  const value = `${source.license ?? ""} ${source.publisher ?? ""} ${source.url ?? ""}`;
  if (allowedLicense.test(value)) return attributionLicense.test(value) ? "attribution-required" : "allowed";
  return "review-required";
}

export function sourceLicenseAudit(article: ViewableSeedArticle) {
  return article.sources.map((source) => ({
    url: source.url,
    publisher: source.publisher,
    license: source.license ?? null,
    status: classifySourceLicense(source),
  }));
}

export function auditLinkGraph(articles: readonly ViewableSeedArticle[]) {
  const slugs = new Set(articles.map((article) => article.slug));
  const incoming = new Map<string, number>(articles.map((article) => [article.slug, 0]));
  const broken: Array<{ from: string; to: string }> = [];
  for (const article of articles) {
    for (const target of getLinkedArticleSlugs(article.bodyMarkdown)) {
      if (!slugs.has(target)) broken.push({ from: article.slug, to: target });
      else incoming.set(target, (incoming.get(target) ?? 0) + 1);
    }
  }
  return {
    broken,
    orphaned: articles.filter((article) => (incoming.get(article.slug) ?? 0) === 0).map((article) => article.slug),
    incoming: Object.fromEntries(incoming),
  };
}

export function publicationGate(article: ViewableSeedArticle, catalog: readonly ViewableSeedArticle[]) {
  const assessment = assessArticleQuality(article);
  const links = getLinkedArticleSlugs(article.bodyMarkdown);
  const catalogSlugs = new Set(catalog.map((entry) => entry.slug));
  const brokenLinks = [...links].filter((slug) => !catalogSlugs.has(slug));
  const licenses = sourceLicenseAudit(article);
  const blockers: Array<{ code: PublicationBlockerCode; detail: string }> = [];
  if (assessment.score < 70) blockers.push({ code: "quality", detail: `Quality score ${assessment.score} is below 70.` });
  if (assessment.structureIssues.some((issue) => issue.severity === "blocker")) blockers.push({ code: "structure", detail: "Article structure contains a blocking issue." });
  if (assessment.duplicatePassages.length) blockers.push({ code: "duplicate", detail: "Repeated passages require revision." });
  if (brokenLinks.length) blockers.push({ code: "broken-link", detail: `Unknown targets: ${brokenLinks.join(", ")}` });
  if (licenses.some((source) => source.status === "review-required" || source.status === "blocked")) blockers.push({ code: "source-license", detail: "At least one source is discovery-only, blocked, or has an unverified reuse license." });
  if (highRiskTopic.test(`${article.topicType} ${article.categoryLabel}`) && article.sources.length < 2) blockers.push({ code: "high-risk-unsourced", detail: "High-risk topics require at least two reliable sources." });
  return { publishable: blockers.length === 0, score: assessment.score, blockers, brokenLinks, licenses };
}

export function updateSchedule(article: ViewableSeedArticle, lastVerifiedAt?: string | Date | null, now = new Date()) {
  const text = `${article.title} ${article.topicType} ${article.categoryLabel}`.toLocaleLowerCase("ja");
  const entity = inferArticleEntityType(article);
  const freshnessClass = /(?:current|price|law|medical|election|\u73fe\u5728|\u4fa1\u683c|\u6cd5\u5f8b|\u533b\u7642|\u9078\u6319)/iu.test(text)
    ? "rapid" as const
    : entity === "technology" || entity === "science" ? "periodic" as const : "stable" as const;
  const policy = { freshnessClass, maxAgeDays: freshnessClass === "rapid" ? 90 : freshnessClass === "periodic" ? 365 : 1825 };
  const verified = lastVerifiedAt ? new Date(lastVerifiedAt) : null;
  const dueAt = verified && !Number.isNaN(verified.valueOf())
    ? new Date(verified.valueOf() + policy.maxAgeDays * 86_400_000)
    : now;
  return { ...policy, lastVerifiedAt: verified?.toISOString() ?? null, dueAt: dueAt.toISOString(), overdue: dueAt <= now };
}

export function buildPublicationOperationsReport(articles: readonly ViewableSeedArticle[]) {
  const gates = articles.map((article) => ({ slug: article.slug, ...publicationGate(article, articles) }));
  return {
    summary: {
      articles: articles.length,
      publishable: gates.filter((gate) => gate.publishable).length,
      blocked: gates.filter((gate) => !gate.publishable).length,
      sourceReviews: gates.reduce((count, gate) => count + gate.licenses.filter((source) => source.status === "review-required").length, 0),
    },
    gates,
    linkGraph: auditLinkGraph(articles),
    updateQueue: articles.map((article) => ({ slug: article.slug, ...updateSchedule(article, null) })),
  };
}
