import "server-only";

import type { D1Database } from "@cloudflare/workers-types";

import { listD1MusicWorksByIds } from "@/lib/server/d1-music";
import { isHubItemGated } from "@/lib/server/gated-exits";
import { hasPublicSocialPostOrigin } from "@/lib/server/video-public-origin";

/*
 * Hub items as Hubpedia claim evidence (docs/hubpedia-hybrid/DESIGN.md, phase 1).
 *
 * Only public material may be used (section 2). This module is the single
 * place that decides that. Every read goes through evaluateHubItem(), so the
 * rules cannot drift between capture, attach and revalidation.
 *
 * Nothing here reads another service's storage: Music is reached only through
 * the Hub's own public catalog reader, never the Music Worker's buckets.
 */

export const HUB_EVIDENCE_KINDS = [
  "post",
  "thread",
  "thread_post",
  "channel_message",
  "research_version",
  "article",
  "video",
  "music_work",
] as const;
export type HubEvidenceKind = (typeof HUB_EVIDENCE_KINDS)[number];

export const HUB_EVIDENCE_QUOTE_LIMIT = 200;

/* Social writing: capped at "provisional" unless something stronger also supports the claim. */
const SOCIAL_KINDS: ReadonlySet<string> = new Set(["post", "thread", "thread_post", "channel_message"]);
/* The only Hub items that may lift a claim above "provisional" (design section 3). */
const STRONG_KINDS: ReadonlySet<string> = new Set(["research_version"]);

export function isHubEvidenceKind(value: unknown): value is HubEvidenceKind {
  return typeof value === "string" && (HUB_EVIDENCE_KINDS as readonly string[]).includes(value);
}

export type HubItemIneligibleReason =
  | "invalid_id"
  | "not_found"
  | "not_public"
  | "deleted"
  | "moderated"
  | "no_accountable_author"
  | "author_suspended"
  | "author_deletion_requested"
  | "author_opted_out"
  | "item_opted_out"
  | "empty_content";

export type HubItemEvaluation =
  | { eligible: true; kind: HubEvidenceKind; itemId: string; authorProfileId: string; text: string }
  | { eligible: false; kind: HubEvidenceKind; itemId: string; reason: HubItemIneligibleReason };

type Loaded = { authorProfileId: string | null; text: string } | HubItemIneligibleReason;

const ITEM_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,200}$/u;

function normalizeText(value: string) {
  return value.normalize("NFC").replace(/\r\n?/gu, "\n").trim();
}

