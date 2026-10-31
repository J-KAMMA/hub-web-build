import "server-only";
import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "./db/client";
import { encyclopediaArticleRevisions, encyclopediaArticleTranslations, encyclopediaArticles, encyclopediaPipelineRuns, encyclopediaSourceChunks, encyclopediaSourceSnapshots, encyclopediaSources, encyclopediaTopics } from "./db/schema";
import { normalizeSourceUrl } from "./url-security";
import type { ViewableSeedArticle } from "./seed";
import type { z } from "zod";
import type { createSourceSchema, createTopicSchema, updateTopicSchema } from "./validation";

export type PublishedReaderCatalogArticle = ViewableSeedArticle & {
  sourceLayer: "database";
  catalogPublishedAt: string | null;
  catalogUpdatedAt: Date;
};

export type ReaderCatalogArticle = ViewableSeedArticle & {
  sourceLayer: "seed" | "database";
  catalogPublishedAt: string | null;
  catalogUpdatedAt?: Date;
};

function publishedArticleVisibilityPredicate() {
  return and(
    eq(encyclopediaArticles.status, "published"),
    sql`EXISTS (
      SELECT 1 FROM hubpedia_publication_approvals approval
      WHERE approval.article_slug = ${encyclopediaArticles.slug}
        AND approval.revoked_at IS NULL
        AND approval.approved_revision_key = 'db:' || ${encyclopediaArticleRevisions.revisionNumber}
    )`,
    sql`EXISTS (
      SELECT 1 FROM hubpedia_publication_eligible_articles eligible
      WHERE eligible.article_slug = ${encyclopediaArticles.slug}
        AND eligible.revision_id = ${encyclopediaArticles.currentRevisionId}
    )`,
  );
}

