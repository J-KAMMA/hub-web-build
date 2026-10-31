import { NextResponse } from "next/server";

import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import { HubAuthenticationError } from "@/lib/server/hub-session";
import { createWalletBalanceChallenge, WalletBalanceInputError, WalletBalanceNetworkError } from "@/lib/server/wallet-balance-verification";

const noStoreHeaders = { "cache-control": "private, no-store" };

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "許可されていない送信元です。" }, { status: 403, headers: noStoreHeaders });
  const body = await request.json().catch(() => null) as { rankingId?: unknown; address?: unknown; chainId?: unknown } | null;
  if (!body) return NextResponse.json({ error: "入力内容を確認してください。" }, { status: 400, headers: noStoreHeaders });
  try {
    return NextResponse.json(await createWalletBalanceChallenge({ request, database: getHubD1(), rankingId: body.rankingId, address: body.address, chainId: body.chainId }), { headers: noStoreHeaders });
  } catch (error) {
    if (error instanceof HubD1UnavailableError) return NextResponse.json({ error: "ウォレット確認用ストレージを現在利用できません。" }, { status: 503, headers: noStoreHeaders });
    if (error instanceof HubAuthenticationError) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401, headers: noStoreHeaders });
    if (error instanceof WalletBalanceInputError) return NextResponse.json({ error: "ウォレット情報を確認してください。" }, { status: 400, headers: noStoreHeaders });
    if (error instanceof WalletBalanceNetworkError) return NextResponse.json({ error: "このネットワークには対応していません。" }, { status: 400, headers: noStoreHeaders });
    return NextResponse.json({ error: "所有確認を開始できませんでした。" }, { status: 502, headers: noStoreHeaders });
  }
}
