/**
 * Solana wallet reads for the Hub wallet view (design sections 1.1 and 4). Server-side, read only, no keys.
 * Hub holds no Solana keys: sends are built in the browser and signed in the user's wallet; the server only
 * answers read questions through a fixed set of allowlisted RPC methods (never a raw passthrough).
 *
 * No @solana/web3.js here (Workers bundle): addresses use lib/chains/address/solana.ts.
 */
import { normalizeSolanaAddress as strictSolanaAddress } from "@/lib/chains/address/solana";
import {
  getSolanaChain,
  isSolanaChainActive,
  resolveSolanaWalletViewRpc,
  SOLANA_CHAIN_REGISTRY,
  SOLANA_DEVNET_REF,
  type SolanaChainEntry,
} from "@/lib/chains/solana-chain-registry";

export class SolanaWalletInputError extends Error {}
export class SolanaWalletNetworkError extends Error {}

export const SPL_TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const SPL_TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const RPC_TIMEOUT_MS = 8_000;
const MAX_TOKEN_ACCOUNTS = 200;

type Env = Readonly<Record<string, string | undefined>>;
export type SolanaWalletDeps = { fetch: typeof fetch; env: Env; production: boolean };

function defaultDeps(): SolanaWalletDeps {
  return { fetch: (input, init) => fetch(input, init), env: process.env, production: process.env.NODE_ENV === "production" };
}

export function normalizeSolanaAddress(value: unknown): string {
  const normalized = strictSolanaAddress(value);
  if (!normalized) throw new SolanaWalletInputError("Solanaアドレスが正しくありません。");
  return normalized;
}

export function normalizeSolanaSignature(value: unknown) {
  if (typeof value !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(value)) {
    throw new SolanaWalletInputError("トランザクション署名が正しくありません。");
  }
  return value;
}

/** Clusters the wallet view may offer: enabled in the registry, or mainnet once its RPC is configured. */
export function listActiveSolanaNetworks(env: Env = process.env): Array<{ chainRef: string; name: string; testnet: boolean; cluster: string }> {
  return SOLANA_CHAIN_REGISTRY
    .filter((entry) => isSolanaChainActive(entry.chainRef, env))
    .map((entry) => ({ chainRef: entry.chainRef, name: entry.name, testnet: entry.testnet, cluster: entry.cluster }));
}

function resolveEntry(chainRef: unknown, deps: SolanaWalletDeps): { entry: SolanaChainEntry; url: string } {
  const ref = typeof chainRef === "string" && chainRef ? chainRef : SOLANA_DEVNET_REF;
  const entry = getSolanaChain(ref);
  if (!entry) throw new SolanaWalletInputError("このSolanaネットワークには対応していません。");
  const resolved = resolveSolanaWalletViewRpc(ref, deps.env, deps.production);
  if (!resolved.ok) throw new SolanaWalletNetworkError("このネットワークのSolana RPCが設定されていません。");
  return { entry, url: resolved.url };
}

async function rpc<T>(deps: SolanaWalletDeps, url: string, method: string, params: unknown[]): Promise<T> {
  let response: Response;
  try {
    response = await deps.fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
    });
  } catch {
    throw new SolanaWalletNetworkError("Solanaネットワークへ接続できません。");
  }
  if (!response.ok) throw new SolanaWalletNetworkError("Solana RPCが応答しませんでした。");
  const body = await response.json().catch(() => null) as { result?: T; error?: unknown } | null;
  if (!body || body.error || body.result === undefined) throw new SolanaWalletNetworkError("Solana RPCの確認に失敗しました。");
  return body.result;
}

export type SolanaTokenBalance = { mint: string; amount: string; decimals: number; program: "spl-token" | "spl-token-2022"; accounts: number };

type TokenAccountsResult = {
  value: Array<{
    account?: {
      owner?: unknown;
      data?: { parsed?: { info?: { mint?: unknown; owner?: unknown; state?: unknown; tokenAmount?: { amount?: unknown; decimals?: unknown } } } };
    };
  }>;
};

function foldTokenAccounts(owner: string, program: "spl-token" | "spl-token-2022", programId: string, result: TokenAccountsResult, into: Map<string, SolanaTokenBalance>) {
  if (!result || !Array.isArray(result.value)) throw new SolanaWalletNetworkError("Solana RPCの応答が正しくありません。");
  for (const item of result.value.slice(0, MAX_TOKEN_ACCOUNTS)) {
    const info = item.account?.data?.parsed?.info;
    if (item.account?.owner !== programId || !info) continue;
    if (info.owner !== owner || info.state !== "initialized" || typeof info.mint !== "string") continue;
    const raw = info.tokenAmount?.amount;
    const decimals = info.tokenAmount?.decimals;
    if (typeof raw !== "string" || !/^[0-9]{1,20}$/.test(raw) || typeof decimals !== "number" || !Number.isInteger(decimals)) continue;
    const key = `${program}:${info.mint}`;
    const existing = into.get(key);
    if (existing) {
      existing.amount = (BigInt(existing.amount) + BigInt(raw)).toString();
      existing.accounts += 1;
    } else {
      into.set(key, { mint: info.mint, amount: raw, decimals, program, accounts: 1 });
    }
  }
}

