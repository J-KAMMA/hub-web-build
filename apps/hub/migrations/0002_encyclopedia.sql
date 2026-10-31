CREATE TABLE `encyclopedia_ai_calls` (
	`id` text PRIMARY KEY NOT NULL,
	`pipeline_run_id` text,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`purpose` text NOT NULL,
	`request_metadata` text DEFAULT '{}' NOT NULL,
	`response_metadata` text DEFAULT '{}' NOT NULL,
	`prompt_tokens` integer,
	`completion_tokens` integer,
	`cost_micros` integer,
	`status` text NOT NULL,
	`error` text,
	`started_at` integer NOT NULL,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`pipeline_run_id`) REFERENCES `encyclopedia_pipeline_runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `encyclopedia_ai_calls_run_idx` ON `encyclopedia_ai_calls` (`pipeline_run_id`);--> statement-breakpoint
CREATE INDEX `encyclopedia_ai_calls_model_idx` ON `encyclopedia_ai_calls` (`provider`,`model`);--> statement-breakpoint
CREATE TABLE `encyclopedia_article_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`article_id` text NOT NULL,
	`revision_number` integer NOT NULL,
	`title` text NOT NULL,
	`body_markdown` text NOT NULL,
	`summary` text,
	`generation_metadata` text DEFAULT '{}' NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`article_id`) REFERENCES `encyclopedia_articles`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "encyclopedia_article_revisions_number_positive" CHECK("encyclopedia_article_revisions"."revision_number" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `encyclopedia_article_revisions_number_uidx` ON `encyclopedia_article_revisions` (`article_id`,`revision_number`);--> statement-breakpoint
CREATE TABLE `encyclopedia_article_translations` (
	`id` text PRIMARY KEY NOT NULL,
	`source_revision_id` text NOT NULL,
	`locale` text NOT NULL,
	`title` text NOT NULL,
	`summary` text,
	`body_markdown` text NOT NULL,
	`status` text DEFAULT 'review' NOT NULL,
	`generation_metadata` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`source_revision_id`) REFERENCES `encyclopedia_article_revisions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `encyclopedia_article_translations_revision_locale_uidx` ON `encyclopedia_article_translations` (`source_revision_id`,`locale`);--> statement-breakpoint
CREATE INDEX `encyclopedia_article_translations_locale_status_idx` ON `encyclopedia_article_translations` (`locale`,`status`);--> statement-breakpoint
CREATE TABLE `encyclopedia_articles` (
	`id` text PRIMARY KEY NOT NULL,
	`topic_id` text NOT NULL,
	`title` text NOT NULL,
	`slug` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`current_revision_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`topic_id`) REFERENCES `encyclopedia_topics`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`current_revision_id`) REFERENCES `encyclopedia_article_revisions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `encyclopedia_articles_topic_uidx` ON `encyclopedia_articles` (`topic_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `encyclopedia_articles_slug_uidx` ON `encyclopedia_articles` (`slug`);--> statement-breakpoint
