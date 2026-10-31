import { addFreeGameToLibrary, readGameOwnership, removeFreeGameFromLibrary } from "@/lib/server/d1-game-store";
import { gameStoreFailure, gameStoreJson, refuseCrossOrigin } from "@/lib/server/game-store-route";
import { getHubD1 } from "@/lib/server/hub-d1";
import { requireHubSessionProfile } from "@/lib/server/hub-session";

type Context = { params: Promise<{ gameId: string }> };

/** GET: whether the signed-in profile owns this game. */
export async function GET(request: Request, { params }: Context) {
  try {
    const { gameId } = await params;
    const database = getHubD1();
    const actor = await requireHubSessionProfile(request, database);
    return gameStoreJson(await readGameOwnership(database, actor.id, gameId));
  } catch (error) {
    return gameStoreFailure(error);
  }
}

/** POST: add a free game to the library (no Commerce order). */
export async function POST(request: Request, { params }: Context) {
  const refused = refuseCrossOrigin(request);
  if (refused) return refused;
  try {
    const { gameId } = await params;
    const database = getHubD1();
    const actor = await requireHubSessionProfile(request, database);
    return gameStoreJson(await addFreeGameToLibrary(database, actor.id, gameId));
  } catch (error) {
    return gameStoreFailure(error);
  }
}

/** DELETE: removes a free add. Purchased games leave only through a Commerce refund proof. */
export async function DELETE(request: Request, { params }: Context) {
  const refused = refuseCrossOrigin(request);
  if (refused) return refused;
  try {
    const { gameId } = await params;
    const database = getHubD1();
    const actor = await requireHubSessionProfile(request, database);
    return gameStoreJson(await removeFreeGameFromLibrary(database, actor.id, gameId));
  } catch (error) {
    return gameStoreFailure(error);
  }
}
