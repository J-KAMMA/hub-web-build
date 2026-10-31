import "server-only";

import type { D1Database } from "@cloudflare/workers-types";
import { HUBPEDIA_RAIL_ARTICLES } from "@/lib/encyclopedia/hubpedia-rail-catalog";
import { withSocialPostAuthorView } from "@/lib/server/social-post-view";
import { calculateCommunityRankScore, rankCommunities } from "@/lib/community-ranking";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { listD1TokenRankings } from "@/lib/server/d1-token-rankings";
import { listD1TrendingContentTags } from "@/lib/server/d1-content-tags";
import type { AppShellData } from "@/lib/server/app-shell-data";
import type { BbsThreadsListData } from "@/lib/server/bbs-thread-list-data";
import type { Board, SocialPost, ThreadSummary } from "@/lib/domain";

type ThreadRanking = Array<{
  thread: ThreadSummary & { recentPostCount?: number; recentParticipantCount?: number };
  board?: Board;
  momentum: number;
}>;
type SocialRanking = Array<{
  post: SocialPost;
  replyCount: number;
  repostCount?: number;
  likeCount?: number;
  score: number;
}>;
type HubpediaRanking = Array<{ slug: string; title: string; category: string; summary: string; score: number }>;
type TokenRanking = Array<{ id: string; title: string; symbol: string; network: string; holderCount: number; score: number }>;
type CommunityRanking = Array<{ id: string; slug: string; name: string; category: string; memberCount: number; recentMemberCount: number; score: number }>;
type TagRanking = Array<{ name: string; key: string; recentCount: number; totalCount: number; score: number }>;

export interface RankingPageData {
  notificationCount: number;
  messageCount: number;
  threadRanking: ThreadRanking;
  socialRanking: SocialRanking;
  hubpediaRanking: HubpediaRanking;
  tokenRanking: TokenRanking;
  communityRanking: CommunityRanking;
  tagRanking: TagRanking;
}

type CommunityRankingRow = {
  id: string;
  slug: string;
  name: string;
  category: string;
  member_count: number;
  recent_member_count: number;
};

function buildHubpediaRanking(): HubpediaRanking {
  return HUBPEDIA_RAIL_ARTICLES
    .map((article, index) => ({
      slug: article.slug,
      title: article.title,
      category: article.category,
      summary: article.summary,
      score: Math.max(1, HUBPEDIA_RAIL_ARTICLES.length - index),
    }))
    .slice(0, 12);
}

async function getD1RankingPageData(
  database: D1Database,
  shellData: AppShellData,
  threadData: BbsThreadsListData,
): Promise<RankingPageData> {
  const recentThreshold = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const [communityRows, tokenDefinitions, tagRanking] = await Promise.all([
    database.prepare(`SELECT c.id, c.slug, c.name, c.category,
        COUNT(m.profile_id) AS member_count,
        SUM(CASE WHEN m.joined_at >= ? THEN 1 ELSE 0 END) AS recent_member_count
      FROM communities c
      LEFT JOIN community_memberships m ON m.community_id = c.id
      GROUP BY c.id, c.slug, c.name, c.category
      ORDER BY member_count DESC, c.name ASC
      LIMIT 12`)
      .bind(recentThreshold)
      .all<CommunityRankingRow>()
      .then((result) => result.results)
      .catch(() => [] as CommunityRankingRow[]),
    listD1TokenRankings(database).catch(() => []),
    listD1TrendingContentTags(database).catch(() => []),
  ]);

  const communityRanking = rankCommunities(communityRows.map((row) => {
    const memberCount = Number(row.member_count ?? 0);
    const recentMemberCount = Number(row.recent_member_count ?? 0);
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      category: row.category,
      memberCount,
      recentMemberCount,
      score: Number(calculateCommunityRankScore({
        memberCount,
        recentMemberCount,
        recentMessageCount: 0,
        recentActiveMemberCount: 0,
        recentReactionCount: 0,
      }).toFixed(1)),
    };
  }));

  const socialRanking = [...shellData.socialPosts]
    .filter((post) => !post.replyToPostId)
    .sort((left, right) => right.score - left.score || right.createdAt.localeCompare(left.createdAt))
    .slice(0, 12)
    .map((post) => ({
      post,
      replyCount: post.replyCount,
      repostCount: 0,
      likeCount: post.likeCount,
      score: post.score,
    }));

  const threadRanking = [...threadData.threads]
    .sort((left, right) => right.postCount - left.postCount || right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 12)
    .map((thread) => ({
      thread: {
        ...thread,
        recentPostCount: thread.postCount,
        recentParticipantCount: 0,
      },
      momentum: thread.postCount,
    }));

  return {
    notificationCount: shellData.unreadIndicatorCount,
    messageCount: 0,
    threadRanking,
    socialRanking,
    hubpediaRanking: buildHubpediaRanking(),
    tokenRanking: tokenDefinitions
      .map((ranking) => ({
        id: ranking.id,
        title: ranking.title,
        symbol: ranking.symbol,
        network: ranking.network,
        holderCount: ranking.holderCount ?? 0,
        score: (ranking.holderCount ?? 0) * 10,
      }))
      .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title, "ja")),
    communityRanking,
    tagRanking,
  };
}