function metadataStrings(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  if (typeof value === "string") return [value];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

export function mergePublishedReaderCatalog(
  seedArticles: readonly ViewableSeedArticle[],
  databaseArticles: readonly PublishedReaderCatalogArticle[],
): ReaderCatalogArticle[] {
  const merged = new Map<string, ReaderCatalogArticle>(
    seedArticles.map((article) => [
      article.slug,
      {
        ...article,
        sourceLayer: "seed",
        catalogPublishedAt: null,
      },
    ]),
  );
  for (const article of databaseArticles) merged.set(article.slug, article);
  return [...merged.values()];
}

export async function createTopic(input: z.infer<typeof createTopicSchema>) { const [topic] = await getDb().insert(encyclopediaTopics).values(input).returning(); return topic; }
export async function listTopics() { return getDb().select({ id: encyclopediaTopics.id, canonicalName: encyclopediaTopics.canonicalName, slug: encyclopediaTopics.slug, topicType: encyclopediaTopics.topicType, status: encyclopediaTopics.status, updatedAt: encyclopediaTopics.updatedAt, sourceCount: count(encyclopediaSources.id) }).from(encyclopediaTopics).leftJoin(encyclopediaSources, eq(encyclopediaTopics.id, encyclopediaSources.topicId)).groupBy(encyclopediaTopics.id).orderBy(desc(encyclopediaTopics.updatedAt)); }
export async function getTopic(id: string) {
  const db = getDb();
  const [topic] = await db.select().from(encyclopediaTopics).where(eq(encyclopediaTopics.id, id));
  if (!topic) return null;
  const [sources, pipelineRuns, articleRows] = await Promise.all([
    db.select().from(encyclopediaSources).where(eq(encyclopediaSources.topicId, id)).orderBy(desc(encyclopediaSources.updatedAt)),
    db.select().from(encyclopediaPipelineRuns).where(eq(encyclopediaPipelineRuns.topicId, id)).orderBy(desc(encyclopediaPipelineRuns.createdAt)),
    db.select().from(encyclopediaArticles).where(eq(encyclopediaArticles.topicId, id)).limit(1)
  ]);
  const article = articleRows[0];
  const revisions = article
    ? await db.select().from(encyclopediaArticleRevisions).where(eq(encyclopediaArticleRevisions.articleId, article.id)).orderBy(desc(encyclopediaArticleRevisions.revisionNumber))
    : [];
  const translations = revisions.length
    ? await db.select().from(encyclopediaArticleTranslations).where(inArray(encyclopediaArticleTranslations.sourceRevisionId, revisions.map((revision) => revision.id))).orderBy(encyclopediaArticleTranslations.locale)
    : [];
  return { ...topic, sources, pipelineRuns, article: article ? { ...article, revisions: revisions.map((revision) => ({ ...revision, translations: translations.filter((translation) => translation.sourceRevisionId === revision.id) })) } : null };
}
export async function updateTopic(id: string, input: z.infer<typeof updateTopicSchema>) { const [topic] = await getDb().update(encyclopediaTopics).set({ ...input, updatedAt: new Date() }).where(eq(encyclopediaTopics.id, id)).returning(); return topic ?? null; }
export async function createSource(topicId: string, input: z.infer<typeof createSourceSchema>) { const normalizedUrl = normalizeSourceUrl(input.url); const [source] = await getDb().insert(encyclopediaSources).values({ ...input, sourceType: input.sourceType ?? "web", publishedAt: input.publishedAt ? new Date(input.publishedAt) : undefined, topicId, normalizedUrl, url: normalizedUrl }).returning(); return source; }
export async function listSources(topicId: string) { return getDb().select().from(encyclopediaSources).where(eq(encyclopediaSources.topicId, topicId)).orderBy(desc(encyclopediaSources.updatedAt)); }
export async function getSource(id: string) { const [source] = await getDb().select().from(encyclopediaSources).where(eq(encyclopediaSources.id, id)); if (!source) return null; const snapshots = await getDb().select().from(encyclopediaSourceSnapshots).where(eq(encyclopediaSourceSnapshots.sourceId, id)).orderBy(desc(encyclopediaSourceSnapshots.retrievedAt)); const chunks = snapshots[0] ? await getDb().select().from(encyclopediaSourceChunks).where(eq(encyclopediaSourceChunks.snapshotId, snapshots[0].id)).orderBy(encyclopediaSourceChunks.chunkIndex) : []; return { ...source, snapshots, chunks }; }
export async function getRun(id: string) { const [run] = await getDb().select().from(encyclopediaPipelineRuns).where(eq(encyclopediaPipelineRuns.id, id)); return run ?? null; }
export async function listRunsForTopic(topicId: string) { return getDb().select().from(encyclopediaPipelineRuns).where(eq(encyclopediaPipelineRuns.topicId, topicId)).orderBy(desc(encyclopediaPipelineRuns.createdAt)); }

export async function listPublishedArticleLinkTargets() {
  return getDb().select({ slug: encyclopediaArticles.slug, title: encyclopediaArticleRevisions.title })
    .from(encyclopediaArticles)
    .innerJoin(encyclopediaArticleRevisions, eq(encyclopediaArticles.currentRevisionId, encyclopediaArticleRevisions.id))
    .where(publishedArticleVisibilityPredicate())
    .orderBy(desc(encyclopediaArticles.updatedAt))
    .limit(500);
}

export async function listPublishedReaderCatalogArticles(requestedLocale = "ja") {
  const rows = await getDb().select({
    slug: encyclopediaArticles.slug,
    title: encyclopediaArticleRevisions.title,
    summary: encyclopediaArticleRevisions.summary,
    bodyMarkdown: encyclopediaArticleRevisions.bodyMarkdown,
    generationMetadata: encyclopediaArticleRevisions.generationMetadata,
    topicType: encyclopediaTopics.topicType,
    topicDescription: encyclopediaTopics.description,
    translatedTitle: encyclopediaArticleTranslations.title,
    translatedSummary: encyclopediaArticleTranslations.summary,
    translatedBodyMarkdown: encyclopediaArticleTranslations.bodyMarkdown,
    articleUpdatedAt: encyclopediaArticles.updatedAt,
    approvedAt: sql<string | null>`(
      SELECT approval.approved_at
      FROM hubpedia_publication_approvals approval
      WHERE approval.article_slug = ${encyclopediaArticles.slug}
        AND approval.revoked_at IS NULL
        AND approval.approved_revision_key = 'db:' || ${encyclopediaArticleRevisions.revisionNumber}
      LIMIT 1
    )`,
  }).from(encyclopediaArticles)
    .innerJoin(encyclopediaArticleRevisions, eq(encyclopediaArticles.currentRevisionId, encyclopediaArticleRevisions.id))
    .innerJoin(encyclopediaTopics, eq(encyclopediaArticles.topicId, encyclopediaTopics.id))
    .leftJoin(encyclopediaArticleTranslations, and(
      eq(encyclopediaArticleTranslations.sourceRevisionId, encyclopediaArticleRevisions.id),
      eq(encyclopediaArticleTranslations.locale, requestedLocale),
      eq(encyclopediaArticleTranslations.status, "published"),
    ))
    .where(publishedArticleVisibilityPredicate())
    .orderBy(desc(encyclopediaArticles.updatedAt));

  return rows.map((row): PublishedReaderCatalogArticle => {
    const metadata = row.generationMetadata ?? {};
    const categoryLabel = metadataStrings(metadata, "categoryIds")[0]
      ?? metadataStrings(metadata, "category")[0]
      ?? row.topicType;
    const searchMetadata = [
      ...metadataStrings(metadata, "reading"),
      ...metadataStrings(metadata, "aliases"),
    ].join(" ");
    const summary = row.translatedSummary ?? row.summary ?? row.topicDescription ?? "";
    return {
      slug: row.slug,
      canonicalName: row.title,
      topicType: row.topicType,
      description: [row.summary ?? row.topicDescription ?? "", searchMetadata].filter(Boolean).join(" "),
      title: row.translatedTitle ?? row.title,
      summary,
      bodyMarkdown: row.translatedBodyMarkdown ?? row.bodyMarkdown,
      sources: [],
      collection: "curated",
      categoryLabel,
      reviewStatus: "completed",
      translations: row.translatedTitle
        ? {
            [requestedLocale]: {
              title: row.translatedTitle,
              summary,
              bodyMarkdown: row.translatedBodyMarkdown ?? row.bodyMarkdown,
            },
          }
        : undefined,
      sourceLayer: "database",
      catalogPublishedAt: row.approvedAt,
      catalogUpdatedAt: row.articleUpdatedAt,
    };
  });
}

export async function getPublishedArticleBySlug(slug: string, requestedLocale = "ja") {
  const [row] = await getDb().select({
    articleId: encyclopediaArticles.id,
    revisionId: encyclopediaArticleRevisions.id,
    slug: encyclopediaArticles.slug,
    title: encyclopediaArticleRevisions.title,
    summary: encyclopediaArticleRevisions.summary,
    bodyMarkdown: encyclopediaArticleRevisions.bodyMarkdown,
    generationMetadata: encyclopediaArticleRevisions.generationMetadata,
    revisionNumber: encyclopediaArticleRevisions.revisionNumber,
    revisionCreatedAt: encyclopediaArticleRevisions.createdAt,
    topicId: encyclopediaTopics.id,
    topicType: encyclopediaTopics.topicType,
    lastVerifiedAt: encyclopediaTopics.lastVerifiedAt
  }).from(encyclopediaArticles)
    .innerJoin(encyclopediaArticleRevisions, eq(encyclopediaArticles.currentRevisionId, encyclopediaArticleRevisions.id))
    .innerJoin(encyclopediaTopics, eq(encyclopediaArticles.topicId, encyclopediaTopics.id))
    .where(and(
      eq(encyclopediaArticles.slug, slug),
      publishedArticleVisibilityPredicate(),
    ))
    .limit(1);
  if (!row) return null;
  const [translations, sources] = await Promise.all([
    getDb().select().from(encyclopediaArticleTranslations)
      .where(and(eq(encyclopediaArticleTranslations.sourceRevisionId, row.revisionId), eq(encyclopediaArticleTranslations.status, "published"))),
    getDb().select().from(encyclopediaSources)
      .where(and(eq(encyclopediaSources.topicId, row.topicId), eq(encyclopediaSources.isActive, true)))
      .orderBy(desc(encyclopediaSources.updatedAt)),
  ]);
  const translation = requestedLocale === "ja" ? null : translations.find((item) => item.locale === requestedLocale);
  return {
    ...row,
    title: translation?.title ?? row.title,
    summary: translation?.summary ?? row.summary,
    bodyMarkdown: translation?.bodyMarkdown ?? row.bodyMarkdown,
    locale: translation?.locale ?? "ja",
    requestedLocale,
    availableLocales: ["ja", ...translations.map((item) => item.locale)],
    sources,
  };
}
