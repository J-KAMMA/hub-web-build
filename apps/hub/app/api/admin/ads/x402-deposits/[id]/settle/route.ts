import { NextResponse } from "next/server";
import { decodePaymentSignatureHeader, encodePaymentRequiredHeader } from "@x402/core/http";
import { getHubD1 } from "@/lib/server/hub-d1";
import { getHubAdX402PaymentRequired, settleHubAdX402Deposit } from "@/lib/server/hub-ads-x402";
import { requireModerationAdmin, requireSameOrigin } from "@/lib/server/moderation-admin-auth";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireModerationAdmin(request) ?? requireSameOrigin(request); if (denied) return denied;
  const id = (await params).id; const database = getHubD1();
  const signature = request.headers.get("payment-signature") ?? request.headers.get("x-payment");
  if (!signature) {
    const required = await getHubAdX402PaymentRequired(database, id);
    return required ? NextResponse.json({ error: "payment_required" }, { status: 402, headers: { "payment-required": encodePaymentRequiredHeader(required) } })
      : NextResponse.json({ error: "deposit_unavailable" }, { status: 409 });
  }
  let payload: unknown;
  try { payload = decodePaymentSignatureHeader(signature); } catch { return NextResponse.json({ error: "invalid_payment_signature" }, { status: 400 }); }
  const result = await settleHubAdX402Deposit(database, id, payload);
  if (result.ok) return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  const retryAfter = "retryAfterSeconds" in result ? result.retryAfterSeconds : undefined;
  const reconciliationRequired = "reconciliationRequired" in result ? result.reconciliationRequired : undefined;
  const status = result.error === "payment_not_configured" ? 503
    : reconciliationRequired ? 202
      : 409;
  return NextResponse.json({ error: result.error, ...(reconciliationRequired ? { reconciliationRequired } : {}) }, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...(retryAfter ? { "Retry-After": String(retryAfter) } : {}),
    },
  });
}