export type SolanaOverview = {
  address: string;
  chainRef: string;
  network: string;
  testnet: boolean;
  commitment: "finalized";
  lamports: number;
  tokens: SolanaTokenBalance[];
};

/** Finalized SOL balance and SPL / Token-2022 balances. Nothing here is a client-supplied number. */
export async function readSolanaOverview(address: unknown, chainRef?: unknown, deps: SolanaWalletDeps = defaultDeps()): Promise<SolanaOverview> {
  const normalized = normalizeSolanaAddress(address);
  const { entry, url } = resolveEntry(chainRef, deps);
  const commitment = { commitment: "finalized" };
  const [balance, legacy, token2022] = await Promise.all([
    rpc<{ value: number }>(deps, url, "getBalance", [normalized, commitment]),
    rpc<TokenAccountsResult>(deps, url, "getTokenAccountsByOwner", [normalized, { programId: SPL_TOKEN_PROGRAM_ID }, { ...commitment, encoding: "jsonParsed" }]),
    rpc<TokenAccountsResult>(deps, url, "getTokenAccountsByOwner", [normalized, { programId: SPL_TOKEN_2022_PROGRAM_ID }, { ...commitment, encoding: "jsonParsed" }]),
  ]);
  if (typeof balance.value !== "number" || !Number.isSafeInteger(balance.value) || balance.value < 0) {
    throw new SolanaWalletNetworkError("Solana RPCの応答が正しくありません。");
  }
  const tokens = new Map<string, SolanaTokenBalance>();
  foldTokenAccounts(normalized, "spl-token", SPL_TOKEN_PROGRAM_ID, legacy, tokens);
  foldTokenAccounts(normalized, "spl-token-2022", SPL_TOKEN_2022_PROGRAM_ID, token2022, tokens);
  return {
    address: normalized,
    chainRef: entry.chainRef,
    network: entry.name,
    testnet: entry.testnet,
    commitment: "finalized",
    lamports: balance.value,
    tokens: [...tokens.values()].filter((token) => token.amount !== "0"),
  };
}

export type SolanaHistoryItem = { signature: string; slot: number; blockTime: number | null; failed: boolean };

/** Last 20 finalized signatures for the address. */
export async function readSolanaHistory(address: unknown, chainRef?: unknown, deps: SolanaWalletDeps = defaultDeps()): Promise<SolanaHistoryItem[]> {
  const normalized = normalizeSolanaAddress(address);
  const { url } = resolveEntry(chainRef, deps);
  const result = await rpc<Array<{ signature?: unknown; slot?: unknown; blockTime?: unknown; err?: unknown }>>(
    deps, url, "getSignaturesForAddress", [normalized, { limit: 20, commitment: "finalized" }]);
  if (!Array.isArray(result)) throw new SolanaWalletNetworkError("Solana RPCの応答が正しくありません。");
  const items: SolanaHistoryItem[] = [];
  for (const row of result) {
    if (typeof row.signature !== "string" || typeof row.slot !== "number") continue;
    items.push({ signature: row.signature, slot: row.slot, blockTime: typeof row.blockTime === "number" ? row.blockTime : null, failed: row.err !== null && row.err !== undefined });
  }
  return items;
}

export type SolanaSendContext = {
  chainRef: string;
  blockhash: string;
  lastValidBlockHeight: number;
  /** Rent-exempt minimum for a new token account (the sender pays it when the recipient has none). */
  tokenAccountRentLamports: number;
};

/** What the browser needs to build a transaction. The blockhash is `confirmed`: a finalized one is already ~13s old. */
export async function readSolanaSendContext(chainRef?: unknown, deps: SolanaWalletDeps = defaultDeps()): Promise<SolanaSendContext> {
  const { entry, url } = resolveEntry(chainRef, deps);
  const [latest, rent] = await Promise.all([
    rpc<{ value: { blockhash: string; lastValidBlockHeight: number } }>(deps, url, "getLatestBlockhash", [{ commitment: "confirmed" }]),
    rpc<number>(deps, url, "getMinimumBalanceForRentExemption", [165]),
  ]);
  if (typeof latest.value?.blockhash !== "string" || !Number.isSafeInteger(latest.value.lastValidBlockHeight) || !Number.isSafeInteger(rent)) {
    throw new SolanaWalletNetworkError("Solana RPCの応答が正しくありません。");
  }
  return { chainRef: entry.chainRef, blockhash: latest.value.blockhash, lastValidBlockHeight: latest.value.lastValidBlockHeight, tokenAccountRentLamports: rent };
}

