// apps/wallet-extension/src/user-operation.js の移植（ethers → viem）。
// PackedUserOperation のpack・hash・ガス上限適用。

import { hashTypedData } from "viem";

import { ENTRY_POINT_V08 } from "./networks";
import { rpcConsensusRequest, rpcRequest } from "./rpc-client";
import type { WalletFetcher } from "./json-rpc";
import { resolveGasPolicy, type GasPolicyInput } from "./gas-policy";

const GET_USER_OP_HASH_SELECTOR = "22cdde4c";
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HEX = /^0x(?:[0-9a-fA-F]{2})*$/;
const QUANTITY = /^0x[0-9a-fA-F]+$/;
const BYTES32 = /^0x[0-9a-fA-F]{64}$/;
const UINT128_MAX = (1n << 128n) - 1n;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const USER_OP_TYPES = {
  PackedUserOperation: [
    { name: "sender", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "initCode", type: "bytes" },
    { name: "callData", type: "bytes" },
    { name: "accountGasLimits", type: "bytes32" },
    { name: "preVerificationGas", type: "uint256" },
    { name: "gasFees", type: "bytes32" },
    { name: "paymasterAndData", type: "bytes" },
  ],
} as const;

export type WalletUserOperation = {
  sender: string;
  nonce: string;
  callData: string;
  callGasLimit: string;
  verificationGasLimit: string;
  preVerificationGas: string;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
  signature: string;
  factory?: string | null;
  factoryData?: string | null;
  paymaster?: string | null;
  paymasterData?: string | null;
  paymasterVerificationGasLimit?: string | null;
  paymasterPostOpGasLimit?: string | null;
};

const word = (value: string) => {
  const body = String(value).replace(/^0x/, "");
  if (!/^[0-9a-fA-F]+$/.test(body) || body.length > 64) throw new Error("invalid_abi_word");
  return body.padStart(64, "0");
};
const uint128 = (value: string | bigint, field: string) => {
  const parsed = BigInt(value);
  if (parsed < 0n || parsed > UINT128_MAX) throw new Error(`user_operation_uint128_overflow:${field}`);
  return parsed;
};
const packed128 = (high: string | bigint, low: string | bigint, highField = "high", lowField = "low") => `${uint128(high, highField).toString(16).padStart(32, "0")}${uint128(low, lowField).toString(16).padStart(32, "0")}`;
function dynamic(hexValue: string) { const body = hexValue.replace(/^0x/, ""); return `${word(`0x${(body.length / 2).toString(16)}`)}${body.padEnd(Math.ceil(body.length / 64) * 64, "0")}`; }

export function assertOperation(operation: WalletUserOperation) {
  if (!operation || !ADDRESS.test(operation.sender ?? "") || operation.sender.toLowerCase() === ZERO_ADDRESS) throw new Error("invalid_user_operation_sender");
  for (const field of ["nonce", "callGasLimit", "verificationGasLimit", "preVerificationGas", "maxFeePerGas", "maxPriorityFeePerGas"] as const) {
    if (!QUANTITY.test(operation[field] ?? "")) throw new Error(`invalid_user_operation_field:${field}`);
  }
  for (const field of ["callData", "signature"] as const) if (!HEX.test(operation[field] ?? "")) throw new Error(`invalid_user_operation_field:${field}`);
  if (!operation.factory && operation.factoryData != null) throw new Error("orphan_user_operation_factory_data");
  if (operation.factory) {
    if (!ADDRESS.test(operation.factory) || operation.factory.toLowerCase() === ZERO_ADDRESS || !HEX.test(operation.factoryData ?? "")) throw new Error("invalid_user_operation_factory");
    if (operation.factory.toLowerCase() === "0x7702".padEnd(42, "0")) throw new Error("eip7702_not_supported");
  }
  const paymasterOnlyFields = ["paymasterData", "paymasterVerificationGasLimit", "paymasterPostOpGasLimit"] as const;
  if (!operation.paymaster && paymasterOnlyFields.some((field) => operation[field] != null)) throw new Error("orphan_user_operation_paymaster_data");
  if (operation.paymaster) {
    if (!ADDRESS.test(operation.paymaster) || operation.paymaster.toLowerCase() === ZERO_ADDRESS || !HEX.test(operation.paymasterData ?? "")) throw new Error("invalid_user_operation_paymaster");
    for (const field of ["paymasterVerificationGasLimit", "paymasterPostOpGasLimit"] as const) if (!QUANTITY.test(operation[field] ?? "")) throw new Error(`invalid_user_operation_field:${field}`);
  }
  if (BigInt(operation.maxPriorityFeePerGas) > BigInt(operation.maxFeePerGas)) throw new Error("invalid_user_operation_fee_order");
}

