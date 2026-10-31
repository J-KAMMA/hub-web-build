import { contentFileDepsFromEnv } from "@/lib/server/content-files";
import { removeGameBuild } from "@/lib/server/game-builds";
import { gameStoreFailure, gameStoreJson, refuseCrossOrigin } from "@/lib/server/game-store-route";
import { getHubD1 } from "@/lib/server/hub-d1";
import { requireHubSessionProfile } from "@/lib/server/hub-session";

/** DELETE: a manager withdraws one build; it is unpublished at the file component. */
export async function DELETE(request: Request, { params }: { params: Promise<{ gameId: string; buildId: string }> }) {
  const refused = refuseCrossOrigin(request);
  if (refused) return refused;
  try {
    const { gameId, buildId } = await params;
    const database = getHubD1();
    const actor = await requireHubSessionProfile(request, database);
    return gameStoreJson(await removeGameBuild(database, contentFileDepsFromEnv(), actor.id, gameId, buildId));
  } catch (error) {
    return gameStoreFailure(error);
  }
}
