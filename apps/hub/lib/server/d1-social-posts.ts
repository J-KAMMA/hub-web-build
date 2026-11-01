import { musicWorkHref } from "@/lib/music-work-href";
import type { D1Database } from "@cloudflare/workers-types";
import { RepostCooldownError, repostRetryAt } from "@/lib/repost-cooldown";

import type { EngagementTargetType, Profile, SocialIdentityMode, SocialPost } from "@/lib/domain";
import { appendContentShare } from "@/lib/content-share";
import { calculateEngagementScore } from "@/lib/engagement-score";
import { requireNoD1BlockBetween } from "@/lib/server/profile-blocks";
import { createD1SocialNotification } from "@/lib/server/d1-social-notifications";
import { attachImagesToPosts, publishImages, validatePendingImages } from "@/lib/server/social-post-images";
import { inferContentTagSignals } from "@/lib/content-tagging";
import { extractSocialMentionHandles } from "@/lib/social-mentions";
import { attachD1ContentTags, replaceD1ContentTags } from "@/lib/server/d1-content-tags";
import { consumeD1PostQuota } from "@/lib/server/d1-rate-limit";
import type { TimelineCursor } from "@/lib/timeline-cursor";
import { socialStreamTimeSql } from "@/lib/server/social-stream-time";
import { streamTimestamp } from "@/lib/social-stream";
import type { PostReplyOrder } from "@/lib/post-reply-order";
import type { PostReplyCursor } from "@/lib/post-reply-cursor";
import { findVisibleD1SocialTarget } from "@/lib/server/social-target-visibility";
import { calculateFeedRankScore, newAuthorProfileIds, rankPopularFeed } from "@/lib/feed-ranking";
import { rankHubObjects } from "@/lib/platform/hub-object-ranking";
import { DEFAULT_INSTANCE_ORIGIN } from "@/lib/instance-origin";
import { redactGated, redactGatedReferences } from "@/lib/server/gated-content";
import { gatedTargetIds } from "@/lib/server/gated-exits";
import { readVideoCommentContext, requireCommentPolicy, requireVideoGateOpen, type VideoCommentContext } from "@/lib/server/video-comment-access";

export type SocialPostView = SocialPost & { avatarUrl?: string };
type TimelineReference = {
  label: string;
  title: string;
  body: string;
  href: string;
  contextLabel?: string;
  avatarUrl?: string;
  avatarLabel?: string;
};
export type D1TimelinePost = SocialPostView & {
  replyCount: number;
  repostCount: number;
  quoteRepostCount: number;
  likeCount: number;
  score: number;
  bookmarked: boolean;
  viewerReaction: "like" | null;
  viewerRepostId: string | null;
  referenced: TimelineReference | null;
};

type SocialPostRow = {
  id: string;
  author_profile_id: string | null;
  display_name: string;
  handle: string | null;
  identity_mode: SocialIdentityMode;
  body: string;
  created_at: string;
  reply_to_post_id: string | null;
  repost_of_target_type: EngagementTargetType | null;
  repost_of_target_id: string | null;
  quote_of_target_type: EngagementTargetType | null;
  quote_of_target_id: string | null;
  avatar_url: string | null;
};

type TimelinePostRow = SocialPostRow & {
  reply_to_video_id?: string | null;
  reply_to_video_seconds?: number | null;
  reply_to_video_title?: string | null;
  feed_visible?: number | null;
  hidden_by_target_owner_at?: string | null;
  reply_count: number;
  repost_count: number;
  quote_repost_count: number;
  like_count: number;
  bookmark_count: number;
  author_follower_count: number;
  bookmarked: number;
  viewer_reaction: "like" | null;
  viewer_repost_id: string | null;
  popularity_rank: number;
  onboarding_interest_match: number;
  interaction_tag_match: number;
  viewer_follows_author: number;
  viewer_already_engaged: number;
  referenced_id: string | null;
  referenced_type: EngagementTargetType | null;
  referenced_kind: "Quote" | "Repost" | null;
  referenced_author_profile_id: string | null;
  referenced_display_name: string | null;
  referenced_handle: string | null;
  referenced_body: string | null;
  referenced_avatar_url: string | null;
  referenced_thread_id: string | null;
  referenced_post_no: number | null;
  referenced_community_id: string | null;
  referenced_community_slug: string | null;
  referenced_community_name: string | null;
  referenced_community_channel_name: string | null;
  remote_host: string | null;
  remote_handle: string | null;
  remote_actor_url: string | null;
  remote_object_url: string | null;
  imported_published_at: string | null;
  imported_provenance: string | null;
};

export interface CreateD1SocialPostInput {
  body: string;
  clientRequestId?: string | null;
  identityMode?: SocialIdentityMode;
  replyToPostId?: string | null;
  repostOfTargetType?: EngagementTargetType | null;
  repostOfTargetId?: string | null;
  quoteOfTargetType?: EngagementTargetType | null;
  quoteOfTargetId?: string | null;
  imageIds?: string[];
  audience?: "public" | "followers";
  /** 動画へのコメント。動画ID。返信先がコメントなら、その動画を引き継ぐ。 */
  videoId?: string | null;
  /** 動画コメントの再生位置（秒）。 */
  replyToVideoSeconds?: number | null;
  /** 動画コメントをフォロワーのフィードにも出す。既定は出さない。鍵付き動画では常に出さない。 */
  inFeed?: boolean;
  /** 音楽作品ページからのポスト。videoIdとは同時に指定できない。呼び出し側が作品の存在を確かめる。 */
  musicWorkId?: string | null;
}

async function findD1SocialPostByClientRequest(
  database: D1Database,
  authorProfileId: string,
  clientRequestId: string,
): Promise<SocialPostView | null> {
  const row = await database.prepare(`SELECT
      s.id, s.author_profile_id,
      COALESCE(p.display_name, s.display_name) AS display_name,
      COALESCE(p.handle, s.handle) AS handle,
      s.identity_mode, s.body, s.created_at, s.reply_to_post_id,
      s.repost_of_target_type, s.repost_of_target_id,
      s.quote_of_target_type, s.quote_of_target_id,
      p.avatar_url
    FROM social_posts s
    LEFT JOIN profiles p ON p.id = s.author_profile_id
    WHERE s.author_profile_id = ? AND s.client_request_id = ?
    LIMIT 1`)
    .bind(authorProfileId, clientRequestId)
    .first<SocialPostRow>();
  return row ? mapSocialPost(row) : null;
}

/** Actor-local reconciliation; this never creates or republishes a post. */
export async function readD1SocialPostRequest(database: D1Database, authorProfileId: string, clientRequestId: string) {
  const row = await database.prepare(`SELECT
      s.id, s.author_profile_id, s.display_name, s.handle, s.identity_mode, s.body, s.created_at,
      s.reply_to_post_id, s.repost_of_target_type, s.repost_of_target_id,
      s.quote_of_target_type, s.quote_of_target_id, s.audience, p.avatar_url
    FROM social_posts s LEFT JOIN profiles p ON p.id = s.author_profile_id
    WHERE s.author_profile_id = ? AND s.client_request_id = ? LIMIT 1`)
    .bind(authorProfileId, clientRequestId).first<SocialPostRow & { audience: string }>();
  if (!row) return null;
  if (row.audience !== "public" && row.audience !== "followers") throw Error("feed_operation_unavailable");
  const post = mapSocialPost(row);
  await attachD1ContentTags(database, "social_post", [post]);
  await attachImagesToPosts(database, [post]);
  return { ...post, audience: row.audience as "public" | "followers" };
}

