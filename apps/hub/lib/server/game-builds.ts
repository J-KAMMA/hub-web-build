/*
 * Game builds and owner downloads (owner approved 2026-10-16/18; docs/hub-software/PLAN.md §2.5 step 7,
 * §2.8, §9 Q1/Q5; DRM.md §9A ④, §10).
 *
 * A build is a file-component file (`apps/vault`). It reuses the content-file plumbing: the creator
 * gets an ordinary upload ticket (POST /api/content-files), uploads straight to the component, then
 * registers the file here as a version of the game. Hub binds the file to target_type 'game' and asks
 * the component to publish it with a single-use `file_publish` ticket; the component's answer must
 * report the same SHA-256 the creator registered, or the file is closed again.
 *
 * Download: Hub checks, server-side and at request time, that the game is live and listed, the build is
 * published, the viewer owns the game (hub_game_library: a free add or an unrevoked Commerce grant) and,
 * for a paid or 18-rated game, that the viewer declared 18+ (Q5). Only then does it record a download
 * row and sign a `file_download` ticket whose jti is that row's random ID. The component signs the ID
 * into the download manifest next to the untouched build: that is the per-buyer watermark. The ID ->
 * purchase mapping stays here and is purged 3 years after the sale. The ticket carries only the file
 * ID, purpose, times and that ID. Hub never returns an object key or a signed storage URL.
 */
import type { D1Database } from "@cloudflare/workers-types";

import {
  readFileBody,
  sendTicketed,
  unpublishAttachedFiles,
  unpublishContentFileIds,
  type ContentFileDeps,
} from "@/lib/server/content-files";
import {
  GameStoreError,
  canManageGame,
  gameNeedsAdultDeclaration,
  hasAdultDeclaration,
  type GameAgeRating,
  type GameStoreListing,
} from "@/lib/server/d1-game-store";
import { getGameSellerVerification } from "@/lib/server/game-seller-verification";
import { isHubFileId, signHubFileTicket } from "@/lib/server/hub-file-ticket";

export const GAME_BUILD_PLATFORMS = ["windows", "macos", "linux"] as const;
export const GAME_BUILD_KINDS = ["full", "demo"] as const;
export const GAME_BUILD_CHANNELS = ["stable", "beta"] as const;
export const GAME_BUILD_LIST_MAX = 50;
export const GAME_BUILD_TICKET_SECONDS = 120;
/** DRM.md §10 (owner decision 2026-10-17): the watermark ID -> purchase mapping lives 3 years from the sale. */
export const GAME_WATERMARK_RETENTION_DAYS = 3 * 365;

