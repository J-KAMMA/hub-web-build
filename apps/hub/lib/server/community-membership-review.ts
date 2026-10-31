import "server-only";
import type { D1Database } from "@cloudflare/workers-types";
import type { Profile } from "@/lib/domain";

export class CommunityMembershipReviewError extends Error {
  constructor(message: string, readonly status: 400 | 403 | 404 | 409 | 503) { super(message); }
}
const validId=(value:unknown):value is string=>typeof value==="string" && /^[A-Za-z0-9_-]{1,80}$/.test(value);
const operator=`EXISTS(SELECT 1 FROM communities c JOIN community_memberships manager ON manager.community_id=c.id
  WHERE c.id=r.community_id AND c.lifecycle_status='active' AND manager.profile_id=? AND manager.status='active'
  AND manager.role IN ('owner','moderator') AND NOT EXISTS(SELECT 1 FROM profile_moderation_status am WHERE am.profile_id=manager.profile_id AND am.status='suspended'))`;
const unrestricted=`NOT EXISTS(SELECT 1 FROM community_memberships m WHERE m.community_id=r.community_id AND m.profile_id=r.profile_id AND m.status IN ('banned','muted'))
  AND NOT EXISTS(SELECT 1 FROM profile_moderation_status moderation WHERE moderation.profile_id=r.profile_id AND moderation.status='suspended')`;
type RequestRow={profileId:string;displayName:string;createdAt:string;status:string;canApprove:number};
const selected=`SELECT r.profile_id profileId,p.display_name displayName,r.created_at createdAt,r.status,CASE WHEN ${unrestricted} THEN 1 ELSE 0 END canApprove
  FROM community_membership_requests r JOIN profiles p ON p.id=r.profile_id WHERE r.community_id=?`;

