import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type DemoCommerceIds = {
  buyer_account_id?: string;
  seller_account_id?: string;
  address_id?: string;
};

export async function POST(request: Request) {
  const url = new URL(request.url);
  if (
    process.env.NODE_ENV === "production" ||
    !["localhost", "127.0.0.1"].includes(url.hostname)
  ) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const body = (await request.json().catch(() => null)) as {
    productId?: unknown;
    fulfillmentMode?: unknown;
  } | null;
  const productId = typeof body?.productId === "string" ? body.productId : "";
  const fulfillmentMode =
    typeof body?.fulfillmentMode === "string" ? body.fulfillmentMode : "";
  if (!UUID_RE.test(productId)) {
    return NextResponse.json({ error: "invalid_product" }, { status: 400 });
  }
  if (!["seller_shipping", "platform_3pl"].includes(fulfillmentMode)) {
    return NextResponse.json(
      { error: "invalid_fulfillment_mode" },
      { status: 400 },
    );
  }
  const identityOrigin = (
    process.env.IDENTITY_API_ORIGIN ?? "http://127.0.0.1:8123"
  ).replace(/\/+$/, "");
  try {
    const demoResponse = await fetch(`${identityOrigin}/demo`, {
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    const demo = (await demoResponse.json().catch(() => null)) as {
      commerce?: DemoCommerceIds;
    } | null;
    const ids = demo?.commerce;
    if (
      !demoResponse.ok ||
      !ids?.buyer_account_id ||
      !ids.seller_account_id ||
      !ids.address_id
    ) {
      return NextResponse.json(
        { error: "identity_demo_unavailable" },
        { status: 503 },
      );
    }
    const quoteResponse = await fetch(`${identityOrigin}/orders/quote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
      body: JSON.stringify({
        buyer_account_id: ids.buyer_account_id,
        seller_account_id: ids.seller_account_id,
        product_id: productId,
        address_id: ids.address_id,
        payment_method: "JPYC",
        fulfillment_mode: fulfillmentMode,
      }),
    });
    const quote = (await quoteResponse.json().catch(() => null)) as {
      decision?: string;
      reason_code?: string;
      commerce_fulfillment_assertion?: string;
      fulfillment_mode?: string;
      destination_zone?: string;
      error?: string;
    } | null;
    if (!quoteResponse.ok || !quote) {
      return NextResponse.json(
        { error: quote?.error ?? "identity_quote_unavailable" },
        { status: 502 },
      );
    }
    if (quote.decision !== "allow" || !quote.commerce_fulfillment_assertion) {
      return NextResponse.json(
        { error: quote.reason_code ?? "identity_quote_blocked" },
        { status: 422 },
      );
    }
    return NextResponse.json(
      {
        assertion: quote.commerce_fulfillment_assertion,
        fulfillmentMode: quote.fulfillment_mode,
        destinationZone: quote.destination_zone,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "identity_quote_unavailable" },
      { status: 503 },
    );
  }
}
