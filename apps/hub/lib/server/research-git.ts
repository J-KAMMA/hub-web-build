import 'server-only';
import type {D1Database} from '@cloudflare/workers-types';
import {ResearchWorkspaceError} from './research-workspace';
import {RESEARCH_GIT_REQUEST_ID, type ResearchGitManagementInfo, type ResearchGitManagementResult, type ResearchGitScope} from '@/lib/research-git-management';

const fail = (message: string, status = 400): never => {throw new ResearchWorkspaceError(message,status);};
const hash = async(value: string) => Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))).toString('hex');
const projectPattern = /^rp_[a-f0-9]{32}$(?![\s\S])/;
const profilePattern = /^[A-Za-z0-9_-]{1,100}$(?![\s\S])/;
const sqlNow = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
const activeViewer = "EXISTS(SELECT 1 FROM profiles v WHERE v.id=? AND NOT EXISTS(SELECT 1 FROM profile_moderation_status m WHERE m.profile_id=v.id AND m.status='suspended'))";
const projectQuery = `SELECT json_object('id',p.id,'owner',p.owner_profile_id,'visibility',p.visibility,'status',p.status,'updatedAt',p.updated_at,'repositoryVisibility',r.visibility,'repositoryCreatedAt',r.created_at) value FROM research_projects p JOIN profiles owner ON owner.id=p.owner_profile_id LEFT JOIN research_git_repositories r ON r.project_id=p.id WHERE p.id=?`;
const tokensQuery = `SELECT COALESCE(json_group_array(json_object('id',id,'owner',owner_profile_id,'scope',scope,'expiresAt',expires_at,'createdAt',created_at,'hash',token_hash)),'[]') value FROM (SELECT id,owner_profile_id,scope,expires_at,created_at,token_hash FROM research_git_tokens WHERE project_id=? AND ?=(SELECT owner_profile_id FROM research_projects WHERE id=?) AND revoked_at IS NULL AND expires_at>${sqlNow} ORDER BY id)`;
type Project = {id:string;owner:string;visibility:string;status:string;updatedAt:string;repositoryVisibility:string|null;repositoryCreatedAt:string|null};
type Token = {id:string;owner:string;scope:ResearchGitScope;expiresAt:string;createdAt:string;hash:string};
type State = {project:Project;tokens:Token[];projectJson:string;tokensJson:string;viewer:string};