async function requireReviewer(db:D1Database,actor:Profile,communityId:string) {
  if(!validId(communityId))throw new CommunityMembershipReviewError("コミュニティの指定が正しくありません。",400);
  const reviewer=await db.prepare(`SELECT manager.role FROM communities c JOIN community_memberships manager ON manager.community_id=c.id
    WHERE c.id=? AND c.lifecycle_status='active' AND manager.profile_id=? AND manager.status='active' AND manager.role IN ('owner','moderator')
    AND NOT EXISTS(SELECT 1 FROM profile_moderation_status am WHERE am.profile_id=manager.profile_id AND am.status='suspended')`)
    .bind(communityId,actor.id).first<{role:string}>();
  if(!reviewer)throw new CommunityMembershipReviewError("参加申請を審査する権限がありません。",403);
  return reviewer;
}
export function readMembershipReviewOffset(params:URLSearchParams) {
  const values=params.getAll("offset");if(!values.length)return 0;
  const offset=Number(values[0]);
  if(values.length!==1 || !/^(0|[1-9]\d*)$/.test(values[0]) || !Number.isSafeInteger(offset))throw new CommunityMembershipReviewError("ページ指定が正しくありません。",400);
  return offset;
}
export async function getCommunityMembershipRequests(db:D1Database,actor:Profile,communityId:string,offset=0) {
  const {role}=await requireReviewer(db,actor,communityId);
  if(!Number.isSafeInteger(offset) || offset<0)throw new CommunityMembershipReviewError("ページ指定が正しくありません。",400);
  const rows=await db.prepare(selected+" AND r.status='pending' ORDER BY r.created_at,r.profile_id LIMIT 21 OFFSET ?").bind(communityId,offset).all<RequestRow>();
  return {communityId,viewerId:actor.id,role,requests:rows.results.slice(0,20),page:{offset,hasMore:rows.results.length>20,nextOffset:rows.results.length>20?offset+20:null}};
}
export async function getCommunityMembershipRequest(db:D1Database,actor:Profile,communityId:string,profileId:string) {
  const {role}=await requireReviewer(db,actor,communityId);
  if(!validId(profileId))throw new CommunityMembershipReviewError("申請者の指定が正しくありません。",400);
  const request=await db.prepare(selected+" AND r.profile_id=?").bind(communityId,profileId).first<RequestRow>();
  if(!request)throw new CommunityMembershipReviewError("参加申請が見つかりません。",404);
  const answers=await db.prepare(`SELECT q.id questionId,q.prompt,a.answer FROM community_onboarding_answers a
    JOIN community_onboarding_questions q ON q.id=a.question_id AND q.community_id=a.community_id
    WHERE a.community_id=? AND a.profile_id=? ORDER BY q.position,q.id`).bind(communityId,profileId).all();
  return {communityId,viewerId:actor.id,role,request:{...request,canApprove:Boolean(request.canApprove && profileId!==actor.id)},answers:answers.results};
}
type Audit={id:string;communityId:string;actorId:string;targetId:string;action:string;detail:string;createdAt:string};
export async function reviewCommunityMembershipRequest(db:D1Database,actor:Profile,communityId:string,profileId:string,payload:unknown) {
  await requireReviewer(db,actor,communityId);
  if(!validId(profileId) || !payload || typeof payload!=="object" || Array.isArray(payload))throw new CommunityMembershipReviewError("審査内容の指定が正しくありません。",400);
  const input=payload as Record<string,unknown>,{operationId,decision,expectedCreatedAt}=input;
  const note=typeof input.note==="string"?input.note.normalize("NFKC").trim():"";
  if(typeof operationId!=="string" || !/^[A-Za-z0-9-]{16,80}$/.test(operationId) || typeof decision!=="string" || !["approve","reject"].includes(decision)
    || typeof expectedCreatedAt!=="string" || !expectedCreatedAt || expectedCreatedAt.length>80 || note.length<5 || note.length>1000)
    throw new CommunityMembershipReviewError("操作ID・判定・申請日時・判断理由を確認してください。理由は5〜1000文字で入力してください。",400);
  if(profileId===actor.id)throw new CommunityMembershipReviewError("自分の参加申請は審査できません。",403);
  const auditQuery=`SELECT id,community_id communityId,actor_profile_id actorId,target_profile_id targetId,action,detail,created_at createdAt FROM community_audit_log WHERE id=?`;
  const loadAudit=()=>db.prepare(auditQuery).bind(operationId).first<Audit>();
  const acknowledge=async(audit:Audit,replayed:boolean)=>{
    let detail:Record<string,unknown>;try{detail=JSON.parse(audit.detail);if(!detail || typeof detail!=="object" || Array.isArray(detail))throw new Error();}catch{throw new CommunityMembershipReviewError("操作IDが別の操作で使用されています。",409);}
    if(audit.communityId!==communityId || audit.actorId!==actor.id || audit.targetId!==profileId || audit.action!=="membership"
      || detail.decision!==decision || detail.expectedCreatedAt!==expectedCreatedAt || detail.note!==note)
      throw new CommunityMembershipReviewError("操作IDが別の操作で使用されています。",409);
    const request=await db.prepare("SELECT profile_id profileId,status,created_at createdAt FROM community_membership_requests WHERE community_id=? AND profile_id=?").bind(communityId,profileId).first();
    return {ok:true,receipt:{auditId:audit.id,action:audit.action,targetId:profileId,targetLabel:String(detail.targetLabel??"参加申請"),confirmedAt:audit.createdAt,replayed},request};
  };
  const existing=await loadAudit();if(existing)return acknowledge(existing,true);
  const request=await db.prepare(selected+" AND r.profile_id=?").bind(communityId,profileId).first<RequestRow>();
  if(!request)throw new CommunityMembershipReviewError("参加申請が見つかりません。",404);
  if(request.status!=="pending" || request.createdAt!==expectedCreatedAt)throw new CommunityMembershipReviewError("申請が更新されたか、処理済みです。読み直して確認してください。",409);
  if(decision==="approve" && !request.canApprove)throw new CommunityMembershipReviewError("制限中のプロフィールは承認できません。",403);
  const now=new Date().toISOString(),nonce=crypto.randomUUID(),targetLabel=request.displayName+"の参加申請";
  const detail=JSON.stringify({note,targetId:profileId,targetLabel,decision,expectedCreatedAt,nonce});
  const proof="EXISTS(SELECT 1 FROM community_audit_log a WHERE a.id=? AND a.detail=?)";
  const statements=[db.prepare(`INSERT INTO community_audit_log(id,community_id,actor_profile_id,target_profile_id,action,detail,created_at)
    SELECT ?,r.community_id,?,r.profile_id,'membership',?,? FROM community_membership_requests r
    WHERE r.community_id=? AND r.profile_id=? AND r.status='pending' AND r.created_at=? AND ${operator}
    AND (?='reject' OR (${unrestricted})) ON CONFLICT(id) DO NOTHING`)
    .bind(operationId,actor.id,detail,now,communityId,profileId,expectedCreatedAt,actor.id,decision)];
  if(decision==="approve")statements.push(db.prepare(`INSERT INTO community_memberships(community_id,profile_id,role,status,joined_at)
    SELECT ?,?,'member','active',? WHERE ${proof}
    ON CONFLICT(community_id,profile_id) DO UPDATE SET status='active' WHERE community_memberships.status NOT IN ('banned','muted')`)
    .bind(communityId,profileId,now,operationId,detail));
  statements.push(db.prepare(`UPDATE community_membership_requests SET status=?,resolved_at=?,resolved_by_profile_id=?
    WHERE community_id=? AND profile_id=? AND status='pending' AND created_at=? AND ${proof}`)
    .bind(decision==="approve"?"approved":"rejected",now,actor.id,communityId,profileId,expectedCreatedAt,operationId,detail));
  try{await db.batch(statements);}catch{throw new CommunityMembershipReviewError("保存結果を確認できませんでした。同じ内容で再試行してください。",503);}
  const saved=await loadAudit();if(!saved)throw new CommunityMembershipReviewError("申請や審査権限が変更されました。読み直して確認してください。",409);
  return acknowledge(saved,saved.detail!==detail);
}
