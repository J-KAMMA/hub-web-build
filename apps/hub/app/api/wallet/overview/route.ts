import { NextResponse } from "next/server";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import { HubAuthenticationError } from "@/lib/server/hub-session";
import {
  readLinkedWalletOverview,
  WalletBalanceInputError,
  WalletBalanceNetworkError,
  WalletBalanceVerificationError,
} from "@/lib/server/wallet-balance-verification";

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json(
      { error: "不正なリクエストです。" },
      { status: 403 },
    );
  }
  const body = (await request.json().catch(() => null)) as {
    address?: unknown;
    chainId?: unknown;
  } | null;
  if (!body)
    return NextResponse.json(
      { error: "入力を確認してください。" },
      { status: 400 },
    );
  try {
    return NextResponse.json(
      await readLinkedWalletOverview({
        request,
        database: getHubD1(),
        address: body.address,
        chainId: body.chainId,
      }),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof HubD1UnavailableError) return NextResponse.json({ error: "wallet_storage_unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
    if (error instanceof HubAuthenticationError) {
      return NextResponse.json(
        { error: "ログインが必要です。" },
        { status: 401 },
      );
    }
    if (
      error instanceof WalletBalanceInputError ||
      error instanceof WalletBalanceVerificationError
    ) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof WalletBalanceNetworkError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    return NextResponse.json(
      { error: "残高を取得できませんでした。時間を置いて再試行してください。" },
      { status: 502 },
    );
  }
}
