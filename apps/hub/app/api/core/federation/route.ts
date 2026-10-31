import { NextResponse } from "next/server";

import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getHubD1 } from "@/lib/server/hub-d1";
import {
  getFederationSettings,
  putFederationSettings,
} from "@/lib/server/federation-gateway";
import {
  HubAuthenticationError,
  requireHubSessionProfile,
} from "@/lib/server/hub-session";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };

export async function GET(request: Request) {
  try {
    const profile = await requireHubSessionProfile(request, getHubD1());
    const settings = await getFederationSettings(profile.id);
    return settings
      ? NextResponse.json(settings, { headers })
      : NextResponse.json({ error: "federation_unavailable" }, { status: 503, headers });
  } catch (error) {
    if (error instanceof HubAuthenticationError) {
      return NextResponse.json({ error: "authentication_required" }, { status: 401, headers });
    }
    return NextResponse.json({ error: "federation_unavailable" }, { status: 503, headers });
  }
}

export async function PUT(request: Request) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: "invalid_origin" }, { status: 403, headers });
  }
  try {
    const profile = await requireHubSessionProfile(request, getHubD1());
    const body = await request.json().catch(() => null) as {
      enabled?: unknown;
      discoverable?: unknown;
    } | null;
    if (typeof body?.enabled !== "boolean" || typeof body.discoverable !== "boolean") {
      return NextResponse.json({ error: "invalid_request" }, { status: 400, headers });
    }
    const settings = await putFederationSettings(profile, {
      enabled: body.enabled,
      discoverable: body.discoverable,
    });
    return settings
      ? NextResponse.json(settings, { headers })
      : NextResponse.json({ error: "federation_unavailable" }, { status: 503, headers });
  } catch (error) {
    if (error instanceof HubAuthenticationError) {
      return NextResponse.json({ error: "authentication_required" }, { status: 401, headers });
    }
    return NextResponse.json({ error: "federation_unavailable" }, { status: 503, headers });
  }
}
