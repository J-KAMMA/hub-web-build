import type { D1Database } from "@cloudflare/workers-types";
import type { Profile } from "@/lib/domain";
import {
  ensureWikiArticle,
  protectWikiArticle,
  restoreRevision,
  reviewProposal,
  WikiConflictError,
  WikiInputError,
} from "@/lib/server/hubpedia-wiki";
import {
  getActiveSuspension,
  getWikiRole,
  isActivePatrol,
  isWikiOperatorIn,
  requirePatrolRole,
  WikiPermissionError,
  type WikiRole,
} from "@/lib/server/hubpedia-wiki-policy";

/*
 * Patrol and operator actions on Hubpedia (design sections 5 and 10).
 * The owner (HUB_OPERATOR_PROFILE_IDS) appoints patrol at first; the appointment is the
 * only thing the operator door grants beyond what patrol can already do.
 */

type EnvLike = Record<string, string | undefined>;
const MAX_SUSPENSION_HOURS = 24 * 30;

const slugOf = (value: string) => {
  const slug = value.normalize("NFKC").trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,118}[a-z0-9])?$/u.test(slug)) throw new WikiInputError("Invalid article slug.");
  return slug;
};
const reasonOf = (value: unknown, name = "reason") => {
  if (typeof value !== "string") throw new WikiInputError(`${name} is required.`);
  const result = value.normalize("NFC").trim();
  if (result.length < 3 || result.length > 500) throw new WikiInputError(`${name} has an invalid length.`);
  return result;
};

