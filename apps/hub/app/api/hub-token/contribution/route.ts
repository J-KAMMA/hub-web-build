import { NextResponse } from "next/server";

import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";
import { readProfileHubContribution } from "@/lib/server/hub-token-contribution";

const privateHeaders = {
  "cache-control": "private, no-store",
  vary: "cookie",
};

export async function GET(request: Request) {
  const database = getOptionalHubD1();
  if (!database) return NextResponse.json({ error: "hub_token_unavailable" }, { status: 503, headers: privateHeaders });
  try {
    const profile = await requireHubSessionProfile(request, database);
    return NextResponse.json(await readProfileHubContribution(database, profile.id), { headers: privateHeaders });
  } catch (error) {
    if (error instanceof HubAuthenticationError) return NextResponse.json({ error: "authentication_required" }, { status: 401, headers: privateHeaders });
    return NextResponse.json({ error: "hub_token_unavailable" }, { status: 503, headers: privateHeaders });
  }
}
