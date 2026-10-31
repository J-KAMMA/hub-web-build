// apps/wallet-extension/src/onchain-verification.js の移植（ethers → viem）。
// デプロイ実行コードのフィンガープリント照合とUserOperationレシート検証。

import { keccak256, toEventSelector } from "viem";

import { ENTRY_POINT_V08 } from "./networks";
import { rpcConsensusRequest } from "./rpc-client";
import type { WalletFetcher } from "./json-rpc";

const HASH = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const USER_OPERATION_EVENT_TOPIC = toEventSelector("UserOperationEvent(bytes32,address,address,uint256,bool,uint256,uint256)").toLowerCase();
const IMPLEMENTATION_SELECTOR = "0x5c60da1b";
const SIGNER_SELECTOR = "0x238ac933";

type Fetcher = WalletFetcher;

function normalizeReceipt(receipt: unknown) {
  const r = receipt as { transactionHash?: string; blockHash?: string; blockNumber?: string; status?: string; logs?: { address?: string; topics?: string[]; data?: string; logIndex?: string }[] };
  if (!r || !HASH.test(r.transactionHash ?? "") || !HASH.test(r.blockHash ?? "")) throw new Error("invalid_transaction_receipt");
  const logs = Array.isArray(r.logs) ? r.logs.map((log) => ({
    address: String(log.address ?? "").toLowerCase(),
    topics: Array.isArray(log.topics) ? log.topics.map((topic) => String(topic).toLowerCase()) : [],
    data: String(log.data ?? "").toLowerCase(),
    logIndex: String(log.logIndex ?? "").toLowerCase(),
  })).sort((a, b) => a.logIndex.localeCompare(b.logIndex)) : [];
  return {
    transactionHash: (r.transactionHash as string).toLowerCase(),
    blockHash: (r.blockHash as string).toLowerCase(),
    blockNumber: String(r.blockNumber).toLowerCase(),
    status: String(r.status).toLowerCase(),
    logs,
  };
}

function topicAddress(topic: string): string {
  if (!HASH.test(topic ?? "")) throw new Error("invalid_event_address");
  return `0x${topic.slice(-40)}`.toLowerCase();
}

function eventSuccess(data: string): boolean {
  if (typeof data !== "string" || !/^0x[0-9a-fA-F]{256}$/.test(data)) throw new Error("invalid_user_operation_event");
  return BigInt(`0x${data.slice(66, 130)}`) !== 0n;
}

export async function verifyUserOperationOnChain({ rpcUrls, chainId, userOperationHash, expectedSender, bundlerReceipt, fetcher = fetch as Fetcher }: {
  rpcUrls: string[];
  chainId: string | number | bigint;
  userOperationHash: string;
  expectedSender: string;
  bundlerReceipt: { userOpHash?: string; sender?: string; success?: boolean; receipt?: { transactionHash?: string } };
  fetcher?: Fetcher;
}): Promise<{ userOperationHash: string; sender: string; transactionHash: string; blockNumber: string; success: true }> {
  if (!HASH.test(userOperationHash ?? "") || !ADDRESS.test(expectedSender ?? "")) throw new Error("invalid_user_operation_verification_input");
  const transactionHash = bundlerReceipt?.receipt?.transactionHash;
  if (!HASH.test(transactionHash ?? "")) throw new Error("bundler_receipt_missing_transaction");
  if (bundlerReceipt.userOpHash && bundlerReceipt.userOpHash.toLowerCase() !== userOperationHash.toLowerCase()) throw new Error("bundler_receipt_hash_mismatch");
  if (bundlerReceipt.sender?.toLowerCase() !== expectedSender.toLowerCase()) throw new Error("bundler_receipt_sender_mismatch");
  const { normalized: receipt } = await rpcConsensusRequest(rpcUrls, chainId, "eth_getTransactionReceipt", [transactionHash], fetcher, { normalize: normalizeReceipt });
  if (receipt.status !== "0x1") throw new Error("user_operation_transaction_failed");
  const log = receipt.logs.find((item) => item.address === ENTRY_POINT_V08.toLowerCase() && item.topics[0] === USER_OPERATION_EVENT_TOPIC && item.topics[1] === userOperationHash.toLowerCase());
  if (!log) throw new Error("user_operation_event_missing");
  if (topicAddress(log.topics[2]) !== expectedSender.toLowerCase()) throw new Error("user_operation_event_sender_mismatch");
  const success = eventSuccess(log.data);
  if (success !== true || bundlerReceipt.success !== true) throw new Error("user_operation_failed");
  return { userOperationHash: userOperationHash.toLowerCase(), sender: expectedSender.toLowerCase(), transactionHash: receipt.transactionHash, blockNumber: receipt.blockNumber, success: true };
}

function decodeAddressWord(value: string, error: string): string {
  if (!HASH.test(value ?? "")) throw new Error(error);
  const decoded = `0x${value.slice(-40)}`.toLowerCase();
  if (/^0x0{40}$/.test(decoded)) throw new Error(error);
  return decoded;
}

