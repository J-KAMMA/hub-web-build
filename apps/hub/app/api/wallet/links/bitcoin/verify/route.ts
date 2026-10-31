import { NextResponse } from "next/server";

import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getHubD1 } from "@/lib/server/hub-d1";
import { requireHubSessionProfile } from "@/lib/server/hub-session";
import { verifyBitcoinLink } from "@/lib/server/wallet-link/bitcoin-link";
import { noStoreHeaders, walletLinkErrorResponse } from "@/lib/server/wallet-link/route-support";

/** POST { challengeId, signature (base64: BIP-322 simple/full or BIP-137), signedMessage } -> { linked: true, accountId, address, chainRef }. */
export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "untrusted_origin" }, { status: 403, headers: noStoreHeaders });
  const body = await request.json().catch(() => null) as { challengeId?: unknown; signature?: unknown; signedMessage?: unknown } | null;
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400, headers: noStoreHeaders });
  try {
    const database = getHubD1();
    const profile = await requireHubSessionProfile(request, database);
    const linked = await verifyBitcoinLink(database, {
      profileId: profile.id,
      challengeId: body.challengeId,
      signature: body.signature,
      signedMessage: body.signedMessage,
      env: process.env,
    });
    return NextResponse.json({ linked: true, ...linked }, { headers: noStoreHeaders });
  } catch (error) {
    return walletLinkErrorResponse(error);
  }
}
