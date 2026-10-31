import type { D1Database } from "@cloudflare/workers-types";

import { DOWNLOAD_HISTORY_LIMIT } from "@/lib/server/download-history";

/*
 * データの書き出しに足す項目（2026-10-17、旦那様の決定）。
 * 呼び出した本人の行だけを、保存先の鍵・署名付きURL・トークンのハッシュを含めずに返す。
 * 問い合わせが失敗したら書き出し全体を失敗にする（AUDIT.md 8.1-7）。
 */

export async function readOwnWorksExport(database: D1Database, profileId: string) {
  const [licenses, videos, contentFiles, repositories, tokens, downloads, usage, objects] = await Promise.all([
    database
      .prepare(
        `SELECT l.target_type, l.target_id, l.license, l.updated_at FROM content_licenses l
          WHERE (l.target_type = 'post' AND EXISTS (SELECT 1 FROM social_posts p WHERE p.id = l.target_id AND p.author_profile_id = ?1))
             OR (l.target_type = 'article' AND EXISTS (SELECT 1 FROM hub_user_articles a WHERE a.id = l.target_id AND a.author_profile_id = ?1))
          ORDER BY l.updated_at`,
      )
      .bind(profileId).all<Record<string, unknown>>(),
    database
      .prepare(
        `SELECT id, title, description, visibility, kind, license, age_restricted, comments_enabled, state, created_at, updated_at, published_at, unpublished_at
           FROM hub_videos WHERE profile_id = ? AND deleted_at IS NULL ORDER BY created_at`,
      )
      .bind(profileId).all<Record<string, unknown>>(),
    database
      .prepare(
        `SELECT id, file_name, declared_bytes, stored_bytes, state, scan_status, target_type, target_id, created_at, updated_at, published_at, unpublished_at
           FROM hub_content_files WHERE owner_profile_id = ? ORDER BY created_at`,
      )
      .bind(profileId).all<Record<string, unknown>>(),
    database
      .prepare(
        `SELECT id, name, description, visibility, default_branch, state, size_bytes, created_at, updated_at
           FROM code_repositories WHERE owner_profile_id = ? ORDER BY created_at`,
      )
      .bind(profileId).all<Record<string, unknown>>(),
    database
      .prepare(
        `SELECT id, repo_id, label, scope, expires_at, revoked_at, created_at
           FROM code_access_tokens WHERE owner_profile_id = ? ORDER BY created_at`,
      )
      .bind(profileId).all<Record<string, unknown>>(),
    database
      .prepare(
        `SELECT id, object_kind, target_type, target_id, issued_at
           FROM hub_download_grants WHERE profile_id = ? ORDER BY issued_at DESC LIMIT ${DOWNLOAD_HISTORY_LIMIT * 10}`,
      )
      .bind(profileId).all<Record<string, unknown>>(),
    database
      .prepare("SELECT committed_bytes, reserved_bytes, object_count, updated_at FROM hub_storage_usage WHERE profile_id = ?")
      .bind(profileId).all<Record<string, unknown>>(),
    database
      .prepare(
        `SELECT kind, state, COUNT(*) AS objects, SUM(bytes) AS bytes
           FROM hub_storage_objects WHERE profile_id = ? GROUP BY kind, state ORDER BY kind, state`,
      )
      .bind(profileId).all<Record<string, unknown>>(),
  ]);

  const tokenRows = tokens.results ?? [];
  return {
    contentLicenses: licenses.results ?? [],
    videos: videos.results ?? [],
    contentFiles: contentFiles.results ?? [],
    codeRepositories: (repositories.results ?? []).map((repo) => ({
      ...repo,
      accessTokens: tokenRows.filter((token) => token.repo_id === repo.id).map(({ repo_id: _repo, ...rest }) => rest),
    })),
    codeAccessTokens: tokenRows.filter((token) => token.repo_id === null || token.repo_id === undefined).map(({ repo_id: _repo, ...rest }) => rest),
    downloadHistory: (downloads.results ?? []).map((row) => ({
      watermarkId: row.id, objectKind: row.object_kind, targetType: row.target_type, targetId: row.target_id, issuedAt: row.issued_at,
    })),
    storageUsage: { summary: (usage.results ?? [])[0] ?? null, objects: objects.results ?? [] },
  };
}
