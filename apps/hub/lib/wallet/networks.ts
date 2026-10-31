// Hubページ内ウォレットのネットワーク定義。
// apps/wallet-extension/src/networks.js からの移植。ピン留めされた
// ランタイムフィンガープリントと送信可否ポリシーは拡張機能と同一の値を共有する。

export const ENTRY_POINT_V08 = "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;

export type HubWalletToken = {
  address: `0x${string}`;
  symbol: string;
  name: string;
  decimals: number;
};

export type HubWalletNetwork = {
  chainId: `0x${string}`;
  name: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  rpcUrls: string[];
  explorerUrl: string;
  entryPoint: string | null;
  tokens?: HubWalletToken[];
  smartAccountFactory?: string | null;
  smartAccountImplementation?: string | null;
  gasTreasury?: string | null;
  paymaster?: string | null;
  smartAccountFactoryVersion?: string;
  entryPointRuntimeCodeHash?: string | null;
  smartAccountFactoryRuntimeCodeHash?: string | null;
  smartAccountImplementationRuntimeCodeHash?: string | null;
  gasTreasuryRuntimeCodeHash?: string | null;
  paymasterRuntimeCodeHash?: string | null;
  minimumPriorityFeePerGas?: string;
  testnet: boolean;
  // 本番チェーンでは明示的に立てる。ピン留めフィンガープリント＋本フラグ＋
  // transactionEnabled の3つが揃ったチェーンだけが送信を許可される。
  productionEnabled?: boolean;
  transactionEnabled: boolean;
  transactionDisabledReason?: string;
  readOnly?: boolean;
};

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

// JPYC（JPY Coin）現行コントラクト。全対応チェーンで同一アドレス
// （Ethereum 1 / Polygon 137 / Avalanche 43114 / Kaia 8217、テストネットも同一）。
const JPYC: HubWalletToken = { address: "0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29", symbol: "JPYC", name: "JPY Coin", decimals: 18 };

