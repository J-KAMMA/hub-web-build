import "server-only";

import type { D1Database } from "@cloudflare/workers-types";

import { ensureShadowProfile, type InboundEvent } from "@/lib/server/federation-inbound";
import { hasD1BlockBetween } from "@/lib/server/profile-blocks";

/*
 * Federation の actor_moved（DESIGN.md 3）を Hub の表へ反映する。
 * フォロー中の外部の人が別の家へ移った。Federation が旧 actor のフォローを外し、新 actor へ Follow を送り直している。
 *  - 旧 actor の影のプロフィールのフォローを外し、「移転しました」の印を付ける。
 *  - 新 actor が外部なら、新しい影のプロフィールへのフォロー（承認待ち）を作る。承認は follow_accepted で来る。
 *  - 新 actor がこの Hub の利用者なら、通常のフォローを作る。
 * 取り込みは冪等。
 */

function text(value: unknown, max: number): string | null {
  return typeof value === "string" && value.trim() && value.length <= max ? value : null;
}

function httpUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export async function applyActorMoved(database: D1Database, event: InboundEvent): Promise<void> {
  const localProfileId = text(event.localProfileId, 128);
  const oldActor = text(event.oldActorId, 2048);
  const newActor = text(event.newActorId, 2048);
  if (!localProfileId || !oldActor || !newActor) return;
  const local = await database.prepare("SELECT id FROM profiles WHERE id = ? AND kind = 'local' LIMIT 1").bind(localProfileId).first();
  if (!local) return;
  const now = new Date().toISOString();

  const oldShadow = await database.prepare("SELECT profile_id FROM remote_actor_profiles WHERE actor_url = ? LIMIT 1")
    .bind(oldActor).first<{ profile_id: string }>();
  if (oldShadow) {
    await database.batch([
      database.prepare("DELETE FROM remote_follows WHERE follower_profile_id = ? AND remote_profile_id = ?").bind(localProfileId, oldShadow.profile_id),
      database.prepare("DELETE FROM follows WHERE follower_profile_id = ? AND followed_profile_id = ?").bind(localProfileId, oldShadow.profile_id),
      database.prepare("UPDATE remote_actor_profiles SET moved_to_actor_url = ? WHERE profile_id = ?").bind(newActor, oldShadow.profile_id),
    ]);
  }

  if (event.localTarget === true) {
    const handle = text(event.newLocalHandle, 64);
    if (!handle) return;
    const target = await database.prepare("SELECT id FROM profiles WHERE handle = ? COLLATE NOCASE AND kind = 'local' LIMIT 1")
      .bind(handle).first<{ id: string }>();
    if (!target || target.id === localProfileId) return;
    if (await hasD1BlockBetween(database, localProfileId, target.id)) return;
    await database.prepare("INSERT OR IGNORE INTO follows (follower_profile_id, followed_profile_id, created_at) VALUES (?, ?, ?)")
      .bind(localProfileId, target.id, now).run();
    return;
  }

  const followId = text(event.followId, 128);
  if (!followId || !event.actor || !httpUrl(event.actor.id)) return;
  const shadow = await ensureShadowProfile(database, event.actor);
  const accepted = event.state === "accepted";
  await database.batch([
    database.prepare(
      `INSERT INTO remote_follows (follower_profile_id, remote_profile_id, federation_follow_id, state, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(follower_profile_id, remote_profile_id) DO UPDATE SET federation_follow_id = excluded.federation_follow_id,
         state = excluded.state, updated_at = excluded.updated_at`,
    ).bind(localProfileId, shadow.profileId, followId, accepted ? "accepted" : "pending", now, now),
    ...(accepted
      ? [database.prepare("INSERT OR IGNORE INTO follows (follower_profile_id, followed_profile_id, created_at) VALUES (?, ?, ?)")
          .bind(localProfileId, shadow.profileId, now)]
      : []),
  ]);
}
