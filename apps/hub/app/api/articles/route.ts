import { NextResponse } from "next/server";

import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getHubD1 } from "@/lib/server/hub-d1";
import { HubAuthenticationError, getOptionalHubSessionProfile, requireHubSessionProfile } from "@/lib/server/hub-session";
import { hasAdultOptIn } from "@/lib/adult/opt-in";
import { readListPagination } from "@/lib/server/list-pagination";
import { listUserArticlePage } from "@/lib/server/d1-user-article-queries";
import { encodeWorkCursor, findListableAuthorId, PROFILE_WORKS_PAGE, readAuthorListQuery } from "@/lib/server/profile-works";
import {
  UserArticleRateLimitError,
  UserArticlePublicationConflictError,
  UserArticleValidationError,
  listUserArticles,
  parsePublishInput,
  publishUserArticle,
} from "@/lib/server/d1-user-articles";

export const dynamic = "force-dynamic";

/**
 * 人が書いた記事の受け口。
 *
 * 公開の受け口は無料公開だけ。閲覧条件（ハブのトークンゲート）と添付ファイルは、
 * 公開した記事に後から付ける（PATCH の accessGateId、/api/content-files/attach）。
 * 販売の値付けはここで受けない。購入・返金は Commerce または外部販売者が持つ。
 */
export async function POST(request: Request) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: "不正なリクエストです。" }, { status: 403 });
  }
  try {
    const database = getHubD1();
    const profile = await requireHubSessionProfile(request, database);
    const payload = await request.json().catch(() => null) as Record<string, unknown> | null;

    const access = typeof payload?.access === "string" ? payload.access : "public";
    if (access !== "public") {
      return NextResponse.json({
        error: "限定・販売の指定はここでは受け付けません。公開したあとに閲覧条件を付けてください。",
        unsupportedAccess: access,
      }, { status: 409 });
    }

    const input = parsePublishInput(payload);
    if (input.audience === "adult" && !(await hasAdultOptIn())) {
      return NextResponse.json({
        error: "成人向けとして公開するには、先に成人向け表示を有効にしてください。",
      }, { status: 409 });
    }

    const { article, duplicate } = await publishUserArticle(database, profile, input);
    const href = article.audience === "adult"
      ? `/adult/articles/${article.id}`
      : `/articles/${article.id}`;
    return NextResponse.json({ id: article.id, href, duplicate }, { status: duplicate ? 200 : 201 });
  } catch (error) {
    if (error instanceof HubAuthenticationError) {
      return NextResponse.json({ error: "記事の公開にはログインが必要です。" }, { status: 401 });
    }
    if (error instanceof UserArticleValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof UserArticlePublicationConflictError) {
      return NextResponse.json({ error: "同じ公開操作で異なる記事は保存できません。" }, { status: 409 });
    }
    if (error instanceof UserArticleRateLimitError) {
      return NextResponse.json({ error: error.message }, {
        status: 429,
        headers: { "retry-after": String(error.retryAfterSeconds) },
      });
    }
    return NextResponse.json({ error: "記事を公開できませんでした。" }, { status: 500 });
  }
}

/**
 * 一覧。成人向けは成人表示を有効にした端末からしか返さない。
 * 無効な端末には題名も要約も渡さないので、一般の一覧へ混ざらない。
 */
/**
 * ?author=<handle>&cursor=<base64url>: one author's general articles for the profile tab, newest
 * first. Gated articles stay listed by title only (redactGated strips the summary and thumbnail).
 */
async function authorArticlesResponse(request: Request, database: ReturnType<typeof getHubD1>, url: URL) {
  const query = readAuthorListQuery(url, "author");
  if (!query) return NextResponse.json({ error: "invalid_query" }, { status: 400 });
  const authorId = await findListableAuthorId(database, query.handle);
  if (!authorId) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const viewer = await getOptionalHubSessionProfile(request, database).catch(() => null);
  const page = await listUserArticlePage(database, {
    audience: "general", limit: PROFILE_WORKS_PAGE, viewerProfileId: viewer?.id ?? null, authorProfileId: authorId,
    before: query.cursor ? { createdAt: query.cursor.at, id: query.cursor.id } : null,
  });
  return NextResponse.json({
    articles: page.articles.map((article) => ({
      id: article.id,
      title: article.title,
      summary: article.accessGate ? "" : article.summary,
      tags: article.tags,
      publishedAt: article.createdAt,
      href: `/articles/${article.id}`,
      locked: Boolean(article.accessGate),
    })),
    nextCursor: page.nextCursor ? encodeWorkCursor({ at: page.nextCursor.createdAt, id: page.nextCursor.id }) : null,
  }, { headers: { "cache-control": "no-store" } });
}

export async function GET(request: Request) {
  try {
    const database = getHubD1();
    const url = new URL(request.url);
    if (url.searchParams.has("author")) return await authorArticlesResponse(request, database, url);
    const { limit, offset } = readListPagination(url, { defaultLimit: 24 });
    const query = (url.searchParams.get("q") ?? "").trim();
    if (query.length > 100 || query.split(/\s+/u).length > 8) return NextResponse.json({ error: "invalid_query" }, { status: 400 });
    const wantsAdult = url.searchParams.get("audience") === "adult";
    if (wantsAdult && !(await hasAdultOptIn())) {
      return NextResponse.json({ articles: [], limit, offset, hasMore: false }, { status: 200 });
    }
    const viewer = await getOptionalHubSessionProfile(request, database).catch(() => null);
    const articles = await listUserArticles(database, {
      audience: wantsAdult ? "adult" : "general",
      limit: limit + 1, offset, query, viewerProfileId: viewer?.id ?? null,
    });
    return NextResponse.json({
      limit, offset, hasMore: articles.length > limit,
      articles: articles.slice(0, limit).map((article) => ({
        id: article.id,
        title: article.title,
        summary: article.summary,
        author: article.authorName,
        authorHandle: article.authorHandle,
        tags: article.tags,
        thumbnailUrl: article.thumbnailUrl,
        audience: article.audience,
        publishedAt: article.createdAt,
        href: article.audience === "adult" ? `/adult/articles/${article.id}` : `/articles/${article.id}`,
      })),
    });
  } catch {
    return NextResponse.json({ error: "記事を読み込めませんでした。" }, { status: 500 });
  }
}
