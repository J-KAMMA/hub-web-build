import 'server-only';
import type { D1Database } from '@cloudflare/workers-types';
import { RESEARCH_LINK_KINDS, researchTargetPath, researchTargetId, type ResearchLink, type ResearchLinkKind, type ResearchDocument, type ResearchRevision, type ResearchProposal } from '@/lib/research-workspace';
import { getResearchProject } from './d1-research';
import { publicVideoOriginSql } from './video-public-origin';
import {researchDocumentHref,type ResearchProposalReview,type ResearchProposalDecision,type ResearchProposalCreated} from '@/lib/research-workspace';
import { getPublicReaderReadySeedArticles } from '@/lib/encyclopedia/public-seed';
import {readMusicWorksByIds,validMusicKey} from './client-music-library';
import { DEFAULT_INSTANCE_ORIGIN } from "@/lib/instance-origin";

export class ResearchWorkspaceError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
const fail = (message: string, status = 400): never => { throw new ResearchWorkspaceError(message, status); };
const text = (value: unknown, max: number) => typeof value === 'string' && value.trim() && value.length <= max ? value : fail('入力の文字数を確認してください。');
const now = () => new Date().toISOString();
const hash = async (body: string) => `sha256:${Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body))), b => b.toString(16).padStart(2, '0')).join('')}`;
const documentColumns = 'd.id,d.project_id projectId,d.title,d.kind,d.visibility,d.head,d.updated_at updatedAt';
async function assertProposalViewerActive(db:D1Database,viewer:string){
  const row=await db.prepare("SELECT status FROM profile_moderation_status WHERE profile_id=? LIMIT 1").bind(viewer).first<{status:string}>();
  if(row?.status==='suspended')return fail('このプロフィールは停止されています。',403);
}
type StoredProposal = ResearchProposal & {authorProfileId:string};
async function proposalFor(db:D1Database,projectId:string,proposalId:string,viewer:string){
  const project=await projectFor(db,projectId,viewer);
  const proposal=await db.prepare(`SELECT c.id,c.document_id documentId,c.base_version baseVersion,c.body,c.summary,c.status,c.created_at createdAt,c.author_profile_id authorProfileId FROM research_change_proposals c JOIN research_documents d ON d.id=c.document_id WHERE c.id=? AND d.project_id=? AND (?=? OR c.author_profile_id=?)`).bind(proposalId,projectId,viewer,project.ownerProfileId,viewer).first<StoredProposal>();
  if(!proposal) return fail('変更提案が見つかりません。',404);
  const {document}=await documentFor(db,projectId,proposal.documentId,viewer);
  return {project,document,proposal};
}
export async function authorizeResearchProposal(db:D1Database,projectId:string,proposalId:string,viewer:string,manage=false){
  const actor=await db.prepare('SELECT p.id,m.status FROM profiles p LEFT JOIN profile_moderation_status m ON m.profile_id=p.id WHERE p.id=? LIMIT 1').bind(viewer).first<{id:string;status:string|null}>();
  if(!actor||actor.status==='suspended')return fail('このプロフィールは利用できません。',403);
  const {project,document}=await proposalFor(db,projectId,proposalId,viewer);
  if(manage&&project.ownerProfileId!==viewer)return fail('編集権限がありません。',403);
  return {documentId:document.id,documentVisibility:document.visibility,projectVisibility:project.visibility,projectStatus:project.status,ownerProfileId:project.ownerProfileId};
}
async function adoptedFor(db:D1Database,proposal:StoredProposal,projectId:string):Promise<ResearchProposalDecision['adoptedRevision']>{
  if(proposal.status!=='accepted')return null;
  if(!Number.isSafeInteger(proposal.baseVersion)||proposal.baseVersion<1||!Number.isSafeInteger(proposal.baseVersion+1))return fail('採用版を確認できませんでした。',409);
  const revision=await db.prepare('SELECT version,body,content_hash contentHash,summary,author_profile_id authorId FROM research_document_revisions WHERE document_id=? AND version=?').bind(proposal.documentId,proposal.baseVersion+1).first<{version:number;body:string;contentHash:string;summary:string;authorId:string}>();
  if(!revision||!Number.isSafeInteger(revision.version)||revision.version!==proposal.baseVersion+1||revision.body!==proposal.body||revision.summary!==proposal.summary||revision.authorId!==proposal.authorProfileId||revision.contentHash!==await hash(proposal.body))return fail('採用版を確認できませんでした。',409);
  return {version:revision.version,contentHash:revision.contentHash,href:researchDocumentHref(projectId,proposal.documentId,revision.version)};
}
export async function readResearchProposalReview(db:D1Database,projectId:string,proposalId:string,viewer:string):Promise<ResearchProposalReview>{
  if(!viewer||!proposalId||proposalId.length>100)return fail('変更提案が見つかりません。',404);
  await assertProposalViewerActive(db,viewer);
  const {project,document,proposal}=await proposalFor(db,projectId,proposalId,viewer);
  if(!Number.isSafeInteger(proposal.baseVersion)||proposal.baseVersion<1||!Number.isSafeInteger(document.head)||document.head<1)return fail('文書の版を確認できませんでした。',409);
  const base=await db.prepare('SELECT version,body,content_hash contentHash FROM research_document_revisions WHERE document_id=? AND version=?').bind(document.id,proposal.baseVersion).first<{version:number;body:string;contentHash:string}>();
  if(!base||!Number.isSafeInteger(base.version)||base.version!==proposal.baseVersion||base.contentHash!==await hash(base.body))return fail('基準版を確認できませんでした。',409);
  const {authorProfileId,...publicProposal}=proposal;
  const proposalHash=await hash(JSON.stringify([proposal.id,proposal.documentId,proposal.baseVersion,proposal.body,proposal.summary,authorProfileId,document.visibility,project.visibility,project.status]));
  const proposalContentHash=await hash(proposal.body);
  const adoptedRevision=await adoptedFor(db,proposal,projectId);
  const access=await db.prepare(`SELECT p.owner_profile_id ownerProfileId FROM research_change_proposals c
    JOIN research_documents d ON d.id=c.document_id JOIN research_projects p ON p.id=d.project_id
    WHERE c.id=? AND p.id=? AND (p.visibility='public' OR p.owner_profile_id=?) AND (d.visibility='public' OR p.owner_profile_id=?) AND (p.owner_profile_id=? OR c.author_profile_id=?)
      AND c.document_id=? AND c.base_version=? AND c.body=? AND c.summary=? AND c.author_profile_id=? AND c.status=?
      AND p.visibility=? AND p.status=? AND d.visibility=? AND d.head=?
      AND NOT EXISTS(SELECT 1 FROM profile_moderation_status WHERE profile_id=? AND status='suspended')`)
    .bind(proposalId,projectId,viewer,viewer,viewer,viewer,proposal.documentId,proposal.baseVersion,proposal.body,proposal.summary,authorProfileId,proposal.status,project.visibility,project.status,document.visibility,document.head,viewer).first<{ownerProfileId:string}>();
  if(!access)return fail('変更提案の閲覧権限を確認できませんでした。',404);
  return {proposal:{...publicProposal,contentHash:proposalContentHash},document:{id:document.id,projectId:document.projectId,title:document.title,visibility:document.visibility,head:document.head},baseRevision:base,
    snapshot:{proposalId:proposal.id,baseVersion:proposal.baseVersion,proposalHash,baseHash:base.contentHash,currentHead:document.head},canDecide:access.ownerProfileId===viewer&&proposal.status==='open',canDiscuss:project.visibility==='public'&&project.status!=='withdrawn'&&document.visibility==='public',adoptedRevision};
}

