import { engagementJson, handleEngagementRead, handleEngagementWrite } from "@/lib/server/article-engagement-route";
import {
  commentsEnabledFor,
  createArticleComment,
  listArticleComments,
} from "@/lib/server/d1-user-article-engagement";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ articleId: string }> };

/** コメントを古い順に1ページ。?cursor= で続きを取る。鍵付きの記事は条件を満たす人だけ。 */
export function GET(request: Request, { params }: Context) {
  const cursor = new URL(request.url).searchParams.get("cursor");
  return handleEngagementRead(request, params, async ({ database, profile, articleId }) => {
    const page = await listArticleComments(database, articleId, profile?.id ?? null, { cursor });
    return engagementJson({ ...page, commentsEnabled: await commentsEnabledFor(database, articleId) });
  });
}

/** コメントを書く。 */
export function POST(request: Request, { params }: Context) {
  return handleEngagementWrite(request, params, async ({ database, profile, articleId }) => {
    const payload = await request.json().catch(() => null) as { body?: unknown; parentId?: unknown } | null;
    const comment = await createArticleComment(database, profile, articleId, payload?.body, new Date(), payload?.parentId);
    return engagementJson({ comment }, 201);
  });
}
