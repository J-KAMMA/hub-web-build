import { NextResponse } from "next/server";
import { getHubD1 } from "@/lib/server/hub-d1";
import { createHubAdX402Deposit } from "@/lib/server/hub-ads-x402";
import { requireModerationAdmin, requireSameOrigin } from "@/lib/server/moderation-admin-auth";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireModerationAdmin(request) ?? requireSameOrigin(request); if (denied) return denied;
  const body = await request.json().catch(() => null) as { advertiserRef?: unknown; amountJpyMicros?: unknown } | null;
  if (typeof body?.advertiserRef !== "string" || !Number.isSafeInteger(body.amountJpyMicros)) return NextResponse.json({ error: "invalid_deposit" }, { status: 400 });
  const quote = await createHubAdX402Deposit(getHubD1(), (await params).id, body.advertiserRef, Number(body.amountJpyMicros));
  return quote ? NextResponse.json({ quote }, { status: 201, headers: { "Cache-Control": "no-store" } })
    : NextResponse.json({ error: "deposit_unavailable" }, { status: 409 });
}

