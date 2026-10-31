import { NextResponse } from "next/server";

import { federationActorUrl } from "@/lib/platform/external-protocols";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getHubD1 } from "@/lib/server/hub-d1";
import { HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";
import {
  FederatedCommerceError,
  discoverFederatedListing,
  requestFederatedQuote,
  verifyFederatedQuote,
} from "@/lib/server/federated-commerce";

export const dynamic = "force-dynamic";

function failure(error: unknown) {
  if (error instanceof HubAuthenticationError) return NextResponse.json({ error: "authentication_required" }, { status: 401 });
  const code = error instanceof FederatedCommerceError ? error.code : "unavailable";
  const status = code === "unsafe_url" || code === "invalid_listing" || code === "invalid_quote" || code === "invalid_signature" || code === "seller_mismatch" ? 400 : 502;
  return NextResponse.json({ error: code }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  try {
    await requireHubSessionProfile(request, getHubD1());
    const body = await request.json().catch(() => null) as { quote?: unknown } | null;
    const quote = await verifyFederatedQuote(body?.quote);
    return NextResponse.json({ quote, verified: true }, { headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  try {
    const profile = await requireHubSessionProfile(request, getHubD1());
    const body = await request.json().catch(() => null) as { listingUrl?: unknown; quantity?: unknown; route?: unknown } | null;
    if (typeof body?.listingUrl !== "string" || !Number.isInteger(body.quantity) || Number(body.quantity) < 1 || Number(body.quantity) > 100) {
      return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    }
    const route = body.route === "direct" ? "direct" : "hub-referral";
    const origin = new URL(request.url).origin;
    if (!origin.startsWith("https://")) return NextResponse.json({ error: "federation_public_origin_required" }, { status: 409 });
    const listing = await discoverFederatedListing(body.listingUrl);
    const buyerActor = federationActorUrl(origin, profile.handle);
    const quote = await requestFederatedQuote({ listing, buyerActor, quantity: Number(body.quantity), route });
    return NextResponse.json({ listing, quote, reservedUntil: quote.reservedUntil }, { status: 201, headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
  } catch (error) {
    return failure(error);
  }
}
