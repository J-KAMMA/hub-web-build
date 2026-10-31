import "server-only";
import type {D1Database} from "@cloudflare/workers-types";
import type {Profile} from "@/lib/domain";
import {CommunityAppealReviewError,getCommunityAppealSubmissionContext} from "./community-appeal-review";

const validId=(id:unknown):id is string=>typeof id==="string" && /^[A-Za-z0-9_-]{1,80}$/.test(id);
const applicantGuard=`EXISTS(SELECT 1 FROM communities c JOIN community_memberships m ON m.community_id=c.id
  WHERE c.id=? AND c.lifecycle_status='active' AND m.profile_id=?
  AND NOT EXISTS(SELECT 1 FROM profile_moderation_status WHERE profile_id=m.profile_id AND status='suspended'))`;
async function requireApplicant(db:D1Database,actor:Profile,communityId:string) {
  if(!validId(communityId))throw new CommunityAppealReviewError("コミュニティの指定が正しくありません。",400);
  if(!await db.prepare(`SELECT 1 WHERE ${applicantGuard}`).bind(communityId,actor.id).first())throw new CommunityAppealReviewError("このコミュニティへの異議申立てを利用できません。",403);
}
function storageFailure(error:unknown):never {
  if(error instanceof CommunityAppealReviewError)throw error;
  throw new CommunityAppealReviewError("保存結果を確認できませんでした。同じ内容で再試行してください。",503);
}
export async function getOwnCommunityAppeals(db:D1Database,actor:Profile,communityId:string) {
  try {
    await requireApplicant(db,actor,communityId);
    const rows=await db.prepare(`SELECT id,reason,status,created_at createdAt,resolved_at resolvedAt,resolution_note resolutionNote
      FROM community_moderation_appeals WHERE community_id=? AND profile_id=? AND ${applicantGuard}
      ORDER BY created_at DESC,id LIMIT 20`).bind(communityId,actor.id,communityId,actor.id).all();
    const context=await getCommunityAppealSubmissionContext(db,actor,communityId);
    return {communityId,appeals:rows.results,submission:{sanction:context.sanction,sanctionKey:context.sanctionKey}};
  }catch(error){storageFailure(error);}
}
export async function submitCommunityAppeal(db:D1Database,actor:Profile,communityId:string,payload:unknown) {
  try {
    await requireApplicant(db,actor,communityId);
    if(!payload || typeof payload!=="object" || Array.isArray(payload) || Object.keys(payload).some(key=>!["operationId","reason","expectedSanctionKey","memberActionId"].includes(key)))throw new CommunityAppealReviewError("異議申立ての指定が正しくありません。",400);
    const {operationId,reason:rawReason,expectedSanctionKey,memberActionId}=payload as Record<string,unknown>,reason=typeof rawReason==="string"?rawReason.normalize("NFKC").trim():"";
    if(typeof operationId!=="string" || !/^[A-Za-z0-9-]{16,80}$/.test(operationId) || Array.from(reason).length<20 || reason.length>1000
      || typeof expectedSanctionKey!=="string" || !/^[a-f0-9]{64}$/.test(expectedSanctionKey) || (memberActionId!==undefined && !validId(memberActionId)))throw new CommunityAppealReviewError("操作ID・処分の確認キー・20〜1000文字の理由を確認してください。",400);
    type Audit={id:string;communityId:string;actorId:string;profileId:string;action:string;detail:string;createdAt:string};
    const loadAudit=()=>db.prepare(`SELECT id,community_id communityId,actor_profile_id actorId,target_profile_id profileId,action,detail,created_at createdAt FROM community_audit_log WHERE id=?`).bind(operationId).first<Audit>();
    const acknowledge=async(audit:Audit,replayed:boolean)=>{
      let saved:{targetId?:unknown;reason?:unknown;expectedSanctionKey?:unknown;requestedMemberActionId?:unknown}|null;
      try{saved=JSON.parse(audit.detail);}catch{saved=null;}
      if(audit.communityId!==communityId || audit.actorId!==actor.id || audit.profileId!==actor.id || audit.action!=="appeal_submitted" || !saved || !validId(saved.targetId)
        || saved.reason!==reason || saved.expectedSanctionKey!==expectedSanctionKey || saved.requestedMemberActionId!==(memberActionId??null))throw new CommunityAppealReviewError("操作IDが別の操作で使用されています。",409);
      const appeal=await db.prepare(`SELECT id,status,created_at createdAt FROM community_moderation_appeals WHERE id=? AND community_id=? AND profile_id=?`).bind(saved.targetId,communityId,actor.id).first<{id:string;status:string;createdAt:string}>();
      if(!appeal)throw new CommunityAppealReviewError("保存した異議申立てが見つかりません。",409);
      return {appeal:{id:appeal.id,status:"pending" as const,createdAt:appeal.createdAt},currentStatus:appeal.status,
        receipt:{auditId:audit.id,action:"appeal_submitted" as const,targetId:appeal.id,confirmedAt:audit.createdAt,replayed}};
    };
    const existing=await loadAudit();if(existing)return await acknowledge(existing,true);
    const pending=()=>db.prepare("SELECT id FROM community_moderation_appeals WHERE community_id=? AND profile_id=? AND status='pending' LIMIT 1").bind(communityId,actor.id).first();
    if(await pending())throw new CommunityAppealReviewError("審査中の異議申立てがあります。",409);
    const context=await getCommunityAppealSubmissionContext(db,actor,communityId,memberActionId as string|undefined,operationId);
    if(context.sanctionKey!==expectedSanctionKey)throw new CommunityAppealReviewError("処分の状態が変更されました。読み直して確認してください。",409);
    if(!context.sanction)throw new CommunityAppealReviewError("異議申立ての対象となる処分を確認できませんでした。",409);
    const id=crypto.randomUUID(),now=new Date().toISOString(),detail=JSON.stringify({targetId:id,reason,expectedSanctionKey,requestedMemberActionId:memberActionId??null,sanction:context.sanction});
    const legacyId=context.sanction.kind==="legacy"?context.sanction.id:null;
    try {
      await db.batch([
        db.prepare(`INSERT INTO community_moderation_appeals(id,community_id,profile_id,member_action_id,reason,created_at)
          SELECT ?,?,?,?,?,? WHERE ${applicantGuard} AND (${context.guard.sql})
          AND NOT EXISTS(SELECT 1 FROM community_moderation_appeals WHERE community_id=? AND profile_id=? AND status='pending')
          AND NOT EXISTS(SELECT 1 FROM community_audit_log WHERE id=?)`)
          .bind(id,communityId,actor.id,legacyId,reason,now,communityId,actor.id,...context.guard.values,communityId,actor.id,operationId),
        db.prepare(`INSERT INTO community_audit_log(id,community_id,actor_profile_id,target_profile_id,action,detail,created_at)
          SELECT ?,?,?,?,'appeal_submitted',?,? WHERE changes()=1`).bind(operationId,communityId,actor.id,actor.id,detail,now),
        db.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM community_audit_log WHERE id=? AND community_id=? AND actor_profile_id=? AND target_profile_id=? AND action='appeal_submitted' AND detail=?)
          AND EXISTS(SELECT 1 FROM community_moderation_appeals WHERE id=? AND community_id=? AND profile_id=? AND reason=? AND member_action_id IS ? AND created_at=?)
          AND ${applicantGuard} AND (${context.guard.sql}) THEN 1 ELSE json('') END`)
          .bind(operationId,communityId,actor.id,actor.id,detail,id,communityId,actor.id,reason,legacyId,now,communityId,actor.id,...context.guard.values),
      ]);
    }catch(error){
      const replay=await loadAudit();if(replay)return await acknowledge(replay,true);
      if(await pending() || !await db.prepare(`SELECT 1 WHERE ${applicantGuard} AND (${context.guard.sql})`).bind(communityId,actor.id,...context.guard.values).first())throw new CommunityAppealReviewError("申立てや処分の状態が変更されました。読み直して確認してください。",409);
      throw error;
    }
    const saved=await loadAudit();if(!saved)throw new CommunityAppealReviewError("異議申立てを確認できませんでした。",409);
    return await acknowledge(saved,false);
  }catch(error){storageFailure(error);}
}
