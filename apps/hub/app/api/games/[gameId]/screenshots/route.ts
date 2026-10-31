import { addGameScreenshot } from "@/lib/server/d1-game-store";
import { gameStoreFailure, gameStoreJson, refuseCrossOrigin } from "@/lib/server/game-store-route";
import { getHubD1, getHubMedia } from "@/lib/server/hub-d1";
import { requireHubSessionProfile } from "@/lib/server/hub-session";

/** POST { imageDataUrl, rightsBasis, attribution }: same image limits and storage as the game image; at most 8. */
export async function POST(request: Request, { params }: { params: Promise<{ gameId: string }> }) {
  const refused = refuseCrossOrigin(request);
  if (refused) return refused;
  try {
    const { gameId } = await params;
    const database = getHubD1();
    const actor = await requireHubSessionProfile(request, database);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const screenshot = await addGameScreenshot(database, getHubMedia(), actor.id, gameId, {
      imageDataUrl: body.imageDataUrl, rightsBasis: body.rightsBasis, attribution: body.attribution,
    });
    return gameStoreJson({ screenshot }, 201);
  } catch (error) {
    return gameStoreFailure(error);
  }
}
