import "server-only";

import type { D1Database } from "@cloudflare/workers-types";

import { isSelfDomainUrl, verifyHubpediaClaimEvidence } from "@/lib/server/hubpedia-memory-verification";

export class HubpediaMemoryProposalInputError extends Error {}
export class HubpediaMemoryProposalRateLimitError extends Error {}

export const HUBPEDIA_MEMORY_KINDS = [
  "claim", "source", "correction", "question", "firsthand",
] as const;
export type HubpediaMemoryKind = typeof HUBPEDIA_MEMORY_KINDS[number];
export type HubpediaMemoryProposalStatus = "queued" | "reviewing" | "accepted" | "rejected" | "merged";

type Contributor = {
  profileId: string;
  type: "human" | "agent";
  agentGrantId?: string;
};

type NormalizedProposal = {
  kind: HubpediaMemoryKind;
  title: string;
  content: string;
  quote: string;
  sourceUrls: string[];
  targetArticleSlug: string | null;
  correctsProposalId: string | null;
  answersProposalId: string | null;
  corroboratesProposalId: string | null;
  idempotencyKey: string;
};

const text = (value: unknown, max: number) =>
  typeof value === "string" ? value.normalize("NFC").trim().slice(0, max) : "";

function normalizeSourceUrls(value: unknown) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 5) {
    throw new HubpediaMemoryProposalInputError("出典URLは5件以内で入力してください。");
  }
  const urls = value.map((item) => {
    const supplied = text(item, 1000);
    let parsed: URL;
    try { parsed = new URL(supplied); } catch {
      throw new HubpediaMemoryProposalInputError("出典URLを確認してください。");
    }
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
      throw new HubpediaMemoryProposalInputError("出典URLには認証情報を含まないHTTPS URLを指定してください。");
    }
    /* The encyclopedia can never cite itself — an agent quoting Hubpedia back
     * to Hubpedia would be circular evidence, not a source. */
    if (isSelfDomainUrl(parsed.toString())) {
      throw new HubpediaMemoryProposalInputError("Hubpedia自身は出典に使えません。");
    }
    parsed.hash = "";
    return parsed.toString();
  });
  return [...new Set(urls)];
}

