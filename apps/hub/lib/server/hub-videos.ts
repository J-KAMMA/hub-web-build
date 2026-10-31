import { normalizeTagList } from "@jkamma/content-tags";
import { indexD1ContentTags, videoCategoryTagInput } from "@/lib/server/d1-content-tags";
/**
 * Hub self-made videos, Hub side (docs/hub-video/PLAN.md sections 3, 6, 7.2; AGENTS.md 2026-10-15).
 *
 * Hub decides; the Video Worker (`apps/video`, `/video/api/v1/*`) stores, scans, processes and
 * delivers. Hub never receives, proxies or caches a video body, rendition, object key or playback
 * token. The browser presents Hub-signed tickets directly to the Worker:
 *
 * - Upload: Hub checks the plan's 30-day minute caps, reserves storage under Hub's own Account
 *   subject, and signs a `video.upload` ticket (byte limit, output height).
 * - Status: the owner polls Hub; Hub reads the Worker's ticketed status, finishes the storage steps
 *   (commit when quarantined, adopt the stored size when ready, release when rejected or deleted)
 *   and charges the reported minutes once. A maintenance job does the same without a poll.
 * - Publish / unpublish / delete: Hub changes its own row FIRST, so it stops issuing play tickets
 *   at once, then tells the Worker. What the Worker could not be told stays in `hub_video_outbox`.
 * - Play: Hub repeats its own visibility check (public, unlisted, followers, Hub token gate, age)
 *   for this viewer and only then signs a single-use `video.play` ticket.
 *
 * Tickets carry only the asset ID, purpose, times, a unique ID and, where the contract says so,
 * the upload limits or the play cache hint. Never a profile, wallet, Account subject, follow or
 * gate (hub-video-ticket.ts). This module has no `@/` imports so the Video Worker's tests can run
 * it against the real Worker; production wiring is in hub-videos-env.ts.
 */

import type { D1Database } from "@cloudflare/workers-types";

import { getInstanceOrigin } from "@/lib/instance-origin";
import { VIDEO_REVIEW_TRUST_THRESHOLD } from "@/lib/video-safety";

import type { HubStorageAccountClient } from "./hub-storage-account-client";
import {
  commitVideoUpload,
  nextVideoStorageStep,
  releaseVideoStorage,
  reserveVideoUpload,
  settleVideoProcessed,
} from "./hub-video-storage";
import {
  HUB_VIDEO_MAX_SOURCE_BYTES,
  HUB_VIDEO_TICKET_HEADER,
  isHubVideoAssetId,
  newHubVideoAssetId,
  signHubVideoTicket,
  type HubVideoOutputHeight,
  type HubVideoPlayCache,
  type HubVideoTicketPurpose,
} from "./hub-video-ticket";

/* ------------------------------------------------------------------ plans and caps */

export type HubVideoPlanLimits = {
  /** 30-day uploaded minutes. */
  minutes: number;
  /** Of those, minutes the server may re-encode (PLAN 6.3). */
  transcodeMinutes: number;
  maxHeight: HubVideoOutputHeight;
};

/** Free 5, S 60, M 300, L 1,200 minutes; L may use 500 server-transcoded minutes (PLAN 6.3). */
export const HUB_VIDEO_PLAN_LIMITS: Record<string, HubVideoPlanLimits> = {
  free: { minutes: 5, transcodeMinutes: 5, maxHeight: 720 },
  S: { minutes: 60, transcodeMinutes: 60, maxHeight: 1080 },
  M: { minutes: 300, transcodeMinutes: 300, maxHeight: 1080 },
  L: { minutes: 1200, transcodeMinutes: 500, maxHeight: 1080 },
};

/** An unknown plan code gets the free limits: never more than Hub knows it sold. */
export function hubVideoPlanLimits(planCode: string): HubVideoPlanLimits {
  return Object.hasOwn(HUB_VIDEO_PLAN_LIMITS, planCode) ? HUB_VIDEO_PLAN_LIMITS[planCode]! : HUB_VIDEO_PLAN_LIMITS.free!;
}

export const HUB_VIDEO_CAP_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
export const HUB_VIDEO_MAX_MINUTES = 60;
export const HUB_VIDEO_MAX_OPEN_UPLOADS = 3;
/** Whole minutes the reported length may exceed the declared one (rounding). */
export const HUB_VIDEO_DECLARED_TOLERANCE_MINUTES = 1;

export type HubVideoVisibility = "public" | "unlisted" | "followers" | "gated";
export type HubVideoKind = "normal" | "short";
export type HubVideoState =
  | "upload_issued"
  | "processing"
  | "ready"
  | "published"
  | "unpublished"
  | "rejected"
  | "failed"
  | "deleted";

const VISIBILITIES: readonly HubVideoVisibility[] = ["public", "unlisted", "followers", "gated"];
const LICENSES = ["arr", "cc0", "cc-by", "cc-by-sa", "cc-by-nc", "cc-by-nd", "cc-by-nc-sa", "cc-by-nc-nd"] as const;
const CONTROL = /[\u0000-\u001f\u007f]/;

export class HubVideoError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HubVideoError";
  }
}

/* ------------------------------------------------------------------ dependencies */

/** Sends one ticketed request to the Video Worker. Path is the same-origin `/video/api/v1/...`. */
export type VideoWorkerSend = (
  path: string,
  init: { method: "GET" | "POST"; headers: Record<string, string>; body?: string },
) => Promise<Response>;

export type HubVideoGateOutcome = "granted" | "locked" | "unavailable" | "no_gate";

export type HubVideoDeps = {
  /** Hub secret `HUB_VIDEO_TICKET_PRIVATE_KEY_PKCS8`; null when unconfigured (fail closed). */
  privateKeyPkcs8: string | null;
  /** Null when no Video Worker transport is configured (fail closed). */
  send: VideoWorkerSend | null;
  account: HubStorageAccountClient;
  /** Hub's own token-gate check of this viewer against the gate on this video (never client-supplied). */
  checkGate(
    database: D1Database,
    input: { videoId: string; viewerProfileId: string },
  ): Promise<HubVideoGateOutcome>;
  now?: () => Date;
  /** Called after a video's published/audience state may have changed (federation). Never awaited for its result. */
  onChange?: (database: D1Database, videoId: string) => Promise<unknown>;
};

/**
 * Ask the Video Worker to serve (or stop serving) this asset's thumbnail without a ticket. Only
 * federateHubVideo calls it with `true`, after its own public / published / not gated / not
 * age-restricted check. Returns the asset revision for the URL, or null (no thumbnail, Worker
 * unreachable, not deliverable). The Worker clears the mark on every unpublish and suspension.
 */
export async function setPublicVideoThumbnail(deps: HubVideoDeps, assetId: string, enable: boolean): Promise<number | null> {
  const response = await sendTicketed(deps, assetId, enable ? "video.publicthumb" : "video.privatethumb");
  if (!enable || !response || response.status !== 200) return null;
  try {
    const body = (await response.json()) as { thumbnail?: { revision?: unknown } | null };
    const revision = body.thumbnail?.revision;
    return typeof revision === "number" && Number.isSafeInteger(revision) && revision >= 0 ? revision : null;
  } catch {
    return null;
  }
}

export async function notifyChange(database: D1Database, deps: HubVideoDeps, videoId: string): Promise<void> {
  try {
    await deps.onChange?.(database, videoId);
  } catch {
    // Federation is best effort; the video's own state has already changed.
  }
}

const nowIso = (deps: HubVideoDeps) => (deps.now?.() ?? new Date()).toISOString();

function requireKey(deps: HubVideoDeps): string {
  if (!deps.privateKeyPkcs8) throw new HubVideoError("videos_unavailable", 503, "動画の機能は準備中です。");
  return deps.privateKeyPkcs8;
}

/* ------------------------------------------------------------------ rows */

