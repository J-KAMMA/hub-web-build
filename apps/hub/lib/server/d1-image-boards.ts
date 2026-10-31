import "server-only";

import type { D1Database } from "@cloudflare/workers-types";

import {
  COMMONS_THUMB_HOSTS,
  IMAGE_PAGE_SIZE,
  OPENVERSE_THUMB_HOSTS,
  decodeCursor,
  encodeCursor,
  isImageKind,
  plainText,
  safeHttpsUrl,
  type ImageItem,
  type ImageKind,
} from "@/lib/image-search";
import { resolveHubPostImage, resolveRemoteImage } from "@/lib/server/d1-image-search";

/*
 * 画像ボード (2026-10-29)。所有者の Hub プロフィールだけが書ける。公開にしたボードだけ他人が読める。
 * Hub 由来の画像 (hub-post / remote) は保存するときも表示するときも元の表から読み直す。
 * クライアントが送るサムネイルや行き先は信用しない。
 */

export const MAX_BOARDS_PER_OWNER = 50;
export const MAX_ITEMS_PER_BOARD = 500;

export class ImageBoardInputError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 = 400) {
    super(message);
    this.name = "ImageBoardInputError";
  }
}

export type ImageBoard = {
  id: string;
  name: string;
  isPublic: boolean;
  itemCount: number;
  coverUrl: string | null;
  updatedAt: string;
  mine: boolean;
};

type BoardRow = { id: string; owner_profile_id: string; name: string; is_public: number; updated_at: string };

function boardName(value: unknown): string {
  const name = typeof value === "string" ? value.normalize("NFKC").replace(/\s+/g, " ").trim() : "";
  if (!name || name.length > 60) throw new ImageBoardInputError("ボード名は1〜60文字で入力してください。");
  return name;
}

export async function listImageBoards(database: D1Database, ownerId: string): Promise<ImageBoard[]> {
  const rows = await database.prepare(
    `SELECT b.id, b.owner_profile_id, b.name, b.is_public, b.updated_at,
            (SELECT count(*) FROM hub_image_board_items i WHERE i.board_id = b.id) AS item_count,
            (SELECT i.thumbnail_url FROM hub_image_board_items i WHERE i.board_id = b.id AND i.kind IN ('openverse', 'commons') ORDER BY i.saved_at DESC, i.id LIMIT 1) AS cover_url
     FROM hub_image_boards b WHERE b.owner_profile_id = ? ORDER BY b.updated_at DESC, b.id`,
  ).bind(ownerId).all<BoardRow & { item_count: number; cover_url: string | null }>();
  return rows.results.map((row) => ({
    id: row.id,
    name: row.name,
    isPublic: row.is_public === 1,
    itemCount: row.item_count,
    coverUrl: row.cover_url,
    updatedAt: row.updated_at,
    mine: true,
  }));
}

export async function createImageBoard(database: D1Database, ownerId: string, input: { name?: unknown; isPublic?: unknown }): Promise<ImageBoard> {
  const name = boardName(input.name);
  const count = await database.prepare("SELECT count(*) AS n FROM hub_image_boards WHERE owner_profile_id = ?").bind(ownerId).first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_BOARDS_PER_OWNER) throw new ImageBoardInputError("ボードは50個までです。", 409);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const isPublic = input.isPublic === true ? 1 : 0;
  await database.prepare(
    "INSERT INTO hub_image_boards (id, owner_profile_id, name, is_public, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).bind(id, ownerId, name, isPublic, now, now).run();
  return { id, name, isPublic: isPublic === 1, itemCount: 0, coverUrl: null, updatedAt: now, mine: true };
}

/** Only the owner may change a board. Returns false when it is not theirs (or does not exist). */
export async function updateImageBoard(database: D1Database, ownerId: string, boardId: string, input: { name?: unknown; isPublic?: unknown }): Promise<boolean> {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (input.name !== undefined) {
    sets.push("name = ?");
    values.push(boardName(input.name));
  }
  if (input.isPublic !== undefined) {
    if (typeof input.isPublic !== "boolean") throw new ImageBoardInputError("公開の指定が正しくありません。");
    sets.push("is_public = ?");
    values.push(input.isPublic ? 1 : 0);
  }
  if (!sets.length) throw new ImageBoardInputError("変更する項目がありません。");
  sets.push("updated_at = ?");
  values.push(new Date().toISOString());
  const result = await database.prepare(`UPDATE hub_image_boards SET ${sets.join(", ")} WHERE id = ? AND owner_profile_id = ?`)
    .bind(...values, boardId, ownerId).run();
  return (result.meta?.changes ?? 0) > 0;
}

