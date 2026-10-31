/**
 * EVM chain registry: the single source of truth for chains the Hub wallet
 * overview, wallet links and token gates may read from. Pure module (no
 * server-only imports) so the UI, the gate validators and the server share it.
 *
 * Adding a chain = one entry here + its RPC env var. Nothing else.
 *
 * Rules (AGENTS.md):
 *  - Server-side reads only. A chain without a configured RPC fails closed
 *    (gates: "rpc_not_configured"; wallet: shown as unavailable).
 *  - RPC env var: `rpcEnv` (legacy name kept for the original chains), and for
 *    every chain `HUB_RPC_URL_<chainId>` is accepted as well (see rpcEnvNames).
 *  - `defaultRpcUrls` are public endpoints used only by the wallet overview
 *    and only for legacy chains in any environment; other chains use them in
 *    non-production only. Gates never use defaults.
 *  - No swap / bridge / exchange features: this file lists chains, nothing more.
 *  - `enabled: false` marks an entry whose chain ID or data is not confirmed.
 *    Disabled entries are never offered, accepted or read.
 */

export type EvmChainEntry = {
  chainId: number;
  /** English display name (also used as the viem chain name). */
  name: string;
  /** Lowercase aliases that token rankings may use as their `network` string. */
  aliases: string[];
  nativeName: string;
  nativeSymbol: string;
  nativeDecimals: number;
  explorerUrl: string;
  testnet: boolean;
  /** Server env var holding the HTTPS RPC URL. */
  rpcEnv: string;
  /** Public RPCs for local/dev convenience. Absent = RPC must be configured. */
  defaultRpcUrls?: string[];
  /**
   * Public RPC endpoints that may be handed to the user's own wallet through
   * wallet_addEthereumChain. Never a server secret (HUB_RPC_URL_*). Empty =
   * not sure of a public endpoint: adding the chain is not offered.
   */
  publicRpcUrls: string[];
  /** The chain was supported before the registry; its defaults stay on in production. */
  legacyDefaultRpc?: boolean;
  enabled: boolean;
  /** Why the entry is disabled, or a data caveat. */
  note?: string;
};

type Seed = Omit<EvmChainEntry, "rpcEnv" | "enabled" | "aliases" | "nativeName" | "publicRpcUrls"> & {
  aliases?: string[];
  nativeName?: string;
  rpcEnv?: string;
  enabled?: boolean;
  publicRpcUrls?: string[];
};

// Well-known public endpoints for enabled mainnets, used only for the user's
// wallet (wallet_addEthereumChain). Chains not listed here: not sure, empty.
const PUBLIC_RPC_URLS: Readonly<Record<number, readonly string[]>> = {
  1: ["https://ethereum-rpc.publicnode.com"],
  137: ["https://polygon-rpc.com"],
  8217: ["https://public-en.node.kaia.io"],
  43114: ["https://api.avax.network/ext/bc/C/rpc"],
  42161: ["https://arb1.arbitrum.io/rpc"],
  10: ["https://mainnet.optimism.io"],
  8453: ["https://mainnet.base.org"],
  324: ["https://mainnet.era.zksync.io"],
  59144: ["https://rpc.linea.build"],
  534352: ["https://rpc.scroll.io"],
  1101: ["https://zkevm-rpc.com"],
  5000: ["https://rpc.mantle.xyz"],
  81457: ["https://rpc.blast.io"],
  56: ["https://bsc-dataseed.binance.org"],
  100: ["https://rpc.gnosischain.com"],
  42220: ["https://forno.celo.org"],
  146: ["https://rpc.soniclabs.com"],
  25: ["https://evm.cronos.org"],
  1284: ["https://rpc.api.moonbeam.network"],
  592: ["https://evm.astar.network"],
  248: ["https://rpc.mainnet.oasys.games"],
};

function chain(seed: Seed): EvmChainEntry {
  return {
    aliases: [],
    nativeName: seed.nativeSymbol,
    rpcEnv: `HUB_RPC_URL_${seed.chainId}`,
    enabled: true,
    publicRpcUrls: [...(PUBLIC_RPC_URLS[seed.chainId] ?? [])],
    ...seed,
  };
}

const ETH = { nativeName: "Ether", nativeSymbol: "ETH", nativeDecimals: 18 } as const;