export type VideoRow = {
  id: string;
  profile_id: string;
  asset_id: string;
  title: string;
  description: string;
  visibility: HubVideoVisibility;
  kind: HubVideoKind;
  license: string;
  age_restricted: number;
  comments_enabled: number;
  tags_json?: string | null;
  state: HubVideoState;
  failure: string | null;
  hold_reason: string | null;
  review_status: "none" | "pending" | "approved" | "rejected";
  review_requested_at: string | null;
  review_decided_at: string | null;
  safety_hold: number;
  safety_hold_was_live: number;
  external_video_id: string | null;
  source: "desktop" | "web";
  max_height: number;
  duration_ms: number | null;
  width: number | null;
  height: number | null;
  is_vertical: number | null;
  processing_kind: "remux" | "remux_low" | "transcode" | null;
  received_bytes: number | null;
  stored_bytes: number | null;
  declared_minutes: number;
  charged_minutes: number | null;
  charged_kind: string | null;
  charged_at: string | null;
  upload_bytes: number;
  upload_reservation_id: string | null;
  upload_committed: number;
  upload_released: number;
  stored_reservation_id: string | null;
  stored_released: number;
  created_at: string;
  updated_at: string;
  published_at: string | null;
  unpublished_at: string | null;
  deleted_at: string | null;
};

export async function readHubVideoRow(database: D1Database, id: string): Promise<VideoRow | null> {
  return readRow(database, id);
}

async function readRow(database: D1Database, id: string): Promise<VideoRow | null> {
  return database.prepare("SELECT * FROM hub_videos WHERE id = ?").bind(id).first<VideoRow>();
}

async function requireOwnRow(database: D1Database, profileId: string, id: string): Promise<VideoRow> {
  const row = typeof id === "string" && id.length === 36 ? await readRow(database, id) : null;
  if (!row || row.profile_id !== profileId || row.state === "deleted") {
    throw new HubVideoError("not_found", 404, "動画が見つかりません。");
  }
  return row;
}

/** Short only when it is 60 seconds or less and taller than wide, as probed by the Worker. */
export function isShortEligible(durationMs: number | null, isVertical: number | boolean | null): boolean {
  return durationMs !== null && durationMs >= 1000 && durationMs <= 60_000 && (isVertical === 1 || isVertical === true);
}

export type HubVideoView = {
  id: string;
  title: string;
  description: string;
  visibility: HubVideoVisibility;
  kind: HubVideoKind;
  license: string;
  ageRestricted: boolean;
  commentsEnabled: boolean;
  tags: string[];
  state: HubVideoState;
  failure: string | null;
  held: boolean;
  /** none | pending (waiting for the operator's first-videos review) | approved | rejected. */
  reviewStatus: "none" | "pending" | "approved" | "rejected";
  source: "desktop" | "web";
  maxHeight: number;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  shortEligible: boolean;
  storedBytes: number | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
};

/** Stored free tags (display forms), re-normalised on read so a hand-edited row cannot exceed the limits. */
export function parseVideoTags(raw: string | null | undefined): string[] {
  try {
    const parsed: unknown = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? normalizeTagList(parsed).map((tag) => tag.display) : [];
  } catch {
    return [];
  }
}

/** What the owner sees. No asset ID, reservation ID or Worker detail leaves Hub. */
export function toHubVideoView(row: VideoRow): HubVideoView {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    visibility: row.visibility,
    kind: row.kind,
    license: row.license,
    ageRestricted: row.age_restricted === 1,
    commentsEnabled: row.comments_enabled === 1,
    tags: parseVideoTags(row.tags_json),
    state: row.state,
    failure: row.failure,
    held: row.hold_reason !== null || row.safety_hold === 1,
    reviewStatus: row.review_status,
    source: row.source,
    maxHeight: row.max_height,
    durationMs: row.duration_ms,
    width: row.width,
    height: row.height,
    shortEligible: isShortEligible(row.duration_ms, row.is_vertical),
    storedBytes: row.stored_bytes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at,
  };
}

/* ------------------------------------------------------------------ Video Worker transport */

async function sendTicketed(
  deps: HubVideoDeps,
  assetId: string,
  purpose: Exclude<HubVideoTicketPurpose, "video.upload" | "video.play" | "video.finalize">,
  body?: string,
): Promise<Response | null> {
  if (!deps.send || !deps.privateKeyPkcs8) return null;
  try {
    const signed = await signHubVideoTicket({
      assetId,
      purpose,
      privateKeyPkcs8: deps.privateKeyPkcs8,
      now: deps.now?.(),
    });
    if (!signed.request) return null;
    return await deps.send(signed.request.path, {
      method: signed.request.method,
      headers: { [HUB_VIDEO_TICKET_HEADER]: signed.ticket, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body }),
    });
  } catch {
    return null;
  }
}

type WorkerAsset = {
  state: "uploading" | "quarantined" | "processing" | "ready" | "rejected" | "failed";
  deleted: boolean;
  receivedBytes: number | null;
  storedBytes: number | null;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  isVertical: boolean | null;
  processingKind: "remux" | "remux_low" | "transcode" | null;
  failure: string | null;
};

async function readWorkerStatus(deps: HubVideoDeps, assetId: string): Promise<WorkerAsset | null> {
  const response = await sendTicketed(deps, assetId, "video.status");
  if (!response || response.status !== 200) return null;
  const body = (await response.json().catch(() => null)) as { asset?: WorkerAsset } | null;
  return body?.asset && typeof body.asset.state === "string" ? body.asset : null;
}

/* ------------------------------------------------------------------ outbox */

type OutboxKind = "unpublish" | "delete" | "storage" | "suspend" | "unsuspend" | "takedown";

async function enqueue(database: D1Database, deps: HubVideoDeps, videoId: string, kind: OutboxKind, delaySeconds = 0) {
  const now = deps.now?.() ?? new Date();
  await database
    .prepare(`INSERT INTO hub_video_outbox (id, video_id, kind, attempts, next_attempt_at, created_at)
      VALUES (?1, ?2, ?3, 0, ?4, ?5)
      ON CONFLICT(video_id, kind) DO UPDATE SET next_attempt_at = excluded.next_attempt_at`)
    .bind(crypto.randomUUID(), videoId, kind, new Date(now.getTime() + delaySeconds * 1000).toISOString(), now.toISOString())
    .run();
}

const dropOutbox = (database: D1Database, videoId: string, kind: OutboxKind) =>
  database.prepare("DELETE FROM hub_video_outbox WHERE video_id = ? AND kind = ?").bind(videoId, kind).run();

async function linkedSubject(database: D1Database, profileId: string): Promise<string | null> {
  const row = await database
    .prepare("SELECT pairwise_subject FROM account_profile_links WHERE profile_id = ?")
    .bind(profileId)
    .first<{ pairwise_subject: string }>();
  return row?.pairwise_subject ?? null;
}

/* ------------------------------------------------------------------ upload */

export type HubVideoUploadInput = {
  title: unknown;
  description?: unknown;
  visibility?: unknown;
  source: unknown;
  sizeBytes: unknown;
  durationSeconds: unknown;
  kind?: unknown;
  license?: unknown;
  ageRestricted?: unknown;
  commentsEnabled?: unknown;
};

export type HubVideoUploadTicket = {
  videoId: string;
  assetId: string;
  ticket: string;
  header: typeof HUB_VIDEO_TICKET_HEADER;
  method: "POST";
  path: string;
  expiresAt: string;
  maxBytes: number;
  maxHeight: HubVideoOutputHeight;
};

function parseText(value: unknown, field: string, min: number, max: number, multiline = false): string {
  if (typeof value !== "string") throw new HubVideoError("invalid_input", 400, `${field}が正しくありません。`);
  const text = value.normalize("NFC").trim();
  if (text.length < min || text.length > max || CONTROL.test(multiline ? text.replace(/[\n\t]/g, "") : text)) {
    throw new HubVideoError("invalid_input", 400, `${field}が正しくありません。`);
  }
  return text;
}

function parseVisibility(value: unknown): HubVideoVisibility {
  if (!VISIBILITIES.includes(value as HubVideoVisibility)) {
    throw new HubVideoError("invalid_input", 400, "公開範囲が正しくありません。");
  }
  return value as HubVideoVisibility;
}

