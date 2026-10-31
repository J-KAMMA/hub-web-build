import type { D1Database } from "@cloudflare/workers-types";

/**
 * Per-author public listings for the profile tabs (articles, Hub videos, code). Each list is a
 * keyset page over an indexed column; nothing here counts rows. The cursor is base64url so it can
 * travel as one path-safe query value (the desktop client only passes [A-Za-z0-9_-]).
 */

export const AUTHOR_HANDLE = /^[A-Za-z0-9_.-]{1,64}$/u;
export const PROFILE_WORKS_PAGE = 20;

export type WorkCursor = { at: string; id: string };

const toBase64Url = (value: string) => btoa(value).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");

export function encodeWorkCursor(cursor: WorkCursor): string {
  return toBase64Url(`${cursor.at}~${cursor.id}`);
}

/** A malformed cursor is null; callers reject it rather than restarting silently. */
export function decodeWorkCursor(value: string | null | undefined): WorkCursor | null {
  if (!value || value.length > 400 || !/^[A-Za-z0-9_-]+$/u.test(value)) return null;
  let text: string;
  try {
    text = atob(value.replace(/-/gu, "+").replace(/_/gu, "/"));
  } catch {
    return null;
  }
  const index = text.indexOf("~");
  if (index <= 0 || !/^[\x21-\x7e]+$/u.test(text)) return null;
  const at = text.slice(0, index);
  const id = text.slice(index + 1);
  if (!id || id.length > 200 || !Number.isFinite(Date.parse(at))) return null;
  return { at, id };
}

/**
 * The local, non-suspended profile behind a handle, or null. Remote shadow profiles have no Hub
 * works of their own, so they are treated as absent.
 */
export async function findListableAuthorId(database: D1Database, handle: string): Promise<string | null> {
  if (!AUTHOR_HANDLE.test(handle)) return null;
  const row = await database.prepare(`SELECT p.id FROM profiles p
    WHERE p.handle = ? COLLATE NOCASE
      AND NOT EXISTS (SELECT 1 FROM profile_moderation_status m WHERE m.profile_id = p.id AND m.status = 'suspended')
      AND NOT EXISTS (SELECT 1 FROM remote_actor_profiles x WHERE x.profile_id = p.id)
    LIMIT 1`).bind(handle).first<{ id: string }>();
  return row?.id ?? null;
}

export type AuthorListQuery = { handle: string; cursor: WorkCursor | null };

/** Reads `author` (or `owner`) and `cursor`. Returns null when either is malformed. */
export function readAuthorListQuery(url: URL, key: "author" | "owner"): AuthorListQuery | null {
  const handle = url.searchParams.get(key) ?? "";
  if (!AUTHOR_HANDLE.test(handle)) return null;
  const raw = url.searchParams.get("cursor");
  const cursor = raw === null ? null : decodeWorkCursor(raw);
  if (raw !== null && !cursor) return null;
  return { handle, cursor };
}
