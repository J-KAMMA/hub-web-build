import { z } from "zod";

import { renderExpandedArticleMarkdown, type FactoryLocalizedDraft } from "./factory";
import type { FactoryUnsourcedRecord } from "./factory-research";
import { createArticleExpansionFrame, expandedArticleSchema, type ExpandedArticle } from "./generation-frame";
import { hubpediaAiJobSchema, type HubpediaAiJob } from "./llm-batch";
import { assessUnsourcedEligibility } from "./unsourced-policy";

/*
 * Source-free explanations, for subjects the unsourced policy admits.
 *
 * The generation frame is the existing expansion frame — the one written for
 * rewriting a draft without sources — because that is exactly this task, and
 * it already forbids inventing quotations, citations, statistics, dates, and
 * current claims. What is added here is the gate in front of it: a subject is
 * checked before a token is spent, so an article that could never be
 * published is never written.
 */

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const unsourcedTopicSchema = z.object({
  slug: z.string().regex(slugPattern),
  title: z.string().trim().min(1).max(200),
  /* The seed sentence the article expands. It is the author's claim about
   * what the subject is; the model elaborates rather than invents a subject. */
  summary: z.string().trim().min(10).max(600),
  topicType: z.string().trim().min(1).max(100),
  categoryLabel: z.string().trim().min(1).max(200),
}).strict();

export const unsourcedPlanSchema = z.object({
  version: z.literal(1),
  topics: z.array(unsourcedTopicSchema).min(1).max(200),
}).strict();

export type UnsourcedTopic = z.infer<typeof unsourcedTopicSchema>;

export interface UnsourcedPlanGate {
  accepted: UnsourcedTopic[];
  rejected: Array<{ slug: string; reason: string; matched: string }>;
}

export function gateUnsourcedPlan(plan: z.infer<typeof unsourcedPlanSchema>): UnsourcedPlanGate {
  const accepted: UnsourcedTopic[] = [];
  const rejected: UnsourcedPlanGate["rejected"] = [];
  const seen = new Set<string>();
  for (const topic of plan.topics) {
    if (seen.has(topic.slug)) {
      rejected.push({ slug: topic.slug, reason: "Duplicate slug in the plan.", matched: topic.slug });
      continue;
    }
    seen.add(topic.slug);
    const decision = assessUnsourcedEligibility(topic);
    if (decision.allowed) accepted.push(topic);
    else rejected.push({ slug: topic.slug, reason: decision.reason, matched: decision.matched });
  }
  return { accepted, rejected };
}

/* Source-free articles are held to a higher length bar than sourced ones:
 * with no evidence to organise them, a short one is a dictionary entry. */
export const UNSOURCED_MINIMUM_CHARACTERS = 1_200;

export function planUnsourcedArticleJob(
  topic: UnsourcedTopic,
  linkTargets: ReadonlyArray<{ slug: string; title: string }>,
): HubpediaAiJob {
  const frame = createArticleExpansionFrame({
    locale: "ja",
    title: topic.title,
    summary: topic.summary,
    bodyMarkdown: `## ${topic.title}\n\n${topic.summary}`,
    category: topic.categoryLabel,
    linkTargets: linkTargets.filter((target) => target.slug !== topic.slug).slice(0, 200),
    minimumCharacters: UNSOURCED_MINIMUM_CHARACTERS,
  });
  return hubpediaAiJobSchema.parse({ slug: topic.slug, locale: "ja", system: frame.system, prompt: frame.prompt });
}

export function assembleUnsourcedRecord(input: {
  topic: UnsourcedTopic;
  draft: ExpandedArticle;
  allowedTargets: ReadonlyMap<string, string>;
  eligibility: string;
  generatedAt?: string;
  translation?: FactoryLocalizedDraft;
}): FactoryUnsourcedRecord {
  const parsed = expandedArticleSchema.parse(input.draft);
  return {
    slug: input.topic.slug,
    topicType: input.topic.topicType,
    categoryLabel: input.topic.categoryLabel,
    title: parsed.title,
    summary: parsed.summary,
    bodyMarkdown: renderExpandedArticleMarkdown(parsed, input.allowedTargets),
    translations: input.translation ? { en: input.translation } : undefined,
    unsourced: {
      generatedAt: input.generatedAt ?? new Date().toISOString(),
      eligibility: input.eligibility,
    },
  };
}

/* Nothing in a source-free article may look like evidence. The generation
 * frame forbids inventing citations, but a rule that matters is checked
 * rather than trusted: a citation marker or a bare URL in the body would
 * present the text as sourced when it is not. */
export function auditUnsourcedRecord(record: FactoryUnsourcedRecord): string[] {
  const issues: string[] = [];
  const bodies: Array<[string, string]> = [["ja", record.bodyMarkdown]];
  if (record.translations?.en) bodies.push(["en", record.translations.en.bodyMarkdown]);
  for (const [locale, body] of bodies) {
    if (/\\?\[\d+\\?\]/u.test(body)) issues.push(`${record.slug}:${locale} carries a citation marker but has no sources.`);
    if (/https?:\/\//u.test(body)) issues.push(`${record.slug}:${locale} carries an external link but has no sources.`);
    if (/##\s*(出典|参考文献|Sources|References)/iu.test(body)) issues.push(`${record.slug}:${locale} has a sources section but has no sources.`);
  }
  const decision = assessUnsourcedEligibility({
    title: record.title,
    summary: record.summary,
    topicType: record.topicType,
    categoryLabel: record.categoryLabel,
  });
  /* The subject is judged again on the finished article: generation can drift
   * a concept into named people or dated events, and the eligibility that
   * admitted the topic no longer describes what was written. */
  if (!decision.allowed) issues.push(`${record.slug}: the finished article is no longer eligible to be unsourced — ${decision.reason}`);
  return issues;
}