function parseLicense(value: unknown, visibility: HubVideoVisibility): string {
  const license = value === undefined ? "arr" : value;
  if (typeof license !== "string" || !(LICENSES as readonly string[]).includes(license)) {
    throw new HubVideoError("invalid_input", 400, "ライセンスが正しくありません。");
  }
  // Gated videos are not offered under a CC license (PLAN 3.3).
  if (visibility === "gated" && license !== "arr") {
    throw new HubVideoError("invalid_input", 400, "ゲート付きの動画にCCライセンスは選べません。");
  }
  return license;
}

function flag(value: unknown, fallback: boolean): number {
  if (value === undefined) return fallback ? 1 : 0;
  if (typeof value !== "boolean") throw new HubVideoError("invalid_input", 400, "指定が正しくありません。");
  return value ? 1 : 0;
}

type MinutesUsage = { total: number; transcode: number };

const USAGE_TOTAL = `(SELECT COALESCE(SUM(CASE
    WHEN charged_at IS NOT NULL AND charged_at >= ?1 THEN charged_minutes
    WHEN charged_at IS NULL AND state IN ('upload_issued', 'processing') THEN declared_minutes
    ELSE 0 END), 0) FROM hub_videos WHERE profile_id = ?2)`;
// An open web upload may be re-encoded, so it is held against the transcode cap until it is charged.
const USAGE_TRANSCODE = `(SELECT COALESCE(SUM(CASE
    WHEN charged_at IS NOT NULL AND charged_at >= ?1 AND charged_kind = 'transcode' THEN charged_minutes
    WHEN charged_at IS NULL AND state IN ('upload_issued', 'processing') AND source = 'web' THEN declared_minutes
    ELSE 0 END), 0) FROM hub_videos WHERE profile_id = ?2)`;
const OPEN_COUNT = `(SELECT COUNT(*) FROM hub_videos WHERE profile_id = ?2 AND state IN ('upload_issued', 'processing'))`;

export async function hubVideoMinutesUsage(database: D1Database, profileId: string, now: Date): Promise<MinutesUsage & { open: number }> {
  const cutoff = new Date(now.getTime() - HUB_VIDEO_CAP_WINDOW_MS).toISOString();
  const row = await database
    .prepare(`SELECT ${USAGE_TOTAL} AS total, ${USAGE_TRANSCODE} AS transcode, ${OPEN_COUNT} AS open`)
    .bind(cutoff, profileId)
    .first<{ total: number; transcode: number; open: number }>();
  return { total: Number(row?.total ?? 0), transcode: Number(row?.transcode ?? 0), open: Number(row?.open ?? 0) };
}

/**
 * Step 1 of an upload: check the plan's caps, reserve storage under Hub's own Account subject, and
 * sign the upload ticket. The browser then starts the upload at the Video Worker with the ticket;
 * Hub never sees the bytes.
 */
export async function issueHubVideoUpload(
  database: D1Database,
  deps: HubVideoDeps,
  profileId: string,
  input: HubVideoUploadInput,
): Promise<HubVideoUploadTicket> {
  const title = parseText(input.title, "題名", 1, 100);
  const description = input.description === undefined ? "" : parseText(input.description, "説明", 0, 5000, true);
  const visibility = input.visibility === undefined ? "public" : parseVisibility(input.visibility);
  const license = parseLicense(input.license, visibility);
  const kind = input.kind === undefined ? "normal" : input.kind;
  if (kind !== "normal" && kind !== "short") throw new HubVideoError("invalid_input", 400, "種類が正しくありません。");
  if (input.source !== "desktop" && input.source !== "web") {
    throw new HubVideoError("invalid_input", 400, "アップロード元が正しくありません。");
  }
  const source = input.source;
  const sizeBytes = input.sizeBytes;
  if (typeof sizeBytes !== "number" || !Number.isSafeInteger(sizeBytes) || sizeBytes < 1) {
    throw new HubVideoError("invalid_input", 400, "ファイルの大きさが正しくありません。");
  }
  if (sizeBytes > HUB_VIDEO_MAX_SOURCE_BYTES) throw new HubVideoError("file_too_large", 413, "ファイルが大きすぎます。");
  const seconds = input.durationSeconds;
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) {
    throw new HubVideoError("invalid_input", 400, "動画の長さが正しくありません。");
  }
  const declaredMinutes = Math.max(1, Math.ceil(seconds / 60));
  if (declaredMinutes > HUB_VIDEO_MAX_MINUTES) throw new HubVideoError("video_too_long", 413, "動画は60分までです。");
  const ageRestricted = flag(input.ageRestricted, false);
  const commentsEnabled = flag(input.commentsEnabled, true);
  const privateKey = requireKey(deps);

  // The plan comes from Account's storage status; no Account link or no answer means no upload.
  const subject = await linkedSubject(database, profileId).catch(() => null);
  if (!subject) throw new HubVideoError("account_link_required", 403, "動画のアップロードには共通アカウントとの連携が必要です。");
  const status = deps.account.status ? await deps.account.status({ subject }) : ({ ok: false } as const);
  if (!status.ok) throw new HubVideoError("storage_unavailable", 503, "プランを確認できませんでした。");
  const plan = hubVideoPlanLimits(status.planCode);

  const now = deps.now?.() ?? new Date();
  const usage = await hubVideoMinutesUsage(database, profileId, now).catch(() => {
    throw new HubVideoError("videos_unavailable", 503, "動画の機能は準備中です。");
  });
  if (usage.open >= HUB_VIDEO_MAX_OPEN_UPLOADS) {
    throw new HubVideoError("too_many_uploads", 429, "処理中のアップロードが多すぎます。終わるまで待ってください。");
  }
  if (usage.total + declaredMinutes > plan.minutes) {
    throw new HubVideoError("minutes_cap_reached", 429, "30日間のアップロード時間の上限に達しています。");
  }
  if (source === "web" && usage.transcode + declaredMinutes > plan.transcodeMinutes) {
    throw new HubVideoError(
      "transcode_cap_reached",
      429,
      "変換が必要なアップロードの30日間の上限に達しています。Hub Desktopからの追加は続けられます。",
    );
  }

  const videoId = crypto.randomUUID();
  const assetId = newHubVideoAssetId();
  const reserved = await reserveVideoUpload(deps.account, { subject, assetId, maxBytes: sizeBytes });
  if (!reserved.ok) {
    throw reserved.reason === "over_limit"
      ? new HubVideoError("storage_quota_exceeded", 413, "保存容量の上限を超えます。")
      : new HubVideoError("storage_unavailable", 503, "保存容量を確認できませんでした。");
  }

  const createdAt = now.toISOString();
  const cutoff = new Date(now.getTime() - HUB_VIDEO_CAP_WINDOW_MS).toISOString();
  let inserted = 0;
  try {
    // The caps are checked again inside the insert, so two uploads started together cannot both pass.
    const result = await database
      .prepare(`INSERT INTO hub_videos
        (id, profile_id, asset_id, title, description, visibility, kind, license, age_restricted, comments_enabled,
         state, source, max_height, declared_minutes, upload_bytes, upload_reservation_id, created_at, updated_at)
        SELECT ?3, ?2, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'upload_issued', ?12, ?13, ?14, ?15, ?16, ?17, ?17
        WHERE ${USAGE_TOTAL} + ?14 <= ?18
          AND ${USAGE_TRANSCODE} + (CASE WHEN ?12 = 'web' THEN ?14 ELSE 0 END) <= ?19
          AND ${OPEN_COUNT} < ?20`)
      .bind(
        cutoff, profileId, videoId, assetId, title, description, visibility, kind, license, ageRestricted, commentsEnabled,
        source, plan.maxHeight, declaredMinutes, sizeBytes, reserved.reservationId, createdAt,
        plan.minutes, plan.transcodeMinutes, HUB_VIDEO_MAX_OPEN_UPLOADS,
      )
      .run();
    inserted = Number(result.meta?.changes ?? 0);
  } catch (error) {
    await releaseVideoStorage(deps.account, { subject, reservationId: reserved.reservationId }).catch(() => undefined);
    throw error;
  }
  if (inserted !== 1) {
    await releaseVideoStorage(deps.account, { subject, reservationId: reserved.reservationId }).catch(() => undefined);
    throw new HubVideoError("minutes_cap_reached", 429, "30日間のアップロード時間の上限に達しています。");
  }

  let signed: Awaited<ReturnType<typeof signHubVideoTicket>>;
  try {
    signed = await signHubVideoTicket({
      assetId,
      purpose: "video.upload",
      privateKeyPkcs8: privateKey,
      upload: { maxBytes: sizeBytes, maxHeight: plan.maxHeight },
      now: deps.now?.(),
    });
  } catch {
    // No ticket went out: undo the row and the reservation.
    await database.prepare("DELETE FROM hub_videos WHERE id = ?").bind(videoId).run().catch(() => undefined);
    await releaseVideoStorage(deps.account, { subject, reservationId: reserved.reservationId }).catch(() => undefined);
    throw new HubVideoError("videos_unavailable", 503, "動画の機能は準備中です。");
  }
  // Poll the Worker even if the uploader never comes back: storage steps must finish either way.
  await enqueue(database, deps, videoId, "storage", 60).catch(() => undefined);
  return {
    videoId,
    assetId,
    ticket: signed.ticket,
    header: signed.header,
    method: "POST",
    path: signed.request!.path,
    expiresAt: signed.expiresAt,
    maxBytes: sizeBytes,
    maxHeight: plan.maxHeight,
  };
}

