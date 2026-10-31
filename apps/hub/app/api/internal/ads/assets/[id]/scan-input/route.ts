import { getHubAdsQuarantine, getHubD1 } from "@/lib/server/hub-d1";
import { readHubAdScanInput } from "@/lib/server/hub-ads-assets";
import { requireHubAdsScanner } from "@/lib/server/hub-ads-scanner-auth";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireHubAdsScanner(request); if (denied) return denied;
  const leaseToken = request.headers.get("x-scan-lease-token") ?? "";
  const object = await readHubAdScanInput(getHubD1(), getHubAdsQuarantine(), (await params).id, leaseToken);
  if (!object) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  return new Response(await object.arrayBuffer(), { headers: {
    "Content-Type": "application/octet-stream", "Content-Length": String(object.size),
    "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
  } });
}
