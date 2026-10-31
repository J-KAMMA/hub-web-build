import { NextResponse } from "next/server";

import { HUB_CAPABILITY_CATALOG } from "@/lib/platform/capability-catalog";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { listApprovedDeveloperCapabilities } from "@/lib/server/d1-developer-services";

export async function GET() {
  const database = getOptionalHubD1();
  const externalCapabilities = database
    ? await listApprovedDeveloperCapabilities(database).catch(() => [])
    : [];
  return NextResponse.json(
    {
      version: "hub.core.v1",
      capabilities: [...HUB_CAPABILITY_CATALOG, ...externalCapabilities],
    },
    {
      headers: {
        "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
      },
    },
  );
}
