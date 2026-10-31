import { NextResponse } from "next/server";

import {
  getEngagementSummaryRouteData,
  toggleReactionRouteData,
} from "@/lib/server/engagements-route-data";
import { HubAuthenticationError } from "@/lib/server/hub-session";
import { HubReactionRateLimitError, HubSelfReactionError } from "@/lib/server/d1-engagements";
import { HubProfileBlockedError } from "@/lib/server/profile-blocks";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { HubD1UnavailableError } from "@/lib/server/hub-d1";

const targetTypes = new Set([
  "social_post",
  "thread_post",
  "community_message",
  "vault_content",
] as const);

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie",
};

function privateJson(body: unknown, init: { status?: number; headers?: HeadersInit } = {}) {
  return NextResponse.json(body, {
    ...init,
    headers: { ...PRIVATE_HEADERS, ...init.headers },
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const targetType = url.searchParams.get("target_type");
  const targetId = url.searchParams.get("target_id");
  if (!targetType || !targetId || !targetTypes.has(targetType as never)) {
    return privateJson(
      { error: "valid target_type and target_id are required." },
      { status: 400 },
    );
  }
  try {
    return privateJson({
      summary: await getEngagementSummaryRouteData(
        request,
        targetType as "social_post" | "thread_post" | "community_message" | "vault_content",
        targetId,
      ),
    });
  } catch (error) {
    if (error instanceof HubD1UnavailableError) {
      return privateJson({ error: "Engagement service is unavailable." }, { status: 503 });
    }
    throw error;
  }
}

async function setReaction(request: Request, forcedActive?: boolean) {
  if (!hasSameOrigin(request)) {
    return privateJson({ error: "invalid_origin" }, { status: 403 });
  }
  try {
    const body = await request.json().catch(() => null) as {
      target_type?: "social_post" | "thread_post" | "community_message" | "vault_content";
      target_id?: string;
      kind?: "like";
      active?: boolean;
    } | null;

    if (
      !body ||
      !body.target_type ||
      !targetTypes.has(body.target_type) ||
      !body.target_id ||
      body.kind !== "like"
    ) {
      return privateJson(
        { error: "valid target_type, target_id, and like reaction are required." },
        { status: 400 },
      );
    }

    const summary = await toggleReactionRouteData(request, {
      targetType: body.target_type,
      targetId: body.target_id,
      kind: body.kind,
      active: forcedActive ?? (typeof body.active === "boolean" ? body.active : undefined),
    });

    return privateJson({ summary });
  } catch (error) {
    if (error instanceof HubAuthenticationError) return privateJson({ error: "ログインが必要です。" }, { status: 401 });
    if (error instanceof HubSelfReactionError) return privateJson({ error: error.message }, { status: 400 });
    if (error instanceof HubProfileBlockedError) return privateJson({ error: error.message }, { status: 403 });
    if (error instanceof HubReactionRateLimitError) return privateJson(
      { error: error.message, retry_after: error.retryAfterSeconds },
      { status: 429, headers: { "Retry-After": String(error.retryAfterSeconds) } },
    );
    if (error instanceof HubD1UnavailableError) {
      return privateJson({ error: "Engagement service is unavailable." }, { status: 503 });
    }
    return privateJson(
      { error: error instanceof Error ? error.message : "Unexpected error." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  return setReaction(request);
}

export async function PUT(request: Request) {
  return setReaction(request, true);
}

export async function DELETE(request: Request) {
  return setReaction(request, false);
}
