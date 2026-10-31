import "server-only";

import { createHash } from "node:crypto";
import type { D1Database } from "@cloudflare/workers-types";
import { inspectHubAdLandingUrl, type LandingCheckResult } from "@/lib/server/hub-ads-landing-monitor";
import { resolveHubAdHostname, type HubAdHostnameResolver } from "@/lib/server/hub-ads-landing-network-policy";
import { inspectHubAdIdempotency, reserveHubAdAtomicIdempotency } from "@/lib/server/hub-ads-idempotency";

type PinnedOperation = {
  targetState: "pinned" | "missing";
  creativeVersionId: string | null;
  urlHash: string | null;
};

type CurrentCreativeVersion = { id: string; landingUrl: string };

export type HubAdLandingCheckBody = LandingCheckResult & {
  creativeVersionId: string;
  checkId: string;
  auditId: string;
  checkedAt: number;
};

export type HubAdLandingCheckOperationResult =
  | { kind: "response"; status: number; body: HubAdLandingCheckBody | { error: string; creativeVersionId?: string } }
  | { kind: "conflict"; reason: "key_reused" | "in_progress" | "invalid_key" }
  | { kind: "unknown" };

async function currentVersion(database: D1Database, creativeId: string) {
  return database.prepare(`SELECT cv.id,cv.landing_url landingUrl
    FROM hub_ad_creatives cr JOIN hub_ad_creative_versions cv
      ON cv.creative_id=cr.id AND cv.version=cr.current_version
    WHERE cr.id=? AND cr.status!='archived'`)
    .bind(creativeId).first<CurrentCreativeVersion>();
}

async function pinOperation(
  database: D1Database,
  input: { scope: string; key: string; executionToken: string; creativeId: string },
  now: number,
) {
  const version = await currentVersion(database, input.creativeId);
  const urlHash = version ? createHash("sha256").update(version.landingUrl).digest("hex") : null;
  await database.prepare(`INSERT OR IGNORE INTO hub_ad_landing_check_operations(
      scope,idempotency_key,creative_id,target_state,creative_version_id,url_hash,state,created_at,updated_at
    ) SELECT i.scope,i.idempotency_key,?,?,?,?, 'processing',?,?
    FROM hub_ad_admin_idempotency i
    WHERE i.scope=? AND i.idempotency_key=? AND i.execution_token=? AND i.state='processing'`)
    .bind(input.creativeId, version ? "pinned" : "missing", version?.id ?? null, urlHash, now, now,
      input.scope, input.key, input.executionToken).run();
  return database.prepare(`SELECT o.target_state targetState,o.creative_version_id creativeVersionId,o.url_hash urlHash
    FROM hub_ad_landing_check_operations o JOIN hub_ad_admin_idempotency i
      ON i.scope=o.scope AND i.idempotency_key=o.idempotency_key
    WHERE o.scope=? AND o.idempotency_key=? AND o.state='processing'
      AND i.execution_token=? AND i.state='processing'`)
    .bind(input.scope, input.key, input.executionToken).first<PinnedOperation>();
}

async function completeWithoutCheck(
  database: D1Database,
  reservation: { scope: string; key: string; executionToken: string },
  status: 404 | 409,
  body: { error: string; creativeVersionId?: string },
  now: number,
) {
  const results = await database.batch([
    database.prepare(`UPDATE hub_ad_landing_check_operations SET state='completed',response_status=?,response_json=?,updated_at=?
      WHERE scope=? AND idempotency_key=? AND state='processing'
        AND EXISTS(SELECT 1 FROM hub_ad_admin_idempotency i WHERE i.scope=? AND i.idempotency_key=?
          AND i.execution_token=? AND i.state='processing')`)
      .bind(status, JSON.stringify(body), now, reservation.scope, reservation.key,
        reservation.scope, reservation.key, reservation.executionToken),
    database.prepare(`UPDATE hub_ad_admin_idempotency SET state='completed',response_status=?,response_json=?,updated_at=?
      WHERE scope=? AND idempotency_key=? AND execution_token=? AND state='processing'`)
      .bind(status, JSON.stringify(body), now,
        reservation.scope, reservation.key, reservation.executionToken),
  ]);
  if (results.some((result) => (result.meta.changes ?? 0) !== 1)) {
    throw new Error("hub_ad_landing_check_terminal_completion_unconfirmed");
  }
}

