import { NextRequest, NextResponse } from "next/server";

import { IMAGE_PAGE_SIZE } from "@/lib/image-search";
import { searchHubImages, type HubImageSource } from "@/lib/server/d1-image-search";
import { getOptionalHubViewerProfile } from "@/lib/server/desktop-hub-auth";
import { getHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";

const HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" };

/*
 * 画像検索の Hub 内の出どころ。?source=hub|remote、?cursor= は前の応答の nextCursor をそのまま返す。
 * ?similarTo=<投稿ID> は、その投稿とタグを共有する投稿の画像 (hub のみ)。
 * 外部 (Openverse / Commons) はここを通らず、ブラウザが直接呼ぶ。
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const source: HubImageSource = params.get("source") === "remote" ? "remote" : "hub";
  const query = (params.get("q") ?? "").trim().slice(0, 100);
  const similarTo = (params.get("similarTo") ?? "").slice(0, 200);
  try {
    const database = getHubD1();
    const viewer = await getOptionalHubViewerProfile(request, database);
    const page = await searchHubImages(database, source, {
      query,
      viewerId: viewer?.id ?? null,
      cursor: params.get("cursor"),
      limit: IMAGE_PAGE_SIZE,
      similarToPostId: source === "hub" && similarTo ? similarTo : undefined,
    });
    if (!page) return NextResponse.json({ error: "cursor_invalid" }, { status: 400, headers: HEADERS });
    return NextResponse.json(page, { headers: HEADERS });
  } catch (error) {
    if (error instanceof HubD1UnavailableError) return NextResponse.json({ error: "search_unavailable" }, { status: 503, headers: HEADERS });
    return NextResponse.json({ error: "search_failed" }, { status: 500, headers: HEADERS });
  }
}
