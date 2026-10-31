import { engagementError, engagementJson } from "@/lib/server/article-engagement-route";
import { setPinnedComment } from "@/lib/server/d1-user-article-engagement";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getHubD1 } from "@/lib/server/hub-d1";
import { requireHubSessionProfile } from "@/lib/server/hub-session";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ articleId: string; commentId: string }> };

async function run(request: Request, { params }: Context, pin: boolean) {
  if (!hasSameOrigin(request)) return engagementJson({ error: "不正なリクエストです。" }, 403);
  try {
    const { articleId, commentId } = await params;
    const database = getHubD1();
    const profile = await requireHubSessionProfile(request, database);
    const pinnedCommentId = await setPinnedComment(database, profile.id, articleId, pin ? commentId : null);
    return engagementJson({ pinnedCommentId });
  } catch (error) {
    return engagementError(error);
  }
}

/** このコメントをピン留めする（記事の書き手だけ。前のピンは外れる）。 */
export function PUT(request: Request, context: Context) {
  return run(request, context, true);
}

/** ピン留めを外す。 */
export function DELETE(request: Request, context: Context) {
  return run(request, context, false);
}
