import { NextResponse } from "next/server";

import { parsePublicListingInput, parsePublicListingKind } from "@/lib/public-listings";
import {
  createD1PublicListing,
  listD1OwnedPublicListings,
  listD1PublicListings,
} from "@/lib/server/d1-public-listings";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getHubD1 } from "@/lib/server/hub-d1";
import { readListPagination } from "@/lib/server/list-pagination";
import {
  HubAuthenticationError,
  requireHubSessionProfile,
} from "@/lib/server/hub-session";

const privateHeaders = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  const url = new URL(request.url);
  const kindValue = url.searchParams.get("kind");
  const parsedKind = kindValue ? parsePublicListingKind(kindValue) : null;
  if (kindValue && !parsedKind) {
    return NextResponse.json({ error: "invalid_kind" }, { status: 400 });
  }
  if (url.searchParams.get("mine") === "1") {
    if (parsedKind !== "events") {
      return NextResponse.json({ error: "invalid_owner_listing_kind" }, { status: 400 });
    }
    try {
      const database = getHubD1();
      const profile = await requireHubSessionProfile(request, database);
      const listings = await listD1OwnedPublicListings(database, profile.id, parsedKind);
      return NextResponse.json({ listings }, { headers: privateHeaders });
    } catch (error) {
      if (error instanceof HubAuthenticationError) {
        return NextResponse.json({ error: "authentication_required" }, { status: 401 });
      }
      return NextResponse.json({ error: "owner_listings_unavailable" }, { status: 503 });
    }
  }
  const { limit, offset } = readListPagination(url, { defaultLimit: 30 });
  const query = (url.searchParams.get("q") ?? "").trim();
  if (query.length > 100 || query.split(/\s+/u).length > 8) return NextResponse.json({ error: "invalid_query" }, { status: 400 });
  const listings = await listD1PublicListings(getHubD1(), {
    limit: limit + 1, offset,
    kind: parsedKind ?? undefined,
    query,
    region: url.searchParams.get("region") ?? undefined,
  });
  return NextResponse.json({ listings: listings.slice(0, limit), limit, offset, hasMore: listings.length > limit }, { headers: privateHeaders });
}

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  }
  try {
    const database = getHubD1();
    const profile = await requireHubSessionProfile(request, database);
    const input = parsePublicListingInput(await request.json().catch(() => null));
    if (!input) {
      return NextResponse.json({ error: "invalid_listing" }, { status: 400 });
    }
    const listing = await createD1PublicListing(database, profile.id, input);
    return NextResponse.json({ listing }, { status: 201, headers: privateHeaders });
  } catch (error) {
    if (error instanceof HubAuthenticationError) {
      return NextResponse.json({ error: "authentication_required" }, { status: 401 });
    }
    return NextResponse.json({ error: "listing_create_failed" }, { status: 500 });
  }
}
