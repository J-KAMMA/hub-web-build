import { NextResponse } from "next/server";
import { getHubAdsQuarantine, getHubD1 } from "@/lib/server/hub-d1";
import { processHubAdAssetUpload } from "@/lib/server/hub-ads-asset-upload";
import { requireActiveHubAdvertiser } from "@/lib/server/hub-ads-advertiser-auth";
import { requireSameOrigin } from "@/lib/server/moderation-admin-auth";

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  const origin = requireSameOrigin(request); if (origin) return origin;
  const database = getHubD1();
  const actor = await requireActiveHubAdvertiser(request, database);
  if (!actor) return NextResponse.json({ error: "active_advertiser_required" }, { status: 403, headers: NO_STORE });
  if (Number(request.headers.get("content-length") ?? 0) > 5 * 1024 * 1024 + 65_536) {
    return NextResponse.json({ error: "asset_too_large" }, { status: 413, headers: NO_STORE });
  }
  const form = await request.formData().catch(() => new FormData());
  const file = form.get("file");
  if (!(file instanceof File) || file.type !== "image/png" || file.size < 1 || file.size > 5 * 1024 * 1024) {
    return NextResponse.json({ error: "png_required" }, { status: 400, headers: NO_STORE });
  }
  const result = await processHubAdAssetUpload(database, getHubAdsQuarantine(), {
    scope: `advertiser.asset.upload.atomic:v1:${actor.advertiserRef}`,
    idempotencyKey: request.headers.get("Idempotency-Key"),
    advertiserRef: actor.advertiserRef,
    bytes: new Uint8Array(await file.arrayBuffer()),
  });
  if (result.kind === "response") {
    return NextResponse.json(result.body, { status: result.status, headers: NO_STORE });
  }
  if (result.kind === "conflict") return NextResponse.json({ error: result.reason }, {
    status: result.reason === "invalid_key" ? 400 : 409, headers: NO_STORE,
  });
  return NextResponse.json({ error: "asset_upload_unconfirmed", retryWithSameKey: true }, {
    status: 503, headers: NO_STORE,
  });
}
