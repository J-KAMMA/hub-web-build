import { createHash } from "node:crypto";
import type { D1Database } from "@cloudflare/workers-types";

export const HUB_AD_POLICY_VERSION = "2026-07-19.1";
const ADVERTISER_REF = /^adv_[0-9a-f]{16}$/;
const TARGET_TYPES = new Set(["advertiser", "campaign", "creative"]);
const REPORT_REASONS = new Set(["misleading", "prohibited_product", "unsafe_landing", "impersonation", "copyright", "other"]);

function bounded(value: unknown, min: number, max: number) {
  return typeof value === "string" && value.trim().length >= min && value.trim().length <= max ? value.trim() : null;
}

export function opaqueSubjectHash(subject: string, secret: string) {
  if (!subject || secret.length < 32) return null;
  return createHash("sha256").update(`hub-ads-advertiser-v1\0${secret}\0${subject}`).digest("base64url");
}

export function parseHubAdAppeal(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>; const reason = bounded(body.reason, 20, 2_000);
  if (!ADVERTISER_REF.test(String(body.advertiserRef ?? "")) || !TARGET_TYPES.has(String(body.targetType ?? ""))
    || !bounded(body.targetId, 1, 128) || !reason) return null;
  return { advertiserRef: String(body.advertiserRef), targetType: String(body.targetType), targetId: String(body.targetId), reason };
}

export function parseHubAdPublicReport(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>; const detail = body.detail === undefined || body.detail === "" ? null : bounded(body.detail, 1, 1_000);
  if (!bounded(body.tokenId, 16, 128) || !REPORT_REASONS.has(String(body.reasonCode ?? "")) || (body.detail && !detail)) return null;
  return { tokenId: String(body.tokenId), reasonCode: String(body.reasonCode), detail };
}

export async function acceptHubAdPolicy(database: D1Database, advertiserRef: string, subjectHash: string, now = Date.now()) {
  if (!ADVERTISER_REF.test(advertiserRef) || !/^[A-Za-z0-9_-]{43}$/.test(subjectHash)) return false;
  await database.prepare(`INSERT INTO hub_ad_advertisers
    (advertiser_ref, access_subject_hash, status, policy_version, policy_accepted_at, created_at, updated_at)
    VALUES (?, ?, 'pending', ?, ?, ?, ?)
    ON CONFLICT(advertiser_ref) DO UPDATE SET policy_version=excluded.policy_version,
      policy_accepted_at=excluded.policy_accepted_at, updated_at=excluded.updated_at
    WHERE hub_ad_advertisers.access_subject_hash=excluded.access_subject_hash`)
    .bind(advertiserRef, subjectHash, HUB_AD_POLICY_VERSION, now, now, now).run();
  return true;
}

export async function createHubAdAppeal(database: D1Database, input: NonNullable<ReturnType<typeof parseHubAdAppeal>>, now = Date.now()) {
  const owner = await database.prepare("SELECT 1 ok FROM hub_ad_advertisers WHERE advertiser_ref=? AND policy_version=?")
    .bind(input.advertiserRef, HUB_AD_POLICY_VERSION).first();
  if (!owner) return null;
  const id = crypto.randomUUID();
  await database.prepare(`INSERT INTO hub_ad_review_appeals
    (id, advertiser_ref, target_type, target_id, reason, status, created_at) VALUES (?, ?, ?, ?, ?, 'open', ?)`)
    .bind(id, input.advertiserRef, input.targetType, input.targetId, input.reason, now).run();
  return id;
}

export async function createHubAdPublicReport(database: D1Database, input: NonNullable<ReturnType<typeof parseHubAdPublicReport>>, now = Date.now()) {
  const id = crypto.randomUUID();
  await database.prepare(`INSERT OR IGNORE INTO hub_ad_public_reports
    (id, token_id, reason_code, detail, status, created_at) VALUES (?, ?, ?, ?, 'open', ?)`)
    .bind(id, input.tokenId, input.reasonCode, input.detail, now).run();
  return id;
}
