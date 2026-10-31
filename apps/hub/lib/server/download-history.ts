import type { D1Database } from "@cloudflare/workers-types";

import { notGatedSql } from "@/lib/server/gated-exits";

/*
 * 自分のダウンロード履歴（2026-10-17、旦那様の決定）。
 * hub_download_grants のうち、呼び出した本人の行だけを新しい順に返す。
 * id は透かしに埋め込む乱数のID。IPや端末の情報は表に無い。365日後に消える。
 */
export const DOWNLOAD_HISTORY_LIMIT = 100;

export type DownloadHistoryEntry = {
  watermarkId: string;
  targetType: "post" | "article" | "video" | "music";
  targetId: string;
  targetLabel: string | null;
  objectKind: "file" | "video" | "music" | "image";
  issuedAt: string;
};

type Row = {
  id: string;
  target_type: DownloadHistoryEntry["targetType"];
  target_id: string;
  object_kind: DownloadHistoryEntry["objectKind"];
  issued_at: string;
  label: string | null;
};

function shorten(value: string | null): string | null {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length > 40 ? `${text.slice(0, 40)}…` : text;
}

export async function listOwnDownloadHistory(
  database: D1Database,
  profileId: string,
  limit = DOWNLOAD_HISTORY_LIMIT,
): Promise<DownloadHistoryEntry[]> {
  const bounded = Math.max(1, Math.min(Math.trunc(limit) || DOWNLOAD_HISTORY_LIMIT, DOWNLOAD_HISTORY_LIMIT));
  const result = await database
    .prepare(
      `SELECT g.id AS id, g.target_type AS target_type, g.target_id AS target_id, g.object_kind AS object_kind,
              g.issued_at AS issued_at,
              CASE g.target_type
                WHEN 'post' THEN (SELECT substr(p.body, 1, 80) FROM social_posts p WHERE p.id = g.target_id AND ${notGatedSql("post", "p.id")})
                WHEN 'article' THEN (SELECT a.title FROM hub_user_articles a WHERE a.id = g.target_id)
                WHEN 'video' THEN (SELECT v.title FROM hub_videos v WHERE v.id = g.target_id)
                ELSE NULL
              END AS label
         FROM hub_download_grants g
        WHERE g.profile_id = ?
        ORDER BY g.issued_at DESC, g.id DESC
        LIMIT ?`,
    )
    .bind(profileId, bounded)
    .all<Row>();
  return (result.results ?? []).map((row) => ({
    watermarkId: row.id,
    targetType: row.target_type,
    targetId: row.target_id,
    targetLabel: shorten(row.label),
    objectKind: row.object_kind,
    issuedAt: row.issued_at,
  }));
}
