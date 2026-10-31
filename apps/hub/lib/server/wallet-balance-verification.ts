import "server-only";

import type { D1Database } from "@cloudflare/workers-types";
import {
  createPublicClient,
  defineChain,
  fallback,
  formatUnits,
  getAddress,
  hashMessage,
  hashTypedData,
  http,
  toBytes,
  verifyMessage,
  type Address,
  type Chain,
} from "viem";

import type { Profile, TokenRankingDefinition } from "@/lib/domain";
import {
  ENABLED_EVM_CHAINS,
  rpcEnvNames,
  type EvmChainEntry,
} from "@/lib/chains/evm-chain-registry";
import { normalizeWalletAddress } from "@/lib/hub-wallet";
import {
  getD1TokenRanking,
  listD1TokenRankings,
} from "@/lib/server/d1-token-rankings";
import { requireHubSessionProfile } from "@/lib/server/hub-session";

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const encoder = new TextEncoder();

type ChallengeRecord = {
  id: string;
  profileId: string;
  rankingId: string;
  chainId: number;
  nonceHash: string;
  issuedAt: string;
  expiresAt: string;
  usedAt: string | null;
};

type AccountLinkChallengeRecord = {
  id: string;
  profileId: string;
  address: Address;
  chainId: number;
  network: string;
  nonceHash: string;
  issuedAt: string;
  expiresAt: string;
  usedAt: string | null;
};

export type HubWalletLink = {
  address: string;
  chainId: number;
  network: string;
  visibility: "private" | "public";
  verifiedAt: string;
  lastBalanceRefreshAt: string;
};

type NetworkDefinition = {
  chain: Chain;
  aliases: string[];
  rpcEnvironmentName: string;
  entry: EvmChainEntry;
};

const developmentGlobal = globalThis as typeof globalThis & {
  __hubTokenBalanceChallenges?: Map<string, ChallengeRecord>;
};
const developmentChallenges =
  developmentGlobal.__hubTokenBalanceChallenges ??
  (developmentGlobal.__hubTokenBalanceChallenges = new Map());
const developmentLinksGlobal = globalThis as typeof globalThis & {
  __hubProfileWalletLinks?: Map<string, HubWalletLink & { profileId: string }>;
};
const developmentLinks =
  developmentLinksGlobal.__hubProfileWalletLinks ??
  (developmentLinksGlobal.__hubProfileWalletLinks = new Map());

function refreshPublicHolderCounts(database: D1Database) {
  return database.prepare(`UPDATE token_rankings SET holder_count = (
    SELECT COUNT(*) FROM token_balance_snapshots balances
    JOIN profile_wallet_links wallet
      ON wallet.id = balances.wallet_link_id
      AND wallet.profile_id = balances.profile_id
    WHERE balances.ranking_id = token_rankings.id AND balances.raw_amount != '0'
      AND wallet.active = 1 AND wallet.visibility = 'public'
  )`);
}
const accountLinkChallengesGlobal = globalThis as typeof globalThis & {
  __hubWalletAccountLinkChallenges?: Map<string, AccountLinkChallengeRecord>;
};
const accountLinkChallenges =
  accountLinkChallengesGlobal.__hubWalletAccountLinkChallenges ??
  (accountLinkChallengesGlobal.__hubWalletAccountLinkChallenges = new Map());
function chainFromEntry(entry: EvmChainEntry): Chain {
  return defineChain({
    id: entry.chainId,
    name: entry.name,
    nativeCurrency: { name: entry.nativeName, symbol: entry.nativeSymbol, decimals: entry.nativeDecimals },
    rpcUrls: { default: { http: entry.defaultRpcUrls ?? [] } },
    blockExplorers: { default: { name: "Explorer", url: entry.explorerUrl } },
    testnet: entry.testnet,
  });
}

// Derived from the chain registry (lib/chains/evm-chain-registry.ts).
const NETWORKS: NetworkDefinition[] = ENABLED_EVM_CHAINS.map((entry) => ({
  chain: chainFromEntry(entry),
  aliases: entry.aliases,
  rpcEnvironmentName: entry.rpcEnv,
  entry,
}));

const erc20BalanceAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "balance", type: "uint256" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "decimals", type: "uint8" }],
  },
] as const;

