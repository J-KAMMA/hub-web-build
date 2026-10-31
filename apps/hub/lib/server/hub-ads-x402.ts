import type { D1Database } from "@cloudflare/workers-types";
import type { PaymentRequired } from "@x402/core/types";
import { signTaxEventReceipt } from "./tax-event-receipt";

export const HUB_AD_X402_NETWORK = "eip155:84532";
export const HUB_AD_X402_CURRENCY = "USDC";
const QUOTE_TTL_MS = 10 * 60 * 1000;
const FACILITATOR_TIMEOUT_MS = 300 * 1000;
const SETTLEMENT_LEASE_MS = 330 * 1000;

type HubAdX402DepositRow = {
  id: string;
  campaignId: string;
  network: string;
  asset: string;
  amount: number;
  credit: number;
  status: string;
  expiresAt: number;
  transactionHash: string | null;
  settledAt: number | null;
};

type HubAdX402SettlementAttempt = {
  operationToken: string;
  state: "reserved" | "submitted" | "external_confirmed" | "completed" | "unknown";
  transactionHash: string | null;
  lockedUntil: number;
  updatedAt: number;
};

export function safeFacilitatorReason(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(value) ? value : undefined;
}

export type HubAdsX402Config = {
  enabled: boolean;
  network: typeof HUB_AD_X402_NETWORK;
  currency: typeof HUB_AD_X402_CURRENCY;
  asset?: string;
  payTo?: string;
  facilitatorUrl?: string;
  jpyPerUsdc?: number;
};

function evmAddress(value: string | undefined) {
  return value && /^0x[0-9a-fA-F]{40}$/.test(value) ? value.toLowerCase() : undefined;
}

export function getHubAdsX402Config(environment: NodeJS.ProcessEnv = process.env): HubAdsX402Config {
  const asset = evmAddress(environment.HUB_ADS_X402_USDC_ADDRESS);
  const payTo = evmAddress(environment.HUB_ADS_X402_PAY_TO);
  const facilitatorUrl = environment.HUB_ADS_X402_FACILITATOR_URL?.trim();
  const jpyPerUsdc = Number(environment.HUB_ADS_X402_JPY_PER_USDC);
  const validFacilitator = facilitatorUrl && /^https:\/\//.test(facilitatorUrl) ? facilitatorUrl.replace(/\/$/, "") : undefined;
  return {
    enabled: Boolean(asset && payTo && validFacilitator && Number.isFinite(jpyPerUsdc) && jpyPerUsdc > 0),
    network: HUB_AD_X402_NETWORK,
    currency: HUB_AD_X402_CURRENCY,
    asset,
    payTo,
    facilitatorUrl: validFacilitator,
    jpyPerUsdc: Number.isFinite(jpyPerUsdc) && jpyPerUsdc > 0 ? jpyPerUsdc : undefined,
  };
}

export async function createHubAdX402Deposit(database: D1Database, campaignId: string, advertiserRef: string, amountJpyMicros: number, now = Date.now()) {
  const config = getHubAdsX402Config();
  if (!config.enabled || !config.jpyPerUsdc || !Number.isSafeInteger(amountJpyMicros) || amountJpyMicros < 1_000_000) return null;
  const campaign = await database.prepare("SELECT advertiser_ref AS advertiserRef, total_budget_jpy_micros AS budget FROM hub_ad_campaigns WHERE id = ?")
    .bind(campaignId).first<{ advertiserRef: string; budget: number }>();
  if (!campaign || campaign.advertiserRef !== advertiserRef || amountJpyMicros > campaign.budget) return null;
  const amountUsdcAtomic = Math.ceil(amountJpyMicros / 1_000_000 / config.jpyPerUsdc * 1_000_000);
  if (!Number.isSafeInteger(amountUsdcAtomic) || amountUsdcAtomic < 1) return null;
  const id = crypto.randomUUID(); const expiresAt = now + QUOTE_TTL_MS;
  await database.prepare(`INSERT INTO hub_ad_x402_deposits
    (id, campaign_id, advertiser_ref, network, asset, amount_usdc_atomic, credited_jpy_micros, status, expires_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`)
    .bind(id, campaignId, advertiserRef, HUB_AD_X402_NETWORK, config.asset, amountUsdcAtomic, amountJpyMicros, expiresAt, now, now).run();
  return { id, campaignId, network: HUB_AD_X402_NETWORK, currency: HUB_AD_X402_CURRENCY, asset: config.asset!, payTo: config.payTo!,
    amountUsdcAtomic, creditedJpyMicros: amountJpyMicros, expiresAt };
}

