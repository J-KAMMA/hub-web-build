import type { D1Database } from "@cloudflare/workers-types";

export type MentionSuggestion = {
  id: string;
  handle: string;
  displayName: string;
};

type ProfileRow = {
  id: string;
  handle: string;
  display_name: string;
};

export function normalizeMentionSuggestionQuery(value: string) {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/^@/, "")
    .toLocaleLowerCase("en")
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 32);
}

export async function listD1MentionSuggestions(
  database: D1Database,
  rawQuery: string,
  viewerProfileId: string | null,
  limit = 5,
): Promise<MentionSuggestion[]> {
  const query = normalizeMentionSuggestionQuery(rawQuery);
  if (!query) return [];

  const viewerId = viewerProfileId ?? "";
  const safeLimit = Math.max(1, Math.min(8, Math.trunc(limit)));
  /* The trigram index cannot answer one- or two-character prefixes; the NOCASE handle index can. */
  const useIndex = query.length >= 3;
  const result = await database.prepare(`
    SELECT p.id, p.handle, p.display_name
    FROM ${useIndex ? "profiles_fts f JOIN profiles p ON p.rowid = f.rowid" : "profiles p"}
    WHERE ${useIndex ? "profiles_fts MATCH ?" : "p.handle LIKE ? ESCAPE '\\'"}
      AND NOT EXISTS (
        SELECT 1 FROM profile_moderation_status moderation
        WHERE moderation.profile_id = p.id AND moderation.status = 'suspended'
      )
      AND NOT EXISTS (
        SELECT 1 FROM thread_user_controls control
        WHERE ? <> '' AND (
          (control.owner_profile_id = ? AND control.target_profile_id = p.id AND (control.muted = 1 OR control.blocked = 1))
          OR (control.owner_profile_id = p.id AND control.target_profile_id = ? AND control.blocked = 1)
        )
      )
    ORDER BY
      CASE
        WHEN lower(p.handle) = ? THEN 0
        WHEN lower(p.handle) LIKE ? THEN 1
        ELSE 2
      END,
      ${useIndex ? "bm25(profiles_fts, 12.0, 8.0, 1.0)" : "0"},
      p.joined_at DESC
    LIMIT ?
  `)
    .bind(useIndex ? `"${query}"` : `${query.replaceAll("_", "\\_")}%`, viewerId, viewerId, viewerId, query, `${query}%`, safeLimit)
    .all<ProfileRow>();

  return result.results.map((row) => ({
    id: row.id,
    handle: row.handle,
    displayName: row.display_name,
  }));
}
