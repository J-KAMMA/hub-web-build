import type { D1Database } from "@cloudflare/workers-types";
import { getCloudflareContext } from "@opennextjs/cloudflare";

import type { AccessGate } from "@/lib/access-gates/types";
import { discardDownloadGrant, readDownloadPolicy, recordDownloadGrant } from "@/lib/server/content-downloads";
import {
  checkGateForViewer,
  createGateVerificationDeps,
  type GateVerificationDeps,
} from "@/lib/server/access-gate-verification";
import { contentFileStorageHooks, type ContentFileStorageHooks } from "@/lib/server/content-file-storage";
import {
  HUB_FILE_TICKET_HEADER,
  isHubFileId,
  newHubFileId,
  signHubFileTicket,
  type HubFileTicketPurpose,
} from "@/lib/server/hub-file-ticket";

/**
 * Gated file attachments on Hub posts and articles (2026-10-15, Vault folded into Hub).
 *
 * Hub decides; the file component (`apps/vault`, `/vault/api/files/:id`) stores, scans and
 * delivers. Hub never receives, proxies or caches a file body, object key or storage URL:
 *
 * - Upload: Hub reserves storage and signs a `file_upload` ticket; the browser POSTs the file
 *   directly to the component with that ticket.
 * - Publish: when the author attaches files to a post or article that has a Hub token gate, Hub
 *   signs a `file_publish` ticket and sends the state change to the component itself. The
 *   component's answer (scan state, stored size) is the status read.
 * - Download: Hub repeats the server-side gate check for the viewer and only then signs a
 *   single-use `file_download` ticket that the browser presents to the component.
 * - Unpublish: `unpublishAttachedFiles` first marks the rows so Hub stops issuing tickets at
 *   once, then asks the component to unpublish. Callers run it in the same operation that
 *   removes the gate, withdraws, deletes or suspends the content.
 *
 * Files exist only on gated content. Without a gate there is no download ticket.
 * Tickets carry only the file ID, purpose, times and a unique ID (see hub-file-ticket.ts).
 */

export type ContentFileTargetType = "post" | "article";
export type ContentFileRef = { targetType: ContentFileTargetType; targetId: string };

export type ContentFileState = "upload_issued" | "published" | "unpublish_pending" | "unpublished" | "removed";

export const CONTENT_FILE_MAX_BYTES = 1024 * 1024 * 1024;
export const CONTENT_FILE_MAX_PER_TARGET = 10;
export const CONTENT_FILE_MAX_OPEN_UPLOADS = 20;
export const CONTENT_FILE_MAX_NAME_LENGTH = 200;

export class ContentFileError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ContentFileError";
  }
}

/** Sends one state change to the file component. Path is the same-origin `/vault/api/files/...`. */
export type FileComponentSend = (
  path: string,
  init: { method: "POST"; headers: Record<string, string> },
) => Promise<Response>;

export type ContentFileDeps = {
  /** Hub secret `HUB_FILE_TICKET_PRIVATE_KEY_PKCS8`; null when unconfigured (fail closed). */
  privateKeyPkcs8: string | null;
  /** Null when no file component transport is configured (fail closed). */
  send: FileComponentSend | null;
  storage: ContentFileStorageHooks;
  gateDeps?: (database: D1Database) => GateVerificationDeps;
  now?: () => Date;
};

type Env = Record<string, unknown>;

function readString(env: Env | undefined, name: string): string | null {
  const fromEnv = env ? Reflect.get(env, name) : undefined;
  const value = typeof fromEnv === "string" ? fromEnv : process.env[name];
  // Example-file placeholders count as unconfigured.
  return typeof value === "string" && value.trim() && !value.trim().startsWith("replace-with") ? value.trim() : null;
}

/**
 * Production wiring. The transport is the `HUB_FILE_COMPONENT` service binding when present,
 * otherwise `HUB_FILE_COMPONENT_ORIGIN` (an http(s) origin that serves `/vault/api/files/*`).
 * Neither configured means no transport, and every publish closes.
 */
