import { engagementJson, handleEngagementRead, handleEngagementWrite } from "@/lib/server/article-engagement-route";
import { getLikeState, setArticleLike } from "@/lib/server/d1-user-article-engagement";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ articleId: string }> };

/** いいねの数と、閲覧者が付けているか。ログインしていなくても数は読める。 */
export function GET(request: Request, { params }: Context) {
  return handleEngagementRead(request, params, async ({ database, profile, articleId }) =>
    engagementJson(await getLikeState(database, articleId, profile?.id ?? null)));
}

/** いいねを付ける（何度送っても同じ）。 */
export function PUT(request: Request, { params }: Context) {
  return handleEngagementWrite(request, params, async ({ database, profile, articleId }) =>
    engagementJson(await setArticleLike(database, profile, articleId, true)));
}

/** いいねを外す。 */
export function DELETE(request: Request, { params }: Context) {
  return handleEngagementWrite(request, params, async ({ database, profile, articleId }) =>
    engagementJson(await setArticleLike(database, profile, articleId, false)));
}
