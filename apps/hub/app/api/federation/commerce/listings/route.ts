import { NextResponse } from "next/server";

import { FederatedCommerceError, discoverFederatedListing } from "@/lib/server/federated-commerce";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (!query || query.length > 512) return NextResponse.json({ error: "invalid_query" }, { status: 400 });
  try {
    const listing = await discoverFederatedListing(query);
    return NextResponse.json({ listing }, { headers: { "Cache-Control": "public, max-age=30, stale-while-revalidate=120" } });
  } catch (error) {
    const code = error instanceof FederatedCommerceError ? error.code : "unavailable";
    const status = code === "unsafe_url" || code === "invalid_listing" || code === "seller_mismatch" ? 400 : 502;
    return NextResponse.json({ error: code }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
