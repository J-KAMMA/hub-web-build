import type { D1Database } from "@cloudflare/workers-types";

import {
  CONTENT_LICENSE_TARGET_TYPES,
  DEFAULT_CONTENT_LICENSE,
  isGateCompatibleLicense,
  normalizeContentLicense,
  type ContentLicenseId,
  type ContentLicenseTargetType,
} from "@/lib/content-license";
import { canManageGatedTarget } from "@/lib/server/access-gates";

export class ContentLicenseValidationError extends Error {}
export class ContentLicenseForbiddenError extends Error {}
/** A CC license was requested for gated content, or a gate for CC-licensed content. */
export class ContentLicenseGateConflictError extends Error {}

export function parseContentLicenseTarget(targetType: unknown, targetId: unknown): { targetType: ContentLicenseTargetType; targetId: string } {
  if (typeof targetType !== "string" || !(CONTENT_LICENSE_TARGET_TYPES as readonly string[]).includes(targetType)) {
    throw new ContentLicenseValidationError("ライセンスを付けられない種類のコンテンツです。");
  }
  if (typeof targetId !== "string" || targetId.length < 1 || targetId.length > 200) {
    throw new ContentLicenseValidationError("コンテンツのIDが正しくありません。");
  }
  return { targetType: targetType as ContentLicenseTargetType, targetId };
}

export function parseContentLicenseInput(value: unknown): ContentLicenseId {
  const license = normalizeContentLicense(value);
  if (!license) throw new ContentLicenseValidationError("未対応のライセンスです。");
  return license;
}

export async function isTargetGated(database: D1Database, target: { targetType: string; targetId: string }): Promise<boolean> {
  const row = await database
    .prepare("SELECT 1 AS ok FROM content_access_gates WHERE target_type = ? AND target_id = ? LIMIT 1")
    .bind(target.targetType, target.targetId)
    .first<{ ok: number }>();
  return row !== null;
}

/** The license of a work. A work with no row is all rights reserved. */
export async function getContentLicense(
  database: D1Database,
  target: { targetType: ContentLicenseTargetType; targetId: string },
): Promise<ContentLicenseId> {
  const row = await database
    .prepare("SELECT license FROM content_licenses WHERE target_type = ? AND target_id = ? LIMIT 1")
    .bind(target.targetType, target.targetId)
    .first<{ license: string }>();
  return normalizeContentLicense(row?.license) ?? DEFAULT_CONTENT_LICENSE;
}

/** True when the work carries a license other than all rights reserved. */
export async function hasOpenLicense(database: D1Database, target: { targetType: string; targetId: string }): Promise<boolean> {
  const row = await database
    .prepare("SELECT 1 AS ok FROM content_licenses WHERE target_type = ? AND target_id = ? AND license <> 'arr' LIMIT 1")
    .bind(target.targetType, target.targetId)
    .first<{ ok: number }>();
  return row !== null;
}

/**
 * Set a work's license. Only the author may do it. A CC license is refused for gated content
 * here and again by a database trigger (migration 0262).
 */
export async function setContentLicense(
  database: D1Database,
  profileId: string,
  rawTarget: { targetType: unknown; targetId: unknown },
  rawLicense: unknown,
): Promise<{ targetType: ContentLicenseTargetType; targetId: string; license: ContentLicenseId }> {
  const target = parseContentLicenseTarget(rawTarget.targetType, rawTarget.targetId);
  const license = parseContentLicenseInput(rawLicense);
  if (!(await canManageGatedTarget(database, profileId, target))) {
    throw new ContentLicenseForbiddenError("このコンテンツのライセンスを変更する権限がありません。");
  }
  if (!isGateCompatibleLicense(license) && (await isTargetGated(database, target))) {
    throw new ContentLicenseGateConflictError("閲覧条件が付いたコンテンツには、CCライセンスを付けられません。");
  }
  try {
    await database
      .prepare(`INSERT INTO content_licenses (target_type, target_id, license, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(target_type, target_id) DO UPDATE SET license = excluded.license, updated_at = excluded.updated_at`)
      .bind(target.targetType, target.targetId, license, new Date().toISOString())
      .run();
  } catch (error) {
    if (String((error as Error)?.message ?? error).includes("cc_license_on_gated_content")) {
      throw new ContentLicenseGateConflictError("閲覧条件が付いたコンテンツには、CCライセンスを付けられません。");
    }
    throw error;
  }
  return { ...target, license };
}

/** Licenses of many posts/articles at once (one indexed query, at most 200 ids). */
export async function getContentLicenses(
  database: D1Database,
  targetType: ContentLicenseTargetType,
  targetIds: readonly string[],
): Promise<Map<string, ContentLicenseId>> {
  const ids = [...new Set(targetIds)].slice(0, 200);
  const result = new Map<string, ContentLicenseId>();
  if (!ids.length) return result;
  const rows = await database
    .prepare(`SELECT target_id, license FROM content_licenses WHERE target_type = ? AND target_id IN (${ids.map(() => "?").join(",")}) LIMIT 200`)
    .bind(targetType, ...ids)
    .all<{ target_id: string; license: string }>();
  for (const row of rows.results) {
    const license = normalizeContentLicense(row.license);
    if (license) result.set(row.target_id, license);
  }
  return result;
}
