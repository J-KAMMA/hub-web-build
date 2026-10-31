'use client';

import React, {useEffect, useRef, useState} from 'react';
import {UiButton, UiCheckbox, UiLinkButton, UiTextarea} from '@/components/ui/primitives';

type Rule={id:string;title:string;body:string;required:0|1};
type Question={id:string;prompt:string;required:0|1};
type Guide={community:{id:string;name:string;description:string;visibility:'public'|'approval'|'private'};viewerId:string|null;joined:boolean;pending:boolean;rules:Rule[];questions:Question[];snapshot:string};
export type CommunityJoinResult={joined:boolean;pending:boolean;alreadyJoined:boolean;alreadyPending:boolean};
type Payload={operationId:string;snapshot:string;acceptedRules:boolean;answers:{questionId:string;answer:string}[]};
type Attempt={payload:Payload;actor:string;action:'member_joined'|'membership_requested';uncertain:boolean;conflict:boolean};
type Entry={accepted:boolean;answers:Record<string,string>;attempt?:Attempt;result?:CommunityJoinResult};
export type CommunityJoinMemory=Map<string,Entry>;
type Props={communityId:string;actorId?:string;memory?:CommunityJoinMemory;onChanged?:(state:CommunityJoinResult)=>void|Promise<void>};
const id=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=100&&!/[^A-Za-z0-9_-]/.test(v);
const hex=(v:unknown,n:number):v is string=>typeof v==='string'&&v.length===n&&!/[^a-f0-9]/.test(v);
const uuid=(v:unknown):v is string=>typeof v==='string'&&v.length===36&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const text=(v:unknown):v is string=>typeof v==='string'&&!/[\ud800-\udfff]/u.test(v);
const dbText=(v:unknown,max:number,min=1):v is string=>text(v)&&v.length<=max*2&&Array.from(v).length>=min&&Array.from(v).length<=max;
const date=(v:unknown):v is string=>text(v)&&v.length>0&&v.length<=64&&!/[\x00-\x1f\x7f]/.test(v)&&Number.isFinite(Date.parse(v));
const invalid=():never=>{throw Error('参加情報を確認できませんでした。');};
const record=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:invalid();
function bounded(v:unknown){if(new TextEncoder().encode(JSON.stringify(v)).length>512*1024)invalid();}
function parseGuide(value:unknown,cid:string):Guide{
  bounded(value);const v=record(value),c=record(v.community);
  if(!id(c.id)||c.id!==cid||!dbText(c.name,100)||!dbText(c.description,2000,0)||!['public','approval','private'].includes(String(c.visibility))||!(v.viewerId===null||id(v.viewerId))||typeof v.joined!=='boolean'||typeof v.pending!=='boolean'||(v.joined&&v.pending)||((v.joined||v.pending)&&v.viewerId===null)||!hex(v.snapshot,64)||!Array.isArray(v.rules)||!Array.isArray(v.questions)||v.questions.length>20)invalid();
  const rules=(v.rules as unknown[]).map(value=>{const r=record(value);if(!id(r.id)||!dbText(r.title,80)||!dbText(r.body,1000)||(r.required!==0&&r.required!==1))invalid();return{id:r.id,title:r.title,body:r.body,required:r.required} as Rule;}),questions=(v.questions as unknown[]).map(value=>{const q=record(value);if(!id(q.id)||!dbText(q.prompt,200)||(q.required!==0&&q.required!==1))invalid();return{id:q.id,prompt:q.prompt,required:q.required} as Question;});
  if(new Set(rules.map(r=>r.id)).size!==rules.length||new Set(questions.map(q=>q.id)).size!==questions.length)invalid();
  return{community:{id:c.id,name:c.name,description:c.description,visibility:c.visibility},viewerId:v.viewerId,joined:v.joined,pending:v.pending,snapshot:v.snapshot,rules,questions} as Guide;
}
function parseResult(value:unknown,cid:string,attempt:Attempt):CommunityJoinResult{
  bounded(value);const v=record(value);
  if(v.communityId!==cid||typeof v.joined!=='boolean'||typeof v.pending!=='boolean'||typeof v.alreadyJoined!=='boolean'||typeof v.alreadyPending!=='boolean'||(v.joined&&v.pending)||(v.alreadyJoined&&v.alreadyPending))invalid();
  if(v.receipt===null){if(!(v.alreadyJoined&&v.joined)&&!(v.alreadyPending&&v.pending))invalid();}
  else{const r=record(v.receipt);if(v.alreadyJoined||v.alreadyPending||!uuid(r.auditId)||r.auditId!==attempt.payload.operationId||r.targetId!==cid||r.action!==attempt.action||!date(r.confirmedAt)||typeof r.replayed!=='boolean')invalid();}
  return{joined:v.joined,pending:v.pending,alreadyJoined:v.alreadyJoined,alreadyPending:v.alreadyPending} as CommunityJoinResult;
}

