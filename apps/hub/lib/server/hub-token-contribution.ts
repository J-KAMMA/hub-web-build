import "server-only";

import type { D1Database } from "@cloudflare/workers-types";
import { normalizeHubTokenBenefits, validateContributionBatch } from "@/lib/hub-token-contribution-response";
import { parseHubTokenLedgerOrigin } from "@/lib/hub-token-ledger-origin";
import { readBoundedJsonResponse } from "@/lib/bounded-json-response";

type LedgerBalance = {
  balanceBaseUnits: string; issuedBaseUnits: string; reversedBaseUnits: string;
  pendingBaseUnits: string; benefitEligibleBaseUnits: string;
  last30DaysBaseUnits: string; last365DaysBaseUnits: string;
  byServiceBaseUnits: Array<{ service: string; issuedBaseUnits: string }>;
  updatedAt: string | null;
};
type LedgerAggregate=LedgerBalance&{level:"supporter"|"silver"|"gold"|"platinum"};

type ContributionEntry = { kind:"revenue"|"refund"; id:string; service:string; units:string; status:string;
  chainId:number; occurredAt:string;
  onchainStatus:string;onchainChainId:number|null;onchainContractAddress:string|null;
  onchainTransactionHash:string|null };

export type HubContributionSummary = LedgerBalance & {
  level: "supporter" | "silver" | "gold" | "platinum";
  linkedWalletCount: number;
  activeWalletCount: number;
  unit: "microETH-contribution";
  transferable: false;
  redeemable: false;
  benefits: string[];
  entries: ContributionEntry[];
};

function configuration() {
  const url = process.env.HUB_TOKEN_LEDGER_URL?.trim();
  const token = process.env.HUB_TOKEN_LEDGER_READ_TOKEN?.trim();
  if (!url || !token || token.length < 43) throw new Error("hub_token_ledger_unavailable");
  return { url: parseHubTokenLedgerOrigin(url), token };
}

export async function readProfileHubContribution(database: D1Database, profileId: string): Promise<HubContributionSummary> {
  // Treat every signature-verified EVM account in the general wallet registry as
  // the same contribution identity as the legacy wallet-link flow. Watch-only
  // accounts are deliberately excluded because their ownership is unproven.
  const links = await database.prepare(`SELECT address, MAX(active) AS active FROM (
      SELECT lower(wallet_address) AS address, active
      FROM profile_wallet_links WHERE profile_id=? AND active=1
      UNION ALL
      SELECT lower(normalized_address) AS address, 1 AS active
      FROM profile_wallet_accounts
      WHERE profile_id=? AND namespace='eip155' AND verification_status='verified'
    ) GROUP BY address LIMIT 21`)
    .bind(profileId, profileId).all<{ address: string; active: number }>();
  if(links.results.length>20)throw new Error("hub_token_wallet_limit_exceeded");
  const batch=links.results.length===0?{contributions:[] as Array<{balance:LedgerBalance;entries:ContributionEntry[]}>,
    aggregate:{balanceBaseUnits:"0",issuedBaseUnits:"0",reversedBaseUnits:"0",pendingBaseUnits:"0",
      benefitEligibleBaseUnits:"0",last30DaysBaseUnits:"0",last365DaysBaseUnits:"0",byServiceBaseUnits:[],
      updatedAt:null,level:"supporter"} as LedgerAggregate}:await (async()=>{
    const { url, token } = configuration();
    const response=await fetch(new URL("internal/v1/contributions/batch",url),{
      method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},
      body:JSON.stringify({addresses:links.results.map(row=>row.address)}),cache:"no-store",
      signal:AbortSignal.timeout(15_000),
    });
    if(!response.ok)throw new Error("hub_token_balance_unavailable");
    const payload=await readBoundedJsonResponse(response);
    const validated=validateContributionBatch(payload,links.results.map(row=>row.address));
    if(!validated)throw new Error("hub_token_balance_invalid");
    return {contributions:validated.contributions as Array<{balance:LedgerBalance;entries:ContributionEntry[]}>,
      aggregate:validated.aggregate as LedgerAggregate};
  })();
  const entries: ContributionEntry[] = [];
  for (const { entries: walletEntries } of batch.contributions) {
    entries.push(...walletEntries);
  }
  const resolvedLevel=batch.aggregate.level;
  const policy = await database.prepare(`SELECT benefits_json AS benefitsJson FROM hub_token_level_policies
    WHERE level_key=? AND active=1`).bind(resolvedLevel).first<{benefitsJson:string}>();
  let benefits: string[] = [];
  try { benefits = normalizeHubTokenBenefits(JSON.parse(policy?.benefitsJson ?? "[]") as unknown); } catch { benefits=[]; }
  return { ...batch.aggregate,level: resolvedLevel, linkedWalletCount: links.results.length,
    activeWalletCount: links.results.filter((row) => row.active === 1).length,
    benefits, entries: entries.sort((a,b)=>b.occurredAt.localeCompare(a.occurredAt)).slice(0,50),
    unit: "microETH-contribution", transferable: false, redeemable: false };
}
