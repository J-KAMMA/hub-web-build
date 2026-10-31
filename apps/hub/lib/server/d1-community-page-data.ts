import type { D1Database } from "@cloudflare/workers-types";
import type { Profile } from "@/lib/domain";
import { headers } from "next/headers";

import type {
  CommunityChannelView,
  CommunityGuideDirectoryView,
  CommunityGuidePageView,
  CommunityGuideProposalView,
  CommunityGovernanceProposalView,
  CommunityMember,
  CommunityPageData,
  CommunitySpace,
  CommunityTokenView,
} from "@/lib/server/community-page-data";
import { getOptionalHubSessionProfile } from "@/lib/server/hub-session";
import { publishDueCommunityMessages } from "@/lib/server/d1-community-scheduled";
import { countD1VisibleUnreadNotifications } from "@/lib/server/visible-notification-count";
import { countD1VisibleUnreadMessages } from "@/lib/server/visible-message-count";

type CommunityRow = {
  id: string;
  slug: string;
  name: string;
  image_url: string | null;
  description: string;
  category: string;
  visibility: "public" | "approval" | "private";
  knowledge_label: string;
  knowledge_description: string;
  owner_profile_id: string;
  governance_mode: "standard" | "dao";
  governance_voting_strategy:
    "one_member_one_vote" | "token_weighted" | "token_capped";
  governance_token_id: string | null;
  governance_tokens_per_vote: number;
  governance_vote_cap: number | null;
  created_at: string;
};
type MembershipRow = {
  community_id: string;
  profile_id: string;
  role: "owner" | "moderator" | "member";
  status: "active" | "muted" | "banned";
  joined_at: string;
};
type MembershipRequestRow = { community_id: string };
type ProfileRow = {
  id: string;
  handle: string;
  display_name: string;
  bio: string;
  avatar_url: string | null;
};
type ChannelRow = {
  id: string;
  community_id: string;
  name: string;
  description: string;
  position: number;
};
type MessageRow = {
  id: string;
  channel_id: string;
  author_profile_id: string;
  bot_id: string | null;
  bot_name: string | null;
  body: string;
  created_at: string;
  reply_to_message_id: string | null;
  edited_at: string | null;
  kind: "chat" | "guide" | "question" | "party";
  pinned_at: string | null;
  workflow_status: "open" | "resolved" | "closed";
  reply_count: number;
  repost_count: number;
  quote_repost_count: number;
  like_count: number;
  bookmarked: number;
  viewer_reaction: "like" | null;
};
type ReactionRow = {
  message_id: string;
  profile_id: string;
  emoji: "👍" | "❤️" | "🎉";
};
type ReadStateRow = { channel_id: string; last_read_message_id: string | null };
type GuideDirectoryRow = {
  id: string;
  community_id: string;
  parent_directory_id: string | null;
  slug: string;
  name: string;
  position: number;
};
type GuidePageRow = {
  id: string;
  community_id: string;
  directory_id: string | null;
  slug: string;
  title: string;
  body: string;
  version: number;
  verification_status: "unverified" | "verified" | "recheck_required";
  verification_count: number;
  game_version: string | null;
  difficulty: string | null;
  dlc: string | null;
  mod_environment: string | null;
  source_url: string | null;
  updated_by_profile_id: string;
  updated_at: string;
};
type ProposalRow = {
  id: string;
  community_id: string;
  page_id: string | null;
  proposed_directory_id: string | null;
  author_profile_id: string;
  title: string;
  proposed_title: string;
  proposed_body: string;
  summary: string;
  status: "open" | "changes_requested" | "merged" | "closed";
  base_version: number;
  created_at: string;
  updated_at: string;
};
type ReviewRow = {
  id: string;
  proposal_id: string;
  author_profile_id: string;
  body: string;
  decision: "comment" | "approve" | "request_changes";
  created_at: string;
};
type GovernanceProposalRow = {
  id: string;
  community_id: string;
  author_profile_id: string;
  kind: "guide" | "channel" | "rule" | "moderator";
  title: string;
  body: string;
  status:
    "discussion" | "voting" | "passed" | "rejected" | "executed" | "cancelled";
  voting_strategy: "one_member_one_vote" | "token_weighted" | "token_capped";
  governance_token_id: string | null;
  governance_token_symbol: string | null;
  tokens_per_vote: number;
  vote_weight_cap: number | null;
  quorum: number;
  approval_threshold: number;
  voting_method_v2: NonNullable<CommunityGovernanceProposalView["votingMethod"]>;
  decision_scope: NonNullable<CommunityGovernanceProposalView["decisionScope"]>;
  execution_mode: NonNullable<CommunityGovernanceProposalView["executionMode"]>;
  snapshot_policy: NonNullable<CommunityGovernanceProposalView["snapshotPolicy"]>;
  snapshot_block_number: string | null;
  snapshot_captured_at: string | null;
  quorum_member_bps: number;
  quorum_token_bps: number;
  approval_bps: number;
  linked_guide_proposal_id: string | null;
  voting_starts_at: string;
  voting_ends_at: string;
  created_at: string;
  updated_at: string;
};
type GovernanceVoteRow = {
  proposal_id: string;
  profile_id: string;
  choice: "for" | "against" | "abstain";
  weight: number;
  member_weight: number;
  token_weight: number;
};
type GovernanceTokenRuleRow = {
  community_id: string;
  token_id: string;
  token_symbol: string;
  tokens_per_vote: number;
  weight: number;
  position: number;
};
type GovernanceProposalTokenRuleRow = Omit<
  GovernanceTokenRuleRow,
  "community_id"
