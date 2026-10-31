import { NextResponse } from "next/server";
import type { D1Database } from "@cloudflare/workers-types";

import type { Profile } from "@/lib/domain";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getHubD1 } from "@/lib/server/hub-d1";
import { HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";
import {
  UserArticlePublicationConflictError,
  UserArticleRateLimitError,
  UserArticleValidationError,
} from "@/lib/server/d1-user-articles";
import { AccessGateConflictError, AccessGateForbiddenError, AccessGateNotFoundError, AccessGateValidationError } from "@/lib/server/access-gates";
import { UserArticleLimitError, UserArticleNotFoundError } from "@/lib/server/d1-user-article-drafts";
import { ContentLicenseForbiddenError, ContentLicenseGateConflictError, ContentLicenseValidationError } from "@/lib/server/content-licenses";

/**
 * 記事の書き込み系の受け口が共有する外枠。
 * 同一オリジン確認、ログイン確認、エラーの写像だけを持つ。権限（著者本人か）は
 * 呼ばれる関数が profile.id で絞って判断する。
 */

const NO_STORE = { "cache-control": "no-store" } as const;

export type ArticleWriteContext = {
  database: D1Database;
  profile: Profile;
  origin: string | null;
};

export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  const payload = await request.json().catch(() => null) as unknown;
  return payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
}

export async function handleArticleWrite(
  request: Request,
  run: (context: ArticleWriteContext) => Promise<Response>,
  options: { mutating: boolean } = { mutating: true },
): Promise<Response> {
  if (options.mutating && !hasSameOrigin(request)) return json({ error: "不正なリクエストです。" }, 403);
  try {
    const database = getHubD1();
    const profile = await requireHubSessionProfile(request, database);
    return await run({ database, profile, origin: request.headers.get("origin") });
  } catch (error) {
    if (error instanceof HubAuthenticationError) return json({ error: "ログインが必要です。" }, 401);
    if (error instanceof UserArticleValidationError) return json({ error: error.message }, 400);
    if (error instanceof UserArticleNotFoundError) return json({ error: error.message }, 404);
    if (error instanceof AccessGateValidationError) return json({ error: error.message }, 400);
    if (error instanceof AccessGateForbiddenError) return json({ error: error.message }, 403);
    if (error instanceof AccessGateNotFoundError) return json({ error: error.message }, 404);
    if (error instanceof AccessGateConflictError) return json({ error: error.message }, 409);
    if (error instanceof ContentLicenseValidationError) return json({ error: error.message }, 400);
    if (error instanceof ContentLicenseForbiddenError) return json({ error: error.message }, 403);
    if (error instanceof ContentLicenseGateConflictError) return json({ error: error.message }, 409);
    if (error instanceof UserArticleLimitError) return json({ error: error.message }, 409);
    if (error instanceof UserArticlePublicationConflictError) return json({ error: error.message }, 409);
    if (error instanceof UserArticleRateLimitError) {
      return json({ error: error.message }, 429, { "retry-after": String(error.retryAfterSeconds) });
    }
    return json({ error: "記事を保存できませんでした。" }, 500);
  }
}
