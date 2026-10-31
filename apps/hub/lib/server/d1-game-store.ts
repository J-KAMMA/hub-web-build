/*
 * Game store backend in Hub (owner approved 2026-10-18; docs/hub-software/PLAN.md §2.5, DRM.md).
 *
 * Hub owns the listing (free or paid-through-one-Commerce-product), screenshots, system requirements
 * and the owned-games library. Commerce owns price, checkout, orders and refunds; Hub never sees an
 * order ID or access token, only a verified game-entitlement proof (game-entitlement-proof.ts).
 * Every query here is indexed and bounded; there is no OFFSET and no aggregate on a render path.
 */
import type { D1Database, R2Bucket } from "@cloudflare/workers-types";

import type { VerifiedGameEntitlementProof } from "./game-entitlement-proof";
import { deleteGameImage, gameImageUrl, storeGameImage } from "./game-image-storage";

export class GameStoreError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
  }
}

export type GameStoreListing = "free" | "paid";
/** The creator's own rating (PLAN.md §2.7). NULL in the database reads as "all". */
export type GameAgeRating = "all" | "12" | "15" | "18";
export const GAME_AGE_RATINGS: readonly GameAgeRating[] = ["all", "12", "15", "18"];
export type GameStoreSettings = {
  storeListing: GameStoreListing | null;
  commerceProductId: string | null;
  requirementsMinimum: string | null;
  requirementsRecommended: string | null;
  releaseDate: string | null;
  platforms: string[];
  ageRating: GameAgeRating;
};
export type GameScreenshot = { id: string; url: string; position: number };
export type GameOwnership = { owned: boolean; source: "free" | "commerce" | null };
export type GameLibraryEntry = {
  gameId: string;
  slug: string;
  title: string;
  imageUrl: string | null;
  platforms: string[];
  source: "free" | "commerce";
  addedAt: string;
};

