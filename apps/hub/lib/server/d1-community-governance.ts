import type { D1Database } from "@cloudflare/workers-types";

import type {
  CommunityGovernanceProposal,
  CommunityGovernanceTokenRule,
  CommunityGovernanceVote,
  Profile,
} from "@/lib/domain";
type ProposalRow = {
  id: string;
  community_id: string;
  author_profile_id: string;
  kind: CommunityGovernanceProposal["kind"];
  title: string;
  body: string;
  status: CommunityGovernanceProposal["status"];
  voting_strategy: "one_member_one_vote" | "token_weighted" | "token_capped";
  governance_token_id: string | null;
  governance_token_symbol: string | null;
  tokens_per_vote: number;
  vote_weight_cap: number | null;
  quorum: number;
  approval_threshold: number;
  voting_method_v2: NonNullable<CommunityGovernanceProposal["votingMethod"]>;
  decision_scope: NonNullable<CommunityGovernanceProposal["decisionScope"]>;
  execution_mode: NonNullable<CommunityGovernanceProposal["executionMode"]>;
  snapshot_policy: NonNullable<CommunityGovernanceProposal["snapshotPolicy"]>;
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
  executed_at: string | null;
};
type VoteRow = {
  proposal_id: string;
  profile_id: string;
  choice: CommunityGovernanceVote["choice"];
  weight: number;
  member_weight: number;
  token_weight: number;
  created_at: string;
  updated_at: string;
};
type TokenRuleRow = {
  token_id: string;
  token_symbol?: string;
  tokens_per_vote: number;
  weight: number;
};

function mapTokenRule(row: TokenRuleRow): CommunityGovernanceTokenRule {
  return {
    tokenId: row.token_id,
    tokenSymbol: row.token_symbol,
    tokensPerVote: Number(row.tokens_per_vote),
    weight: Number(row.weight),
  };
}

function mapProposal(row: ProposalRow): CommunityGovernanceProposal {
  return {
    id: row.id,
    communityId: row.community_id,
    authorProfileId: row.author_profile_id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    status: row.status,
    votingStrategy: row.voting_strategy,
    governanceTokenId: row.governance_token_id,
    governanceTokenSymbol: row.governance_token_symbol,
    tokensPerVote: Number(row.tokens_per_vote),
    voteWeightCap:
      row.vote_weight_cap === null ? null : Number(row.vote_weight_cap),
    quorum: Number(row.quorum),
    approvalThreshold: Number(row.approval_threshold),
    votingMethod: row.voting_method_v2,
    decisionScope: row.decision_scope,
    executionMode: row.execution_mode,
    snapshotPolicy: row.snapshot_policy,
    snapshotBlockNumber: row.snapshot_block_number,
    snapshotCapturedAt: row.snapshot_captured_at,
    quorumMemberBps: Number(row.quorum_member_bps),
    quorumTokenBps: Number(row.quorum_token_bps),
    approvalBps: Number(row.approval_bps),
    linkedGuideProposalId: row.linked_guide_proposal_id,
    votingStartsAt: row.voting_starts_at,
    votingEndsAt: row.voting_ends_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    executedAt: row.executed_at,
  };
}