export function researchGitUrl(projectId: string) {
  const configured = process.env.HUB_RESEARCH_GIT_PUBLIC_ORIGIN;
  if (!configured && process.env.NODE_ENV !== 'development') return null;
  try {
    const url = new URL(configured || 'http://127.0.0.1:43131');
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || (url.protocol !== 'https:' && !(process.env.NODE_ENV === 'development' && url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname)))) return null;
    return `${url.origin}/git/${encodeURIComponent(projectId)}.git`;
  } catch {return null;}
}
async function readState(db: D1Database, projectId: string, viewer = ''): Promise<State> {
  if (!projectPattern.test(projectId)) return fail('プロジェクトが見つかりません。',404);
  if (viewer && (!profilePattern.test(viewer) || !await db.prepare(`SELECT ${activeViewer} allowed`).bind(viewer).first<{allowed:number}>().then(row=>row?.allowed))) return fail('Gitの操作権限を確認できません。',403);
  const captured = await db.prepare(projectQuery).bind(projectId).first<{value:string}>();
  if (!captured) return fail('プロジェクトが見つかりません。',404);
  const project = JSON.parse(captured.value) as Project;
  if (project.owner !== viewer && (project.visibility !== 'public' || project.status === 'withdrawn')) return fail('プロジェクトが見つかりません。',404);
  const capturedTokens = await db.prepare(tokensQuery).bind(projectId,viewer,projectId).first<{value:string}>();
  if (!capturedTokens) return fail('Gitの情報を確認できませんでした。',503);
  const tokens = JSON.parse(capturedTokens.value) as Token[];
  if (!Array.isArray(tokens) || tokens.length > 20) return fail('Gitの認証情報を確認できませんでした。',503);
  return {project,tokens,projectJson:captured.value,tokensJson:capturedTokens.value,viewer};
}
function guard(state: State) {
  return {sql:`(${projectQuery})=? AND (${tokensQuery})=? AND (?='' OR ${activeViewer})`,args:[state.project.id,state.projectJson,state.project.id,state.viewer,state.project.id,state.tokensJson,state.viewer,state.viewer]};
}
async function unchanged(db: D1Database, state: State) {
  const current = guard(state);
  return !!(await db.prepare(`SELECT (${current.sql}) valid`).bind(...current.args).first<{valid:number}>())?.valid;
}
const owner = (state: State) => {if (state.project.owner !== state.viewer) return fail('編集権限がありません。',403); if (state.project.status === 'withdrawn') return fail('撤回されたプロジェクトは変更できません。',409);};
async function info(db: D1Database, state: State): Promise<ResearchGitManagementInfo> {
  const {project,viewer,tokens} = state, canManage = project.owner === viewer && project.status !== 'withdrawn';
  const snapshot = await hash(JSON.stringify([viewer,state.projectJson,state.tokensJson]));
  if (!await unchanged(db,state)) return fail('Gitの情報や権限が変わりました。もう一度読み込んでください。',409);
  const visibleRepository = project.repositoryVisibility && (project.owner === viewer || project.repositoryVisibility === 'public');
  return {projectId:project.id,viewerId:viewer || null,canManage,projectPublic:project.visibility === 'public' && project.status !== 'withdrawn',snapshot,
    repository:visibleRepository ? {visibility:project.repositoryVisibility as 'public'|'confidential',url:researchGitUrl(project.id)} : null,
    tokens:canManage ? tokens.map(({id,scope,expiresAt})=>({id,scope,expiresAt})) : []};
}
export async function researchGitInfo(db: D1Database, projectId: string, viewer?: string) {return info(db,await readState(db,projectId,viewer));}

