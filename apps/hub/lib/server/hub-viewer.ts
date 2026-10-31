import "server-only";

import { headers } from "next/headers";
import { cache } from "react";

import type { Profile } from "@/lib/domain";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { getOptionalHubSessionProfile } from "@/lib/server/hub-session";

/**
 * The session profile of the current request. Memoised per request with React cache():
 * the app shell, the page data builder and nested helpers all ask for the viewer, and each
 * ask used to repeat the profile and moderation lookups.
 */
export const getHubViewer = cache(async (): Promise<Profile | null> => {
  const database = getOptionalHubD1();
  if (!database) return null;
  const requestHeaders = await headers();
  return getOptionalHubSessionProfile(new Request("http://hub.local/session", { headers: requestHeaders }), database);
});
