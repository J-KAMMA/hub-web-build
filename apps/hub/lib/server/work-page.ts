import "server-only";

import type { D1Database } from "@cloudflare/workers-types";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { getInstanceOrigin } from "@/lib/instance-origin";
import { isOptionalServiceEnabled } from "@/lib/optional-services";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { getOptionalHubSessionProfile } from "@/lib/server/hub-session";

/** The signed-in profile ID and the database for a /v2/commissions page; null parts mean signed out or unavailable. */
export async function getWorkPageViewer(path: string): Promise<{ database: D1Database | null; viewerId: string | null }> {
  if (!isOptionalServiceEnabled("work-commissions")) notFound();
  const database = getOptionalHubD1();
  if (!database) return { database: null, viewerId: null };
  try {
    const request = new Request(`${getInstanceOrigin()}${path}`, { headers: await headers() });
    const viewer = await getOptionalHubSessionProfile(request, database);
    return { database, viewerId: viewer?.id ?? null };
  } catch {
    return { database, viewerId: null };
  }
}
