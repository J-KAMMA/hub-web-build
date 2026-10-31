/**
 * Solana cluster registry (docs/hub-multichain/SOLANA-BITCOIN-DESIGN.md section 1.1). Pure module.
 *
 * Rules (AGENTS.md):
 *  - Chain references are CAIP-2: `solana:<first 32 chars of the genesis hash>`.
 *  - Gates, links and tips read only from the RPC configured in `rpcEnv` (https). `defaultRpcUrls` are used only
 *    by the wallet balance view outside production, never for gates, tips or link checks.
 *  - Mainnet stays disabled until its RPC is configured (`enableWhenRpcConfigured`): without the env var it is
 *    never offered, accepted or read. Fail closed.
 *  - No swap, bridge, quote or route features: this file lists clusters, nothing more.
 */
import type { ChainRef } from "./chain-family";

export type SolanaChainRef = Extract<ChainRef, `solana:${string}`>;

export type SolanaChainEntry = {
  chainRef: SolanaChainRef;
  name: string;
  /** Short cluster word used in the Sign-In With Solana `Chain ID:` line. */
  cluster: "mainnet" | "devnet";
  nativeSymbol: "SOL";
  nativeDecimals: 9;
  explorerUrl: string;
  /** Explorer query suffix for non-mainnet clusters. */
  explorerClusterQuery: string;
  testnet: boolean;
  /** Server env var holding the https RPC URL. */
  rpcEnv: string;
  /** Older env var names still accepted. */
  legacyRpcEnv?: string[];
  /** Server env var for a DAS-capable RPC (phase 2 NFT reads). */
  dasRpcEnv?: string;
  /** Public endpoints for the wallet balance view outside production. Absent = RPC must be configured. */
  defaultRpcUrls?: string[];
  enabled: boolean;
  /** Turns on automatically once `rpcEnv` holds a valid https URL. */
  enableWhenRpcConfigured?: boolean;
};

export const SOLANA_MAINNET_REF: SolanaChainRef = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
export const SOLANA_DEVNET_REF: SolanaChainRef = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";

export const SOLANA_CHAIN_REGISTRY: readonly SolanaChainEntry[] = Object.freeze([
  {
    chainRef: SOLANA_MAINNET_REF,
    name: "Solana",
    cluster: "mainnet",
    nativeSymbol: "SOL",
    nativeDecimals: 9,
    explorerUrl: "https://explorer.solana.com",
    explorerClusterQuery: "",
    testnet: false,
    rpcEnv: "HUB_RPC_URL_SOLANA_MAINNET",
    dasRpcEnv: "HUB_DAS_URL_SOLANA_MAINNET",
    enabled: false,
    enableWhenRpcConfigured: true,
  },
  {
    chainRef: SOLANA_DEVNET_REF,
    name: "Solana Devnet",
    cluster: "devnet",
    nativeSymbol: "SOL",
    nativeDecimals: 9,
    explorerUrl: "https://explorer.solana.com",
    explorerClusterQuery: "?cluster=devnet",
    testnet: true,
    rpcEnv: "HUB_RPC_URL_SOLANA_DEVNET",
    legacyRpcEnv: ["HUB_SOLANA_DEVNET_RPC_URL"],
    defaultRpcUrls: ["https://api.devnet.solana.com"],
    enabled: true,
  },
] as const satisfies readonly SolanaChainEntry[]);

type Env = Readonly<Record<string, string | undefined>>;

export function getSolanaChain(ref: string): SolanaChainEntry | null {
  return SOLANA_CHAIN_REGISTRY.find((entry) => entry.chainRef === ref) ?? null;
}

export function solanaRpcEnvNames(entry: SolanaChainEntry): string[] {
  return [entry.rpcEnv, ...(entry.legacyRpcEnv ?? [])];
}

/** The configured https URL, or null (missing, malformed or not https). Defaults are never returned here. */
export function configuredSolanaRpcUrl(entry: SolanaChainEntry, env: Env): string | null {
  for (const name of solanaRpcEnvNames(entry)) {
    const value = env[name]?.trim();
    if (!value) continue;
    try {
      const parsed = new URL(value);
      if (parsed.protocol === "https:" && !parsed.username && !parsed.password) return parsed.toString();
    } catch {
      /* fall through: a malformed value never counts as configured */
    }
    return null;
  }
  return null;
}

/** True when the cluster may be offered, accepted or read. */
export function isSolanaChainActive(ref: string, env: Env): boolean {
  const entry = getSolanaChain(ref);
  if (!entry) return false;
  if (entry.enabled) return true;
  return entry.enableWhenRpcConfigured === true && configuredSolanaRpcUrl(entry, env) !== null;
}

export type SolanaRpcResolution =
  | { ok: true; url: string; entry: SolanaChainEntry }
  | { ok: false; reason: "unsupported_chain" | "rpc_not_configured" };

/** RPC for gates, tips and link checks: the configured URL only, never a default. */
export function resolveSolanaRpc(ref: string, env: Env): SolanaRpcResolution {
  const entry = getSolanaChain(ref);
  if (!entry || (!entry.enabled && entry.enableWhenRpcConfigured !== true)) return { ok: false, reason: "unsupported_chain" };
  const url = configuredSolanaRpcUrl(entry, env);
  if (!url) return { ok: false, reason: "rpc_not_configured" };
  return { ok: true, url, entry };
}

/** RPC for the wallet balance view: the configured URL, or a default outside production. */
export function resolveSolanaWalletViewRpc(ref: string, env: Env, production: boolean): SolanaRpcResolution {
  const resolved = resolveSolanaRpc(ref, env);
  if (resolved.ok || resolved.reason === "unsupported_chain") return resolved;
  const entry = getSolanaChain(ref);
  const fallback = entry && !production ? entry.defaultRpcUrls?.[0] : undefined;
  return entry && fallback ? { ok: true, url: fallback, entry } : resolved;
}

export function solanaClusterWord(ref: string): "mainnet" | "devnet" | null {
  return getSolanaChain(ref)?.cluster ?? null;
}
