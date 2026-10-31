/**
 * Hub video tickets (docs/hub-video/PLAN.md section 7.4, AGENTS.md 2026-10-15).
 *
 * Hub signs a short-lived, single-use ticket for exactly one video asset and one purpose after its
 * own server-side checks (session, ownership, visibility, follows, gate, age). The browser presents
 * the ticket directly to the Video Worker at `/video/api/v1/*`; Hub handlers never receive or proxy
 * video bodies, renditions, object keys or playback tokens.
 *
 * The ticket carries only the asset ID, purpose, issue time, expiry and a unique ID; an upload
 * ticket adds the byte limit and the output-height limit. Never add a profile ID, wallet, Account
 * subject, follow relation, gate or balance: the Video Worker rejects unknown claims.
 *
 * The signing key `HUB_VIDEO_TICKET_PRIVATE_KEY_PKCS8` is separate from the file-ticket key.
 * This module has no Hub-only imports so the Video Worker's tests can sign with it directly.
 */

export const HUB_VIDEO_TICKET_ISSUER = "jkamma-hub";
export const HUB_VIDEO_TICKET_AUDIENCE = "jkamma-video";
export const HUB_VIDEO_TICKET_TYPE = "hub-video-ticket+jwt";
export const HUB_VIDEO_TICKET_HEADER = "x-hub-video-ticket";
export const HUB_VIDEO_TICKET_MAX_LIFETIME_SECONDS = 300;
export const HUB_VIDEO_TICKET_DEFAULT_LIFETIME_SECONDS = 120;
/** Path prefix that the edge routes to the Video Worker. */
export const HUB_VIDEO_API_PREFIX = "/video/api/v1/assets";
/** 4 GiB: the per-video source limit (PLAN 2.6). */
export const HUB_VIDEO_MAX_SOURCE_BYTES = 4 * 1024 * 1024 * 1024;

export type HubVideoTicketPurpose =
  | "video.upload"
  | "video.status"
  | "video.publish"
  | "video.unpublish"
  | "video.play"
  | "video.preview"
  | "video.suspend"
  | "video.unsuspend"
  | "video.publicthumb"
  | "video.privatethumb"
  | "video.delete"
  | "video.download"
  | "video.finalize";

/** Output short-side limit: 720 for the free tier, 1080 otherwise (PLAN 6.2). */
export type HubVideoOutputHeight = 720 | 1080;

export type HubVideoTicketClaims = {
  iss: typeof HUB_VIDEO_TICKET_ISSUER;
  aud: typeof HUB_VIDEO_TICKET_AUDIENCE;
  purpose: HubVideoTicketPurpose;
  asset_id: string;
  iat: number;
  exp: number;
  jti: string;
  max_bytes?: number;
  max_height?: HubVideoOutputHeight;
  /** `video.play` only: whether the Video Worker may let segment responses be cached for 60s. */
  cache?: HubVideoPlayCache;
};

/** "public" only for public and unlisted videos; everything else is "private" (PLAN 3.2). */
export type HubVideoPlayCache = "public" | "private";

