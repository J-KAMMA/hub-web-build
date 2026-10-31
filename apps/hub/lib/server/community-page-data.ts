import "server-only";

import type { CommunityRole } from "@/lib/domain";
import { getD1CommunityPageData } from "@/lib/server/d1-community-page-data";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";

export interface CommunitySpace {
  id: string;
  slug: string;
  name: string;
  imageUrl?: string;
  description: string;
  category: string;
  visibility?: "public" | "approval" | "private";
  knowledgeLabel?: string;
  knowledgeDescription?: string;
  ownerProfileId: string;
  createdAt: string;
  joined: boolean;
  pendingMembershipRequest?: boolean;
  viewerRole: CommunityRole | null;
  viewerStatus?: "active" | "muted" | "banned" | null;
  memberIds: string[];
  memberRoles: Record<string, CommunityRole>;
  memberStatuses?: Record<string, "active" | "muted">;
  recentMemberCount: number;
  channels: CommunityChannelView[];
  tokens?: CommunityTokenView[];
  guideDirectories?: CommunityGuideDirectoryView[];
  guides?: CommunityGuidePageView[];
  guideProposals?: CommunityGuideProposalView[];
  governanceMode?: "standard" | "dao";
  governanceVotingStrategy?:
    "one_member_one_vote" | "token_weighted" | "token_capped";
  governanceTokenId?: string | null;
  governanceTokensPerVote?: number;
  governanceTokenRules?: Array<{
    tokenId: string;
    tokenSymbol?: string;
    tokensPerVote: number;
    weight: number;
  }>;
  governanceVoteCap?: number | null;
  governanceProposals?: CommunityGovernanceProposalView[];
}

export interface CommunityGuideDirectoryView {
  id: string;
  parentDirectoryId: string | null;
  slug: string;
  name: string;
  position: number;
}

export interface CommunityGuidePageView {
  id: string;
  directoryId?: string | null;
  slug: string;
  title: string;
  body: string;
  images?: Array<{ id: string; url: string; width: number; height: number; altText: string }>;
  version: number;
  updatedAt: string;
  updatedBy: string;
  verificationStatus?: "unverified" | "verified" | "recheck_required";
  verificationCount?: number;
  gameVersion?: string;
  difficulty?: string;
  dlc?: string;
  modEnvironment?: string;
  sourceUrl?: string;
}

export interface CommunityGuideReviewView {
  id: string;
  authorProfileId: string;
  authorName: string;
  body: string;
  decision: "comment" | "approve" | "request_changes";
  createdAt: string;
}

export interface CommunityGuideProposalView {
  id: string;
  pageId: string | null;
  proposedDirectoryId?: string | null;
  authorProfileId: string;
  authorName: string;
  title: string;
  proposedTitle: string;
  proposedBody: string;
  summary: string;
  status: "open" | "changes_requested" | "merged" | "closed";
  baseVersion: number;
  createdAt: string;
  updatedAt: string;
  reviews: CommunityGuideReviewView[];
}

export interface CommunityGovernanceProposalView {
  id: string;
  authorProfileId: string;
  authorName: string;
  kind: "guide" | "channel" | "rule" | "moderator";
  title: string;
  body: string;
  status:
    "discussion" | "voting" | "passed" | "rejected" | "executed" | "cancelled";
  votingStrategy: "one_member_one_vote" | "token_weighted" | "token_capped";
  votingMethod?: import("@/lib/domain").CommunityGovernanceVotingMethod;
  decisionScope?: import("@/lib/domain").CommunityGovernanceDecisionScope;
  executionMode?: import("@/lib/domain").CommunityGovernanceExecutionMode;
  snapshotPolicy?: "proposal_start" | "seven_day_prior" | "time_weighted";
  snapshotBlockNumber?: string | null;
  snapshotCapturedAt?: string | null;
  quorumMemberBps?: number;
  quorumTokenBps?: number;
  approvalBps?: number;
  governanceTokenId?: string | null;
  governanceTokenSymbol?: string | null;
  tokensPerVote: number;
  governanceTokenRules?: Array<{
    tokenId: string;
    tokenSymbol?: string;
    tokensPerVote: number;
    weight: number;
  }>;
  voteWeightCap?: number | null;
  quorum: number;
  approvalThreshold: number;
  linkedGuideProposalId?: string | null;
  linkedGuideProposalTitle?: string | null;
  votingStartsAt: string;
  votingEndsAt: string;
  createdAt: string;
  updatedAt: string;
  eligibleMemberCount: number;
  eligibilityKnown?: boolean;
  tally: {
    for: number;
    against: number;
    abstain: number;
    voters: number;
    memberFor?: number;
    memberAgainst?: number;
    tokenFor?: number;
    tokenAgainst?: number;
    participatingTokenWeight?: number;
    topTenWeightShare?: number;
  };
  viewerVote?: "for" | "against" | "abstain" | null;
}