export type GameBuildPlatform = (typeof GAME_BUILD_PLATFORMS)[number];
export type GameBuildView = {
  id: string;
  version: string;
  platform: GameBuildPlatform;
  kind: "full" | "demo";
  channel: "stable" | "beta";
  sha256: string;
  sizeBytes: number;
  notes: string | null;
  createdAt: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GAME_ID = /^[A-Za-z0-9_-]{1,128}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const VERSION = /^[\p{L}\p{N} ._+\-()]{1,64}$/u;

type GameRow = { id: string; status: string; store_listing: GameStoreListing | null; age_rating: GameAgeRating | null };

async function readGame(database: D1Database, gameId: string): Promise<GameRow | null> {
  if (!GAME_ID.test(gameId)) return null;
  return database.prepare("SELECT id, status, store_listing, age_rating FROM game_guide_hubs WHERE id = ? LIMIT 1")
    .bind(gameId).first<GameRow>();
}

function pick<T extends string>(value: unknown, allowed: readonly T[], code: string): T {
  if (typeof value === "string" && (allowed as readonly string[]).includes(value)) return value as T;
  throw new GameStoreError(code, 400);
}

export type GameBuildInput = { fileId: unknown; version: unknown; platform: unknown; kind?: unknown; channel?: unknown; sha256: unknown; notes?: unknown };

export function parseGameBuildInput(input: GameBuildInput) {
  if (!isHubFileId(input.fileId)) throw new GameStoreError("invalid_file", 400);
  const version = typeof input.version === "string" ? input.version.normalize("NFC").trim() : "";
  if (!VERSION.test(version)) throw new GameStoreError("invalid_version", 400);
  const sha256 = typeof input.sha256 === "string" ? input.sha256.trim().toLowerCase() : "";
  if (!SHA256.test(sha256)) throw new GameStoreError("invalid_sha256", 400);
  let notes: string | null = null;
  if (input.notes !== undefined && input.notes !== null && input.notes !== "") {
    if (typeof input.notes !== "string" || input.notes.length > 2000) throw new GameStoreError("invalid_notes", 400);
    notes = input.notes.replace(/\r\n?/g, "\n").trim() || null;
  }
  return {
    fileId: input.fileId,
    version,
    platform: pick(input.platform, GAME_BUILD_PLATFORMS, "invalid_platform"),
    kind: pick(input.kind ?? "full", GAME_BUILD_KINDS, "invalid_kind"),
    channel: pick(input.channel ?? "stable", GAME_BUILD_CHANNELS, "invalid_channel"),
    sha256,
    notes,
  };
}

type FileRow = {
  id: string; owner_profile_id: string; target_type: string | null; target_id: string | null; state: string;
  declared_bytes: number; storage_reservation: string | null; storage_committed: number;
};

async function readFile(database: D1Database, fileId: string) {
  return database.prepare(`SELECT id, owner_profile_id, target_type, target_id, state, declared_bytes, storage_reservation,
      storage_committed FROM hub_content_files WHERE id = ?`).bind(fileId).first<FileRow>();
}

/**
 * Registers an uploaded file as a build of the game and publishes it at the component. Only a manager
 * of the game (canManageGame), only the uploader's own unattached file. Fails closed: no key or no
 * transport, a component that does not publish, a different SHA-256 or a larger stored size all leave
 * the file unpublished and the build unregistered.
 */
export async function registerGameBuild(
  database: D1Database,
  deps: ContentFileDeps,
  profileId: string,
  gameId: string,
  input: GameBuildInput,
  options: { identityVerified?: boolean } = {},
): Promise<GameBuildView> {
  const game = await readGame(database, gameId);
  if (!game) throw new GameStoreError("game_not_found", 404);
  if (!await canManageGame(database, gameId, profileId)) throw new GameStoreError("forbidden", 403);
  const build = parseGameBuildInput(input);
  // Owner decisions 2026-10-16 / 2026-10-29: executables need Commerce's seller verification (販売者確認). Builds can be
  // executables or archives holding them, so every build is refused unless the profile holds an unexpired
  // game_seller_verified_at (an explicit `identityVerified` overrides it, for tests). Unpublishing stays allowed.
  const verified = options.identityVerified
    ?? (await getGameSellerVerification(database, profileId, deps.now?.() ?? new Date())).verified;
  if (verified !== true) throw new GameStoreError("identity_required", 409);
  if (!deps.privateKeyPkcs8 || !deps.send) throw new GameStoreError("files_unavailable", 503);
  const file = await readFile(database, build.fileId);
  if (!file || file.owner_profile_id !== profileId || file.state !== "upload_issued" || file.target_id !== null) {
    throw new GameStoreError("invalid_file", 400);
  }
  const now = (deps.now?.() ?? new Date()).toISOString();
  const buildId = crypto.randomUUID();
  // The build row first (file_id is UNIQUE), then bind the file; a download needs both.
  await database.prepare(`INSERT INTO hub_game_builds (id, game_id, file_id, version, platform, kind, channel, sha256, notes,
      created_by_profile_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(buildId, gameId, build.fileId, build.version, build.platform, build.kind, build.channel, build.sha256, build.notes, profileId, now)
    .run().catch(() => { throw new GameStoreError("invalid_file", 400); });
  const bound = await database.prepare(`UPDATE hub_content_files SET target_type = 'game', target_id = ?, updated_at = ?
      WHERE id = ? AND owner_profile_id = ? AND state = 'upload_issued' AND target_id IS NULL`)
    .bind(gameId, now, build.fileId, profileId).run();
  const undo = async (code: string, status: number, unpublish: boolean): Promise<never> => {
    if (unpublish) await sendTicketed(deps, build.fileId, "file_unpublish");
    await database.prepare("DELETE FROM hub_game_builds WHERE id = ?").bind(buildId).run();
    await database.prepare(`UPDATE hub_content_files SET target_type = NULL, target_id = NULL, updated_at = ?
        WHERE id = ? AND state = 'upload_issued' AND target_type = 'game'`).bind(now, build.fileId).run();
    throw new GameStoreError(code, status);
  };
  if (Number(bound.meta?.changes ?? 0) !== 1) return undo("invalid_file", 400, false);

  const response = await sendTicketed(deps, build.fileId, "file_publish");
  const body = response ? await readFileBody(response) : null;
  if (!response || response.status !== 200 || body?.publishState !== "published") {
    return undo(response?.status === 409 ? "build_not_publishable" : "files_unavailable", response?.status === 409 ? 409 : 503, Boolean(response && response.status === 200));
  }
  const reported = typeof body.sha256 === "string" ? body.sha256.toLowerCase() : "";
  if (reported !== build.sha256) return undo("sha256_mismatch", 409, true);
  const storedBytes = typeof body.sizeBytes === "number" && Number.isSafeInteger(body.sizeBytes) && body.sizeBytes > 0 ? body.sizeBytes : file.declared_bytes;
  if (storedBytes > file.declared_bytes) return undo("size_mismatch", 409, true);
  if (!file.storage_committed) {
    const committed = await deps.storage
      .commit(database, { profileId, fileId: build.fileId, reservation: file.storage_reservation, bytes: storedBytes })
      .catch(() => false);
    if (!committed) return undo("storage_unavailable", 503, true);
    await database.prepare("UPDATE hub_content_files SET storage_committed = 1 WHERE id = ?").bind(build.fileId).run();
  }
  const scanStatus = typeof body.scanStatus === "string" ? body.scanStatus.slice(0, 20) : null;
  const changed = await database.prepare(`UPDATE hub_content_files SET state = 'published', stored_bytes = ?, scan_status = ?,
      published_at = COALESCE(published_at, ?), updated_at = ?
    WHERE id = ? AND target_type = 'game' AND target_id = ? AND state = 'upload_issued'`)
    .bind(storedBytes, scanStatus, now, now, build.fileId, gameId).run();
  if (Number(changed.meta?.changes ?? 0) !== 1) {
    await unpublishContentFileIds(database, deps, [build.fileId]);
    throw new GameStoreError("files_unavailable", 503);
  }
  return {
    id: buildId, version: build.version, platform: build.platform, kind: build.kind, channel: build.channel,
    sha256: build.sha256, sizeBytes: storedBytes, notes: build.notes, createdAt: now,
  };
}

/** Published builds of a live, listed game, newest first. Public metadata only (no file ID). */
export async function listGameBuilds(database: D1Database, gameId: string): Promise<GameBuildView[]> {
  const game = await readGame(database, gameId);
  if (!game || game.status !== "published" || !game.store_listing) return [];
  const { results } = await database.prepare(`SELECT b.id, b.version, b.platform, b.kind, b.channel, b.sha256, b.notes, b.created_at,
      f.stored_bytes, f.declared_bytes
    FROM hub_game_builds b JOIN hub_content_files f ON f.id = b.file_id
    WHERE b.game_id = ? AND f.state = 'published' AND f.target_type = 'game' AND f.target_id = b.game_id
    ORDER BY b.created_at DESC, b.id DESC LIMIT ${GAME_BUILD_LIST_MAX}`)
    .bind(gameId)
    .all<{ id: string; version: string; platform: GameBuildPlatform; kind: "full" | "demo"; channel: "stable" | "beta"; sha256: string; notes: string | null; created_at: string; stored_bytes: number | null; declared_bytes: number }>();
  return (results ?? []).map((row) => ({
    id: row.id, version: row.version, platform: row.platform, kind: row.kind, channel: row.channel, sha256: row.sha256,
    sizeBytes: Number(row.stored_bytes ?? row.declared_bytes), notes: row.notes, createdAt: row.created_at,
  }));
}

/** A manager withdraws one build. Hub stops issuing tickets at once, then the component unpublishes. */
export async function removeGameBuild(database: D1Database, deps: ContentFileDeps, profileId: string, gameId: string, buildId: string) {
  if (!UUID.test(buildId)) throw new GameStoreError("build_not_found", 404);
  if (!await canManageGame(database, gameId, profileId)) throw new GameStoreError("forbidden", 403);
  const row = await database.prepare("SELECT file_id FROM hub_game_builds WHERE id = ? AND game_id = ?").bind(buildId, gameId).first<{ file_id: string }>();
  if (!row) throw new GameStoreError("build_not_found", 404);
  const summary = await unpublishContentFileIds(database, deps, [row.file_id]);
  return { removed: true, pending: summary.pending > 0 };
}

/** Closes every build of a game: call it in the same request that unlists or unpublishes the game. */
export function unpublishGameBuilds(database: D1Database, deps: ContentFileDeps, gameId: string) {
  return unpublishAttachedFiles(database, { targetType: "game", targetId: gameId }, deps);
}

/**
 * A single-use download ticket for one build, only after Hub's own checks for this viewer.
 * Managers of the game may always fetch their own builds; everybody else needs ownership and,
 * for a paid or 18-rated game, the 18+ declaration.
 */
export async function issueGameBuildDownloadTicket(
  database: D1Database,
  deps: ContentFileDeps,
  profileId: string,
  gameId: string,
  buildId: string,
): Promise<{ url: string; expiresAt: string; sha256: string }> {
  if (!UUID.test(buildId)) throw new GameStoreError("build_not_found", 404);
  const game = await readGame(database, gameId);
  if (!game || game.status !== "published" || !game.store_listing) throw new GameStoreError("game_not_found", 404);
  if (!deps.privateKeyPkcs8) throw new GameStoreError("files_unavailable", 503);
  const build = await database.prepare(`SELECT b.file_id, b.sha256 FROM hub_game_builds b JOIN hub_content_files f ON f.id = b.file_id
      WHERE b.id = ? AND b.game_id = ? AND f.state = 'published' AND f.target_type = 'game' AND f.target_id = b.game_id`)
    .bind(buildId, gameId).first<{ file_id: string; sha256: string }>();
  if (!build) throw new GameStoreError("build_not_found", 404);

  const manager = await canManageGame(database, gameId, profileId);
  let saleAt: Date | null = null;
  if (!manager) {
    const owned = await database.prepare("SELECT source, added_at FROM hub_game_library WHERE profile_id = ? AND game_id = ?")
      .bind(profileId, gameId).first<{ source: "free" | "commerce"; added_at: string }>();
    if (!owned) throw new GameStoreError("not_owned", 403);
    // A purchased game must still hold an unrevoked Commerce grant; a stale library row never downloads.
    if (owned.source === "commerce") {
      const grant = await database.prepare(`SELECT MIN(granted_at) AS granted_at FROM hub_game_grants
          WHERE profile_id = ? AND game_id = ? AND revoked_at IS NULL`).bind(profileId, gameId).first<{ granted_at: string | null }>();
      if (!grant?.granted_at) throw new GameStoreError("not_owned", 403);
      saleAt = new Date(grant.granted_at);
    } else {
      saleAt = new Date(owned.added_at);
      // A free game that is now sold needs a purchase; the earlier free add does not carry over.
      if (game.store_listing !== "free") throw new GameStoreError("not_owned", 403);
    }
    if (gameNeedsAdultDeclaration(game) && !await hasAdultDeclaration(database, profileId)) {
      throw new GameStoreError("age_declaration_required", 403);
    }
  }

  const now = deps.now?.() ?? new Date();
  const base = saleAt && Number.isFinite(saleAt.getTime()) ? saleAt : now;
  const downloadId = crypto.randomUUID();
  const expiresAt = new Date(now.getTime() + GAME_BUILD_TICKET_SECONDS * 1000).toISOString();
  const purgeAfter = new Date(base.getTime() + GAME_WATERMARK_RETENTION_DAYS * 86_400_000).toISOString();
  try {
    await database.prepare(`INSERT INTO hub_game_build_downloads (id, profile_id, game_id, build_id, issued_at, expires_at, purge_after)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(downloadId, profileId, gameId, buildId, now.toISOString(), expiresAt, purgeAfter).run();
  } catch {
    throw new GameStoreError("files_unavailable", 503);
  }
  try {
    const signed = await signHubFileTicket({
      fileId: build.file_id,
      purpose: "file_download",
      privateKeyPkcs8: deps.privateKeyPkcs8,
      lifetimeSeconds: GAME_BUILD_TICKET_SECONDS,
      jti: downloadId,
      now,
    });
    return { url: `${signed.request.path}?ticket=${encodeURIComponent(signed.ticket)}`, expiresAt: signed.expiresAt, sha256: build.sha256 };
  } catch {
    await database.prepare("DELETE FROM hub_game_build_downloads WHERE id = ?").bind(downloadId).run().catch(() => undefined);
    throw new GameStoreError("files_unavailable", 503);
  }
}