function mapVote(row: VoteRow): CommunityGovernanceVote {
  return {
    proposalId: row.proposal_id,
    profileId: row.profile_id,
    choice: row.choice,
    weight: Number(row.weight),
    memberWeight: Number(row.member_weight ?? 1),
    tokenWeight: Number(row.token_weight ?? 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function updateD1CommunityGovernanceSettings(
  database: D1Database,
  actor: Profile,
  input: {
    communityId: string;
    votingStrategy: "one_member_one_vote" | "token_weighted" | "token_capped";
    governanceTokenId?: string | null;
    tokensPerVote?: number;
    tokenRules?: Array<{
      tokenId: string;
      tokensPerVote: number;
      weight: number;
    }>;
    voteWeightCap?: number | null;
  },
) {
  const {communityId,...payload}=input;
  const {updateCommunityGovernanceSettings}=await import('./community-governance-access');
  return (await updateCommunityGovernanceSettings(database,actor,communityId,payload)).settings;
}

export async function listD1CommunityGovernanceProposals(
  database: D1Database,
  communityId: string,
) {
  const proposals = await database
    .prepare(
      `SELECT id, community_id, author_profile_id, kind, title, body, status,
       voting_strategy, governance_token_id, governance_token_symbol,
       tokens_per_vote, vote_weight_cap, quorum, approval_threshold,
       voting_method_v2, decision_scope, execution_mode, snapshot_policy,
       snapshot_block_number, snapshot_captured_at, quorum_member_bps, quorum_token_bps, approval_bps,
       linked_guide_proposal_id,
       voting_starts_at, voting_ends_at, created_at, updated_at, executed_at
       FROM community_governance_proposals
       WHERE community_id = ? ORDER BY updated_at DESC`,
    )
    .bind(communityId)
    .all<ProposalRow>();
  const mapped = (proposals.results ?? []).map(mapProposal);
  return Promise.all(
    mapped.map(async (proposal) => {
      const rules = await database
        .prepare(
          `SELECT token_id, token_symbol, tokens_per_vote, weight
           FROM community_governance_proposal_token_rules
           WHERE proposal_id = ? ORDER BY position`,
        )
        .bind(proposal.id)
        .all<TokenRuleRow>();
      return {
        ...proposal,
        governanceTokenRules: (rules.results ?? []).map(mapTokenRule),
        votes: await listD1CommunityGovernanceVotes(database, proposal.id),
      };
    }),
  );
}

export async function listD1CommunityGovernanceVotes(
  database: D1Database,
  proposalId: string,
) {
  const result = await database
    .prepare(
      `SELECT proposal_id, profile_id, choice, weight, member_weight, token_weight, created_at, updated_at
       FROM community_governance_votes
       WHERE proposal_id = ? ORDER BY created_at`,
    )
    .bind(proposalId)
    .all<VoteRow>();
  return (result.results ?? []).map(mapVote);
}

export async function createD1CommunityGovernanceProposal(
  database: D1Database,
  actor: Profile,
  input: {
    communityId: string;
    kind: CommunityGovernanceProposal["kind"];
    title: string;
    body: string;
    linkedGuideProposalId?: string | null;
    votingMethod?: NonNullable<CommunityGovernanceProposal["votingMethod"]>;
    decisionScope?: NonNullable<CommunityGovernanceProposal["decisionScope"]>;
    executionMode?: NonNullable<CommunityGovernanceProposal["executionMode"]>;
    snapshotPolicy?: NonNullable<CommunityGovernanceProposal["snapshotPolicy"]>;
    quorumMemberBps?: number;
    quorumTokenBps?: number;
    approvalBps?: number;
  },
) {
  const {communityId,...payload}=input;
  const {createCommunityGovernanceProposal}=await import('./community-governance-create');
  return (await createCommunityGovernanceProposal(database,actor,communityId,payload)).proposal;
}

export async function castD1CommunityGovernanceVote(database:D1Database,actor:Profile,input:{communityId:string;proposalId:string;choice:CommunityGovernanceVote['choice'];operationId?:unknown;snapshot?:unknown}){
  const {communityId,proposalId,...payload}=input;
  const {castCommunityGovernanceVote}=await import('./community-governance-mutations');
  return castCommunityGovernanceVote(database,actor,communityId,proposalId,payload);
}

export async function updateD1CommunityGovernanceProposalLifecycle(database:D1Database,actor:Profile,input:{communityId:string;proposalId:string;action:'start_voting'|'close_voting'|'execute'|'cancel';operationId?:unknown;snapshot?:unknown}){
  const {communityId,proposalId,...payload}=input;
  const {updateCommunityGovernanceLifecycle}=await import('./community-governance-mutations');
  return updateCommunityGovernanceLifecycle(database,actor,communityId,proposalId,payload);
}