function input(body: Record<string,unknown>) {
  if (!body || typeof body!=='object' || Array.isArray(body)) return fail('操作が不正です。');
  const fields: Record<string,string[]> = {create:[],visibility:['visibility'],revoke:['id'],token:['scope','requestId']};
  const action = body.action;
  if (typeof action !== 'string' || !Object.hasOwn(fields,action) || Object.keys(body).some(key=>!['action','snapshot',...fields[action]].includes(key))) return fail('操作が不正です。');
  if (body.snapshot !== undefined && (typeof body.snapshot !== 'string' || !/^[a-f0-9]{64}$(?![\s\S])/.test(body.snapshot))) return fail('確認したGit情報を読み直してください。');
  if (action === 'visibility' && body.visibility !== 'public' && body.visibility !== 'confidential') return fail('公開範囲が不正です。');
  if (action === 'revoke' && (typeof body.id !== 'string' || !RESEARCH_GIT_REQUEST_ID.test(body.id))) return fail('認証情報を選んでください。');
  if (action === 'token' && (body.scope !== 'read' && body.scope !== 'write' || body.snapshot !== undefined && (typeof body.requestId !== 'string' || !RESEARCH_GIT_REQUEST_ID.test(body.requestId)) || body.requestId !== undefined && (body.snapshot === undefined || typeof body.requestId !== 'string' || !RESEARCH_GIT_REQUEST_ID.test(body.requestId)))) return fail('権限と発行操作を確認してください。');
  return action as ResearchGitManagementResult['action'];
}
async function acknowledgement(db: D1Database, projectId: string, viewer: string, action: ResearchGitManagementResult['action'], replayed: boolean, extra: Partial<ResearchGitManagementResult> = {}): Promise<ResearchGitManagementResult> {
  const state = await readState(db,projectId,viewer); owner(state);
  if (action === 'token') {
    const current=state.tokens.find(row=>row.id===extra.id && row.owner===viewer && row.scope===extra.scope && row.expiresAt===extra.expiresAt);
    if (extra.token && (!current || current.hash!==await hash(extra.token))) return fail('認証情報の現在状態を確認できません。同じ発行操作で確認してください。',409);
    extra={...extra,active:!!current};
  }
  return {projectId,action,replayed,...extra,data:await info(db,state)};
}
type SavedToken = {id:string;projectId:string;owner:string;scope:ResearchGitScope;expiresAt:string;revokedAt:string|null};
async function savedToken(db:D1Database,id:string) {return db.prepare('SELECT id,project_id projectId,owner_profile_id owner,scope,expires_at expiresAt,revoked_at revokedAt FROM research_git_tokens WHERE id=?').bind(id).first<SavedToken>();}
async function replayToken(db:D1Database,projectId:string,viewer:string,body:Record<string,unknown>,saved:SavedToken) {
  if (saved.projectId !== projectId || saved.owner !== viewer || saved.scope !== body.scope) return fail('発行操作IDが別の操作で使用されています。',409);
  if (!Number.isFinite(Date.parse(saved.expiresAt))) return fail('認証情報の期限を確認できませんでした。',503);
  return acknowledgement(db,projectId,viewer,'token',true,{id:saved.id,requestId:saved.id,scope:saved.scope,expiresAt:saved.expiresAt,active:saved.revokedAt === null && Date.parse(saved.expiresAt) > Date.now()});
}
export async function mutateResearchGit(db:D1Database,projectId:string,viewer:string,body:Record<string,unknown>):Promise<ResearchGitManagementResult> {
  const action = input(body), state = await readState(db,projectId,viewer); owner(state);
  if (action === 'token' && body.requestId) {const saved=await savedToken(db,body.requestId as string);if (saved) return replayToken(db,projectId,viewer,body,saved);}
  const current = await info(db,state);
  if (body.snapshot !== undefined && body.snapshot !== current.snapshot) return fail('Gitの情報が更新されています。現在の状態を読み直してください。',409);
  const conditional = guard(state), now = new Date().toISOString();
  if (action === 'create') {
    if (state.project.repositoryVisibility) return acknowledgement(db,projectId,viewer,action,true);
    const result = await db.prepare(`INSERT OR IGNORE INTO research_git_repositories(project_id,created_at) SELECT ?,? WHERE ${conditional.sql}`).bind(projectId,now,...conditional.args).run();
    if (!result.meta.changes) return fail('Gitの登録状態や権限が変わりました。もう一度読み込んでください。',409);
    return acknowledgement(db,projectId,viewer,action,false);
  }
  if (!state.project.repositoryVisibility) return fail('リポジトリがありません。',404);
  if (action === 'visibility') {
    if (state.project.repositoryVisibility === body.visibility) return acknowledgement(db,projectId,viewer,action,true);
    const result = await db.prepare(`UPDATE research_git_repositories SET visibility=? WHERE project_id=? AND ${conditional.sql}`).bind(body.visibility,projectId,...conditional.args).run();
    if (!result.meta.changes) return fail('Gitの公開範囲や権限が変わりました。もう一度読み込んでください。',409);
    return acknowledgement(db,projectId,viewer,action,false);
  }
  if (action === 'revoke') {
    const saved = await savedToken(db,body.id as string);
    if (!saved || saved.projectId !== projectId) return fail('認証情報が見つかりません。',404);
    if (saved.revokedAt) return acknowledgement(db,projectId,viewer,action,true);
    const result = await db.prepare(`UPDATE research_git_tokens SET revoked_at=? WHERE id=? AND project_id=? AND revoked_at IS NULL AND ${conditional.sql}`).bind(now,body.id,projectId,...conditional.args).run();
    if (!result.meta.changes) return fail('認証情報や権限が変わりました。もう一度読み込んでください。',409);
    return acknowledgement(db,projectId,viewer,action,false);
  }
  const id = body.requestId as string || crypto.randomUUID(), token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url'), tokenHash = await hash(token), expiresAt = new Date(Date.now()+3600000).toISOString();
  const result = await db.prepare(`INSERT OR IGNORE INTO research_git_tokens(id,project_id,owner_profile_id,token_hash,scope,expires_at,created_at) SELECT ?,?,?,?,?,?,? WHERE ${conditional.sql} AND (SELECT count(*) FROM research_git_tokens WHERE project_id=? AND revoked_at IS NULL AND expires_at>${sqlNow})<10`)
    .bind(id,projectId,viewer,tokenHash,body.scope,expiresAt,now,...conditional.args,projectId).run();
  if (!result.meta.changes) {
    const saved = await savedToken(db,id); if (saved && body.requestId) return replayToken(db,projectId,viewer,body,saved);
    if (!await unchanged(db,state)) return fail('Gitの情報や権限が変わりました。もう一度読み込んでください。',409);
    return fail('有効な認証情報は10件までです。不要なものを無効化してください。',409);
  }
  return acknowledgement(db,projectId,viewer,'token',false,{id,requestId:id,scope:body.scope as ResearchGitScope,expiresAt,active:true,token});
}
export async function authorizeResearchGit(db:D1Database,projectId:string,write:boolean,token:string) {
  if (!projectPattern.test(projectId) || token && !/^[A-Za-z0-9_-]{43}$(?![\s\S])/.test(token)) return false;
  if (!token) return !write && !!await db.prepare("SELECT r.project_id FROM research_git_repositories r JOIN research_projects p ON p.id=r.project_id JOIN profiles owner ON owner.id=p.owner_profile_id WHERE r.project_id=? AND r.visibility='public' AND p.visibility='public' AND p.status<>'withdrawn'").bind(projectId).first();
  const tokenHash = await hash(token);
  return !!await db.prepare(`SELECT t.id FROM research_git_tokens t JOIN research_git_repositories r ON r.project_id=t.project_id JOIN research_projects p ON p.id=r.project_id JOIN profiles owner ON owner.id=p.owner_profile_id WHERE t.token_hash=? AND t.project_id=? AND t.owner_profile_id=p.owner_profile_id AND p.status<>'withdrawn' AND t.revoked_at IS NULL AND t.expires_at>${sqlNow} AND (?=0 OR t.scope='write') AND NOT EXISTS(SELECT 1 FROM profile_moderation_status m WHERE m.profile_id=p.owner_profile_id AND m.status='suspended')`).bind(tokenHash,projectId,Number(write)).first();
}

