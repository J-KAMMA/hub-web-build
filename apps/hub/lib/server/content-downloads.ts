/**
 * Content downloads (2026-10-17, owner-approved; docs/hub-downloads/DESIGN.md).
 *
 * Every download is authorized here, server-side, at request time: the creator's setting, the
 * viewer's entitlement (Hub's own token-gate check), the copyright hold and hidden state, and the
 * publish state. Only then does Hub record a download grant and sign a short-lived, single-use,
 * download-purpose ticket for the owning service, whose `jti` is the grant ID. The service embeds
 * that opaque ID as the watermark. Anything that cannot be read closes.
 *
 * This module keeps no `@/` imports so the Video and Music Workers' tests can run it against the
 * real Workers. Files (content-files.ts) and images (content-download-images.ts) live elsewhere
 * because they need Hub-only modules; they share the setting and grant helpers below.
 */

import type { D1Database } from "@cloudflare/workers-types";

import {
  isContentDownloadPolicy,
  normalizeContentDownloadPolicy,
  DEFAULT_CONTENT_DOWNLOAD_POLICY,
  type ContentDownloadKind,
  type ContentDownloadPolicy,
  type ContentDownloadTargetType,
} from "../content-download-policy";
import { isHubVideoAssetId, signHubVideoTicket } from "./hub-video-ticket";
import { isMusicTrackId, signHubMusicTicket } from "./hub-music-ticket";

/** How long Hub keeps the watermark ID → download mapping. */
export const DOWNLOAD_GRANT_RETENTION_DAYS = 365;
/** Ticket lifetime: long enough to start a download, short enough to be useless when shared. */
export const DOWNLOAD_TICKET_LIFETIME_SECONDS = 120;

export class ContentDownloadError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) {
    super(message);
    this.name = "ContentDownloadError";
  }
}

const notFound = () => new ContentDownloadError("not_found", 404, "見つかりません。");
const notAllowed = () => new ContentDownloadError("download_not_allowed", 403, "作者はダウンロードを許可していません。");
const locked = () => new ContentDownloadError("locked", 403, "ダウンロードの条件を満たしていません。");
const signInRequired = () => new ContentDownloadError("authentication_required", 401, "ログインが必要です。");
const gateUnavailable = () => new ContentDownloadError("gate_unavailable", 503, "閲覧条件を確認できませんでした。");
const unavailable = () => new ContentDownloadError("downloads_unavailable", 503, "ダウンロードを準備できませんでした。");

export type DownloadGateOutcome = "granted" | "locked" | "unavailable" | "no_gate";

export type MusicTrackInfo = { id: string; downloadPolicy: unknown };

export type ContentDownloadDeps = {
  /** Hub secret `HUB_VIDEO_TICKET_PRIVATE_KEY_PKCS8`; null closes video downloads. */
  videoTicketKey: string | null;
  /** Hub secret `HUB_MUSIC_TICKET_PRIVATE_KEY_PKCS8`; null closes music downloads. */
  musicTicketKey: string | null;
  /** Hub's own token-gate check of this viewer against the gate on this video. */
  checkVideoGate(database: D1Database, input: { videoId: string; viewerProfileId: string }): Promise<DownloadGateOutcome>;
  /**
   * Music's public metadata for a track that Music currently delivers (published, clean, ready,
   * not hidden), or null. Throws when Music cannot be reached.
   */
  readMusicTrack(trackId: string): Promise<MusicTrackInfo | null>;
  now?: () => Date;
};

export type IssuedDownload = { url: string; expiresAt: string };

/* ----------------------------------------------------------------- settings */

const TARGET_TYPES: readonly ContentDownloadTargetType[] = ["post", "article", "video"];

export function parseDownloadTarget(targetType: unknown, targetId: unknown): { targetType: ContentDownloadTargetType; targetId: string } {
  if (typeof targetType !== "string" || !(TARGET_TYPES as readonly string[]).includes(targetType)) {
    throw new ContentDownloadError("invalid_target", 400, "対象の種類が正しくありません。");
  }
  if (typeof targetId !== "string" || targetId.length < 1 || targetId.length > 128 || /[\u0000-\u001f\u007f]/.test(targetId)) {
    throw new ContentDownloadError("invalid_target", 400, "対象のIDが正しくありません。");
  }
  return { targetType: targetType as ContentDownloadTargetType, targetId };
}

