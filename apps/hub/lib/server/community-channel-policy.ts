import 'server-only';
import type {D1Database} from '@cloudflare/workers-types';
import {COMMUNITY_SLOWMODE_SECONDS,type CommunitySlowmodeSeconds,type CommunityChannelPolicy,type CommunityChannelPolicyPage,type CommunityChannelPolicyResult} from '@/lib/community-channel-policy';
export class CommunityChannelPolicyError extends Error{constructor(message:string,readonly status:400|403|404|409|503){super(message);}}
const fail=(message:string,status:400|403|404|409|503=400):never=>{throw new CommunityChannelPolicyError(message,status);};
const id=(value:unknown)=>typeof value==='string'&&value.length>=1&&value.length<=100&&!/[^A-Za-z0-9_-]/.test(value)?value:fail('対象の指定が不正です。');
const seconds=(value:unknown):CommunitySlowmodeSeconds=>typeof value==='number'&&COMMUNITY_SLOWMODE_SECONDS.includes(value as CommunitySlowmodeSeconds)?value as CommunitySlowmodeSeconds:fail('低速モードの指定が不正です。');
const timestamp=(value:unknown):string|null=>value===null?null:typeof value==='string'&&value.length<=64&&Number.isFinite(Date.parse(value))&&!/[\x00-\x1f\x7f]/.test(value)?value:fail('現在の状態を確認してください。');
const validText=(value:string)=>!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(value);
const failed=(error:unknown):never=>{if(error instanceof CommunityChannelPolicyError)throw error;return fail('チャンネル設定を処理できませんでした。',503);};
const channelSelect='SELECT id,name,slowmode_seconds slowmodeSeconds,archived_at archivedAt FROM community_channels';
const operator=`EXISTS(SELECT 1 FROM communities community JOIN community_memberships membership ON membership.community_id=community.id JOIN profiles actor ON actor.id=membership.profile_id WHERE community.id=? AND community.lifecycle_status='active' AND membership.profile_id=? AND membership.status='active' AND membership.role IN ('owner','moderator') AND (membership.role<>'owner' OR community.owner_profile_id=actor.id) AND (?=0 OR membership.role='owner') AND NOT EXISTS(SELECT 1 FROM profile_moderation_status m WHERE m.profile_id=actor.id AND m.status='suspended'))`;
async function authorize(db:D1Database,actorId:string,communityId:string,owner=false){
  id(communityId);id(actorId);
  const member=await db.prepare(`SELECT membership.role FROM community_memberships membership WHERE membership.community_id=? AND membership.profile_id=? AND ${operator}`).bind(communityId,actorId,communityId,actorId,Number(owner)).first<{role:'owner'|'moderator'}>();
  if(!member)return fail('チャンネル設定を操作する権限がありません。',403);
  return member;
}
function validateChannel(channel:CommunityChannelPolicy){
  if(typeof channel.id!=='string'||channel.id.length<1||channel.id.length>100||/[^A-Za-z0-9_-]/.test(channel.id)||typeof channel.name!=='string'||!channel.name.trim()||channel.name.length>50||!validText(channel.name))return fail('チャンネル情報を確認できませんでした。',503);
  try{seconds(channel.slowmodeSeconds);timestamp(channel.archivedAt);}catch{return fail('チャンネル情報を確認できませんでした。',503);}
}
async function channelFor(db:D1Database,communityId:string,channelId:string){
  const channel=await db.prepare(channelSelect+' WHERE community_id=? AND id=?').bind(communityId,channelId).first<CommunityChannelPolicy>();
  if(!channel)return fail('チャンネルが見つかりません。',404);
  validateChannel(channel);
  return channel;
}
export async function readCommunityChannelPolicies(db:D1Database,actorId:string,communityId:string,offset=0):Promise<CommunityChannelPolicyPage>{
  try{
    await authorize(db,actorId,communityId);
    if(!Number.isSafeInteger(offset)||offset<0||offset>Number.MAX_SAFE_INTEGER-20)return fail('ページ指定が不正です。');
    await db.prepare('SELECT id FROM community_audit_log LIMIT 0').all();
    const rows=await db.prepare(channelSelect+' WHERE community_id=? ORDER BY position,created_at,id LIMIT 21 OFFSET ?').bind(communityId,offset).all<CommunityChannelPolicy>();
    rows.results.forEach(validateChannel);
    const {role}=await authorize(db,actorId,communityId);
    return {communityId,viewerId:actorId,role,channels:rows.results.slice(0,20),offset,hasMore:rows.results.length>20};
  }catch(error){return failed(error);}
}
export async function mutateCommunityChannelPolicy(db:D1Database,actorId:string,communityId:string,payload:unknown):Promise<CommunityChannelPolicyResult>{
  try{
    if(!payload||typeof payload!=='object'||Array.isArray(payload))return fail('操作内容が不正です。');
    const input=payload as Record<string,unknown>,action=input.action;
    const allowed=['action','channelId','operationId','note','expectedSlowmodeSeconds','expectedArchivedAt',action==='channel_controls'?'slowmodeSeconds':'archived'];
    if(Object.keys(input).some(key=>!allowed.includes(key)))return fail('操作内容が不正です。');
    if(action!=='channel_controls'&&action!=='set_channel_archived')return fail('操作が不正です。');
    const channelId=id(input.channelId),operationId=input.operationId;
    if(typeof operationId!=='string'||operationId.length!==36||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(operationId))return fail('操作IDが不正です。');
    if(typeof input.note!=='string'||input.note.length>1000||!validText(input.note))return fail('変更理由は5〜1000文字で入力してください。');
    const note=input.note.normalize('NFKC').trim();if(note.length<5||note.length>1000)return fail('変更理由は5〜1000文字で入力してください。');
    const expectedSlowmodeSeconds=seconds(input.expectedSlowmodeSeconds),expectedArchivedAt=timestamp(input.expectedArchivedAt);
    const desired=action==='channel_controls'?seconds(input.slowmodeSeconds):typeof input.archived==='boolean'?input.archived:fail('アーカイブの指定が不正です。');
    const owner=action==='set_channel_archived';await authorize(db,actorId,communityId,owner);
    const fingerprint=JSON.stringify({version:1,action,channelId,note,expectedSlowmodeSeconds,expectedArchivedAt,desired});
    const replay=async():Promise<CommunityChannelPolicyResult|null>=>{
      const saved=await db.prepare('SELECT community_id communityId,actor_profile_id actorId,action,detail,created_at createdAt FROM community_audit_log WHERE id=?').bind(operationId).first<{communityId:string;actorId:string;action:string;detail:string;createdAt:string}>();
      if(!saved)return null;
      let detail:{policyFingerprint?:string};try{detail=JSON.parse(saved.detail);}catch{return fail('操作IDは別の操作に使用されています。',409);}
      if(saved.communityId!==communityId||saved.actorId!==actorId||saved.action!==action||detail?.policyFingerprint!==fingerprint)return fail('操作IDは別の操作に使用されています。',409);
      await authorize(db,actorId,communityId,owner);
      const channel=await channelFor(db,communityId,channelId);
      await authorize(db,actorId,communityId,owner);
      return {communityId,channel,receipt:{auditId:operationId,action,targetId:channelId,confirmedAt:saved.createdAt,replayed:true}};
    };
    const repeated=await replay();if(repeated)return repeated;
    const before=await channelFor(db,communityId,channelId);
    if(before.slowmodeSeconds!==expectedSlowmodeSeconds||before.archivedAt!==expectedArchivedAt)return fail('設定が更新されています。読み直してください。',409);
    const confirmedAt=new Date().toISOString(),afterSlowmode=action==='channel_controls'?desired as CommunitySlowmodeSeconds:expectedSlowmodeSeconds;
    const afterArchived=action==='set_channel_archived'?(desired?(expectedArchivedAt??confirmedAt):null):expectedArchivedAt;
    const detail=JSON.stringify({note,targetId:channelId,targetLabel:`#${before.name}`,policyFingerprint:fingerprint,before:{slowmodeSeconds:expectedSlowmodeSeconds,archivedAt:expectedArchivedAt},after:{slowmodeSeconds:afterSlowmode,archivedAt:afterArchived}});
    try{
      await db.batch([
        db.prepare(`UPDATE community_channels SET slowmode_seconds=?,archived_at=? WHERE id=? AND community_id=? AND slowmode_seconds=? AND archived_at IS ? AND ${operator}`).bind(afterSlowmode,afterArchived,channelId,communityId,expectedSlowmodeSeconds,expectedArchivedAt,communityId,actorId,Number(owner)),
        db.prepare(`INSERT INTO community_audit_log(id,community_id,actor_profile_id,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE changes()=1 AND EXISTS(SELECT 1 FROM community_channels WHERE id=? AND community_id=? AND slowmode_seconds=? AND archived_at IS ? AND ${operator})`).bind(operationId,communityId,actorId,action,detail,confirmedAt,channelId,communityId,afterSlowmode,afterArchived,communityId,actorId,Number(owner)),
        db.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM community_channels channel JOIN community_audit_log audit ON audit.id=? WHERE channel.id=? AND channel.community_id=? AND channel.slowmode_seconds=? AND channel.archived_at IS ? AND audit.community_id=channel.community_id AND audit.actor_profile_id=? AND audit.action=? AND audit.detail=? AND audit.created_at=? AND ${operator}) THEN 1 ELSE json_extract('invalid-json','$') END`).bind(operationId,channelId,communityId,afterSlowmode,afterArchived,actorId,action,detail,confirmedAt,communityId,actorId,Number(owner)),
      ]);
    }catch{
      const recovered=await replay();if(recovered)return recovered;
      await authorize(db,actorId,communityId,owner);await channelFor(db,communityId,channelId);
      return fail('設定または権限が更新されています。読み直してください。',409);
    }
    await authorize(db,actorId,communityId,owner);
    const channel=await channelFor(db,communityId,channelId);
    await authorize(db,actorId,communityId,owner);
    return {communityId,channel,receipt:{auditId:operationId,action,targetId:channelId,confirmedAt,replayed:false}};
  }catch(error){return failed(error);}
}
