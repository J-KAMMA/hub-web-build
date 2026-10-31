/**
 * Hub file tickets (2026-10-15, Vault folded into Hub).
 *
 * Hub signs a short-lived, single-use ticket for exactly one file and one purpose after its own
 * server-side checks (session, ownership, token gate). The browser presents the ticket directly
 * to the file component at `/vault/api/files/*`; Hub handlers never receive or proxy file bodies.
 * The file component verifies the ticket with Hub's public key, burns the `jti`, and still checks
 * its own scan, suspension and publish state.
 *
 * The ticket carries only the file ID, purpose, issue time, expiry and a unique ID. Never add a
 * profile ID, wallet, Account subject or balance: the file component rejects unknown claims.
 *
 * This module has no Hub-only imports so the file component's tests can sign with it directly.
 */

export const HUB_FILE_TICKET_ISSUER = "jkamma-hub";
export const HUB_FILE_TICKET_AUDIENCE = "jkamma-vault-file";
export const HUB_FILE_TICKET_TYPE = "hub-file-ticket+jwt";
/** Upload, publish and unpublish carry the ticket only in this header. */
export const HUB_FILE_TICKET_HEADER = "x-hub-file-ticket";
export const HUB_FILE_TICKET_MAX_LIFETIME_SECONDS = 300;
export const HUB_FILE_TICKET_DEFAULT_LIFETIME_SECONDS = 120;
/** Path prefix that the edge routes to the file component. */
export const HUB_FILE_API_PREFIX = "/vault/api/files";

export type HubFileTicketPurpose =
  | "file_upload"
  | "file_download"
  | "file_publish"
  | "file_unpublish";

export type HubFileTicketClaims = {
  iss: typeof HUB_FILE_TICKET_ISSUER;
  aud: typeof HUB_FILE_TICKET_AUDIENCE;
  purpose: HubFileTicketPurpose;
  file_id: string;
  iat: number;
  exp: number;
  jti: string;
};

export type HubFileTicketRequest = {
  method: "GET" | "POST";
  /** Same-origin path, e.g. `/vault/api/files/<id>`. Downloads may also use `?ticket=`. */
  path: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** File IDs are random UUIDs minted by Hub; never derive them from a profile, wallet or post. */
export function isHubFileId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export function newHubFileId(): string {
  return crypto.randomUUID();
}

export function hubFileTicketRequest(
  fileId: string,
  purpose: HubFileTicketPurpose,
): HubFileTicketRequest {
  if (!isHubFileId(fileId)) throw new Error("invalid_file_id");
  const base = `${HUB_FILE_API_PREFIX}/${fileId}`;
  switch (purpose) {
    case "file_upload":
      return { method: "POST", path: base };
    case "file_download":
      return { method: "GET", path: base };
    case "file_publish":
      return { method: "POST", path: `${base}/publish` };
    case "file_unpublish":
      return { method: "POST", path: `${base}/unpublish` };
  }
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function encodeJson(value: unknown): string {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify(value)));
}

function pkcs8Bytes(value: string): Uint8Array {
  const body = value.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  return Uint8Array.from(atob(body), (character) => character.charCodeAt(0));
}

/**
 * Sign a ticket. Call it only after Hub's own server-side checks pass for this file and purpose
 * (for downloads: the post is visible and its token gate passed for the viewer).
 *
 * @param privateKeyPkcs8 Ed25519 private key, PKCS#8 base64 or PEM (Hub secret
 *   `HUB_FILE_TICKET_PRIVATE_KEY_PKCS8`). The file component holds only the public SPKI.
 */
export async function signHubFileTicket(input: {
  fileId: string;
  purpose: HubFileTicketPurpose;
  privateKeyPkcs8: string;
  lifetimeSeconds?: number;
  /**
   * `file_download` only (2026-10-17): the per-download ID Hub recorded, used as `jti` so the
   * file component can embed it in the signed manifest. A random UUID, never derived.
   */
  jti?: string;
  now?: Date;
}): Promise<{
  ticket: string;
  claims: HubFileTicketClaims;
  expiresAt: string;
  request: HubFileTicketRequest;
  header: typeof HUB_FILE_TICKET_HEADER;
}> {
  if (!isHubFileId(input.fileId)) throw new Error("invalid_file_id");
  const lifetime = input.lifetimeSeconds ?? HUB_FILE_TICKET_DEFAULT_LIFETIME_SECONDS;
  if (
    !Number.isSafeInteger(lifetime)
    || lifetime < 1
    || lifetime > HUB_FILE_TICKET_MAX_LIFETIME_SECONDS
  ) {
    throw new Error("invalid_ticket_lifetime");
  }
  if (input.jti !== undefined && (input.purpose !== "file_download" || !isHubFileId(input.jti))) {
    throw new Error("invalid_download_id");
  }
  const secret = input.privateKeyPkcs8.trim();
  if (!secret) throw new Error("ticket_key_unconfigured");

  const iat = Math.floor((input.now ?? new Date()).getTime() / 1000);
  const claims: HubFileTicketClaims = {
    iss: HUB_FILE_TICKET_ISSUER,
    aud: HUB_FILE_TICKET_AUDIENCE,
    purpose: input.purpose,
    file_id: input.fileId,
    iat,
    exp: iat + lifetime,
    jti: input.jti ?? crypto.randomUUID(),
  };
  const signingInput = `${encodeJson({ alg: "EdDSA", typ: HUB_FILE_TICKET_TYPE })}.${encodeJson(claims)}`;
  const keyBytes = pkcs8Bytes(secret);
  const keyBuffer = new ArrayBuffer(keyBytes.byteLength);
  new Uint8Array(keyBuffer).set(keyBytes);
  const key = await crypto.subtle.importKey("pkcs8", keyBuffer, { name: "Ed25519" }, false, ["sign"]);
  const signature = new Uint8Array(
    await crypto.subtle.sign("Ed25519", key, new TextEncoder().encode(signingInput)),
  );
  return {
    ticket: `${signingInput}.${base64UrlEncode(signature)}`,
    claims,
    expiresAt: new Date(claims.exp * 1000).toISOString(),
    request: hubFileTicketRequest(input.fileId, input.purpose),
    header: HUB_FILE_TICKET_HEADER,
  };
}
