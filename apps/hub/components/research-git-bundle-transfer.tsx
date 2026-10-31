'use client';

import React,{useEffect,useRef,useState} from 'react';
import {UiButton,UiField,UiInput} from './ui/primitives';
import {P2PTransferPanel} from './p2p-transfer-panel';
import {PAIRING_RELAY_ORIGIN} from '@/lib/p2p-pairing.mjs';
import {MAX_FILE_BYTES} from '@/lib/p2p-transfer.mjs';
import {parseResearchGitChangeTarget} from '@/lib/research-git-change-package';
import {GIT_IMPORT_MAX_BUNDLE_BYTES,encodeGitImportMetadataHeader,parseGitImportMetadata,parseGitImportResult,parseGitImportCheckResult,validateGitImportBundleLength,type GitImportMetadata,type GitImportResult,type GitImportCheckResult} from '@/lib/research-git-import';
import {parseResearchGitCommitDetail,type ResearchGitCommitDetail} from '@/lib/research-git-browse';

export type ResearchGitBundleTransferProps={projectId:string;actorId?:string;signedIn?:boolean;canManage:boolean;repositoryVisibility:'public'|'confidential';projectPublic?:boolean;onImportedComparison?:(comparison:ResearchGitCommitDetail)=>void};
type Attempt={metadata:GitImportMetadata;preview:GitImportResult;sent:boolean;saved?:GitImportResult;check?:GitImportCheckResult};
const wrap:React.CSSProperties={minWidth:0,overflowWrap:'anywhere'};
const explain=(e:unknown)=>{const value=e instanceof Error?e.message:'履歴を確認できません。';return value==='invalid_git_import'?'取込み情報・応答が固定した対象と一致しません。':value==='invalid_git_import_length'||value==='git_import_bundle_too_large'?'Git bundleは1バイト〜50MiBで指定してください。':value;};
const digest=async(bytes:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes as Uint8Array<ArrayBuffer>)),value=>value.toString(16).padStart(2,'0')).join('');
async function boundedBody(response:Response,max:number){
  const declared=response.headers.get('content-length');
  if(declared!==null&&(!/^(?:0|[1-9][0-9]*)$/.test(declared)||!Number.isSafeInteger(Number(declared))||Number(declared)>max))throw Error('応答の長さが表示上限を超えています。');
  const reader=response.body?.getReader();if(!reader)throw Error('応答の本文を確認できません。');
  const chunks:Uint8Array[]=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max)throw Error('応答の長さが表示上限を超えています。');chunks.push(value);}}catch(e){await reader.cancel().catch(()=>{});throw e;}finally{reader.releaseLock();}
  if(declared!==null&&Number(declared)!==size)throw Error('応答の宣言長と実際の長さが一致しません。');
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}return bytes;
}
async function json(response:Response,max=4096){
  if(response.headers.get('content-type')?.split(';',1)[0].trim().toLowerCase()!=='application/json')throw Error('応答の形式を確認できません。');
  if(response.headers.get('content-encoding')&&response.headers.get('content-encoding')?.toLowerCase()!=='identity')throw Error('圧縮された応答は確認できません。');
  const bytes=await boundedBody(response,max);try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)) as unknown;}finally{bytes.fill(0);}
}
export function ResearchGitBundleTransfer(props:ResearchGitBundleTransferProps){
  const [account,setAccount]=useState(0);useEffect(()=>{const clear=()=>setAccount(value=>value+1);window.addEventListener('hub-account-changed',clear);return()=>window.removeEventListener('hub-account-changed',clear);},[]);
  return <TransferScope key={JSON.stringify([account,props.projectId,props.actorId,props.signedIn,props.canManage,props.repositoryVisibility,props.projectPublic])} {...props}/>;
}
function TransferScope({projectId,signedIn=false,canManage,repositoryVisibility,projectPublic=false,onImportedComparison}:ResearchGitBundleTransferProps){
  const endpoint=`/api/research/projects/${encodeURIComponent(projectId)}/git`;
  const [file,setFile]=useState<File|null>(null),[hash,setHash]=useState(''),[download,setDownload]=useState(''),[branch,setBranch]=useState('main'),[base,setBase]=useState(''),[head,setHead]=useState(''),[target,setTarget]=useState(''),[invitation,setInvitation]=useState('');
  const [attempt,setAttempt]=useState<Attempt|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[invalidInvitation,setInvalidInvitation]=useState(false),[peer,setPeer]=useState<'send'|'receive'|null>(null),[peerGeneration,setPeerGeneration]=useState(0),[comparison,setComparison]=useState<ResearchGitCommitDetail|null>(null),[connected,setConnected]=useState(false);
  const life=useRef({mounted:true,generation:0,busy:false,controller:null as AbortController|null,bytes:null as Uint8Array|null,attempt:null as Attempt|null,peer:0,origin:''});
  const callback=useRef(onImportedComparison);callback.current=onImportedComparison;
  const active=(generation:number)=>life.current.mounted&&generation===life.current.generation&&life.current.origin===window.location.origin;
  useEffect(()=>{const state=life.current;state.mounted=true;state.origin=window.location.origin;const clear=()=>{state.generation++;state.peer++;state.controller?.abort();state.bytes?.fill(0);state.bytes=null;state.attempt=null;state.busy=false;};window.addEventListener('hub-account-changed',clear);return()=>{state.mounted=false;clear();window.removeEventListener('hub-account-changed',clear);};},[]);
  useEffect(()=>{const invite=()=>{const query=new URLSearchParams(window.location.search);if(!query.has('gitBundle')||!window.location.hash.startsWith('#pair='))return;if(query.getAll('gitBundle').length!==1||query.get('gitBundle')!=='1'){setInvalidInvitation(true);setError('履歴受信の招待指定が不正です。接続しません。');return;}if(!signedIn||!canManage||life.current.busy||life.current.attempt?.sent)return;life.current.peer++;setPeerGeneration(value=>value+1);setPeer('receive');};invite();window.addEventListener('hashchange',invite);return()=>window.removeEventListener('hashchange',invite);},[signedIn,canManage]);
  useEffect(()=>{if(!file)return;const url=URL.createObjectURL(file);setDownload(url);return()=>URL.revokeObjectURL(url);},[file]);
  const locked=busy||!!attempt?.sent,editable=signedIn&&canManage;
  function reset(){if(life.current.busy)return;life.current.generation++;life.current.peer++;life.current.bytes?.fill(0);life.current.bytes=null;life.current.attempt=null;setAttempt(null);setFile(null);setDownload('');setHash('');setComparison(null);setConnected(false);setPeer(null);setTarget('');setInvitation('');setError('');}
  function edit(setter:(value:string)=>void,value:string){if(locked||life.current.busy)return;life.current.generation++;life.current.peer++;life.current.attempt=null;setAttempt(null);setComparison(null);setConnected(false);setPeer(null);setInvitation('');setError('');setter(value);}
  async function run(action:(generation:number,signal:AbortSignal)=>Promise<void>){
    if(life.current.busy)return;const state=life.current,generation=state.generation,controller=new AbortController();state.controller=controller;state.busy=true;setBusy(true);setError('');
    try{await action(generation,AbortSignal.any([controller.signal,AbortSignal.timeout(30000)]));}catch(e){if(active(generation))setError((state.attempt?.sent&&!state.attempt.saved?'保存結果は不明です。同じ内容は再送せず、「候補ブランチの現在を確認」を使ってください。 ':'')+explain(e));}finally{if(active(generation)){state.busy=false;state.controller=null;setBusy(false);}}
  }
  async function stage(selected:File,peerToken?:number){
    if(locked||life.current.busy||peerToken!==undefined&&(peerToken!==life.current.peer||!editable))return;
    reset();await run(async generation=>{validateGitImportBundleLength(selected.size);const bytes=new Uint8Array(await selected.arrayBuffer());try{validateGitImportBundleLength(bytes.byteLength,selected.size);const sha=await digest(bytes);if(!active(generation)||peerToken!==undefined&&peerToken+1!==life.current.peer)return;life.current.bytes=bytes;setFile(new File([bytes as Uint8Array<ArrayBuffer>],'PROJECT.bundle',{type:'application/octet-stream'}));setHash(sha);}finally{if(life.current.bytes!==bytes)bytes.fill(0);}});
  }
  async function acquire(){if(locked||life.current.busy||!projectPublic||repositoryVisibility!=='public')return;reset();await run(async(generation,signal)=>{
    const response=await fetch(endpoint+'/bundle',{cache:'no-store',credentials:'omit',redirect:'error',signal});if(!response.ok)throw Error('公開Git履歴を取得できません。');
    if(response.headers.get('content-type')?.split(';',1)[0].trim().toLowerCase()!=='application/octet-stream'||response.headers.get('content-encoding')&&response.headers.get('content-encoding')?.toLowerCase()!=='identity')throw Error('Git bundleの応答形式が不正です。');
    const bytes=await boundedBody(response,GIT_IMPORT_MAX_BUNDLE_BYTES);try{validateGitImportBundleLength(bytes.byteLength,response.headers.get('content-length')??undefined);const sha=await digest(bytes);if(response.headers.get('x-hub-bundle-sha256')!==sha)throw Error('Git bundleのハッシュが一致しません。');if(!active(generation))return;life.current.bytes=bytes;setFile(new File([bytes as Uint8Array<ArrayBuffer>],'PROJECT.bundle',{type:'application/octet-stream'}));setHash(sha);}finally{if(life.current.bytes!==bytes)bytes.fill(0);}
  });}
  async function prepare(){if(!editable||!life.current.bytes||locked||life.current.busy)return;const metadata=parseGitImportMetadata({requestId:crypto.randomUUID(),branch,baseOid:base,headOid:head,bundleSha256:hash});await run(async(generation,signal)=>{
    life.current.attempt=null;setAttempt(null);const response=await fetch(endpoint+'/import/preview',{method:'POST',cache:'no-store',redirect:'error',headers:{'Content-Type':'application/octet-stream','X-Hub-Git-Import':encodeGitImportMetadataHeader(metadata)},signal,body:life.current.bytes as Uint8Array<ArrayBuffer>});if(!response.ok)throw Error('履歴情報の確認が拒否されました。branchと二版を確認してください。');const preview=parseGitImportResult(await json(response),projectId,metadata,'preview');if(preview.bundleBytes!==life.current.bytes?.byteLength)throw Error('応答のbundle長が一致しません。');if(active(generation)){const next={metadata,preview,sent:false};life.current.attempt=next;setAttempt(next);}
  });}
  async function save(){const current=life.current.attempt;if(!editable||!current||current.sent||!life.current.bytes||life.current.busy)return;current.sent=true;setAttempt({...current});setPeer(null);life.current.peer++;await run(async(generation,signal)=>{
    const response=await fetch(endpoint+'/import/save',{method:'POST',cache:'no-store',redirect:'error',headers:{'Content-Type':'application/octet-stream','X-Hub-Git-Import':encodeGitImportMetadataHeader(current.metadata)},signal,body:life.current.bytes as Uint8Array<ArrayBuffer>});if(!response.ok)throw Error('保存の応答を確認できません。');const saved=parseGitImportResult(await json(response),projectId,current.metadata,'save');if(saved.bundleBytes!==current.preview.bundleBytes||saved.baseTreeOid!==current.preview.baseTreeOid||saved.headTreeOid!==current.preview.headTreeOid)throw Error('確認時のbundle長・二版のtreeと保存応答が一致しません。');if(active(generation)){current.saved=saved;setAttempt({...current});life.current.bytes?.fill(0);life.current.bytes=null;setFile(null);setDownload('');}
  });}
  async function check(){const current=life.current.attempt;if(!editable||!current?.sent)return;await run(async(generation,signal)=>{const response=await fetch(endpoint+'/import/check',{method:'POST',cache:'no-store',redirect:'error',headers:{'Content-Type':'application/json'},signal,body:JSON.stringify(current.metadata)});if(!response.ok)throw Error('候補ブランチを確認できません。保存結果は断定できません。');const value=parseGitImportCheckResult(await json(response),projectId,current.metadata);if(active(generation)){current.check=value;setAttempt({...current});}});}
  async function compare(){const current=life.current.attempt;if(!editable||!current||!current.saved&&current.check?.outcome!=='imported'||!projectPublic||repositoryVisibility!=='public')return;await run(async(generation,signal)=>{const response=await fetch(`${endpoint}/browse?commit=${current.metadata.headOid}&base=${current.metadata.baseOid}`,{cache:'no-store',credentials:'omit',redirect:'error',signal});if(!response.ok)throw Error('このHubで公開された二版を取得できません。公開範囲と両コミットを確認してください。');const value=parseResearchGitCommitDetail(await json(response,512*1024),projectId,current.metadata.headOid,current.metadata.baseOid);if(active(generation)){setComparison(value);setConnected(false);}});}
  const peerToken=life.current.peer;
  return <section aria-label="Git履歴の受渡し" style={wrap}><h3>Git履歴を受け渡す</h3><p>Git bundleは最大50MiBです。16MiB以内はP2Pで送受信できます。受信・履歴情報の確認だけでは保存・提案・承認・ブランチ反映を行いません。</p>
    {projectPublic&&repositoryVisibility==='public'?<UiButton type="button" size="compact" disabled={locked} pending={busy} onClick={()=>void acquire()}>このHubの公開履歴を取得</UiButton>:null}
    <UiField label="Git bundleファイル（最大50MiB）"><UiInput type="file" aria-label="Git bundleファイル" accept=".bundle,application/octet-stream" disabled={locked} onChange={e=>{const selected=e.target.files?.[0];e.target.value='';if(selected)void stage(selected);}}/></UiField>
    {editable?<UiButton type="button" size="compact" disabled={locked||invalidInvitation} onClick={()=>{life.current.peer++;setPeerGeneration(value=>value+1);setPeer(peer==='receive'?null:'receive');}}>{peer==='receive'?'P2P受信を閉じる':'履歴をP2Pで受け取る'}</UiButton>:<p>保存には、このリポジトリを管理できるアカウントでログインしてください。</p>}
    {file?<><p>履歴ファイル: {file.size} bytes · SHA256 <code>{hash}</code></p>{download?<a href={download} download="PROJECT.bundle">確認した履歴ファイルを保存</a>:null}{file.size<=MAX_FILE_BYTES?<><UiField label="P2P送り先Hubの研究プロジェクトURL"><UiInput aria-label="P2P送り先Hubの研究プロジェクトURL" value={target} maxLength={560} disabled={locked} onChange={e=>edit(setTarget,e.target.value)} placeholder="https://hub.example/v2/research/rp_…" spellCheck={false}/></UiField><UiButton type="button" size="compact" disabled={locked} onClick={()=>{try{const parsed=parseResearchGitChangeTarget(target),canonical=`${parsed.origin}/v2/research/${parsed.projectId}`;if(target!==canonical&&target!==canonical+'#git')throw Error('送り先は正規のHub研究プロジェクトURLを入力してください。');life.current.peer++;setPeerGeneration(value=>value+1);setInvitation(canonical+'?gitBundle=1');setPeer(peer==='send'?null:'send');setError('');}catch(e){setError(e instanceof Error?e.message:'送り先を確認してください。');}}}>{peer==='send'?'P2P送信を閉じる':'この履歴をP2Pで渡す'}</UiButton></>:<p>16MiBを超えるため、ファイルとして保存して渡してください。</p>}</>:null}
    {peer?<P2PTransferPanel key={peerGeneration} pairOrigin={PAIRING_RELAY_ORIGIN} embedded allowRelaySelection maxFileBytes={MAX_FILE_BYTES} {...(peer==='send'&&file?{sendFile:file,invitationUrl:invitation}:{onReceiveFile:(selected:File)=>stage(selected,peerToken)})}/>:null}
    <p>保存先: このHubの研究プロジェクト <code>{projectId}</code> · {repositoryVisibility==='public'?'公開リポジトリ。保存した候補の履歴も公開取得の対象になります。':'非公開リポジトリ。今回の保存では公開範囲を変更しません。'}</p>
    <UiField label="反映先のブランチ"><UiInput aria-label="取込み先ブランチ" value={branch} maxLength={240} disabled={locked} onChange={e=>edit(setBranch,e.target.value)}/></UiField>
    <UiField label="基準コミットID"><UiInput aria-label="取込みの基準コミットID" value={base} maxLength={64} disabled={locked} onChange={e=>edit(setBase,e.target.value)} spellCheck={false}/></UiField>
    <UiField label="変更後コミットID"><UiInput aria-label="取込みの変更後コミットID" value={head} maxLength={64} disabled={locked} onChange={e=>edit(setHead,e.target.value)} spellCheck={false}/></UiField>
    {error?<p role="alert">{error}</p>:null}
    {!attempt?.sent?<UiButton type="button" size="compact" disabled={!editable||!file||busy} onClick={()=>{void prepare().catch(e=>setError(explain(e)));}}>履歴情報を確認</UiButton>:null}
    {attempt?<section aria-label="Git履歴の保存確認"><p>操作ID <code>{attempt.metadata.requestId}</code> · SHA256 <code>{attempt.metadata.bundleSha256}</code></p><p>基準 <code>{attempt.metadata.baseOid}</code> → 変更後 <code>{attempt.metadata.headOid}</code> · {attempt.preview.objectFormat}</p><p>候補ブランチ <code>{attempt.preview.candidateBranch}</code> · {attempt.preview.bundleBytes} bytes</p><p>履歴情報を確認しました。差分の確認・本人の確認・承認を引き継ぐものではありません。保存は候補ブランチだけを追加し、反映先 <code>{attempt.metadata.branch}</code> は更新しません。</p>
      {!attempt.sent?<UiButton type="button" size="compact" disabled={busy||!editable} onClick={()=>void save()}>確認して候補履歴を保存</UiButton>:<><p role="status">{attempt.saved?'候補履歴の保存を確認しました。提案・承認・反映は別の操作です。':'保存結果は不明です。固定した内容を再送せず、候補だけを確認してください。'}</p><UiButton type="button" size="compact" disabled={busy||!editable} onClick={()=>void check()}>候補ブランチの現在を確認</UiButton></>}
      {attempt.check?<p>{attempt.check.outcome==='imported'?'候補の現在のコミットは変更後の版と一致しています。過去のbytes・本人・承認を証明しません。':'現在の候補を確認できません。未保存の証明ではありません。再送しません。'}</p>:null}
      {(attempt.saved||attempt.check?.outcome==='imported')?<>{projectPublic&&repositoryVisibility==='public'?<UiButton type="button" size="compact" disabled={busy||!editable} onClick={()=>void compare()}>受信Hubから二版の差分を取得</UiButton>:<p>提案へ進むには、受信Hubで公開された二版を取得できる必要があります。公開範囲は別の管理操作です。</p>}</>:null}
    </section>:null}
    {comparison?<section aria-label="受信Hubの二版比較"><h4>このHubから取得した二版の差分</h4><pre className="research-source">{comparison.diff||'表示できるテキスト差分はありません。'}</pre>{comparison.truncated?<p>差分の一部を省略しています。Gitで二版の全体を確認してください。</p>:null}<UiButton type="button" size="compact" disabled={busy||!editable||!callback.current} onClick={()=>{try{callback.current?.(comparison);setConnected(true);}catch(e){setError(e instanceof Error?e.message:'提案画面に接続できません。');}}}>この二版を既存の提案画面へ渡す</UiButton>{connected?<p role="status">提案画面へ渡しました。同じ二版の既存入力と保存確認を保持しています。提案の保存は別に確認してください。</p>:null}</section>:null}
    {(file||attempt)?<UiButton type="button" size="compact" disabled={busy} onClick={reset}>{attempt?.sent?'保存結果を断定せず、この受渡しを終了':'この受渡しを終了'}</UiButton>:null}
  </section>;
}
