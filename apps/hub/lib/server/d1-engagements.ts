import type { D1Database } from "@cloudflare/workers-types";

import type { EngagementSummary, EngagementTargetType, ReactionKind } from "@/lib/domain";
import { calculateEngagementScore } from "@/lib/engagement-score";
import { requireNoD1BlockBetween } from "@/lib/server/profile-blocks";
import {
  createD1SocialNotification,
  syncUnreadD1ReactionNotification,
} from "@/lib/server/d1-social-notifications";
import { isNewHubAccount } from "@/lib/thread-abuse-controls";
import { mirrorRemoteLike } from "@/lib/server/federation-outbound";
import { findVisibleD1SocialTarget } from "@/lib/server/social-target-visibility";

export class HubReactionRateLimitError extends Error {
  constructor(public readonly retryAfterSeconds: number) {
    super(`反応が集中しています。約${Math.max(1, Math.ceil(retryAfterSeconds / 60))}分後にもう一度お試しください。`);
    this.name = "HubReactionRateLimitError";
  }
}

export class HubSelfReactionError extends Error {
  constructor() {
    super("自分の投稿にはいいねできません。");
    this.name = "HubSelfReactionError";
  }
}

async function visibleTarget(
  database: D1Database,
  viewerProfileId: string,
  targetType: EngagementTargetType,
  targetId: string,
) {
  return findVisibleD1SocialTarget(
    database,
    viewerProfileId,
    targetType,
    targetId,
  );
}

async function rejectBlockedSocialPostBeforeVisibility(
  database: D1Database,
  viewerProfileId: string,
  targetType: "thread" | EngagementTargetType,
  targetId: string,
) {
  if (targetType !== "social_post") return;
  // Blocking removes follows, so a followers-only post can disappear from the
  // visibility query before the interaction block is checked.
  const target = await database.prepare(`SELECT post.author_profile_id AS authorProfileId
      FROM social_posts post
      WHERE post.id = ? AND post.moderated_at IS NULL
      LIMIT 1`)
    .bind(targetId)
    .first<{ authorProfileId: string | null }>();
  await requireNoD1BlockBetween(database, viewerProfileId, target?.authorProfileId);
}

async function threadExists(database: D1Database, threadId: string) {
  return Boolean(await database.prepare("SELECT id FROM threads WHERE id = ?").bind(threadId).first());
}

async function notifyLike(database: D1Database, input: {
  targetType: EngagementTargetType;
  targetId: string;
  actorProfileId: string;
  createdAt: string;
}) {
  if (input.targetType === "vault_content") return;
  const table = input.targetType === "thread_post"
    ? "thread_posts"
    : input.targetType === "community_message"
      ? "community_channel_messages"
      : "social_posts";
  const visibility = input.targetType === "thread_post"
    ? "AND deleted_at IS NULL AND moderated_at IS NULL"
    : input.targetType === "social_post"
      ? "AND moderated_at IS NULL"
      : "";
  const owner = await database.prepare(`SELECT author_profile_id FROM ${table} WHERE id = ? ${visibility}`)
    .bind(input.targetId).first<{ author_profile_id: string | null }>();
  if (!owner?.author_profile_id || owner.author_profile_id === input.actorProfileId) return;

  await createD1SocialNotification(database, {
    receiverProfileId: owner.author_profile_id,
    actorProfileId: null,
    safetyActorProfileId: input.actorProfileId,
    type: "social_reaction",
    targetType: input.targetType,
    targetId: input.targetId,
    text: "投稿にいいねが付きました。",
    preference: "reactions",
    createdAt: input.createdAt,
  });
}

