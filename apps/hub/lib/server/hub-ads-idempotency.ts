import "server-only";

import { createHash } from "node:crypto";
import type { D1Database } from "@cloudflare/workers-types";

export type HubAdIdempotencyReservation =
  | { kind: "owner"; executionToken: string }
  | { kind: "replay"; status: number; body: unknown }
  | { kind: "conflict"; reason: "key_reused" | "in_progress" | "invalid_key" };

const ATOMIC_OPERATION_LEASE_MS = 30_000;
const RETENTION_MS = 24 * 60 * 60 * 1000;

type IdempotencyRow = {
  request_hash: string;
  execution_token: string;
  state: string;
  response_status: number | null;
  response_json: string | null;
  updated_at: number;
};

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function requestHash(value: unknown) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function completedResult(row: IdempotencyRow): HubAdIdempotencyReservation {
  if (row.state !== "completed" || row.response_status === null || row.response_json === null) {
    return { kind: "conflict", reason: "in_progress" };
  }
  try { return { kind: "replay", status: row.response_status, body: JSON.parse(row.response_json) as unknown }; }
  catch { return { kind: "conflict", reason: "in_progress" }; }
}

export async function inspectHubAdIdempotency(
  database: D1Database,
  scope: string,
  key: string | null,
  requestBody: unknown,
): Promise<HubAdIdempotencyReservation | null> {
  if (!key || !/^[A-Za-z0-9._:-]{8,128}$/.test(key)) return { kind: "conflict", reason: "invalid_key" };
  const expectedHash = requestHash(requestBody);
  const row = await database.prepare(`SELECT request_hash,execution_token,state,response_status,response_json,updated_at
    FROM hub_ad_admin_idempotency WHERE scope=? AND idempotency_key=?`)
    .bind(scope, key).first<IdempotencyRow>();
  if (!row) return null;
  if (row.request_hash !== expectedHash) return { kind: "conflict", reason: "key_reused" };
  return completedResult(row);
}

async function reserve(
  database: D1Database,
  scope: string,
  key: string | null,
  requestBody: unknown,
  now: number,
  staleLeaseMs: number | null,
): Promise<HubAdIdempotencyReservation> {
  if (!key || !/^[A-Za-z0-9._:-]{8,128}$/.test(key)) return { kind: "conflict", reason: "invalid_key" };
  const requestDigest = requestHash(requestBody);
  const executionToken = crypto.randomUUID();
  await database.prepare(`INSERT OR IGNORE INTO hub_ad_admin_idempotency
    (scope, idempotency_key, request_hash, execution_token, state, created_at, updated_at, expires_at)
    VALUES (?, ?, ?, ?, 'processing', ?, ?, ?)`)
    .bind(scope, key, requestDigest, executionToken, now, now, now + RETENTION_MS).run();
  let row = await database.prepare(`SELECT request_hash, execution_token, state, response_status, response_json, updated_at
    FROM hub_ad_admin_idempotency WHERE scope = ? AND idempotency_key = ?`)
    .bind(scope, key).first<IdempotencyRow>();
  if (!row || row.request_hash !== requestDigest) return { kind: "conflict", reason: "key_reused" };
  if (row.execution_token === executionToken) return { kind: "owner", executionToken };
  if (row.state === "processing" && staleLeaseMs !== null && row.updated_at <= now - staleLeaseMs) {
    const takeover = await database.prepare(`UPDATE hub_ad_admin_idempotency
      SET execution_token=?,updated_at=?,expires_at=?
      WHERE scope=? AND idempotency_key=? AND request_hash=? AND state='processing'
        AND execution_token=? AND updated_at=?`)
      .bind(executionToken, now, now + RETENTION_MS, scope, key, requestDigest, row.execution_token, row.updated_at).run();
    if ((takeover.meta.changes ?? 0) > 0) return { kind: "owner", executionToken };
    row = await database.prepare(`SELECT request_hash, execution_token, state, response_status, response_json, updated_at
      FROM hub_ad_admin_idempotency WHERE scope=? AND idempotency_key=?`)
      .bind(scope, key).first<IdempotencyRow>();
    if (!row || row.request_hash !== requestDigest) return { kind: "conflict", reason: "key_reused" };
  }
  return completedResult(row);
}

export function reserveHubAdIdempotency(
  database: D1Database,
  scope: string,
  key: string | null,
  requestBody: unknown,
  now = Date.now(),
) {
  return reserve(database, scope, key, requestBody, now, null);
}

/**
 * Only use this reservation for mutations that commit their side effect and
 * completed idempotency response in the same D1 batch. A stale processing row
 * can then be taken over without risking a duplicate committed side effect.
 */
export function reserveHubAdAtomicIdempotency(
  database: D1Database,
  scope: string,
  key: string | null,
  requestBody: unknown,
  now = Date.now(),
) {
  return reserve(database, scope, key, requestBody, now, ATOMIC_OPERATION_LEASE_MS);
}

export async function completeHubAdIdempotency(
  database: D1Database,
  scope: string,
  key: string,
  executionToken: string,
  status: number,
  body: unknown,
  now = Date.now(),
): Promise<void> {
  await database.prepare(`UPDATE hub_ad_admin_idempotency
    SET state = 'completed', response_status = ?, response_json = ?, updated_at = ?
    WHERE scope = ? AND idempotency_key = ? AND execution_token = ? AND state = 'processing'`)
    .bind(status, JSON.stringify(body), now, scope, key, executionToken).run();
}
