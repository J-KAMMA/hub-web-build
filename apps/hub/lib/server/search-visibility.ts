import { notGatedSql } from "@/lib/server/gated-exits";

/*
 * The visibility SQL shared by the first search page and the per-kind continuation pages
 * (d1-search-more.ts), so a continuation can never show what the first page hides.
 * Aliases: profiles are `p`; social posts are `p` with author_profile_id.
 */

export const visibleProfileSql = `(NOT EXISTS (
      SELECT 1 FROM profile_moderation_status moderation
      WHERE moderation.profile_id = p.id AND moderation.status = 'suspended'
    ) AND NOT EXISTS (
      SELECT 1 FROM thread_user_controls control
      WHERE ? <> '' AND (
        (control.owner_profile_id = ? AND control.target_profile_id = p.id AND (control.muted = 1 OR control.blocked = 1))
        OR (control.owner_profile_id = p.id AND control.target_profile_id = ? AND control.blocked = 1)
      )
    ))`;

const visiblePostBaseSql = `(p.author_profile_id IS NULL OR (
      NOT EXISTS (
        SELECT 1 FROM profile_moderation_status moderation
        WHERE moderation.profile_id = p.author_profile_id AND moderation.status = 'suspended'
      )
      AND NOT EXISTS (
        SELECT 1 FROM thread_user_controls control
        WHERE ? <> '' AND (
          (control.owner_profile_id = ? AND control.target_profile_id = p.author_profile_id AND (control.muted = 1 OR control.blocked = 1))
          OR (control.owner_profile_id = p.author_profile_id AND control.target_profile_id = ? AND control.blocked = 1)
        )
      )
    ))`;

/** Public, unmoderated, ungated social posts. Three viewer bindings, in order. */
export const visiblePostSql = `(${visiblePostBaseSql} AND p.hidden_by_target_owner_at IS NULL AND ${notGatedSql("post", "p.id")})`;

export const visibilityBindings = (viewerProfileId: string | null): [string, string, string] => {
  const viewerId = viewerProfileId ?? "";
  return [viewerId, viewerId, viewerId];
};