export function normalizeHubpediaMemoryProposal(input: Record<string, unknown>): NormalizedProposal {
  const kind = String(input.kind ?? "");
  if (!HUBPEDIA_MEMORY_KINDS.includes(kind as HubpediaMemoryKind)) {
    throw new HubpediaMemoryProposalInputError("記憶候補の種類を確認してください。");
  }
  const title = text(input.title, 160).replace(/\s+/gu, " ");
  if (title.length < 2) throw new HubpediaMemoryProposalInputError("題名を2文字以上で入力してください。");
  const content = text(input.content, 8000);
  if (!content) throw new HubpediaMemoryProposalInputError("記憶候補の内容を入力してください。");
  const target = text(input.targetArticleSlug, 160);
  if (target && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(target)) {
    throw new HubpediaMemoryProposalInputError("対象記事のslugを確認してください。");
  }
  const idempotencyKey = text(input.idempotencyKey, 100);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,99}$/.test(idempotencyKey)) {
    throw new HubpediaMemoryProposalInputError("再送防止キーを確認してください。");
  }
  /* A correction names the shared entry it replaces — optional, and the
   * target's existence is checked at submit time against the table itself. */
  const corrects = text(input.correctsProposalId, 200);
  if (corrects && !/^[A-Za-z0-9._:-]{1,200}$/.test(corrects)) {
    throw new HubpediaMemoryProposalInputError("訂正対象のIDを確認してください。");
  }
  /* An answer names the accepted question it resolves — the demand side of
   * the commons. Only knowledge kinds may answer; questions and corrections
   * are meta-proposals, not answers. */
  const answers = text(input.answersProposalId, 200);
  if (answers) {
    if (!/^[A-Za-z0-9._:-]{1,200}$/.test(answers)) {
      throw new HubpediaMemoryProposalInputError("回答対象のIDを確認してください。");
    }
    if (kind === "question" || kind === "correction") {
      throw new HubpediaMemoryProposalInputError("この種類の記憶候補は問いへの回答にできません。");
    }
  }
  /* A replication names the accepted entry it independently verified —
   * the peer-review record of the research institution. Same eligibility
   * rules as answers: knowledge kinds only, accepted targets only. */
  const corroborates = text(input.corroboratesProposalId, 200);
  if (corroborates) {
    if (!/^[A-Za-z0-9._:-]{1,200}$/.test(corroborates)) {
      throw new HubpediaMemoryProposalInputError("追試対象のIDを確認してください。");
    }
    if (kind === "question" || kind === "correction") {
      throw new HubpediaMemoryProposalInputError("この種類の記憶候補は追試にできません。");
    }
  }
  return {
    kind: kind as HubpediaMemoryKind,
    title,
    content,
    quote: text(input.quote, 2000),
    sourceUrls: normalizeSourceUrls(input.sourceUrls),
    targetArticleSlug: target || null,
    correctsProposalId: corrects || null,
    answersProposalId: answers || null,
    corroboratesProposalId: corroborates || null,
    idempotencyKey,
  };
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function envelope<T extends object>(proposal: T) {
  const row = proposal as { status?: unknown; evidenceStatus?: unknown };
  const shared = row.status === "accepted" || row.status === "merged";
  return {
    ...proposal,
    evidenceStatus: typeof row.evidenceStatus === "string" && row.evidenceStatus
      ? row.evidenceStatus
      : "unverified_proposal",
    /* Accepted knowledge joins the shared memory every agent may read;
     * everything else stays in the private review queue. Neither is an
     * article — publication still requires the human approval path. */
    visibility: (shared ? "agent_readers" : "reviewers_only") as "agent_readers" | "reviewers_only",
    publicationBlocked: true as const,
  };
}

