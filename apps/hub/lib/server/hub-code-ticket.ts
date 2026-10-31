/**
 * Hub code tickets (docs/hub-software/PLAN.md sections 3.3 and 3.4, AGENTS.md 2026-10-16).
 *
 * Hub is the authorization source for code hosting. The Code Worker (`apps/code`) asks Hub whether
 * a Git request may read or write a repository; Hub answers with a ticket signed by this module,
 * and the Code Worker verifies it before it mints a short-lived Cloudflare Artifacts token. Hub
 * also signs the tickets that ask the Code Worker to create or delete a repository.
 *
 * The ticket carries only the repository ID, purpose, issue time, expiry and a unique ID; a
 * `code.git-write` ticket adds the push byte limit. Never add a profile ID, handle, wallet, Account
 * subject, token, token hash or collaborator relation: the Code Worker rejects unknown claims.
 *
 * The signing key `HUB_CODE_TICKET_PRIVATE_KEY_PKCS8` is separate from the file and video keys.
 * This module has no Hub-only imports so the Code Worker's tests can sign with it directly.
 */

export const HUB_CODE_TICKET_ISSUER = "jkamma-hub";
export const HUB_CODE_TICKET_AUDIENCE = "jkamma-code";
export const HUB_CODE_TICKET_TYPE = "hub-code-ticket+jwt";
export const HUB_CODE_TICKET_HEADER = "x-hub-code-ticket";
export const HUB_CODE_TICKET_MAX_LIFETIME_SECONDS = 300;
/** A Git ticket covers one HTTP request, which the Code Worker starts at once. */
export const HUB_CODE_GIT_TICKET_LIFETIME_SECONDS = 60;
export const HUB_CODE_OPERATION_TICKET_LIFETIME_SECONDS = 120;
/** Cloudflare Artifacts caps a repository at 1 GB (developers.cloudflare.com/artifacts/platform/limits/). */
export const HUB_CODE_REPOSITORY_MAX_BYTES = 1024 * 1024 * 1024;
/** One push is at most 100 MiB, the request body limit of a Worker on the Free and Pro plans. */
export const HUB_CODE_MAX_PUSH_BYTES = 100 * 1024 * 1024;

export type HubCodeTicketPurpose = "code.git-read" | "code.git-write" | "code.repo-create" | "code.repo-delete";

export type HubCodeTicketClaims = {
  iss: typeof HUB_CODE_TICKET_ISSUER;
  aud: typeof HUB_CODE_TICKET_AUDIENCE;
  purpose: HubCodeTicketPurpose;
  repo_id: string;
  iat: number;
  exp: number;
  jti: string;
  /** `code.git-write` only: the bytes Hub reserved for this push. */
  max_push_bytes?: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * Repository IDs are random UUIDs minted by Hub and double as the Artifacts repository name.
 * Never derive them from a profile, handle or repository name.
 */
export function isHubCodeRepoId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export function newHubCodeRepoId(): string {
  return crypto.randomUUID();
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function encodeJson(value: unknown): string {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify(value)));
}

