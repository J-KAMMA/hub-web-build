import { NextResponse } from "next/server";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { HubAuthenticationError } from "@/lib/server/hub-session";
import {
  confirmWalletActivity,
  listWalletActivity,
  WalletActivityInputError,
  WalletActivityPendingError,
  WalletActivityVerificationError,
} from "@/lib/server/wallet-activity";

export async function GET(request: Request) {
  const database = getOptionalHubD1();
  if (!database)
    return NextResponse.json(
      { error: "履歴を利用できません。" },
      { status: 503 },
    );
  try {
    return NextResponse.json(await listWalletActivity(request, database), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof HubAuthenticationError)
      return NextResponse.json(
        { error: "ログインが必要です。" },
        { status: 401 },
      );
    throw error;
  }
}

export async function POST(request: Request) {
  if (!hasSameOrigin(request))
    return NextResponse.json(
      { error: "不正なリクエストです。" },
      { status: 403 },
    );
  const database = getOptionalHubD1();
  if (!database)
    return NextResponse.json(
      { error: "履歴を利用できません。" },
      { status: 503 },
    );
  const body = (await request.json().catch(() => null)) as {
    txHash?: unknown;
    chainId?: unknown;
  } | null;
  try {
    return NextResponse.json(
      await confirmWalletActivity({
        request,
        database,
        txHash: body?.txHash,
        chainId: body?.chainId,
      }),
    );
  } catch (error) {
    if (error instanceof HubAuthenticationError)
      return NextResponse.json(
        { error: "ログインが必要です。" },
        { status: 401 },
      );
    if (
      error instanceof WalletActivityInputError ||
      error instanceof WalletActivityVerificationError
    )
      return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof WalletActivityPendingError)
      return NextResponse.json({ error: error.message }, { status: 409 });
    return NextResponse.json(
      { error: "取引を確認できませんでした。" },
      { status: 502 },
    );
  }
}
