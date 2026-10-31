import { contentFileDepsFromEnv } from "@/lib/server/content-files";
import { issueGameBuildDownloadTicket } from "@/lib/server/game-builds";
import { gameStoreFailure, gameStoreJson, refuseCrossOrigin } from "@/lib/server/game-store-route";
import { getHubD1 } from "@/lib/server/hub-d1";
import { requireHubSessionProfile } from "@/lib/server/hub-session";

/*
 * POST: a single-use file-component download URL for one build, after Hub's own ownership and age
 * checks. The browser (or Hub Desktop's browser view) opens it directly at /vault/api/files/<id>;
 * Hub never sees the bytes. The response's sha256 is the original build's registered hash.
 */
export async function POST(request: Request, { params }: { params: Promise<{ gameId: string; buildId: string }> }) {
  const refused = refuseCrossOrigin(request);
  if (refused) return refused;
  try {
    const { gameId, buildId } = await params;
    const database = getHubD1();
    const actor = await requireHubSessionProfile(request, database);
    return gameStoreJson(await issueGameBuildDownloadTicket(database, contentFileDepsFromEnv(), actor.id, gameId, buildId));
  } catch (error) {
    return gameStoreFailure(error);
  }
}
