import { NextResponse } from "next/server";

import { getHubD1 } from "@/lib/server/hub-d1";
import { exportPersonalNodeBundle } from "@/lib/server/federation-gateway";
import {
  HubAuthenticationError,
  requireHubSessionProfile,
} from "@/lib/server/hub-session";

export async function GET(request: Request) {
  try {
    const profile = await requireHubSessionProfile(request, getHubD1());
    const bundle = await exportPersonalNodeBundle(profile.id);
    if (!bundle) {
      return NextResponse.json({ error: "personal_node_not_found" }, { status: 404 });
    }
    return NextResponse.json(bundle, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="hub-personal-node-${profile.handle}.json"`,
        Vary: "Cookie",
      },
    });
  } catch (error) {
    if (error instanceof HubAuthenticationError) {
      return NextResponse.json({ error: "authentication_required" }, { status: 401 });
    }
    return NextResponse.json({ error: "personal_node_unavailable" }, { status: 503 });
  }
}
