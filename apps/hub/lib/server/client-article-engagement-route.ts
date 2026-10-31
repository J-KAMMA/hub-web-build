import { DesktopHubAuthenticationError, requireDesktopHubProfile } from "@/lib/server/desktop-hub-auth";
import { engagementError, engagementJson, type LoggedInEngagementContext } from "@/lib/server/article-engagement-route";
import { isEngagementArticleId } from "@/lib/server/d1-user-article-engagement";
import { getHubD1 } from "@/lib/server/hub-d1";
import { HubSuspendedError } from "@/lib/server/hub-session";

/**
 * Hub Desktop の記事いいね・コメントが共有する外枠。Bearer の端末資格だけで認証し（Cookie は見ない）、
 * 記事の規則は Web と同じ d1-user-article-engagement の関数に任せる。資格が無い・不正なら閉じる。
 */
export async function handleDesktopEngagement(
  request: Request,
  params: Promise<{ articleId: string }>,
  run: (context: LoggedInEngagementContext) => Promise<Response>,
): Promise<Response> {
  try {
    const { articleId } = await params;
    if (!isEngagementArticleId(articleId)) return engagementJson({ error: "invalid_article" }, 400);
    const database = getHubD1();
    const profile = await requireDesktopHubProfile(request, database);
    return await run({ database, profile, articleId });
  } catch (error) {
    if (error instanceof DesktopHubAuthenticationError) return engagementJson({ error: "desktop_authentication_failed" }, 401);
    if (error instanceof HubSuspendedError) return engagementJson({ error: "suspended" }, 403);
    return engagementError(error);
  }
}
