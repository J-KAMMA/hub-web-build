import { NextResponse } from "next/server";

import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { HubAuthenticationError } from "@/lib/server/hub-session";
import {
  confirmWalletTip,
  WalletTipInputError,
  WalletTipPendingError,
  WalletTipPermissionError,
  WalletTipVerificationError,
} from "@/lib/server/wallet-tips";

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: "不正なリクエストです。" }, { status: 403 });
  }
  const database = getOptionalHubD1();
  if (!database) {
    return NextResponse.json({ error: "投げ銭機能を利用できません。" }, { status: 503 });
  }
  const body = await request.json().catch(() => null) as
    | { recipientHandle?: unknown; txHash?: unknown; chainId?: unknown; articleId?: unknown }
    | null;
  if (!body) {
    return NextResponse.json({ error: "入力を確認してください。" }, { status: 400 });
  }
  try {
    return NextResponse.json(await confirmWalletTip({
      request,
      database,
      recipientHandle: body.recipientHandle,
      txHash: body.txHash,
      chainId: body.chainId,
      articleId: body.articleId,
    }));
  } catch (error) {
    if (error instanceof HubAuthenticationError) {
      return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
    }
    if (error instanceof WalletTipInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof WalletTipPermissionError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof WalletTipPendingError) {
      return NextResponse.json({ error: error.message, pending: true }, { status: 409 });
    }
    if (error instanceof WalletTipVerificationError) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    return NextResponse.json(
      { error: "投げ銭トランザクションを確認できませんでした。" },
      { status: 502 },
    );
  }
}
