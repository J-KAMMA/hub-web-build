import { handleDesktopEngagement } from "@/lib/server/client-article-engagement-route";
import { engagementJson } from "@/lib/server/article-engagement-route";
import { getLikeState, setArticleLike } from "@/lib/server/d1-user-article-engagement";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ articleId: string }> };

/** 自分がいいねしているかと件数。 */
export function GET(request: Request, { params }: Context) {
  return handleDesktopEngagement(request, params, async ({ database, profile, articleId }) =>
    engagementJson(await getLikeState(database, articleId, profile.id)));
}

/** いいねを付ける（何度送っても同じ。日次の統計加算は setArticleLike の中）。 */
export function PUT(request: Request, { params }: Context) {
  return handleDesktopEngagement(request, params, async ({ database, profile, articleId }) =>
    engagementJson(await setArticleLike(database, profile, articleId, true)));
}

/** いいねを外す。 */
export function DELETE(request: Request, { params }: Context) {
  return handleDesktopEngagement(request, params, async ({ database, profile, articleId }) =>
    engagementJson(await setArticleLike(database, profile, articleId, false)));
}
