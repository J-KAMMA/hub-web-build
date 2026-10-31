import "server-only";

import { NextResponse } from "next/server";

import { CommunityPermissionError } from "@/lib/server/d1-community-channels";
import { HubPostRateLimitError } from "@/lib/server/d1-rate-limit";
import { HubAuthenticationError } from "@/lib/server/hub-session";

export function communityApiErrorResponse(
  error: unknown,
  fallbackMessage: string,
  fallbackStatus = 400,
) {
  const message = error instanceof Error ? error.message : fallbackMessage;
  if (error instanceof HubAuthenticationError) {
    return NextResponse.json({ error: message }, { status: 401 });
  }
  if (error instanceof CommunityPermissionError) {
    return NextResponse.json({ error: message }, { status: 403 });
  }
  if (error instanceof HubPostRateLimitError) {
    return NextResponse.json(
      { error: message },
      {
        status: 429,
        headers: { "Retry-After": String(error.retryAfterSeconds) },
      },
    );
  }
  return NextResponse.json({ error: message }, { status: fallbackStatus });
}
