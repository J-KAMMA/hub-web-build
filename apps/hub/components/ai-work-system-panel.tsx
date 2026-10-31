"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, FileText, LoaderCircle, Package, Play, Save, ScrollText, ShieldCheck, Trash2, Upload, X } from "lucide-react";
import styles from "./ai-work-system-panel.module.css";
import { AiConnectorSettings } from "./ai-connector-settings";
import { IntentRunCenter } from "./intent-run-center";

type WorkStep = { id: string; toolId: string; action: string; phase: "read" | "draft" | "confirm"; href?: string; input?: Record<string, string> };
type WorkJob = { id: string; title: string; project: string; status: string; steps: WorkStep[]; budgetUsdCents: number; approvalExpiresAt?: number | null; attempts?: number; maxAttempts?: number; updatedAt: number; hubIntentRunId?: string | null; previewHash?: string | null; preview?: { externalDataPreview?: string; externalRecipients?: string[]; irreversibleActions?: string[] } | null };
type KnowledgeDocument = { id: string; project: string; name: string; mimeType: string; characters: number; updatedAt: number };
type Permission = { scope: string; decision: "allow" | "ask" | "deny" };
type Draft = { id: string; project: string; kind: string; title: string; content: string; status: string; updatedAt: number };
type Artifact = { id: string; project: string; kind: string; name: string; mimeType: string; updatedAt: number };
type Score = { providerId: string; toolId: string; samples: number; rating: number; latencyMs: number | null; successes: number };
const LABEL: Record<string, string> = { approval_required: "承認待ち", queued: "実行待ち", running: "実行中", completed: "完了", failed: "失敗", cancelled: "取消済み" };

