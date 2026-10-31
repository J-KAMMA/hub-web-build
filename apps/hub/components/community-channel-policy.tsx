'use client';

import React,{useEffect,useRef,useState} from 'react';
import {UiButton,UiSelect,UiTextarea} from '@/components/ui/primitives';
import {COMMUNITY_SLOWMODE_SECONDS,type CommunityChannelPolicy,type CommunityChannelPolicyPage} from '@/lib/community-channel-policy';

type Operation=Readonly<{action:'channel_controls'|'set_channel_archived';channelId:string;operationId:string;note:string;expectedSlowmodeSeconds:number;expectedArchivedAt:string|null;slowmodeSeconds?:number;archived?:boolean}>;
type Entry={offset:number;viewerId?:string;data?:CommunityChannelPolicyPage;verified?:boolean;draft?:{channelId:string;seconds:number;note:string};operation?:Operation;uncertain?:boolean;conflicted?:boolean;busy?:boolean;notice?:string;error?:string;sync?:()=>void;reading?:AbortController};
export type CommunityChannelPolicyMemory=Map<string,Entry>;
const intervals=new Set<number>(COMMUNITY_SLOWMODE_SECONDS);
const id=(value:unknown):value is string=>typeof value==='string'&&value.length>=1&&value.length<=100&&!/[^A-Za-z0-9_-]/.test(value);
const text=(value:string)=>!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(value);
const date=(value:unknown)=>value===null||(typeof value==='string'&&value.length<=64&&!/[\x00-\x1f\x7f]/.test(value)&&!Number.isNaN(Date.parse(value)));
const channel=(value:CommunityChannelPolicy)=>value&&id(value.id)&&typeof value.name==='string'&&value.name.trim().length>=1&&value.name.length<=50&&text(value.name)&&intervals.has(value.slowmodeSeconds)&&date(value.archivedAt);
const timing=(seconds:number)=>seconds===0?'制限なし':`${seconds}秒`;

