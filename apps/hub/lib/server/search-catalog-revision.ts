import "server-only";

import type { D1Database } from "@cloudflare/workers-types";

import { publicVideoOriginSql } from "./video-public-origin";

/**
 * A durable, public-catalog revision for cursor validation.
 *
 * The search response is intentionally capped per source. These small
 * aggregates bind the cursor to the underlying public catalog as well, so a
 * change outside the first visible candidates cannot silently alter a later
 * continuation. The values are only fed into the cursor HMAC and are never
 * returned to the browser.
 */
export type HubSearchCatalogRevision = {
  version: 1;
  sources: Record<
    "videos" | "tokens" | "work" | "listings",
    {
      count: number;
      latest: string;
      newestId: string;
    }
  >;
};

type RevisionRow = {
  count: number | string | null;
  latest: string | null;
  newest_id: string | null;
};

const emptyRow = (): RevisionRow => ({ count: 0, latest: "", newest_id: "" });

function normalizeRow(row: RevisionRow | null | undefined): {
  count: number;
  latest: string;
  newestId: string;
} {
  const count = Number(row?.count ?? 0);
  return {
    count: Number.isSafeInteger(count) && count >= 0 ? count : 0,
    latest: typeof row?.latest === "string" ? row.latest : "",
    newestId: typeof row?.newest_id === "string" ? row.newest_id : "",
  };
}

/**
 * Read only public rows and their change markers. A failed read returns null;
 * callers must then withhold a continuation cursor rather than guessing that
 * the catalog is unchanged.
 */
export async function getD1SearchCatalogRevision(
  database: D1Database,
): Promise<HubSearchCatalogRevision | null> {
  try {
    const [videos, tokens, work, listings] = await Promise.all([
      database
        .prepare(
          `SELECT COUNT(*) AS count,
              MAX(max(COALESCE(metadata_checked_at, ''), COALESCE(published_at, ''), COALESCE(created_at, ''))) AS latest,
              MAX(id) AS newest_id
           FROM external_videos v
           WHERE status = 'active' AND ${publicVideoOriginSql("v")}`,
        )
        .first<RevisionRow>(),
      database
        .prepare(
          `SELECT COUNT(*) AS count,
              MAX(max(COALESCE(last_synced_at, ''), COALESCE(last_verified_at, ''), COALESCE(created_at, ''))) AS latest,
              MAX(id) AS newest_id
           FROM token_rankings`,
        )
        .first<RevisionRow>(),
      database
        .prepare(
          `SELECT COUNT(*) AS count, MAX(updated_at) AS latest, MAX(id) AS newest_id
           FROM work_listings
           WHERE status = 'published'`,
        )
        .first<RevisionRow>(),
      database
        .prepare(
          `SELECT COUNT(*) AS count, MAX(updated_at) AS latest, MAX(id) AS newest_id
           FROM public_listings
           WHERE status = 'published'`,
        )
        .first<RevisionRow>(),
    ]);

    return {
      version: 1,
      sources: {
        videos: normalizeRow(videos ?? emptyRow()),
        tokens: normalizeRow(tokens ?? emptyRow()),
        work: normalizeRow(work ?? emptyRow()),
        listings: normalizeRow(listings ?? emptyRow()),
      },
    };
  } catch {
    return null;
  }
}
