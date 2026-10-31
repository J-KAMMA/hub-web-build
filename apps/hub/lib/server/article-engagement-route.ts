import { NextResponse } from "next/server";
import type { D1Database } from "@cloudflare/workers-types";

import type { Profile } from "@/lib/domain";
import {
  ArticleCommentRateLimitError,
  ArticleEngagementForbiddenError,
  ArticleEngagementNotFoundError,
  ArticleEngagementValidationError,
  isEngagementArticleId,
} from "@/lib/server/d1-user-article-engagement";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getHubD1 } from "@/lib/server/hub-d1";
import { getOptionalHubSessionProfile, HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";
import { HubProfileBlockedError } from "@/lib/server/profile-blocks";

/** 記事のいいね・コメントの受け口が共有する外枠（同一オリジン確認、ログイン確認、エラーの写像）。 */

const NO_STORE = { "cache-control": "no-store" } as const;

export function engagementJson(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

export type EngagementContext = { database: D1Database; profile: Profile | null; articleId: string };
export type LoggedInEngagementContext = EngagementContext & { profile: Profile };

/** ログイン必須の操作。 */
export async function handleEngagementWrite(
  request: Request,
  params: Promise<{ articleId: string }>,
  run: (context: LoggedInEngagementContext) => Promise<Response>,
  options: { mutating: boolean } = { mutating: true },
): Promise<Response> {
  if (options.mutating && !hasSameOrigin(request)) return engagementJson({ error: "不正なリクエストです。" }, 403);
  try {
    const { articleId } = await params;
    if (!isEngagementArticleId(articleId)) return engagementJson({ error: "記事の指定が正しくありません。" }, 400);
    const database = getHubD1();
    const profile = await requireHubSessionProfile(request, database);
    return await run({ database, profile, articleId });
  } catch (error) {
    return engagementError(error);
  }
}

/** ログインしていなくても読める操作。 */
export async function handleEngagementRead(
  request: Request,
  params: Promise<{ articleId: string }>,
  run: (context: EngagementContext) => Promise<Response>,
): Promise<Response> {
  try {
    const { articleId } = await params;
    if (!isEngagementArticleId(articleId)) return engagementJson({ error: "記事の指定が正しくありません。" }, 400);
    const database = getHubD1();
    const profile = await getOptionalHubSessionProfile(request, database).catch(() => null);
    return await run({ database, profile, articleId });
  } catch (error) {
    return engagementError(error);
  }
}

export function engagementError(error: unknown): Response {
  if (error instanceof HubAuthenticationError) return engagementJson({ error: "ログインが必要です。" }, 401);
  if (error instanceof ArticleEngagementValidationError) return engagementJson({ error: error.message }, 400);
  if (error instanceof ArticleEngagementNotFoundError) return engagementJson({ error: error.message }, 404);
  if (error instanceof ArticleEngagementForbiddenError) return engagementJson({ error: error.message }, 403);
  if (error instanceof HubProfileBlockedError) return engagementJson({ error: error.message }, 403);
  if (error instanceof ArticleCommentRateLimitError) {
    return engagementJson({ error: error.message }, 429, { "retry-after": String(error.retryAfterSeconds) });
  }
  return engagementJson({ error: "処理できませんでした。" }, 500);
}
