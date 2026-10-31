import { NextResponse } from "next/server";

import { createBbsThreadReplyRouteData } from "@/lib/server/bbs-route-data";
import { validateReplyContent } from "@/lib/bbs-content-quality";
import { HubAuthenticationError, HubSuspendedError } from "@/lib/server/hub-session";
import { HubPostRateLimitError } from "@/lib/server/d1-rate-limit";
import { HubProfileBlockedError } from "@/lib/server/profile-blocks";
import { isThreadLanguage, isThreadRegion } from "@/lib/thread-scope";
import { isThreadLanguageTag, normalizeThreadCountries } from "@/lib/thread-fine-scope";

/**
 * クライアント向けのスレッド返信口。同一オリジン確認の代わりに
 * Bearer assertion で本人を確認する（ローダー側で解決）。
 * 画像・訂正・出典の添付はブラウザ側の画面に任せ、ここでは
 * 本文とスコープ宣言だけを受ける。
 * { body, replyToPostId?, language, region, languageTag, countryCode? }
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ threadId: string }> },
) {
  const { threadId } = await params;
  if (typeof threadId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(threadId)) {
    return NextResponse.json({ error: "スレッドの指定が正しくありません。" }, { status: 400 });
  }
  const body = (await request.json().catch(() => null)) as {
    body?: string;
    replyToPostId?: string | null;
    language?: string;
    region?: string;
    languageTag?: string;
    countryCode?: string | null;
  } | null;
  if (!body) {
    return NextResponse.json({ error: "リクエストの形式が正しくありません。" }, { status: 400 });
  }
  const contentError = validateReplyContent(body.body);
  if (contentError) return NextResponse.json({ error: contentError }, { status: 400 });
  if (!isThreadLanguage(body.language) || !isThreadRegion(body.region)) {
    return NextResponse.json({ error: "投稿の言語と対象地域を選んでください。" }, { status: 400 });
  }
  if (!isThreadLanguageTag(body.languageTag)) {
    return NextResponse.json({ error: "投稿に使う言語・方言を選んでください。" }, { status: 400 });
  }
  const countryCode = normalizeThreadCountries(body.countryCode ? [body.countryCode] : [])[0] ?? null;
  try {
    const data = await createBbsThreadReplyRouteData(request, {
      threadId,
      body: body.body!.trim(),
      identityMode: "account",
      replyToPostId: typeof body.replyToPostId === "string" ? body.replyToPostId : null,
      imageIds: [],
      role: "unspecified",
      declaredLanguage: body.language,
      declaredRegion: body.region,
      declaredLanguageTag: body.languageTag,
      declaredCountryCode: countryCode,
    });
    return NextResponse.json(data, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof HubAuthenticationError) {
      return NextResponse.json({ error: "返信するにはHubへ接続してください。" }, { status: 401 });
    }
    if (error instanceof HubSuspendedError) {
      return NextResponse.json({ error: "suspended" }, { status: 403 });
    }
    if (error instanceof HubPostRateLimitError) {
      return NextResponse.json({ error: error.message, retryAfter: error.retryAfterSeconds }, {
        status: 429,
        headers: { "Retry-After": String(error.retryAfterSeconds) },
      });
    }
    if (error instanceof HubProfileBlockedError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected error." },
      { status: 404 },
    );
  }
}
