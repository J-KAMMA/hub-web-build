import "server-only";

import {
  createHubSearchCursor,
  emptyHubSearchCursorBoundaries,
  getHubSearchCatalogVersion,
  HUB_SEARCH_CURSOR_PAGE_SIZE,
  pageHubSearchEntities,
  type HubSearchCursorEntity,
  type HubSearchCursorOrder,
} from "./search-cursor";
import type { HubSearchCatalogRevision } from "./search-catalog-revision";
import type { HubSearchFilters } from "@/lib/search-filters";

type CursorableSearchData = {
  query: string;
  coreEntities: HubSearchCursorEntity[];
  counts?: Readonly<Record<string, number>> | null;
};

export type HubSearchInitialPageOptions = {
  viewerProfileId: string | null;
  filters?: HubSearchFilters;
  order: HubSearchCursorOrder;
  durableRevision: HubSearchCatalogRevision | null;
};

/**
 * Keep a server-rendered search page on the same signed-cursor contract as
 * `/api/search`. Without this boundary, an SSR page would render every
 * capped candidate but could not continue to the next page.
 */
export function prepareHubSearchInitialPage<T extends CursorableSearchData>(
  data: T,
  options: HubSearchInitialPageOptions,
): T & { coreEntities: HubSearchCursorEntity[]; nextCursor?: string; hasMore?: boolean } {
  const candidateVersion = getHubSearchCatalogVersion(data.coreEntities, null, data.counts);
  if (!candidateVersion || !options.durableRevision) return data;

  const catalogVersion = getHubSearchCatalogVersion(
    data.coreEntities,
    JSON.stringify(options.durableRevision),
    data.counts,
  );
  if (!catalogVersion) return data;

  const page = pageHubSearchEntities(
    data.coreEntities,
    emptyHubSearchCursorBoundaries(),
    HUB_SEARCH_CURSOR_PAGE_SIZE,
  );
  if (!page) return data;

  const nextCursor = page.hasMore
    ? createHubSearchCursor({
        query: data.query,
        viewerProfileId: options.viewerProfileId,
        filters: options.filters,
        boundaries: page.boundaries,
        order: options.order,
        catalogVersion,
      })
    : null;

  /* A failed signature must never advertise a continuation the client cannot verify. */
  if (page.hasMore && !nextCursor) return data;

  return {
    ...data,
    coreEntities: page.entities,
    ...(nextCursor ? { nextCursor, hasMore: true } : { hasMore: false }),
  };
}
