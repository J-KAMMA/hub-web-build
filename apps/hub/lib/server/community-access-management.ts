import 'server-only';
import type {D1Database} from '@cloudflare/workers-types';
import type {CommunityAccessAction,CommunityAccessKind,CommunityAccessItem,CommunityAccessPage,CommunityAccessResult} from '@/lib/community-access-management';
export class CommunityAccessManagementError extends Error{constructor(message:string,readonly status:400|403|404|409|503){super(message);}}
const fail=(message:string,status:400|403|404|409|503=400):never=>{throw new CommunityAccessManagementError(message,status);};
const validText=(s:string)=>!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);
const id=(v:unknown)=>typeof v==='string'&&v.length>=1&&v.length<=100&&!/[^A-Za-z0-9_-]/.test(v)?v:fail('対象の指定が不正です。');
const text=(v:unknown,max:number,min=1)=>{if(typeof v!=='string'||v.length>max||!validText(v))return fail('文字数または文字の指定が不正です。');const s=v.normalize('NFKC').trim();return s.length>=min&&s.length<=max?s:fail('文字数の指定が不正です。');};
const object=(v:unknown)=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:fail('操作内容が不正です。');
const keys=(v:Record<string,unknown>,allowed:string[])=>{if(Object.keys(v).length!==allowed.length||Object.keys(v).some(k=>!allowed.includes(k)))fail('操作内容が不正です。');};
const integer=(v:unknown,min=0,max=Number.MAX_SAFE_INTEGER)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min&&v<=max?v:fail('数値の指定が不正です。');
const date=(v:unknown,nullable=false)=>v===null&&nullable?null:typeof v==='string'&&v.length<=64&&validText(v)&&!/[\x00-\x1f\x7f]/.test(v)&&Number.isFinite(Date.parse(v))?v:fail('日時の指定が不正です。');
const specs={
 invites:{table:'community_invites',fields:{id:'id',label:'label',maxUses:'max_uses',useCount:'use_count',expiresAt:'expires_at',revokedAt:'revoked_at',createdAt:'created_at'},order:'created_at,id'},
 rules:{table:'community_rules',fields:{id:'id',title:'title',body:'body',required:'required',position:'position',createdAt:'created_at',updatedAt:'updated_at'},order:'position,created_at,id'},
 questions:{table:'community_onboarding_questions',fields:{id:'id',prompt:'prompt',required:'required',position:'position',createdAt:'created_at'},order:'position,created_at,id'},
};
const select=(kind:CommunityAccessKind)=>`SELECT ${Object.entries(specs[kind].fields).map(([key,col])=>`${col} ${key}`).join(',')} FROM ${specs[kind].table}`;
const operator=`EXISTS(SELECT 1 FROM communities c JOIN community_memberships m ON m.community_id=c.id JOIN profiles p ON p.id=m.profile_id WHERE c.id=? AND c.lifecycle_status='active' AND m.profile_id=? AND m.status='active' AND m.role IN ('owner','moderator') AND (m.role<>'owner' OR c.owner_profile_id=p.id) AND (?=0 OR m.role='owner') AND NOT EXISTS(SELECT 1 FROM profile_moderation_status s WHERE s.profile_id=p.id AND s.status='suspended'))`;
async function authorize(db:D1Database,actor:string,cid:string,owner=false){id(actor);id(cid);const row=await db.prepare(`SELECT m.role FROM community_memberships m WHERE m.community_id=? AND m.profile_id=? AND ${operator}`).bind(cid,actor,cid,actor,Number(owner)).first<{role:'owner'|'moderator'}>();if(!row)fail('参加設定を操作する権限がありません。',403);return row!;}
function item(kind:CommunityAccessKind,value:unknown,fromStore=false):CommunityAccessItem{
 try{const v=object(value);keys(v,Object.keys(specs[kind].fields));id(v.id);
  if(kind==='invites'){if(typeof v.label!=='string'||v.label.length>80||!validText(v.label))fail('招待名が不正です。');if(v.maxUses!==null)integer(v.maxUses,1);integer(v.useCount);date(v.expiresAt,true);date(v.revokedAt,true);}
  else{integer(v.position);if(fromStore&&(v.required===0||v.required===1))v.required=Boolean(v.required);if(typeof v.required!=='boolean')fail('必須設定が不正です。');const fields=kind==='rules'?['title','body']:['prompt'];for(const field of fields){const max=field==='title'?80:field==='body'?1000:200;if(typeof v[field]!=='string'||!v[field].length||v[field].length>max||!validText(v[field] as string))fail('設定内容が不正です。');}if(kind==='rules')date(v.updatedAt);}
  date(v.createdAt);return v as unknown as CommunityAccessItem;
 }catch(error){if(fromStore)fail('参加設定を確認できませんでした。',503);throw error;}
}
async function target(db:D1Database,cid:string,kind:CommunityAccessKind,targetId:string){const row=await db.prepare(select(kind)+' WHERE community_id=? AND id=?').bind(cid,targetId).first();return row?item(kind,row,true):null;}
async function schema(db:D1Database,kind:CommunityAccessKind){await db.prepare('SELECT id FROM community_audit_log LIMIT 0').all();await db.prepare(select(kind)+' LIMIT 0').all();}
const failed=(error:unknown):never=>{if(error instanceof CommunityAccessManagementError)throw error;return fail('参加設定を処理できませんでした。',503);};
export async function readCommunityAccessManagement(db:D1Database,actor:string,cid:string,kind:CommunityAccessKind,offset=0):Promise<CommunityAccessPage>{
 try{if(!Object.hasOwn(specs,kind))fail('種類の指定が不正です。');integer(offset,0,Number.MAX_SAFE_INTEGER-20);await authorize(db,actor,cid);await schema(db,kind);const rows=await db.prepare(select(kind)+` WHERE community_id=? ORDER BY ${specs[kind].order} LIMIT 21 OFFSET ?`).bind(cid,offset).all();const items=rows.results.map(v=>item(kind,v,true));const {role}=await authorize(db,actor,cid);return {communityId:cid,viewerId:actor,role,kind,items:items.slice(0,20),offset,hasMore:items.length>20};}catch(error){return failed(error);}
}
export async function mutateCommunityAccessManagement(db:D1Database,actor:string,cid:string,payload:unknown):Promise<CommunityAccessResult>{
 try{
  const input=object(payload),action=input.action as CommunityAccessAction;
  const actionFields:Record<CommunityAccessAction,string[]>={create_invite:['label','maxUses','expiresInDays'],revoke_invite:['inviteId','expected'],create_rule:['title','body'],delete_rule:['ruleId','expected'],create_onboarding_question:['prompt','required'],delete_onboarding_question:['questionId','expected']};
  if(!Object.hasOwn(actionFields,action))fail('操作が不正です。');keys(input,['action','operationId','note',...actionFields[action]]);
  const operationId=input.operationId;if(typeof operationId!=='string'||operationId.length!==36||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(operationId))fail('操作IDが不正です。');
  const note=text(input.note,1000,5),kind:CommunityAccessKind=action.endsWith('invite')?'invites':action.endsWith('rule')?'rules':'questions',create=action.startsWith('create_'),owner=action!=='create_invite';
  const normalized:Record<string,unknown>={};let targetId=operationId as string,expected:CommunityAccessItem|null=null;
  if(create){if(kind==='invites'){normalized.label=text(input.label,80,0);normalized.maxUses=input.maxUses===null?null:integer(input.maxUses,1);normalized.expiresInDays=integer(input.expiresInDays,1,365);}else if(kind==='rules'){normalized.title=text(input.title,80);normalized.body=text(input.body,1000);}else{normalized.prompt=text(input.prompt,200);if(typeof input.required!=='boolean')fail('必須設定が不正です。');normalized.required=input.required;}}
  else{const field=kind==='invites'?'inviteId':kind==='rules'?'ruleId':'questionId';targetId=id(input[field]);expected=item(kind,input.expected);if(expected.id!==targetId)fail('対象の指定が不正です。');normalized[field]=targetId;normalized.expected=Object.fromEntries(Object.keys(specs[kind].fields).map(k=>[k,(expected as unknown as Record<string,unknown>)[k]]));}
  await authorize(db,actor,cid,owner);await schema(db,kind);
  const fingerprint=JSON.stringify({version:1,action,note,...normalized});
  const replay=async():Promise<CommunityAccessResult|null>=>{const saved=await db.prepare('SELECT community_id communityId,actor_profile_id actorId,action,detail,created_at createdAt FROM community_audit_log WHERE id=?').bind(operationId).first<{communityId:string;actorId:string;action:string;detail:string;createdAt:string}>();if(!saved)return null;let detail:Record<string,unknown>;try{detail=object(JSON.parse(saved.detail));}catch{return fail('操作IDは別の操作に使用されています。',409);}if(saved.communityId!==cid||saved.actorId!==actor||saved.action!==action||detail.accessFingerprint!==fingerprint||detail.targetId!==targetId)fail('操作IDは別の操作に使用されています。',409);date(saved.createdAt);await authorize(db,actor,cid,owner);const current=await target(db,cid,kind,targetId);await authorize(db,actor,cid,owner);return {communityId:cid,kind,targetId,target:current,inviteCode:null,receipt:{auditId:operationId as string,action,targetId,confirmedAt:saved.createdAt,replayed:true}};};
  const repeated=await replay();if(repeated)return repeated;
  const before=await target(db,cid,kind,targetId);if(create?Boolean(before):!before)fail(create?'操作IDは使用されています。':'設定が見つかりません。',create?409:404);
  if(expected&&JSON.stringify(Object.fromEntries(Object.keys(specs[kind].fields).map(k=>[k,(before as unknown as Record<string,unknown>)[k]])))!==JSON.stringify(normalized.expected))fail('設定が更新されています。読み直してください。',409);
  if(action==='revoke_invite'&&(expected as {revokedAt:string|null}).revokedAt!==null)fail('招待リンクは無効化済みです。',409);
  const now=new Date().toISOString(),inviteCode=action==='create_invite'?crypto.randomUUID().replaceAll('-',''):null;
  const hash=inviteCode?Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(inviteCode))),b=>b.toString(16).padStart(2,'0')).join(''):null;
  const table=specs[kind].table,conditions=(v:Record<string,unknown>)=>Object.entries(v).map(([k])=>`${(specs[kind].fields as Record<string,string>)[k]} IS ?`).join(' AND '),values=(v:Record<string,unknown>)=>Object.values(v).map(v=>typeof v==='boolean'?Number(v):v) as (string|number|null)[];
  let after:Record<string,unknown>|null=null,statement;
  if(create){const position=kind==='invites'?0:await db.prepare(`SELECT count(*) count FROM ${table} WHERE community_id=?`).bind(cid).first<{count:number}>();const pos=typeof position==='number'?position:integer(position?.count);if(kind==='questions'&&pos>=20)fail('参加質問は20件までです。',409);
   after=kind==='invites'?{id:targetId,label:normalized.label,maxUses:normalized.maxUses,useCount:0,expiresAt:new Date(Date.now()+(normalized.expiresInDays as number)*86400000).toISOString(),revokedAt:null,createdAt:now}:kind==='rules'?{id:targetId,title:normalized.title,body:normalized.body,required:true,position:pos,createdAt:now,updatedAt:now}:{id:targetId,prompt:normalized.prompt,required:normalized.required,position:pos,createdAt:now};
   const fields=Object.keys(after).map(k=>(specs[kind].fields as Record<string,string>)[k]);const extra=kind==='invites'?['code_hash','created_by_profile_id']:[];const args=[...values(after),...(kind==='invites'?[hash,actor]:[]),cid];
   const countGuard=kind==='questions'?` AND (SELECT count(*) FROM ${table} WHERE community_id=?)<20`:'';
   statement=db.prepare(`INSERT INTO ${table}(${[...fields,...extra,'community_id'].join(',')}) SELECT ${args.map(()=>'?').join(',')} WHERE ${operator}${countGuard}`).bind(...args,cid,actor,Number(owner),...(kind==='questions'?[cid]:[]));
  }else{const exp=normalized.expected as Record<string,unknown>;after=action==='revoke_invite'?{...exp,revokedAt:now}:null;statement=action==='revoke_invite'?db.prepare(`UPDATE ${table} SET revoked_at=? WHERE community_id=? AND ${conditions(exp)} AND ${operator}`).bind(now,cid,...values(exp),cid,actor,Number(owner)):db.prepare(`DELETE FROM ${table} WHERE community_id=? AND ${conditions(exp)} AND ${operator}`).bind(cid,...values(exp),cid,actor,Number(owner));}
  const proof=after?`EXISTS(SELECT 1 FROM ${table} WHERE community_id=? AND ${conditions(after)}${kind==='invites'&&create?' AND code_hash=? AND created_by_profile_id=?':''})`:`NOT EXISTS(SELECT 1 FROM ${table} WHERE community_id=? AND id=?)${kind==='questions'?' AND NOT EXISTS(SELECT 1 FROM community_onboarding_answers WHERE question_id=?)':''}`;
  const proofArgs=after?[cid,...values(after),...(kind==='invites'&&create?[hash,actor]:[])]:[cid,targetId,...(kind==='questions'?[targetId]:[])];
  const countProof=kind==='questions'&&create?` AND (SELECT count(*) FROM ${table} WHERE community_id=?)<=20`:'';const countArgs=kind==='questions'&&create?[cid]:[];
  const detail=JSON.stringify({note,targetId,accessFingerprint:fingerprint});
  const answerDelete=action==='delete_onboarding_question'?db.prepare(`DELETE FROM community_onboarding_answers WHERE question_id=? AND EXISTS(SELECT 1 FROM ${table} WHERE community_id=? AND ${conditions(normalized.expected as Record<string,unknown>)} AND ${operator})`).bind(targetId,cid,...values(normalized.expected as Record<string,unknown>),cid,actor,Number(owner)):null;
  try{await db.batch([...(answerDelete?[answerDelete]:[]),statement,db.prepare(`INSERT INTO community_audit_log(id,community_id,actor_profile_id,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE changes()=1 AND ${proof}${countProof} AND ${operator}`).bind(operationId as string,cid,actor,action,detail,now,...proofArgs,...countArgs,cid,actor,Number(owner)),db.prepare(`SELECT CASE WHEN ${proof}${countProof} AND ${operator} AND EXISTS(SELECT 1 FROM community_audit_log WHERE id=? AND community_id=? AND actor_profile_id=? AND action=? AND detail=? AND created_at=?) THEN 1 ELSE json_extract('invalid-json','$') END`).bind(...proofArgs,...countArgs,cid,actor,Number(owner),operationId as string,cid,actor,action,detail,now)]);}catch{const recovered=await replay();if(recovered)return recovered;await authorize(db,actor,cid,owner);return fail('設定または権限が更新されています。読み直してください。',409);}
  await authorize(db,actor,cid,owner);const current=await target(db,cid,kind,targetId);await authorize(db,actor,cid,owner);return {communityId:cid,kind,targetId,target:current,inviteCode,receipt:{auditId:operationId as string,action,targetId,confirmedAt:now,replayed:false}};
 }catch(error){return failed(error);}
}
