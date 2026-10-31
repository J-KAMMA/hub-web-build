// apps/wallet-extension/src/transaction-request.js の移植。
// プロバイダ要求の入力検証と、承認済み料金上限の短命保持。

import { applyFeeCeilings, formatMaximumFee, maximumUserOperationCost } from "./user-operation";
import { HARD_PAYMASTER_GAS_CEILINGS } from "./gas-policy";
import type { HubWalletNetwork } from "./networks";
import type { WalletFetcher } from "./json-rpc";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const ZERO_ADDRESS = /^0x0{40}$/i;
const DATA = /^0x(?:[0-9a-fA-F]{2})*$/;
const QUANTITY = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SESSION_KEY_SIGNATURE = /^0x[0-9a-fA-F]{130}$/;
const APPROVAL_MAX_AGE_MS = 120_000;
const approvedFeeCeilings = new Map<string, { atomic: bigint; observedAt: number }>();

function invalid(message: string): never {
  throw Object.assign(new Error(message), { code: -32602 });
}

function normalizeAddress(value: unknown, message: string): string {
  if (typeof value !== "string" || !ADDRESS.test(value) || ZERO_ADDRESS.test(value)) invalid(message);
  return value.toLowerCase();
}

export type HubGasSponsorship = {
  orderId: string;
  accessToken: string;
  url: string;
  sessionKeySignature?: `0x${string}`;
};

// A grant-bound session-key signature is a 65-byte EIP-191 signature over
// order id + chain id + keccak256(callData). It is only meaningful to a
// trusted Hub origin, and Commerce re-verifies it against the exact callData
// in the submitted UserOperation, so a stale signature fails closed there.
export function parseHubGasSponsorship(input: unknown, context: { trustedHubOrigin?: boolean }): HubGasSponsorship | null {
  if (input == null) return null;
  if (context?.trustedHubOrigin !== true) invalid("hub_sponsorship_origin_not_allowed");
  if (!input || typeof input !== "object" || Array.isArray(input)) invalid("invalid_commerce_sponsorship_request");
  const value = input as Record<string, unknown>;
  const signature = value.sessionKeySignature;
  if (signature != null && (typeof signature !== "string" || !SESSION_KEY_SIGNATURE.test(signature))) invalid("invalid_session_key_signature");
  if (
    !UUID.test(value.orderId as string) ||
    typeof value.accessToken !== "string" ||
    value.accessToken.length < 32 || value.accessToken.length > 1100 ||
    typeof value.url !== "string"
  ) invalid("invalid_commerce_sponsorship_request");
  return Object.freeze({
    orderId: (value.orderId as string).toLowerCase(),
    accessToken: value.accessToken,
    url: value.url,
    ...(signature != null ? { sessionKeySignature: (signature as string).toLowerCase() as `0x${string}` } : {}),
  });
}

function parseCallBatch(value: unknown): { to: string; value: string; data: `0x${string}` }[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 16) invalid("invalid_transaction_batch");
  return value.map((call) => {
    if (!call || typeof call !== "object" || Array.isArray(call)) invalid("invalid_transaction_batch");
    const record = call as Record<string, unknown>;
    const to = normalizeAddress(record.to ?? record.target, "invalid_transaction_recipient");
    const data = record.data == null ? "0x" : record.data;
    if (typeof data !== "string" || !DATA.test(data)) invalid("invalid_transaction_data");
    const callValue = record.value == null ? "0x0" : record.value;
    if (typeof callValue !== "string" || !QUANTITY.test(callValue) || BigInt(callValue) >= 1n << 256n) invalid("invalid_transaction_value");
    return { to, value: `0x${BigInt(callValue).toString(16)}`, data: data.toLowerCase() as `0x${string}` };
  });
}

function parseHubCallParams(request: { method?: string; params?: unknown }, method: string): Record<string, unknown> {
  if (!request || request.method !== method || !Array.isArray(request.params)) invalid("invalid_transaction_request");
  const input = request.params[0];
  if (!input || typeof input !== "object" || Array.isArray(input)) invalid("invalid_transaction_request");
  return input as Record<string, unknown>;
}

/**
 * hub_sendBatchTransaction 要求の正規化: Hubチェックアウトの atomic
 * 支払いバッチ（approve + lock/pay）を1つのUserOperationとして。
 */
export function parseHubBatchRequest(request: { method?: string; params?: unknown }, context: { account?: string; chainId?: string | number; trustedHubOrigin?: boolean }): { from: string; calls: { to: string; value: string; data: `0x${string}` }[]; hubGasSponsorship: HubGasSponsorship | null } {
  const input = parseHubCallParams(request, "hub_sendBatchTransaction");
  const account = normalizeAddress(context?.account, "transaction_account_unavailable");
  const from = normalizeAddress(input.from, "invalid_transaction_sender");
  if (from !== account) invalid("transaction_sender_mismatch");
  if (input.chainId != null && String(input.chainId).toLowerCase() !== String(context?.chainId).toLowerCase()) invalid("transaction_chain_mismatch");
  return Object.freeze({ from, calls: parseCallBatch(input.calls), hubGasSponsorship: parseHubGasSponsorship(input.hubGasSponsorship, context) });
}

/**
 * hub_prepareSponsoredCall 要求の正規化: epoch結合済みcallDataとハッシュの
 * 読み取り専用プレビュー。署名も承認もここでは起きない。
 */