export function packUserOperation(operation: WalletUserOperation) {
  assertOperation(operation);
  const initCode = operation.factory ? `0x${operation.factory.slice(2)}${(operation.factoryData ?? "").slice(2)}` : "0x";
  const paymasterAndData = operation.paymaster ? `0x${operation.paymaster.slice(2)}${packed128(operation.paymasterVerificationGasLimit ?? "0x0", operation.paymasterPostOpGasLimit ?? "0x0", "paymasterVerificationGasLimit", "paymasterPostOpGasLimit")}${(operation.paymasterData ?? "0x").slice(2)}` : "0x";
  return {
    sender: operation.sender.toLowerCase() as `0x${string}`, nonce: operation.nonce, initCode: initCode as `0x${string}`, callData: operation.callData as `0x${string}`,
    accountGasLimits: `0x${packed128(operation.verificationGasLimit, operation.callGasLimit, "verificationGasLimit", "callGasLimit")}` as `0x${string}`,
    preVerificationGas: operation.preVerificationGas,
    gasFees: `0x${packed128(operation.maxPriorityFeePerGas, operation.maxFeePerGas, "maxPriorityFeePerGas", "maxFeePerGas")}` as `0x${string}`,
    paymasterAndData: paymasterAndData as `0x${string}`,
    signature: operation.signature as `0x${string}`,
  };
}

export function encodeGetUserOpHash(operation: WalletUserOperation): string {
  const op = packUserOperation(operation); const tupleHead = 9 * 32;
  const tails = [dynamic(op.initCode), dynamic(op.callData), dynamic(op.paymasterAndData), dynamic(op.signature)];
  const offsets: number[] = []; let cursor = tupleHead; for (const tail of tails) { offsets.push(cursor); cursor += tail.length / 2; }
  const tuple = `${word(op.sender)}${word(op.nonce)}${word(`0x${offsets[0].toString(16)}`)}${word(`0x${offsets[1].toString(16)}`)}${word(op.accountGasLimits)}${word(op.preVerificationGas)}${word(op.gasFees)}${word(`0x${offsets[2].toString(16)}`)}${word(`0x${offsets[3].toString(16)}`)}${tails.join("")}`;
  return `0x${GET_USER_OP_HASH_SELECTOR}${word("0x20")}${tuple}`;
}

export function localUserOperationHash(chainId: string | number | bigint, operation: WalletUserOperation, entryPoint: `0x${string}` = ENTRY_POINT_V08 as `0x${string}`): string {
  const packed = packUserOperation(operation);
  return hashTypedData({
    domain: { name: "ERC4337", version: "1", chainId: BigInt(chainId), verifyingContract: entryPoint },
    types: USER_OP_TYPES,
    primaryType: "PackedUserOperation",
    message: {
      sender: packed.sender,
      nonce: BigInt(packed.nonce),
      initCode: packed.initCode,
      callData: packed.callData,
      accountGasLimits: packed.accountGasLimits,
      preVerificationGas: BigInt(packed.preVerificationGas),
      gasFees: packed.gasFees,
      paymasterAndData: packed.paymasterAndData,
    },
  }).toLowerCase();
}

export async function getUserOperationHash(rpcUrls: string | string[], chainId: string | number | bigint, operation: WalletUserOperation, fetcher: WalletFetcher = fetch as WalletFetcher, options: { entryPoint?: `0x${string}`; crossCheck?: boolean; minimumResponses?: number } = {}): Promise<string> {
  const localHash = localUserOperationHash(chainId, operation, options.entryPoint ?? ENTRY_POINT_V08 as `0x${string}`);
  if (options.crossCheck === false) return localHash;
  const { normalized } = await rpcConsensusRequest(
    rpcUrls,
    chainId,
    "eth_call",
    [{ to: options.entryPoint ?? ENTRY_POINT_V08, data: encodeGetUserOpHash(operation) }, "latest"],
    fetcher,
    { minimumResponses: options.minimumResponses ?? 2, normalize: (value: unknown) => {
      if (!BYTES32.test(String(value ?? ""))) throw new Error("invalid_user_operation_hash");
      return String(value).toLowerCase();
    } },
  );
  if (normalized !== localHash) throw new Error("user_operation_hash_mismatch");
  return localHash;
}

