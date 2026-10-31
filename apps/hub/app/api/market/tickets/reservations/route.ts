import { NextResponse } from "next/server";

import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getHubD1 } from "@/lib/server/hub-d1";
import { requireHubSessionProfile } from "@/lib/server/hub-session";
import {
  holdMarketTickets,
  listMarketTicketReservations,
  requestMarketTicketRefund,
} from "@/lib/server/market-tickets";

export async function GET(request: Request) {
  try {
    const database = getHubD1();
    const viewer = await requireHubSessionProfile(request, database);
    const reservations = await listMarketTicketReservations(database, viewer.id);
    return NextResponse.json({ reservations });
  } catch {
    return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
  }
}

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "不正なリクエストです。" }, { status: 403 });
  try {
    const database = getHubD1();
    const viewer = await requireHubSessionProfile(request, database);
    const reservation = await holdMarketTickets(database, viewer.id, await request.json() as Record<string, unknown>);
    return NextResponse.json({ reservation }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    return NextResponse.json({ error: code === "ticket_sold_out" ? "選択したチケットは売り切れました。"
      : "現在このチケットを確保できません。" }, { status: 409 });
  }
}

export async function DELETE(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "不正なリクエストです。" }, { status: 403 });
  try {
    const database = getHubD1();
    const viewer = await requireHubSessionProfile(request, database);
    const body = await request.json() as { reservationId?: unknown };
    if (typeof body.reservationId !== "string" || !body.reservationId) {
      return NextResponse.json({ error: "申込を確認できません。" }, { status: 400 });
    }
    const refund = await requestMarketTicketRefund(database, viewer.id, body.reservationId);
    return NextResponse.json({ refund });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    const message = code === "ticket_refund_closed"
      ? "イベント開始後はこの画面から返金を申請できません。"
      : code === "ticket_refund_unavailable"
        ? "現在、このチケットは返金を申請できません。"
        : "申込を確認できません。";
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
