"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import type { ThreadModerationReportView, ThreadPostReport } from "@/lib/domain";
import styles from "./moderation-workspace.module.css";

const REASON_LABELS: Record<ThreadModerationReportView["reason"], string> = {
  harassment: "嫌がらせ・攻撃",
  spam: "スパム・宣伝",
  privacy: "個人情報・プライバシー",
  misinformation: "危険な誤情報",
  other: "その他"
};

type UnifiedKind = "social_post" | "social_post_appeal" | "profile" | "appeal" | "copyright" | "video" | "music" | "work_listing" | "remote_flag" | "article_comment";
type PendingDecision =
  | { scope: "unified"; kind: UnifiedKind; id: string; action: string; target: string }
  | {
      scope: "thread";
      kind: "thread";
      id: string;
      action: string;
      target: string;
      input: Record<string, string>;
      operationId: string;
    }
  | {
      scope: "recovery";
      kind: "moderation_security";
      id: "recovery_codes";
      action: "rotate_recovery_codes";
      target: string;
      operationId: string;
    };
type DecisionReceipt = {
  auditId: string;
  action: string;
  kind: string;
  targetId: string;
  confirmedAt: string;
  replayed?: boolean;
  affected?: number;
};

function decisionCopy(action: string) {
  if (action === "rotate_recovery_codes") return { title: "復旧コードを再生成する", impact: "既存の復旧コード10件をすべて無効にし、新しい10件へ置き換えます。新しいコードは一度だけ表示されます。", destructive: true };
  if (action === "archive_stale") return { title: "対象スレッドを過去ログ化する", impact: "受付終了から180日以上経過した対象を一括で過去ログ化します。通常の一覧には表示されなくなります。", destructive: true };
  if (action === "freeze") return { title: "スレッドを凍結する", impact: "スレッドへの新しい投稿を停止します。操作履歴から解除できます。", destructive: true };
  if (action === "unfreeze") return { title: "スレッドの凍結を解除する", impact: "利用者が再びスレッドへ投稿できる状態に戻します。", destructive: false };
  if (action === "hide") return { title: "対象を非表示にする", impact: "対象は利用者から見えなくなります。後から管理画面で復元できます。", destructive: true };
  if (action === "suspend") return { title: "プロフィールを凍結する", impact: "対象者はHubを利用できなくなり、異議申立てのみ利用できます。", destructive: true };
  if (action === "restore" || action === "accept") return { title: "表示・利用を復元する", impact: "対象は再び利用者から閲覧または利用できる状態になります。", destructive: false };
  if (action === "reject") return { title: "申立てを棄却する", impact: "現在の制限を維持し、判断理由を申立者へ通知します。", destructive: true };
  return { title: "通報を処理する", impact: "この通報を処理済みにします。対象コンテンツの現在の公開状態は維持されます。", destructive: false };
}

