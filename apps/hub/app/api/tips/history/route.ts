import { NextResponse } from "next/server";

import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { HubAuthenticationError } from "@/lib/server/hub-session";
import { listOwnWalletTips } from "@/lib/server/wallet-tips";

export async function GET(request: Request) {
  const database = getOptionalHubD1();
  if (!database) return NextResponse.json({ error: "投げ銭機能を利用できません。" }, { status: 503 });
  try {
    return NextResponse.json(await listOwnWalletTips(request, database), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof HubAuthenticationError) {
      return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
    }
    throw error;
  }
}
