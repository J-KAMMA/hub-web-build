"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./ai-local-runner-panel.module.css";

const RUNNER = "http://127.0.0.1:43127";
type GeneratedFile = { path: string; sizeBytes: number; contentBase64: string };
type RunResult = { id: string; status: "pending_approval" | "running" | "completed" | "denied" | "cancelled" | "failed" | "isolation_unavailable"; stdout?: string; stderr?: string; exitCode?: number; files?: GeneratedFile[] };
type RunnerHealth = { status: "checking" | "offline" | "ready"; isolation: "docker" | "unavailable" };
type WorkspaceSearchResult={relativePath:string;excerpt:string;sizeBytes:number};
type FilePreview={relativePath:string;previousSha256:string|null;nextSha256:string;previousLines:number;nextLines:number;changed:boolean};
type FileRevision={id:string;relativePath:string;sha256:string|null;createdAtMs:number};
export type LocalModel = { id: string; name: string; runtime: string };
export type LocalExecutionPolicy = { mode:"local_only"|"local_preferred";allowWeb:boolean;allowHubRead:boolean;allowHubWrite:boolean;allowFileRead:boolean;allowFileWrite:boolean;allowCodeExecution:boolean;allowPurchase:boolean;maximumCostUsd:number };
export type LocalAiConnection = { sessionToken: string; model: LocalModel; models: LocalModel[]; policy: LocalExecutionPolicy };
const DEFAULT_POLICY:LocalExecutionPolicy={mode:"local_only",allowWeb:false,allowHubRead:false,allowHubWrite:false,allowFileRead:false,allowFileWrite:false,allowCodeExecution:false,allowPurchase:false,maximumCostUsd:0};

