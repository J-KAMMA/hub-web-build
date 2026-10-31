/*
 * Hub -> services/account storage client (docs/hub-storage-plans/PLAN.md 1.1, 1.4).
 * Wire contract: services/account/src/storage-api.ts (commit 32f941768).
 *
 *   POST <account origin>/api/v1/storage/service/{reserve|commit|release|adopt}
 *   body {"claim":"<EdDSA JWT>"}
 *
 * Claims: iss "jkamma-hub", aud "jkamma-account", sub = Hub-audience pairwise subject,
 * purpose storage_<action>, iat/exp (exp - iat <= 60s), jti (single use) plus per-action
 * claims. Every attempt, including every outbox retry, signs a fresh claim: a replayed jti
 * is refused with 409 claim_replayed.
 *
 * The signing key is a Hub secret (HUB_STORAGE_SIGNING_KEY, base64 PKCS8 Ed25519). Without it,
 * or without HUB_ACCOUNT_STORAGE_ORIGIN, every call is `unavailable`, so uploads by
 * Account-linked profiles fail closed. Hub never learns the common Account id.
 */

export type HubStorageAccountReserveInput = {
  /** Hub-audience opaque pairwise subject. */
  subject: string;
  bytes: number;
  /** `${objectKind}:${objectId}`; matches ^[A-Za-z0-9_.:-]{8,128}$. */
  idempotencyKey: string;
};

export type HubStorageAccountReserveResult =
  | { ok: true; reservationId: string; limitBytes: number | null; /** committed + reserved, including this reservation */ usedBytes: number | null }
  | { ok: false; reason: "over_limit"; limitBytes: number | null; usedBytes: number | null }
  | { ok: false; reason: "unavailable" };

export type HubStorageAccountCommitInput = {
  subject: string;
  reservationId: string;
  /** The size actually stored; at most the reserved size. */
  bytes: number;
};

export type HubStorageAccountReleaseInput = {
  subject: string;
  /** Valid for both an unused reservation and a committed object. */
  reservationId: string;
};

export type HubStorageAccountAdoptInput = {
  subject: string;
  bytes: number;
  idempotencyKey: string;
};

export type HubStorageAccountAck =
  | { ok: true; reservationId?: string }
  | { ok: false; reason: "unavailable" | "expired" };

export interface HubStorageAccountClient {
  reserve(input: HubStorageAccountReserveInput): Promise<HubStorageAccountReserveResult>;
  commit(input: HubStorageAccountCommitInput): Promise<HubStorageAccountAck>;
  release(input: HubStorageAccountReleaseInput): Promise<HubStorageAccountAck>;
  /** Counts bytes with no limit check (account-move imports). Returns the reservation id to release later. */
  adopt(input: HubStorageAccountAdoptInput): Promise<HubStorageAccountAck>;
  /**
   * Reads the person's plan and usage (Account `storage/service/status`). Optional so older test
   * doubles still satisfy the interface; a client without it is treated as unavailable.
   */
  status?(input: HubStorageAccountStatusInput): Promise<HubStorageAccountStatusResult>;
}

export type HubStorageAccountStatusInput = { subject: string };
export type HubStorageAccountStatusResult =
  | { ok: true; planCode: string; state: string; limitBytes: number | null; usedBytes: number | null; planUntil?: string | null; renewal?: "manual" | "auto"; nextRenewalAt?: string | null; byService?: { service: string; committedBytes: number; reservedBytes: number }[] }
  | { ok: false; reason: "unavailable" };

export type HubStorageAccountTransport = {
  /** Account origin; a path prefix is allowed. */
  origin: string;
  /** base64 PKCS8 Ed25519 private key (a Hub secret). */
  signingKeyPkcs8Base64: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  nowSeconds?: () => number;
};

const CLAIM_LIFETIME_SECONDS = 60;

const unavailableClient: HubStorageAccountClient = {
  async reserve() { return { ok: false, reason: "unavailable" }; },
  async commit() { return { ok: false, reason: "unavailable" }; },
  async release() { return { ok: false, reason: "unavailable" }; },
  async adopt() { return { ok: false, reason: "unavailable" }; },
  async status() { return { ok: false, reason: "unavailable" }; },
};

const base64Url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
const textBase64Url = (value: unknown) => base64Url(new TextEncoder().encode(JSON.stringify(value)));

