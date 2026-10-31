import { NextResponse } from "next/server";

import { getSimilarBbsThreadsRouteData } from "@/lib/server/bbs-route-data";

export async function GET(request: Request) {
  const title = new URL(request.url).searchParams.get("title") ?? "";
  return NextResponse.json(await getSimilarBbsThreadsRouteData(title), {
    headers: { "Cache-Control": "private, max-age=15" },
  });
}