export interface CommunityTokenView {
  id: string;
  name: string;
  symbol: string;
  network: string;
  contractAddress?: string;
  totalAmount: number;
  holderCount: number;
  viewerAmount: number;
  holders: Array<{ profileId: string; amount: number }>;
  verifiedAt?: string;
  expiresAt?: string;
  verificationSource?: "development" | "provider";
}

export interface CommunityChannelMessageView {
  id: string;
  authorProfileId: string;
  botId?: string | null;
  botName?: string | null;
  displayName: string;
  handle?: string;
  avatarUrl?: string;
  body: string;
  images?: Array<{ id: string; url: string; width: number; height: number; altText: string }>;
  createdAt: string;
  editedAt?: string | null;
  kind?: "chat" | "guide" | "question" | "party";
  pinned?: boolean;
  pinnedAt?: string | null;
  workflowStatus?: "open" | "resolved" | "closed";
  replyTo?: { id: string; displayName: string; body: string };
  reactions: Array<{
    emoji: "👍" | "❤️" | "🎉";
    count: number;
    reacted: boolean;
  }>;
  engagement?: {
    replyCount: number;
    repostCount?: number;
    quoteRepostCount?: number;
    likeCount: number;
    liked: boolean;
    bookmarked: boolean;
  };
}

export interface CommunityChannelView {
  id: string;
  name: string;
  description: string;
  position: number;
  unreadCount: number;
  messages: CommunityChannelMessageView[];
}

export interface CommunityMember {
  id: string;
  handle: string;
  displayName: string;
  bio: string;
  avatarUrl?: string;
  isCurrentUser: boolean;
}

export interface CommunityBoard {
  key: string;
  title: string;
  description: string;
}

export interface CommunityPageData {
  authenticated: boolean;
  notificationCount: number;
  messageCount: number;
  communities: CommunitySpace[];
  members: CommunityMember[];
  boards: CommunityBoard[];
}