export function createHubStorageAccountClient(transport: HubStorageAccountTransport): HubStorageAccountClient {
  let keyPromise: Promise<CryptoKey> | null = null;
  const signingKey = () => keyPromise ??= crypto.subtle.importKey(
    "pkcs8",
    Uint8Array.from(atob(transport.signingKeyPkcs8Base64), (character) => character.charCodeAt(0)),
    { name: "Ed25519" },
    false,
    ["sign"],
  );

  const claim = async (subject: string, purpose: string, extra: Record<string, unknown>): Promise<string> => {
    const iat = Math.floor((transport.nowSeconds?.() ?? Date.now() / 1000));
    const header = textBase64Url({ alg: "EdDSA", typ: "JWT" });
    const claims = textBase64Url({
      iss: "jkamma-hub", aud: "jkamma-account", sub: subject, purpose,
      iat, exp: iat + CLAIM_LIFETIME_SECONDS, jti: crypto.randomUUID(), ...extra,
    });
    const signature = await crypto.subtle.sign("Ed25519", await signingKey(), new TextEncoder().encode(`${header}.${claims}`));
    return `${header}.${claims}.${base64Url(new Uint8Array(signature))}`;
  };

  const call = async (action: string, subject: string, extra: Record<string, unknown>): Promise<{ status: number; json: Record<string, unknown> | null } | null> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), transport.timeoutMs ?? 5000);
    try {
      const body = JSON.stringify({ claim: await claim(subject, `storage_${action}`, extra) });
      const response = await (transport.fetcher ?? fetch)(`${transport.origin.replace(/\/+$/u, "")}/api/v1/storage/service/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        signal: controller.signal,
        redirect: "manual",
      });
      const json = await response.json().catch(() => null) as Record<string, unknown> | null;
      return { status: response.status, json: json && typeof json === "object" ? json : null };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };
  const count = (value: unknown): number | null => (Number.isSafeInteger(value) && (value as number) >= 0 ? (value as number) : null);
  const reservationId = (json: Record<string, unknown> | null) => typeof json?.reservationId === "string" && json.reservationId.length > 0 && json.reservationId.length <= 64 ? json.reservationId : undefined;

  return {
    async reserve(input) {
      const reply = await call("reserve", input.subject, { key: input.idempotencyKey, bytes: input.bytes });
      if (!reply) return { ok: false, reason: "unavailable" };
      if (reply.status === 409 && reply.json?.error === "storage_limit_exceeded") {
        return { ok: false, reason: "over_limit", limitBytes: count(reply.json.limitBytes), usedBytes: count(reply.json.usedBytes) };
      }
      const id = reservationId(reply.json);
      if (reply.status === 200 && id) return { ok: true, reservationId: id, limitBytes: count(reply.json?.limitBytes), usedBytes: count(reply.json?.usedBytes) };
      return { ok: false, reason: "unavailable" };
    },
    async commit(input) {
      const reply = await call("commit", input.subject, { reservationId: input.reservationId, bytes: input.bytes });
      if (reply?.status === 200) return { ok: true };
      if (reply?.status === 410 && reply.json?.error === "reservation_expired") return { ok: false, reason: "expired" };
      return { ok: false, reason: "unavailable" };
    },
    async release(input) {
      const reply = await call("release", input.subject, { reservationId: input.reservationId });
      // Already gone on Account's side counts as released.
      return reply?.status === 200 || reply?.status === 404 ? { ok: true } : { ok: false, reason: "unavailable" };
    },
    async adopt(input) {
      const reply = await call("adopt", input.subject, { key: input.idempotencyKey, bytes: input.bytes });
      const id = reservationId(reply?.json ?? null);
      return reply?.status === 200 && id ? { ok: true, reservationId: id } : { ok: false, reason: "unavailable" };
    },
    async status(input) {
      const reply = await call("status", input.subject, {});
      const planCode = reply?.json?.planCode;
      const state = reply?.json?.state;
      if (reply?.status !== 200 || typeof planCode !== "string" || typeof state !== "string") return { ok: false, reason: "unavailable" };
      const planUntil = typeof reply.json?.planUntil === "string" ? reply.json.planUntil : null;
      const rows = Array.isArray(reply.json?.byService) ? (reply.json.byService as Record<string, unknown>[]) : [];
      const byService = rows.flatMap((row) => {
        const committed = count(row?.committedBytes);
        const reserved = count(row?.reservedBytes);
        return typeof row?.service === "string" && committed !== null && reserved !== null ? [{ service: row.service, committedBytes: committed, reservedBytes: reserved }] : [];
      });
      // 更新の方式と次の更新時刻だけ（Account が持つ）。額・トークン・アドレスは来ない。読めなければ載せない。
      const nextRaw = reply.json?.nextRenewalAt;
      const nextRenewalAt = typeof nextRaw === "string" && Number.isFinite(Date.parse(nextRaw)) ? nextRaw : null;
      const renewal = reply.json?.renewal === "auto" && nextRenewalAt ? "auto" : reply.json?.renewal === "manual" ? "manual" : undefined;
      return { ok: true, planCode, state, limitBytes: count(reply.json?.limitBytes), usedBytes: count(reply.json?.usedBytes), planUntil, byService, ...(renewal ? { renewal, nextRenewalAt: renewal === "auto" ? nextRenewalAt : null } : {}) };
    },
  };
}

let configured: HubStorageAccountClient | null = null;
let fromEnv: HubStorageAccountClient | null = null;

export function setHubStorageAccountClientForTesting(client: HubStorageAccountClient | null): void {
  configured = client;
}

/** The client used by the upload paths: a test override, else one built from the environment, else fail closed. */
export function getHubStorageAccountClient(): HubStorageAccountClient {
  if (configured) return configured;
  const origin = process.env.HUB_ACCOUNT_STORAGE_ORIGIN?.trim();
  const key = process.env.HUB_STORAGE_SIGNING_KEY?.trim();
  if (!origin || !key) return unavailableClient;
  return fromEnv ??= createHubStorageAccountClient({ origin, signingKeyPkcs8Base64: key });
}