function audit(db: D1Database, articleKey: string | null, actorId: string, action: string, targetId: string | null, detail: string | null, now: string) {
  return db
    .prepare("INSERT INTO hubpedia_wiki_audit(id, article_key, actor_profile_id, action, target_id, created_at, detail) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), articleKey, actorId, action, targetId, now, detail);
}

async function articleKeyOf(db: D1Database, slug: string) {
  const row = await db.prepare("SELECT article_key AS key FROM hubpedia_wiki_articles WHERE slug = ? LIMIT 1").bind(slug).first<{ key: string }>();
  return row?.key ?? null;
}

/* ---- roles and appointments ---- */

export async function getEditingStatus(db: D1Database, profileId: string, env: EnvLike = process.env) {
  const role = await getWikiRole(db, profileId, env);
  const suspension = await getActiveSuspension(db, profileId);
  const trust = await db
    .prepare("SELECT level, approved_edits AS approvedEdits, rejected_edits AS rejectedEdits FROM hubpedia_wiki_editor_trust WHERE profile_id = ?")
    .bind(profileId)
    .first<{ level: string; approvedEdits: number; rejectedEdits: number }>();
  return {
    role,
    trust: trust ?? { level: "newcomer", approvedEdits: 0, rejectedEdits: 0 },
    suspension: suspension ? { reason: suspension.reason, expiresAt: suspension.expiresAt } : null,
  };
}

/** Only the Hub operator (environment key) can appoint or revoke patrol. */
export async function appointPatrol(db: D1Database, actor: Profile, profileId: string, env: EnvLike = process.env) {
  if (!(await isWikiOperatorIn(db, actor.id, env))) throw new WikiPermissionError("Only the Hub operator can appoint patrol.");
  const target = await db.prepare("SELECT id FROM profiles WHERE id = ?").bind(profileId).first();
  if (!target) throw new WikiInputError("Profile not found.");
  const now = new Date().toISOString();
  await db.batch([
    db
      .prepare(
        `INSERT INTO hubpedia_wiki_patrol(profile_id, appointed_by, appointed_at) VALUES (?, ?, ?)
         ON CONFLICT(profile_id) DO UPDATE SET appointed_by = excluded.appointed_by, appointed_at = excluded.appointed_at,
           revoked_at = NULL, revoked_by = NULL`,
      )
      .bind(profileId, actor.id, now),
    audit(db, null, actor.id, "patrol_appointed", profileId, null, now),
  ]);
  return { profileId, appointedAt: now };
}

export async function revokePatrol(db: D1Database, actor: Profile, profileId: string, env: EnvLike = process.env) {
  if (!(await isWikiOperatorIn(db, actor.id, env))) throw new WikiPermissionError("Only the Hub operator can revoke patrol.");
  const now = new Date().toISOString();
  const result = await db
    .prepare("UPDATE hubpedia_wiki_patrol SET revoked_at = ?, revoked_by = ? WHERE profile_id = ? AND revoked_at IS NULL")
    .bind(now, actor.id, profileId)
    .run();
  if (!result.meta.changes) throw new WikiConflictError("This profile is not active patrol.");
  await audit(db, null, actor.id, "patrol_revoked", profileId, null, now).run();
  return { profileId, revokedAt: now };
}

export async function listPatrol(db: D1Database, actor: Profile, env: EnvLike = process.env) {
  await requirePatrolRole(db, actor.id, env);
  const rows = await db
    .prepare(
      `SELECT t.profile_id AS profileId, p.handle, t.appointed_at AS appointedAt
       FROM hubpedia_wiki_patrol t JOIN profiles p ON p.id = t.profile_id
       WHERE t.revoked_at IS NULL ORDER BY t.appointed_at LIMIT 200`,
    )
    .all();
  return rows.results ?? [];
}

/* ---- review ---- */

/**
 * Patrol/operator review of a pending proposal. Human-lane proposals, and AI-lane proposals the
 * AI review could not settle, are eligible. Nobody reviews their own proposal.
 */
export async function reviewProposalAs(db: D1Database, actor: Profile, proposalId: string, approve: boolean, note: unknown, env: EnvLike = process.env) {
  await requirePatrolRole(db, actor.id, env);
  const proposal = await db
    .prepare("SELECT editor_profile_id AS editor, review_lane AS lane, ai_review_status AS aiStatus FROM hubpedia_wiki_proposals WHERE id = ? AND status = 'pending'")
    .bind(proposalId)
    .first<{ editor: string; lane: string; aiStatus: string }>();
  if (!proposal) throw new WikiConflictError("Proposal is no longer pending.");
  if (proposal.editor === actor.id) throw new WikiPermissionError("You cannot review your own proposal.");
  const settledByHuman = proposal.lane === "human" || (proposal.lane === "ai" && ["human_required", "failed"].includes(proposal.aiStatus));
  if (!settledByHuman) throw new WikiConflictError("This proposal is still in an automated lane.");
  const text = typeof note === "string" ? note.trim() : "";
  if (!approve && text.length < 3) throw new WikiInputError("A rejection needs a note.");
  return reviewProposal(db, actor, proposalId, approve, text);
}

export async function listPendingPage(db: D1Database, actor: Profile, options: { limit?: number; cursor?: string | null } = {}, env: EnvLike = process.env) {
  await requirePatrolRole(db, actor.id, env);
  const limit = Math.max(1, Math.min(options.limit ?? 30, 100));
  const cursor = decodeCursor(options.cursor);
  const rows = await db
    .prepare(
      `SELECT q.id, a.slug, q.title, q.edit_reason AS editSummary, q.created_at AS createdAt, q.risk_level AS riskLevel,
         q.review_lane AS reviewLane, q.ai_review_status AS aiReviewStatus, q.conflict_status AS conflictStatus,
         q.source_urls_json AS sources, q.automated_checks AS automatedChecks, a.sensitive_category AS sensitiveCategory,
         p.handle AS submitterHandle, c.kind AS claimKind, c.claim_id AS claimId, c.statement AS claimStatement,
         c.evidence_kind AS evidenceKind, c.hub_kind AS hubKind, c.hub_item_id AS hubItemId
       FROM hubpedia_wiki_proposals q
       JOIN hubpedia_wiki_articles a ON a.article_key = q.article_key
       JOIN profiles p ON p.id = q.editor_profile_id
       LEFT JOIN hubpedia_claim_proposals c ON c.proposal_id = q.id
       WHERE q.status = 'pending' AND (q.created_at > ? OR (q.created_at = ? AND q.id > ?))
       ORDER BY q.created_at, q.id LIMIT ?`,
    )
    .bind(cursor.at, cursor.at, cursor.id, limit + 1)
    .all<Record<string, unknown> & { id: string; createdAt: string }>();
  return page(rows.results ?? [], limit);
}

/* ---- revert / protect / sensitive ---- */

export async function revertRevision(db: D1Database, actor: Profile, slugValue: string, revisionId: string, reason: unknown, env: EnvLike = process.env) {
  await requirePatrolRole(db, actor.id, env);
  const slug = slugOf(slugValue);
  const why = reasonOf(reason);
  const restored = await restoreRevision(db, actor, slug, revisionId, why);
  await audit(db, await articleKeyOf(db, slug), actor.id, "patrol_revert", restored.revisionId, why, new Date().toISOString()).run();
  return restored;
}

export async function protectAs(db: D1Database, actor: Profile, slugValue: string, until: string | null, reason: unknown, env: EnvLike = process.env) {
  await requirePatrolRole(db, actor.id, env);
  if (until !== null && (typeof until !== "string" || Number.isNaN(Date.parse(until)))) throw new WikiInputError("until is invalid.");
  return protectWikiArticle(db, actor, slugOf(slugValue), until, reasonOf(reason));
}

export async function setSensitiveCategoryAs(db: D1Database, actor: Profile, slugValue: string, category: unknown, env: EnvLike = process.env) {
  await requirePatrolRole(db, actor.id, env);
  if (category !== null && category !== "medical" && category !== "legal" && category !== "financial") throw new WikiInputError("category is invalid.");
  const slug = slugOf(slugValue);
  const key = await ensureWikiArticle(db, slug);
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("UPDATE hubpedia_wiki_articles SET sensitive_category = ?, updated_at = ? WHERE article_key = ?").bind(category, now, key),
    audit(db, key, actor.id, "sensitive_category_set", category ?? "none", null, now),
  ]);
  return { slug, sensitiveCategory: category };
}

