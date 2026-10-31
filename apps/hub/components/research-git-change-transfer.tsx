'use client';

import React,{useEffect,useRef,useState} from 'react';
import {UiButton,UiField,UiInput,UiTextarea} from './ui/primitives';
import {P2PTransferPanel} from './p2p-transfer-panel';
import {PAIRING_RELAY_ORIGIN} from '@/lib/p2p-pairing.mjs';
import {parseResearchGitCommitDetail,type ResearchGitCommitDetail} from '@/lib/research-git-browse';
import {RESEARCH_GIT_CHANGE_BYTES,createResearchGitChangePackage,readResearchGitChangeFile,parseResearchGitChangeTarget,type ResearchGitChangePackage} from '@/lib/research-git-change-package';

const wrap:React.CSSProperties={minWidth:0,overflowWrap:'anywhere'};
type ExportProps={comparison:ResearchGitCommitDetail;title?:string;summary?:string};
type ImportProps={projectId:string;signedIn:boolean;onImport:(value:{comparison:ResearchGitCommitDetail;title:string;summary:string})=>void|Promise<void>};
function useAccountEpoch(){const [epoch,setEpoch]=useState(0);useEffect(()=>{const reset=()=>setEpoch(value=>value+1);window.addEventListener('hub-account-changed',reset);return()=>window.removeEventListener('hub-account-changed',reset);},[]);return epoch;}
function useLife(){
  const life=useRef({mounted:true,generation:0,busy:false,controller:null as AbortController|null});
  useEffect(()=>{const reset=()=>{life.current.generation++;life.current.busy=false;life.current.controller?.abort();};life.current.mounted=true;window.addEventListener('hub-account-changed',reset);return()=>{life.current.mounted=false;reset();window.removeEventListener('hub-account-changed',reset);};},[]);
  return life;
}
function PackagePreview({value}:{value:ResearchGitChangePackage}){return <section aria-label="受渡し内容の確認" style={wrap}><p>受信先: <code>{value.target.origin}/v2/research/{value.target.projectId}</code></p><p>基準 <code>{value.baseOid}</code> → 変更後 <code>{value.headOid}</code></p><h4>{value.title}</h4><p style={{whiteSpace:'pre-wrap'}}>{value.summary}</p><p>内容ハッシュ: <code>{value.contentHash}</code></p><p>ハッシュは内容の照合用です。送付者・出自・承認権限を証明しません。Gitオブジェクト・プロフィール・提案ID・承認状態は含みません。</p></section>;}