/* ------------------------------------------------------------------ status and storage steps */

function workerStateForSteps(row: VideoRow, bytesGone: boolean): { state: string; deleted: boolean } {
  switch (row.state) {
    case "upload_issued":
      return { state: "uploading", deleted: false };
    case "processing":
      return { state: "processing", deleted: false };
    case "ready":
    case "published":
    case "unpublished":
      return { state: "ready", deleted: false };
    case "rejected":
      return { state: "rejected", deleted: false };
    case "failed":
      return { state: "failed", deleted: false };
    case "deleted":
      // Counted until the Worker confirms the bytes are gone.
      return bytesGone ? { state: "ready", deleted: true } : { state: "deleting", deleted: false };
  }
}

/**
 * Finish whichever Account storage steps the row calls for. Idempotent: every Account call is
 * retried with a fresh claim and a repeated adopt does not double count. Returns true when
 * nothing is left to do for this row.
 */
async function runStorageSteps(database: D1Database, deps: HubVideoDeps, videoId: string, bytesGone = false): Promise<boolean> {
  for (let round = 0; round < 3; round += 1) {
    const row = await readRow(database, videoId);
    if (!row) return true;
    const subject = await linkedSubject(database, row.profile_id).catch(() => null);
    const now = nowIso(deps);
    const step = nextVideoStorageStep(workerStateForSteps(row, bytesGone), {
      uploadCommitted: row.upload_committed === 1,
      storedReservationId: row.stored_reservation_id,
    });
    const uploadHeld = row.upload_reservation_id !== null && row.upload_released === 0;
    const storedHeld = row.stored_reservation_id !== null && row.stored_released === 0;

    if (!subject) {
      // The account link is gone; Account's reservations lapse on their own. Nothing more Hub can do.
      return step === "wait" && !uploadHeld && !storedHeld;
    }

    if (step === "commit_upload") {
      if (!row.upload_reservation_id || !row.received_bytes) return false;
      const committed = await commitVideoUpload(deps.account, {
        subject,
        reservationId: row.upload_reservation_id,
        receivedBytes: Math.min(row.received_bytes, row.upload_bytes),
      });
      if (committed.ok) {
        await database.prepare("UPDATE hub_videos SET upload_committed = 1, updated_at = ? WHERE id = ?").bind(now, videoId).run();
        continue;
      }
      if (committed.reason === "expired") {
        // The 30-minute reservation lapsed before we could count it: the video cannot be kept.
        await failVideo(database, deps, row, "storage_expired");
        return false;
      }
      return false;
    }

    if (step === "settle_processed") {
      if (!row.upload_reservation_id || !row.stored_bytes) return false;
      const settled = await settleVideoProcessed(deps.account, {
        subject,
        assetId: row.asset_id,
        uploadReservationId: row.upload_reservation_id,
        storedBytes: row.stored_bytes,
      });
      if (!settled.ok) return false;
      await database
        .prepare("UPDATE hub_videos SET stored_reservation_id = ?, upload_released = ?, updated_at = ? WHERE id = ?")
        .bind(settled.storedReservationId, settled.uploadReleased ? 1 : 0, now, videoId)
        .run();
      continue;
    }

    if (step === "release") {
      let ok = true;
      if (uploadHeld) {
        const released = await releaseVideoStorage(deps.account, { subject, reservationId: row.upload_reservation_id! });
        if (released.ok) await database.prepare("UPDATE hub_videos SET upload_released = 1, updated_at = ? WHERE id = ?").bind(now, videoId).run();
        else ok = false;
      }
      if (storedHeld) {
        const released = await releaseVideoStorage(deps.account, { subject, reservationId: row.stored_reservation_id! });
        if (released.ok) await database.prepare("UPDATE hub_videos SET stored_released = 1, updated_at = ? WHERE id = ?").bind(now, videoId).run();
        else ok = false;
      }
      return ok;
    }

    // wait: a settled video whose original commitment could not be released yet.
    if (row.stored_reservation_id && uploadHeld && ["ready", "published", "unpublished"].includes(row.state)) {
      const released = await releaseVideoStorage(deps.account, { subject, reservationId: row.upload_reservation_id! });
      if (!released.ok) return false;
      await database.prepare("UPDATE hub_videos SET upload_released = 1, updated_at = ? WHERE id = ?").bind(now, videoId).run();
      continue;
    }
    return ["ready", "published", "unpublished"].includes(row.state)
      ? row.stored_reservation_id !== null && !uploadHeld
      : row.state === "deleted"
        ? bytesGone && !uploadHeld && !storedHeld
        : false;
  }
  return false;
}

/** Mark a video failed (or rejected), have the Worker drop whatever it holds, and release storage. */
async function failVideo(database: D1Database, deps: HubVideoDeps, row: VideoRow, failure: string, state: "failed" | "rejected" = "failed") {
  await database
    .prepare(`UPDATE hub_videos SET state = ?, failure = ?, updated_at = ?
      WHERE id = ? AND state IN ('upload_issued', 'processing', 'ready')`)
    .bind(state, failure, nowIso(deps), row.id)
    .run();
  await enqueue(database, deps, row.id, "delete").catch(() => undefined);
}

async function applyWorkerStatus(database: D1Database, deps: HubVideoDeps, row: VideoRow, asset: WorkerAsset): Promise<void> {
  const now = nowIso(deps);
  if (row.state !== "upload_issued" && row.state !== "processing" && row.state !== "ready") return;
  switch (asset.state) {
    case "uploading":
      return;
    case "quarantined":
    case "processing":
      await database
        .prepare(`UPDATE hub_videos SET state = 'processing', received_bytes = COALESCE(?, received_bytes), updated_at = ?
          WHERE id = ? AND state IN ('upload_issued', 'processing')`)
        .bind(asset.receivedBytes, now, row.id)
        .run();
      return;
    case "rejected":
    case "failed":
      await database
        .prepare(`UPDATE hub_videos SET state = ?, failure = ?, received_bytes = COALESCE(?, received_bytes), updated_at = ?
          WHERE id = ? AND state IN ('upload_issued', 'processing', 'ready')`)
        .bind(asset.state, (asset.failure ?? asset.state).slice(0, 100), asset.receivedBytes, now, row.id)
        .run();
      return;
    case "ready": {
      if (row.state === "ready" || row.charged_at !== null) return;
      const durationMs = asset.durationMs ?? 0;
      const charged = Math.max(1, Math.ceil(durationMs / 60_000));
      // Not reported means the worst case for cost: count it as a full re-encode.
      const kind = asset.processingKind ?? "transcode";
      const mismatch = charged > row.declared_minutes + HUB_VIDEO_DECLARED_TOLERANCE_MINUTES;
      await database
        .prepare(`UPDATE hub_videos SET state = ?, failure = ?, duration_ms = ?, width = ?, height = ?, is_vertical = ?,
            processing_kind = ?, received_bytes = COALESCE(?, received_bytes), stored_bytes = ?,
            charged_minutes = ?, charged_kind = ?, charged_at = ?, updated_at = ?
          WHERE id = ? AND state IN ('upload_issued', 'processing') AND charged_at IS NULL`)
        .bind(
          mismatch ? "rejected" : "ready",
          mismatch ? "duration_mismatch" : null,
          asset.durationMs,
          asset.width,
          asset.height,
          asset.isVertical === null ? null : asset.isVertical ? 1 : 0,
          asset.processingKind,
          asset.receivedBytes,
          asset.storedBytes,
          charged,
          kind,
          now,
          now,
          row.id,
        )
        .run();
      // The uploader declared a much shorter video than they sent: drop it. The minutes stay charged.
      if (mismatch) await enqueue(database, deps, row.id, "delete").catch(() => undefined);
    }
  }
}

