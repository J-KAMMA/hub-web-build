import { contentFileDepsFromEnv } from "@/lib/server/content-files";
import { listGameBuilds, registerGameBuild, type GameBuildInput } from "@/lib/server/game-builds";
import { gameStoreFailure, gameStoreJson, refuseCrossOrigin } from "@/lib/server/game-store-route";
import { getHubD1 } from "@/lib/server/hub-d1";
import { requireHubSessionProfile } from "@/lib/server/hub-session";

type Context = { params: Promise<{ gameId: string }> };

/** GET: published builds of a listed game (version, platform, SHA-256, size). No file IDs. */
export async function GET(_request: Request, { params }: Context) {
  try {
    const { gameId } = await params;
    return gameStoreJson({ builds: await listGameBuilds(getHubD1(), gameId) });
  } catch (error) {
    return gameStoreFailure(error);
  }
}

/**
 * POST { fileId, version, platform, kind?, channel?, sha256, notes? }: a manager registers a file they
 * uploaded with an ordinary upload ticket (POST /api/content-files) as a build, and Hub publishes it.
 */
export async function POST(request: Request, { params }: Context) {
  const refused = refuseCrossOrigin(request);
  if (refused) return refused;
  try {
    const { gameId } = await params;
    const database = getHubD1();
    const actor = await requireHubSessionProfile(request, database);
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || typeof body !== "object" || Array.isArray(body)) return gameStoreJson({ error: "invalid_body" }, 400);
    const build = await registerGameBuild(database, contentFileDepsFromEnv(), actor.id, gameId, body as GameBuildInput);
    return gameStoreJson({ build }, 201);
  } catch (error) {
    return gameStoreFailure(error);
  }
}
