import { engagementError, engagementJson } from "@/lib/server/article-engagement-route";
import { setCommentLike } from "@/lib/server/d1-user-article-engagement";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getHubD1 } from "@/lib/server/hub-d1";
import { requireHubSessionProfile } from "@/lib/server/hub-session";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ articleId: string; commentId: string }> };

async function run(request: Request, { params }: Context, liked: boolean) {
  if (!hasSameOrigin(request)) return engagementJson({ error: "不正なリクエストです。" }, 403);
  try {
    const { articleId, commentId } = await params;
    const database = getHubD1();
    const profile = await requireHubSessionProfile(request, database);
    return engagementJson(await setCommentLike(database, profile, articleId, commentId, liked));
  } catch (error) {
    return engagementError(error);
  }
}

/** コメントにいいねを付ける（何度送っても同じ）。 */
export function PUT(request: Request, context: Context) {
  return run(request, context, true);
}

/** コメントのいいねを外す。 */
export function DELETE(request: Request, context: Context) {
  return run(request, context, false);
}
