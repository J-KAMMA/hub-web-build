// apps/wallet-extension/src/paymaster.js の移植。
// 汎用ペイマスター/Alchemyガスマネージャーの応答検証（将来のスポンサー用）。

import { ENTRY_POINT_V08, safeRpcUrl } from "./networks";
import { postJsonRpc, type WalletFetcher } from "./json-rpc";
import { HARD_PAYMASTER_GAS_CEILINGS, MAX_PAYMASTER_DATA_BYTES } from "./gas-policy";
import type { WalletUserOperation } from "./user-operation";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HEX = /^0x(?:[0-9a-fA-F]{2})*$/;
const QUANTITY = /^0x[0-9a-fA-F]+$/;
// Keep enough headroom for WebAuthn/P-256 validation without failing the
// bundler's minimum verification-gas efficiency check.
const PASSKEY_VERIFICATION_GAS_LIMIT = "0x25d78"; // 155,000 gas.
const SPONSOR_MUTABLE_FIELDS = [
  "callGasLimit",
  "verificationGasLimit",
  "preVerificationGas",
  "maxFeePerGas",
  "maxPriorityFeePerGas",
] as const;

type Fetcher = WalletFetcher;

type SponsorshipResult = {
  paymaster?: string;
  paymasterData?: string;
  paymasterVerificationGasLimit?: string;
  paymasterPostOpGasLimit?: string;
} & Record<string, unknown>;

function byteLength(hexValue: string): number {
  return (hexValue.length - 2) / 2;
}

function assertBoundedPaymasterFields(result: SponsorshipResult, prefix: string) {
  if (!ADDRESS.test(result?.paymaster ?? "") || !HEX.test(result?.paymasterData ?? "")) {
    throw new Error(`invalid_${prefix}_response`);
  }
  if (byteLength(result.paymasterData as string) > MAX_PAYMASTER_DATA_BYTES) {
    throw new Error(`${prefix}_data_too_large`);
  }
  for (const [field, ceiling] of Object.entries(HARD_PAYMASTER_GAS_CEILINGS)) {
    if (!QUANTITY.test((result as Record<string, unknown>)[field] as string ?? "")) throw new Error(`invalid_${prefix}_response:${field}`);
    const value = BigInt((result as Record<string, unknown>)[field] as string);
    if ((field === "paymasterVerificationGasLimit" && value === 0n) || value > ceiling) {
      throw new Error(`${prefix}_gas_ceiling_exceeded:${field}`);
    }
  }
}

function assertSponsorDoesNotRaiseApprovedCeilings(operation: WalletUserOperation, result: SponsorshipResult, prefix: string, fields: readonly string[] = SPONSOR_MUTABLE_FIELDS) {
  for (const field of fields) {
    if (result[field] == null) continue;
    if (!QUANTITY.test(result[field] as string) || BigInt(result[field] as string) <= 0n) {
      throw new Error(`invalid_${prefix}_response:${field}`);
    }
    if (!QUANTITY.test((operation as Record<string, unknown>)[field] as string ?? "") || BigInt(result[field] as string) > BigInt((operation as Record<string, unknown>)[field] as string)) {
      throw new Error(`${prefix}_gas_ceiling_exceeded:${field}`);
    }
  }
  if (
    result.maxPriorityFeePerGas != null
    && result.maxFeePerGas != null
    && BigInt(result.maxPriorityFeePerGas as string) > BigInt(result.maxFeePerGas as string)
  ) {
    throw new Error(`invalid_${prefix}_response:max_priority_fee`);
  }
}

export function applySponsorship(operation: WalletUserOperation, result: SponsorshipResult): WalletUserOperation {
  assertBoundedPaymasterFields(result, "paymaster");
  assertSponsorDoesNotRaiseApprovedCeilings(operation, result, "paymaster");
  return {
    ...operation,
    ...Object.fromEntries(SPONSOR_MUTABLE_FIELDS.filter((field) => result[field] != null).map((field) => [field, result[field]])),
    paymaster: (result.paymaster as string).toLowerCase(),
    paymasterData: result.paymasterData,
    paymasterVerificationGasLimit: result.paymasterVerificationGasLimit,
    paymasterPostOpGasLimit: result.paymasterPostOpGasLimit,
  };
}

export function applyGasManagerSponsorship(operation: WalletUserOperation, result: SponsorshipResult): WalletUserOperation {
  assertBoundedPaymasterFields(result, "gas_manager");
  for (const field of SPONSOR_MUTABLE_FIELDS) {
    if (result?.[field] == null) throw new Error(`invalid_gas_manager_response:${field}`);
  }
  assertSponsorDoesNotRaiseApprovedCeilings(operation, result, "gas_manager");
  return {
    ...operation,
    ...Object.fromEntries([
      ...SPONSOR_MUTABLE_FIELDS,
      "paymasterVerificationGasLimit",
      "paymasterPostOpGasLimit",
    ].map((field) => [field, result[field]])),
    paymaster: (result.paymaster as string).toLowerCase(),
    paymasterData: result.paymasterData,
  };
}

export class PaymasterClient {
  private url: string;
  private fetcher: Fetcher;

  constructor(url: string, fetcher: Fetcher = (...args) => globalThis.fetch(...args)) {
    this.url = safeRpcUrl(url);
    this.fetcher = fetcher;
  }

  async sponsor(operation: WalletUserOperation, chainId: string | number | bigint): Promise<WalletUserOperation> {
    const result = await postJsonRpc({ url: this.url, method: "pm_sponsorUserOperation", params: [operation, ENTRY_POINT_V08, { chainId }], fetcher: this.fetcher, unavailableError: "paymaster_unavailable", invalidError: "paymaster_invalid_response" }) as SponsorshipResult;
    return applySponsorship(operation, result);
  }
}

export class AlchemyGasManagerClient {
  private url: string;
  private policyId: string;
  private fetcher: Fetcher;

  constructor(url: string, policyId: string, fetcher: Fetcher = (...args) => globalThis.fetch(...args)) {
    this.url = safeRpcUrl(url);
    if (typeof policyId !== "string" || !/^[0-9a-zA-Z-]{8,128}$/.test(policyId)) throw new Error("invalid_gas_manager_policy_id");
    this.policyId = policyId;
    this.fetcher = fetcher;
  }

  async sponsor(operation: WalletUserOperation, dummySignature: string): Promise<WalletUserOperation> {
    if (!HEX.test(dummySignature ?? "") || dummySignature === "0x") throw new Error("invalid_dummy_signature");
    const userOperation = { ...operation, signature: dummySignature } as Record<string, unknown>;
    for (const field of ["paymaster", "paymasterData", "paymasterVerificationGasLimit", "paymasterPostOpGasLimit"]) delete userOperation[field];
    const result = await postJsonRpc({ url: this.url, method: "alchemy_requestGasAndPaymasterAndData", params: [{ policyId: this.policyId, entryPoint: ENTRY_POINT_V08, dummySignature, userOperation, overrides: { verificationGasLimit: PASSKEY_VERIFICATION_GAS_LIMIT } }], fetcher: this.fetcher, unavailableError: "gas_manager_unavailable", invalidError: "gas_manager_invalid_response" }) as SponsorshipResult;
    return applyGasManagerSponsorship(operation, result);
  }
}
