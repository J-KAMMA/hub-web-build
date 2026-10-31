import { verifyGameSellerProof } from "@/lib/server/game-seller-proof";
import { getGameSellerVerification, redeemGameSellerProof } from "@/lib/server/game-seller-verification";
import { gameStoreFailure, gameStoreJson, refuseCrossOrigin } from "@/lib/server/game-store-route";
import { getHubD1 } from "@/lib/server/hub-d1";
import { requireHubSessionProfile } from "@/lib/server/hub-session";

/** GET: whether the signed-in creator holds an unexpired game-seller verification (time only). */
export async function GET(request: Request) {
  try {
    const database = getHubD1();
    const actor = await requireHubSessionProfile(request, database);
    return gameStoreJson(await getGameSellerVerification(database, actor.id));
  } catch (error) {
    return gameStoreFailure(error);
  }
}

/*
 * POST { proof }. The browser obtained the proof from Commerce directly (POST
 * /api/v1/seller/hub-game-verification with the challenge from ./challenge and its own seller session).
 * Hub receives only the proof, verifies it with the Commerce public key, consumes this profile's challenge
 * and records the verification time. A missing key fails closed.
 */
export async function POST(request: Request) {
  const refused = refuseCrossOrigin(request);
  if (refused) return refused;
  try {
    const database = getHubD1();
    const actor = await requireHubSessionProfile(request, database);
    const body = await request.json().catch(() => null) as { proof?: unknown } | null;
    const publicKey = process.env.COMMERCE_GAME_ENTITLEMENT_PUBLIC_KEY_SPKI;
    if (!publicKey?.trim()) return gameStoreJson({ error: "seller_verification_unavailable" }, 503);
    const proof = await verifyGameSellerProof(body?.proof, publicKey);
    if (!proof) return gameStoreJson({ error: "invalid_seller_proof" }, 401);
    return gameStoreJson(await redeemGameSellerProof(database, actor.id, proof));
  } catch (error) {
    return gameStoreFailure(error);
  }
}
