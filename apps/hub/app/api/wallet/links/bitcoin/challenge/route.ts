import { NextResponse } from "next/server";

import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getHubD1 } from "@/lib/server/hub-d1";
import { requireHubSessionProfile } from "@/lib/server/hub-session";
import { issueBitcoinLinkChallenge } from "@/lib/server/wallet-link/bitcoin-link";
import { linkOrigin, noStoreHeaders, walletLinkErrorResponse } from "@/lib/server/wallet-link/route-support";
import { WalletLinkError } from "@/lib/server/wallet-link/link-store";

/** POST { chainRef, address } -> { challengeId, message, expiresAt } for a Bitcoin wallet link (BIP-322 / BIP-137). */
export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "untrusted_origin" }, { status: 403, headers: noStoreHeaders });
  const body = await request.json().catch(() => null) as { chainRef?: unknown; address?: unknown } | null;
  if (!body || typeof body.chainRef !== "string" || body.chainRef.length > 80) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400, headers: noStoreHeaders });
  }
  try {
    const database = getHubD1();
    const profile = await requireHubSessionProfile(request, database);
    const origin = linkOrigin(request);
    if (!origin) throw new WalletLinkError("unsupported_chain");
    const issued = await issueBitcoinLinkChallenge(database, {
      profileId: profile.id,
      handle: profile.handle ?? null,
      chainRef: body.chainRef,
      address: body.address,
      origin,
      env: process.env,
    });
    return NextResponse.json(issued, { headers: noStoreHeaders });
  } catch (error) {
    return walletLinkErrorResponse(error);
  }
}
