import "server-only";
import type {D1Database} from "@cloudflare/workers-types";
import type {Profile} from "@/lib/domain";
import {CommunityGuideAccessError,requireCommunityGuideAccess} from "./community-guide-access";
import {CommunityGuideProposalError} from "./community-guide-proposals";

type Proposal={id:string;communityId:string;pageId:string|null;authorProfileId:string;proposedDirectoryId:string|null;proposedTitle:string;proposedBody:string;status:string;baseVersion:number;updatedAt:string};
const open=(status:string)=>["open","changes_requested"].includes(status);
const manager=(role?:string)=>role==="owner"||role==="moderator";
const approval=`EXISTS(SELECT 1 FROM community_guide_reviews r JOIN community_memberships rm ON rm.profile_id=r.author_profile_id AND rm.community_id=p.community_id
  WHERE r.proposal_id=p.id AND r.decision='approve' AND r.author_profile_id<>p.author_profile_id AND rm.status='active' AND rm.role IN ('owner','moderator')
  AND NOT EXISTS(SELECT 1 FROM community_guide_reviews newer WHERE newer.proposal_id=r.proposal_id AND newer.author_profile_id=r.author_profile_id
    AND newer.decision<>'comment' AND newer.rowid>r.rowid)
  AND NOT EXISTS(SELECT 1 FROM community_guide_reviews change WHERE change.proposal_id=r.proposal_id AND change.decision='request_changes' AND change.rowid>r.rowid))`;
const selected=`SELECT id,community_id communityId,page_id pageId,author_profile_id authorProfileId,proposed_directory_id proposedDirectoryId,
  proposed_title proposedTitle,proposed_body proposedBody,status,base_version baseVersion,updated_at updatedAt FROM community_guide_proposals WHERE id=? AND community_id=?`;
