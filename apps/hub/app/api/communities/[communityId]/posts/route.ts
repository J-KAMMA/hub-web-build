import { NextResponse } from "next/server";

import { getHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import { getOptionalHubSessionProfile } from "@/lib/server/hub-session";
import {
  decodeCommunityPostCursor,
  getCommunityPostFeed,
} from "@/lib/server/community-post-feed";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ communityId: string }> },
) {
  const { communityId } = await params;
  const url = new URL(request.url);
  const rawLimit = Number(url.searchParams.get("limit") ?? "20");
  const limit = Number.isFinite(rawLimit) ? rawLimit : 20;
  const rawCursor = url.searchParams.get("cursor");
  const cursor = decodeCommunityPostCursor(rawCursor);
  if (rawCursor && !cursor) {
    return NextResponse.json({ error: "ページ位置が正しくありません。" }, { status: 400 });
  }
  try {
    const database = getHubD1();
    const viewer = await getOptionalHubSessionProfile(request, database);
    const feed = await getCommunityPostFeed(database, {
      communityId,
      limit,
      cursor,
      viewerProfileId: viewer?.id ?? null,
    });
    if (!feed) {
      return NextResponse.json({ error: "Community not found." }, { status: 404 });
    }
    return NextResponse.json(feed, {
      headers: { "Cache-Control": "private, max-age=5, stale-while-revalidate=30", Vary: "Cookie" },
    });
  } catch (error) {
    if (error instanceof HubD1UnavailableError) {
      return NextResponse.json({ error: "Community service is unavailable." }, { status: 503 });
    }
    throw error;
  }
}