export async function getD1EngagementSummary(database: D1Database, targetType: EngagementTargetType, targetId: string, viewerId: string | null): Promise<EngagementSummary> {
  const supportsPostRelationships =
    targetType === "social_post" || targetType === "thread_post";
  const [reactions, replyCount, repostCount, quoteCount, bookmarkCount, bookmark, viewerReaction, viewerRepost] = await Promise.all([
    database.prepare(`SELECT count(*) AS likes
      FROM reactions WHERE target_type = ? AND target_id = ? AND kind = 'like'`).bind(targetType, targetId).first<{ likes: number }>(),
    targetType === "community_message"
      ? database.prepare(`SELECT count(*) AS total
          FROM community_channel_messages WHERE reply_to_message_id = ?`)
        .bind(targetId).first<{ total: number }>()
      : supportsPostRelationships
        ? database.prepare(`SELECT count(*) AS total FROM ${
            targetType === "thread_post" ? "thread_posts" : "social_posts"
          } WHERE reply_to_post_id = ? ${
            targetType === "thread_post"
              ? "AND deleted_at IS NULL AND moderated_at IS NULL"
              : "AND moderated_at IS NULL"
          }`)
          .bind(targetId).first<{ total: number }>()
        : Promise.resolve({ total: 0 }),
    supportsPostRelationships
      ? database.prepare("SELECT count(*) AS total FROM social_posts WHERE repost_of_target_type = ? AND repost_of_target_id = ? AND moderated_at IS NULL")
        .bind(targetType, targetId).first<{ total: number }>()
      : Promise.resolve({ total: 0 }),
    supportsPostRelationships
      ? database.prepare("SELECT count(*) AS total FROM social_posts WHERE quote_of_target_type = ? AND quote_of_target_id = ? AND moderated_at IS NULL")
        .bind(targetType, targetId).first<{ total: number }>()
      : Promise.resolve({ total: 0 }),
    database.prepare("SELECT count(*) AS total FROM bookmarks WHERE target_type = ? AND target_id = ?")
      .bind(targetType, targetId).first<{ total: number }>(),
    viewerId ? database.prepare("SELECT id FROM bookmarks WHERE profile_id = ? AND target_type = ? AND target_id = ?")
      .bind(viewerId, targetType, targetId).first<{ id: string }>() : Promise.resolve(null),
    viewerId ? database.prepare("SELECT kind FROM reactions WHERE profile_id = ? AND target_type = ? AND target_id = ? AND kind = 'like'")
      .bind(viewerId, targetType, targetId).first<{ kind: ReactionKind }>() : Promise.resolve(null),
    viewerId && supportsPostRelationships
      ? database.prepare(`SELECT id FROM social_posts
          WHERE author_profile_id = ?
            AND repost_of_target_type = ?
            AND repost_of_target_id = ?
            AND moderated_at IS NULL
          ORDER BY datetime(created_at) DESC
          LIMIT 1`)
        .bind(viewerId, targetType, targetId)
        .first<{ id: string }>()
      : Promise.resolve(null),
  ]);
  const likeCount = Number(reactions?.likes ?? 0);
  const counts = {
    replyCount: Number(replyCount?.total ?? 0),
    repostCount: Number(repostCount?.total ?? 0),
    quoteRepostCount: Number(quoteCount?.total ?? 0),
    likeCount,
    bookmarkCount: Number(bookmarkCount?.total ?? 0)
  };
  return {
    targetType,
    targetId,
    replyCount: counts.replyCount,
    repostCount: counts.repostCount,
    quoteRepostCount: counts.quoteRepostCount,
    likeCount,
    score: calculateEngagementScore(counts),
    bookmarked: Boolean(bookmark),
    viewerReaction: viewerReaction?.kind ?? null,
    viewerRepostId: viewerRepost?.id ?? null,
  };
}

