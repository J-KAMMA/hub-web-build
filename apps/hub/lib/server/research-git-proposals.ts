import 'server-only';
import type {D1Database} from '@cloudflare/workers-types';
import {gitCommitOid} from '@/lib/research-git-browse';
import {gitProposalId,gitProposalText,gitComparisonHash,parseGitProposal,type GitProposal,type GitProposalPage,type GitProposalReview} from '@/lib/research-git-proposals';
import {readResearchGitCommit} from './research-git-browse';
import {ResearchWorkspaceError} from './research-workspace';
const fail=(message:string,status=400):never=>{throw new ResearchWorkspaceError(message,status);};
const hashId=(value:unknown):value is string=>typeof value==='string'&&value.length===64&&/^[a-f0-9]+$/.test(value);
const projectQuery=`SELECT json_object('owner',p.owner_profile_id,'visibility',p.visibility,'status',p.status,'updatedAt',p.updated_at,'gitVisibility',r.visibility,'ownerActive',NOT EXISTS(SELECT 1 FROM profile_moderation_status m WHERE m.profile_id=p.owner_profile_id AND m.status='suspended')) value FROM research_projects p JOIN profiles owner ON owner.id=p.owner_profile_id JOIN research_git_repositories r ON r.project_id=p.id WHERE p.id=?`;
const active="EXISTS(SELECT 1 FROM profiles v WHERE v.id=? AND NOT EXISTS(SELECT 1 FROM profile_moderation_status m WHERE m.profile_id=v.id AND m.status='suspended'))";
const rowJson="json_object('id',id,'projectId',project_id,'baseOid',base_oid,'headOid',head_oid,'title',title,'summary',summary,'sourceHash',source_hash,'author',author_profile_id,'status',status,'createdAt',created_at,'resolvedAt',resolved_at,'reviewer',reviewer_profile_id,'decisionSnapshot',decision_snapshot,'comparisonHash',comparison_hash)";
const rowQuery=`SELECT ${rowJson} value FROM research_git_proposals WHERE id=?`;
type State={projectId:string;viewer:string;json:string;project:{owner:string;visibility:string;status:string;updatedAt:string;gitVisibility:string;ownerActive:number}};
type Row=Omit<GitProposal,'mine'> & {author:string;sourceHash:string;reviewer:string|null;decisionSnapshot:string|null;comparisonHash:string|null};
const digest=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),byte=>byte.toString(16).padStart(2,'0')).join('');
async function state(db:D1Database,projectId:string,viewer:string):Promise<State>{
  if(projectId.length!==35||!/^rp_[a-f0-9]{32}$/.test(projectId))return fail('プロジェクトが見つかりません。',404);
  if(!viewer||viewer.length>100||!/^[A-Za-z0-9_-]+$/.test(viewer)||!(await db.prepare(`SELECT ${active} allowed`).bind(viewer).first<{allowed:number}>())?.allowed)return fail('操作権限を確認できません。',403);
  const captured=await db.prepare(projectQuery).bind(projectId).first<{value:string}>();if(!captured)return fail('Gitリポジトリが見つかりません。',404);
  const project=JSON.parse(captured.value) as State['project'];
  if(project.owner!==viewer&&(project.visibility!=='public'||project.status==='withdrawn'))return fail('プロジェクトが見つかりません。',404);
  return {projectId,viewer,json:captured.value,project};
}
const guard=(s:State)=>({sql:`(${projectQuery})=? AND ${active}`,args:[s.projectId,s.json,s.viewer]});
async function unchanged(db:D1Database,s:State){const g=guard(s);if(!(await db.prepare(`SELECT (${g.sql}) allowed`).bind(...g.args).first<{allowed:number}>())?.allowed)return fail('プロジェクトや権限が変わりました。読み直してください。',409);}
const publicProject=(s:State)=>{if(s.project.visibility!=='public'||s.project.gitVisibility!=='public'||s.project.status==='withdrawn'||!s.project.ownerActive)return fail('現在公開中のGitにだけ提案できます。',409);};
async function capture(db:D1Database,id:string){const value=await db.prepare(rowQuery).bind(id).first<{value:string}>();return value?{json:value.value,row:JSON.parse(value.value) as Row}:null;}
const visible=(s:State,row:Row)=>{if(row.projectId!==s.projectId||(row.author!==s.viewer&&s.project.owner!==s.viewer))return fail('変更提案が見つかりません。',404);};
const proposal=(s:State,row:Row)=>parseGitProposal({...row,mine:row.author===s.viewer},s.projectId,row.id);
const snapshot=(s:State,json:string)=>digest(JSON.stringify([s.viewer,s.json,json]));
async function saved(db:D1Database,s:State,id:string):Promise<GitProposal>{const value=await capture(db,id);if(!value)return fail('保存結果を確認できません。同じ内容で確認してください。',409);visible(s,value.row);await unchanged(db,s);return proposal(s,value.row);}
export async function listGitProposals(db:D1Database,projectId:string,viewer:string,cursor?:string):Promise<GitProposalPage>{
  let after:{createdAt:string;id:string}|undefined;
  if(cursor!==undefined){try{if(cursor.length>256)throw Error();const value=JSON.parse(cursor);if(!value||Object.keys(value).sort().join(',')!=='createdAt,id'||!gitProposalId(value.id)||typeof value.createdAt!=='string'||new Date(value.createdAt).toISOString()!==value.createdAt)throw Error();after=value;}catch{return fail('ページの指定が不正です。');}}
  const s=await state(db,projectId,viewer),rows=await db.prepare(`SELECT ${rowJson} value FROM research_git_proposals WHERE project_id=? AND (author_profile_id=? OR ?=?) ${after?'AND (created_at<? OR (created_at=? AND id<?))':''} ORDER BY created_at DESC,id DESC LIMIT 51`).bind(projectId,viewer,viewer,s.project.owner,...(after?[after.createdAt,after.createdAt,after.id]:[])).all<{value:string}>();
  const proposals=rows.results.slice(0,50).map(value=>proposal(s,JSON.parse(value.value) as Row));
  await unchanged(db,s);const last=proposals.at(-1);return {projectId,proposals,nextCursor:rows.results.length>50&&last?JSON.stringify({createdAt:last.createdAt,id:last.id}):null};
}
export async function readGitProposal(db:D1Database,projectId:string,viewer:string,id:string):Promise<GitProposalReview>{
  if(!gitProposalId(id))return fail('提案IDが不正です。');const s=await state(db,projectId,viewer),captured=await capture(db,id);if(!captured)return fail('変更提案が見つかりません。',404);visible(s,captured.row);
  const item=proposal(s,captured.row),canManage=s.project.owner===viewer&&s.project.ownerActive===1&&s.project.status!=='withdrawn',result:GitProposalReview={proposal:item,canManage,canReview:canManage&&item.status==='open',snapshot:await snapshot(s,captured.json)};
  try{result.comparison=await readResearchGitCommit(db,projectId,item.headOid,item.baseOid);result.comparisonHash=await gitComparisonHash(result.comparison);}catch{delete result.comparison;delete result.comparisonHash;result.comparisonError='現在の公開Gitから二版の差分を確認できません。承認には差分の再確認が必要です。';}
  if(new TextEncoder().encode(JSON.stringify(result)).length>512*1024){delete result.comparison;delete result.comparisonHash;result.comparisonError='比較の応答が表示上限を超えています。Gitで全体を確認してください。';}
  await unchanged(db,s);if((await capture(db,id))?.json!==captured.json)return fail('変更提案が更新されました。読み直してください。',409);return result;
}
export async function mutateGitProposal(db:D1Database,projectId:string,viewer:string,input:Record<string,unknown>):Promise<GitProposal>{
  const create=input.action==='create',fields=create?['action','requestId','baseOid','headOid','title','summary','comparisonHash']:['action','proposalId','snapshot',...(input.action==='approve'?['comparisonHash','fullReviewConfirmed']:[])];
  if(!['create','approve','reject'].includes(String(input.action))||Object.keys(input).some(key=>!fields.includes(key)))return fail('操作が不正です。');
  const id=create?input.requestId:input.proposalId;if(!gitProposalId(id))return fail('操作IDが不正です。');
  const s=await state(db,projectId,viewer),previous=await capture(db,id),g=guard(s);
  if(create){
    if(!gitCommitOid(input.baseOid)||!gitCommitOid(input.headOid)||input.baseOid.length!==input.headOid.length||input.baseOid===input.headOid||!gitProposalText(input.title,240)||!gitProposalText(input.summary,500)||!hashId(input.comparisonHash))return fail('二版と提案内容を確認してください。');
    const title=input.title.trim(),summary=input.summary.trim();
    const matches=(row:Row)=>row.projectId===projectId&&row.author===viewer&&row.baseOid===input.baseOid&&row.headOid===input.headOid&&row.title===title&&row.summary===summary&&row.sourceHash===input.comparisonHash;
    if(previous){if(!matches(previous.row))return fail('操作IDに保存済みの内容が一致しません。',409);return saved(db,s,id);}
    publicProject(s);const comparison=await readResearchGitCommit(db,projectId,input.headOid,input.baseOid);
    if(await gitComparisonHash(comparison)!==input.comparisonHash)return fail('確認した差分が変わりました。比較を読み直してください。',409);
    const result=await db.prepare(`INSERT OR IGNORE INTO research_git_proposals(id,project_id,base_oid,head_oid,title,summary,source_hash,author_profile_id,created_at) SELECT ?,?,?,?,?,?,?,?,? WHERE ${g.sql} AND (SELECT count(*) FROM research_git_proposals WHERE project_id=? AND status IN ('open','approved'))<100 AND (SELECT count(*) FROM research_git_proposals WHERE author_profile_id=? AND created_at>=strftime('%Y-%m-%dT00:00:00.000Z','now'))<30`).bind(id,projectId,input.baseOid,input.headOid,title,summary,input.comparisonHash,viewer,new Date().toISOString(),...g.args,projectId,viewer).run();
    if(!result.meta.changes){const existing=await capture(db,id);if(existing&&matches(existing.row))return saved(db,s,id);if(existing)return fail('操作IDは使用済みです。',409);await unchanged(db,s);return fail('未解決の提案は100件、本人の作成はUTCの一日30件までです。',429);}
    return saved(db,s,id);
  }
  if(!hashId(input.snapshot)||input.action==='approve'&&(!hashId(input.comparisonHash)||input.fullReviewConfirmed!==undefined&&typeof input.fullReviewConfirmed!=='boolean'))return fail('レビュー内容を確認してください。');
  if(!previous)return fail('変更提案が見つかりません。',404);visible(s,previous.row);
  if(s.project.owner!==viewer||!s.project.ownerActive)return fail('レビューは現在の所有者だけが行えます。',403);
  if(s.project.status==='withdrawn')return fail('撤回されたプロジェクトは変更できません。',409);
  const status=input.action==='approve'?'approved':'rejected',row=previous.row;
  if(row.status!=='open'){if(row.status!==status||row.reviewer!==viewer||row.decisionSnapshot!==input.snapshot||row.comparisonHash!==(status==='approved'?input.comparisonHash:null))return fail('確定したレビューと一致しません。',409);return saved(db,s,id);}
  if(await snapshot(s,previous.json)!==input.snapshot)return fail('提案や公開範囲が変わりました。読み直してください。',409);
  if(status==='approved'){publicProject(s);const comparison=await readResearchGitCommit(db,projectId,row.headOid,row.baseOid);if(await gitComparisonHash(comparison)!==input.comparisonHash||comparison.truncated&&input.fullReviewConfirmed!==true)return fail('二版の全体と現在の差分を確認してください。',409);}
  const result=await db.prepare(`UPDATE research_git_proposals SET status=?,resolved_at=?,reviewer_profile_id=?,decision_snapshot=?,comparison_hash=? WHERE id=? AND status='open' AND (${rowQuery})=? AND ${g.sql}`).bind(status,new Date().toISOString(),viewer,input.snapshot,status==='approved'?input.comparisonHash:null,id,id,previous.json,...g.args).run();
  if(!result.meta.changes){const current=await capture(db,id);if(current?.row.status===status&&current.row.reviewer===viewer&&current.row.decisionSnapshot===input.snapshot&&current.row.comparisonHash===(status==='approved'?input.comparisonHash:null))return saved(db,s,id);return fail('提案や権限が変わりました。読み直してください。',409);}
  return saved(db,s,id);
}

