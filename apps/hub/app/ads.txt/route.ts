import { isAdvertisingEnabled, normalizeAdSenseClientId } from "@/lib/advertising";

export function GET() {
  if (!isAdvertisingEnabled(process.env.HUB_ADVERTISING_ENABLED) || String(process.env.HUB_ADS_PROVIDER) !== "legacy") {
    return new Response("", { status: 404 });
  }
  const clientId = normalizeAdSenseClientId(process.env.HUB_ADSENSE_CLIENT_ID);
  if (!clientId) return new Response("", { status: 404 });
  return new Response(`google.com, ${clientId.slice(3)}, DIRECT, f08c47fec0942fa0\n`, {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
