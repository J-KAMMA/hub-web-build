import 'server-only';
import type { D1Database } from '@cloudflare/workers-types';
import type { Profile } from '@/lib/domain';
import { validateThreadContent } from '@/lib/bbs-content-quality';
import { formatResearchDiscussionBody, researchDocumentHref, type ResearchDiscussionSource } from '@/lib/research-workspace';
import { createBbsThreadForViewer, getMockBbsData } from './bbs-route-data';
import { ResearchWorkspaceError } from './research-workspace';

export async function prepareResearchDiscussion(db: D1Database, projectId: string, documentId: string, version: number, viewerId?: string) {
  if (!Number.isSafeInteger(version) || version < 1) throw new ResearchWorkspaceError('公開された版が見つかりません。', 404);
  const row = await db.prepare(`SELECT p.title projectTitle,p.owner_profile_id ownerId,d.title,r.content_hash contentHash
    FROM research_projects p JOIN research_documents d ON d.project_id=p.id JOIN research_document_revisions r ON r.document_id=d.id
    WHERE p.id=? AND d.id=? AND r.version=? AND p.visibility='public' AND p.status<>'withdrawn' AND d.visibility='public'`)
    .bind(projectId, documentId, version).first<{projectTitle:string;ownerId:string;title:string;contentHash:string}>();
  if (!row) throw new ResearchWorkspaceError('公開された版が見つかりません。', 404);
  const source: ResearchDiscussionSource = { projectId, projectTitle:row.projectTitle, documentId, title:row.title, version, contentHash:row.contentHash, href:researchDocumentHref(projectId,documentId,version) };
  const { getBoards } = await getMockBbsData();
  return { source, boards:getBoards().map(board => ({key:board.key,title:board.title})), canLink:row.ownerId === viewerId };
}

export async function createResearchDiscussion(db: D1Database, projectId: string, viewer: Profile, input: Record<string, unknown>) {
  if (input.action !== 'discuss' || typeof input.documentId !== 'string' || typeof input.version !== 'number' || typeof input.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.requestId)) throw new ResearchWorkspaceError('入力内容を確認してください。');
  const supplied = input.source as Record<string, unknown> | null;
  if (!Number.isSafeInteger(input.version) || input.version < 1 || !supplied || typeof supplied !== 'object' || supplied.projectId !== projectId || supplied.documentId !== input.documentId || supplied.version !== input.version || supplied.href !== researchDocumentHref(projectId,input.documentId,input.version) || !['projectTitle','title','contentHash'].every(key => typeof supplied[key] === 'string' && (supplied[key] as string).length > 0 && (supplied[key] as string).length <= 240)) throw new ResearchWorkspaceError('資料の表示が変わりました。再確認してください。',409);
  const previous = await db.prepare('SELECT p.author_profile_id authorId,p.body FROM threads t JOIN thread_posts p ON p.thread_id=t.id AND p.post_no=1 WHERE t.id=?').bind(input.requestId).first<{authorId:string;body:string}>();
  if (previous && previous.authorId !== viewer.id) throw new ResearchWorkspaceError('操作IDが別のスレッドで使用されています。',409);
  const source = previous ? supplied as ResearchDiscussionSource : (await prepareResearchDiscussion(db,projectId,input.documentId,input.version,viewer.id)).source;
  if (!previous && Object.entries(source).some(([key,value]) => supplied[key] !== value)) throw new ResearchWorkspaceError('資料の表示が変わりました。再確認してください。',409);
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  const body = typeof input.body === 'string' ? input.body.trim() : '';
  const error = validateThreadContent({title,body});
  if (error) throw new ResearchWorkspaceError(error);
  const { getBoards } = await getMockBbsData();
  if (!['question','issue','discussion'].includes(String(input.threadType)) || !getBoards().some(board => board.key === input.boardKey)) throw new ResearchWorkspaceError('投稿先と種類を確認してください。');
  const finalBody = formatResearchDiscussionBody(source,body);
  if (previous && previous.body !== finalBody) throw new ResearchWorkspaceError('操作IDが別のスレッドで使用されています。',409);
  const finalError = validateThreadContent({title,body:finalBody});
  if (finalError) throw new ResearchWorkspaceError(finalError);
  return createBbsThreadForViewer(db,viewer,{boardKey:input.boardKey as string,title,body:finalBody,threadType:input.threadType as 'question'|'issue'|'discussion',requestId:input.requestId,researchSource:source});
}
