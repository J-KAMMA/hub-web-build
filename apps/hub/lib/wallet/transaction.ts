// apps/wallet-extension/src/transaction.js の移植（ethers AbiCoder → viem）。
// executeUserOp 封筒のエンコード・ノンス/epoch読み取り。

import { decodeAbiParameters, encodeAbiParameters, keccak256 } from "viem";

import { ENTRY_POINT_V08 } from "./networks";
import { rpcRequest } from "./rpc-client";
import type { WalletFetcher } from "./json-rpc";
import type { WalletUserOperation } from "./user-operation";

const EXECUTE_USER_OP_SELECTOR = "8dd7712f";
const GET_NONCE_SELECTOR = "35567e1a";
const ERC20_TRANSFER_SELECTOR = "a9059cbb";
const ERC721_SAFE_TRANSFER_SELECTOR = "42842e0e";
export const BATCH_MODE = `0x01${"00".repeat(31)}`;

const EXECUTION_PARAMS = [
  { name: "authorizationEpoch", type: "uint64" },
  {
    name: "calls",
    type: "tuple[]",
    components: [
      { name: "target", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
    ],
  },
] as const;

export type WalletCall = { target: `0x${string}`; value: bigint; data: `0x${string}` };

const word = (value: string) => value.replace(/^0x/, "").padStart(64, "0").toLowerCase();

export function parseNativeAmount(value: string, decimals = 18): bigint {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)(\.\d+)?$/.test(value)) throw new Error("invalid_amount");
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > decimals) throw new Error("too_many_decimals");
  const amount = BigInt(whole) * 10n ** BigInt(decimals) + BigInt((fraction || "0").padEnd(decimals, "0"));
  if (amount <= 0n) throw new Error("invalid_amount");
  return amount;
}

function encodeBatchCall(target: string, value: bigint, data: `0x${string}`, authorizationEpoch = 1n): `0x${string}` {
  if (!/^0x[0-9a-fA-F]{40}$/.test(target) || /^0x0{40}$/i.test(target)) throw new Error("invalid_recipient");
  const epoch = BigInt(authorizationEpoch);
  if (epoch <= 0n || epoch > 0xffffffffffffffffn) throw new Error("invalid_authorization_epoch");
  const body = encodeAbiParameters(EXECUTION_PARAMS, [epoch, [{ target: target as `0x${string}`, value: BigInt(value), data }]]);
  return `0x${EXECUTE_USER_OP_SELECTOR}${body.slice(2)}`;
}

export function encodeNativeTransfer(to: string, value: bigint, authorizationEpoch = 1n): `0x${string}` {
  if (!/^0x[0-9a-fA-F]{40}$/.test(to) || /^0x0{40}$/i.test(to)) throw new Error("invalid_recipient");
  return encodeBatchCall(to, value, "0x", authorizationEpoch);
}

export function encodeContractCall(target: string, value = 0n, data: `0x${string}` = "0x", authorizationEpoch = 1n): `0x${string}` {
  if (typeof data !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(data)) throw new Error("invalid_transaction_data");
  return encodeBatchCall(target, value, data, authorizationEpoch);
}

export function encodeTokenTransfer(tokenContract: string, to: string, amount: bigint, authorizationEpoch = 1n): `0x${string}` {
  if (!/^0x[0-9a-fA-F]{40}$/.test(to) || /^0x0{40}$/i.test(to)) throw new Error("invalid_recipient");
  return encodeBatchCall(tokenContract, 0n, `0x${ERC20_TRANSFER_SELECTOR}${word(to)}${word(`0x${BigInt(amount).toString(16)}`)}` as `0x${string}`, authorizationEpoch);
}

export function encodeNftTransfer(nftContract: string, from: string, to: string, tokenId: string | bigint, authorizationEpoch = 1n): `0x${string}` {
  if (!/^0x[0-9a-fA-F]{40}$/.test(from) || !/^0x[0-9a-fA-F]{40}$/.test(to) || /^0x0{40}$/i.test(to)) throw new Error("invalid_nft_transfer_address");
  let id: bigint;
  try { id = BigInt(tokenId); } catch { throw new Error("invalid_token_id"); }
  if (id < 0n) throw new Error("invalid_token_id");
  return encodeBatchCall(nftContract, 0n, `0x${ERC721_SAFE_TRANSFER_SELECTOR}${word(from)}${word(to)}${word(`0x${id.toString(16)}`)}` as `0x${string}`, authorizationEpoch);
}

