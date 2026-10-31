import { NextRequest, NextResponse } from "next/server";
import { hasHubSearchFilters, parseHubSearchFilters } from "@/lib/search-filters";

import { getD1SearchRouteData } from "@/lib/server/d1-search-route-data";
import { getD1SearchExtras } from "@/lib/server/d1-search-extras";
import type { SearchExtras } from "@/lib/search-extras";
import { getD1SearchCatalogRevision } from "@/lib/server/search-catalog-revision";
import { getHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import { getOptionalHubSessionProfile } from "@/lib/server/hub-session";
import {
  HUB_SEARCH_CURSOR_PAGE_SIZE,
  createHubSearchCursor,
  emptyHubSearchCursorBoundaries,
  getHubSearchCatalogVersion,
  pageHubSearchEntities,
  verifyHubSearchCursor,
  type HubSearchCursorOrder,
} from "@/lib/server/search-cursor";

function normalize(value: string) {
  return value.normalize("NFKC").trim().toLocaleLowerCase("ja").slice(0, 100);
}

export async function GET(request: NextRequest) {
  const query = normalize(request.nextUrl.searchParams.get("q") ?? "");
  const parsedFilters = parseHubSearchFilters(request.nextUrl.searchParams);
  if (!parsedFilters.ok) {
    return NextResponse.json(
      { error: "search_filters_invalid" },
      { status: 400, headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } },
    );
  }
  const filters = parsedFilters.filters;
  const requestedCursor = request.nextUrl.searchParams.get("cursor");
  const cursorMode = requestedCursor !== null || request.nextUrl.searchParams.get("cursorMode") === "1";
  const order: HubSearchCursorOrder = request.nextUrl.searchParams.get("order") === "kind" ? "kind" : "recommended";
  const startedAt = performance.now();

  let data;
  let database: ReturnType<typeof getHubD1>;
  let viewerProfileId: string | null = null;
  try {
    database = getHubD1();
    const viewer = await getOptionalHubSessionProfile(request, database);
    data = hasHubSearchFilters(filters)
      ? await getD1SearchRouteData(query, viewer?.id ?? null, filters)
      : await getD1SearchRouteData(query, viewer?.id ?? null);
    viewerProfileId = viewer?.id ?? null;
  } catch (error) {
    if (error instanceof HubD1UnavailableError) {
      return NextResponse.json(
        { error: "search_unavailable" },
        {
          status: 503,
          headers: {
            "Cache-Control": "private, no-store",
            "Vary": "Cookie",
          },
        },
      );
    }
    throw error;
  }

  /*
   * Articles, music, tags and tag-matched items sit beside the core entities. They are read once,
   * on the first page of an unfiltered search; a continuation page and a filtered search skip them.
   */
  let extras: SearchExtras | undefined;
  if (requestedCursor === null && query && !hasHubSearchFilters(filters)) {
    try {
      extras = await getD1SearchExtras(database, {
        query,
        viewerId: viewerProfileId,
        profileIds: (data.profiles ?? []).map((profile) => profile.id),
        postIds: (data.posts ?? []).map((post) => post.id),
      });
    } catch {
      extras = undefined;
    }
  }

  /*
   * Cursor mode is opt-in so existing clients retain the original response.
   * The snapshot digest detects any candidate or ranking change between pages;
   * returning a partial page after that change would risk gaps or duplicates.
   */
  if (cursorMode) {
    /*
     * The candidate digest protects ranking/title changes in the response;
     * the D1 revision also covers public catalog rows outside the capped
     * candidate lists. If either source cannot be read, no continuation is
     * issued and an existing cursor is rejected.
     */
    const candidateSnapshotVersion = getHubSearchCatalogVersion(data.coreEntities, null, data.counts);
    const durableRevision = candidateSnapshotVersion
      ? await getD1SearchCatalogRevision(database)
      : null;
    const catalogVersion = candidateSnapshotVersion && durableRevision
      ? getHubSearchCatalogVersion(data.coreEntities, JSON.stringify(durableRevision), data.counts)
      : null;
    if (requestedCursor !== null) {
      if (!catalogVersion) {
        return NextResponse.json(
          { error: "search_cursor_invalid" },
          { status: 400, headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } },
        );
      }
      const cursor = verifyHubSearchCursor(requestedCursor, {
        query,
        viewerProfileId,
        filters,
        order,
        catalogVersion,
      });
      if (!cursor) {
        return NextResponse.json(
          { error: "search_cursor_invalid" },
          { status: 400, headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } },
        );
      }
      const pageResult = pageHubSearchEntities(data.coreEntities, cursor.boundaries, HUB_SEARCH_CURSOR_PAGE_SIZE);
      if (!pageResult) {
        return NextResponse.json(
          { error: "search_cursor_invalid" },
          { status: 400, headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } },
        );
      }
      const nextCursor = pageResult.hasMore
        ? createHubSearchCursor({
            query,
            viewerProfileId,
            filters,
            boundaries: pageResult.boundaries,
            order,
            catalogVersion,
          })
        : null;
      data = {
        ...data,
        coreEntities: pageResult.entities,
        nextCursor,
        hasMore: Boolean(nextCursor),
      };
    } else if (catalogVersion) {
      const pageResult = pageHubSearchEntities(
        data.coreEntities,
        emptyHubSearchCursorBoundaries(),
        HUB_SEARCH_CURSOR_PAGE_SIZE,
      );
      if (!pageResult) {
        return NextResponse.json(
          { error: "search_cursor_invalid" },
          { status: 400, headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } },
        );
      }
      const nextCursor = pageResult.hasMore
        ? createHubSearchCursor({
            query,
            viewerProfileId,
            filters,
            boundaries: pageResult.boundaries,
            order,
            catalogVersion,
          })
        : null;
      data = {
        ...data,
        coreEntities: pageResult.entities,
        nextCursor,
        hasMore: Boolean(nextCursor),
      };
    }
  }
  const durationMs = Math.max(0, performance.now() - startedAt);
  const response = NextResponse.json(extras ? { ...data, extras } : data);
  response.headers.set("Server-Timing", `hub-search;dur=${durationMs.toFixed(1)}`);
  response.headers.set("X-Hub-Search-Duration-Ms", durationMs.toFixed(1));
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Vary", "Cookie");
  return response;
}
