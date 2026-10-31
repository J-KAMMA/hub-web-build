import { sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const ENCYCLOPEDIA_EMBEDDING_DIMENSIONS = 1536 as const;

const TOPIC_STATUSES = ["proposed", "researching", "draft", "verified", "published", "stale", "disputed", "archived"] as const;
const EXTRACTION_STATUSES = ["pending", "processing", "succeeded", "failed"] as const;
const PIPELINE_STATUSES = ["queued", "running", "succeeded", "failed", "cancelled"] as const;
const CLAIM_STATUSES = ["proposed", "supported", "disputed", "rejected"] as const;
const ARTICLE_STATUSES = ["draft", "review", "published", "archived"] as const;
const RELATION_TYPES = ["supports", "contradicts", "qualifies", "duplicates", "depends_on"] as const;
const FINDING_SEVERITIES = ["info", "warning", "error"] as const;
const FINDING_STATUSES = ["open", "resolved", "dismissed"] as const;

const id = () => text("id").$defaultFn(() => crypto.randomUUID()).primaryKey();
const createdAt = () => integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()).notNull();
const updatedAt = () => integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()).notNull();
const jsonObject = (name: string) => text(name, { mode: "json" }).$type<Record<string, unknown>>().default({}).notNull();
const jsonArray = (name: string) => text(name, { mode: "json" }).$type<string[]>().default([]).notNull();

export const encyclopediaTopics = sqliteTable("encyclopedia_topics", {
  id: id(), canonicalName: text("canonical_name").notNull(), slug: text("slug").notNull(), description: text("description"), topicType: text("topic_type").notNull(),
  parentTopicId: text("parent_topic_id").references((): AnySQLiteColumn => encyclopediaTopics.id, { onDelete: "set null" }), externalIds: jsonObject("external_ids"),
  status: text("status", { enum: TOPIC_STATUSES }).default("proposed").notNull(), freshnessIntervalHours: integer("freshness_interval_hours").default(720).notNull(),
  lastResearchedAt: integer("last_researched_at", { mode: "timestamp" }), lastVerifiedAt: integer("last_verified_at", { mode: "timestamp" }), createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [uniqueIndex("encyclopedia_topics_slug_uidx").on(t.slug), index("encyclopedia_topics_parent_idx").on(t.parentTopicId), index("encyclopedia_topics_status_idx").on(t.status), check("encyclopedia_topics_freshness_positive", sql`${t.freshnessIntervalHours} > 0`)]);

export const encyclopediaSources = sqliteTable("encyclopedia_sources", {
  id: id(), topicId: text("topic_id").notNull().references(() => encyclopediaTopics.id, { onDelete: "cascade" }), url: text("url").notNull(), normalizedUrl: text("normalized_url").notNull(), title: text("title"),
  publisher: text("publisher"), authors: jsonArray("authors"), sourceType: text("source_type").notNull(), language: text("language"), doi: text("doi"), isbn: text("isbn"),
  publishedAt: integer("published_at", { mode: "timestamp" }), license: text("license"), reliabilityTier: text("reliability_tier"), metadata: jsonObject("metadata"),
  isActive: integer("is_active", { mode: "boolean" }).default(true).notNull(), createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [uniqueIndex("encyclopedia_sources_topic_url_uidx").on(t.topicId, t.normalizedUrl), index("encyclopedia_sources_topic_idx").on(t.topicId)]);

export const encyclopediaSourceSnapshots = sqliteTable("encyclopedia_source_snapshots", {
  id: id(), sourceId: text("source_id").notNull().references(() => encyclopediaSources.id, { onDelete: "cascade" }), retrievedAt: integer("retrieved_at", { mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
  contentHash: text("content_hash").notNull(), mimeType: text("mime_type"), objectStorageKey: text("object_storage_key"), extractedText: text("extracted_text"),
  extractionStatus: text("extraction_status", { enum: EXTRACTION_STATUSES }).default("pending").notNull(), extractionMetadata: jsonObject("extraction_metadata"), canonicalUrl: text("canonical_url"),
  extractedTitle: text("extracted_title"), extractedLanguage: text("extracted_language"), extractedAuthors: jsonArray("extracted_authors"), extractedPublishedAt: integer("extracted_published_at", { mode: "timestamp" }),
  error: text("error", { mode: "json" }).$type<Record<string, unknown> | null>(), createdAt: createdAt(),
}, (t) => [uniqueIndex("encyclopedia_snapshots_source_hash_uidx").on(t.sourceId, t.contentHash), index("encyclopedia_snapshots_source_retrieved_idx").on(t.sourceId, t.retrievedAt)]);

export const encyclopediaSourceChunks = sqliteTable("encyclopedia_source_chunks", {
  id: id(), snapshotId: text("snapshot_id").notNull().references(() => encyclopediaSourceSnapshots.id, { onDelete: "cascade" }), chunkIndex: integer("chunk_index").notNull(),
  headingPath: jsonArray("heading_path"), textContent: text("text_content").notNull(), startOffset: integer("start_offset").notNull(), endOffset: integer("end_offset").notNull(),
  pageNumber: integer("page_number"), metadata: jsonObject("metadata"), embedding: text("embedding", { mode: "json" }).$type<number[] | null>(), createdAt: createdAt(),
}, (t) => [uniqueIndex("encyclopedia_chunks_snapshot_index_uidx").on(t.snapshotId, t.chunkIndex), check("encyclopedia_chunks_offsets_valid", sql`${t.startOffset} >= 0 AND ${t.endOffset} >= ${t.startOffset}`)]);

export const encyclopediaClaims = sqliteTable("encyclopedia_claims", {
  id: id(), topicId: text("topic_id").notNull().references(() => encyclopediaTopics.id, { onDelete: "cascade" }), statement: text("statement").notNull(), normalizedStatement: text("normalized_statement"),
  status: text("status", { enum: CLAIM_STATUSES }).default("proposed").notNull(), confidence: real("confidence"), metadata: jsonObject("metadata"), createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [index("encyclopedia_claims_topic_status_idx").on(t.topicId, t.status), check("encyclopedia_claims_confidence_range", sql`${t.confidence} IS NULL OR (${t.confidence} >= 0 AND ${t.confidence} <= 1)`)]);

export const encyclopediaClaimEvidence = sqliteTable("encyclopedia_claim_evidence", {
  claimId: text("claim_id").notNull().references(() => encyclopediaClaims.id, { onDelete: "cascade" }), chunkId: text("chunk_id").notNull().references(() => encyclopediaSourceChunks.id, { onDelete: "cascade" }),
  stance: text("stance", { enum: RELATION_TYPES }).notNull(), quote: text("quote"), relevance: real("relevance"), metadata: jsonObject("metadata"), createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.claimId, t.chunkId] }), index("encyclopedia_claim_evidence_chunk_idx").on(t.chunkId), check("encyclopedia_evidence_relevance_range", sql`${t.relevance} IS NULL OR (${t.relevance} >= 0 AND ${t.relevance} <= 1)`)]);

export const encyclopediaClaimRelations = sqliteTable("encyclopedia_claim_relations", {
  fromClaimId: text("from_claim_id").notNull().references(() => encyclopediaClaims.id, { onDelete: "cascade" }), toClaimId: text("to_claim_id").notNull().references(() => encyclopediaClaims.id, { onDelete: "cascade" }),
  relationType: text("relation_type", { enum: RELATION_TYPES }).notNull(), metadata: jsonObject("metadata"), createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.fromClaimId, t.toClaimId, t.relationType] }), index("encyclopedia_claim_relations_to_idx").on(t.toClaimId), check("encyclopedia_claim_relations_not_self", sql`${t.fromClaimId} <> ${t.toClaimId}`)]);

