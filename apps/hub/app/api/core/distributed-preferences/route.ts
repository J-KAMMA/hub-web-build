import { NextResponse } from "next/server";

import { DISTRIBUTED_RESOURCE_KINDS } from "@/lib/distributed-resource-manifest";
import { getPersonalNodeState } from "@/lib/server/federation-gateway";
import { getHubD1 } from "@/lib/server/hub-d1";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import {
  getDistributedPreferences,
  putDistributedPreference,
  type DistributedPreferenceKind,
} from "@/lib/server/distributed-resources";
import { HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };

export async function GET(request: Request) {
  try {
    const db = getHubD1();
    const profile = await requireHubSessionProfile(request, db);
    const [preferences, nodeState] = await Promise.all([
      getDistributedPreferences(db, profile.id),
      getPersonalNodeState(profile.id),
    ]);
    const personalNodeReady = nodeState?.node?.status === "active";
    return NextResponse.json({
      preferences,
      personalNodeReady,
      personalNodeUrl: personalNodeReady ? nodeState.node?.nodeUrl : null,
      directFederation: {
        protocol: "ActivityPub",
        hubRequired: false,
        relayRequired: false,
      },
    }, { headers });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof HubAuthenticationError
        ? "authentication_required"
        : "preferences_unavailable",
    }, {
      status: error instanceof HubAuthenticationError ? 401 : 503,
      headers,
    });
  }
}

export async function PUT(request: Request) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: "invalid_origin" }, { status: 403, headers });
  }

  try {
    const body = await request.json().catch(() => null) as {
      kind?: unknown;
      mode?: unknown;
      providerResourceId?: unknown;
    } | null;
    const modes = ["hub-standard", "local", "external"];
    if (
      !body
      || !DISTRIBUTED_RESOURCE_KINDS.includes(String(body.kind) as DistributedPreferenceKind)
      || !modes.includes(String(body.mode))
      || (body.providerResourceId != null && typeof body.providerResourceId !== "string")
    ) {
      return NextResponse.json({ error: "invalid_request" }, { status: 400, headers });
    }

    const db = getHubD1();
    const profile = await requireHubSessionProfile(request, db);
    if (body.mode === "local") {
      const nodeState = await getPersonalNodeState(profile.id);
      if (nodeState?.node?.status !== "active") {
        return NextResponse.json({ error: "personal_node_required" }, { status: 409, headers });
      }
    }

    const preference = await putDistributedPreference(db, profile.id, {
      kind: body.kind as DistributedPreferenceKind,
      mode: body.mode as "hub-standard" | "local" | "external",
      providerResourceId: body.providerResourceId as string | null | undefined,
    });
    return NextResponse.json({ preference }, { headers });
  } catch (error) {
    if (error instanceof HubAuthenticationError) {
      return NextResponse.json({ error: "authentication_required" }, { status: 401, headers });
    }
    if (error instanceof Error && error.message === "provider_unavailable") {
      return NextResponse.json({ error: "provider_unavailable" }, { status: 409, headers });
    }
    return NextResponse.json({ error: "preferences_unavailable" }, { status: 503, headers });
  }
}
