import { engagementError, engagementJson } from "@/lib/server/article-engagement-route";
import { deleteArticleComment } from "@/lib/server/d1-user-article-engagement";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getHubD1 } from "@/lib/server/hub-d1";
import { getOptionalHubSessionProfile } from "@/lib/server/hub-session";
import { requireModerationAdmin } from "@/lib/server/moderation-admin-auth";

export const dynamic = "force-dynamic";

/**
 * コメントを削除する。できるのはコメント本人・記事の書き手・運営（管理セッション）。
 * 運営はログイン不要で、管理セッションだけで通る。
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ articleId: string; commentId: string }> }) {
  if (!hasSameOrigin(request)) return engagementJson({ error: "不正なリクエストです。" }, 403);
  try {
    const { articleId, commentId } = await params;
    const database = getHubD1();
    const profile = await getOptionalHubSessionProfile(request, database).catch(() => null);
    const moderator = requireModerationAdmin(request) === null;
    if (!profile && !moderator) return engagementJson({ error: "ログインが必要です。" }, 401);
    const removed = await deleteArticleComment(database, articleId, commentId, { profileId: profile?.id ?? null, moderator });
    return engagementJson({ ok: true, removed });
  } catch (error) {
    return engagementError(error);
  }
}
