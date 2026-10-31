import type { D1Database } from "@cloudflare/workers-types";
import { isHubOperator, isInstanceOperator } from "@/lib/hub-operators";

/*
 * Hubpedia human editing: feature flag, roles, suspensions and the
 * sensitive-category rule (docs/hubpedia-hybrid/DESIGN.md sections 5 and 10).
 *
 * This module imports nothing from hubpedia-wiki.ts so that file can use it.
 */

export class WikiPermissionError extends Error {}
export class WikiSuspendedError extends Error {
  constructor(message: string, readonly expiresAt: string, readonly reason: string) {
    super(message);
  }
}
export class HumanEditingDisabledError extends Error {
  constructor() {
    super("Hubpedia human editing is not enabled.");
  }
}

/* ---- feature flag ---- */

type EnvLike = Record<string, string | undefined>;

/**
 * HUBPEDIA_HUMAN_EDITING=1 turns human editing on. It is off unless set, except in a
 * local `next dev` server (NODE_ENV=development) where it is on unless set to 0.
 */
export function isHumanEditingEnabled(env: EnvLike = process.env): boolean {
  const value = env.HUBPEDIA_HUMAN_EDITING;
  if (value === "1") return true;
  if (value === "0") return false;
  return env.NODE_ENV === "development";
}

export function assertHumanEditingEnabled(env: EnvLike = process.env) {
  if (!isHumanEditingEnabled(env)) throw new HumanEditingDisabledError();
}

/* ---- roles ---- */

export type WikiRole = "operator" | "patrol" | "editor";

/** The Hub operator (owner) is named by the environment key, the existing first door. */
export function isWikiOperator(profileId: string | null | undefined, env: EnvLike = process.env) {
  return isHubOperator(profileId, env.HUB_OPERATOR_PROFILE_IDS);
}

/** Environment key plus the operator chosen by /setup/admin. */
export function isWikiOperatorIn(db: D1Database, profileId: string | null | undefined, env: EnvLike = process.env) {
  return isInstanceOperator(db as never, profileId, env.HUB_OPERATOR_PROFILE_IDS);
}

export async function isActivePatrol(db: D1Database, profileId: string) {
  const row = await db
    .prepare("SELECT 1 AS found FROM hubpedia_wiki_patrol WHERE profile_id = ? AND revoked_at IS NULL")
    .bind(profileId)
    .first();
  return Boolean(row);
}

export async function getWikiRole(db: D1Database, profileId: string, env: EnvLike = process.env): Promise<WikiRole> {
  if (await isWikiOperatorIn(db, profileId, env)) return "operator";
  return (await isActivePatrol(db, profileId)) ? "patrol" : "editor";
}

/** Patrol and the operator may moderate. Returns the role so callers can branch on it. */
export async function requirePatrolRole(db: D1Database, profileId: string, env: EnvLike = process.env) {
  const role = await getWikiRole(db, profileId, env);
  if (role === "editor") throw new WikiPermissionError("This action is limited to Hubpedia patrol.");
  return role;
}

/* ---- suspension ---- */

export async function getActiveSuspension(db: D1Database, profileId: string, now = new Date().toISOString()) {
  return db
    .prepare(
      `SELECT id, reason, expires_at AS expiresAt FROM hubpedia_wiki_suspensions
       WHERE profile_id = ? AND lifted_at IS NULL AND expires_at > ?
       ORDER BY expires_at DESC LIMIT 1`,
    )
    .bind(profileId, now)
    .first<{ id: string; reason: string; expiresAt: string }>();
}

/** Throws WikiSuspendedError when the editor is suspended (or blocked by the older trust table). */
export async function assertEditorNotSuspended(db: D1Database, profileId: string, now = new Date().toISOString()) {
  const suspension = await getActiveSuspension(db, profileId, now);
  if (suspension) {
    throw new WikiSuspendedError("Your Hubpedia editing is suspended.", suspension.expiresAt, suspension.reason);
  }
  const trust = await db
    .prepare("SELECT blocked_until AS blockedUntil FROM hubpedia_wiki_editor_trust WHERE profile_id = ?")
    .bind(profileId)
    .first<{ blockedUntil: string | null }>();
  if (trust?.blockedUntil && trust.blockedUntil > now) {
    throw new WikiSuspendedError("Your Hubpedia editing is blocked.", trust.blockedUntil, "blocked");
  }
}

/* ---- sensitive categories (medical / legal / financial) ---- */

export type SensitiveCategory = "medical" | "legal" | "financial";

const SENSITIVE_PATTERNS: Array<[SensitiveCategory, RegExp]> = [
  ["medical", /医療|医学|治療|診断|診察|処方|薬|疾患|疾病|症状|病気|感染症|副作用|\b(?:medical|medicine|clinical|disease|diagnos\w*|therapy|symptom\w*|prescription)\b/iu],
  ["legal", /法律|法的|訴訟|裁判|弁護士|刑事|民事|契約書|判例|\b(?:legal|lawsuit|statute|attorney|litigation|court)\b/iu],
  ["financial", /投資|金融|株価|株式|暗号資産|融資|証券|為替|税金|節税|\b(?:financial|investment|securities|stocks?|tax advice|loan)\b/iu],
];

export function detectSensitiveCategory(text: string): SensitiveCategory | null {
  for (const [category, pattern] of SENSITIVE_PATTERNS) if (pattern.test(text)) return category;
  return null;
}

/** The stored (sticky) category wins; otherwise detect from the supplied text. */
export async function getSensitiveCategory(db: D1Database, slug: string, text = ""): Promise<SensitiveCategory | null> {
  const stored = await db
    .prepare("SELECT sensitive_category AS category FROM hubpedia_wiki_articles WHERE slug = ? AND sensitive_category IS NOT NULL LIMIT 1")
    .bind(slug)
    .first<{ category: SensitiveCategory }>();
  return stored?.category ?? detectSensitiveCategory(text);
}