export async function getHubAdX402PaymentRequired(database: D1Database, depositId: string, now = Date.now()) {
  const config = getHubAdsX402Config();
  if (!config.enabled) return null;
  const deposit = await database.prepare(`SELECT amount_usdc_atomic AS amount, status, expires_at AS expiresAt
    FROM hub_ad_x402_deposits WHERE id = ?`).bind(depositId)
    .first<{ amount: number; status: string; expiresAt: number }>();
  if (!deposit || deposit.status !== "pending" || deposit.expiresAt <= now) return null;
  return { x402Version: 2 as const, resource: { url: `/api/admin/ads/x402-deposits/${encodeURIComponent(depositId)}/settle`,
    description: "Hub Ads campaign budget prepayment", mimeType: "application/json" },
    accepts: [{ scheme: "exact", network: HUB_AD_X402_NETWORK, amount: String(deposit.amount),
    asset: config.asset!, payTo: config.payTo!, maxTimeoutSeconds: 300, extra: { name: "USDC", version: "2" } }] } satisfies PaymentRequired;
}

async function getHubAdX402Deposit(database: D1Database, depositId: string) {
  return database.prepare(`SELECT id, campaign_id AS campaignId, network, asset, amount_usdc_atomic AS amount,
    credited_jpy_micros AS credit, status, expires_at AS expiresAt, transaction_hash AS transactionHash,
    settled_at AS settledAt FROM hub_ad_x402_deposits WHERE id = ?`)
    .bind(depositId).first<HubAdX402DepositRow>();
}

async function getHubAdX402SettlementAttempt(database: D1Database, depositId: string) {
  return database.prepare(`SELECT operation_token operationToken,state,transaction_hash transactionHash,
    locked_until lockedUntil,updated_at updatedAt FROM hub_ad_x402_settlement_attempts WHERE deposit_id=?`)
    .bind(depositId).first<HubAdX402SettlementAttempt>();
}

async function settledDepositResult(deposit: HubAdX402DepositRow, replayed: boolean, now: number) {
  const transactionHash = deposit.transactionHash?.toLowerCase() ?? "";
  if (!/^0x[0-9a-f]{64}$/.test(transactionHash) || deposit.settledAt === null) {
    return { ok: false as const, error: "deposit_state_invalid" };
  }
  const signingKey = process.env.HUB_ADS_TAX_EVENT_PRIVATE_KEY_PKCS8;
  const taxReceipt = signingKey ? await signTaxEventReceipt({
    issuer: "advertising",
    sourceEventId: deposit.id,
    eventKind: "advertising_spend",
    direction: "expense",
    currency: HUB_AD_X402_CURRENCY,
    netAmount: String(deposit.amount),
    taxAmount: "0",
    grossAmount: String(deposit.amount),
    occurredAt: new Date(deposit.settledAt).toISOString(),
    settlementNetwork: deposit.network,
    settlementReference: transactionHash,
  }, signingKey, now).catch(() => undefined) : undefined;
  return {
    ok: true as const,
    replayed,
    transactionHash,
    creditedJpyMicros: deposit.credit,
    ...(taxReceipt ? { taxReceipt } : {}),
  };
}