function pkcs8Buffer(value: string): ArrayBuffer {
  const body = value.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  const bytes = Uint8Array.from(atob(body), (character) => character.charCodeAt(0));
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

/**
 * Sign a ticket. Call it only after Hub's own checks pass for this repository and purpose, and, for
 * a write that carries a pack, after Account has reserved `maxPushBytes` under Hub's audience.
 */
export async function signHubCodeTicket(input: {
  repoId: string;
  purpose: HubCodeTicketPurpose;
  privateKeyPkcs8: string;
  /** Required for `code.git-write` only. */
  maxPushBytes?: number;
  /** Lets Hub record the push reservation under the ticket's ID before signing. */
  jti?: string;
  lifetimeSeconds?: number;
  now?: Date;
}): Promise<{ ticket: string; claims: HubCodeTicketClaims; header: typeof HUB_CODE_TICKET_HEADER }> {
  if (!isHubCodeRepoId(input.repoId)) throw new Error("invalid_repo_id");
  const git = input.purpose === "code.git-read" || input.purpose === "code.git-write";
  const lifetime = input.lifetimeSeconds
    ?? (git ? HUB_CODE_GIT_TICKET_LIFETIME_SECONDS : HUB_CODE_OPERATION_TICKET_LIFETIME_SECONDS);
  if (!Number.isSafeInteger(lifetime) || lifetime < 1 || lifetime > HUB_CODE_TICKET_MAX_LIFETIME_SECONDS) {
    throw new Error("invalid_ticket_lifetime");
  }
  if ((input.purpose === "code.git-write") !== (input.maxPushBytes !== undefined)) {
    throw new Error("push_limit_only_on_write");
  }
  if (
    input.maxPushBytes !== undefined
    && (!Number.isSafeInteger(input.maxPushBytes) || input.maxPushBytes < 0 || input.maxPushBytes > HUB_CODE_MAX_PUSH_BYTES)
  ) {
    throw new Error("invalid_max_push_bytes");
  }
  const jti = input.jti ?? crypto.randomUUID();
  if (!UUID.test(jti)) throw new Error("invalid_jti");
  const secret = input.privateKeyPkcs8.trim();
  if (!secret) throw new Error("ticket_key_unconfigured");

  const iat = Math.floor((input.now ?? new Date()).getTime() / 1000);
  const claims: HubCodeTicketClaims = {
    iss: HUB_CODE_TICKET_ISSUER,
    aud: HUB_CODE_TICKET_AUDIENCE,
    purpose: input.purpose,
    repo_id: input.repoId,
    iat,
    exp: iat + lifetime,
    jti,
    ...(input.maxPushBytes !== undefined ? { max_push_bytes: input.maxPushBytes } : {}),
  };
  const signingInput = `${encodeJson({ alg: "EdDSA", typ: HUB_CODE_TICKET_TYPE })}.${encodeJson(claims)}`;
  const key = await crypto.subtle.importKey("pkcs8", pkcs8Buffer(secret), { name: "Ed25519" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("Ed25519", key, new TextEncoder().encode(signingInput)));
  return { ticket: `${signingInput}.${base64UrlEncode(signature)}`, claims, header: HUB_CODE_TICKET_HEADER };
}

/**
 * Hub reading back a ticket it signed itself (the Code Worker returns a `code.git-write` ticket in
 * its push report). The signature is checked with the public half of Hub's own key; expiry is not,
 * because a large push may finish after the ticket that started it expired. Callers must still
 * match `jti` against the reservation they recorded.
 */
export async function readOwnHubCodeTicket(ticket: string, privateKeyPkcs8: string): Promise<HubCodeTicketClaims | null> {
  if (typeof ticket !== "string" || ticket.length > 2048) return null;
  const parts = ticket.split(".");
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[0]))) as Record<string, unknown>;
    if (header.alg !== "EdDSA" || header.typ !== HUB_CODE_TICKET_TYPE) return null;
    const privateKey = await crypto.subtle.importKey("pkcs8", pkcs8Buffer(privateKeyPkcs8.trim()), { name: "Ed25519" }, true, ["sign"]);
    const jwk = await crypto.subtle.exportKey("jwk", privateKey);
    if (typeof jwk.x !== "string") return null;
    const publicKey = await crypto.subtle.importKey("jwk", { kty: "OKP", crv: "Ed25519", x: jwk.x }, { name: "Ed25519" }, false, ["verify"]);
    const valid = await crypto.subtle.verify("Ed25519", publicKey, base64UrlDecode(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    if (!valid) return null;
    const claims = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[1]))) as HubCodeTicketClaims;
    if (claims.iss !== HUB_CODE_TICKET_ISSUER || claims.aud !== HUB_CODE_TICKET_AUDIENCE || !isHubCodeRepoId(claims.repo_id)) return null;
    return claims;
  } catch {
    return null;
  }
}
