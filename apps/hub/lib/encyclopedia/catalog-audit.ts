import type { ViewableSeedArticle } from "./seed";
import { isPublishableEvidenceSource } from "./source-license-policy";
import { auditArticleStructure, type ArticleStructureIssue } from "./article-structure-policy";
import { assessArticleQuality, type ArticleQualityAssessment } from "./article-quality-engine";
import { buildMaintenanceReport } from "./article-maintenance";

const internalLink = /\]\(\/hubpedia\/([a-z0-9]+(?:-[a-z0-9]+)*)\)/g;

function plainTextLength(markdown: string) {
  return markdown
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[-*>]\s*/gm, "")
    .replace(/\s+/g, "")
    .length;
}

function normalizedTitle(title: string) {
  return title.normalize("NFKC").replace(/[\s・･:：―—-]+/g, "").toLocaleLowerCase("ja");
}

export interface CatalogAuditReport {
  articleCount: number;
  translationCount: number;
  shortJapaneseArticles: string[];
  shortTranslations: Array<{ slug: string; locale: string }>;
  brokenInternalLinks: Array<{ slug: string; targetSlug: string; locale: string }>;
  duplicateTitles: Array<{ locale: string; title: string; slugs: string[] }>;
  unapprovedDisplayedSources: Array<{ slug: string; url: string }>;
  duplicateBodies: Array<{ locale: string; slugs: string[] }>;
  orphanArticles: string[];
  templatedArticles: Array<{ slug: string; locale: string; phrase: string }>;
  officialNameCaseMismatches: Array<{ slug: string; locale: string; expected: string; actual: string }>;
  highRiskUnreviewedArticles: string[];
  structuralIssues: Array<{ slug: string; locale: string; issue: ArticleStructureIssue }>;
  qualityAssessments: Array<{ slug: string; locale: string; assessment: ArticleQualityAssessment }>;
  lowQualityArticles: Array<{ slug: string; locale: string; score: number }>;
  maintenance: Omit<ReturnType<typeof buildMaintenanceReport>, "quality">;
  publicationBlockerCount: number;
}

const templatePhrases = [
  "文脈を踏まえて理解することが重要",
  "関連する概念とあわせて理解",
  "今後の動向を注視する必要",
  "it is important to understand the context",
  "should be understood alongside related concepts",
];

const highRiskTopic = /(?:医療|医学|病気|疾患|治療|薬|法律|法令|投資|金融|税|選挙|政治|medicine|medical|disease|treatment|drug|law|legal|investment|finance|tax|election|politic)/i;

function normalizedBody(markdown: string) {
  return markdown.normalize("NFKC").replace(/\[[^\]]+\]\([^)]+\)/g, "").replace(/[^\p{L}\p{N}]+/gu, "").toLocaleLowerCase();
}

