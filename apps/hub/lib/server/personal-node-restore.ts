import "server-only";

import type { D1Database } from "@cloudflare/workers-types";

import {
  setD1DirectMessagePreferences,
  setD1NotificationPreferences,
  type DirectMessageReceivePolicy,
  type NotificationPreferences,
} from "@/lib/server/d1-direct-messages";

export type VerifiedPortableEvent = {
  id: string;
  sequence: number;
  previousHash?: string;
  eventHash: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
  signerKeyId: string;
};

export type RestorePreview = {
  total: number;
  pending: number;
  alreadyRestored: number;
  byType: Record<string, number>;
  warnings: string[];
};

export async function previewPersonalNodeRestore(
  database: D1Database,
  profileId: string,
  events: VerifiedPortableEvent[],
): Promise<RestorePreview> {
  const hashes = events.map((event) => event.eventHash);
  const restored = new Set<string>();
  for (let offset = 0; offset < hashes.length; offset += 80) {
    const chunk = hashes.slice(offset, offset + 80);
    if (!chunk.length) continue;
    const rows = await database.prepare(
      `SELECT event_hash FROM personal_node_restore_events
       WHERE profile_id=? AND event_hash IN (${chunk.map(() => "?").join(",")})`,
    ).bind(profileId, ...chunk).all<{ event_hash: string }>();
    rows.results.forEach((row) => restored.add(row.event_hash));
  }
  const byType: Record<string, number> = {};
  for (const event of events) byType[event.type] = (byType[event.type] ?? 0) + 1;
  const warnings: string[] = [];
  if (events.some((event) =>
    event.type === "hub.profile.update" && event.payload.avatarUpdated === true)) {
    warnings.push("プロフィール画像のバイナリはイベントに含まれないため、画像は復元されません。");
  }
  if (events.some((event) =>
    event.type === "hub.post.create" && Array.isArray(event.payload.imageIds) &&
    event.payload.imageIds.length > 0)) {
    warnings.push("メディア参照があっても画像本体がない投稿は、本文のみ復元されます。");
  }
  return {
    total: events.length,
    pending: events.length - restored.size,
    alreadyRestored: restored.size,
    byType,
    warnings,
  };
}

export async function applyPersonalNodeRestore(
  database: D1Database,
  profileId: string,
  events: VerifiedPortableEvent[],
): Promise<{ applied: number; alreadyPresent: number; skipped: number; conflicts: number }> {
  const profile = await database.prepare(
    "SELECT display_name displayName,handle FROM profiles WHERE id=? LIMIT 1",
  ).bind(profileId).first<{ displayName: string; handle: string }>();
  if (!profile) throw new Error("profile_not_found");
  const result = { applied: 0, alreadyPresent: 0, skipped: 0, conflicts: 0 };
  for (const event of events) {
    const receipt = await database.prepare(
      "SELECT outcome FROM personal_node_restore_events WHERE profile_id=? AND event_hash=?",
    ).bind(profileId, event.eventHash).first<{ outcome: string }>();
    if (receipt) {
      result.alreadyPresent += 1;
      continue;
    }
    let outcome: "applied" | "already_present" | "skipped" | "conflict" = "skipped";
    try {
      outcome = await applyEvent(database, profileId, profile, event);
    } catch {
      outcome = "conflict";
    }
    await database.prepare(
      `INSERT OR IGNORE INTO personal_node_restore_events(
        profile_id,event_hash,event_type,source_created_at,outcome,restored_at
      ) VALUES(?,?,?,?,?,?)`,
    ).bind(
      profileId, event.eventHash, event.type, event.createdAt, outcome,
      new Date().toISOString(),
    ).run();
    if (outcome === "applied") result.applied += 1;
    else if (outcome === "already_present") result.alreadyPresent += 1;
    else if (outcome === "conflict") result.conflicts += 1;
    else result.skipped += 1;
  }
  return result;
}

