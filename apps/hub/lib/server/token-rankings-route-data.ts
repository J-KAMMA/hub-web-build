import "server-only";

import type { TokenRankingInput } from "@/lib/token-ranking";
import { canManageD1TokenRankings, createD1TokenRanking, listD1TokenRankings } from "@/lib/server/d1-token-rankings";
import { getHubD1 } from "@/lib/server/hub-d1";
import { requireHubSessionProfile } from "@/lib/server/hub-session";

export async function getTokenRankingsRouteData() {
  return { rankings: await listD1TokenRankings(getHubD1()) };
}

export async function createTokenRankingRouteData(request: Request, input: TokenRankingInput) {
  const database = getHubD1();
  const viewer = await requireHubSessionProfile(request, database);
  if (!await canManageD1TokenRankings(database, viewer.id)) throw new TokenRankingPermissionError();
  return { ranking: await createD1TokenRanking(database, viewer.id, input) };
}

export class TokenRankingPermissionError extends Error {
  constructor() {
    super("Token ranking manager permission is required.");
    this.name = "TokenRankingPermissionError";
  }
}