CREATE TABLE `encyclopedia_claim_evidence` (
	`claim_id` text NOT NULL,
	`chunk_id` text NOT NULL,
	`stance` text NOT NULL,
	`quote` text,
	`relevance` real,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`claim_id`, `chunk_id`),
	FOREIGN KEY (`claim_id`) REFERENCES `encyclopedia_claims`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chunk_id`) REFERENCES `encyclopedia_source_chunks`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "encyclopedia_evidence_relevance_range" CHECK("encyclopedia_claim_evidence"."relevance" IS NULL OR ("encyclopedia_claim_evidence"."relevance" >= 0 AND "encyclopedia_claim_evidence"."relevance" <= 1))
);
--> statement-breakpoint
CREATE INDEX `encyclopedia_claim_evidence_chunk_idx` ON `encyclopedia_claim_evidence` (`chunk_id`);--> statement-breakpoint
CREATE TABLE `encyclopedia_claim_relations` (
	`from_claim_id` text NOT NULL,
	`to_claim_id` text NOT NULL,
	`relation_type` text NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`from_claim_id`, `to_claim_id`, `relation_type`),
	FOREIGN KEY (`from_claim_id`) REFERENCES `encyclopedia_claims`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`to_claim_id`) REFERENCES `encyclopedia_claims`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "encyclopedia_claim_relations_not_self" CHECK("encyclopedia_claim_relations"."from_claim_id" <> "encyclopedia_claim_relations"."to_claim_id")
);
--> statement-breakpoint
CREATE INDEX `encyclopedia_claim_relations_to_idx` ON `encyclopedia_claim_relations` (`to_claim_id`);--> statement-breakpoint
CREATE TABLE `encyclopedia_claims` (
	`id` text PRIMARY KEY NOT NULL,
	`topic_id` text NOT NULL,
	`statement` text NOT NULL,
	`normalized_statement` text,
	`status` text DEFAULT 'proposed' NOT NULL,
	`confidence` real,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`topic_id`) REFERENCES `encyclopedia_topics`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "encyclopedia_claims_confidence_range" CHECK("encyclopedia_claims"."confidence" IS NULL OR ("encyclopedia_claims"."confidence" >= 0 AND "encyclopedia_claims"."confidence" <= 1))
);
--> statement-breakpoint
CREATE INDEX `encyclopedia_claims_topic_status_idx` ON `encyclopedia_claims` (`topic_id`,`status`);--> statement-breakpoint
CREATE TABLE `encyclopedia_pipeline_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`topic_id` text,
	`source_id` text,
	`run_type` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`input` text DEFAULT '{}' NOT NULL,
	`output` text,
	`error` text,
	`attempt` integer DEFAULT 1 NOT NULL,
	`idempotency_key` text,
	`started_at` integer,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`topic_id`) REFERENCES `encyclopedia_topics`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`source_id`) REFERENCES `encyclopedia_sources`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "encyclopedia_pipeline_runs_attempt_positive" CHECK("encyclopedia_pipeline_runs"."attempt" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `encyclopedia_pipeline_runs_idempotency_uidx` ON `encyclopedia_pipeline_runs` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `encyclopedia_pipeline_runs_topic_created_idx` ON `encyclopedia_pipeline_runs` (`topic_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `encyclopedia_pipeline_runs_status_idx` ON `encyclopedia_pipeline_runs` (`status`);--> statement-breakpoint
CREATE TABLE `encyclopedia_review_findings` (
	`id` text PRIMARY KEY NOT NULL,
	`revision_id` text NOT NULL,
	`claim_id` text,
	`finding_type` text NOT NULL,
	`severity` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`message` text NOT NULL,
	`location` text DEFAULT '{}' NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`resolved_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`revision_id`) REFERENCES `encyclopedia_article_revisions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`claim_id`) REFERENCES `encyclopedia_claims`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `encyclopedia_review_findings_revision_status_idx` ON `encyclopedia_review_findings` (`revision_id`,`status`);--> statement-breakpoint
CREATE INDEX `encyclopedia_review_findings_claim_idx` ON `encyclopedia_review_findings` (`claim_id`);--> statement-breakpoint
CREATE TABLE `encyclopedia_revision_claims` (
	`revision_id` text NOT NULL,
	`claim_id` text NOT NULL,
	`citation_index` integer,
	`section_path` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`revision_id`, `claim_id`),
	FOREIGN KEY (`revision_id`) REFERENCES `encyclopedia_article_revisions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`claim_id`) REFERENCES `encyclopedia_claims`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `encyclopedia_revision_claims_claim_idx` ON `encyclopedia_revision_claims` (`claim_id`);--> statement-breakpoint
