import { NextResponse } from "next/server";
import { getHubAdsQuarantine, getHubD1 } from "@/lib/server/hub-d1";
import { processHubAdAssetUpload } from "@/lib/server/hub-ads-asset-upload";
import { listHubAdAssets, parseHubAdAssetUpload } from "@/lib/server/hub-ads-assets";
import { requireModerationAdmin, requireSameOrigin } from "@/lib/server/moderation-admin-auth";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const denied = requireModerationAdmin(request); if (denied) return denied;
  return NextResponse.json({ assets: await listHubAdAssets(getHubD1()) }, { headers: NO_STORE });
}

export async function POST(request: Request) {
  const denied = requireModerationAdmin(request) ?? requireSameOrigin(request); if (denied) return denied;
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 5 * 1024 * 1024 + 64 * 1024) return NextResponse.json(
    { error: "PNGは5MB以下にしてください。" }, { status: 413, headers: NO_STORE },
  );
  const parsed = parseHubAdAssetUpload(await request.formData().catch(() => new FormData()));
  if (!parsed) return NextResponse.json(
    { error: "広告主参照IDと5MB以下のPNGが必要です。" }, { status: 400, headers: NO_STORE },
  );
  const result = await processHubAdAssetUpload(getHubD1(), getHubAdsQuarantine(), {
    scope: "admin.asset.upload.atomic:v1",
    idempotencyKey: request.headers.get("Idempotency-Key"),
    advertiserRef: parsed.advertiserRef,
    bytes: new Uint8Array(await parsed.file.arrayBuffer()),
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
