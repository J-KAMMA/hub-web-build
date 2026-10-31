import { rankHubObjects } from "@/lib/platform/hub-object-ranking";

export interface CommunityRankSignals {
  memberCount: number;
  recentMemberCount: number;
  recentMessageCount: number;
  recentActiveMemberCount: number;
  recentReactionCount: number;
}

export function rankCommunities<T extends {
  id: string;
  name: string;
  category?: string;
  score: number;
}>(communities: readonly T[]): T[] {
  return rankHubObjects(
    communities.map((community) => ({
      ref: { namespace: "hub", kind: "community", id: community.id },
      value: community,
      baseScore: community.score,
      stableKey: community.name.normalize("NFKC"),
      diversityKeys: community.category ? { topic: community.category } : undefined,
    })),
    { surface: "community_feed" },
  ).map((entry) => entry.value);
}

function safeCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function calculateCommunityRankScore(signals: CommunityRankSignals): number {
  const members = safeCount(signals.memberCount);
  const recentMembers = safeCount(signals.recentMemberCount);
  const messages = safeCount(signals.recentMessageCount);
  const activeMembers = safeCount(signals.recentActiveMemberCount);
  const reactions = safeCount(signals.recentReactionCount);
  const growthRate = members > 0 ? Math.min(1, recentMembers / members) : 0;
  const participationBreadth = messages > 0 ? Math.min(1, activeMembers / messages) : 0;
  return (
    Math.log1p(members) * 1.5 +
    Math.log1p(recentMembers) * 4 +
    Math.log1p(messages) * 2.5 +
    Math.log1p(activeMembers) * 6 +
    Math.log1p(reactions) * 2 +
    growthRate * 3 +
    participationBreadth * 3
  );
}