export function contentFileDepsFromEnv(env?: Env): ContentFileDeps {
  let bindings: Env | undefined = env;
  if (!bindings) {
    try {
      bindings = getCloudflareContext().env as unknown as Env;
    } catch {
      bindings = undefined;
    }
  }
  const binding = bindings ? Reflect.get(bindings, "HUB_FILE_COMPONENT") : undefined;
  const origin = readString(bindings, "HUB_FILE_COMPONENT_ORIGIN");
  let send: FileComponentSend | null = null;
  if (binding && typeof (binding as { fetch?: unknown }).fetch === "function") {
    const fetcher = binding as { fetch(request: Request): Promise<Response> };
    send = (path, init) => fetcher.fetch(new Request(new URL(path, "https://file-component.internal"), init));
  } else if (origin && /^https?:\/\/[^/]+$/i.test(origin.replace(/\/$/, ""))) {
    const base = origin.replace(/\/$/, "");
    send = (path, init) => fetch(`${base}${path}`, { ...init, redirect: "manual" });
  }
  return {
    privateKeyPkcs8: readString(bindings, "HUB_FILE_TICKET_PRIVATE_KEY_PKCS8"),
    send,
    storage: contentFileStorageHooks,
  };
}

const CONTROL = /[\u0000-\u001f\u007f]/;

function nowIso(deps: ContentFileDeps): string {
  return (deps.now?.() ?? new Date()).toISOString();
}

export function parseContentFileRef(targetType: unknown, targetId: unknown): ContentFileRef {
  if (targetType !== "post" && targetType !== "article") {
    throw new ContentFileError("invalid_target", 400, "ファイルを付けられるのは投稿と記事だけです。");
  }
  if (typeof targetId !== "string" || targetId.length < 1 || targetId.length > 200 || CONTROL.test(targetId)) {
    throw new ContentFileError("invalid_target", 400, "対象の指定が正しくありません。");
  }
  return { targetType, targetId };
}

function parseFileName(value: unknown): string {
  if (typeof value !== "string") throw new ContentFileError("invalid_file", 400, "ファイル名が必要です。");
  const name = value.normalize("NFC").trim();
  if (!name || name.length > CONTENT_FILE_MAX_NAME_LENGTH || CONTROL.test(name) || /[\\/]/.test(name)) {
    throw new ContentFileError("invalid_file", 400, "ファイル名が正しくありません。");
  }
  return name;
}

function parseSize(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new ContentFileError("invalid_file", 400, "ファイルの大きさが正しくありません。");
  }
  if (value > CONTENT_FILE_MAX_BYTES) throw new ContentFileError("file_too_large", 413, "ファイルが大きすぎます。");
  return value;
}

function requireKey(deps: ContentFileDeps): string {
  if (!deps.privateKeyPkcs8) {
    throw new ContentFileError("files_unavailable", 503, "ファイルの添付は準備中です。");
  }
  return deps.privateKeyPkcs8;
}

type ContentFileRow = {
  id: string;
  owner_profile_id: string;
  /** 'game' rows are game builds (game-builds.ts); they never pass through the post/article paths. */
  target_type: ContentFileTargetType | "game" | null;
  target_id: string | null;
  file_name: string;
  declared_bytes: number;
  stored_bytes: number | null;
  state: ContentFileState;
  scan_status: string | null;
  storage_reservation: string | null;
  storage_committed: number;
};

async function readRow(database: D1Database, fileId: string): Promise<ContentFileRow | null> {
  return database.prepare("SELECT * FROM hub_content_files WHERE id = ?").bind(fileId).first<ContentFileRow>();
}

/**
 * Whether the content is live for readers, and its author. Withdrawn articles, hidden or held
 * posts and missing rows answer null, so no ticket is issued for them.
 */
