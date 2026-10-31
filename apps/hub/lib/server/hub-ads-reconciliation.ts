import type {D1Database} from "@cloudflare/workers-types";
import {reconcileHubAdX402SettlementAttempts} from "@/lib/server/hub-ads-x402";

export async function reconcileHubAdBilling(database:D1Database,now=Date.now()){
 const settlementAttempts=await reconcileHubAdX402SettlementAttempts(database,now);
 const rows=await database.prepare(`SELECT c.id campaignId,c.funded_jpy_micros funded,
  COALESCE((SELECT SUM(d.credited_jpy_micros) FROM hub_ad_x402_deposits d WHERE d.campaign_id=c.id AND d.status='settled'),0) settledCredits,
  COALESCE((SELECT SUM(b.amount_jpy_micros) FROM hub_ad_budget_ledger b WHERE b.campaign_id=c.id),0) spent,
  COALESCE((SELECT SUM(r.amount_usdc_atomic) FROM hub_ad_refunds r WHERE r.campaign_id=c.id AND r.status IN ('confirmed','recorded')),0) refundedAtomic
  FROM hub_ad_campaigns c`).all<{campaignId:string;funded:number;settledCredits:number;spent:number;refundedAtomic:number}>();
 const mismatches=rows.results.filter(row=>row.funded!==row.settledCredits||row.spent>row.funded);
 for(const row of mismatches){const key=`billing.mismatch.${row.campaignId}`;await database.prepare(`INSERT INTO hub_ad_operational_alerts
  (id,alert_key,severity,category,summary,status,created_at,updated_at) VALUES(?,?,'critical','payment',?,'open',?,?)
  ON CONFLICT(alert_key) DO UPDATE SET summary=excluded.summary,status='open',updated_at=excluded.updated_at`)
  .bind(crypto.randomUUID(),key,`広告予算照合不一致: funded=${row.funded}, settled=${row.settledCredits}, spent=${row.spent}`,now,now).run();}
 return{campaignsChecked:rows.results.length,mismatches:mismatches.length,settlementAttempts,rows:rows.results};
}
