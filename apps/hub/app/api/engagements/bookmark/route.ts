import { NextResponse } from "next/server";

import { toggleBookmarkRouteData } from "@/lib/server/engagements-route-data";
import { HubAuthenticationError } from "@/lib/server/hub-session";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { HubD1UnavailableError } from "@/lib/server/hub-d1";
import { HubProfileBlockedError } from "@/lib/server/profile-blocks";

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie",
};

function privateJson(body: unknown, init: { status?: number } = {}) {
  return NextResponse.json(body, { ...init, headers: PRIVATE_HEADERS });
}

async function setBookmark(request: Request, forcedActive?: boolean) {
  if (!hasSameOrigin(request)) {
    return privateJson({ error: "invalid_origin" }, { status: 403 });
  }
  const body = await request.json().catch(() => null) as {
    target_type?: "social_post" | "thread_post" | "community_message" | "thread" | "vault_content";
    target_id?: string;
    note?: string;
    active?: boolean;
  } | null;

  if (!body || !body.target_type || !body.target_id) {
    return privateJson(
      { error: "target_type and target_id are required." },
      { status: 400 },
    );
  }

  try {
    const summary = await toggleBookmarkRouteData(request, {
      targetType: body.target_type,
      targetId: body.target_id,
      note: body.note,
      active: forcedActive ?? (typeof body.active === "boolean" ? body.active : undefined),
    });
    return privateJson({ summary });
  } catch (error) {
    if (error instanceof HubProfileBlockedError) {
      return privateJson({ error: error.message }, { status: 403 });
    }
    if (error instanceof HubAuthenticationError) return privateJson({ error: "ログインが必要です。" }, { status: 401 });
    if (error instanceof HubD1UnavailableError) {
      return privateJson({ error: "Engagement service is unavailable." }, { status: 503 });
    }
    return privateJson({ error: error instanceof Error ? error.message : "Unexpected error." }, { status: 400 });
  }
}

export async function POST(request: Request) {
  return setBookmark(request);
}

export async function PUT(request: Request) {
  return setBookmark(request, true);
}

export async function DELETE(request: Request) {
  return setBookmark(request, false);
}
