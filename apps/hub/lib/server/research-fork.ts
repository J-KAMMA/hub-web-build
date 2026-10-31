import 'server-only';
import type {D1Database} from '@cloudflare/workers-types';
import {getResearchProject} from './d1-research';
import {ResearchWorkspaceError} from './research-workspace';
import {isSecureRequest} from './hub-auth-route';
import {parseResearchForkPackage,researchForkDigest,RESEARCH_FORK_BYTES} from '@/lib/research-fork-package';

const fail = (message: string, status = 400): never => {throw new ResearchWorkspaceError(message, status);};
const projectId = (value: string) => value.length === 35 && /^rp_[a-f0-9]{32}$/.test(value);
const digest = researchForkDigest;
const documentsSql = `SELECT d.id,d.title,d.kind,d.head,r.body,r.content_hash contentHash
  FROM research_documents d JOIN research_document_revisions r ON r.document_id=d.id AND r.version=d.head
  WHERE d.project_id=? AND d.visibility='public' ORDER BY d.id LIMIT 21`;
const documentsJsonSql = `SELECT coalesce(json_group_array(json_object('id',id,'title',title,'kind',kind,'head',head,'body',body,'contentHash',contentHash)),'[]') FROM (${documentsSql})`;
type Document = {id:string;title:string;kind:string;head:number;body:string;contentHash:string};
export type ResearchForkSource = {projectId:string;href:string;title:string;snapshotHash:string;documents:{sourceId:string;documentId:string;version:number;contentHash:string}[]};
export function researchForkOrigin(request:Request) {
  const host=request.headers.get('x-forwarded-host')?.split(',',1)[0]?.trim()||request.headers.get('host')||new URL(request.url).host;
  return `${isSecureRequest(request)?'https':'http'}://${host}`;
}