export async function deleteImageBoard(database: D1Database, ownerId: string, boardId: string): Promise<boolean> {
  const result = await database.prepare("DELETE FROM hub_image_boards WHERE id = ? AND owner_profile_id = ?").bind(boardId, ownerId).run();
  return (result.meta?.changes ?? 0) > 0;
}

/** The board when the viewer owns it or it is public; otherwise null (private boards look absent). */
export async function getReadableImageBoard(database: D1Database, boardId: string, viewerId: string | null): Promise<ImageBoard | null> {
  const row = await database.prepare(
    `SELECT b.id, b.owner_profile_id, b.name, b.is_public, b.updated_at,
            (SELECT count(*) FROM hub_image_board_items i WHERE i.board_id = b.id) AS item_count
     FROM hub_image_boards b WHERE b.id = ?`,
  ).bind(boardId).first<BoardRow & { item_count: number }>();
  if (!row) return null;
  const mine = viewerId !== null && row.owner_profile_id === viewerId;
  if (!mine && row.is_public !== 1) return null;
  return { id: row.id, name: row.name, isPublic: row.is_public === 1, itemCount: row.item_count, coverUrl: null, updatedAt: row.updated_at, mine };
}

type ItemRow = {
  id: string;
  kind: string;
  ref: string;
  thumbnail_url: string;
  source_url: string;
  licence: string;
  title: string;
  width: number | null;
  height: number | null;
  saved_at: string;
};

export type BoardItem = ImageItem & { itemId: string; savedAt: string };

/* Hub-owned references that are still public for this viewer. External kinds are always kept. */
async function stillPublicRefs(database: D1Database, rows: readonly ItemRow[], viewerId: string | null): Promise<Set<string>> {
  const ok = new Set<string>();
  for (const row of rows) {
    if (row.kind === "hub-post") {
      if (await resolveHubPostImage(database, row.ref, viewerId)) ok.add(row.id);
    } else if (row.kind === "remote") {
      if (await resolveRemoteImage(database, row.ref)) ok.add(row.id);
    } else if (row.kind !== "hub-article") {
      ok.add(row.id);
    }
  }
  return ok;
}

export async function listImageBoardItems(
  database: D1Database,
  boardId: string,
  viewerId: string | null,
  cursor: string | null,
  limit = IMAGE_PAGE_SIZE,
): Promise<{ items: BoardItem[]; nextCursor: string | null } | null> {
  const board = await getReadableImageBoard(database, boardId, viewerId);
  if (!board) return null;
  const decoded = cursor ? decodeCursor(cursor) : null;
  if (cursor && (!decoded || decoded.s !== "board" || typeof decoded.c !== "string" || typeof decoded.i !== "string")) return null;
  const size = Math.min(Math.max(Math.trunc(limit), 1), 48);
  const where = ["board_id = ?"];
  const bindings: unknown[] = [boardId];
  if (decoded) {
    where.push("(saved_at < ? OR (saved_at = ? AND id > ?))");
    bindings.push(decoded.c, decoded.c, decoded.i);
  }
  const rows = await database.prepare(
    `SELECT id, kind, ref, thumbnail_url, source_url, licence, title, width, height, saved_at FROM hub_image_board_items
     WHERE ${where.join(" AND ")} ORDER BY saved_at DESC, id ASC LIMIT ?`,
  ).bind(...bindings, size + 1).all<ItemRow>();
  const page = rows.results.slice(0, size);
  const visible = await stillPublicRefs(database, page, viewerId);
  const last = page[page.length - 1];
  return {
    items: page.filter((row) => visible.has(row.id) && isImageKind(row.kind)).map((row) => ({
      itemId: row.id,
      savedAt: row.saved_at,
      key: `${row.kind}:${row.ref}`,
      kind: row.kind as ImageKind,
      ref: row.ref,
      title: row.title,
      thumbnailUrl: row.thumbnail_url,
      width: row.width,
      height: row.height,
      sourceUrl: row.source_url,
      licence: row.licence,
      creator: "",
      tags: [],
    })),
    nextCursor: rows.results.length > size && last ? encodeCursor({ s: "board", c: last.saved_at, i: last.id }) : null,
  };
}

