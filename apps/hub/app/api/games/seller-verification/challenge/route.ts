import { issueGameSellerChallenge } from "@/lib/server/game-seller-verification";
import { gameStoreFailure, gameStoreJson, refuseCrossOrigin } from "@/lib/server/game-store-route";
import { getHubD1 } from "@/lib/server/hub-d1";
import { requireHubSessionProfile } from "@/lib/server/hub-session";

/** POST: a one-time challenge (5 minutes) bound to the signed-in creator. Replaces any earlier one. */
export async function POST(request: Request) {
  const refused = refuseCrossOrigin(request);
  if (refused) return refused;
  try {
    const database = getHubD1();
    const actor = await requireHubSessionProfile(request, database);
    return gameStoreJson(await issueGameSellerChallenge(database, actor.id));
  } catch (error) {
    return gameStoreFailure(error);
  }
}
