import { NextResponse } from "next/server";

import { getActivityPubRecommendations } from "@/lib/server/activitypub-recommendations";
import { getActivityPubPublicSources } from "@/lib/server/activitypub-source-config";
import { listActivityPubRegistrySources } from "@/lib/server/activitypub-node-registry";
import { listActivityPubRecommendationSources } from "@/lib/server/d1-external-protocols";
import { requireHubViewerProfile } from "@/lib/server/desktop-hub-auth";
import { getHubD1 } from "@/lib/server/hub-d1";
import { HubAuthenticationError } from "@/lib/server/hub-session";

export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, max-age=60, stale-while-revalidate=300", Vary: "Cookie, Authorization" };

export async function GET(request: Request) {
  try {
    const database = getHubD1();
    const profile = await requireHubViewerProfile(request, database);
    const [personalSources, registrySources] = await Promise.all([
      listActivityPubRecommendationSources(database, profile.id),
      listActivityPubRegistrySources(database),
    ]);
    const publicSources = getActivityPubPublicSources();
    // Retire the old PeerTube preset even when it remains in the discovery registry.
    // A user's explicitly linked account and an operator's configured source still apply.
    const timelineRegistrySources = registrySources.filter((source) =>
      !/^(?:(?:@|acct:)?peertube@framapiaf\.org|https:\/\/framapiaf\.org\/(?:users\/|@)peertube\/?)$/iu.test(source.trim()),
    );
    const sources = [...personalSources, ...timelineRegistrySources, ...publicSources];
    if (!sources.length) return NextResponse.json({ items: [], configured: false, scope: "hub" }, { headers });
    const items = await getActivityPubRecommendations(sources);
    return NextResponse.json({
      items,
      configured: true,
      scope: publicSources.length ? "federated-public" : "linked-only",
    }, { headers });
  } catch (error) {
    if (error instanceof HubAuthenticationError) {
      return NextResponse.json({ error: "authentication_required" }, { status: 401, headers: { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" } });
    }
    return NextResponse.json({ items: [], configured: true }, { status: 200, headers });
  }
}
