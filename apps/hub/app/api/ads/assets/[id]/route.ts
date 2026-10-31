import { getHubAdsAssets, getHubD1 } from "@/lib/server/hub-d1";
import { getCleanHubAdAssetKey } from "@/lib/server/hub-ads-assets";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const key = await getCleanHubAdAssetKey(getHubD1(), (await params).id);
  if (!key) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  const object = await getHubAdsAssets().get(key);
  if (!object) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  return new Response(await object.arrayBuffer(), { headers: {
    "Content-Type": "image/png", "Content-Length": String(object.size), "ETag": object.httpEtag,
    "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
  } });
}
