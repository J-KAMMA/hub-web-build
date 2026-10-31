import { NextResponse } from "next/server";

import { isEngagementArticleId } from "@/lib/server/d1-user-article-engagement";
import { recordArticleView } from "@/lib/server/d1-user-article-stats";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getHubD1 } from "@/lib/server/hub-d1";
import { getOptionalHubSessionProfile } from "@/lib/server/hub-session";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ articleId: string }> };

/*
 * 閲覧を1つ数えるビーコン。記事の描画は読み取りのまま保つため、ブラウザから1回だけ呼ぶ。
 * 何も保存しない（日別の合計に1を足すだけ）。応答は常に 204 で、数えたかは返さない。
 */
export async function POST(request: Request, { params }: Context) {
  const empty = () => new NextResponse(null, { status: 204, headers: { "cache-control": "no-store" } });
  if (!hasSameOrigin(request)) return empty();
  try {
    const { articleId } = await params;
    if (!isEngagementArticleId(articleId)) return empty();
    const database = getHubD1();
    const profile = await getOptionalHubSessionProfile(request, database).catch(() => null);
    await recordArticleView(database, articleId, profile?.id ?? null, request.headers.get("user-agent"));
  } catch { /* 数えられなくても読む画面には影響させない */ }
  return empty();
}