async function load(db:D1Database,communityId:string,proposalId:string,viewer:Profile|null){
  await requireCommunityGuideAccess(db,communityId,viewer);
  if(!/^[A-Za-z0-9_-]{1,80}$/.test(proposalId))throw new CommunityGuideAccessError("編集案の指定が正しくありません。",400);
  const proposal=await db.prepare(selected).bind(proposalId,communityId).first<Proposal>();
  if(!proposal)throw new CommunityGuideAccessError("編集案が見つからないか、閲覧できません。",404);
  return proposal;
}
export async function getCommunityGuideReviewData(db:D1Database,communityId:string,proposalId:string,viewer:Profile|null,offset=0){
  const proposal=await load(db,communityId,proposalId,viewer);
  if(!Number.isSafeInteger(offset)||offset<0)throw new CommunityGuideAccessError("ページ指定が正しくありません。",400);
  const membership=viewer?await db.prepare("SELECT role,status FROM community_memberships WHERE community_id=? AND profile_id=?").bind(communityId,viewer.id).first<{role:string;status:string}>():null;
  const active=membership?.status==="active",manage=active&&manager(membership?.role),editable=open(proposal.status);
  const currentPage=proposal.pageId?await db.prepare("SELECT id,title,body,version FROM community_guide_pages WHERE id=? AND community_id=?").bind(proposal.pageId,communityId).first<{id:string;title:string;body:string;version:number}>():null;
  const approved=Boolean(await db.prepare("SELECT p.id FROM community_guide_proposals p WHERE p.id=? AND p.community_id=? AND "+approval).bind(proposalId,communityId).first());
  const current=proposal.pageId?currentPage?.version===proposal.baseVersion:proposal.baseVersion===0;
  const rows=await db.prepare(`SELECT r.id,r.proposal_id proposalId,r.author_profile_id authorProfileId,r.body,r.decision,r.created_at createdAt,pr.display_name authorName
    FROM community_guide_reviews r LEFT JOIN profiles pr ON pr.id=r.author_profile_id WHERE r.proposal_id=? ORDER BY r.rowid LIMIT 21 OFFSET ?`).bind(proposalId,offset).all();
  return {reviews:rows.results.slice(0,20),reviewPage:{offset,hasMore:rows.results.length>20,nextOffset:rows.results.length>20?offset+20:null},currentPage,
    permissions:{canComment:active&&editable,canApprove:manage&&editable&&viewer?.id!==proposal.authorProfileId,canRequestChanges:manage&&editable,
      canClose:manage&&editable,canReopen:manage&&proposal.status==="closed",canMerge:manage&&proposal.status==="open"&&approved&&current},
    mergeReason:!current?"公開版が更新されています。最新版を確認して新しい編集案を作成してください。":!approved?"提案者以外の有効な管理者による承認が必要です。":null};
}
type OperationInput={requestId?:unknown;expectedUpdatedAt?:unknown;action?:unknown;decision?:unknown;body?:unknown};
export async function mutateCommunityGuideProposal(db:D1Database,actor:Profile,communityId:string,proposalId:string,payload:unknown,review=false){
  const proposal=await load(db,communityId,proposalId,actor);
  if(!payload||typeof payload!=="object"||Array.isArray(payload))throw new CommunityGuideProposalError("操作内容を確認してください。",400);
  const raw=payload as OperationInput,action=review?raw.decision:raw.action;
  if(typeof action!=="string"||!(review?["comment","approve","request_changes"]:["merge","close","reopen"]).includes(action))throw new CommunityGuideProposalError("操作内容を確認してください。",400);
  const body=review&&typeof raw.body==="string"?raw.body.trim():"";
  if(review&&(!body||body.length>2000))throw new CommunityGuideProposalError("レビューは1〜2000文字で入力してください。",400);
  const id=raw.requestId===undefined?crypto.randomUUID():raw.requestId;
  if(typeof id!=="string"||!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id))throw new CommunityGuideProposalError("操作IDが正しくありません。",400);
  if(raw.expectedUpdatedAt!==undefined&&(typeof raw.expectedUpdatedAt!=="string"||!raw.expectedUpdatedAt||raw.expectedUpdatedAt.length>80))throw new CommunityGuideProposalError("確認した版の指定が正しくありません。",400);
  const membership=await db.prepare("SELECT role,status FROM community_memberships WHERE community_id=? AND profile_id=?").bind(communityId,actor.id).first<{role:string;status:string}>();
  if(membership?.status!=="active"||((!review||action!=="comment")&&!manager(membership?.role)))throw new CommunityGuideProposalError("この操作を行う参加権限がありません。",403);
  if(action==="approve"&&proposal.authorProfileId===actor.id)throw new CommunityGuideProposalError("自分の編集案は承認できません。別の管理者にレビューを依頼してください。",403);
  const fingerprint=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify({proposalId,action,body,expectedUpdatedAt:raw.expectedUpdatedAt??null})))),byte=>byte.toString(16).padStart(2,"0")).join("");
  const kind=review?"guide_review":"guide_proposal_"+action;
  const saved=()=>db.prepare("SELECT community_id communityId,actor_profile_id actorId,action,detail FROM community_audit_log WHERE id=?").bind(id).first<{communityId:string;actorId:string;action:string;detail:string}>();
  const matches=(row:Awaited<ReturnType<typeof saved>>)=>{if(!row)return false;try{return row.communityId===communityId&&row.actorId===actor.id&&row.action===kind&&JSON.parse(row.detail).fingerprint===fingerprint;}catch{return false;}};
  const response=async(replayed:boolean)=>{
    const current=await load(db,communityId,proposalId,actor);
    return {operationId:id,replayed,proposal:current,
      ...(review?{review:await db.prepare("SELECT id,proposal_id proposalId,author_profile_id authorProfileId,body,decision,created_at createdAt FROM community_guide_reviews WHERE id=? AND proposal_id=?").bind(id,proposalId).first()}: {}),
      ...(action==="merge"&&current.pageId?{page:await db.prepare("SELECT id,directory_id directoryId,slug,title,body,version,updated_at updatedAt FROM community_guide_pages WHERE id=? AND community_id=?").bind(current.pageId,communityId).first()}: {})};
  };
  const previous=await saved();
  if(previous){if(!matches(previous))throw new CommunityGuideProposalError("操作IDが別の処理に使われています。",409);return response(true);}
  if(raw.expectedUpdatedAt!==undefined&&raw.expectedUpdatedAt!==proposal.updatedAt)throw new CommunityGuideProposalError("編集案が更新されています。最新の内容を確認してください。",409);
  if((review||action==="close")&&!open(proposal.status)||action==="reopen"&&proposal.status!=="closed"||action==="merge"&&proposal.status!=="open")throw new CommunityGuideProposalError("現在の状態ではこの操作を行えません。",409);
  if(action==="merge"&&(!Number.isSafeInteger(proposal.baseVersion)||proposal.baseVersion<0||proposal.baseVersion>=Number.MAX_SAFE_INTEGER))throw new CommunityGuideProposalError("元の版を確認できません。",409);
  const now=new Date().toISOString(),detail=JSON.stringify({proposalId,fingerprint,nonce:crypto.randomUUID()}),pageId=proposal.pageId??id,version=proposal.baseVersion+1;
  let guard="c.id=? AND c.lifecycle_status='active' AND m.profile_id=? AND m.status='active' AND p.id=? AND p.status=? AND p.updated_at=?";
  const args:unknown[]=[communityId,actor.id,proposalId,proposal.status,proposal.updatedAt];
  if(!review||action!=="comment")guard+=" AND m.role IN ('owner','moderator')";
  if(action==="approve"){guard+=" AND p.author_profile_id<>?";args.push(actor.id);}
  if(action==="merge")guard+=" AND "+approval+" AND ((p.page_id IS NULL AND p.base_version=0) OR EXISTS(SELECT 1 FROM community_guide_pages g WHERE g.id=p.page_id AND g.community_id=p.community_id AND g.version=p.base_version)) AND (p.proposed_directory_id IS NULL OR EXISTS(SELECT 1 FROM community_guide_directories d WHERE d.id=p.proposed_directory_id AND d.community_id=p.community_id))";
  const proof="EXISTS(SELECT 1 FROM community_audit_log WHERE id=? AND detail=?)";
  const statements=[db.prepare(`INSERT INTO community_audit_log(id,community_id,actor_profile_id,action,detail,created_at)
    SELECT ?,c.id,m.profile_id,?,?,? FROM communities c JOIN community_memberships m ON m.community_id=c.id JOIN community_guide_proposals p ON p.community_id=c.id
    WHERE ${guard} ON CONFLICT(id) DO NOTHING`).bind(id,kind,detail,now,...args)];
  const status=review?(action==="request_changes"?"changes_requested":action==="approve"?"open":proposal.status):action==="merge"?"merged":action==="close"?"closed":"open";
  if(review)statements.push(db.prepare(`INSERT INTO community_guide_reviews(id,proposal_id,author_profile_id,body,decision,created_at) SELECT ?,?,?,?,?,? WHERE ${proof}`).bind(id,proposalId,actor.id,body,action,now,id,detail));
  if(action==="merge"){
    if(proposal.pageId)statements.push(db.prepare(`UPDATE community_guide_pages SET title=?,body=?,directory_id=COALESCE(?,directory_id),version=?,updated_by_profile_id=?,updated_at=? WHERE id=? AND community_id=? AND ${proof}`)
      .bind(proposal.proposedTitle,proposal.proposedBody,proposal.proposedDirectoryId,version,actor.id,now,pageId,communityId,id,detail));
    else statements.push(db.prepare(`INSERT INTO community_guide_pages(id,community_id,slug,title,body,version,updated_by_profile_id,created_at,updated_at,directory_id) SELECT ?,?,?,?,?,1,?,?,?,? WHERE ${proof}`)
      .bind(pageId,communityId,"guide-"+pageId,proposal.proposedTitle,proposal.proposedBody,actor.id,now,now,proposal.proposedDirectoryId,id,detail));
    statements.push(db.prepare(`INSERT INTO community_guide_revisions(id,community_id,page_id,proposal_id,editor_profile_id,title,body,revision_no,created_at) SELECT ?,?,?,?,?,?,?,?,? WHERE ${proof}`)
      .bind(id,communityId,pageId,proposalId,actor.id,proposal.proposedTitle,proposal.proposedBody,version,now,id,detail));
    statements.push(db.prepare(`UPDATE community_guide_proposals SET page_id=?,status='merged',merged_at=?,merged_by_profile_id=?,updated_at=? WHERE id=? AND community_id=? AND ${proof}`).bind(pageId,now,actor.id,now,proposalId,communityId,id,detail));
  }else statements.push(db.prepare(`UPDATE community_guide_proposals SET status=?,updated_at=? WHERE id=? AND community_id=? AND ${proof}`).bind(status,now,proposalId,communityId,id,detail));
  try{await db.batch(statements);}catch{throw new CommunityGuideProposalError("処理を完了できませんでした。同じ内容で再試行してください。",409);}
  const committed=await saved();
  if(!matches(committed))throw new CommunityGuideProposalError("参加権限・編集案・公開版が変わったため保存できませんでした。最新の内容を確認してください。",409);
  return response(committed?.detail!==detail);
}
