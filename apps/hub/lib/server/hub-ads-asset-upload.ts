import "server-only";

import { createHash } from "node:crypto";
import type { D1Database, R2Bucket } from "@cloudflare/workers-types";
import { InvalidPngError, sanitizeHubAdPng } from "@/lib/hub-ads-png";
import { HUB_AD_IMAGE_MIME } from "@/lib/server/hub-ads-assets";
import { reserveHubAdAtomicIdempotency } from "@/lib/server/hub-ads-idempotency";

type StructuralResult =
  | { status: "scan_pending"; structuralResult: "passed"; width: number; height: number; rejectionCode: null }
  | { status: "rejected"; structuralResult: "failed"; width: null; height: null; rejectionCode: string };

type ExistingAsset = {
  id: string;
  quarantineObjectKey: string;
  status: "quarantined" | "scan_pending" | "clean" | "rejected";
  structuralResult: "pending" | "passed" | "failed";
  width: number | null;
  height: number | null;
  rejectionCode: string | null;
};

export type HubAdAssetUploadBody = {
  id: string;
  status: "scan_pending" | "clean" | "rejected";
  width?: number;
  height?: number;
  rejectionCode?: string;
};

export type HubAdAssetUploadResult =
  | { kind: "response"; status: number; body: HubAdAssetUploadBody }
  | { kind: "conflict"; reason: "key_reused" | "in_progress" | "invalid_key" }
  | { kind: "unknown" };

export type PreparedHubAdAssetUpload = {
  advertiserRef: string;
  bytes: Uint8Array;
  byteSize: number;
  originalSha256: string;
  assetId: string;
  objectKey: string;
  structural: StructuralResult;
};

