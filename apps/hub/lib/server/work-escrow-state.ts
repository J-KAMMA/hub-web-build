/*
 * Commerce's signed work-escrow state reply (DESIGN 6.2, owner approved 2026-10-29).
 *
 * Hub asks, server to server and read-only: GET <commerce>/shopping/api/commerce/api/v1/work-escrows/{contractId}/state.
 * Commerce checks the chain with two RPC providers and answers with a Hub-audience EdDSA proof carrying only the
 * contract ID, the state, four deadlines, issue time, expiry (at most 5 minutes) and a unique token ID. No address,
 * amount or transaction hash. Hub verifies signature, audience, purpose, contract, expiry and replay; anything
 * else fails closed, and the page shows "確認中" instead of moving the contract.
 *
 * The reply shape is `{ "proof": "<jwt>" }`; 404 means the escrow was never created (still unfunded).
 */
import type { D1Database } from "@cloudflare/workers-types";

import { isWorkEscrowState, type WorkEscrowState } from "@/lib/work-commissions";

export const WORK_STATE_PROOF_AUDIENCE = "jkamma-hub";
export const WORK_STATE_PROOF_PURPOSE = "work-escrow-state";
export const WORK_STATE_PROOF_MAX_LIFETIME_SECONDS = 300;
export const WORK_CONTRACT_ID = /^[0-9a-f]{32}$/;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED = new Set([
  "version", "iss", "aud", "purpose", "jti", "contract_id", "state",
  "accept_by", "deliver_by", "release_at", "flag_until", "delivery_hash", "iat", "exp",
]);
/** Commerce-only names: not yet paid, not yet confirmed by two RPCs, and a split agreed by both parties. */
const EXTRA_STATES = new Set(["pending_payment", "checking", "resolved"]);
const DEADLINES = ["accept_by", "deliver_by", "release_at", "flag_until"] as const;

export type VerifiedWorkEscrowState = {
  jti: string;
  contractId: string;
  /** Commerce `pending_payment` is reported as pending_funding; `resolved` (agreed split) as refunded: the client does not receive the full delivery. */
  state: WorkEscrowState | "checking";
  acceptBy: string | null;
  deliverBy: string | null;
  releaseAt: string | null;
  flagUntil: string | null;
  deliveryHash: string | null;
  iat: number;
  exp: number;
};

