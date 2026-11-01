import type { DatabaseSync } from "node:sqlite";

import type { Profile } from "@/lib/domain";

/* Shared seed for the video-comment tests (docs/hub-video-comments/DESIGN.md). Rows go through the real schema. */
export const NOW = "2026-11-01T00:00:00.000Z";

export function put(sql: DatabaseSync, table: string, values: Record<string, unknown>) {
  const info = sql.prepare(`PRAGMA table_info(${table})`).all() as { name: string; type: string; notnull: number; dflt_value: unknown }[];
  const row: Record<string, unknown> = {};
  for (const column of info) {
    if (column.name in values) row[column.name] = values[column.name];
    else if (column.notnull && column.dflt_value === null) {
      row[column.name] = /INT|REAL|NUM/i.test(column.type) ? 0 : column.name.endsWith("_at") ? NOW : "x";
    }
  }
  const names = Object.keys(row);
  sql.prepare(`INSERT INTO ${table}(${names.join(",")}) VALUES(${names.map(() => "?").join(",")})`).run(...(Object.values(row) as never[]));
}

export const profile = (id: string): Profile => ({ id, handle: id, displayName: id, bio: "", joinedAt: NOW });

/** Hub video ids are 36 characters (hub_videos CHECK). */
export const V_OPEN = "00000000-0000-4000-8000-00000000000a";
export const V_GATED = "00000000-0000-4000-8000-00000000000b";
export const V_EXTERNAL = "yt-external-1";

/** Profiles owner/alice/bob, an open Hub video and a gated one owned by `owner`, and an external YouTube video shared by alice. */
export function seedVideoComments(sql: DatabaseSync) {
  for (const id of ["owner", "alice", "bob"]) put(sql, "profiles", { id, handle: id, display_name: id, bio: "" });
  put(sql, "access_gates", { id: "g", owner_profile_id: "owner", match: "all" });
  put(sql, "access_gate_conditions", { gate_id: "g", ordinal: 0, kind: "erc20", chain_id: 8453, contract: "0x" + "ab".repeat(20), min_raw: "10", token_ids: "[]" });
  for (const [n, id] of [V_OPEN, V_GATED].entries()) {
    put(sql, "external_videos", { id, title: id, channel: "c", provider: "hub", external_video_id: id, source_url: `https://example.test/${id}`, status: "active", submitted_by_profile_id: "owner" });
    put(sql, "hub_videos", {
      id, profile_id: "owner", asset_id: `00000000-0000-4000-8000-0000000001${n}0`, title: "t", state: "published", visibility: "public",
      source: "web", max_height: 720, declared_minutes: 1, upload_bytes: 1,
    });
  }
  put(sql, "external_videos", { id: V_EXTERNAL, title: "yt", channel: "c", provider: "youtube", external_video_id: "abc", source_url: "https://youtube.test/abc", status: "active", submitted_by_profile_id: "alice" });
}

export function addComment(sql: DatabaseSync, id: string, videoId: string | null, body: string, extra: Record<string, unknown> = {}) {
  put(sql, "social_posts", {
    id, author_profile_id: "alice", display_name: "alice", handle: "alice", identity_mode: "account",
    body, audience: "public", reply_to_video_id: videoId, ...extra,
  });
}

export const gate = (sql: DatabaseSync, type: string, id: string) =>
  sql.prepare("INSERT INTO content_access_gates(target_type, target_id, gate_id, created_at) VALUES (?, ?, 'g', ?) ON CONFLICT(target_type, target_id) DO UPDATE SET gate_id = excluded.gate_id").run(type, id, NOW);
export const ungate = (sql: DatabaseSync, type: string, id: string) =>
  sql.prepare("DELETE FROM content_access_gates WHERE target_type = ? AND target_id = ?").run(type, id);

export const postHits = (sql: DatabaseSync, term: string) =>
  (sql.prepare("SELECT p.id FROM social_posts_fts f JOIN social_posts p ON p.rowid = f.rowid WHERE social_posts_fts MATCH ? ORDER BY p.id").all(`"${term}"`) as { id: string }[]).map((row) => row.id);
