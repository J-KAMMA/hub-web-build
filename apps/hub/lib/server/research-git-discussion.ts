import 'server-only';
import type {D1Database} from '@cloudflare/workers-types';
import type {Profile} from '@/lib/domain';
import {gitCommitOid} from '@/lib/research-git-browse';
import {researchGitCommitHref,formatResearchGitDiscussionBody,type ResearchGitDiscussionSource} from '@/lib/research-git-discussion';
import {validateThreadContent} from '@/lib/bbs-content-quality';
import {readResearchGitCommit} from './research-git-browse';
import {createBbsThreadForViewer,getMockBbsData} from './bbs-route-data';
import {ResearchWorkspaceError} from './research-workspace';
const singleLine=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=240&&!/[\u0000-\u001f\u007f]/u.test(value)&&!/[\uD800-\uDBFF]$/.test(value);
export async function prepareResearchGitDiscussion(db:D1Database,projectId:string,oid:string,viewerId?:string){
  const detail=await readResearchGitCommit(db,projectId,oid);
  const project=await db.prepare(`SELECT p.title,p.owner_profile_id ownerId FROM research_projects p JOIN research_git_repositories r ON r.project_id=p.id WHERE p.id=? AND p.visibility='public' AND p.status<>'withdrawn' AND r.visibility='public'`).bind(projectId).first<{title:string;ownerId:string}>();
  if(!project)throw new ResearchWorkspaceError('公開リポジトリが見つかりません。',404);
  const subject=detail.commit.subject.replace(/[\u0000-\u001f\u007f]/gu,' ').trim().slice(0,240).replace(/[\uD800-\uDBFF]$/u,'') || '件名なし';
  if(!singleLine(project.title)||!singleLine(subject))throw new ResearchWorkspaceError('変更情報を議論に使用できません。',409);
  const source:ResearchGitDiscussionSource={projectId,projectTitle:project.title,oid,subject,href:researchGitCommitHref(projectId,oid)};
  const {getBoards}=await getMockBbsData();return {source,boards:getBoards().map(board=>({key:board.key,title:board.title})),canLink:project.ownerId===viewerId};
}
export async function createResearchGitDiscussion(db:D1Database,projectId:string,viewer:Profile,input:Record<string,unknown>){
  if(input.action!=='discuss_git'||projectId.length!==35||!/^rp_[a-f0-9]{32}$/.test(projectId)||!gitCommitOid(input.oid)||typeof input.requestId!=='string'||input.requestId.length!==36||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.requestId))throw new ResearchWorkspaceError('入力内容を確認してください。');
  const supplied=input.source as Record<string,unknown>|null;
  if(!supplied||typeof supplied!=='object'||Array.isArray(supplied)||supplied.projectId!==projectId||supplied.oid!==input.oid||supplied.href!==researchGitCommitHref(projectId,input.oid)||!singleLine(supplied.projectTitle)||!singleLine(supplied.subject))throw new ResearchWorkspaceError('参照する変更を再確認してください。',409);
  const previous=await db.prepare('SELECT p.author_profile_id authorId,p.body FROM threads t JOIN thread_posts p ON p.thread_id=t.id AND p.post_no=1 WHERE t.id=?').bind(input.requestId).first<{authorId:string;body:string}>();
  if(previous&&previous.authorId!==viewer.id)throw new ResearchWorkspaceError('操作IDが別のスレッドで使用されています。',409);
  const source=previous?supplied as ResearchGitDiscussionSource:(await prepareResearchGitDiscussion(db,projectId,input.oid,viewer.id)).source;
  if(!previous&&Object.entries(source).some(([key,value])=>supplied[key]!==value))throw new ResearchWorkspaceError('変更情報が更新されました。再確認してください。',409);
  const title=typeof input.title==='string'?input.title.trim():'',body=typeof input.body==='string'?input.body.trim():'';
  const error=validateThreadContent({title,body});if(error)throw new ResearchWorkspaceError(error);
  const {getBoards}=await getMockBbsData();if(!['question','issue','discussion'].includes(String(input.threadType))||!getBoards().some(board=>board.key===input.boardKey))throw new ResearchWorkspaceError('投稿先と種類を確認してください。');
  const finalBody=formatResearchGitDiscussionBody(source,body);
  if(previous&&previous.body!==finalBody)throw new ResearchWorkspaceError('操作IDが別のスレッドで使用されています。',409);
  const finalError=validateThreadContent({title,body:finalBody});if(finalError)throw new ResearchWorkspaceError(finalError);
  return createBbsThreadForViewer(db,viewer,{boardKey:input.boardKey as string,title,body:finalBody,threadType:input.threadType as 'question'|'issue'|'discussion',requestId:input.requestId,researchGitSource:source});
}
