import "server-only";

import {
  getCommunityMemberships,
  getCommunityTokens,
  getCurrentProfile,
  getTokenBalances
} from "@/lib/mock-data";

const PROTOCOL_VERSION = "2026-07-01";
const AUDIENCE = "hub.community-token-holdings";
const encoder = new TextEncoder();

export interface VerifiedCommunityHolding {
  tokenId: string;
  profileId: string;
  amount: number;
}

export interface CommunityHoldingVerification {
  source: "development" | "provider";
  verifiedAt: string;
  expiresAt: string;
  holdings: VerifiedCommunityHolding[];
}

async function hmacHex(secret: string, value: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function equalSignature(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

function providerEndpoint() {
  const configured = process.env.HUB_TOKEN_HOLDINGS_API?.trim();
  if (!configured) return null;
  const url = new URL(configured);
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && url.protocol === "http:" && loopback)) {
    throw new Error("Token holdings provider must use HTTPS.");
  }
  if (url.username || url.password) throw new Error("Token holdings provider URL must not contain credentials.");
  return url.toString();
}

async function developmentVerification(communityId: string): Promise<CommunityHoldingVerification> {
  const tokens = getCommunityTokens(communityId);
  const memberships = getCommunityMemberships(communityId).filter((membership) => (membership.status ?? "active") !== "banned");
  const verifiedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const holdings = memberships.flatMap((membership) => tokens.map((token) => {
    const amount = getTokenBalances(membership.profileId).find((balance) =>
      balance.symbol.toUpperCase() === token.symbol.toUpperCase() &&
      (!balance.network || balance.network.toLocaleLowerCase("en") === token.network.toLocaleLowerCase("en")) &&
      (!token.contractAddress || !balance.contractAddress || balance.contractAddress.toLocaleLowerCase("en") === token.contractAddress.toLocaleLowerCase("en"))
    )?.amount ?? 0;
    return { tokenId: token.id, profileId: membership.profileId, amount };
  }));
  return { source: "development", verifiedAt, expiresAt, holdings };
}

export async function verifyCommunityTokenHoldings(communityId: string): Promise<CommunityHoldingVerification> {
  const viewer = getCurrentProfile();
  const memberships = getCommunityMemberships(communityId).filter((membership) => (membership.status ?? "active") !== "banned");
  if (!memberships.some((membership) => membership.profileId === viewer.id)) throw new Error("Join the community before refreshing holdings.");
  const tokens = getCommunityTokens(communityId);
  if (!tokens.length) throw new Error("No community tokens are registered.");

  const endpoint = providerEndpoint();
  const secret = process.env.HUB_TOKEN_HOLDINGS_SECRET?.trim();
  if (!endpoint || !secret) {
    if (process.env.NODE_ENV === "production") throw new Error("Token holdings verification is unavailable.");
    return developmentVerification(communityId);
  }

  const subjectPairs = await Promise.all(memberships.map(async (membership) => ({
    profileId: membership.profileId,
    subject: await hmacHex(secret, `${AUDIENCE}|${membership.profileId}`)
  })));
  const subjectToProfile = new Map(subjectPairs.map((entry) => [entry.subject, entry.profileId]));
  const requestPayload = {
    version: PROTOCOL_VERSION,
    audience: AUDIENCE,
    request_id: crypto.randomUUID(),
    community_id: communityId,
    subjects: subjectPairs.map((entry) => entry.subject),
    assets: tokens.map((token) => ({ id: token.id, symbol: token.symbol, network: token.network, contract_address: token.contractAddress ?? null }))
  };
  const requestBody = JSON.stringify(requestPayload);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Hub-Holdings-Signature": await hmacHex(secret, requestBody)
    },
    body: requestBody,
    cache: "no-store",
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error("Token holdings provider rejected the request.");
  const payload = (await response.json().catch(() => null)) as null | {
    version?: string;
    claims?: Array<{ token_id?: string; subject?: string; amount?: number | string; verified_at?: string; expires_at?: string }>;
    signature?: string;
  };
  if (!payload || payload.version !== PROTOCOL_VERSION || !Array.isArray(payload.claims) || typeof payload.signature !== "string") throw new Error("Token holdings provider returned an invalid response.");
  const signedBody = JSON.stringify({ version: payload.version, claims: payload.claims });
  const expectedSignature = await hmacHex(secret, signedBody);
  if (!equalSignature(payload.signature.toLowerCase(), expectedSignature)) throw new Error("Token holdings response signature is invalid.");

  const tokenIds = new Set(tokens.map((token) => token.id));
  const now = Date.now();
  const seen = new Set<string>();
  let verifiedAt = new Date(now).toISOString();
  let expiresAt = new Date(now + 5 * 60 * 1000).toISOString();
  const holdings = payload.claims.map((claim) => {
    const profileId = claim.subject ? subjectToProfile.get(claim.subject) : undefined;
    const amount = Number(claim.amount);
    const claimVerifiedAt = Date.parse(claim.verified_at ?? "");
    const claimExpiresAt = Date.parse(claim.expires_at ?? "");
    if (!claim.token_id || !tokenIds.has(claim.token_id) || !profileId || !Number.isFinite(amount) || amount < 0) throw new Error("Token holdings response contains an invalid claim.");
    if (!Number.isFinite(claimVerifiedAt) || !Number.isFinite(claimExpiresAt) || claimVerifiedAt > now + 60_000 || claimExpiresAt <= now || claimExpiresAt > now + 15 * 60_000) throw new Error("Token holdings response is stale or has an invalid lifetime.");
    const key = `${claim.token_id}:${profileId}`;
    if (seen.has(key)) throw new Error("Token holdings response contains duplicate claims.");
    seen.add(key);
    if (claimVerifiedAt < Date.parse(verifiedAt)) verifiedAt = new Date(claimVerifiedAt).toISOString();
    if (claimExpiresAt < Date.parse(expiresAt)) expiresAt = new Date(claimExpiresAt).toISOString();
    return { tokenId: claim.token_id, profileId, amount };
  });
  return { source: "provider", verifiedAt, expiresAt, holdings };
}

export function aggregateVerifiedCommunityTokens(communityId: string, verification: CommunityHoldingVerification) {
  const viewer = getCurrentProfile();
  return getCommunityTokens(communityId).map((token) => {
    const holders = verification.holdings
      .filter((holding) => holding.tokenId === token.id && holding.amount > 0)
      .map((holding) => ({ profileId: holding.profileId, amount: holding.amount }))
      .sort((left, right) => right.amount - left.amount);
    return {
      id: token.id,
      name: token.name,
      symbol: token.symbol,
      network: token.network,
      contractAddress: token.contractAddress,
      totalAmount: holders.reduce((sum, holding) => sum + holding.amount, 0),
      holderCount: holders.length,
      viewerAmount: holders.find((holding) => holding.profileId === viewer.id)?.amount ?? 0,
      holders,
      verifiedAt: verification.verifiedAt,
      expiresAt: verification.expiresAt,
      verificationSource: verification.source
    };
  });
}