async function liveContentAuthor(database: D1Database, ref: ContentFileRef): Promise<string | null> {
  if (ref.targetType === "article") {
    const row = await database
      .prepare("SELECT author_profile_id FROM hub_user_articles WHERE id = ? AND status = 'published' AND moderated_at IS NULL LIMIT 1")
      .bind(ref.targetId)
      .first<{ author_profile_id: string }>();
    return row?.author_profile_id ?? null;
  }
  const row = await database
    .prepare(`SELECT p.author_profile_id FROM social_posts p
      WHERE p.id = ? AND p.moderated_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM social_post_moderation_cases c
          WHERE c.post_id = p.id AND c.status IN ('auto_held', 'hidden'))
      LIMIT 1`)
    .bind(ref.targetId)
    .first<{ author_profile_id: string | null }>();
  return row?.author_profile_id ?? null;
}

async function gateFor(database: D1Database, ref: ContentFileRef): Promise<AccessGate | null> {
  // Imported lazily: access-gates.ts imports this module for the unpublish hook.
  const { loadGatesForTargets } = await import("@/lib/server/gated-content");
  const gates = await loadGatesForTargets(database, ref.targetType, [ref.targetId]);
  return gates.get(ref.targetId) ?? null;
}

/** Exported for game builds (game-builds.ts), which share the file component transport. */
export async function sendTicketed(
  deps: ContentFileDeps,
  fileId: string,
  purpose: Extract<HubFileTicketPurpose, "file_publish" | "file_unpublish">,
): Promise<Response | null> {
  if (!deps.send || !deps.privateKeyPkcs8) return null;
  try {
    const signed = await signHubFileTicket({
      fileId,
      purpose,
      privateKeyPkcs8: deps.privateKeyPkcs8,
      now: deps.now?.(),
    });
    return await deps.send(signed.request.path, {
      method: "POST",
      headers: { [HUB_FILE_TICKET_HEADER]: signed.ticket },
    });
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ upload */

export type UploadTicket = {
  fileId: string;
  ticket: string;
  header: typeof HUB_FILE_TICKET_HEADER;
  method: "POST";
  path: string;
  expiresAt: string;
};

/**
 * Step 1 of an attachment: reserve storage and sign an upload ticket. The browser then POSTs the
 * file (multipart field `file`) to `path` with the ticket in `header`. Hub never sees the bytes.
 */
export async function issueContentFileUploadTicket(
  database: D1Database,
  deps: ContentFileDeps,
  profileId: string,
  input: { fileName: unknown; sizeBytes: unknown },
): Promise<UploadTicket> {
  const fileName = parseFileName(input.fileName);
  const sizeBytes = parseSize(input.sizeBytes);
  const privateKey = requireKey(deps);
  const open = await database
    .prepare("SELECT COUNT(*) AS n FROM hub_content_files WHERE owner_profile_id = ? AND state = 'upload_issued' AND target_id IS NULL")
    .bind(profileId)
    .first<{ n: number }>();
  if (Number(open?.n ?? 0) >= CONTENT_FILE_MAX_OPEN_UPLOADS) {
    throw new ContentFileError("too_many_uploads", 429, "未添付のファイルが多すぎます。先に添付するか取り除いてください。");
  }

  const fileId = newHubFileId();
  // Storage quota: reserve the declared size before anything is stored (content-file-storage.ts).
  const reserved = await deps.storage.reserve(database, { profileId, fileId, bytes: sizeBytes });
  if (!reserved.ok) {
    throw reserved.reason === "quota_exceeded"
      ? new ContentFileError("storage_quota_exceeded", 413, "保存容量の上限を超えます。")
      : new ContentFileError("storage_unavailable", 503, "保存容量を確認できませんでした。");
  }
  const now = nowIso(deps);
  try {
    await database
      .prepare(`INSERT INTO hub_content_files
        (id, owner_profile_id, target_type, target_id, file_name, declared_bytes, stored_bytes, state,
         scan_status, storage_reservation, storage_committed, created_at, updated_at)
        VALUES (?, ?, NULL, NULL, ?, ?, NULL, 'upload_issued', NULL, ?, 0, ?, ?)`)
      .bind(fileId, profileId, fileName, sizeBytes, reserved.reservation, now, now)
      .run();
  } catch (error) {
    await deps.storage.release(database, { profileId, fileId, reservation: reserved.reservation }).catch(() => undefined);
    throw error;
  }
  let signed: Awaited<ReturnType<typeof signHubFileTicket>>;
  try {
    signed = await signHubFileTicket({ fileId, purpose: "file_upload", privateKeyPkcs8: privateKey, now: deps.now?.() });
  } catch {
    throw new ContentFileError("files_unavailable", 503, "ファイルの添付は準備中です。");
  }
  return {
    fileId,
    ticket: signed.ticket,
    header: signed.header,
    method: "POST",
    path: signed.request.path,
    expiresAt: signed.expiresAt,
  };
}

/* ----------------------------------------------------------------- publish */

export type AttachResult = {
  fileId: string;
  status: "published" | "not_publishable" | "unavailable";
  scanStatus: string | null;
};

/**
 * Step 2: attach uploaded files to the author's gated post or article and publish them at the
 * component. Only the content's author, only while the content is live and gated.
 */
export async function attachContentFiles(
  database: D1Database,
  deps: ContentFileDeps,
  profileId: string,
  ref: ContentFileRef,
  rawFileIds: unknown,
): Promise<AttachResult[]> {
  if (!Array.isArray(rawFileIds) || rawFileIds.length < 1 || rawFileIds.length > CONTENT_FILE_MAX_PER_TARGET) {
    throw new ContentFileError("invalid_files", 400, "添付するファイルを指定してください。");
  }
  const fileIds = [...new Set(rawFileIds)];
  if (!fileIds.every(isHubFileId)) throw new ContentFileError("invalid_files", 400, "ファイルの指定が正しくありません。");
  requireKey(deps);
  if (!deps.send) throw new ContentFileError("files_unavailable", 503, "ファイルの添付は準備中です。");

  const author = await liveContentAuthor(database, ref);
  if (!author || author !== profileId) {
    throw new ContentFileError("forbidden", 403, "このコンテンツにファイルを付ける権限がありません。");
  }
  if (!(await gateFor(database, ref))) {
    throw new ContentFileError("gate_required", 409, "ファイルは閲覧条件を付けた投稿・記事にだけ添付できます。");
  }
  const attached = await database
    .prepare(`SELECT COUNT(*) AS n FROM hub_content_files
      WHERE target_type = ? AND target_id = ? AND state IN ('published', 'unpublish_pending', 'unpublished')
        AND id NOT IN (SELECT value FROM json_each(?))`)
    .bind(ref.targetType, ref.targetId, JSON.stringify(fileIds))
    .first<{ n: number }>();
  if (Number(attached?.n ?? 0) + fileIds.length > CONTENT_FILE_MAX_PER_TARGET) {
    throw new ContentFileError("too_many_files", 409, "1つの投稿・記事に付けられるファイルの数を超えます。");
  }

  const results: AttachResult[] = [];
  for (const fileId of fileIds) {
    const row = await readRow(database, fileId);
    const reusable =
      row &&
      row.owner_profile_id === profileId &&
      (row.state === "upload_issued" || row.state === "unpublished") &&
      (row.target_id === null || (row.target_type === ref.targetType && row.target_id === ref.targetId));
    if (!row || !reusable) {
      throw new ContentFileError("invalid_files", 400, "添付できないファイルが含まれています。");
    }
    // Bind the file to the target first, so an unpublish racing with this publish finds it.
    await database
      .prepare(`UPDATE hub_content_files SET target_type = ?, target_id = ?, updated_at = ?
        WHERE id = ? AND owner_profile_id = ? AND state IN ('upload_issued', 'unpublished')
          AND (target_type IS NULL OR target_type NOT IN ('game', 'work'))`)
      .bind(ref.targetType, ref.targetId, nowIso(deps), fileId, profileId)
      .run();
    const response = await sendTicketed(deps, fileId, "file_publish");
    const body = response ? await readFileBody(response) : null;
    if (response?.status === 200 && body?.publishState === "published") {
      const storedBytes = typeof body.sizeBytes === "number" && Number.isSafeInteger(body.sizeBytes) && body.sizeBytes > 0
        ? body.sizeBytes
        : row.declared_bytes;
      const scanStatus = typeof body.scanStatus === "string" ? body.scanStatus.slice(0, 20) : null;
      // The stored file may not be larger than the size reserved against the storage quota.
      if (storedBytes > row.declared_bytes) {
        await sendTicketed(deps, fileId, "file_unpublish");
        results.push({ fileId, status: "not_publishable", scanStatus: "size_mismatch" });
        continue;
      }
      // Storage quota: the first publish commits the stored size (content-file-storage.ts).
      // A commit that cannot be recorded closes the file again.
      if (!row.storage_committed) {
        const committed = await deps.storage
          .commit(database, { profileId, fileId, reservation: row.storage_reservation, bytes: storedBytes })
          .catch(() => false);
        if (!committed) {
          await sendTicketed(deps, fileId, "file_unpublish");
          results.push({ fileId, status: "unavailable", scanStatus });
          continue;
        }
        await database.prepare("UPDATE hub_content_files SET storage_committed = 1 WHERE id = ?").bind(fileId).run();
      }
      const now = nowIso(deps);
      const changed = await database
        .prepare(`UPDATE hub_content_files SET state = 'published', stored_bytes = ?, scan_status = ?,
            published_at = COALESCE(published_at, ?), updated_at = ?
          WHERE id = ? AND target_type = ? AND target_id = ? AND state IN ('upload_issued', 'unpublished')`)
        .bind(storedBytes, scanStatus, now, now, fileId, ref.targetType, ref.targetId)
        .run();
      if (Number(changed.meta?.changes ?? 0) !== 1) {
        // The content was unpublished while we published: undo at the component.
        await unpublishAttachedFiles(database, ref, deps);
        results.push({ fileId, status: "unavailable", scanStatus });
        continue;
      }
      results.push({ fileId, status: "published", scanStatus });
    } else if (response?.status === 409) {
      const scanStatus = typeof body?.scanStatus === "string" ? body.scanStatus.slice(0, 20) : null;
      await database
        .prepare("UPDATE hub_content_files SET scan_status = ?, updated_at = ? WHERE id = ?")
        .bind(scanStatus, nowIso(deps), fileId)
        .run();
      results.push({ fileId, status: "not_publishable", scanStatus });
    } else {
      results.push({ fileId, status: "unavailable", scanStatus: row.scan_status });
    }
  }
  // A gate removed while we were publishing must not leave files open.
  if (!(await gateFor(database, ref)) || !(await liveContentAuthor(database, ref))) {
    await unpublishAttachedFiles(database, ref, deps);
    throw new ContentFileError("gate_required", 409, "閲覧条件が外れたため、ファイルを公開しませんでした。");
  }
  return results;
}

export async function readFileBody(response: Response): Promise<Record<string, unknown> | null> {
  const payload = (await response.json().catch(() => null)) as { file?: unknown } | null;
  return payload && typeof payload.file === "object" && payload.file !== null
    ? (payload.file as Record<string, unknown>)
    : payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : null;
}

/* ---------------------------------------------------------------- reading */

export type ContentFileView = {
  id: string;
  fileName: string;
  sizeBytes: number;
  scanStatus: string | null;
  state?: ContentFileState;
};

type ViewerDecision = "author" | "allowed" | "locked" | "unavailable" | "absent";

async function decideViewer(
  database: D1Database,
  deps: ContentFileDeps,
  viewerProfileId: string | null,
  ref: ContentFileRef,
): Promise<ViewerDecision> {
  const author = await liveContentAuthor(database, ref);
  if (!author) return "absent";
  const gate = await gateFor(database, ref);
  if (!gate) return "absent";
  if (!viewerProfileId) return "locked";
  if (viewerProfileId === author || viewerProfileId === gate.ownerProfileId) return "author";
  const { toGateToVerify } = await import("@/lib/server/gated-content");
  try {
    const gateDeps = deps.gateDeps?.(database) ?? createGateVerificationDeps(database);
    const outcome = await checkGateForViewer(toGateToVerify(gate), viewerProfileId, gateDeps);
    if (outcome.result === "granted") return "allowed";
    return outcome.result === "unavailable" ? "unavailable" : "locked";
  } catch {
    return "unavailable";
  }
}

/**
 * Files on a gated post or article. Names and sizes are part of the gated content, so they are
 * returned only to the author or to a viewer whose gate check passes; otherwise an empty list.
 */
export async function listContentFiles(
  database: D1Database,
  deps: ContentFileDeps,
  viewerProfileId: string | null,
  ref: ContentFileRef,
): Promise<{ access: ViewerDecision; files: ContentFileView[]; downloadable: boolean }> {
  const access = await decideViewer(database, deps, viewerProfileId, ref);
  if (access !== "author" && access !== "allowed") return { access, files: [], downloadable: false };
  // Whether to offer the download button. The ticket route checks the setting again.
  const downloadable = access === "author"
    || (await readDownloadPolicy(database, ref).then((saved) => saved.policy !== "none", () => false));
  const states = access === "author" ? ["published", "unpublish_pending", "unpublished"] : ["published"];
  const { results } = await database
    .prepare(`SELECT id, file_name, declared_bytes, stored_bytes, scan_status, state FROM hub_content_files
      WHERE target_type = ? AND target_id = ? AND state IN (SELECT value FROM json_each(?))
      ORDER BY created_at, id LIMIT ?`)
    .bind(ref.targetType, ref.targetId, JSON.stringify(states), CONTENT_FILE_MAX_PER_TARGET)
    .all<Pick<ContentFileRow, "id" | "file_name" | "declared_bytes" | "stored_bytes" | "scan_status" | "state">>();
  return {
    access,
    downloadable,
    files: (results ?? []).map((row) => ({
      id: row.id,
      fileName: row.file_name,
      sizeBytes: Number(row.stored_bytes ?? row.declared_bytes),
      scanStatus: row.scan_status,
      ...(access === "author" ? { state: row.state } : {}),
    })),
  };
}

/** The author's own unattached uploads, for the composer. */
export async function listOwnUnattachedFiles(database: D1Database, profileId: string): Promise<ContentFileView[]> {
  const { results } = await database
    .prepare(`SELECT id, file_name, declared_bytes, stored_bytes, scan_status, state FROM hub_content_files
      WHERE owner_profile_id = ? AND target_id IS NULL AND state = 'upload_issued'
      ORDER BY created_at DESC LIMIT ?`)
    .bind(profileId, CONTENT_FILE_MAX_OPEN_UPLOADS)
    .all<Pick<ContentFileRow, "id" | "file_name" | "declared_bytes" | "stored_bytes" | "scan_status" | "state">>();
  return (results ?? []).map((row) => ({
    id: row.id,
    fileName: row.file_name,
    sizeBytes: Number(row.stored_bytes ?? row.declared_bytes),
    scanStatus: row.scan_status,
    state: row.state,
  }));
}

/* --------------------------------------------------------------- download */

/**
 * Step 3: a single-use download ticket, only after Hub's own server-side gate check for this
 * viewer. The browser opens `url` directly at the component; the ticket is good for one request.
 */
export async function issueContentFileDownloadTicket(
  database: D1Database,
  deps: ContentFileDeps,
  viewerProfileId: string | null,
  fileId: unknown,
): Promise<{ url: string; expiresAt: string }> {
  if (!isHubFileId(fileId)) throw new ContentFileError("not_found", 404, "ファイルが見つかりません。");
  const privateKey = requireKey(deps);
  const row = await readRow(database, fileId);
  // Game builds (game-builds.ts) and work deliveries (d1-work.ts) have their own checks; never through here.
  if (!row || row.state !== "published" || !row.target_type || !row.target_id || row.target_type === "game" || (row.target_type as string) === "work") {
    throw new ContentFileError("not_found", 404, "ファイルが見つかりません。");
  }
  const decision = await decideViewer(database, deps, viewerProfileId, { targetType: row.target_type, targetId: row.target_id });
  if (decision === "absent") throw new ContentFileError("not_found", 404, "ファイルが見つかりません。");
  if (decision === "unavailable") throw new ContentFileError("gate_unavailable", 503, "閲覧条件を確認できませんでした。");
  if (decision === "locked") {
    throw viewerProfileId
      ? new ContentFileError("locked", 403, "閲覧条件を満たしていません。")
      : new ContentFileError("authentication_required", 401, "ログインが必要です。");
  }
  // The creator's download setting (2026-10-17). Files follow their post or article; the gate
  // above already applies to every setting, so "entitled" and "anyone" both need it to pass.
  const target = { targetType: row.target_type, targetId: row.target_id };
  let policy: Awaited<ReturnType<typeof readDownloadPolicy>>["policy"];
  try {
    ({ policy } = await readDownloadPolicy(database, target));
  } catch {
    throw new ContentFileError("files_unavailable", 503, "ファイルを準備できませんでした。");
  }
  if (decision !== "author" && policy === "none") {
    throw new ContentFileError("download_not_allowed", 403, "作者はダウンロードを許可していません。");
  }
  // Re-read: an unpublish that ran during the gate check closes the ticket too.
  const current = await readRow(database, fileId);
  if (!current || current.state !== "published") throw new ContentFileError("not_found", 404, "ファイルが見つかりません。");
  const now = deps.now?.() ?? new Date();
  let grant: { id: string };
  try {
    grant = await recordDownloadGrant(database, {
      profileId: viewerProfileId,
      kind: "file",
      objectId: fileId,
      targetType: row.target_type,
      targetId: row.target_id,
      now,
    });
  } catch {
    throw new ContentFileError("files_unavailable", 503, "ファイルを準備できませんでした。");
  }
  let signed: Awaited<ReturnType<typeof signHubFileTicket>>;
  try {
    // The ticket's jti is the grant ID: the file component signs it into the download manifest.
    signed = await signHubFileTicket({ fileId, purpose: "file_download", privateKeyPkcs8: privateKey, jti: grant.id, now });
  } catch {
    await discardDownloadGrant(database, grant.id);
    throw new ContentFileError("files_unavailable", 503, "ファイルを準備できませんでした。");
  }
  return {
    url: `${signed.request.path}?ticket=${encodeURIComponent(signed.ticket)}`,
    expiresAt: signed.expiresAt,
  };
}

/* -------------------------------------------------------------- unpublish */

export type UnpublishSummary = { unpublished: number; pending: number };

/**
 * Unpublish every file attached to a post or article.
 *
 * Call it in the same operation that removes the content's gate, withdraws or deletes the
 * content, suspends it, or takes it down for copyright. It first marks the rows
 * `unpublish_pending` (Hub stops issuing download tickets immediately), then asks the file
 * component to unpublish each file with a single-use `file_unpublish` ticket. Files the component
 * could not be reached for stay pending and are retried by `retryPendingFileUnpublishes`.
 * Never throws; a failure leaves the files closed on the Hub side.
 */
export async function unpublishAttachedFiles(
  database: D1Database,
  contentRef: { targetType: ContentFileTargetType | "game"; targetId: string },
  deps: ContentFileDeps = contentFileDepsFromEnv(),
): Promise<UnpublishSummary> {
  try {
    await database
      .prepare(`UPDATE hub_content_files SET state = 'unpublish_pending', updated_at = ?
        WHERE target_type = ? AND target_id = ? AND state = 'published'`)
      .bind(nowIso(deps), contentRef.targetType, contentRef.targetId)
      .run();
    const { results } = await database
      .prepare("SELECT id FROM hub_content_files WHERE target_type = ? AND target_id = ? AND state = 'unpublish_pending'")
      .bind(contentRef.targetType, contentRef.targetId)
      .all<{ id: string }>();
    return await finishUnpublish(database, deps, (results ?? []).map((row) => row.id));
  } catch {
    console.warn(JSON.stringify({ event: "content_files_unpublish_failed", targetType: contentRef.targetType }));
    return { unpublished: 0, pending: -1 };
  }
}

async function finishUnpublish(database: D1Database, deps: ContentFileDeps, fileIds: string[]): Promise<UnpublishSummary> {
  let unpublished = 0;
  let pending = 0;
  for (const fileId of fileIds) {
    const response = await sendTicketed(deps, fileId, "file_unpublish");
    // 404: the component holds no such file, so nothing can be delivered either.
    if (response && (response.status === 200 || response.status === 404)) {
      await database
        .prepare(`UPDATE hub_content_files SET state = 'unpublished', unpublished_at = ?, updated_at = ?
          WHERE id = ? AND state = 'unpublish_pending'`)
        .bind(nowIso(deps), nowIso(deps), fileId)
        .run();
      unpublished += 1;
    } else {
      pending += 1;
    }
  }
  if (pending) console.warn(JSON.stringify({ event: "content_files_unpublish_pending", count: pending }));
  return { unpublished, pending };
}

/** Unpublish specific files (one game build). Hub stops issuing tickets before the component answers. */
export async function unpublishContentFileIds(
  database: D1Database,
  deps: ContentFileDeps,
  fileIds: string[],
): Promise<UnpublishSummary> {
  for (const fileId of fileIds) {
    await database
      .prepare("UPDATE hub_content_files SET state = 'unpublish_pending', updated_at = ? WHERE id = ? AND state = 'published'")
      .bind(nowIso(deps), fileId)
      .run();
  }
  return finishUnpublish(database, deps, fileIds);
}

/** Maintenance job: retry component unpublishes that could not be delivered. */
export async function retryPendingFileUnpublishes(
  database: D1Database,
  deps: ContentFileDeps = contentFileDepsFromEnv(),
  limit = 50,
): Promise<UnpublishSummary> {
  const { results } = await database
    .prepare("SELECT id FROM hub_content_files WHERE state = 'unpublish_pending' ORDER BY updated_at LIMIT ?")
    .bind(limit)
    .all<{ id: string }>();
  return finishUnpublish(database, deps, (results ?? []).map((row) => row.id));
}

/**
 * The author removes one attachment. Published files are unpublished first; an upload that was
 * never committed releases its storage reservation. Stored bytes stay counted while the file
 * component still holds them (it has no delete yet).
 */
export async function removeContentFile(
  database: D1Database,
  deps: ContentFileDeps,
  profileId: string,
  fileId: unknown,
): Promise<{ removed: boolean; pending: boolean }> {
  if (!isHubFileId(fileId)) throw new ContentFileError("not_found", 404, "ファイルが見つかりません。");
  const row = await readRow(database, fileId);
  if (!row || row.owner_profile_id !== profileId || row.state === "removed") {
    throw new ContentFileError("not_found", 404, "ファイルが見つかりません。");
  }
  let pending = false;
  if (row.state === "published" || row.state === "unpublish_pending") {
    await database
      .prepare("UPDATE hub_content_files SET state = 'unpublish_pending', updated_at = ? WHERE id = ? AND state IN ('published', 'unpublish_pending')")
      .bind(nowIso(deps), fileId)
      .run();
    const summary = await finishUnpublish(database, deps, [fileId]);
    pending = summary.pending > 0;
    if (pending) return { removed: false, pending };
  }
  await database
    .prepare("UPDATE hub_content_files SET state = 'removed', updated_at = ? WHERE id = ? AND state IN ('upload_issued', 'unpublished')")
    .bind(nowIso(deps), fileId)
    .run();
  if (!row.storage_committed) {
    // Storage quota: give back a reservation that was never committed (content-file-storage.ts).
    await deps.storage.release(database, { profileId, fileId, reservation: row.storage_reservation }).catch(() => undefined);
  }
  return { removed: true, pending: false };
}