async function finalizeHubAdX402Settlement(
  database: D1Database,
  deposit: HubAdX402DepositRow,
  operationToken: string,
  transactionHash: string,
  replayed: boolean,
  settledAt: number,
  now: number,
) {
  try {
    await database.batch([
      database.prepare(`UPDATE hub_ad_x402_deposits
        SET status='settled',transaction_hash=?,settled_at=?,updated_at=?
        WHERE id=? AND status='pending'`)
        .bind(transactionHash, settledAt, now, deposit.id),
      database.prepare(`INSERT OR IGNORE INTO hub_ad_budget_ledger
        (id,campaign_id,line_item_id,entry_type,amount_jpy_micros,idempotency_key,occurred_at,created_at)
        SELECT ?,campaign_id,NULL,'authorization',0,?,?,? FROM hub_ad_x402_deposits
        WHERE id=? AND status='settled' AND transaction_hash=?`)
        .bind(crypto.randomUUID(), `x402:${deposit.id}`, settledAt, now, deposit.id, transactionHash),
      database.prepare(`INSERT OR IGNORE INTO hub_ad_audit_logs
        (id,actor_key,action,target_type,target_id,after_json,occurred_at)
        SELECT ?,'moderation-admin','x402_deposit.settled','x402_deposit',?,
          json_object('transactionHash',?,'creditedJpyMicros',?),?
        FROM hub_ad_x402_deposits WHERE id=? AND status='settled' AND transaction_hash=?`)
        .bind(`x402-settle:${deposit.id}`, deposit.id, transactionHash, deposit.credit, settledAt, deposit.id, transactionHash),
      database.prepare(`UPDATE hub_ad_x402_settlement_attempts SET state='completed',updated_at=?
        WHERE deposit_id=? AND operation_token=? AND state='external_confirmed'
          AND transaction_hash=? AND EXISTS(
            SELECT 1 FROM hub_ad_x402_deposits WHERE id=? AND status='settled' AND transaction_hash=?
          )`)
        .bind(now, deposit.id, operationToken, transactionHash, deposit.id, transactionHash),
    ]);
  } catch {
    return { ok: false as const, error: "payment_settlement_commit_failed", reconciliationRequired: true as const };
  }
  const stored = await getHubAdX402Deposit(database, deposit.id);
  if (!stored || stored.status !== "settled" || stored.transactionHash?.toLowerCase() !== transactionHash) {
    return { ok: false as const, error: "payment_settlement_commit_failed", reconciliationRequired: true as const };
  }
  return settledDepositResult(stored, replayed, now);
}

