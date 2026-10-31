'use client';

import React,{useEffect,useRef,useState} from 'react';
import {UiButton,UiCheckbox,UiInput,UiSelect} from '@/components/ui/primitives';

type Strategy='one_member_one_vote'|'token_weighted'|'token_capped';
type TokenRule={tokenId:string;tokenSymbol:string;tokensPerVote:number;weight:number};
export type CommunityGovernanceSettings={votingStrategy:Strategy;governanceTokenId:string|null;tokensPerVote:number;tokenRules:TokenRule[];voteWeightCap:number|null};
type Token={id:string;name:string;symbol:string};
type Catalog={community:{id:string;name:string;description:string;governanceMode:'dao'};viewerId:string;settings:CommunityGovernanceSettings;availableTokens:Token[];canEdit:boolean;snapshot:string};
type Draft={strategy:Strategy;rules:{tokenId:string;tokensPerVote:string;weight:string}[];cap:string};
type Payload={operationId:string;snapshot:string;votingStrategy:Strategy;tokenRules:{tokenId:string;tokensPerVote:number;weight:number}[];voteWeightCap:number|null};
type Attempt={payload:Payload;actor:string;sent:boolean;uncertain:boolean;conflict:boolean};
type Saved={settings?:CommunityGovernanceSettings;different:boolean};
type Entry={data?:Catalog;draft?:Draft;attempt?:Attempt;saved?:Saved};
export type CommunityGovernanceSettingsMemory=Map<string,Entry>;
type Props={communityId:string;actorId?:string;memory?:CommunityGovernanceSettingsMemory;onSaved?:(settings:CommunityGovernanceSettings)=>void|Promise<void>;onClose?:()=>void};
const names:Record<Strategy,string>={one_member_one_vote:'1メンバー1票',token_weighted:'トークン保有量比例',token_capped:'トークン保有量比例＋上限'};
const id=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=100&&!/[^A-Za-z0-9_-]/.test(v);
const text=(v:unknown):v is string=>typeof v==='string'&&!/[\ud800-\udfff]/u.test(v);
const stored=(v:unknown,max:number,min=1):v is string=>text(v)&&v.length<=max*2&&Array.from(v).length>=min&&Array.from(v).length<=max;
const hex=(v:unknown):v is string=>typeof v==='string'&&v.length===64&&!/[^a-f0-9]/.test(v);
const uuid=(v:unknown):v is string=>typeof v==='string'&&v.length===36&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const positive=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>0&&v<=Number.MAX_SAFE_INTEGER;
const cap=(v:unknown):v is number|null=>v===null||(typeof v==='number'&&Number.isSafeInteger(v)&&v>=1);
const date=(v:unknown):v is string=>text(v)&&v.length>0&&v.length<=64&&!/[\x00-\x1f\x7f]/.test(v)&&Number.isFinite(Date.parse(v));
const invalid=():never=>{throw Error('投票設定を確認できませんでした。');};
const object=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:invalid();
function bounded(v:unknown){if(new TextEncoder().encode(JSON.stringify(v)).length>512*1024)invalid();}
function settings(value:unknown):CommunityGovernanceSettings{
  const v=object(value);if(!Object.hasOwn(names,String(v.votingStrategy))||!(v.governanceTokenId===null||id(v.governanceTokenId))||!positive(v.tokensPerVote)||!cap(v.voteWeightCap)||!Array.isArray(v.tokenRules)||v.tokenRules.length>100)invalid();
  const rules=(v.tokenRules as unknown[]).map(value=>{const r=object(value);if(!id(r.tokenId)||!stored(r.tokenSymbol,16)||!positive(r.tokensPerVote)||!positive(r.weight)||r.weight>1000)invalid();return{tokenId:r.tokenId,tokenSymbol:r.tokenSymbol,tokensPerVote:r.tokensPerVote,weight:r.weight} as TokenRule;});
  const strategy=v.votingStrategy as Strategy;if(new Set(rules.map(r=>r.tokenId)).size!==rules.length||(strategy==='one_member_one_vote'&&(rules.length>0||v.voteWeightCap!==null))||(strategy!=='one_member_one_vote'&&rules.length===0)||(strategy==='token_weighted'&&v.voteWeightCap!==null)||(strategy==='token_capped'&&v.voteWeightCap===null))invalid();
  return{votingStrategy:strategy,governanceTokenId:v.governanceTokenId,tokensPerVote:v.tokensPerVote,tokenRules:rules,voteWeightCap:v.voteWeightCap} as CommunityGovernanceSettings;
}
function catalog(value:unknown,cid:string):Catalog{
  bounded(value);const v=object(value),c=object(v.community);if(c.id!==cid||!id(c.id)||!stored(c.name,100)||!stored(c.description,2000,0)||c.governanceMode!=='dao'||!id(v.viewerId)||typeof v.canEdit!=='boolean'||!hex(v.snapshot)||!Array.isArray(v.availableTokens)||v.availableTokens.length>100)invalid();
  const availableTokens=(v.availableTokens as unknown[]).map(value=>{const t=object(value);if(!id(t.id)||!stored(t.name,80)||!stored(t.symbol,16))invalid();return{id:t.id,name:t.name,symbol:t.symbol} as Token;});if(new Set(availableTokens.map(t=>t.id)).size!==availableTokens.length)invalid();
  return{community:{id:c.id,name:c.name,description:c.description,governanceMode:'dao'},viewerId:v.viewerId,canEdit:v.canEdit,snapshot:v.snapshot,settings:settings(v.settings),availableTokens} as Catalog;
}
const matches=(a:CommunityGovernanceSettings,p:Payload)=>a.votingStrategy===p.votingStrategy&&a.voteWeightCap===p.voteWeightCap&&a.tokenRules.length===p.tokenRules.length&&a.tokenRules.every(r=>p.tokenRules.some(w=>w.tokenId===r.tokenId&&w.tokensPerVote===r.tokensPerVote&&w.weight===r.weight));
function acknowledgement(value:unknown,cid:string,attempt:Attempt):Saved{
  bounded(value);const v=object(value),r=object(v.receipt);if(v.communityId!==cid||!uuid(r.auditId)||r.auditId!==attempt.payload.operationId||r.action!=='governance_settings_updated'||r.targetId!==cid||!date(r.confirmedAt)||typeof r.replayed!=='boolean')invalid();const current=settings(v.settings);return{settings:current,different:!matches(current,attempt.payload)};
}
const draftOf=(s:CommunityGovernanceSettings):Draft=>({strategy:s.votingStrategy,rules:s.tokenRules.map(r=>({tokenId:r.tokenId,tokensPerVote:String(r.tokensPerVote),weight:String(r.weight)})),cap:String(s.voteWeightCap??100)});
export function CommunityGovernanceSettingsControls(props:Props){
  const owned=useRef<CommunityGovernanceSettingsMemory>(new Map()),memory=props.memory??owned.current,identity=useRef({actor:props.actorId,memory,version:0});
  if(identity.current.actor!==props.actorId||identity.current.memory!==memory){memory.clear();identity.current={actor:props.actorId,memory,version:identity.current.version+1};}
  return <SettingsControls key={JSON.stringify([props.communityId,props.actorId??null,identity.current.version])} {...props} memory={memory}/>;
}
function SettingsControls({communityId,actorId,memory,onSaved,onClose}:Props&{memory:CommunityGovernanceSettingsMemory}){
  const key=JSON.stringify([communityId,actorId??null]),[entry]=useState(()=>{if(!memory.has(key))memory.set(key,{});return memory.get(key)!;}),[loading,setLoading]=useState(true),[readReady,setReadReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[refreshError,setRefreshError]=useState(false),[,rerender]=useState(0);
  const mounted=useRef(false),generation=useRef(0),epoch=useRef(0),reading=useRef<AbortController|null>(null),writing=useRef<AbortController|null>(null),sending=useRef(false),savedCallback=useRef(onSaved);savedCallback.current=onSaved;
  const valid=(g:number)=>mounted.current&&generation.current===g&&memory.get(key)===entry,update=()=>rerender(n=>n+1),endpoint=`/api/communities/${encodeURIComponent(communityId)}/governance/settings`;
  function invalidate(){generation.current++;epoch.current++;reading.current?.abort();writing.current?.abort();memory.clear();delete entry.data;delete entry.draft;delete entry.attempt;delete entry.saved;sending.current=false;setLoading(false);setReadReady(false);setBusy(false);setError('アカウントが変わりました。投票設定を閉じて開き直してください。');update();}
  async function load(reset=false){
    if(!mounted.current||sending.current)return;const g=generation.current,e=++epoch.current,controller=new AbortController();reading.current?.abort();reading.current=controller;setLoading(true);setError('');
    try{if(!id(communityId))invalid();const response=await fetch(endpoint,{cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(20000)])}),value=await response.json();if(!valid(g)||e!==epoch.current||controller.signal.aborted)return;if(!response.ok){if([401,403,404].includes(response.status)){delete entry.data;delete entry.draft;if(entry.saved)delete entry.saved.settings;update();}throw Error(text(value?.error)?value.error:'現在の投票設定を取得できませんでした。');}const next=catalog(value,communityId);if((actorId!==undefined&&next.viewerId!==actorId)||(entry.attempt&&next.viewerId!==entry.attempt.actor)){invalidate();return;}entry.data=next;if(reset){delete entry.attempt;delete entry.saved;entry.draft=draftOf(next.settings);}else entry.draft??=draftOf(next.settings);setReadReady(true);update();
    }catch(cause){if(valid(g)&&e===epoch.current&&!controller.signal.aborted){setReadReady(false);setError(cause instanceof Error?cause.message:'投票設定を取得できませんでした。');}}
    finally{if(valid(g)&&e===epoch.current&&!controller.signal.aborted)setLoading(false);}
  }
  useEffect(()=>{mounted.current=true;window.addEventListener('hub-account-changed',invalidate);void load();return()=>{mounted.current=false;generation.current++;epoch.current++;reading.current?.abort();writing.current?.abort();window.removeEventListener('hub-account-changed',invalidate);};},[communityId,actorId,memory]);
  function preview(){
    if(!valid(generation.current)||loading||!readReady||busy||!entry.data?.canEdit||!entry.draft||entry.attempt||entry.saved)return;const draft=entry.draft;
    const rules=draft.strategy==='one_member_one_vote'?[]:draft.rules.map(r=>({tokenId:r.tokenId,tokensPerVote:Number(r.tokensPerVote),weight:Number(r.weight)})),limit=draft.strategy==='token_capped'?Number(draft.cap):null;
    if(!Object.hasOwn(names,draft.strategy)||rules.length>100||new Set(rules.map(r=>r.tokenId)).size!==rules.length||rules.some(r=>!id(r.tokenId)||!positive(r.tokensPerVote)||!positive(r.weight)||r.weight>1000)||(draft.strategy!=='one_member_one_vote'&&rules.length===0)||!cap(limit)||(draft.strategy==='token_capped'&&limit===null)){setError('投票トークン、正の換算値と1000以下の倍率、整数の上限を確認してください。');return;}
    entry.attempt={payload:{operationId:crypto.randomUUID(),snapshot:entry.data.snapshot,votingStrategy:draft.strategy,tokenRules:rules,voteWeightCap:limit},actor:entry.data.viewerId,sent:false,uncertain:false,conflict:false};setError('');update();
  }
  async function sync(settings:CommunityGovernanceSettings,g=generation.current){if(!valid(g))return;setRefreshError(false);try{await savedCallback.current?.(settings);}catch{if(valid(g))setRefreshError(true);}}
  async function save(){
    const attempt=entry.attempt;if(!valid(generation.current)||sending.current||loading||!readReady||!attempt||attempt.conflict||entry.saved||!entry.data?.canEdit||entry.data.viewerId!==attempt.actor)return;
    const wasUncertain=attempt.uncertain,g=generation.current,controller=new AbortController();writing.current=controller;attempt.sent=true;attempt.uncertain=true;sending.current=true;setBusy(true);setError('');update();
    try{const response=await fetch(endpoint,{method:'PATCH',cache:'no-store',headers:{'content-type':'application/json'},signal:AbortSignal.any([controller.signal,AbortSignal.timeout(20000)]),body:JSON.stringify(attempt.payload)}),value=await response.json();if(!valid(g)||controller.signal.aborted||entry.attempt!==attempt)return;
      if(!response.ok){if([400,401,403,404,409,413].includes(response.status)){attempt.conflict=true;attempt.uncertain=wasUncertain;}if([401,403,404].includes(response.status)){delete entry.data;delete entry.draft;}update();throw Error(text(value?.error)?value.error:'保存結果を確認できませんでした。同じ設定で再試行してください。');}const saved=acknowledgement(value,communityId,attempt);entry.saved=saved;entry.data.settings=saved.settings!;delete entry.draft;update();await sync(saved.settings!,g);
    }catch(cause){if(valid(g)&&!controller.signal.aborted&&entry.attempt===attempt){setError(cause instanceof Error?cause.message:'保存結果が不明です。同じ設定で確認してください。');update();}}
    finally{if(valid(g)&&entry.attempt===attempt){sending.current=false;setBusy(false);}}
  }
  const data=entry.data,draft=entry.draft,attempt=entry.attempt,saved=entry.saved,locked=loading||!readReady||busy||Boolean(attempt)||Boolean(saved)||!data?.canEdit;
  const tokens=data?[...data.availableTokens,...data.settings.tokenRules.filter(r=>!data.availableTokens.some(t=>t.id===r.tokenId)).map(r=>({id:r.tokenId,name:'登録一覧にない設定済みトークン',symbol:r.tokenSymbol}))]:[];
  function describe(value:Pick<CommunityGovernanceSettings,'votingStrategy'|'tokenRules'|'voteWeightCap'>|Payload){return <><p>投票方式：{names[value.votingStrategy]}</p>{value.tokenRules.length>0&&<ul>{value.tokenRules.map(r=><li key={r.tokenId}>{tokens.find(t=>t.id===r.tokenId)?.symbol??('tokenSymbol'in r?r.tokenSymbol:'設定済みトークン')}：{r.tokensPerVote}枚ごとに{r.weight}点</li>)}</ul>}<p>1人あたりの上限：{value.voteWeightCap===null?'上限なし':`${value.voteWeightCap}票`}</p></>;}
  return <section className="community-governance-settings-controls" aria-label="DAO投票設定"><header><h3>DAO投票設定</h3><p>変更は新しく作る提案から適用されます。既存の提案・投票には反映しません。</p></header>
    {loading&&<p role="status">現在の投票設定を確認しています…</p>}
    {saved?<section aria-label="設定の保存結果"><p>投票設定の保存を確認しました。同じ操作を再送しません。</p>{saved.different&&<p>保存操作は記録されていますが、現在の設定は確認時と異なります。以前の設定を再適用しません。</p>}{data?describe(data.settings):saved.settings?describe(saved.settings):null}{refreshError&&<><p role="status">設定は保存済みですが、画面の更新を確認できませんでした。</p>{saved.settings&&<UiButton type="button" size="compact" disabled={busy} onClick={()=>void sync(saved.settings!)}>表示を更新する</UiButton>}</>}<UiButton type="button" size="compact" disabled={busy||loading} onClick={()=>void load(true)}>現在の設定を読み直す</UiButton></section>:data&&draft?<>
      <h4>{data.community.name}</h4><section aria-label="現在の投票設定">{describe(data.settings)}</section>{!data.canEdit&&<p>投票設定を変更できるのはコミュニティの所有者だけです。</p>}
      {attempt?<section aria-label="投票設定の確認"><h4>変更内容を確認</h4><p>対象：{data.community.name}</p>{describe(attempt.payload)}<p>これから作る提案にこの設定を使用します。</p>{attempt.conflict?<><p>保存条件が確認できませんでした。{attempt.uncertain?'以前の保存結果は確定できません。':'今回の変更は拒否されました。'}現在の設定を読み直して、新しい変更内容を確認してください。自動で保存しません。</p><UiButton type="button" size="compact" disabled={busy||loading} onClick={()=>void load(true)}>最新の設定を確認してやり直す</UiButton></>:<><UiButton type="button" size="compact" disabled={busy||loading||!readReady||!data.canEdit} pending={busy} onClick={()=>void save()}>{attempt.sent?'同じ設定の保存結果を確認':'確認して設定を保存'}</UiButton>{!attempt.sent&&<UiButton type="button" size="compact" onClick={()=>{delete entry.attempt;update();}}>編集に戻る</UiButton>}{attempt.sent&&<p>送信した設定と操作を固定しています。結果が確認できるまで内容を変更できません。</p>}</>}</section>:<form onSubmit={event=>{event.preventDefault();preview();}}><label className="community-governance-settings-controls__field"><span>投票方式</span><UiSelect aria-label="投票方式" value={draft.strategy} disabled={locked} onChange={event=>{draft.strategy=event.target.value as Strategy;update();}}>{Object.entries(names).map(([value,label])=><option value={value} key={value}>{label}</option>)}</UiSelect></label>
        {draft.strategy!=='one_member_one_vote'&&<section className="community-governance-token-rules" aria-label="投票トークンと重み"><h4>投票トークンと重み</h4><p>選択した各トークンの点を合算します。</p>{tokens.map(token=>{const rule=draft.rules.find(r=>r.tokenId===token.id);return <article key={token.id}><UiCheckbox label={`${token.symbol} ${token.name}`} checked={Boolean(rule)} disabled={locked} onChange={event=>{draft.rules=event.target.checked?[...draft.rules,{tokenId:token.id,tokensPerVote:'1',weight:'1'}]:draft.rules.filter(r=>r.tokenId!==token.id);update();}}/>{rule&&<div className="community-governance-settings-controls__numbers"><label className="community-governance-settings-controls__field"><span>基準保有量</span><UiInput aria-label={`基準保有量（${token.symbol}）`} type="number" min="0" step="any" max={Number.MAX_SAFE_INTEGER} value={rule.tokensPerVote} disabled={locked} onChange={event=>{rule.tokensPerVote=event.target.value;update();}}/></label><label className="community-governance-settings-controls__field"><span>倍率</span><UiInput aria-label={`倍率（${token.symbol}）`} type="number" min="0" max="1000" step="any" value={rule.weight} disabled={locked} onChange={event=>{rule.weight=event.target.value;update();}}/></label><p>{rule.tokensPerVote} {token.symbol} = {rule.weight}点</p></div>}</article>;})}{tokens.length===0&&<p>先にコミュニティへトークンを登録してください。</p>}</section>}
        {draft.strategy==='token_capped'&&<label className="community-governance-settings-controls__field"><span>1人あたりの最大票数</span><UiInput aria-label="1人あたりの最大票数" type="number" min="1" max={Number.MAX_SAFE_INTEGER} step="1" value={draft.cap} disabled={locked} onChange={event=>{draft.cap=event.target.value;update();}}/></label>}<UiButton type="submit" size="compact" disabled={locked}>変更内容を確認</UiButton></form>}
    </>:!loading&&<UiButton type="button" size="compact" disabled={!valid(generation.current)||busy} onClick={()=>void load(Boolean(attempt?.conflict))}>投票設定を再読み込み</UiButton>}
    {error&&<p role="alert">{saved?'設定は保存済みです。':''}{error}</p>}
    {error&&!saved&&data&&<UiButton type="button" size="compact" disabled={busy||loading} onClick={()=>void load(Boolean(attempt?.conflict))}>投票設定を再読み込み</UiButton>}
    {onClose&&<UiButton type="button" size="compact" disabled={busy} onClick={onClose}>閉じる</UiButton>}
  </section>;
}