function mapSocialPost(row: SocialPostRow): SocialPostView {
  return {
    id: row.id,
    authorProfileId: row.author_profile_id,
    displayName: row.display_name,
    handle: row.handle ?? undefined,
    identityMode: row.identity_mode,
    body: row.body,
    createdAt: row.created_at,
    replyToPostId: row.reply_to_post_id,
    repostOfTargetType: row.repost_of_target_type,
    repostOfTargetId: row.repost_of_target_id,
    quoteOfTargetType: row.quote_of_target_type,
    quoteOfTargetId: row.quote_of_target_id,
    avatarUrl: row.avatar_url ?? undefined
  };
}

function mapTimelineReference(
  row: TimelinePostRow,
  hiddenReferencedAuthorIds: ReadonlySet<string>,
  hiddenReferencedTargetKeys: ReadonlySet<string>,
): TimelineReference | null {
  if (!row.referenced_id || !row.referenced_type || !row.referenced_display_name) return null;
  if (
    hiddenReferencedTargetKeys.has(
      `${row.referenced_type}:${row.referenced_id}`,
    )
  ) return null;
  if (
    row.referenced_author_profile_id
    && hiddenReferencedAuthorIds.has(row.referenced_author_profile_id)
  ) return null;

  const isSocialPost = row.referenced_type === "social_post";
  const isCommunityMessage = row.referenced_type === "community_message";
  if (isCommunityMessage && !row.referenced_community_name) return null;
  const handle = row.referenced_handle ? ` @${row.referenced_handle}` : "";
  const postNumber = row.referenced_post_no ? ` #${row.referenced_post_no}` : "";
  return {
    label: row.referenced_kind ?? "Quote",
    title: `${row.referenced_display_name}${isSocialPost ? handle : postNumber}`,
    body: row.referenced_body ?? "",
    href: isSocialPost
      ? `/posts/${row.referenced_id}`
      : isCommunityMessage
        ? `/community?community=${encodeURIComponent(row.referenced_community_slug ?? row.referenced_community_id ?? "")}`
        : `/threads/${row.referenced_thread_id ?? ""}`,
    contextLabel: isCommunityMessage && row.referenced_community_name
      ? `${row.referenced_community_name}${row.referenced_community_channel_name ? ` · #${row.referenced_community_channel_name}` : ""}`
      : undefined,
    avatarUrl: row.referenced_avatar_url ?? undefined,
    avatarLabel: row.referenced_display_name
  };
}

async function getHiddenReferencedAuthorIds(
  database: D1Database,
  viewerProfileId: string | null,
  authorProfileIds: readonly string[],
): Promise<Set<string>> {
  const uniqueAuthorIds = [...new Set(authorProfileIds.filter(Boolean))];
  if (uniqueAuthorIds.length === 0) return new Set();

  const placeholders = uniqueAuthorIds.map(() => "?").join(", ");
  const viewerId = viewerProfileId ?? "";
  const result = await database.prepare(`SELECT p.id
    FROM profiles p
    WHERE p.id IN (${placeholders})
      AND (
        EXISTS (
          SELECT 1
          FROM profile_moderation_status moderation
          WHERE moderation.profile_id = p.id
            AND moderation.status = 'suspended'
        )
        OR (
          ? <> ''
          AND (
            EXISTS (
              SELECT 1
              FROM thread_user_controls outgoing_control
              WHERE outgoing_control.owner_profile_id = ?
                AND outgoing_control.target_profile_id = p.id
                AND (outgoing_control.muted = 1 OR outgoing_control.blocked = 1)
            )
            OR EXISTS (
              SELECT 1
              FROM thread_user_controls incoming_control
              WHERE incoming_control.owner_profile_id = p.id
                AND incoming_control.target_profile_id = ?
                AND incoming_control.blocked = 1
            )
          )
        )
      )`)
    .bind(...uniqueAuthorIds, viewerId, viewerId, viewerId)
    .all<{ id: string }>();

  return new Set(result.results.map((row) => row.id));
}

export async function listD1SocialPosts(database: D1Database): Promise<SocialPostView[]> {
  const result = await database.prepare(`SELECT
      s.id, s.author_profile_id,
      CASE WHEN s.identity_mode = 'account' THEN COALESCE(p.display_name, s.display_name) ELSE s.display_name END AS display_name,
      CASE WHEN s.identity_mode = 'account' THEN COALESCE(p.handle, s.handle) ELSE NULL END AS handle,
      s.identity_mode, s.body, s.created_at, s.reply_to_post_id,
      s.repost_of_target_type, s.repost_of_target_id,
      s.quote_of_target_type, s.quote_of_target_id,
      CASE WHEN s.identity_mode = 'account' THEN p.avatar_url ELSE NULL END AS avatar_url
    FROM social_posts s
    LEFT JOIN profiles p ON p.id = s.author_profile_id
    WHERE s.moderated_at IS NULL AND s.audience = 'public' AND s.origin = 'local'
      AND (s.author_profile_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM profile_moderation_status moderation
        WHERE moderation.profile_id = s.author_profile_id AND moderation.status = 'suspended'
      ))
    ORDER BY s.created_at DESC
    LIMIT 200`).all<SocialPostRow>();

  const posts = result.results.map(mapSocialPost);
  await attachD1ContentTags(database, "social_post", posts);
  await attachImagesToPosts(database, posts);
  return redactGated(database, null, posts, "post");
}

/*
 * 人気・おすすめの候補は直近N日の投稿に絞る。popularity_rank は候補行ごとに
 * 相関サブクエリを走らせるので、LIMIT の前に idx_social_posts_created で範囲を切る。
 */
export const RANKED_FEED_WINDOW_DAYS = 7;
export const RANKED_FEED_WINDOW_SQL = `s.created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-${RANKED_FEED_WINDOW_DAYS} days')`;