export async function settleHubAdX402Deposit(database: D1Database, depositId: string, paymentPayload: unknown, now = Date.now()) {
  const deposit = await getHubAdX402Deposit(database, depositId);
  if (!deposit) return { ok: false as const, error: "deposit_unavailable" };
  if (deposit.status === "settled") return settledDepositResult(deposit, true, now);

  let attempt = await getHubAdX402SettlementAttempt(database, deposit.id);
  if (attempt?.state === "external_confirmed" && attempt.transactionHash) {
    return finalizeHubAdX402Settlement(database, deposit, attempt.operationToken, attempt.transactionHash, true, attempt.updatedAt, now);
  }
  if (attempt?.state === "completed") {
    const completed = await getHubAdX402Deposit(database, deposit.id);
    return completed?.status === "settled"
      ? settledDepositResult(completed, true, now)
      : { ok: false as const, error: "deposit_state_invalid" };
  }
  if (attempt?.state === "unknown" || (attempt?.state === "submitted" && attempt.lockedUntil <= now)) {
    return { ok: false as const, error: "payment_settlement_unknown", reconciliationRequired: true as const };
  }
  if (attempt?.state === "submitted") {
    return { ok: false as const, error: "payment_settlement_in_progress", retryAfterSeconds: Math.max(1, Math.ceil((attempt.lockedUntil - now) / 1000)) };
  }

  const config = getHubAdsX402Config();
  if (!config.enabled || !config.facilitatorUrl) return { ok: false as const, error: "payment_not_configured" };
  if (deposit.status !== "pending" || deposit.expiresAt <= now || deposit.network !== HUB_AD_X402_NETWORK || deposit.asset !== config.asset)
    return { ok: false as const, error: "deposit_unavailable" };

  const operationToken = crypto.randomUUID();
  const lockedUntil = now + SETTLEMENT_LEASE_MS;
  await database.prepare(`INSERT OR IGNORE INTO hub_ad_x402_settlement_attempts
    (deposit_id,operation_token,state,locked_until,created_at,updated_at)
    VALUES(?,?,'reserved',?,?,?)`)
    .bind(deposit.id, operationToken, lockedUntil, now, now).run();
  attempt = await getHubAdX402SettlementAttempt(database, deposit.id);

  if (attempt?.state === "external_confirmed" && attempt.transactionHash) {
    return finalizeHubAdX402Settlement(database, deposit, attempt.operationToken, attempt.transactionHash, true, attempt.updatedAt, now);
  }
  if (attempt?.state === "completed") {
    const completed = await getHubAdX402Deposit(database, deposit.id);
    return completed?.status === "settled"
      ? settledDepositResult(completed, true, now)
      : { ok: false as const, error: "deposit_state_invalid" };
  }
  if (attempt?.operationToken !== operationToken && attempt?.state === "reserved" && attempt.lockedUntil <= now) {
    const reclaimed = await database.prepare(`UPDATE hub_ad_x402_settlement_attempts
      SET operation_token=?,locked_until=?,updated_at=?
      WHERE deposit_id=? AND state='reserved' AND locked_until<=?`)
      .bind(operationToken, lockedUntil, now, deposit.id, now).run();
    if ((reclaimed.meta.changes ?? 0) === 1) {
      attempt = { operationToken, state: "reserved", transactionHash: null, lockedUntil, updatedAt: now };
    }
  }
  if (attempt?.operationToken !== operationToken) {
    const unknown = attempt?.state === "unknown" || (attempt?.state === "submitted" && attempt.lockedUntil <= now);
    return unknown
      ? { ok: false as const, error: "payment_settlement_unknown", reconciliationRequired: true as const }
      : { ok: false as const, error: "payment_settlement_in_progress", retryAfterSeconds: Math.max(1, Math.ceil(((attempt?.lockedUntil ?? lockedUntil) - now) / 1000)) };
  }

  const releaseReservation = () => database.prepare(`DELETE FROM hub_ad_x402_settlement_attempts
    WHERE deposit_id=? AND operation_token=? AND state='reserved'`).bind(deposit.id, operationToken).run();
  const requirements = { scheme: "exact", network: HUB_AD_X402_NETWORK, amount: String(deposit.amount), asset: config.asset,
    payTo: config.payTo, maxTimeoutSeconds: 300, extra: { name: "USDC", version: "2" } };
  const call = async (path: "verify" | "settle") => {
    const response = await fetch(`${config.facilitatorUrl}/${path}`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ x402Version: 2, paymentPayload, paymentRequirements: requirements }),
      signal: AbortSignal.timeout(FACILITATOR_TIMEOUT_MS) });
    const body = await response.json().catch(() => null);
    return {
      transportOk: response.ok,
      body: body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : null,
    };
  };
  const verification = await call("verify").catch(() => null);
  const verified = verification?.body;
  if (!verification?.transportOk || !verified || verified.isValid !== true) {
    await releaseReservation();
    const reason = safeFacilitatorReason(verified?.invalidReason);
    return { ok: false as const, error: reason ? `payment_verification_failed:${reason}` : "payment_verification_failed" };
  }

  const submitted = await database.prepare(`UPDATE hub_ad_x402_settlement_attempts
    SET state='submitted',updated_at=? WHERE deposit_id=? AND operation_token=? AND state='reserved'`)
    .bind(now, deposit.id, operationToken).run();
  if ((submitted.meta.changes ?? 0) !== 1) {
    return { ok: false as const, error: "payment_settlement_in_progress", retryAfterSeconds: SETTLEMENT_LEASE_MS / 1000 };
  }
  const settlement = await call("settle").catch(() => null);
  const settled = settlement?.body;
  if (!settlement?.transportOk || !settled) {
    await database.prepare(`UPDATE hub_ad_x402_settlement_attempts SET state='unknown',updated_at=?
      WHERE deposit_id=? AND operation_token=? AND state='submitted'`).bind(now, deposit.id, operationToken).run();
    return { ok: false as const, error: "payment_settlement_unknown", reconciliationRequired: true as const };
  }
  const txHash = typeof settled.transaction === "string" ? settled.transaction
    : typeof settled.transactionHash === "string" ? settled.transactionHash : "";
  if (settled.success !== true || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    await database.prepare(`DELETE FROM hub_ad_x402_settlement_attempts
      WHERE deposit_id=? AND operation_token=? AND state='submitted'`).bind(deposit.id, operationToken).run();
    const reason = safeFacilitatorReason(settled.errorReason);
    return { ok: false as const, error: reason ? `payment_settlement_failed:${reason}` : "payment_settlement_failed" };
  }

  const transactionHash = txHash.toLowerCase();
  const confirmed = await database.prepare(`UPDATE hub_ad_x402_settlement_attempts
    SET state='external_confirmed',transaction_hash=?,updated_at=?
    WHERE deposit_id=? AND operation_token=? AND state='submitted'`)
    .bind(transactionHash, now, deposit.id, operationToken).run();
  if ((confirmed.meta.changes ?? 0) !== 1) {
    return { ok: false as const, error: "payment_settlement_unknown", reconciliationRequired: true as const };
  }
  return finalizeHubAdX402Settlement(database, deposit, operationToken, transactionHash, false, now, now);
}

