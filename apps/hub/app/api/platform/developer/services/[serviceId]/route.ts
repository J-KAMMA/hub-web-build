import { NextResponse } from "next/server";

import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getHubD1 } from "@/lib/server/hub-d1";
import {
  revokeDeveloperService,
  submitDeveloperService,
} from "@/lib/server/d1-developer-services";
import { HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";

export async function PATCH(request: Request, context: { params: Promise<{ serviceId: string }> }) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  try {
    const database = getHubD1();
    const profile = await requireHubSessionProfile(request, database);
    const { serviceId } = await context.params;
    const body = await request.json().catch(() => null) as { action?: unknown } | null;
    const updated = body?.action === "submit"
      ? await submitDeveloperService(database, profile.id, serviceId)
      : body?.action === "revoke"
        ? await revokeDeveloperService(database, profile.id, serviceId)
        : false;
    return updated
      ? NextResponse.json({ updated: true })
      : NextResponse.json({ error: "invalid_transition" }, { status: 409 });
  } catch (error) {
    return error instanceof HubAuthenticationError
      ? NextResponse.json({ error: "authentication_required" }, { status: 401 })
      : Promise.reject(error);
  }
}
