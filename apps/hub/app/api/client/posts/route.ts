import { NextResponse } from "next/server";
import { clientFeedPost, feedManaged, feedExpectedViewerError, feedHeaders } from "@/lib/server/client-feed-operation";

import { resolveHubFeatureFlag } from "@/lib/platform/feature-flags";
import { getHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import {
  DesktopHubAuthenticationError,
  requireDesktopHubProfile,
} from "@/lib/server/desktop-hub-auth";
import { createD1SocialPost, readD1SocialPostRequest } from "@/lib/server/d1-social-posts";
import { scheduleD1SocialPost, readScheduledClientRequest, FeedRequestConflict } from "@/lib/server/d1-social-scheduled";
import {
  deleteD1SocialPost,
  editD1SocialPost,
  SocialPostActionError,
} from "@/lib/server/social-post-actions";
import {
  deleteFederatedPost,
  publishFederatedPost,
  updateFederatedPost,
} from "@/lib/server/federation-gateway";
import { safelyIngestVideosFromPublicBody } from "@/lib/server/auto-ingest-post-videos";
import { RepostCooldownError } from "@/lib/repost-cooldown";
import { HubPostRateLimitError } from "@/lib/server/d1-rate-limit";
import { HubProfileBlockedError } from "@/lib/server/profile-blocks";
import { HubSuspendedError } from "@/lib/server/hub-session";
import { HUB_SOCIAL_POST_MAX_CHARACTERS } from "@/lib/social-post-limits";
import { toClientPost } from "@/lib/client-feed-shape";

const socialPostingEnvironmentProvider = {
  getBoolean(key: string) {
    if (key !== "social.posting") return undefined;
    const value = process.env.HUB_FEATURE_SOCIAL_POSTING?.trim().toLowerCase();
    return value === "true" ? true : value === "false" ? false : undefined;
  },
};

const TARGET_TYPES = new Set(["social_post", "thread_post", "community_message"]);

/**
 * クライアント（デスクトップ・モバイル）専用の投稿口。
 *
 * /api/social/posts はブラウザのセッションCookie＋同一オリジン前提。
 * 端末は assertion をBearerで持って来るので別口にする。画像は
 * /api/client/images で pending 画像として上げたものだけが imageIds で
 * 貼れる（所有・状態の検査は createD1SocialPost 側）。scheduledAt を
 * 付けると予約投稿になる（テキストのみ・画像不可はブラウザ版と同じ）。
 * 匿名モードは載せない——要る操作はブラウザ側の画面へ任せる。
 */
export const POST = clientFeedPost(post);
async function post(request: Request) {
  if (!(await resolveHubFeatureFlag("social.posting", socialPostingEnvironmentProvider))) {
    return NextResponse.json({ error: "投稿機能は一時的に利用できません。" }, { status: 503 });
  }
  const body = (await request.json().catch(() => null)) as {
    body?: string;
    replyToPostId?: string | null;
    repostOfTargetType?: string | null;
    repostOfTargetId?: string | null;
    quoteOfTargetType?: string | null;
    quoteOfTargetId?: string | null;
    audience?: string;
    clientRequestId?: string | null;
    imageIds?: string[];
    scheduledAt?: string | null;
  } | null;
  if (!body) {
    return NextResponse.json({ error: "JSON形式の本文が必要です。" }, { status: 400 });
  }
  if (
    (body.repostOfTargetType && !TARGET_TYPES.has(body.repostOfTargetType)) ||
    (body.quoteOfTargetType && !TARGET_TYPES.has(body.quoteOfTargetType))
  ) {
    return NextResponse.json({ error: "対象の種類が正しくありません。" }, { status: 400 });
  }
  const isRepost = Boolean(body.repostOfTargetType && body.repostOfTargetId);
  const isQuote = Boolean(body.quoteOfTargetType && body.quoteOfTargetId);
  const normalizedBody = body.body?.trim() ?? "";
  if (normalizedBody.length > HUB_SOCIAL_POST_MAX_CHARACTERS) {
    return NextResponse.json(
      { error: `本文は${HUB_SOCIAL_POST_MAX_CHARACTERS}文字以内で入力してください。` },
      { status: 400 },
    );
  }
  const clientRequestId = body.clientRequestId?.trim() || null;
  if (clientRequestId && !/^[0-9a-f-]{36}$/i.test(clientRequestId)) {
    return NextResponse.json({ error: "重複送信防止キーが正しくありません。" }, { status: 400 });
  }
  const imageIds = Array.isArray(body.imageIds)
    ? body.imageIds.filter((id): id is string => typeof id === "string")
    : [];
  if (
    imageIds.length > 4 ||
    imageIds.some((id) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
  ) {
    return NextResponse.json({ error: "画像の指定が正しくありません。" }, { status: 400 });
  }
  if (!normalizedBody && !isRepost && !isQuote && imageIds.length === 0) {
    return NextResponse.json({ error: "本文を入力してください。" }, { status: 400 });
  }
  if (isQuote && !normalizedBody) {
    return NextResponse.json({ error: "引用投稿には本文が必要です。" }, { status: 400 });
  }
  const scheduledAtInput = typeof body.scheduledAt === "string" ? new Date(body.scheduledAt) : null;
  if (
    body.scheduledAt !== undefined && body.scheduledAt !== null &&
    !(scheduledAtInput && Number.isFinite(scheduledAtInput.getTime()))
  ) {
    return NextResponse.json({ error: "予約時刻が正しくありません。" }, { status: 400 });
  }
  try {
    const database = getHubD1();
    const profile = await requireDesktopHubProfile(request, database);
    const managed = feedManaged(request);
    const mismatch = feedExpectedViewerError(request, profile.id); if (mismatch) return mismatch;
    // Existing managed requests can reconcile a now-past or terminal reservation.
    const previousSchedule = managed && scheduledAtInput && clientRequestId
      ? await readScheduledClientRequest(database, profile.id, clientRequestId) : null;
    // 予約投稿はテキストのみ・60秒後以降——ブラウザ版 /api/social/posts と同じ条件。
    if (scheduledAtInput) {
      if (
        !normalizedBody || imageIds.length || isRepost || isQuote || body.replyToPostId ||
        !Number.isFinite(scheduledAtInput.getTime()) || !previousSchedule && scheduledAtInput.getTime() < Date.now() + 60_000
      ) {
        return NextResponse.json({ error: "予約投稿の内容が正しくありません。" }, { status: 400 });
      }
      const scheduled = await scheduleD1SocialPost(database, profile, {
        body: normalizedBody,
        audience: body.audience === "followers" ? "followers" : "public",
        scheduledAt: scheduledAtInput.toISOString(),
        ...(managed ? { clientRequestId } : {}),
      });
      if (managed) {
        const receipt = await readScheduledClientRequest(database, profile.id, clientRequestId!);
        if (!receipt || receipt.id !== scheduled.id) throw Error("feed_operation_unavailable");
        return NextResponse.json({ viewerId: profile.id, clientRequestId, post: null, scheduled: receipt }, { status: 202, headers: feedHeaders });
      }
      return NextResponse.json(
        { scheduled },
        { status: 202, headers: { "cache-control": "no-store" } },
      );
    }
    const input = {
      body: normalizedBody,
      identityMode: "account" as const,
      replyToPostId: body.replyToPostId ?? null,
      repostOfTargetType: (body.repostOfTargetType ?? null) as "social_post" | "thread_post" | "community_message" | null,
      repostOfTargetId: body.repostOfTargetId ?? null,
      quoteOfTargetType: (body.quoteOfTargetType ?? null) as "social_post" | "thread_post" | "community_message" | null,
      quoteOfTargetId: body.quoteOfTargetId ?? null,
      imageIds,
      audience: body.audience === "followers" ? ("followers" as const) : ("public" as const),
      clientRequestId,
    };
    const previousPost = managed ? await readD1SocialPostRequest(database, profile.id, clientRequestId!) : null;
    const post = previousPost ?? await createD1SocialPost(database, profile, input);
    let receipt;
    if (managed) {
      receipt = await readD1SocialPostRequest(database, profile.id, clientRequestId!);
      const actualImages = (receipt?.images ?? []).map(image => image.id).sort();
      if (!receipt || receipt.id !== post.id || receipt.body !== normalizedBody || receipt.audience !== input.audience
        || JSON.stringify(actualImages) !== JSON.stringify([...imageIds].sort())
        || receipt.replyToPostId || receipt.repostOfTargetId || receipt.quoteOfTargetId) throw new FeedRequestConflict();
    }
    if (!previousPost) {
    await safelyIngestVideosFromPublicBody(database, profile, normalizedBody, {
      identityMode: "account",
      ingestSource: "social_post",
      post: { id: post.id, audience: input.audience },
    });
    if (input.audience === "public" && normalizedBody && post.authorProfileId) {
      await publishFederatedPost({
        profileId: post.authorProfileId,
        hubPostId: post.id,
        text: post.body,
        inReplyToHubPostId: post.replyToPostId,
      });
    }
    }
    if (managed && receipt) return NextResponse.json({ viewerId: profile.id, clientRequestId, post: { ...toClientPost(receipt), audience: receipt.audience }, scheduled: null }, { status: 201, headers: feedHeaders });
    return NextResponse.json(
      { post: toClientPost(post) },
      { status: 201, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return postError(error);
  }
}

/**
 * 自分の投稿の編集。ブラウザ側は /api/social/posts/[id] PATCH が
 * セッションCookie前提なので、端末はここで同じ editD1SocialPost を呼ぶ。
 * { id: "<投稿ID>", body: "<本文>" }
 */
export async function PATCH(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    id?: string;
    body?: string;
  } | null;
  if (typeof body?.id !== "string" || !body.id || typeof body.body !== "string") {
    return NextResponse.json({ error: "idと本文が必要です。" }, { status: 400 });
  }
  try {
    const database = getHubD1();
    const profile = await requireDesktopHubProfile(request, database);
    const post = await editD1SocialPost(database, body.id, profile.id, body.body);
    await updateFederatedPost(body.id, post.body);
    return NextResponse.json({ post }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return postError(error);
  }
}

/**
 * 自分の投稿の取り下げ。リポストの取り消しもここ——リポストは
 * 自分の投稿として作られているので、viewerRepostId をそのまま渡す。
 * { id: "<投稿ID>" }
 */
export async function DELETE(request: Request) {
  const body = (await request.json().catch(() => null)) as { id?: string } | null;
  if (typeof body?.id !== "string" || !body.id) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }
  try {
    const database = getHubD1();
    const profile = await requireDesktopHubProfile(request, database);
    const post = await deleteD1SocialPost(database, body.id, profile.id);
    await deleteFederatedPost(body.id);
    return NextResponse.json({ post }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return postError(error);
  }
}

function postError(error: unknown) {
  if (error instanceof FeedRequestConflict) return NextResponse.json({ error: "feed_operation_request_conflict" }, { status: 409, headers: feedHeaders });
  if (error instanceof DesktopHubAuthenticationError) {
    return NextResponse.json({ error: "desktop_authentication_failed" }, { status: 401 });
  }
  if (error instanceof HubSuspendedError) {
    return NextResponse.json({ error: "suspended" }, { status: 403 });
  }
  if (error instanceof HubProfileBlockedError) {
    return NextResponse.json({ error: "このプロフィールでは投稿できません。" }, { status: 403 });
  }
  if (error instanceof RepostCooldownError) {
    const retryAfterSeconds = Math.max(1, Math.ceil((Date.parse(error.retryAt) - Date.now()) / 1000));
    return NextResponse.json(
      { error: "続けてリポストする前に少しお待ちください。", retryAt: error.retryAt },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
    );
  }
  if (error instanceof HubPostRateLimitError) {
    return NextResponse.json(
      { error: "投稿回数の上限に達しました。", retryAfterSeconds: error.retryAfterSeconds },
      { status: 429, headers: { "Retry-After": String(error.retryAfterSeconds) } },
    );
  }
  if (error instanceof SocialPostActionError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof HubD1UnavailableError) {
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
  if (error instanceof Error && /target|incomplete|exist/i.test(error.message)) {
    return NextResponse.json({ error: "対象の投稿が見つかりません。" }, { status: 404 });
  }
  throw error;
}
