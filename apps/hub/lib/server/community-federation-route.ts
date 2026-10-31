import "server-only";

import type { D1Database } from "@cloudflare/workers-types";
import { NextResponse } from "next/server";

import type { Profile } from "@/lib/domain";
import { CommunityFederationError } from "@/lib/server/community-federation-host";
import { HubPostRateLimitError } from "@/lib/server/d1-rate-limit";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import { HubAuthenticationError, HubSuspendedError, requireHubSessionProfile } from "@/lib/server/hub-session";

export const PRIVATE_HEADERS = { "cache-control": "private, no-store", vary: "Cookie" };

export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { ...PRIVATE_HEADERS, ...headers } });
}

/** 他のハブとのコミュニティ API 共通の入口: 同一オリジン（書き込み時）・ログイン・エラーの整形。 */
export async function withViewer(
  request: Request,
  options: { write: boolean },
  handler: (database: D1Database, viewer: Profile) => Promise<Response>,
): Promise<Response> {
  if (options.write && !hasSameOrigin(request)) return json({ error: "不正なリクエストです。" }, 403);
  try {
    const database = getHubD1();
    const viewer = await requireHubSessionProfile(request, database);
    return await handler(database, viewer);
  } catch (error) {
    if (error instanceof HubSuspendedError) return json({ error: "suspended" }, 403);
    if (error instanceof HubAuthenticationError) return json({ error: "ログインが必要です。" }, 401);
    if (error instanceof HubD1UnavailableError) return json({ error: "unavailable" }, 503);
    if (error instanceof CommunityFederationError) return json({ error: error.message }, error.status);
    if (error instanceof HubPostRateLimitError) {
      return json({ error: "操作の回数が上限に達しました。", retry_after: error.retryAfterSeconds }, 429, { "Retry-After": String(error.retryAfterSeconds) });
    }
    return json({ error: "処理できませんでした。" }, 400);
  }
}

export async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  const value = await request.json().catch(() => null) as unknown;
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