export class WalletBalanceInputError extends Error {}
export class WalletBalanceVerificationError extends Error {}
export class WalletBalanceNetworkError extends Error {}

function requirePersistentDatabase(database: D1Database): D1Database {
  if (!database || typeof database.prepare !== "function") {
    throw new WalletBalanceVerificationError("persistent_wallet_storage_required");
  }
  return database;
}

function disabledWalletMockFallback(): never {
  throw new WalletBalanceVerificationError("persistent_wallet_storage_required");
}

function normalizeRankingId(value: unknown): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,160}$/.test(value)) {
    throw new WalletBalanceInputError("ランキングが正しくありません。");
  }
  return value;
}

function normalizeChainId(value: unknown): number {
  const chainId = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new WalletBalanceInputError("チェーンIDが正しくありません。");
  }
  return chainId;
}

function normalizeSignature(value: unknown): `0x${string}` {
  if (
    typeof value !== "string" ||
    !/^0x(?:[0-9a-fA-F]{2}){1,4096}$/.test(value)
  ) {
    throw new WalletBalanceInputError("署名が正しくありません。");
  }
  return value as `0x${string}`;
}

async function verifyWalletOwnershipSignature(input: {
  address: Address;
  chainId: number;
  message: string;
  signature: `0x${string}`;
  signatureType?: "personal_sign" | "eip712";
}): Promise<boolean> {
  if (input.signatureType !== "eip712" &&
    input.signature.length === 132 &&
    await verifyMessage({
      address: input.address,
      message: input.message,
      signature: input.signature,
    }).catch(() => false)
  ) {
    return true;
  }
  try {
    const client = createHubPublicClient(input.chainId);
    const code = await client.getBytecode({ address: input.address });
    if (!code) return false;
    const result = await client.readContract({
      address: input.address,
      abi: [{
        type: "function",
        name: "isValidSignature",
        stateMutability: "view",
        inputs: [
          { name: "hash", type: "bytes32" },
          { name: "signature", type: "bytes" },
        ],
        outputs: [{ name: "magicValue", type: "bytes4" }],
      }] as const,
      functionName: "isValidSignature",
      // The wallet receives the UTF-8 message as a hex byte string. Hash the
      // exact same bytes explicitly; this avoids string/hex overload
      // differences between ethers and viem for ERC-1271 personal_sign.
      args: [input.signatureType === "eip712" ? hashTypedData({
        domain: { name: "JKamma Hub", version: "1", chainId: input.chainId, verifyingContract: input.address },
        primaryType: "HubWalletLink",
        types: { HubWalletLink: [{ name: "message", type: "string" }] },
        message: { message: input.message },
      }) : hashMessage({ raw: toBytes(input.message) }), input.signature],
    });
    return result.toLowerCase() === "0x1626ba7e";
  } catch {
    return false;
  }
}

function networkForRanking(ranking: TokenRankingDefinition): NetworkDefinition {
  const normalized = ranking.network.trim().toLocaleLowerCase("en");
  const definition = NETWORKS.find((entry) =>
    entry.aliases.includes(normalized),
  );
  if (!definition) {
    throw new WalletBalanceNetworkError(
      `${ranking.network} はまだ自動残高取得に対応していません。`,
    );
  }
  return definition;
}