export async function listD1TimelinePosts(
  database: D1Database,
  viewerProfileId: string | null,
  authorProfileId?: string,
  limit = 200,
  offset = 0,
  targetIds?: readonly string[],
  cursor?: TimelineCursor | null,
  feedScope: "all" | "latest" | "following" | "popular" | "recommended" = "all",
  pageScan?: {
    count: number;
    lastCreatedAt: string | null;
    lastId: string | null;
  },
  authorActivity: "all" | "posts" | "replies" = "all",
  utcOrder = false,
  videoId: string | null = null,
  musicWorkId: string | null = null,
  gateContext: "list" | "detail" = "list",
  /** 動画の持ち主が非表示にしたコメントだけを返す（videoId と一緒に。呼び出し側が持ち主を確かめる）。 */
  hiddenOnly = false,
): Promise<D1TimelinePost[]> {
  const normalizedTargetIds = targetIds
    ? [...new Set(targetIds.map((id) => id.trim()).filter(Boolean))].slice(0, 120)
    : undefined;
  if (targetIds && normalizedTargetIds?.length === 0) return [];
  if (feedScope === "following" && !viewerProfileId) return [];
  const viewerId = viewerProfileId ?? "";
  /*
   * 外部から取り込んだ投稿は、一覧（全体・おすすめ・人気）にはフォローしている人の物だけを出す。
   * 投稿の個別ページ・返信の一覧・本人のプロフィールは対象を指定して引くので制限しない。
   */
  const restrictRemote = !authorProfileId && !normalizedTargetIds;
  /*
   * Video comments: the video owner's hidden comments appear nowhere. In general feeds a comment appears only
   * when its author ticked 「フィードにも出す」 and its video is not gated; a page that asks for a specific video,
   * specific posts or one author lists comments regardless of that tick.
   */
  const commentVisibilitySql = `AND s.hidden_by_target_owner_at IS ${hiddenOnly && videoId ? "NOT NULL" : "NULL"}
    ${!videoId && !normalizedTargetIds && !authorProfileId
      ? `AND (s.reply_to_video_id IS NULL OR (s.feed_visible = 1 AND NOT EXISTS (
          SELECT 1 FROM content_access_gates comment_gate WHERE comment_gate.target_type = 'video' AND comment_gate.target_id = s.reply_to_video_id)))`
      : ""}`;
  const activeAuthorFilter = `(s.author_profile_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM profile_moderation_status moderation
    WHERE moderation.profile_id = s.author_profile_id AND moderation.status = 'suspended'
  ))`;
  const visibilityFilter = authorProfileId
    ? `WHERE s.author_profile_id = ?
      AND s.moderated_at IS NULL
      AND ${activeAuthorFilter}
      AND (
        s.audience = 'public'
        OR s.author_profile_id = ?
        OR (
          s.audience = 'followers'
          AND EXISTS (
            SELECT 1 FROM follows audience_follow
            WHERE audience_follow.follower_profile_id = ?
              AND audience_follow.followed_profile_id = s.author_profile_id
          )
        )
      )
      AND (
        ? = ''
        OR (
          NOT EXISTS (
            SELECT 1 FROM thread_user_controls control
            WHERE control.owner_profile_id = ?
              AND control.target_profile_id = s.author_profile_id
              AND (control.muted = 1 OR control.blocked = 1)
          )
          AND NOT EXISTS (
            SELECT 1 FROM thread_user_controls incoming_block
            WHERE incoming_block.owner_profile_id = s.author_profile_id
              AND incoming_block.target_profile_id = ?
              AND incoming_block.blocked = 1
          )
          AND NOT EXISTS (
            SELECT 1 FROM profile_muted_terms mt
            WHERE mt.profile_id = ? AND instr(lower(s.body), lower(mt.term)) > 0
          )
        )
      )`
    : viewerProfileId
      ? `WHERE s.moderated_at IS NULL AND ${activeAuthorFilter} AND (s.audience = 'public' OR s.author_profile_id = ? OR (s.audience = 'followers' AND EXISTS (SELECT 1 FROM follows audience_follow WHERE audience_follow.follower_profile_id = ? AND audience_follow.followed_profile_id = s.author_profile_id))) AND NOT EXISTS (
          SELECT 1
          FROM thread_user_controls control
          WHERE control.owner_profile_id = ?
            AND control.target_profile_id = s.author_profile_id
            AND (control.muted = 1 OR control.blocked = 1)
        ) AND NOT EXISTS (
          SELECT 1
          FROM thread_user_controls incoming_block
          WHERE incoming_block.owner_profile_id = s.author_profile_id
            AND incoming_block.target_profile_id = ?
            AND incoming_block.blocked = 1
        ) AND NOT EXISTS (SELECT 1 FROM profile_muted_terms mt WHERE mt.profile_id = ? AND instr(lower(s.body),lower(mt.term))>0)`
      : `WHERE s.moderated_at IS NULL AND ${activeAuthorFilter} AND s.audience = 'public'`;
  const result = await database.prepare(`SELECT
      s.id, s.author_profile_id,
      CASE WHEN s.identity_mode = 'account' THEN COALESCE(p.display_name, s.display_name) ELSE s.display_name END AS display_name,
      CASE WHEN s.identity_mode = 'account' THEN COALESCE(p.handle, s.handle) ELSE NULL END AS handle,
      s.identity_mode, s.body, s.created_at, s.reply_to_post_id,
      s.repost_of_target_type, s.repost_of_target_id,
      s.quote_of_target_type, s.quote_of_target_id,
      CASE WHEN s.identity_mode = 'account' THEN p.avatar_url ELSE NULL END AS avatar_url,
      (SELECT count(*) FROM social_posts r WHERE r.reply_to_post_id = s.id AND r.moderated_at IS NULL) AS reply_count,
      (SELECT count(*) FROM social_posts r WHERE r.repost_of_target_type = 'social_post' AND r.repost_of_target_id = s.id AND r.moderated_at IS NULL) AS repost_count,
      (SELECT count(*) FROM social_posts r WHERE r.quote_of_target_type = 'social_post' AND r.quote_of_target_id = s.id AND r.moderated_at IS NULL) AS quote_repost_count,
      (SELECT count(*) FROM reactions r WHERE r.target_type = 'social_post' AND r.target_id = s.id AND r.kind = 'like') AS like_count,
      (SELECT count(*) FROM bookmarks b WHERE b.target_type = 'social_post' AND b.target_id = s.id) AS bookmark_count,
      /* Audience size, for the boost that lifts a writer nobody has found yet. */
      (SELECT count(*) FROM follows f WHERE f.followed_profile_id = s.author_profile_id) AS author_follower_count,
      s.reply_to_video_id AS reply_to_video_id, s.reply_to_video_seconds AS reply_to_video_seconds,
      s.feed_visible AS feed_visible, s.hidden_by_target_owner_at AS hidden_by_target_owner_at,
      (SELECT v.title FROM external_videos v WHERE v.id = s.reply_to_video_id) AS reply_to_video_title,
      ${feedScope === "popular" || feedScope === "recommended" ? `      CAST((
        (SELECT count(*) FROM social_posts r WHERE r.reply_to_post_id = s.id AND r.moderated_at IS NULL) * 3
        + (SELECT count(*) FROM social_posts r WHERE r.repost_of_target_type = 'social_post' AND r.repost_of_target_id = s.id AND r.moderated_at IS NULL) * 5
        + (SELECT count(*) FROM social_posts r WHERE r.quote_of_target_type = 'social_post' AND r.quote_of_target_id = s.id AND r.moderated_at IS NULL) * 6
        + (SELECT count(*) FROM reactions r WHERE r.target_type = 'social_post' AND r.target_id = s.id AND r.kind = 'like')
        + (SELECT count(*) FROM bookmarks b WHERE b.target_type = 'social_post' AND b.target_id = s.id) * 4
        + 1
      ) * 1000 / (
        1 + MAX(0, CAST((julianday('now') - julianday(s.created_at)) * 4 AS INTEGER))
      ) AS INTEGER) AS popularity_rank,
      ` : "0 AS popularity_rank,"}
      ${feedScope === "recommended" ? `
      EXISTS (
        SELECT 1
        FROM profile_onboarding onboarding,
             json_each(onboarding.interests_json) interest
        WHERE onboarding.profile_id = ?
          AND (
            EXISTS (
              SELECT 1
              FROM content_tag_links candidate_link
              JOIN content_tags candidate_tag ON candidate_tag.id = candidate_link.tag_id
              WHERE candidate_link.target_type = 'social_post'
                AND candidate_link.target_id = s.id
                AND candidate_link.confidence >= 0.5
                AND candidate_tag.normalized_key = lower(CAST(interest.value AS TEXT))
            )
            OR CASE CAST(interest.value AS TEXT)
              WHEN 'governance' THEN lower(s.body) LIKE '%政治%' OR lower(s.body) LIKE '%法律%' OR lower(s.body) LIKE '%行政%' OR lower(s.body) LIKE '%governance%'
              WHEN 'technology' THEN lower(s.body) LIKE '%技術%' OR lower(s.body) LIKE '%ai%' OR lower(s.body) LIKE '%ソフトウェア%' OR lower(s.body) LIKE '%technology%'
              WHEN 'science' THEN lower(s.body) LIKE '%科学%' OR lower(s.body) LIKE '%自然%' OR lower(s.body) LIKE '%宇宙%' OR lower(s.body) LIKE '%science%'
              WHEN 'culture' THEN lower(s.body) LIKE '%文化%' OR lower(s.body) LIKE '%創作%' OR lower(s.body) LIKE '%映画%' OR lower(s.body) LIKE '%culture%'
              WHEN 'economy' THEN lower(s.body) LIKE '%経済%' OR lower(s.body) LIKE '%仕事%' OR lower(s.body) LIKE '%金融%' OR lower(s.body) LIKE '%economy%'
              WHEN 'community' THEN lower(s.body) LIKE '%地域%' OR lower(s.body) LIKE '%コミュニティ%' OR lower(s.body) LIKE '%community%'
              WHEN 'music' THEN lower(s.body) LIKE '%音楽%' OR lower(s.body) LIKE '%楽曲%' OR lower(s.body) LIKE '%music%'
              WHEN 'games' THEN lower(s.body) LIKE '%動画%' OR lower(s.body) LIKE '%ゲーム%' OR lower(s.body) LIKE '%配信%' OR lower(s.body) LIKE '%game%'
              ELSE 0
            END
          )
      ) AS onboarding_interest_match,
      EXISTS (
        SELECT 1
        FROM content_tag_links candidate_link
        JOIN content_tag_links engaged_link
          ON engaged_link.tag_id = candidate_link.tag_id
         AND engaged_link.target_type = 'social_post'
        WHERE candidate_link.target_type = 'social_post'
          AND candidate_link.target_id = s.id
          AND candidate_link.confidence >= 0.5
          AND engaged_link.confidence >= 0.5
          AND (
            EXISTS (
              SELECT 1 FROM reactions engaged_reaction
              WHERE engaged_reaction.profile_id = ?
                AND engaged_reaction.target_type = 'social_post'
                AND engaged_reaction.target_id = engaged_link.target_id
                AND engaged_reaction.kind = 'like'
            )
            OR EXISTS (
              SELECT 1 FROM bookmarks engaged_bookmark
              WHERE engaged_bookmark.profile_id = ?
                AND engaged_bookmark.target_type = 'social_post'
                AND engaged_bookmark.target_id = engaged_link.target_id
            )
          )
      ) AS interaction_tag_match,
      EXISTS (
        SELECT 1 FROM follows recommendation_follow
        WHERE recommendation_follow.follower_profile_id = ?
          AND recommendation_follow.followed_profile_id = s.author_profile_id
      ) AS viewer_follows_author,
      (
        EXISTS (
          SELECT 1 FROM reactions recommendation_reaction
          WHERE recommendation_reaction.profile_id = ?
            AND recommendation_reaction.target_type = 'social_post'
            AND recommendation_reaction.target_id = s.id
            AND recommendation_reaction.kind = 'like'
        )
        OR EXISTS (
          SELECT 1 FROM bookmarks recommendation_bookmark
          WHERE recommendation_bookmark.profile_id = ?
            AND recommendation_bookmark.target_type = 'social_post'
            AND recommendation_bookmark.target_id = s.id
        )
      ) AS viewer_already_engaged,`
      : `
      0 AS onboarding_interest_match,
      0 AS interaction_tag_match,
      0 AS viewer_follows_author,
      0 AS viewer_already_engaged,`}
      EXISTS(SELECT 1 FROM bookmarks b WHERE b.profile_id = ? AND b.target_type = 'social_post' AND b.target_id = s.id) AS bookmarked,
      (SELECT r.kind FROM reactions r WHERE r.profile_id = ? AND r.target_type = 'social_post' AND r.target_id = s.id AND r.kind = 'like' LIMIT 1) AS viewer_reaction,
      (SELECT viewer_repost.id FROM social_posts viewer_repost
        WHERE viewer_repost.author_profile_id = ?
          AND viewer_repost.repost_of_target_type = 'social_post'
          AND viewer_repost.repost_of_target_id = s.id
          AND viewer_repost.moderated_at IS NULL
        ORDER BY datetime(viewer_repost.created_at) DESC
        LIMIT 1) AS viewer_repost_id,
      COALESCE(s.quote_of_target_id, s.repost_of_target_id) AS referenced_id,
      COALESCE(s.quote_of_target_type, s.repost_of_target_type) AS referenced_type,
      CASE WHEN s.quote_of_target_id IS NOT NULL THEN 'Quote' WHEN s.repost_of_target_id IS NOT NULL THEN 'Repost' END AS referenced_kind,
      CASE
        WHEN COALESCE(s.quote_of_target_type, s.repost_of_target_type) = 'social_post' THEN referenced_social.author_profile_id
        WHEN COALESCE(s.quote_of_target_type, s.repost_of_target_type) = 'thread_post' THEN referenced_thread.author_profile_id
        WHEN COALESCE(s.quote_of_target_type, s.repost_of_target_type) = 'community_message' THEN referenced_community_message.author_profile_id
      END AS referenced_author_profile_id,
      CASE
        WHEN COALESCE(s.quote_of_target_type, s.repost_of_target_type) = 'social_post' THEN
          CASE WHEN referenced_social.identity_mode = 'account' THEN COALESCE(referenced_social_profile.display_name, referenced_social.display_name) ELSE referenced_social.display_name END
        WHEN COALESCE(s.quote_of_target_type, s.repost_of_target_type) = 'thread_post' THEN referenced_thread.display_name
        WHEN COALESCE(s.quote_of_target_type, s.repost_of_target_type) = 'community_message' THEN referenced_community_profile.display_name
      END AS referenced_display_name,
      CASE
        WHEN COALESCE(s.quote_of_target_type, s.repost_of_target_type) = 'social_post' AND referenced_social.identity_mode = 'account' THEN COALESCE(referenced_social_profile.handle, referenced_social.handle)
        WHEN COALESCE(s.quote_of_target_type, s.repost_of_target_type) = 'thread_post' THEN referenced_thread_profile.handle
        WHEN COALESCE(s.quote_of_target_type, s.repost_of_target_type) = 'community_message' THEN referenced_community_profile.handle
      END AS referenced_handle,
      COALESCE(referenced_social.body, referenced_thread.body, referenced_community_message.body) AS referenced_body,
      CASE
        WHEN COALESCE(s.quote_of_target_type, s.repost_of_target_type) = 'social_post' AND referenced_social.identity_mode = 'account' THEN referenced_social_profile.avatar_url
        WHEN COALESCE(s.quote_of_target_type, s.repost_of_target_type) = 'thread_post' THEN referenced_thread_profile.avatar_url
        WHEN COALESCE(s.quote_of_target_type, s.repost_of_target_type) = 'community_message' THEN referenced_community_profile.avatar_url
      END AS referenced_avatar_url,
      referenced_thread.thread_id AS referenced_thread_id,
      referenced_thread.post_no AS referenced_post_no,
      referenced_community_channel.community_id AS referenced_community_id,
      referenced_community.slug AS referenced_community_slug,
      referenced_community.name AS referenced_community_name,
      referenced_community_channel.name AS referenced_community_channel_name,
      remote_author.host AS remote_host,
      remote_author.handle AS remote_handle,
      remote_author.actor_url AS remote_actor_url,
      s.origin_object_id AS remote_object_url,
      imported.original_published_at AS imported_published_at,
      imported.provenance AS imported_provenance
    FROM social_posts s
    LEFT JOIN hub_imported_posts imported ON imported.post_id = s.id
    LEFT JOIN profiles p ON p.id = s.author_profile_id
    LEFT JOIN remote_actor_profiles remote_author ON remote_author.profile_id = s.author_profile_id AND s.origin = 'remote'
    LEFT JOIN social_posts referenced_social
      ON referenced_social.id = COALESCE(s.quote_of_target_id, s.repost_of_target_id)
      AND COALESCE(s.quote_of_target_type, s.repost_of_target_type) = 'social_post'
      AND referenced_social.moderated_at IS NULL
    LEFT JOIN profiles referenced_social_profile ON referenced_social_profile.id = referenced_social.author_profile_id
    LEFT JOIN thread_posts referenced_thread
      ON referenced_thread.id = COALESCE(s.quote_of_target_id, s.repost_of_target_id)
      AND COALESCE(s.quote_of_target_type, s.repost_of_target_type) = 'thread_post'
      AND referenced_thread.deleted_at IS NULL
      AND referenced_thread.moderated_at IS NULL
    LEFT JOIN profiles referenced_thread_profile ON referenced_thread_profile.id = referenced_thread.author_profile_id
    LEFT JOIN community_channel_messages referenced_community_message
      ON referenced_community_message.id = COALESCE(s.quote_of_target_id, s.repost_of_target_id)
      AND COALESCE(s.quote_of_target_type, s.repost_of_target_type) = 'community_message'
    LEFT JOIN profiles referenced_community_profile ON referenced_community_profile.id = referenced_community_message.author_profile_id
    LEFT JOIN community_channels referenced_community_channel ON referenced_community_channel.id = referenced_community_message.channel_id
    LEFT JOIN communities referenced_community
      ON referenced_community.id = referenced_community_channel.community_id
      AND referenced_community.lifecycle_status = 'active'
      AND referenced_community.visibility = 'public'
    ${visibilityFilter}
    ${restrictRemote
      ? `AND (s.origin = 'local' OR EXISTS (
          SELECT 1 FROM follows remote_follow
          WHERE remote_follow.follower_profile_id = ?
            AND remote_follow.followed_profile_id = s.author_profile_id
        ))`
      : ""}
    AND NOT (
      trim(s.body) = ''
      AND s.repost_of_target_id IS NOT NULL
      AND COALESCE(
        referenced_social.id,
        referenced_thread.id,
        CASE WHEN referenced_community.id IS NOT NULL THEN referenced_community_message.id END
      ) IS NULL
    )
    ${normalizedTargetIds
      ? `AND s.id IN (${normalizedTargetIds.map(() => "?").join(", ")})`
      : ""}
    ${videoId ? "AND s.reply_to_video_id = ?" : ""}
    ${commentVisibilitySql}
    ${musicWorkId ? "AND s.id IN (SELECT post_id FROM social_post_music_refs WHERE work_id = ?)" : ""}
    ${authorActivity === "posts"
      ? "AND s.reply_to_post_id IS NULL"
      : authorActivity === "replies"
        ? "AND s.reply_to_post_id IS NOT NULL"
        : ""}
    ${feedScope === "following"
      ? `AND (
          s.author_profile_id = ?
          OR EXISTS (
            SELECT 1 FROM follows feed_follow
            WHERE feed_follow.follower_profile_id = ?
              AND feed_follow.followed_profile_id = s.author_profile_id
          )
        )`
      : ""}
    ${feedScope === "popular" || feedScope === "recommended" ? `AND ${RANKED_FEED_WINDOW_SQL}` : ""}
    ${cursor && feedScope !== "popular" && feedScope !== "recommended"
      ? `AND (
          ${utcOrder ? socialStreamTimeSql('post') : "s.created_at"} < ?
          OR (${utcOrder ? socialStreamTimeSql('post') : "s.created_at"} = ? AND s.id${utcOrder ? " COLLATE BINARY" : ""} < ?)
        )`
      : ""}
    ORDER BY ${feedScope === "popular"
      ? "popularity_rank DESC, s.created_at DESC, s.id DESC"
      : feedScope === "recommended"
        ? `(
            popularity_rank
            + onboarding_interest_match * 12000
            + interaction_tag_match * 9000
            + viewer_follows_author * 4000
            - viewer_already_engaged * 2000
          ) DESC, s.created_at DESC, s.id DESC`
       : utcOrder ? `${socialStreamTimeSql('post')} DESC, s.id COLLATE BINARY DESC` : "s.created_at DESC, s.id DESC"}
    LIMIT ? OFFSET ?`).bind(...(
      [[viewerId, viewerId, viewerId],
        ...(feedScope === "recommended"
          ? [[viewerId, viewerId, viewerId, viewerId, viewerId, viewerId]]
          : []),
        ...(authorProfileId
          ? [[authorProfileId, viewerId, viewerId, viewerId, viewerId, viewerId, viewerId]]
          : viewerProfileId
            ? [[viewerId, viewerId, viewerId, viewerId, viewerId]]
            : []),
        ...(restrictRemote ? [viewerId] : []),
        ...(normalizedTargetIds ?? []),
        ...(videoId ? [videoId] : []),
        ...(musicWorkId ? [musicWorkId] : []),
        ...(feedScope === "following" ? [viewerId, viewerId] : []),
        ...(cursor && feedScope !== "popular" && feedScope !== "recommended" ? [utcOrder ? streamTimestamp(cursor.createdAt) : cursor.createdAt, utcOrder ? streamTimestamp(cursor.createdAt) : cursor.createdAt, cursor.id] : []),
        Math.max(1, Math.min(50, Math.trunc(limit))),
        cursor && feedScope !== "popular" && feedScope !== "recommended" ? 0 : Math.max(0, Math.trunc(offset))]
        .flat()
    )).all<TimelinePostRow>();

  if (pageScan) {
    const lastScanned = result.results.at(-1);
    pageScan.count = result.results.length;
    pageScan.lastCreatedAt = lastScanned?.created_at ?? null;
    pageScan.lastId = lastScanned?.id ?? null;
  }

  const hiddenReferencedAuthorIdsPromise = getHiddenReferencedAuthorIds(
    database,
    viewerProfileId,
    result.results.flatMap((row) => (
      row.referenced_author_profile_id ? [row.referenced_author_profile_id] : []
    )),
  );
  const referencedTargets = [
    ...new Map(
      result.results.flatMap((row) =>
        row.referenced_id && row.referenced_type
          ? [[
              `${row.referenced_type}:${row.referenced_id}`,
              {
                key: `${row.referenced_type}:${row.referenced_id}`,
                type: row.referenced_type,
                id: row.referenced_id,
              },
            ] as const]
          : [],
      ),
    ).values(),
  ];
  const [hiddenReferencedAuthorIds, referencedTargetVisibility] = await Promise.all([
    hiddenReferencedAuthorIdsPromise,
    Promise.all(
    referencedTargets.map(async (target) => ({
      key: target.key,
      visible: Boolean(
        await findVisibleD1SocialTarget(
          database,
          viewerProfileId,
          target.type,
          target.id,
        ),
      ),
    })),
    ),
  ]);
  const hiddenReferencedTargetKeys = new Set(
    referencedTargetVisibility
      .filter((target) => !target.visible)
      .map((target) => target.key),
  );
  const mappedPosts = result.results.flatMap((row) => {
    const post = mapSocialPost(row);
    const likeCount = Number(row.like_count);
    const counts = {
      replyCount: Number(row.reply_count),
      repostCount: Number(row.repost_count),
      quoteRepostCount: Number(row.quote_repost_count),
      likeCount,
      bookmarkCount: Number(row.bookmark_count)
    };
    const referenced = mapTimelineReference(
      row,
      hiddenReferencedAuthorIds,
      hiddenReferencedTargetKeys,
    );
    if (post.repostOfTargetId && !post.quoteOfTargetId && !referenced) {
      return [];
    }
    return [{
      ...post,
      replyCount: counts.replyCount,
      repostCount: counts.repostCount,
      quoteRepostCount: counts.quoteRepostCount,
      likeCount,
      score: calculateEngagementScore(counts),
      bookmarked: row.bookmarked === 1,
      viewerReaction: row.viewer_reaction,
      viewerRepostId: row.viewer_repost_id ?? null,
      authorFollowerCount: Number(row.author_follower_count ?? 0),
      referenced,
      ...(row.reply_to_video_id
        ? {
            replyToVideo: { id: row.reply_to_video_id, title: row.reply_to_video_title ?? "", seconds: row.reply_to_video_seconds ?? null },
            inFeed: Number(row.feed_visible ?? 1) === 1,
            ...(row.hidden_by_target_owner_at ? { hiddenByVideoOwner: true } : {}),
          }
        : {}),
      ...(row.remote_host && row.remote_actor_url
        ? { remote: { host: row.remote_host, handle: row.remote_handle ?? row.remote_host, actorUrl: row.remote_actor_url, objectUrl: row.remote_object_url } }
        : {}),
      ...(row.imported_published_at
        ? { imported: { originalPublishedAt: row.imported_published_at, verified: row.imported_provenance === "verified" } }
        : {}),
    }];
  });
  // Tags, images and reply targets touch disjoint fields, so they load concurrently.
  await Promise.all([
    attachD1ContentTags(database, "social_post", mappedPosts),
    attachImagesToPosts(database, mappedPosts),
    attachD1ReplyToHandles(database, mappedPosts),
  ]);
  // Token gates: strip gated bodies, media and quote previews before ranking or serializing.
  const gatedPosts = await redactGated(database, viewerProfileId, mappedPosts, "post", { context: gateContext });
  const posts = await redactGatedReferences(
    database,
    viewerProfileId,
    gatedPosts,
    new Map(result.results.map((row) => [row.id, row.referenced_type === "social_post" ? row.referenced_id : null])),
  );
  /*
   * The server ranks too, and it knows things the browser does not: who the
   * viewer follows, and how large each author`s audience is. Leaving the
   * signals off here meant the first ordering the reader saw ignored them,
   * and only a client re-rank applied them.
   */
  const newAuthorIds = newAuthorProfileIds(posts);
  const rankSignals = (post: (typeof posts)[number]) => ({
    newAuthor: Boolean(post.authorProfileId && newAuthorIds.has(post.authorProfileId)),
  });
  if (feedScope === "popular") {
    return rankPopularFeed(posts, Date.now(), "balanced", rankSignals);
  }
  if (feedScope === "recommended") {
    const signals = new Map(result.results.map((row) => [row.id, row]));
    return rankHubObjects(
      posts.map((post, index) => {
        const row = signals.get(post.id);
        return {
          ref: { namespace: "hub", kind: "post", id: post.id },
          value: post,
          baseScore: calculateFeedRankScore(post, Date.now(), rankSignals(post)),
          relevance: (Number(row?.onboarding_interest_match) ? 12 : 0)
            + (Number(row?.interaction_tag_match) ? 9 : 0),
          affinity: (Number(row?.viewer_follows_author) ? 4 : 0)
            - (Number(row?.viewer_already_engaged) ? 2 : 0),
          safety: 1,
          stableKey: post.id,
          tieBreakers: [Date.parse(post.createdAt), -index],
          diversityKeys: post.authorProfileId
            ? { author: post.authorProfileId }
            : undefined,
        };
      }),
      {
        surface: "social_feed",
        diversity: {
          author: {
            recentWindow: 1,
            penalty: 0,
            repeatMultiplier: 0.35,
            exposureMultiplier: 0.72,
          },
        },
      },
    ).map((entry) => entry.value);
  }
  return posts;
}

