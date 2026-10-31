import type { D1Database } from "@cloudflare/workers-types";
import { z } from "zod";

import type { Profile } from "@/lib/domain";
import { findTrustedSourceDomain } from "@/lib/encyclopedia/trusted-source-domains";
import { assessUnsourcedEligibility } from "@/lib/encyclopedia/unsourced-policy";

/*
 * Readers propose subjects; the factory writes the articles.
 *
 * Direct editing of Hubpedia is closed, and this does not open it. What a
 * submitter supplies is a subject and candidate sources — a proposal about
 * what should be researched. Every gate that decides whether an article may
 * exist runs afterwards, in the factory, and none of them can be reached
 * from this endpoint.
 *
 * Screening happens here rather than at production time so a submitter gets
 * a specific answer immediately: which URL failed, and why. A submission that
 * would certainly be rejected downstream is refused up front rather than
 * costing a run.
 *
 * Only the sourced tier is open. Source-free articles rest on a judgement
 * about whether a subject can be written safely without evidence, and moving
 * that judgement to submitters would make an unverified-text channel out of
 * a policy that exists to prevent one.
 */

export class TopicSubmissionInputError extends Error {}
export class TopicSubmissionRateLimitError extends Error {}
export class TopicSubmissionDuplicateError extends Error {}

const MAXIMUM_PER_DAY = 5;
const MINIMUM_SOURCES = 2;
const MAXIMUM_SOURCES = 6;

const submissionSchema = z.object({
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slugは英小文字と数字とハイフンで書いてください。").min(2).max(80),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(10).max(600),
  categoryLabel: z.string().trim().min(1).max(200),
  sources: z.array(z.object({
    url: z.string().url(),
    title: z.string().trim().min(1).max(300),
    notes: z.string().trim().min(1).max(500),
  })).min(MINIMUM_SOURCES).max(MAXIMUM_SOURCES),
}).strict();

export type TopicSubmissionInput = z.infer<typeof submissionSchema>;

export interface SourceScreening {
  url: string;
  accepted: boolean;
  publisher?: string;
  reason?: string;
}

export interface SubmissionScreening {
  sources: SourceScreening[];
  acceptedSources: number;
  /* Recorded so a reviewer can see the subject was checked, not only the
   * URLs: a subject that needs evidence must not arrive with sources that
   * happen to pass while the subject itself is unsuitable. */
  subjectNote: string;
}

/*
 * Publisher terms are the one thing a submitter cannot supply, because the
 * determination is a reading of a licence, recorded once per publisher. An
 * unreviewed domain is refused with the name of the domain so the submitter
 * can ask for it to be reviewed rather than guess.
 */
export function screenSubmission(input: TopicSubmissionInput): SubmissionScreening {
  const sources = input.sources.map((source): SourceScreening => {
    const trusted = findTrustedSourceDomain(source.url);
    if (!trusted) {
      let host = source.url;
      try { host = new URL(source.url).hostname; } catch { /* keep the raw string */ }
      return { url: source.url, accepted: false, reason: `${host} の利用条件は未審査です。審査済みの発行者から出典を選ぶか、この発行者の審査を依頼してください。` };
    }
    return { url: source.url, accepted: true, publisher: trusted.publisher };
  });
  const eligibility = assessUnsourcedEligibility({
    title: input.title,
    summary: input.description,
    categoryLabel: input.categoryLabel,
  });
  return {
    sources,
    acceptedSources: sources.filter((source) => source.accepted).length,
    subjectNote: eligibility.allowed
      ? "この主題は説明で書ける範囲だが、投稿からは出典つきでのみ作る。"
      : `この主題は出典が要る領域である（${eligibility.matched}）。出典つきでのみ作る。`,
  };
}

export async function submitHubpediaTopic(db: D1Database, actor: Profile, raw: unknown) {
  const parsed = submissionSchema.safeParse(raw);
  if (!parsed.success) {
    throw new TopicSubmissionInputError(parsed.error.issues[0]?.message ?? "入力を確認してください。");
  }
  const input = parsed.data;

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const recent = await db.prepare(
    "SELECT count(*) count FROM hubpedia_topic_submissions WHERE submitter_profile_id=? AND created_at>=?",
  ).bind(actor.id, since).first<{ count: number }>();
  if ((recent?.count ?? 0) >= MAXIMUM_PER_DAY) {
    throw new TopicSubmissionRateLimitError("題材の投稿が1日の上限に達しました。");
  }

  const existing = await db.prepare(
    "SELECT id,status FROM hubpedia_topic_submissions WHERE slug=? LIMIT 1",
  ).bind(input.slug).first<{ id: string; status: string }>();
  if (existing) {
    throw new TopicSubmissionDuplicateError(`「${input.slug}」は既に投稿されています（状態: ${existing.status}）。`);
  }

  const screening = screenSubmission(input);
  /* Refused here rather than downstream: without two usable sources the
   * evidence floor would stop it anyway, and the submitter learns why now. */
  if (screening.acceptedSources < MINIMUM_SOURCES) {
    throw new TopicSubmissionInputError(
      `審査済みの発行者による出典が${MINIMUM_SOURCES}件必要です。${screening.sources.filter((source) => !source.accepted).map((source) => source.reason).join(" ")}`,
    );
  }

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await db.prepare(`INSERT INTO hubpedia_topic_submissions
      (id,slug,title,description,category_label,sources_json,submitter_profile_id,status,screening_json,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,'screened',?,?,?)`)
    .bind(id, input.slug, input.title, input.description, input.categoryLabel,
      JSON.stringify(input.sources), actor.id, JSON.stringify(screening), now, now)
    .run();

  return {
    id,
    slug: input.slug,
    status: "screened" as const,
    screening,
    /* Stated in the response so the surface cannot imply otherwise: passing
     * screening is not acceptance, and nothing is published by submitting. */
    next: "自動審査を通過しました。実際に記事になるかは、出典の取得・逐語引用の照合・証拠量・品質検査を経て決まります。公開はさらに別の承認が要ります。",
  };
}

const REVIEWABLE_STATUSES = new Set(["submitted", "screened", "rejected", "queued", "produced"]);

export async function listHubpediaTopicSubmissions(db: D1Database, requestedStatus: string | null, requestedLimit: number) {
  const status = requestedStatus && REVIEWABLE_STATUSES.has(requestedStatus) ? requestedStatus : "screened";
  const limit = Math.max(1, Math.min(100, Math.floor(requestedLimit || 50)));
  const result = await db.prepare(`SELECT
      id, slug, title, description, category_label AS categoryLabel,
      sources_json AS sourcesJson, screening_json AS screeningJson,
      submitter_profile_id AS submitterProfileId, status, review_note AS reviewNote,
      batch, created_at AS createdAt, updated_at AS updatedAt
    FROM hubpedia_topic_submissions
    WHERE status=?
    ORDER BY created_at ASC
    LIMIT ?`).bind(status, limit).all<Record<string, string>>();
  return {
    status,
    submissions: result.results.map((row) => ({
      ...row,
      sources: JSON.parse(row.sourcesJson ?? "[]") as unknown,
      screening: row.screeningJson ? (JSON.parse(row.screeningJson) as unknown) : null,
      sourcesJson: undefined,
      screeningJson: undefined,
    })),
  };
}
