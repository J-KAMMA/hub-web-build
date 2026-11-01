import { NextResponse } from "next/server";

import { createHubApiError, type HubApiErrorCategory } from "@/lib/platform/api-error";
import { resolveHubFeatureFlag } from "@/lib/platform/feature-flags";
import { createHubLogger } from "@/lib/platform/logger";
import {
  createHubRequestContext,
  hubContextHeaders,
  type HubRequestContext,
} from "@/lib/platform/request-context";
import { assertExpectedSocialPostViewer, createSocialPostRouteData, getSocialPostsRouteData, SocialPostScopeError } from "@/lib/server/social-posts-route-data";
import { HubAuthenticationError } from "@/lib/server/hub-session";
import { HubProfileBlockedError } from "@/lib/server/profile-blocks";
import { getHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import { federateNewPost } from "@/lib/server/video-comment-federation";
import { getOptionalHubSessionProfile, requireHubSessionProfile } from "@/lib/server/hub-session";
import { listD1TimelinePosts } from "@/lib/server/d1-social-posts";
import { pullFederationInboundIfStale } from "@/lib/server/federation-inbound";
import { RepostCooldownError } from "@/lib/repost-cooldown";
import { readListPagination } from "@/lib/server/list-pagination";
import { scheduleD1SocialPost } from "@/lib/server/d1-social-scheduled";
import { HubPostRateLimitError } from "@/lib/server/d1-rate-limit";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { decodeTimelineCursor, encodeTimelineCursor } from "@/lib/timeline-cursor";
import { HUB_SOCIAL_POST_MAX_CHARACTERS } from "@/lib/social-post-limits";

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie",
};
const logger = createHubLogger("social-posts");
const socialPostingEnvironmentProvider = {
  getBoolean(key: string) {
    if (key !== "social.posting") return undefined;
    const value = process.env.HUB_FEATURE_SOCIAL_POSTING?.trim().toLowerCase();
    return value === "true" ? true : value === "false" ? false : undefined;
  },
};

function privateJson(
  context: HubRequestContext,
  body: unknown,
  init: { status?: number; headers?: HeadersInit } = {},
) {
  return NextResponse.json(body, {
    ...init,
    headers: { ...PRIVATE_HEADERS, ...hubContextHeaders(context), ...init.headers },
  });
}

function errorJson(
  context: HubRequestContext,
  code: string,
  category: HubApiErrorCategory,
  message: string,
  status: number,
  details: Record<string, unknown> | unknown[] | null = null,
  headers: HeadersInit = {},
) {
  logger.warn("request.rejected", context, { code, category, status });
  return privateJson(
    context,
    createHubApiError({ code, category, message, requestId: context.requestId, details }),
    { status, headers },
  );
}

export async function GET(request: Request) {
  const context = createHubRequestContext(request);
  try {
    const url = new URL(request.url);
    if (url.searchParams.get("view") === "timeline") {
      const database = getHubD1();
      // 他のハブからの投稿・返信・いいねを、開いた時点で最新にする（定期の取り込みの補助）。
      await pullFederationInboundIfStale(database);
      const viewer = await getOptionalHubSessionProfile(request, database);
      const requestedFeed = url.searchParams.get("feed");
      const feedScope = requestedFeed === "following"
        ? "following"
        : requestedFeed === "latest"
          ? "latest"
        : requestedFeed === "popular"
          ? "popular"
          : requestedFeed === "recommended"
            ? "recommended"
          : "all";
      if (feedScope === "following" && !viewer) {
        return errorJson(context, "AUTHENTICATION_REQUIRED", "unauthenticated", "ログインが必要です。", 401);
      }
      const { limit, offset } = readListPagination(url);
      const rawCursor = url.searchParams.get("cursor");
      const cursor = feedScope === "popular" || feedScope === "recommended"
        ? null
        : decodeTimelineCursor(rawCursor);
      if (rawCursor && !cursor) {
        return errorJson(context, "INVALID_CURSOR", "validation_error", "カーソルが正しくありません。", 400, {
          fields: [{ field: "cursor", reason: "invalid" }],
        });
      }
      const pageScan = {
        count: 0,
        lastCreatedAt: null as string | null,
        lastId: null as string | null,
      };
      const posts = await listD1TimelinePosts(
        database,
        viewer?.id ?? null,
        undefined,
        limit,
        offset,
        undefined,
        cursor,
        feedScope,
        pageScan,
      );
      logger.info("timeline.listed", context, { status: 200, count: posts.length, feedScope });
      return privateJson(context, {
        posts,
        hasMore: pageScan.count === limit,
        nextCursor: feedScope !== "popular" && feedScope !== "recommended"
          && pageScan.lastCreatedAt && pageScan.lastId
          ? encodeTimelineCursor({
              createdAt: pageScan.lastCreatedAt,
              id: pageScan.lastId,
            })
          : null,
        nextOffset: offset + pageScan.count,
        limit,
        offset: cursor ? 0 : offset,
      });
    }
    const data = await getSocialPostsRouteData();
    logger.info("posts.listed", context, { status: 200 });
    return privateJson(context, data);
  } catch (error) {
    if (error instanceof HubD1UnavailableError) {
      return errorJson(context, "SOCIAL_POSTS_UNAVAILABLE", "dependency_unavailable", "投稿を取得できません。", 503);
    }
    logger.error("request.failed", context, { code: "UNEXPECTED_ERROR", status: 500 });
    return errorJson(context, "INTERNAL_ERROR", "internal_error", "投稿を取得できません。", 500);
  }
}