function caseSensitiveOfficialNames(title: string) {
  return [...new Set([...title.matchAll(/[A-Za-z][A-Za-z0-9.+&-]*/g)]
    .map(([token]) => token)
    .filter((token) => {
      const letters = token.replace(/[^A-Za-z]/g, "");
      return letters.length >= 2 && (letters === letters.toUpperCase() || /[a-z][A-Z]/.test(letters));
    }))];
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function auditCatalog(articles: readonly ViewableSeedArticle[]): CatalogAuditReport {
  const slugs = new Set(articles.map((article) => article.slug));
  const titleGroups = new Map<string, { locale: string; title: string; slugs: string[] }>();
  const brokenInternalLinks: CatalogAuditReport["brokenInternalLinks"] = [];
  const shortJapaneseArticles: string[] = [];
  const shortTranslations: CatalogAuditReport["shortTranslations"] = [];
  const unapprovedDisplayedSources: CatalogAuditReport["unapprovedDisplayedSources"] = [];
  const bodyGroups = new Map<string, { locale: string; slugs: string[] }>();
  const inboundLinks = new Map<string, number>(articles.map((article) => [article.slug, 0]));
  const templatedArticles: CatalogAuditReport["templatedArticles"] = [];
  const officialNameCaseMismatches: CatalogAuditReport["officialNameCaseMismatches"] = [];
  const highRiskUnreviewedArticles: string[] = [];
  const structuralIssues: CatalogAuditReport["structuralIssues"] = [];
  const qualityAssessments: CatalogAuditReport["qualityAssessments"] = [];
  let translationCount = 0;

  const inspectDocument = (slug: string, locale: string, title: string, bodyMarkdown: string) => {
    const key = `${locale}:${normalizedTitle(title)}`;
    const group = titleGroups.get(key) ?? { locale, title, slugs: [] };
    group.slugs.push(slug);
    titleGroups.set(key, group);
    for (const match of bodyMarkdown.matchAll(internalLink)) {
      if (!slugs.has(match[1])) brokenInternalLinks.push({ slug, targetSlug: match[1], locale });
      else if (locale === "ja" && match[1] !== slug) inboundLinks.set(match[1], (inboundLinks.get(match[1]) ?? 0) + 1);
    }
    const bodyKey = `${locale}:${normalizedBody(bodyMarkdown)}`;
    if (bodyKey.length > locale.length + 101) {
      const bodyGroup = bodyGroups.get(bodyKey) ?? { locale, slugs: [] };
      bodyGroup.slugs.push(slug);
      bodyGroups.set(bodyKey, bodyGroup);
    }
    for (const phrase of templatePhrases) if (bodyMarkdown.toLocaleLowerCase().includes(phrase)) templatedArticles.push({ slug, locale, phrase });
  };

  for (const article of articles) {
    if (plainTextLength(article.bodyMarkdown) < 300) shortJapaneseArticles.push(article.slug);
    inspectDocument(article.slug, "ja", article.title, article.bodyMarkdown);
    structuralIssues.push(...auditArticleStructure(article).map((issue) => ({ slug: article.slug, locale: "ja", issue })));
    qualityAssessments.push({ slug: article.slug, locale: "ja", assessment: assessArticleQuality(article) });
    for (const source of article.sources) {
      if (!isPublishableEvidenceSource(source)) unapprovedDisplayedSources.push({ slug: article.slug, url: source.url });
    }
    if (article.reviewStatus !== "completed" && highRiskTopic.test(`${article.title} ${article.summary} ${article.topicType} ${article.categoryLabel}`)) {
      highRiskUnreviewedArticles.push(article.slug);
    }
    for (const [locale, translation] of Object.entries(article.translations ?? {})) {
      translationCount += 1;
      if (plainTextLength(translation.bodyMarkdown) < 500) shortTranslations.push({ slug: article.slug, locale });
      for (const expected of caseSensitiveOfficialNames(article.title)) {
        const matches = translation.title.match(new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(expected)}(?![A-Za-z0-9])`, "gi")) ?? [];
        const actual = matches.find((match) => match !== expected);
        if (actual) officialNameCaseMismatches.push({ slug: article.slug, locale, expected, actual });
      }
      inspectDocument(article.slug, locale, translation.title, translation.bodyMarkdown);
      structuralIssues.push(...auditArticleStructure({ ...article, title: translation.title, bodyMarkdown: translation.bodyMarkdown }).map((issue) => ({ slug: article.slug, locale, issue })));
      qualityAssessments.push({ slug: article.slug, locale, assessment: assessArticleQuality({ ...article, title: translation.title, summary: translation.summary, bodyMarkdown: translation.bodyMarkdown }) });
    }
  }

  const duplicateBodies = [...bodyGroups.values()].filter((group) => group.slugs.length > 1);
  const duplicateTitles = [...titleGroups.values()].filter((group) => group.slugs.length > 1);
  const orphanArticles = articles.filter((article) =>
    (inboundLinks.get(article.slug) ?? 0) === 0
    && !/\]\(\/hubpedia\/[a-z0-9]+(?:-[a-z0-9]+)*\)/.test(article.bodyMarkdown)
  ).map((article) => article.slug);
  const lowQualityArticles = qualityAssessments.filter(({ assessment }) => !assessment.publishable).map(({ slug, locale, assessment }) => ({ slug, locale, score: assessment.score }));
  const {quality:_quality,...maintenance}=buildMaintenanceReport(articles);
  const publicationBlockerCount = brokenInternalLinks.length + duplicateTitles.length + duplicateBodies.length + unapprovedDisplayedSources.length + officialNameCaseMismatches.length + highRiskUnreviewedArticles.length + structuralIssues.filter(({ issue }) => issue.severity === "blocker").length + lowQualityArticles.length;

  return {
    articleCount: articles.length,
    translationCount,
    shortJapaneseArticles,
    shortTranslations,
    brokenInternalLinks,
    duplicateTitles,
    unapprovedDisplayedSources,
    duplicateBodies,
    orphanArticles,
    templatedArticles,
    officialNameCaseMismatches,
    highRiskUnreviewedArticles,
    structuralIssues,
    qualityAssessments,
    lowQualityArticles,
    maintenance,
    publicationBlockerCount,
  };
}