export const encyclopediaArticles = sqliteTable("encyclopedia_articles", {
  id: id(), topicId: text("topic_id").notNull().references(() => encyclopediaTopics.id, { onDelete: "cascade" }), title: text("title").notNull(), slug: text("slug").notNull(),
  status: text("status", { enum: ARTICLE_STATUSES }).default("draft").notNull(), currentRevisionId: text("current_revision_id").references((): AnySQLiteColumn => encyclopediaArticleRevisions.id, { onDelete: "set null" }),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [uniqueIndex("encyclopedia_articles_topic_uidx").on(t.topicId), uniqueIndex("encyclopedia_articles_slug_uidx").on(t.slug)]);

export const encyclopediaArticleRevisions = sqliteTable("encyclopedia_article_revisions", {
  id: id(), articleId: text("article_id").notNull().references(() => encyclopediaArticles.id, { onDelete: "cascade" }), revisionNumber: integer("revision_number").notNull(),
  title: text("title").notNull(), bodyMarkdown: text("body_markdown").notNull(), summary: text("summary"), generationMetadata: jsonObject("generation_metadata"), createdBy: text("created_by"), createdAt: createdAt(),
  authorKind: text("author_kind", { enum: ["ai", "human", "hybrid"] }).default("human").notNull(), contributorsJson: text("contributors_json", { mode: "json" }).$type<string[]>().default([]).notNull(), aiRunId: text("ai_run_id"),
}, (t) => [uniqueIndex("encyclopedia_article_revisions_number_uidx").on(t.articleId, t.revisionNumber), check("encyclopedia_article_revisions_number_positive", sql`${t.revisionNumber} > 0`)]);

export const encyclopediaArticleTranslations = sqliteTable("encyclopedia_article_translations", {
  id: id(), sourceRevisionId: text("source_revision_id").notNull().references(() => encyclopediaArticleRevisions.id, { onDelete: "cascade" }), locale: text("locale").notNull(),
  title: text("title").notNull(), summary: text("summary"), bodyMarkdown: text("body_markdown").notNull(), status: text("status", { enum: ARTICLE_STATUSES }).default("review").notNull(),
  generationMetadata: jsonObject("generation_metadata"), createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [uniqueIndex("encyclopedia_article_translations_revision_locale_uidx").on(t.sourceRevisionId, t.locale), index("encyclopedia_article_translations_locale_status_idx").on(t.locale, t.status)]);

export const hubPublicPostTranslations = sqliteTable("hub_public_post_translations", {
  id: id(), targetType: text("target_type").notNull(), targetId: text("target_id").notNull(), sourceHash: text("source_hash").notNull(), locale: text("locale").notNull(),
  provider: text("provider").notNull(), model: text("model").notNull(), translatedText: text("translated_text").notNull(), createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [uniqueIndex("hub_post_translations_cache_uidx").on(t.targetType, t.targetId, t.sourceHash, t.locale, t.provider, t.model), index("hub_post_translations_target_idx").on(t.targetType, t.targetId, t.locale)]);

export const encyclopediaRevisionClaims = sqliteTable("encyclopedia_revision_claims", {
  revisionId: text("revision_id").notNull().references(() => encyclopediaArticleRevisions.id, { onDelete: "cascade" }), claimId: text("claim_id").notNull().references(() => encyclopediaClaims.id, { onDelete: "restrict" }),
  citationIndex: integer("citation_index"), sectionPath: jsonArray("section_path"), createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.revisionId, t.claimId] }), index("encyclopedia_revision_claims_claim_idx").on(t.claimId)]);

