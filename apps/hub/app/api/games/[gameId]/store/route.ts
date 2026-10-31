import { contentFileDepsFromEnv } from "@/lib/server/content-files";
import { readGameStoreSettings, updateGameStoreSettings } from "@/lib/server/d1-game-store";
import { unpublishGameBuilds } from "@/lib/server/game-builds";
import { gameStoreFailure, gameStoreJson, refuseCrossOrigin } from "@/lib/server/game-store-route";
import { getHubD1 } from "@/lib/server/hub-d1";
import { requireHubSessionProfile } from "@/lib/server/hub-session";

type Context = { params: Promise<{ gameId: string }> };

/** GET: the store settings and screenshots, for the game's managers. */
export async function GET(request: Request, { params }: Context) {
  try {
    const { gameId } = await params;
    const database = getHubD1();
    const actor = await requireHubSessionProfile(request, database);
    return gameStoreJson(await readGameStoreSettings(database, actor.id, gameId));
  } catch (error) {
    return gameStoreFailure(error);
  }
}

/** PATCH: listing (none/free/paid with one Commerce product), system requirements, release date, platforms. */
export async function PATCH(request: Request, { params }: Context) {
  const refused = refuseCrossOrigin(request);
  if (refused) return refused;
  try {
    const { gameId } = await params;
    const database = getHubD1();
    const actor = await requireHubSessionProfile(request, database);
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || typeof body !== "object" || Array.isArray(body)) return gameStoreJson({ error: "invalid_body" }, 400);
    const settings = await updateGameStoreSettings(database, actor.id, gameId, body);
    // Unlisting closes every build at the file component in the same request (AGENTS.md gate rule).
    if (!settings.storeListing) await unpublishGameBuilds(database, contentFileDepsFromEnv(), gameId);
    return gameStoreJson({ settings });
  } catch (error) {
    return gameStoreFailure(error);
  }
}
