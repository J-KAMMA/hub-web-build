/**
 * Hub music download tickets (2026-10-17, docs/hub-downloads/DESIGN.md).
 *
 * Hub signs a short-lived, single-use ticket for exactly one Music track after its own
 * server-side checks (the track is deliverable and its creator allows downloads). The browser
 * opens `/music/api/tracks/<id>/download?ticket=` directly; Hub never streams the audio. Music
 * verifies the ticket with Hub's public key, burns the `jti`, re-checks its own state, and embeds
 * the `jti` as the per-download watermark.
 *
 * The ticket carries only the track ID, purpose, issue time, expiry and a unique ID. Never add a
 * profile ID, wallet, Account subject or Music creator subject: Music rejects unknown claims.
 *
 * This module has no Hub-only imports so Music's tests can sign with it directly.
 */

export const HUB_MUSIC_TICKET_ISSUER = "jkamma-hub";
export const HUB_MUSIC_TICKET_AUDIENCE = "jkamma-music";
export const HUB_MUSIC_TICKET_TYPE = "hub-music-ticket+jwt";
export const HUB_MUSIC_TICKET_MAX_LIFETIME_SECONDS = 300;
export const HUB_MUSIC_TICKET_DEFAULT_LIFETIME_SECONDS = 120;

export type HubMusicTicketPurpose = "music.download";

export type HubMusicTicketClaims = {
  iss: typeof HUB_MUSIC_TICKET_ISSUER;
  aud: typeof HUB_MUSIC_TICKET_AUDIENCE;
  purpose: HubMusicTicketPurpose;
  track_id: string;
  iat: number;
  exp: number;
  jti: string;
};

const TRACK_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isMusicTrackId(value: unknown): value is string {
  return typeof value === "string" && TRACK_ID.test(value);
}

export function hubMusicDownloadPath(trackId: string): string {
  if (!isMusicTrackId(trackId)) throw new Error("invalid_track_id");
  return `/music/api/tracks/${trackId}/download`;
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
 * Sign a download ticket. Call it only after Hub's own checks pass for this track.
 *
 * @param privateKeyPkcs8 Ed25519 private key, PKCS#8 base64 or PEM (Hub secret
 *   `HUB_MUSIC_TICKET_PRIVATE_KEY_PKCS8`). Music holds only the public SPKI.
 * @param jti The per-download ID Hub recorded; becomes the watermark. A random v4 UUID.
 */
export async function signHubMusicTicket(input: {
  trackId: string;
  privateKeyPkcs8: string;
  jti?: string;
  lifetimeSeconds?: number;
  now?: Date;
}): Promise<{ ticket: string; claims: HubMusicTicketClaims; expiresAt: string; path: string }> {
  if (!isMusicTrackId(input.trackId)) throw new Error("invalid_track_id");
  if (input.jti !== undefined && !UUID_V4.test(input.jti)) throw new Error("invalid_download_id");
  const lifetime = input.lifetimeSeconds ?? HUB_MUSIC_TICKET_DEFAULT_LIFETIME_SECONDS;
  if (!Number.isSafeInteger(lifetime) || lifetime < 1 || lifetime > HUB_MUSIC_TICKET_MAX_LIFETIME_SECONDS) {
    throw new Error("invalid_ticket_lifetime");
  }
  const secret = input.privateKeyPkcs8.trim();
  if (!secret) throw new Error("ticket_key_unconfigured");

  const iat = Math.floor((input.now ?? new Date()).getTime() / 1000);
  const claims: HubMusicTicketClaims = {
    iss: HUB_MUSIC_TICKET_ISSUER,
    aud: HUB_MUSIC_TICKET_AUDIENCE,
    purpose: "music.download",
    track_id: input.trackId,
    iat,
    exp: iat + lifetime,
    jti: input.jti ?? crypto.randomUUID(),
  };
  const signingInput = `${encodeJson({ alg: "EdDSA", typ: HUB_MUSIC_TICKET_TYPE })}.${encodeJson(claims)}`;
  const keyBytes = pkcs8Bytes(secret);
  const keyBuffer = new ArrayBuffer(keyBytes.byteLength);
  new Uint8Array(keyBuffer).set(keyBytes);
  const key = await crypto.subtle.importKey("pkcs8", keyBuffer, { name: "Ed25519" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("Ed25519", key, new TextEncoder().encode(signingInput)));
  return {
    ticket: `${signingInput}.${base64UrlEncode(signature)}`,
    claims,
    expiresAt: new Date(claims.exp * 1000).toISOString(),
    path: hubMusicDownloadPath(input.trackId),
  };
}