> & { proposal_id: string };
type TokenRow = {
  id: string;
  community_id: string;
  name: string;
  symbol: string;
  network: string;
  contract_address: string | null;
};
type BalanceRow = { profile_id: string; symbol: string; amount: number };
type BoardRow = { board_key: string; title: string; description: string };
type CountRow = { total: number };

async function requestFromHeaders() {
  return new Request("http://hub.local/community", {
    headers: await headers(),
  });
}

function groupBy<T>(items: T[], key: (item: T) => string) {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const value = key(item);
    grouped.set(value, [...(grouped.get(value) ?? []), item]);
  }
  return grouped;
}

export async function getD1CommunityPageData(
  database: D1Database,
  selectedCommunityRef?: string,
  options: { viewer?: Profile | null; skipCounts?: boolean } = {},
): Promise<CommunityPageData> {
  await publishDueCommunityMessages(database);
  const viewer = options.viewer === undefined ? await getOptionalHubSessionProfile(
    await requestFromHeaders(),
    database,
  ) : options.viewer;
  const viewerId = viewer?.id ?? null;
  const communityScope = viewerId
    ? `SELECT id FROM communities
       WHERE lifecycle_status = 'active'
         AND visibility IN ('public', 'approval')
       UNION
       SELECT community_id FROM community_memberships
       WHERE profile_id = ? AND status <> 'banned'`
    : `SELECT id FROM communities
       WHERE lifecycle_status = 'active' AND visibility = 'public'`;
  const scoped = (sql: string) => viewerId
    ? database.prepare(sql).bind(...Array(sql.split("?").length - 1).fill(viewerId))
    : database.prepare(sql);
  const channelVisibilityScope = viewerId ? `AND NOT EXISTS (
    SELECT 1 FROM community_member_custom_roles mr
    JOIN community_channel_permissions cp ON cp.role_id = mr.role_id
    WHERE mr.community_id = c.community_id AND mr.profile_id = ? AND cp.channel_id = c.id
    GROUP BY cp.channel_id HAVING MIN(cp.can_view) = 0
  )` : "";
  const viewerEngagementFields = viewerId
    ? `EXISTS(SELECT 1 FROM bookmarks viewer_bookmark WHERE viewer_bookmark.profile_id = ? AND viewer_bookmark.target_type = 'community_message' AND viewer_bookmark.target_id = recent.id) AS bookmarked,
      (SELECT viewer_reaction.kind FROM reactions viewer_reaction WHERE viewer_reaction.profile_id = ? AND viewer_reaction.target_type = 'community_message' AND viewer_reaction.target_id = recent.id AND viewer_reaction.kind = 'like' LIMIT 1) AS viewer_reaction`
    : `0 AS bookmarked, NULL AS viewer_reaction`;
  const visibleCommunityProfileScope = viewerId
    ? `AND NOT EXISTS (
        SELECT 1 FROM profile_moderation_status moderation
        WHERE moderation.profile_id = p.id AND moderation.status = 'suspended'
      )
      AND NOT EXISTS (
        SELECT 1 FROM thread_user_controls control
        WHERE control.blocked = 1
          AND (
            (control.owner_profile_id = ? AND control.target_profile_id = p.id)
            OR (control.owner_profile_id = p.id AND control.target_profile_id = ?)
          )
      )`
    : `AND NOT EXISTS (
        SELECT 1 FROM profile_moderation_status moderation
        WHERE moderation.profile_id = p.id AND moderation.status = 'suspended'
      )`;
  const visibleCommunityMessageScope = viewerId
    ? `AND (
        source.author_profile_id IS NULL
        OR (
          NOT EXISTS (
            SELECT 1 FROM profile_moderation_status moderation
            WHERE moderation.profile_id = source.author_profile_id
              AND moderation.status = 'suspended'
          )
          AND NOT EXISTS (
            SELECT 1 FROM thread_user_controls outgoing_control
            WHERE outgoing_control.owner_profile_id = ?
              AND outgoing_control.target_profile_id = source.author_profile_id
              AND (outgoing_control.muted = 1 OR outgoing_control.blocked = 1)
          )
          AND NOT EXISTS (
            SELECT 1 FROM thread_user_controls incoming_control
            WHERE incoming_control.owner_profile_id = source.author_profile_id
              AND incoming_control.target_profile_id = ?
              AND incoming_control.blocked = 1
          )
        )
      )`
    : `AND (
        source.author_profile_id IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM profile_moderation_status moderation
          WHERE moderation.profile_id = source.author_profile_id
            AND moderation.status = 'suspended'
        )
      )`;
  const communityResult = await scoped(
    `SELECT id, slug, name, image_url, description, category, visibility,
      knowledge_label, knowledge_description,
      owner_profile_id, governance_mode, governance_voting_strategy,
      governance_token_id, governance_tokens_per_vote, governance_vote_cap, created_at
      FROM communities WHERE id IN (${communityScope}) ORDER BY created_at DESC`,
  ).all<CommunityRow>();
  const detailCommunityId = (
    communityResult.results.find(
      (community) =>
        community.id === selectedCommunityRef
        || community.slug === selectedCommunityRef,
    )
    ?? communityResult.results[0]
  )?.id ?? "";
  const detailChannelVisibilityScope = channelVisibilityScope.replaceAll("?", "?2");
  const detailViewerEngagementFields = viewerEngagementFields.replaceAll("?", "?2");
  const detailVisibleCommunityProfileScope =
    visibleCommunityProfileScope.replaceAll("?", "?2");
  const detailVisibleCommunityMessageScope =
    visibleCommunityMessageScope.replaceAll("?", "?2");
  // Token-gated channels: bodies are withheld unless the viewer manages the community
  // or holds a fresh, allowed gate check (access_gate_checks). No RPC is made here;
  // opening the channel (listD1CommunityChannelMessages) refreshes the check.
  const gatedChannelPass = (channelColumn: string) => viewerId
    ? `AND (NOT EXISTS (SELECT 1 FROM content_access_gates cag WHERE cag.target_type = 'channel' AND cag.target_id = ${channelColumn})
        OR EXISTS (SELECT 1 FROM community_memberships gm WHERE gm.community_id = ?1 AND gm.profile_id = ?2 AND gm.status = 'active' AND gm.role IN ('owner', 'moderator'))
        OR EXISTS (SELECT 1 FROM content_access_gates cag
          JOIN access_gates gate ON gate.id = cag.gate_id
          JOIN access_gate_checks chk ON chk.gate_id = gate.id AND chk.gate_version = gate.version
          WHERE cag.target_type = 'channel' AND cag.target_id = ${channelColumn}
            AND chk.profile_id = ?2 AND chk.allowed = 1 AND chk.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')))`
    : `AND NOT EXISTS (SELECT 1 FROM content_access_gates cag WHERE cag.target_type = 'channel' AND cag.target_id = ${channelColumn})`;
  const detailScoped = (sql: string) =>
    viewerId && sql.includes("?2")
      ? database.prepare(sql).bind(detailCommunityId, viewerId)
      : database.prepare(sql).bind(detailCommunityId);

  const [
    membershipResult,
    membershipRequestResult,
    profileResult,
    channelResult,
    messageResult,
    reactionResult,
    readStateResult,
    guideDirectoryResult,
    guidePageResult,
    proposalResult,
    reviewResult,
    governanceProposalResult,
    governanceVoteResult,
    governanceTokenRuleResult,
    governanceProposalTokenRuleResult,
    tokenResult,
    balanceResult,
    boardResult,
    notificationCount,
    messageCount,
  ] = await Promise.all([
    scoped(
        `SELECT community_id, profile_id, role, status, joined_at
      FROM community_memberships WHERE community_id IN (${communityScope}) ORDER BY joined_at`,
      )
      .all<MembershipRow>(),
    viewerId
      ? scoped(`SELECT community_id FROM community_membership_requests
          WHERE profile_id = ? AND status = 'pending'
            AND community_id IN (${communityScope})`)
          .all<MembershipRequestRow>()
      : Promise.resolve({ results: [] as MembershipRequestRow[] }),
    detailScoped(
        `SELECT p.id, p.handle, p.display_name, p.bio, p.avatar_url
      FROM profiles p
      WHERE p.id IN (SELECT profile_id FROM community_memberships WHERE community_id = ?1 AND status <> 'banned')
        ${detailVisibleCommunityProfileScope}
      ORDER BY p.joined_at`,
      )
      .all<ProfileRow>(),
    detailScoped(
        `SELECT c.id, c.community_id, c.name, c.description, c.position
      FROM community_channels c WHERE c.community_id = ?1 ${detailChannelVisibilityScope} ORDER BY c.position, c.created_at`,
      )
      .all<ChannelRow>(),
    detailScoped(
        `SELECT recent.id, recent.channel_id, recent.author_profile_id, recent.body, recent.created_at,
      recent.reply_to_message_id, recent.edited_at, recent.kind, recent.pinned_at,
      recent.workflow_status, recent.bot_id, b.name AS bot_name,
      (SELECT count(*) FROM community_channel_messages reply WHERE reply.reply_to_message_id = recent.id) AS reply_count,
      (SELECT count(*) FROM social_posts repost WHERE repost.repost_of_target_type = 'community_message' AND repost.repost_of_target_id = recent.id) AS repost_count,
      (SELECT count(*) FROM social_posts quote_post WHERE quote_post.quote_of_target_type = 'community_message' AND quote_post.quote_of_target_id = recent.id) AS quote_repost_count,
      (SELECT count(*) FROM reactions reaction WHERE reaction.target_type = 'community_message' AND reaction.target_id = recent.id AND reaction.kind = 'like') AS like_count,
      ${detailViewerEngagementFields}
      FROM (
        SELECT id, channel_id, author_profile_id, body, created_at,
          reply_to_message_id, edited_at, kind, pinned_at, workflow_status, bot_id,
          ROW_NUMBER() OVER (PARTITION BY channel_id ORDER BY created_at DESC, id DESC) AS row_number
        FROM community_channel_messages source
        WHERE source.channel_id IN (SELECT c.id FROM community_channels c WHERE c.community_id = ?1 ${detailChannelVisibilityScope})
          ${detailVisibleCommunityMessageScope}
          ${gatedChannelPass("source.channel_id")}
      ) recent LEFT JOIN community_bots b ON b.id = recent.bot_id
      WHERE row_number <= 50 ORDER BY recent.channel_id, recent.created_at, recent.id`,
      )
      .all<MessageRow>(),
    detailScoped(
        `SELECT message_id, profile_id, emoji
      FROM community_channel_reactions
      WHERE message_id IN (
        SELECT recent.id FROM (
          SELECT message.id,
            ROW_NUMBER() OVER (
              PARTITION BY message.channel_id
              ORDER BY message.created_at DESC, message.id DESC
            ) AS row_number
          FROM community_channel_messages message
          JOIN community_channels channel ON channel.id = message.channel_id
          WHERE channel.community_id = ?1
            ${gatedChannelPass("message.channel_id")}
        ) recent
        WHERE recent.row_number <= 50
      )
      ORDER BY created_at`,
      )
      .all<ReactionRow>(),
    viewerId
      ? database
          .prepare(
            `SELECT state.channel_id, state.last_read_message_id
          FROM community_channel_read_states state
          JOIN community_channels channel ON channel.id = state.channel_id
          WHERE state.profile_id = ? AND channel.community_id = ?`,
          )
          .bind(viewerId, detailCommunityId)
          .all<ReadStateRow>()
      : Promise.resolve({ results: [] as ReadStateRow[] }),
    detailScoped(
        `SELECT id, community_id, parent_directory_id, slug, name, position
      FROM community_guide_directories WHERE community_id = ?1
      ORDER BY parent_directory_id, position, created_at`,
      )
      .all<GuideDirectoryRow>(),
    detailScoped(
      `SELECT id, community_id, directory_id, slug, title, body, version,
      updated_by_profile_id, updated_at, verification_status, verification_count,
      game_version, difficulty, dlc, mod_environment, source_url FROM community_guide_pages WHERE community_id = ?1
      ORDER BY updated_at DESC`,
      )
      .all<GuidePageRow>(),
    detailScoped(
      `SELECT id, community_id, page_id, proposed_directory_id, author_profile_id, title,
      proposed_title, proposed_body, summary, status, base_version, created_at, updated_at
      FROM community_guide_proposals WHERE community_id = ?1 ORDER BY updated_at DESC`,
      )
      .all<ProposalRow>(),
    detailScoped(
        `SELECT id, proposal_id, author_profile_id, body, decision, created_at
      FROM community_guide_reviews WHERE proposal_id IN (SELECT id FROM community_guide_proposals WHERE community_id = ?1) ORDER BY created_at`,
      )
      .all<ReviewRow>(),
    detailScoped(
        `SELECT id, community_id, author_profile_id, kind, title, body, status,
      voting_strategy, governance_token_id, governance_token_symbol,
      tokens_per_vote, vote_weight_cap, quorum, approval_threshold,
      voting_method_v2, decision_scope, execution_mode, snapshot_policy,
      snapshot_block_number, snapshot_captured_at, quorum_member_bps, quorum_token_bps, approval_bps,
      linked_guide_proposal_id,
      voting_starts_at, voting_ends_at, created_at, updated_at
      FROM community_governance_proposals WHERE community_id = ?1 ORDER BY updated_at DESC`,
      )
      .all<GovernanceProposalRow>(),
    detailScoped(
        `SELECT proposal_id, profile_id, choice, weight, member_weight, token_weight
      FROM community_governance_votes WHERE proposal_id IN (SELECT id FROM community_governance_proposals WHERE community_id = ?1) ORDER BY created_at`,
      )
      .all<GovernanceVoteRow>(),
    detailScoped(
        `SELECT r.community_id, r.token_id, t.symbol AS token_symbol,
        r.tokens_per_vote, r.weight, r.position
        FROM community_governance_token_rules r
        JOIN community_tokens t ON t.id = r.token_id WHERE r.community_id = ?1
        ORDER BY r.position`,
      )
      .all<GovernanceTokenRuleRow>(),
    detailScoped(
        `SELECT proposal_id, token_id, token_symbol, tokens_per_vote, weight, position
        FROM community_governance_proposal_token_rules WHERE proposal_id IN (SELECT id FROM community_governance_proposals WHERE community_id = ?1)
        ORDER BY proposal_id, position`,
      )
      .all<GovernanceProposalTokenRuleRow>(),
    detailScoped(
        `SELECT id, community_id, name, symbol, network, contract_address
      FROM community_tokens WHERE community_id = ?1 ORDER BY created_at`,
      )
      .all<TokenRow>(),
    detailScoped(
      `SELECT DISTINCT b.profile_id, b.symbol, b.amount FROM token_balances b
      JOIN community_tokens t ON upper(t.symbol) = upper(b.symbol)
      WHERE b.amount > 0 AND t.community_id = ?1 ORDER BY b.amount DESC`,
      )
      .all<BalanceRow>(),
    database
      .prepare(
        `SELECT board_key, title, description FROM boards
      ORDER BY created_at`,
      )
      .all<BoardRow>(),
    viewerId && !options.skipCounts
      ? countD1VisibleUnreadNotifications(database, viewerId)
      : Promise.resolve(null),
    viewerId && !options.skipCounts
      ? countD1VisibleUnreadMessages(database, viewerId)
      : Promise.resolve(null),
  ]);

  const communities = communityResult.results ?? [];
  const memberships = membershipResult.results ?? [];
  const pendingMembershipRequestIds = new Set(
    (membershipRequestResult.results ?? []).map((request) => request.community_id),
  );
  const profiles = profileResult.results ?? [];
  const channelsByCommunity = groupBy(
    channelResult.results ?? [],
    (row) => row.community_id,
  );
  const messagesByChannel = groupBy(
    messageResult.results ?? [],
    (row) => row.channel_id,
  );
  const reactionsByMessage = groupBy(
    reactionResult.results ?? [],
    (row) => row.message_id,
  );
  const guidesByCommunity = groupBy(
    guidePageResult.results ?? [],
    (row) => row.community_id,
  );
  const guideDirectoriesByCommunity = groupBy(
    guideDirectoryResult.results ?? [],
    (row) => row.community_id,
  );
  const proposalsByCommunity = groupBy(
    proposalResult.results ?? [],
    (row) => row.community_id,
  );
  const reviewsByProposal = groupBy(
    reviewResult.results ?? [],
    (row) => row.proposal_id,
  );
  const governanceProposalsByCommunity = groupBy(
    governanceProposalResult.results ?? [],
    (row) => row.community_id,
  );
  const governanceVotesByProposal = groupBy(
    governanceVoteResult.results ?? [],
    (row) => row.proposal_id,
  );
  const governanceTokenRulesByCommunity = groupBy(
    governanceTokenRuleResult.results ?? [],
    (row) => row.community_id,
  );
  const governanceTokenRulesByProposal = groupBy(
    governanceProposalTokenRuleResult.results ?? [],
    (row) => row.proposal_id,
  );
  const tokensByCommunity = groupBy(
    (tokenResult.results ?? []).filter(
      (row): row is TokenRow =>
        typeof row.community_id === "string" && typeof row.symbol === "string",
    ),
    (row) => row.community_id,
  );
  const balancesBySymbol = groupBy(
    (balanceResult.results ?? []).filter(
      (row): row is BalanceRow => typeof row.symbol === "string" && row.symbol.length > 0,
    ),
    (row) => row.symbol.toUpperCase(),
  );
  const profileMap = new Map(profiles.map((profile) => [profile.id, profile]));
  const readStateMap = new Map(
    (readStateResult.results ?? []).map((state) => [
      state.channel_id,
      state.last_read_message_id,
    ]),
  );
  const recentThreshold = Date.now() - 7 * 24 * 60 * 60 * 1000;

  const communityViews: CommunitySpace[] = communities.map((community) => {
    const allMemberships = memberships.filter(
      (entry) => entry.community_id === community.id,
    );
    const activeMemberships = allMemberships.filter(
      (entry) => entry.status !== "banned",
    );
    const viewerMembership = allMemberships.find(
      (entry) => entry.profile_id === viewerId,
    );
    const guideDirectories: CommunityGuideDirectoryView[] = (
      guideDirectoriesByCommunity.get(community.id) ?? []
    ).map((directory) => ({
      id: directory.id,
      parentDirectoryId: directory.parent_directory_id,
      slug: directory.slug,
      name: directory.name,
      position: Number(directory.position),
    }));
    const guides: CommunityGuidePageView[] = (
      guidesByCommunity.get(community.id) ?? []
    ).map((guide) => ({
      id: guide.id,
      directoryId: guide.directory_id,
      slug: guide.slug,
      title: guide.title,
      body: guide.body,
      version: Number(guide.version),
      updatedAt: guide.updated_at,
      updatedBy:
        profileMap.get(guide.updated_by_profile_id)?.display_name ?? "Unknown",
      verificationStatus: guide.verification_status,
      verificationCount: Number(guide.verification_count),
      gameVersion: guide.game_version ?? undefined,
      difficulty: guide.difficulty ?? undefined,
      dlc: guide.dlc ?? undefined,
      modEnvironment: guide.mod_environment ?? undefined,
      sourceUrl: guide.source_url ?? undefined,
    }));
    const guideProposals: CommunityGuideProposalView[] = (
      proposalsByCommunity.get(community.id) ?? []
    ).map((proposal) => ({
      id: proposal.id,
      pageId: proposal.page_id,
      proposedDirectoryId: proposal.proposed_directory_id,
      authorProfileId: proposal.author_profile_id,
      authorName:
        profileMap.get(proposal.author_profile_id)?.display_name ?? "Unknown",
      title: proposal.title,
      proposedTitle: proposal.proposed_title,
      proposedBody: proposal.proposed_body,
      summary: proposal.summary,
      status: proposal.status,
      baseVersion: Number(proposal.base_version),
      createdAt: proposal.created_at,
      updatedAt: proposal.updated_at,
      reviews: (reviewsByProposal.get(proposal.id) ?? []).map((review) => ({
        id: review.id,
        authorProfileId: review.author_profile_id,
        authorName:
          profileMap.get(review.author_profile_id)?.display_name ?? "Unknown",
        body: review.body,
        decision: review.decision,
        createdAt: review.created_at,
      })),
    }));
    const governanceProposals: CommunityGovernanceProposalView[] = (
      governanceProposalsByCommunity.get(community.id) ?? []
    ).map((proposal) => {
      const votes = governanceVotesByProposal.get(proposal.id) ?? [];
      const tallyChoice = (choice: "for" | "against" | "abstain") =>
        votes
          .filter((vote) => vote.choice === choice)
          .reduce((sum, vote) => sum + Number(vote.weight), 0);
      const chamberChoice = (choice: "for" | "against", chamber: "member_weight" | "token_weight") =>
        votes.filter((vote) => vote.choice === choice).reduce((sum, vote) => sum + Number(vote[chamber] ?? 0), 0);
      const totalWeight = votes.reduce((sum, vote) => sum + Number(vote.weight), 0);
      const topTenWeight = [...votes].sort((left, right) => Number(right.weight) - Number(left.weight))
        .slice(0, 10).reduce((sum, vote) => sum + Number(vote.weight), 0);
      return {
        id: proposal.id,
        authorProfileId: proposal.author_profile_id,
        authorName:
          profileMap.get(proposal.author_profile_id)?.display_name ?? "Unknown",
        kind: proposal.kind,
        title: proposal.title,
        body: proposal.body,
        status: proposal.status,
        votingStrategy: proposal.voting_strategy,
        governanceTokenId: proposal.governance_token_id,
        governanceTokenSymbol: proposal.governance_token_symbol,
        tokensPerVote: Number(proposal.tokens_per_vote),
        governanceTokenRules: (
          governanceTokenRulesByProposal.get(proposal.id) ?? []
        ).map((rule) => ({
          tokenId: rule.token_id,
          tokenSymbol: rule.token_symbol,
          tokensPerVote: Number(rule.tokens_per_vote),
          weight: Number(rule.weight),
        })),
        voteWeightCap:
          proposal.vote_weight_cap === null
            ? null
            : Number(proposal.vote_weight_cap),
        quorum: Number(proposal.quorum),
        approvalThreshold: Number(proposal.approval_threshold),
        votingMethod: proposal.voting_method_v2,
        decisionScope: proposal.decision_scope,
        executionMode: proposal.execution_mode,
        snapshotPolicy: proposal.snapshot_policy,
        snapshotBlockNumber: proposal.snapshot_block_number,
        snapshotCapturedAt: proposal.snapshot_captured_at,
        quorumMemberBps: Number(proposal.quorum_member_bps),
        quorumTokenBps: Number(proposal.quorum_token_bps),
        approvalBps: Number(proposal.approval_bps),
        linkedGuideProposalId: proposal.linked_guide_proposal_id,
        linkedGuideProposalTitle:
          guideProposals.find(
            (guideProposal) =>
              guideProposal.id === proposal.linked_guide_proposal_id,
          )?.title ?? null,
        votingStartsAt: proposal.voting_starts_at,
        votingEndsAt: proposal.voting_ends_at,
        createdAt: proposal.created_at,
        updatedAt: proposal.updated_at,
        eligibleMemberCount: activeMemberships.length,
        tally: {
          for: tallyChoice("for"),
          against: tallyChoice("against"),
          abstain: tallyChoice("abstain"),
          voters: votes.length,
          memberFor: chamberChoice("for", "member_weight"),
          memberAgainst: chamberChoice("against", "member_weight"),
          tokenFor: chamberChoice("for", "token_weight"),
          tokenAgainst: chamberChoice("against", "token_weight"),
          participatingTokenWeight: votes.reduce((sum, vote) => sum + Number(vote.token_weight ?? 0), 0),
          topTenWeightShare: totalWeight > 0 ? Math.round(topTenWeight / totalWeight * 100) : 0,
        },
        viewerVote:
          votes.find((vote) => vote.profile_id === viewerId)?.choice ?? null,
      };
    });
    const tokens: CommunityTokenView[] = (
      tokensByCommunity.get(community.id) ?? []
    ).map((token) => {
      const memberIds = new Set(
        activeMemberships.map((entry) => entry.profile_id),
      );
      const holders = (balancesBySymbol.get(token.symbol.toUpperCase()) ?? [])
        .filter((balance) => memberIds.has(balance.profile_id))
        .map((balance) => ({
          profileId: balance.profile_id,
          amount: Number(balance.amount),
        }));
      return {
        id: token.id,
        name: token.name,
        symbol: token.symbol,
        network: token.network,
        contractAddress: token.contract_address ?? undefined,
        totalAmount: holders.reduce((sum, holder) => sum + holder.amount, 0),
        holderCount: holders.length,
        viewerAmount:
          holders.find((holder) => holder.profileId === viewerId)?.amount ?? 0,
        holders,
      };
    });
    const channels: CommunityChannelView[] = (
      channelsByCommunity.get(community.id) ?? []
    ).map((channel) => {
      const channelMessages = messagesByChannel.get(channel.id) ?? [];
      const messageMap = new Map(
        channelMessages.map((message) => [message.id, message]),
      );
      const lastReadMessageId = readStateMap.get(channel.id);
      const lastReadIndex = lastReadMessageId
        ? channelMessages.findIndex(
            (message) => message.id === lastReadMessageId,
          )
        : -1;
      return {
        id: channel.id,
        name: channel.name,
        description: channel.description,
        position: Number(channel.position),
        unreadCount: viewerId
          ? channelMessages
              .slice(lastReadIndex + 1)
              .filter((message) => message.author_profile_id !== viewerId)
              .length
          : 0,
        messages: channelMessages.map((message) => {
          const author = profileMap.get(message.author_profile_id);
          const replyTarget = message.reply_to_message_id
            ? messageMap.get(message.reply_to_message_id)
            : undefined;
          const replyAuthor = replyTarget
            ? profileMap.get(replyTarget.author_profile_id)
            : undefined;
          const reactions = reactionsByMessage.get(message.id) ?? [];
          return {
            id: message.id,
            authorProfileId: message.author_profile_id,
            botId: message.bot_id,
            botName: message.bot_name,
            displayName: author?.display_name ?? "Unknown",
            handle: author?.handle,
            avatarUrl: author?.avatar_url ?? undefined,
            body: message.body,
            createdAt: message.created_at,
            editedAt: message.edited_at,
            kind: message.kind,
            pinned: Boolean(message.pinned_at),
            pinnedAt: message.pinned_at,
            workflowStatus: message.workflow_status,
            replyTo: replyTarget
              ? {
                  id: replyTarget.id,
                  displayName: replyAuthor?.display_name ?? "Unknown",
                  body: replyTarget.body,
                }
              : undefined,
            reactions: (["👍", "❤️", "🎉"] as const).flatMap((emoji) => {
              const entries = reactions.filter(
                (reaction) => reaction.emoji === emoji,
              );
              return entries.length
                ? [
                    {
                      emoji,
                      count: entries.length,
                      reacted: entries.some(
                        (reaction) => reaction.profile_id === viewerId,
                      ),
                    },
                  ]
                : [];
            }),
            engagement: {
              replyCount: Number(message.reply_count),
              repostCount: Number(message.repost_count),
              quoteRepostCount: Number(message.quote_repost_count),
              likeCount: Number(message.like_count),
              liked: message.viewer_reaction === "like",
              bookmarked: message.bookmarked === 1,
            },
          };
        }),
      };
    });

    return {
      id: community.id,
      slug: community.slug,
      name: community.name,
      imageUrl: community.image_url ?? undefined,
      description: community.description,
      category: community.category,
      visibility: community.visibility,
      knowledgeLabel: community.knowledge_label,
      knowledgeDescription: community.knowledge_description,
      ownerProfileId: community.owner_profile_id,
      governanceMode: community.governance_mode,
      governanceVotingStrategy: community.governance_voting_strategy,
      governanceTokenId: community.governance_token_id,
      governanceTokensPerVote: Number(community.governance_tokens_per_vote),
      governanceTokenRules: (
        governanceTokenRulesByCommunity.get(community.id) ?? []
      ).map((rule) => ({
        tokenId: rule.token_id,
        tokenSymbol: rule.token_symbol,
        tokensPerVote: Number(rule.tokens_per_vote),
        weight: Number(rule.weight),
      })),
      governanceVoteCap:
        community.governance_vote_cap === null
          ? null
          : Number(community.governance_vote_cap),
      createdAt: community.created_at,
      joined: Boolean(viewerMembership && viewerMembership.status !== "banned"),
      pendingMembershipRequest: pendingMembershipRequestIds.has(community.id),
      viewerRole: viewerMembership?.role ?? null,
      viewerStatus: viewerMembership?.status ?? null,
      memberIds: activeMemberships.map((entry) => entry.profile_id),
      memberRoles: Object.fromEntries(
        activeMemberships.map((entry) => [entry.profile_id, entry.role]),
      ),
      memberStatuses: Object.fromEntries(
        activeMemberships.map((entry) => [
          entry.profile_id,
          entry.status === "muted" ? "muted" : "active",
        ]),
      ),
      recentMemberCount: activeMemberships.filter(
        (entry) => Date.parse(entry.joined_at) >= recentThreshold,
      ).length,
      channels,
      guideDirectories,
      guides,
      guideProposals,
      governanceProposals,
      tokens,
    };
  });

  /*
   * メッセージの画像。API の一覧（listD1CommunityChannelMessages）は付けていたが、
   * 最初の描画に使うこの経路は付けておらず、開いた直後だけ画像が無かった
   * （2026-09-02、v2 のコミュニティで判明）。読むのは選んだコミュニティの
   * チャンネルごと最新50件だけなので、80件ずつの問い合わせで収まる。
   */
  const { attachImagesToPosts } = await import("@/lib/server/social-post-images");
  await attachImagesToPosts(
    database,
    communityViews.flatMap((community) => community.channels.flatMap((channel) => channel.messages)),
  );

  const members: CommunityMember[] = profiles.map((profile) => ({
    id: profile.id,
    handle: profile.handle,
    displayName: profile.display_name,
    bio: profile.bio,
    avatarUrl: profile.avatar_url ?? undefined,
    isCurrentUser: profile.id === viewerId,
  }));

  return {
    authenticated: Boolean(viewerId),
    notificationCount: Number(notificationCount ?? 0),
    messageCount: Number(messageCount ?? 0),
    communities: communityViews,
    members,
    boards: (boardResult.results ?? []).map((board) => ({
      key: board.board_key,
      title: board.title,
      description: board.description,
    })),
  };
}
