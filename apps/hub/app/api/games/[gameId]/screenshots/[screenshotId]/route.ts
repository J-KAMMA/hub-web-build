import { removeGameScreenshot } from "@/lib/server/d1-game-store";
import { gameStoreFailure, gameStoreJson, refuseCrossOrigin } from "@/lib/server/game-store-route";
import { getHubD1, getHubMedia } from "@/lib/server/hub-d1";
import { requireHubSessionProfile } from "@/lib/server/hub-session";

export async function DELETE(request: Request, { params }: { params: Promise<{ gameId: string; screenshotId: string }> }) {
  const refused = refuseCrossOrigin(request);
  if (refused) return refused;
  try {
    const { gameId, screenshotId } = await params;
    const database = getHubD1();
    const actor = await requireHubSessionProfile(request, database);
    await removeGameScreenshot(database, getHubMedia(), actor.id, gameId, screenshotId);
    return gameStoreJson({ removed: true });
  } catch (error) {
    return gameStoreFailure(error);
  }
}
