import { engagementError, engagementJson } from "@/lib/server/article-engagement-route";
import { reportArticleComment } from "@/lib/server/d1-user-article-engagement";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getHubD1 } from "@/lib/server/hub-d1";
import { requireHubSessionProfile } from "@/lib/server/hub-session";

export const dynamic = "force-dynamic";

/** コメントを通報する（ログインが必要）。運営は通報の表から確認する。 */
export async function POST(request: Request, { params }: { params: Promise<{ articleId: string; commentId: string }> }) {
  if (!hasSameOrigin(request)) return engagementJson({ error: "不正なリクエストです。" }, 403);
  try {
    const { articleId, commentId } = await params;
    const database = getHubD1();
    const profile = await requireHubSessionProfile(request, database);
    const payload = await request.json().catch(() => null) as { reason?: unknown } | null;
    await reportArticleComment(database, profile, articleId, commentId, payload?.reason);
    return engagementJson({ ok: true }, 201);
  } catch (error) {
    return engagementError(error);
  }
}