export function ModerationWorkspace({ authenticated }: { authenticated: boolean }) {
  const router = useRouter();
  const [reports, setReports] = useState<ThreadModerationReportView[]>([]);
  const [status, setStatus] = useState<ThreadPostReport["status"] | "all">("open");
  const [loading, setLoading] = useState(authenticated);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [unified,setUnified]=useState<Array<{id:string;kind:UnifiedKind;reason:string;details:string;status:string;createdAt:string;targetId:string;preview:string}>>([]);
  const [staleThreadCount, setStaleThreadCount] = useState(0);
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [pendingDecision, setPendingDecision] = useState<PendingDecision | null>(null);
  const [decisionNote, setDecisionNote] = useState("");
  const [receipt, setReceipt] = useState<DecisionReceipt | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/moderation/reports?status=${status}`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({})) as { reports?: ThreadModerationReportView[]; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "通報一覧を取得できませんでした。");
      setReports(payload.reports ?? []);
      const unifiedResponse=await fetch(`/api/admin/moderation/unified?status=${status}`,{cache:"no-store"});
      if(unifiedResponse.ok)setUnified(((await unifiedResponse.json()) as {reports?:typeof unified}).reports??[]);
      const threadResponse=await fetch("/api/admin/moderation/threads",{cache:"no-store"});
      if(threadResponse.ok){
        const threadPayload=(await threadResponse.json()) as {staleThreadCount?:number};
        setStaleThreadCount(Number(threadPayload.staleThreadCount??0));
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "通報一覧を取得できませんでした。");
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => { if (authenticated) void load(); }, [authenticated, load]);
  useEffect(() => {
    if (!pendingDecision) return;
    const cancel = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyId) {
        setPendingDecision(null);
        setDecisionNote("");
      }
    };
    document.addEventListener("keydown", cancel);
    return () => document.removeEventListener("keydown", cancel);
  }, [pendingDecision, busyId]);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/admin/moderation/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(useRecoveryCode
        ? { key: form.get("key"), recoveryCode: form.get("recoveryCode") }
        : { key: form.get("key"), totp: form.get("totp") })
    });
    const payload = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) return setError(payload.error ?? "認証できませんでした。");
    router.refresh();
  }

  async function logout() {
    await fetch("/api/admin/moderation/session", { method: "DELETE" });
    router.refresh();
  }

  async function generateRecoveryCodes() {
    setDecisionNote("");
    setReceipt(null);
    setPendingDecision({
      scope:"recovery",
      kind:"moderation_security",
      id:"recovery_codes",
      action:"rotate_recovery_codes",
      target:"管理者用の使い捨て復旧コード10件",
      operationId:crypto.randomUUID()
    });
  }

  async function moderate(reportId: string, action: "resolve" | "dismiss" | "hide", note: string) {
    setBusyId(reportId);
    setError("");
    try {
      const response = await fetch(`/api/admin/moderation/reports/${reportId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, note })
      });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "通報を処理できませんでした。");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "通報を処理できませんでした。");
    } finally {
      setBusyId("");
    }
  }
  function moderateUnified(kind:UnifiedKind,id:string,action:string){
    const item=unified.find((candidate)=>candidate.kind===kind&&candidate.id===id);
    setDecisionNote("");
    setPendingDecision({scope:"unified",kind,id,action,target:item?.preview||item?.targetId||id});
  }
  function requestThreadDecision(
    action:string,
    target:string,
    input:Record<string,string>={}
  ){
    setDecisionNote("");
    setReceipt(null);
    setPendingDecision({
      scope:"thread",
      kind:"thread",
      id:input.requestId??input.threadId??action,
      action,
      target,
      input,
      operationId:crypto.randomUUID()
    });
  }
  async function confirmDecision(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(!pendingDecision||decisionNote.trim().length<5)return;
    setBusyId(pendingDecision.id);setError("");setReceipt(null);
    try{
      const isThread=pendingDecision.scope==="thread";
      const isRecovery=pendingDecision.scope==="recovery";
      const response=await fetch(isThread
        ?"/api/admin/moderation/threads"
        :isRecovery
          ?"/api/admin/moderation/recovery-codes"
          :`/api/admin/moderation/unified/${pendingDecision.kind}/${pendingDecision.id}`,{
          method:"PATCH",headers:{"Content-Type":"application/json"},
          ...(isRecovery?{method:"POST"}:{}),
          body:JSON.stringify(isThread?{
              action:pendingDecision.action,
              note:decisionNote.trim(),
              operationId:pendingDecision.operationId,
              ...pendingDecision.input,
            }:isRecovery?{
              note:decisionNote.trim(),
              operationId:pendingDecision.operationId
            }:{
              action:pendingDecision.action,
              note:decisionNote.trim()
            }),
        });
      const payload=await response.json().catch(()=>({})) as {error?:string;receipt?:DecisionReceipt;codes?:string[]};
      if(!response.ok)throw new Error(payload.error||"処理できませんでした。");
      if(payload.receipt)setReceipt(payload.receipt);
      if(isRecovery){
        if(payload.receipt?.replayed){
          setError("同じ再生成要求はすでに処理済みです。安全のため復旧コードは再表示しません。必要ならもう一度再生成してください。");
        }else if(payload.codes?.length===10){
          setRecoveryCodes(payload.codes);
        }else{
          throw new Error("新しい復旧コードを受け取れませんでした。");
        }
      }
      setPendingDecision(null);setDecisionNote("");await load();
    }catch(cause){setError(cause instanceof Error?cause.message:"処理できませんでした.");}
    finally{setBusyId("");}
  }

  if (!authenticated) return <section className={styles.loginShell}>
    <form className={styles.loginCard} onSubmit={login}>
      <span className={styles.eyebrow}>スレッド管理</span>
      <h1>スレッド管理</h1>
      <p>管理キーで認証してください。キーはブラウザへ保存されません。</p>
      {error && <div className={styles.error} role="alert">{error}</div>}
      <label htmlFor="moderation-key">管理キー</label>
      <input id="moderation-key" name="key" type="password" minLength={16} autoComplete="current-password" required />
      {useRecoveryCode ? <>
        <label htmlFor="moderation-recovery-code">使い捨て復旧コード</label>
        <input id="moderation-recovery-code" name="recoveryCode" autoComplete="one-time-code" required />
      </> : <>
        <label htmlFor="moderation-totp">Google Authenticatorコード</label>
        <input id="moderation-totp" name="totp" inputMode="numeric" pattern="[0-9]{6}" autoComplete="one-time-code" required />
      </>}
      <button type="button" onClick={() => setUseRecoveryCode((current) => !current)}>
        {useRecoveryCode ? "Google Authenticatorを使う" : "復旧コードを使う"}
      </button>
      <button type="submit">認証する</button>
      <a href="/bbs">スレッドへ戻る</a>
    </form>
  </section>;

  return <section className={styles.shell}>
    <header className={styles.header}>
      <div><span className={styles.eyebrow}>スレッド管理</span><h1>通報キュー</h1><p>本文と通報理由を確認してから処理します。</p></div>
      <div className={styles.headerActions}><a href="/admin/moderation/copyright">著作権の申告</a><a href="/admin/moderation/video-safety">動画の審査と通報</a><a href="/admin/moderation/trust-requests">信頼情報の申請</a><a href="/bbs">スレッドを見る</a><button type="button" onClick={logout}>ログアウト</button></div>
    </header>
    <nav className={styles.filters} aria-label="通報状態">
      {(["open", "resolved", "dismissed", "all"] as const).map((value) => <button key={value} type="button" className={status === value ? styles.active : ""} onClick={() => setStatus(value)}>{value === "open" ? "未処理" : value === "resolved" ? "対応済み" : value === "dismissed" ? "問題なし" : "すべて"}</button>)}
    </nav>
    {error && <div className={styles.error} role="alert">{error}</div>}
    {receipt ? <div className={styles.receipt} role="status">
      <strong>処理が確定しました</strong>
      <span>{receipt.kind} · {receipt.action}</span>
      <code>監査番号 {receipt.auditId}</code>
      <time dateTime={receipt.confirmedAt}>{new Date(receipt.confirmedAt).toLocaleString()}</time>
      {typeof receipt.affected==="number"?<span>{receipt.affected}件を処理</span>:null}
      {receipt.replayed?<span>同じ操作の再送を検出し、重複処理を防止しました。</span>:null}
    </div> : null}
    {pendingDecision ? <div className={styles.dialogBackdrop}>
      <form className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="moderation-decision-title" onSubmit={confirmDecision}>
        <span className={styles.eyebrow}>操作の確認</span>
        <h2 id="moderation-decision-title">{decisionCopy(pendingDecision.action).title}</h2>
        <p>{decisionCopy(pendingDecision.action).impact}</p>
        <dl className={styles.dialogSummary}>
          <div><dt>対象</dt><dd>{pendingDecision.target}</dd></div>
          <div><dt>操作</dt><dd>{pendingDecision.action}</dd></div>
        </dl>
        <label htmlFor="moderation-decision-note">判断理由
          <textarea id="moderation-decision-note" value={decisionNote} onChange={(event)=>setDecisionNote(event.target.value)}
            minLength={5} maxLength={1000} autoFocus required
            placeholder="確認した事実と判断理由を5文字以上で記入" />
        </label>
        <p className={styles.dialogNotice}>理由は監査記録へ保存され、処分対象者へ表示される場合があります。</p>
        <div className={styles.dialogActions}>
          <button type="button" disabled={busyId===pendingDecision.id} onClick={()=>{setPendingDecision(null);setDecisionNote("");}}>キャンセル</button>
          <button type="submit" className={decisionCopy(pendingDecision.action).destructive?styles.danger:""} disabled={busyId===pendingDecision.id||decisionNote.trim().length<5}>
            {busyId===pendingDecision.id?"処理中…":decisionCopy(pendingDecision.action).title}
          </button>
        </div>
      </form>
    </div> : null}
    <section className={styles.list} aria-label="管理者の復旧設定">
      <article className={styles.card}>
        <strong>使い捨て復旧コード</strong>
        <p>スマホを紛失した場合に備えます。再生成すると以前のコードはすべて無効になります。</p>
        <button type="button" onClick={() => void generateRecoveryCodes()}>新しい復旧コードを生成</button>
        {recoveryCodes.length > 0 ? <div role="status">
          <p><strong>この画面を閉じると再表示できません。安全な場所へ保存してください。</strong></p>
          <pre>{recoveryCodes.join("\n")}</pre>
        </div> : null}
      </article>
    </section>
    <section className={styles.list} aria-label="スレッド運営"><article className={styles.card}><strong>長期運用</strong><p>受付終了から180日以上経過したスレッドを過去ログ化します。</p><p><strong>現在の対象: {staleThreadCount}件</strong></p><button type="button" disabled={staleThreadCount===0} onClick={()=>requestThreadDecision("archive_stale",`過去ログ化の対象 ${staleThreadCount}件`)}>対象を過去ログ化</button></article></section>
    {loading ? <div className={styles.empty}>読み込み中…</div> : reports.length === 0 ? <div className={styles.empty}>該当する通報はありません。</div> : <section className={styles.list}>
      {reports.map((report) => <ReportCard key={report.id} report={report} busy={busyId === report.id} onModerate={moderate} onFreezeThread={(threadId, threadTitle) => requestThreadDecision("freeze", threadTitle, { threadId })} />)}
    </section>}
    {unified.length?<section className={styles.list} aria-label="投稿・プロフィール・仕事掲載・異議申し立て">{unified.map((item)=><article className={styles.card} key={`${item.kind}:${item.id}`}><div className={styles.cardHead}><div><span className={styles.reason}>{item.kind}</span><span className={styles.status}>{item.status}</span></div><time>{new Date(item.createdAt).toLocaleString()}</time></div>{item.kind==="work_listing"?<a className={styles.threadLink} href={`/work?q=${encodeURIComponent(item.preview)}`}><strong>{item.preview}</strong></a>:<strong>{item.preview}</strong>}<p>{item.reason} · {item.details}</p>{item.status==="open"?<div className={styles.controls}><div>{item.kind==="social_post"?<><button disabled={busyId===item.id} onClick={()=>void moderateUnified(item.kind,item.id,"dismiss")}>この通報を却下</button><button disabled={busyId===item.id} onClick={()=>void moderateUnified(item.kind,item.id,"restore")}>問題なし・復元</button><button className={styles.danger} disabled={busyId===item.id} onClick={()=>void moderateUnified(item.kind,item.id,"hide")}>違反として非表示</button></>:item.kind==="social_post_appeal"?<><button disabled={busyId===item.id} onClick={()=>void moderateUnified(item.kind,item.id,"reject")}>非表示を維持</button><button disabled={busyId===item.id} onClick={()=>void moderateUnified(item.kind,item.id,"accept")}>申立てを承認・復元</button></>:item.kind==="profile"?<><button disabled={busyId===item.id} onClick={()=>void moderateUnified(item.kind,item.id,"dismiss")}>問題なし</button><button className={styles.danger} disabled={busyId===item.id} onClick={()=>void moderateUnified(item.kind,item.id,"suspend")}>プロフィールを凍結</button></>:item.kind==="work_listing"?<><button disabled={busyId===item.id} onClick={()=>void moderateUnified(item.kind,item.id,"dismiss")}>問題なし</button><button disabled={busyId===item.id} onClick={()=>void moderateUnified(item.kind,item.id,"resolve")}>確認済みにする</button><button className={styles.danger} disabled={busyId===item.id} onClick={()=>void moderateUnified(item.kind,item.id,"hide")}>掲載を非公開</button></>:item.kind==="remote_flag"?<><button disabled={busyId===item.id} onClick={()=>void moderateUnified(item.kind,item.id,"dismiss")}>問題なし</button><button className={styles.danger} disabled={busyId===item.id} onClick={()=>void moderateUnified(item.kind,item.id,"hide")}>投稿を非表示</button></>:item.kind==="article_comment"?<><button disabled={busyId===item.id} onClick={()=>void moderateUnified(item.kind,item.id,"dismiss")}>問題なし</button><button className={styles.danger} disabled={busyId===item.id} onClick={()=>void moderateUnified(item.kind,item.id,"remove")}>コメントを削除</button></>:item.kind==="music"?<><button disabled={busyId===item.id} onClick={()=>void moderateUnified(item.kind,item.id,"dismiss")}>問題なし</button><button disabled={busyId===item.id} onClick={()=>void moderateUnified(item.kind,item.id,"resolve")}>確認済みにする</button></>:<><button disabled={busyId===item.id} onClick={()=>void moderateUnified(item.kind,item.id,"reject")}>却下</button><button disabled={busyId===item.id} onClick={()=>void moderateUnified(item.kind,item.id,"accept")}>解除を承認</button></>}</div></div>:null}</article>)}</section>:null}
  </section>;
}

