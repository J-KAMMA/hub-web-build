/**
 * Who may find a community in search. This is the rule the community directory uses
 * (lib/server/community-route-data.ts getCommunitiesRouteData): only an active community, and
 * - signed out: visibility = 'public'
 * - signed in: 'public', 'approval', or a community the viewer belongs to (any status except 'banned').
 * A private (or otherwise closed) community's name, slug, description, category and channel messages
 * must not reach search results, the "more" pages or the AI step context for anyone else.
 */
export function visibleCommunitySql(alias: string, viewerProfileId: string | null): { sql: string; bindings: string[] } {
  if (!viewerProfileId) return { sql: `(${alias}.lifecycle_status = 'active' AND ${alias}.visibility = 'public')`, bindings: [] };
  return {
    sql: `(${alias}.lifecycle_status = 'active' AND (${alias}.visibility IN ('public', 'approval') OR EXISTS (SELECT 1 FROM community_memberships cv WHERE cv.community_id = ${alias}.id AND cv.profile_id = ? AND cv.status <> 'banned')))`,
    bindings: [viewerProfileId],
  };
}

/** True for the error D1 raises when a migration has not been applied yet (deploy order: code before migration). */
export function isMissingSchemaError(cause: unknown): boolean {
  return /no such (table|column|module)/i.test(cause instanceof Error ? cause.message : String(cause));
}
