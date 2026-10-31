import { NextResponse } from "next/server";

import { createBbsThreadRouteData, searchBbsThreadsRouteData } from "@/lib/server/bbs-route-data";
import { validateIdentity, validateThreadContent } from "@/lib/bbs-content-quality";
import { isThreadLanguage, isThreadRegion } from "@/lib/thread-scope";
import { HubAuthenticationError } from "@/lib/server/hub-session";
import { HubPostRateLimitError } from "@/lib/server/d1-rate-limit";
import { isThreadType } from "@/lib/thread-type";
import { normalizeThreadTags, validateThreadTags } from "@/lib/thread-tags";
import { readListPagination } from "@/lib/server/list-pagination";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { listD1BoardKeys, type D1ThreadListView } from "@/lib/server/d1-threads";
import { normalizeAllowedThreadLanguages } from "@/lib/thread-scope-policy";
import { normalizeThreadCountries, normalizeThreadLanguageTags } from "@/lib/thread-fine-scope";
import { normalizeThreadIpPolicy } from "@/lib/server/thread-ip-policy";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const { limit, offset } = readListPagination(url);
  const database = getOptionalHubD1();
  if (!database) {
    return NextResponse.json({ error: "掲示板を取得できませんでした。" }, { status: 503 });
  }
  const allowedBoardKeys = new Set(await listD1BoardKeys(database));
  const requestedBoardKeys = [
    ...url.searchParams.getAll("boardKey"),
    ...(url.searchParams.get("boardKeys") ?? "").split(","),
  ].map((key) => key.trim()).filter((key) => allowedBoardKeys.has(key)).slice(0, 50);
  const requestedView = url.searchParams.get("view") ?? "popular";
  const views = new Set<D1ThreadListView>(["popular", "latest", "rising", "unanswered", "solved", "quality"]);
  const view = views.has(requestedView as D1ThreadListView) ? requestedView as D1ThreadListView : "popular";
  return NextResponse.json(await searchBbsThreadsRouteData({
    boardKeys: requestedBoardKeys,
    query: url.searchParams.get("q") ?? "",
    view,
    limit,
    offset,
  }));
}

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  const body = await request.json().catch(() => null) as {
    board_key?: string;
    title?: string;
    body?: string;
    identity_mode?: "anonymous" | "account";
    language?: string;
    allowed_languages?: unknown;
    allowed_language_tags?: unknown;
    allowed_country_codes?: unknown;
    write_ip_policy?: unknown;
    region?: string;
    thread_type?: string;
    deadline?: string | null;
    tags?: unknown;
  } | null;

  if (!body) return NextResponse.json({ error: "リクエストの形式が正しくありません。" }, { status: 400 });

  if (!body.board_key) {
    return NextResponse.json(
      { error: "投稿先を選んでください。" },
      { status: 400 }
    );
  }

  const contentError = validateThreadContent(body);
  if (contentError) return NextResponse.json({ error: contentError }, { status: 400 });

  const identityMode = body.identity_mode ?? "account";
  const identityError = validateIdentity(identityMode, undefined, ["account", "anonymous"]);
  if (identityError) return NextResponse.json({ error: identityError }, { status: 400 });
  const language = body.language ?? "ja";
  const region = body.region ?? "global";
  if (!isThreadLanguage(language) || !isThreadRegion(region)) {
    return NextResponse.json({ error: "言語または対象地域が正しくありません。" }, { status: 400 });
  }
  const threadType = body.thread_type ?? "chat";
  if (!isThreadType(threadType)) {
    return NextResponse.json({ error: "スレッド種別が正しくありません。" }, { status: 400 });
  }
  const deadline = typeof body.deadline === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(body.deadline) ? body.deadline : null;
  if (threadType === "recruitment" && deadline && Date.parse(`${deadline}T23:59:59Z`) < Date.now()) {
    return NextResponse.json({ error: "募集期限は今日以降の日付を指定してください。" }, { status: 400 });
  }
  const tagsError = validateThreadTags(body.tags);
  if (tagsError) return NextResponse.json({ error: tagsError }, { status: 400 });

  try {
    const result = await createBbsThreadRouteData(request, {
      boardKey: body.board_key,
      title: body.title!.trim(),
      body: body.body!.trim(),
      identityMode,
      language,
      allowedLanguages: normalizeAllowedThreadLanguages(body.allowed_languages, language),
      allowedLanguageTags: normalizeThreadLanguageTags(body.allowed_language_tags),
      allowedCountryCodes: normalizeThreadCountries(body.allowed_country_codes),
      writeIpPolicy: normalizeThreadIpPolicy(body.write_ip_policy),
      region,
      threadType,
      deadline,
      tags: normalizeThreadTags(body.tags)
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof HubAuthenticationError) {
      return NextResponse.json({ error: "投稿するにはHubへログインしてください。" }, { status: 401 });
    }
    if (error instanceof HubPostRateLimitError) {
      return NextResponse.json({ error: error.message, retry_after: error.retryAfterSeconds }, {
        status: 429,
        headers: { "Retry-After": String(error.retryAfterSeconds) },
      });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected error." },
      { status: 400 }
    );
  }
}
