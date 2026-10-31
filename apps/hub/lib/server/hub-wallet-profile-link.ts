import "server-only";

import type { D1Database } from "@cloudflare/workers-types";
import {
  getAddress,
  hashTypedData,
  verifyTypedData,
  type Address,
  type Hex,
} from "viem";

import { requireHubSessionProfile } from "@/lib/server/hub-session";
import {
  createHubPublicClient,
  getHubEvmNetworkByChainId,
  WalletBalanceInputError,
  WalletBalanceNetworkError,
  WalletBalanceVerificationError,
} from "@/lib/server/wallet-balance-verification";
import { normalizeWalletAddress } from "@/lib/hub-wallet";
import { registerVerifiedEvmWallet, WalletAlreadyLinkedError } from "@/lib/server/wallet-account-registry";

const CHALLENGE_TTL_SECONDS = 5 * 60;
const PURPOSE = "hub_profile_wallet_link_v1" as const;
const DOMAIN_NAME = "JKamma Hub Wallet Link" as const;
const PRIMARY_TYPE = "ProfileWalletLink" as const;
const ERC1271_MAGIC_VALUE = "0x1626ba7e";
const PROFILE_LINK_TYPES = {
  ProfileWalletLink: [
    { name: "purpose", type: "string" },
    { name: "audience", type: "string" },
    { name: "profileId", type: "string" },
    { name: "profileHandle", type: "string" },
    { name: "wallet", type: "address" },
    { name: "chainId", type: "uint256" },
    { name: "nonce", type: "string" },
    { name: "issuedAt", type: "uint64" },
    { name: "expiresAt", type: "uint64" },
  ],
} as const;

export type HubProfileLinkTypedData = {
  domain: {
    name: typeof DOMAIN_NAME;
    version: "1";
    chainId: number;
    verifyingContract: Address;
  };
  primaryType: typeof PRIMARY_TYPE;
  types: typeof PROFILE_LINK_TYPES;
  message: {
    purpose: typeof PURPOSE;
    audience: string;
    profileId: string;
    profileHandle: string;
    wallet: Address;
    chainId: bigint;
    nonce: string;
    issuedAt: bigint;
    expiresAt: bigint;
  };
};

type ChallengeRow = {
  id: string;
  profile_id: string;
  wallet_address: string;
  chain_id: number;
  network: string;
  nonce_hash: string;
  issued_at: string;
  expires_at: string;
  used_at: string | null;
};

function normalizeChallengeId(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f-]{36}$/i.test(value)) {
    throw new WalletBalanceInputError("確認IDが正しくありません。");
  }
  return value;
}

function normalizeSignature(value: unknown): Hex {
  if (typeof value !== "string" || !/^0x(?:[0-9a-fA-F]{2}){32,4096}$/.test(value)) {
    throw new WalletBalanceInputError("署名が正しくありません。");
  }
  return value as Hex;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return keys.length === sortedExpected.length && keys.every((key, index) => key === sortedExpected[index]);
}

function parseUnsignedInteger(value: unknown, field: string): bigint {
  if (typeof value === "number" && (!Number.isSafeInteger(value) || value < 0)) {
    throw new WalletBalanceInputError(`${field}が正しくありません。`);
  }
  if (typeof value === "string" && !/^(?:0|[1-9][0-9]*)$/.test(value)) {
    throw new WalletBalanceInputError(`${field}が正しくありません。`);
  }
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint") {
    throw new WalletBalanceInputError(`${field}が正しくありません。`);
  }
  try {
    const parsed = BigInt(value);
    if (parsed < 0n) throw new Error("negative");
    return parsed;
  } catch {
    throw new WalletBalanceInputError(`${field}が正しくありません。`);
  }
}