function deterministicUuid(hex: string) {
  const value = `${hex.slice(0, 12)}5${hex.slice(13, 16)}a${hex.slice(17, 20)}${hex.slice(20, 32)}`;
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

export function prepareHubAdAssetUpload(advertiserRef: string, bytes: Uint8Array): PreparedHubAdAssetUpload {
  const originalSha256 = createHash("sha256").update(bytes).digest("hex");
  const identity = createHash("sha256").update(advertiserRef).update("\0").update(originalSha256).digest("hex");
  let structural: StructuralResult;
  try {
    const parsed = sanitizeHubAdPng(bytes);
    structural = {
      status: "scan_pending",
      structuralResult: "passed",
      width: parsed.width,
      height: parsed.height,
      rejectionCode: null,
    };
  } catch (error) {
    structural = {
      status: "rejected",
      structuralResult: "failed",
      width: null,
      height: null,
      rejectionCode: error instanceof InvalidPngError ? error.code : "structural_error",
    };
  }
  const assetId = deterministicUuid(identity);
  return {
    advertiserRef,
    bytes,
    byteSize: bytes.byteLength,
    originalSha256,
    assetId,
    objectKey: `original/${assetId}`,
    structural,
  };
}

function responseFor(id: string, structural: StructuralResult): { status: number; body: HubAdAssetUploadBody } {
  if (structural.status === "rejected") {
    return { status: 422, body: { id, status: "rejected", rejectionCode: structural.rejectionCode } };
  }
  return {
    status: 202,
    body: { id, status: "scan_pending", width: structural.width, height: structural.height },
  };
}

function responseForExisting(row: ExistingAsset): { status: number; body: HubAdAssetUploadBody } {
  if (row.status === "clean") {
    return {
      status: 200,
      body: { id: row.id, status: "clean", ...(row.width ? { width: row.width } : {}), ...(row.height ? { height: row.height } : {}) },
    };
  }
  if (row.status === "rejected") {
    return {
      status: 422,
      body: { id: row.id, status: "rejected", ...(row.rejectionCode ? { rejectionCode: row.rejectionCode } : {}) },
    };
  }
  return {
    status: 202,
    body: {
      id: row.id,
      status: "scan_pending",
      ...(row.width ? { width: row.width } : {}),
      ...(row.height ? { height: row.height } : {}),
    },
  };
}

async function findExisting(database: D1Database, upload: PreparedHubAdAssetUpload) {
  return database.prepare(`SELECT id,quarantine_object_key quarantineObjectKey,status,
      structural_result structuralResult,width,height,rejection_code rejectionCode
    FROM hub_ad_image_assets WHERE advertiser_ref=? AND original_sha256=?
    ORDER BY created_at ASC LIMIT 1`)
    .bind(upload.advertiserRef, upload.originalSha256).first<ExistingAsset>();
}

export async function commitHubAdAssetUploadAtomically(
  database: D1Database,
  upload: PreparedHubAdAssetUpload,
  reservation: { scope: string; key: string; executionToken: string },
  response: { status: number; body: HubAdAssetUploadBody },
  existing: ExistingAsset | null,
  now = Date.now(),
) {
  const targetId = existing?.id ?? upload.assetId;
  const targetObjectKey = existing?.quarantineObjectKey ?? upload.objectKey;
  const statements = [];
  if (!existing) {
    statements.push(database.prepare(`INSERT OR IGNORE INTO hub_ad_image_assets(
        id,advertiser_ref,mime_type,byte_size,original_sha256,quarantine_object_key,width,height,
        status,structural_result,rejection_code,created_at,updated_at
      ) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?
      FROM hub_ad_admin_idempotency i
      WHERE i.scope=? AND i.idempotency_key=? AND i.execution_token=? AND i.state='processing'`)
      .bind(targetId, upload.advertiserRef, HUB_AD_IMAGE_MIME, upload.byteSize, upload.originalSha256,
        targetObjectKey, upload.structural.width, upload.structural.height, upload.structural.status,
        upload.structural.structuralResult, upload.structural.rejectionCode, now, now,
        reservation.scope, reservation.key, reservation.executionToken));
  } else if (existing.status === "quarantined") {
    statements.push(database.prepare(`UPDATE hub_ad_image_assets SET width=?,height=?,status=?,structural_result=?,
        rejection_code=?,updated_at=?
      WHERE id=? AND advertiser_ref=? AND original_sha256=? AND status='quarantined'
        AND EXISTS(SELECT 1 FROM hub_ad_admin_idempotency i WHERE i.scope=? AND i.idempotency_key=?
          AND i.execution_token=? AND i.state='processing')`)
      .bind(upload.structural.width, upload.structural.height, upload.structural.status,
        upload.structural.structuralResult, upload.structural.rejectionCode, now,
        targetId, upload.advertiserRef, upload.originalSha256,
        reservation.scope, reservation.key, reservation.executionToken));
  }
  statements.push(database.prepare(`INSERT INTO hub_ad_asset_upload_receipts(
      scope,idempotency_key,execution_token,request_hash,asset_id,advertiser_ref,original_sha256,
      response_status,response_json,occurred_at
    ) SELECT i.scope,i.idempotency_key,i.execution_token,i.request_hash,a.id,a.advertiser_ref,a.original_sha256,?,?,?
    FROM hub_ad_admin_idempotency i JOIN hub_ad_image_assets a ON a.id=?
    WHERE i.scope=? AND i.idempotency_key=? AND i.execution_token=? AND i.state='processing'
      AND a.advertiser_ref=? AND a.original_sha256=?`)
    .bind(response.status, JSON.stringify(response.body), now, targetId,
      reservation.scope, reservation.key, reservation.executionToken,
      upload.advertiserRef, upload.originalSha256));
  statements.push(database.prepare(`UPDATE hub_ad_admin_idempotency
    SET state='completed',response_status=?,response_json=?,updated_at=?
    WHERE scope=? AND idempotency_key=? AND execution_token=? AND state='processing'`)
    .bind(response.status, JSON.stringify(response.body), now,
      reservation.scope, reservation.key, reservation.executionToken));
  const results = await database.batch(statements);
  const receiptResult = results.at(-2);
  const completionResult = results.at(-1);
  if ((receiptResult?.meta.changes ?? 0) !== 1 || (completionResult?.meta.changes ?? 0) !== 1) {
    throw new Error("hub_ad_asset_upload_atomic_completion_unconfirmed");
  }
}

export async function processHubAdAssetUpload(
  database: D1Database,
  quarantine: R2Bucket,
  input: { scope: string; idempotencyKey: string | null; advertiserRef: string; bytes: Uint8Array },
  now = Date.now(),
): Promise<HubAdAssetUploadResult> {
  const upload = prepareHubAdAssetUpload(input.advertiserRef, input.bytes);
  const intent = {
    advertiserRef: upload.advertiserRef,
    mimeType: HUB_AD_IMAGE_MIME,
    byteSize: upload.byteSize,
    originalSha256: upload.originalSha256,
  };
  const reservation = await reserveHubAdAtomicIdempotency(database, input.scope, input.idempotencyKey, intent, now);
  if (reservation.kind === "replay") {
    return { kind: "response", status: reservation.status, body: reservation.body as HubAdAssetUploadBody };
  }
  if (reservation.kind === "conflict") return reservation;
  const existing = await findExisting(database, upload);
  const response = existing?.status === "quarantined"
    ? responseFor(existing.id, upload.structural)
    : existing
      ? responseForExisting(existing)
      : responseFor(upload.assetId, upload.structural);
  try {
    if (!existing || existing.status === "quarantined" || existing.status === "scan_pending") {
      await quarantine.put(existing?.quarantineObjectKey ?? upload.objectKey, upload.bytes, {
        httpMetadata: { contentType: HUB_AD_IMAGE_MIME },
        customMetadata: { assetId: existing?.id ?? upload.assetId },
      });
    }
    await commitHubAdAssetUploadAtomically(database, upload, {
      scope: input.scope,
      key: input.idempotencyKey!,
      executionToken: reservation.executionToken,
    }, response, existing, now);
    return { kind: "response", ...response };
  } catch {
    return { kind: "unknown" };
  }
}