/*
 * 凍結はここに置く。以前はカテゴリ移動申請のカードの中にしか無く、申請を
 * 廃止した時点で「進行中の荒れを止める唯一の手段」に到達できなくなった。
 * 通報を見ている場所なら、対象スレッドが目の前にありIDの手入力も要らない。
 */
function ReportCard({ report, busy, onModerate, onFreezeThread }: {
  report: ThreadModerationReportView;
  busy: boolean;
  onModerate: (id: string, action: "resolve" | "dismiss" | "hide", note: string) => Promise<void>;
  onFreezeThread: (threadId: string, threadTitle: string) => void;
}) {
  const [note, setNote] = useState(report.resolutionNote ?? "");
  return <article className={styles.card}>
    <div className={styles.cardHead}>
      <div><span className={styles.reason}>{REASON_LABELS[report.reason]}</span><span className={styles.status}>{report.status}</span></div>
      <time>{new Date(report.createdAt).toLocaleString()}</time>
    </div>
    <a className={styles.threadLink} href={`/threads/${report.threadId}#post-${report.postNo}`}>{report.threadTitle} › レス {report.postNo}</a>
    <dl className={styles.meta}><div><dt>投稿者</dt><dd>{report.authorDisplayName}</dd></div><div><dt>通報者</dt><dd>{report.reporterDisplayName}</dd></div></dl>
    <div className={styles.body}>{report.postDeletedAt ? "投稿者により削除済み" : report.postModeratedAt ? "運営により非表示済み" : report.postBody}</div>
    {report.details && <div className={styles.details}><strong>通報者の補足</strong><p>{report.details}</p></div>}
    {report.status === "open" ? <div className={styles.controls}>
      <label>運営メモ<textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} placeholder="判断理由や対応内容" /></label>
      <div><button type="button" disabled={busy} onClick={() => onModerate(report.id, "dismiss", note)}>問題なし</button><button type="button" disabled={busy} onClick={() => onModerate(report.id, "resolve", note)}>対応済みにする</button><button type="button" className={styles.danger} disabled={busy} onClick={() => onModerate(report.id, "hide", note)}>投稿を非表示</button><button type="button" className={styles.danger} disabled={busy} onClick={() => onFreezeThread(report.threadId, report.threadTitle)}>スレッドを凍結</button></div>
    </div> : <div className={styles.resolution}><strong>運営メモ</strong><p>{report.resolutionNote || "メモなし"}</p></div>}
  </article>;
}