export async function POST(request: Request) {
  const context = createHubRequestContext(request);
  if (!hasSameOrigin(request)) {
    return errorJson(context, "INVALID_ORIGIN", "forbidden", "この送信元からは投稿できません。", 403);
  }
  if (!(await resolveHubFeatureFlag("social.posting", socialPostingEnvironmentProvider))) {
    return errorJson(context, "SOCIAL_POSTING_DISABLED", "dependency_unavailable", "投稿機能は一時的に利用できません。", 503);
  }
  const body = (await request.json().catch(() => null)) as {
    body?: string;
    identity_mode?: string;
    reply_to_post_id?: string | null;
    repost_of_target_type?: "social_post" | "thread_post" | "community_message" | null;
    repost_of_target_id?: string | null;
    quote_of_target_type?: "social_post" | "thread_post" | "community_message" | null;
    quote_of_target_id?: string | null;
    image_ids?: string[];
    audience?: "public" | "followers";
    scheduled_at?: string | null;
    client_request_id?: string | null;
  } | null;

  if (!body) {
    return errorJson(context, "JSON_BODY_REQUIRED", "validation_error", "JSON形式の本文が必要です。", 400);
  }

  const targetTypes = new Set(["social_post", "thread_post", "community_message"]);
  if (body.identity_mode && body.identity_mode !== "account") {
    return errorJson(context, "INVALID_IDENTITY_MODE", "validation_error", "投稿者の表示方法が正しくありません。", 400, {
      fields: [{ field: "identity_mode", reason: "unsupported" }],
    });
  }
  if (
    (body.repost_of_target_type && !targetTypes.has(body.repost_of_target_type)) ||
    (body.quote_of_target_type && !targetTypes.has(body.quote_of_target_type))
  ) {
    return errorJson(context, "INVALID_TARGET_TYPE", "validation_error", "対象の種類が正しくありません。", 400);
  }

  const isRepost = Boolean(body.repost_of_target_type && body.repost_of_target_id);
  const isQuote = Boolean(body.quote_of_target_type && body.quote_of_target_id);
  const normalizedBody = body.body?.trim() ?? "";

  if (normalizedBody.length > HUB_SOCIAL_POST_MAX_CHARACTERS) {
    return errorJson(context, "POST_BODY_TOO_LONG", "validation_error", `本文は${HUB_SOCIAL_POST_MAX_CHARACTERS}文字以内で入力してください。`, 400, {
      fields: [{ field: "body", reason: "max_length", maximum: HUB_SOCIAL_POST_MAX_CHARACTERS }],
    });
  }

  const imageIds = Array.isArray(body.image_ids) ? body.image_ids.filter((id): id is string => typeof id === "string") : [];
  const idempotencyKey = request.headers.get("idempotency-key")?.trim() || null;
  const clientRequestId = idempotencyKey ?? body.client_request_id?.trim() ?? null;
  if (clientRequestId && !/^[0-9a-f-]{36}$/i.test(clientRequestId)) {
    return errorJson(context, "INVALID_IDEMPOTENCY_KEY", "validation_error", "重複送信防止キーが正しくありません。", 400, {
      fields: [{ field: idempotencyKey ? "idempotency-key" : "client_request_id", reason: "invalid_uuid" }],
    });
  }
  const audience = body.audience === "followers" ? "followers" : "public";
  if (!normalizedBody && !isRepost && !isQuote && imageIds.length === 0) {
    return errorJson(context, "POST_CONTENT_REQUIRED", "validation_error", "本文または画像を追加してください。", 400);
  }

  if (isQuote && !normalizedBody) {
    return errorJson(context, "QUOTE_BODY_REQUIRED", "validation_error", "引用投稿には本文が必要です。", 400);
  }

  let postData;
  try {
    if (body.scheduled_at) {
      const scheduledAt = new Date(body.scheduled_at);
      if (!normalizedBody || imageIds.length || !Number.isFinite(scheduledAt.getTime()) || scheduledAt.getTime() < Date.now() + 60_000) {
        return errorJson(context, "INVALID_SCHEDULE", "validation_error", "予約投稿は本文のみで、1分後以降を指定してください。", 400);
      }
      const database = getHubD1();
      const viewer = await requireHubSessionProfile(request, database);
      assertExpectedSocialPostViewer(request, viewer.id);
      const scheduled = await scheduleD1SocialPost(database, viewer, { body: normalizedBody, audience, scheduledAt: scheduledAt.toISOString() });
      logger.info("post.scheduled", context, { status: 202 });
      return privateJson(context, { scheduled }, { status: 202 });
    }
    postData = await createSocialPostRouteData(request, {
      body: normalizedBody,
      identityMode: "account",
      replyToPostId: body.reply_to_post_id ?? null,
      repostOfTargetType: body.repost_of_target_type ?? null,
      repostOfTargetId: body.repost_of_target_id ?? null,
      quoteOfTargetType: body.quote_of_target_type ?? null,
      quoteOfTargetId: body.quote_of_target_id ?? null,
      imageIds,
      audience,
      clientRequestId
    });
  } catch (error) {
    if (error instanceof SocialPostScopeError) {
      return errorJson(context, "SOCIAL_POST_SCOPE_CHANGED", "forbidden", "投稿するプロフィールが変わりました。画面を読み直してください。", 409);
    }
    if (error instanceof HubAuthenticationError) {
      return errorJson(context, "AUTHENTICATION_REQUIRED", "unauthenticated", "ログインが必要です。", 401);
    }
    if (error instanceof HubProfileBlockedError) {
      return errorJson(context, "POSTING_FORBIDDEN", "forbidden", "このプロフィールでは投稿できません。", 403);
    }
    if (error instanceof RepostCooldownError) {
      const retryAfterSeconds = Math.max(1, Math.ceil((Date.parse(error.retryAt) - Date.now()) / 1000));
      return errorJson(context, "REPOST_COOLDOWN", "rate_limited", "続けてリポストする前に少しお待ちください。", 429, {
        retryAt: error.retryAt,
      }, { "Retry-After": String(retryAfterSeconds) });
    }
    if (error instanceof HubPostRateLimitError) {
      return errorJson(context, "POST_RATE_LIMITED", "rate_limited", "投稿回数の上限に達しました。", 429, {
        retryAfterSeconds: error.retryAfterSeconds,
      }, { "Retry-After": String(error.retryAfterSeconds) });
    }
    if (error instanceof HubD1UnavailableError) {
      return errorJson(context, "SOCIAL_POSTS_UNAVAILABLE", "dependency_unavailable", "投稿機能を利用できません。", 503);
    }
    if (error instanceof Error && /target|incomplete/i.test(error.message)) {
      return errorJson(context, "POST_NOT_FOUND", "not_found", "対象の投稿が見つかりません。", 404);
    }
    logger.error("post.create_failed", context, { code: "UNEXPECTED_ERROR", status: 500 });
    return errorJson(context, "INTERNAL_ERROR", "internal_error", "投稿を作成できません。", 500);
  }

  logger.info("post.created", context, { status: 201 });
  if (audience === "public" && normalizedBody && postData.post.authorProfileId) {
    await federateNewPost(getHubD1(), postData.post, {
      attachments: postData.post.images?.map((image) => ({
        url: image.url,
        mediaType: "image/webp",
        name: image.altText,
      })) ?? [],
    });
  }
  return privateJson(context, postData, { status: 201 });
}