// Links contain public Hub identifiers only; the target is rechecked on every read.
export async function resolveResearchLink(db: D1Database, kind: ResearchLinkKind, targetId: string): Promise<ResearchLink | null> {
  let row: { title: string; id?:string } | null | undefined;
  if (kind === 'hubpedia') row = (await getPublicReaderReadySeedArticles()).find(a => a.slug === targetId);
  else if(kind==='music') {
    if(!validMusicKey(targetId)||/[\p{Cc}]/u.test(targetId))return null;
    const configured=process.env.HUB_PUBLIC_ORIGIN??DEFAULT_INSTANCE_ORIGIN,origin=new URL(configured);
    if(origin.origin!==configured||origin.username||origin.password||!(origin.protocol==='https:'||origin.protocol==='http:'&&['127.0.0.1','localhost'].includes(origin.hostname)))throw Error('research_music_unavailable');
    const [work]=await readMusicWorksByIds(db,[targetId],origin.origin);row=work?.id===targetId?{id:work.id,title:work.title}:null;
  }
  else {
    const queries = {
      article: "SELECT title FROM hub_user_articles WHERE id=? AND status='published' AND audience='general' AND moderated_at IS NULL",
      video: `SELECT title FROM external_videos v WHERE id=? AND status='active' AND safety_level='standard' AND availability_status<>'unavailable' AND ${publicVideoOriginSql("v")}`,
      thread: "SELECT title FROM threads WHERE id=? AND status<>'archived' AND moderation_status='active'",
      community: "SELECT id,name title FROM communities WHERE (id=? OR slug=?) AND visibility='public' AND lifecycle_status='active'",
    };
    row = await db.prepare(queries[kind]).bind(...(kind === 'community' ? [targetId,targetId] : [targetId])).first<{ title: string;id?:string }>();
  }
  return row ? { kind, targetId:row.id ?? targetId, title: row.title, href: researchTargetPath(kind, row.id ?? targetId) } : null;
}
async function projectFor(db: D1Database, id: string, viewer?: string | null, owner = false) {
  const project = await getResearchProject(db, id, viewer);
  if (!project) return fail('プロジェクトが見つかりません。', 404);
  if (owner && project.ownerProfileId !== viewer) fail('編集権限がありません。', 403);
  return project;
}
async function documentFor(db: D1Database, projectId: string, id: string, viewer?: string | null) {
  const project = await projectFor(db, projectId, viewer);
  const document = await db.prepare(`SELECT ${documentColumns} FROM research_documents d
    WHERE d.id=? AND d.project_id=? AND (d.visibility='public' OR ?=?)`)
    .bind(id, projectId, viewer ?? '', project.ownerProfileId).first<ResearchDocument>();
  if (!document) return fail('文書が見つかりません。', 404);
  return { project, document };
}
export async function readResearchWorkspace(db: D1Database, projectId: string, viewer?: string | null) {
  const project = await projectFor(db, projectId, viewer);
  const [links, documents, proposals] = await Promise.all([
    db.prepare('SELECT kind,target_id targetId FROM research_links WHERE project_id=? ORDER BY created_at DESC LIMIT 100').bind(projectId).all<{ kind: ResearchLinkKind; targetId: string }>(),
    db.prepare(`SELECT ${documentColumns} FROM research_documents d WHERE project_id=? AND (visibility='public' OR ?=?) ORDER BY updated_at DESC LIMIT 100`).bind(projectId, viewer ?? '', project.ownerProfileId).all<ResearchDocument>(),
    db.prepare(`SELECT c.id,c.document_id documentId,c.base_version baseVersion,c.body,c.summary,c.status,c.created_at createdAt
      FROM research_change_proposals c JOIN research_documents d ON d.id=c.document_id
      WHERE d.project_id=? AND (d.visibility='public' OR ?=?) AND (?=? OR c.author_profile_id=?)
      ORDER BY c.created_at DESC LIMIT 20`).bind(projectId, viewer ?? '', project.ownerProfileId, viewer ?? '', project.ownerProfileId, viewer ?? '').all<ResearchProposal>(),
  ]);
  const resolved = (await Promise.all(links.results.map(l => resolveResearchLink(db, l.kind, l.targetId)))).filter((l): l is ResearchLink => !!l);
  const proposalIds = proposals.results.map(row=>row.id);
  const access = await db.prepare(`SELECT * FROM (
    SELECT 'project' resource,p.id,p.visibility,p.owner_profile_id ownerProfileId,p.status
      FROM research_projects p WHERE p.id=? AND (p.visibility='public' OR p.owner_profile_id=?)
    ) UNION ALL SELECT * FROM (
    SELECT 'document',d.id,d.visibility,NULL,NULL FROM research_documents d JOIN research_projects p ON p.id=d.project_id
      WHERE p.id=? AND (p.visibility='public' OR p.owner_profile_id=?) AND (d.visibility='public' OR p.owner_profile_id=?)
      ORDER BY d.updated_at DESC LIMIT 100
    ) UNION ALL SELECT * FROM (
    SELECT 'proposal',c.id,d.visibility,NULL,NULL FROM research_change_proposals c JOIN research_documents d ON d.id=c.document_id JOIN research_projects p ON p.id=d.project_id
      WHERE p.id=? AND (p.visibility='public' OR p.owner_profile_id=?) AND (d.visibility='public' OR p.owner_profile_id=?) AND (p.owner_profile_id=? OR c.author_profile_id=?)
        AND ${proposalIds.length?`c.id IN (${proposalIds.map(()=>'?').join(',')})`:'0'}
    )`).bind(projectId,viewer??'',projectId,viewer??'',viewer??'',projectId,viewer??'',viewer??'',viewer??'',viewer??'',...proposalIds)
    .all<{resource:string;id:string;visibility:string;ownerProfileId:string|null;status:string|null}>();
  const current = access.results.find(row=>row.resource==='project'), readable = new Map(access.results.map(row=>[`${row.resource}:${row.id}`,row.visibility]));
  if(!current||current.ownerProfileId!==project.ownerProfileId||current.visibility!==project.visibility||current.status!==project.status
    ||documents.results.some(row=>readable.get(`document:${row.id}`)!==row.visibility)||proposals.results.some(row=>!readable.has(`proposal:${row.id}`)))return fail('閲覧権限を確認できませんでした。',404);
  return { links: resolved, documents: documents.results, proposals: proposals.results };
}
export async function readResearchDocument(db: D1Database, projectId: string, id: string, viewer?: string | null, version?: number) {
  const { document } = await documentFor(db, projectId, id, viewer);
  if (version !== undefined && (!Number.isSafeInteger(version) || version < 1)) fail('版が不正です。');
  const revision = await db.prepare(`SELECT id,version,body,content_hash contentHash,summary,created_at createdAt
    FROM research_document_revisions WHERE document_id=? AND version=?`).bind(id, version ?? document.head).first<ResearchRevision>();
  if (!revision) return fail('版が見つかりません。', 404);
  const history = await db.prepare('SELECT version,summary,created_at createdAt FROM research_document_revisions WHERE document_id=? ORDER BY version DESC LIMIT 100').bind(id).all<{ version: number; summary: string; createdAt: string }>();
  const current = await db.prepare(`SELECT ${documentColumns},p.visibility projectVisibility,p.status projectStatus
    FROM research_documents d JOIN research_projects p ON p.id=d.project_id
    WHERE d.id=? AND p.id=? AND (p.visibility='public' OR p.owner_profile_id=?) AND (d.visibility='public' OR p.owner_profile_id=?)`)
    .bind(id,projectId,viewer??'',viewer??'').first<ResearchDocument & {projectVisibility:string;projectStatus:string}>();
  if(!current)return fail('文書が見つかりません。',404);
  const {projectVisibility,projectStatus,...authorizedDocument}=current;
  return { document: authorizedDocument, revision, history: history.results, canDiscuss: projectVisibility === 'public' && projectStatus !== 'withdrawn' && authorizedDocument.visibility === 'public' };
}
export async function mutateResearchWorkspace(db: D1Database, projectId: string, viewer: string, input: Record<string, unknown>, origin?: string) {
  const action = input.action;
  if(action==='accept'||action==='reject'||action==='propose')await assertProposalViewerActive(db,viewer);
  const project = await projectFor(db, projectId, viewer, action !== 'propose');
  const date = now();
  if (action === 'visibility') {
    const { document } = await documentFor(db, projectId, text(input.documentId,100), viewer);
    if (!['public','confidential'].includes(String(input.visibility))) return fail('公開範囲が不正です。');
    await db.prepare('UPDATE research_documents SET visibility=?,updated_at=? WHERE id=?').bind(String(input.visibility),date,document.id).run();
    return {};
  }
  if (action === 'link' || action === 'unlink') {
    const kind = input.kind as ResearchLinkKind;
    if (!RESEARCH_LINK_KINDS.includes(kind)) return fail('関連先の種類が不正です。');
    const targetId = researchTargetId(kind,text(input.targetId, 1000),origin);
    if (!targetId || targetId.length > 240) return fail('関連先のURLまたはIDが不正です。');
    if (action === 'link') {
      const resolved = await resolveResearchLink(db, kind, targetId);
      if (!resolved) return fail('公開されている関連先が見つかりません。', 404);
      const count = await db.prepare('SELECT count(*) total FROM research_links WHERE project_id=?').bind(projectId).first<{total:number}>();
      if ((count?.total ?? 0) >= 100) fail('関連先は100件までです。');
      await db.prepare('INSERT OR IGNORE INTO research_links(project_id,kind,target_id,created_at) VALUES(?,?,?,?)').bind(projectId, kind, resolved.targetId, date).run();
    } else await db.prepare('DELETE FROM research_links WHERE project_id=? AND kind=? AND target_id=?').bind(projectId, kind, targetId).run();
    return {};
  }
  if (action === 'create') {
    const title = text(input.title, 240).trim(), body = text(input.body, 100000), kind = String(input.kind), visibility = String(input.visibility);
    if (!['paper','software','dataset','notebook'].includes(kind) || !['public','confidential'].includes(visibility)) fail('種類または公開範囲が不正です。');
    const count = await db.prepare('SELECT count(*) total FROM research_documents WHERE project_id=?').bind(projectId).first<{total:number}>();
    if ((count?.total ?? 0) >= 100) fail('文書は100件までです。');
    const id = crypto.randomUUID();
    await db.batch([
      db.prepare('INSERT INTO research_documents(id,project_id,title,kind,visibility,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').bind(id, projectId, title, kind, visibility, date, date),
      db.prepare('INSERT INTO research_document_revisions(id,document_id,version,body,content_hash,summary,author_profile_id,created_at) VALUES(?,?,1,?,?,?,?,?)').bind(crypto.randomUUID(), id, body, await hash(body), '初版', viewer, date),
      db.prepare('UPDATE research_projects SET updated_at=? WHERE id=?').bind(date, projectId),
    ]);
    return { documentId: id };
  }
  if (action === 'propose') {
    const requestId=input.requestId;
    if(typeof requestId!=='string'||requestId.length!==36||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(requestId))return fail('再試行IDが不正です。');
    const id=text(input.documentId,100),base=input.baseVersion;
    if(typeof base!=='number'||!Number.isSafeInteger(base)||base<1)return fail('版の指定が不正です。');
    const body=text(input.body,100000),summary=text(input.summary,500).trim();
    if([body,summary].some(value=>/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(value)))return fail('本文または理由の文字が不正です。');
    const {document,project:currentProject}=await documentFor(db,projectId,id,viewer);
    const expectedBaseHash=input.expectedBaseHash;
    let boundBase:{body:string;contentHash:string}|null=null;
    if(expectedBaseHash!==undefined){
      if(typeof expectedBaseHash!=='string'||expectedBaseHash.length!==71||!/^sha256:[a-f0-9]{64}$/.test(expectedBaseHash))return fail('基準本文のハッシュが不正です。');
      boundBase=await db.prepare('SELECT body,content_hash contentHash FROM research_document_revisions WHERE document_id=? AND version=?').bind(id,base).first<{body:string;contentHash:string}>();
      if(!boundBase||boundBase.contentHash!==expectedBaseHash||await hash(boundBase.body)!==expectedBaseHash)return fail('原本の基準本文が変更ファイルと一致しません。',409);
    }
    const existing=async():Promise<ResearchProposalCreated|null>=>{
      const row=await db.prepare('SELECT id,document_id documentId,base_version baseVersion,body,summary,author_profile_id authorProfileId,status FROM research_change_proposals WHERE id=?').bind(requestId).first<StoredProposal>();
      if(!row)return null;
      await assertProposalViewerActive(db,viewer);
      await documentFor(db,projectId,id,viewer);
      if(row.documentId!==id||row.baseVersion!==base||row.body!==body||row.summary!==summary||row.authorProfileId!==viewer||!['open','accepted','rejected'].includes(row.status))return fail('再試行の内容が一致しません。',409);
      return {proposalId:requestId,documentId:id,baseVersion:base,contentHash:await hash(body),status:row.status as ResearchProposalCreated['status']};
    };
    const replay=await existing();if(replay)return replay;
    if(base!==document.head)return fail('本文が更新されています。最新版を読み直してください。',409);
    const since=new Date(Date.now()-86400000).toISOString();
    const count=await db.prepare('SELECT count(*) total FROM research_change_proposals WHERE author_profile_id=? AND created_at>=?').bind(viewer,since).first<{total:number}>();
    if((count?.total??0)>=20)return fail('変更提案は1日20件までです。',429);
    const guard=`d.id=? AND d.project_id=? AND d.head=? AND d.visibility=? AND p.visibility=? AND p.status=? AND p.owner_profile_id=? AND (d.visibility='public' OR p.owner_profile_id=?) AND (p.visibility='public' OR p.owner_profile_id=?) AND EXISTS(SELECT 1 FROM profiles actor WHERE actor.id=? AND NOT EXISTS(SELECT 1 FROM profile_moderation_status m WHERE m.profile_id=actor.id AND m.status='suspended'))${boundBase?' AND EXISTS(SELECT 1 FROM research_document_revisions b WHERE b.document_id=d.id AND b.version=d.head AND b.content_hash=? AND b.body=?)':''}`;
    const values=[id,projectId,base,document.visibility,currentProject.visibility,currentProject.status,currentProject.ownerProfileId,viewer,viewer,viewer,...(boundBase?[boundBase.contentHash,boundBase.body]:[])];
    try{
      await db.batch([
        db.prepare(`INSERT INTO research_change_proposals(id,document_id,base_version,body,summary,author_profile_id,created_at) SELECT ?,d.id,?,?,?,?,? FROM research_documents d JOIN research_projects p ON p.id=d.project_id WHERE ${guard} AND (SELECT count(*) FROM research_change_proposals WHERE author_profile_id=? AND created_at>=?)<20 AND EXISTS(SELECT 1 FROM research_document_revisions WHERE document_id=d.id AND version=?)`).bind(requestId,base,body,summary,viewer,date,...values,viewer,since,base),
        db.prepare(`UPDATE research_documents SET head=NULL WHERE id=? AND NOT EXISTS(SELECT 1 FROM research_change_proposals c JOIN research_documents d ON d.id=c.document_id JOIN research_projects p ON p.id=d.project_id WHERE c.id=? AND c.base_version=? AND c.body=? AND c.summary=? AND c.author_profile_id=? AND c.status='open' AND ${guard} AND (SELECT count(*) FROM research_change_proposals WHERE author_profile_id=? AND created_at>=?)<=20)`).bind(id,requestId,base,body,summary,viewer,...values,viewer,since),
      ]);
    }catch{
      const retry=await existing();if(retry)return retry;
    }
    const saved=await existing();if(saved)return saved;
    await assertProposalViewerActive(db,viewer);
    await documentFor(db,projectId,id,viewer);
    const currentCount=await db.prepare('SELECT count(*) total FROM research_change_proposals WHERE author_profile_id=? AND created_at>=?').bind(viewer,since).first<{total:number}>();
    return fail((currentCount?.total??0)>=20?'変更提案は1日20件までです。':'文書が更新されています。読み直してください。',(currentCount?.total??0)>=20?429:409);
  }
  if (action === 'accept' || action === 'reject') {
    const proposalId=text(input.proposalId,100),review=await readResearchProposalReview(db,projectId,proposalId,viewer);
    const snapshot=input.snapshot as Record<string,unknown>|null;
    if(!snapshot||typeof snapshot!=='object'||Array.isArray(snapshot)||!Number.isSafeInteger(snapshot.currentHead)||Number(snapshot.currentHead)<1||['proposalId','baseVersion','proposalHash','baseHash'].some(key=>snapshot[key]!==review.snapshot[key as keyof typeof review.snapshot]))return fail('比較した提案を確認してください。',409);
    const {proposal,document,project:currentProject}=await proposalFor(db,projectId,proposalId,viewer);
    if(await hash(JSON.stringify([proposal.id,proposal.documentId,proposal.baseVersion,proposal.body,proposal.summary,proposal.authorProfileId,document.visibility,currentProject.visibility,currentProject.status]))!==review.snapshot.proposalHash)return fail('提案が更新されています。比較し直してください。',409);
    if(action==='accept'&&!Number.isSafeInteger(proposal.baseVersion+1))return fail('採用版の上限に達しています。',409);
    const status=action==='accept'?'accepted':'rejected';
    if(proposal.status!=='open'){
      if(proposal.status!==status)return fail('別の判断が確定しています。',409);
      return {proposalId,status,adoptedRevision:await adoptedFor(db,proposal,projectId)} satisfies ResearchProposalDecision;
    }
    if(snapshot.currentHead!==document.head||(action==='accept'&&proposal.baseVersion!==document.head))return fail('文書が更新されています。比較し直してください。',409);
    const revisionId=crypto.randomUUID(),contentHash=await hash(proposal.body);
    const condition=`c.id=? AND c.status='open' AND c.document_id=? AND c.base_version=? AND c.body=? AND c.summary=? AND c.author_profile_id=? AND d.head=? AND p.id=? AND p.owner_profile_id=? AND d.visibility=? AND p.visibility=? AND p.status=? AND EXISTS(SELECT 1 FROM profiles actor WHERE actor.id=? AND NOT EXISTS(SELECT 1 FROM profile_moderation_status moderation WHERE moderation.profile_id=actor.id AND moderation.status='suspended')) AND EXISTS(SELECT 1 FROM research_document_revisions b WHERE b.document_id=d.id AND b.version=c.base_version AND b.content_hash=? AND b.body=?)`;
    const values=[proposalId,document.id,proposal.baseVersion,proposal.body,proposal.summary,proposal.authorProfileId,document.head,projectId,viewer,document.visibility,currentProject.visibility,currentProject.status,viewer,review.snapshot.baseHash,review.baseRevision.body];
    try{
      await db.batch([
        ...(action==='accept'?[db.prepare(`INSERT INTO research_document_revisions(id,document_id,version,body,content_hash,summary,author_profile_id,created_at) SELECT ?,d.id,c.base_version+1,c.body,?,c.summary,c.author_profile_id,? FROM research_change_proposals c JOIN research_documents d ON d.id=c.document_id JOIN research_projects p ON p.id=d.project_id WHERE ${condition}`).bind(revisionId,contentHash,date,...values),
          db.prepare('UPDATE research_documents SET head=?,updated_at=? WHERE id=? AND head=? AND EXISTS(SELECT 1 FROM research_document_revisions WHERE id=?)').bind(proposal.baseVersion+1,date,document.id,document.head,revisionId)] : []),
        db.prepare(`UPDATE research_change_proposals SET status=?,resolved_at=? WHERE id IN (SELECT c.id FROM research_change_proposals c JOIN research_documents d ON d.id=c.document_id JOIN research_projects p ON p.id=d.project_id WHERE ${condition.replace('d.head=?',action==='accept'?'d.head=?+1':'d.head=?')})${action==='accept'?' AND EXISTS(SELECT 1 FROM research_document_revisions WHERE id=?)':''}`).bind(status,date,...values,...(action==='accept'?[revisionId]:[])),
        db.prepare('UPDATE research_projects SET updated_at=? WHERE id=?').bind(date,projectId),
        db.prepare(`UPDATE research_change_proposals SET status=NULL WHERE id=? AND NOT EXISTS(SELECT 1 FROM research_change_proposals c JOIN research_documents d ON d.id=c.document_id JOIN research_projects p ON p.id=d.project_id WHERE c.id=? AND c.status=? AND c.document_id=? AND c.base_version=? AND c.body=? AND c.summary=? AND c.author_profile_id=? AND d.head=? AND p.id=? AND p.owner_profile_id=? AND d.visibility=? AND p.visibility=? AND p.status=? AND EXISTS(SELECT 1 FROM profiles actor WHERE actor.id=? AND NOT EXISTS(SELECT 1 FROM profile_moderation_status moderation WHERE moderation.profile_id=actor.id AND moderation.status='suspended')) AND EXISTS(SELECT 1 FROM research_document_revisions b WHERE b.document_id=d.id AND b.version=c.base_version AND b.content_hash=? AND b.body=?))`).bind(proposalId,proposalId,status,document.id,proposal.baseVersion,proposal.body,proposal.summary,proposal.authorProfileId,action==='accept'?proposal.baseVersion+1:document.head,projectId,viewer,document.visibility,currentProject.visibility,currentProject.status,viewer,review.snapshot.baseHash,review.baseRevision.body),
        ...(action==='accept'?[db.prepare(`UPDATE research_change_proposals SET status=NULL WHERE id=? AND NOT EXISTS(SELECT 1 FROM research_document_revisions WHERE id=? AND document_id=? AND version=? AND body=? AND content_hash=? AND summary=? AND author_profile_id=?)`).bind(proposalId,revisionId,document.id,proposal.baseVersion+1,proposal.body,contentHash,proposal.summary,proposal.authorProfileId)] : []),
      ]);
    }catch{return fail('提案または権限が更新されました。比較し直してください。',409);}
    const saved=await proposalFor(db,projectId,proposalId,viewer);
    return {proposalId,status,adoptedRevision:await adoptedFor(db,saved.proposal,projectId)} satisfies ResearchProposalDecision;
  }
  return fail('操作が不正です。');
}

export async function listResearchUpdates(db: D1Database) {
  const result = await db.prepare(`SELECT d.id,d.title,d.kind,d.head version,d.updated_at updatedAt,p.id projectId,p.title projectTitle
    FROM research_documents d JOIN research_projects p ON p.id=d.project_id
    WHERE d.visibility='public' AND p.visibility='public' AND p.status<>'withdrawn'
    ORDER BY d.updated_at DESC,d.id DESC LIMIT 20`).all<ResearchDocument & { version: number; projectTitle: string }>();
  return result.results.map(item => ({ ...item, href: researchDocumentHref(item.projectId,item.id,item.version) }));
}
export async function researchBacklinks(db: D1Database, kind: ResearchLinkKind, targetId: string) {
  const target = await resolveResearchLink(db, kind, targetId);
  if (!target) return [];
  return (await db.prepare(`SELECT p.id,p.title FROM research_links l JOIN research_projects p ON p.id=l.project_id
    WHERE l.kind=? AND l.target_id=? AND p.visibility='public' AND p.status<>'withdrawn' ORDER BY p.updated_at DESC,p.id DESC LIMIT 20`).bind(kind, target.targetId).all<{id:string;title:string}>()).results;
}