export const GAME_SCREENSHOT_LIMIT = 8;
export const GAME_REQUIREMENTS_MAX = 2000;
export const GAME_LIBRARY_PAGE_MAX = 50;
/** Store platforms: the game-guide list plus the desktop systems a sold build can target. */
export const GAME_STORE_PLATFORMS = new Set([
  "PC", "Windows", "macOS", "Linux", "PlayStation 5", "PlayStation 4", "Xbox Series X|S", "Xbox One",
  "Nintendo Switch", "iOS", "Android", "その他",
]);
const RIGHTS = new Set(["official_permission", "user_created", "licensed"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GAME_ID = /^[A-Za-z0-9_-]{1,128}$/;

type GameStoreRow = {
  id: string;
  status: string;
  store_listing: GameStoreListing | null;
  commerce_product_id: string | null;
  requirements_minimum: string | null;
  requirements_recommended: string | null;
  release_date: string | null;
  platforms: string | null;
  age_rating: GameAgeRating | null;
};

export function parseGamePlatforms(value: string | null | undefined): string[] {
  try {
    const parsed: unknown = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

async function readGame(database: D1Database, gameId: string) {
  if (!GAME_ID.test(gameId)) return null;
  return database.prepare(`SELECT id, status, store_listing, commerce_product_id, requirements_minimum,
      requirements_recommended, release_date, platforms, age_rating
    FROM game_guide_hubs WHERE id = ? LIMIT 1`).bind(gameId).first<GameStoreRow>();
}

function settingsFrom(row: GameStoreRow): GameStoreSettings {
  return {
    storeListing: row.store_listing,
    commerceProductId: row.commerce_product_id,
    requirementsMinimum: row.requirements_minimum,
    requirementsRecommended: row.requirements_recommended,
    releaseDate: row.release_date,
    platforms: parseGamePlatforms(row.platforms),
    ageRating: row.age_rating ?? "all",
  };
}

/*
 * The age check (PLAN.md §9 Q5, decided 2026-10-16): buying is only for people who declared they are
 * 18 or older, and an `18`-rated game, free or paid, needs the same declaration. 16- and 17-year-olds
 * (Hub's minimum age is 16) may add free games rated below 18. The declaration is the profile's own
 * statement; Hub keeps only that it was made and when (no birthdate, no Identity data).
 */
export function gameNeedsAdultDeclaration(game: { store_listing: GameStoreListing | null; age_rating: GameAgeRating | null }): boolean {
  return game.store_listing === "paid" || game.age_rating === "18";
}

export async function hasAdultDeclaration(database: D1Database, profileId: string): Promise<boolean> {
  const row = await database.prepare("SELECT 1 AS ok FROM hub_game_age_declarations WHERE profile_id = ? LIMIT 1")
    .bind(profileId).first<{ ok: number }>();
  return Boolean(row);
}

/** 「18歳以上です」. Idempotent; the first declaration time is kept. */
export async function declareAdult(database: D1Database, profileId: string, now = new Date()): Promise<{ declared: true; declaredAt: string }> {
  await database.prepare(`INSERT INTO hub_game_age_declarations (profile_id, declared_at) VALUES (?, ?)
    ON CONFLICT(profile_id) DO NOTHING`).bind(profileId, now.toISOString()).run();
  const row = await database.prepare("SELECT declared_at FROM hub_game_age_declarations WHERE profile_id = ?")
    .bind(profileId).first<{ declared_at: string }>();
  if (!row) throw new GameStoreError("age_declaration_unavailable", 503);
  return { declared: true, declaredAt: row.declared_at };
}

/** Withdraws the declaration. Owned games stay; new purchases and 18-rated adds close again. */
export async function withdrawAdultDeclaration(database: D1Database, profileId: string): Promise<{ declared: false }> {
  await database.prepare("DELETE FROM hub_game_age_declarations WHERE profile_id = ?").bind(profileId).run();
  return { declared: false };
}

async function requireAdultDeclarationFor(database: D1Database, profileId: string, game: GameStoreRow) {
  if (gameNeedsAdultDeclaration(game) && !await hasAdultDeclaration(database, profileId)) {
    throw new GameStoreError("age_declaration_required", 403);
  }
}

/** The same people who may change the game image: owners/moderators of an owner-approved linked community, or the submitter. */
export async function canManageGame(database: D1Database, gameId: string, profileId: string): Promise<boolean> {
  const row = await database.prepare(`SELECT 1 AS ok FROM game_guide_hubs WHERE id = ?1 AND created_by_profile_id = ?2
    UNION ALL
    SELECT 1 AS ok FROM game_guide_community_links l JOIN community_memberships m ON m.community_id = l.community_id
      WHERE l.game_id = ?1 AND l.approved_at IS NOT NULL AND m.profile_id = ?2 AND m.status = 'active' AND m.role IN ('owner','moderator')
    LIMIT 1`).bind(gameId, profileId).first<{ ok: number }>();
  return Boolean(row);
}

/**
 * Who decides which communities may link to a game: the submitter, or an owner/moderator of an approved
 * 'maintainer' community. A contributor link never confers this.
 */
export async function isGameOwner(database: D1Database, gameId: string, profileId: string): Promise<boolean> {
  const row = await database.prepare(`SELECT 1 AS ok FROM game_guide_hubs WHERE id = ?1 AND created_by_profile_id = ?2
    UNION ALL
    SELECT 1 AS ok FROM game_guide_community_links l JOIN community_memberships m ON m.community_id = l.community_id
      WHERE l.game_id = ?1 AND l.role = 'maintainer' AND l.approved_at IS NOT NULL
        AND m.profile_id = ?2 AND m.status = 'active' AND m.role IN ('owner','moderator')
    LIMIT 1`).bind(gameId, profileId).first<{ ok: number }>();
  return Boolean(row);
}

async function requireManager(database: D1Database, gameId: string, profileId: string) {
  const game = await readGame(database, gameId);
  if (!game) throw new GameStoreError("game_not_found", 404);
  if (!await canManageGame(database, gameId, profileId)) throw new GameStoreError("forbidden", 403);
  return game;
}

export type ManagedGame = { id: string; slug: string; title: string; status: string; storeListing: GameStoreListing | null };

/** The games a profile may sell: the ones it can manage (submitter, or owner/moderator of an approved linked community). Bounded. */
export async function listManagedGames(database: D1Database, profileId: string, limit = 50): Promise<ManagedGame[]> {
  const result = await database.prepare(`SELECT id, slug, title, status, store_listing FROM game_guide_hubs
    WHERE created_by_profile_id = ?1
       OR id IN (SELECT l.game_id FROM game_guide_community_links l JOIN community_memberships m ON m.community_id = l.community_id
         WHERE l.approved_at IS NOT NULL AND m.profile_id = ?1 AND m.status = 'active' AND m.role IN ('owner','moderator'))
    ORDER BY updated_at DESC LIMIT ?2`).bind(profileId, Math.min(Math.max(1, limit), 100))
    .all<{ id: string; slug: string; title: string; status: string; store_listing: GameStoreListing | null }>();
  return (result.results ?? []).map((row) => ({ id: row.id, slug: row.slug, title: row.title, status: row.status, storeListing: row.store_listing }));
}

export async function readGameStoreSettings(database: D1Database, profileId: string, gameId: string) {
  const game = await requireManager(database, gameId, profileId);
  return { settings: settingsFrom(game), screenshots: await listGameScreenshots(database, gameId) };
}

function optionalText(value: unknown, field: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") throw new GameStoreError(`invalid_${field}`, 400);
  const trimmed = value.replace(/\r\n?/g, "\n").trim();
  if (trimmed.length > GAME_REQUIREMENTS_MAX) throw new GameStoreError(`invalid_${field}`, 400);
  return trimmed || null;
}

/** Validates a partial update. Unknown keys are ignored; anything malformed is refused before a write. */
export function parseGameStoreUpdate(body: Record<string, unknown>, current: GameStoreSettings): GameStoreSettings {
  const next = { ...current, platforms: [...current.platforms] };
  if (body.storeListing !== undefined) {
    if (body.storeListing === null || body.storeListing === "none") next.storeListing = null;
    else if (body.storeListing === "free" || body.storeListing === "paid") next.storeListing = body.storeListing;
    else throw new GameStoreError("invalid_store_listing", 400);
  }
  if (body.commerceProductId !== undefined) {
    if (body.commerceProductId === null || body.commerceProductId === "") next.commerceProductId = null;
    else if (typeof body.commerceProductId === "string" && UUID.test(body.commerceProductId.trim())) next.commerceProductId = body.commerceProductId.trim().toLowerCase();
    else throw new GameStoreError("invalid_commerce_product_id", 400);
  }
  const minimum = optionalText(body.requirementsMinimum, "requirements_minimum");
  if (minimum !== undefined) next.requirementsMinimum = minimum;
  const recommended = optionalText(body.requirementsRecommended, "requirements_recommended");
  if (recommended !== undefined) next.requirementsRecommended = recommended;
  if (body.releaseDate !== undefined) {
    if (body.releaseDate === null || body.releaseDate === "") next.releaseDate = null;
    else if (typeof body.releaseDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.releaseDate) && Number.isFinite(Date.parse(`${body.releaseDate}T00:00:00Z`))) next.releaseDate = body.releaseDate;
    else throw new GameStoreError("invalid_release_date", 400);
  }
  if (body.ageRating !== undefined) {
    if (body.ageRating === null) next.ageRating = "all";
    else if (typeof body.ageRating === "string" && (GAME_AGE_RATINGS as readonly string[]).includes(body.ageRating)) next.ageRating = body.ageRating as GameAgeRating;
    else throw new GameStoreError("invalid_age_rating", 400);
  }
  if (body.platforms !== undefined) {
    if (!Array.isArray(body.platforms) || body.platforms.some((item) => typeof item !== "string" || !GAME_STORE_PLATFORMS.has(item))) throw new GameStoreError("invalid_platforms", 400);
    next.platforms = [...new Set(body.platforms as string[])].slice(0, 12);
    if (!next.platforms.length) throw new GameStoreError("invalid_platforms", 400);
  }
  if (next.storeListing === "paid" && !next.commerceProductId) throw new GameStoreError("commerce_product_required", 400);
  // A free or unlisted game keeps no product link, so a stale link can never sell it.
  if (next.storeListing !== "paid") next.commerceProductId = null;
  return next;
}

export async function updateGameStoreSettings(database: D1Database, profileId: string, gameId: string, body: Record<string, unknown>, now = new Date()) {
  const game = await requireManager(database, gameId, profileId);
  const next = parseGameStoreUpdate(body, settingsFrom(game));
  // Only a published game record may be put on sale; unlisting (storeListing null) is always allowed.
  if (next.storeListing && game.status !== "published") throw new GameStoreError("game_not_published", 409);
  await database.prepare(`UPDATE game_guide_hubs SET store_listing = ?, commerce_product_id = ?, requirements_minimum = ?,
      requirements_recommended = ?, release_date = ?, platforms = ?, age_rating = ?, updated_at = ? WHERE id = ?`)
    .bind(next.storeListing, next.commerceProductId, next.requirementsMinimum, next.requirementsRecommended,
      next.releaseDate, JSON.stringify(next.platforms), next.ageRating, now.toISOString(), gameId).run();
  return next;
}

export async function listGameScreenshots(database: D1Database, gameId: string): Promise<GameScreenshot[]> {
  const result = await database.prepare(`SELECT id, position FROM hub_game_screenshots WHERE game_id = ?
    ORDER BY position LIMIT ${GAME_SCREENSHOT_LIMIT}`).bind(gameId).all<{ id: string; position: number }>();
  return (result.results ?? []).map((row) => ({ id: row.id, position: Number(row.position), url: gameImageUrl(gameId, row.id) }));
}

export async function addGameScreenshot(
  database: D1Database,
  bucket: R2Bucket,
  profileId: string,
  gameId: string,
  input: { imageDataUrl: unknown; rightsBasis: unknown; attribution: unknown },
  now = new Date(),
): Promise<GameScreenshot> {
  await requireManager(database, gameId, profileId);
  if (typeof input.rightsBasis !== "string" || !RIGHTS.has(input.rightsBasis)) throw new GameStoreError("invalid_rights_basis", 400);
  const attribution = typeof input.attribution === "string" ? input.attribution.trim().slice(0, 200) : "";
  if (input.rightsBasis !== "user_created" && !attribution) throw new GameStoreError("attribution_required", 400);
  const taken = new Set((await listGameScreenshots(database, gameId)).map((shot) => shot.position));
  const position = Array.from({ length: GAME_SCREENSHOT_LIMIT }, (_, index) => index).find((index) => !taken.has(index));
  if (position === undefined) throw new GameStoreError("screenshot_limit", 409);
  let stored: { imageUrl: string; version: string };
  try {
    stored = await storeGameImage(bucket, gameId, input.imageDataUrl);
  } catch {
    throw new GameStoreError("invalid_image", 400);
  }
  const result = await database.prepare(`INSERT INTO hub_game_screenshots (id, game_id, position, rights_basis, attribution, created_at)
    VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(game_id, position) DO NOTHING`)
    .bind(stored.version, gameId, position, input.rightsBasis, attribution || null, now.toISOString()).run();
  if (!result.meta.changes) {
    await deleteGameImage(bucket, gameId, stored.version);
    throw new GameStoreError("screenshot_conflict", 409);
  }
  return { id: stored.version, position, url: stored.imageUrl };
}

export async function removeGameScreenshot(database: D1Database, bucket: R2Bucket, profileId: string, gameId: string, screenshotId: string) {
  await requireManager(database, gameId, profileId);
  if (!UUID.test(screenshotId)) throw new GameStoreError("screenshot_not_found", 404);
  const result = await database.prepare("DELETE FROM hub_game_screenshots WHERE id = ? AND game_id = ?").bind(screenshotId, gameId).run();
  if (!result.meta.changes) throw new GameStoreError("screenshot_not_found", 404);
  await deleteGameImage(bucket, gameId, screenshotId);
}

export async function readGameOwnership(database: D1Database, profileId: string, gameId: string): Promise<GameOwnership> {
  const row = await database.prepare("SELECT source FROM hub_game_library WHERE profile_id = ? AND game_id = ?")
    .bind(profileId, gameId).first<{ source: "free" | "commerce" }>();
  return row ? { owned: true, source: row.source } : { owned: false, source: null };
}

/** 「ライブラリに追加」 for a published free game. No Commerce order is made. Idempotent. */
export async function addFreeGameToLibrary(database: D1Database, profileId: string, gameId: string, now = new Date()): Promise<GameOwnership> {
  const game = await readGame(database, gameId);
  if (!game || game.status !== "published") throw new GameStoreError("game_not_found", 404);
  if (game.store_listing !== "free") throw new GameStoreError("not_free", 409);
  await requireAdultDeclarationFor(database, profileId, game);
  await database.prepare(`INSERT INTO hub_game_library (profile_id, game_id, source, added_at) VALUES (?, ?, 'free', ?)
    ON CONFLICT(profile_id, game_id) DO NOTHING`).bind(profileId, gameId, now.toISOString()).run();
  return readGameOwnership(database, profileId, gameId);
}

/** Removes a free add. A purchased game stays: it leaves the library only through a Commerce refund proof. */
export async function removeFreeGameFromLibrary(database: D1Database, profileId: string, gameId: string): Promise<GameOwnership> {
  await database.prepare("DELETE FROM hub_game_library WHERE profile_id = ? AND game_id = ? AND source = 'free'").bind(profileId, gameId).run();
  return readGameOwnership(database, profileId, gameId);
}

/** Records the grant as revoked (so it can never be redeemed) and drops the game from the holder's library
 * unless another unrevoked grant for it remains. Idempotent. */
async function revokeGameGrant(database: D1Database, gameId: string, jti: string, at: string) {
  await database.batch([
    database.prepare(`INSERT INTO hub_game_grants (grant_jti, profile_id, game_id, granted_at, revoked_at)
      VALUES (?1, NULL, ?2, ?3, ?3) ON CONFLICT(grant_jti) DO UPDATE SET revoked_at = COALESCE(revoked_at, excluded.revoked_at)`)
      .bind(jti, gameId, at),
    database.prepare(`DELETE FROM hub_game_library WHERE source = 'commerce'
      AND (profile_id, game_id) IN (SELECT profile_id, game_id FROM hub_game_grants WHERE grant_jti = ?1 AND profile_id IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM hub_game_grants g WHERE g.profile_id = hub_game_library.profile_id
        AND g.game_id = hub_game_library.game_id AND g.revoked_at IS NULL)`)
      .bind(jti),
  ]);
}

/*
 * Commerce's refund push (PLAN.md §2.5): the same verified "refunded" proof, sent by the Commerce cron
 * instead of the buyer's browser. There is no session: the Commerce signature is the authority, and the
 * only effect is an idempotent revoke. A known grant revokes its own game; an unknown one is recorded
 * as revoked against the listing that names the product, so the order can never be redeemed later.
 */
export async function revokeGameEntitlementFromPush(
  database: D1Database,
  proof: VerifiedGameEntitlementProof,
  now = new Date(),
): Promise<{ status: "revoked" | "unknown_product" }> {
  if (proof.status !== "refunded") throw new GameStoreError("not_a_refund", 400);
  const known = await database.prepare("SELECT game_id FROM hub_game_grants WHERE grant_jti = ?").bind(proof.jti).first<{ game_id: string }>();
  const gameId = known?.game_id ?? (await database.prepare(`SELECT id FROM game_guide_hubs
      WHERE commerce_product_id = ? AND store_listing = 'paid' ORDER BY id LIMIT 1`).bind(proof.productId).first<{ id: string }>())?.id;
  if (!gameId) return { status: "unknown_product" };
  await revokeGameGrant(database, gameId, proof.jti, now.toISOString());
  return { status: "revoked" };
}

/*
 * Redeems a verified Commerce proof for the signed-in profile.
 *  - payment_final: the listing must be paid and name the proof's product. The proof's jti binds to the
 *    first profile that redeems it (replays by that profile are no-ops; any other profile is refused).
 *  - refunded: the grant is revoked (or recorded as revoked, so it can never be redeemed), and the game
 *    leaves the holder's library unless another unrevoked grant for it remains.
 */
export async function redeemGameEntitlement(
  database: D1Database,
  profileId: string,
  gameId: string,
  proof: VerifiedGameEntitlementProof,
  now = new Date(),
): Promise<GameOwnership & { status: "granted" | "revoked" }> {
  const game = await readGame(database, gameId);
  if (!game) throw new GameStoreError("game_not_found", 404);
  const at = now.toISOString();
  const known = await database.prepare("SELECT game_id FROM hub_game_grants WHERE grant_jti = ?").bind(proof.jti).first<{ game_id: string }>();
  // A refund revokes a known grant even if the listing changed since; anything new must match the listing.
  const listed = game.store_listing === "paid" && game.commerce_product_id === proof.productId;
  if (proof.status === "refunded" ? (known ? known.game_id !== gameId : !listed) : !listed) throw new GameStoreError("product_mismatch", 409);
  if (proof.status === "refunded") {
    await revokeGameGrant(database, gameId, proof.jti, at);
    return { ...await readGameOwnership(database, profileId, gameId), status: "revoked" };
  }
  if (game.status !== "published") throw new GameStoreError("game_not_found", 404);
  // Q5: a paid game is redeemed only by a profile that declared 18+. The proof can be fetched again
  // from Commerce after declaring (its jti stays the same), so nothing is lost by refusing here.
  await requireAdultDeclarationFor(database, profileId, game);
  await database.batch([
    database.prepare(`INSERT INTO hub_game_grants (grant_jti, profile_id, game_id, granted_at, revoked_at)
      VALUES (?, ?, ?, ?, NULL) ON CONFLICT(grant_jti) DO NOTHING`).bind(proof.jti, profileId, gameId, at),
    database.prepare(`INSERT INTO hub_game_library (profile_id, game_id, source, added_at)
      SELECT ?1, ?2, 'commerce', ?3 WHERE EXISTS (SELECT 1 FROM hub_game_grants
        WHERE grant_jti = ?4 AND profile_id = ?1 AND game_id = ?2 AND revoked_at IS NULL)
      ON CONFLICT(profile_id, game_id) DO UPDATE SET source = 'commerce'`).bind(profileId, gameId, at, proof.jti),
  ]);
  const grant = await database.prepare("SELECT profile_id, game_id, revoked_at FROM hub_game_grants WHERE grant_jti = ?")
    .bind(proof.jti).first<{ profile_id: string | null; game_id: string; revoked_at: string | null }>();
  if (!grant || grant.profile_id !== profileId || grant.game_id !== gameId) throw new GameStoreError("entitlement_already_claimed", 409);
  if (grant.revoked_at) throw new GameStoreError("entitlement_revoked", 409);
  return { ...await readGameOwnership(database, profileId, gameId), status: "granted" };
}

function encodeCursor(addedAt: string, gameId: string) {
  return Buffer.from(JSON.stringify([addedAt, gameId]), "utf8").toString("base64url");
}
function decodeCursor(cursor: string | null | undefined): [string, string] | null {
  if (!cursor) return null;
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (Array.isArray(value) && value.length === 2 && typeof value[0] === "string" && typeof value[1] === "string"
      && Number.isFinite(Date.parse(value[0])) && GAME_ID.test(value[1])) return [value[0], value[1]];
  } catch { /* fall through */ }
  throw new GameStoreError("invalid_cursor", 400);
}

/** Owned games, newest first, keyset-paged over idx_hub_game_library_profile_added. */
export async function listGameLibrary(
  database: D1Database,
  profileId: string,
  options: { cursor?: string | null; limit?: number } = {},
): Promise<{ games: GameLibraryEntry[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 24), 1), GAME_LIBRARY_PAGE_MAX);
  const cursor = decodeCursor(options.cursor);
  const result = await database.prepare(`SELECT l.game_id, l.source, l.added_at, g.slug, g.title, g.image_url, g.platforms
    FROM hub_game_library l JOIN game_guide_hubs g ON g.id = l.game_id
    WHERE l.profile_id = ?1 ${cursor ? "AND (l.added_at < ?2 OR (l.added_at = ?2 AND l.game_id < ?3))" : ""}
    ORDER BY l.added_at DESC, l.game_id DESC LIMIT ${limit + 1}`)
    .bind(...(cursor ? [profileId, cursor[0], cursor[1]] : [profileId]))
    .all<{ game_id: string; source: "free" | "commerce"; added_at: string; slug: string; title: string; image_url: string | null; platforms: string | null }>();
  const rows = result.results ?? [];
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    games: page.map((row) => ({
      gameId: row.game_id, slug: row.slug, title: row.title, imageUrl: row.image_url,
      platforms: parseGamePlatforms(row.platforms), source: row.source, addedAt: row.added_at,
    })),
    nextCursor: rows.length > limit && last ? encodeCursor(last.added_at, last.game_id) : null,
  };
}