// USDC（Circle 公式の発行）。保存容量プランの支払い（PLAN.md §3.2）。Fuji は開発用の試験網。
const USDC_AVALANCHE: HubWalletToken = { address: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", symbol: "USDC", name: "USD Coin", decimals: 6 };
const USDC_FUJI: HubWalletToken = { address: "0x5425890298aed601595a70AB815c96711a31Bc65", symbol: "USDC", name: "USD Coin", decimals: 6 };

const builtin: Record<string, HubWalletNetwork> = {
  "0x3e9": {
    chainId: "0x3e9",
    name: "Kaia Kairos",
    nativeCurrency: { name: "Kaia", symbol: "KAIA", decimals: 18 },
    // 口座解決・検証は独立エンドポイントの合意を要求する（rpc-client.ts）。
    // 2本以上を必ず維持する。
    rpcUrls: ["https://public-en-kairos.node.kaia.io", "https://rpc.ankr.com/kaia_testnet"],
    explorerUrl: "https://kairos.kaiascan.io",
    entryPoint: ENTRY_POINT_V08,
    // 2026-08-22 の signature-agile v2 配備（apps/smart-wallet-contracts/
    // deployments/kairos/HubSignatureAgileAccountFactory.json）。
    smartAccountFactory: "0xE4E5dc64A1275C0568333c18d00C08D666554aba",
    smartAccountImplementation: "0x852DC7243b717db3327F852C6335B5FEF1E10Ad7",
    smartAccountFactoryVersion: "hub-signature-agile-v2",
    entryPointRuntimeCodeHash: "0xd9829d15f1ab5ce82f9fde27ab77fa35316fdfcf58f6ff5a27555403c9ffc5fa",
    smartAccountFactoryRuntimeCodeHash: "0x26449e9e3a20eacdce363fb61c7d50596000045b55a749d6f8ec1d4dee920b75",
    smartAccountImplementationRuntimeCodeHash: "0x4a089a63e027c3d03baeb1de2d10e11b2b0df6a66fccf704c949d5f077b5387b",
    minimumPriorityFeePerGas: "30000000000",
    testnet: true,
    transactionEnabled: true,
    tokens: [JPYC],
  },
  "0x13882": {
    chainId: "0x13882",
    name: "Polygon Amoy",
    nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 },
    rpcUrls: ["https://polygon-amoy-bor-rpc.publicnode.com", "https://polygon-amoy.drpc.org"],
    explorerUrl: "https://amoy.polygonscan.com",
    entryPoint: ENTRY_POINT_V08,
    gasTreasury: "0x794E77370E4cEcb8AeE6579eB180fcFab933cf56",
    paymaster: "0x2D225b9Ba0EBCfcc4fdCC7e87E2DB680Cacf57Bb",
    // 2026-07 の signature-agile v2 配備（config/chains/polygon-amoy.json、
    // ランタイムハッシュは独立RPCで実測照合済み）。
    smartAccountFactory: "0x639543620772B30C9f08381334708AE3545939b0",
    smartAccountImplementation: "0x53691E03C19bCA2083930fb48E024C9a8b1a2Cf7",
    smartAccountFactoryVersion: "hub-signature-agile-v2",
    entryPointRuntimeCodeHash: "0x4797be40523f13c9f2ea99bc335e8fb1dc937c3097433725da5d6376dfc2eff9",
    smartAccountFactoryRuntimeCodeHash: "0x94224baf9da1e897c0e284b8b77c2906f697d26c93eae654d3778e461cd8bcdc",
    smartAccountImplementationRuntimeCodeHash: "0x5f6e4ba82a33dbee431ef6cfddf49cef06587661b8c56dbd3a6f47ee86ad5a7f",
    gasTreasuryRuntimeCodeHash: "0xfa2a048230ef9d56c793e1fe09491262a8eeae27851919abd7c8edd8d7550fd2",
    paymasterRuntimeCodeHash: "0x1b72511e1d5026c8b089f8e95541739aa9d0d00bdfdfdf7752dd489f272c70b8",
    minimumPriorityFeePerGas: "30000000000",
    testnet: true,
    transactionEnabled: true,
    tokens: [JPYC],
  },
  "0x1": {
    chainId: "0x1",
    name: "Ethereum",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: ["https://ethereum-rpc.publicnode.com", "https://eth.drpc.org"],
    explorerUrl: "https://etherscan.io",
    entryPoint: ENTRY_POINT_V08,
    smartAccountFactoryVersion: "hub-signature-agile-v2",
    // EntryPoint v0.8 のランタイムハッシュは独立2RPCで実測一致
    // （config/chains/ethereum-mainnet.json と同一値）。
    entryPointRuntimeCodeHash: "0x44e632a24c6f2600cbd5b5b8b4c2d372359112c8b5774297f5fd0a9e64f11f86",
    minimumPriorityFeePerGas: "1000000000",
    testnet: false,
    productionEnabled: true,
    transactionEnabled: false,
    transactionDisabledReason: "Ethereum mainnet へのスマートアカウント配備の検証が完了するまで送信できません。",
    tokens: [JPYC],
  },
  "0x89": {
    chainId: "0x89",
    name: "Polygon",
    nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 },
    rpcUrls: ["https://polygon-bor-rpc.publicnode.com", "https://polygon.drpc.org"],
    explorerUrl: "https://polygonscan.com",
    entryPoint: ENTRY_POINT_V08,
    // signature-agile v2 実配備（deployments/polygon/HubSignatureAgileAccountFactory.deployment.json、
    // tx 0x01cd1186…）。4コントラクト全てを独立2RPCでランタイムハッシュ照合済み。
    smartAccountFactory: "0xff7EF1952ea4810248F8D5abDaE8F543f19d3dCf",
    smartAccountImplementation: "0x8E580dB098d84159c760DFBD79A04BB81aC7ad05",
    smartAccountFactoryVersion: "hub-signature-agile-v2",
    // EntryPoint v0.8 のランタイムハッシュは Polygon mainnet 上の2つの独立RPCで
    // 実測・一致確認済み（config/chains/polygon-mainnet.json と同一値）。
    entryPointRuntimeCodeHash: "0x9b02bddddb9413003580adbd2343b5c0338451e96810228aa8a6903d352169cb",
    smartAccountFactoryRuntimeCodeHash: "0x23e0b72a2ef712b0d3a8cce5a927af2d0f63d900fc781a593fa15eaaae247a06",
    smartAccountImplementationRuntimeCodeHash: "0xc0e6affd46caa386caeed78b9006bbdb8da0ebe96a06aff43ade9699659a9146",
    minimumPriorityFeePerGas: "30000000000",
    testnet: false,
    productionEnabled: true,
    transactionEnabled: true,
    tokens: [JPYC],
  },
  "0xa86a": {
    chainId: "0xa86a",
    name: "Avalanche",
    nativeCurrency: { name: "Avalanche", symbol: "AVAX", decimals: 18 },
    rpcUrls: ["https://api.avax.network/ext/bc/C/rpc", "https://avalanche.drpc.org"],
    explorerUrl: "https://snowscan.xyz",
    entryPoint: ENTRY_POINT_V08,
    // signature-agile v2 実配備（deployments/avalanche/HubSignatureAgileAccountFactory.deployment.json、
    // tx 0x9e8d968a…）。4コントラクト全てを独立2RPCでランタイムハッシュ照合済み。
    smartAccountFactory: "0xff7EF1952ea4810248F8D5abDaE8F543f19d3dCf",
    smartAccountImplementation: "0x8E580dB098d84159c760DFBD79A04BB81aC7ad05",
    smartAccountFactoryVersion: "hub-signature-agile-v2",
    entryPointRuntimeCodeHash: "0x0f5ede041dfb41e1efa08f44498305be0d26f50f0768927f51ff504908ad8c7d",
    smartAccountFactoryRuntimeCodeHash: "0x23e0b72a2ef712b0d3a8cce5a927af2d0f63d900fc781a593fa15eaaae247a06",
    smartAccountImplementationRuntimeCodeHash: "0x577c0b0b26cca7fca3b3c582cbc496615c3ef30dd226daf8b739ef841faabaf5",
    minimumPriorityFeePerGas: "2000000000",
    testnet: false,
    productionEnabled: true,
    transactionEnabled: true,
    tokens: [JPYC, USDC_AVALANCHE],
  },
  "0xa869": {
    chainId: "0xa869",
    name: "Avalanche Fuji",
    nativeCurrency: { name: "Avalanche", symbol: "AVAX", decimals: 18 },
    rpcUrls: ["https://api.avax-test.network/ext/bc/C/rpc", "https://avalanche-fuji-c-chain-rpc.publicnode.com"],
    explorerUrl: "https://testnet.snowtrace.io",
    entryPoint: null,
    testnet: true,
    // スマートアカウントは Fuji に未配備。配備と独立 2RPC のランタイムハッシュ照合が済むまで送信しない。
    transactionEnabled: false,
    transactionDisabledReason: "Fuji には Hub のスマートアカウントが未配備です。",
    tokens: [JPYC, USDC_FUJI],
  },
  "0x2019": {
    chainId: "0x2019",
    name: "Kaia",
    nativeCurrency: { name: "Kaia", symbol: "KAIA", decimals: 18 },
    rpcUrls: ["https://public-en.node.kaia.io", "https://rpc.ankr.com/kaia"],
    explorerUrl: "https://kaiascan.io",
    entryPoint: ENTRY_POINT_V08,
    // signature-agile v2 実配備（deployments/kaia/HubSignatureAgileAccountFactory.deployment.json、
    // tx 0xce37e553…）。4コントラクト全てを独立2RPCでランタイムハッシュ照合済み。
    smartAccountFactory: "0xff7EF1952ea4810248F8D5abDaE8F543f19d3dCf",
    smartAccountImplementation: "0x8E580dB098d84159c760DFBD79A04BB81aC7ad05",
    smartAccountFactoryVersion: "hub-signature-agile-v2",
    entryPointRuntimeCodeHash: "0x9927ada6b019e63ac267287131d08efc8618dca8291eac6d7f95dff0014579da",
    smartAccountFactoryRuntimeCodeHash: "0x23e0b72a2ef712b0d3a8cce5a927af2d0f63d900fc781a593fa15eaaae247a06",
    smartAccountImplementationRuntimeCodeHash: "0xc108c166e74bed5c2d7a988714616b721de2ce6aef27a5d8a0e7cde7a0817bde",
    minimumPriorityFeePerGas: "30000000000",
    testnet: false,
    productionEnabled: true,
    transactionEnabled: true,
    tokens: [JPYC],
  },
};