export function AiLocalRunnerPanel({ onClose, onConnected }: { onClose(): void; onConnected?(connection: LocalAiConnection): void }) {
  const [sessionToken, setSessionToken] = useState("");
  const [language, setLanguage] = useState<"python" | "javascript">("python");
  const [workspaceRoot, setWorkspaceRoot] = useState("");
  const [code, setCode] = useState("");
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState("");
  const [health, setHealth] = useState<RunnerHealth>({ status: "checking", isolation: "unavailable" });
  const [localModels, setLocalModels] = useState<LocalModel[]>([]);
  const [localModel, setLocalModel] = useState("");
  const [localPrompt, setLocalPrompt] = useState("");
  const [localOutput, setLocalOutput] = useState("");
  const [localRunning, setLocalRunning] = useState(false);
  const [policy,setPolicy]=useState<LocalExecutionPolicy>(DEFAULT_POLICY);
  const [fileQuery,setFileQuery]=useState("");
  const [fileResults,setFileResults]=useState<WorkspaceSearchResult[]>([]);
  const [filePath,setFilePath]=useState("");
  const [fileContent,setFileContent]=useState("");
  const [filePreview,setFilePreview]=useState<FilePreview|null>(null);
  const [fileWriteStatus,setFileWriteStatus]=useState("");
  const [fileRevisions,setFileRevisions]=useState<FileRevision[]>([]);
  const polling = useRef<number | null>(null);
  const connecting = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${RUNNER}/health`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => response.ok ? response.json() as Promise<{ status?: string; isolation?: string }> : Promise.reject())
      .then((body) => setHealth({ status: body.status === "ok" ? "ready" : "offline", isolation: body.isolation === "docker" ? "docker" : "unavailable" }))
      .catch(() => { if (!controller.signal.aborted) setHealth({ status: "offline", isolation: "unavailable" }); });
    return () => { controller.abort(); if (polling.current) window.clearTimeout(polling.current); };
  }, []);

  useEffect(() => {
    if (health.status === "ready" && !sessionToken && !connecting.current) void connect();
  }, [health.status, sessionToken]);

  async function connect() {
    connecting.current = true;
    setError("");
    try {
      const response = await fetch(`${RUNNER}/pair`, { method: "POST" });
      const body = await response.json() as { sessionToken?: string; error?: string };
      if (!response.ok || !body.sessionToken) throw new Error(body.error ?? "pair_failed");
      setSessionToken(body.sessionToken);
      void loadLocalModels(body.sessionToken);
    } catch { setError("Local Runnerへ自動接続できません。アプリを再起動して、もう一度お試しください。"); }
    finally { connecting.current = false; }
  }

  async function loadLocalModels(token: string) {
    try {
      const response = await fetch(`${RUNNER}/local-ai/models`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
      const body = await response.json() as LocalModel[];
      const models = response.ok ? body.filter((model) => /^(ollama|openai:[1-9][0-9]{0,4})$/.test(model.runtime) && model.id.length > 0 && model.id.length <= 200 && !/[\u0000-\u001f\u007f]/.test(model.id)) : [];
      setLocalModels(models); setLocalModel(models[0] ? modelKey(models[0]) : "");
      if (models[0]) onConnected?.({ sessionToken: token, model: models[0], models, policy });
    } catch { setLocalModels([]); }
  }

  async function runLocalAi() {
    const model = localModels.find((item) => modelKey(item) === localModel);
    if (!model || !sessionToken || !localPrompt.trim()) return;
    setLocalRunning(true); setLocalOutput(""); setError("");
    try {
      const response = await fetch(`${RUNNER}/local-ai/chat`, { method: "POST", headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" }, body: JSON.stringify({ runtime: model.runtime, model: model.id, prompt: localPrompt.slice(0, 8000), policy }) });
      const body = await response.json() as { output?: string };
      if (!response.ok || typeof body.output !== "string") throw new Error("local_ai_failed");
      setLocalOutput(body.output);
    } catch { setError("接続PCのAIを実行できません。OllamaまたはLM Studioを確認してください。"); }
    finally { setLocalRunning(false); }
  }

  function selectLocalModel(key: string) {
    setLocalModel(key);
    const model = localModels.find((item) => modelKey(item) === key);
    if (model && sessionToken) onConnected?.({ sessionToken, model, models: localModels, policy });
  }

  function updatePolicy(next:LocalExecutionPolicy){
    setPolicy(next);
    const model=localModels.find((item)=>modelKey(item)===localModel);
    if(model&&sessionToken)onConnected?.({sessionToken,model,models:localModels,policy:next});
  }

  async function disconnect() {
    if (sessionToken) await fetch(`${RUNNER}/disconnect`, { method: "POST", headers: { authorization: `Bearer ${sessionToken}` } }).catch(() => undefined);
    if (polling.current) window.clearTimeout(polling.current);
    setSessionToken(""); setResult(null); setCode("");
  }

  async function requestRun() {
    if (!sessionToken || !workspaceRoot.trim() || !code.trim()) return;
    setError(""); setResult(null);
    try {
      const response = await fetch(`${RUNNER}/runs`, { method: "POST", headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" }, body: JSON.stringify({ language, code, workspaceRoot: workspaceRoot.trim(), network: false, timeoutMs: 15_000, policy }) });
      const body = await response.json() as RunResult & { error?: string };
      if (!response.ok || !body.id) throw new Error(body.error ?? "run_failed");
      setResult(body); poll(body.id, sessionToken, 0);
    } catch { setError("実行要求を送れませんでした。ペアリングをやり直してください。"); }
  }

  async function searchWorkspace(){
    if(!sessionToken||!workspaceRoot.trim()||!fileQuery.trim()||!policy.allowFileRead)return;
    setError("");
    try{
      const response=await fetch(`${RUNNER}/files/search`,{method:"POST",headers:{authorization:`Bearer ${sessionToken}`,"content-type":"application/json"},body:JSON.stringify({workspaceRoot:workspaceRoot.trim(),query:fileQuery.trim(),policy})});
      const body=await response.json() as WorkspaceSearchResult[]&{error?:string};
      if(!response.ok||!Array.isArray(body))throw new Error("search_failed");
      setFileResults(body);
    }catch{setError("許可フォルダを検索できませんでした。パスと読取権限を確認してください。");}
  }

  async function previewFileWrite(){
    if(!sessionToken||!workspaceRoot.trim()||!filePath.trim()||!policy.allowFileRead)return;
    setError("");setFileWriteStatus("");
    try{
      const response=await fetch(`${RUNNER}/files/diff`,{method:"POST",headers:{authorization:`Bearer ${sessionToken}`,"content-type":"application/json"},body:JSON.stringify({workspaceRoot:workspaceRoot.trim(),relativePath:filePath.trim(),nextContent:fileContent,policy})});
      const body=await response.json() as FilePreview&{error?:string};
      if(!response.ok||!body.nextSha256)throw new Error(body.error??"preview_failed");
      setFilePreview(body);
    }catch{setError("ファイル差分を作成できませんでした。作業フォルダと権限を確認してください。");}
  }

  async function requestFileWrite(){
    if(!sessionToken||!filePreview||!policy.allowFileWrite)return;
    setError("");setFileWriteStatus("デスクトップで承認してください");
    try{
      const response=await fetch(`${RUNNER}/files/write`,{method:"POST",headers:{authorization:`Bearer ${sessionToken}`,"content-type":"application/json"},body:JSON.stringify({workspaceRoot:workspaceRoot.trim(),relativePath:filePreview.relativePath,nextContent:fileContent,expectedPreviousSha256:filePreview.previousSha256,expectedNextSha256:filePreview.nextSha256,policy})});
      const body=await response.json() as {id?:string;error?:string};
      if(!response.ok||!body.id)throw new Error(body.error??"write_failed");
      pollFileWrite(body.id,sessionToken,0);
    }catch{setFileWriteStatus("");setError("保存リクエストを送れませんでした。差分を再作成してください。");}
  }

  async function loadFileRevisions(){
    if(!sessionToken||!workspaceRoot.trim()||!filePath.trim()||!policy.allowFileRead)return;
    try{const response=await fetch(`${RUNNER}/files/revisions`,{method:"POST",headers:{authorization:`Bearer ${sessionToken}`,"content-type":"application/json"},body:JSON.stringify({workspaceRoot:workspaceRoot.trim(),relativePath:filePath.trim(),policy})});const body=await response.json() as FileRevision[];if(!response.ok||!Array.isArray(body))throw new Error();setFileRevisions(body);}catch{setError("復元履歴を読み込めませんでした。");}
  }

  async function requestRestore(revisionId:string){
    if(!sessionToken||!filePreview||!policy.allowFileWrite)return;
    setFileWriteStatus("復元をデスクトップで承認してください");
    try{const response=await fetch(`${RUNNER}/files/restore`,{method:"POST",headers:{authorization:`Bearer ${sessionToken}`,"content-type":"application/json"},body:JSON.stringify({workspaceRoot:workspaceRoot.trim(),relativePath:filePath.trim(),revisionId,expectedCurrentSha256:filePreview.previousSha256,policy})});const body=await response.json() as {id?:string};if(!response.ok||!body.id)throw new Error();pollFileWrite(body.id,sessionToken,0);}catch{setError("復元リクエストを送れませんでした。現在のファイルを再確認してください。");}
  }

  function pollFileWrite(id:string,token:string,attempt:number){
    if(attempt>=240){setFileWriteStatus("承認待ちがタイムアウトしました");return}
    window.setTimeout(async()=>{try{const response=await fetch(`${RUNNER}/files/write/${encodeURIComponent(id)}`,{headers:{authorization:`Bearer ${token}`}});const body=await response.json() as {status:string};if(!response.ok)throw new Error();setFileWriteStatus(body.status==="completed"?"保存しました":body.status==="denied"?"保存は拒否されました":body.status==="failed"?"保存できませんでした":"デスクトップで承認してください");if(body.status==="pending_approval")pollFileWrite(id,token,attempt+1);}catch{setFileWriteStatus("保存状態を確認できませんでした");}},500);
  }

  async function cancelRun() {
    if (!result || !sessionToken) return;
    await fetch(`${RUNNER}/runs/${encodeURIComponent(result.id)}/cancel`, { method: "POST", headers: { authorization: `Bearer ${sessionToken}` } });
    setResult((current) => current ? { ...current, status: "cancelled" } : current);
  }

  function poll(id: string, token: string, attempt: number) {
    if (attempt >= 240) { setError("ローカル実行がタイムアウトしました。"); return; }
    polling.current = window.setTimeout(async () => {
      try {
        const response = await fetch(`${RUNNER}/runs/${encodeURIComponent(id)}`, { headers: { authorization: `Bearer ${token}` } });
        const body = await response.json() as RunResult;
        if (!response.ok) throw new Error("poll_failed");
        setResult(body);
        if (body.status === "pending_approval" || body.status === "running") poll(id, token, attempt + 1);
      } catch { setError("Local Runnerとの接続が切れました。"); }
    }, 500);
  }

  return <section className={styles.overlay} aria-label="ローカルコード実行">
    <div className={styles.panel}>
      <header><div><strong>Local Runner</strong><small>コードとファイルはPC外へ送りません</small></div><button type="button" onClick={onClose}>閉じる</button></header>
      <p role="status">{health.status === "offline" ? "Local Runnerは起動していません。" : health.status === "checking" ? "Local Runnerを確認中…" : health.isolation === "docker" ? "Docker隔離を利用できます。" : "接続済みですがDocker隔離が未設定です。"}</p>
      {!sessionToken ? <div className={styles.pair}><span>Local Runnerへ自動接続しています。</span><button type="button" onClick={() => { void connect(); }} disabled={health.status !== "ready"}>再接続</button></div> : <>
        <fieldset className={styles.policy}><legend>ローカル権限</legend><label><input type="checkbox" checked={policy.allowHubRead} onChange={(event)=>updatePolicy({...policy,allowHubRead:event.target.checked})}/>Hubの参照</label><label><input type="checkbox" checked={policy.allowFileRead} onChange={(event)=>updatePolicy({...policy,allowFileRead:event.target.checked,allowFileWrite:event.target.checked?policy.allowFileWrite:false})}/>指定フォルダの読取</label><label><input type="checkbox" checked={policy.allowFileWrite} disabled={!policy.allowFileRead} onChange={(event)=>updatePolicy({...policy,allowFileWrite:event.target.checked})}/>承認後のファイル保存</label><label><input type="checkbox" checked={policy.allowCodeExecution} onChange={(event)=>updatePolicy({...policy,allowCodeExecution:event.target.checked})}/>Docker内コード実行</label><small>保存は差分確認とデスクトップ承認が必要です。ネット接続・公開・購入はローカル限定では常に禁止されます。</small></fieldset>
        <div className={styles.result}><strong>接続PCのAI</strong>{localModels.length ? <><label>モデル<select value={localModel} onChange={(event) => selectLocalModel(event.target.value)}>{localModels.map((model) => <option key={modelKey(model)} value={modelKey(model)}>{model.name} · {runtimeLabel(model.runtime)}</option>)}</select></label><label>メッセージ<textarea rows={5} maxLength={8000} value={localPrompt} onChange={(event) => setLocalPrompt(event.target.value)} /></label><div className={styles.actions}><span>無料・接続PC内で処理・Hubサーバーを経由しません</span><button type="button" disabled={localRunning || !localPrompt.trim()} onClick={() => { void runLocalAi(); }}>{localRunning ? "生成中…" : "接続PCで送信"}</button></div>{localOutput ? <pre>{localOutput}</pre> : null}</> : <p>対応するAIモデルが接続PCに見つかりません。Ollama、XinferenceまたはOpenAI互換APIを起動してください。</p>}</div>
        <div className={styles.grid}><label>言語<select value={language} onChange={(event) => setLanguage(event.target.value as "python" | "javascript")}><option value="python">Python</option><option value="javascript">JavaScript</option></select></label><label>読み取りを許可する作業フォルダ<input value={workspaceRoot} onChange={(event) => setWorkspaceRoot(event.target.value)} placeholder="C:\work\project" /></label></div>
        <div className={styles.workspaceSearch}><label>フォルダ内検索<input value={fileQuery} maxLength={200} onChange={(event)=>setFileQuery(event.target.value)} placeholder="ファイル名または本文"/></label><button type="button" disabled={!policy.allowFileRead||!workspaceRoot.trim()||!fileQuery.trim()} onClick={()=>void searchWorkspace()}>検索</button>{fileResults.length?<ul>{fileResults.map((item)=><li key={item.relativePath}><strong>{item.relativePath}</strong><small>{item.excerpt}</small></li>)}</ul>:null}</div>
        <div className={styles.workspaceSearch}><strong>安全なファイル保存</strong><label>相対パス<input value={filePath} onChange={(event)=>{setFilePath(event.target.value);setFilePreview(null);setFileRevisions([])}} placeholder="src/example.ts"/></label><label>保存内容<textarea rows={6} value={fileContent} onChange={(event)=>{setFileContent(event.target.value);setFilePreview(null)}}/></label><div className={styles.actions}><button type="button" disabled={!policy.allowFileRead||!workspaceRoot.trim()||!filePath.trim()} onClick={()=>void previewFileWrite()}>差分を確認</button><button type="button" disabled={!policy.allowFileWrite||!filePreview?.changed} onClick={()=>void requestFileWrite()}>承認画面へ送る</button><button type="button" disabled={!filePreview} onClick={()=>void loadFileRevisions()}>復元履歴</button></div>{filePreview?<small>{filePreview.previousLines}行 → {filePreview.nextLines}行 · SHA-256検証済み</small>:null}{fileRevisions.length?<ul>{fileRevisions.map((revision)=><li key={revision.id}><span>{new Date(Number(revision.createdAtMs)).toLocaleString()}</span><button type="button" disabled={!policy.allowFileWrite||!filePreview} onClick={()=>void requestRestore(revision.id)}>この版へ復元</button></li>)}</ul>:null}{fileWriteStatus?<small>{fileWriteStatus}</small>:null}</div>
        <label>実行するコード<textarea value={code} onChange={(event) => setCode(event.target.value)} rows={12} spellCheck={false} /></label>
        <div className={styles.actions}><span>ネットワークOFF・最大15秒・生成物は /output のみ</span><button type="button" onClick={() => { void requestRun(); }} disabled={!workspaceRoot.trim() || !code.trim() || health.isolation !== "docker"}>承認画面へ送る</button></div>
        {result ? <div className={styles.result}><strong>{result.status}</strong>{result.stdout ? <pre>{result.stdout}</pre> : null}{result.stderr ? <pre>{result.stderr}</pre> : null}{result.exitCode !== undefined ? <small>exit {result.exitCode}</small> : null}{result.files?.map((file) => <button key={file.path} type="button" onClick={() => downloadFile(file)}>{file.path} ({formatBytes(file.sizeBytes)})</button>)}{result.status === "pending_approval" || result.status === "running" ? <button type="button" onClick={() => { void cancelRun(); }}>実行を中止</button> : null}</div> : null}
        <div className={styles.actions}><span>セッションは5分で失効します</span><button type="button" onClick={() => { void disconnect(); }}>接続解除</button></div>
      </>}
      {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    </div>
  </section>;
}

function downloadFile(file: GeneratedFile) {
  const binary = atob(file.contentBase64); const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  const url = URL.createObjectURL(new Blob([bytes])); const anchor = document.createElement("a");
  anchor.href = url; anchor.download = file.path.split("/").pop() || "output"; anchor.click(); URL.revokeObjectURL(url);
}
function formatBytes(bytes: number) { return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`; }
function modelKey(model: LocalModel) { return `${model.runtime}\u0000${model.id}`; }
function runtimeLabel(runtime: string) { return runtime === "ollama" ? "Ollama" : `OpenAI互換 (${runtime.split(":")[1]})`; }