export async function getD1ThreadPostEngagementSummaries(
  database: D1Database,
  targetIds: readonly string[],
  viewerId: string | null,
): Promise<Map<string, EngagementSummary>> {
  const ids = [...new Set(targetIds.map((id) => id.trim()).filter(Boolean))].slice(0, 100);
  if (ids.length === 0) return new Map();
  const placeholders = ids.map(() => "?").join(", ");
  const viewer = viewerId ?? "";
  const result = await database.prepare(`SELECT target.id AS target_id,
    (SELECT count(*) FROM reactions reaction
      WHERE reaction.target_type = 'thread_post'
        AND reaction.target_id = target.id
        AND reaction.kind = 'like') AS like_count,
    (SELECT count(*) FROM thread_posts reply
      WHERE reply.reply_to_post_id = target.id
        AND reply.deleted_at IS NULL
        AND reply.moderated_at IS NULL) AS reply_count,
    (SELECT count(*) FROM social_posts repost
      WHERE repost.repost_of_target_type = 'thread_post'
        AND repost.repost_of_target_id = target.id
        AND repost.moderated_at IS NULL) AS repost_count,
    (SELECT count(*) FROM social_posts quote
      WHERE quote.quote_of_target_type = 'thread_post'
        AND quote.quote_of_target_id = target.id
        AND quote.moderated_at IS NULL) AS quote_count,
    (SELECT count(*) FROM bookmarks bookmark
      WHERE bookmark.target_type = 'thread_post'
        AND bookmark.target_id = target.id) AS bookmark_count,
    EXISTS (
      SELECT 1 FROM bookmarks viewer_bookmark
      WHERE ? <> ''
        AND viewer_bookmark.profile_id = ?
        AND viewer_bookmark.target_type = 'thread_post'
        AND viewer_bookmark.target_id = target.id
    ) AS bookmarked,
    EXISTS (
      SELECT 1 FROM reactions viewer_reaction
      WHERE ? <> ''
        AND viewer_reaction.profile_id = ?
        AND viewer_reaction.target_type = 'thread_post'
        AND viewer_reaction.target_id = target.id
        AND viewer_reaction.kind = 'like'
    ) AS liked,
    (SELECT viewer_repost.id FROM social_posts viewer_repost
      WHERE ? <> ''
        AND viewer_repost.author_profile_id = ?
        AND viewer_repost.repost_of_target_type = 'thread_post'
        AND viewer_repost.repost_of_target_id = target.id
        AND viewer_repost.moderated_at IS NULL
      ORDER BY datetime(viewer_repost.created_at) DESC
      LIMIT 1) AS viewer_repost_id
    FROM thread_posts target
    WHERE target.id IN (${placeholders})`)
    .bind(viewer, viewer, viewer, viewer, viewer, viewer, ...ids)
    .all<{
      target_id: string;
      like_count: number;
      reply_count: number;
      repost_count: number;
      quote_count: number;
      bookmark_count: number;
      bookmarked: number;
      liked: number;
      viewer_repost_id: string | null;
    }>();

  return new Map(result.results.map((row) => {
    const counts = {
      replyCount: Number(row.reply_count ?? 0),
      repostCount: Number(row.repost_count ?? 0),
      quoteRepostCount: Number(row.quote_count ?? 0),
      likeCount: Number(row.like_count ?? 0),
      bookmarkCount: Number(row.bookmark_count ?? 0),
    };
    return [row.target_id, {
      targetType: "thread_post" as const,
      targetId: row.target_id,
      replyCount: counts.replyCount,
      repostCount: counts.repostCount,
      quoteRepostCount: counts.quoteRepostCount,
      likeCount: counts.likeCount,
      score: calculateEngagementScore(counts),
      bookmarked: Boolean(row.bookmarked),
      viewerReaction: row.liked ? "like" as const : null,
      viewerRepostId: row.viewer_repost_id ?? null,
    }];
  }));
}