export const encyclopediaPipelineRuns = sqliteTable("encyclopedia_pipeline_runs", {
  id: id(), topicId: text("topic_id").references(() => encyclopediaTopics.id, { onDelete: "set null" }), sourceId: text("source_id").references(() => encyclopediaSources.id, { onDelete: "set null" }),
  runType: text("run_type").notNull(), status: text("status", { enum: PIPELINE_STATUSES }).default("queued").notNull(), input: jsonObject("input"), output: text("output", { mode: "json" }).$type<Record<string, unknown> | null>(),
  error: text("error", { mode: "json" }).$type<Record<string, unknown> | null>(), attempt: integer("attempt").default(1).notNull(), idempotencyKey: text("idempotency_key"),
  startedAt: integer("started_at", { mode: "timestamp" }), completedAt: integer("completed_at", { mode: "timestamp" }), createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [uniqueIndex("encyclopedia_pipeline_runs_idempotency_uidx").on(t.idempotencyKey), index("encyclopedia_pipeline_runs_topic_created_idx").on(t.topicId, t.createdAt), index("encyclopedia_pipeline_runs_status_idx").on(t.status), check("encyclopedia_pipeline_runs_attempt_positive", sql`${t.attempt} > 0`)]);

export const encyclopediaAiCalls = sqliteTable("encyclopedia_ai_calls", {
  id: id(), pipelineRunId: text("pipeline_run_id").references(() => encyclopediaPipelineRuns.id, { onDelete: "set null" }), provider: text("provider").notNull(), model: text("model").notNull(), purpose: text("purpose").notNull(),
  requestMetadata: jsonObject("request_metadata"), responseMetadata: jsonObject("response_metadata"), promptTokens: integer("prompt_tokens"), completionTokens: integer("completion_tokens"), costMicros: integer("cost_micros"),
  status: text("status", { enum: PIPELINE_STATUSES }).notNull(), error: text("error", { mode: "json" }).$type<Record<string, unknown> | null>(), startedAt: integer("started_at", { mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
  completedAt: integer("completed_at", { mode: "timestamp" }), createdAt: createdAt(),
}, (t) => [index("encyclopedia_ai_calls_run_idx").on(t.pipelineRunId), index("encyclopedia_ai_calls_model_idx").on(t.provider, t.model)]);

export const encyclopediaReviewFindings = sqliteTable("encyclopedia_review_findings", {
  id: id(), revisionId: text("revision_id").notNull().references(() => encyclopediaArticleRevisions.id, { onDelete: "cascade" }), claimId: text("claim_id").references(() => encyclopediaClaims.id, { onDelete: "set null" }),
  findingType: text("finding_type").notNull(), severity: text("severity", { enum: FINDING_SEVERITIES }).notNull(), status: text("status", { enum: FINDING_STATUSES }).default("open").notNull(),
  message: text("message").notNull(), location: jsonObject("location"), metadata: jsonObject("metadata"), resolvedAt: integer("resolved_at", { mode: "timestamp" }), createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [index("encyclopedia_review_findings_revision_status_idx").on(t.revisionId, t.status), index("encyclopedia_review_findings_claim_idx").on(t.claimId)]);

export type EncyclopediaTopic = typeof encyclopediaTopics.$inferSelect;
export type NewEncyclopediaTopic = typeof encyclopediaTopics.$inferInsert;
