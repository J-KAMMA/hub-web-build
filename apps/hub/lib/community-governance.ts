import type { CommunityGovernanceProposal } from "@/lib/domain";

export function calculateGovernanceVotingPower(input: {
  method: NonNullable<CommunityGovernanceProposal["votingMethod"]>;
  tokenBalance: number;
  tokensPerVote?: number;
  voteWeightCap?: number | null;
}) {
  if (input.method === "one_member_one_vote") return { memberWeight: 1, tokenWeight: 0, weight: 1 };
  const balance = Number.isFinite(input.tokenBalance) ? Math.max(0, input.tokenBalance) : 0;
  const unit = Number.isFinite(input.tokensPerVote) && Number(input.tokensPerVote) > 0
    ? Number(input.tokensPerVote)
    : 1;
  const normalized = balance / unit;
  let tokenWeight = input.method === "one_holder_one_vote"
    ? (normalized > 0 ? 1 : 0)
    : input.method === "token_sqrt"
      ? Math.floor(Math.sqrt(normalized))
      : input.method === "token_log"
        ? Math.floor(Math.log2(normalized + 1))
        : Math.floor(normalized);
  if (input.voteWeightCap) tokenWeight = Math.min(tokenWeight, Math.max(1, Math.floor(input.voteWeightCap)));
  const memberWeight = input.method === "dual_chamber" ? 1 : 0;
  return { memberWeight, tokenWeight, weight: input.method === "dual_chamber" ? Math.max(1, tokenWeight) : tokenWeight };
}

export function validateGovernanceProposalPolicy(input: {
  kind: CommunityGovernanceProposal["kind"];
  votingMethod: NonNullable<CommunityGovernanceProposal["votingMethod"]>;
  decisionScope: NonNullable<CommunityGovernanceProposal["decisionScope"]>;
  executionMode: NonNullable<CommunityGovernanceProposal["executionMode"]>;
}) {
  if (input.decisionScope === "hub_policy" || input.decisionScope === "security") {
    throw new Error("Hub共通規約とセキュリティ対応はコミュニティ投票では変更できません。");
  }
  if (input.decisionScope === "moderation" || input.kind === "moderator") {
    if (input.votingMethod !== "one_member_one_vote" || input.executionMode !== "advisory") {
      throw new Error("個人への処分・管理権限はトークン投票や自動執行の対象にできません。");
    }
  }
}

export function resolveDualChamberGovernanceResult(input: {
  votes: Array<{ choice: "for" | "against" | "abstain"; memberWeight: number; tokenWeight: number }>;
  eligibleMembers: number;
  eligibleTokenWeight: number;
  quorumMemberBps: number;
  quorumTokenBps: number;
  approvalBps: number;
}) {
  const decisive = input.votes.filter((vote) => vote.choice !== "abstain");
  const memberFor = decisive.filter((vote) => vote.choice === "for").reduce((sum, vote) => sum + vote.memberWeight, 0);
  const memberAgainst = decisive.filter((vote) => vote.choice === "against").reduce((sum, vote) => sum + vote.memberWeight, 0);
  const tokenFor = decisive.filter((vote) => vote.choice === "for").reduce((sum, vote) => sum + vote.tokenWeight, 0);
  const tokenAgainst = decisive.filter((vote) => vote.choice === "against").reduce((sum, vote) => sum + vote.tokenWeight, 0);
  const memberParticipation = input.votes.reduce((sum, vote) => sum + vote.memberWeight, 0);
  const tokenParticipation = input.votes.reduce((sum, vote) => sum + vote.tokenWeight, 0);
  const memberQuorum = memberParticipation * 10000 >= input.eligibleMembers * input.quorumMemberBps;
  const tokenQuorum = input.quorumTokenBps === 0 || tokenParticipation * 10000 >= input.eligibleTokenWeight * input.quorumTokenBps;
  const memberApproved = memberFor * 10000 >= Math.max(1, memberFor + memberAgainst) * input.approvalBps;
  const tokenApproved = tokenFor * 10000 >= Math.max(1, tokenFor + tokenAgainst) * input.approvalBps;
  return memberQuorum && tokenQuorum && memberApproved && tokenApproved ? "passed" as const : "rejected" as const;
}

export function calculateGovernanceVoteWeight(input: {
  strategy: CommunityGovernanceProposal["votingStrategy"];
  balance: number;
  tokensPerVote: number;
  voteWeightCap?: number | null;
}) {
  if (input.strategy === "one_member_one_vote") return 1;
  if (
    !Number.isFinite(input.balance) ||
    input.balance <= 0 ||
    !Number.isFinite(input.tokensPerVote) ||
    input.tokensPerVote <= 0
  ) {
    return 0;
  }
  const proportionalWeight = Math.floor(input.balance / input.tokensPerVote);
  if (input.strategy === "token_capped") {
    return Math.min(
      proportionalWeight,
      Math.max(1, Math.floor(input.voteWeightCap ?? 100)),
    );
  }
  return proportionalWeight;
}

export function calculateMultiTokenGovernanceVoteWeight(input: {
  strategy: CommunityGovernanceProposal["votingStrategy"];
  holdings: Array<{
    balance: number;
    tokensPerVote: number;
    weight: number;
  }>;
  voteWeightCap?: number | null;
}) {
  if (input.strategy === "one_member_one_vote") return 1;
  const combinedWeight = Math.floor(
    input.holdings.reduce((total, holding) => {
      if (
        !Number.isFinite(holding.balance) ||
        holding.balance <= 0 ||
        !Number.isFinite(holding.tokensPerVote) ||
        holding.tokensPerVote <= 0 ||
        !Number.isFinite(holding.weight) ||
        holding.weight <= 0
      ) {
        return total;
      }
      return (
        total +
        Math.floor(holding.balance / holding.tokensPerVote) * holding.weight
      );
    }, 0),
  );
  if (input.strategy === "token_capped") {
    return Math.min(
      combinedWeight,
      Math.max(1, Math.floor(input.voteWeightCap ?? 100)),
    );
  }
  return combinedWeight;
}

export function resolveGovernanceVoteResult(input: {
  votes: Array<{ choice: "for" | "against" | "abstain"; weight: number }>;
  quorum: number;
  approvalThreshold: number;
}): "passed" | "rejected" {
  const forVotes = input.votes
    .filter((vote) => vote.choice === "for")
    .reduce((sum, vote) => sum + vote.weight, 0);
  const againstVotes = input.votes
    .filter((vote) => vote.choice === "against")
    .reduce((sum, vote) => sum + vote.weight, 0);
  const decisiveVotes = forVotes + againstVotes;
  const approvalRate = decisiveVotes > 0 ? forVotes / decisiveVotes : 0;
  return input.votes.length >= input.quorum &&
    approvalRate >= input.approvalThreshold
    ? "passed"
    : "rejected";
}
