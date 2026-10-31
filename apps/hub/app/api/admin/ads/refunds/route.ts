import { NextResponse } from "next/server";

import { getHubD1 } from "@/lib/server/hub-d1";
import { recordConfirmedHubAdRefund } from "@/lib/server/hub-ads-refunds";
import { requireModerationAdmin, requireSameOrigin } from "@/lib/server/moderation-admin-auth";

export async function POST(request: Request) {
  const denied = requireModerationAdmin(request) ?? requireSameOrigin(request);
  if (denied) return denied;
  const body = await request.json().catch(() => null) as {
    depositId?: unknown;
    amountUsdcAtomic?: unknown;
    reason?: unknown;
    settlementReference?: unknown;
  } | null;
  const result = await recordConfirmedHubAdRefund(getHubD1(), {
    depositId: String(body?.depositId ?? ""),
    amountUsdcAtomic: Number(body?.amountUsdcAtomic),
    reason: String(body?.reason ?? ""),
    settlementReference: String(body?.settlementReference ?? ""),
  });
  if (!result) {
    return NextResponse.json({ error: "refund_rejected" }, {
      status: 409,
      headers: { "Cache-Control": "no-store" },
    });
  }
  return NextResponse.json(result, {
    status: result.replayed ? 200 : 201,
    headers: { "Cache-Control": "no-store" },
  });
}
