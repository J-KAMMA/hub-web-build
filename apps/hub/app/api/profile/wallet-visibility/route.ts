import { NextResponse } from "next/server";

import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import { HubAuthenticationError } from "@/lib/server/hub-session";
import { setHubWalletLinksVisibility } from "@/lib/server/wallet-balance-verification";

const noStoreHeaders = { "cache-control": "private, no-store" };

export async function PATCH(request: Request) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: "許可されていない送信元です。" }, { status: 403, headers: noStoreHeaders });
  }
  try {
    const body = await request.json() as { published?: unknown };
    if (typeof body.published !== "boolean") {
      return NextResponse.json({ error: "公開設定を確認してください。" }, { status: 400, headers: noStoreHeaders });
    }
    return NextResponse.json(
      await setHubWalletLinksVisibility(request, getHubD1(), body.published ? "public" : "private"),
      { headers: noStoreHeaders },
    );
  } catch (error) {
    if (error instanceof HubD1UnavailableError) {
      return NextResponse.json({ error: "ウォレット公開設定を現在利用できません。" }, { status: 503, headers: noStoreHeaders });
    }
    if (error instanceof HubAuthenticationError) {
      return NextResponse.json({ error: "ログインが必要です。" }, { status: 401, headers: noStoreHeaders });
    }
    return NextResponse.json({ error: "ウォレットの公開設定を更新できませんでした。" }, { status: 400, headers: noStoreHeaders });
  }
}