export async function getD1ThreadSpotlightScores(database: D1Database, threadId: string): Promise<Map<string, number>> {
  const trustedBefore = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const result = await database.prepare(`SELECT target.id,
    (SELECT count(*) FROM reactions reaction
      JOIN profiles voter ON voter.id = reaction.profile_id
      WHERE reaction.target_type = 'thread_post' AND reaction.target_id = target.id
        AND reaction.kind = 'like' AND reaction.profile_id <> target.author_profile_id
        AND voter.joined_at <= ?) AS trusted_likes,
    (SELECT count(*) FROM bookmarks bookmark
      JOIN profiles saver ON saver.id = bookmark.profile_id
      WHERE bookmark.target_type = 'thread_post' AND bookmark.target_id = target.id
        AND bookmark.profile_id <> target.author_profile_id AND saver.joined_at <= ?) AS trusted_bookmarks,
    (SELECT count(*) FROM thread_posts reply
      JOIN profiles replier ON replier.id = reply.author_profile_id
      WHERE reply.reply_to_post_id = target.id AND reply.deleted_at IS NULL AND reply.moderated_at IS NULL
        AND reply.author_profile_id <> target.author_profile_id AND replier.joined_at <= ?) AS trusted_replies
    FROM thread_posts target WHERE target.thread_id = ?`)
    .bind(trustedBefore, trustedBefore, trustedBefore, threadId)
    .all<{ id: string; trusted_likes: number; trusted_bookmarks: number; trusted_replies: number }>();
  return new Map((result.results ?? []).map((row) => [row.id, calculateEngagementScore({
    likeCount: Number(row.trusted_likes ?? 0),
    bookmarkCount: Number(row.trusted_bookmarks ?? 0),
    replyCount: Number(row.trusted_replies ?? 0),
    repostCount: 0,
    quoteRepostCount: 0,
  })]));
}

/**
 * いいねの切替。外部から取り込んだ投稿へのいいねは、ローカルの行を作ったあと Federation へ Like / Undo Like を送る。
 */
export async function toggleD1Reaction(database: D1Database, input: {
  targetType: EngagementTargetType; targetId: string; kind: ReactionKind; profileId: string; profileJoinedAt: string;
  active?: boolean;
}) {
  const summary = await toggleD1ReactionLocal(database, input);
  if (input.kind === "like" && input.targetType === "social_post") {
    await mirrorRemoteLike(database, { profileId: input.profileId, targetId: input.targetId, liked: summary.viewerReaction === "like" });
  }
  return summary;
}

async function toggleD1ReactionLocal(database: D1Database, input: {
  targetType: EngagementTargetType; targetId: string; kind: ReactionKind; profileId: string; profileJoinedAt: string;
  active?: boolean;
}) {
  const existing = await database.prepare("SELECT id, kind FROM reactions WHERE profile_id = ? AND target_type = ? AND target_id = ?")
    .bind(input.profileId, input.targetType, input.targetId).first<{ id: string; kind: ReactionKind }>();
  const shouldActivate = input.active ?? existing?.kind !== input.kind;
  if (!shouldActivate) {
    if (existing?.kind === input.kind) {
      await database.prepare("DELETE FROM reactions WHERE id = ?").bind(existing.id).run();
      if (
        input.kind === "like" &&
        input.targetType !== "vault_content"
      ) {
        await syncUnreadD1ReactionNotification(database, {
          targetType: input.targetType,
          targetId: input.targetId,
        });
      }
    }
    return {
      ...await getD1EngagementSummary(database, input.targetType, input.targetId, input.profileId),
      viewerReaction: null,
    };
  }
  await rejectBlockedSocialPostBeforeVisibility(
    database,
    input.profileId,
    input.targetType,
    input.targetId,
  );
  const target = await visibleTarget(
    database,
    input.profileId,
    input.targetType,
    input.targetId,
  );
  if (!target) throw new Error("Target does not exist.");
  const now = new Date().toISOString();
  if (target.authorProfileId === input.profileId) {
    throw new HubSelfReactionError();
  }
  await requireNoD1BlockBetween(
    database,
    input.profileId,
    target.authorProfileId,
  );
  let insertedReaction = false;
  if (existing?.kind === input.kind) {
    // Explicit desired-state requests are idempotent.
  } else if (existing) {
    await database.prepare("UPDATE reactions SET kind = ?, created_at = ? WHERE id = ?")
      .bind(input.kind, now, existing.id).run();
  } else {
    const nowDate = new Date(now);
    const windowMs = 10 * 60 * 1000;
    const limit = isNewHubAccount({ joinedAt: input.profileJoinedAt }, nowDate) ? 5 : 20;
    const windowStartMs = Math.floor(nowDate.getTime() / windowMs) * windowMs;
    const result = await database.prepare(`INSERT INTO hub_reaction_rate_limit_buckets
      (profile_id, window_started_at, request_count, expires_at) VALUES (?, ?, 1, ?)
      ON CONFLICT(profile_id, window_started_at) DO UPDATE SET request_count = request_count + 1
      WHERE request_count < ?`).bind(
        input.profileId,
        new Date(windowStartMs).toISOString(),
        new Date(windowStartMs + windowMs).toISOString(),
        limit,
      ).run();
    if (!result.meta.changes) {
      throw new HubReactionRateLimitError(Math.max(1, Math.ceil((windowStartMs + windowMs - nowDate.getTime()) / 1000)));
    }
    const inserted = await database.prepare(`INSERT INTO reactions
      (id, target_type, target_id, profile_id, kind, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(profile_id, target_type, target_id) DO NOTHING`)
      .bind(
        crypto.randomUUID(),
        input.targetType,
        input.targetId,
        input.profileId,
        input.kind,
        now,
      )
      .run();
    insertedReaction = Boolean(inserted.meta.changes);
    if (!insertedReaction) {
      await database.prepare(`UPDATE hub_reaction_rate_limit_buckets
        SET request_count = max(0, request_count - 1)
        WHERE profile_id = ? AND window_started_at = ?`)
        .bind(input.profileId, new Date(windowStartMs).toISOString()).run();
    }
  }
  if (
    input.kind === "like" &&
    shouldActivate &&
    existing?.kind !== "like" &&
    (existing || insertedReaction)
  ) {
    await notifyLike(database, {
      targetType: input.targetType,
      targetId: input.targetId,
      actorProfileId: input.profileId,
      createdAt: now,
    });
  }
  return getD1EngagementSummary(database, input.targetType, input.targetId, input.profileId);
}