export function ResearchGitChangeExport(props:ExportProps){const epoch=useAccountEpoch();return <ExportScope key={JSON.stringify([epoch,props.comparison,props.title,props.summary])} {...props}/>;}
function ExportScope({comparison,title='',summary=''}:ExportProps){
  const [target,setTarget]=useState(''),[draftTitle,setTitle]=useState(title),[draftSummary,setSummary]=useState(summary),[preview,setPreview]=useState<ResearchGitChangePackage|null>(null),[file,setFile]=useState<File|null>(null),[download,setDownload]=useState(''),[peer,setPeer]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const life=useLife();
  useEffect(()=>{if(!file){setDownload('');return;}const url=URL.createObjectURL(file);setDownload(url);return()=>URL.revokeObjectURL(url);},[file]);
  async function prepare(){
    if(life.current.busy)return;life.current.busy=true;setBusy(true);setError('');const token=life.current.generation;
    try{const value=await createResearchGitChangePackage({protocol:'hub.research-git-change.v1',target:parseResearchGitChangeTarget(target),baseOid:comparison.baseOid!,headOid:comparison.commit.oid,title:draftTitle,summary:draftSummary});if(life.current.mounted&&token===life.current.generation)setPreview(value);}
    catch(e){if(life.current.mounted&&token===life.current.generation)setError(e instanceof Error?e.message:'受渡し内容を準備できません。');}
    finally{if(life.current.mounted&&token===life.current.generation){life.current.busy=false;setBusy(false);}}
  }
  return <section aria-label="Git変更の持出し" style={wrap}><h4>別のHubへ提案内容を渡す</h4><p>題・変更の理由・固定した二版をJSONファイルで渡します。提案理由は本人と現在の所有者に限定された内容です。受信先に開示してよい内容か、持出し前に確認してください。</p>
    {error?<p role="alert">{error}</p>:null}
    {preview?<><PackagePreview value={preview}/>{!file?<UiButton type="button" size="compact" onClick={()=>{if(life.current.mounted)setFile(new File([JSON.stringify(preview)],'git-change.json',{type:'application/json'}));}}>確認して受渡しファイルを作る</UiButton>:<><p>この内容の持出しを確認しました。保存または接続を選んでください。</p>{download?<a href={download} download="git-change.json">確認したJSONファイルを保存</a>:null}<UiButton type="button" size="compact" aria-expanded={peer} onClick={()=>setPeer(value=>!value)}>{peer?'P2P接続を閉じる':'確認した内容をP2Pで渡す'}</UiButton>{peer?<P2PTransferPanel pairOrigin={PAIRING_RELAY_ORIGIN} embedded allowRelaySelection sendFile={file} invitationUrl={`${preview.target.origin}/v2/research/${preview.target.projectId}`} maxFileBytes={RESEARCH_GIT_CHANGE_BYTES}/>:null}</>}
      <UiButton type="button" size="compact" onClick={()=>{setPeer(false);setFile(null);setPreview(null);}}>内容の入力へ戻る</UiButton>
    </>:<><UiField label="受信先HubのプロジェクトURL"><UiInput aria-label="受信先HubのプロジェクトURL" value={target} disabled={busy} onChange={e=>setTarget(e.target.value)} placeholder="https://hub.example/v2/research/rp_…" spellCheck={false}/></UiField><UiField label="受渡しする提案の題"><UiInput aria-label="受渡しする提案の題" value={draftTitle} disabled={busy} maxLength={240} onChange={e=>setTitle(e.target.value)}/></UiField><UiField label="受渡しする変更の理由"><UiTextarea aria-label="受渡しする変更の理由" value={draftSummary} disabled={busy} maxLength={500} rows={3} onChange={e=>setSummary(e.target.value)}/></UiField><UiButton type="button" size="compact" pending={busy} onClick={()=>void prepare()}>受渡し内容を確認</UiButton></>}
  </section>;
}