function requireRuntimeCodeHash(value: string | null | undefined, error: string): string {
  if (!HASH.test(value ?? "") || /^0x0{64}$/i.test(value as string)) throw new Error(error);
  return (value as string).toLowerCase();
}

function hashRuntimeCode(value: unknown, error: string): { code: string; hash: string } {
  const code = String(value ?? "").toLowerCase();
  if (!/^0x(?:[0-9a-f]{2})+$/.test(code)) throw new Error(error);
  return { code, hash: keccak256(code as `0x${string}`).toLowerCase() };
}

export async function verifyWalletDeployment({
  rpcUrls,
  chainId,
  account,
  factory,
  entryPoint = ENTRY_POINT_V08,
  entryPointRuntimeCodeHash,
  smartAccountFactoryRuntimeCodeHash,
  smartAccountImplementationRuntimeCodeHash,
  fetcher = fetch as Fetcher,
  allowUndeployed = false,
}: {
  rpcUrls: string[];
  chainId: string | number | bigint;
  account: string;
  factory: string;
  entryPoint?: string;
  entryPointRuntimeCodeHash?: string | null;
  smartAccountFactoryRuntimeCodeHash?: string | null;
  smartAccountImplementationRuntimeCodeHash?: string | null;
  fetcher?: Fetcher;
  allowUndeployed?: boolean;
}): Promise<{ deployed: boolean; implementation: string; runtimeCodeHashes: { entryPoint: string; factory: string; implementation: string } }> {
  if (!ADDRESS.test(account ?? "") || /^0x0{40}$/i.test(account) || !ADDRESS.test(factory ?? "") || /^0x0{40}$/i.test(factory) || !ADDRESS.test(entryPoint ?? "") || /^0x0{40}$/i.test(entryPoint)) {
    throw new Error("invalid_deployment_verification_input");
  }
  const expected = {
    entryPoint: requireRuntimeCodeHash(entryPointRuntimeCodeHash, "entrypoint_runtime_fingerprint_required"),
    factory: requireRuntimeCodeHash(smartAccountFactoryRuntimeCodeHash, "factory_runtime_fingerprint_required"),
    implementation: requireRuntimeCodeHash(smartAccountImplementationRuntimeCodeHash, "implementation_runtime_fingerprint_required"),
  };
  const code = async (address: string) => (await rpcConsensusRequest(rpcUrls, chainId, "eth_getCode", [address, "latest"], fetcher, { normalize: (value: unknown) => String(value).toLowerCase() })).normalized;
  const [rawEntryCode, rawFactoryCode, rawAccountCode] = await Promise.all([code(entryPoint), code(factory), code(account)]);
  const entry = hashRuntimeCode(rawEntryCode, "wallet_entrypoint_not_deployed");
  const factoryRuntime = hashRuntimeCode(rawFactoryCode, "wallet_factory_not_deployed");
  if (entry.hash !== expected.entryPoint) throw new Error("entrypoint_runtime_fingerprint_mismatch");
  if (factoryRuntime.hash !== expected.factory) throw new Error("factory_runtime_fingerprint_mismatch");
  const implementationResult = (await rpcConsensusRequest(rpcUrls, chainId, "eth_call", [{ to: factory, data: IMPLEMENTATION_SELECTOR }, "latest"], fetcher, { normalize: (value: unknown) => String(value).toLowerCase() })).normalized;
  const implementation = decodeAddressWord(implementationResult, "invalid_factory_implementation");
  const implementationRuntime = hashRuntimeCode(await code(implementation), "wallet_implementation_not_deployed");
  if (implementationRuntime.hash !== expected.implementation) throw new Error("implementation_runtime_fingerprint_mismatch");
  if (rawAccountCode === "0x" || rawAccountCode === "0x0") {
    if (allowUndeployed) return { deployed: false, implementation, runtimeCodeHashes: expected };
    throw new Error("smart_account_not_deployed");
  }
  const accountRuntime = hashRuntimeCode(rawAccountCode, "smart_account_not_deployed");
  const expectedRuntime = `0x363d3d373d3d3d363d73${implementation.slice(2)}5af43d82803e903d91602b57fd5bf3`.toLowerCase();
  if (accountRuntime.code !== expectedRuntime) throw new Error("unexpected_smart_account_runtime");
  return { deployed: true, implementation, runtimeCodeHashes: expected };
}

function decodeBytes32Pair(value: string, error: string): { qx: string; qy: string } {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{128}$/.test(value)) throw new Error(error);
  return { qx: `0x${value.slice(2, 66)}`.toLowerCase(), qy: `0x${value.slice(66, 130)}`.toLowerCase() };
}

export async function readPrimarySigner({ rpcUrls, chainId, account, fetcher = fetch as Fetcher }: {
  rpcUrls: string[];
  chainId: string | number | bigint;
  account: string;
  fetcher?: Fetcher;
}): Promise<{ qx: string; qy: string }> {
  const { normalized } = await rpcConsensusRequest(rpcUrls, chainId, "eth_call", [{ to: account, data: SIGNER_SELECTOR }, "latest"], fetcher, { normalize: (value: unknown) => String(value).toLowerCase() });
  return decodeBytes32Pair(normalized, "invalid_primary_signer_response");
}