CREATE TABLE `encyclopedia_source_chunks` (
	`id` text PRIMARY KEY NOT NULL,
	`snapshot_id` text NOT NULL,
	`chunk_index` integer NOT NULL,
	`heading_path` text DEFAULT '[]' NOT NULL,
	`text_content` text NOT NULL,
	`start_offset` integer NOT NULL,
	`end_offset` integer NOT NULL,
	`page_number` integer,
	`metadata` text DEFAULT '{}' NOT NULL,
	`embedding` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`snapshot_id`) REFERENCES `encyclopedia_source_snapshots`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "encyclopedia_chunks_offsets_valid" CHECK("encyclopedia_source_chunks"."start_offset" >= 0 AND "encyclopedia_source_chunks"."end_offset" >= "encyclopedia_source_chunks"."start_offset")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `encyclopedia_chunks_snapshot_index_uidx` ON `encyclopedia_source_chunks` (`snapshot_id`,`chunk_index`);--> statement-breakpoint
CREATE TABLE `encyclopedia_source_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`retrieved_at` integer NOT NULL,
	`content_hash` text NOT NULL,
	`mime_type` text,
	`object_storage_key` text,
	`extracted_text` text,
	`extraction_status` text DEFAULT 'pending' NOT NULL,
	`extraction_metadata` text DEFAULT '{}' NOT NULL,
	`canonical_url` text,
	`extracted_title` text,
	`extracted_language` text,
	`extracted_authors` text DEFAULT '[]' NOT NULL,
	`extracted_published_at` integer,
	`error` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `encyclopedia_sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `encyclopedia_snapshots_source_hash_uidx` ON `encyclopedia_source_snapshots` (`source_id`,`content_hash`);--> statement-breakpoint
CREATE INDEX `encyclopedia_snapshots_source_retrieved_idx` ON `encyclopedia_source_snapshots` (`source_id`,`retrieved_at`);--> statement-breakpoint
CREATE TABLE `encyclopedia_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`topic_id` text NOT NULL,
	`url` text NOT NULL,
	`normalized_url` text NOT NULL,
	`title` text,
	`publisher` text,
	`authors` text DEFAULT '[]' NOT NULL,
	`source_type` text NOT NULL,
	`language` text,
	`doi` text,
	`isbn` text,
	`published_at` integer,
	`license` text,
	`reliability_tier` text,
	`metadata` text DEFAULT '{}' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`topic_id`) REFERENCES `encyclopedia_topics`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `encyclopedia_sources_topic_url_uidx` ON `encyclopedia_sources` (`topic_id`,`normalized_url`);--> statement-breakpoint
CREATE INDEX `encyclopedia_sources_topic_idx` ON `encyclopedia_sources` (`topic_id`);--> statement-breakpoint
CREATE TABLE `encyclopedia_topics` (
	`id` text PRIMARY KEY NOT NULL,
	`canonical_name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text,
	`topic_type` text NOT NULL,
	`parent_topic_id` text,
	`external_ids` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'proposed' NOT NULL,
	`freshness_interval_hours` integer DEFAULT 720 NOT NULL,
	`last_researched_at` integer,
	`last_verified_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`parent_topic_id`) REFERENCES `encyclopedia_topics`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "encyclopedia_topics_freshness_positive" CHECK("encyclopedia_topics"."freshness_interval_hours" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `encyclopedia_topics_slug_uidx` ON `encyclopedia_topics` (`slug`);--> statement-breakpoint
CREATE INDEX `encyclopedia_topics_parent_idx` ON `encyclopedia_topics` (`parent_topic_id`);--> statement-breakpoint
CREATE INDEX `encyclopedia_topics_status_idx` ON `encyclopedia_topics` (`status`);--> statement-breakpoint
CREATE TABLE `hub_public_post_translations` (
	`id` text PRIMARY KEY NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`source_hash` text NOT NULL,
	`locale` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`translated_text` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `hub_post_translations_cache_uidx` ON `hub_public_post_translations` (`target_type`,`target_id`,`source_hash`,`locale`,`provider`,`model`);--> statement-breakpoint
CREATE INDEX `hub_post_translations_target_idx` ON `hub_public_post_translations` (`target_type`,`target_id`,`locale`);