/* ---- suspension ---- */

export async function suspendEditor(db: D1Database, actor: Profile, targetProfileId: string, reason: unknown, hours: unknown, env: EnvLike = process.env) {
  const role: WikiRole = await requirePatrolRole(db, actor.id, env);
  const why = reasonOf(reason);
  const duration = Number(hours);
  if (!Number.isFinite(duration) || duration < 1 || duration > MAX_SUSPENSION_HOURS) throw new WikiInputError(`hours must be between 1 and ${MAX_SUSPENSION_HOURS}.`);
  if (targetProfileId === actor.id) throw new WikiPermissionError("You cannot suspend yourself.");
  const target = await db.prepare("SELECT id FROM profiles WHERE id = ?").bind(targetProfileId).first();
  if (!target) throw new WikiInputError("Profile not found.");
  if (await isWikiOperatorIn(db, targetProfileId, env)) throw new WikiPermissionError("The Hub operator cannot be suspended.");
  if (role !== "operator" && (await isActivePatrol(db, targetProfileId))) throw new WikiPermissionError("Only the Hub operator can suspend patrol.");
  const nowDate = new Date(), now = nowDate.toISOString(), expiresAt = new Date(nowDate.getTime() + duration * 3600000).toISOString();
  const id = crypto.randomUUID();
  await db.batch([
    db
      .prepare("INSERT INTO hubpedia_wiki_suspensions(id, profile_id, reason, suspended_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(id, targetProfileId, why, actor.id, now, expiresAt),
    audit(db, null, actor.id, "editor_suspended", targetProfileId, `${why} (until ${expiresAt})`, now),
    db
      .prepare("INSERT INTO notifications(id, receiver_profile_id, actor_profile_id, notification_type, target_type, target_id, text, is_read, created_at) VALUES (?, ?, ?, 'system', 'system', ?, ?, 0, ?)")
      .bind(crypto.randomUUID(), targetProfileId, actor.id, id, "Hubpediaの編集が一時停止されました。", now),
  ]);
  return { id, profileId: targetProfileId, expiresAt };
}

export async function liftSuspension(db: D1Database, actor: Profile, targetProfileId: string, reason: unknown, env: EnvLike = process.env) {
  await requirePatrolRole(db, actor.id, env);
  const why = reasonOf(reason);
  const now = new Date().toISOString();
  const result = await db
    .prepare("UPDATE hubpedia_wiki_suspensions SET lifted_at = ?, lifted_by = ? WHERE profile_id = ? AND lifted_at IS NULL AND expires_at > ?")
    .bind(now, actor.id, targetProfileId, now)
    .run();
  if (!result.meta.changes) throw new WikiConflictError("This editor is not suspended.");
  await audit(db, null, actor.id, "editor_suspension_lifted", targetProfileId, why, now).run();
  return { profileId: targetProfileId, liftedAt: now };
}

/* ---- recent changes ---- */

function encodeCursor(at: string, id: string) {
  return btoa(`${at}|${id}`).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}
function decodeCursor(value: string | null | undefined, fallback: { at: string; id: string } = { at: "", id: "" }) {
  if (!value) return fallback;
  try {
    const raw = atob(value.replace(/-/gu, "+").replace(/_/gu, "/"));
    const [at, id] = raw.split("|");
    if (at && id) return { at, id };
  } catch {
    /* fall through */
  }
  throw new WikiInputError("cursor is invalid.");
}
function page<T extends { id: string; createdAt: string }>(rows: T[], limit: number) {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return { items, nextCursor: rows.length > limit && last ? encodeCursor(last.createdAt, last.id) : null };
}

/** Public feed of published revisions across Hubpedia, newest first, keyset-paged. */
export async function listRecentChanges(db: D1Database, options: { limit?: number; cursor?: string | null; authorKind?: string | null } = {}) {
  const limit = Math.max(1, Math.min(options.limit ?? 30, 100));
  const cursor = decodeCursor(options.cursor, { at: "9999-12-31T23:59:59.999Z", id: "￿" });
  const kind = options.authorKind && ["ai", "human", "hybrid"].includes(options.authorKind) ? options.authorKind : null;
  const rows = await db
    .prepare(
      `SELECT r.id, a.slug, r.title, r.revision_number AS revisionNumber, r.edit_reason AS editSummary, r.created_at AS createdAt,
         r.author_kind AS authorKind, r.restored_from_revision_id AS restoredFrom, r.proposal_id AS proposalId,
         a.sensitive_category AS sensitiveCategory,
         (SELECT json_group_array(p.handle) FROM json_each(r.contributors_json) j JOIN profiles p ON p.id = j.value) AS contributorHandles
       FROM hubpedia_wiki_revisions r JOIN hubpedia_wiki_articles a ON a.article_key = r.article_key
       WHERE r.copyright_hidden_at IS NULL AND (r.created_at < ? OR (r.created_at = ? AND r.id < ?)) AND (? IS NULL OR r.author_kind = ?)
       ORDER BY r.created_at DESC, r.id DESC LIMIT ?`,
    )
    .bind(cursor.at, cursor.at, cursor.id, kind, kind, limit + 1)
    .all<{ id: string; createdAt: string; contributorHandles: string | null } & Record<string, unknown>>();
  const result = page(rows.results ?? [], limit);
  return {
    items: result.items.map((row) => ({ ...row, contributorHandles: JSON.parse(row.contributorHandles ?? "[]") as string[] })),
    nextCursor: result.nextCursor,
  };
}
