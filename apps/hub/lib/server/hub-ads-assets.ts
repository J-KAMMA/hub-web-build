import "server-only";

import { createHash } from "node:crypto";
import type { D1Database, R2Bucket } from "@cloudflare/workers-types";
import { InvalidPngError, sanitizeHubAdPng } from "@/lib/hub-ads-png";

export const HUB_AD_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const HUB_AD_IMAGE_MIME = "image/png";
const ADVERTISER_REF = /^adv_[a-z0-9]{16,64}$/;
const ASSET_ID = /^[0-9a-f-]{36}$/;

export function validHubAdAssetId(value: string) { return ASSET_ID.test(value); }

export function parseHubAdAssetUpload(form: FormData): { advertiserRef: string; file: File } | null {
  const advertiserRef = form.get("advertiserRef"); const file = form.get("file");
  return typeof advertiserRef === "string" && ADVERTISER_REF.test(advertiserRef) && file instanceof File
    && file.type === HUB_AD_IMAGE_MIME && file.size > 0 && file.size <= HUB_AD_IMAGE_MAX_BYTES ? { advertiserRef, file } : null;
}

export async function listHubAdAssets(database: D1Database) {
  return (await database.prepare(`SELECT id, advertiser_ref AS advertiserRef, mime_type AS mimeType, byte_size AS byteSize,
    width, height, status, structural_result AS structuralResult, scanner_provider AS scannerProvider,
    scanner_result AS scannerResult, rejection_code AS rejectionCode, created_at AS createdAt, updated_at AS updatedAt
    FROM hub_ad_image_assets ORDER BY created_at DESC LIMIT 500`).all()).results;
}

export async function quarantineHubAdAsset(database: D1Database, quarantine: R2Bucket, advertiserRef: string, bytes: Uint8Array, now = Date.now()) {
  const id = crypto.randomUUID(); const objectKey = `original/${id}`;
  const originalSha256 = createHash("sha256").update(bytes).digest("hex");
  await quarantine.put(objectKey, bytes, { httpMetadata: { contentType: HUB_AD_IMAGE_MIME }, customMetadata: { assetId: id } });
  try {
    await database.prepare(`INSERT INTO hub_ad_image_assets
      (id, advertiser_ref, mime_type, byte_size, original_sha256, quarantine_object_key, status, structural_result, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'quarantined', 'pending', ?, ?)`)
      .bind(id, advertiserRef, HUB_AD_IMAGE_MIME, bytes.byteLength, originalSha256, objectKey, now, now).run();
  } catch (error) { await quarantine.delete(objectKey); throw error; }
  try {
    const parsed = sanitizeHubAdPng(bytes);
    await database.prepare(`UPDATE hub_ad_image_assets SET width = ?, height = ?, status = 'scan_pending',
      structural_result = 'passed', updated_at = ? WHERE id = ? AND status = 'quarantined'`)
      .bind(parsed.width, parsed.height, now, id).run();
    return { id, status: "scan_pending", width: parsed.width, height: parsed.height };
  } catch (error) {
    const code = error instanceof InvalidPngError ? error.code : "structural_error";
    await database.prepare(`UPDATE hub_ad_image_assets SET status = 'rejected', structural_result = 'failed',
      rejection_code = ?, updated_at = ? WHERE id = ?`).bind(code, now, id).run();
    return { id, status: "rejected", rejectionCode: code };
  }
}

interface AssetRow { id: string; quarantine_object_key: string; clean_object_key: string | null; status: string; structural_result: string; }

function leaseHash(token: string) { return createHash("sha256").update(token).digest("hex"); }

export async function claimHubAdScan(database: D1Database, now = Date.now()) {
  const candidate = await database.prepare(`SELECT id FROM hub_ad_image_assets WHERE status = 'scan_pending'
    AND structural_result = 'passed' AND scan_attempts < 3 AND (scan_lease_expires_at IS NULL OR scan_lease_expires_at < ?)
    ORDER BY created_at ASC LIMIT 1`).bind(now).first<{ id: string }>();
  if (!candidate) return null;
  const leaseToken = `${crypto.randomUUID()}${crypto.randomUUID()}`; const expiresAt = now + 120_000;
  const updated = await database.prepare(`UPDATE hub_ad_image_assets SET scan_lease_token_hash = ?, scan_lease_expires_at = ?,
    scan_attempts = scan_attempts + 1, updated_at = ? WHERE id = ? AND status = 'scan_pending' AND scan_attempts < 3
    AND (scan_lease_expires_at IS NULL OR scan_lease_expires_at < ?)`)
    .bind(leaseHash(leaseToken), expiresAt, now, candidate.id, now).run();
  return (updated.meta.changes ?? 0) === 1 ? { assetId: candidate.id, leaseToken, expiresAt } : null;
}

