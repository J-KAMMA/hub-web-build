import { isRedirectResponse } from "../redirect-guard";
// apps/wallet-extension/src/json-rpc.js の移植。JSON-RPC POST の
// タイムアウト・応答サイズ・エラー形状を統一する。

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 2_000_000;

export type WalletFetcher = (url: string, init?: RequestInit) => Promise<Response>;

type Fetcher = WalletFetcher;

function boundedTimeout(value: number | undefined): number {
  const parsed = Number(value ?? DEFAULT_TIMEOUT_MS);
  if (!Number.isSafeInteger(parsed) || parsed < 1_000 || parsed > 60_000) throw new Error("invalid_rpc_timeout");
  return parsed;
}

async function readJson(response: Response, invalidError: string): Promise<unknown> {
  const lengthHeader = response.headers?.get?.("content-length");
  if (lengthHeader && Number(lengthHeader) > MAX_RESPONSE_BYTES) throw new Error(`${invalidError}:response_too_large`);
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) throw new Error(`${invalidError}:response_too_large`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${invalidError}:invalid_json`);
  }
}

export async function postJsonRpc({ url, method, params = [], fetcher = fetch as Fetcher, unavailableError = "rpc_unavailable", invalidError = "rpc_invalid_response", timeoutMs = DEFAULT_TIMEOUT_MS }: {
  url: string;
  method: string;
  params?: unknown[];
  fetcher?: Fetcher;
  unavailableError?: string;
  invalidError?: string;
  timeoutMs?: number;
}): Promise<unknown> {
  const id = crypto.randomUUID();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), boundedTimeout(timeoutMs));
  let response: Response;
  try {
    response = await fetcher(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      signal: controller.signal,
      cache: "no-store",
      credentials: "omit",
      redirect: "manual",
      referrerPolicy: "no-referrer",
    });
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`${unavailableError}:timeout`);
    throw new Error(unavailableError, { cause: error });
  } finally {
    clearTimeout(timeout);
  }
  if (!response?.ok || isRedirectResponse(response)) throw new Error(unavailableError);
  const payload = await readJson(response, invalidError) as { jsonrpc?: string; id?: unknown; error?: { message?: string }; result?: unknown };
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || payload.jsonrpc !== "2.0" || payload.id !== id) throw new Error(invalidError);
  if (payload.error) {
    const message = typeof payload.error?.message === "string" ? payload.error.message.slice(0, 300) : invalidError;
    throw new Error(message);
  }
  if (!("result" in payload)) throw new Error(invalidError);
  return payload.result;
}