function sourceHref(origin: string, id: string) {
  const url = new URL(origin);
  if (!projectId(id) || url.origin !== origin || url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname)))) return fail('派生元の指定が不正です。');
  return `${origin}/v2/research/${id}`;
}
async function snapshot(db: D1Database, id: string, origin: string) {
  const href = sourceHref(origin,id), project = await getResearchProject(db,id);
  if (!project || project.visibility !== 'public' || project.status === 'withdrawn') return fail('公開プロジェクトが見つかりません。',404);
  const documents = (await db.prepare(documentsSql).bind(id).all<Document>()).results;
  const count = await db.prepare("SELECT count(*) total FROM research_documents WHERE project_id=? AND visibility='public'").bind(id).first<{total:number}>();
  if ((count?.total ?? 0) > 20 || new TextEncoder().encode(JSON.stringify(documents)).byteLength > 1_000_000) return fail('forkは公開文書20件・合計1MBまでです。Git履歴はGitの持ち出し機能を使ってください。',413);
  if (count?.total !== documents.length) return fail('文書の最新版を確認できませんでした。',409);
  for (const doc of documents) if (!Number.isSafeInteger(doc.head) || doc.head < 1 || !doc.body.trim() || doc.body.length > 100000 || doc.contentHash !== await digest(doc.body)) return fail('文書の版またはハッシュを確認できませんでした。',409);
  const snapshotHash = await digest(JSON.stringify([href,project.title,project.description,project.defaultLicense,project.status,project.updatedAt,documents]));
  return {project,documents,href,snapshotHash};
}
async function assertSnapshotCurrent(db:D1Database,id:string,value:Awaited<ReturnType<typeof snapshot>>) {
  const p=value.project;
  // Recheck all public heads and metadata together. Document edits need not change project.updated_at.
  const current=await db.prepare(`SELECT 1 FROM research_projects p WHERE p.id=? AND p.visibility='public' AND p.status=? AND p.title=? AND p.description=? AND p.default_license IS ? AND p.updated_at=? AND (${documentsJsonSql})=? AND (SELECT count(*) FROM research_documents WHERE project_id=? AND visibility='public')=?`).bind(id,p.status,p.title,p.description,p.defaultLicense,p.updatedAt,id,JSON.stringify(value.documents),id,value.documents.length).first();
  if(!current)return fail('派生元が変わりました。再読み込みしてください。',409);
}
async function stableSnapshot(db:D1Database,id:string,origin:string) {
  const value=await snapshot(db,id,origin);await assertSnapshotCurrent(db,id,value);return value;
}
export async function exportResearchFork(db:D1Database,id:string,origin:string) {
  const snapshotValue=await snapshot(db,id,origin),{project,documents,href,snapshotHash}=snapshotValue;
  const value={protocol:'hub.research-fork.v1',project:{id,title:project.title,description:project.description,license:project.defaultLicense,status:project.status,updatedAt:project.updatedAt},href,snapshotHash,documents};
  if(new TextEncoder().encode(JSON.stringify(value)).byteLength>RESEARCH_FORK_BYTES)return fail('公開プロジェクトの持ち出しは合計1MBまでです。',413);
  let result;
  try{result=await parseResearchForkPackage(value,origin,id);}catch{return fail('公開プロジェクトの版を確認できませんでした。',409);}
  await assertSnapshotCurrent(db,id,snapshotValue);
  return result;
}
export async function prepareResearchFork(db: D1Database, id: string, origin: string) {
  const value = await stableSnapshot(db,id,origin);
  return {projectId:id,href:value.href,title:value.project.title,license:value.project.defaultLicense,snapshotHash:value.snapshotHash,documentCount:value.documents.length};
}
export async function readResearchForkSource(db: D1Database, id: string): Promise<ResearchForkSource|null> {
  const row = await db.prepare("SELECT agent_metadata_json value FROM research_provenance_events WHERE project_id=? AND activity_type='project_forked' LIMIT 1").bind(id).first<{value:string}>();
  if (!row) return null;
  try {
    const source = JSON.parse(row.value).source as ResearchForkSource, url = new URL(source.href);
    if (source.href !== sourceHref(url.origin,source.projectId) || source.snapshotHash.length !== 71 || !/^sha256:[a-f0-9]{64}$/.test(source.snapshotHash) || typeof source.title !== 'string' || source.title.length > 240 || !Array.isArray(source.documents)) return null;
    return source;
  } catch {return null;}
}
export async function researchForkInfo(db: D1Database, id: string, origin: string, viewer?: string) {
  const project = await getResearchProject(db,id,viewer);
  if (!project) return fail('プロジェクトが見つかりません。',404);
  return {source:await readResearchForkSource(db,id),preview:project.visibility === 'public' && project.status !== 'withdrawn' ? await prepareResearchFork(db,id,origin) : null};
}
export async function researchForkTarget(db: D1Database, sourceId: string, viewer: string, origin: string, input: Record<string,unknown>) {
  if (typeof input.requestId !== 'string' || input.requestId.length !== 36 || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(input.requestId) || typeof input.snapshotHash !== 'string' || input.snapshotHash.length !== 71 || !/^sha256:[a-f0-9]{64}$/.test(input.snapshotHash) || input.rightsConfirmed !== true) return fail('内容と利用条件を確認してからforkしてください。');
  const id = `rp_${input.requestId.replaceAll('-','')}`, href = sourceHref(origin,sourceId);
  const actor = await db.prepare("SELECT p.id FROM profiles p WHERE p.id=? AND NOT EXISTS(SELECT 1 FROM profile_moderation_status m WHERE m.profile_id=p.id AND m.status='suspended')").bind(viewer).first();
  if (!actor) return fail('このプロフィールは利用できません。',403);
  const saved = await getResearchProject(db,id,viewer);
  if (saved) {
    const source = await readResearchForkSource(db,id);
    if (saved.ownerProfileId !== viewer || !source || source.href !== href || source.snapshotHash !== input.snapshotHash) return fail('同じ操作IDで異なるforkは作成できません。',409);
    return {id,href,saved:{project:saved,source}};
  }
  return {id,href,saved:null};
}
export async function forkResearchProject(db: D1Database, sourceId: string, viewer: string, origin: string, input: Record<string,unknown>) {
  const target=await researchForkTarget(db,sourceId,viewer,origin,input);if(target.saved)return target.saved;
  const {project,documents,snapshotHash} = await snapshot(db,sourceId,origin);
  if (snapshotHash !== input.snapshotHash) return fail('確認後に派生元が変わりました。内容を再確認してください。',409);
  const guard = `EXISTS(SELECT 1 FROM research_projects p WHERE p.id=? AND p.visibility='public' AND p.status=? AND p.title=? AND p.description=? AND p.default_license IS ? AND p.updated_at=? AND p.owner_profile_id=?)
    AND (${documentsJsonSql})=? AND (SELECT count(*) FROM research_documents WHERE project_id=? AND visibility='public')=?
    AND EXISTS(SELECT 1 FROM profiles p WHERE p.id=? AND NOT EXISTS(SELECT 1 FROM profile_moderation_status m WHERE m.profile_id=p.id AND m.status='suspended'))`;
  const values = [sourceId,project.status,project.title,project.description,project.defaultLicense,project.updatedAt,project.ownerProfileId,sourceId,JSON.stringify(documents),sourceId,documents.length,viewer];
  return copyResearchFork(db,sourceId,viewer,origin,input,{project,documents,snapshotHash},guard,values);
}
/** Copies a verified snapshot atomically; callers supply the current local access guard. */
export async function copyResearchFork(db:D1Database,sourceId:string,viewer:string,origin:string,input:Record<string,unknown>,value:{project:{title:string;description:string;defaultLicense:string|null};documents:Document[];snapshotHash:string},guard:string,values:(string|number|null)[]) {
  const target=await researchForkTarget(db,sourceId,viewer,origin,input);if(target.saved)return target.saved;
  const {id,href}=target,{project,documents,snapshotHash}=value;
  if(snapshotHash!==input.snapshotHash)return fail('確認後に派生元が変わりました。内容を再確認してください。',409);
  const date = new Date().toISOString(), since = new Date(Date.now()-86400000).toISOString();
  const total = await db.prepare("SELECT count(*) total FROM research_provenance_events WHERE actor_profile_id=? AND activity_type='project_forked' AND occurred_at>=?").bind(viewer,since).first<{total:number}>();
  if ((total?.total ?? 0) >= 20) return fail('forkは1日20件までです。',429);
  const copied = documents.map(doc => ({...doc,newId:crypto.randomUUID()}));
  const source: ResearchForkSource = {projectId:sourceId,href,title:project.title,snapshotHash,documents:copied.map(doc=>({sourceId:doc.id,documentId:doc.newId,version:doc.head,contentHash:doc.contentHash}))};
  try {
    await db.batch([
      db.prepare(`INSERT INTO research_projects(id,owner_profile_id,title,description,status,visibility,default_license,created_at,updated_at) SELECT ?,?,?,?,'draft','confidential',?,?,? WHERE ${guard} AND (SELECT count(*) FROM research_provenance_events WHERE actor_profile_id=? AND activity_type='project_forked' AND occurred_at>=?)<20`).bind(id,viewer,project.title,project.description,project.defaultLicense,date,date,...values,viewer,since),
      ...copied.flatMap(doc=>[
        db.prepare("INSERT INTO research_documents(id,project_id,title,kind,visibility,head,created_at,updated_at) SELECT ?,id,?,?,'confidential',1,?,? FROM research_projects WHERE id=? AND owner_profile_id=?").bind(doc.newId,doc.title,doc.kind,date,date,id,viewer),
        db.prepare("INSERT INTO research_document_revisions(id,document_id,version,body,content_hash,summary,author_profile_id,created_at) SELECT ?,id,1,?,?,'公開版からfork',?,? FROM research_documents WHERE id=? AND project_id=?").bind(crypto.randomUUID(),doc.body,doc.contentHash,viewer,date,doc.newId,id),
      ]),
      db.prepare("INSERT INTO research_provenance_events(id,project_id,actor_profile_id,activity_type,output_hash,agent_metadata_json,occurred_at) SELECT ?,id,?,'project_forked',?,?,? FROM research_projects WHERE id=? AND owner_profile_id=?").bind(input.requestId,viewer,snapshotHash,JSON.stringify({source}),date,id,viewer),
      // A NOT NULL failure rolls back the whole D1 batch if access or the source changes during copying.
      db.prepare(`UPDATE research_projects SET title=NULL WHERE id=? AND NOT (${guard})`).bind(id,...values),
      db.prepare(`UPDATE research_projects SET title=NULL WHERE id=? AND (owner_profile_id<>? OR visibility<>'confidential' OR status<>'draft' OR title<>? OR description<>? OR default_license IS NOT ? OR (SELECT count(*) FROM research_documents WHERE project_id=?)<>? OR EXISTS(SELECT 1 FROM research_documents d LEFT JOIN research_document_revisions r ON r.document_id=d.id AND r.version=d.head WHERE d.project_id=? AND (d.visibility<>'confidential' OR d.head<>1 OR r.id IS NULL OR r.author_profile_id<>?)))`).bind(id,viewer,project.title,project.description,project.defaultLicense,id,copied.length,id,viewer),
      ...copied.map(doc=>db.prepare(`UPDATE research_projects SET title=NULL WHERE id=? AND NOT EXISTS(SELECT 1 FROM research_documents d JOIN research_document_revisions r ON r.document_id=d.id AND r.version=1 WHERE d.id=? AND d.project_id=? AND d.title=? AND d.kind=? AND r.body=? AND r.content_hash=?)`).bind(id,doc.newId,id,doc.title,doc.kind,doc.body,doc.contentHash)),
      db.prepare(`INSERT INTO research_projects(id,owner_profile_id,title,description,status,visibility,created_at,updated_at) SELECT ?,?,NULL,'','draft','confidential',?,? WHERE NOT EXISTS(SELECT 1 FROM research_provenance_events WHERE id=? AND project_id=?) OR (SELECT count(*) FROM research_provenance_events WHERE actor_profile_id=? AND activity_type='project_forked' AND occurred_at>=?)>20`).bind(id,viewer,date,date,input.requestId,id,viewer,since),
    ]);
  } catch {
    // A concurrent retry may have committed this exact operation while this batch was queued.
    const existing=await getResearchProject(db,id,viewer), provenance=existing?.ownerProfileId===viewer?await readResearchForkSource(db,id):null;
    const active=await db.prepare("SELECT p.id FROM profiles p WHERE p.id=? AND NOT EXISTS(SELECT 1 FROM profile_moderation_status m WHERE m.profile_id=p.id AND m.status='suspended')").bind(viewer).first();
    if(active&&existing?.ownerProfileId===viewer&&provenance?.href===href&&provenance.snapshotHash===input.snapshotHash)return {project:existing,source:provenance};
    return fail('派生元または権限が変わりました。再読み込みして確認してください。',409);
  }
  return {project:await getResearchProject(db,id,viewer),source};
}
