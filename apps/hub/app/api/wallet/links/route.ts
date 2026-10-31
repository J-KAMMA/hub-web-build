import { NextResponse } from "next/server";

import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import { HubAuthenticationError } from "@/lib/server/hub-session";
import { listHubWalletLinks, unlinkHubWallet, WalletBalanceInputError } from "@/lib/server/wallet-balance-verification";

const noStoreHeaders = { "cache-control": "private, no-store" };

function unavailable() {
  return NextResponse.json({ error: "ウォレット連携用ストレージを現在利用できません。" }, { status: 503, headers: noStoreHeaders });
}

export async function GET(request: Request) {
  try {
    return NextResponse.json({ links: await listHubWalletLinks(request, getHubD1()) }, { headers: noStoreHeaders });
  } catch (error) {
    if (error instanceof HubD1UnavailableError) return unavailable();
    if (error instanceof HubAuthenticationError) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401, headers: noStoreHeaders });
    return NextResponse.json({ error: "ウォレット連携を取得できませんでした。" }, { status: 502, headers: noStoreHeaders });
  }
}

export async function DELETE(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "許可されていない送信元です。" }, { status: 403, headers: noStoreHeaders });
  const body = await request.json().catch(() => null) as { address?: unknown; chainId?: unknown } | null;
  if (!body) return NextResponse.json({ error: "入力内容を確認してください。" }, { status: 400, headers: noStoreHeaders });
  try {
    return NextResponse.json(await unlinkHubWallet({ request, database: getHubD1(), address: body.address, chainId: body.chainId }), { headers: noStoreHeaders });
  } catch (error) {
    if (error instanceof HubD1UnavailableError) return unavailable();
    if (error instanceof HubAuthenticationError) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401, headers: noStoreHeaders });
    if (error instanceof WalletBalanceInputError) return NextResponse.json({ error: "ウォレット情報を確認してください。" }, { status: 400, headers: noStoreHeaders });
    return NextResponse.json({ error: "ウォレット連携を解除できませんでした。" }, { status: 502, headers: noStoreHeaders });
  }
}
