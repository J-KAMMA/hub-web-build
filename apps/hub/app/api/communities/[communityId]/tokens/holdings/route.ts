import { NextResponse } from "next/server";

import { aggregateVerifiedCommunityTokens, verifyCommunityTokenHoldings } from "@/lib/server/community-token-holdings";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";

export async function POST(request: Request, { params }: { params: Promise<{ communityId: string }> }) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  const { communityId } = await params;
  try {
    const verification = await verifyCommunityTokenHoldings(communityId);
    return NextResponse.json({
      source: verification.source,
      verifiedAt: verification.verifiedAt,
      expiresAt: verification.expiresAt,
      tokens: aggregateVerifiedCommunityTokens(communityId, verification)
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "保有量を確認できませんでした。" }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
}
