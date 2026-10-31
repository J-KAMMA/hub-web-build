import { getHubD1 } from '@/lib/server/hub-d1';
import { DesktopHubAuthenticationError, requireDesktopHubProfile } from '@/lib/server/desktop-hub-auth';
import { HubSuspendedError } from '@/lib/server/hub-session';
import { findUserArticle } from '@/lib/server/d1-user-articles';
import { isUserArticleSaved, saveUserArticle, unsaveUserArticle } from '@/lib/server/d1-user-article-saves';

const headers = { 'Cache-Control': 'private, no-store' };
type Context = { params: Promise<{ articleId: string }> };
async function handle(request: Request, {params}: Context, action: 'read' | 'save' | 'remove') {
  try {
    const database = getHubD1(), viewer = await requireDesktopHubProfile(request, database);
    const {articleId} = await params;
    if (typeof articleId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(articleId)) return Response.json({error:'invalid_article'}, {status:400, headers});
    if (action === 'remove') {
      await unsaveUserArticle(database, viewer.id, articleId);
      return Response.json({saved:false}, {headers});
    }
    if (action === 'save') {
      if (!await saveUserArticle(database, viewer.id, articleId)) return Response.json({error:'not_found'}, {status:404, headers});
      return Response.json({saved:true}, {headers});
    }
    if (!await findUserArticle(database, articleId, {audience:'general'})) return Response.json({error:'not_found'}, {status:404, headers});
    return Response.json({saved:await isUserArticleSaved(database, viewer.id, articleId)}, {headers});
  } catch (error) {
    const status = error instanceof DesktopHubAuthenticationError ? 401 : error instanceof HubSuspendedError ? 403 : 503;
    return Response.json({error:status === 401 ? 'desktop_authentication_failed' : status === 403 ? 'suspended' : 'unavailable'}, {status, headers});
  }
}
export const GET = (request: Request, context: Context) => handle(request, context, 'read');
export const POST = (request: Request, context: Context) => handle(request, context, 'save');
export const DELETE = (request: Request, context: Context) => handle(request, context, 'remove');
