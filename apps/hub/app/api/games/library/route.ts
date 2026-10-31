import { listGameLibrary } from "@/lib/server/d1-game-store";
import { gameStoreFailure, gameStoreJson } from "@/lib/server/game-store-route";
import { getHubD1 } from "@/lib/server/hub-d1";
import { requireHubSessionProfile } from "@/lib/server/hub-session";

/** GET /api/games/library?cursor=&limit= — the signed-in profile's owned games (free adds and verified purchases). */
export async function GET(request: Request) {
  try {
    const database = getHubD1();
    const actor = await requireHubSessionProfile(request, database);
    const params = new URL(request.url).searchParams;
    const limit = Number(params.get("limit") ?? "24");
    const page = await listGameLibrary(database, actor.id, { cursor: params.get("cursor"), limit: Number.isFinite(limit) ? limit : 24 });
    return gameStoreJson({ version: "hub.games.library.v1", ...page });
  } catch (error) {
    return gameStoreFailure(error);
  }
}
