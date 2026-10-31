import { NextResponse } from "next/server";

import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { HubD1UnavailableError } from "@/lib/server/hub-d1";
import { HubAuthenticationError } from "@/lib/server/hub-session";
import { createTokenRankingRouteData, getTokenRankingsRouteData, TokenRankingPermissionError } from "@/lib/server/token-rankings-route-data";
import { parseTokenRankingInput } from "@/lib/token-ranking";

const noStoreHeaders = { "cache-control": "no-store" };

export async function GET() {
  try {
    return NextResponse.json(await getTokenRankingsRouteData(), { headers: noStoreHeaders });
  } catch {
    return NextResponse.json({ error: "token_rankings_unavailable" }, { status: 503, headers: noStoreHeaders });
  }
}

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "許可されていない送信元です。" }, { status: 403, headers: noStoreHeaders });
  try {
    const input = parseTokenRankingInput(await request.json());
    return NextResponse.json(await createTokenRankingRouteData(request, input), { status: 201, headers: noStoreHeaders });
  } catch (error) {
    if (error instanceof HubAuthenticationError) return NextResponse.json({ error: "ランキングの作成にはログインが必要です。" }, { status: 401, headers: noStoreHeaders });
    if (error instanceof TokenRankingPermissionError) return NextResponse.json({ error: "ランキングを作成できるのはコミュニティ管理者だけです。" }, { status: 403, headers: noStoreHeaders });
    if (error instanceof HubD1UnavailableError) return NextResponse.json({ error: "token_rankings_unavailable" }, { status: 503, headers: noStoreHeaders });
    return NextResponse.json({ error: "ランキングを作成できませんでした。" }, { status: 400, headers: noStoreHeaders });
  }
}