/** Internal operation credential, never returned to a client or persisted in plaintext. */
export async function withResearchGitWrite<T>(db:D1Database,projectId:string,viewer:string,operation:(token:string)=>Promise<T>):Promise<T>{
  const state=await readState(db,projectId,viewer);owner(state);if(!state.project.repositoryVisibility)return fail('リポジトリがありません。',404);
  const g=guard(state),id=crypto.randomUUID(),token=Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url'),tokenHash=await hash(token),now=new Date().toISOString(),expires=new Date(Date.now()+60000).toISOString();
  const result=await db.prepare(`INSERT INTO research_git_tokens(id,project_id,owner_profile_id,token_hash,scope,expires_at,created_at) SELECT ?,?,?,?,'write',?,? WHERE ${g.sql} AND (SELECT count(*) FROM research_git_tokens WHERE project_id=? AND revoked_at IS NULL AND expires_at>${sqlNow})<10`).bind(id,projectId,viewer,tokenHash,expires,now,...g.args,projectId).run();
  if(!result.meta.changes)return fail('Gitの権限や認証件数が変わりました。読み直してください。',409);
  try{return await operation(token);}finally{await db.prepare(`UPDATE research_git_tokens SET revoked_at=? WHERE id=? AND token_hash=? AND project_id=? AND owner_profile_id=? AND revoked_at IS NULL`).bind(new Date().toISOString(),id,tokenHash,projectId,viewer).run();}
}
