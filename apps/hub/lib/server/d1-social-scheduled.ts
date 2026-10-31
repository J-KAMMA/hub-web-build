import type { D1Database } from "@cloudflare/workers-types";
import type { Profile } from "@/lib/domain";

export class FeedRequestConflict extends Error {
  readonly code = "feed_request_conflict";
  constructor() { super("feed_request_conflict"); this.name = "FeedRequestConflict"; }
}

export type ScheduledClientRequest = {
  id: string;
  body: string;
  audience: "public" | "followers";
  scheduledAt: string;
  status: "scheduled" | "cancelled" | "published" | "failed";
};

function requestIdentity(authorId: string, requestId: string) {
  if (typeof authorId !== "string" || authorId.length < 1 || authorId.length > 128 || /[^A-Za-z0-9_-]/u.test(authorId)
    || typeof requestId !== "string" || requestId.length !== 36 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(requestId)
    || requestId === "00000000-0000-0000-0000-000000000000") throw new Error("feed_request_invalid");
  return requestId.toLowerCase();
}

/** Deterministic UUIDv8 (122 hash bits after fixed version/variant), never random. */
export async function scheduledClientRequestId(authorId: string, requestId: string): Promise<string> {
  const normalized = requestIdentity(authorId, requestId);
  const data = new TextEncoder().encode(JSON.stringify(["hub-scheduled-request-v1", authorId, normalized]));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data)).slice(0, 16);
  digest[6] = (digest[6]! & 0x0f) | 0x80;
  digest[8] = (digest[8]! & 0x3f) | 0x80;
  const hex = Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function readScheduledClientRequest(database: D1Database, authorId: string, requestId: string): Promise<ScheduledClientRequest | null> {
  const expected = await scheduledClientRequestId(authorId, requestId);
  const value = await database.prepare(`SELECT id, body, audience, scheduled_at AS scheduledAt, status
    FROM social_scheduled_posts WHERE id = ? AND author_profile_id = ?`).bind(expected, authorId).first<ScheduledClientRequest>();
  if (!value) return null;
  if (value.id !== expected || typeof value.body !== "string" || !value.body.trim() || value.body.length > 500 || /[\p{Surrogate}\u0000]/u.test(value.body)
    || !["public", "followers"].includes(value.audience) || typeof value.scheduledAt !== "string" || value.scheduledAt.length > 40
    || !Number.isFinite(Date.parse(value.scheduledAt)) || !["scheduled", "cancelled", "published", "failed"].includes(value.status)) {
    throw new Error("feed_request_unavailable");
  }
  return { id: value.id, body: value.body, audience: value.audience, scheduledAt: value.scheduledAt, status: value.status };
}

export async function scheduleD1SocialPost(database: D1Database, profile: Profile, input: { body: string; audience: "public" | "followers"; scheduledAt: string; clientRequestId?: string | null }) {
  if (input.clientRequestId != null) {
    const id = await scheduledClientRequestId(profile.id, input.clientRequestId);
    if (typeof input.body !== "string" || input.body.length > 500 || /[\p{Surrogate}\u0000]/u.test(input.body) || !["public", "followers"].includes(input.audience)
      || typeof input.scheduledAt !== "string" || input.scheduledAt.length > 40 || !Number.isFinite(Date.parse(input.scheduledAt))) throw new Error("feed_request_invalid");
    const body = input.body.normalize("NFKC").replace(/\r\n/gu, "\n").trim(), scheduledAt = new Date(input.scheduledAt).toISOString();
    if (!body || body.length > 500) throw new Error("feed_request_invalid");
    await database.prepare(`INSERT OR IGNORE INTO social_scheduled_posts
      (id, author_profile_id, body, audience, scheduled_at, status, created_at)
      VALUES (?, ?, ?, ?, ?, 'scheduled', ?)`).bind(id, profile.id, body, input.audience, scheduledAt, new Date().toISOString()).run();
    const saved = await readScheduledClientRequest(database, profile.id, input.clientRequestId);
    if (!saved || saved.body !== body || saved.audience !== input.audience || saved.scheduledAt !== scheduledAt) throw new FeedRequestConflict();
    return { id: saved.id, scheduledAt: saved.scheduledAt, status: saved.status };
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await database.prepare(`INSERT INTO social_scheduled_posts
    (id, author_profile_id, body, audience, scheduled_at, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'scheduled', ?)`)
    .bind(id, profile.id, input.body, input.audience, input.scheduledAt, now).run();
  return { id, scheduledAt: input.scheduledAt, status: "scheduled" as const };
}

export async function publishDueSocialPosts(database: D1Database, now = new Date().toISOString()) {
  const due = await database.prepare(`SELECT s.id, s.author_profile_id, s.body, s.audience, s.scheduled_at,
      p.display_name, p.handle FROM social_scheduled_posts s JOIN profiles p ON p.id = s.author_profile_id
      WHERE s.status = 'scheduled' AND s.scheduled_at <= ? ORDER BY s.scheduled_at LIMIT 50`)
    .bind(now).all<{ id: string; author_profile_id: string; body: string; audience: "public" | "followers"; scheduled_at: string; display_name: string; handle: string }>();
  let published = 0;
  for (const item of due.results) {
    const postId = `scheduled:${item.id}`;
    const result = await database.batch([
      database.prepare(`INSERT OR IGNORE INTO social_posts
        (id, author_profile_id, display_name, handle, identity_mode, body, created_at, audience)
        VALUES (?, ?, ?, ?, 'account', ?, ?, ?)`)
        .bind(postId, item.author_profile_id, item.display_name, item.handle, item.body, item.scheduled_at, item.audience),
      database.prepare("UPDATE social_scheduled_posts SET status = 'published' WHERE id = ? AND status = 'scheduled'").bind(item.id),
    ]);
    if (result.length) published += 1;
  }
  return { published };
}