function normalizeTypedData(value: unknown): HubProfileLinkTypedData {
  if (!value || typeof value !== "object") throw new WalletBalanceInputError("署名内容が正しくありません。");
  const root = value as Record<string, unknown>;
  if (!exactKeys(root, ["domain", "primaryType", "types", "message"])) throw new WalletBalanceInputError("署名内容が正しくありません。");
  const domain = root.domain as Record<string, unknown> | null;
  const types = root.types as Record<string, unknown> | null;
  const message = root.message as Record<string, unknown> | null;
  if (!domain || !types || !message || root.primaryType !== PRIMARY_TYPE) throw new WalletBalanceInputError("署名内容が正しくありません。");
  if (!exactKeys(domain, ["name", "version", "chainId", "verifyingContract"]) || !exactKeys(types, [PRIMARY_TYPE]) || !exactKeys(message, ["purpose", "audience", "profileId", "profileHandle", "wallet", "chainId", "nonce", "issuedAt", "expiresAt"])) throw new WalletBalanceInputError("署名内容が正しくありません。");
  if (JSON.stringify(types[PRIMARY_TYPE]) !== JSON.stringify(PROFILE_LINK_TYPES[PRIMARY_TYPE])) throw new WalletBalanceInputError("署名形式が正しくありません。");
  const normalizedAddress = normalizeWalletAddress(message.wallet);
  const normalizedContract = normalizeWalletAddress(domain.verifyingContract);
  const chainId = Number(domain.chainId);
  const messageChainId = parseUnsignedInteger(message.chainId, "chainId");
  const issuedAt = parseUnsignedInteger(message.issuedAt, "issuedAt");
  const expiresAt = parseUnsignedInteger(message.expiresAt, "expiresAt");
  if (!normalizedAddress || !normalizedContract || !Number.isSafeInteger(chainId) || chainId <= 0 || messageChainId !== BigInt(chainId) || normalizedAddress.toLowerCase() !== normalizedContract.toLowerCase()) throw new WalletBalanceInputError("署名対象が正しくありません。");
  if (domain.name !== DOMAIN_NAME || domain.version !== "1" || message.purpose !== PURPOSE) throw new WalletBalanceInputError("署名用途が正しくありません。");
  for (const field of [message.audience, message.profileId, message.profileHandle, message.nonce]) {
    if (typeof field !== "string" || field.length < 1 || field.length > 256) throw new WalletBalanceInputError("署名内容が正しくありません。");
  }
  return {
    domain: { name: DOMAIN_NAME, version: "1", chainId, verifyingContract: getAddress(normalizedContract) },
    primaryType: PRIMARY_TYPE,
    types: PROFILE_LINK_TYPES,
    message: {
      purpose: PURPOSE,
      audience: message.audience as string,
      profileId: message.profileId as string,
      profileHandle: message.profileHandle as string,
      wallet: getAddress(normalizedAddress),
      chainId: messageChainId,
      nonce: message.nonce as string,
      issuedAt,
      expiresAt,
    },
  };
}

function createTypedData(input: {
  origin: string;
  profileId: string;
  profileHandle: string;
  address: Address;
  chainId: number;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
}): HubProfileLinkTypedData {
  return {
    domain: { name: DOMAIN_NAME, version: "1", chainId: input.chainId, verifyingContract: input.address },
    primaryType: PRIMARY_TYPE,
    types: PROFILE_LINK_TYPES,
    message: {
      purpose: PURPOSE,
      audience: input.origin,
      profileId: input.profileId,
      profileHandle: `@${input.profileHandle}`,
      wallet: input.address,
      chainId: BigInt(input.chainId),
      nonce: input.nonce,
      issuedAt: BigInt(input.issuedAt),
      expiresAt: BigInt(input.expiresAt),
    },
  };
}

function jsonTypedData(value: HubProfileLinkTypedData) {
  return {
    ...value,
    message: {
      ...value.message,
      chainId: value.message.chainId.toString(),
      issuedAt: value.message.issuedAt.toString(),
      expiresAt: value.message.expiresAt.toString(),
    },
  };
}

async function verifyTypedSignature(address: Address, chainId: number, typedData: HubProfileLinkTypedData, signature: Hex): Promise<boolean> {
  if (signature.length === 132 && await verifyTypedData({ address, ...typedData, signature }).catch(() => false)) return true;
  try {
    const client = createHubPublicClient(chainId);
    if (!await client.getBytecode({ address })) return false;
    const digest = hashTypedData(typedData);
    const result = await client.readContract({
      address,
      abi: [{
        type: "function",
        name: "isValidSignature",
        stateMutability: "view",
        inputs: [{ name: "hash", type: "bytes32" }, { name: "signature", type: "bytes" }],
        outputs: [{ name: "magicValue", type: "bytes4" }],
      }] as const,
      functionName: "isValidSignature",
      args: [digest, signature],
    });
    return result.toLowerCase() === ERC1271_MAGIC_VALUE;
  } catch {
    return false;
  }
}

export async function createHubProfileLinkChallenge(input: { request: Request; database: D1Database; address: unknown; chainId: unknown }) {
  const profile = await requireHubSessionProfile(input.request, input.database);
  return createHubProfileLinkChallengeForViewer({ ...input, profile });
}