export const EVM_CHAIN_REGISTRY: readonly EvmChainEntry[] = Object.freeze([
  // --- Ethereum, Polygon, Kaia, Avalanche -------------------------------
  chain({ chainId: 1, name: "Ethereum", aliases: ["ethereum", "eth", "mainnet"], ...ETH, explorerUrl: "https://etherscan.io", testnet: false, rpcEnv: "HUB_RPC_ETHEREUM_URL", defaultRpcUrls: ["https://ethereum.reth.rs/rpc"], legacyDefaultRpc: true }),
  chain({ chainId: 11155111, name: "Sepolia", aliases: ["sepolia", "ethereum sepolia"], ...ETH, explorerUrl: "https://sepolia.etherscan.io", testnet: true }),
  chain({ chainId: 137, name: "Polygon", aliases: ["polygon", "matic", "polygon pos"], nativeName: "POL", nativeSymbol: "POL", nativeDecimals: 18, explorerUrl: "https://polygonscan.com", testnet: false, rpcEnv: "HUB_RPC_POLYGON_URL", defaultRpcUrls: ["https://polygon.drpc.org"], legacyDefaultRpc: true }),
  chain({ chainId: 80002, name: "Polygon Amoy", aliases: ["polygon amoy", "amoy"], nativeName: "POL", nativeSymbol: "POL", nativeDecimals: 18, explorerUrl: "https://amoy.polygonscan.com", testnet: true, rpcEnv: "HUB_RPC_AMOY_URL", defaultRpcUrls: ["https://polygon-amoy-bor-rpc.publicnode.com", "https://polygon-amoy.drpc.org"], legacyDefaultRpc: true }),
  chain({ chainId: 8217, name: "Kaia", aliases: ["kaia", "kaia mainnet", "klaytn"], nativeName: "Kaia", nativeSymbol: "KAIA", nativeDecimals: 18, explorerUrl: "https://kaiascan.io", testnet: false, defaultRpcUrls: ["https://public-en.node.kaia.io"] }),
  chain({ chainId: 1001, name: "Kaia Kairos", aliases: ["kaia kairos", "kairos"], nativeName: "Kaia", nativeSymbol: "KAIA", nativeDecimals: 18, explorerUrl: "https://kairos.kaiascan.io", testnet: true, defaultRpcUrls: ["https://public-en-kairos.node.kaia.io"] }),
  chain({ chainId: 43114, name: "Avalanche C-Chain", aliases: ["avalanche", "avalanche c-chain", "avax"], nativeName: "Avalanche", nativeSymbol: "AVAX", nativeDecimals: 18, explorerUrl: "https://snowscan.xyz", testnet: false, rpcEnv: "HUB_RPC_AVALANCHE_URL", defaultRpcUrls: ["https://api.avax.network/ext/bc/C/rpc"], legacyDefaultRpc: true }),
  chain({ chainId: 43113, name: "Avalanche Fuji", aliases: ["avalanche fuji", "fuji"], nativeName: "Avalanche", nativeSymbol: "AVAX", nativeDecimals: 18, explorerUrl: "https://testnet.snowtrace.io", testnet: true, rpcEnv: "HUB_RPC_FUJI_URL", defaultRpcUrls: ["https://api.avax-test.network/ext/bc/C/rpc"], legacyDefaultRpc: true }),
  // --- Optimistic / rollup L2s ------------------------------------------
  chain({ chainId: 42161, name: "Arbitrum One", aliases: ["arbitrum", "arbitrum one"], ...ETH, explorerUrl: "https://arbiscan.io", testnet: false, rpcEnv: "HUB_RPC_ARBITRUM_URL", defaultRpcUrls: ["https://arb1.arbitrum.io/rpc"], legacyDefaultRpc: true }),
  chain({ chainId: 421614, name: "Arbitrum Sepolia", aliases: ["arbitrum sepolia"], ...ETH, explorerUrl: "https://sepolia.arbiscan.io", testnet: true }),
  chain({ chainId: 10, name: "OP Mainnet", aliases: ["optimism", "op mainnet"], ...ETH, explorerUrl: "https://optimistic.etherscan.io", testnet: false, rpcEnv: "HUB_RPC_OPTIMISM_URL", defaultRpcUrls: ["https://mainnet.optimism.io"], legacyDefaultRpc: true }),
  chain({ chainId: 11155420, name: "OP Sepolia", aliases: ["op sepolia", "optimism sepolia"], ...ETH, explorerUrl: "https://sepolia-optimism.etherscan.io", testnet: true }),
  chain({ chainId: 8453, name: "Base", aliases: ["base"], ...ETH, explorerUrl: "https://basescan.org", testnet: false, rpcEnv: "HUB_RPC_BASE_URL", defaultRpcUrls: ["https://mainnet.base.org"], legacyDefaultRpc: true }),
  chain({ chainId: 84532, name: "Base Sepolia", aliases: ["base sepolia"], ...ETH, explorerUrl: "https://sepolia.basescan.org", testnet: true }),
  chain({ chainId: 324, name: "zkSync Era", aliases: ["zksync", "zksync era"], ...ETH, explorerUrl: "https://explorer.zksync.io", testnet: false }),
  chain({ chainId: 300, name: "zkSync Sepolia", aliases: ["zksync sepolia"], ...ETH, explorerUrl: "https://sepolia.explorer.zksync.io", testnet: true }),
  chain({ chainId: 59144, name: "Linea", aliases: ["linea"], ...ETH, explorerUrl: "https://lineascan.build", testnet: false }),
  chain({ chainId: 59141, name: "Linea Sepolia", aliases: ["linea sepolia"], ...ETH, explorerUrl: "https://sepolia.lineascan.build", testnet: true }),
  chain({ chainId: 534352, name: "Scroll", aliases: ["scroll"], ...ETH, explorerUrl: "https://scrollscan.com", testnet: false }),
  chain({ chainId: 534351, name: "Scroll Sepolia", aliases: ["scroll sepolia"], ...ETH, explorerUrl: "https://sepolia.scrollscan.com", testnet: true }),
  chain({ chainId: 1101, name: "Polygon zkEVM", aliases: ["polygon zkevm"], ...ETH, explorerUrl: "https://zkevm.polygonscan.com", testnet: false }),
  chain({ chainId: 2442, name: "Polygon zkEVM Cardona", aliases: ["polygon zkevm cardona", "cardona"], ...ETH, explorerUrl: "https://cardona-zkevm.polygonscan.com", testnet: true }),
  chain({ chainId: 5000, name: "Mantle", aliases: ["mantle"], nativeName: "Mantle", nativeSymbol: "MNT", nativeDecimals: 18, explorerUrl: "https://explorer.mantle.xyz", testnet: false }),
  chain({ chainId: 5003, name: "Mantle Sepolia", aliases: ["mantle sepolia"], nativeName: "Mantle", nativeSymbol: "MNT", nativeDecimals: 18, explorerUrl: "https://explorer.sepolia.mantle.xyz", testnet: true }),
  chain({ chainId: 81457, name: "Blast", aliases: ["blast"], ...ETH, explorerUrl: "https://blastscan.io", testnet: false }),
  chain({ chainId: 168587773, name: "Blast Sepolia", aliases: ["blast sepolia"], ...ETH, explorerUrl: "https://sepolia.blastscan.io", testnet: true }),
  // --- Other L1s ---------------------------------------------------------
  chain({ chainId: 56, name: "BNB Smart Chain", aliases: ["bnb", "bsc", "bnb smart chain"], nativeName: "BNB", nativeSymbol: "BNB", nativeDecimals: 18, explorerUrl: "https://bscscan.com", testnet: false }),
  chain({ chainId: 97, name: "BNB Smart Chain Testnet", aliases: ["bsc testnet", "bnb testnet"], nativeName: "BNB", nativeSymbol: "BNB", nativeDecimals: 18, explorerUrl: "https://testnet.bscscan.com", testnet: true }),
  chain({ chainId: 100, name: "Gnosis", aliases: ["gnosis", "gnosis chain", "xdai"], nativeName: "xDAI", nativeSymbol: "xDAI", nativeDecimals: 18, explorerUrl: "https://gnosisscan.io", testnet: false }),
  chain({ chainId: 10200, name: "Gnosis Chiado", aliases: ["chiado", "gnosis chiado"], nativeName: "xDAI", nativeSymbol: "xDAI", nativeDecimals: 18, explorerUrl: "https://gnosis-chiado.blockscout.com", testnet: true }),
  chain({ chainId: 42220, name: "Celo", aliases: ["celo"], nativeName: "Celo", nativeSymbol: "CELO", nativeDecimals: 18, explorerUrl: "https://celoscan.io", testnet: false }),
  chain({ chainId: 250, name: "Fantom Opera", aliases: ["fantom", "fantom opera", "ftm"], nativeName: "Fantom", nativeSymbol: "FTM", nativeDecimals: 18, explorerUrl: "https://ftmscan.com", testnet: false }),
  chain({ chainId: 146, name: "Sonic", aliases: ["sonic"], nativeName: "Sonic", nativeSymbol: "S", nativeDecimals: 18, explorerUrl: "https://sonicscan.org", testnet: false }),
  chain({ chainId: 25, name: "Cronos", aliases: ["cronos"], nativeName: "Cronos", nativeSymbol: "CRO", nativeDecimals: 18, explorerUrl: "https://cronoscan.com", testnet: false }),
  chain({ chainId: 338, name: "Cronos Testnet", aliases: ["cronos testnet"], nativeName: "Cronos", nativeSymbol: "CRO", nativeDecimals: 18, explorerUrl: "https://explorer.cronos.org/testnet", testnet: true }),
  chain({ chainId: 1284, name: "Moonbeam", aliases: ["moonbeam"], nativeName: "Glimmer", nativeSymbol: "GLMR", nativeDecimals: 18, explorerUrl: "https://moonbeam.moonscan.io", testnet: false }),
  chain({ chainId: 1287, name: "Moonbase Alpha", aliases: ["moonbase alpha", "moonbase"], nativeName: "Dev", nativeSymbol: "DEV", nativeDecimals: 18, explorerUrl: "https://moonbase.moonscan.io", testnet: true }),
  chain({ chainId: 592, name: "Astar", aliases: ["astar"], nativeName: "Astar", nativeSymbol: "ASTR", nativeDecimals: 18, explorerUrl: "https://astar.subscan.io", testnet: false }),
  chain({ chainId: 248, name: "Oasys", aliases: ["oasys"], nativeName: "Oasys", nativeSymbol: "OAS", nativeDecimals: 18, explorerUrl: "https://scan.oasys.games", testnet: false }),
  // --- Disabled: chain id or data not confirmed --------------------------
  chain({ chainId: 81, name: "Japan Open Chain", aliases: ["japan open chain", "joc"], nativeName: "Japan Open Chain Token", nativeSymbol: "JOC", nativeDecimals: 18, explorerUrl: "https://explorer.japanopenchain.org", testnet: false, enabled: false, note: "Chain ID 81 is also used by Astar's Shibuya testnet; the explorer and native symbol are unconfirmed. Enable only after verification." }),
  chain({ chainId: 9372, name: "Oasys Testnet", aliases: ["oasys testnet"], nativeName: "Oasys", nativeSymbol: "OAS", nativeDecimals: 18, explorerUrl: "https://scan.testnet.oasys.games", testnet: true, enabled: false, note: "Testnet chain ID and explorer unconfirmed." }),
  chain({ chainId: 14601, name: "Sonic Testnet", aliases: ["sonic testnet"], nativeName: "Sonic", nativeSymbol: "S", nativeDecimals: 18, explorerUrl: "https://testnet.sonicscan.org", testnet: true, enabled: false, note: "Testnet chain ID and explorer unconfirmed." }),
  chain({ chainId: 11142220, name: "Celo Sepolia", aliases: ["celo sepolia"], nativeName: "Celo", nativeSymbol: "CELO", nativeDecimals: 18, explorerUrl: "https://celo-sepolia.blockscout.com", testnet: true, enabled: false, note: "Testnet chain ID and explorer unconfirmed (Alfajores 44787 is deprecated)." }),
  chain({ chainId: 4002, name: "Fantom Testnet", aliases: ["fantom testnet"], nativeName: "Fantom", nativeSymbol: "FTM", nativeDecimals: 18, explorerUrl: "https://testnet.ftmscan.com", testnet: true, enabled: false, note: "Fantom testnet is being retired in favour of Sonic; not offered." }),
]);

