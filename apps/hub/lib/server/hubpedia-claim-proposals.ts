import "server-only";
import type { D1Database } from "@cloudflare/workers-types";
import type { Profile } from "@/lib/domain";
import {
  evaluateHubItem,
  isHubEvidenceKind,
  limitQuote,
  type HubEvidenceKind,
} from "@/lib/server/hubpedia-hub-evidence";
import {
  assertCanSubmitProposal,
  createWikiProposal,
  getBaseContent,
  normalizeSourceUrls,
  WikiInputError,
} from "@/lib/server/hubpedia-wiki";

/*
 * Claim-level proposals (docs/hubpedia-hybrid/DESIGN.md section 5): add or modify a
 * claim, add supporting evidence, add refuting evidence. Each is an ordinary wiki
 * proposal (so lanes, review, conflict detection and publication are shared) plus a
 * hubpedia_claim_proposals row that says what the approval does to the claim tables.
 * Claim proposals are always reviewed by a human (patrol/operator).
 */

import type { ClaimProposalKind } from "@/lib/server/hubpedia-claim-effects";
export type { ClaimProposalKind };
export type ClaimEvidenceInput =
  | { type: "source"; url: string; quote?: string }
  | { type: "hub_item"; hubKind: HubEvidenceKind; itemId: string };

const KINDS: readonly ClaimProposalKind[] = ["add_claim", "modify_claim", "add_evidence", "add_refuting_evidence"];

const slugOf = (value: string) => {
  const slug = value.normalize("NFKC").trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,118}[a-z0-9])?$/u.test(slug)) throw new WikiInputError("Invalid article slug.");
  return slug;
};
const textOf = (value: unknown, name: string, min: number, max: number) => {
  if (typeof value !== "string") throw new WikiInputError(`${name} is required.`);
  const result = value.normalize("NFC").trim();
  if (result.length < min || result.length > max) throw new WikiInputError(`${name} has an invalid length.`);
  return result;
};

function parseEvidence(value: unknown): ClaimEvidenceInput | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object") throw new WikiInputError("evidence is invalid.");
  const raw = value as Record<string, unknown>;
  if (raw.type === "source") {
    const [url] = normalizeSourceUrls([raw.url]);
    if (!url) throw new WikiInputError("evidence.url is required.");
    const quote = typeof raw.quote === "string" && raw.quote.trim() ? limitQuote(raw.quote.normalize("NFC").trim()) : undefined;
    return { type: "source", url, quote };
  }
  if (raw.type === "hub_item") {
    if (!isHubEvidenceKind(raw.hubKind)) throw new WikiInputError("evidence.hubKind is invalid.");
    return { type: "hub_item", hubKind: raw.hubKind, itemId: textOf(raw.itemId, "evidence.itemId", 1, 200) };
  }
  throw new WikiInputError("evidence.type must be source or hub_item.");
}

/** Replace the single occurrence of `needle` in `body`; anything else is ambiguous and rejected. */
function replaceOnce(body: string, needle: string, replacement: string) {
  const first = body.indexOf(needle);
  if (first < 0 || body.indexOf(needle, first + needle.length) >= 0) {
    throw new WikiInputError("The text to replace must appear exactly once in the article.");
  }
  return body.slice(0, first) + replacement + body.slice(first + needle.length);
}

export async function submitClaimProposal(db: D1Database, actor: Profile, input: Record<string, unknown>) {
  const slug = slugOf(String(input.slug ?? ""));
  const kind = input.kind as ClaimProposalKind;
  if (!KINDS.includes(kind)) throw new WikiInputError("kind is invalid.");
  await assertCanSubmitProposal(db, actor, slug);
  const editReason = textOf(input.editSummary, "edit summary", 3, 300);
  const baseRevisionKey = textOf(input.baseRevisionKey, "base revision", 1, 100);
  const base = await getBaseContent(db, slug);
  if (!base) throw new WikiInputError("Article was not found.");
  const topic = await db.prepare("SELECT topic_id AS topicId FROM encyclopedia_articles WHERE slug = ? LIMIT 1").bind(slug).first<{ topicId: string }>();
  if (!topic) throw new WikiInputError("Claims can only be edited on stored encyclopedia articles.");

  const evidence = parseEvidence(input.evidence);
  let body = base.bodyMarkdown;
  let claimId: string | null = null;
  let statement: string | null = null;

  if (kind === "add_claim") {
    statement = textOf(input.statement, "statement", 5, 2000);
    const insertAfter = typeof input.insertAfter === "string" && input.insertAfter.trim() ? input.insertAfter : null;
    body = insertAfter
      ? replaceOnce(body, insertAfter, `${insertAfter}\n\n${statement}`)
      : `${body.trimEnd()}\n\n${statement}`;
  } else {
    claimId = textOf(input.claimId, "claimId", 1, 100);
    const claim = await db
      .prepare("SELECT statement FROM encyclopedia_claims WHERE id = ? AND topic_id = ?")
      .bind(claimId, topic.topicId)
      .first<{ statement: string }>();
    if (!claim) throw new WikiInputError("The claim does not belong to this article.");
    if (kind === "modify_claim") {
      statement = textOf(input.statement, "statement", 5, 2000);
      if (statement === claim.statement) throw new WikiInputError("The statement is unchanged.");
      const from = typeof input.replaceText === "string" && input.replaceText ? input.replaceText : claim.statement;
      body = replaceOnce(body, from, statement);
    } else if (!evidence) {
      throw new WikiInputError("evidence is required.");
    }
  }

  if (evidence?.type === "hub_item") {
    const item = await evaluateHubItem(db, evidence.hubKind, evidence.itemId);
    if (!item.eligible) throw new WikiInputError(`This Hub item cannot be used as material (${item.reason}).`);
  }
  if (body.length > 80000) throw new WikiInputError("body has an invalid length.");

  const sources = evidence?.type === "source" ? [evidence.url] : [];
  return createWikiProposal(
    db,
    actor,
    { slug, title: base.title, summary: base.summary, bodyMarkdown: body, editReason, baseRevisionKey, sources },
    {
      forceHuman: true,
      extra: (proposalId, articleKey, now) => [
        db
          .prepare(
            `INSERT INTO hubpedia_claim_proposals
               (id, proposal_id, article_key, kind, claim_id, topic_id, statement, evidence_kind, source_url, hub_kind, hub_item_id, quote, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            crypto.randomUUID(), proposalId, articleKey, kind, claimId, topic.topicId, statement,
            evidence?.type ?? null,
            evidence?.type === "source" ? evidence.url : null,
            evidence?.type === "hub_item" ? evidence.hubKind : null,
            evidence?.type === "hub_item" ? evidence.itemId : null,
            evidence?.type === "source" ? evidence.quote ?? null : null,
            now,
          ),
      ],
    },
  );
}

