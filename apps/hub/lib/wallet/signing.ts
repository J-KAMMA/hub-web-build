// apps/wallet-extension/src/signing.js の移植（ethers → viem）。
// personal_sign / eth_signTypedData_v4 / hub_signProfileLink の検証とハッシュ化。

import { hashMessage, hashTypedData, hexToBytes, isAddress } from "viem";

import { analyzePersonalMessage, analyzeTypedData, type SigningRisk } from "./security-analysis";
import { HUB_PROFILE_LINK_METHOD, isTrustedHubOrigin } from "./policy";

export const HUB_PROFILE_LINK_PURPOSE = "hub_profile_wallet_link_v1";
export const HUB_PROFILE_LINK_DOMAIN_NAME = "JKamma Hub Wallet Link";
export const HUB_PROFILE_LINK_TYPES = { ProfileWalletLink: [
  { name: "purpose", type: "string" }, { name: "audience", type: "string" }, { name: "profileId", type: "string" },
  { name: "profileHandle", type: "string" }, { name: "wallet", type: "address" }, { name: "chainId", type: "uint256" },
  { name: "nonce", type: "string" }, { name: "issuedAt", type: "uint64" }, { name: "expiresAt", type: "uint64" },
] } as const;

export type SigningPreparedRequest = {
  account: string;
  hash: `0x${string}`;
  title: string;
  detailLabel: string;
  detail: string;
  risk: SigningRisk;
  warning: string;
};

type SigningState = {
  chainId: string | number;
  smartAccountAddress?: string;
  smartAccountAddresses?: Record<string, string>;
  activeSmartAccounts?: Record<string, { address?: string } | null>;
};

function activeAccount(state: SigningState): string {
  const account = state.smartAccountAddresses?.[String(state.chainId)] ?? state.smartAccountAddresses?.[state.chainId as keyof typeof state.smartAccountAddresses] ?? state.smartAccountAddress;
  const active = state.activeSmartAccounts?.[String(state.chainId)];
  if (!account || !active || active.address?.toLowerCase() !== account.toLowerCase()) throw new Error("smart_wallet_not_activated");
  return account.toLowerCase();
}

function requestedAccount(value: unknown, expected: string) {
  if (typeof value !== "string" || !isAddress(value) || value.toLowerCase() !== expected) throw new Error("signing_account_mismatch");
}

function parseTypedData(encoded: unknown): { primaryType: string; domain: Record<string, unknown>; types: Record<string, unknown>; message: Record<string, unknown> } {
  try {
    const payload = typeof encoded === "string" ? JSON.parse(encoded) : encoded;
    if (!payload || typeof payload !== "object") throw new Error();
    return payload as never;
  } catch {
    throw new Error("invalid_typed_data");
  }
}

function exactTypes(actual: Record<string, unknown>, expected: typeof HUB_PROFILE_LINK_TYPES): boolean {
  const keys = Object.keys(actual ?? {}).filter((key) => key !== "EIP712Domain");
  if (keys.length !== 1 || keys[0] !== "ProfileWalletLink") return false;
  return JSON.stringify((actual as Record<string, unknown>).ProfileWalletLink) === JSON.stringify(expected.ProfileWalletLink);
}