export function parseHubPrepareRequest(request: { method?: string; params?: unknown }, context: { account?: string; chainId?: string | number; trustedHubOrigin?: boolean }): { from: string; calls: { to: string; value: string; data: `0x${string}` }[] } {
  if (context?.trustedHubOrigin !== true) invalid("hub_sponsorship_origin_not_allowed");
  const input = parseHubCallParams(request, "hub_prepareSponsoredCall");
  const account = normalizeAddress(context?.account, "transaction_account_unavailable");
  const from = normalizeAddress(input.from, "invalid_transaction_sender");
  if (from !== account) invalid("transaction_sender_mismatch");
  if (input.chainId != null && String(input.chainId).toLowerCase() !== String(context?.chainId).toLowerCase()) invalid("transaction_chain_mismatch");
  return Object.freeze({ from, calls: parseCallBatch(input.calls) });
}

/**
 * eth_sendTransaction 要求の正規化。スマートアカウント経路で扱えない
 * フィールドは、確認後に黙って無視するのではなく拒否する。
 */
export function parseDappTransactionRequest(request: { method?: string; params?: unknown }, context: { account?: string; chainId?: string | number; trustedHubOrigin?: boolean }): { from: string; to: string; value: `0x${string}`; data: `0x${string}`; hubGasSponsorship: HubGasSponsorship | null } {
  if (!request || request.method !== "eth_sendTransaction" || !Array.isArray(request.params)) invalid("invalid_transaction_request");
  const input = request.params[0] as Record<string, unknown>;
  if (!input || typeof input !== "object" || Array.isArray(input)) invalid("invalid_transaction_request");
  const account = normalizeAddress(context?.account, "transaction_account_unavailable");
  const from = normalizeAddress(input.from, "invalid_transaction_sender");
  if (from !== account) invalid("transaction_sender_mismatch");
  const to = normalizeAddress(input.to, "invalid_transaction_recipient");
  const value = input.value == null ? "0x0" : input.value;
  if (typeof value !== "string" || !QUANTITY.test(value) || BigInt(value) >= 1n << 256n) invalid("invalid_transaction_value");
  const data = input.data == null ? "0x" : input.data;
  if (typeof data !== "string" || !DATA.test(data)) invalid("invalid_transaction_data");
  if (input.chainId != null && String(input.chainId).toLowerCase() !== String(context?.chainId).toLowerCase()) invalid("transaction_chain_mismatch");
  for (const field of ["gas", "gasPrice", "maxFeePerGas", "maxPriorityFeePerGas", "nonce"]) {
    if (input[field] != null) invalid(`unsupported_transaction_field:${field}`);
  }

  const hubGasSponsorship = parseHubGasSponsorship(input.hubGasSponsorship, context);

  return Object.freeze({ from, to, value: `0x${BigInt(value).toString(16)}` as `0x${string}`, data: (data as string).toLowerCase() as `0x${string}`, hubGasSponsorship });
}

export function formatNativeQuantity(value: bigint | string, network: HubWalletNetwork | null): string {
  const amount = BigInt(value);
  const decimals = Number.isInteger(network?.nativeCurrency?.decimals) ? (network?.nativeCurrency?.decimals ?? 18) : 18;
  const symbol = typeof network?.nativeCurrency?.symbol === "string" ? network.nativeCurrency.symbol : "native";
  const scale = 10n ** BigInt(decimals);
  const whole = amount / scale;
  const fraction = (amount % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole}${fraction ? `.${fraction}` : ""} ${symbol}`;
}

/** 現在のgas priceを読み、ウォレットのハード上限から最大network feeを求める。 */
export async function estimateMaximumNetworkFee(network: HubWalletNetwork | null, chainId: string | number | bigint, gasPolicy = {}, fetcher: WalletFetcher = fetch as WalletFetcher): Promise<{ atomic: bigint; display: string }> {
  if (!network?.rpcUrls?.length) throw new Error("transaction_fee_unavailable");
  const operation = await applyFeeCeilings(
    network.rpcUrls,
    chainId,
    {
      sender: "0x0000000000000000000000000000000000000001",
      nonce: "0x0",
      callData: "0x",
      signature: "0x",
      callGasLimit: "0x0",
      verificationGasLimit: "0x0",
      preVerificationGas: "0x0",
      maxFeePerGas: "0x0",
      maxPriorityFeePerGas: "0x0",
      paymasterVerificationGasLimit: `0x${HARD_PAYMASTER_GAS_CEILINGS.paymasterVerificationGasLimit.toString(16)}`,
      paymasterPostOpGasLimit: `0x${HARD_PAYMASTER_GAS_CEILINGS.paymasterPostOpGasLimit.toString(16)}`,
    },
    fetcher,
    { ...gasPolicy, minimumPriorityFeePerGas: network.minimumPriorityFeePerGas },
  );
  const decimals = network.nativeCurrency?.decimals ?? 18;
  const symbol = network.nativeCurrency?.symbol ?? "";
  const result = Object.freeze({
    atomic: maximumUserOperationCost(operation),
    display: formatMaximumFee(operation, decimals, symbol),
  });
  approvedFeeCeilings.set(String(chainId).toLowerCase(), { atomic: result.atomic, observedAt: Date.now() });
  return result;
}

/** 承認画面と署名器だけが共有する短命のメモリ内上限。 */
export function readApprovedMaximumNetworkFee(chainId: string | number | bigint, now = Date.now()): bigint | null {
  const key = String(chainId).toLowerCase();
  const approved = approvedFeeCeilings.get(key);
  if (!approved || now - approved.observedAt > APPROVAL_MAX_AGE_MS || now < approved.observedAt) {
    approvedFeeCeilings.delete(key);
    return null;
  }
  return approved.atomic;
}

/** 承認が取り消された・期限切れになったときに確実に破棄する。 */
export function clearApprovedMaximumNetworkFee(chainId: string | number | bigint) {
  approvedFeeCeilings.delete(String(chainId).toLowerCase());
}
