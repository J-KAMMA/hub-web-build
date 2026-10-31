import { NextResponse } from "next/server";

import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getHubD1 } from "@/lib/server/hub-d1";
import {
  HubAuthenticationError,
  requireHubSessionProfile,
} from "@/lib/server/hub-session";
import { parseTrustRequestInput } from "@/lib/trust-request-input";

type TrustRequestRow = {
  id: string;
  context: string;
  sourceService: string;
  evidenceLabel: string;
  requestType: string;
  status: string;
  resolutionNote: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
};

function responseError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

function cleanText(value: unknown, maximum: number): string {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, maximum)
    : "";
}

export async function GET(request: Request) {
  try {
    const database = getHubD1();
    const profile = await requireHubSessionProfile(request, database);
    const rows = await database.prepare(
      `SELECT id,context,source_service sourceService,
              evidence_label evidenceLabel,request_type requestType,status,
              resolution_note resolutionNote,created_at createdAt,
              updated_at updatedAt,resolved_at resolvedAt
       FROM hub_trust_requests
       WHERE profile_id=?
       ORDER BY created_at DESC
       LIMIT 100`,
    ).bind(profile.id).all<TrustRequestRow>();
    return NextResponse.json(
      { requests: rows.results },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (cause) {
    if (cause instanceof HubAuthenticationError) {
      return responseError("authentication_required", 401);
    }
    return responseError("trust_requests_unavailable", 503);
  }
}

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return responseError("untrusted_origin", 403);
  const input = parseTrustRequestInput(await request.json().catch(() => null));
  if (!input) {
    return responseError("invalid_trust_request", 400);
  }
  const { context, sourceService, evidenceLabel, requestType, message } = input;
  try {
    const database = getHubD1();
    const profile = await requireHubSessionProfile(request, database);
    const id = crypto.randomUUID();
    const eventId = crypto.randomUUID();
    const now = new Date().toISOString();
    await database.batch([
      database.prepare(
        `INSERT INTO hub_trust_requests
         (id,profile_id,context,source_service,evidence_label,request_type,
          message,status,created_at,updated_at)
         VALUES(?,?,?,?,?,?,?,'pending',?,?)`,
      ).bind(
        id,
        profile.id,
        context,
        sourceService,
        evidenceLabel,
        requestType,
        message,
        now,
        now,
      ),
      database.prepare(
        `INSERT INTO hub_trust_request_events
         (id,request_id,actor_scope,event_type,created_at)
         VALUES(?,?,'requester','submitted',?)`,
      ).bind(eventId, id, now),
    ]);
    return NextResponse.json(
      {
        request: {
          id,
          context,
          sourceService,
          evidenceLabel,
          requestType,
          status: "pending",
          resolutionNote: "",
          createdAt: now,
          updatedAt: now,
          resolvedAt: null,
        },
      },
      { status: 201, headers: { "cache-control": "private, no-store" } },
    );
  } catch (cause) {
    if (cause instanceof HubAuthenticationError) {
      return responseError("authentication_required", 401);
    }
    if (String(cause).toLowerCase().includes("unique")) {
      return responseError("active_trust_request_exists", 409);
    }
    return responseError("trust_request_failed", 503);
  }
}

export async function DELETE(request: Request) {
  if (!hasSameOrigin(request)) return responseError("untrusted_origin", 403);
  const input = await request.json().catch(() => null) as { id?: unknown } | null;
  const id = cleanText(input?.id, 80);
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return responseError("invalid_trust_request_id", 400);
  }
  try {
    const database = getHubD1();
    const profile = await requireHubSessionProfile(request, database);
    const now = new Date().toISOString();
    const results = await database.batch([
      database.prepare(
        `UPDATE hub_trust_requests
         SET status='cancelled',updated_at=?,resolved_at=?
         WHERE id=? AND profile_id=? AND status='pending'`,
      ).bind(now, now, id, profile.id),
      database.prepare(
        `INSERT INTO hub_trust_request_events
         (id,request_id,actor_scope,event_type,created_at)
         SELECT ?,id,'requester','cancelled',?
         FROM hub_trust_requests
         WHERE id=? AND profile_id=? AND status='cancelled' AND updated_at=?`,
      ).bind(crypto.randomUUID(), now, id, profile.id, now),
    ]);
    if (!Number(results[0].meta.changes ?? 0)) {
      return responseError("trust_request_not_cancellable", 409);
    }
    return new NextResponse(null, { status: 204 });
  } catch (cause) {
    if (cause instanceof HubAuthenticationError) {
      return responseError("authentication_required", 401);
    }
    return responseError("trust_request_cancel_failed", 503);
  }
}
