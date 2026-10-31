import type { D1Database } from "@cloudflare/workers-types";
import type { Profile } from "@/lib/domain";
import { notGatedSql } from "@/lib/server/gated-exits";

export class HubpediaCandidateInputError extends Error {}
export class HubpediaCandidateRateLimitError extends Error {}

type CandidateSourceType = "social_post" | "thread_post";
export type HubpediaCandidateStatus = "queued" | "reviewing" | "accepted" | "rejected" | "merged";

export interface HubpediaArticleCandidate {
  id: string;
  sourceType: CandidateSourceType;
  sourceId: string;
  proposedTitle: string;
  sourceExcerpt: string;
  proposerProfileId: string;
  signalCount: number;
  status: HubpediaCandidateStatus;
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
  evidenceStatus: "unverified_source_signal";
  publicationBlocked: true;
}

function proposedTitle(value: unknown, excerpt: string) {
  const supplied = typeof value === "string" ? value.normalize("NFC").trim() : "";
  const fallback = excerpt.split(/\r?\n/u).map((part) => part.trim()).find(Boolean) ?? "";
  const title = (supplied || fallback).replace(/\s+/gu, " ").slice(0, 160);
  if (title.length < 2) throw new HubpediaCandidateInputError("記事候補の題名を入力してください。");
  return title;
}

// Gated bodies never become Hubpedia evidence, so a gated source reads as missing.
async function authoritativeSource(db: D1Database, sourceType: CandidateSourceType, sourceId: string) {
  if (sourceType === "social_post") {
    return db.prepare(
      `SELECT body FROM social_posts WHERE id=? AND moderated_at IS NULL AND ${notGatedSql("post", "social_posts.id")} LIMIT 1`,
    )
      .bind(sourceId).first<{ body: string }>();
  }
  return db.prepare(
    `SELECT body FROM thread_posts WHERE id=? AND deleted_at IS NULL AND moderated_at IS NULL AND ${notGatedSql("thread", "thread_posts.thread_id")} LIMIT 1`,
  )
    .bind(sourceId).first<{ body: string }>();
}

function reviewEnvelope<T extends object>(candidate: T) {
  return {
    ...candidate,
    evidenceStatus: "unverified_source_signal" as const,
    publicationBlocked: true as const,
  };
}

export async function submitHubpediaArticleCandidate(
  db: D1Database,
  actor: Profile,
  input: Record<string, unknown>,
) {
  const sourceType = input.sourceType;
  if (sourceType !== "social_post" && sourceType !== "thread_post") {
    throw new HubpediaCandidateInputError("対応していない投稿種別です。");
  }
  const sourceId = typeof input.sourceId === "string" ? input.sourceId.trim() : "";
  if (!sourceId || sourceId.length > 200) throw new HubpediaCandidateInputError("投稿を確認できません。");

  const source = await authoritativeSource(db, sourceType, sourceId);
  const excerpt = source?.body?.normalize("NFC").trim().slice(0, 2000) ?? "";
  if (!excerpt) throw new HubpediaCandidateInputError("公開中の投稿を確認できません。");

  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const recent = await db.prepare(
    "SELECT count(*) count FROM hubpedia_article_candidate_signals WHERE profile_id=? AND created_at>=?",
  ).bind(actor.id, since).first<{ count: number }>();
  if ((recent?.count ?? 0) >= 12) throw new HubpediaCandidateRateLimitError("記事候補の提案回数が上限に達しました。");

  const existing = await db.prepare(
    "SELECT id,status FROM hubpedia_article_candidates WHERE source_type=? AND source_id=? LIMIT 1",
  ).bind(sourceType, sourceId).first<{ id: string; status: string }>();
  const now = new Date().toISOString();
  if (existing) {
    const signal = await db.prepare(
      "INSERT OR IGNORE INTO hubpedia_article_candidate_signals(candidate_id,profile_id,created_at) VALUES(?,?,?)",
    ).bind(existing.id, actor.id, now).run();
    if (signal.meta.changes) {
      await db.prepare(
        "UPDATE hubpedia_article_candidates SET signal_count=signal_count+1,updated_at=? WHERE id=?",
      ).bind(now, existing.id).run();
    }
    return reviewEnvelope({
      id: existing.id,
      status: existing.status,
      duplicate: !signal.meta.changes,
    });
  }

  const id = crypto.randomUUID();
  const title = proposedTitle(input.title, excerpt);
  await db.batch([
    db.prepare(`INSERT INTO hubpedia_article_candidates
      (id,source_type,source_id,proposed_title,source_excerpt,proposer_profile_id,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?)`)
      .bind(id, sourceType, sourceId, title, excerpt, actor.id, now, now),
    db.prepare(
      "INSERT INTO hubpedia_article_candidate_signals(candidate_id,profile_id,created_at) VALUES(?,?,?)",
    ).bind(id, actor.id, now),
  ]);
  return reviewEnvelope({ id, status: "queued", duplicate: false });
}

const CANDIDATE_STATUSES = new Set<HubpediaCandidateStatus>([
  "queued", "reviewing", "accepted", "rejected", "merged",
]);

export async function listHubpediaArticleCandidates(
  db: D1Database,
  requestedStatus: string | null,
  requestedLimit: number,
) {
  const status = requestedStatus && CANDIDATE_STATUSES.has(requestedStatus as HubpediaCandidateStatus)
    ? requestedStatus as HubpediaCandidateStatus
    : "queued";
  const limit = Math.max(1, Math.min(100, Math.floor(requestedLimit || 50)));
  const result = await db.prepare(`SELECT
      id,
      source_type AS sourceType,
      source_id AS sourceId,
      proposed_title AS proposedTitle,
      source_excerpt AS sourceExcerpt,
      proposer_profile_id AS proposerProfileId,
      signal_count AS signalCount,
      status,
      review_note AS reviewNote,
      reviewed_at AS reviewedAt,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM hubpedia_article_candidates
    WHERE status=?
    ORDER BY signal_count DESC, created_at ASC
    LIMIT ?`).bind(status, limit).all<HubpediaArticleCandidate>();
  return {
    status,
    candidates: result.results.map((candidate) => reviewEnvelope(candidate)),
  };
}

export async function reviewHubpediaArticleCandidate(
  db: D1Database,
  candidateId: string,
  input: Record<string, unknown>,
) {
  const status = input.status;
  if (status !== "reviewing" && status !== "accepted" && status !== "rejected" && status !== "merged") {
    throw new HubpediaCandidateInputError("審査状態が正しくありません。");
  }
  const id = candidateId.trim();
  if (!id || id.length > 200) throw new HubpediaCandidateInputError("記事候補を確認できません。");
  const note = typeof input.note === "string" ? input.note.normalize("NFC").trim().slice(0, 1000) : "";
  const now = new Date().toISOString();
  const result = await db.prepare(`UPDATE hubpedia_article_candidates
    SET status=?,review_note=?,reviewed_at=?,updated_at=?
    WHERE id=? AND status IN ('queued','reviewing','accepted')`)
    .bind(status, note || null, now, now, id).run();
  if (!result.meta.changes) throw new HubpediaCandidateInputError("審査できる記事候補が見つかりません。");
  const candidate = await db.prepare(`SELECT
      id,source_type AS sourceType,source_id AS sourceId,proposed_title AS proposedTitle,
      signal_count AS signalCount,status,review_note AS reviewNote,reviewed_at AS reviewedAt
    FROM hubpedia_article_candidates WHERE id=? LIMIT 1`).bind(id).first();
  if (!candidate) throw new HubpediaCandidateInputError("記事候補を確認できません。");
  return reviewEnvelope(candidate);
}