/*
 * 返信の行の「返信先 @handle」。親の投稿を主キーで引き、アカウント名義で
 * 非表示でない親のハンドルだけを付ける（匿名・ゲストの親には付けない）。
 * 本文は読まないので、閲覧条件つきの親でもハンドル以外は出ない。
 */
export async function attachD1ReplyToHandles(
  database: D1Database,
  posts: Array<{ replyToPostId: string | null; replyToHandle?: string }>,
): Promise<void> {
  const parentIds = [...new Set(posts.flatMap((post) => post.replyToPostId ? [post.replyToPostId] : []))];
  if (!parentIds.length) return;
  const handles = new Map<string, string>();
  for (let index = 0; index < parentIds.length; index += 80) {
    const chunk = parentIds.slice(index, index + 80);
    const rows = await database.prepare(`SELECT parent.id, COALESCE(profile.handle, parent.handle) AS handle
      FROM social_posts parent
      LEFT JOIN profiles profile ON profile.id = parent.author_profile_id
      WHERE parent.id IN (${chunk.map(() => "?").join(", ")})
        AND parent.identity_mode = 'account'
        AND parent.moderated_at IS NULL`).bind(...chunk).all<{ id: string; handle: string | null }>();
    for (const row of rows.results ?? []) if (row.handle) handles.set(row.id, row.handle);
  }
  for (const post of posts) {
    const handle = post.replyToPostId ? handles.get(post.replyToPostId) : undefined;
    if (handle) post.replyToHandle = handle;
  }
}