const BY_ID: ReadonlyMap<number, EvmChainEntry> = new Map(EVM_CHAIN_REGISTRY.map((entry) => [entry.chainId, entry]));

/** Enabled entries only. */
export const ENABLED_EVM_CHAINS: readonly EvmChainEntry[] = Object.freeze(EVM_CHAIN_REGISTRY.filter((entry) => entry.enabled));

/** Enabled chain IDs, in registry order (Ethereum first). */
export const EVM_CHAIN_IDS: readonly number[] = Object.freeze(ENABLED_EVM_CHAINS.map((entry) => entry.chainId));

/** Returns the entry only when it exists and is enabled. */
export function getEvmChain(chainId: number): EvmChainEntry | null {
  const entry = BY_ID.get(chainId);
  return entry && entry.enabled ? entry : null;
}

export function isSupportedEvmChain(chainId: number): boolean {
  return getEvmChain(chainId) !== null;
}

/** Env var names that may carry the RPC URL, preferred first. */
export function rpcEnvNames(entry: EvmChainEntry): string[] {
  const generic = `HUB_RPC_URL_${entry.chainId}`;
  return entry.rpcEnv === generic ? [generic] : [entry.rpcEnv, generic];
}

/** Display label used by pickers. Testnets carry a suffix. */
export function evmChainLabel(chainId: number): string {
  const entry = getEvmChain(chainId);
  if (!entry) return `チェーン ${chainId}（未対応）`;
  return entry.testnet ? `${entry.name}（テスト）` : entry.name;
}