export async function commitHubAdLandingCheckAtomically(
  database: D1Database,
  input: {
    scope: string;
    key: string;
    executionToken: string;
    creativeId: string;
    creativeVersionId: string;
    urlHash: string;
  },
  check: LandingCheckResult,
  now = Date.now(),
) {
  const checkId = crypto.randomUUID();
  const auditId = input.executionToken;
  const body: HubAdLandingCheckBody = {
    ...check,
    creativeVersionId: input.creativeVersionId,
    checkId,
    auditId,
    checkedAt: now,
  };
  const results = await database.batch([
    database.prepare(`INSERT INTO hub_ad_landing_checks(
        id,creative_version_id,url_hash,final_host,result,reason_code,http_status,redirect_count,checked_at,check_source
      ) SELECT ?,cv.id,?,?,?,?,?,?,?,'moderation_admin'
      FROM hub_ad_creatives cr JOIN hub_ad_creative_versions cv
        ON cv.creative_id=cr.id AND cv.version=cr.current_version
      JOIN hub_ad_landing_check_operations o
        ON o.scope=? AND o.idempotency_key=? AND o.creative_id=cr.id
        AND o.creative_version_id=cv.id AND o.url_hash=? AND o.state='processing'
      JOIN hub_ad_admin_idempotency i
        ON i.scope=o.scope AND i.idempotency_key=o.idempotency_key
        AND i.execution_token=? AND i.state='processing'
      WHERE cr.id=? AND cr.status!='archived' AND cv.id=?`)
      .bind(checkId, input.urlHash, check.finalHost ?? null, check.result, check.reasonCode,
        check.httpStatus ?? null, check.redirectCount, now,
        input.scope, input.key, input.urlHash, input.executionToken,
        input.creativeId, input.creativeVersionId),
    database.prepare(`INSERT INTO hub_ad_audit_logs(
        id,actor_key,action,target_type,target_id,before_json,after_json,occurred_at
      ) SELECT ?,'moderation-admin','creative.landing_checked','creative_version',lc.creative_version_id,NULL,?,?
      FROM hub_ad_landing_checks lc JOIN hub_ad_admin_idempotency i
        ON i.scope=? AND i.idempotency_key=? AND i.execution_token=? AND i.state='processing'
      WHERE lc.id=? AND lc.creative_version_id=?`)
      .bind(auditId, JSON.stringify(body), now,
        input.scope, input.key, input.executionToken, checkId, input.creativeVersionId),
    database.prepare(`UPDATE hub_ad_landing_check_operations
      SET state='completed',response_status=200,response_json=?,updated_at=?
      WHERE scope=? AND idempotency_key=? AND creative_id=? AND creative_version_id=? AND url_hash=?
        AND state='processing' AND EXISTS(SELECT 1 FROM hub_ad_landing_checks WHERE id=?)
        AND EXISTS(SELECT 1 FROM hub_ad_admin_idempotency i WHERE i.scope=? AND i.idempotency_key=?
          AND i.execution_token=? AND i.state='processing')`)
      .bind(JSON.stringify(body), now, input.scope, input.key, input.creativeId,
        input.creativeVersionId, input.urlHash, checkId,
        input.scope, input.key, input.executionToken),
    database.prepare(`UPDATE hub_ad_admin_idempotency SET state='completed',response_status=200,response_json=?,updated_at=?
      WHERE scope=? AND idempotency_key=? AND execution_token=? AND state='processing'`)
      .bind(JSON.stringify(body), now, input.scope, input.key, input.executionToken),
  ]);
  if (results.some((result) => (result.meta.changes ?? 0) !== 1)) {
    throw new Error("hub_ad_landing_check_atomic_completion_unconfirmed");
  }
  return body;
}

export async function processHubAdAdminLandingCheck(
  database: D1Database,
  creativeId: string,
  idempotencyKey: string | null,
  fetcher?: typeof fetch,
  now = Date.now(),
  resolver: HubAdHostnameResolver = resolveHubAdHostname,
): Promise<HubAdLandingCheckOperationResult> {
  const scope = `admin.creative.landing-check.atomic:v1:${creativeId}`;
  const intent = { action: "check-current-creative-landing" };
  const inspected = await inspectHubAdIdempotency(database, scope, idempotencyKey, intent);
  if (inspected?.kind === "replay") {
    return { kind: "response", status: inspected.status, body: inspected.body as HubAdLandingCheckBody };
  }
  if (inspected?.kind === "conflict" && inspected.reason !== "in_progress") return inspected;
  const reservation = await reserveHubAdAtomicIdempotency(database, scope, idempotencyKey, intent, now);
  if (reservation.kind === "replay") {
    return { kind: "response", status: reservation.status, body: reservation.body as HubAdLandingCheckBody };
  }
  if (reservation.kind === "conflict") return reservation;
  try {
    const operation = await pinOperation(database, {
      scope, key: idempotencyKey!, executionToken: reservation.executionToken, creativeId,
    }, now);
    if (!operation) return { kind: "unknown" };
    if (operation.targetState === "missing" || !operation.creativeVersionId || !operation.urlHash) {
      const body = { error: "creative_not_found" };
      await completeWithoutCheck(database, {
        scope, key: idempotencyKey!, executionToken: reservation.executionToken,
      }, 404, body, now);
      return { kind: "response", status: 404, body };
    }
    const current = await currentVersion(database, creativeId);
    const currentHash = current ? createHash("sha256").update(current.landingUrl).digest("hex") : null;
    if (!current || current.id !== operation.creativeVersionId || currentHash !== operation.urlHash) {
      const body = { error: "creative_version_changed", creativeVersionId: operation.creativeVersionId };
      await completeWithoutCheck(database, {
        scope, key: idempotencyKey!, executionToken: reservation.executionToken,
      }, 409, body, now);
      return { kind: "response", status: 409, body };
    }
    const check = await inspectHubAdLandingUrl(current.landingUrl, fetcher, resolver, {
      creativeVersionId: operation.creativeVersionId,
      initialUrlHash: operation.urlHash,
    });
    const body = await commitHubAdLandingCheckAtomically(database, {
      scope,
      key: idempotencyKey!,
      executionToken: reservation.executionToken,
      creativeId,
      creativeVersionId: operation.creativeVersionId,
      urlHash: operation.urlHash,
    }, check, now);
    return { kind: "response", status: 200, body };
  } catch {
    return { kind: "unknown" };
  }
}
