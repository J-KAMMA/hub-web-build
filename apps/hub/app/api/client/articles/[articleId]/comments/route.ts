import { handleDesktopEngagement } from "@/lib/server/client-article-engagement-route";
import { engagementJson } from "@/lib/server/article-engagement-route";
import { createArticleComment } from "@/lib/server/d1-user-article-engagement";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ articleId: string }> };

/** コメントを書く。コメント可否・長さ・頻度・通知の規則は Web と同じ関数が持つ。 */
export function POST(request: Request, { params }: Context) {
  return handleDesktopEngagement(request, params, async ({ database, profile, articleId }) => {
    const payload = await request.json().catch(() => null) as { body?: unknown; parentId?: unknown } | null;
    const comment = await createArticleComment(database, profile, articleId, payload?.body, new Date(), payload?.parentId);
    return engagementJson({ comment }, 201);
  });
}