export function getHubEvmNetworkByChainId(chainId: number) {
  const definition = NETWORKS.find((entry) => entry.chain.id === chainId);
  if (!definition) {
    throw new WalletBalanceNetworkError(
      `Chain ID ${chainId} はまだ対応していません。`,
    );
  }
  return definition;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function buildMessage(input: {
  origin: string;
  profile: Profile;
  ranking: TokenRankingDefinition;
  address: Address;
  chainId: number;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
}) {
  return [
    `${new URL(input.origin).host} でウォレット所有確認を行います。`,
    "",
    "この署名は取引を実行せず、Hubの公開トークン残高を更新するためだけに使われます。",
    "",
    `Hubプロフィール: @${input.profile.handle}`,
    `ランキング: ${input.ranking.title} (${input.ranking.symbol})`,
    `ウォレット: ${input.address}`,
    `Chain ID: ${input.chainId}`,
    `Nonce: ${input.nonce}`,
    `Issued At: ${input.issuedAt}`,
    `Expiration Time: ${input.expiresAt}`,
  ].join("\n");
}

function buildAccountLinkMessage(input: {
  origin: string;
  profile: Profile;
  address: Address;
  chainId: number;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
}) {
  return [
    `${new URL(input.origin).host} で決済アカウントの連携確認を行います。`,
    "",
    "この署名は取引やログインを実行せず、公開ウォレットをHubプロフィールへ非公開で紐づけるためだけに使われます。",
    "",
    `Hubプロフィール: @${input.profile.handle}`,
    `ウォレット: ${input.address}`,
    `Chain ID: ${input.chainId}`,
    `Nonce: ${input.nonce}`,
    `Issued At: ${input.issuedAt}`,
    `Expiration Time: ${input.expiresAt}`,
  ].join("\n");
}

function buildReadableWalletBalanceMessage(input: {
  origin: string;
  profile: Profile;
  ranking: TokenRankingDefinition;
  address: Address;
  chainId: number;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
}) {
  return [
    `${new URL(input.origin).host} でウォレット所有確認を行います。`,
    "",
    "この署名は公開トークン残高の更新にのみ使われます。送金、支払い、トークン承認、ログインは実行しません。",
    "ウォレットとプロフィールの関連付けは非公開で保存され、別途公開を選んだ場合だけランキングに表示されます。",
    "",
    `Hubプロフィール: @${input.profile.handle}`,
    `ランキング: ${input.ranking.title} (${input.ranking.symbol})`,
    `ウォレット: ${input.address}`,
    `Chain ID: ${input.chainId}`,
    `Nonce: ${input.nonce}`,
    `Issued At: ${input.issuedAt}`,
    `Expiration Time: ${input.expiresAt}`,
  ].join("\n");
}

async function resolveProfile(request: Request, database: D1Database) {
  return requireHubSessionProfile(request, database);
}

async function resolveRanking(
  database: D1Database,
  rankingId: string,
): Promise<TokenRankingDefinition> {
  const ranking = await getD1TokenRanking(database, rankingId);
  if (!ranking)
    throw new WalletBalanceInputError("ランキングが見つかりません。");
  return ranking;
}

async function saveChallenge(
  database: D1Database,
  challenge: ChallengeRecord,
) {
  if (!database) {
    developmentChallenges.set(challenge.id, challenge);
    return;
  }
  await database
    .prepare(
      `INSERT INTO token_balance_challenges
      (id, profile_id, ranking_id, chain_id, nonce_hash, issued_at, expires_at, used_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
    )
    .bind(
      challenge.id,
      challenge.profileId,
      challenge.rankingId,
      challenge.chainId,
      challenge.nonceHash,
      challenge.issuedAt,
      challenge.expiresAt,
    )
    .run();
}

async function consumeChallenge(
  database: D1Database,
  challengeId: string,
  profileId: string,
): Promise<ChallengeRecord> {
  const now = new Date().toISOString();
  if (!database) {
    const challenge = developmentChallenges.get(challengeId);
    if (
      !challenge ||
      challenge.profileId !== profileId ||
      challenge.usedAt ||
      challenge.expiresAt <= now
    ) {
      throw new WalletBalanceVerificationError(
        "確認リクエストが期限切れか、すでに使用されています。",
      );
    }
    challenge.usedAt = now;
    return challenge;
  }

  const row = await database
    .prepare(
      `SELECT id, profile_id, ranking_id, chain_id,
      nonce_hash, issued_at, expires_at, used_at
      FROM token_balance_challenges
      WHERE id = ? AND profile_id = ? LIMIT 1`,
    )
    .bind(challengeId, profileId)
    .first<{
      id: string;
      profile_id: string;
      ranking_id: string;
      chain_id: number;
      nonce_hash: string;
      issued_at: string;
      expires_at: string;
      used_at: string | null;
    }>();
  if (!row || row.used_at || row.expires_at <= now) {
    throw new WalletBalanceVerificationError(
      "確認リクエストが期限切れか、すでに使用されています。",
    );
  }
  const result = await database
    .prepare(
      `UPDATE token_balance_challenges
      SET used_at = ?
      WHERE id = ? AND profile_id = ? AND used_at IS NULL AND expires_at > ?`,
    )
    .bind(now, challengeId, profileId, now)
    .run();
  if (!result.meta.changes) {
    throw new WalletBalanceVerificationError(
      "確認リクエストはすでに使用されています。",
    );
  }
  return {
    id: row.id,
    profileId: row.profile_id,
    rankingId: row.ranking_id,
    chainId: Number(row.chain_id),
    nonceHash: row.nonce_hash,
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
    usedAt: now,
  };
}

function rpcUrls(definition: NetworkDefinition) {
  for (const name of rpcEnvNames(definition.entry)) {
    const configured = process.env[name]?.trim();
    if (!configured) continue;
    let parsed: URL;
    try {
      parsed = new URL(configured);
    } catch {
      throw new WalletBalanceNetworkError("RPC URLが正しくありません。");
    }
    if (parsed.protocol !== "https:") {
      throw new WalletBalanceNetworkError("RPC URLはHTTPSで設定してください。");
    }
    return [parsed.toString()];
  }
  const defaults = definition.entry.defaultRpcUrls ?? [];
  // Chains added after the registry have no production default: fail closed.
  if (defaults.length && (definition.entry.legacyDefaultRpc || process.env.NODE_ENV !== "production")) {
    return [...defaults];
  }
  throw new WalletBalanceNetworkError(`${definition.entry.name} のRPCが未設定のため、現在利用できません。`);
}

export function createHubPublicClient(chainId: number) {
  const definition = getHubEvmNetworkByChainId(chainId);
  return createPublicClient({
    chain: definition.chain,
    transport: fallback(
      rpcUrls(definition).map((url) => http(url, { timeout: 8_000 })),
      { retryCount: 1 },
    ),
  });
}

export async function readLinkedWalletOverview(input: {
  request: Request;
  database: D1Database;
  address: unknown;
  chainId: unknown;
}) {
  requirePersistentDatabase(input.database);
  const normalizedAddress = normalizeWalletAddress(input.address);
  if (!normalizedAddress) {
    throw new WalletBalanceInputError("ウォレットアドレスが正しくありません。");
  }
  const address = getAddress(normalizedAddress);
  const chainId = normalizeChainId(input.chainId);
  const links = await listHubWalletLinks(input.request, input.database);
  const linked = links.some(
    (link) =>
      link.chainId === chainId &&
      link.address.toLocaleLowerCase("en") === address.toLocaleLowerCase("en"),
  );
  if (!linked) {
    throw new WalletBalanceVerificationError(
      "残高を確認するには、先にこのウォレットの所有権を署名で確認してください。",
    );
  }
  const client = createHubPublicClient(chainId);
  const [balance, blockNumber] = await Promise.all([
    client.getBalance({ address }),
    client.getBlockNumber(),
  ]);
  const rankings = await listD1TokenRankings(input.database);
  const allowedTokens = rankings
    .filter((ranking) => {
      if (!ranking.contractAddress || ranking.verificationStatus !== "verified")
        return false;
      try {
        return networkForRanking(ranking).chain.id === chainId;
      } catch {
        return false;
      }
    })
    .slice(0, 20);
  const tokenResults = await Promise.allSettled(
    allowedTokens.map(async (ranking) => {
      const balance = await readBalance(ranking, address);
      return {
        id: ranking.id,
        symbol: ranking.symbol,
        name: ranking.title,
        contractAddress: getAddress(ranking.contractAddress!),
        balance: Number(balance.amount),
      };
    }),
  );
  const tokens = tokenResults.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );
  const hubTokenAddress = process.env.HUB_TOKEN_CONTRACT_ADDRESS?.trim();
  const rawHubTokenChainId = process.env.HUB_TOKEN_CHAIN_ID?.trim();
  const hubTokenChainId = rawHubTokenChainId && /^[1-9][0-9]*$/.test(rawHubTokenChainId)
    ? Number(rawHubTokenChainId)
    : null;
  if (chainId === hubTokenChainId && Number.isSafeInteger(hubTokenChainId) &&
      hubTokenAddress && /^0x[0-9a-fA-F]{40}$/.test(hubTokenAddress)) {
    try {
      const normalizedHubTokenAddress = getAddress(hubTokenAddress);
      if (!tokens.some((token) => token.contractAddress === normalizedHubTokenAddress)) {
        const rawHubTokenBalance = await client.readContract({
          address: normalizedHubTokenAddress,
          abi: [{
            type: "function",
            name: "balanceOf",
            stateMutability: "view",
            inputs: [{ name: "account", type: "address" }],
            outputs: [{ name: "", type: "uint256" }],
          }] as const,
          functionName: "balanceOf",
          args: [address],
        });
        tokens.push({
          id: "hub-revenue-token",
          symbol: "HUB",
          name: "Hub Token",
          contractAddress: normalizedHubTokenAddress,
          balance: Number(formatUnits(rawHubTokenBalance, 18)),
        });
      }
    } catch {
      // Fail closed: do not display a stale or client-supplied Hub Token balance.
      // Misconfigured server-side chain evidence is rejected by the same boundary.
    }
  }
  const nftCollections = configuredNftCollections(chainId);
  const nftResults = await Promise.allSettled(
    nftCollections.map(async (collection) => {
      const owned = await client.readContract({
        address: collection.address,
        abi: erc721EnumerableAbi,
        functionName: "balanceOf",
        args: [address],
      });
      const visibleCount = Number(owned > 12n ? 12n : owned);
      const tokenIds = await Promise.all(
        Array.from({ length: visibleCount }, (_, index) =>
          client.readContract({
            address: collection.address,
            abi: erc721EnumerableAbi,
            functionName: "tokenOfOwnerByIndex",
            args: [address, BigInt(index)],
          }),
        ),
      );
      return {
        name: collection.name,
        contractAddress: collection.address,
        owned: owned.toString(),
        tokenIds: tokenIds.map(String),
      };
    }),
  );
  const nfts = nftResults.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );
  const nativeEntry = getHubEvmNetworkByChainId(chainId).entry;
  return {
    address,
    chainId,
    network: getHubEvmNetworkByChainId(chainId).chain.name,
    nativeBalance: formatUnits(balance, nativeEntry.nativeDecimals),
    nativeSymbol: nativeEntry.nativeSymbol,
    tokens,
    tokenReadFailures: tokenResults.length - tokens.length,
    nfts,
    nftReadFailures: nftResults.length - nfts.length,
    blockNumber: blockNumber.toString(),
    refreshedAt: new Date().toISOString(),
  };
}

const erc721EnumerableAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "balance", type: "uint256" }],
  },
  {
    type: "function",
    name: "tokenOfOwnerByIndex",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "index", type: "uint256" },
    ],
    outputs: [{ name: "tokenId", type: "uint256" }],
  },
] as const;

function configuredNftCollections(
  chainId: number,
): Array<{ name: string; address: Address }> {
  const raw = process.env.HUB_WALLET_NFT_COLLECTIONS_JSON?.trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .flatMap((value) => {
        if (!value || typeof value !== "object") return [];
        const item = value as Record<string, unknown>;
        if (
          Number(item.chainId) !== chainId ||
          typeof item.name !== "string" ||
          typeof item.address !== "string"
        )
          return [];
        if (
          item.name.length < 1 ||
          item.name.length > 80 ||
          !normalizeWalletAddress(item.address)
        )
          return [];
        return [{ name: item.name, address: getAddress(item.address) }];
      })
      .slice(0, 6);
  } catch {
    return [];
  }
}

async function readBalance(
  ranking: TokenRankingDefinition,
  address: Address,
): Promise<{ rawAmount: string; decimals: number; amount: string }> {
  const definition = networkForRanking(ranking);
  const client = createHubPublicClient(definition.chain.id);
  let raw: bigint;
  let decimals = definition.chain.nativeCurrency.decimals;
  if (ranking.contractAddress) {
    const contractAddress = getAddress(ranking.contractAddress);
    [raw, decimals] = await Promise.all([
      client.readContract({
        address: contractAddress,
        abi: erc20BalanceAbi,
        functionName: "balanceOf",
        args: [address],
      }),
      client.readContract({
        address: contractAddress,
        abi: erc20BalanceAbi,
        functionName: "decimals",
      }),
    ]);
  } else {
    raw = await client.getBalance({ address });
  }
  if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new WalletBalanceVerificationError(
      "残高を安全に数値化できませんでした。",
    );
  }
  return { rawAmount: raw.toString(), decimals, amount: formatUnits(raw, decimals) };
}

async function saveVerifiedBalance(input: {
  database: D1Database;
  profileId: string;
  ranking: TokenRankingDefinition;
  address: Address;
  chainId: number;
  rawAmount: string;
  decimals: number;
  amount: string;
  verifiedAt: string;
}) {
  if (!input.database) {
    const key = input.address.toLocaleLowerCase("en");
    const existing = developmentLinks.get(key);
    if (existing && existing.profileId !== input.profileId) {
      throw new WalletBalanceVerificationError(
        "このウォレットは別のHubアカウントに紐づいています。",
      );
    }
    developmentLinks.set(key, {
      profileId: input.profileId,
      address: input.address,
      chainId: input.chainId,
      network: input.ranking.network,
      visibility: "private",
      verifiedAt: existing?.verifiedAt ?? input.verifiedAt,
      lastBalanceRefreshAt: input.verifiedAt,
    });
    return disabledWalletMockFallback();
  }
  const existingLink = await input.database
    .prepare(
      `SELECT id, profile_id
      FROM profile_wallet_links
      WHERE wallet_address = ? LIMIT 1`,
    )
    .bind(input.address)
    .first<{ id: string; profile_id: string }>();
  if (existingLink && existingLink.profile_id !== input.profileId) {
    throw new WalletBalanceVerificationError(
      "このウォレットは別のHubアカウントに紐づいています。",
    );
  }
  const walletLinkId = existingLink?.id ?? `wallet-link-${crypto.randomUUID()}`;
  await input.database.batch([
    input.database
      .prepare(
        `INSERT INTO profile_wallet_links
        (id, profile_id, chain_id, network, wallet_address, visibility,
         verified_at, last_balance_refresh_at, created_at)
        VALUES (?, ?, ?, ?, ?, 'private', ?, ?, ?)
        ON CONFLICT(wallet_address) DO UPDATE SET
          chain_id = excluded.chain_id,
          network = excluded.network,
          active = 1,
          visibility = 'private',
          unlinked_at = NULL,
          verified_at = excluded.verified_at,
          last_balance_refresh_at = excluded.last_balance_refresh_at`,
      )
      .bind(
        walletLinkId,
        input.profileId,
        input.chainId,
        input.ranking.network,
        input.address,
        input.verifiedAt,
        input.verifiedAt,
        input.verifiedAt,
      ),
    input.database
      .prepare(
        `INSERT INTO token_balance_snapshots
        (profile_id, ranking_id, amount, verified_at, wallet_link_id, raw_amount, token_decimals)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(profile_id, ranking_id) DO UPDATE SET
          amount = excluded.amount, verified_at = excluded.verified_at,
          wallet_link_id = excluded.wallet_link_id,
          raw_amount = excluded.raw_amount,
          token_decimals = excluded.token_decimals`,
      )
      .bind(
        input.profileId,
        input.ranking.id,
        Number(input.amount),
        input.verifiedAt,
        walletLinkId,
        input.rawAmount,
        input.decimals,
      ),
    input.database
      .prepare(
        `INSERT INTO token_balances
        (profile_id, symbol, amount, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(profile_id, symbol) DO UPDATE SET
          amount = excluded.amount, updated_at = excluded.updated_at`,
      )
      .bind(
        input.profileId,
        input.ranking.symbol,
        input.amount,
        input.verifiedAt,
      ),
    input.database
      .prepare(
        `UPDATE token_rankings SET
        verification_status = 'verified',
        last_verified_at = ?,
        last_synced_at = ?,
        sync_error = NULL,
        holder_count = (
          SELECT COUNT(*) FROM token_balance_snapshots balances
          JOIN profile_wallet_links wallet
            ON wallet.id = balances.wallet_link_id
            AND wallet.profile_id = balances.profile_id
          WHERE balances.ranking_id = ? AND balances.raw_amount != '0'
            AND wallet.active = 1 AND wallet.visibility = 'public'
        )
        WHERE id = ?`,
      )
      .bind(
        input.verifiedAt,
        input.verifiedAt,
        input.ranking.id,
        input.ranking.id,
      ),
  ]);
}

export async function createWalletBalanceChallenge(input: {
  request: Request;
  database: D1Database;
  rankingId: unknown;
  address: unknown;
  chainId: unknown;
}) {
  requirePersistentDatabase(input.database);
  const rankingId = normalizeRankingId(input.rankingId);
  const normalizedAddress = normalizeWalletAddress(input.address);
  if (!normalizedAddress) {
    throw new WalletBalanceInputError("ウォレットアドレスが正しくありません。");
  }
  const address = getAddress(normalizedAddress);
  const chainId = normalizeChainId(input.chainId);
  const [profile, ranking] = await Promise.all([
    resolveProfile(input.request, input.database),
    resolveRanking(input.database, rankingId),
  ]);
  const definition = networkForRanking(ranking);
  if (definition.chain.id !== chainId) {
    throw new WalletBalanceNetworkError(
      `${ranking.network}（Chain ID ${definition.chain.id}）へ切り替えてください。`,
    );
  }
  const id = crypto.randomUUID();
  const nonce = crypto.randomUUID();
  const issuedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS).toISOString();
  const message = buildReadableWalletBalanceMessage({
    origin: new URL(input.request.url).origin,
    profile,
    ranking,
    address,
    chainId,
    nonce,
    issuedAt,
    expiresAt,
  });
  await saveChallenge(input.database, {
    id,
    profileId: profile.id,
    rankingId,
    chainId,
    nonceHash: await sha256Hex(nonce),
    issuedAt,
    expiresAt,
    usedAt: null,
  });
  return { challengeId: id, message, expiresAt };
}

export async function verifyWalletAndRefreshBalance(input: {
  request: Request;
  database: D1Database;
  challengeId: unknown;
  address: unknown;
  signature: unknown;
  message: unknown;
}) {
  requirePersistentDatabase(input.database);
  if (
    typeof input.challengeId !== "string" ||
    !/^[0-9a-f-]{36}$/i.test(input.challengeId)
  ) {
    throw new WalletBalanceInputError("確認IDが正しくありません。");
  }
  const normalizedAddress = normalizeWalletAddress(input.address);
  if (!normalizedAddress) {
    throw new WalletBalanceInputError("ウォレットアドレスが正しくありません。");
  }
  if (typeof input.message !== "string") {
    throw new WalletBalanceInputError("署名メッセージがありません。");
  }
  const address = getAddress(normalizedAddress);
  const signature = normalizeSignature(input.signature);
  const profile = await resolveProfile(input.request, input.database);
  const challenge = await consumeChallenge(
    input.database,
    input.challengeId,
    profile.id,
  );
  const ranking = await resolveRanking(input.database, challenge.rankingId);
  const messageNonce = input.message.match(/^Nonce: (.+)$/m)?.[1];
  const expectedMessage = messageNonce
    ? buildReadableWalletBalanceMessage({
        origin: new URL(input.request.url).origin,
        profile,
        ranking,
        address,
        chainId: challenge.chainId,
        nonce: messageNonce,
        issuedAt: challenge.issuedAt,
        expiresAt: challenge.expiresAt,
      })
    : "";
  if (
    !messageNonce ||
    (await sha256Hex(messageNonce)) !== challenge.nonceHash ||
    input.message !== expectedMessage
  ) {
    throw new WalletBalanceVerificationError(
      "署名メッセージが改変されています。",
    );
  }
  if (!(await verifyWalletOwnershipSignature({
    address,
    chainId: challenge.chainId,
    message: input.message,
    signature,
  }))) {
    throw new WalletBalanceVerificationError(
      "ウォレット署名を確認できませんでした。",
    );
  }
  const definition = networkForRanking(ranking);
  if (definition.chain.id !== challenge.chainId) {
    throw new WalletBalanceNetworkError(
      "ランキングのネットワーク設定が変更されています。",
    );
  }
  const balance = await readBalance(ranking, address);
  const verifiedAt = new Date().toISOString();
  await saveVerifiedBalance({
    database: input.database,
    profileId: profile.id,
    ranking,
    address,
    chainId: challenge.chainId,
    ...balance,
    verifiedAt,
  });
  return {
    rankingId: ranking.id,
    symbol: ranking.symbol,
    amount: balance.amount,
    verifiedAt,
  };
}

export async function listHubWalletLinks(
  request: Request,
  database: D1Database,
): Promise<HubWalletLink[]> {
  const profile = await resolveProfile(request, database);
  return listHubWalletLinksForViewer(profile, database);
}

export async function listHubWalletLinksForViewer(
  profile: { id: string },
  database: D1Database,
): Promise<HubWalletLink[]> {
  requirePersistentDatabase(database);
  if (!database) {
    return Array.from(developmentLinks.values())
      .filter((link) => link.profileId === profile.id)
      .map(({ profileId: _profileId, ...link }) => link);
  }
  const result = await database
    .prepare(
      `SELECT wallet_address, chain_id, network,
      visibility, verified_at, last_balance_refresh_at
      FROM profile_wallet_links
      WHERE profile_id = ? AND active = 1
      ORDER BY verified_at DESC`,
    )
    .bind(profile.id)
    .all<{
      wallet_address: string;
      chain_id: number;
      network: string;
      visibility: "private" | "public";
      verified_at: string;
      last_balance_refresh_at: string;
    }>();
  return result.results.map((row) => ({
    address: row.wallet_address,
    chainId: Number(row.chain_id),
    network: row.network,
    visibility: row.visibility,
    verifiedAt: row.verified_at,
    lastBalanceRefreshAt: row.last_balance_refresh_at,
  }));
}

export async function unlinkHubWallet(input: {
  request: Request;
  database: D1Database;
  address: unknown;
  chainId: unknown;
}) {
  const profile = await resolveProfile(input.request, input.database);
  return unlinkHubWalletForViewer({ ...input, profile });
}

export async function unlinkHubWalletForViewer(input: {
  request: Request;
  database: D1Database;
  address: unknown;
  chainId: unknown;
  profile: { id: string };
}) {
  const { profile } = input;
  requirePersistentDatabase(input.database);
  const normalizedAddress = normalizeWalletAddress(input.address);
  if (!normalizedAddress) {
    throw new WalletBalanceInputError("ウォレットアドレスが正しくありません。");
  }
  const address = getAddress(normalizedAddress);
  const chainId = normalizeChainId(input.chainId);
  if (!input.database) {
    const key = address.toLocaleLowerCase("en");
    const existing = developmentLinks.get(key);
    if (existing?.profileId === profile.id) developmentLinks.delete(key);
    return { unlinked: Boolean(existing?.profileId === profile.id) };
  }
  const results = await input.database.batch([
    input.database.prepare(
      `UPDATE profile_wallet_links SET active=0,unlinked_at=?
      WHERE profile_id = ? AND wallet_address = ? AND chain_id = ? AND active=1`,
    )
    .bind(new Date().toISOString(), profile.id, address, chainId),
    refreshPublicHolderCounts(input.database),
    // Token gates: closing a wallet link must close gated access at once.
    input.database.prepare("DELETE FROM access_gate_checks WHERE profile_id = ?").bind(profile.id),
  ]);
  return { unlinked: Boolean(results[0].meta.changes) };
}

export async function setHubWalletLinksVisibility(
  request: Request,
  database: D1Database,
  visibility: "private" | "public",
) {
  requirePersistentDatabase(database);
  const profile = await resolveProfile(request, database);
  if (!database) {
    for (const [key, link] of developmentLinks) {
      if (link.profileId === profile.id)
        developmentLinks.set(key, { ...link, visibility });
    }
    return { visibility };
  }
  await database.batch([
    database.prepare(
      "UPDATE profile_wallet_links SET visibility = ? WHERE profile_id = ? AND active = 1",
    ).bind(visibility, profile.id),
    refreshPublicHolderCounts(database),
  ]);
  return { visibility };
}

/** @deprecated Profile linking moved to the purpose-bound EIP-712 module. */
export async function createHubWalletAccountLinkChallenge(): Promise<never> {
  throw new WalletBalanceVerificationError("legacy_profile_link_api_removed");
}

/** @deprecated Profile linking moved to the purpose-bound EIP-712 module. */
export async function verifyAndLinkHubWalletAccount(): Promise<never> {
  throw new WalletBalanceVerificationError("legacy_profile_link_api_removed");
}
