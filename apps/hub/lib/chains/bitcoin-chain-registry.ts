/**
 * Bitcoin network registry (design section 1.1). Same rules as the EVM registry:
 *  - Gates and tips read only from the configured indexer (`indexerEnv`, an https Esplora-compatible base URL).
 *    Defaults are used only for the wallet balance view outside production, never for gates, tips or links.
 *  - A network that is `enabled: false` is never offered, accepted or read.
 *  - No swap, bridge, quote or route features: this file lists networks, nothing more.
 * Testnet4 and Signet share the `tb` prefix, so an address alone does not identify the network: the
 * challenge row fixes the chainRef and the address only has to be valid for it.
 */
import type { ChainRef } from "./chain-family";

export type BitcoinNetworkEntry = {
  chainRef: Extract<ChainRef, `bip122:${string}`>;
  name: string;
  hrp: "bc" | "tb";
  p2pkhVersion: number;
  p2shVersion: number;
  nativeSymbol: "BTC";
  nativeDecimals: 8;
  explorerUrl: string;
  testnet: boolean;
  /** Server env var holding the https Esplora base URL. */
  indexerEnv: string;
  legacyIndexerEnv?: string;
  defaultIndexerUrls?: string[];
  /** Confirmations a UTXO or tip needs before it counts. */
  minConfirmations: number;
  enabled: boolean;
};

export const BITCOIN_NETWORKS: readonly BitcoinNetworkEntry[] = [
  {
    chainRef: "bip122:000000000019d6689c085ae165831e93",
    name: "Bitcoin",
    hrp: "bc",
    p2pkhVersion: 0x00,
    p2shVersion: 0x05,
    nativeSymbol: "BTC",
    nativeDecimals: 8,
    explorerUrl: "https://mempool.space",
    testnet: false,
    indexerEnv: "HUB_RPC_URL_BITCOIN_MAINNET",
    minConfirmations: 3,
    enabled: true,
  },
  {
    chainRef: "bip122:00000000da84f2bafbbc53dee25a72ae",
    name: "Bitcoin Testnet4",
    hrp: "tb",
    p2pkhVersion: 0x6f,
    p2shVersion: 0xc4,
    nativeSymbol: "BTC",
    nativeDecimals: 8,
    explorerUrl: "https://mempool.space/testnet4",
    testnet: true,
    indexerEnv: "HUB_RPC_URL_BITCOIN_TESTNET4",
    legacyIndexerEnv: "HUB_BITCOIN_TESTNET_API_URL",
    defaultIndexerUrls: ["https://mempool.space/testnet4/api"],
    minConfirmations: 1,
    enabled: true,
  },
  {
    chainRef: "bip122:00000008819873e925422c1ff0f99f7c",
    name: "Bitcoin Signet",
    hrp: "tb",
    p2pkhVersion: 0x6f,
    p2shVersion: 0xc4,
    nativeSymbol: "BTC",
    nativeDecimals: 8,
    explorerUrl: "https://mempool.space/signet",
    testnet: true,
    indexerEnv: "HUB_RPC_URL_BITCOIN_SIGNET",
    defaultIndexerUrls: ["https://mempool.space/signet/api"],
    minConfirmations: 1,
    enabled: true,
  },
];

export function getBitcoinNetwork(chainRef: unknown): BitcoinNetworkEntry | null {
  if (typeof chainRef !== "string") return null;
  const entry = BITCOIN_NETWORKS.find((network) => network.chainRef === chainRef);
  return entry && entry.enabled ? entry : null;
}

function httpsBase(value: string | undefined): string | null {
  const text = value?.trim();
  if (!text) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== "https:") return null;
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

type Env = Record<string, string | undefined>;

/** The configured indexer for gates and tips. Defaults are never used here; missing or non-https = null (fail closed). */
export function resolveBitcoinIndexer(entry: BitcoinNetworkEntry, env: Env = process.env): string | null {
  return httpsBase(env[entry.indexerEnv]) ?? (entry.legacyIndexerEnv ? httpsBase(env[entry.legacyIndexerEnv]) : null);
}

/** Wallet view only: configured indexer, else a public default outside production. */
export function resolveBitcoinWalletIndexer(entry: BitcoinNetworkEntry, env: Env = process.env): string | null {
  const configured = resolveBitcoinIndexer(entry, env);
  if (configured) return configured;
  if (env.NODE_ENV === "production") return null;
  return entry.defaultIndexerUrls?.[0] ?? null;
}

/** A network is offered for linking and sending only when enabled and its indexer is configured (mainnet has no default). */
export function bitcoinNetworkAvailable(entry: BitcoinNetworkEntry | null, env: Env = process.env): entry is BitcoinNetworkEntry {
  if (!entry || !entry.enabled) return false;
  return resolveBitcoinWalletIndexer(entry, env) !== null;
}
