import { NextResponse } from "next/server";
import { isAdvertisingEnabled } from "@/lib/advertising";
import { isSafeServeRequest, selectHubAd } from "@/lib/hub-ads";
import { allowHubAdServe } from "@/lib/server/hub-ads-serve-guard";
import { getHubD1 } from "@/lib/server/hub-d1";
import { loadHubAdServeData, recordHubAdOpportunity, recordHubAdServed } from "@/lib/server/d1-hub-ads";
import { createHubAdMeasurementToken, hashHubAdFrequencyBucket } from "@/lib/server/hub-ads-token";

export const dynamic = "force-dynamic";
const FREQUENCY_COOKIE = "hub.ads.frequency";

function cookieValue(request: Request): string | null {
  const value = (request.headers.get("cookie") ?? "").split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${FREQUENCY_COOKIE}=`))?.slice(FREQUENCY_COOKIE.length + 1);
  return value && /^[A-Za-z0-9_-]{16,128}$/.test(value) ? value : null;
}

export async function POST(request: Request) {
  // Advertising is off in production: this unauthenticated endpoint must not exist, let alone write rows.
  if (!isAdvertisingEnabled(process.env.HUB_ADVERTISING_ENABLED)) {
    return new NextResponse(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  // Every successful call inserts opportunity and served rows, so limit each client (hashed CF-Connecting-IP).
  const limit = await allowHubAdServe(request.headers);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(limit.retryAfterSeconds) } });
  }
  if (String(process.env.HUB_ADS_PROVIDER) !== "first-party") {
    return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  }
  const text = await request.text();
  if (text.length > 16_384) return NextResponse.json({ error: "Request is too large." }, { status: 413 });
  let body: unknown;
  try { body = JSON.parse(text); } catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400 }); }
  if (!isSafeServeRequest(body)) return NextResponse.json({ error: "Invalid ad request." }, { status: 400 });

  const rawFrequencyToken = cookieValue(request) ?? crypto.randomUUID();
  const frequencyBucketHash = hashHubAdFrequencyBucket(rawFrequencyToken);
  if (!frequencyBucketHash) return NextResponse.json({ error: "Advertising is not configured." }, { status: 503 });
  try {
    const database = getHubD1();
    const now = Date.now();
    const serveData = await loadHubAdServeData(database, body, frequencyBucketHash, now);
    if(serveData.placement)await recordHubAdOpportunity(database,serveData.placement.id,now);
    const selection = selectHubAd({ ...serveData, request: body, now });
    if (!selection || !serveData.placement) return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
    const tokenId = crypto.randomUUID();
    const token = createHubAdMeasurementToken({ tokenId, requestId: body.requestId, placementId: serveData.placement.id,
      lineItemId: selection.candidate.lineItemId, creativeVersionId: selection.candidate.creativeVersionId,
      issuedAt: now, expiresAt: now + 30 * 60 * 1000 });
    if (!token) return NextResponse.json({ error: "Advertising is not configured." }, { status: 503 });
    await recordHubAdServed(database, { requestId: body.requestId, tokenId, placementId: serveData.placement.id,
      lineItemId: selection.candidate.lineItemId, creativeVersionId: selection.candidate.creativeVersionId,
      frequencyBucketHash, now });
    const imagePath = selection.candidate.imagePath?.startsWith("/api/ads/assets/") ? selection.candidate.imagePath : undefined;
    const response = NextResponse.json({
      ad: { label: "広告", advertiserDisplayName: selection.candidate.advertiserDisplayName,
        headline: selection.candidate.headline, description: selection.candidate.description, imagePath,
        altText: selection.candidate.altText, callToAction: selection.candidate.callToAction,
        clickUrl: `/ads/click/${encodeURIComponent(token)}`, aboutUrl: `/ads/about/${encodeURIComponent(token)}` },
      measurementToken: token,
    }, { headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
    response.cookies.set(FREQUENCY_COOKIE, rawFrequencyToken, { httpOnly: true, maxAge: 60 * 60 * 24 * 7, path: "/",
      sameSite: "lax", secure: new URL(request.url).protocol === "https:" });
    return response;
  } catch {
    return NextResponse.json({ error: "Ad delivery is temporarily unavailable." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
