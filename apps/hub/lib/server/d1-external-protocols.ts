import "server-only";

import type { D1Database } from "@cloudflare/workers-types";

import type { HubExternalProtocol, HubProtocolDirection } from "@/lib/platform/external-protocols";
import { notGatedSql } from "@/lib/server/gated-exits";

export async function getPublicFederationProfile(database: D1Database, handle: string) {
  return database.prepare(
    `SELECT p.id, p.handle, p.display_name AS displayName, p.bio, p.avatar_url AS avatarUrl
     FROM profiles p
     WHERE p.handle = ? COLLATE NOCASE
       AND NOT EXISTS (
         SELECT 1 FROM profile_moderation_status m
         WHERE m.profile_id = p.id AND m.status = 'suspended'
       )
     LIMIT 1`,
  ).bind(handle).first<{
    id: string;
    handle: string;
    displayName: string;
    bio: string;
    avatarUrl: string | null;
  }>();
}

export async function getPublicFederationPosts(database: D1Database, profileId: string, limit = 20) {
  const result = await database.prepare(
    `SELECT id, body, created_at AS createdAt
     FROM social_posts
     WHERE author_profile_id = ?
       AND audience = 'public'
       AND moderated_at IS NULL
       AND identity_mode = 'account'
       AND ${notGatedSql("post", "social_posts.id")}
     ORDER BY created_at DESC
     LIMIT ?`,
  ).bind(profileId, Math.max(1, Math.min(50, limit))).all<{
    id: string;
    body: string;
    createdAt: string;
  }>();
  return result.results;
}

export async function getPublicFederationPost(database: D1Database, postId: string) {
  return database.prepare(
    `SELECT s.id, s.body, s.created_at AS createdAt,
            p.id AS profileId, p.handle, p.display_name AS displayName
     FROM social_posts s
     JOIN profiles p ON p.id = s.author_profile_id
     WHERE s.id = ?
       AND s.audience = 'public'
       AND s.moderated_at IS NULL
       AND s.identity_mode = 'account'
       AND ${notGatedSql("post", "s.id")}
       AND NOT EXISTS (
         SELECT 1 FROM profile_moderation_status m
         WHERE m.profile_id = p.id AND m.status = 'suspended'
       )
     LIMIT 1`,
  ).bind(postId).first<{
    id: string;
    body: string;
    createdAt: string;
    profileId: string;
    handle: string;
    displayName: string;
  }>();
}

export async function listExternalProtocolLinks(database: D1Database, profileId: string) {
  const result = await database.prepare(
    `SELECT id, protocol, remote_identifier AS remoteIdentifier,
            direction, status, created_at AS createdAt, updated_at AS updatedAt
     FROM hub_external_protocol_links
     WHERE profile_id = ?
     ORDER BY updated_at DESC`,
  ).bind(profileId).all();
  return result.results;
}

export async function listActivityPubRecommendationSources(
  database: D1Database,
  profileId: string,
  limit = 6,
) {
  const result = await database.prepare(
    `SELECT remote_identifier AS remoteIdentifier
     FROM hub_external_protocol_links
     WHERE profile_id = ?
       AND protocol = 'activitypub'
       AND direction IN ('import', 'bidirectional')
       AND status = 'active'
     ORDER BY updated_at DESC
     LIMIT ?`,
  ).bind(profileId, Math.max(1, Math.min(12, limit))).all<{ remoteIdentifier: string }>();
  return result.results.map((row) => row.remoteIdentifier);
}

export async function createExternalProtocolLink(database: D1Database, input: {
  profileId: string;
  protocol: HubExternalProtocol;
  remoteIdentifier: string;
  direction: HubProtocolDirection;
}) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await database.prepare(
    `INSERT INTO hub_external_protocol_links
       (id, profile_id, protocol, remote_identifier, direction, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`,
  ).bind(id, input.profileId, input.protocol, input.remoteIdentifier, input.direction, now, now).run();
  return { id, ...input, status: "active", createdAt: now, updatedAt: now };
}

export async function revokeExternalProtocolLink(database: D1Database, profileId: string, id: string) {
  const now = new Date().toISOString();
  const result = await database.prepare(
    `UPDATE hub_external_protocol_links
     SET status = 'revoked', updated_at = ?
     WHERE id = ? AND profile_id = ? AND status != 'revoked'`,
  ).bind(now, id, profileId).run();
  return Boolean(result.meta.changes);
}

export async function buildPortableProfileArchive(database: D1Database, profileId: string) {
  const [profile, follows, posts, lists, bookmarks, links] = await Promise.all([
    database.prepare(
      `SELECT handle, display_name AS displayName, bio, avatar_url AS avatarUrl,
              joined_at AS joinedAt
       FROM profiles WHERE id = ? LIMIT 1`,
    ).bind(profileId).first(),
    database.prepare(
      `SELECT p.handle, f.created_at AS followedAt
       FROM follows f JOIN profiles p ON p.id = f.followed_profile_id
       WHERE f.follower_profile_id = ? ORDER BY f.created_at`,
    ).bind(profileId).all(),
    database.prepare(
      `SELECT id, body, created_at AS createdAt, reply_to_post_id AS replyToPostId
       FROM social_posts
       WHERE author_profile_id = ? AND identity_mode = 'account'
       ORDER BY created_at`,
    ).bind(profileId).all(),
    database.prepare(
      `SELECT id, name, description, visibility, created_at AS createdAt
       FROM user_lists WHERE owner_profile_id = ? ORDER BY created_at`,
    ).bind(profileId).all(),
    database.prepare(
      `SELECT target_type AS targetType, target_id AS targetId,
              note, created_at AS createdAt
       FROM bookmarks
       WHERE profile_id = ?
       ORDER BY created_at`,
    ).bind(profileId).all(),
    listExternalProtocolLinks(database, profileId),
  ]);
  return {
    format: "hub-portable-v1",
    generatedAt: new Date().toISOString(),
    profile,
    follows: follows.results,
    posts: posts.results,
    lists: lists.results,
    bookmarks: bookmarks.results,
    externalProtocolLinks: links,
  };
}

export async function recordPortabilityExport(database: D1Database, profileId: string, recordCount: number) {
  const id = crypto.randomUUID();
  await database.prepare(
    `INSERT INTO hub_portability_exports
       (id, profile_id, format, status, record_count, created_at)
     VALUES (?, ?, 'hub-portable-v1', 'completed', ?, ?)`,
  ).bind(id, profileId, recordCount, new Date().toISOString()).run();
}
