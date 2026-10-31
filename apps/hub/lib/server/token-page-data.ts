import "server-only";

import type { Profile, TokenRankingDefinition } from "@/lib/domain";
import { getD1TokenRankingView, listD1TokenRankings } from "@/lib/server/d1-token-rankings";
import { getD1ViewerData } from "@/lib/server/d1-viewer-data";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";

type TokenRanking = Array<{ profile: Profile; balance: string }>;

export interface TokenPageData {
  currentProfile: Profile;
  notificationCount: number;
  messageCount: number;
  balances: Array<{ symbol: string; amount: string }>;
  ranking: TokenRanking;
  profiles: Profile[];
  selectedSymbol: string;
  selectedRanking: TokenRankingDefinition;
  rankingDefinitions: TokenRankingDefinition[];
}

const EMPTY_RANKING: TokenRankingDefinition = {
  id: "",
  title: "ランキング未登録",
  symbol: "-",
  network: "-",
  description: "利用できるトークンランキングはまだありません。",
  createdByProfileId: "",
  createdAt: "",
  verificationStatus: "pending",
  holderCount: 0,
};

export async function getTokenPageData(requestedRanking = "token-ranking-wg"): Promise<TokenPageData> {
  const database = getOptionalHubD1();
  if (database) {
    /*
     * A binding that answers is not the same as a schema that matches. Three
     * token migrations were still unapplied on staging, so these queries threw
     * and /token returned 500 for every visitor — the page had no guard at all
     * while the rest of the Hub degrades. Falling through to the same empty
     * state a missing binding produces keeps the screen readable.
     */
    try {
      const [viewer, rankingDefinitions] = await Promise.all([
        getD1ViewerData(),
        listD1TokenRankings(database),
      ]);
      const selectedRanking = rankingDefinitions.find((item) => item.id === requestedRanking)
        ?? rankingDefinitions.find((item) => item.symbol === requestedRanking.trim().toUpperCase())
        ?? rankingDefinitions[0]
        ?? EMPTY_RANKING;
      const view = await getD1TokenRankingView(
        database,
        selectedRanking.id,
        selectedRanking.symbol,
        viewer.currentProfile.id || null,
      );
      return {
        currentProfile: viewer.currentProfile,
        notificationCount: viewer.notificationCount,
        messageCount: viewer.messageCount,
        balances: view.balances,
        ranking: view.ranking,
        profiles: view.profiles,
        selectedSymbol: selectedRanking.symbol,
        selectedRanking,
        rankingDefinitions,
      };
    } catch (error) {
      console.error(JSON.stringify({
        event: "token_page_data_unavailable",
        category: error instanceof Error ? error.name : "unknown",
      }));
    }
  }

  // A missing D1 binding must never expose seeded balances or profiles as if
  // they were verified runtime data. The page remains usable in a safe empty state.
  return {
    currentProfile: { id: "", handle: "guest", displayName: "ゲスト", bio: "", joinedAt: "1970-01-01T00:00:00.000Z" },
    notificationCount: 0,
    messageCount: 0,
    balances: [],
    ranking: [],
    profiles: [],
    selectedSymbol: EMPTY_RANKING.symbol,
    selectedRanking: EMPTY_RANKING,
    rankingDefinitions: [],
  };
}