const REFUSED_EXTENSIONS = new Set(["transferHook", "permanentDelegate", "nonTransferable", "confidentialTransferMint", "confidentialTransferFeeConfig"]);

export type SolanaMintInfo = {
  mint: string;
  program: "spl-token" | "spl-token-2022";
  decimals: number;
  extensions: string[];
  /** Extensions that make Hub refuse the send in phase 1. */
  refused: string[];
  transferFee: { basisPoints: number; maximumFee: string } | null;
};

/** Mint facts the send flow needs: decimals, owning program and Token-2022 extensions. */
export async function readSolanaMintInfo(mint: unknown, chainRef?: unknown, deps: SolanaWalletDeps = defaultDeps()): Promise<SolanaMintInfo> {
  const normalized = normalizeSolanaAddress(mint);
  const { url } = resolveEntry(chainRef, deps);
  const result = await rpc<{ value: null | { owner?: unknown; data?: { parsed?: { type?: unknown; info?: { decimals?: unknown; extensions?: unknown } } } } }>(
    deps, url, "getAccountInfo", [normalized, { commitment: "finalized", encoding: "jsonParsed" }]);
  const account = result?.value;
  const parsed = account?.data?.parsed;
  if (!account || parsed?.type !== "mint" || typeof parsed.info?.decimals !== "number") {
    throw new SolanaWalletInputError("このミントを読み取れません。");
  }
  const program = account.owner === SPL_TOKEN_PROGRAM_ID ? "spl-token" : account.owner === SPL_TOKEN_2022_PROGRAM_ID ? "spl-token-2022" : null;
  if (!program) throw new SolanaWalletInputError("このミントはSPLトークンではありません。");
  const list = Array.isArray(parsed.info.extensions) ? parsed.info.extensions as Array<{ extension?: unknown; state?: Record<string, unknown> }> : [];
  const extensions = list.map((item) => item.extension).filter((name): name is string => typeof name === "string");
  let transferFee: SolanaMintInfo["transferFee"] = null;
  const feeConfig = list.find((item) => item.extension === "transferFeeConfig")?.state as
    { newerTransferFee?: { transferFeeBasisPoints?: unknown; maximumFee?: unknown } } | undefined;
  const fee = feeConfig?.newerTransferFee;
  if (fee && typeof fee.transferFeeBasisPoints === "number") {
    transferFee = { basisPoints: fee.transferFeeBasisPoints, maximumFee: String(fee.maximumFee ?? "0") };
  }
  return {
    mint: normalized,
    program,
    decimals: parsed.info.decimals,
    extensions,
    refused: extensions.filter((name) => REFUSED_EXTENSIONS.has(name)),
    transferFee,
  };
}

/** Whether an account exists (the recipient's associated token account), and the program that owns it. */
export async function readSolanaAccountExists(address: unknown, chainRef?: unknown, deps: SolanaWalletDeps = defaultDeps()): Promise<{ exists: boolean; owner: string | null }> {
  const normalized = normalizeSolanaAddress(address);
  const { url } = resolveEntry(chainRef, deps);
  const result = await rpc<{ value: null | { owner?: unknown } }>(deps, url, "getAccountInfo", [normalized, { commitment: "confirmed", encoding: "base64", dataSlice: { offset: 0, length: 0 } }]);
  const value = result?.value;
  return { exists: value !== null && value !== undefined, owner: value && typeof value.owner === "string" ? value.owner : null };
}

/** `confirmed` is for the sender's own pending-send display only; gates, tips and history use finalized. */
export async function confirmSolanaTransaction(signature: unknown, chainRef?: unknown, deps: SolanaWalletDeps = defaultDeps()) {
  const normalized = normalizeSolanaSignature(signature);
  const { url } = resolveEntry(chainRef, deps);
  const result = await rpc<{ value: Array<{ confirmationStatus?: string; err: unknown } | null> }>(
    deps, url, "getSignatureStatuses", [[normalized], { searchTransactionHistory: true }]);
  const status = result.value?.[0];
  if (!status) return { signature: normalized, status: "pending" as const };
  if (status.err) return { signature: normalized, status: "failed" as const };
  return { signature: normalized, status: status.confirmationStatus === "finalized" ? "finalized" as const : "confirmed" as const };
}

/** Backward-compatible names used by earlier callers (devnet only). */
export const readSolanaDevnetOverview = (address: unknown) => readSolanaOverview(address, SOLANA_DEVNET_REF);
export const confirmSolanaDevnetTransaction = (signature: unknown) => confirmSolanaTransaction(signature, SOLANA_DEVNET_REF);
