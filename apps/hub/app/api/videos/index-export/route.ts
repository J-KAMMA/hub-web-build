import { NextResponse } from "next/server";
import { listDistributedVideos } from "@/lib/server/distributed-videos";
import { getHubD1 } from "@/lib/server/hub-d1";
import { publicApiCacheHeaders } from "@/lib/server/public-api-cache";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") ?? 50) || 50));
  const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0) || 0);
  const entries = await listDistributedVideos(getHubD1(), limit, offset);
  return NextResponse.json({
    type: "https://hub.jkamma.com/spec/video-index/v1",
    generatedAt: new Date().toISOString(),
    entries: entries.map(({ streams, captions, ...entry }) => ({
      ...entry,
      streams: streams.map(({ url: _url, ...stream }) => stream),
      captionLanguages: [...new Set(captions.map((caption) => caption.language))],
    })),
    pagination: { limit, offset, nextOffset: entries.length === limit ? offset + limit : null },
  }, { headers: publicApiCacheHeaders(request, "videos.index-export") });
}
