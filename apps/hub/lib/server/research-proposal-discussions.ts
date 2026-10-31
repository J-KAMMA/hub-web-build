import 'server-only';
import type {D1Database} from '@cloudflare/workers-types';
import {researchTargetPath,type ResearchProposalDiscussions,type ResearchProposalDiscussionResult} from '@/lib/research-workspace';
import {authorizeResearchProposal,ResearchWorkspaceError} from './research-workspace';

const fail=(message:string,status=400):never=>{throw new ResearchWorkspaceError(message,status);};
const uuid=(value:unknown):string=>typeof value==='string'&&value.length===36&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value)?value:fail('関連IDが不正です。');
const identifier=(value:unknown):string=>typeof value==='string'&&value.length>=1&&value.length<=128&&/^[A-Za-z0-9_-]+$/.test(value)?value:fail('スレッドIDが不正です。');
const publicThread="t.status IN ('open','closed') AND t.moderation_status='active'";
type Row={id:string;threadId:string;creator:string;removedAt:string|null};
const failure=(error:unknown):never=>{if(error instanceof ResearchWorkspaceError)throw error;return fail('提案の関連を処理できませんでした。',503);};
const relation=(db:D1Database,proposalId:string,threadId:string)=>db.prepare('SELECT id,thread_id threadId,creator_profile_id creator,removed_at removedAt FROM research_proposal_discussions WHERE proposal_id=? AND thread_id=?').bind(proposalId,threadId).first<Row>();
const result=(proposalId:string,row:Row):ResearchProposalDiscussionResult=>({proposalId,threadId:row.threadId,linkId:row.id,linked:row.removedAt===null});

export async function readResearchProposalDiscussions(db:D1Database,projectId:string,proposalId:string,viewer:string):Promise<ResearchProposalDiscussions>{
  try{
    uuid(proposalId);
    await authorizeResearchProposal(db,projectId,proposalId,viewer);
    const rows=await db.prepare(`SELECT l.id linkId,l.thread_id threadId,l.removed_at removedAt,CASE WHEN b.id IS NOT NULL AND ${publicThread} THEN t.title ELSE NULL END title FROM research_proposal_discussions l LEFT JOIN research_proposal_discussion_requests history ON history.request_id=l.id LEFT JOIN threads t ON t.id=l.thread_id LEFT JOIN boards b ON b.id=t.board_id WHERE l.proposal_id=? ORDER BY l.created_at,l.id LIMIT 101`).bind(proposalId).all<{linkId:string;threadId:string;removedAt:string|null;title:string|null}>();
    if(rows.results.length>100)return fail('関連の上限を確認できませんでした。',409);
    const currentAccess=await authorizeResearchProposal(db,projectId,proposalId,viewer);
    return {proposalId,canManage:currentAccess.ownerProfileId===viewer,links:rows.results.map(row=>({linkId:row.linkId,threadId:row.threadId,linked:row.removedAt===null,available:row.title!==null,title:row.title,href:row.title!==null?researchTargetPath('thread',row.threadId):null}))};
  }catch(error){return failure(error);}
}