export async function readHubAdScanInput(database: D1Database, quarantine: R2Bucket, id: string, leaseToken: string) {
  if (!validHubAdAssetId(id)) return null;
  const row = await database.prepare(`SELECT id, quarantine_object_key, clean_object_key, status, structural_result
    FROM hub_ad_image_assets WHERE id = ? AND scan_lease_token_hash = ? AND scan_lease_expires_at >= ?`)
    .bind(id, leaseHash(leaseToken), Date.now()).first<AssetRow>();
  if (!row || row.status !== "scan_pending" || row.structural_result !== "passed") return null;
  return quarantine.get(row.quarantine_object_key);
}

export async function recordHubAdScanResult(database: D1Database, quarantine: R2Bucket, clean: R2Bucket, id: string,
  leaseToken: string, input: { result: "clean" | "malicious" | "error"; provider: string }, now = Date.now()) {
  if (!validHubAdAssetId(id) || !/^[A-Za-z0-9._-]{2,64}$/.test(input.provider)) return null;
  const row = await database.prepare(`SELECT id, quarantine_object_key, clean_object_key, status, structural_result, scan_attempts
    FROM hub_ad_image_assets WHERE id = ? AND scan_lease_token_hash = ? AND scan_lease_expires_at >= ?`)
    .bind(id, leaseHash(leaseToken), now).first<AssetRow & { scan_attempts: number }>();
  if (!row || row.status !== "scan_pending" || row.structural_result !== "passed") return null;
  if (input.result !== "clean") {
    const rejected = input.result === "malicious" || row.scan_attempts >= 3;
    const rejectionCode = input.result === "malicious" ? "malware_detected" : rejected ? "scanner_retries_exhausted" : null;
    await database.prepare(`UPDATE hub_ad_image_assets SET status = ?, scanner_provider = ?, scanner_result = ?,
      rejection_code = ?, scanned_at = ?, scan_lease_token_hash = NULL, scan_lease_expires_at = NULL, updated_at = ?
      WHERE id = ? AND status = 'scan_pending' AND scan_lease_token_hash = ?`)
      .bind(rejected ? "rejected" : "scan_pending", input.provider, input.result, rejectionCode, now, now, id, leaseHash(leaseToken)).run();
    return { id, status: rejected ? "rejected" : "scan_pending" };
  }
  const original = await quarantine.get(row.quarantine_object_key); if (!original) throw new Error("quarantine_object_missing");
  const sanitized = sanitizeHubAdPng(new Uint8Array(await original.arrayBuffer()));
  const cleanKey = `clean/${id}.png`; const sanitizedSha256 = createHash("sha256").update(sanitized.bytes).digest("hex");
  await clean.put(cleanKey, sanitized.bytes, { httpMetadata: { contentType: HUB_AD_IMAGE_MIME, cacheControl: "public, max-age=31536000, immutable" }, customMetadata: { assetId: id } });
  const updated = await database.prepare(`UPDATE hub_ad_image_assets SET status = 'clean', clean_object_key = ?, sanitized_sha256 = ?,
    scanner_provider = ?, scanner_result = 'clean', scanned_at = ?, scan_lease_token_hash = NULL,
    scan_lease_expires_at = NULL, updated_at = ? WHERE id = ? AND status = 'scan_pending' AND scan_lease_token_hash = ?`)
    .bind(cleanKey, sanitizedSha256, input.provider, now, now, id, leaseHash(leaseToken)).run();
  if ((updated.meta.changes ?? 0) !== 1) { await clean.delete(cleanKey); return null; }
  await quarantine.delete(row.quarantine_object_key);
  return { id, status: "clean", width: sanitized.width, height: sanitized.height };
}

export async function getCleanHubAdAssetKey(database: D1Database, id: string) {
  if (!validHubAdAssetId(id)) return null;
  const row = await database.prepare(`SELECT a.clean_object_key FROM hub_ad_image_assets a WHERE a.id = ? AND a.status = 'clean'
    AND a.structural_result = 'passed' AND a.scanner_result = 'clean' AND EXISTS (
      SELECT 1 FROM hub_ad_creative_versions cv JOIN hub_ad_creatives cr ON cr.id = cv.creative_id
      WHERE cv.image_asset_path = '/api/ads/assets/' || a.id AND cv.version = cr.current_version
        AND cv.review_status IN ('approved', 'approved_with_restrictions') AND cr.status = 'approved'
    )`).bind(id).first<{ clean_object_key: string }>();
  return row?.clean_object_key ?? null;
}
