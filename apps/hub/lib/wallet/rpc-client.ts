// apps/wallet-extension/src/rpc-client.js の移植。
// チェーンID照合付きフェイルオーバーと、独立エンドポイントの合意制リクエスト。

import { normalizeChainId, safeRpcUrl } from "./networks";
import { postJsonRpc, type WalletFetcher } from "./json-rpc";

type Fetcher = WalletFetcher;

function jsonStable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(jsonStable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${jsonStable((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

async function callRpc(rpcUrl: string, method: string, params: unknown[], fetcher: Fetcher): Promise<unknown> {
  return postJsonRpc({ url: safeRpcUrl(rpcUrl), method, params, fetcher, unavailableError: "rpc_http_error", invalidError: "rpc_invalid_response" });
}

export async function rpcRequest(rpcUrls: string | string[], chainId: string | number | bigint, method: string, params: unknown[] = [], fetcher: Fetcher = fetch as Fetcher): Promise<{ result: unknown; rpcUrl: string }> {
  const urls = Array.isArray(rpcUrls) ? rpcUrls : [rpcUrls];
  if (!urls.length) throw new Error("rpc_unavailable");
  const expectedChain = normalizeChainId(chainId);
  let lastError: Error = new Error("rpc_unavailable");
  for (const rpcUrl of urls) {
    try {
      const reportedChain = normalizeChainId(await callRpc(rpcUrl, "eth_chainId", [], fetcher) as string);
      if (reportedChain !== expectedChain) throw new Error("rpc_chain_mismatch");
      return { result: await callRpc(rpcUrl, method, params, fetcher), rpcUrl: safeRpcUrl(rpcUrl) };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("rpc_unavailable");
    }
  }
  throw new Error(`rpc_failover_exhausted:${lastError.message}`);
}

export async function rpcConsensusRequest<T = unknown>(rpcUrls: string | string[], chainId: string | number | bigint, method: string, params: unknown[] = [], fetcher: Fetcher = fetch as Fetcher, options: { minimumResponses?: number; normalize?: (value: unknown) => T } = {}): Promise<{ result: unknown; normalized: T; rpcUrls: string[] }> {
  const urls = [...new Set((Array.isArray(rpcUrls) ? rpcUrls : [rpcUrls]).map(safeRpcUrl))];
  const minimumResponses = options.minimumResponses ?? 2;
  if (urls.length < minimumResponses) throw new Error("rpc_consensus_requires_independent_endpoints");
  const normalize = options.normalize ?? ((value: unknown) => value as T);
  const successes: { rpcUrl: string; result: unknown; normalized: T; key: string }[] = [];
  for (const rpcUrl of urls) {
    try {
      const { result } = await rpcRequest([rpcUrl], chainId, method, params, fetcher);
      const normalized = normalize(result);
      successes.push({ rpcUrl, result, normalized, key: jsonStable(normalized) });
    } catch {
      // Continue; consensus will fail closed below.
    }
  }
  if (successes.length < minimumResponses) throw new Error("rpc_consensus_unavailable");
  const groups = new Map<string, typeof successes>();
  for (const item of successes) groups.set(item.key, [...(groups.get(item.key) ?? []), item]);
  const winner = [...groups.values()].sort((a, b) => b.length - a.length)[0];
  if (!winner || winner.length < minimumResponses) throw new Error("rpc_consensus_mismatch");
  return { result: winner[0].result, normalized: winner[0].normalized, rpcUrls: winner.map((item) => item.rpcUrl) };
}