/** Read the Worker's status for a video, finish the storage steps and return the fresh row. */
export async function syncHubVideo(database: D1Database, deps: HubVideoDeps, videoId: string): Promise<VideoRow | null> {
  const row = await readRow(database, videoId);
  if (!row) return null;
  if (row.state === "upload_issued" || row.state === "processing" || row.state === "ready") {
    const asset = await readWorkerStatus(deps, row.asset_id);
    if (asset) await applyWorkerStatus(database, deps, row, asset);
  }
  const complete = await runStorageSteps(database, deps, videoId).catch(() => false);
  if (complete) await dropOutbox(database, videoId, "storage").catch(() => undefined);
  else await enqueue(database, deps, videoId, "storage", 60).catch(() => undefined);
  return readRow(database, videoId);
}

/* ------------------------------------------------------------------ owner reads */

export async function listOwnHubVideos(database: D1Database, profileId: string): Promise<HubVideoView[]> {
  const { results } = await database
    .prepare("SELECT * FROM hub_videos WHERE profile_id = ? AND state <> 'deleted' ORDER BY created_at DESC LIMIT 200")
    .bind(profileId)
    .all<VideoRow>();
  return (results ?? []).map(toHubVideoView);
}

export type HubVideoQuota = {
  planCode: string;
  /** 30-day uploaded minutes the plan allows, the minutes used or reserved, and what is left. */
  minutesCap: number;
  minutesUsed: number;
  minutesRemaining: number;
  /** Of the remaining minutes, how many a browser (server-transcoded) upload may still use. */
  webMinutesRemaining: number;
  maxMinutesPerVideo: number;
  openUploads: number;
  maxOpenUploads: number;
  maxHeight: number;
};

/** What the upload screen shows before a file is picked. Null when the plan cannot be read (no Account link, no answer). */
export async function getHubVideoQuota(database: D1Database, deps: HubVideoDeps, profileId: string): Promise<HubVideoQuota | null> {
  try {
    const subject = await linkedSubject(database, profileId);
    if (!subject || !deps.account.status) return null;
    const status = await deps.account.status({ subject });
    if (!status.ok) return null;
    const plan = hubVideoPlanLimits(status.planCode);
    const usage = await hubVideoMinutesUsage(database, profileId, deps.now?.() ?? new Date());
    const remaining = Math.max(0, plan.minutes - usage.total);
    return {
      planCode: status.planCode,
      minutesCap: plan.minutes,
      minutesUsed: usage.total,
      minutesRemaining: remaining,
      webMinutesRemaining: Math.min(remaining, Math.max(0, plan.transcodeMinutes - usage.transcode)),
      maxMinutesPerVideo: HUB_VIDEO_MAX_MINUTES,
      openUploads: usage.open,
      maxOpenUploads: HUB_VIDEO_MAX_OPEN_UPLOADS,
      maxHeight: plan.maxHeight,
    };
  } catch {
    return null;
  }
}

/** The owner's status read. It polls the Worker, so storage steps advance while the owner watches. */
export async function getOwnHubVideo(
  database: D1Database,
  deps: HubVideoDeps,
  profileId: string,
  videoId: string,
  options: { sync?: boolean } = {},
): Promise<HubVideoView> {
  const row = await requireOwnRow(database, profileId, videoId);
  const fresh = options.sync === false ? row : await syncHubVideo(database, deps, row.id);
  if (!fresh || fresh.state === "deleted") throw new HubVideoError("not_found", 404, "動画が見つかりません。");
  return toHubVideoView(fresh);
}

/* ------------------------------------------------------------------ metadata */

export async function updateHubVideo(
  database: D1Database,
  deps: HubVideoDeps,
  profileId: string,
  videoId: string,
  input: { title?: unknown; description?: unknown; visibility?: unknown; ageRestricted?: unknown; commentsEnabled?: unknown; tags?: unknown },
): Promise<HubVideoView> {
  const row = await requireOwnRow(database, profileId, videoId);
  const title = input.title === undefined ? row.title : parseText(input.title, "題名", 1, 100);
  const description = input.description === undefined ? row.description : parseText(input.description, "説明", 0, 5000, true);
  const visibility = input.visibility === undefined ? row.visibility : parseVisibility(input.visibility);
  const ageRestricted = flag(input.ageRestricted, row.age_restricted === 1);
  const commentsEnabled = flag(input.commentsEnabled, row.comments_enabled === 1);
  if (input.tags !== undefined && !Array.isArray(input.tags)) {
    throw new HubVideoError("invalid_input", 400, "タグの形式が正しくありません。");
  }
  const tags = input.tags === undefined ? parseVideoTags(row.tags_json) : normalizeTagList(input.tags as unknown[]).map((tag) => tag.display);
  if (visibility === "gated" && row.license !== "arr") {
    throw new HubVideoError("invalid_input", 400, "ゲート付きの動画にCCライセンスは選べません。");
  }
  if (visibility === "gated" && row.state === "published" && !(await hasGate(database, row.id))) {
    throw new HubVideoError("gate_required", 409, "ゲート付きにするには、先にゲートを付けてください。");
  }
  // Anything that makes the audience smaller must not leave older playback tokens alive.
  const narrowing = row.state === "published"
    && ((["public", "unlisted"].includes(row.visibility) && ["followers", "gated"].includes(visibility))
      || (row.age_restricted === 0 && ageRestricted === 1));
  await database
    .prepare(`UPDATE hub_videos SET title = ?, description = ?, visibility = ?, age_restricted = ?, comments_enabled = ?, tags_json = ?, updated_at = ?
      WHERE id = ? AND state <> 'deleted'`)
    .bind(title, description, visibility, ageRestricted, commentsEnabled, JSON.stringify(tags), nowIso(deps), row.id)
    .run();
  if (input.tags !== undefined) {
    await indexD1ContentTags(database, "video", row.id, [...videoCategoryTagInput("Hub動画", null), ...tags]);
  }
  if (narrowing) await bumpRevision(database, deps, row);
  if (row.external_video_id) await syncHubVideoCatalogEntry(database, row.id, deps.now?.()).catch(() => undefined);
  const fresh = await readRow(database, row.id);
  await notifyChange(database, deps, row.id);
  if (!fresh) throw new HubVideoError("not_found", 404, "動画が見つかりません。");
  return toHubVideoView(fresh);
}

/**
 * Unpublish then publish at the Worker, so the revision changes and segment tokens issued under the
 * wider audience stop within a minute. Any failure leaves the video unpublished on Hub.
 */
export async function bumpRevision(database: D1Database, deps: HubVideoDeps, row: VideoRow) {
  const down = await sendTicketed(deps, row.asset_id, "video.unpublish");
  const up = down?.status === 200 ? await sendTicketed(deps, row.asset_id, "video.publish") : null;
  if (up?.status === 200) return;
  await unpublishHubVideo(database, deps, row.id);
  throw new HubVideoError("videos_unavailable", 503, "公開範囲の変更を反映できなかったため、動画を非公開にしました。");
}