type Props={communityId:string;memory:CommunityChannelPolicyMemory;isCurrent?:()=>boolean;onChanged?:()=>void};
export function CommunityChannelPolicyControls(props:Props){return <PolicyControls key={props.communityId} {...props}/>;}
function PolicyControls({communityId,memory,isCurrent=()=>true,onChanged}:Props){
  const [entry]=useState(()=>{const found=memory.get(communityId)??{offset:0};memory.set(communityId,found);return found;}),[,refresh]=useState(0);
  const reader=useRef<AbortController|null>(null),mounted=useRef(false),endpoint=`/api/communities/${encodeURIComponent(communityId)}/channels/policy`;
  const valid=()=>mounted.current&&memory.get(communityId)===entry&&isCurrent(),sync=()=>entry.sync?.();
  function clear(){delete entry.data;delete entry.viewerId;delete entry.operation;delete entry.draft;entry.uncertain=false;entry.conflicted=false;entry.verified=false;entry.notice='';}
  async function read(offset=entry.offset){
    if(!valid()||entry.busy||!Number.isSafeInteger(offset)||offset<0||offset>Number.MAX_SAFE_INTEGER-20)return;
    const controller=new AbortController();reader.current?.abort();reader.current=controller;entry.reading=controller;entry.busy=true;entry.verified=false;entry.error='';sync();
    try{
      const response=await fetch(`${endpoint}?offset=${offset}`,{cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(20000)])}),value=await response.json() as CommunityChannelPolicyPage&{error?:string};
      if(!valid()||controller.signal.aborted)return;
      if(!response.ok){if([401,403,404].includes(response.status))clear();throw Error(value.error??'チャンネル設定を読み込めませんでした。');}
      if(value?.communityId!==communityId||!id(value.viewerId)||!['owner','moderator'].includes(value.role)||value.offset!==offset||typeof value.hasMore!=='boolean'||!Array.isArray(value.channels)||value.channels.length>20||value.channels.some(item=>!channel(item))||new Set(value.channels.map(item=>item.id)).size!==value.channels.length||(value.hasMore&&value.channels.length!==20))throw Error('チャンネル設定を確認できませんでした。');
      if(entry.viewerId&&entry.viewerId!==value.viewerId)clear();
      entry.viewerId=value.viewerId;entry.data=value;entry.offset=offset;entry.verified=true;
    }catch(error){if(valid()&&!controller.signal.aborted)entry.error=error instanceof Error?error.message:'チャンネル設定を読み込めませんでした。';}
    finally{if(memory.get(communityId)===entry&&entry.reading===controller){delete entry.reading;entry.busy=false;sync();}}
  }
  useEffect(()=>{mounted.current=true;entry.sync=()=>refresh(value=>value+1);entry.verified=false;void read();return()=>{mounted.current=false;delete entry.sync;reader.current?.abort();if(entry.reading===reader.current){delete entry.reading;entry.busy=false;}};},[entry]);
  const canManage=(item:CommunityChannelPolicy,action:Operation['action'])=>entry.verified&&entry.data?.channels.some(current=>current.id===item.id)&&(action==='channel_controls'||entry.data?.role==='owner');
  function preview(item:CommunityChannelPolicy,action:Operation['action']){
    if(!valid()||entry.busy||entry.operation||!canManage(item,action))return;
    const rawNote=entry.draft?.note??'',note=rawNote.normalize('NFKC').trim(),seconds=entry.draft?.seconds??item.slowmodeSeconds;
    if(rawNote.length>1000||!text(rawNote)||note.length<5||note.length>1000){entry.error='理由を5〜1000文字で入力してください。';sync();return;}
    if(action==='channel_controls'&&(!intervals.has(seconds)||seconds===item.slowmodeSeconds)){entry.error='投稿間隔を変更してください。';sync();return;}
    entry.operation=Object.freeze({action,channelId:item.id,operationId:crypto.randomUUID(),note,expectedSlowmodeSeconds:item.slowmodeSeconds,expectedArchivedAt:item.archivedAt,...(action==='channel_controls'?{slowmodeSeconds:seconds}:{archived:item.archivedAt===null})});
    entry.error='';entry.notice='';entry.uncertain=false;entry.conflicted=false;sync();
  }
  async function save(){
    const operation=entry.operation,item=entry.data?.channels.find(value=>value.id===operation?.channelId);
    if(!valid()||entry.busy||!operation||!item||!canManage(item,operation.action))return;
    entry.busy=true;entry.uncertain=true;entry.error='';sync();
    try{
      const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(20000),body:JSON.stringify(operation)}),value=await response.json();
      if(!valid())return;
      if(!response.ok){
        if([401,403,404].includes(response.status)){clear();throw Error(value.error??'運営権限を確認できません。');}
        entry.conflicted=response.status===409;entry.uncertain=true;entry.verified=false;
        throw Error(value.error??'保存結果が不明です。同じ操作で確認してください。');
      }
      const receipt=value?.receipt,current=value?.channel;
      if(value?.communityId!==communityId||!channel(current)||current.id!==operation.channelId||receipt?.auditId!==operation.operationId||receipt?.action!==operation.action||receipt?.targetId!==operation.channelId||typeof receipt.replayed!=='boolean'||typeof receipt.confirmedAt!=='string'||!date(receipt.confirmedAt)||(!receipt.replayed&&(operation.action==='channel_controls'?current.slowmodeSeconds!==operation.slowmodeSeconds:Boolean(current.archivedAt)!==operation.archived)))throw Error('保存結果を確認できません。同じ操作で確認してください。');
      const matches=operation.action==='channel_controls'?current.slowmodeSeconds===operation.slowmodeSeconds:Boolean(current.archivedAt)===operation.archived;
      entry.notice=matches?'設定は保存済みです。':'以前の操作は保存済みですが、現在は別の設定です。';delete entry.operation;delete entry.draft;entry.uncertain=false;entry.conflicted=false;entry.busy=false;entry.verified=false;sync();onChanged?.();await read();
    }catch(error){if(valid()){if(entry.operation)entry.uncertain=true;entry.error=error instanceof Error?error.message:'保存結果が不明です。同じ操作で確認してください。';}}
    finally{if(memory.get(communityId)===entry){entry.busy=false;sync();}}
  }
  const operation=entry.operation,current=entry.data?.channels.find(item=>item.id===operation?.channelId);
  const cancelUnknown=Boolean(operation&&entry.verified&&current&&(entry.conflicted||(operation.action==='set_channel_archived'&&entry.data?.role==='moderator')));
  return <section className="community-channel-policy" aria-label="投稿間隔・アーカイブ">
    <header><h3>投稿間隔・アーカイブ</h3><UiButton size="compact" disabled={entry.busy} onClick={()=>void read()}>設定を再読込</UiButton></header>
    <p className="meta">投稿間隔は運営者が変更できます。アーカイブ・復元はオーナーのみ。内容は削除されません。</p>
    {entry.data?.channels.map(item=><article key={item.id}>
      <div><strong>#{item.name}</strong><p className="meta">{item.archivedAt?'アーカイブ済み':'公開中'} · 投稿間隔 {timing(item.slowmodeSeconds)}</p></div>
      <UiButton size="compact" disabled={entry.busy||!entry.verified||Boolean(operation)} onClick={()=>{entry.draft={channelId:item.id,seconds:item.slowmodeSeconds,note:''};entry.error='';sync();}}>設定を変更</UiButton>
      {entry.draft?.channelId===item.id&&!operation&&<div className="community-channel-policy-editor">
        <label>投稿間隔<UiSelect aria-label="投稿間隔" disabled={entry.busy||!entry.verified} value={entry.draft.seconds} onChange={event=>{entry.draft!.seconds=Number(event.target.value);sync();}}>{COMMUNITY_SLOWMODE_SECONDS.map(seconds=><option value={seconds} key={seconds}>{timing(seconds)}</option>)}</UiSelect></label>
        <label>変更理由<UiTextarea aria-label="チャンネル設定の変更理由" maxLength={1000} disabled={entry.busy||!entry.verified} value={entry.draft.note} onChange={event=>{entry.draft!.note=event.target.value;sync();}}/></label>
        <div className="community-channel-policy-actions"><UiButton size="compact" disabled={entry.busy||!entry.verified} onClick={()=>preview(item,'channel_controls')}>投稿間隔の変更を確認</UiButton>{entry.data?.role==='owner'&&<UiButton size="compact" disabled={entry.busy||!entry.verified} onClick={()=>preview(item,'set_channel_archived')}>{item.archivedAt?'復元を確認':'アーカイブを確認'}</UiButton>}</div>
      </div>}
    </article>)}
    {entry.data?.channels.length===0&&<p>チャンネルはありません。</p>}
    {entry.data&&<nav aria-label="チャンネル設定のページ"><UiButton size="compact" disabled={entry.busy||Boolean(operation)||entry.offset===0} onClick={()=>void read(Math.max(0,entry.offset-20))}>前の20件</UiButton><UiButton size="compact" disabled={entry.busy||Boolean(operation)||!entry.data.hasMore} onClick={()=>void read(entry.offset+20)}>次の20件</UiButton></nav>}
    {operation&&<section aria-label="チャンネル設定の確認" className="community-channel-policy-confirmation">
      <h4>#{current?.name??operation.channelId} の設定を確認</h4>
      <p>現在の投稿間隔: {timing(operation.expectedSlowmodeSeconds)} · {operation.expectedArchivedAt?'アーカイブ済み':'公開中'}</p>
      <p>{operation.action==='channel_controls'?`変更後の投稿間隔: ${timing(operation.slowmodeSeconds!)}`:operation.archived?'新しい投稿を止め、通常の一覧から外します。内容は削除しません。':'チャンネルを復元し、メンバーが再び投稿できるようにします。'}</p><p>理由: {operation.note}</p>
      {entry.uncertain&&<p>保存結果が不明です。同じ操作IDで確認します。</p>}
      <div className="community-channel-policy-actions"><UiButton size="compact" disabled={entry.busy||!current||!canManage(current,operation.action)} onClick={()=>void save()}>{entry.uncertain?'同じ設定操作で結果を確認':'確認して設定を保存'}</UiButton>{!entry.uncertain&&<UiButton size="compact" disabled={entry.busy} onClick={()=>{delete entry.operation;sync();}}>設定の確認を取り消す</UiButton>}{cancelUnknown&&<UiButton size="compact" disabled={entry.busy} onClick={()=>{delete entry.operation;entry.uncertain=false;entry.conflicted=false;entry.notice='以前の保存結果は確定できません。現在の設定を確認して操作を閉じました。再送していません。';entry.error='';sync();}}>現在の設定を確認して操作を閉じる</UiButton>}</div>
    </section>}
    <p role="status">{entry.busy?'確認中…':entry.error||entry.notice||''}</p>
  </section>;
}