export async function listD1PostRepliesPage(
  database: D1Database,
  viewerProfileId: string | null,
  postId: string,
  order: PostReplyOrder,
  limit: number,
  cursor: PostReplyCursor | null,
) {
  const viewerId = viewerProfileId ?? "";
  const cursorClause = !cursor
    ? ""
    : order === "latest"
      ? `WHERE (
          created_at < ?
          OR (created_at = ? AND id > ?)
        )`
      : order === "oldest"
        ? `WHERE (
            created_at > ?
            OR (created_at = ? AND id > ?)
          )`
        : `WHERE (
            -score, -like_count, -reply_count, created_at, id
          ) > (?, ?, ?, ?, ?)`;
  const ordering = order === "latest"
    ? "created_at DESC, id ASC"
    : order === "oldest"
      ? "created_at ASC, id ASC"
      : "score DESC, like_count DESC, reply_count DESC, created_at ASC, id ASC";
  const viewerFilter = viewerProfileId
    ? `AND (
        source.audience = 'public'
        OR source.author_profile_id = ?
        OR (
          source.audience = 'followers'
          AND EXISTS (
            SELECT 1 FROM follows audience_follow
            WHERE audience_follow.follower_profile_id = ?
              AND audience_follow.followed_profile_id = source.author_profile_id
          )
        )
      )
      AND NOT EXISTS (
        SELECT 1 FROM thread_user_controls control
        WHERE control.owner_profile_id = ?
          AND control.target_profile_id = source.author_profile_id
          AND (control.muted = 1 OR control.blocked = 1)
      )
      AND NOT EXISTS (
        SELECT 1 FROM thread_user_controls incoming_block
        WHERE incoming_block.owner_profile_id = source.author_profile_id
          AND incoming_block.target_profile_id = ?
          AND incoming_block.blocked = 1
      )
      AND NOT EXISTS (
        SELECT 1 FROM profile_muted_terms muted_term
        WHERE muted_term.profile_id = ?
          AND instr(lower(source.body), lower(muted_term.term)) > 0
      )`
    : "AND source.audience = 'public'";
  const cursorBindings = !cursor
    ? []
    : order === "recommended"
      ? [
          -cursor.score,
          -cursor.likeCount,
          -cursor.replyCount,
          cursor.createdAt,
          cursor.id,
        ]
      : [cursor.createdAt, cursor.createdAt, cursor.id];
  const pageSize = Math.max(1, Math.min(50, Math.trunc(limit)));
  const result = await database.prepare(`WITH reply_metrics AS (
      SELECT source.id, source.created_at,
        (SELECT count(*) FROM reactions reaction
          WHERE reaction.target_type = 'social_post'
            AND reaction.target_id = source.id
            AND reaction.kind = 'like') AS like_count,
        (SELECT count(*) FROM social_posts reply
          WHERE reply.reply_to_post_id = source.id
            AND reply.moderated_at IS NULL) AS reply_count,
        (SELECT count(*) FROM social_posts repost
          WHERE repost.repost_of_target_type = 'social_post'
            AND repost.repost_of_target_id = source.id
            AND repost.moderated_at IS NULL) AS repost_count,
        (SELECT count(*) FROM social_posts quote
          WHERE quote.quote_of_target_type = 'social_post'
            AND quote.quote_of_target_id = source.id
            AND quote.moderated_at IS NULL) AS quote_count,
        (SELECT count(*) FROM bookmarks bookmark
          WHERE bookmark.target_type = 'social_post'
            AND bookmark.target_id = source.id) AS bookmark_count
      FROM social_posts source
      WHERE source.reply_to_post_id = ?
        AND source.moderated_at IS NULL
        AND (
          source.author_profile_id IS NULL
          OR NOT EXISTS (
            SELECT 1 FROM profile_moderation_status moderation
            WHERE moderation.profile_id = source.author_profile_id
              AND moderation.status = 'suspended'
          )
        )
        ${viewerFilter}
    ), ranked_replies AS (
      SELECT *,
        reply_count * 3
          + repost_count * 5
          + quote_count * 6
          + like_count
          + bookmark_count * 4 AS score
      FROM reply_metrics
    )
    SELECT id, created_at, score, like_count, reply_count
    FROM ranked_replies
    ${cursorClause}
    ORDER BY ${ordering}
    LIMIT ?`)
    .bind(
      postId,
      ...(viewerProfileId
        ? [viewerId, viewerId, viewerId, viewerId, viewerId]
        : []),
      ...cursorBindings,
      pageSize + 1,
    )
    .all<{
      id: string;
      created_at: string;
      score: number;
      like_count: number;
      reply_count: number;
    }>();

  const pageRows = result.results.slice(0, pageSize);
  const posts = await listD1TimelinePosts(
    database,
    viewerProfileId,
    undefined,
    pageSize,
    0,
    pageRows.map((row) => row.id),
  );
  const postsById = new Map(posts.map((post) => [post.id, post]));

  return {
    replies: pageRows.flatMap((row) => {
      const post = postsById.get(row.id);
      return post ? [post] : [];
    }),
    hasMore: result.results.length > pageSize,
  };
}

