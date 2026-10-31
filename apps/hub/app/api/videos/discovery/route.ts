import { NextResponse } from "next/server";

import {
  listD1ExternalVideosByIds,
  listD1VideoDiscoveryPage,
} from "@/lib/server/d1-videos";
import { getHubD1 } from "@/lib/server/hub-d1";

const NO_STORE_HEADERS = { "cache-control": "private, no-store" };

function isBoundedId(value: string): boolean {
  return value.length > 0 && value.length <= 100 && /^[\x21-\x7e]+$/.test(value);
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const rawIds = params.getAll("id");
  const cursor = params.get("after");
  const unknownParameter = [...new Set([...params.keys()])].find((key) => key !== "id" && key !== "after");

  if (unknownParameter || rawIds.length > 30 || (rawIds.length > 0 && rawIds.some((id) => !isBoundedId(id)))) {
    return NextResponse.json({ error: "Invalid video id." }, { status: 400, headers: NO_STORE_HEADERS });
  }
  if (params.getAll("after").length > 1 || (cursor !== null && (!isBoundedId(cursor) || rawIds.length > 0))) {
    return NextResponse.json({ error: "Invalid cursor." }, { status: 400, headers: NO_STORE_HEADERS });
  }

  try {
    const database = getHubD1();
    if (rawIds.length > 0) {
      const ids = [...new Set(rawIds)];
      const videos = await listD1ExternalVideosByIds(database, ids);
      return NextResponse.json({ videos }, { headers: NO_STORE_HEADERS });
    }
    const page = await listD1VideoDiscoveryPage(database, cursor ?? undefined);
    return NextResponse.json(page, { headers: NO_STORE_HEADERS });
  } catch {
    return NextResponse.json({ error: "Video discovery is temporarily unavailable." }, {
      status: 503,
      headers: NO_STORE_HEADERS,
    });
  }
}
