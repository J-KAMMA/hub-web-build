import { NextResponse } from "next/server";

import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getHubD1 } from "@/lib/server/hub-d1";
import { requireHubSessionProfile } from "@/lib/server/hub-session";
import { createMarketTicketEvent, listMarketTicketEvents } from "@/lib/server/market-tickets";

export async function GET() {
  return NextResponse.json({ events: await listMarketTicketEvents(getHubD1()) });
}

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "不正なリクエストです。" }, { status: 403 });
  try {
    const database = getHubD1();
    const viewer = await requireHubSessionProfile(request, database);
    const event = await createMarketTicketEvent(database, viewer.id, await request.json() as Record<string, unknown>);
    return NextResponse.json({ event }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error && error.message === "invalid_ticket_event"
      ? "イベント、販売期間、券種、在庫を確認してください。" : "イベントを登録できませんでした。" }, { status: 400 });
  }
}

