import "server-only";

import type { D1Database } from "@cloudflare/workers-types";

import { federationConfiguration, sendFederatedFlag } from "@/lib/server/federation-gateway";

/*
 * ハブ間の通報（ActivityPub Flag）。
 *
 * 受信: 他のハブが送った Flag を、運営者の通報キューへ「外部の通報」として入れる。
 *   - 通報者は個人ではなく送信元のハブ（host）。
 *   - 自動保留（SOCIAL_POST_AUTO_HOLD_THRESHOLD）には数えない。外のハブの通報だけで投稿が消えないようにする。
 *   - 取り込みは冪等（activity_id + 対象）。
 * 送信: 外部の投稿を通報した利用者が、通報時に明示的に選んだときだけ、元のハブへ通報を送る。
 *   - 送るのは対象の URL と理由の分類だけ。通報者の素性・自由記述は送らない。
 *   - 送れなくても、ローカルの通報は成立済み。例外にしない。
 */

const REASONS = new Set(["image_safety", "sexual", "violence", "copyright", "privacy", "harassment", "spam", "other"]);

type FlagEvent = {
  activityId?: unknown;
  actor?: { host?: unknown } | null;
  localProfileId?: unknown;
  hubPostIds?: unknown;
  category?: unknown;
  comment?: unknown;
};

function text(value: unknown, max: number): string | null {
  return typeof value === "string" && value.trim() && value.length <= max ? value : null;
}

export async function applyRemoteFlag(database: D1Database, event: FlagEvent): Promise<number> {
  const activityId = text(event.activityId, 2048);
  const host = text(event.actor?.host, 255)?.toLowerCase();
  if (!activityId || !host) return 0;
  const reason = typeof event.category === "string" && REASONS.has(event.category) ? event.category : "other";
  const details = typeof event.comment === "string" ? event.comment.slice(0, 300) : "";
  const now = new Date().toISOString();
  const targets: Array<{ kind: "post" | "profile"; id: string }> = [];

  const profileId = text(event.localProfileId, 128);
  if (profileId) {
    const local = await database.prepare("SELECT id FROM profiles WHERE id = ? AND kind = 'local' LIMIT 1").bind(profileId).first();
    if (local) targets.push({ kind: "profile", id: profileId });
  }
  const postIds = Array.isArray(event.hubPostIds) ? event.hubPostIds.filter((id): id is string => typeof id === "string" && id.length <= 128).slice(0, 20) : [];
  for (const postId of postIds) {
    const post = await database.prepare("SELECT id FROM social_posts WHERE id = ? AND origin = 'local' LIMIT 1").bind(postId).first();
    if (post) targets.push({ kind: "post", id: postId });
  }

  let inserted = 0;
  for (const target of targets) {
    const result = await database.prepare(
      `INSERT OR IGNORE INTO remote_flag_reports (id, activity_id, source_host, target_kind, target_id, reason, details, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
    ).bind(crypto.randomUUID(), activityId, host, target.kind, target.id, reason, details, now).run();
    inserted += result.meta.changes ? 1 : 0;
  }
  return inserted;
}

/** 外部の投稿の通報を元のハブへも送る。送れなくても例外にしない。送ったら true。 */
export async function sendFlagForRemotePost(
  database: D1Database,
  input: { postId: string; reason: string },
): Promise<boolean> {
  if (!federationConfiguration() || !REASONS.has(input.reason)) return false;
  try {
    const row = await database.prepare(
      `SELECT s.origin_object_id AS object_url, r.actor_url
       FROM social_posts s JOIN remote_actor_profiles r ON r.profile_id = s.author_profile_id
       WHERE s.id = ? AND s.origin = 'remote' LIMIT 1`,
    ).bind(input.postId).first<{ object_url: string | null; actor_url: string }>();
    if (!row?.object_url) return false;
    const sent = await sendFederatedFlag({ actorUrl: row.actor_url, objectUrls: [row.object_url], category: input.reason });
    if (!sent.ok) console.warn(JSON.stringify({ event: "federation_flag_failed", status: sent.status, error: sent.error }));
    return sent.ok;
  } catch {
    console.warn(JSON.stringify({ event: "federation_flag_failed", status: "unavailable" }));
    return false;
  }
}
