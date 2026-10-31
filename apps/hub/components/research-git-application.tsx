'use client';
import React,{useEffect,useRef,useState} from 'react';
import {UiButton} from './ui/primitives';
import type {GitProposalReview} from '@/lib/research-git-proposals';
import {parseGitApplicationPlan,parseGitApplicationResult,type GitApplicationPlan,type GitApplicationResult} from '@/lib/research-git-application';
export type GitApplicationEntry={plan?:GitApplicationPlan;branch?:string;confirm?:boolean;sent?:boolean;busy?:boolean;result?:GitApplicationResult;error?:string};
export function ResearchGitApplication({projectId,review,memory}:{projectId:string;review:GitProposalReview;memory:Map<string,GitApplicationEntry>}){
 const id=review.proposal.id,[entry]=useState(()=>{const value=memory.get(id)??{};memory.set(id,value);return value;}),[,render]=useState(0),life=useRef(0),mounted=useRef(false);
 useEffect(()=>{mounted.current=true;life.current++;return()=>{mounted.current=false;life.current++;};},[review.snapshot,review.canManage,review.proposal.status]);
 const sync=()=>{if(mounted.current)render(value=>value+1);},valid=()=>review.canManage&&review.proposal.status==='approved',endpoint=`/api/research/projects/${encodeURIComponent(projectId)}/git/application`;
 async function run(action:'preview'|'apply'|'check'){
  if(!valid()||entry.busy||action!=='check'&&entry.sent||action==='apply'&&!entry.confirm||action!=='preview'&&(!entry.plan||!entry.branch))return;
  const token=life.current,identity=entry.plan?{...entry.plan,snapshot:review.snapshot}:undefined,branch=entry.branch;
  if(identity&&(identity.baseOid!==review.proposal.baseOid||identity.headOid!==review.proposal.headOid))return;
  const body=action==='preview'?{action,proposalId:id,snapshot:review.snapshot}:{action,proposalId:id,snapshot:identity!.snapshot,comparisonHash:identity!.comparisonHash,branch,...(action==='apply'?{confirmed:true}:{})};
  entry.busy=true;entry.error='';if(action==='apply'){entry.sent=true;delete entry.result;}sync();
  try{
   const response=await fetch(endpoint,{method:'POST',cache:'no-store',signal:AbortSignal.timeout(60000),headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),value=await response.json();if(!response.ok)throw Error(typeof value.error==='string'?value.error:'Gitの結果を確認できません。');
   if(action==='preview'){const plan=parseGitApplicationPlan(value,projectId,id);if(plan.snapshot!==review.snapshot||plan.baseOid!==review.proposal.baseOid||plan.headOid!==review.proposal.headOid||plan.comparisonHash!==review.comparisonHash)throw Error('確認した提案と反映先が一致しません。');if(mounted.current&&life.current===token){entry.plan=plan;entry.branch='';entry.confirm=false;delete entry.result;}}
   else{const result=parseGitApplicationResult(value,identity!,branch!,action==='check');if(mounted.current&&life.current===token){entry.result=result;entry.sent=false;entry.confirm=false;}}
  }catch(error){if(mounted.current&&life.current===token)entry.error=error instanceof Error?error.message:'Gitの結果を確認できません。';}
  finally{entry.busy=false;sync();}
 }
 const selected=entry.plan?.branches.find(value=>value.branch===entry.branch),currentPlan=entry.plan?.snapshot===review.snapshot,canApply=currentPlan&&selected?.oid===entry.plan?.baseOid&&!entry.sent&&!entry.result;
 return <section aria-label="Gitブランチへの反映" style={{minWidth:0,overflowWrap:'anywhere',display:'grid',gridTemplateColumns:'minmax(0,1fr)',justifyItems:'start',gap:8}}><h5>ブランチへ反映</h5>
  <p>承認した変更を、選んだブランチへ反映します。先端が基準版と異なる場合は更新しません。</p>
  {entry.error?<p role="alert">{entry.error}</p>:null}
  {entry.sent?<p role="status">反映結果は未確認です。反映を再送せず、同じブランチの現在状態を確認してください。</p>:null}
  {entry.result?<p role="status">{entry.result.outcome==='not_included'?'確認時点では、この変更はブランチに含まれていません。再度反映先を確認してから操作してください。':'確認時点で、この変更はブランチに含まれています。'} <strong>{entry.result.branch}</strong> · <code style={{overflowWrap:'anywhere'}}>{entry.result.currentOid}</code></p>:null}
  {!entry.sent?<UiButton type="button" size="compact" pending={entry.busy} disabled={!valid()||!review.comparison} onClick={()=>void run('preview')}>反映先を確認</UiButton>:null}
  {entry.plan?<><label style={{width:'100%',minWidth:0}}>反映先ブランチ <select aria-label="反映先ブランチ" value={entry.branch??''} disabled={entry.busy||entry.sent} onChange={event=>{entry.branch=event.target.value;entry.confirm=false;delete entry.result;sync();}} style={{width:'100%',minWidth:0,maxWidth:'100%'}}><option value="">選択してください</option>{entry.plan.branches.map(value=><option key={value.branch} value={value.branch}>{value.branch}{value.oid===entry.plan?.baseOid?'（基準版）':''}</option>)}</select></label>
   {selected?<p style={{overflowWrap:'anywhere'}}>現在の先端 <code>{selected.oid}</code><br/>基準 <code>{entry.plan.baseOid}</code> → 変更後 <code>{entry.plan.headOid}</code></p>:null}
   {entry.branch?<UiButton type="button" size="compact" pending={entry.busy} disabled={!valid()} onClick={()=>void run('check')}>このブランチの反映状態を確認</UiButton>:null}
   {canApply&&!entry.confirm?<UiButton type="button" size="compact" disabled={entry.busy||!valid()} onClick={()=>{entry.confirm=true;sync();}}>このブランチへ反映する</UiButton>:null}
   {entry.confirm&&canApply?<section aria-label="Git反映の確定確認"><p><strong>{entry.branch}</strong> を上の基準版から変更後の版へ進めます。</p><UiButton type="button" size="compact" pending={entry.busy} disabled={!valid()} onClick={()=>void run('apply')}>確認してGitへ反映</UiButton><UiButton type="button" size="compact" disabled={entry.busy} onClick={()=>{entry.confirm=false;sync();}}>戻る</UiButton></section>:null}
   {entry.branch&&!canApply&&!entry.sent?<p>先端や提案の状態が変わっている場合は、反映先を読み直してください。</p>:null}
   {!entry.plan.branches.length?<p>反映先のブランチがありません。Gitで最初のブランチをpushしてください。</p>:null}
  </>:null}
 </section>;
}
