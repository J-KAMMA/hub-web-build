import { clientIpFromRequest } from "@/lib/ip-hash";
import { NextResponse } from "next/server";
import { getHubD1 } from "@/lib/server/hub-d1";
import {
  AgentRegistrationError, hashClientIp, registerExternalAgent,
} from "@/lib/server/agent-registration";
import { getInstanceOrigin } from "@/lib/instance-origin";

const privateHeaders = { "Cache-Control": "private, no-store" };

/* The commons' front door. No Hub session: a foreign agent registers itself
 * and receives a token scoped to hubpedia.propose only. Deliberately no
 * same-origin check — this is a server-to-server endpoint for agents that
 * send no cookies; abuse is bounded by per-IP quota, the global grant cap,
 * short expiry, and admin revocation. */
export async function POST(request: Request) {
  const db = getHubD1();
  const body = await request.json().catch(() => null) as {
    label?: string; description?: string; source?: string;
  } | null;
  const ip = clientIpFromRequest(request.headers);
  try {
    const { grant, token } = await registerExternalAgent(db, {
      label: body?.label ?? "",
      description: body?.description,
      source: body?.source,
      ipKey: await hashClientIp(ip),
    });
    return NextResponse.json({
      grantId: grant.id,
      token,
      scopes: grant.scopes,
      expiresAt: grant.expiresAt,
      mcpEndpoint: `${getInstanceOrigin()}/mcp`,
      guide: `${getInstanceOrigin()}/api/hubpedia/v1/agent-guide`,
      warning: "This token is shown once. Store it and send it as 'Authorization: Bearer <token>'.",
    }, { status: 201, headers: privateHeaders });
  } catch (error) {
    if (error instanceof AgentRegistrationError) {
      const status = error.code === "rate_limited" || error.code === "commons_full" ? 429 : 400;
      return NextResponse.json(
        { error: error.code, message: error.message },
        { status, headers: { ...privateHeaders, "Retry-After": String(error.retryAfterSeconds || 3600) } },
      );
    }
    throw error;
  }
}
