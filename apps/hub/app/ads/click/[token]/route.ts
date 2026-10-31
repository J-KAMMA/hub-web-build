import { NextResponse } from "next/server";
import { validateLandingUrl } from "@/lib/hub-ads";
import { getHubD1 } from "@/lib/server/hub-d1";
import { getHubAdClickDestination, recordHubAdMeasurement } from "@/lib/server/d1-hub-ads";
import { createHubAdAttributionToken } from "@/lib/server/hub-ads-conversion";
import { verifyHubAdMeasurementToken } from "@/lib/server/hub-ads-token";

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const payload = verifyHubAdMeasurementToken((await params).token);
  if (!payload) return NextResponse.json({ error: "Invalid or expired ad link." }, { status: 400 });
  const database = getHubD1();
  const destination = await getHubAdClickDestination(database, payload.creativeVersionId, payload.lineItemId);
  const landingUrl = validateLandingUrl(destination?.landingUrl ?? "");
  if (!landingUrl) return NextResponse.json({ error: "This ad is no longer available." }, { status: 410 });
  await recordHubAdMeasurement(database, payload, "clicked", Date.now());
  const attribution = destination && createHubAdAttributionToken({ campaignId: destination.campaignId, lineItemId: payload.lineItemId, creativeVersionId: payload.creativeVersionId });
  if (attribution) landingUrl.searchParams.set("hub_ad_attribution", attribution);
  return NextResponse.redirect(landingUrl, { status: 302, headers: { "Cache-Control": "no-store", "Referrer-Policy": "strict-origin-when-cross-origin" } });
}