export type HubVideoTicketRequest = { method: "GET" | "POST"; path: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Asset IDs are random UUIDs minted by Hub; never derive them from a profile, wallet or post. */
export function isHubVideoAssetId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export function newHubVideoAssetId(): string {
  return crypto.randomUUID();
}

/** Where the browser presents a play ticket. The asset comes from the ticket, not the path. */
export const HUB_VIDEO_PLAY_PATH = "/video/api/v1/play";
/** Owner-only preview of a processed video that is not published (video.preview). */
export const HUB_VIDEO_PREVIEW_PATH = "/video/api/v1/preview";
/**
 * Where the browser opens a download (2026-10-17). The ticket rides in `?ticket=` because the
 * browser navigates there; the asset comes from the ticket, not the path.
 */
export const HUB_VIDEO_DOWNLOAD_PATH = "/video/api/v1/download";

/** The route each purpose authorizes. `video.finalize` is still reserved. */
export function hubVideoTicketRequest(
  assetId: string,
  purpose: HubVideoTicketPurpose,
): HubVideoTicketRequest | null {
  if (!isHubVideoAssetId(assetId)) throw new Error("invalid_asset_id");
  const base = `${HUB_VIDEO_API_PREFIX}/${assetId}`;
  switch (purpose) {
    case "video.upload":
      return { method: "POST", path: `${base}/upload` };
    case "video.status":
      return { method: "GET", path: base };
    case "video.publish":
      return { method: "POST", path: `${base}/publish` };
    case "video.unpublish":
      return { method: "POST", path: `${base}/unpublish` };
    case "video.suspend":
      return { method: "POST", path: `${base}/suspend` };
    case "video.unsuspend":
      return { method: "POST", path: `${base}/unsuspend` };
    case "video.delete":
      return { method: "POST", path: `${base}/delete` };
    case "video.publicthumb":
      return { method: "POST", path: `${base}/publicthumb` };
    case "video.privatethumb":
      return { method: "POST", path: `${base}/privatethumb` };
    case "video.play":
      return { method: "POST", path: HUB_VIDEO_PLAY_PATH };
    case "video.preview":
      return { method: "POST", path: HUB_VIDEO_PREVIEW_PATH };
    case "video.download":
      return { method: "GET", path: HUB_VIDEO_DOWNLOAD_PATH };
    case "video.finalize":
      return null;
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
 * Sign a ticket. Call it only after Hub's own server-side checks pass for this asset and purpose,
 * and, for uploads, after Account has reserved `maxBytes` under Hub's storage audience.
 */
export async function signHubVideoTicket(input: {
  assetId: string;
  purpose: HubVideoTicketPurpose;
  privateKeyPkcs8: string;
  /** Required for `video.upload` only. */
  upload?: { maxBytes: number; maxHeight: HubVideoOutputHeight };
  /** Required for `video.play` only. */
  play?: { cache: HubVideoPlayCache };
  lifetimeSeconds?: number;
  /**
   * `video.download` only: the per-download ID Hub recorded, used as `jti` so the Worker can
   * embed it as the watermark. A random UUID, never derived from a profile, wallet or subject.
   */
  jti?: string;
  now?: Date;
}): Promise<{
  ticket: string;
  claims: HubVideoTicketClaims;
  expiresAt: string;
  request: HubVideoTicketRequest | null;
  header: typeof HUB_VIDEO_TICKET_HEADER;
}> {
  if (!isHubVideoAssetId(input.assetId)) throw new Error("invalid_asset_id");
  const lifetime = input.lifetimeSeconds ?? HUB_VIDEO_TICKET_DEFAULT_LIFETIME_SECONDS;
  if (
    !Number.isSafeInteger(lifetime)
    || lifetime < 1
    || lifetime > HUB_VIDEO_TICKET_MAX_LIFETIME_SECONDS
  ) {
    throw new Error("invalid_ticket_lifetime");
  }
  if ((input.purpose === "video.upload") !== Boolean(input.upload)) {
    throw new Error("upload_limits_only_on_upload");
  }
  if ((input.purpose === "video.play") !== Boolean(input.play)) throw new Error("play_hint_only_on_play");
  if (input.jti !== undefined && (input.purpose !== "video.download" || !isHubVideoAssetId(input.jti))) {
    throw new Error("invalid_download_id");
  }
  if (input.play && input.play.cache !== "public" && input.play.cache !== "private") throw new Error("invalid_play_cache");
  if (input.upload) {
    const { maxBytes, maxHeight } = input.upload;
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > HUB_VIDEO_MAX_SOURCE_BYTES) {
      throw new Error("invalid_max_bytes");
    }
    if (maxHeight !== 720 && maxHeight !== 1080) throw new Error("invalid_max_height");
  }
  const secret = input.privateKeyPkcs8.trim();
  if (!secret) throw new Error("ticket_key_unconfigured");

  const iat = Math.floor((input.now ?? new Date()).getTime() / 1000);
  const claims: HubVideoTicketClaims = {
    iss: HUB_VIDEO_TICKET_ISSUER,
    aud: HUB_VIDEO_TICKET_AUDIENCE,
    purpose: input.purpose,
    asset_id: input.assetId,
    iat,
    exp: iat + lifetime,
    jti: input.jti ?? crypto.randomUUID(),
    ...(input.upload ? { max_bytes: input.upload.maxBytes, max_height: input.upload.maxHeight } : {}),
    ...(input.play ? { cache: input.play.cache } : {}),
  };
  const signingInput = `${encodeJson({ alg: "EdDSA", typ: HUB_VIDEO_TICKET_TYPE })}.${encodeJson(claims)}`;
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
    request: hubVideoTicketRequest(input.assetId, input.purpose),
    header: HUB_VIDEO_TICKET_HEADER,
  };
}
