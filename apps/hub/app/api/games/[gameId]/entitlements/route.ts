import { redeemGameEntitlement } from "@/lib/server/d1-game-store";
import { verifyGameEntitlementProof } from "@/lib/server/game-entitlement-proof";
import { gameStoreFailure, gameStoreJson, refuseCrossOrigin } from "@/lib/server/game-store-route";
import { getHubD1 } from "@/lib/server/hub-d1";
import { requireHubSessionProfile } from "@/lib/server/hub-session";

/*
 * POST { proof }. The browser obtained the proof from Commerce directly (POST
 * /api/v1/orders/{id}/game-entitlement with its own order access token). Hub receives only the proof,
 * verifies it with the Commerce public key, and records ownership. A missing key fails closed.
 */
export async function POST(request: Request, { params }: { params: Promise<{ gameId: string }> }) {
  const refused = refuseCrossOrigin(request);
  if (refused) return refused;
  try {
    const { gameId } = await params;
    const database = getHubD1();
    const actor = await requireHubSessionProfile(request, database);
    const body = await request.json().catch(() => null) as { proof?: unknown } | null;
    const publicKey = process.env.COMMERCE_GAME_ENTITLEMENT_PUBLIC_KEY_SPKI;
    if (!publicKey?.trim()) return gameStoreJson({ error: "entitlement_verification_unavailable" }, 503);
    const proof = await verifyGameEntitlementProof(body?.proof, publicKey);
    if (!proof) return gameStoreJson({ error: "invalid_entitlement_proof" }, 401);
    return gameStoreJson(await redeemGameEntitlement(database, actor.id, gameId, proof));
  } catch (error) {
    return gameStoreFailure(error);
  }
}