export async function gitApplicationState(db:D1Database,projectId:string,viewer:string,id:string,expected?:string){
 if(!gitProposalId(id))return fail('提案IDが不正です。');const s=await state(db,projectId,viewer),captured=await capture(db,id);if(!captured)return fail('変更提案が見つかりません。',404);visible(s,captured.row);
 if(s.project.owner!==viewer||!s.project.ownerActive)return fail('反映は現在の所有者だけが行えます。',403);publicProject(s);
 const row=captured.row;if(row.status!=='approved'||!hashId(row.comparisonHash))return fail('レビュー承認済みの提案を選んでください。',409);
 const identity={projectId,proposalId:id,snapshot:await snapshot(s,captured.json),baseOid:row.baseOid,headOid:row.headOid,comparisonHash:row.comparisonHash};
 if(expected!==undefined&&identity.snapshot!==expected)return fail('提案や権限が変わりました。読み直してください。',409);await unchanged(db,s);if((await capture(db,id))?.json!==captured.json)return fail('提案が更新されました。',409);
 return identity;
}
/** Called by the Git service before writing and before returning its result. */
export async function authorizeGitApplication(db:D1Database,projectId:string,review:unknown){
 if(typeof review!=='string'||review.length>231)return false;const [id,expected,base,head,...extra]=review.split(':');if(extra.length||!gitProposalId(id)||!hashId(expected)||!gitCommitOid(base)||!gitCommitOid(head)||base.length!==head.length||base===head)return false;
 try{const project=await db.prepare(projectQuery).bind(projectId).first<{value:string}>();if(!project)return false;const owner=(JSON.parse(project.value) as State['project']).owner,identity=await gitApplicationState(db,projectId,owner,id,expected);return identity.baseOid===base&&identity.headOid===head;}catch{return false;}
}