type Resolved = { thumbnailUrl: string; sourceUrl: string; licence: string; title: string; width: number | null; height: number | null };

function dim(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 20000 ? value : null;
}

async function resolveSaveInput(database: D1Database, ownerId: string, input: Record<string, unknown>): Promise<{ kind: ImageKind; ref: string } & Resolved> {
  const kind = input.kind;
  const ref = typeof input.ref === "string" ? input.ref.trim() : "";
  if (!isImageKind(kind) || !ref || ref.length > 2048) throw new ImageBoardInputError("保存する画像の指定が正しくありません。");
  if (kind === "hub-post") {
    const item = await resolveHubPostImage(database, ref, ownerId);
    if (!item) throw new ImageBoardInputError("この画像は公開されていないため保存できません。", 404);
    return { kind, ref, thumbnailUrl: item.thumbnailUrl, sourceUrl: item.sourceUrl, licence: item.licence, title: item.title, width: item.width, height: item.height };
  }
  if (kind === "remote") {
    const item = await resolveRemoteImage(database, ref);
    if (!item) throw new ImageBoardInputError("この画像は公開されていないため保存できません。", 404);
    return { kind, ref, thumbnailUrl: item.thumbnailUrl, sourceUrl: item.sourceUrl, licence: item.licence, title: item.title, width: item.width, height: item.height };
  }
  if (kind === "hub-article") throw new ImageBoardInputError("記事の画像はまだ保存できません。");
  // openverse / commons: the browser found it, so the hosts are pinned here instead of trusted.
  const thumbnailUrl = safeHttpsUrl(input.thumbnailUrl, kind === "openverse" ? OPENVERSE_THUMB_HOSTS : COMMONS_THUMB_HOSTS);
  const sourceUrl = safeHttpsUrl(input.sourceUrl, kind === "commons" ? [/^commons\.wikimedia\.org$/] : undefined);
  if (!thumbnailUrl || !sourceUrl || ref.length > 80) throw new ImageBoardInputError("保存する画像の指定が正しくありません。");
  return {
    kind,
    ref,
    thumbnailUrl,
    sourceUrl,
    licence: plainText(input.licence, 200),
    title: plainText(input.title, 300),
    width: dim(input.width),
    height: dim(input.height),
  };
}

/** Save an image to one of the owner's boards. Saving the same image twice is a no-op (alreadySaved). */
export async function saveImageToBoard(
  database: D1Database,
  ownerId: string,
  boardId: string,
  input: Record<string, unknown>,
): Promise<{ itemId: string; alreadySaved: boolean }> {
  const board = await database.prepare("SELECT id FROM hub_image_boards WHERE id = ? AND owner_profile_id = ?").bind(boardId, ownerId).first<{ id: string }>();
  if (!board) throw new ImageBoardInputError("ボードが見つかりません。", 404);
  const resolved = await resolveSaveInput(database, ownerId, input);
  const existing = await database.prepare("SELECT id FROM hub_image_board_items WHERE board_id = ? AND kind = ? AND ref = ?")
    .bind(boardId, resolved.kind, resolved.ref).first<{ id: string }>();
  if (existing) return { itemId: existing.id, alreadySaved: true };
  const count = await database.prepare("SELECT count(*) AS n FROM hub_image_board_items WHERE board_id = ?").bind(boardId).first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_ITEMS_PER_BOARD) throw new ImageBoardInputError("このボードは500枚までです。", 409);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await database.batch([
    database.prepare(
      `INSERT INTO hub_image_board_items (id, board_id, kind, ref, thumbnail_url, source_url, licence, title, width, height, saved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, boardId, resolved.kind, resolved.ref, resolved.thumbnailUrl, resolved.sourceUrl, resolved.licence, resolved.title, resolved.width, resolved.height, now),
    database.prepare("UPDATE hub_image_boards SET updated_at = ? WHERE id = ?").bind(now, boardId),
  ]);
  return { itemId: id, alreadySaved: false };
}

export async function removeImageFromBoard(database: D1Database, ownerId: string, boardId: string, itemId: string): Promise<boolean> {
  const result = await database.prepare(
    "DELETE FROM hub_image_board_items WHERE id = ? AND board_id = ? AND board_id IN (SELECT id FROM hub_image_boards WHERE id = ? AND owner_profile_id = ?)",
  ).bind(itemId, boardId, boardId, ownerId).run();
  return (result.meta?.changes ?? 0) > 0;
}
