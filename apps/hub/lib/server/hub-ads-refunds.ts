import type { D1Database } from "@cloudflare/workers-types";

import { signTaxEventReceipt } from "@/lib/server/tax-event-receipt";

type HubAdRefundInput = {
  depositId: string;
  amountUsdcAtomic: number;
  reason: string;
  settlementReference: string;
};

type RecordedHubAdRefund = {
  id: string;
  depositId: string;
  amountUsdcAtomic: number;
  reason: string;
  settlementNetwork: string;
  settlementReference: string;
  createdAt: number;
};

export type HubAdRefundResult = {
  id: string;
  replayed: boolean;
  taxReceipt: string | null;
};

const FIND_RECORDED_REFUND_SQL = `SELECT id,deposit_id depositId,amount_usdc_atomic amountUsdcAtomic,reason,
  settlement_network settlementNetwork,settlement_reference settlementReference,created_at createdAt
  FROM hub_ad_refunds WHERE deposit_id=? OR settlement_reference=? LIMIT 1`;

function normalizeInput(input: HubAdRefundInput): HubAdRefundInput | null {
  const reason = input.reason.trim();
  const settlementReference = input.settlementReference.toLowerCase();
  if (
    !/^[0-9a-f-]{36}$/i.test(input.depositId)
    || !Number.isSafeInteger(input.amountUsdcAtomic)
    || input.amountUsdcAtomic <= 0
    || reason.length < 10
    || reason.length > 1000
    || !/^0x[0-9a-f]{64}$/.test(settlementReference)
  ) return null;
  return { ...input, reason, settlementReference };
}

async function findMatchingRefund(database: D1Database, input: HubAdRefundInput) {
  const row = await database.prepare(FIND_RECORDED_REFUND_SQL)
    .bind(input.depositId, input.settlementReference)
    .first<RecordedHubAdRefund>();
  if (
    !row
    || row.depositId !== input.depositId
    || row.amountUsdcAtomic !== input.amountUsdcAtomic
    || row.reason !== input.reason
    || row.settlementReference !== input.settlementReference
  ) return null;
  return row;
}

async function resultForRecordedRefund(row: RecordedHubAdRefund, replayed: boolean, now: number): Promise<HubAdRefundResult> {
  const key = process.env.HUB_ADS_TAX_EVENT_PRIVATE_KEY_PKCS8;
  if (!key) return { id: row.id, replayed, taxReceipt: null };
  const taxReceipt = await signTaxEventReceipt({
    issuer: "advertising",
    sourceEventId: row.id,
    eventKind: "refund",
    direction: "refund_out",
    currency: "USDC",
    netAmount: String(row.amountUsdcAtomic),
    taxAmount: "0",
    grossAmount: String(row.amountUsdcAtomic),
    occurredAt: new Date(row.createdAt).toISOString(),
    settlementNetwork: row.settlementNetwork,
    settlementReference: row.settlementReference,
  }, key, now).catch(() => null);
  return { id: row.id, replayed, taxReceipt };
}

export async function recordConfirmedHubAdRefund(
  database: D1Database,
  rawInput: HubAdRefundInput,
  now = Date.now(),
): Promise<HubAdRefundResult | null> {
  const input = normalizeInput(rawInput);
  if (!input) return null;

  const existing = await findMatchingRefund(database, input);
  if (existing) return resultForRecordedRefund(existing, true, now);

  const deposit = await database.prepare(`SELECT d.id,d.campaign_id campaignId,d.amount_usdc_atomic amount,d.network,d.status
    FROM hub_ad_x402_deposits d WHERE d.id=?`)
    .bind(input.depositId)
    .first<{ id: string; campaignId: string; amount: number; network: string; status: string }>();
  if (!deposit || deposit.status !== "settled" || input.amountUsdcAtomic > deposit.amount) return null;

  const row: RecordedHubAdRefund = {
    id: crypto.randomUUID(),
    depositId: deposit.id,
    amountUsdcAtomic: input.amountUsdcAtomic,
    reason: input.reason,
    settlementNetwork: deposit.network,
    settlementReference: input.settlementReference,
    createdAt: now,
  };
  try {
    await database.batch([
      database.prepare(`INSERT INTO hub_ad_refunds(id,deposit_id,campaign_id,amount_usdc_atomic,reason,settlement_network,settlement_reference,status,created_at)
        VALUES(?,?,?,?,?,?,?,'confirmed',?)`)
        .bind(row.id, row.depositId, deposit.campaignId, row.amountUsdcAtomic, row.reason, row.settlementNetwork, row.settlementReference, row.createdAt),
      database.prepare(`INSERT INTO hub_ad_audit_logs(id,actor_key,action,target_type,target_id,after_json,occurred_at)
        VALUES(?,'moderation-admin','refund.confirmed','x402_deposit',?,json_object('refundId',?,'amountAtomic',?),?)`)
        .bind(crypto.randomUUID(), row.depositId, row.id, row.amountUsdcAtomic, now),
    ]);
    return resultForRecordedRefund(row, false, now);
  } catch {
    // A concurrent retry may have committed the same externally confirmed refund.
    // Only an exact semantic match is replayable; conflicting reuse remains rejected.
    const concurrentlyRecorded = await findMatchingRefund(database, input);
    return concurrentlyRecorded ? resultForRecordedRefund(concurrentlyRecorded, true, now) : null;
  }
}
