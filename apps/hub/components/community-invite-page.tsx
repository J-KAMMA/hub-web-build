'use client';

import React,{useEffect,useRef,useState} from 'react';
import {useParams,useRouter} from 'next/navigation';
import {UiButton,UiCheckbox,UiLinkButton,UiStatePanel,UiTextarea} from '@/components/ui/primitives';

type Rule={id:string;title:string;body:string;required:0|1};
type Question={id:string;prompt:string;required:0|1};
type Invite={community:{id:string;name:string;description:string};rules:Rule[];questions:Question[];snapshot:string;viewerId:string|null;joined:boolean};
type Payload={operationId:string;snapshot:string;acceptedRules:boolean;answers:ReadonlyArray<Readonly<{questionId:string;answer:string}>>};
type Operation={payload:Readonly<Payload>;communityId:string;actor:string;uncertain:boolean;conflict:boolean};
type Result={joined:boolean;alreadyJoined:boolean};
const id=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=100&&!/[^A-Za-z0-9_-]/.test(v);
const hex=(v:unknown,length:number):v is string=>typeof v==='string'&&v.length===length&&!/[^a-f0-9]/.test(v);
const uuid=(v:unknown):v is string=>typeof v==='string'&&v.length===36&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const safeText=(v:unknown):v is string=>typeof v==='string'&&!/[\ud800-\udfff]/u.test(v);
const storedText=(v:unknown,max:number,required=true):v is string=>safeText(v)&&v.length<=max*2&&Array.from(v).length<=max&&(!required||v.length>0);
const date=(v:unknown):v is string=>safeText(v)&&v.length>0&&v.length<=64&&!/[\x00-\x1f\x7f]/.test(v)&&Number.isFinite(Date.parse(v));
const invalid=():never=>{throw Error('招待情報を確認できませんでした。');};
const record=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:invalid();
function bounded(v:unknown){try{if(new TextEncoder().encode(JSON.stringify(v)).length>512*1024)invalid();}catch{invalid();}}
function parseInvite(value:unknown):Invite{
  bounded(value);const v=record(value),community=record(v.community);if(!id(community.id)||!storedText(community.name,100)||!storedText(community.description,2000,false)||!hex(v.snapshot,64)||!(v.viewerId===null||id(v.viewerId))||typeof v.joined!=='boolean'||(v.joined&&v.viewerId===null)||!Array.isArray(v.rules)||!Array.isArray(v.questions)||v.questions.length>20)invalid();
  const rules=(v.rules as unknown[]).map(value=>{const r=record(value);if(!id(r.id)||!storedText(r.title,80)||!storedText(r.body,1000)||(r.required!==0&&r.required!==1))invalid();return{id:r.id,title:r.title,body:r.body,required:r.required} as Rule;}),questions=(v.questions as unknown[]).map(value=>{const q=record(value);if(!id(q.id)||!storedText(q.prompt,200)||(q.required!==0&&q.required!==1))invalid();return{id:q.id,prompt:q.prompt,required:q.required} as Question;});
  if(new Set(rules.map(r=>r.id)).size!==rules.length||new Set(questions.map(q=>q.id)).size!==questions.length)invalid();return{community:{id:community.id,name:community.name,description:community.description},rules,questions,snapshot:v.snapshot,viewerId:v.viewerId,joined:v.joined} as Invite;
}
function parseResult(value:unknown,operation:Operation):Result{
  bounded(value);const v=record(value);if(v.communityId!==operation.communityId||typeof v.joined!=='boolean'||v.pending!==false||typeof v.alreadyJoined!=='boolean')invalid();
  if(v.receipt===null){if(!v.alreadyJoined||!v.joined)invalid();}
  else{const r=record(v.receipt);if(v.alreadyJoined!==false||!uuid(r.auditId)||r.auditId!==operation.payload.operationId||r.action!=='member_joined_invite'||r.targetId!==operation.communityId||!date(r.confirmedAt)||typeof r.replayed!=='boolean')invalid();}
  return{joined:v.joined,alreadyJoined:v.alreadyJoined} as Result;
}