async function applyEvent(
  database: D1Database,
  profileId: string,
  profile: { displayName: string; handle: string },
  event: VerifiedPortableEvent,
): Promise<"applied" | "already_present" | "skipped" | "conflict"> {
  const payload = event.payload;
  if (event.type === "hub.post.create") {
    const postId = safeId(payload.postId);
    const body = safeText(payload.body, 20_000);
    if (!postId || !body) return "skipped";
    const existing = await database.prepare(
      "SELECT author_profile_id authorProfileId,body FROM social_posts WHERE id=?",
    ).bind(postId).first<{ authorProfileId: string | null; body: string }>();
    if (existing) {
      return existing.authorProfileId === profileId && existing.body === body
        ? "already_present"
        : "conflict";
    }
    const replyToPostId = safeId(payload.replyToPostId);
    const audience = payload.audience === "followers" ? "followers" : "public";
    await database.prepare(
      `INSERT INTO social_posts(
        id,author_profile_id,display_name,handle,identity_mode,body,created_at,
        reply_to_post_id,audience
      ) VALUES(?,?,?,?,?,?,?,?,?)`,
    ).bind(
      postId, profileId, profile.displayName, profile.handle, "account", body,
      event.createdAt, replyToPostId, audience,
    ).run();
    return "applied";
  }
  if (event.type === "hub.post.update") {
    const postId = safeId(payload.postId);
    const body = safeText(payload.body, 20_000);
    if (!postId || !body) return "skipped";
    const changed = await database.prepare(
      `UPDATE social_posts SET body=?
       WHERE id=? AND author_profile_id=? AND moderated_at IS NULL`,
    ).bind(body, postId, profileId).run();
    return changed.meta.changes ? "applied" : "skipped";
  }
  if (event.type === "hub.post.delete") {
    const postId = safeId(payload.postId);
    if (!postId) return "skipped";
    const changed = await database.prepare(
      `UPDATE social_posts SET moderated_at=?,moderation_reason='user_deleted'
       WHERE id=? AND author_profile_id=? AND moderated_at IS NULL`,
    ).bind(event.createdAt, postId, profileId).run();
    return changed.meta.changes ? "applied" : "already_present";
  }
  if (event.type === "hub.follow.create" || event.type === "hub.follow.delete") {
    const targetProfileId = safeId(payload.targetProfileId);
    if (!targetProfileId || targetProfileId === profileId) return "skipped";
    const target = await database.prepare("SELECT id FROM profiles WHERE id=?")
      .bind(targetProfileId).first();
    if (!target) return "skipped";
    if (event.type === "hub.follow.create") {
      const changed = await database.prepare(
        "INSERT OR IGNORE INTO follows(follower_profile_id,followed_profile_id,created_at) VALUES(?,?,?)",
      ).bind(profileId, targetProfileId, event.createdAt).run();
      return changed.meta.changes ? "applied" : "already_present";
    }
    const changed = await database.prepare(
      "DELETE FROM follows WHERE follower_profile_id=? AND followed_profile_id=?",
    ).bind(profileId, targetProfileId).run();
    return changed.meta.changes ? "applied" : "already_present";
  }
  if (event.type === "hub.profile.update") {
    const displayName = safeText(payload.displayName, 80);
    const bio = typeof payload.bio === "string" ? payload.bio.slice(0, 500) : null;
    if (displayName !== null || bio !== null) {
      await database.prepare(
        `UPDATE profiles SET display_name=COALESCE(?,display_name),
         bio=COALESCE(?,bio),updated_at=? WHERE id=?`,
      ).bind(displayName, bio, event.createdAt, profileId).run();
      return "applied";
    }
    return "skipped";
  }
  if (event.type === "hub.preference.update") {
    return applyPreference(database, profileId, payload);
  }
  return "skipped";
}

async function applyPreference(
  database: D1Database,
  profileId: string,
  payload: Record<string, unknown>,
): Promise<"applied" | "skipped"> {
  if (!isRecord(payload.value)) return "skipped";
  if (payload.namespace === "content-safety") {
    const terms = Array.isArray(payload.value.terms)
      ? [...new Set(payload.value.terms.map(String).map((term) => term.trim())
        .filter((term) => term.length >= 2 && term.length <= 80))].slice(0, 50)
      : [];
    if (typeof payload.value.showSensitive !== "boolean") return "skipped";
    const now = new Date().toISOString();
    await database.batch([
      database.prepare("DELETE FROM profile_muted_terms WHERE profile_id=?").bind(profileId),
      ...terms.map((term) => database.prepare(
        "INSERT INTO profile_muted_terms(profile_id,term,created_at) VALUES(?,?,?)",
      ).bind(profileId, term, now)),
      database.prepare(
        `INSERT INTO profile_content_preferences(profile_id,show_sensitive,updated_at)
         VALUES(?,?,?) ON CONFLICT(profile_id) DO UPDATE SET
         show_sensitive=excluded.show_sensitive,updated_at=excluded.updated_at`,
      ).bind(profileId, payload.value.showSensitive ? 1 : 0, now),
    ]);
    return "applied";
  }
  if (payload.namespace === "notifications" && isRecord(payload.value.notifications)) {
    const notifications = payload.value.notifications;
    const keys: Array<keyof NotificationPreferences> = [
      "replies", "reactions", "follows", "messages",
      "commercePayments", "commerceDelivery", "commerceReturns",
    ];
    if (keys.some((key) => typeof notifications[key] !== "boolean")) return "skipped";
    await setD1NotificationPreferences(
      database,
      profileId,
      Object.fromEntries(keys.map((key) => [key, notifications[key]])) as NotificationPreferences,
    );
    const directMessages = payload.value.directMessages;
    if (directMessages === "mutuals" || directMessages === "following" || directMessages === "nobody") {
      await setD1DirectMessagePreferences(
        database,
        profileId,
        directMessages as DirectMessageReceivePolicy,
      );
    }
    return "applied";
  }
  return "skipped";
}

function safeId(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{1,100}$/.test(value) ? value : null;
}

function safeText(value: unknown, max: number): string | null {
  return typeof value === "string" && value.trim() && value.length <= max ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