const decode = (value: string) => Uint8Array.from(
  atob(value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=")),
  (character) => character.charCodeAt(0),
);

const iso = (seconds: unknown): string | null | undefined => {
  if (seconds === undefined || seconds === null) return null;
  if (typeof seconds !== "number" || !Number.isInteger(seconds) || seconds < 1_500_000_000 || seconds > 4_000_000_000) return undefined;
  return new Date(seconds * 1000).toISOString();
};

export async function verifyWorkEscrowStateProof(
  proof: unknown,
  publicKeySpkiBase64: string | undefined,
  expectedContractId: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<VerifiedWorkEscrowState | null> {
  const publicKey = publicKeySpkiBase64?.trim();
  if (!publicKey || typeof proof !== "string" || proof.length > 4_096 || !WORK_CONTRACT_ID.test(expectedContractId)) return null;
  const parts = proof.split(".");
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(new TextDecoder().decode(decode(parts[0]))) as Record<string, unknown>;
    if (header.alg !== "EdDSA" || header.typ !== "JWT") return null;
    const key = await crypto.subtle.importKey(
      "spki",
      Uint8Array.from(atob(publicKey), (character) => character.charCodeAt(0)),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    if (!await crypto.subtle.verify("Ed25519", key, decode(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`))) return null;
    const claims = JSON.parse(new TextDecoder().decode(decode(parts[1]))) as Record<string, unknown>;
    if (!claims || typeof claims !== "object" || Array.isArray(claims)) return null;
    if (!Object.keys(claims).every((name) => ALLOWED.has(name))) return null;
    if (
      claims.version !== 1
      || claims.iss !== "jkamma-commerce"
      || claims.aud !== WORK_STATE_PROOF_AUDIENCE
      || claims.purpose !== WORK_STATE_PROOF_PURPOSE
      || claims.contract_id !== expectedContractId
      || !(isWorkEscrowState(claims.state) || EXTRA_STATES.has(String(claims.state)))
      || typeof claims.jti !== "string" || !UUID.test(claims.jti)
      || !Number.isInteger(claims.iat) || !Number.isInteger(claims.exp)
      || Number(claims.iat) > nowSeconds + 30
      || Number(claims.exp) <= nowSeconds
      || Number(claims.exp) - Number(claims.iat) > WORK_STATE_PROOF_MAX_LIFETIME_SECONDS
    ) return null;
    const deadlines: Record<(typeof DEADLINES)[number], string | null> = { accept_by: null, deliver_by: null, release_at: null, flag_until: null };
    for (const name of DEADLINES) {
      const value = iso(claims[name]);
      if (value === undefined) return null;
      deadlines[name] = value;
    }
    const rawHash = claims.delivery_hash;
    if (rawHash !== undefined && rawHash !== null && (typeof rawHash !== "string" || !/^0x[0-9a-f]{64}$/i.test(rawHash))) return null;
    const deliveryHash = typeof rawHash === "string" ? rawHash.slice(2).toLowerCase() : null;
    return {
      jti: claims.jti.toLowerCase(),
      contractId: expectedContractId,
      state: claims.state === "pending_payment" ? "pending_funding" : claims.state === "resolved" ? "refunded" : (claims.state as WorkEscrowState | "checking"),
      acceptBy: deadlines.accept_by,
      deliverBy: deadlines.deliver_by,
      releaseAt: deadlines.release_at,
      flagUntil: deadlines.flag_until,
      deliveryHash,
      iat: Number(claims.iat),
      exp: Number(claims.exp),
    };
  } catch {
    return null;
  }
}

/** A proof is single-use: the second sight of a token ID fails closed. Expired rows are swept on the way. */
export async function burnWorkStateJti(database: D1Database, jti: string, expSeconds: number, now = new Date()): Promise<boolean> {
  await database.prepare("DELETE FROM work_ticket_jti WHERE expires_at <= ?").bind(now.toISOString()).run();
  const result = await database
    .prepare("INSERT OR IGNORE INTO work_ticket_jti (jti, expires_at) VALUES (?, ?)")
    .bind(jti, new Date(expSeconds * 1000).toISOString())
    .run();
  return (result.meta?.changes ?? 0) === 1;
}

export type WorkStateLookup =
  | { status: "unfunded" }
  | { status: "ok"; proof: VerifiedWorkEscrowState }
  | { status: "unavailable" };

export type WorkStateLookupDeps = {
  /** SPKI base64 of Commerce's signing key; missing means unavailable (fail closed). */
  publicKey: string | undefined;
  /** `<origin>/shopping/api/commerce` (no trailing slash). */
  baseUrl: string;
  fetch?: typeof fetch;
  now?: () => Date;
};

export function workEscrowStateUrl(baseUrl: string, contractId: string): string {
  if (!WORK_CONTRACT_ID.test(contractId)) throw new Error("invalid_contract_id");
  return `${baseUrl.replace(/\/+$/, "")}/api/v1/work-escrows/${contractId}/state`;
}

export async function lookupWorkEscrowState(contractId: string, deps: WorkStateLookupDeps): Promise<WorkStateLookup> {
  if (!deps.publicKey?.trim() || !WORK_CONTRACT_ID.test(contractId)) return { status: "unavailable" };
  try {
    const response = await (deps.fetch ?? fetch)(workEscrowStateUrl(deps.baseUrl, contractId), {
      method: "GET",
      headers: { accept: "application/json" },
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(8_000),
    });
    if (response.status === 404) return { status: "unfunded" };
    if (response.status !== 200) return { status: "unavailable" };
    const body = (await response.json().catch(() => null)) as { proof?: unknown } | null;
    const nowSeconds = Math.floor((deps.now?.() ?? new Date()).getTime() / 1000);
    const proof = await verifyWorkEscrowStateProof(body?.proof, deps.publicKey, contractId, nowSeconds);
    return proof ? { status: "ok", proof } : { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}

/** Production wiring: the Commerce public key from the environment and the same-origin edge route. */
export function workStateLookupDepsFromEnv(origin: string): WorkStateLookupDeps {
  const override = process.env.NEXT_PUBLIC_COMMERCE_API_ORIGIN?.trim();
  return {
    // Its own key: never reuse another purpose's Commerce key. Unset means unavailable (fail closed).
    publicKey: process.env.COMMERCE_WORK_STATE_PUBLIC_KEY_SPKI?.trim() || undefined,
    baseUrl: override ? override.replace(/\/+$/, "") : `${origin.replace(/\/+$/, "")}/shopping/api/commerce`,
  };
}