export async function toggleD1Bookmark(database: D1Database, input: {
  targetType: "thread" | EngagementTargetType; targetId: string; note?: string; profileId: string;
  active?: boolean;
}) {
  const existing = await database.prepare("SELECT id FROM bookmarks WHERE profile_id = ? AND target_type = ? AND target_id = ?")
    .bind(input.profileId, input.targetType, input.targetId).first<{ id: string }>();
  const shouldActivate = input.active ?? !existing;
  if (!shouldActivate) {
    if (existing) {
      await database.prepare("DELETE FROM bookmarks WHERE id = ?").bind(existing.id).run();
    }
    if (input.targetType === "thread") return { bookmarked: false };
    return {
      ...await getD1EngagementSummary(database, input.targetType, input.targetId, input.profileId),
      bookmarked: false,
    };
  }
  await rejectBlockedSocialPostBeforeVisibility(
    database,
    input.profileId,
    input.targetType,
    input.targetId,
  );
  const target = input.targetType === "thread"
    ? null
    : await visibleTarget(
        database,
        input.profileId,
        input.targetType,
        input.targetId,
      );
  const exists = input.targetType === "thread"
    ? await threadExists(database, input.targetId)
    : Boolean(target);
  if (!exists) throw new Error("Target does not exist.");
  if (
    shouldActivate
    && (
      input.targetType === "social_post"
      || input.targetType === "thread_post"
      || input.targetType === "community_message"
    )
  ) {
    await requireNoD1BlockBetween(
      database,
      input.profileId,
      target?.authorProfileId,
    );
  }
  if (!existing) await database.prepare(`INSERT INTO bookmarks
    (id, profile_id, target_type, target_id, note, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(profile_id, target_type, target_id) DO NOTHING`)
    .bind(
      crypto.randomUUID(),
      input.profileId,
      input.targetType,
      input.targetId,
      input.note?.trim() ?? "",
      new Date().toISOString(),
    ).run();
  if (input.targetType === "thread") return { bookmarked: shouldActivate };
  return getD1EngagementSummary(database, input.targetType, input.targetId, input.profileId);
}
