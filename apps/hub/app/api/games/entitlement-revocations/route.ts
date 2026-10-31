import { revokeGameEntitlementFromPush } from "@/lib/server/d1-game-store";
import { verifyGameEntitlementProof } from "@/lib/server/game-entitlement-proof";
import { gameStoreFailure, gameStoreJson } from "@/lib/server/game-store-route";
import { getHubD1 } from "@/lib/server/hub-d1";

/*
 * POST { proof } from the Commerce cron when a game order is fully refunded (PLAN.md §2.5). No session
 * and no Origin: the Commerce EdDSA signature over the Hub-audience proof is the authority, and the
 * proof holds only the product ID, scope, status, times and the grant's token ID. Only "refunded"
 * proofs are accepted here; the effect is an idempotent revoke. A missing key fails closed with 503 so
 * Commerce keeps the row and retries.
 */
export async function POST(request: Request) {
  try {
    const publicKey = process.env.COMMERCE_GAME_ENTITLEMENT_PUBLIC_KEY_SPKI;
    if (!publicKey?.trim()) return gameStoreJson({ error: "entitlement_verification_unavailable" }, 503);
    const text = await request.text().catch(() => "");
    if (text.length > 8_192) return gameStoreJson({ error: "invalid_body" }, 400);
    let body: { proof?: unknown } | null = null;
    try {
      body = JSON.parse(text) as { proof?: unknown };
    } catch {
      body = null;
    }
    const proof = await verifyGameEntitlementProof(body?.proof, publicKey);
    if (!proof) return gameStoreJson({ error: "invalid_entitlement_proof" }, 401);
    if (proof.status !== "refunded") return gameStoreJson({ error: "not_a_refund" }, 400);
    return gameStoreJson(await revokeGameEntitlementFromPush(getHubD1(), proof));
  } catch (error) {
    return gameStoreFailure(error);
  }
}
