import "server-only";

import type { D1Database } from "@cloudflare/workers-types";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { getHubViewer } from "@/lib/server/hub-viewer";

export type HubServiceStateCounts = {
  communities: number;
  bookmarks: number;
  scheduledPosts: number;
  workManaged: number;
};

const EMPTY: HubServiceStateCounts = {
  communities: 0,
  bookmarks: 0,
  scheduledPosts: 0,
  workManaged: 0,
};

async function count(database: D1Database, sql: string, profileId: string, ...values: unknown[]) {
  try {
    const row = await database.prepare(sql).bind(profileId, ...values).first<{ total: number }>();
    return Number(row?.total ?? 0);
  } catch {
    return 0;
  }
}

export async function getServicesPageState(): Promise<HubServiceStateCounts> {
  const [database, viewer] = [getOptionalHubD1(), await getHubViewer()];
  if (!database || !viewer) return EMPTY;
  const profileId = viewer.id;
  const [communities, bookmarks, scheduledPosts, workManaged] = await Promise.all([
    count(database, "SELECT count(*) AS total FROM community_memberships WHERE profile_id = ? AND status <> 'banned'", profileId),
    count(database, "SELECT count(*) AS total FROM bookmarks WHERE profile_id = ?", profileId),
    count(database, "SELECT count(*) AS total FROM social_scheduled_posts WHERE author_profile_id = ? AND status = 'scheduled'", profileId),
    count(database, "SELECT count(*) AS total FROM work_listings WHERE owner_profile_id = ? AND status IN ('draft','published','paused')", profileId),
  ]);
  return { communities, bookmarks, scheduledPosts, workManaged };
}