/** The saved setting, or the default. A value the database should never hold also closes. */
export async function readDownloadPolicy(
  database: D1Database,
  target: { targetType: ContentDownloadTargetType; targetId: string },
): Promise<{ policy: ContentDownloadPolicy; saved: boolean }> {
  const row = await database
    .prepare("SELECT policy FROM content_download_settings WHERE target_type = ? AND target_id = ? LIMIT 1")
    .bind(target.targetType, target.targetId)
    .first<{ policy: string }>();
  if (!row) return { policy: DEFAULT_CONTENT_DOWNLOAD_POLICY, saved: false };
  return { policy: isContentDownloadPolicy(row.policy) ? row.policy : DEFAULT_CONTENT_DOWNLOAD_POLICY, saved: true };
}

async function targetAuthor(
  database: D1Database,
  target: { targetType: ContentDownloadTargetType; targetId: string },
): Promise<string | null> {
  const query =
    target.targetType === "post"
      ? "SELECT author_profile_id AS owner FROM social_posts WHERE id = ? LIMIT 1"
      : target.targetType === "article"
        ? "SELECT author_profile_id AS owner FROM hub_user_articles WHERE id = ? LIMIT 1"
        : "SELECT profile_id AS owner FROM hub_videos WHERE id = ? AND state <> 'deleted' LIMIT 1";
  const row = await database.prepare(query).bind(target.targetId).first<{ owner: string | null }>();
  return row?.owner ?? null;
}

/** Author only. CC works may be set to "none"; the form shows a notice, the server does not block. */
export async function setDownloadPolicy(
  database: D1Database,
  profileId: string,
  target: { targetType: unknown; targetId: unknown },
  value: unknown,
  now = new Date(),
): Promise<{ targetType: ContentDownloadTargetType; targetId: string; policy: ContentDownloadPolicy }> {
  const parsed = parseDownloadTarget(target.targetType, target.targetId);
  const policy = value === undefined || value === null || value === "" ? null : normalizeContentDownloadPolicy(value);
  if (!policy) throw new ContentDownloadError("invalid_policy", 400, "ダウンロードの設定が正しくありません。");
  const author = await targetAuthor(database, parsed);
  if (!author) throw notFound();
  if (author !== profileId) throw new ContentDownloadError("forbidden", 403, "作者だけが設定できます。");
  await database
    .prepare(`INSERT INTO content_download_settings (target_type, target_id, policy, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(target_type, target_id) DO UPDATE SET policy = excluded.policy, updated_at = excluded.updated_at`)
    .bind(parsed.targetType, parsed.targetId, policy, now.toISOString())
    .run();
  return { ...parsed, policy };
}

/* ------------------------------------------------------------------- grants */

/**
 * Record the grant before signing. The returned ID is the ticket's `jti` and the watermark: a
 * random v4 UUID. Hub alone maps it back to the profile, until purge_after.
 */
