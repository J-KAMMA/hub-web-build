import type { D1Database } from "@cloudflare/workers-types";

import type { ThreadPostVoteKind, ThreadPostVoteSummary } from "@/lib/domain";
import { isNewHubAccount } from "@/lib/thread-abuse-controls";

export class ThreadPostVoteError extends Error {}

export async function getD1ThreadPostVoteSummaries(
  database: D1Database,
  threadId: string,
  viewerId: string | null,
): Promise<Map<string, ThreadPostVoteSummary>> {
  const result = await database.prepare(`SELECT post.id,
    SUM(CASE WHEN vote.kind = 'up' THEN 1 ELSE 0 END) AS up_count,
    SUM(CASE WHEN vote.kind = 'down' THEN 1 ELSE 0 END) AS down_count,
    MAX(CASE WHEN vote.profile_id = ? THEN vote.kind ELSE NULL END) AS viewer_vote
    FROM thread_posts post
    LEFT JOIN thread_post_votes vote ON vote.post_id = post.id
    WHERE post.thread_id = ? GROUP BY post.id`)
    .bind(viewerId ?? "", threadId)
    .all<{ id: string; up_count: number; down_count: number; viewer_vote: ThreadPostVoteKind | null }>();
  return new Map((result.results ?? []).map((row) => {
    const up = Number(row.up_count ?? 0);
    const down = Number(row.down_count ?? 0);
    return [row.id, { up, down, score: up - down, viewerVote: row.viewer_vote ?? null }];
  }));
}

export async function getD1TrustedThreadPostVoteScores(database: D1Database, threadId: string) {
  const trustedBefore = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const settledBefore = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const result = await database.prepare(`SELECT post.id,
    SUM(CASE WHEN vote.kind = 'up' AND voter.joined_at <= ? AND vote.created_at <= ? AND vote.profile_id <> post.author_profile_id THEN 1 ELSE 0 END) -
    SUM(CASE WHEN vote.kind = 'down' AND voter.joined_at <= ? AND vote.created_at <= ? AND vote.profile_id <> post.author_profile_id THEN 1 ELSE 0 END) AS trusted_score
    FROM thread_posts post
    LEFT JOIN thread_post_votes vote ON vote.post_id = post.id
    LEFT JOIN profiles voter ON voter.id = vote.profile_id
    WHERE post.thread_id = ? GROUP BY post.id`)
    .bind(trustedBefore, settledBefore, trustedBefore, settledBefore, threadId)
    .all<{ id: string; trusted_score: number }>();
  return new Map((result.results ?? []).map((row) => [row.id, Number(row.trusted_score ?? 0)]));
}

export async function toggleD1ThreadPostVote(database: D1Database, input: {
  postId: string;
  profileId: string;
  profileJoinedAt: string;
  kind: ThreadPostVoteKind;
}): Promise<ThreadPostVoteSummary> {
  const post = await database.prepare("SELECT author_profile_id FROM thread_posts WHERE id = ? AND deleted_at IS NULL AND moderated_at IS NULL")
    .bind(input.postId).first<{ author_profile_id: string | null }>();
  if (!post) throw new ThreadPostVoteError("レスが見つかりません。");
  if (post.author_profile_id === input.profileId) throw new ThreadPostVoteError("自分のレスは評価できません。");

  const now = new Date();
  const recent = await database.prepare("SELECT count(*) AS total FROM thread_post_votes WHERE profile_id = ? AND updated_at >= ?")
    .bind(input.profileId, new Date(now.getTime() - 10 * 60 * 1000).toISOString())
    .first<{ total: number }>();
  const limit = isNewHubAccount({ joinedAt: input.profileJoinedAt }, now) ? 5 : 30;
  const existing = await database.prepare("SELECT kind FROM thread_post_votes WHERE post_id = ? AND profile_id = ?")
    .bind(input.postId, input.profileId).first<{ kind: ThreadPostVoteKind }>();
  if (!existing && Number(recent?.total ?? 0) >= limit) throw new ThreadPostVoteError("評価が集中しています。しばらく待ってからお試しください。");

  const timestamp = now.toISOString();
  if (existing?.kind === input.kind) {
    await database.prepare("DELETE FROM thread_post_votes WHERE post_id = ? AND profile_id = ?")
      .bind(input.postId, input.profileId).run();
  } else {
    await database.prepare(`INSERT INTO thread_post_votes (post_id, profile_id, kind, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(post_id, profile_id) DO UPDATE SET kind = excluded.kind, updated_at = excluded.updated_at`)
      .bind(input.postId, input.profileId, input.kind, timestamp, timestamp).run();
  }
  const row = await database.prepare(`SELECT
    SUM(CASE WHEN kind = 'up' THEN 1 ELSE 0 END) AS up_count,
    SUM(CASE WHEN kind = 'down' THEN 1 ELSE 0 END) AS down_count,
    MAX(CASE WHEN profile_id = ? THEN kind ELSE NULL END) AS viewer_vote
    FROM thread_post_votes WHERE post_id = ?`).bind(input.profileId, input.postId)
    .first<{ up_count: number; down_count: number; viewer_vote: ThreadPostVoteKind | null }>();
  const up = Number(row?.up_count ?? 0);
  const down = Number(row?.down_count ?? 0);
  return { up, down, score: up - down, viewerVote: row?.viewer_vote ?? null };
}
