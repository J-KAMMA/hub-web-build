import { NextResponse } from "next/server";

import {
  normalizeRemoteIdentifier,
  type HubExternalProtocol,
  type HubProtocolDirection,
} from "@/lib/platform/external-protocols";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getHubD1 } from "@/lib/server/hub-d1";
import {
  createExternalProtocolLink,
  listExternalProtocolLinks,
  revokeExternalProtocolLink,
} from "@/lib/server/d1-external-protocols";
import { HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";
import {
  authorizeAtprotoConnection,
  getAtprotoConnection,
  unlinkAtprotoConnection,
} from "@/lib/server/federation-gateway";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };

export async function GET(request: Request) {
  try {
    const database = getHubD1();
    const profile = await requireHubSessionProfile(request, database);
    const [storedLinks, atproto] = await Promise.all([
      listExternalProtocolLinks(database, profile.id),
      getAtprotoConnection(profile.id),
    ]);
    const links = storedLinks.filter((link) => link.protocol !== "atproto");
    if (atproto?.connected && atproto.did && atproto.handle) {
      links.push({
        id: "atproto-oauth",
        protocol: "atproto",
        remoteIdentifier: atproto.handle,
        direction: "export",
        status: "active",
        createdAt: atproto.connectedAt ?? atproto.updatedAt ?? new Date(0).toISOString(),
        updatedAt: atproto.updatedAt ?? atproto.connectedAt ?? new Date(0).toISOString(),
      });
    }
    return NextResponse.json(
      { version: "hub.external-protocols.v1", links },
      { headers },
    );
  } catch (error) {
    if (error instanceof HubAuthenticationError) {
      return NextResponse.json({ error: "authentication_required" }, { status: 401, headers });
    }
    throw error;
  }
}

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: "invalid_origin" }, { status: 403, headers });
  }
  try {
    const database = getHubD1();
    const profile = await requireHubSessionProfile(request, database);
    const body = await request.json().catch(() => null) as {
      protocol?: unknown;
      remoteIdentifier?: unknown;
      direction?: unknown;
    } | null;
    const protocol = body?.protocol === "activitypub" || body?.protocol === "atproto"
      ? body.protocol as HubExternalProtocol
      : null;
    const direction = body?.direction === "export" || body?.direction === "import" || body?.direction === "bidirectional"
      ? body.direction as HubProtocolDirection
      : "export";
    const remoteIdentifier = protocol
      ? normalizeRemoteIdentifier(protocol, body?.remoteIdentifier)
      : null;
    if (!protocol || !remoteIdentifier) {
      return NextResponse.json({ error: "invalid_protocol_link" }, { status: 400, headers });
    }
    if (protocol === "atproto") {
      const authorizationUrl = await authorizeAtprotoConnection(
        profile.id,
        remoteIdentifier,
      );
      return authorizationUrl
        ? NextResponse.json({ authorizationUrl }, { status: 202, headers })
        : NextResponse.json(
            { error: "atproto_authorization_unavailable" },
            { status: 503, headers },
          );
    }
    const link = await createExternalProtocolLink(database, {
      profileId: profile.id,
      protocol,
      remoteIdentifier,
      direction,
    });
    return NextResponse.json({ link }, { status: 201, headers });
  } catch (error) {
    if (error instanceof HubAuthenticationError) {
      return NextResponse.json({ error: "authentication_required" }, { status: 401, headers });
    }
    if (error instanceof Error && /UNIQUE/i.test(error.message)) {
      return NextResponse.json({ error: "link_already_exists" }, { status: 409, headers });
    }
    throw error;
  }
}

export async function DELETE(request: Request) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: "invalid_origin" }, { status: 403, headers });
  }
  try {
    const database = getHubD1();
    const profile = await requireHubSessionProfile(request, database);
    const id = new URL(request.url).searchParams.get("id")?.trim() ?? "";
    if (!id) return NextResponse.json({ error: "id_required" }, { status: 400, headers });
    if (id === "atproto-oauth") {
      return await unlinkAtprotoConnection(profile.id)
        ? NextResponse.json({ revoked: true }, { headers })
        : NextResponse.json(
            { error: "atproto_unlink_unavailable" },
            { status: 503, headers },
          );
    }
    const revoked = await revokeExternalProtocolLink(database, profile.id, id);
    return revoked
      ? NextResponse.json({ revoked: true }, { headers })
      : NextResponse.json({ error: "link_not_found" }, { status: 404, headers });
  } catch (error) {
    if (error instanceof HubAuthenticationError) {
      return NextResponse.json({ error: "authentication_required" }, { status: 401, headers });
    }
    throw error;
  }
}