export function ResearchGitChangeImport(props:ImportProps){const epoch=useAccountEpoch();return <ImportScope key={JSON.stringify([epoch,props.projectId])} {...props}/>;}
function ImportScope({projectId,signedIn,onImport}:ImportProps){
  const [staged,setStaged]=useState<ResearchGitChangePackage|null>(null),[peer,setPeer]=useState(false),[peerGeneration,setPeerGeneration]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState(''),[imported,setImported]=useState(false),life=useLife();
  const current=useRef({signedIn,onImport}),peerLife=useRef(0);current.current={signedIn,onImport};
  useEffect(()=>{life.current.generation++;life.current.busy=false;life.current.controller?.abort();peerLife.current++;setBusy(false);setPeer(false);setStaged(null);setError('');setImported(false);},[signedIn,life]);
  useEffect(()=>{const invitation=()=>{if(!new URLSearchParams(window.location.search).has('gitBundle')&&current.current.signedIn&&window.location.hash.startsWith('#pair=')){peerLife.current++;setPeerGeneration(value=>value+1);setPeer(true);}};invitation();window.addEventListener('hashchange',invitation);return()=>window.removeEventListener('hashchange',invitation);},[]);
  const peerToken=peerLife.current;
  const active=(token:number)=>life.current.mounted&&token===life.current.generation;
  async function stage(file:File,p2pToken?:number){
    if(!life.current.mounted||life.current.busy||p2pToken!==undefined&&(!current.current.signedIn||p2pToken!==peerLife.current))return;const token=life.current.generation;life.current.busy=true;setBusy(true);setError('');setStaged(null);setImported(false);
    try{const value=await readResearchGitChangeFile(file);if(active(token)&&(p2pToken===undefined||current.current.signedIn&&p2pToken===peerLife.current))setStaged(value);}
    catch(e){if(active(token))setError(e instanceof Error?e.message:'受信ファイルを確認できません。');}
    finally{if(active(token)){life.current.busy=false;setBusy(false);}}
  }
  async function importDraft(){
    if(!staged||!current.current.signedIn||life.current.busy)return;const token=life.current.generation;life.current.busy=true;setBusy(true);setError('');setImported(false);const controller=new AbortController();life.current.controller=controller;
    try{
      if(staged.target.origin!==window.location.origin||staged.target.projectId!==projectId)throw Error('受信先がこのHub・プロジェクトと一致しません。指定された受信先でファイルを開いてください。');
      const response=await fetch(`/api/research/projects/${encodeURIComponent(projectId)}/git/browse?commit=${staged.headOid}&base=${staged.baseOid}`,{cache:'no-store',credentials:'omit',redirect:'error',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(20000)])});
      if(!response.ok)throw Error('受信Hubで公開された二版を取得できません。Git bundleから別の候補ブランチへpushし、両コミットを公開してから再試行してください。反映先ブランチは基準版のまま保持してください。');
      const comparison=parseResearchGitCommitDetail(await response.json(),projectId,staged.headOid,staged.baseOid);
      if(!active(token)||!current.current.signedIn)return;
      await current.current.onImport({comparison,title:staged.title,summary:staged.summary});if(active(token)&&current.current.signedIn)setImported(true);
    }catch(e){if(active(token)&&current.current.signedIn)setError(e instanceof Error&&e.message!=='invalid_git_response'?e.message:'受信Hubの比較応答が固定した二版と一致しません。両コミットが公開されているか確認してください。');}
    finally{if(active(token)){life.current.busy=false;life.current.controller=null;setBusy(false);}}
  }
  return <section aria-label="Git変更の受信" style={wrap}><h4>受け取った提案内容を確認する</h4><p>JSONにはGitオブジェクトは含まれません。受信だけでは既存の下書き・提案・Gitを書き換えません。取込み時にこのHubの公開された二版を確認します。</p>
    <UiField label="受渡しJSONファイル"><UiInput type="file" aria-label="受渡しJSONファイル" accept=".json,application/json" disabled={busy} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void stage(file);}}/></UiField>
    {!signedIn?<p>ログインして比較の取得と提案フォームへの取込みを行ってください。アカウントが変わると未保存の受信内容を消去します。</p>:<><UiButton type="button" size="compact" aria-expanded={peer} onClick={()=>{if(new URLSearchParams(window.location.search).has('gitBundle')&&window.location.hash.startsWith('#pair=')){setError('履歴の招待はGit履歴の受渡し画面で確認してください。');return;}peerLife.current++;setPeerGeneration(value=>value+1);setPeer(value=>!value);}}>{peer?'P2P受信を閉じる':'P2Pで受け取る'}</UiButton>{peer?<P2PTransferPanel key={peerGeneration} pairOrigin={PAIRING_RELAY_ORIGIN} embedded allowRelaySelection onReceiveFile={file=>stage(file,peerToken)} maxFileBytes={RESEARCH_GIT_CHANGE_BYTES}/>:null}</>}
    {error?<p role="alert">{error}</p>:null}{staged?<><PackagePreview value={staged}/><UiButton type="button" size="compact" disabled={!signedIn} pending={busy} onClick={()=>void importDraft()}>提案フォームへ取り込む</UiButton>{imported?<p role="status">提案フォームへ取り込みました。二版を確認し、提案の保存は別に確定してください。</p>:null}</>:null}
  </section>;
}