export const BUILTIN_NETWORKS = deepFreeze(builtin);
// 既定チェーンは、ファクトリが実配備されてアドレス解決できるチェーンでなければならない。
// Kaia mainnet（0x2019）は signature-agile v2 配備・2RPC照合済み。Kairosは引き続き選択可。
export const DEFAULT_CHAIN_ID = "0x2019";

export function hasPinnedRuntimeFingerprints(network: HubWalletNetwork | null | undefined): boolean {
  return [
    network?.entryPointRuntimeCodeHash,
    network?.smartAccountFactoryRuntimeCodeHash,
    network?.smartAccountImplementationRuntimeCodeHash,
  ].every((value) => typeof value === "string" && HASH.test(value) && !/^0x0{64}$/i.test(value));
}

export function canonicalSmartAccountFactory(network: HubWalletNetwork | null | undefined): string | null {
  const value = network?.smartAccountFactory;
  return typeof value === "string" && ADDRESS.test(value) ? value : null;
}

export function normalizeChainId(value: string | number | bigint): `0x${string}` {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint") throw new Error("invalid_chain_id");
  const text = String(value);
  if (!/^0x[0-9a-fA-F]+$/.test(text) && !/^[0-9]+$/.test(text)) throw new Error("invalid_chain_id");
  const parsed = BigInt(text);
  if (parsed <= 0n) throw new Error("invalid_chain_id");
  return `0x${parsed.toString(16)}`;
}

export function safeRpcUrl(value: string): string {
  if (typeof value !== "string" || value.length > 2048) throw new Error("unsafe_rpc_url");
  const url = new URL(value);
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.username || url.password || (url.protocol !== "https:" && !(loopback && url.protocol === "http:"))) throw new Error("unsafe_rpc_url");
  if (url.hash) throw new Error("unsafe_rpc_url");
  return url.toString();
}

export function walletNetwork(chainId: string | number | bigint): HubWalletNetwork | null {
  try {
    return BUILTIN_NETWORKS[normalizeChainId(chainId)] ?? null;
  } catch {
    return null;
  }
}

export function assertTransactionNetwork(chainId: string | number | bigint): HubWalletNetwork {
  const normalized = normalizeChainId(chainId);
  const network = BUILTIN_NETWORKS[normalized];
  if (!network || (network.testnet !== true && network.productionEnabled !== true)) throw new Error("transaction_network_not_allowed");
  if (!hasPinnedRuntimeFingerprints(network)) throw new Error("transaction_network_fingerprints_unregistered");
  if (network.transactionEnabled !== true) throw new Error("transaction_network_not_allowed");
  return network;
}
