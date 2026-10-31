import { NextResponse } from "next/server";

import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getHubD1 } from "@/lib/server/hub-d1";
import { requireHubSessionProfile } from "@/lib/server/hub-session";
import {
  createMarketTicketCheckinChallenge,
  redeemMarketTicketCheckinChallenge,
} from "@/lib/server/market-tickets";

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "不正なリクエストです。" }, { status: 403 });
  try {
    const database = getHubD1();
    const viewer = await requireHubSessionProfile(request, database);
    const body = await request.json() as { action?: unknown; eventId?: unknown; challengeId?: unknown; nonce?: unknown };
    if (body.action === "create" && typeof body.eventId === "string") {
      return NextResponse.json({ challenge: await createMarketTicketCheckinChallenge(database, viewer.id, body.eventId) }, { status: 201 });
    }
    if (body.action === "redeem" && typeof body.challengeId === "string" && typeof body.nonce === "string") {
      return NextResponse.json({ checkin: await redeemMarketTicketCheckinChallenge(database, viewer.id, body.challengeId, body.nonce) });
    }
    return NextResponse.json({ error: "受付情報が不足しています。" }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "有効な未使用チケットを確認できませんでした。" }, { status: 409 });
  }
}
