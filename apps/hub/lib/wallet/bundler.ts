// apps/wallet-extension/src/bundler.js の移植（ethers AbiCoder → viem）。
// バンドラー JSON-RPC クライアントと有効化 UserOperation の構築。

import { encodeAbiParameters } from "viem";

import { ENTRY_POINT_V08, normalizeChainId, safeRpcUrl } from "./networks";
import { postJsonRpc, type WalletFetcher } from "./json-rpc";
import type { WalletUserOperation } from "./user-operation";

type Fetcher = WalletFetcher;

const CREATE_ACCOUNT_SELECTOR = "0b7eb161";
const HASH = /^0x[0-9a-fA-F]{64}$/;
const EXECUTE_USER_OP_SELECTOR = "8dd7712f";

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

function word(value: string) { const raw = value.replace(/^0x/, ""); if (!/^[0-9a-fA-F]+$/.test(raw) || raw.length > 64) throw new Error("invalid_abi_value"); return raw.padStart(64, "0").toLowerCase(); }
function quantity(value: bigint) { return `0x${BigInt(value).toString(16)}`; }

export function encodeCreateAccount(qx: string, qy: string, salt = 0n): string {
  return `0x${CREATE_ACCOUNT_SELECTOR}${word(qx)}${word(qy)}${word(quantity(salt))}`;
}

export function encodeEmptyV2Execution(authorizationEpoch = 1n): `0x${string}` {
  const body = encodeAbiParameters(EXECUTION_PARAMS, [BigInt(authorizationEpoch), []]);
  return `0x${EXECUTE_USER_OP_SELECTOR}${body.slice(2)}`;
}

export function createActivationUserOperation({ sender, factory, qx, qy, salt = 0n }: {
  sender: string;
  factory: string;
  qx: string;
  qy: string;
  salt?: bigint;
}): WalletUserOperation {
  if (!/^0x[0-9a-fA-F]{40}$/.test(sender) || !/^0x[0-9a-fA-F]{40}$/.test(factory)) throw new Error("invalid_user_operation_address");
  return { sender: sender.toLowerCase(), nonce: "0x0", factory: factory.toLowerCase(), factoryData: encodeCreateAccount(qx, qy, salt), callData: encodeEmptyV2Execution(1n), callGasLimit: "0x0", verificationGasLimit: "0x0", preVerificationGas: "0x0", maxFeePerGas: "0x0", maxPriorityFeePerGas: "0x0", signature: "0x" };
}

export class BundlerClient {
  private url: string;
  private fetcher: Fetcher;

  constructor(url: string, fetcher: Fetcher = (...args) => globalThis.fetch(...args)) {
    this.url = safeRpcUrl(url);
    this.fetcher = fetcher;
  }

  async rpc(method: string, params: unknown[]): Promise<unknown> {
    return postJsonRpc({ url: this.url, method, params, fetcher: this.fetcher, unavailableError: "bundler_unavailable", invalidError: "bundler_invalid_response" });
  }

  async assertEntryPoint(): Promise<true> {
    const supported = await this.rpc("eth_supportedEntryPoints", []);
    if (!Array.isArray(supported) || !supported.some((item) => String(item).toLowerCase() === ENTRY_POINT_V08.toLowerCase())) throw new Error("entrypoint_v08_unsupported");
    return true;
  }

  async assertNetwork(chainId: string | number | bigint): Promise<true> {
    const actual = normalizeChainId(await this.rpc("eth_chainId", []) as string);
    if (actual !== normalizeChainId(chainId)) throw new Error("bundler_chain_mismatch");
    return true;
  }

  async estimate(operation: WalletUserOperation): Promise<{ callGasLimit?: string; verificationGasLimit?: string; preVerificationGas?: string }> {
    return this.rpc("eth_estimateUserOperationGas", [operation, ENTRY_POINT_V08]) as Promise<{ callGasLimit?: string; verificationGasLimit?: string; preVerificationGas?: string }>;
  }

  async send(operation: WalletUserOperation, expectedHash: string): Promise<string> {
    if (!operation.signature || operation.signature === "0x") throw new Error("unsigned_user_operation");
    if (!HASH.test(expectedHash ?? "")) throw new Error("expected_user_operation_hash_required");
    const returned = await this.rpc("eth_sendUserOperation", [operation, ENTRY_POINT_V08]);
    if (!HASH.test(String(returned ?? ""))) throw new Error("invalid_bundler_operation_hash");
    if (String(returned).toLowerCase() !== expectedHash.toLowerCase()) throw new Error("bundler_user_operation_hash_mismatch");
    return String(returned).toLowerCase();
  }

  async receipt(userOperationHash: string): Promise<unknown> {
    if (!HASH.test(userOperationHash)) throw new Error("invalid_user_operation_hash");
    return this.rpc("eth_getUserOperationReceipt", [userOperationHash]);
  }
}
