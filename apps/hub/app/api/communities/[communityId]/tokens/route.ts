import { NextResponse } from "next/server";

import { createCommunityTokenRouteData, getCommunityTokensRouteData } from "@/lib/server/community-route-data";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";

export async function GET(_request: Request, { params }: { params: Promise<{ communityId: string }> }) {
  const { communityId } = await params;
  return NextResponse.json(await getCommunityTokensRouteData(communityId));
}

export async function POST(request: Request, { params }: { params: Promise<{ communityId: string }> }) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  const { communityId } = await params;
  const payload = (await request.json().catch(() => ({}))) as { name?: string; symbol?: string; network?: string; contract_address?: string };
  const name = payload.name?.trim() ?? "";
  const symbol = payload.symbol?.trim() ?? "";
  const network = payload.network?.trim() ?? "";
  if (!name || !symbol || !network) return NextResponse.json({ error: "名前、シンボル、ネットワークを入力してください。" }, { status: 400 });
  try {
    return NextResponse.json(await createCommunityTokenRouteData(request, { communityId, name, symbol, network, contractAddress: payload.contract_address?.trim() || undefined }), { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "トークンを登録できませんでした。" }, { status: 400 });
  }
}