export async function recordDownloadGrant(
  database: D1Database,
  input: {
    profileId: string | null;
    kind: ContentDownloadKind;
    objectId: string;
    targetType: ContentDownloadTargetType | "music";
    targetId: string;
    lifetimeSeconds?: number;
    now?: Date;
  },
): Promise<{ id: string; expiresAt: string }> {
  const now = input.now ?? new Date();
  const id = crypto.randomUUID();
  const expiresAt = new Date(now.getTime() + (input.lifetimeSeconds ?? DOWNLOAD_TICKET_LIFETIME_SECONDS) * 1000).toISOString();
  const purgeAfter = new Date(now.getTime() + DOWNLOAD_GRANT_RETENTION_DAYS * 86_400_000).toISOString();
  try {
    await database
      .prepare(`INSERT INTO hub_download_grants (id, profile_id, object_kind, object_id, target_type, target_id, issued_at, expires_at, purge_after)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, input.profileId, input.kind, input.objectId, input.targetType, input.targetId, now.toISOString(), expiresAt, purgeAfter)
      .run();
  } catch {
    throw unavailable();
  }
  return { id, expiresAt };
}

/** Undo a grant whose ticket could not be signed, so the mapping holds only real downloads. */
export async function discardDownloadGrant(database: D1Database, id: string): Promise<void> {
  await database.prepare("DELETE FROM hub_download_grants WHERE id = ?").bind(id).run().catch(() => undefined);
}

/**
 * Decide a Hub-owned work's download for one viewer after visibility has been settled.
 * `gate` is the gate check result for this viewer ("no_gate" when the work has none).
 */
export function decideDownload(input: {
  policy: ContentDownloadPolicy;
  isAuthor: boolean;
  viewerProfileId: string | null;
  gate: DownloadGateOutcome;
}): "allowed" | "not_allowed" | "locked" | "sign_in" | "gate_unavailable" {
  if (input.isAuthor) return "allowed";
  if (input.policy === "none") return "not_allowed";
  // A gate always applies first, whatever the setting says.
  if (input.gate === "unavailable") return "gate_unavailable";
  if (input.gate === "locked") return "locked";
  if (input.policy === "anyone") return "allowed";
  // "entitled": a passed gate is the only entitlement Hub can verify today.
  if (input.gate === "granted") return "allowed";
  return input.viewerProfileId ? "locked" : "sign_in";
}

export function throwForDecision(decision: ReturnType<typeof decideDownload>): void {
  if (decision === "allowed") return;
  if (decision === "not_allowed") throw notAllowed();
  if (decision === "gate_unavailable") throw gateUnavailable();
  if (decision === "sign_in") throw signInRequired();
  throw locked();
}

/* -------------------------------------------------------------------- video */

type VideoRow = {
  id: string;
  profile_id: string;
  asset_id: string;
  state: string;
  hold_reason: string | null;
  visibility: string;
  age_restricted: number;
};

async function readVideo(database: D1Database, videoId: string): Promise<VideoRow | null> {
  return database
    .prepare("SELECT id, profile_id, asset_id, state, hold_reason, visibility, age_restricted FROM hub_videos WHERE id = ? LIMIT 1")
    .bind(videoId)
    .first<VideoRow>();
}

/**
 * A `video.download` ticket for a published, not held video, after the same visibility checks as
 * playback (age restriction, followers, gate) and then the creator's download setting.
 */
export async function issueVideoDownload(
  database: D1Database,
  deps: ContentDownloadDeps,
  viewerProfileId: string | null,
  videoId: unknown,
): Promise<IssuedDownload> {
  if (!deps.videoTicketKey) throw unavailable();
  if (typeof videoId !== "string" || videoId.length !== 36) throw notFound();
  const row = await readVideo(database, videoId);
  if (!row || row.state !== "published" || row.hold_reason !== null || !isHubVideoAssetId(row.asset_id)) throw notFound();
  const isAuthor = viewerProfileId !== null && viewerProfileId === row.profile_id;

  if (row.age_restricted === 1 && !isAuthor) {
    if (!viewerProfileId) throw signInRequired();
    const opted = await database
      .prepare("SELECT enabled FROM profile_adult_opt_in WHERE profile_id = ? LIMIT 1")
      .bind(viewerProfileId)
      .first<{ enabled: number }>()
      .catch(() => {
        throw unavailable();
      });
    if (opted?.enabled !== 1) throw new ContentDownloadError("age_restricted", 403, "この動画は年齢制限があります。");
  }
  if (row.visibility === "followers" && !isAuthor) {
    const follows = viewerProfileId
      ? await database
          .prepare("SELECT 1 AS ok FROM follows WHERE follower_profile_id = ? AND followed_profile_id = ? LIMIT 1")
          .bind(viewerProfileId, row.profile_id)
          .first<{ ok: number }>()
          .catch(() => null)
      : null;
    if (!follows) throw notFound();
  }

  let gate: DownloadGateOutcome = "no_gate";
  if (!isAuthor && viewerProfileId) {
    try {
      gate = await deps.checkVideoGate(database, { videoId: row.id, viewerProfileId });
    } catch {
      gate = "unavailable";
    }
  } else if (!isAuthor && row.visibility === "gated") {
    throw signInRequired();
  }
  // A gated video without a gate shows to nobody (playback fails closed the same way).
  if (row.visibility === "gated" && gate === "no_gate" && !isAuthor) throw notFound();

  const { policy } = await readDownloadPolicy(database, { targetType: "video", targetId: row.id }).catch(() => {
    throw unavailable();
  });
  throwForDecision(decideDownload({ policy, isAuthor, viewerProfileId, gate }));

  // Re-read: an unpublish or a copyright hold that ran during the checks closes the ticket too.
  const current = await readVideo(database, row.id);
  if (!current || current.state !== "published" || current.hold_reason !== null || current.asset_id !== row.asset_id) throw notFound();

  const now = deps.now?.() ?? new Date();
  const grant = await recordDownloadGrant(database, {
    profileId: viewerProfileId,
    kind: "video",
    objectId: row.asset_id,
    targetType: "video",
    targetId: row.id,
    now,
  });
  try {
    const signed = await signHubVideoTicket({
      assetId: row.asset_id,
      purpose: "video.download",
      privateKeyPkcs8: deps.videoTicketKey,
      jti: grant.id,
      lifetimeSeconds: DOWNLOAD_TICKET_LIFETIME_SECONDS,
      now,
    });
    return { url: `${signed.request!.path}?ticket=${encodeURIComponent(signed.ticket)}`, expiresAt: signed.expiresAt };
  } catch {
    await discardDownloadGrant(database, grant.id);
    throw unavailable();
  }
}

/* -------------------------------------------------------------------- music */

/**
 * A `music.download` ticket. Music owns the track, its publish and hidden state and its setting;
 * Hub reads them from Music's public API at request time and Music checks them again. Music has
 * no purchase or gate, so only "anyone" opens a download ("entitled" has nothing to verify).
 */
export async function issueMusicDownload(
  database: D1Database,
  deps: ContentDownloadDeps,
  viewerProfileId: string | null,
  trackId: unknown,
): Promise<IssuedDownload> {
  if (!deps.musicTicketKey) throw unavailable();
  if (!isMusicTrackId(trackId)) throw notFound();
  let track: MusicTrackInfo | null;
  try {
    track = await deps.readMusicTrack(trackId);
  } catch {
    throw unavailable();
  }
  if (!track || track.id !== trackId) throw notFound();
  if (track.downloadPolicy !== "anyone") throw notAllowed();

  const now = deps.now?.() ?? new Date();
  const grant = await recordDownloadGrant(database, {
    profileId: viewerProfileId,
    kind: "music",
    objectId: trackId,
    targetType: "music",
    targetId: trackId,
    now,
  });
  try {
    const signed = await signHubMusicTicket({
      trackId,
      privateKeyPkcs8: deps.musicTicketKey,
      jti: grant.id,
      lifetimeSeconds: DOWNLOAD_TICKET_LIFETIME_SECONDS,
      now,
    });
    return { url: `${signed.path}?ticket=${encodeURIComponent(signed.ticket)}`, expiresAt: signed.expiresAt };
  } catch {
    await discardDownloadGrant(database, grant.id);
    throw unavailable();
  }
}

/** Music's track list answers only deliverable tracks; one ID in, at most one track out. */
export function musicTrackReader(send: ((path: string) => Promise<Response>) | null): ContentDownloadDeps["readMusicTrack"] {
  return async (trackId) => {
    if (!send) throw new Error("music_unconfigured");
    const response = await send(`/music/api/tracks?ids=${encodeURIComponent(trackId)}`);
    if (!response.ok) throw new Error("music_unavailable");
    const body = (await response.json()) as { tracks?: Array<{ id?: unknown; downloadPolicy?: unknown }> };
    const track = Array.isArray(body.tracks) ? body.tracks.find((item) => item?.id === trackId) : undefined;
    return track ? { id: trackId, downloadPolicy: track.downloadPolicy } : null;
  };
}
