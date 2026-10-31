'use client';

import React,{useEffect,useRef,useState} from 'react';
import {UiButton,UiInput,UiTextarea} from '@/components/ui/primitives';
import type {CommunityAccessAction,CommunityAccessInput,CommunityAccessItem,CommunityAccessKind,CommunityAccessPage,CommunityAccessResult,CommunityManagedInvite,CommunityManagedQuestion,CommunityManagedRule} from '@/lib/community-access-management';

type Operation={input:Readonly<CommunityAccessInput>;remove:boolean};
type Entry={offset:number;actor?:string;data?:CommunityAccessPage;verified?:boolean;draft?:Record<string,string|boolean>;operation?:Operation;attempted?:boolean;uncertain?:boolean;rejected?:number;loading?:boolean;sending?:boolean;permissionLost?:boolean;invalidated?:boolean;error?:string;notice?:string;failedOffset?:number;reading?:AbortController;sync?:()=>void;saved?:{action:CommunityAccessAction;targetId:string;receipt:CommunityAccessResult['receipt'];different:boolean}};
export type CommunityAccessManagementMemory=Map<string,Entry>;
type Props={communityId:string;memory:CommunityAccessManagementMemory;isCurrent?:()=>boolean;onChanged?:()=>void|Promise<void>;kinds?:CommunityAccessKind[]};
const names={invites:'招待',rules:'ルール',questions:'参加時の質問'};
const id=(v:unknown):v is string=>typeof v==='string'&&v.length>=1&&v.length<=100&&!/[^A-Za-z0-9_-]/.test(v);
const uuid=(v:unknown):v is string=>typeof v==='string'&&v.length===36&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const safeText=(v:unknown,max:number):v is string=>typeof v==='string'&&v.length<=max&&!/[\ud800-\udfff]/u.test(v);
const text=(v:unknown,max:number):v is string=>safeText(v,max)&&Boolean(v.trim());
const normalized=(v:unknown,max:number)=>safeText(v,max)?v.normalize('NFKC').trim():null;
const date=(v:unknown):v is string=>text(v,64)&&!/[\x00-\x1f\x7f]/.test(v)&&Number.isFinite(Date.parse(v));
const nullableDate=(v:unknown)=>v===null||date(v);
const integer=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const offset=(v:unknown):v is number=>integer(v)&&v%20===0&&Number.isSafeInteger(v+20);
const invalid=():never=>{throw Error('管理情報を確認できませんでした。');};
const record=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:invalid();
function bounded(v:unknown){try{if(new TextEncoder().encode(JSON.stringify(v)).length>128*1024)invalid();}catch{invalid();}}
function managed(value:unknown,kind:CommunityAccessKind):CommunityAccessItem{
  const v=record(value);if(!id(v.id)||!date(v.createdAt))invalid();
  if(kind==='invites'){if(!safeText(v.label,80)||!(v.maxUses===null||(integer(v.maxUses)&&v.maxUses>0))||!integer(v.useCount)||!nullableDate(v.expiresAt)||!nullableDate(v.revokedAt))invalid();return{id:v.id,label:v.label,maxUses:v.maxUses as number|null,useCount:v.useCount,expiresAt:v.expiresAt as string|null,revokedAt:v.revokedAt as string|null,createdAt:v.createdAt} as CommunityManagedInvite;}
  if(typeof v.required!=='boolean'||!integer(v.position))invalid();
  if(kind==='rules'){if(!text(v.title,80)||!text(v.body,1000)||!date(v.updatedAt))invalid();return{id:v.id,title:v.title,body:v.body,required:v.required,position:v.position,createdAt:v.createdAt,updatedAt:v.updatedAt} as CommunityManagedRule;}
  if(!text(v.prompt,200))invalid();return{id:v.id,prompt:v.prompt,required:v.required,position:v.position,createdAt:v.createdAt} as CommunityManagedQuestion;
}
function parsePage(value:unknown,communityId:string,kind:CommunityAccessKind,requested:number):CommunityAccessPage{
  bounded(value);const v=record(value);if(v.communityId!==communityId||v.kind!==kind||!id(v.viewerId)||!['owner','moderator'].includes(String(v.role))||v.offset!==requested||!offset(v.offset)||typeof v.hasMore!=='boolean'||!Array.isArray(v.items)||v.items.length>20||(v.hasMore&&v.items.length!==20))invalid();
  const items=(v.items as unknown[]).map(item=>managed(item,kind));if(new Set(items.map(item=>item.id)).size!==items.length)invalid();return{communityId,viewerId:v.viewerId,role:v.role,kind,items,offset:requested,hasMore:v.hasMore} as CommunityAccessPage;
}
const itemTitle=(item:CommunityAccessItem)=>'label'in item?(item.label||'名前なしの招待'):'title'in item?item.title:item.prompt;
const removeAction=(kind:CommunityAccessKind):CommunityAccessAction=>kind==='invites'?'revoke_invite':kind==='rules'?'delete_rule':'delete_onboarding_question';
function targetMatches(target:CommunityAccessItem|null,input:CommunityAccessInput){
  if(input.action==='delete_rule'||input.action==='delete_onboarding_question')return target===null;
  if(!target)return false;
  if(input.action==='revoke_invite')return 'revokedAt'in target&&target.revokedAt!==null&&Object.entries(input.expected).every(([key,value])=>key==='revokedAt'||(target as unknown as Record<string,unknown>)[key]===value);
  if(input.action==='create_invite')return 'label'in target&&target.label===input.label&&target.maxUses===input.maxUses&&target.useCount===0&&target.revokedAt===null&&target.expiresAt!==null&&Date.parse(target.expiresAt)>Date.parse(target.createdAt);
  if(input.action==='create_rule')return 'title'in target&&target.title===input.title&&target.body===input.body&&target.required===true;
  return 'prompt'in target&&target.prompt===input.prompt&&target.required===input.required;
}
function parseResult(value:unknown,cid:string,kind:CommunityAccessKind,op:Operation){
  bounded(value);const v=record(value),r=record(v.receipt),input=op.input,targetId=input.action==='revoke_invite'?input.inviteId:input.action==='delete_rule'?input.ruleId:input.action==='delete_onboarding_question'?input.questionId:input.operationId;
  if(v.communityId!==cid||v.kind!==kind||v.targetId!==targetId||!id(v.targetId)||!uuid(r.auditId)||r.auditId!==input.operationId||r.action!==input.action||r.targetId!==targetId||!date(r.confirmedAt)||typeof r.replayed!=='boolean')invalid();
  const target=v.target===null?null:managed(v.target,kind);if(target&&target.id!==targetId)invalid();const matches=targetMatches(target,input);if(!r.replayed&&!matches)invalid();
  if(input.action==='create_invite'){if(!(v.inviteCode===null||(typeof v.inviteCode==='string'&&v.inviteCode.length===32&&!/[^a-f0-9]/.test(v.inviteCode)))||(v.inviteCode!==null&&r.replayed))invalid();}else if(v.inviteCode!==null)invalid();
  return{action:input.action,targetId,receipt:{auditId:r.auditId,action:input.action,targetId,confirmedAt:r.confirmedAt,replayed:r.replayed} as CommunityAccessResult['receipt'],code:v.inviteCode as string|null,different:!matches};
}