export async function createHubProfileLinkChallengeForViewer(input: { request: Request; database: D1Database; address: unknown; chainId: unknown; profile: { id: string; handle: string } }) {
  const { profile } = input;
  const normalized = normalizeWalletAddress(input.address);
  const chainId = typeof input.chainId === "number" ? input.chainId : Number(input.chainId);
  if (!normalized || !Number.isSafeInteger(chainId) || chainId <= 0) throw new WalletBalanceInputError("ウォレット情報が正しくありません。");
  const address = getAddress(normalized);
  const network = getHubEvmNetworkByChainId(chainId).chain.name;
  const challengeId = crypto.randomUUID();
  const nonce = crypto.randomUUID();
  const issuedAtSeconds = Math.floor(Date.now() / 1000);
  const expiresAtSeconds = issuedAtSeconds + CHALLENGE_TTL_SECONDS;
  const issuedAt = new Date(issuedAtSeconds * 1000).toISOString();
  const expiresAt = new Date(expiresAtSeconds * 1000).toISOString();
  await input.database.prepare(`INSERT INTO wallet_account_link_challenges
    (id, profile_id, wallet_address, chain_id, network, nonce_hash, issued_at, expires_at, used_at, purpose)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 'payment_account_link')`)
    .bind(challengeId, profile.id, address, chainId, network, await sha256Hex(nonce), issuedAt, expiresAt).run();
  const typedData = createTypedData({ origin: new URL(input.request.url).origin, profileId: profile.id, profileHandle: profile.handle, address, chainId, nonce, issuedAt: issuedAtSeconds, expiresAt: expiresAtSeconds });
  return { challengeId, typedData: jsonTypedData(typedData), expiresAt };
}

export async function verifyAndLinkHubProfileWallet(input: { request: Request; database: D1Database; challengeId: unknown; address: unknown; typedData: unknown; signature: unknown }) {
  const profile = await requireHubSessionProfile(input.request, input.database);
  return verifyAndLinkHubProfileWalletForViewer({ ...input, profile });
}

export async function verifyAndLinkHubProfileWalletForViewer(input: { request: Request; database: D1Database; challengeId: unknown; address: unknown; typedData: unknown; signature: unknown; profile: { id: string; handle: string } }) {
  const { profile } = input;
  const challengeId = normalizeChallengeId(input.challengeId);
  const normalized = normalizeWalletAddress(input.address);
  if (!normalized) throw new WalletBalanceInputError("ウォレットアドレスが正しくありません。");
  const address = getAddress(normalized);
  const signature = normalizeSignature(input.signature);
  const supplied = normalizeTypedData(input.typedData);
  const row = await input.database.prepare(`SELECT id, profile_id, wallet_address, chain_id, network, nonce_hash, issued_at, expires_at, used_at
    FROM wallet_account_link_challenges WHERE id = ? AND profile_id = ? AND purpose = 'payment_account_link' LIMIT 1`)
    .bind(challengeId, profile.id).first<ChallengeRow>();
  const now = new Date();
  if (!row || row.used_at || new Date(row.expires_at) <= now) throw new WalletBalanceVerificationError("連携確認が期限切れか、すでに使用されています。");
  const expected = createTypedData({
    origin: new URL(input.request.url).origin,
    profileId: profile.id,
    profileHandle: profile.handle,
    address: getAddress(row.wallet_address),
    chainId: Number(row.chain_id),
    nonce: supplied.message.nonce,
    issuedAt: Math.floor(new Date(row.issued_at).getTime() / 1000),
    expiresAt: Math.floor(new Date(row.expires_at).getTime() / 1000),
  });
  if (address.toLowerCase() !== expected.message.wallet.toLowerCase() || await sha256Hex(supplied.message.nonce) !== row.nonce_hash || hashTypedData(supplied) !== hashTypedData(expected)) throw new WalletBalanceVerificationError("署名内容が改変されています。");
  if (!await verifyTypedSignature(address, Number(row.chain_id), expected, signature)) throw new WalletBalanceVerificationError("ウォレット署名を確認できませんでした。");
  const usedAt = now.toISOString();
  const consumed = await input.database.prepare("UPDATE wallet_account_link_challenges SET used_at = ? WHERE id = ? AND used_at IS NULL").bind(usedAt, challengeId).run();
  if (!consumed.meta.changes) throw new WalletBalanceVerificationError("連携確認はすでに使用されています。");

  const verifiedAt = usedAt;
  try {
    await registerVerifiedEvmWallet(input.database, { profileId: profile.id, address, chainId: Number(row.chain_id), network: row.network, verifiedAt });
  } catch (error) {
    if (error instanceof WalletAlreadyLinkedError) throw new WalletBalanceVerificationError("このウォレットは別のHubアカウントに紐づいています。");
    throw error;
  }
  return { linked: true, link: { address, chainId: Number(row.chain_id), network: row.network, visibility: "private" as const, verifiedAt } };
}

export { WalletBalanceInputError, WalletBalanceNetworkError, WalletBalanceVerificationError };
