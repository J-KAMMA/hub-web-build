import { NextResponse } from "next/server";

import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getHubD1 } from "@/lib/server/hub-d1";
import { getDomainAlias, startDomainAliasChallenge, unlinkDomainAlias, verifyDomainAlias } from "@/lib/server/federation-gateway";
import { HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };

export async function GET(request: Request) {
  try {
    const profile = await requireHubSessionProfile(request, getHubD1());
    const alias = await getDomainAlias(profile.id);
    return alias !== undefined
      ? NextResponse.json({ alias }, { headers })
      : NextResponse.json({ error: "federation_unavailable" }, { status: 503, headers });
  } catch (error) {
    return authenticationOrUnavailable(error);
  }
}

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "invalid_origin" }, { status: 403, headers });
  try {
    const profile = await requireHubSessionProfile(request, getHubD1());
    const body = await request.json().catch(() => null) as { action?: unknown; domain?: unknown } | null;
    if (body?.action === "challenge" && typeof body.domain === "string") {
      const result = await startDomainAliasChallenge(profile, body.domain);
      return result
        ? NextResponse.json(result, { status: 201, headers })
        : NextResponse.json({ error: "domain_alias_unavailable" }, { status: 503, headers });
    }
    if (body?.action === "verify") {
      const alias = await verifyDomainAlias(profile.id);
      return alias
        ? NextResponse.json({ alias }, { headers })
        : NextResponse.json({ error: "ownership_proof_unavailable" }, { status: 422, headers });
    }
    return NextResponse.json({ error: "invalid_request" }, { status: 400, headers });
  } catch (error) {
    return authenticationOrUnavailable(error);
  }
}

export async function DELETE(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "invalid_origin" }, { status: 403, headers });
  try {
    const profile = await requireHubSessionProfile(request, getHubD1());
    return await unlinkDomainAlias(profile.id)
      ? NextResponse.json({ deleted: true }, { headers })
      : NextResponse.json({ error: "domain_alias_unavailable" }, { status: 503, headers });
  } catch (error) {
    return authenticationOrUnavailable(error);
  }
}

function authenticationOrUnavailable(error: unknown) {
  return error instanceof HubAuthenticationError
    ? NextResponse.json({ error: "authentication_required" }, { status: 401, headers })
    : NextResponse.json({ error: "federation_unavailable" }, { status: 503, headers });
}