export async function applyFeeCeilings(rpcUrls: string | string[], chainId: string | number | bigint, operation: WalletUserOperation, fetcher: WalletFetcher = fetch as WalletFetcher, gasPolicy: GasPolicyInput = {}): Promise<WalletUserOperation> {
  const { result } = await rpcRequest(Array.isArray(rpcUrls) ? rpcUrls : [rpcUrls], chainId, "eth_gasPrice", [], fetcher);
  if (!QUANTITY.test(String(result ?? ""))) throw new Error("invalid_gas_price");
  const gasPrice = BigInt(String(result));
  const policy = resolveGasPolicy(gasPolicy);
  const minimumPriorityFee = BigInt(gasPolicy.minimumPriorityFeePerGas ?? 0);
  const priorityFee = [gasPrice / BigInt(policy.priorityDivisor) || 1n, minimumPriorityFee].reduce((highest, value) => value > highest ? value : highest, 0n);
  const maxFee = [gasPrice * BigInt(policy.feeMultiplierBps) / 10000n, priorityFee].reduce((highest, value) => value > highest ? value : highest, 0n);
  return { ...operation, callGasLimit: `0x${policy.callGasLimit.toString(16)}`, verificationGasLimit: `0x${policy.verificationGasLimit.toString(16)}`, preVerificationGas: `0x${policy.preVerificationGas.toString(16)}`, maxFeePerGas: `0x${maxFee.toString(16)}`, maxPriorityFeePerGas: `0x${priorityFee.toString(16)}` };
}

export function assertEstimateWithinCeilings(operation: WalletUserOperation, estimate: { callGasLimit?: string; verificationGasLimit?: string; preVerificationGas?: string }) {
  for (const field of ["callGasLimit", "verificationGasLimit", "preVerificationGas"] as const) {
    if (!estimate?.[field] || BigInt(estimate[field] as string) > BigInt(operation[field])) throw new Error(`gas_ceiling_exceeded:${field}`);
  }
}

export function applyGasEstimate(operation: WalletUserOperation, estimate: { callGasLimit?: string; verificationGasLimit?: string; preVerificationGas?: string }, bufferBps = 11500): WalletUserOperation {
  if (!Number.isSafeInteger(bufferBps) || bufferBps < 10000 || bufferBps > 15000) throw new Error("invalid_gas_estimate_buffer");
  assertEstimateWithinCeilings(operation, estimate);
  const tightened = { ...operation };
  for (const field of ["callGasLimit", "verificationGasLimit", "preVerificationGas"] as const) {
    const measured = BigInt(estimate[field] as string); const ceiling = BigInt(operation[field]);
    const buffered = (measured * BigInt(bufferBps) + 9999n) / 10000n;
    tightened[field] = `0x${(buffered > ceiling ? ceiling : buffered).toString(16)}`;
  }
  return tightened;
}

export function maximumUserOperationCost(operation: Partial<WalletUserOperation>): bigint {
  const accountGas = ["callGasLimit", "verificationGasLimit", "preVerificationGas"].reduce((total, field) => total + BigInt((operation as Record<string, unknown>)[field] as string ?? 0), 0n);
  const paymasterGas = BigInt(operation.paymasterVerificationGasLimit ?? 0) + BigInt(operation.paymasterPostOpGasLimit ?? 0);
  return (accountGas + paymasterGas) * BigInt(operation.maxFeePerGas ?? 0);
}

export function formatMaximumFee(operation: Partial<WalletUserOperation>, decimals = 18, symbol = ""): string {
  const cost = maximumUserOperationCost(operation); const scale = 10n ** BigInt(decimals);
  const whole = cost / scale; const fraction = (cost % scale).toString().padStart(decimals, "0").slice(0, 6).replace(/0+$/, "");
  return `${whole}${fraction ? `.${fraction}` : ""}${symbol ? ` ${symbol}` : ""}`;
}