type ReconciliationAttempt = HubAdX402SettlementAttempt & { depositId: string };

async function openSettlementAlert(database: D1Database, depositId: string, state: string, now: number) {
  return database.prepare(`INSERT INTO hub_ad_operational_alerts
    (id,alert_key,severity,category,summary,status,created_at,updated_at)
    VALUES(?,?,'critical','payment',?,'open',?,?)
    ON CONFLICT(alert_key) DO UPDATE SET summary=excluded.summary,status='open',updated_at=excluded.updated_at`)
    .bind(
      crypto.randomUUID(),
      `x402.settlement.${depositId}`,
      `x402入金確定は外部状態の手動照合が必要です: state=${state}`,
      now,
      now,
    ).run();
}

async function resolveSettlementAlert(database: D1Database, depositId: string, now: number) {
  return database.prepare(`UPDATE hub_ad_operational_alerts SET status='resolved',updated_at=?
    WHERE alert_key=? AND status!='resolved'`)
    .bind(now, `x402.settlement.${depositId}`).run();
}

export async function reconcileHubAdX402SettlementAttempts(database: D1Database, now = Date.now()) {
  const result = await database.prepare(`SELECT deposit_id depositId,operation_token operationToken,state,
    transaction_hash transactionHash,locked_until lockedUntil,updated_at updatedAt
    FROM hub_ad_x402_settlement_attempts WHERE state!='completed' ORDER BY updated_at ASC LIMIT 201`)
    .all<ReconciliationAttempt>();
  const attempts = result.results.slice(0, 200);
  const reconciliationRequired: Array<{ depositId: string; state: string }> = [];
  let recovered = 0;
  let released = 0;
  let inProgress = 0;

  for (const attempt of attempts) {
    if (attempt.state === "reserved") {
      if (attempt.lockedUntil > now) {
        inProgress += 1;
        continue;
      }
      const removed = await database.prepare(`DELETE FROM hub_ad_x402_settlement_attempts
        WHERE deposit_id=? AND operation_token=? AND state='reserved' AND locked_until<=?`)
        .bind(attempt.depositId, attempt.operationToken, now).run();
      released += removed.meta.changes ?? 0;
      continue;
    }
    if (attempt.state === "submitted" && attempt.lockedUntil > now) {
      inProgress += 1;
      continue;
    }
    if (attempt.state === "external_confirmed" && attempt.transactionHash) {
      const deposit = await getHubAdX402Deposit(database, attempt.depositId);
      if (deposit) {
        const finalized = await finalizeHubAdX402Settlement(
          database,
          deposit,
          attempt.operationToken,
          attempt.transactionHash,
          true,
          attempt.updatedAt,
          now,
        );
        if (finalized.ok) {
          recovered += 1;
          await resolveSettlementAlert(database, attempt.depositId, now);
          continue;
        }
      }
    }
    const state = attempt.state === "submitted" ? "submitted_expired" : attempt.state;
    reconciliationRequired.push({ depositId: attempt.depositId, state });
    await openSettlementAlert(database, attempt.depositId, state, now);
  }

  return {
    attemptsChecked: attempts.length,
    recovered,
    released,
    inProgress,
    reconciliationRequired,
    truncated: result.results.length > attempts.length,
  };
}
