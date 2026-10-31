import { NextResponse } from "next/server";

import { createD1ExternalVideo, ExternalVideoAlreadyExistsError, listD1AuthorHubVideosPage, listD1ExternalVideosPage } from "@/lib/server/d1-videos";
import { encodeWorkCursor, findListableAuthorId, PROFILE_WORKS_PAGE, readAuthorListQuery } from "@/lib/server/profile-works";
import { getHubD1 } from "@/lib/server/hub-d1";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";
import { InvalidVideoContextError, parseVideoContextInput } from "@/lib/video-context";
import { InvalidVideoSourceError, parseExternalVideoInput } from "@/lib/video-source";
import { lookupExternalVideoMetadata } from "@/lib/server/video-metadata";
import { readListPagination } from "@/lib/server/list-pagination";
import { publicApiCacheHeaders } from "@/lib/server/public-api-cache";

/**
 * ?author=<handle>&cursor=<base64url>: one author's Hub-made videos for the profile tab. Only
 * what the public lists already show (published, public, not held, not age-restricted).
 */
async function authorVideosResponse(url: URL) {
  const query = readAuthorListQuery(url, "author");
  if (!query) return NextResponse.json({ error: "invalid_query" }, { status: 400 });
  try {
    const database = getHubD1();
    const authorId = await findListableAuthorId(database, query.handle);
    if (!authorId) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const page = await listD1AuthorHubVideosPage(database, authorId, { limit: PROFILE_WORKS_PAGE, before: query.cursor });
    return NextResponse.json(
      { videos: page.videos, nextCursor: page.nextCursor ? encodeWorkCursor(page.nextCursor) : null },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.has("author")) return authorVideosResponse(url);
  const { limit, offset } = readListPagination(url);
  const query = (url.searchParams.get("q") ?? "").trim();
  const category = (url.searchParams.get("category") ?? "").trim();
  const order = url.searchParams.get("order") ?? "recent";
  if (query.length > 100 || query.split(/\s+/u).length > 8 || category.length > 100 || !["recent", "popular", "live"].includes(order)) {
    return NextResponse.json({ error: "検索語は100文字・8語以内で指定してください。" }, { status: 400 });
  }
  const page = await listD1ExternalVideosPage(getHubD1(), limit, offset, { query, category, order });
  return NextResponse.json(
    { ...page, limit, offset, hasMore: offset + page.videos.length < page.total },
    { headers: publicApiCacheHeaders(request, "videos.catalog") },
  );
}

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });

  let input;
  try {
    const body = await request.json().catch(() => null);
    input = { ...parseExternalVideoInput(body), ...parseVideoContextInput(body) };
  } catch (error) {
    if (error instanceof InvalidVideoSourceError || error instanceof InvalidVideoContextError || error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (input.source.storedProvider === "youtube") {
    return NextResponse.json({
      error: "YouTube動画の登録は終了しました。",
    }, { status: 410 });
  }

  try {
    const database = getHubD1();
    const viewer = await requireHubSessionProfile(request, database);
    const metadata = await lookupExternalVideoMetadata(input.source.sourceUrl);
    const video = await createD1ExternalVideo(database, viewer, {
      ...input,
      source: {
        ...input.source,
        thumbnailUrl: metadata.thumbnailUrl ?? input.source.thumbnailUrl,
      },
    });
    return NextResponse.json({ video, message: "動画をカタログに追加しました。" }, { status: 201 });
  } catch (error) {
    if (error instanceof HubAuthenticationError) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
    if (error instanceof ExternalVideoAlreadyExistsError) return NextResponse.json({ error: error.message }, { status: 409 });
    console.error(JSON.stringify({
      event: "external_video_create_failed",
      status: "internal_error",
    }));
    return NextResponse.json({ error: "動画を追加できませんでした。" }, { status: 500 });
  }
}