async function targetExists(
  database: D1Database,
  viewerProfileId: string,
  targetType: EngagementTargetType,
  targetId: string
): Promise<boolean> {
  if (targetType === "community_message") {
    const publicMessage = await database.prepare(`SELECT message.id
      FROM community_channel_messages message
      JOIN community_channels channel ON channel.id = message.channel_id
      JOIN communities community ON community.id = channel.community_id
      WHERE message.id = ?
        AND community.lifecycle_status = 'active'
        AND community.visibility = 'public'
      LIMIT 1`)
      .bind(targetId)
      .first<{ id: string }>();
    return Boolean(publicMessage);
  }
  return Boolean(
    await findVisibleD1SocialTarget(
      database,
      viewerProfileId,
      targetType,
      targetId,
    ),
  );
}

async function targetAuthorProfileId(
  database: D1Database,
  targetType: EngagementTargetType,
  targetId: string,
) {
  if (targetType === "vault_content") return null;
  const table = targetType === "social_post"
    ? "social_posts"
    : targetType === "thread_post"
      ? "thread_posts"
      : "community_channel_messages";
  const row = await database.prepare(`SELECT author_profile_id FROM ${table} WHERE id = ? LIMIT 1`)
    .bind(targetId).first<{ author_profile_id: string | null }>();
  return row?.author_profile_id ?? null;
}

