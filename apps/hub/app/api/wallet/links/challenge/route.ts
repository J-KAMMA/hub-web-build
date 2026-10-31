import { NextResponse } from "next/server";

import { familyOf } from "@/lib/chains/chain-family";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getHubD1 } from "@/lib/server/hub-d1";
import { requireHubSessionProfile } from "@/lib/server/hub-session";
import { issueSolanaLinkChallenge, WalletLinkError } from "@/lib/server/wallet-link/link-store";
import { linkOrigin, noStoreHeaders, walletLinkErrorResponse } from "@/lib/server/wallet-link/route-support";

/** POST { chainRef, address } -> { challengeId, message, expiresAt }. Solana only in this lane; Bitcoin plugs in beside it. */
export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "untrusted_origin" }, { status: 403, headers: noStoreHeaders });
  const body = await request.json().catch(() => null) as { chainRef?: unknown; address?: unknown } | null;
  if (!body || typeof body.chainRef !== "string" || body.chainRef.length > 80) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400, headers: noStoreHeaders });
  }
  try {
    const database = getHubD1();
    const profile = await requireHubSessionProfile(request, database);
    let family: string;
    try {
      family = familyOf(body.chainRef);
    } catch {
      throw new WalletLinkError("unsupported_chain");
    }
    if (family !== "solana") throw new WalletLinkError("unsupported_chain");
    const origin = linkOrigin(request);
    if (!origin) throw new WalletLinkError("unsupported_chain");
    const issued = await issueSolanaLinkChallenge(database, {
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
