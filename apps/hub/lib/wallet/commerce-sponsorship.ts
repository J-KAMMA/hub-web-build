// apps/wallet-extension/src/commerce-sponsorship.js の移植。
// Commerce注文のガススポンサーシップ要求と応答の厳格な検証。

import { packUserOperation, type WalletUserOperation } from "./user-operation";
import type { WalletFetcher } from "./json-rpc";
import { getInstanceHost, isJkammaServicesEnabled } from "@/lib/instance-origin";

const HASH = /^0x[0-9a-fA-F]{40}$/;
const HEX = /^0x(?:[0-9a-fA-F]{2})*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COMMERCE_PAYMASTER_VERIFICATION_GAS_LIMIT = 200000n;
const COMMERCE_PAYMASTER_POST_OP_GAS_LIMIT = 50000n;
const MAX_COMMERCE_PAYMASTER_DATA_BYTES = 2048;
const MAX_COMMERCE_RESPONSE_BYTES = 65536;
const COMMERCE_TIMEOUT_MS = 15000;

export type CommerceSponsorshipRequest = {
  orderId: string;
  accessToken: string;
  url: string;
  expectedPaymaster?: string | null;
  sessionKeySignature?: `0x${string}` | null;
};

export function safeCommerceSponsorshipUrl(value: string): string {
  const url = new URL(value);
  const loopback = url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
  const trustedHttps = url.protocol === "https:" && [getInstanceHost(), ...(isJkammaServicesEnabled() ? ["hub.jkamma.com", "jkamma-hub-staging.jammakamma0.workers.dev"] : [])].includes(url.host);
  if (!(trustedHttps || loopback) || url.username || url.password || !/^\/shopping\/api\/commerce\/api\/v1\/orders\/[0-9a-f-]{36}\/gas-sponsorship$/i.test(url.pathname) || url.search || url.hash) throw new Error("unsafe_commerce_sponsorship_url");
  return url.toString();
}

export function applyPackedPaymasterAndData(operation: WalletUserOperation, value: string, expectedPaymaster: string | null = null): WalletUserOperation {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{104,}$/.test(value)) throw new Error("invalid_commerce_sponsorship");
  const body = value.slice(2);
  const paymaster = `0x${body.slice(0, 40)}`;
  const verification = `0x${body.slice(40, 72)}`;
  const postOp = `0x${body.slice(72, 104)}`;
  const data = `0x${body.slice(104)}`;
  const verificationGas = BigInt(verification);
  const postOpGas = BigInt(postOp);
  if (!HASH.test(paymaster) || !HEX.test(data) || data.length > 2 + MAX_COMMERCE_PAYMASTER_DATA_BYTES * 2 || verificationGas === 0n || verificationGas > COMMERCE_PAYMASTER_VERIFICATION_GAS_LIMIT || postOpGas > COMMERCE_PAYMASTER_POST_OP_GAS_LIMIT) throw new Error("commerce_sponsorship_gas_ceiling_exceeded");
  if (expectedPaymaster && (!HASH.test(expectedPaymaster) || paymaster.toLowerCase() !== expectedPaymaster.toLowerCase())) throw new Error("commerce_paymaster_mismatch");
  return { ...operation, paymaster: paymaster.toLowerCase(), paymasterVerificationGasLimit: `0x${verificationGas.toString(16)}`, paymasterPostOpGasLimit: `0x${postOpGas.toString(16)}`, paymasterData: data };
}

async function readBoundedJson(response: Response): Promise<{ sponsorship?: { paymasterAndData?: string }; error?: string } | null> {
  const length = response.headers?.get?.("content-length");
  if (length && Number(length) > MAX_COMMERCE_RESPONSE_BYTES) throw new Error("commerce_sponsorship_response_too_large");
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_COMMERCE_RESPONSE_BYTES) throw new Error("commerce_sponsorship_response_too_large");
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("commerce_sponsorship_invalid_json");
  }
}

export async function requestCommerceSponsorship(operation: WalletUserOperation, request: CommerceSponsorshipRequest, fetcher: WalletFetcher = fetch as WalletFetcher): Promise<WalletUserOperation> {
  if (!request || !UUID.test(request.orderId ?? "") || typeof request.accessToken !== "string" || request.accessToken.length < 32 || request.accessToken.length > 1100 || !HASH.test(request.expectedPaymaster ?? "")) throw new Error("invalid_commerce_sponsorship_request");
  const sessionKeySignature = request.sessionKeySignature ?? null;
  if (sessionKeySignature != null && (typeof sessionKeySignature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(sessionKeySignature))) throw new Error("invalid_commerce_sponsorship_request");
  const url = safeCommerceSponsorshipUrl(request.url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), COMMERCE_TIMEOUT_MS);
  const totalGas = BigInt(operation.callGasLimit) + BigInt(operation.verificationGasLimit) + BigInt(operation.preVerificationGas) + COMMERCE_PAYMASTER_VERIFICATION_GAS_LIMIT + COMMERCE_PAYMASTER_POST_OP_GAS_LIMIT;
  const maximumCostAtomic = totalGas * BigInt(operation.maxFeePerGas);
  let response: Response;
  try {
    response = await fetcher(url, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${request.accessToken}` }, body: JSON.stringify({ maximumCostAtomic: maximumCostAtomic.toString(), userOperation: packUserOperation(operation), ...(sessionKeySignature ? { sessionKeySignature } : {}) }), signal: controller.signal, cache: "no-store", credentials: "omit", redirect: "error", referrerPolicy: "no-referrer" });
  } catch (error) {
    if (controller.signal.aborted) throw new Error("commerce_sponsorship_timeout");
    throw new Error("commerce_sponsorship_unavailable", { cause: error });
  } finally {
    clearTimeout(timeout);
  }
  const body = await readBoundedJson(response);
  if (!response.ok || !body?.sponsorship?.paymasterAndData) throw new Error(typeof body?.error === "string" ? body.error.slice(0, 300) : "commerce_sponsorship_unavailable");
  return applyPackedPaymasterAndData(operation, body.sponsorship.paymasterAndData, request.expectedPaymaster ?? null);
}
