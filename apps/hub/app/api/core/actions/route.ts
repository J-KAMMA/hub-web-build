import { NextResponse } from "next/server";

import {
  CREATE_SOCIAL_POST_CAPABILITY,
  isCoreActionActor,
  parseCreateSocialPostCoreAction,
} from "@/lib/platform/core-action-dispatch";
import { getHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import {
  HubAuthenticationError,
  requireHubSessionProfile,
} from "@/lib/server/hub-session";
import { POST as createSocialPost } from "@/app/api/social/posts/route";

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie",
};

export async function GET() {
  return NextResponse.json(
    {
      version: "hub.core.v1",
      capabilities: [
        {
          name: CREATE_SOCIAL_POST_CAPABILITY,
          actionKind: "create",
          actorKind: "profile",
          objectKind: "post",
          approval: "required",
        },
      ],
    },
    { headers: PRIVATE_HEADERS },
  );
}

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json(
      { error: "invalid_origin" },
      { status: 403, headers: PRIVATE_HEADERS },
    );
  }
  const parsed = parseCreateSocialPostCoreAction(
    await request.json().catch(() => null),
  );
  if (!parsed) {
    return NextResponse.json(
      { error: "invalid_core_action" },
      { status: 400, headers: PRIVATE_HEADERS },
    );
  }

  try {
    const database = getHubD1();
    const viewer = await requireHubSessionProfile(request, database);
    if (!isCoreActionActor(parsed, viewer.id)) {
      return NextResponse.json(
        { error: "actor_mismatch" },
        { status: 403, headers: PRIVATE_HEADERS },
      );
    }

    const headers = new Headers(request.headers);
    headers.set("content-type", "application/json");
    if (parsed.input.clientRequestId) {
      headers.set("idempotency-key", parsed.input.clientRequestId);
    }
    const forwarded = new Request(new URL("/api/social/posts", request.url), {
      method: "POST",
      headers,
      body: JSON.stringify({
        body: parsed.input.body,
        identity_mode: "account",
        image_ids: parsed.input.imageIds,
        audience: parsed.input.audience,
        client_request_id: parsed.input.clientRequestId,
      }),
    });
    const response = await createSocialPost(forwarded);
    response.headers.set("X-Hub-Core-Action", CREATE_SOCIAL_POST_CAPABILITY);
    return response;
  } catch (error) {
    if (error instanceof HubAuthenticationError) {
      return NextResponse.json(
        { error: "authentication_required" },
        { status: 401, headers: PRIVATE_HEADERS },
      );
    }
    if (error instanceof HubD1UnavailableError) {
      return NextResponse.json(
        { error: "core_action_unavailable" },
        { status: 503, headers: PRIVATE_HEADERS },
      );
    }
    throw error;
  }
}
