import { NextResponse } from "next/server";

import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import {
  getPublicTipRecipient,
  WalletTipInputError,
} from "@/lib/server/wallet-tips";

export async function GET(request: Request) {
  const database = getOptionalHubD1();
  if (!database) {
    return NextResponse.json({ error: "投げ銭機能を利用できません。" }, { status: 503 });
  }
  try {
    const handle = new URL(request.url).searchParams.get("handle");
    return NextResponse.json(await getPublicTipRecipient(database, handle));
  } catch (error) {
    if (error instanceof WalletTipInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