// wallet_sendCalls 用: N件の呼び出しを1つの executeUserOp 封筒へ（1〜16件）。
export function encodeContractCalls(calls: { to?: string; target?: string; value?: string | bigint; data?: string }[], authorizationEpoch = 1n): `0x${string}` {
  if (!Array.isArray(calls) || calls.length === 0 || calls.length > 16) throw new Error("invalid_call_batch");
  const epoch = BigInt(authorizationEpoch);
  if (epoch <= 0n || epoch > 0xffffffffffffffffn) throw new Error("invalid_authorization_epoch");
  const normalized: WalletCall[] = calls.map((call) => {
    const target = call.target ?? call.to;
    if (!/^0x[0-9a-fA-F]{40}$/.test(target ?? "") || /^0x0{40}$/i.test(target as string)) throw new Error("invalid_recipient");
    const data = (call.data ?? "0x") as `0x${string}`;
    if (typeof data !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(data)) throw new Error("invalid_transaction_data");
    return { target: target as `0x${string}`, value: BigInt(call.value ?? "0x0"), data };
  });
  const body = encodeAbiParameters(EXECUTION_PARAMS, [epoch, normalized]);
  return `0x${EXECUTE_USER_OP_SELECTOR}${body.slice(2)}`;
}

// hub_prepareSponsoredCall: the page needs the hash of the exact callData the
// wallet will submit, so a grant-bound session key can sign
// {orderId, chainId, keccak256(callData)} before the UserOperation exists.
export async function previewSponsoredCallData({ rpcUrls, chainId, account, calls, fetcher = fetch as WalletFetcher }: {
  rpcUrls: string[];
  chainId: string | number | bigint;
  account: string;
  calls: { to?: string; target?: string; value?: string | bigint; data?: string }[];
  fetcher?: WalletFetcher;
}): Promise<{ callData: `0x${string}`; callDataHash: `0x${string}` }> {
  const epoch = await getAuthorizationEpoch(rpcUrls, chainId, account, fetcher);
  const callData = encodeContractCalls(calls, epoch);
  return Object.freeze({ callData, callDataHash: keccak256(callData) });
}

export function rebindAuthorizationEpoch(callData: string, authorizationEpoch: bigint): `0x${string}` {
  if (typeof callData !== "string" || !callData.toLowerCase().startsWith(`0x${EXECUTE_USER_OP_SELECTOR}`)) throw new Error("invalid_v2_execution_envelope");
  const [, calls] = decodeAbiParameters(EXECUTION_PARAMS, `0x${callData.slice(10)}` as `0x${string}`) as unknown as [bigint, { target: `0x${string}`; value: bigint; data: `0x${string}` }[]];
  const epoch = BigInt(authorizationEpoch);
  if (epoch <= 0n || epoch > 0xffffffffffffffffn) throw new Error("invalid_authorization_epoch");
  const body = encodeAbiParameters(EXECUTION_PARAMS, [epoch, calls.map((call) => ({ target: call.target, value: call.value, data: call.data }))]);
  return `0x${EXECUTE_USER_OP_SELECTOR}${body.slice(2)}`;
}

export async function getAuthorizationEpoch(rpcUrls: string | string[], chainId: string | number | bigint, account: string, fetcher = fetch as WalletFetcher): Promise<bigint> {
  const selector = "0x6d5f87be";
  const { result } = await rpcRequest(Array.isArray(rpcUrls) ? rpcUrls : [rpcUrls], chainId, "eth_call", [{ to: account, data: selector }, "latest"], fetcher);
  if (!/^0x[0-9a-fA-F]{64}$/.test(String(result ?? ""))) throw new Error("invalid_authorization_epoch");
  const epoch = BigInt(String(result));
  if (epoch <= 0n || epoch > 0xffffffffffffffffn) throw new Error("invalid_authorization_epoch");
  return epoch;
}

export async function getAccountNonce(rpcUrls: string | string[], chainId: string | number | bigint, sender: string, fetcher = fetch as WalletFetcher): Promise<string> {
  const data = `0x${GET_NONCE_SELECTOR}${word(sender)}${word("0x0")}`;
  const { result } = await rpcRequest(Array.isArray(rpcUrls) ? rpcUrls : [rpcUrls], chainId, "eth_call", [{ to: ENTRY_POINT_V08, data }, "latest"], fetcher);
  if (!/^0x[0-9a-fA-F]{64}$/.test(String(result ?? ""))) throw new Error("invalid_nonce");
  return `0x${BigInt(String(result)).toString(16)}`;
}

export function createTransferUserOperation({ sender, nonce, callData }: { sender: string; nonce: string; callData: string }): WalletUserOperation {
  return { sender: sender.toLowerCase(), nonce, callData, callGasLimit: "0x0", verificationGasLimit: "0x0", preVerificationGas: "0x0", maxFeePerGas: "0x0", maxPriorityFeePerGas: "0x0", signature: "0x" };
}

export function reconcileTransactionReceipt<T extends Record<string, unknown>>(item: T, receipt: { sender?: string; success?: boolean; receipt?: { transactionHash?: string } } | null, expectedSender: string, confirmedAt = new Date().toISOString()): T & { status?: string; transactionHash?: string | null; confirmedAt?: string } {
  if (!receipt || !expectedSender || receipt.sender?.toLowerCase() !== expectedSender.toLowerCase()) return item;
  const transactionHash = /^0x[0-9a-fA-F]{64}$/.test(receipt.receipt?.transactionHash ?? "") ? receipt.receipt?.transactionHash : null;
  return { ...item, status: receipt.success === true ? "success" : "failed", transactionHash, confirmedAt };
}