async function getMockRankingPageData(): Promise<RankingPageData> {
  const {
    getCommunities,
    getCommunityChannelMessages,
    getCommunityChannelReactions,
    getCommunityChannels,
    getCommunityMemberships,
    getConversations,
    getCurrentProfile,
    getNotifications,
    getSocialRanking,
    getTokenRanking,
    getTokenRankings,
    getThreadRanking,
  } = await import("@/lib/mock-data");
  const currentProfile = getCurrentProfile();
  const notifications = getNotifications();
  const conversations = getConversations();
  const memberships = getCommunityMemberships();
  const channels = getCommunityChannels();
  const messages = channels.flatMap((channel) => getCommunityChannelMessages(channel.id));
  const reactions = getCommunityChannelReactions();
  const recentThreshold = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const communityRanking = rankCommunities(getCommunities()
    .map((community) => {
      const communityMemberships = memberships.filter(
        (membership) => membership.communityId === community.id && (membership.status ?? "active") !== "banned"
      );
      const memberCount = communityMemberships.length;
      const recentMemberCount = communityMemberships.filter((membership) => new Date(membership.joinedAt).getTime() >= recentThreshold).length;
      const channelIds = new Set(channels.filter((channel) => channel.communityId === community.id).map((channel) => channel.id));
      const recentMessages = messages.filter(
        (message) => channelIds.has(message.channelId) && new Date(message.createdAt).getTime() >= recentThreshold
      );
      const recentMessageIds = new Set(recentMessages.map((message) => message.id));
      const recentActiveMemberCount = new Set(recentMessages.map((message) => message.authorProfileId)).size;
      const recentReactionCount = reactions.filter(
        (reaction) => recentMessageIds.has(reaction.messageId) && new Date(reaction.createdAt).getTime() >= recentThreshold
      ).length;
      const score = calculateCommunityRankScore({
        memberCount,
        recentMemberCount,
        recentMessageCount: recentMessages.length,
        recentActiveMemberCount,
        recentReactionCount
      });
      return {
        id: community.id,
        slug: community.slug,
        name: community.name,
        category: community.category,
        memberCount,
        recentMemberCount,
        score: Number(score.toFixed(1))
      };
    }));
  const tokenRanking = getTokenRankings()
    .map((ranking) => {
      const holderCount = getTokenRanking(ranking.symbol).filter((entry) => entry.balance > 0).length;
      return { id: ranking.id, title: ranking.title, symbol: ranking.symbol, network: ranking.network, holderCount, score: holderCount * 10 };
    })
    .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title, "ja"));
  const tagCounts = new Map<string, { name: string; count: number }>();
  for (const entry of getSocialRanking()) {
    for (const tag of entry.post.tags ?? []) {
      const key = tag.normalize("NFKC").trim().toLocaleLowerCase("ja");
      if (!key) continue;
      const current = tagCounts.get(key);
      tagCounts.set(key, { name: current?.name ?? tag, count: (current?.count ?? 0) + 1 });
    }
  }
  const tagRanking = [...tagCounts.entries()]
    .map(([key, value]) => ({
      name: value.name,
      key,
      recentCount: value.count,
      totalCount: value.count,
      score: value.count * 4,
    }))
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name, "ja"))
    .slice(0, 12);

  return {
    notificationCount: notifications.filter((item) => !item.isRead).length,
    messageCount: conversations.reduce(
      (total, conversation) => total + (conversation.unreadCountByProfileId[currentProfile.id] ?? 0),
      0
    ),
    threadRanking: getThreadRanking(),
    socialRanking: getSocialRanking().map((entry) => ({
      ...entry,
      post: withSocialPostAuthorView(entry.post)
    })),
    hubpediaRanking: buildHubpediaRanking(),
    tokenRanking,
    communityRanking,
    tagRanking,
  };
}

export async function getRankingPageData(input?: {
  shellData?: AppShellData;
  threadData?: BbsThreadsListData;
}): Promise<RankingPageData> {
  const database = getOptionalHubD1();
  if (database && input?.shellData && input.threadData) {
    return getD1RankingPageData(database, input.shellData, input.threadData);
  }
  return getMockRankingPageData();
}
