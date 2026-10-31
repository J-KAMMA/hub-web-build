import "server-only";

import { parseHubTokenReadiness, type HubTokenReadiness } from "@/lib/hub-token-readiness-response";
import { parseHubTokenLedgerOrigin } from "@/lib/hub-token-ledger-origin";
import { readBoundedJsonResponse } from "@/lib/bounded-json-response";

export async function readHubTokenReadiness(): Promise<HubTokenReadiness> {
  const rawUrl = process.env.HUB_TOKEN_LEDGER_URL?.trim();
  const token = process.env.HUB_TOKEN_LEDGER_READ_TOKEN?.trim();
  const expectedTokenAddress = process.env.HUB_TOKEN_CONTRACT_ADDRESS?.trim().toLowerCase();
  const expectedChainId = Number(process.env.HUB_TOKEN_CHAIN_ID);
  if (!rawUrl || !token || token.length < 43 ||
      !expectedTokenAddress || !/^0x[0-9a-f]{40}$/.test(expectedTokenAddress) ||
      !Number.isSafeInteger(expectedChainId) || expectedChainId <= 0)
    throw new Error("hub_token_readiness_unavailable");
  const origin = parseHubTokenLedgerOrigin(rawUrl);
  const response = await fetch(new URL("internal/v1/readiness", origin), {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const value = await readBoundedJsonResponse(response);
  if (!response.ok) throw new Error("hub_token_readiness_unavailable");
  const parsed = parseHubTokenReadiness(value);
  if (!parsed) throw new Error("hub_token_readiness_invalid");
  if (parsed.tokenContractAddress !== expectedTokenAddress || parsed.onchainChainId !== expectedChainId)
    throw new Error("hub_token_readiness_environment_mismatch");
  return parsed;
}