export async function submitHubpediaMemoryProposal(
  db: D1Database,
  contributor: Contributor,
  input: Record<string, unknown>,
) {
  if (contributor.type === "agent" && !contributor.agentGrantId) {
    throw new HubpediaMemoryProposalInputError("AI接続の由来を確認できません。");
  }
  const proposal = normalizeHubpediaMemoryProposal(input);
  const actorKey = contributor.type === "agent"
    ? `agent:${contributor.agentGrantId}`
    : `human:${contributor.profileId}`;
  const existing = await db.prepare(`SELECT id,status,evidence_status AS evidenceStatus,
      verified_source_url AS verifiedSourceUrl FROM hubpedia_memory_proposals
    WHERE actor_key=? AND idempotency_key=? LIMIT 1`)
    .bind(actorKey, proposal.idempotencyKey)
    .first<{ id: string; status: HubpediaMemoryProposalStatus; evidenceStatus: string; verifiedSourceUrl: string | null }>();
  if (existing) return envelope({ ...existing, duplicate: true });

  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const recent = await db.prepare(`SELECT count(*) count FROM hubpedia_memory_proposals
    WHERE proposer_profile_id=? AND created_at>=?`)
    .bind(contributor.profileId, since).first<{ count: number }>();
  if ((recent?.count ?? 0) >= 20) {
    throw new HubpediaMemoryProposalRateLimitError("記憶候補の提案回数が上限に達しました。");
  }

  if (proposal.correctsProposalId) {
    const correctionTarget = await db.prepare(`SELECT id FROM hubpedia_memory_proposals
      WHERE id=? LIMIT 1`).bind(proposal.correctsProposalId).first();
    if (!correctionTarget) {
      throw new HubpediaMemoryProposalInputError("訂正対象の記憶が見つかりません。");
    }
  }

  /* An answer may only name a question the commons has already accepted —
   * agents cannot even see queued entries, so answering an invisible
   * question is rejected outright rather than silently dangling. */
  if (proposal.answersProposalId) {
    const answerTarget = await db.prepare(`SELECT id,memory_kind AS kind,status
      FROM hubpedia_memory_proposals WHERE id=? LIMIT 1`)
      .bind(proposal.answersProposalId)
      .first<{ id: string; kind: string; status: string }>();
    if (!answerTarget || answerTarget.kind !== "question"
      || (answerTarget.status !== "accepted" && answerTarget.status !== "merged")) {
      throw new HubpediaMemoryProposalInputError("回答対象の問いが見つかりません。");
    }
  }

  /* A replication may only name an entry the commons has already accepted —
   * like answers, corroborating an invisible queued entry is rejected. */
  if (proposal.corroboratesProposalId) {
    const replicationTarget = await db.prepare(`SELECT id FROM hubpedia_memory_proposals
      WHERE id=? AND memory_kind!='question' AND status IN ('accepted','merged') LIMIT 1`)
      .bind(proposal.corroboratesProposalId)
      .first<{ id: string }>();
    if (!replicationTarget) {
      throw new HubpediaMemoryProposalInputError("追試対象の記憶が見つかりません。");
    }
  }

  const fingerprint = await sha256(JSON.stringify({
    kind: proposal.kind,
    title: proposal.title.toLocaleLowerCase("ja"),
    content: proposal.content.replace(/\s+/gu, " ").toLocaleLowerCase("ja"),
    sourceUrls: proposal.sourceUrls,
    targetArticleSlug: proposal.targetArticleSlug,
  }));
  /* The claim fingerprint ignores which sources were cited, so a second
   * contributor confirming the same claim through a different source counts
   * as corroboration — stronger evidence, not a duplicate. */
  const claimFingerprint = await sha256(JSON.stringify({
    kind: proposal.kind,
    title: proposal.title.toLocaleLowerCase("ja"),
    content: proposal.content.replace(/\s+/gu, " ").toLocaleLowerCase("ja"),
    targetArticleSlug: proposal.targetArticleSlug,
  }));

  /*
   * Machine verification is only attempted when the proposal carries the one
   * thing a machine can check: a verbatim quote plus cited source URLs on
   * reviewed trusted domains. Every other shape — or any failed check — falls
   * through to the human queue unchanged.
   */
  const verification = proposal.kind === "claim" && proposal.quote && proposal.sourceUrls.length
    ? await verifyHubpediaClaimEvidence(proposal.quote, proposal.sourceUrls)
    : null;
  const machineVerified = verification?.verified === true;
  const verifiedSourceUrl = verification?.verified === true ? verification.sourceUrl : null;
  const machineNote = !verification ? null
    : verification.verified
      ? `machine: quote verified verbatim on ${verification.sourceUrl} (${verification.publisher}, ${verification.license})`
      : `machine: ${verification.reason}`;

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.prepare(`INSERT INTO hubpedia_memory_proposals
    (id,proposer_profile_id,contributor_type,agent_grant_id,actor_key,memory_kind,
     proposed_title,content,source_urls_json,target_article_slug,corrects_proposal_id,
     answers_proposal_id,corroborates_proposal_id,
     fingerprint,claim_fingerprint,idempotency_key,status,evidence_quote,evidence_status,
     verified_source_url,review_note,created_at,updated_at,reviewed_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(
      id, contributor.profileId, contributor.type, contributor.agentGrantId ?? null,
      actorKey, proposal.kind, proposal.title, proposal.content,
      JSON.stringify(proposal.sourceUrls), proposal.targetArticleSlug,
      proposal.correctsProposalId, proposal.answersProposalId, proposal.corroboratesProposalId,
      fingerprint, claimFingerprint,
      proposal.idempotencyKey, machineVerified ? "accepted" : "queued",
      proposal.quote || null, machineVerified ? "machine_verified" : "unverified_proposal",
      verifiedSourceUrl, machineNote, now, now,
      machineVerified ? now : null,
    ).run();
  /* A machine-accepted answer never passes through review — record the
   * resolution on the question here, mirroring the review path. */
  if (machineVerified && proposal.answersProposalId) {
    await db.prepare(`UPDATE hubpedia_memory_proposals
      SET answered_by=?,updated_at=? WHERE id=? AND answered_by IS NULL`)
      .bind(id, now, proposal.answersProposalId).run();
  }
  return envelope({
    id,
    status: (machineVerified ? "accepted" : "queued") as HubpediaMemoryProposalStatus,
    evidenceStatus: machineVerified ? "machine_verified" : "unverified_proposal",
    verifiedSourceUrl,
    duplicate: false,
  });
}

export async function listProfileHubpediaMemoryProposals(db: D1Database, profileId: string, limit = 20) {
  const result = await db.prepare(`SELECT id,memory_kind AS kind,proposed_title AS title,
      contributor_type AS contributorType,status,evidence_status AS evidenceStatus,
      created_at AS createdAt,reviewed_at AS reviewedAt
    FROM hubpedia_memory_proposals WHERE proposer_profile_id=?
    ORDER BY created_at DESC LIMIT ?`)
    .bind(profileId, Math.max(1, Math.min(50, Math.floor(limit)))).all();
  return { proposals: result.results.map((proposal) => envelope(proposal)) };
}

/* An agent may see only what it submitted itself — keyed by its grant, never
 * by a client-supplied profile or another grant's actor key. */
export async function listAgentHubpediaMemoryProposals(db: D1Database, agentGrantId: string, limit = 20) {
  const result = await db.prepare(`SELECT id,memory_kind AS kind,proposed_title AS title,
      status,evidence_status AS evidenceStatus,review_note AS reviewNote,
      created_at AS createdAt,reviewed_at AS reviewedAt
    FROM hubpedia_memory_proposals
    WHERE contributor_type='agent' AND agent_grant_id=?
    ORDER BY created_at DESC LIMIT ?`)
    .bind(agentGrantId, Math.max(1, Math.min(50, Math.floor(limit)))).all();
  return { proposals: result.results.map((proposal) => envelope(proposal)) };
}

/*
 * The AI-to-AI commons: knowledge another contributor proposed that cleared
 * review — human or machine. Queued and rejected material stays private.
 * Provenance stays attached (contributorType, agent label, evidence status)
 * so a reading agent can weight what it is about to reuse.
 */
export async function listHubpediaSharedMemory(
  db: D1Database,
  filter: { kind?: unknown; query?: unknown; limit?: unknown; includeSuperseded?: unknown; needsAnswer?: unknown; answersFor?: unknown; findings?: unknown } = {},
) {
  const kind = HUBPEDIA_MEMORY_KINDS.includes(filter.kind as HubpediaMemoryKind)
    ? filter.kind as HubpediaMemoryKind
    : null;
  const query = text(filter.query, 200);
  const conditions = ["p.status IN ('accepted','merged')"];
  const params: unknown[] = [];
  if (kind) { conditions.push("p.memory_kind=?"); params.push(kind); }
  if (query) {
    conditions.push("(p.proposed_title LIKE ? OR p.content LIKE ?)");
    params.push(`%${query}%`, `%${query}%`);
  }
  /* Superseded entries stay in the record but out of the current commons
   * unless the caller asks for history. */
  if (!filter.includeSuperseded) conditions.push("p.superseded_by IS NULL");
  /* needs_answer surfaces the commons' open questions — the pull-queue an
   * agent works from when it wants to improve shared knowledge. */
  if (filter.needsAnswer === true) {
    conditions.push("p.memory_kind='question' AND p.answered_by IS NULL");
  }
  /* answers_for lists the accepted answers attached to one question. */
  const answersFor = text(filter.answersFor, 200);
  if (answersFor) { conditions.push("p.answers_proposal_id=?"); params.push(answersFor); }
  /* findings surfaces the institution's official position: knowledge two or
   * more independent contributors stand behind — either same-fingerprint
   * claims from distinct actors, or an explicit replication link. */
  if (filter.findings === true) {
    conditions.push(`(
      p.claim_fingerprint IN (
        SELECT claim_fingerprint FROM hubpedia_memory_proposals
        WHERE status IN ('accepted','merged') AND claim_fingerprint IS NOT NULL
        GROUP BY claim_fingerprint HAVING COUNT(DISTINCT actor_key)>=2
      )
      OR p.id IN (
        SELECT corroborates_proposal_id FROM hubpedia_memory_proposals
        WHERE status IN ('accepted','merged') AND corroborates_proposal_id IS NOT NULL
      )
    )`);
  }
  const result = await db.prepare(`SELECT p.id,p.memory_kind AS kind,p.proposed_title AS title,
      p.content,p.source_urls_json AS sourceUrlsJson,p.target_article_slug AS targetArticleSlug,
      p.contributor_type AS contributorType,g.label AS contributorLabel,g.origin AS contributorOrigin,p.actor_key AS actorKey,
      p.claim_fingerprint AS claimFingerprint,p.corrects_proposal_id AS correctsProposalId,
      p.superseded_by AS supersededBy,
      p.answers_proposal_id AS answersProposalId,p.answered_by AS answeredBy,
      p.status,p.evidence_status AS evidenceStatus,p.verified_source_url AS verifiedSourceUrl,
      p.created_at AS createdAt,p.reviewed_at AS reviewedAt
    FROM hubpedia_memory_proposals p
    LEFT JOIN hub_agent_grants g ON g.id=p.agent_grant_id
    WHERE ${conditions.join(" AND ")}
    ORDER BY p.reviewed_at DESC LIMIT ?`)
    .bind(...params, Math.max(1, Math.min(50, Math.floor(Number(filter.limit) || 20))))
    .all<{
      id: string; kind: string; title: string; content: string;
      sourceUrlsJson: string | null; targetArticleSlug: string | null;
      contributorType: string; contributorLabel: string | null; contributorOrigin: string | null;
      actorKey: string | null; claimFingerprint: string | null;
      correctsProposalId: string | null; supersededBy: string | null;
      answersProposalId: string | null; answeredBy: string | null;
      status: string; evidenceStatus: string | null; verifiedSourceUrl: string | null;
      createdAt: string; reviewedAt: string | null;
    }>();
  const rows = result.results;

  /* Corroboration: other contributors' accepted proposals carrying the same
   * claim fingerprint. Batched — one query for the whole page, grouped in JS. */
  const fingerprints = [...new Set(rows.map((row) => String(row.claimFingerprint ?? "")).filter(Boolean))];
  const corroborations = new Map<string, Array<{ actorKey: string; contributorType: string; contributorLabel: string | null; contributorOrigin: string | null; evidenceStatus: string }>>();
  if (fingerprints.length) {
    const found = await db.prepare(`SELECT c.claim_fingerprint AS claimFingerprint,
        c.contributor_type AS contributorType,cg.label AS contributorLabel,cg.origin AS contributorOrigin,
        c.evidence_status AS evidenceStatus,c.actor_key AS actorKey
      FROM hubpedia_memory_proposals c
      LEFT JOIN hub_agent_grants cg ON cg.id=c.agent_grant_id
      WHERE c.claim_fingerprint IN (${fingerprints.map(() => "?").join(",")})
        AND c.status IN ('accepted','merged')`)
      .bind(...fingerprints).all<Record<string, unknown>>();
    for (const item of found.results) {
      const list = corroborations.get(String(item.claimFingerprint)) ?? [];
      list.push({
        actorKey: String(item.actorKey ?? ""),
        contributorType: String(item.contributorType),
        contributorLabel: item.contributorLabel == null ? null : String(item.contributorLabel),
        contributorOrigin: item.contributorOrigin == null ? null : String(item.contributorOrigin),
        evidenceStatus: String(item.evidenceStatus ?? "unverified_proposal"),
      });
      corroborations.set(String(item.claimFingerprint), list);
    }
  }

  /* Explicit replications: accepted proposals that named one of this page's
   * entries as the thing they independently verified. Same contributor shape
   * as fingerprint corroboration; merged and deduplicated per row below. */
  const rowIds = rows.map((row) => row.id);
  const replications = new Map<string, Array<{ actorKey: string; contributorType: string; contributorLabel: string | null; contributorOrigin: string | null; evidenceStatus: string }>>();
  if (rowIds.length) {
    const found = await db.prepare(`SELECT c.corroborates_proposal_id AS targetId,
        c.contributor_type AS contributorType,cg.label AS contributorLabel,cg.origin AS contributorOrigin,
        c.evidence_status AS evidenceStatus,c.actor_key AS actorKey
      FROM hubpedia_memory_proposals c
      LEFT JOIN hub_agent_grants cg ON cg.id=c.agent_grant_id
      WHERE c.corroborates_proposal_id IN (${rowIds.map(() => "?").join(",")})
        AND c.status IN ('accepted','merged')`)
      .bind(...rowIds).all<Record<string, unknown>>();
    for (const item of found.results) {
      const list = replications.get(String(item.targetId)) ?? [];
      list.push({
        actorKey: String(item.actorKey ?? ""),
        contributorType: String(item.contributorType),
        contributorLabel: item.contributorLabel == null ? null : String(item.contributorLabel),
        contributorOrigin: item.contributorOrigin == null ? null : String(item.contributorOrigin),
        evidenceStatus: String(item.evidenceStatus ?? "unverified_proposal"),
      });
      replications.set(String(item.targetId), list);
    }
  }

  /* Track record, not privilege: each contributor's accept/reject counts are
   * shown so a reader can weigh the entry — they grant no powers. */
  const actorKeys = [...new Set(rows.map((row) => String(row.actorKey ?? "")).filter(Boolean))];
  const records = new Map<string, { total: number; accepted: number; machineVerified: number; rejected: number }>();
  if (actorKeys.length) {
    const stats = await db.prepare(`SELECT actor_key AS actorKey,COUNT(*) AS total,
        SUM(status IN ('accepted','merged')) AS accepted,
        SUM(evidence_status='machine_verified') AS machineVerified,
        SUM(status='rejected') AS rejected
      FROM hubpedia_memory_proposals
      WHERE actor_key IN (${actorKeys.map(() => "?").join(",")})
      GROUP BY actor_key`)
      .bind(...actorKeys).all<Record<string, unknown>>();
    for (const stat of stats.results) {
      records.set(String(stat.actorKey), {
        total: Number(stat.total ?? 0), accepted: Number(stat.accepted ?? 0),
        machineVerified: Number(stat.machineVerified ?? 0), rejected: Number(stat.rejected ?? 0),
      });
    }
  }

  /* Accepted answers per question — a question with several answers carries
   * convergent evidence; one with none is still an open request. */
  const questionIds = rows.filter((row) => row.kind === "question").map((row) => row.id);
  const answerCounts = new Map<string, number>();
  if (questionIds.length) {
    const counts = await db.prepare(`SELECT answers_proposal_id AS answersProposalId,
        COUNT(*) AS answerCount
      FROM hubpedia_memory_proposals
      WHERE answers_proposal_id IN (${questionIds.map(() => "?").join(",")})
        AND status IN ('accepted','merged')
      GROUP BY answers_proposal_id`)
      .bind(...questionIds).all<Record<string, unknown>>();
    for (const item of counts.results) {
      answerCounts.set(String(item.answersProposalId), Number(item.answerCount ?? 0));
    }
  }

  return {
    entries: rows.map((row) => {
      const { actorKey, sourceUrlsJson, ...entry } = row;
      const claimFingerprint = String(row.claimFingerprint ?? "");
      /* Implicit (same-fingerprint) and explicit (replication link) support
       * merge into one corroborator list — deduplicated by actor so a
       * contributor who both restated and replicated counts once. */
      const seen = new Set<string>();
      const corroborators = [
        ...(corroborations.get(claimFingerprint) ?? []),
        ...(replications.get(row.id) ?? []),
      ]
        .filter((item) => item.actorKey !== actorKey && !seen.has(item.actorKey) && seen.add(item.actorKey))
        .map(({ contributorType, contributorLabel, contributorOrigin, evidenceStatus }) =>
          ({ contributorType, contributorLabel, contributorOrigin, evidenceStatus }));
      return envelope({
        ...entry,
        sourceUrls: JSON.parse(String(sourceUrlsJson ?? "[]")),
        corroborationCount: corroborators.length,
        corroborators,
        contributorRecord: records.get(String(actorKey)) ?? null,
        ...(row.kind === "question" ? { answerCount: answerCounts.get(row.id) ?? 0 } : {}),
      });
    }),
  };
}

/*
 * The directorate's work program: what the institution most needs next.
 * openQuestions are unanswered demand; awaitingReplication lists accepted
 * knowledge no second contributor has verified yet — the peer-review queue.
 * stats keep the institution honest about its own size and makeup.
 */
export async function getHubpediaResearchAgenda(db: D1Database) {
  const { entries: openQuestions } = await listHubpediaSharedMemory(db, {
    needsAnswer: true, limit: 10,
  });
  const awaiting = await db.prepare(`SELECT p.id,p.memory_kind AS kind,
      p.proposed_title AS title,p.contributor_type AS contributorType,
      g.label AS contributorLabel,g.origin AS contributorOrigin,
      p.evidence_status AS evidenceStatus,p.reviewed_at AS reviewedAt
    FROM hubpedia_memory_proposals p
    LEFT JOIN hub_agent_grants g ON g.id=p.agent_grant_id
    WHERE p.status IN ('accepted','merged') AND p.superseded_by IS NULL
      AND p.memory_kind!='question'
      AND (p.claim_fingerprint IS NULL OR p.claim_fingerprint IN (
        SELECT claim_fingerprint FROM hubpedia_memory_proposals
        WHERE status IN ('accepted','merged') AND claim_fingerprint IS NOT NULL
        GROUP BY claim_fingerprint HAVING COUNT(DISTINCT actor_key)=1
      ))
      AND p.id NOT IN (
        SELECT corroborates_proposal_id FROM hubpedia_memory_proposals
        WHERE status IN ('accepted','merged') AND corroborates_proposal_id IS NOT NULL
      )
    ORDER BY p.reviewed_at ASC LIMIT 10`).all<Record<string, unknown>>();
  const stats = await db.prepare(`SELECT
      COUNT(*) AS entries,
      SUM(p.evidence_status='machine_verified') AS machineVerified,
      SUM(p.memory_kind='question' AND p.answered_by IS NULL) AS openQuestions,
      COUNT(DISTINCT p.actor_key) AS contributors,
      COUNT(DISTINCT CASE WHEN g.origin='external' THEN p.actor_key END) AS externalContributors
    FROM hubpedia_memory_proposals p
    LEFT JOIN hub_agent_grants g ON g.id=p.agent_grant_id
    WHERE p.status IN ('accepted','merged')`)
    .first<Record<string, unknown>>();
  return envelope({
    openQuestions,
    awaitingReplication: awaiting.results,
    stats: {
      entries: Number(stats?.entries ?? 0),
      machineVerified: Number(stats?.machineVerified ?? 0),
      openQuestions: Number(stats?.openQuestions ?? 0),
      contributors: Number(stats?.contributors ?? 0),
      externalContributors: Number(stats?.externalContributors ?? 0),
    },
  });
}

const REVIEW_STATUSES = new Set<HubpediaMemoryProposalStatus>([
  "queued", "reviewing", "accepted", "rejected", "merged",
]);

export async function listHubpediaMemoryProposals(
  db: D1Database,
  requestedStatus: string | null,
  requestedLimit: number,
) {
  const status = requestedStatus && REVIEW_STATUSES.has(requestedStatus as HubpediaMemoryProposalStatus)
    ? requestedStatus as HubpediaMemoryProposalStatus
    : "queued";
  const limit = Math.max(1, Math.min(100, Math.floor(requestedLimit || 50)));
  const result = await db.prepare(`SELECT p.id,p.memory_kind AS kind,p.proposed_title AS title,
      p.content,p.source_urls_json AS sourceUrlsJson,p.target_article_slug AS targetArticleSlug,
      p.contributor_type AS contributorType,p.proposer_profile_id AS proposerProfileId,
      p.agent_grant_id AS agentGrantId,g.label AS agentLabel,g.source AS agentSource,
      p.status,p.review_note AS reviewNote,p.created_at AS createdAt,p.reviewed_at AS reviewedAt,
      p.evidence_quote AS evidenceQuote,p.evidence_status AS evidenceStatus,
      p.verified_source_url AS verifiedSourceUrl
    FROM hubpedia_memory_proposals p
    LEFT JOIN hub_agent_grants g ON g.id=p.agent_grant_id
    WHERE p.status=? ORDER BY p.created_at ASC LIMIT ?`)
    .bind(status, limit).all<Record<string, unknown>>();
  return {
    status,
    proposals: result.results.map((row) => envelope({
      ...row,
      sourceUrls: JSON.parse(String(row.sourceUrlsJson ?? "[]")),
      sourceUrlsJson: undefined,
    })),
  };
}

export async function reviewHubpediaMemoryProposal(
  db: D1Database,
  proposalId: string,
  input: Record<string, unknown>,
) {
  const status = String(input.status ?? "");
  if (!["reviewing", "accepted", "rejected", "merged"].includes(status)) {
    throw new HubpediaMemoryProposalInputError("審査状態が正しくありません。");
  }
  const id = proposalId.trim();
  if (!id || id.length > 200) throw new HubpediaMemoryProposalInputError("記憶候補を確認できません。");
  const note = text(input.note, 1000);
  const now = new Date().toISOString();
  const result = await db.prepare(`UPDATE hubpedia_memory_proposals
    SET status=?,review_note=?,reviewed_at=?,updated_at=?
    WHERE id=? AND status IN ('queued','reviewing','accepted')`)
    .bind(status, note || null, now, now, id).run();
  if (!result.meta.changes) throw new HubpediaMemoryProposalInputError("審査できる記憶候補が見つかりません。");
  /* An accepted correction retires the entry it named. The old row keeps its
   * status and gains superseded_by — the record stays honest about having
   * been current once, while the shared-memory view drops it by default. */
  if (status === "accepted" || status === "merged") {
    const row = await db.prepare(`SELECT corrects_proposal_id AS correctsProposalId,
        answers_proposal_id AS answersProposalId
      FROM hubpedia_memory_proposals WHERE id=?`).bind(id)
      .first<{ correctsProposalId: string | null; answersProposalId: string | null }>();
    if (row?.correctsProposalId) {
      await db.prepare(`UPDATE hubpedia_memory_proposals
        SET superseded_by=?,updated_at=? WHERE id=? AND superseded_by IS NULL`)
        .bind(id, now, row.correctsProposalId).run();
    }
    /* The first accepted answer resolves the question; later answers remain
     * as additional knowledge but do not steal the answered_by link. */
    if (row?.answersProposalId) {
      await db.prepare(`UPDATE hubpedia_memory_proposals
        SET answered_by=?,updated_at=? WHERE id=? AND answered_by IS NULL`)
        .bind(id, now, row.answersProposalId).run();
    }
  }
  return envelope({ id, status: status as HubpediaMemoryProposalStatus, reviewNote: note || null, reviewedAt: now });
}
