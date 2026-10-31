import "server-only";

import type { D1Database } from "@cloudflare/workers-types";
import {
  decodeAbiParameters,
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  type Address,
  type Hex,
} from "viem";

import {
  getHubEvmNetworkByChainId,
  listHubWalletLinksForViewer,
} from "@/lib/server/wallet-balance-verification";
import { rpcEnvNames } from "@/lib/chains/evm-chain-registry";
import { normalizeSolanaAddress } from "@/lib/chains/address/solana";
import { resolveSolanaRpc } from "@/lib/chains/solana-chain-registry";
import { isBitcoinGateKind, isSolanaGateKind } from "@/lib/access-gates/types";
import {
  evaluateBitcoinNative,
  parseBitcoinNativeCondition,
  type BitcoinGateReason,
  type BitcoinNativeCondition,
} from "@/lib/server/gate-readers/bitcoin";
import {
  evaluateSolanaConditions,
  SolanaGateReadFailure,
  type SolanaGateCondition,
} from "@/lib/server/gate-readers/solana";

/**
 * Hub token-gate verification (docs/hub-token-gates/DESIGN.md section 2).
 *
 * Server-side only. A gate is satisfied only by balances read from an
 * allowlisted chain over the viewer's signature-verified linked wallets.
 * Everything uncertain fails closed ("unavailable"). Neither the cache nor the
 * logs ever contain wallet addresses, profile ids or balances.
 */

// ---- Input types -----------------------------------------------------------
// NOTE for reconciliation: structurally compatible with the DESIGN section 1
// shape. When lane A's lib/access-gates/types.ts lands, these can become
// aliases of its types (field names chosen to match camelCase of the columns).
export type GateConditionKind = "erc20" | "erc721" | "erc1155";

export type GateCondition = {
  kind: string;
  chainId: number;
  /** CAIP-2 reference; required for Solana kinds. */
  chainRef?: string | null;
  contract: string;
  minRaw: string | null;
  tokenIds: readonly string[] | null;
};

export type GateToVerify = {
  id: string;
  match: "any" | "all";
  version: number;
  conditions: readonly GateCondition[];
};

export type GateCheckResult = "granted" | "denied" | "unavailable";

export type GateCheckReason =
  | "ok"
  | "cache_hit"
  | "no_wallet"
  | "not_satisfied"
  | "invalid_gate"
  | "unsupported_chain"
  | "unsupported_kind"
  | "rpc_not_configured"
  | "rpc_error"
  | "malformed_response"
  | "too_many_wallets"
  | "too_many_utxos"
  | "too_many_calls";

export type GateCheckOutcome = {
  result: GateCheckResult;
  reason: GateCheckReason;
};

// ---- Limits ----------------------------------------------------------------
export const GRANTED_TTL_MS = 10 * 60 * 1000;
export const DENIED_TTL_MS = 2 * 60 * 1000;
export const MAX_WALLETS_PER_VIEWER = 25;
export const MAX_CONDITIONS_PER_GATE = 5;
export const MAX_TOKEN_IDS_PER_CONDITION = 20;
export const MAX_CALLS_PER_CHAIN = 500;
export const RPC_TIMEOUT_MS = 8_000;
export const MULTICALL3_ADDRESS: Address =
  "0xcA11bde05977b3631167028862bE2a173976CA11";

// ---- ABIs ------------------------------------------------------------------
const multicallAbi = [
  {
    type: "function",
    name: "aggregate3",
    stateMutability: "payable",
    inputs: [
      {
        name: "calls",
        type: "tuple[]",
        components: [
          { name: "target", type: "address" },
          { name: "allowFailure", type: "bool" },
          { name: "callData", type: "bytes" },
        ],
      },
    ],
    outputs: [
      {
        name: "returnData",
        type: "tuple[]",
        components: [
          { name: "success", type: "bool" },
          { name: "returnData", type: "bytes" },
        ],
      },
    ],
  },
] as const;

const tokenAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [
      { name: "account", type: "address" },
      { name: "id", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

// ---- Dependencies (injectable for tests) -----------------------------------
export type GateCheckCache = {
  get(input: {
    profileId: string;
    gateId: string;
    gateVersion: number;
    now: number;
  }): Promise<"granted" | "denied" | null>;
  put(input: {
    profileId: string;
    gateId: string;
    gateVersion: number;
    allowed: boolean;
    now: number;
    expiresAt: number;
  }): Promise<void>;
};

export type GateVerificationDeps = {
  /** Active, signature-verified wallet addresses of the viewer. */
  listWalletAddresses: (profileId: string) => Promise<string[]>;
  /** Active, signature-verified Solana wallet addresses of the viewer (only read when a gate has Solana conditions). */
  listSolanaWalletAddresses?: (profileId: string) => Promise<string[]>;
  /** Active, signature-verified Bitcoin addresses of the viewer on one network (only read when a gate has Bitcoin conditions). */
  listBitcoinWalletAddresses?: (profileId: string, chainRef: string) => Promise<string[]>;
  /** Environment holding HUB_RPC_URL_BITCOIN_* (defaults to process.env). Bitcoin gates never use default indexers. */
  bitcoinEnv?: Readonly<Record<string, string | undefined>>;
  /** Resolves a Solana cluster to its configured HTTPS RPC URL. Absent = not configured (fail closed). */
  resolveSolanaRpc?: (chainRef: string) => { url: string } | "unsupported_chain" | "rpc_not_configured";
  /** Resolves an allowlisted chain to its configured HTTPS RPC URL, or throws. */
  resolveRpc: (chainId: number) => { url: string } | "unsupported_chain" | "rpc_not_configured";
  fetch: typeof fetch;
  cache: GateCheckCache | null;
  now: () => number;
  log: (entry: { gateId: string; result: GateCheckResult; reason: GateCheckReason; ms: number }) => void;
};

// ---- D1 cache --------------------------------------------------------------
/**
 * Columns per DESIGN section 2: profile_id, gate_id, gate_version, allowed,
 * checked_at, expires_at (lane A's migration 0240). Stores only result+expiry.
 */
export function createD1GateCheckCache(database: D1Database): GateCheckCache {
  return {
    async get({ profileId, gateId, gateVersion, now }) {
      const row = await database
        .prepare(
          `SELECT allowed FROM access_gate_checks
           WHERE profile_id = ? AND gate_id = ? AND gate_version = ? AND expires_at > ?
           LIMIT 1`,
        )
        .bind(profileId, gateId, gateVersion, new Date(now).toISOString())
        .first<{ allowed: number }>();
      if (!row) return null;
      return Number(row.allowed) === 1 ? "granted" : "denied";
    },
    async put({ profileId, gateId, gateVersion, allowed, now, expiresAt }) {
      await database.batch([
        database
          .prepare("DELETE FROM access_gate_checks WHERE profile_id = ? AND gate_id = ?")
          .bind(profileId, gateId),
        database
          .prepare(
            `INSERT INTO access_gate_checks
             (profile_id, gate_id, gate_version, allowed, checked_at, expires_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            profileId,
            gateId,
            gateVersion,
            allowed ? 1 : 0,
            new Date(now).toISOString(),
            new Date(expiresAt).toISOString(),
          ),
      ]);
    },
  };
}

/** Removes cached results for a profile (call when a wallet is unlinked). */
export async function clearGateChecksForProfile(
  database: D1Database,
  profileId: string,
): Promise<void> {
  await database
    .prepare("DELETE FROM access_gate_checks WHERE profile_id = ?")
    .bind(profileId)
    .run();
}

// ---- Evaluation ------------------------------------------------------------
type Tri = "yes" | "no" | "unknown";

class ChainFailure extends Error {
  constructor(readonly reason: GateCheckReason) {
    super(reason);
  }
}

type PlannedCall = {
  target: Address;
  callData: Hex;
  /** index into the condition plan so results can be routed back. */
  conditionIndex: number;
  role: "balance" | "owner";
  /** wallet index for balance calls, token-id index for owner calls. */
  slot: number;
  /** ownerOf revert means "token not owned" rather than a failure. */
  revertIsEmpty: boolean;
};

const UINT_RE = /^[0-9]{1,78}$/;

function parseUint(value: unknown): bigint | null {
  if (typeof value !== "string" || !UINT_RE.test(value)) return null;
  const parsed = BigInt(value);
  return parsed < 2n ** 256n ? parsed : null;
}

function normalizeContract(value: string): Address | null {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) return null;
  try {
    return getAddress(value.toLowerCase());
  } catch {
    return null;
  }
}

type ParsedCondition = {
  kind: GateConditionKind;
  chainId: number;
  contract: Address;
  min: bigint;
  tokenIds: bigint[];
};

function parseCondition(
  condition: GateCondition,
): ParsedCondition | "invalid_gate" | "unsupported_kind" {
  if (
    condition.kind !== "erc20" &&
    condition.kind !== "erc721" &&
    condition.kind !== "erc1155"
  ) {
    return "unsupported_kind";
  }
  const contract = normalizeContract(condition.contract);
  if (!contract || !Number.isSafeInteger(condition.chainId)) return "invalid_gate";
  const rawIds = condition.tokenIds ?? [];
  if (rawIds.length > MAX_TOKEN_IDS_PER_CONDITION) return "invalid_gate";
  const tokenIds: bigint[] = [];
  for (const id of rawIds) {
    const parsed = parseUint(id);
    if (parsed === null) return "invalid_gate";
    tokenIds.push(parsed);
  }
  if (condition.kind === "erc20") {
    const min = parseUint(condition.minRaw);
    if (min === null || min === 0n) return "invalid_gate";
    return { kind: "erc20", chainId: condition.chainId, contract, min, tokenIds: [] };
  }
  if (condition.kind === "erc721") {
    return { kind: "erc721", chainId: condition.chainId, contract, min: 1n, tokenIds };
  }
  const min = parseUint(condition.minRaw);
  if (min === null || min === 0n || tokenIds.length !== 1) return "invalid_gate";
  return { kind: "erc1155", chainId: condition.chainId, contract, min, tokenIds };
}

function planCalls(
  condition: ParsedCondition,
  conditionIndex: number,
  wallets: readonly Address[],
): PlannedCall[] {
  const calls: PlannedCall[] = [];
  if (condition.kind === "erc721" && condition.tokenIds.length > 0) {
    condition.tokenIds.forEach((tokenId, slot) => {
      calls.push({
        target: condition.contract,
        callData: encodeFunctionData({ abi: tokenAbi, functionName: "ownerOf", args: [tokenId] }),
        conditionIndex,
        role: "owner",
        slot,
        revertIsEmpty: true,
      });
    });
    return calls;
  }
  wallets.forEach((wallet, slot) => {
    const callData =
      condition.kind === "erc1155"
        ? encodeFunctionData({
            abi: tokenAbi,
            functionName: "balanceOf",
            args: [wallet, condition.tokenIds[0]],
          })
        : encodeFunctionData({
            abi: tokenAbi,
            functionName: "balanceOf",
            args: [wallet],
          });
    calls.push({
      target: condition.contract,
      callData,
      conditionIndex,
      role: "balance",
      slot,
      revertIsEmpty: false,
    });
  });
  return calls;
}

function decodeUint256(data: Hex): bigint {
  if (data.length !== 66) throw new ChainFailure("malformed_response");
  const [value] = decodeAbiParameters([{ type: "uint256" }], data);
  return value;
}

function decodeAddressWord(data: Hex): string {
  if (data.length !== 66) throw new ChainFailure("malformed_response");
  const [value] = decodeAbiParameters([{ type: "address" }], data);
  return value.toLowerCase();
}

async function callMulticall(
  deps: GateVerificationDeps,
  rpcUrl: string,
  calls: readonly PlannedCall[],
): Promise<Array<{ success: boolean; returnData: Hex }>> {
  const data = encodeFunctionData({
    abi: multicallAbi,
    functionName: "aggregate3",
    args: [calls.map((call) => ({ target: call.target, allowFailure: true, callData: call.callData }))],
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);
  let body: unknown;
  try {
    const response = await deps.fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_call",
        params: [{ to: MULTICALL3_ADDRESS, data }, "latest"],
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new ChainFailure("rpc_error");
    body = await response.json();
  } catch (error) {
    if (error instanceof ChainFailure) throw error;
    throw new ChainFailure("rpc_error");
  } finally {
    clearTimeout(timer);
  }
  if (!body || typeof body !== "object") throw new ChainFailure("malformed_response");
  const envelope = body as { result?: unknown; error?: unknown };
  if (envelope.error) throw new ChainFailure("rpc_error");
  if (typeof envelope.result !== "string" || !/^0x([0-9a-fA-F]{2})+$/.test(envelope.result)) {
    throw new ChainFailure("malformed_response");
  }
  let decoded: readonly { success: boolean; returnData: Hex }[];
  try {
    decoded = decodeFunctionResult({
      abi: multicallAbi,
      functionName: "aggregate3",
      data: envelope.result as Hex,
    });
  } catch {
    throw new ChainFailure("malformed_response");
  }
  if (decoded.length !== calls.length) throw new ChainFailure("malformed_response");
  return decoded.map((entry) => ({ success: entry.success, returnData: entry.returnData }));
}

type ParsedSolanaCondition = { chainRef: string; solana: SolanaGateCondition };
type ParsedBitcoinCondition = { bitcoin: BitcoinNativeCondition };

function parseBitcoinCondition(condition: GateCondition): ParsedBitcoinCondition | "invalid_gate" {
  const parsed = parseBitcoinNativeCondition({ chainRef: condition.chainRef, minRaw: condition.minRaw });
  return parsed ? { bitcoin: parsed } : "invalid_gate";
}

const UINT64_LIMIT = BigInt(1) << BigInt(64);

function parseSolanaCondition(condition: GateCondition, index: number): ParsedSolanaCondition | "invalid_gate" {
  const chainRef = condition.chainRef;
  if (typeof chainRef !== "string" || !chainRef.startsWith("solana:")) return "invalid_gate";
  const min = parseUint(condition.minRaw);
  if (condition.kind === "sol_native") {
    if (min === null || min === BigInt(0) || min >= UINT64_LIMIT) return "invalid_gate";
    return { chainRef, solana: { index, kind: "sol_native", mints: [], min } };
  }
  if (condition.kind === "spl") {
    const mint = normalizeSolanaAddress(condition.contract);
    if (!mint || min === null || min === BigInt(0) || min >= UINT64_LIMIT) return "invalid_gate";
    return { chainRef, solana: { index, kind: "spl", mints: [mint], min } };
  }
  const ids = condition.tokenIds ?? [];
  if (ids.length === 0 || ids.length > MAX_TOKEN_IDS_PER_CONDITION) return "invalid_gate";
  const mints: string[] = [];
  for (const id of ids) {
    const mint = normalizeSolanaAddress(id);
    if (!mint) return "invalid_gate";
    mints.push(mint);
  }
  return { chainRef, solana: { index, kind: "spl_mints", mints, min: BigInt(1) } };
}

/** Reads one chain; returns tri-state per condition index. */
async function evaluateChain(
  deps: GateVerificationDeps,
  chainId: number,
  entries: Array<{ condition: ParsedCondition; index: number }>,
  wallets: readonly Address[],
): Promise<Map<number, Tri>> {
  const rpc = deps.resolveRpc(chainId);
  if (typeof rpc === "string") throw new ChainFailure(rpc);
  const calls = entries.flatMap(({ condition, index }) => planCalls(condition, index, wallets));
  if (calls.length > MAX_CALLS_PER_CHAIN) throw new ChainFailure("too_many_calls");
  const responses = await callMulticall(deps, rpc.url, calls);

  const walletSet = new Set(wallets.map((wallet) => wallet.toLowerCase()));
  const sums = new Map<number, bigint>();
  const ownedTokenIds = new Map<number, number>();
  const failed = new Set<number>();
  calls.forEach((call, position) => {
    const response = responses[position];
    if (!response.success) {
      if (!call.revertIsEmpty) failed.add(call.conditionIndex);
      return;
    }
    try {
      if (call.role === "balance") {
        sums.set(call.conditionIndex, (sums.get(call.conditionIndex) ?? 0n) + decodeUint256(response.returnData));
      } else if (walletSet.has(decodeAddressWord(response.returnData))) {
        ownedTokenIds.set(call.conditionIndex, (ownedTokenIds.get(call.conditionIndex) ?? 0) + 1);
      }
    } catch {
      failed.add(call.conditionIndex);
    }
  });

  const out = new Map<number, Tri>();
  for (const { condition, index } of entries) {
    if (failed.has(index)) {
      out.set(index, "unknown");
    } else if (condition.kind === "erc721" && condition.tokenIds.length > 0) {
      out.set(index, (ownedTokenIds.get(index) ?? 0) >= 1 ? "yes" : "no");
    } else {
      out.set(index, (sums.get(index) ?? 0n) >= condition.min ? "yes" : "no");
    }
  }
  return out;
}

function combine(match: "any" | "all", states: readonly Tri[]): GateCheckOutcome {
  if (match === "any") {
    if (states.includes("yes")) return { result: "granted", reason: "ok" };
    if (states.includes("unknown")) return { result: "unavailable", reason: "rpc_error" };
    return { result: "denied", reason: "not_satisfied" };
  }
  if (states.includes("no")) return { result: "denied", reason: "not_satisfied" };
  if (states.includes("unknown")) return { result: "unavailable", reason: "rpc_error" };
  return { result: "granted", reason: "ok" };
}

function bitcoinFailureReason(reason: BitcoinGateReason): GateCheckReason {
  switch (reason) {
    case "no_wallet": return "no_wallet";
    case "rpc_not_configured": return "rpc_not_configured";
    case "unsupported_chain": return "unsupported_chain";
    case "malformed_response": return "malformed_response";
    case "too_many_utxos": return "too_many_utxos";
    case "invalid_gate": return "invalid_gate";
    default: return "rpc_error";
  }
}

/** Pure read, no cache. Exposed for tests and for the "recheck" path. */
export async function evaluateGate(
  gate: GateToVerify,
  walletAddresses: readonly string[],
  deps: Pick<GateVerificationDeps, "resolveRpc" | "fetch" | "now" | "log" | "listWalletAddresses" | "cache"> &
    Partial<Pick<GateVerificationDeps, "resolveSolanaRpc" | "listSolanaWalletAddresses" | "listBitcoinWalletAddresses" | "bitcoinEnv">>,
  extra: { solanaWallets?: readonly string[]; bitcoinWallets?: Readonly<Record<string, readonly string[]>> } = {},
): Promise<GateCheckOutcome> {
  const conditions = gate.conditions;
  if (
    (gate.match !== "any" && gate.match !== "all") ||
    conditions.length === 0 ||
    conditions.length > MAX_CONDITIONS_PER_GATE
  ) {
    return { result: "unavailable", reason: "invalid_gate" };
  }
  const parsed: Array<ParsedCondition | ParsedSolanaCondition | ParsedBitcoinCondition> = [];
  for (let position = 0; position < conditions.length; position += 1) {
    const condition = conditions[position];
    const value = isSolanaGateKind(condition.kind)
      ? parseSolanaCondition(condition, position)
      : isBitcoinGateKind(condition.kind)
        ? parseBitcoinCondition(condition)
        : parseCondition(condition);
    if (value === "unsupported_kind") return { result: "unavailable", reason: "unsupported_kind" };
    if (value === "invalid_gate") return { result: "unavailable", reason: "invalid_gate" };
    parsed.push(value);
  }

  const wallets: Address[] = [];
  const seen = new Set<string>();
  for (const raw of walletAddresses) {
    const address = normalizeContract(raw);
    if (!address) return { result: "unavailable", reason: "malformed_response" };
    const key = address.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      wallets.push(address);
    }
  }
  const solanaWallets: string[] = [];
  for (const raw of extra.solanaWallets ?? []) {
    const address = normalizeSolanaAddress(raw);
    if (!address) return { result: "unavailable", reason: "malformed_response" };
    if (!solanaWallets.includes(address)) solanaWallets.push(address);
  }
  const bitcoinWallets: Record<string, string[]> = {};
  let bitcoinWalletCount = 0;
  for (const [chainRef, list] of Object.entries(extra.bitcoinWallets ?? {})) {
    bitcoinWallets[chainRef] = [...new Set(list)];
    bitcoinWalletCount += bitcoinWallets[chainRef].length;
  }
  if (wallets.length > MAX_WALLETS_PER_VIEWER || solanaWallets.length > MAX_WALLETS_PER_VIEWER || bitcoinWalletCount > MAX_WALLETS_PER_VIEWER) {
    return { result: "unavailable", reason: "too_many_wallets" };
  }
  if (wallets.length === 0 && solanaWallets.length === 0 && bitcoinWalletCount === 0) return { result: "denied", reason: "no_wallet" };

  const states: Tri[] = new Array(parsed.length).fill("unknown");
  const byChain = new Map<number, Array<{ condition: ParsedCondition; index: number }>>();
  const bySolanaChain = new Map<string, SolanaGateCondition[]>();
  const bitcoinEntries: Array<{ index: number; condition: BitcoinNativeCondition }> = [];
  parsed.forEach((condition, index) => {
    if ("bitcoin" in condition) {
      if ((bitcoinWallets[condition.bitcoin.chainRef] ?? []).length === 0) {
        states[index] = "no";
        return;
      }
      bitcoinEntries.push({ index, condition: condition.bitcoin });
      return;
    }
    if ("solana" in condition) {
      if (solanaWallets.length === 0) {
        states[index] = "no";
        return;
      }
      const list = bySolanaChain.get(condition.chainRef) ?? [];
      list.push(condition.solana);
      bySolanaChain.set(condition.chainRef, list);
      return;
    }
    if (wallets.length === 0) {
      states[index] = "no";
      return;
    }
    const list = byChain.get(condition.chainId) ?? [];
    list.push({ condition, index });
    byChain.set(condition.chainId, list);
  });

  type Settled = { states: Map<number, Tri> | null; failure: GateCheckReason | null };
  let firstFailure: GateCheckReason | null = null;
  const settled: Settled[] = await Promise.all([
    ...[...byChain.entries()].map(async ([chainId, entries]): Promise<Settled> => {
      try {
        return { states: await evaluateChain(deps as GateVerificationDeps, chainId, entries, wallets), failure: null };
      } catch (error) {
        const reason = error instanceof ChainFailure ? error.reason : "rpc_error";
        return { states: null, failure: reason as GateCheckReason };
      }
    }),
    ...bitcoinEntries.map(async ({ index, condition }): Promise<Settled> => {
      const outcome = await evaluateBitcoinNative(condition, bitcoinWallets[condition.chainRef] ?? [], {
        fetch: deps.fetch,
        env: deps.bitcoinEnv ?? process.env,
      });
      if (outcome.state === "unknown") return { states: null, failure: bitcoinFailureReason(outcome.reason) };
      return { states: new Map<number, Tri>([[index, outcome.state]]), failure: null };
    }),
    ...[...bySolanaChain.entries()].map(async ([chainRef, list]): Promise<Settled> => {
      const rpc = deps.resolveSolanaRpc ? deps.resolveSolanaRpc(chainRef) : "rpc_not_configured";
      if (typeof rpc === "string") return { states: null, failure: rpc };
      try {
        const result = await evaluateSolanaConditions({ fetch: deps.fetch, rpcUrl: rpc.url, conditions: list, wallets: solanaWallets });
        return { states: result, failure: null };
      } catch (error) {
        return { states: null, failure: error instanceof SolanaGateReadFailure ? error.reason : "rpc_error" };
      }
    }),
  ]);
  for (const entry of settled) {
    if (entry.states) {
      for (const [index, state] of entry.states) states[index] = state;
    } else {
      firstFailure ??= entry.failure;
    }
  }
  const outcome = combine(gate.match, states);
  if (outcome.result === "unavailable" && firstFailure) {
    return { result: "unavailable", reason: firstFailure };
  }
  return outcome;
}

// ---- Public entry point ----------------------------------------------------
export function envRpc(chainId: number): ReturnType<GateVerificationDeps["resolveRpc"]> {
  let definition;
  try {
    definition = getHubEvmNetworkByChainId(chainId);
  } catch {
    return "unsupported_chain";
  }
  const configured = rpcEnvNames(definition.entry)
    .map((name) => process.env[name]?.trim())
    .find((value) => value);
  if (!configured) return "rpc_not_configured";
  try {
    const parsed = new URL(configured);
    if (parsed.protocol !== "https:") return "rpc_not_configured";
    return { url: parsed.toString() };
  } catch {
    return "rpc_not_configured";
  }
}

export function createGateVerificationDeps(database: D1Database): GateVerificationDeps {
  return {
    async listWalletAddresses(profileId) {
      const links = await listHubWalletLinksForViewer({ id: profileId }, database);
      return links.map((link) => link.address);
    },
    async listSolanaWalletAddresses(profileId) {
      const rows = await database
        .prepare("SELECT normalized_address FROM profile_wallet_accounts WHERE profile_id = ? AND namespace = 'solana' AND verification_status = 'verified' LIMIT ?")
        .bind(profileId, MAX_WALLETS_PER_VIEWER + 1)
        .all<{ normalized_address: string }>();
      return rows.results.map((row) => row.normalized_address);
    },
    async listBitcoinWalletAddresses(profileId, chainRef) {
      const rows = await database
        .prepare(`SELECT a.normalized_address FROM profile_wallet_accounts a
          JOIN wallet_account_networks n ON n.wallet_account_id = a.id AND n.network_reference = ? AND n.enabled = 1
          WHERE a.profile_id = ? AND a.namespace = 'bip122' AND a.verification_status = 'verified' LIMIT ?`)
        .bind(chainRef, profileId, MAX_WALLETS_PER_VIEWER + 1)
        .all<{ normalized_address: string }>();
      return rows.results.map((row) => row.normalized_address);
    },
    resolveRpc: envRpc,
    resolveSolanaRpc: (chainRef) => {
      const resolved = resolveSolanaRpc(chainRef, process.env);
      return resolved.ok ? { url: resolved.url } : resolved.reason;
    },
    fetch: (input, init) => fetch(input, init),
    cache: createD1GateCheckCache(database),
    now: () => Date.now(),
    log: (entry) => console.info(JSON.stringify({ event: "access_gate_check", ...entry })),
  };
}

export type CheckGateOptions = {
  /** Ignore a cached result ("check again" button). Rate limiting is the caller's job. */
  bypassCache?: boolean;
};

export async function checkGateForViewer(
  gate: GateToVerify,
  viewerProfileId: string,
  deps: GateVerificationDeps,
  options: CheckGateOptions = {},
): Promise<GateCheckOutcome> {
  const started = deps.now();
  const finish = (outcome: GateCheckOutcome): GateCheckOutcome => {
    deps.log({
      gateId: gate.id,
      result: outcome.result,
      reason: outcome.reason,
      ms: Math.max(0, deps.now() - started),
    });
    return outcome;
  };

  try {
    if (!options.bypassCache && deps.cache) {
      try {
        const cached = await deps.cache.get({
          profileId: viewerProfileId,
          gateId: gate.id,
          gateVersion: gate.version,
          now: started,
        });
        if (cached) return finish({ result: cached, reason: "cache_hit" });
      } catch {
        // Cache trouble never grants; fall through to a fresh read.
      }
    }
    const wallets = await deps.listWalletAddresses(viewerProfileId);
    const needsSolana = gate.conditions.some((condition) => isSolanaGateKind(condition.kind));
    const solanaWallets = needsSolana && deps.listSolanaWalletAddresses ? await deps.listSolanaWalletAddresses(viewerProfileId) : [];
    const bitcoinChainRefs = new Set<string>();
    for (const condition of gate.conditions) {
      if (isBitcoinGateKind(condition.kind) && typeof condition.chainRef === "string") bitcoinChainRefs.add(condition.chainRef);
    }
    const bitcoinWallets: Record<string, string[]> = {};
    if (deps.listBitcoinWalletAddresses) {
      for (const chainRef of bitcoinChainRefs) bitcoinWallets[chainRef] = await deps.listBitcoinWalletAddresses(viewerProfileId, chainRef);
    }
    const outcome = await evaluateGate(gate, wallets, deps, { solanaWallets, bitcoinWallets });
    if (outcome.result !== "unavailable" && deps.cache) {
      const granted = outcome.result === "granted";
      try {
        await deps.cache.put({
          profileId: viewerProfileId,
          gateId: gate.id,
          gateVersion: gate.version,
          allowed: granted,
          now: started,
          expiresAt: started + (granted ? GRANTED_TTL_MS : DENIED_TTL_MS),
        });
      } catch {
        // Failing to cache only costs another RPC read.
      }
    }
    return finish(outcome);
  } catch {
    return finish({ result: "unavailable", reason: "rpc_error" });
  }
}
