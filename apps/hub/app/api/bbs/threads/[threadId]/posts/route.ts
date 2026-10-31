import { NextResponse } from "next/server";

import { createBbsThreadReplyRouteData, getBbsThreadPostsRouteData } from "@/lib/server/bbs-route-data";
import { validateIdentity, validateReplyContent } from "@/lib/bbs-content-quality";
import { HubAuthenticationError, getOptionalHubSessionProfile } from "@/lib/server/hub-session";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { HubPostRateLimitError } from "@/lib/server/d1-rate-limit";
import { HubProfileBlockedError } from "@/lib/server/profile-blocks";
import { THREAD_POST_ROLES, type ThreadPostRole, type ThreadSource } from "@/lib/thread-knowledge";
import { isThreadLanguage, isThreadRegion } from "@/lib/thread-scope";
import { isThreadLanguageTag, normalizeThreadCountries } from "@/lib/thread-fine-scope";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ threadId: string }> }
) {
  const { threadId } = await params;
  const database = getOptionalHubD1();
  const viewer = database ? await getOptionalHubSessionProfile(request, database).catch(() => null) : null;
  return NextResponse.json(await getBbsThreadPostsRouteData(threadId, viewer?.id ?? null), { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ threadId: string }> }
) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  const { threadId } = await params;
  const body = await request.json().catch(() => null) as {
    body?: string;
    identity_mode?: "anonymous" | "account";
    reply_to_post_id?: string | null;
    image_ids?: string[];
    role?: ThreadPostRole;
    supersedes_post_id?: string | null;
    sources?: ThreadSource[];
    language?: string;
    region?: string;
    language_tag?: string;
    country_code?: string | null;
  } | null;
  if (!body) return NextResponse.json({ error: "リクエストの形式が正しくありません。" }, { status: 400 });

  const contentError = validateReplyContent(body.body);
  if (contentError) return NextResponse.json({ error: contentError }, { status: 400 });

  const identityMode = body.identity_mode ?? "account";
  const identityError = validateIdentity(identityMode, undefined, ["account", "anonymous"]);
  if (identityError) return NextResponse.json({ error: identityError }, { status: 400 });
  if (!isThreadLanguage(body.language) || !isThreadRegion(body.region)) {
    return NextResponse.json({ error: "投稿の言語と対象地域を選んでください。" }, { status: 400 });
  }
  if (!isThreadLanguageTag(body.language_tag)) {
    return NextResponse.json({ error: "投稿に使う言語・方言を選んでください。" }, { status: 400 });
  }
  const countryCode = normalizeThreadCountries(body.country_code ? [body.country_code] : [])[0] ?? null;

  try {
    const postData = await createBbsThreadReplyRouteData(request, {
      threadId,
      body: body.body!.trim(),
      identityMode,
      replyToPostId: body.reply_to_post_id ?? null
      ,imageIds: Array.isArray(body.image_ids) ? body.image_ids.filter((id): id is string => typeof id === "string").slice(0, 4) : []
      ,role: THREAD_POST_ROLES.includes(body.role as ThreadPostRole) ? body.role : "unspecified"
      ,supersedesPostId: typeof body.supersedes_post_id === "string" ? body.supersedes_post_id : null
      ,sources: Array.isArray(body.sources) ? body.sources.slice(0,5) : []
      ,declaredLanguage: body.language
      ,declaredRegion: body.region
      ,declaredLanguageTag: body.language_tag
      ,declaredCountryCode: countryCode
    });

    return NextResponse.json(postData, { status: 201 });
  } catch (error) {
    if (error instanceof HubAuthenticationError) {
      return NextResponse.json({ error: "返信するにはHubへログインしてください。" }, { status: 401 });
    }
    if (error instanceof HubPostRateLimitError) {
      return NextResponse.json({ error: error.message, retry_after: error.retryAfterSeconds }, {
        status: 429,
        headers: { "Retry-After": String(error.retryAfterSeconds) },
      });
    }
    if (error instanceof HubProfileBlockedError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected error." },
      { status: 404 }
    );
  }
}