export function CommunityAccessManagementControls({kinds=['invites','rules','questions'],...props}:Props){
  const identity=useRef({memory:props.memory,version:0});if(identity.current.memory!==props.memory)identity.current={memory:props.memory,version:identity.current.version+1};
  const allowed=[...new Set(kinds.filter(kind=>Object.hasOwn(names,kind)))];return <AccessKinds key={JSON.stringify([identity.current.version,props.communityId,allowed])} {...props} kinds={allowed}/>;
}
function AccessKinds({kinds,...props}:Props&{kinds:CommunityAccessKind[]}){
  const [kind,setKind]=useState(kinds[0]);
  if(!kind)return <section className="community-access-management"><p>管理する項目がありません。</p></section>;
  return <AccessControls key={JSON.stringify([props.communityId,kind])} {...props} kind={kind} kinds={kinds} onKind={setKind}/>;
}
function AccessControls({communityId,memory,isCurrent=()=>true,onChanged,kind,kinds,onKind}:Omit<Props,'kinds'>&{kind:CommunityAccessKind;kinds:CommunityAccessKind[];onKind:(kind:CommunityAccessKind)=>void}){
  const key=JSON.stringify([communityId,kind]),[entry]=useState(()=>{const e=memory.get(key)??{offset:0};memory.set(key,e);return e;}),[,refresh]=useState(0),[code,setCode]=useState<string|null>(null);
  const mounted=useRef(false),reader=useRef<AbortController|null>(null),endpoint=`/api/communities/${encodeURIComponent(communityId)}/access-management`;
  const retained=()=>memory.get(key)===entry&&!entry.invalidated;
  const current=()=>{try{return isCurrent()!==false;}catch{return false;}};
  const valid=()=>mounted.current&&retained()&&current(),sync=()=>entry.sync?.();
  const entries=()=>[...memory.entries()].filter(([name])=>{try{return JSON.parse(name)[0]===communityId;}catch{return false;}});
  const locked=()=>entries().some(([,e])=>e.operation||e.sending);
  const canManage=(remove=false)=>Boolean(entry.data&&((kind==='invites'&&!remove)||entry.data.role==='owner'));
  const canEdit=()=>valid()&&entry.verified&&!entry.loading&&!entry.sending&&!entry.saved&&!locked()&&canManage();
  function clearReaders(except?:AbortController){setCode(null);for(const [,e] of entries()){if(e.reading!==except)e.reading?.abort();delete e.reading;e.loading=false;delete e.data;delete e.draft;e.verified=false;e.permissionLost=true;if(!e.attempted&&!e.sending)delete e.operation;e.sync?.();}}
  function invalidate(){setCode(null);for(const [name,e] of entries()){const notify=e.sync;for(const property of Object.keys(e))delete (e as Record<string,unknown>)[property];e.invalidated=true;e.notice='接続が変わりました。管理画面を閉じて開き直してください。';memory.delete(name);notify?.();}}
  async function read(requested=entry.failedOffset??entry.offset){
    if(!valid()||entry.sending||entry.loading)return;const controller=new AbortController();reader.current?.abort();reader.current=controller;entry.reading=controller;entry.loading=true;entry.verified=false;entry.error='';sync();
    try{if(!id(communityId)||!offset(requested))invalid();const response=await fetch(`${endpoint}?kind=${kind}&offset=${requested}`,{cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(20000)])}),value=await response.json();if(!valid()||controller.signal.aborted)return;
      if(!response.ok){if([401,403,404].includes(response.status))clearReaders(controller);throw Error(typeof value?.error==='string'?value.error:'管理情報を読み込めませんでした。');}
      const data=parsePage(value,communityId,kind,requested);if(entries().some(([,e])=>e.actor&&e.actor!==data.viewerId)){invalidate();return;}entry.actor=data.viewerId;entry.data=data;entry.offset=requested;entry.verified=true;entry.permissionLost=false;delete entry.failedOffset;
    }catch(e){if(valid()&&!controller.signal.aborted){entry.failedOffset=requested;entry.error=`${entry.saved?'変更は保存済みです。現在の登録を確認できませんでした: ':''}${e instanceof Error?e.message:'管理情報を読み込めませんでした。'}`;}}
    finally{if(retained()&&entry.reading===controller){entry.loading=false;delete entry.reading;sync();}}
  }
  useEffect(()=>{mounted.current=true;const notify=()=>refresh(v=>v+1);entry.sync=notify;entry.verified=false;const changed=()=>{reader.current?.abort();invalidate();for(const property of Object.keys(entry))delete (entry as Record<string,unknown>)[property];entry.invalidated=true;entry.notice='接続が変わりました。管理画面を閉じて開き直してください。';notify();};window.addEventListener('hub-account-changed',changed);void read(entry.offset);return()=>{mounted.current=false;if(entry.sync===notify)delete entry.sync;reader.current?.abort();if(entry.reading===reader.current){delete entry.reading;entry.loading=false;}window.removeEventListener('hub-account-changed',changed);};},[entry,memory]);
  function setDraft(name:string,value:string|boolean){if(!canEdit())return;(entry.draft??={})[name]=value;sync();}
  function prepare(item?:CommunityAccessItem){
    const remove=Boolean(item);if(!canEdit()||!canManage(remove))return;const d=entry.draft??{},note=normalized(d.note??'',1000);if(!text(note,1000)||note.length<5){entry.error='変更の理由を5〜1000文字で入力してください。';sync();return;}
    const common={note,operationId:crypto.randomUUID()};let input:CommunityAccessInput;
    if(item){if(!entry.data?.items.some(v=>v.id===item.id))return;const expected=Object.freeze({...item});input=(kind==='invites'?{...common,action:'revoke_invite',inviteId:item.id,expected:expected as CommunityManagedInvite}:kind==='rules'?{...common,action:'delete_rule',ruleId:item.id,expected:expected as CommunityManagedRule}:{...common,action:'delete_onboarding_question',questionId:item.id,expected:expected as CommunityManagedQuestion});}
    else if(kind==='invites'){const label=normalized(d.label??'',80),expiresInDays=Number(d.expiresInDays??7),raw=d.maxUses??'25',maxUses=String(raw).trim()===''?null:Number(raw);if(!safeText(label,80)||!Number.isInteger(expiresInDays)||expiresInDays<1||expiresInDays>365||!(maxUses===null||(integer(maxUses)&&maxUses>0))){entry.error='招待の名前・1〜365日の有効期限・利用上限を確認してください。';sync();return;}input={...common,action:'create_invite',label,expiresInDays,maxUses};}
    else if(kind==='rules'){const title=normalized(d.title??'',80),body=normalized(d.body??'',1000);if(!text(title,80)||!text(body,1000)){entry.error='ルールの見出しと本文を入力してください。';sync();return;}input={...common,action:'create_rule',title,body};}
    else{const prompt=normalized(d.prompt??'',200),required=d.required??false;if(!text(prompt,200)||typeof required!=='boolean'){entry.error='参加時の質問を200文字以内で入力してください。';sync();return;}input={...common,action:'create_onboarding_question',prompt,required};}
    entry.operation={input:Object.freeze(input),remove};entry.error='';entry.notice='';sync();
  }
  async function save(){
    const op=entry.operation;if(!valid()||!op||entry.saved||entry.sending||entry.loading||!entry.verified||entry.rejected||!canManage(op.remove))return;entry.sending=true;entry.attempted=true;entry.uncertain=true;entry.error='';sync();
    try{const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(20000),body:JSON.stringify(op.input)}),value=await response.json();if(!retained()||!current())return;
      if(!response.ok){entry.rejected=[400,403,404,409].includes(response.status)?response.status:undefined;entry.uncertain=!entry.rejected;if(entry.rejected)entry.verified=false;if([401,403,404].includes(response.status))clearReaders();throw Error(typeof value?.error==='string'?value.error:'保存結果を確認できません。同じ操作で確認してください。');}
      const ack=parseResult(value,communityId,kind,op);entry.saved={action:ack.action,targetId:ack.targetId,receipt:ack.receipt,different:ack.different};delete entry.operation;delete entry.uncertain;delete entry.rejected;entry.verified=false;entry.sending=false;entry.notice='変更は保存済みです。';if(valid()&&!entry.permissionLost)setCode(ack.code);sync();
      if(valid()){if(!ack.code&&!entry.permissionLost){try{await onChanged?.();}catch(e){if(valid())entry.error=`変更は保存済みです。画面を更新できませんでした: ${e instanceof Error?e.message:'再読込できませんでした。'}`;}}if(valid())await read(entry.offset);}
    }catch(e){if(retained()&&current()){entry.error=e instanceof Error?e.message:'保存結果が不明です。同じ操作で確認してください。';sync();}}
    finally{if(retained()){entry.sending=false;sync();}}
  }
  const op=entry.operation,input=op?.input,closeAllowed=Boolean(op&&entry.verified&&!entry.loading&&!entry.sending&&entry.data?.viewerId===entry.actor&&(entry.rejected||(entry.uncertain&&op.remove&&entry.data?.role==='moderator')));
  const busy=Boolean(entry.loading||entry.sending),draft=entry.draft??{};
  const field=(label:string,name:string,max:number|undefined,multiline=false,defaultValue='',type='text')=><label>{label}{multiline?<UiTextarea aria-label={label} name={name} rows={3} maxLength={max} disabled={!canEdit()} value={String(draft[name]??defaultValue)} onChange={event=>setDraft(name,event.target.value)}/>:<UiInput aria-label={label} name={name} type={type} min={type==='number'?1:undefined} max={name==='expiresInDays'?365:undefined} step={type==='number'?1:undefined} maxLength={max} disabled={!canEdit()} value={String(draft[name]??defaultValue)} onChange={event=>setDraft(name,event.target.value)}/>}</label>;
  return <section className="community-access-management" aria-label="招待・ルール・参加時の質問">
    <header><h3>{names[kind]}の管理</h3><UiButton size="compact" disabled={busy||entry.invalidated} onClick={()=>void read()}>管理情報を再読み込み</UiButton></header>
    {kinds.length>1&&<nav aria-label="管理する項目">{kinds.map(value=><UiButton key={value} size="compact" aria-pressed={value===kind} disabled={busy||locked()||Boolean(code)} onClick={()=>{if(valid()&&!locked()&&!code)onKind(value);}}>{names[value]}</UiButton>)}</nav>}
    {entry.loading&&<p className="meta">管理情報を読み込んでいます…</p>}
    {!entry.verified&&entry.data&&<p className="meta">表示は以前の読み込み結果です。再確認するまで変更できません。</p>}
    {entry.data&&!canManage()&&<p className="meta">この項目の変更はオーナーだけが行えます。</p>}
    {entry.data?.items.map(item=><article key={item.id}><h4>{itemTitle(item)}</h4>{'label'in item?<p className="meta">使用 {item.useCount} / {item.maxUses??'上限なし'} · 有効期限: {item.expiresAt??'期限なし'} · {item.revokedAt?'無効化済み':'有効'}</p>:'body'in item?<p>{item.body}</p>:<p className="meta">{item.required?'回答必須':'任意回答'}</p>}{canManage(true)&&!('revokedAt'in item&&item.revokedAt)&&<UiButton size="compact" disabled={!canEdit()} onClick={()=>prepare(item)}>{kind==='invites'?'無効化を確認':'削除を確認'}</UiButton>}</article>)}
    {entry.data?.items.length===0&&<p>このページに登録はありません。</p>}
    {entry.data&&<nav aria-label="管理項目のページ"><UiButton size="compact" disabled={busy||locked()||entry.offset===0} onClick={()=>void read(entry.offset-20)}>前の20件</UiButton><span className="meta">{entry.offset/20+1}ページ</span><UiButton size="compact" disabled={busy||locked()||!entry.data.hasMore} onClick={()=>void read(entry.offset+20)}>次の20件</UiButton></nav>}
    {entry.saved?<section aria-label="管理変更の保存結果"><p>変更は保存済みです。同じ操作を再送しません。</p>{entry.saved.different&&<p className="meta">以前の操作は保存済みですが、現在の登録は確認した内容と異なるか、削除されています。再適用しません。</p>}{entry.saved.action==='create_invite'&&(code?<section aria-label="今回発行した招待"><p>この招待URLはこの画面で一度だけ表示します。画面を離れる前に控えてください。</p><a href={`${window.location.origin}/v2/community/invite/${code}`}>{`${window.location.origin}/v2/community/invite/${code}`}</a><UiButton size="compact" onClick={()=>{if(!valid())return;setCode(null);void onChanged?.();}}>コード表示を閉じる</UiButton></section>:<p>招待は発行済みです。招待URLは復元できません。必要なら現在の招待を確認し、無効化と再発行を別の操作として行ってください。</p>)}<UiButton size="compact" disabled={busy||!entry.verified||Boolean(code)} onClick={()=>{if(!valid()||busy||!entry.verified||code)return;delete entry.saved;delete entry.operation;delete entry.attempted;delete entry.uncertain;delete entry.rejected;entry.draft={};entry.error='';entry.notice='';sync();}}>別の変更を行う</UiButton></section>:input&&op?<section aria-label="管理変更の確認"><h4>{names[kind]} · {op.remove?(kind==='invites'?'無効化':'削除'):'追加'}</h4><p className="meta">対象コミュニティ: {communityId}</p>{!entry.permissionLost&&<><Preview input={input}/><h5>変更の理由</h5><p>{input.note}</p></>}{input.action==='create_invite'&&<p className="meta">招待URLは発行直後に一度だけ表示します。再試行では復元できない場合があります。</p>}{input.action==='delete_onboarding_question'&&<p>この質問に寄せられた既存の回答も削除されます。</p>}{entry.uncertain&&<p className="meta">保存結果が不明です。同じ対象・内容で結果を確認してください。</p>}{entry.rejected&&<p className="meta">この操作は受け付けられませんでした。現在の登録を再確認してください。以前の保存結果は確定できない場合があります。</p>}<div><UiButton size="compact" disabled={busy||!entry.verified||Boolean(entry.rejected)||!canManage(op.remove)} onClick={()=>void save()}>{entry.attempted?'同じ変更の保存結果を確認':'確認して変更を保存'}</UiButton>{!entry.attempted&&<UiButton size="compact" disabled={busy} onClick={()=>{if(valid()&&!entry.attempted){delete entry.operation;sync();}}}>編集に戻る</UiButton>}{closeAllowed&&<><p className="meta">以前の保存結果は確定できません。現在の登録を確認して、以前の操作を閉じます。再送しません。</p><UiButton size="compact" onClick={()=>{if(!valid()||!closeAllowed)return;delete entry.operation;delete entry.attempted;delete entry.uncertain;delete entry.rejected;entry.error='';entry.notice='以前の操作を閉じました。登録内容は変更していません。';sync();}}>現在の登録を確認して操作を閉じる</UiButton></>}</div></section>:canManage()&&<form onSubmit={event=>{event.preventDefault();prepare();}}>{kind==='invites'?<>{field('招待の名前','label',80)}{field('有効期限（日）','expiresInDays',undefined,false,'7','number')}{field('利用上限（空欄で上限なし）','maxUses',undefined,false,'25','number')}</>:kind==='rules'?<>{field('ルールの見出し','title',80)}{field('ルールの本文','body',1000,true)}<p className="meta">追加したルールは確認必須になります。</p></>:<>{field('参加時の質問','prompt',200,true)}<label>回答を必須にする<UiInput type="checkbox" aria-label="回答を必須にする" checked={draft.required===true} disabled={!canEdit()} onChange={event=>setDraft('required',event.target.checked)}/></label></>}{field('変更の理由','note',1000,true)}<UiButton type="submit" size="compact" disabled={!canEdit()}>追加内容を確認</UiButton></form>}
    <p role="status">{entry.error||entry.notice||''}</p>
  </section>;
}
function Preview({input}:{input:CommunityAccessInput}){
  if(input.action==='create_invite')return <><p>{input.label||'名前なしの招待'}</p><p>発行後: 有効期限 {input.expiresInDays}日 · 利用上限 {input.maxUses??'なし'}</p></>;
  if(input.action==='create_rule')return <><p>{input.title}</p><p>{input.body}</p><p className="meta">確認必須</p></>;
  if(input.action==='create_onboarding_question')return <><p>{input.prompt}</p><p>{input.required?'回答必須':'任意回答'}</p></>;
  const value=input.expected;return <><p>{itemTitle(value)}</p>{'label'in value?<p>現在: 使用 {value.useCount} / {value.maxUses??'上限なし'} · 有効期限 {value.expiresAt??'期限なし'} · {value.revokedAt?'無効化済み · '+value.revokedAt:'有効'}</p>:'body'in value?<><p>{value.body}</p><p>{value.required?'確認必須':'確認任意'}</p><p className="meta">更新日時: {value.updatedAt}</p></>:<p>{value.required?'回答必須':'任意回答'}</p>}<p className="meta">登録日時: {value.createdAt}</p>{'position'in value&&<p className="meta">表示順: {value.position}</p>}</>;
}
