import { declareAdult, hasAdultDeclaration, withdrawAdultDeclaration } from "@/lib/server/d1-game-store";
import { gameStoreFailure, gameStoreJson, refuseCrossOrigin } from "@/lib/server/game-store-route";
import { getHubD1 } from "@/lib/server/hub-d1";
import { requireHubSessionProfile } from "@/lib/server/hub-session";

/*
 * The game store's age check (PLAN.md §9 Q5): the signed-in person's own declaration that they are 18
 * or older. Hub keeps only that it was made and when; no birthdate and no Identity data.
 *   GET    -> { declared }
 *   POST   { declaredAdult: true } -> { declared: true, declaredAt }
 *   DELETE -> { declared: false }
 */
export async function GET(request: Request) {
  try {
    const database = getHubD1();
    const actor = await requireHubSessionProfile(request, database);
    return gameStoreJson({ declared: await hasAdultDeclaration(database, actor.id) });
  } catch (error) {
    return gameStoreFailure(error);
  }
}

export async function POST(request: Request) {
  const refused = refuseCrossOrigin(request);
  if (refused) return refused;
  try {
    const database = getHubD1();
    const actor = await requireHubSessionProfile(request, database);
    const body = await request.json().catch(() => null) as { declaredAdult?: unknown } | null;
    if (body?.declaredAdult !== true) return gameStoreJson({ error: "declaration_required" }, 400);
    return gameStoreJson(await declareAdult(database, actor.id));
  } catch (error) {
    return gameStoreFailure(error);
  }
}

export async function DELETE(request: Request) {
  const refused = refuseCrossOrigin(request);
  if (refused) return refused;
  try {
    const database = getHubD1();
    const actor = await requireHubSessionProfile(request, database);
    return gameStoreJson(await withdrawAdultDeclaration(database, actor.id));
  } catch (error) {
    return gameStoreFailure(error);
  }
}