export async function getCommunityPageData(
  options: {
    selectedCommunityRef?: string;
    /** Pass the request viewer when the caller already resolved it. */
    viewer?: import("@/lib/domain").Profile | null;
    /** The caller already has the unread counts (the app shell). */
    skipCounts?: boolean;
  } = {},
): Promise<CommunityPageData> {
  const database = getOptionalHubD1();
  if (database) {
    try {
      const persisted = await getD1CommunityPageData(
        database,
        options.selectedCommunityRef,
        {
          ...(options.viewer !== undefined ? { viewer: options.viewer } : {}),
          ...(options.skipCounts ? { skipCounts: true } : {}),
        },
      );
      if (
        process.env.NODE_ENV !== "development" ||
        persisted.communities.length > 0
      ) {
        return persisted;
      }
    } catch (error) {
      if (process.env.NODE_ENV !== "development") throw error;
    }
  }

  const {
    getBoards,
    getCommunities,
    getCommunityChannelMessages,
    getCommunityChannelReactions,
    getCommunityChannelReadStates,
    getCommunityChannels,
    getCommunityGuideDirectories,
    getCommunityGuidePages,
    getCommunityGuideProposals,
    getCommunityGuideReviews,
    getCommunityGovernanceProposals,
    getCommunityGovernanceVotes,
    getCommunityMemberships,
    getCommunityTokens,
    getEngagementSummary,
    getConversations,
    getCurrentProfile,
    getNotifications,
    getProfiles,
    getTokenBalances,
  } = await import("@/lib/mock-data");
  const currentProfile = getCurrentProfile();
  const notifications = getNotifications();
  const conversations = getConversations();
  const profiles = getProfiles();
  const profileMap = new Map(profiles.map((profile) => [profile.id, profile]));
  const boards = getBoards();
  const memberships = getCommunityMemberships();
  const reactions = getCommunityChannelReactions();
  const readStateMap = new Map(
    getCommunityChannelReadStates(currentProfile.id).map((state) => [
      state.channelId,
      state,
    ]),
  );
  const recentThreshold = Date.now() - 7 * 24 * 60 * 60 * 1000;

  const communities = getCommunities().map((community) => {
    const allCommunityMemberships = memberships.filter(
      (membership) => membership.communityId === community.id,
    );
    const communityMemberships = allCommunityMemberships.filter(
      (membership) => (membership.status ?? "active") !== "banned",
    );
    const viewerMembership = allCommunityMemberships.find(
      (membership) => membership.profileId === currentProfile.id,
    );
    return {
      id: community.id,
      slug: community.slug,
      name: community.name,
      imageUrl: community.imageUrl,
      description: community.description,
      category: community.category,
      knowledgeLabel: community.knowledgeLabel ?? "共同ページ",
      knowledgeDescription:
        community.knowledgeDescription ??
        "コミュニティの知識をディレクトリで整理する共同ページ",
      ownerProfileId: community.ownerProfileId,
      governanceMode: community.governanceMode ?? "standard",
      governanceVotingStrategy:
        community.governanceVotingStrategy ?? "one_member_one_vote",
      governanceTokenId: community.governanceTokenId ?? null,
      governanceTokensPerVote: community.governanceTokensPerVote ?? 1,
      governanceVoteCap: community.governanceVoteCap ?? null,
      createdAt: community.createdAt,
      joined: Boolean(
        viewerMembership && (viewerMembership.status ?? "active") !== "banned",
      ),
      pendingMembershipRequest: false,
      viewerRole: viewerMembership?.role ?? null,
      viewerStatus:
        viewerMembership?.status ?? (viewerMembership ? "active" : null),
      memberIds: communityMemberships.map((membership) => membership.profileId),
      memberRoles: Object.fromEntries(
        communityMemberships.map((membership) => [
          membership.profileId,
          membership.role,
        ]),
      ),
      memberStatuses: Object.fromEntries(
        communityMemberships.map((membership) => [
          membership.profileId,
          membership.status === "muted"
            ? ("muted" as const)
            : ("active" as const),
        ]),
      ),
      recentMemberCount: communityMemberships.filter(
        (membership) =>
          new Date(membership.joinedAt).getTime() >= recentThreshold,
      ).length,
      guideDirectories: getCommunityGuideDirectories(community.id).map(
        (directory) => ({
          id: directory.id,
          parentDirectoryId: directory.parentDirectoryId ?? null,
          slug: directory.slug,
          name: directory.name,
          position: directory.position,
        }),
      ),
      guides: getCommunityGuidePages(community.id).map((page) => ({
        id: page.id,
        directoryId: page.directoryId ?? null,
        slug: page.slug,
        title: page.title,
        body: page.body,
        version: page.version,
        updatedAt: page.updatedAt,
        updatedBy:
          profileMap.get(page.updatedByProfileId)?.displayName ?? "Unknown",
      })),
      guideProposals: getCommunityGuideProposals(community.id).map(
        (proposal) => ({
          id: proposal.id,
          pageId: proposal.pageId,
          proposedDirectoryId: proposal.proposedDirectoryId ?? null,
          authorProfileId: proposal.authorProfileId,
          authorName:
            profileMap.get(proposal.authorProfileId)?.displayName ?? "Unknown",
          title: proposal.title,
          proposedTitle: proposal.proposedTitle,
          proposedBody: proposal.proposedBody,
          summary: proposal.summary,
          status: proposal.status,
          baseVersion: proposal.baseVersion,
          createdAt: proposal.createdAt,
          updatedAt: proposal.updatedAt,
          reviews: getCommunityGuideReviews(proposal.id).map((review) => ({
            id: review.id,
            authorProfileId: review.authorProfileId,
            authorName:
              profileMap.get(review.authorProfileId)?.displayName ?? "Unknown",
            body: review.body,
            decision: review.decision,
            createdAt: review.createdAt,
          })),
        }),
      ),
      governanceProposals: getCommunityGovernanceProposals(community.id).map(
        (proposal) => {
          const votes = getCommunityGovernanceVotes(proposal.id);
          const tallyChoice = (choice: "for" | "against" | "abstain") =>
            votes
              .filter((vote) => vote.choice === choice)
              .reduce((sum, vote) => sum + vote.weight, 0);
          return {
            id: proposal.id,
            authorProfileId: proposal.authorProfileId,
            authorName:
              profileMap.get(proposal.authorProfileId)?.displayName ??
              "Unknown",
            kind: proposal.kind,
            title: proposal.title,
            body: proposal.body,
            status: proposal.status,
            votingStrategy: proposal.votingStrategy,
            governanceTokenId: proposal.governanceTokenId ?? null,
            governanceTokenSymbol: proposal.governanceTokenSymbol ?? null,
            tokensPerVote: proposal.tokensPerVote ?? 1,
            voteWeightCap: proposal.voteWeightCap ?? null,
            quorum: proposal.quorum,
            approvalThreshold: proposal.approvalThreshold,
            linkedGuideProposalId: proposal.linkedGuideProposalId ?? null,
            linkedGuideProposalTitle:
              getCommunityGuideProposals(community.id).find(
                (guideProposal) =>
                  guideProposal.id === proposal.linkedGuideProposalId,
              )?.title ?? null,
            votingStartsAt: proposal.votingStartsAt,
            votingEndsAt: proposal.votingEndsAt,
            createdAt: proposal.createdAt,
            updatedAt: proposal.updatedAt,
            eligibleMemberCount: communityMemberships.length,
            tally: {
              for: tallyChoice("for"),
              against: tallyChoice("against"),
              abstain: tallyChoice("abstain"),
              voters: votes.length,
            },
            viewerVote:
              votes.find((vote) => vote.profileId === currentProfile.id)
                ?.choice ?? null,
          };
        },
      ),
      tokens: getCommunityTokens(community.id).map((token) => {
        const holders = communityMemberships
          .map((membership) => ({
            profileId: membership.profileId,
            amount:
              getTokenBalances(membership.profileId).find(
                (balance) =>
                  balance.symbol.toUpperCase() === token.symbol.toUpperCase() &&
                  (!balance.network ||
                    balance.network.toLocaleLowerCase("en") ===
                      token.network.toLocaleLowerCase("en")) &&
                  (!token.contractAddress ||
                    !balance.contractAddress ||
                    balance.contractAddress.toLocaleLowerCase("en") ===
                      token.contractAddress.toLocaleLowerCase("en")),
              )?.amount ?? 0,
          }))
          .filter((holding) => holding.amount > 0)
          .sort((left, right) => right.amount - left.amount);
        return {
          id: token.id,
          name: token.name,
          symbol: token.symbol,
          network: token.network,
          contractAddress: token.contractAddress,
          totalAmount: holders.reduce(
            (sum, holding) => sum + holding.amount,
            0,
          ),
          holderCount: holders.length,
          viewerAmount:
            holders.find((holding) => holding.profileId === currentProfile.id)
              ?.amount ?? 0,
          holders,
        };
      }),
      channels: getCommunityChannels(community.id).map((channel) => {
        const channelMessages = getCommunityChannelMessages(channel.id);
        const messageMap = new Map(
          channelMessages.map((message) => [message.id, message]),
        );
        const lastReadMessageId = readStateMap.get(
          channel.id,
        )?.lastReadMessageId;
        const lastReadIndex = lastReadMessageId
          ? channelMessages.findIndex(
              (message) => message.id === lastReadMessageId,
            )
          : -1;
        return {
          id: channel.id,
          name: channel.name,
          description: channel.description,
          position: channel.position,
          unreadCount: channelMessages
            .slice(lastReadIndex + 1)
            .filter((message) => message.authorProfileId !== currentProfile.id)
            .length,
          messages: channelMessages.map((message) => {
            const author = profileMap.get(message.authorProfileId);
            const replyTarget = message.replyToMessageId
              ? messageMap.get(message.replyToMessageId)
              : undefined;
            const replyAuthor = replyTarget
              ? profileMap.get(replyTarget.authorProfileId)
              : undefined;
            const messageReactions = reactions.filter(
              (reaction) => reaction.messageId === message.id,
            );
            const engagement = getEngagementSummary(
              "community_message",
              message.id,
              currentProfile.id,
            );
            return {
              id: message.id,
              authorProfileId: message.authorProfileId,
              displayName: author?.displayName ?? "Unknown",
              handle: author?.handle,
              avatarUrl: author?.avatarUrl,
              body: message.body,
              createdAt: message.createdAt,
              editedAt: message.editedAt,
              kind: message.kind ?? "chat",
              pinned: Boolean(message.pinnedAt),
              pinnedAt: message.pinnedAt,
              workflowStatus: message.workflowStatus ?? "open",
              replyTo: replyTarget
                ? {
                    id: replyTarget.id,
                    displayName: replyAuthor?.displayName ?? "Unknown",
                    body: replyTarget.body,
                  }
                : undefined,
              reactions: (["👍", "❤️", "🎉"] as const).flatMap((emoji) => {
                const entries = messageReactions.filter(
                  (reaction) => reaction.emoji === emoji,
                );
                return entries.length
                  ? [
                      {
                        emoji,
                        count: entries.length,
                        reacted: entries.some(
                          (reaction) =>
                            reaction.profileId === currentProfile.id,
                        ),
                      },
                    ]
                  : [];
              }),
              engagement: {
                replyCount: engagement.replyCount,
                repostCount: engagement.repostCount,
                quoteRepostCount: engagement.quoteRepostCount,
                likeCount: engagement.likeCount,
                liked: engagement.viewerReaction === "like",
                bookmarked: engagement.bookmarked,
              },
            };
          }),
        };
      }),
    };
  });

  return {
    authenticated: true,
    notificationCount: notifications.filter(
      (notification) => !notification.isRead,
    ).length,
    messageCount: conversations.reduce(
      (total, conversation) =>
        total + (conversation.unreadCountByProfileId[currentProfile.id] ?? 0),
      0,
    ),
    communities,
    members: profiles.map((profile) => ({
      id: profile.id,
      handle: profile.handle,
      displayName: profile.displayName,
      bio: profile.bio,
      avatarUrl: profile.avatarUrl,
      isCurrentUser: Boolean(profile.isCurrentUser),
    })),
    boards: boards.map((board) => ({
      key: board.key,
      title: board.title,
      description: board.description,
    })),
  };
}