export async function mutateResearchProposalDiscussions(db:D1Database,projectId:string,proposalId:string,viewer:string,input:Record<string,unknown>):Promise<ResearchProposalDiscussionResult>{
  try{
    uuid(proposalId);const threadId=identifier(input.threadId),action=input.action;
    if(action!=='link'&&action!=='unlink')return fail('操作が不正です。');
    const requestId=uuid(action==='link'?input.requestId:input.linkId);
    const expected=action==='link'?(input.expectedLinkId===null?null:uuid(input.expectedLinkId)):null;
    const access=await authorizeResearchProposal(db,projectId,proposalId,viewer,true);
    const replay=async()=>{
      const receipt=await db.prepare('SELECT proposal_id proposalId,thread_id threadId,creator_profile_id creator,expected_link_id expected FROM research_proposal_discussion_requests WHERE request_id=?').bind(requestId).first<{proposalId:string;threadId:string;creator:string;expected:string|null}>();
      if(action!=='link'||!receipt)return null;
      if(receipt.proposalId!==proposalId||receipt.threadId!==threadId||receipt.creator!==viewer||receipt.expected!==expected)return fail('再試行の内容が一致しません。',409);
      await authorizeResearchProposal(db,projectId,proposalId,viewer,true);
      const current=await relation(db,proposalId,threadId);
      if(!current||current.id!==requestId)return fail('関連が更新されています。',409);
      return result(proposalId,current);
    };
    const repeated=await replay();if(repeated)return repeated;
    const previous=await relation(db,proposalId,threadId);
    if(action==='unlink'){
      if(!previous||previous.id!==requestId)return fail('関連が更新されています。',409);
      if(previous.removedAt!==null){await authorizeResearchProposal(db,projectId,proposalId,viewer,true);return result(proposalId,previous);}
    }else{
      if(previous?(previous.removedAt===null||previous.id!==expected):expected!==null)return fail('関連が更新されています。',409);
      const collision=await db.prepare('SELECT id FROM research_proposal_discussions WHERE id=?').bind(requestId).first();
      if(collision)return fail('関連IDは使用済みです。',409);
      if(!await db.prepare(`SELECT t.id FROM threads t JOIN boards b ON b.id=t.board_id WHERE t.id=? AND ${publicThread}`).bind(threadId).first())return fail('公開スレッドが見つかりません。',404);
      const count=await db.prepare('SELECT count(*) total FROM research_proposal_discussions WHERE proposal_id=?').bind(proposalId).first<{total:number}>();
      if(!previous&&(count?.total??0)>=100)return fail('関連は100件までです。',409);
    }
    const guard=`c.id=? AND c.document_id=? AND d.project_id=? AND p.owner_profile_id=? AND d.visibility=? AND p.visibility=? AND p.status=? AND EXISTS(SELECT 1 FROM profiles actor WHERE actor.id=? AND NOT EXISTS(SELECT 1 FROM profile_moderation_status m WHERE m.profile_id=actor.id AND m.status='suspended'))`;
    const values=[proposalId,access.documentId,projectId,viewer,access.documentVisibility,access.projectVisibility,access.projectStatus,viewer];
    const scope=`SELECT 1 FROM research_change_proposals c JOIN research_documents d ON d.id=c.document_id JOIN research_projects p ON p.id=d.project_id WHERE ${guard}`;
    const target=`SELECT 1 FROM threads t JOIN boards b ON b.id=t.board_id WHERE t.id=? AND ${publicThread}`;
    const date=new Date().toISOString();
    try{
      await db.batch(action==='link'?[
        db.prepare(`INSERT INTO research_proposal_discussions(id,proposal_id,thread_id,creator_profile_id,created_at,removed_at) SELECT ?,?,?,?,?,NULL WHERE EXISTS(${scope}) AND EXISTS(${target}) AND (EXISTS(SELECT 1 FROM research_proposal_discussions WHERE proposal_id=? AND thread_id=? AND id=? AND removed_at IS NOT NULL) OR (? IS NULL AND (SELECT count(*) FROM research_proposal_discussions WHERE proposal_id=?)<100)) ON CONFLICT(proposal_id,thread_id) DO UPDATE SET id=excluded.id,creator_profile_id=excluded.creator_profile_id,created_at=excluded.created_at,removed_at=NULL WHERE research_proposal_discussions.id=? AND research_proposal_discussions.removed_at IS NOT NULL`).bind(requestId,proposalId,threadId,viewer,date,...values,threadId,proposalId,threadId,expected,expected,proposalId,expected),
        db.prepare(`INSERT INTO research_proposal_discussion_requests(request_id,proposal_id,thread_id,creator_profile_id,expected_link_id,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM research_proposal_discussions WHERE id=? AND proposal_id=? AND thread_id=? AND creator_profile_id=? AND removed_at IS NULL)`).bind(requestId,proposalId,threadId,viewer,expected,date,requestId,proposalId,threadId,viewer),
        db.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM research_proposal_discussions l JOIN research_proposal_discussion_requests r ON r.request_id=l.id WHERE l.id=? AND l.proposal_id=? AND l.thread_id=? AND l.creator_profile_id=? AND l.removed_at IS NULL AND r.proposal_id=l.proposal_id AND r.thread_id=l.thread_id AND r.creator_profile_id=l.creator_profile_id AND r.expected_link_id IS ? AND EXISTS(${scope}) AND EXISTS(${target}) AND (SELECT count(*) FROM research_proposal_discussions WHERE proposal_id=?)<=100) THEN 1 ELSE json_extract('invalid-json','$') END`).bind(requestId,proposalId,threadId,viewer,expected,...values,threadId,proposalId),
      ]:[
        db.prepare(`UPDATE research_proposal_discussions SET removed_at=? WHERE id=? AND proposal_id=? AND thread_id=? AND removed_at IS NULL AND EXISTS(${scope})`).bind(date,requestId,proposalId,threadId,...values),
        db.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM research_proposal_discussions WHERE id=? AND proposal_id=? AND thread_id=? AND removed_at IS NOT NULL AND EXISTS(${scope})) THEN 1 ELSE json_extract('invalid-json','$') END`).bind(requestId,proposalId,threadId,...values),
      ]);
    }catch{
      const recovered=await replay();if(recovered)return recovered;
      await authorizeResearchProposal(db,projectId,proposalId,viewer,true);
      return fail('関連または権限が更新されています。',409);
    }
    await authorizeResearchProposal(db,projectId,proposalId,viewer,true);
    const saved=await relation(db,proposalId,threadId);
    if(!saved||saved.id!==requestId||((saved.removedAt===null)!==(action==='link')))return fail('関連が更新されています。',409);
    return result(proposalId,saved);
  }catch(error){return failure(error);}
}