function prepareHubProfileLink(request: { params?: unknown[] }, state: SigningState, context: { origin?: string; now?: number }, account: string): SigningPreparedRequest {
  const [requested, encoded] = request.params ?? [];
  requestedAccount(requested, account);
  if (!context.origin || !isTrustedHubOrigin(context.origin)) throw new Error("hub_profile_link_origin_denied");
  const payload = parseTypedData(encoded);
  if (payload.primaryType !== "ProfileWalletLink" || !exactTypes(payload.types, HUB_PROFILE_LINK_TYPES)) throw new Error("invalid_hub_profile_link_schema");
  const domain = payload.domain as { name?: string; version?: string; chainId?: unknown; verifyingContract?: string };
  if (domain?.name !== HUB_PROFILE_LINK_DOMAIN_NAME || domain?.version !== "1" || BigInt(String(domain?.chainId ?? -1)) !== BigInt(state.chainId) || domain?.verifyingContract?.toLowerCase() !== account) throw new Error("invalid_hub_profile_link_domain");
  const message = payload.message as Record<string, unknown> ?? {};
  if (message.purpose !== HUB_PROFILE_LINK_PURPOSE || message.audience !== context.origin || String(message.wallet ?? "").toLowerCase() !== account || BigInt(String(message.chainId ?? -1)) !== BigInt(state.chainId)) throw new Error("invalid_hub_profile_link_scope");
  if (![message.profileId, message.profileHandle, message.nonce].every((value) => typeof value === "string" && value.length >= 1 && value.length <= 256)) throw new Error("invalid_hub_profile_link_identity");
  const issuedAt = Number(message.issuedAt); const expiresAt = Number(message.expiresAt); const nowSeconds = Math.floor((context.now ?? Date.now()) / 1000);
  if (!Number.isSafeInteger(issuedAt) || !Number.isSafeInteger(expiresAt) || expiresAt <= issuedAt || expiresAt - issuedAt > 300 || issuedAt > nowSeconds + 30 || expiresAt < nowSeconds) throw new Error("invalid_hub_profile_link_expiry");
  const hash = hashTypedData({
    domain: { name: domain.name, version: domain.version, chainId: BigInt(String(domain.chainId)), verifyingContract: domain.verifyingContract as `0x${string}` },
    types: HUB_PROFILE_LINK_TYPES,
    primaryType: "ProfileWalletLink",
    message: message as never,
  });
  return { account, hash, title: "Hubプロフィール連携の確認", detailLabel: "連携対象", detail: `${message.profileHandle} (${message.profileId}) / ${message.audience}`, risk: "caution", warning: `この署名はHubプロフィール連携専用です。nonce: ${message.nonce}、有効期限: ${new Date(expiresAt * 1000).toISOString()}` };
}

export function prepareSigningRequest(request: { method: string; params?: unknown[] }, state: SigningState, context: { origin?: string; now?: number } = {}): SigningPreparedRequest {
  const account = activeAccount(state);
  if (request.method === HUB_PROFILE_LINK_METHOD) return prepareHubProfileLink(request, state, context, account);
  if (request.method === "hub_signWalletChallenge") throw Object.assign(new Error("raw_hub_challenge_signing_removed"), { code: 4200 });
  if (request.method === "personal_sign") {
    const [message, requested] = request.params ?? [];
    requestedAccount(requested, account);
    if (typeof message !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(message)) throw new Error("invalid_personal_sign_message");
    const bytes = hexToBytes(message as `0x${string}`);
    const analysis = analyzePersonalMessage(bytes);
    return { account, hash: hashMessage({ raw: bytes }), title: "メッセージ署名の確認", detailLabel: "メッセージ", detail: analysis.summary, risk: analysis.risk, warning: analysis.warning };
  }
  if (request.method === "eth_signTypedData_v4") {
    const [requested, encoded] = request.params ?? [];
    requestedAccount(requested, account);
    const payload = parseTypedData(encoded);
    if (typeof payload.primaryType !== "string" || !payload.domain || !payload.types || !payload.message) throw new Error("invalid_typed_data");
    if (payload.domain.chainId == null || BigInt(String(payload.domain.chainId)) !== BigInt(state.chainId)) throw new Error("typed_data_chain_mismatch");
    const types = { ...payload.types };
    delete types.EIP712Domain;
    const analysis = analyzeTypedData(payload as never);
    const hash = hashTypedData({ domain: payload.domain, types, primaryType: payload.primaryType, message: payload.message } as Parameters<typeof hashTypedData>[0]);
    return { account, hash, title: "Typed Data署名の確認", detailLabel: "署名内容", detail: analysis.summary, risk: analysis.risk, warning: analysis.warning };
  }
  throw new Error("unsupported_signing_method");
}
