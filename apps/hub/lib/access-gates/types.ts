/**
 * Hub token gates: shared types and constants (docs/hub-token-gates/DESIGN.md).
 * Pure module (no server-only imports) so every lane and the UI may import it.
 * Keep this file stable: other lanes depend on these names.
 */

import { EVM_CHAIN_IDS, isSupportedEvmChain } from "@/lib/chains/evm-chain-registry";

export const ACCESS_GATE_MATCHES =["any", "all"] as const;
export type AccessGateMatch = (typeof ACCESS_GATE_MATCHES)[number];

/** EVM kinds: what the gate editor offers with the EVM chain list. */
export const ACCESS_GATE_CONDITION_KINDS = ["erc20", "erc721", "erc1155"] as const;
/** Solana kinds (2026-10-31): native SOL, one SPL / Token-2022 mint, or any of a listed mint set (NFT-style, decimals 0). */
export const ACCESS_GATE_SOLANA_CONDITION_KINDS = ["sol_native", "spl", "spl_mints"] as const;
/** Bitcoin kind (2026-10-31): native BTC, confirmed UTXOs only. */
export const ACCESS_GATE_BITCOIN_CONDITION_KINDS = ["btc_native"] as const;
export const ACCESS_GATE_ALL_CONDITION_KINDS = [...ACCESS_GATE_CONDITION_KINDS, ...ACCESS_GATE_SOLANA_CONDITION_KINDS, ...ACCESS_GATE_BITCOIN_CONDITION_KINDS] as const;
export type AccessGateConditionKind = (typeof ACCESS_GATE_ALL_CONDITION_KINDS)[number];

export function isBitcoinGateKind(kind: string): kind is (typeof ACCESS_GATE_BITCOIN_CONDITION_KINDS)[number] {
  return (ACCESS_GATE_BITCOIN_CONDITION_KINDS as readonly string[]).includes(kind);
}

export function isSolanaGateKind(kind: string): kind is (typeof ACCESS_GATE_SOLANA_CONDITION_KINDS)[number] {
  return (ACCESS_GATE_SOLANA_CONDITION_KINDS as readonly string[]).includes(kind);
}

export const ACCESS_GATE_TARGET_TYPES = ["post", "article", "video", "thread", "channel"] as const;
export type AccessGateTargetType = (typeof ACCESS_GATE_TARGET_TYPES)[number];

export const ACCESS_GATE_MAX_CONDITIONS = 5;
export const ACCESS_GATE_MAX_TOKEN_IDS = 20;
export const ACCESS_GATE_MAX_DESCRIPTION_LENGTH = 280;
export const ACCESS_GATE_MAX_MIN_RAW_DIGITS = 78;
export const ACCESS_GATE_MAX_ACQUISITION_URL_LENGTH = 500;

/**
 * Chain allowlist for gate conditions (EVM chain ids). Derived from the chain
 * registry (lib/chains/evm-chain-registry.ts): add a chain there, not here.
 * A gate pointing at a chain that later leaves the list admits nobody, and a
 * chain with no configured RPC fails closed at check time.
 */
export const ACCESS_GATE_CHAIN_IDS: readonly number[] = EVM_CHAIN_IDS;

export function isAllowedAccessGateChain(chainId: number): boolean {
  return isSupportedEvmChain(chainId);
}

/** One condition. `contract` is lowercase 0x + 40 hex; `minRaw` is a base-10 integer string; token ids are base-10 integer strings. */
export type AccessGateCondition = {
  ordinal: number;
  kind: AccessGateConditionKind;
  /** EVM chain ID; 0 for non-EVM conditions (use chainRef). */
  chainId: number;
  /** CAIP-2 reference ("eip155:8453", "solana:..."). Always set by the server. */
  chainRef?: string;
  /** EVM contract, or the Solana mint for spl/spl_mints (first mint); "" for sol_native. */
  contract: string;
  minRaw: string;
  /** EVM token IDs, or the Solana mint list for spl_mints. */
  tokenIds: string[];
  /** Display only; never used for checks. */
  decimals: number | null;
};

/** Caller-supplied condition (ordinal assigned by position). */
export type AccessGateConditionInput = {
  kind: AccessGateConditionKind;
  chainId: number;
  /** Required for Solana kinds. */
  chainRef?: string;
  contract: string;
  minRaw?: string;
  tokenIds?: string[];
  decimals?: number | null;
};

export type AccessGateInput = {
  match: AccessGateMatch;
  description: string;
  /** One creator-supplied external https link, or null. */
  acquisitionUrl: string | null;
  conditions: AccessGateConditionInput[];
};

export type AccessGate = {
  id: string;
  ownerProfileId: string;
  match: AccessGateMatch;
  description: string;
  acquisitionUrl: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  conditions: AccessGateCondition[];
};

/** Public descriptor shown on a locked card. Contains no owner id. */
export type PublicAccessGate = {
  id: string;
  version: number;
  match: AccessGateMatch;
  description: string;
  acquisitionUrl: string | null;
  conditions: AccessGateCondition[];
};

export type AccessGateTarget = { targetType: AccessGateTargetType; targetId: string };

/** Cache outcome categories. "unavailable" is never stored. */
export type AccessGateCheckOutcome = "allowed" | "denied" | "unavailable";

/** Row of access_gate_checks: no wallet addresses, no balances. */
export type AccessGateCheckRecord = {
  profileId: string;
  gateId: string;
  gateVersion: number;
  allowed: boolean;
  checkedAt: string;
  expiresAt: string;
};

export const ACCESS_GATE_ALLOWED_TTL_MS = 10 * 60 * 1000;
export const ACCESS_GATE_DENIED_TTL_MS = 2 * 60 * 1000;