export class SocialPostVideoNotFoundError extends Error {
  constructor() {
    super("video_not_found");
    this.name = "SocialPostVideoNotFoundError";
  }
}

export class SocialPostLinkConflictError extends Error {
  constructor() {
    super("post_link_conflict");
    this.name = "SocialPostLinkConflictError";
  }
}

/** 音楽作品ポスト本文に作品ページのリンクを足す。上限を超えるなら content_share_full。 */
function withMusicLink(body: string, workId: string): string {
  const origin = new URL(process.env.HUB_PUBLIC_ORIGIN ?? DEFAULT_INSTANCE_ORIGIN).origin;
  return appendContentShare(body, musicWorkHref(workId), origin);
}

function clampVideoSeconds(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(604800, Math.trunc(value))) : null;
}

export async function createD1SocialPost(
  database: D1Database,
  viewer: Profile,
  input: CreateD1SocialPostInput
): Promise<SocialPostView> {
  const identityMode = input.identityMode ?? "account";
  const repostType = input.repostOfTargetType ?? null;
  const repostId = input.repostOfTargetId ?? null;
  const quoteType = input.quoteOfTargetType ?? null;
  const quoteId = input.quoteOfTargetId ?? null;
  const imageIds = input.imageIds ?? [];
  const clientRequestId = input.clientRequestId?.trim() || null;
  const createdAt = new Date().toISOString();
  let videoId = input.videoId?.trim() || null;
  const musicWorkId = input.musicWorkId?.trim() || null;
  if (videoId && musicWorkId) throw new SocialPostLinkConflictError();
  if (input.replyToPostId && !musicWorkId) {
    // A reply to a video comment is a comment of the same video.
    const parent = await database.prepare("SELECT reply_to_video_id AS videoId FROM social_posts WHERE id = ? LIMIT 1")
      .bind(input.replyToPostId).first<{ videoId: string | null }>();
    if (parent?.videoId) {
      if (videoId && videoId !== parent.videoId) throw new SocialPostLinkConflictError();
      videoId = parent.videoId;
    } else if (videoId) {
      // Replying to a post that is not a comment of this video from the video page is not allowed.
      throw new SocialPostLinkConflictError();
    }
  }

  if (clientRequestId) {
    const existing = await findD1SocialPostByClientRequest(database, viewer.id, clientRequestId);
    if (existing) {
      await attachD1ContentTags(database, "social_post", [existing]);
      await attachImagesToPosts(database, [existing]);
      return existing;
    }
  }
  let videoContext: VideoCommentContext | null = null;
  if (videoId) {
    videoContext = await readVideoCommentContext(database, videoId);
    if (!videoContext) throw new SocialPostVideoNotFoundError();
  }
  // The gate and the owner's comment policy are checked before anything is written (replies inherit both).
  const videoGate = videoId ? await requireVideoGateOpen(database, viewer.id, videoId) : null;
  if (videoId && videoContext) {
    await requireCommentPolicy(database, viewer.id, videoContext);
    if (videoContext.ownerProfileId) await requireNoD1BlockBetween(database, viewer.id, videoContext.ownerProfileId);
    if (input.replyToPostId) {
      const hidden = await database.prepare("SELECT 1 AS hidden FROM social_posts WHERE id = ? AND hidden_by_target_owner_at IS NOT NULL LIMIT 1")
        .bind(input.replyToPostId).first<{ hidden: number }>();
      if (hidden) throw new Error("Reply target does not exist.");
    }
  }
  const postBody = musicWorkId ? withMusicLink(input.body, musicWorkId) : input.body;
  await validatePendingImages(database, viewer.id, imageIds);

  if ((repostType && !repostId) || (!repostType && repostId) || (quoteType && !quoteId) || (!quoteType && quoteId)) {
    throw new Error("Post target is incomplete.");
  }
  // Blocking removes follows, so identify a blocked interaction before the
  // target becomes invisible through its followers-only audience.
  const interactionTargets: Array<[EngagementTargetType, string]> = [];
  if (input.replyToPostId) interactionTargets.push(["social_post", input.replyToPostId]);
  if (repostType && repostId) interactionTargets.push([repostType, repostId]);
  if (quoteType && quoteId) interactionTargets.push([quoteType, quoteId]);
  for (const [targetType, targetId] of interactionTargets) {
    await requireNoD1BlockBetween(
      database,
      viewer.id,
      await targetAuthorProfileId(database, targetType, targetId),
    );
  }
  if (input.replyToPostId && !(await targetExists(database, viewer.id, "social_post", input.replyToPostId))) {
    throw new Error("Reply target does not exist.");
  }
  if (repostType && repostId && !(await targetExists(database, viewer.id, repostType, repostId))) {
    throw new Error("Repost target does not exist.");
  }
  // A gated post (its own gate or its video's) is never reposted: the repost would carry it into feeds.
  if (repostType === "social_post" && repostId && (await gatedTargetIds(database, "post", [repostId])).has(repostId)) {
    throw new Error("Repost target does not exist.");
  }
  if (quoteType && quoteId && !(await targetExists(database, viewer.id, quoteType, quoteId))) {
    throw new Error("Quote target does not exist.");
  }

  if (repostType && repostId) {
    const recent = await database.prepare(`SELECT created_at FROM social_posts
      WHERE author_profile_id = ? AND repost_of_target_type = ? AND repost_of_target_id = ?
        AND datetime(created_at) > datetime(?, '-24 hours')
      ORDER BY datetime(created_at) DESC LIMIT 1`)
      .bind(viewer.id, repostType, repostId, createdAt)
      .first<{ created_at: string }>();
    if (recent?.created_at) throw new RepostCooldownError(repostRetryAt(recent.created_at));
  }

  await consumeD1PostQuota(database, viewer, "social_post", new Date(createdAt));

  const isAccount = identityMode === "account";
  const post: SocialPostView = {
    id: crypto.randomUUID(),
    authorProfileId: isAccount ? viewer.id : null,
    displayName: isAccount ? viewer.displayName : identityMode === "guest" ? "Guest" : "Anonymous",
    handle: isAccount ? viewer.handle : undefined,
    identityMode,
    body: postBody,
    createdAt,
    replyToPostId: input.replyToPostId ?? null,
    repostOfTargetType: repostType,
    repostOfTargetId: repostId,
    quoteOfTargetType: quoteType,
    quoteOfTargetId: quoteId,
    avatarUrl: isAccount ? viewer.avatarUrl : undefined
  };

  try {
    const insertPost = database.prepare(`INSERT INTO social_posts (
        id, author_profile_id, display_name, handle, identity_mode, body, created_at,
        reply_to_post_id, repost_of_target_type, repost_of_target_id,
        quote_of_target_type, quote_of_target_id, audience, client_request_id,
        reply_to_video_id, reply_to_video_seconds, feed_visible
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        post.id, post.authorProfileId, post.displayName, post.handle ?? null, post.identityMode,
        post.body, post.createdAt, post.replyToPostId, repostType, repostId, quoteType, quoteId, input.audience ?? "public", clientRequestId,
        videoId, videoId ? clampVideoSeconds(input.replyToVideoSeconds) : null,
        // A comment enters followers' feeds only when asked, and never while its video is gated.
        videoId ? (input.inFeed === true && !videoGate?.gated ? 1 : 0) : 1
      );
    if (musicWorkId) {
      await database.batch([
        insertPost,
        database.prepare(`INSERT INTO social_post_music_refs (post_id, work_id, created_at) VALUES (?, ?, ?)`)
          .bind(post.id, musicWorkId, post.createdAt),
      ]);
    } else {
      await insertPost.run();
    }
  } catch (error) {
    if (clientRequestId) {
      const existing = await findD1SocialPostByClientRequest(database, viewer.id, clientRequestId);
      if (existing) {
        await attachD1ContentTags(database, "social_post", [existing]);
        await attachImagesToPosts(database, [existing]);
        return existing;
      }
    }
    if (repostType && repostId) {
      const concurrent = await database.prepare(`SELECT created_at FROM social_posts
        WHERE author_profile_id = ? AND repost_of_target_type = ? AND repost_of_target_id = ?
          AND datetime(created_at) > datetime(?, '-24 hours')
        ORDER BY datetime(created_at) DESC LIMIT 1`)
        .bind(viewer.id, repostType, repostId, createdAt)
        .first<{ created_at: string }>();
      if (concurrent?.created_at) {
        throw new RepostCooldownError(repostRetryAt(concurrent.created_at));
      }
    }
    throw error;
  }

  post.tags = await replaceD1ContentTags(database, "social_post", post.id, inferContentTagSignals({
    target: "social_post",
    body: post.body,
    destination: input.audience ?? "public",
    attachmentTypes: imageIds.length ? ["画像"] : [],
  }));
  await publishImages(database, viewer.id, post.id, imageIds);
  if (imageIds.length) {
    await attachImagesToPosts(database, [post]);
  }

  const conversationRecipients = new Map<string, "reply" | "mention" | "video">();
  if (input.replyToPostId) {
    const ownerId = await targetAuthorProfileId(database, "social_post", input.replyToPostId);
    if (ownerId) conversationRecipients.set(ownerId, "reply");
  }
  // The Hub video's owner hears about comments. External videos have no owner, so nobody is told.
  if (videoContext?.ownerProfileId && !conversationRecipients.has(videoContext.ownerProfileId)) {
    conversationRecipients.set(videoContext.ownerProfileId, "video");
  }
  const mentionedHandles = extractSocialMentionHandles(post.body);
  if (mentionedHandles.length) {
    const placeholders = mentionedHandles.map(() => "?").join(", ");
    const mentionedProfiles = await database.prepare(
      `SELECT id FROM profiles WHERE lower(handle) IN (${placeholders})`,
    ).bind(...mentionedHandles).all<{ id: string }>();
    for (const profile of mentionedProfiles.results) {
      if (!conversationRecipients.has(profile.id)) {
        conversationRecipients.set(profile.id, "mention");
      }
    }
  }
  await Promise.all([...conversationRecipients].map(([receiverProfileId, kind]) =>
    createD1SocialNotification(database, {
      receiverProfileId,
      actorProfileId: viewer.id,
      type: "social_reply",
      context: kind === "mention" ? "mention" : undefined,
      targetType: "social_post",
      targetId: post.id,
      text: kind === "reply"
        ? "ポストに返信がありました。"
        : kind === "video"
          ? "動画にコメントがありました。"
          : "ポストでメンションされました。",
      preference: "replies",
      createdAt: post.createdAt,
    }),
  ));

  const sharedTargetType = quoteType ?? repostType;
  const sharedTargetId = quoteId ?? repostId;
  if (sharedTargetType && sharedTargetId) {
    const ownerId = await targetAuthorProfileId(
      database,
      sharedTargetType,
      sharedTargetId,
    );
    if (ownerId) {
      await createD1SocialNotification(database, {
        receiverProfileId: ownerId,
        actorProfileId: viewer.id,
        type: "social_repost",
        targetType: "social_post",
        targetId: post.id,
        text: quoteId
          ? "ポストが引用リポストされました。"
          : "ポストがリポストされました。",
        preference: "reactions",
        createdAt: post.createdAt,
      });
    }
  }

  return post;
}