export function AiWorkSystemPanel({ project }: { project: string }) {
  const [jobs, setJobs] = useState<WorkJob[]>([]), [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]), [drafts, setDrafts] = useState<Draft[]>([]), [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [scores, setScores] = useState<Score[]>([]), [auditRows, setAuditRows] = useState<Array<{ eventType?: string; stage?: string; statusCategory: string; createdAt: number }>>([]);
  const [draftText, setDraftText] = useState("");
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const [a, b, c, d] = await Promise.all([fetch("/ai/api/jobs", { credentials: "same-origin", cache: "no-store" }), fetch(`/ai/api/knowledge?project=${encodeURIComponent(project)}`, { credentials: "same-origin", cache: "no-store" }), fetch(`/ai/api/workspace?project=${encodeURIComponent(project)}`, { credentials: "same-origin", cache: "no-store" }), fetch("/ai/api/permissions", { credentials: "same-origin", cache: "no-store" })]);
      if (!a.ok || !b.ok || !c.ok || !d.ok) throw new Error("AIデータを取得できませんでした。");
      const workspace = await c.json() as { drafts: Draft[]; artifacts: Artifact[]; scores: Score[] };
      setJobs(((await a.json()) as { jobs: WorkJob[] }).jobs); setDocuments(((await b.json()) as { documents: KnowledgeDocument[] }).documents); setDrafts(workspace.drafts); setArtifacts(workspace.artifacts); setScores(workspace.scores); setPermissions(((await d.json()) as { permissions: Permission[] }).permissions); setNotice("");
    } catch (error) { setNotice(error instanceof Error ? error.message : "取得に失敗しました。"); } finally { setBusy(false); }
  }, [project]);
  useEffect(() => { void refresh(); }, [refresh]);
  async function executeStep(step: WorkStep) {
    if (step.action === "publish_post" && step.input?.body) return fetch("/api/social/posts", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ body: step.input.body, identity_mode: "account" }) });
    if (step.action === "publish_thread" && step.input?.title && step.input?.body) return fetch("/api/bbs/threads", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ board_key: step.input.boardKey || "general", title: step.input.title, body: step.input.body, identity_mode: "account", language: "ja", region: "global", thread_type: "chat", tags: [] }) });
    if (step.action === "publish_message" && step.input?.communityId && step.input?.channelId && step.input?.body) return fetch(`/api/communities/${encodeURIComponent(step.input.communityId)}/channels/${encodeURIComponent(step.input.channelId)}/messages`, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ body: step.input.body, kind: step.input.kind || "chat" }) });
    if (step.action === "create_video_playlist" && step.input?.title) return fetch("/api/videos/playlists", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: step.input.title, description: step.input.description || "" }) });
    if (step.action === "create_music_playlist" && step.input?.title) return fetch("/api/music/playlists", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: step.input.title, description: step.input.description || "" }) });
    if (step.action === "mark_read" && step.input?.notificationId) return fetch(`/api/notifications/${encodeURIComponent(step.input.notificationId)}/read`, { method: "POST", credentials: "same-origin" });
    if (step.action === "bookmark" && step.input?.targetType && step.input?.targetId) return fetch("/api/engagements/bookmark", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ target_type: step.input.targetType, target_id: step.input.targetId, note: step.input.note || "" }) });
    return null;
  }
  async function decide(job: WorkJob, decision: "approved" | "denied") {
    const response = await fetch(`/ai/api/jobs/${encodeURIComponent(job.id)}/approval`, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision, previewHash: job.previewHash, stepIds: job.steps.filter((step) => step.phase === "confirm").map((step) => step.id) }) });
    if (!response.ok) { setNotice("承認を更新できませんでした。"); await refresh(); return; }
    if (decision === "denied") { setNotice("取り消しました。"); await refresh(); return; }
    await fetch(`/ai/api/jobs/${encodeURIComponent(job.id)}/start`, { method: "POST", credentials: "same-origin" });
    const executable = job.steps.filter((step) => step.phase === "confirm");
    let failed = false, executed = 0;
    const evidence: Array<{stepId:string;kind:"state";ref:string}> = [];
    for (const step of executable) {
      const result = await executeStep(step);
      if (!result) continue;
      executed += 1;
      if (!result.ok) failed = true;
      else evidence.push({ stepId: step.id, kind: "state", ref: result.headers.get("location") ?? `${step.toolId}.${step.action}:${result.status}` });
    }
    if (executed > 0) {
      await fetch(`/ai/api/jobs/${encodeURIComponent(job.id)}/${failed ? "fail" : "verify"}`, {
        method: "POST", credentials: "same-origin",
        headers: failed ? undefined : { "content-type": "application/json" },
        body: failed ? undefined : JSON.stringify({ evidence }),
      });
    }
    const message = failed ? "一部の操作を実行できませんでした。" : executed ? "承認した操作を実行しました。" : "承認しました。対象タブで内容を確認してください。";
    if ((failed || executed > 0) && job.hubIntentRunId) {
      await syncIntentResult(job);
    }
    setNotice(message); window.dispatchEvent(new CustomEvent("hub:ai-job-status", { detail: { jobId: job.id, status: failed ? "failed" : "completed", message } }));
    if (!failed && executed && "Notification" in window && Notification.permission === "granted") new Notification("AIの仕事が完了しました", { body: job.title });
    await refresh();
  }
  async function cancel(job: WorkJob) { const response = await fetch(`/ai/api/jobs/${encodeURIComponent(job.id)}/cancel`, { method: "POST", credentials: "same-origin" }); setNotice(response.ok ? "ジョブを取り消しました。" : "取り消せませんでした。"); await refresh(); }
  async function retry(job: WorkJob) { const response = await fetch(`/ai/api/jobs/${encodeURIComponent(job.id)}/retry`, { method: "POST", credentials: "same-origin" }); setNotice(response.ok ? "再試行の承認待ちへ戻しました。" : "再試行できませんでした。"); await refresh(); }
  async function syncIntentResult(job: WorkJob) {
    const result = await fetch(`/ai/api/jobs/${encodeURIComponent(job.id)}/intent-result`, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
    });
    const resultBody = await result.json().catch(() => null) as { proof?: unknown; error?: unknown } | null;
    if (!result.ok || typeof resultBody?.proof !== "string") {
      setNotice(typeof resultBody?.error === "string" ? resultBody.error : "AIの完了証明を取得できませんでした。");
      return;
    }
    const accepted = await fetch("/api/core/intents/owner-result", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ proof: resultBody.proof }),
    });
    const acceptedBody = await accepted.json().catch(() => null) as { error?: unknown } | null;
    if (!accepted.ok && acceptedBody?.error !== "owner_result_not_expected") {
      setNotice(typeof acceptedBody?.error === "string" ? acceptedBody.error : "Hubへ結果を反映できませんでした。");
      return;
    }
    setNotice("AIの実行結果をIntent作業へ反映しました。");
    window.dispatchEvent(new CustomEvent("hub:intent-completed"));
  }
  async function upload(files: FileList | null) {
    if (!files?.length) return; setBusy(true);
    for (const file of Array.from(files).slice(0, 5)) { if (file.size > 2_000_000 || (!file.type.startsWith("text/") && !/\.(md|txt|csv|json|ts|tsx|js|jsx|py|css|html)$/i.test(file.name))) continue; await fetch("/ai/api/knowledge", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ project, name: file.name, mimeType: file.type || "text/plain", content: (await file.text()).slice(0, 65_536) }) }); }
    setNotice("資料をAIアカウントへ保存しました。"); await refresh();
  }
  async function removeDocument(document: KnowledgeDocument) { const response = await fetch(`/ai/api/knowledge/${encodeURIComponent(document.id)}`, { method: "DELETE", credentials: "same-origin" }); setNotice(response.ok ? "資料を削除しました。" : "削除できませんでした。"); await refresh(); }
  async function updatePermission(scope: string, decision: Permission["decision"]) { const next=permissions.map((item)=>item.scope===scope?{...item,decision}:item); const response=await fetch("/ai/api/permissions",{method:"PUT",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify({permissions:next})}); if(response.ok)setPermissions(next); else setNotice("権限を更新できませんでした。"); }
  async function createDraft() { if(!draftText.trim())return; const response=await fetch("/ai/api/drafts",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify({project,kind:"document",title:"AI下書き",content:draftText})}); setNotice(response.ok?"下書きを保存しました。":"下書きを保存できませんでした。"); if(response.ok)setDraftText(""); await refresh(); }
  async function removeDraft(id:string){await fetch(`/ai/api/drafts/${encodeURIComponent(id)}`,{method:"DELETE",credentials:"same-origin"});await refresh();}
  async function removeArtifact(id:string){await fetch(`/ai/api/artifacts/${encodeURIComponent(id)}`,{method:"DELETE",credentials:"same-origin"});await refresh();}
  async function loadAudit(job:WorkJob){const response=await fetch(`/ai/api/jobs/${encodeURIComponent(job.id)}/audit`,{credentials:"same-origin",cache:"no-store"});if(!response.ok){setNotice("監査履歴を取得できませんでした。");return;}const body=await response.json() as {audit:Array<{eventType:string;statusCategory:string;createdAt:number}>;progress:Array<{stage:string;statusCategory:string;createdAt:number}>};setAuditRows([...body.audit,...body.progress].sort((a,b)=>a.createdAt-b.createdAt));}
  return <div className={styles.layout}>
    <IntentRunCenter project={project} />
    <section><div className={styles.heading}><div><h2>仕事の実行</h2><p>重要な操作は実行前にここで止まります。</p></div><button onClick={() => void refresh()} disabled={busy}>{busy ? <LoaderCircle className={styles.spin} /> : "更新"}</button></div>
      <div className={styles.list}>{jobs.length ? jobs.map((job) => <article key={job.id}><div className={styles.jobTop}><span data-status={job.status}>{LABEL[job.status] ?? job.status}</span><small>上限 ${(job.budgetUsdCents / 100).toFixed(2)}{job.approvalExpiresAt && job.status === "approval_required" ? ` · ${new Date(job.approvalExpiresAt).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}まで` : ""}</small></div><button className={styles.auditButton} onClick={()=>void loadAudit(job)}><ScrollText />{job.title}</button><ol>{job.steps.map((step) => <li key={step.id}><span>{step.phase === "confirm" ? "確認" : step.phase === "draft" ? "下書き" : "参照"}</span>{step.action}{step.input?.body ? <blockquote>{step.input.body}</blockquote> : null}{step.input?.title ? <blockquote>{step.input.title}</blockquote> : null}</li>)}</ol>{job.status === "approval_required" ? <div className={styles.actions}><button onClick={() => void decide(job, "approved")}><Check />この内容で実行</button><button onClick={() => void decide(job, "denied")}><X />取消</button></div> : null}{job.status === "queued" || job.status === "running" ? <button className={styles.cancel} onClick={() => void cancel(job)}>実行を取り消す</button> : null}{job.status === "failed" && (job.attempts ?? 0) < (job.maxAttempts ?? 3) ? <button className={styles.cancel} onClick={() => void retry(job)}>再試行する</button> : null}{job.hubIntentRunId && (job.status === "completed" || job.status === "failed") ? <button className={styles.cancel} onClick={() => void syncIntentResult(job)}>Hubへ結果を反映</button> : null}</article>) : <div className={styles.empty}><Play /><strong>実行中の仕事はありません</strong><span>Chatで依頼すると計画と状態が表示されます。</span></div>}</div>{auditRows.length?<div className={styles.audit}><strong>監査・進捗</strong>{auditRows.map((row,index)=><div key={`${row.createdAt}-${index}`}><span>{row.stage??row.eventType}</span><small>{row.statusCategory} · {new Date(row.createdAt).toLocaleString("ja-JP")}</small></div>)}</div>:null}</section>
    <section><div className={styles.heading}><div><h2>プロジェクト資料</h2><p>AI専用領域へ保存し、このプロジェクトだけで使います。</p></div><button onClick={() => input.current?.click()}><Upload />追加</button><input ref={input} hidden multiple type="file" onChange={(event) => { void upload(event.target.files); event.currentTarget.value = ""; }} /></div><div className={styles.documents}>{documents.length ? documents.map((document) => <div key={document.id}><FileText /><span><strong>{document.name}</strong><small>{document.characters.toLocaleString()}文字</small></span><button aria-label={`${document.name}を削除`} onClick={() => void removeDocument(document)}><Trash2 /></button></div>) : <p>保存済みの資料はありません。</p>}</div></section>
    <section><div className={styles.heading}><div><h2>権限</h2><p>公開・送信・支払いは「毎回確認」または「拒否」だけです。</p></div><ShieldCheck /></div><div className={styles.permissions}>{permissions.map((permission)=>{const consequential=permission.scope.startsWith("publish:")||permission.scope==="approve:message-send"||permission.scope==="propose:purchase"||permission.scope==="authorize:payment";return <label key={permission.scope}><span>{permission.scope}</span><select value={permission.decision} onChange={(event)=>void updatePermission(permission.scope,event.target.value as Permission["decision"])}>{!consequential?<option value="allow">許可</option>:null}<option value="ask">毎回確認</option><option value="deny">拒否</option></select></label>;})}</div></section>
    <section><div className={styles.heading}><div><h2>下書きと成果物</h2><p>公開前の編集領域と、会話から独立した保存領域です。</p></div><Package /></div><div className={styles.draftComposer}><textarea value={draftText} onChange={(event)=>setDraftText(event.target.value)} placeholder="下書きを入力"/><button disabled={!draftText.trim()} onClick={()=>void createDraft()}><Save />下書き保存</button></div><div className={styles.documents}>{drafts.map((draft)=><div key={draft.id}><FileText/><span><strong>{draft.title||draft.kind}</strong><small>{draft.status} · {draft.content.slice(0,60)}</small></span><button onClick={()=>void removeDraft(draft.id)}><Trash2/></button></div>)}{artifacts.map((artifact)=><div key={artifact.id}><Package/><span><strong>{artifact.name}</strong><small>{artifact.kind} · {artifact.mimeType}</small></span><button onClick={()=>void removeArtifact(artifact.id)}><Trash2/></button></div>)}</div></section>
    <section><div className={styles.heading}><div><h2>モデル成績</h2><p>評価、成功率、速度を分野別に集計します。</p></div></div><div className={styles.scores}>{scores.length?scores.map((score)=><div key={`${score.providerId}-${score.toolId}`}><strong>{score.providerId}</strong><span>{score.toolId}</span><small>{score.rating??"-"}/5 · {score.successes}/{score.samples}成功 · {score.latencyMs??"-"}ms</small></div>):<p>評価データはまだありません。</p>}</div></section>
    <section><div className={styles.heading}><div><h2>外部接続</h2><p>読み取り範囲を選び、書き込みは常に確認します。</p></div></div><AiConnectorSettings compact /></section>
    {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
  </div>;
}