async function hasGate(database: D1Database, videoId: string): Promise<boolean> {
  const row = await database
    .prepare("SELECT 1 AS ok FROM content_access_gates WHERE target_type = 'video' AND target_id = ? LIMIT 1")
    .bind(videoId)
    .first<{ ok: number }>();
  return row !== null;
}

/* ------------------------------------------------------------------ publish / unpublish / delete */

export async function publishHubVideo(
  database: D1Database,
  deps: HubVideoDeps,
  profileId: string,
  videoId: string,
): Promise<HubVideoView> {
  requireKey(deps);
  const row = await requireOwnRow(database, profileId, videoId);
  return publishHubVideoRow(database, deps, row);
}

/**
 * First-videos review (PLAN 2.3): a creator with fewer than VIDEO_REVIEW_TRUST_THRESHOLD approved or
 * already-live videos publishes into `pending`. Nothing else happens: the row stays `ready`, so Hub
 * issues no play ticket, writes no catalog row and tells the Video Worker nothing until an operator
 * approves. Rejected videos can never be published.
 */
async function reviewGate(database: D1Database, deps: HubVideoDeps, row: VideoRow): Promise<"go" | "pending"> {
  if (row.review_status === "approved") return "go";
  if (row.review_status === "pending") return "pending";
  if (row.review_status === "rejected") {
    throw new HubVideoError("review_rejected", 403, "審査で公開できないと判断された動画です。");
  }
  const trusted = await database
    .prepare(`SELECT COUNT(*) AS n FROM hub_videos
      WHERE profile_id = ? AND id <> ?
        AND (review_status = 'approved' OR (review_status = 'none' AND published_at IS NOT NULL))`)
    .bind(row.profile_id, row.id)
    .first<{ n: number }>();
  if (Number(trusted?.n ?? 0) >= VIDEO_REVIEW_TRUST_THRESHOLD) return "go";
  const now = nowIso(deps);
  await database
    .prepare(`UPDATE hub_videos SET review_status = 'pending', review_requested_at = ?, updated_at = ?
      WHERE id = ? AND review_status = 'none'`)
    .bind(now, now, row.id)
    .run();
  return "pending";
}

export async function publishHubVideoRow(database: D1Database, deps: HubVideoDeps, startRow: VideoRow): Promise<HubVideoView> {
  requireKey(deps);
  let row = startRow;
  if (row.hold_reason) throw new HubVideoError("copyright_hold", 403, "著作権の確認中のため、公開できません。");
  if (row.safety_hold === 1) throw new HubVideoError("safety_hold", 403, "運営が確認中のため、公開できません。");
  if (row.state === "upload_issued" || row.state === "processing") {
    row = (await syncHubVideo(database, deps, row.id)) ?? row;
  }
  if (row.state === "published") return toHubVideoView(row);
  if (row.state !== "ready" && row.state !== "unpublished") {
    throw new HubVideoError("not_ready", 409, "動画の処理が終わっていません。");
  }
  if (row.visibility === "gated" && !(await hasGate(database, row.id))) {
    throw new HubVideoError("gate_required", 409, "ゲート付きの動画には、先にゲートを付けてください。");
  }
  if (row.kind === "short" && !isShortEligible(row.duration_ms, row.is_vertical)) {
    throw new HubVideoError("not_short_eligible", 409, "ショートにできるのは、60秒以下の縦長の動画だけです。");
  }
  if ((await reviewGate(database, deps, row)) === "pending") {
    return toHubVideoView((await readRow(database, row.id)) ?? row);
  }
  // The catalog row is only a pointer (shown while published), so it is safe to write first.
  try {
    await syncHubVideoCatalogEntry(database, row.id, deps.now?.());
  } catch {
    throw new HubVideoError("videos_unavailable", 503, "動画を公開できませんでした。");
  }
  // A late retry of an earlier unpublish must not undo this publish.
  await dropOutbox(database, row.id, "unpublish");
  const response = await sendTicketed(deps, row.asset_id, "video.publish");
  if (!response) throw new HubVideoError("videos_unavailable", 503, "動画の機能は準備中です。");
  if (response.status === 409 || response.status === 410) {
    throw new HubVideoError("not_ready", 409, "動画を公開できる状態ではありません。");
  }
  if (response.status !== 200) throw new HubVideoError("videos_unavailable", 503, "動画を公開できませんでした。");
  const now = nowIso(deps);
  const changed = await database
    .prepare(`UPDATE hub_videos SET state = 'published', published_at = ?, unpublished_at = NULL, updated_at = ?
      WHERE id = ? AND state IN ('ready', 'unpublished') AND hold_reason IS NULL AND safety_hold = 0`)
    .bind(now, now, row.id)
    .run();
  if (Number(changed.meta?.changes ?? 0) !== 1) {
    // A copyright hold or a deletion landed while the Worker was publishing: close it again.
    await unpublishHubVideo(database, deps, row.id);
    throw new HubVideoError("copyright_hold", 403, "著作権の確認中のため、公開できません。");
  }
  const fresh = await readRow(database, row.id);
  await notifyChange(database, deps, row.id);
  return toHubVideoView(fresh!);
}

export type UnpublishSummary = { unpublished: boolean; pending: boolean };

/**
 * Take a video down. Hub's row changes first (play tickets stop at once), then the Worker is told
 * with a `video.unpublish` ticket; if it cannot be reached the outbox retries. `reason: "copyright"`
 * also places a hold the owner cannot lift. Never throws.
 */
export async function unpublishHubVideo(
  database: D1Database,
  deps: HubVideoDeps,
  videoId: string,
  options: { reason?: "copyright" | "safety" } = {},
): Promise<UnpublishSummary> {
  try {
    const now = nowIso(deps);
    if (options.reason === "copyright") {
      await database
        .prepare("UPDATE hub_videos SET hold_reason = 'copyright', updated_at = ? WHERE id = ? AND state <> 'deleted'")
        .bind(now, videoId)
        .run();
    }
    if (options.reason === "safety") {
      await database
        .prepare("UPDATE hub_videos SET safety_hold = 1, safety_hold_was_live = CASE WHEN state = 'published' THEN 1 ELSE safety_hold_was_live END, updated_at = ? WHERE id = ? AND state <> 'deleted'")
        .bind(now, videoId)
        .run();
    }
    await database
      .prepare(`UPDATE hub_videos SET state = 'unpublished', unpublished_at = ?, updated_at = ?
        WHERE id = ? AND state = 'published'`)
      .bind(now, now, videoId)
      .run();
    await enqueue(database, deps, videoId, "unpublish");
    await notifyChange(database, deps, videoId);
    const done = await processOutbox(database, deps, { video_id: videoId, kind: "unpublish" });
    return { unpublished: true, pending: !done };
  } catch {
    console.warn(JSON.stringify({ event: "hub_video_unpublish_failed" }));
    return { unpublished: false, pending: true };
  }
}

/** Owner takes a video down. */
export async function unpublishOwnHubVideo(
  database: D1Database,
  deps: HubVideoDeps,
  profileId: string,
  videoId: string,
): Promise<HubVideoView> {
  const row = await requireOwnRow(database, profileId, videoId);
  await unpublishHubVideo(database, deps, row.id);
  return toHubVideoView((await readRow(database, row.id))!);
}

/**
 * The copyright flow hid the catalog row this video is listed under: unpublish it, same pattern as
 * `unpublishAttachedFiles`. Never throws; what the Worker could not be told is retried.
 */
