import { NextResponse } from "next/server";

import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getHubD1 } from "@/lib/server/hub-d1";
import {
  HubAuthenticationError,
  requireHubSessionProfile,
} from "@/lib/server/hub-session";
import { verifySelectiveCredentialProof } from "@/lib/server/selective-credential-proof";

const TYPES = new Set(["adult_verified", "seller_verified"]);
const NO_STORE = { "cache-control": "private, no-store" };

function error(code: string, status: number) {
  return NextResponse.json({ error: code }, { status, headers: NO_STORE });
}

function parseType(value: unknown): "adult_verified" | "seller_verified" | null {
  return typeof value === "string" && TYPES.has(value)
    ? value as "adult_verified" | "seller_verified"
    : null;
}

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return error("untrusted_origin", 403);
  const input = await request.json().catch(() => null) as {
    credentialType?: unknown;
  } | null;
  const credentialType = parseType(input?.credentialType);
  if (!credentialType) return error("unsupported_credential_type", 400);
  try {
    const database = getHubD1();
    const profile = await requireHubSessionProfile(request, database);
    const challenge = crypto.randomUUID();
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + 5 * 60 * 1000);
    await database.batch([
      database.prepare(
        "DELETE FROM hub_selective_credential_challenges WHERE expires_at < ?",
      ).bind(createdAt.toISOString()),
      database.prepare(
        `INSERT INTO hub_selective_credential_challenges
         (challenge,profile_id,credential_type,created_at,expires_at,consumed_at)
         VALUES (?,?,?,?,?,NULL)`,
      ).bind(
        challenge,
        profile.id,
        credentialType,
        createdAt.toISOString(),
        expiresAt.toISOString(),
      ),
    ]);
    return NextResponse.json(
      {
        challenge,
        credentialType,
        audience: "jkamma-hub",
        expiresAt: expiresAt.toISOString(),
      },
      { status: 201, headers: NO_STORE },
    );
  } catch (cause) {
    if (cause instanceof HubAuthenticationError) return error("authentication_required", 401);
    return error("credential_challenge_unavailable", 503);
  }
}

export async function PUT(request: Request) {
  if (!hasSameOrigin(request)) return error("untrusted_origin", 403);
  const input = await request.json().catch(() => null) as {
    proof?: unknown; challenge?: unknown;
  } | null;
  if (
    typeof input?.challenge !== "string"
    || !/^[0-9a-f-]{36}$/i.test(input.challenge)
  ) return error("invalid_credential_challenge", 400);
  const publicKey = process.env.IDENTITY_HUB_CREDENTIAL_PUBLIC_KEY_SPKI?.trim() ?? "";
  const statusBaseUrl = process.env.IDENTITY_PUBLIC_URL?.trim() ?? "";
  if (!publicKey || !statusBaseUrl) return error("credential_verification_unavailable", 503);
  try {
    const database = getHubD1();
    const profile = await requireHubSessionProfile(request, database);
    const challenge = await database.prepare(
      `SELECT challenge,credential_type credentialType,expires_at expiresAt,consumed_at consumedAt
       FROM hub_selective_credential_challenges
       WHERE challenge=? AND profile_id=?`,
    ).bind(input.challenge, profile.id).first<{
      challenge: string; credentialType: string; expiresAt: string; consumedAt: string | null;
    }>();
    if (
      !challenge
      || challenge.consumedAt
      || Date.parse(challenge.expiresAt) <= Date.now()
    ) return error("credential_challenge_expired_or_used", 409);
    const claims = await verifySelectiveCredentialProof(
      input.proof,
      challenge.challenge,
      publicKey,
    );
    if (!claims || claims.credentialType !== challenge.credentialType) {
      return error("invalid_selective_credential", 422);
    }
    const statusUrl = new URL("/credentials/hub/status", statusBaseUrl);
    statusUrl.searchParams.set("jti", claims.jti);
    const statusResponse = await fetch(statusUrl, {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(4_000),
    });
    const status = await statusResponse.json().catch(() => null) as {
      jti?: unknown; status?: unknown; expires_at?: unknown;
    } | null;
    if (
      !statusResponse.ok
      || status?.jti !== claims.jti
      || status.status !== "active"
      || typeof status.expires_at !== "string"
      || Date.parse(status.expires_at) <= Date.now()
    ) return error("credential_status_unavailable_or_inactive", 503);
    const now = new Date().toISOString();
    const expiresAt = new Date(
      Math.min(claims.expiresAt * 1000, Date.parse(status.expires_at)),
    ).toISOString();
    await database.batch([
      database.prepare(
        `UPDATE hub_selective_credential_challenges SET consumed_at=?
         WHERE challenge=? AND profile_id=? AND consumed_at IS NULL`,
      ).bind(now, challenge.challenge, profile.id),
      database.prepare(
        `INSERT INTO hub_selective_credentials
         (profile_id,credential_type,issuer,proof_jti,verified_at,expires_at,status_checked_at)
         VALUES (?,?,?,?,?,?,?)
         ON CONFLICT(profile_id,credential_type) DO UPDATE SET
           issuer=excluded.issuer,
           proof_jti=excluded.proof_jti,
           verified_at=excluded.verified_at,
           expires_at=excluded.expires_at,
           status_checked_at=excluded.status_checked_at`,
      ).bind(
        profile.id,
        claims.credentialType,
        claims.issuer,
        claims.jti,
        now,
        expiresAt,
        now,
      ),
    ]);
    return NextResponse.json(
      { credentialType: claims.credentialType, verified: true, expiresAt },
      { headers: NO_STORE },
    );
  } catch (cause) {
    if (cause instanceof HubAuthenticationError) return error("authentication_required", 401);
    return error("credential_verification_unavailable", 503);
  }
}