export default function CommunityInvitePage(){
  const params=useParams<{code:string}>(),code=typeof params.code==='string'?params.code:'';
  return <InviteControls key={code} code={code}/>;
}
function InviteControls({code}:{code:string}){
  const router=useRouter(),[data,setData]=useState<Invite|null>(null),[accepted,setAccepted]=useState(false),[answers,setAnswers]=useState<Record<string,string>>({}),[error,setError]=useState(''),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[operation,setOperation]=useState<Operation|null>(null),[result,setResult]=useState<Result|null>(null),[authNeeded,setAuthNeeded]=useState(false);
  const mounted=useRef(false),generation=useRef(0),readEpoch=useRef(0),reader=useRef<AbortController|null>(null),writer=useRef<AbortController|null>(null),inFlight=useRef(false),held=useRef<Operation|null>(null),acknowledged=useRef<Result|null>(null);
  const endpoint=`/api/community-invites/${encodeURIComponent(code)}`,communityHref=data?`/v2/community?community=${encodeURIComponent(data.community.id)}`:'/v2/community',loginHref=`/v2/auth?next=${encodeURIComponent(`/v2/community/invite/${code}`)}`;
  const valid=(scope:number)=>mounted.current&&scope===generation.current;
  async function load(reset=false){
    if(!mounted.current||inFlight.current)return;const scope=generation.current,epoch=++readEpoch.current,controller=new AbortController();reader.current?.abort();reader.current=controller;setLoading(true);setError('');
    try{if(!hex(code,32))invalid();const response=await fetch(endpoint,{cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(20000)])}),value=await response.json();if(!valid(scope)||epoch!==readEpoch.current||controller.signal.aborted)return;if(!response.ok)throw Error(typeof value?.error==='string'?value.error:'招待情報を取得できませんでした。');const next=parseInvite(value);if(reset){held.current=null;acknowledged.current=null;setOperation(null);setResult(null);setAccepted(false);setAnswers({});}setData(next);setAuthNeeded(false);
    }catch(cause){if(valid(scope)&&epoch===readEpoch.current&&!controller.signal.aborted){setData(null);setError(cause instanceof Error?cause.message:'招待情報を取得できませんでした。');}}
    finally{if(valid(scope)&&epoch===readEpoch.current&&!controller.signal.aborted)setLoading(false);}
  }
  useEffect(()=>{mounted.current=true;const changed=()=>{generation.current++;readEpoch.current++;reader.current?.abort();writer.current?.abort();inFlight.current=false;held.current=null;acknowledged.current=null;setData(null);setAccepted(false);setAnswers({});setOperation(null);setResult(null);setBusy(false);setAuthNeeded(false);void load(true);};window.addEventListener('hub-account-changed',changed);void load(true);return()=>{mounted.current=false;generation.current++;readEpoch.current++;reader.current?.abort();writer.current?.abort();window.removeEventListener('hub-account-changed',changed);};},[code]);
  async function join(){
    if(!mounted.current||inFlight.current||loading||!data||!data.viewerId||data.joined||acknowledged.current||authNeeded)return;let fixed=held.current;
    if(fixed?.conflict)return;
    if(!fixed){
      const required=data.rules.some(rule=>rule.required===1);if(required&&!accepted){setError('必須ルールへの同意が必要です。');return;}
      const normalized=[];for(const question of data.questions){const raw=answers[question.id]??'';if(!safeText(raw)||raw.length>1000){setError('回答は1000文字以内で入力してください。');return;}const answer=raw.normalize('NFKC').trim();if(!safeText(answer)||answer.length>1000){setError('回答は1000文字以内で入力してください。');return;}if(!answer&&question.required===1){setError('必須の質問に回答してください。');return;}if(answer)normalized.push(Object.freeze({questionId:question.id,answer}));}
      fixed={payload:Object.freeze({operationId:crypto.randomUUID(),snapshot:data.snapshot,acceptedRules:required?accepted:true,answers:Object.freeze(normalized)}),communityId:data.community.id,actor:data.viewerId,uncertain:false,conflict:false};held.current=fixed;setOperation(fixed);
    }
    if(fixed.actor!==data.viewerId||fixed.communityId!==data.community.id)return;const scope=generation.current,controller=new AbortController();writer.current=controller;inFlight.current=true;setBusy(true);setError('');
    try{const response=await fetch(endpoint,{method:'POST',cache:'no-store',headers:{'content-type':'application/json'},signal:AbortSignal.any([controller.signal,AbortSignal.timeout(20000)]),body:JSON.stringify(fixed.payload)}),value=await response.json();if(!valid(scope)||controller.signal.aborted||held.current!==fixed)return;
      if(!response.ok){if([400,409].includes(response.status)){fixed.conflict=true;setOperation({...fixed});}else{fixed.uncertain=true;setOperation({...fixed});}if(response.status===401)setAuthNeeded(true);throw Error(typeof value?.error==='string'?value.error:'参加結果を確認できませんでした。同じ参加操作で再試行してください。');}
      const saved=parseResult(value,fixed);acknowledged.current=saved;setResult(saved);if(saved.joined){try{router.push(`/v2/community?community=${encodeURIComponent(fixed.communityId)}`);}catch{setError('参加は確認済みです。コミュニティを開いてください。');}}
    }catch(cause){if(valid(scope)&&!controller.signal.aborted&&held.current===fixed){if(!acknowledged.current&&!fixed.conflict){fixed.uncertain=true;setOperation({...fixed});}setError(cause instanceof Error?cause.message:'参加結果が不明です。同じ参加操作で確認してください。');}}
    finally{if(valid(scope)&&held.current===fixed){inFlight.current=false;setBusy(false);}}
  }
  const locked=Boolean(operation||busy),requiredRules=data?.rules.some(rule=>rule.required===1);
  return <section className="community-invite-page"><section>
    {loading&&<UiStatePanel state="loading" title="招待を確認しています"/>}
    {!loading&&!data&&<UiStatePanel state="error" title="招待を確認できませんでした" description={error||'通信状態を確認して、もう一度お試しください。'} action={<UiButton type="button" size="compact" disabled={busy} onClick={()=>void load(Boolean(operation?.conflict))}>再試行</UiButton>}/>}
    {!loading&&data&&<><h1>{data.community.name}</h1><p>{data.community.description}</p>
      {data.rules.length>0&&<section className="community-invite-page__rules" aria-label="参加ルール"><h2>参加ルール</h2>{data.rules.map((rule,index)=><article key={rule.id}><h3>{index+1}. {rule.title}</h3><p className="meta">{rule.required===1?'同意必須':'参考ルール'}</p><p>{rule.body}</p></article>)}</section>}
      {(data.viewerId===null||authNeeded||data.joined||result)&&data.questions.length>0&&<section className="community-invite-page__questions" aria-label="参加時の質問"><h2>参加時の質問</h2>{data.questions.map((question,index)=><article key={question.id}><h3>{index+1}. {question.prompt}</h3><p className="meta">{question.required===1?'回答必須':'任意回答'}</p></article>)}</section>}
      {data.joined?<><p>このコミュニティには参加済みです。招待の利用回数を増やさずに開けます。</p><UiLinkButton href={communityHref} size="compact">コミュニティを開く</UiLinkButton></>:result?<section aria-label="参加結果">{result.joined?<><p>参加を確認しました。同じ操作を再送しません。</p><UiLinkButton href={communityHref} size="compact">コミュニティを開く</UiLinkButton></>:<p>この参加操作は記録されていますが、現在は参加していません。同じ操作で再加入しません。</p>}</section>:data.viewerId===null||authNeeded?<><p>参加するにはHubアカウントでログインしてください。</p><UiLinkButton href={loginHref} size="compact">Hubにログイン</UiLinkButton></>:<form className="community-invite-page__form" onSubmit={event=>{event.preventDefault();void join();}}>
        {requiredRules&&<UiCheckbox label="必須ルールを読み、同意します" checked={accepted} disabled={locked} onChange={event=>setAccepted(event.target.checked)}/>}
        {data.questions.length>0&&<section className="community-invite-page__questions" aria-label="参加時の質問"><h2>参加時の質問</h2>{data.questions.map((question,index)=><label className="community-invite-page__question" key={question.id}><strong>{index+1}. {question.prompt}</strong><span className="meta">{question.required===1?'回答必須':'任意回答'}</span><UiTextarea aria-label={`${question.prompt}（${question.required===1?'必須':'任意'}）`} required={question.required===1} maxLength={1000} rows={3} value={answers[question.id]??''} disabled={locked} onChange={event=>setAnswers(previous=>({...previous,[question.id]:event.target.value}))}/></label>)}</section>}
        {operation?.uncertain&&<p className="meta">参加結果が不明です。回答と同意内容を変えずに、同じ参加操作の結果を確認してください。</p>}
        {operation?.conflict?<section aria-label="参加内容の再確認"><p>ルールや質問の内容、参加条件を再確認してください。{operation.uncertain?'以前の参加結果は確定できません。':''}最新の招待情報を読み込み、同意と回答を入力し直します。自動で参加しません。</p><UiButton type="button" size="compact" disabled={busy} onClick={()=>void load(true)}>最新のルールを確認してやり直す</UiButton></section>:<UiButton type="submit" size="compact" pending={busy} pendingLabel="参加結果を確認中…" disabled={busy||Boolean(requiredRules&&!accepted)}>{operation?.uncertain?'同じ参加操作で結果を確認':'コミュニティに参加'}</UiButton>}
      </form>}
      {error&&<UiStatePanel state="error" title="参加結果を確認できませんでした" description={error}/>}
    </>}
  </section></section>;
}
