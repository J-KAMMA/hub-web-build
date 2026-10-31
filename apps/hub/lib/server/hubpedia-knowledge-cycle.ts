import type { D1Database } from "@cloudflare/workers-types";

import type { Profile } from "@/lib/domain";

export class HubpediaKnowledgeCycleInputError extends Error {}

const SLUG = /^[a-z0-9][a-z0-9-]{0,159}$/;

export function normalizeKnowledgeArticleSlug(value: unknown) {
  const slug = typeof value === "string"
    ? value.normalize("NFKC").trim().toLowerCase()
    : "";
  if (!SLUG.test(slug)) {
    throw new HubpediaKnowledgeCycleInputError("記事を確認できませんでした。");
  }
  return slug;
}

export async function listHubpediaArticleDiscussions(
  db: D1Database,
  slugValue: unknown,
) {
  const slug = normalizeKnowledgeArticleSlug(slugValue);
  const rows = await db.prepare(`
    SELECT
      d.thread_id threadId,
      t.title,
      t.status,
      t.post_count postCount,
      t.updated_at updatedAt
    FROM hubpedia_article_discussions d
    JOIN threads t ON t.id=d.thread_id
    WHERE d.article_slug=? AND d.status='active' AND t.status<>'archived'
    ORDER BY t.updated_at DESC
    LIMIT 50
  `).bind(slug).all();
  return { slug, discussions: rows.results ?? [] };
}

export async function linkHubpediaArticleDiscussion(
  db: D1Database,
  actor: Profile,
  slugValue: unknown,
  threadIdValue: unknown,
) {
  const slug = normalizeKnowledgeArticleSlug(slugValue);
  const threadId = typeof threadIdValue === "string"
    ? threadIdValue.trim()
    : "";
  if (!threadId || threadId.length > 200) {
    throw new HubpediaKnowledgeCycleInputError("スレッドを確認できませんでした。");
  }
  const thread = await db.prepare(`
    SELECT id
    FROM threads
    WHERE id=? AND created_by_profile_id=? AND status<>'archived'
    LIMIT 1
  `).bind(threadId, actor.id).first<{ id: string }>();
  if (!thread) {
    throw new HubpediaKnowledgeCycleInputError(
      "自分が作成した公開スレッドだけを関連付けできます。",
    );
  }
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await db.batch([
    db.prepare(`
      INSERT INTO hubpedia_article_discussions
        (article_slug,thread_id,created_by_profile_id,status,created_at,updated_at)
      VALUES(?,?,?,'active',?,?)
      ON CONFLICT(article_slug,thread_id)
      DO UPDATE SET status='active',updated_at=excluded.updated_at
    `).bind(slug, threadId, actor.id, now, now),
    db.prepare(`
      INSERT INTO hubpedia_social_knowledge_links
        (id,article_slug,source_type,source_id,relation,proposed_by_profile_id,
         reviewed_by_profile_id,status,created_at,reviewed_at)
      VALUES(?,?, 'thread',?,'discussion',?,?, 'accepted',?,?)
      ON CONFLICT(article_slug,source_type,source_id,relation)
      DO UPDATE SET status='accepted',reviewed_at=excluded.reviewed_at
    `).bind(id, slug, threadId, actor.id, actor.id, now, now),
  ]);
  return {
    slug,
    threadId,
    linked: true,
    evidenceStatus: "discussion_not_article_evidence" as const,
  };
}

export async function acceptHubpediaCandidateProvenance(
  db: D1Database,
  input: {
    candidateId: string;
    articleSlug: string;
    reviewerProfileId?: string | null;
  },
) {
  const slug = normalizeKnowledgeArticleSlug(input.articleSlug);
  const candidate = await db.prepare(`
    SELECT source_type sourceType,source_id sourceId,proposer_profile_id proposerId
    FROM hubpedia_article_candidates
    WHERE id=? AND status IN ('accepted','merged')
    LIMIT 1
  `).bind(input.candidateId).first<{
    sourceType: "social_post" | "thread_post";
    sourceId: string;
    proposerId: string;
  }>();
  if (!candidate) {
    throw new HubpediaKnowledgeCycleInputError(
      "採用済みの候補だけを記事へ関連付けできます。",
    );
  }
  const now = new Date().toISOString();
  await db.prepare(`
    INSERT INTO hubpedia_social_knowledge_links
      (id,article_slug,source_type,source_id,relation,candidate_id,
       proposed_by_profile_id,reviewed_by_profile_id,status,created_at,reviewed_at)
    VALUES(?,?,?,?, 'origin_signal',?,?,?, 'accepted',?,?)
    ON CONFLICT(article_slug,source_type,source_id,relation)
    DO UPDATE SET candidate_id=excluded.candidate_id,status='accepted',
      reviewed_by_profile_id=excluded.reviewed_by_profile_id,
      reviewed_at=excluded.reviewed_at
  `).bind(
    crypto.randomUUID(),
    slug,
    candidate.sourceType,
    candidate.sourceId,
    input.candidateId,
    candidate.proposerId,
    input.reviewerProfileId ?? null,
    now,
    now,
  ).run();
  return {
    articleSlug: slug,
    sourceType: candidate.sourceType,
    sourceId: candidate.sourceId,
    linked: true,
    evidenceStatus: "unverified_social_origin_signal" as const,
    publicationBlockedWithoutIndependentEvidence: true as const,
  };
}
