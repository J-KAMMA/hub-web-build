import { NextResponse } from "next/server";

import { parseDeveloperServiceInput } from "@/lib/platform/developer-service";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getHubD1 } from "@/lib/server/hub-d1";
import {
  createDeveloperService,
  listDeveloperServices,
} from "@/lib/server/d1-developer-services";
import { requireHubViewerProfile } from "@/lib/server/desktop-hub-auth";
import { HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" };

export async function GET(request: Request) {
  try {
    const database = getHubD1();
    const profile = await requireHubViewerProfile(request, database);
    return NextResponse.json({ services: await listDeveloperServices(database, profile.id) }, { headers });
  } catch (error) {
    return error instanceof HubAuthenticationError
      ? NextResponse.json({ error: "authentication_required" }, { status: 401, headers })
      : Promise.reject(error);
  }
}

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "invalid_origin" }, { status: 403, headers });
  try {
    const database = getHubD1();
    const profile = await requireHubSessionProfile(request, database);
    const input = parseDeveloperServiceInput(await request.json().catch(() => null));
    if (!input) return NextResponse.json({ error: "invalid_service_manifest" }, { status: 400, headers });
    return NextResponse.json({ service: await createDeveloperService(database, profile.id, input) }, { status: 201, headers });
  } catch (error) {
    if (error instanceof HubAuthenticationError) {
      return NextResponse.json({ error: "authentication_required" }, { status: 401, headers });
    }
    if (error instanceof Error && /UNIQUE/i.test(error.message)) {
      return NextResponse.json({ error: "service_or_capability_exists" }, { status: 409, headers });
    }
    throw error;
  }
}