export async function unpublishHubVideosForCatalogEntry(
  database: D1Database,
  deps: HubVideoDeps,
  externalVideoId: string,
): Promise<UnpublishSummary & { count: number }> {
  try {
    const { results } = await database
      .prepare("SELECT id FROM hub_videos WHERE external_video_id = ? AND state <> 'deleted'")
      .bind(externalVideoId)
      .all<{ id: string }>();
    let pending = false;
    for (const row of results ?? []) {
      const summary = await unpublishHubVideo(database, deps, row.id, { reason: "copyright" });
      pending = pending || summary.pending;
    }
    return { unpublished: true, pending, count: (results ?? []).length };
  } catch {
    console.warn(JSON.stringify({ event: "hub_video_copyright_unpublish_failed" }));
    return { unpublished: false, pending: true, count: 0 };
  }
}

/** Ties a video to the catalog row that lists it (the seam copyright cases use). */
export async function linkHubVideoToCatalog(database: D1Database, videoId: string, externalVideoId: string): Promise<void> {
  await database
    .prepare("UPDATE hub_videos SET external_video_id = ? WHERE id = ? AND external_video_id IS NULL")
    .bind(externalVideoId, videoId)
    .run();
}

/** "m:ss" or "h:mm:ss", the shape the catalog's duration column already holds. */
export function formatCatalogDuration(durationMs: number | null): string | null {
  if (durationMs === null || !Number.isFinite(durationMs) || durationMs < 0) return null;
  const total = Math.round(durationMs / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/**
 * The catalog row (`external_videos`, provider 'hub') that lists a self-made video in /v2/videos,
 * shorts, subscriptions and copyright hiding. Its ID is the hub video's own ID, so the watch URL,
 * the token-gate target and the catalog row are one identifier. The row is only a pointer: whether
 * it is shown is decided at read time from `hub_videos` (video-public-origin.ts), so unpublishing,
 * a copyright hold or a deletion never needs a second write here. Idempotent; also refreshes the
 * title, channel, length and age flag after an edit.
 */
export async function syncHubVideoCatalogEntry(database: D1Database, videoId: string, now = new Date()): Promise<void> {
  const row = await readRow(database, videoId);
  if (!row) return;
  const owner = await database
    .prepare("SELECT display_name FROM profiles WHERE id = ?")
    .bind(row.profile_id)
    .first<{ display_name: string | null }>();
  const iso = now.toISOString();
  const channel = (owner?.display_name ?? "").trim().slice(0, 120) || "Hub";
  await database
    .prepare(`INSERT INTO external_videos (
        id, provider, external_video_id, source_url, title, channel, category, thumbnail_url, duration,
        published_at, submitted_by_profile_id, status, created_at, updated_at, purpose, topic,
        submitter_visible, ingest_source, safety_level, availability_status, broadcast_status
      ) VALUES (?1, 'hub', ?1, ?2, ?3, ?4, 'Hub動画', NULL, ?5, ?6, ?7, 'active', ?8, ?8, 'creation', '未分類',
        1, 'manual', ?9, 'available', 'video')
      ON CONFLICT(id) DO UPDATE SET title = excluded.title, channel = excluded.channel, duration = excluded.duration,
        safety_level = excluded.safety_level, updated_at = excluded.updated_at`)
    .bind(
      row.id,
      `${getInstanceOrigin()}/v2/videos/${row.id}`,
      row.title.slice(0, 240),
      channel,
      formatCatalogDuration(row.duration_ms),
      row.published_at ?? iso,
      row.profile_id,
      iso,
      row.age_restricted === 1 ? "adult" : "standard",
    )
    .run();
  await indexD1ContentTags(database, "video", row.id, [...videoCategoryTagInput("Hub動画", null), ...parseVideoTags(row.tags_json)]);
  await linkHubVideoToCatalog(database, row.id, row.id);
}

export async function deleteHubVideo(
  database: D1Database,
  deps: HubVideoDeps,
  profileId: string,
  videoId: string,
): Promise<{ deleted: true; pending: boolean }> {
  const row = await requireOwnRow(database, profileId, videoId);
  const now = nowIso(deps);
  await database.batch([
    database
      .prepare(`UPDATE hub_videos SET state = 'deleted', deleted_at = ?, unpublished_at = COALESCE(unpublished_at, ?), updated_at = ?
        WHERE id = ? AND state <> 'deleted'`)
      .bind(now, now, now, row.id),
    database.prepare("DELETE FROM content_access_gates WHERE target_type = 'video' AND target_id = ?").bind(row.id),
    database.prepare("DELETE FROM hub_video_outbox WHERE video_id = ?").bind(row.id),
  ]);
  await enqueue(database, deps, row.id, "delete");
  await notifyChange(database, deps, row.id);
  const done = await processOutbox(database, deps, { video_id: row.id, kind: "delete" });
  return { deleted: true, pending: !done };
}

/* ------------------------------------------------------------------ outbox processing */

type OutboxRef = { video_id: string; kind: OutboxKind };

/** Returns true when the item is finished and its row removed. */
async function processOutbox(database: D1Database, deps: HubVideoDeps, item: OutboxRef): Promise<boolean> {
  const row = await readRow(database, item.video_id);
  if (!row) {
    await dropOutbox(database, item.video_id, item.kind);
    return true;
  }
  if (item.kind === "unpublish") {
    // Republished since: this retry is stale.
    if (row.state === "published") {
      await dropOutbox(database, row.id, "unpublish");
      return true;
    }
    const response = await sendTicketed(deps, row.asset_id, "video.unpublish");
    if (response && (response.status === 200 || response.status === 404 || response.status === 410)) {
      await dropOutbox(database, row.id, "unpublish");
      return true;
    }
    return false;
  }
  if (item.kind === "suspend" || item.kind === "unsuspend") {
    // A copyright hold is Hub's row (hold_reason). If it changed since this was queued, the item is stale.
    const held = row.hold_reason === "copyright";
    if (row.state === "deleted" || (item.kind === "suspend" ? !held : held)) {
      await dropOutbox(database, row.id, item.kind);
      return true;
    }
    const response = await sendTicketed(deps, row.asset_id, item.kind === "suspend" ? "video.suspend" : "video.unsuspend");
    if (response && (response.status === 200 || response.status === 404 || response.status === 410)) {
      await dropOutbox(database, row.id, item.kind);
      return true;
    }
    return false;
  }
  if (item.kind === "delete" || item.kind === "takedown") {
    // A confirmed copyright takedown tells the Worker to keep the SHA-256 block row (the body is JSON, not secret).
    const response =
      item.kind === "takedown"
        ? await sendTicketed(deps, row.asset_id, "video.delete", JSON.stringify({ reason: "copyright" }))
        : await sendTicketed(deps, row.asset_id, "video.delete");
    if (!response || !(response.status === 200 || response.status === 404 || response.status === 410)) return false;
    // Rejected or failed videos stay visible to their owner; only an owner delete finishes the row.
    const released = await runStorageSteps(database, deps, row.id, true).catch(() => false);
    await dropOutbox(database, row.id, item.kind);
    if (!released) await enqueue(database, deps, row.id, "storage", 60);
    return true;
  }
  const synced = await syncHubVideo(database, deps, row.id);
  if (!synced) return true;
  const stillOpen = await database
    .prepare("SELECT 1 AS ok FROM hub_video_outbox WHERE video_id = ? AND kind = 'storage' LIMIT 1")
    .bind(row.id)
    .first<{ ok: number }>();
  return stillOpen === null;
}

/**
 * Copyright flow: try now to tell the Video Worker what the case just did to this video
 * (suspend, unsuspend, or a takedown delete with the block row). Never throws; whatever could not
 * be delivered stays in the outbox for the maintenance job.
 */
export async function drainHubVideoCopyrightOutbox(
  database: D1Database,
  deps: HubVideoDeps,
  videoId: string,
): Promise<{ pending: boolean }> {
  let pending = false;
  for (const kind of ["suspend", "unsuspend", "takedown"] as const) {
    try {
      const queued = await database
        .prepare("SELECT 1 AS ok FROM hub_video_outbox WHERE video_id = ? AND kind = ? LIMIT 1")
        .bind(videoId, kind)
        .first<{ ok: number }>();
      if (queued && !(await processOutbox(database, deps, { video_id: videoId, kind }))) pending = true;
    } catch {
      pending = true;
      console.warn(JSON.stringify({ event: "hub_video_copyright_outbox_failed" }));
    }
  }
  // Hub's own row changed in the case's batch (hold, restore or deletion), whether or not the Worker
  // was reachable: tell federation now (Delete on hide/takedown, Update on restore).
  await notifyChange(database, deps, videoId);
  return { pending };
}

/**
 * Maintenance job: retry what could not be delivered. Each failed attempt backs off (1 minute
 * doubling, at most an hour). Returns counts only.
 */
export async function drainHubVideoOutbox(
  database: D1Database,
  deps: HubVideoDeps,
  options: { limit?: number; now?: Date } = {},
): Promise<{ attempted: number; finished: number }> {
  const now = options.now ?? deps.now?.() ?? new Date();
  const { results } = await database
    .prepare("SELECT video_id, kind, attempts FROM hub_video_outbox WHERE next_attempt_at <= ? ORDER BY next_attempt_at LIMIT ?")
    .bind(now.toISOString(), options.limit ?? 20)
    .all<{ video_id: string; kind: OutboxKind; attempts: number }>();
  let finished = 0;
  for (const item of results ?? []) {
    let done = false;
    try {
      done = await processOutbox(database, deps, item);
    } catch {
      done = false;
    }
    if (done) {
      finished += 1;
      continue;
    }
    const delaySeconds = Math.min(60 * 2 ** Math.min(item.attempts, 6), 3600);
    await database
      .prepare("UPDATE hub_video_outbox SET attempts = attempts + 1, next_attempt_at = ? WHERE video_id = ? AND kind = ?")
      .bind(new Date(now.getTime() + delaySeconds * 1000).toISOString(), item.video_id, item.kind)
      .run();
  }
  return { attempted: (results ?? []).length, finished };
}

/* ------------------------------------------------------------------ play */

export type HubVideoPlayTicket = {
  ticket: string;
  header: typeof HUB_VIDEO_TICKET_HEADER;
  method: "POST";
  path: string;
  expiresAt: string;
};

async function follows(database: D1Database, followerId: string, followedId: string): Promise<boolean> {
  const row = await database
    .prepare("SELECT 1 AS ok FROM follows WHERE follower_profile_id = ? AND followed_profile_id = ? LIMIT 1")
    .bind(followerId, followedId)
    .first<{ ok: number }>();
  return row !== null;
}

async function adultOptedIn(database: D1Database, profileId: string): Promise<boolean> {
  const row = await database
    .prepare("SELECT enabled FROM profile_adult_opt_in WHERE profile_id = ? LIMIT 1")
    .bind(profileId)
    .first<{ enabled: number }>();
  return row?.enabled === 1;
}

/**
 * Owner-only preview (PLAN 2.3): the creator can watch a processed video that is waiting for review,
 * was rejected, or is unpublished. Never for another profile, and never while a copyright or safety
 * hold or a deletion applies. The Worker still requires a processed, unsuspended asset.
 */
export async function issueHubVideoPreviewTicket(
  database: D1Database,
  deps: HubVideoDeps,
  viewerProfileId: string | null,
  videoId: unknown,
): Promise<HubVideoPlayTicket> {
  const privateKey = requireKey(deps);
  const row = typeof videoId === "string" && videoId.length === 36 ? await readRow(database, videoId) : null;
  const notFound = () => new HubVideoError("not_found", 404, "動画が見つかりません。");
  if (!viewerProfileId) throw new HubVideoError("authentication_required", 401, "ログインが必要です。");
  if (!row || row.profile_id !== viewerProfileId || !isHubVideoAssetId(row.asset_id)) throw notFound();
  if (row.hold_reason !== null || row.safety_hold === 1) throw notFound();
  if (row.state !== "ready" && row.state !== "published" && row.state !== "unpublished") throw notFound();
  let signed: Awaited<ReturnType<typeof signHubVideoTicket>>;
  try {
    signed = await signHubVideoTicket({ assetId: row.asset_id, purpose: "video.preview", privateKeyPkcs8: privateKey, now: deps.now?.() });
  } catch {
    throw new HubVideoError("videos_unavailable", 503, "動画を準備できませんでした。");
  }
  return {
    ticket: signed.ticket,
    header: signed.header,
    method: "POST",
    path: signed.request!.path,
    expiresAt: signed.expiresAt,
  };
}

/**
 * A single-use play ticket, only after Hub's own checks for this viewer: the video is published
 * and not held, the age restriction (signed in and opted in to adult content), and the visibility
 * (public and unlisted: anyone; followers: the owner and followers; gated: the owner and viewers
 * whose token-gate check passes server-side). Public and unlisted videos get the "public" cache
 * hint; every other kind is never cacheable. Nothing about the viewer enters the ticket.
 */
export async function issueHubVideoPlayTicket(
  database: D1Database,
  deps: HubVideoDeps,
  viewerProfileId: string | null,
  videoId: unknown,
): Promise<HubVideoPlayTicket> {
  const privateKey = requireKey(deps);
  const row = typeof videoId === "string" && videoId.length === 36 ? await readRow(database, videoId) : null;
  const notFound = () => new HubVideoError("not_found", 404, "動画が見つかりません。");
  if (!row || row.state !== "published" || row.hold_reason !== null || row.safety_hold === 1 || row.review_status === "pending"
    || row.review_status === "rejected" || !isHubVideoAssetId(row.asset_id)) throw notFound();
  const isOwner = viewerProfileId !== null && viewerProfileId === row.profile_id;

  if (row.age_restricted === 1 && !isOwner) {
    if (!viewerProfileId) throw new HubVideoError("authentication_required", 401, "ログインが必要です。");
    let opted = false;
    try {
      opted = await adultOptedIn(database, viewerProfileId);
    } catch {
      throw new HubVideoError("videos_unavailable", 503, "年齢制限を確認できませんでした。");
    }
    if (!opted) throw new HubVideoError("age_restricted", 403, "この動画は年齢制限があります。成人向け表示を有効にしてください。");
  }

  if (row.visibility === "followers" && !isOwner) {
    if (!viewerProfileId || !(await follows(database, viewerProfileId, row.profile_id).catch(() => false))) throw notFound();
  } else if (row.visibility === "gated" && !isOwner) {
    if (!viewerProfileId) throw new HubVideoError("authentication_required", 401, "ログインが必要です。");
    let outcome: HubVideoGateOutcome;
    try {
      outcome = await deps.checkGate(database, { videoId: row.id, viewerProfileId });
    } catch {
      outcome = "unavailable";
    }
    if (outcome === "no_gate") throw notFound();
    if (outcome === "unavailable") throw new HubVideoError("gate_unavailable", 503, "閲覧条件を確認できませんでした。");
    if (outcome !== "granted") throw new HubVideoError("locked", 403, "閲覧条件を満たしていません。");
  } else if (row.visibility === "gated" && !(await hasGate(database, row.id))) {
    // Even the owner needs a gate on a gated video; without one it fails closed.
    throw notFound();
  }

  // Re-read: an unpublish or a hold that ran during the checks closes the ticket too.
  const current = await readRow(database, row.id);
  if (!current || current.state !== "published" || current.hold_reason !== null || current.safety_hold === 1
    || current.review_status === "pending" || current.review_status === "rejected") throw notFound();

  const cache: HubVideoPlayCache =
    (current.visibility === "public" || current.visibility === "unlisted") && current.age_restricted === 0 ? "public" : "private";
  let signed: Awaited<ReturnType<typeof signHubVideoTicket>>;
  try {
    signed = await signHubVideoTicket({
      assetId: current.asset_id,
      purpose: "video.play",
      privateKeyPkcs8: privateKey,
      play: { cache },
      now: deps.now?.(),
    });
  } catch {
    throw new HubVideoError("videos_unavailable", 503, "動画を準備できませんでした。");
  }
  return {
    ticket: signed.ticket,
    header: signed.header,
    method: "POST",
    path: signed.request!.path,
    expiresAt: signed.expiresAt,
  };
}
