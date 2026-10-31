import { engagementJson, handleEngagementWrite } from "@/lib/server/article-engagement-route";
import { getCommentsEnabledForOwner, setCommentsEnabled } from "@/lib/server/d1-user-article-engagement";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ articleId: string }> };

/** コメントの受け付け設定（書き手本人だけ。下書きのidでも読める）。 */
export function GET(request: Request, { params }: Context) {
  return handleEngagementWrite(request, params, async ({ database, profile, articleId }) =>
    engagementJson({ commentsEnabled: await getCommentsEnabledForOwner(database, profile.id, articleId) }), { mutating: false });
}

export function PUT(request: Request, { params }: Context) {
  return handleEngagementWrite(request, params, async ({ database, profile, articleId }) => {
    const payload = await request.json().catch(() => null) as { commentsEnabled?: unknown } | null;
    if (typeof payload?.commentsEnabled !== "boolean") return engagementJson({ error: "commentsEnabled を true か false で指定してください。" }, 400);
    return engagementJson({ commentsEnabled: await setCommentsEnabled(database, profile.id, articleId, payload.commentsEnabled) });
  });
}
