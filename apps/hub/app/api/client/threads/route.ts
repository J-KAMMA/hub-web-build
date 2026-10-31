import { NextResponse } from "next/server";

import { createBbsThreadForViewer } from "@/lib/server/bbs-route-data";
import { validateIdentity, validateThreadContent } from "@/lib/bbs-content-quality";
import { isThreadLanguage, isThreadRegion } from "@/lib/thread-scope";
import { isThreadType } from "@/lib/thread-type";
import { normalizeThreadTags, validateThreadTags } from "@/lib/thread-tags";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import {
  DesktopHubAuthenticationError,
  requireDesktopHubProfile,
} from "@/lib/server/desktop-hub-auth";
import { HubSuspendedError } from "@/lib/server/hub-session";
import { HubPostRateLimitError } from "@/lib/server/d1-rate-limit";
import { normalizeAllowedThreadLanguages } from "@/lib/thread-scope-policy";
import { normalizeThreadCountries, normalizeThreadLanguageTags } from "@/lib/thread-fine-scope";
import { normalizeThreadIpPolicy } from "@/lib/server/thread-ip-policy";

/**
 * クライアント向けのスレッド作成。検証と作成はWeb側の
 * /api/bbs/threads POST と同じ関数を通す——掲示板の作法が
 * 経路で変わると片方だけ荒れるので、分岐は認証だけ。
 */
export async function POST(request: Request) {
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
    return NextResponse.json({ error: "投稿先を選んでください。" }, { status: 400 });
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

  const database = getOptionalHubD1();
  if (!database) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  try {
    const viewer = await requireDesktopHubProfile(request, database);
    const result = await createBbsThreadForViewer(database, viewer, {
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
      tags: normalizeThreadTags(body.tags),
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof HubSuspendedError) {
      return NextResponse.json({ error: "suspended" }, { status: 403 });
    }
    if (error instanceof DesktopHubAuthenticationError) {
      return NextResponse.json({ error: "desktop_authentication_failed" }, { status: 401 });
    }
    if (error instanceof HubPostRateLimitError) {
      return NextResponse.json(
        { error: error.message, retry_after: error.retryAfterSeconds },
        { status: 429, headers: { "Retry-After": String(error.retryAfterSeconds) } },
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected error." },
      { status: 400 },
    );
  }
}
