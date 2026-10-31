import { NextResponse } from "next/server";

import { parsePublicListingCancellationReason } from "@/lib/public-listings";
import {
  cancelD1PublicEventListing,
  getD1PublicEventListingDetail,
} from "@/lib/server/d1-public-listings";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getHubD1 } from "@/lib/server/hub-d1";
import {
  HubAuthenticationError,
  requireHubSessionProfile,
} from "@/lib/server/hub-session";

type Context = { params: Promise<{ listingId: string }> };

export async function GET(_request: Request, { params }: Context) {
  const { listingId } = await params;
  if (!listingId || listingId.length > 160) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const listing = await getD1PublicEventListingDetail(getHubD1(), listingId);
  return listing
    ? NextResponse.json({ listing }, { headers: { "Cache-Control": "private, no-store" } })
    : NextResponse.json({ error: "not_found" }, { status: 404 });
}

export async function PATCH(request: Request, { params }: Context) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  }
  const reason = parsePublicListingCancellationReason(
    (await request.json().catch(() => null) as { reason?: unknown } | null)?.reason,
  );
  if (!reason) {
    return NextResponse.json({ error: "invalid_cancellation_reason" }, { status: 400 });
  }
  try {
    const { listingId } = await params;
    if (!listingId || listingId.length > 160) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const database = getHubD1();
    const profile = await requireHubSessionProfile(request, database);
    const listing = await cancelD1PublicEventListing(
      database,
      listingId,
      profile.id,
      reason,
    );
    return listing
      ? NextResponse.json({ listing }, { headers: { "Cache-Control": "private, no-store" } })
      : NextResponse.json({ error: "not_found" }, { status: 404 });
  } catch (error) {
    if (error instanceof HubAuthenticationError) {
      return NextResponse.json({ error: "authentication_required" }, { status: 401 });
    }
    return NextResponse.json({ error: "listing_cancellation_failed" }, { status: 503 });
  }
}
