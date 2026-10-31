import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    {
      error: "refund_verification_owned_by_commerce",
      replacement: "commerce_hub_token_refund_outbox",
    },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
}