export function CommunityJoinControls(props:Props){
  const owned=useRef<CommunityJoinMemory>(new Map());
  const memory=props.memory??owned.current,actor=useRef(props.actorId);
  if(actor.current!==props.actorId){memory.clear();actor.current=props.actorId;}
  return <JoinControls key={JSON.stringify([props.communityId,props.actorId??null])} {...props} memory={memory}/>;
}
function JoinControls({communityId,actorId,memory,onChanged}:Props&{memory:CommunityJoinMemory}){
  const key=JSON.stringify([communityId,actorId??null]);
  const [entry]=useState(()=>{if(!memory.has(key))memory.set(key,{accepted:false,answers:{}});return memory.get(key)!;});
  const [data,setData]=useState<Guide|null>(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[refreshFailed,setRefreshFailed]=useState(false),[,render]=useState(0);
  const mounted=useRef(false),generation=useRef(0),epoch=useRef(0),reader=useRef<AbortController|null>(null),writer=useRef<AbortController|null>(null),inFlight=useRef(false),changed=useRef(onChanged);changed.current=onChanged;
  const endpoint=`/api/communities/${encodeURIComponent(communityId)}/onboarding`,href=`/v2/community?community=${encodeURIComponent(communityId)}`,valid=(scope:number)=>mounted.current&&generation.current===scope&&memory.get(key)===entry;
  const update=()=>render(n=>n+1);
  function invalidateActor(){generation.current++;epoch.current++;reader.current?.abort();writer.current?.abort();inFlight.current=false;memory.clear();entry.answers={};entry.accepted=false;delete entry.attempt;delete entry.result;setData(null);setBusy(false);setLoading(false);setError('アカウントが変わりました。参加画面を閉じて開き直してください。');update();}
  async function load(reset=false){
    if(!mounted.current||inFlight.current)return;const scope=generation.current,read=++epoch.current,controller=new AbortController();reader.current?.abort();reader.current=controller;setLoading(true);setError('');
    try{if(!id(communityId))invalid();const response=await fetch(endpoint,{cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(20000)])}),value=await response.json();if(!valid(scope)||read!==epoch.current||controller.signal.aborted)return;if(!response.ok)throw Error(text(value?.error)?value.error:'参加案内を取得できませんでした。');const next=parseGuide(value,communityId);if((actorId!==undefined&&next.viewerId!==(actorId||null))||(entry.attempt&&next.viewerId!==entry.attempt.actor)){invalidateActor();return;}
      if(reset){entry.accepted=false;entry.answers={};delete entry.attempt;delete entry.result;update();}setData(next);
    }catch(cause){if(valid(scope)&&read===epoch.current&&!controller.signal.aborted){setData(null);setError(cause instanceof Error?cause.message:'参加案内を取得できませんでした。');}}
    finally{if(valid(scope)&&read===epoch.current&&!controller.signal.aborted)setLoading(false);}
  }
  useEffect(()=>{mounted.current=true;window.addEventListener('hub-account-changed',invalidateActor);void load();return()=>{mounted.current=false;generation.current++;epoch.current++;reader.current?.abort();writer.current?.abort();window.removeEventListener('hub-account-changed',invalidateActor);};},[communityId,actorId,memory]);
  async function refresh(saved:CommunityJoinResult,scope=generation.current){
    if(!valid(scope)||inFlight.current)return;setRefreshFailed(false);try{await changed.current?.(saved);}catch{if(valid(scope))setRefreshFailed(true);}
  }
  async function join(){
    if(!valid(generation.current)||inFlight.current||loading||!data||!data.viewerId||data.joined||data.pending||data.community.visibility==='private'||entry.result||entry.attempt?.conflict)return;
    let attempt=entry.attempt;
    if(!attempt){
      const required=data.rules.some(r=>r.required===1);if(required&&!entry.accepted){setError('必須ルールへの同意が必要です。');return;}const answers:Payload['answers']=[];
      for(const q of data.questions){const raw=entry.answers[q.id]??'';if(!text(raw)||raw.length>1000){setError('回答は1000文字以内で入力してください。');return;}const answer=raw.normalize('NFKC').trim();if(answer.length>1000){setError('回答は1000文字以内で入力してください。');return;}if(!answer&&q.required===1){setError('必須の質問に回答してください。');return;}if(answer)answers.push({questionId:q.id,answer});}
      attempt={payload:{operationId:crypto.randomUUID(),snapshot:data.snapshot,acceptedRules:required?entry.accepted:true,answers},actor:data.viewerId,action:data.community.visibility==='approval'?'membership_requested':'member_joined',uncertain:false,conflict:false};entry.attempt=attempt;
    }
    if(attempt.actor!==data.viewerId)return;const wasUncertain=attempt.uncertain;attempt.uncertain=true;update();const scope=generation.current,controller=new AbortController();writer.current=controller;inFlight.current=true;setBusy(true);setError('');
    try{const response=await fetch(endpoint,{method:'POST',cache:'no-store',headers:{'content-type':'application/json'},signal:AbortSignal.any([controller.signal,AbortSignal.timeout(20000)]),body:JSON.stringify(attempt.payload)}),value=await response.json();if(!valid(scope)||controller.signal.aborted||entry.attempt!==attempt)return;
      if(!response.ok){if([400,403,404,409,429].includes(response.status)){attempt.conflict=true;attempt.uncertain=wasUncertain;}if([401,403,404].includes(response.status))setData(null);update();throw Error(text(value?.error)?value.error:'参加結果を確認できませんでした。同じ操作で再試行してください。');}
      const saved=parseResult(value,communityId,attempt);entry.result=saved;entry.answers={};entry.accepted=false;setData(previous=>previous?{...previous,joined:saved.joined,pending:saved.pending}:previous);update();inFlight.current=false;await refresh(saved,scope);
    }catch(cause){if(valid(scope)&&!controller.signal.aborted&&entry.attempt===attempt){setError(cause instanceof Error?cause.message:'参加結果が不明です。同じ操作で確認してください。');update();}}
    finally{if(valid(scope)&&entry.attempt===attempt){inFlight.current=false;setBusy(false);}}
  }
  const locked=Boolean(entry.attempt||busy),required=data?.rules.some(r=>r.required===1),saved=entry.result;
  const joined=data?.joined??saved?.joined,pending=data?.pending??saved?.pending;
  return <section className="community-join-controls" aria-label="コミュニティへの参加">
    <h2>参加案内</h2>
    {saved?<section aria-label="参加結果"><p>{joined?'参加を確認しました。':pending?'参加申請を確認しました。承認をお待ちください。':'この操作は記録されていますが、現在は参加・申請していません。自動で参加し直しません。'}同じ操作を再送しません。</p>{refreshFailed&&<><p role="status">参加操作は保存済みですが、画面の更新を確認できませんでした。</p><UiButton type="button" size="compact" disabled={busy} onClick={()=>void refresh(saved)}>画面を更新する</UiButton></>}{error&&<p role="alert">参加操作は確認済みです。{error}</p>}<UiButton type="button" size="compact" disabled={busy||loading} onClick={()=>void load(true)}>参加状態と案内を読み直す</UiButton></section>:loading?<p role="status">参加案内を確認しています…</p>:!data?<><p role="alert">{error}</p>{memory.get(key)===entry&&<UiButton type="button" size="compact" onClick={()=>void load(Boolean(entry.attempt?.conflict))}>参加案内を再読み込み</UiButton>}</>:<>
      <h3>{data.community.name}</h3><p>{data.community.description}</p>
      {data.rules.length>0&&<section aria-label="参加ルール"><h3>参加ルール</h3>{data.rules.map(r=><article key={r.id}><h4>{r.title}</h4><p className="meta">{r.required===1?'同意必須':'参考ルール'}</p><p>{r.body}</p></article>)}</section>}
      {(data.joined||data.pending||!data.viewerId||data.community.visibility==='private')&&data.questions.length>0&&<section aria-label="参加時の質問"><h3>参加時の質問</h3>{data.questions.map(q=><article key={q.id}><h4>{q.prompt}</h4><p className="meta">{q.required===1?'回答必須':'任意回答'}</p></article>)}</section>}
      {data.joined?<p>このコミュニティには参加済みです。</p>:data.pending?<p>参加申請は承認待ちです。追加の申請は送りません。</p>:!data.viewerId?<><p>参加するにはHubアカウントでログインしてください。</p><UiLinkButton size="compact" href={`/v2/auth?next=${encodeURIComponent(href)}`}>Hubにログイン</UiLinkButton></>:data.community.visibility==='private'?<p>このコミュニティは招待制です。通常の参加申請はできません。</p>:<form onSubmit={event=>{event.preventDefault();void join();}}>
        {required&&<UiCheckbox label="必須ルールを読み、同意します" checked={entry.accepted} disabled={locked} onChange={event=>{entry.accepted=event.target.checked;update();}}/>}
        {data.questions.map(q=><label className="community-join-controls__question" key={q.id}><strong>{q.prompt}</strong><span className="meta">{q.required===1?'回答必須':'任意回答'}</span><UiTextarea aria-label={`${q.prompt}（${q.required===1?'必須':'任意'}）`} maxLength={1000} rows={3} value={entry.answers[q.id]??''} disabled={locked} onChange={event=>{entry.answers[q.id]=event.target.value;update();}}/></label>)}
        <p>{data.community.visibility==='approval'?'回答と同意内容を送信し、参加を申請します。承認されるまで参加は確定しません。':'回答と同意内容を送信し、このコミュニティに参加します。'}</p>
        {entry.attempt?.conflict?<><p>参加条件を確認できませんでした。{entry.attempt.uncertain?'以前の保存結果は確定できません。':'今回の送信は拒否されました。'}最新の参加状態・ルールを確認して、同意と回答を入力し直します。自動で送信しません。</p><UiButton type="button" size="compact" disabled={busy} onClick={()=>void load(true)}>最新の参加案内を確認してやり直す</UiButton></>:<><UiButton type="submit" size="compact" pending={busy} disabled={busy||Boolean(required&&!entry.accepted)}>{entry.attempt?'同じ参加操作で結果を確認':data.community.visibility==='approval'?'同意と回答を送信して参加を申請':'同意と回答を送信して参加'}</UiButton>{entry.attempt&&<p>送信結果が不明の場合は、同じ回答・同意内容で結果を確認します。内容は変更できません。</p>}</>}
      </form>}
      {error&&<p role="alert">{error}</p>}
    </>}
  </section>;
}
