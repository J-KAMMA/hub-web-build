import { NextResponse } from "next/server";

import {
  listD1PublicListingReviewQueue,
  reviewD1PublicListing,
} from "@/lib/server/d1-public-listings";
import { getHubD1 } from "@/lib/server/hub-d1";
import { requireSameOrigin } from "@/lib/server/moderation-admin-auth";
import { requireShoppingAdmin } from "@/lib/server/shopping-admin-auth";

export async function GET(request: Request) {
  const denied = requireShoppingAdmin(request);
  if (denied) return denied;
  return NextResponse.json(
    { listings: await listD1PublicListingReviewQueue(getHubD1()) },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function PATCH(request: Request) {
  const denied = requireShoppingAdmin(request) ?? requireSameOrigin(request);
  if (denied) return denied;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const action =
    body?.action === "approve" ||
    body?.action === "reject" ||
    body?.action === "pause"
      ? body.action
      : null;
  if (!action || typeof body?.listingId !== "string") {
    return NextResponse.json({ error: "invalid_review" }, { status: 400 });
  }
  const trustStatus =
    body.trustStatus === "verified" ||
    body.trustStatus === "pending" ||
    body.trustStatus === "not_available"
      ? body.trustStatus
      : undefined;
  const listing = await reviewD1PublicListing(getHubD1(), body.listingId, {
    action,
    trustStatus,
    note: typeof body.note === "string" ? body.note : "",
  });
  return listing
    ? NextResponse.json({ listing })
    : NextResponse.json({ error: "not_found" }, { status: 404 });
}
