import { NextResponse } from "next/server";

import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import { HubAuthenticationError } from "@/lib/server/hub-session";
import {
  verifyAndLinkHubProfileWallet,
  WalletBalanceInputError,
  WalletBalanceVerificationError,
} from "@/lib/server/hub-wallet-profile-link";

const unavailable = () => NextResponse.json(
  { error: "ウォレット連携ストレージを利用できません。" },
  { status: 503, headers: { "cache-control": "no-store" } },
);

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "不正なリクエストです。" }, { status: 403 });
  const body = await request.json().catch(() => null) as { challengeId?: unknown; address?: unknown; typedData?: unknown; signature?: unknown } | null;
  if (!body) return NextResponse.json({ error: "入力を確認してください。" }, { status: 400 });
  try {
    return NextResponse.json(await verifyAndLinkHubProfileWallet({ request, database: getHubD1(), challengeId: body.challengeId, address: body.address, typedData: body.typedData, signature: body.signature }), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof HubD1UnavailableError) return unavailable();
    if (error instanceof HubAuthenticationError) return NextResponse.json({ error: "Hubへのログインが必要です。" }, { status: 401 });
    if (error instanceof WalletBalanceInputError || error instanceof WalletBalanceVerificationError) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ error: "決済アカウントを連携できませんでした。" }, { status: 500, headers: { "cache-control": "no-store" } });
  }
}