export function limitQuote(text: string) {
  return Array.from(normalizeText(text)).slice(0, HUB_EVIDENCE_QUOTE_LIMIT).join("");
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Hash of the canonical content. The kind is part of it, so equal text in two kinds never collides. */
export async function hubItemContentHash(kind: HubEvidenceKind, text: string) {
  return sha256Hex(`hubpedia-hub-item-v1\n${kind}\n${normalizeText(text)}`);
}

/* ---- per-kind loaders: one point lookup each, every public condition in the WHERE ---- */

async function loadPost(db: D1Database, id: string): Promise<Loaded> {
  const row = await db
    .prepare(
      `SELECT author_profile_id AS author, identity_mode AS identityMode, audience, moderated_at AS moderatedAt, body
       FROM social_posts WHERE id = ?`,
    )
    .bind(id)
    .first<{ author: string | null; identityMode: string; audience: string; moderatedAt: string | null; body: string }>();
  if (!row) return "not_found";
  // followers-only is not public. A repost with no body has no words of its own.
  if (row.audience !== "public") return "not_public";
  if (row.moderatedAt) return "moderated";
  if (row.identityMode !== "account" || !row.author) return "no_accountable_author";
  return { authorProfileId: row.author, text: row.body };
}

async function loadThread(db: D1Database, id: string): Promise<Loaded> {
  const thread = await db
    .prepare(
      `SELECT created_by_profile_id AS author, title, status, moderation_status AS moderationStatus,
              merged_into_thread_id AS mergedInto
       FROM threads WHERE id = ?`,
    )
    .bind(id)
    .first<{ author: string | null; title: string; status: string; moderationStatus: string; mergedInto: string | null }>();
  if (!thread) return "not_found";
  // Same public rule as the social stream's thread lane.
  if (!["open", "closed"].includes(thread.status) || thread.mergedInto) return "not_public";
  if (thread.moderationStatus === "frozen") return "moderated";
  if (!thread.author) return "no_accountable_author";
  const first = await db
    .prepare(
      `SELECT body, deleted_at AS deletedAt, moderated_at AS moderatedAt, is_anonymous AS anonymous
       FROM thread_posts WHERE thread_id = ? ORDER BY post_no LIMIT 1`,
    )
    .bind(id)
    .first<{ body: string; deletedAt: string | null; moderatedAt: string | null; anonymous: number }>();
  if (!first || first.deletedAt) return "deleted";
  if (first.moderatedAt) return "moderated";
  if (first.anonymous) return "no_accountable_author";
  return { authorProfileId: thread.author, text: `${thread.title}\n\n${first.body}` };
}

async function loadThreadPost(db: D1Database, id: string): Promise<Loaded> {
  const row = await db
    .prepare(
      `SELECT p.author_profile_id AS author, p.body, p.deleted_at AS deletedAt, p.moderated_at AS moderatedAt,
              p.is_anonymous AS anonymous, t.status, t.moderation_status AS moderationStatus,
              t.merged_into_thread_id AS mergedInto
       FROM thread_posts p JOIN threads t ON t.id = p.thread_id WHERE p.id = ?`,
    )
    .bind(id)
    .first<{
      author: string | null; body: string; deletedAt: string | null; moderatedAt: string | null; anonymous: number;
      status: string; moderationStatus: string; mergedInto: string | null;
    }>();
  if (!row) return "not_found";
  if (row.deletedAt) return "deleted";
  if (row.moderatedAt) return "moderated";
  if (!["open", "closed"].includes(row.status) || row.mergedInto) return "not_public";
  if (row.moderationStatus === "frozen") return "moderated";
  if (row.anonymous || !row.author) return "no_accountable_author";
  return { authorProfileId: row.author, text: row.body };
}

async function loadChannelMessage(db: D1Database, id: string): Promise<Loaded> {
  // Mirrors the public community lane of the social stream: a public, active
  // community, an unarchived and ungated channel, and no role that hides it.
  const row = await db
    .prepare(
      `SELECT m.author_profile_id AS author, m.body, m.bot_id AS botId,
              community.visibility, community.lifecycle_status AS lifecycle,
              c.archived_at AS archivedAt, EXISTS(SELECT 1 FROM content_access_gates cag WHERE cag.target_type = 'channel' AND cag.target_id = c.id) AS tokenGate,
              EXISTS(SELECT 1 FROM community_channel_permissions permission
                     WHERE permission.channel_id = c.id AND permission.can_view = 0) AS restricted
       FROM community_channel_messages m
       JOIN community_channels c ON c.id = m.channel_id
       JOIN communities community ON community.id = c.community_id
       WHERE m.id = ?`,
    )
    .bind(id)
    .first<{
      author: string; body: string; botId: string | null; visibility: string; lifecycle: string;
      archivedAt: string | null; tokenGate: number; restricted: number;
    }>();
  if (!row) return "not_found";
  if (
    row.visibility !== "public" || row.lifecycle !== "active" || row.archivedAt
    || row.tokenGate || row.restricted
  ) return "not_public";
  if (row.botId) return "no_accountable_author";
  return { authorProfileId: row.author, text: row.body };
}

async function loadResearchVersion(db: D1Database, id: string): Promise<Loaded> {
  // The id is a research_document_revisions row. Public means a public project
  // that is neither a draft nor withdrawn, a public document, and a version
  // that has been published (version <= head).
  const row = await db
    .prepare(
      `SELECT r.author_profile_id AS author, r.body, r.version, d.head, d.visibility AS documentVisibility,
              d.title AS documentTitle, p.visibility AS projectVisibility, p.status AS projectStatus
       FROM research_document_revisions r
       JOIN research_documents d ON d.id = r.document_id
       JOIN research_projects p ON p.id = d.project_id
       WHERE r.id = ?`,
    )
    .bind(id)
    .first<{
      author: string; body: string; version: number; head: number; documentVisibility: string;
      documentTitle: string; projectVisibility: string; projectStatus: string;
    }>();
  if (!row) return "not_found";
  if (
    row.projectVisibility !== "public" || row.documentVisibility !== "public"
    || !["active", "paused", "completed"].includes(row.projectStatus) || row.version > row.head
  ) return "not_public";
  return { authorProfileId: row.author, text: `${row.documentTitle}\n\n${row.body}` };
}

async function loadArticle(db: D1Database, id: string): Promise<Loaded> {
  const row = await db
    .prepare(
      `SELECT author_profile_id AS author, title, body, audience, status, moderated_at AS moderatedAt
       FROM hub_user_articles WHERE id = ?`,
    )
    .bind(id)
    .first<{ author: string; title: string; body: string; audience: string; status: string; moderatedAt: string | null }>();
  if (!row) return "not_found";
  if (row.status !== "published" || row.audience !== "general") return "not_public";
  if (row.moderatedAt) return "moderated";
  return { authorProfileId: row.author, text: `${row.title}\n\n${row.body}` };
}

async function loadVideo(db: D1Database, id: string): Promise<Loaded> {
  const row = await db
    .prepare(
      `SELECT submitted_by_profile_id AS author, title, channel, source_url AS sourceUrl, status,
              safety_level AS safetyLevel, availability_status AS availability, ingest_source AS ingestSource
       FROM external_videos WHERE id = ?`,
    )
    .bind(id)
    .first<{
      author: string; title: string; channel: string; sourceUrl: string; status: string;
      safetyLevel: string; availability: string; ingestSource: string;
    }>();
  if (!row) return "not_found";
  if (row.status !== "active" || row.safetyLevel !== "standard" || row.availability === "unavailable") return "not_public";
  // A video that was auto-ingested from a post inherits that post's audience:
  // having the link in the catalog must not reveal a followers-only post. It is
  // usable only if some public, unmoderated post refers to it. Fail closed when
  // no such post is recorded. Thread ingests come from public boards.
  if (row.ingestSource === "social_post") {
    // The rule lives in video-public-origin.ts, shared with every public video reader.
    if (!(await hasPublicSocialPostOrigin(db, id))) return "not_public";
  } else if (!["manual", "thread", "thread_reply"].includes(row.ingestSource)) {
    return "not_public";
  }
  return { authorProfileId: row.author, text: `${row.title}\n${row.channel}\n${row.sourceUrl}` };
}

async function loadMusicWork(db: D1Database, id: string): Promise<Loaded> {
  // Only the Hub's public catalog reader. It returns active works that have a
  // playable service link; it never touches the Music Worker or its storage.
  const [work] = await listD1MusicWorksByIds(db, [id]);
  if (!work || work.id !== id) return "not_found";
  const owner = await db
    .prepare("SELECT submitted_by_profile_id AS author FROM music_works WHERE id = ?")
    .bind(id)
    .first<{ author: string }>();
  if (!owner) return "not_found";
  return { authorProfileId: owner.author, text: `${work.title}\n${work.artist}\n${work.description}` };
}

const LOADERS: Record<HubEvidenceKind, (db: D1Database, id: string) => Promise<Loaded>> = {
  post: loadPost,
  thread: loadThread,
  thread_post: loadThreadPost,
  channel_message: loadChannelMessage,
  research_version: loadResearchVersion,
  article: loadArticle,
  video: loadVideo,
  music_work: loadMusicWork,
};

async function authorBlock(db: D1Database, kind: HubEvidenceKind, id: string, author: string) {
  const row = await db
    .prepare(
      `SELECT
         EXISTS(SELECT 1 FROM profiles WHERE id = ?1) AS present,
         EXISTS(SELECT 1 FROM profile_moderation_status WHERE profile_id = ?1 AND status = 'suspended') AS suspended,
         EXISTS(SELECT 1 FROM hub_data_requests WHERE profile_id = ?1 AND request_type = 'deletion'
                AND status IN ('open','processing','completed')) AS deletion,
         EXISTS(SELECT 1 FROM hubpedia_material_profile_optouts WHERE profile_id = ?1) AS profileOptOut,
         EXISTS(SELECT 1 FROM hubpedia_material_item_optouts WHERE kind = ?2 AND item_id = ?3) AS itemOptOut`,
    )
    .bind(author, kind, id)
    .first<{ present: number; suspended: number; deletion: number; profileOptOut: number; itemOptOut: number }>();
  if (!row || !row.present) return "no_accountable_author" as const;
  if (row.suspended) return "author_suspended" as const;
  if (row.deletion) return "author_deletion_requested" as const;
  if (row.profileOptOut) return "author_opted_out" as const;
  if (row.itemOptOut) return "item_opted_out" as const;
  return null;
}

/** Decide whether one Hub item may be used as material, and return its canonical text if so. */
export async function evaluateHubItem(db: D1Database, kind: HubEvidenceKind, id: string): Promise<HubItemEvaluation> {
  const no = (reason: HubItemIneligibleReason): HubItemEvaluation => ({ eligible: false, kind, itemId: id, reason });
  if (!isHubEvidenceKind(kind) || typeof id !== "string" || !ITEM_ID_PATTERN.test(id)) return no("invalid_id");
  const loaded = await LOADERS[kind](db, id);
  if (typeof loaded === "string") return no(loaded);
  // Gated content is never material, whoever asks (DESIGN.md section 3). Fail closed on a lookup error.
  if (await isHubItemGated(db, kind, id).catch(() => true)) return no("not_public");
  if (!loaded.authorProfileId) return no("no_accountable_author");
  const blocked = await authorBlock(db, kind, id, loaded.authorProfileId);
  if (blocked) return no(blocked);
  if (!normalizeText(loaded.text)) return no("empty_content");
  return { eligible: true, kind, itemId: id, authorProfileId: loaded.authorProfileId, text: loaded.text };
}

export async function isEligibleHubItem(db: D1Database, kind: HubEvidenceKind, id: string) {
  return (await evaluateHubItem(db, kind, id)).eligible;
}

/* ---- capture ---- */

export type HubItemSnapshot = {
  kind: HubEvidenceKind;
  itemId: string;
  quote: string;
  snapshotSha256: string;
  capturedAt: string;
};

export async function captureHubItem(
  db: D1Database,
  kind: HubEvidenceKind,
  id: string,
  now: Date = new Date(),
): Promise<{ ok: true; snapshot: HubItemSnapshot } | { ok: false; reason: HubItemIneligibleReason }> {
  const item = await evaluateHubItem(db, kind, id);
  if (!item.eligible) return { ok: false, reason: item.reason };
  return {
    ok: true,
    snapshot: {
      kind,
      itemId: id,
      quote: limitQuote(item.text),
      snapshotSha256: await hubItemContentHash(kind, item.text),
      capturedAt: now.toISOString(),
    },
  };
}

/* ---- opt-outs ---- */

export async function setProfileMaterialOptOut(db: D1Database, profileId: string, excluded: boolean, now: Date = new Date()) {
  if (excluded) {
    await db
      .prepare("INSERT INTO hubpedia_material_profile_optouts(profile_id, created_at) VALUES(?, ?) ON CONFLICT(profile_id) DO NOTHING")
      .bind(profileId, now.toISOString())
      .run();
  } else {
    await db.prepare("DELETE FROM hubpedia_material_profile_optouts WHERE profile_id = ?").bind(profileId).run();
  }
  return excluded;
}

export async function getProfileMaterialOptOut(db: D1Database, profileId: string) {
  const row = await db
    .prepare("SELECT 1 AS found FROM hubpedia_material_profile_optouts WHERE profile_id = ?")
    .bind(profileId)
    .first<{ found: number }>();
  return Boolean(row);
}

/** An author excludes one of their own items. The item must name that author; otherwise nothing is recorded. */
export async function setItemMaterialOptOut(
  db: D1Database,
  profileId: string,
  kind: HubEvidenceKind,
  itemId: string,
  excluded: boolean,
  now: Date = new Date(),
) {
  if (!isHubEvidenceKind(kind) || !ITEM_ID_PATTERN.test(itemId)) return false;
  const loaded = await LOADERS[kind](db, itemId);
  // A withdrawn-from-public item still has an author; look it up from the row, not the public gate.
  const author = typeof loaded === "string" ? await rawAuthor(db, kind, itemId) : loaded.authorProfileId;
  if (author !== profileId) return false;
  if (excluded) {
    await db
      .prepare("INSERT INTO hubpedia_material_item_optouts(kind, item_id, profile_id, created_at) VALUES(?, ?, ?, ?) ON CONFLICT(kind, item_id) DO NOTHING")
      .bind(kind, itemId, profileId, now.toISOString())
      .run();
  } else {
    await db.prepare("DELETE FROM hubpedia_material_item_optouts WHERE kind = ? AND item_id = ? AND profile_id = ?").bind(kind, itemId, profileId).run();
  }
  return true;
}

const AUTHOR_SQL: Record<HubEvidenceKind, string> = {
  post: "SELECT author_profile_id AS author FROM social_posts WHERE id = ?",
  thread: "SELECT created_by_profile_id AS author FROM threads WHERE id = ?",
  thread_post: "SELECT author_profile_id AS author FROM thread_posts WHERE id = ?",
  channel_message: "SELECT author_profile_id AS author FROM community_channel_messages WHERE id = ?",
  research_version: "SELECT author_profile_id AS author FROM research_document_revisions WHERE id = ?",
  article: "SELECT author_profile_id AS author FROM hub_user_articles WHERE id = ?",
  video: "SELECT submitted_by_profile_id AS author FROM external_videos WHERE id = ?",
  music_work: "SELECT submitted_by_profile_id AS author FROM music_works WHERE id = ?",
};

async function rawAuthor(db: D1Database, kind: HubEvidenceKind, id: string) {
  const row = await db.prepare(AUTHOR_SQL[kind]).bind(id).first<{ author: string | null }>();
  return row?.author ?? null;
}

/* ---- attaching evidence to a claim ---- */

export type HubEvidenceStance = "supports" | "refutes" | "context";

export async function attachHubEvidence(
  db: D1Database,
  input: { claimId: string; kind: HubEvidenceKind; itemId: string; stance?: HubEvidenceStance },
  now: Date = new Date(),
): Promise<{ ok: true; evidenceId: string } | { ok: false; reason: HubItemIneligibleReason | "claim_not_found" }> {
  const claim = await db.prepare("SELECT id FROM encyclopedia_claims WHERE id = ?").bind(input.claimId).first();
  if (!claim) return { ok: false, reason: "claim_not_found" };
  const captured = await captureHubItem(db, input.kind, input.itemId, now);
  if (!captured.ok) return captured;
  const stamp = now.toISOString();
  const { snapshot } = captured;
  const id = crypto.randomUUID();
  // Re-attaching the same item to the same claim refreshes the snapshot and reactivates it.
  await db
    .prepare(
      `INSERT INTO hubpedia_hub_item_evidence
         (id, claim_id, kind, item_id, stance, snapshot_sha256, captured_at, quote, status, last_checked_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
       ON CONFLICT(claim_id, kind, item_id) DO UPDATE SET
         stance = excluded.stance, snapshot_sha256 = excluded.snapshot_sha256, captured_at = excluded.captured_at,
         quote = excluded.quote, status = 'active', withdrawn_reason = NULL, withdrawn_at = NULL,
         last_checked_at = excluded.last_checked_at`,
    )
    .bind(id, input.claimId, input.kind, input.itemId, input.stance ?? "supports", snapshot.snapshotSha256, snapshot.capturedAt, snapshot.quote, stamp, stamp)
    .run();
  const stored = await db
    .prepare("SELECT id FROM hubpedia_hub_item_evidence WHERE claim_id = ? AND kind = ? AND item_id = ?")
    .bind(input.claimId, input.kind, input.itemId)
    .first<{ id: string }>();
  await recomputeClaimKnowledge(db, input.claimId, now);
  return { ok: true, evidenceId: stored?.id ?? id };
}

/* ---- knowledge state (design section 3) ---- */

const STRONG_STATUSES = new Set(["established", "strong-evidence"]);
const CAPPABLE_STATUSES = new Set(["established", "strong-evidence", "provisional"]);

/**
 * Re-derive the claim's knowledge state from its remaining evidence. This only
 * ever lowers a status; it never promotes one.
 *  - active refuting evidence -> disputed
 *  - no supporting evidence left -> unverified (and the claim leaves "supported")
 *  - only social writing supports it -> at most provisional
 */
export async function recomputeClaimKnowledge(db: D1Database, claimId: string, now: Date = new Date()) {
  const everHub = await db
    .prepare("SELECT 1 AS found FROM hubpedia_hub_item_evidence WHERE claim_id = ? LIMIT 1")
    .bind(claimId)
    .first();
  // A claim that never used a Hub item is not this module's business.
  if (!everHub) return { supports: 0, refutes: 0, onlySocial: false, status: null };
  const hub = await db
    .prepare(
      `SELECT kind, stance FROM hubpedia_hub_item_evidence WHERE claim_id = ? AND status = 'active'`,
    )
    .bind(claimId)
    .all<{ kind: string; stance: string }>();
  const chunk = await db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN stance = 'supports' THEN 1 ELSE 0 END), 0) AS supports,
         COALESCE(SUM(CASE WHEN stance = 'refutes' THEN 1 ELSE 0 END), 0) AS refutes
       FROM encyclopedia_claim_evidence WHERE claim_id = ?`,
    )
    .bind(claimId)
    .first<{ supports: number; refutes: number }>();

  const supportingHub = hub.results.filter((row) => row.stance === "supports");
  const supports = supportingHub.length + Number(chunk?.supports ?? 0);
  const refutes = hub.results.filter((row) => row.stance === "refutes").length + Number(chunk?.refutes ?? 0);
  const strongSupport = Number(chunk?.supports ?? 0) > 0 || supportingHub.some((row) => STRONG_KINDS.has(row.kind));
  const onlySocial = supports > 0 && !strongSupport && supportingHub.every((row) => SOCIAL_KINDS.has(row.kind));

  const state = await db
    .prepare("SELECT knowledge_status AS status FROM hubpedia_claim_knowledge_state WHERE claim_id = ?")
    .bind(claimId)
    .first<{ status: string }>();
  let next: string | null = null;
  if (state) {
    if (refutes > 0 && state.status !== "refuted") next = "disputed";
    else if (supports === 0 && CAPPABLE_STATUSES.has(state.status)) next = "unverified";
    else if (!strongSupport && STRONG_STATUSES.has(state.status)) next = "provisional";
    if (next && next !== state.status) {
      await db
        .prepare(
          `UPDATE hubpedia_claim_knowledge_state
           SET knowledge_status = ?, last_checked_at = ?, checked_by = 'hubpedia-hub-evidence', updated_at = ?
           WHERE claim_id = ?`,
        )
        .bind(next, now.toISOString(), now.toISOString(), claimId)
        .run();
    }
  }
  if (supports === 0) {
    await db
      .prepare("UPDATE encyclopedia_claims SET status = 'proposed', updated_at = ? WHERE id = ? AND status = 'supported'")
      .bind(Math.floor(now.getTime() / 1000), claimId)
      .run();
  }
  return { supports, refutes, onlySocial, status: next ?? state?.status ?? null };
}

/* ---- review queue ---- */

const FINDING_TYPE = "hub_evidence_changed";

async function putClaimBackInReview(
  db: D1Database,
  claimId: string,
  evidence: { kind: string; itemId: string },
  reason: string,
  now: Date,
) {
  const seconds = Math.floor(now.getTime() / 1000);
  const message = reason === "edited"
    ? "A Hub item cited by this claim was edited; the claim must be checked against the new content."
    : "A Hub item cited by this claim is no longer usable as material; its evidence was withdrawn.";
  // One open finding per claim and current revision: repeated withdrawals do not pile up.
  await db
    .prepare(
      `INSERT INTO encyclopedia_review_findings
         (id, revision_id, claim_id, finding_type, severity, status, message, location, metadata, created_at, updated_at)
       SELECT ?, rc.revision_id, rc.claim_id, ?, 'warning', 'open', ?, '{}', ?, ?, ?
       FROM encyclopedia_revision_claims rc
       JOIN encyclopedia_articles a ON a.current_revision_id = rc.revision_id
       WHERE rc.claim_id = ?
         AND NOT EXISTS (
           SELECT 1 FROM encyclopedia_review_findings f
           WHERE f.revision_id = rc.revision_id AND f.claim_id = rc.claim_id
             AND f.finding_type = ? AND f.status = 'open'
         )`,
    )
    .bind(
      crypto.randomUUID(), FINDING_TYPE, message,
      JSON.stringify({ kind: evidence.kind, itemId: evidence.itemId, reason }), seconds, seconds,
      claimId, FINDING_TYPE,
    )
    .run();
  await recomputeClaimKnowledge(db, claimId, now);
}

/* ---- revalidation (design section 6) ---- */

export type RevalidateResult = {
  checked: number;
  withdrawn: number;
  stale: number;
  unchanged: number;
  /** Pass back as sinceCursor to continue; null when the pass is complete. */
  nextCursor: string | null;
};

/**
 * Check active Hub evidence against its source items.
 *
 * Keyset-paginated on the evidence id (no OFFSET): each call reads at most
 * `limit` rows after `sinceCursor`, so a daily job can walk the table in
 * bounded steps and D1 billing stays proportional to the batch.
 */
export async function revalidateHubEvidence(
  db: D1Database,
  options: { sinceCursor?: string | null; limit?: number } = {},
  now: Date = new Date(),
): Promise<RevalidateResult> {
  const limit = Math.max(1, Math.min(200, Math.trunc(options.limit ?? 50)));
  const cursor = options.sinceCursor ?? "";
  const rows = (
    await db
      .prepare(
        `SELECT id, claim_id AS claimId, kind, item_id AS itemId, snapshot_sha256 AS hash
         FROM hubpedia_hub_item_evidence
         WHERE status = 'active' AND id > ?
         ORDER BY id LIMIT ?`,
      )
      .bind(cursor, limit)
      .all<{ id: string; claimId: string; kind: HubEvidenceKind; itemId: string; hash: string }>()
  ).results;

  const stamp = now.toISOString();
  const result: RevalidateResult = { checked: rows.length, withdrawn: 0, stale: 0, unchanged: 0, nextCursor: null };
  for (const row of rows) {
    const item = await evaluateHubItem(db, row.kind, row.itemId);
    let outcome: string | null = null;
    if (!item.eligible) outcome = item.reason;
    else if ((await hubItemContentHash(row.kind, item.text)) !== row.hash) outcome = "edited";

    if (!outcome) {
      result.unchanged += 1;
      await db.prepare("UPDATE hubpedia_hub_item_evidence SET last_checked_at = ? WHERE id = ?").bind(stamp, row.id).run();
      continue;
    }
    const status = outcome === "edited" ? "stale" : "withdrawn";
    const changed = await db
      .prepare(
        `UPDATE hubpedia_hub_item_evidence
         SET status = ?, withdrawn_reason = ?, withdrawn_at = ?, last_checked_at = ?
         WHERE id = ? AND status = 'active'`,
      )
      .bind(status, outcome, stamp, stamp, row.id)
      .run();
    if (!(changed.meta?.changes ?? 0)) continue;
    if (status === "stale") result.stale += 1;
    else result.withdrawn += 1;
    await putClaimBackInReview(db, row.claimId, { kind: row.kind, itemId: row.itemId }, outcome, now);
  }
  if (rows.length === limit) result.nextCursor = rows[rows.length - 1].id;
  return result;
}

/* ---- backlinks (design section 8) ---- */

export type HubItemCitation = { slug: string; title: string; claimCount: number };

/**
 * Published encyclopedia entries that cite this item. Unpublished articles are
 * never listed, and an item that may not be used as material lists nothing,
 * so the endpoint cannot be used to learn whether a private item exists.
 */
export async function listArticlesCitingHubItem(db: D1Database, kind: HubEvidenceKind, id: string): Promise<HubItemCitation[]> {
  if (!(await isEligibleHubItem(db, kind, id))) return [];
  const rows = await db
    .prepare(
      `SELECT a.slug AS slug, a.title AS title, COUNT(DISTINCT e.claim_id) AS claimCount
       FROM hubpedia_hub_item_evidence e
       JOIN encyclopedia_revision_claims rc ON rc.claim_id = e.claim_id
       JOIN encyclopedia_articles a ON a.current_revision_id = rc.revision_id
       WHERE e.kind = ? AND e.item_id = ? AND e.status = 'active' AND a.status = 'published'
         AND EXISTS (
           SELECT 1 FROM hubpedia_publication_approvals approval
           JOIN encyclopedia_article_revisions rev ON rev.id = a.current_revision_id
           WHERE approval.article_slug = a.slug AND approval.revoked_at IS NULL
             AND approval.approved_revision_key = 'db:' || rev.revision_number
         )
         AND EXISTS (
           SELECT 1 FROM hubpedia_publication_eligible_articles eligible
           WHERE eligible.article_slug = a.slug AND eligible.revision_id = a.current_revision_id
         )
       GROUP BY a.id
       ORDER BY a.slug
       LIMIT 50`,
    )
    .bind(kind, id)
    .all<HubItemCitation>();
  return rows.results.map((row) => ({ slug: row.slug, title: row.title, claimCount: Number(row.claimCount) }));
}

/* ---- scheduled pass (persisted keyset cursor) ---- */

export const HUB_EVIDENCE_CURSOR_NAME = "revalidate";
export const HUB_EVIDENCE_SCHEDULED_BATCH = 100;

/**
 * One bounded step of the scheduled revalidation. The cursor lives in D1, so
 * successive cron runs continue where the last one stopped and wrap to the
 * start after the final row.
 */
export async function runScheduledHubEvidenceRevalidation(
  db: D1Database,
  options: { limit?: number } = {},
  now: Date = new Date(),
) {
  const saved = await db
    .prepare("SELECT cursor FROM hubpedia_hub_evidence_cursor WHERE name = ?")
    .bind(HUB_EVIDENCE_CURSOR_NAME)
    .first<{ cursor: string }>();
  const result = await revalidateHubEvidence(
    db,
    { sinceCursor: saved?.cursor || null, limit: options.limit ?? HUB_EVIDENCE_SCHEDULED_BATCH },
    now,
  );
  await db
    .prepare(
      `INSERT INTO hubpedia_hub_evidence_cursor(name, cursor, updated_at) VALUES(?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET cursor = excluded.cursor, updated_at = excluded.updated_at`,
    )
    .bind(HUB_EVIDENCE_CURSOR_NAME, result.nextCursor ?? "", now.toISOString())
    .run();
  return result;
}
