"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Folder = "inbox" | "sent" | "archive" | "trash" | "spam" | "drafts";
type Mailbox = { id: string; address: string; localPart: string; domain: string; closedAt?: string | null; purgeAfter?: string | null };
type MailSummary = { id: string; direction: "inbound" | "outbound"; folder: string; sender: string; recipient: string; subject: string; textBody: string; readAt: string | null; createdAt: string };
type MailAttachment = { id: string; filename: string; mediaType: string; byteSize: number; scanStatus: string };
type MailDetail = MailSummary & { threadId: string; attachments?: MailAttachment[] };
type MailDraft = { id: string; to: string; subject: string; text: string; inReplyTo: string | null; updatedAt: string };
type SendPreview = { id: string; to: string; subject: string; text: string; status: "awaiting_confirmation"; expiresAt: string; isReply: boolean };
type SendAttempt = { preview: SendPreview; idempotencyKey: string; replyToId: string | null; draftKey: string; status: "ready" | "unknown" };
type SendDelivery = { previewId: string; state: "awaiting_confirmation" | "confirmed" | "failed" | "expired" | "unknown"; terminal: boolean; canConfirm: boolean; requiresReconciliation: boolean };

class MailApiError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) {
    super(message);
  }
}

const folderLabels: Record<Folder, string> = { inbox: "受信", sent: "送信済み", drafts: "下書き", archive: "アーカイブ", trash: "ゴミ箱", spam: "迷惑メール" };

async function accountAssertion() {
  const options: RequestInit = { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: "{}" };
  let response = await fetch("/account/api/v1/assertions/mail", options);
  if (response.status === 403) {
    const link = await fetch("/account/api/v1/links/mail", options);
    if (!link.ok) throw new Error(link.status === 403 ? "本人確認後にメールを有効にしてください。" : "メールをAccountへ接続できませんでした。");
    response = await fetch("/account/api/v1/assertions/mail", options);
  }
  const body = await response.json().catch(() => null) as { assertion?: unknown } | null;
  if (!response.ok || typeof body?.assertion !== "string") throw new Error(response.status === 401 ? "Accountへログインしてください。" : "メール認証を取得できませんでした。");
  return body.assertion;
}

async function mailApi<T>(path: string, init?: RequestInit): Promise<T> {
  const assertion = await accountAssertion();
  const response = await fetch(`/mail/api${path}`, { ...init, cache: "no-store", headers: { authorization: `Bearer ${assertion}`, ...(init?.body ? { "content-type": "application/json" } : {}), ...init?.headers } });
  const body = await response.json().catch(() => null) as ({ error?: string } & T) | null;
  if (!response.ok) {
    const code = body?.error ?? "mail_request_failed";
    const errors: Record<string, string> = {
      mailbox_required: "先にメールアドレスを作成してください。",
      mailbox_closed: "このメールボックスは閉じています。送信や下書きの保存はできません。",
      reopen_window_closed: "閉じてから30日が過ぎたため、開け直せません。メールは削除されます。",
      address_unavailable: "このアドレスは使用されています。",
      confirmation_required: "送信前の確認が必要です。",
      delivery_failed: "メールを送信できませんでした。時間をおいて再試行してください。",
      delivery_status_unknown: "送信済みの可能性があります。送信状況を確認してから再試行してください。",
      outbound_disabled: "メール送信は現在利用できません。",
      preview_already_used: "この確認内容はすでに処理されています。",
      preview_expired: "送信前の確認が期限切れです。内容を確認し直してください。",
      preview_mismatch: "送信前の確認内容が現在の返信先と一致しません。",
      preview_not_found: "送信前の確認内容が見つかりません。内容を確認し直してください。",
      preview_unavailable: "送信内容を確認できませんでした。内容を確認して再試行してください。",
      send_rate_limited: "送信回数が上限に達しました。時間をおいて再試行してください。",
    };
    throw new MailApiError(code, response.status, errors[code] ?? "メールを読み込めませんでした。");
  }
  return body as T;
}

// 添付のダウンロードは Bearer assertion が要るので素のリンクでは届かない。
// 取得して blob 経由で保存する。
async function mailDownload(path: string) {
  const assertion = await accountAssertion();
  const response = await fetch(`/mail/api${path}`, { cache: "no-store", headers: { authorization: `Bearer ${assertion}` } });
  if (!response.ok) throw new Error(response.status === 404 ? "添付ファイルが見つかりません。" : "添付ファイルを取得できませんでした。");
  return response.blob();
}

function draftKey(replyToId: string | null, to: string, subject: string, text: string) {
  return JSON.stringify({ replyToId, to, subject, text });
}

function isSendPreview(value: unknown): value is SendPreview {
  if (!value || typeof value !== "object") return false;
  const preview = value as Partial<SendPreview>;
  return typeof preview.id === "string" && /^[0-9a-f-]{36}$/i.test(preview.id)
    && typeof preview.to === "string" && typeof preview.subject === "string" && typeof preview.text === "string"
    && preview.status === "awaiting_confirmation" && typeof preview.expiresAt === "string"
    && Number.isFinite(Date.parse(preview.expiresAt)) && typeof preview.isReply === "boolean";
}

function isSendDelivery(value: unknown): value is SendDelivery {
  if (!value || typeof value !== "object") return false;
  const delivery = value as Partial<SendDelivery>;
  return typeof delivery.previewId === "string" && typeof delivery.state === "string"
    && ["awaiting_confirmation", "confirmed", "failed", "expired", "unknown"].includes(delivery.state)
    && typeof delivery.terminal === "boolean" && typeof delivery.canConfirm === "boolean"
    && typeof delivery.requiresReconciliation === "boolean";
}

export function EmailWorkspace() {
  const [mailbox, setMailbox] = useState<Mailbox | null>(null);
  const [messages, setMessages] = useState<MailSummary[]>([]);
  const [drafts, setDrafts] = useState<MailDraft[]>([]);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [folder, setFolder] = useState<Folder>("inbox");
  const [selected, setSelected] = useState<MailDetail | null>(null);
  const [replyToId, setReplyToId] = useState<string | null>(null);
  const [localPart, setLocalPart] = useState("");
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  const [composing, setComposing] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [sendAttempt, setSendAttempt] = useState<SendAttempt | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [busy, setBusy] = useState(true);
  const [notice, setNotice] = useState("");
  const [confirmingClose, setConfirmingClose] = useState(false);
  const currentDraftKey = draftKey(replyToId, to, subject, text);
  const draftKeyRef = useRef(currentDraftKey);
  const previewRequestRef = useRef(0);
  draftKeyRef.current = currentDraftKey;
  const unresolvedNotice = "送信済みの可能性があります。送信状況を確認してから再試行してください。";

  const invalidatePreview = () => {
    previewRequestRef.current += 1;
    setPreviewing(false); setPreviewError(""); setSendAttempt(null); setBusy(false);
  };

  const closePreview = () => {
    if (busy) return;
    previewRequestRef.current += 1;
    const keepUnknown = sendAttempt?.status === "unknown";
    setPreviewing(false); setPreviewError("");
    setSendAttempt(keepUnknown ? sendAttempt : null);
    if (keepUnknown) setNotice(unresolvedNotice);
    setBusy(false);
  };

  const unresolvedAttempt = () => {
    if (sendAttempt?.status !== "unknown") return false;
    setPreviewing(true); setPreviewError(unresolvedNotice); setNotice(unresolvedNotice);
    return true;
  };

  const refreshMessages = useCallback(async (nextFolder: Folder) => {
    const result = await mailApi<{ messages: MailSummary[] }>(`/messages?folder=${nextFolder}`);
    setMessages(result.messages);
  }, []);

  // 下書きは MailDraft として別エンドポイントで管理する。
  const refreshDrafts = useCallback(async () => {
    const result = await mailApi<{ drafts: MailDraft[] }>("/drafts");
    setDrafts(result.drafts);
  }, []);

  useEffect(() => {
    let active = true;
    setBusy(true);
    mailApi<{ mailboxes: Mailbox[] }>("/mailboxes")
      .then(async (result) => { if (!active) return; setMailbox(result.mailboxes[0] ?? null); if (result.mailboxes[0]) await (folder === "drafts" ? refreshDrafts() : refreshMessages(folder)); })
      .catch((error) => active && setNotice(error instanceof Error ? error.message : "メールを読み込めませんでした。"))
      .finally(() => active && setBusy(false));
    return () => { active = false; };
  }, [folder, refreshMessages, refreshDrafts]);

  const createMailbox = async () => {
    setBusy(true); setNotice("");
    try { const result = await mailApi<{ mailbox: Mailbox }>("/mailboxes", { method: "POST", body: JSON.stringify({ localPart }) }); setMailbox(result.mailbox); setLocalPart(""); await refreshMessages("inbox"); }
    catch (error) { setNotice(error instanceof Error ? error.message : "アドレスを作成できませんでした。"); }
    finally { setBusy(false); }
  };

  // メールボックスを閉じる・開け直す。メールの中身は Mail が持ち、Hub は状態を表示するだけ。
  const closeMailbox = async () => {
    setBusy(true); setNotice("");
    try { const result = await mailApi<{ mailbox: Mailbox }>("/mailboxes/close", { method: "POST", body: JSON.stringify({ confirm: "close_mailbox" }) }); setMailbox(result.mailbox); setConfirmingClose(false); setComposing(false); }
    catch (error) { setNotice(error instanceof Error ? error.message : "メールボックスを閉じられませんでした。"); }
    finally { setBusy(false); }
  };

  const reopenMailbox = async () => {
    setBusy(true); setNotice("");
    try { const result = await mailApi<{ mailbox: Mailbox }>("/mailboxes/reopen", { method: "POST" }); setMailbox(result.mailbox); }
    catch (error) { setNotice(error instanceof Error ? error.message : "メールボックスを開け直せませんでした。"); }
    finally { setBusy(false); }
  };

  const openMessage = async (id: string) => {
    if (busy || unresolvedAttempt()) return;
    invalidatePreview(); setBusy(true); setNotice(""); setComposing(false);
    try { const result = await mailApi<{ message: MailDetail; attachments?: MailAttachment[] }>(`/messages/${id}`); setSelected({ ...result.message, attachments: result.attachments ?? [] }); if (!result.message.readAt) await mailApi(`/messages/${id}`, { method: "PATCH", body: JSON.stringify({ action: "read" }) }); }
    catch (error) { setNotice(error instanceof Error ? error.message : "メールを開けませんでした。"); }
    finally { setBusy(false); }
  };

  const discardCompose = () => {
    if (unresolvedAttempt()) return;
    invalidatePreview(); setTo(""); setSubject(""); setText(""); setReplyToId(null); setDraftId(null); setComposing(false);
  };

  const beginCompose = () => { if (unresolvedAttempt()) return; invalidatePreview(); setSelected(null); setReplyToId(null); setDraftId(null); setTo(""); setSubject(""); setText(""); setComposing(true); };
  const beginReply = () => {
    if (!selected) return;
    if (busy || unresolvedAttempt()) return;
    invalidatePreview();
    setReplyToId(selected.id); setDraftId(crypto.randomUUID()); setTo(selected.direction === "inbound" ? selected.sender : selected.recipient);
    setSubject(/^re:/i.test(selected.subject) ? selected.subject : `Re: ${selected.subject}`); setText(""); setComposing(true); setSelected(null);
  };

  // 下書きを開くと composer に内容を載せ、サーバー側の draft id を保持する。
  const openDraft = (draft: MailDraft) => {
    if (busy || unresolvedAttempt()) return;
    invalidatePreview(); setNotice(""); setSelected(null);
    setDraftId(draft.id); setReplyToId(draft.inReplyTo); setTo(draft.to); setSubject(draft.subject); setText(draft.text); setComposing(true);
  };

  const saveDraft = async () => {
    if (busy || sendAttempt?.status === "unknown") return;
    const id = draftId ?? crypto.randomUUID();
    setBusy(true); setNotice("");
    try {
      const result = await mailApi<{ draft?: { id?: string } }>(`/drafts/${id}`, { method: "PUT", body: JSON.stringify({ to, subject, text, inReplyTo: replyToId }) });
      if (result.draft?.id !== id) throw new Error("下書きの応答を確認できませんでした。");
      setDraftId(id); setNotice("下書きを保存しました。");
      if (folder === "drafts") await refreshDrafts().catch(() => undefined);
    } catch (error) { setNotice(error instanceof Error ? error.message : "下書きを保存できませんでした。"); }
    finally { setBusy(false); }
  };

  const deleteDraft = async (id: string) => {
    if (busy || sendAttempt?.status === "unknown") return;
    setBusy(true); setNotice("");
    try { await mailApi(`/drafts/${id}`, { method: "DELETE" }); if (draftId === id) setDraftId(null); await refreshDrafts(); }
    catch (error) { setNotice(error instanceof Error ? error.message : "下書きを削除できませんでした。"); }
    finally { setBusy(false); }
  };

  const previewSend = async () => {
    if (busy) return;
    const requestDraftKey = currentDraftKey;
    const existing = sendAttempt;
    if (existing?.status === "unknown" && existing.draftKey === requestDraftKey) {
      setPreviewError(unresolvedNotice);
      setPreviewing(true);
      return;
    }
    const requestId = ++previewRequestRef.current;
    setBusy(true); setNotice(""); setPreviewError(""); setSendAttempt(null); setPreviewing(true);
    try {
      const path = replyToId ? `/messages/${replyToId}/reply/preview` : "/messages/preview";
      const payload = replyToId ? { text } : { to, subject, text };
      const result = await mailApi<{ preview?: unknown }>(path, { method: "POST", body: JSON.stringify(payload) });
      if (previewRequestRef.current !== requestId || draftKeyRef.current !== requestDraftKey) return;
      if (!isSendPreview(result.preview) || Date.parse(result.preview.expiresAt) <= Date.now()) throw new Error("preview_invalid");
      setSendAttempt({ preview: result.preview, idempotencyKey: crypto.randomUUID(), replyToId, draftKey: requestDraftKey, status: "ready" });
    } catch (error) {
      if (previewRequestRef.current !== requestId || draftKeyRef.current !== requestDraftKey) return;
      setSendAttempt(null);
      setPreviewError(error instanceof MailApiError ? error.message : "送信内容を確認できませんでした。内容を確認して再試行してください。");
    } finally {
      if (previewRequestRef.current === requestId) setBusy(false);
    }
  };

  const finishAccepted = async (message: string) => {
    const sentDraftId = draftId;
    setTo(""); setSubject(""); setText(""); setReplyToId(null); setDraftId(null); setSendAttempt(null); setPreviewing(false); setComposing(false); setFolder("sent");
    // 送信が受理されたら対応する下書きは消す。失敗しても送信自体は成立しているので無視する。
    if (sentDraftId) await mailApi(`/drafts/${sentDraftId}`, { method: "DELETE" }).catch(() => undefined);
    try { await refreshMessages("sent"); setNotice(message); }
    catch { setNotice(`${message} 送信済み一覧を更新できませんでした。`); }
  };

  const checkSendStatus = async () => {
    if (busy) return;
    const attempt = sendAttempt;
    if (!attempt || attempt.status !== "unknown") return;
    setBusy(true); setNotice("");
    try {
      const result = await mailApi<{ delivery?: unknown }>(`/send-intents/${attempt.preview.id}/status`);
      if (!isSendDelivery(result.delivery) || result.delivery.previewId !== attempt.preview.id) throw new Error("status_invalid");
      if (result.delivery.state === "confirmed") { await finishAccepted("メールは送信済みです。"); return; }
      if (result.delivery.state === "awaiting_confirmation") {
        setSendAttempt((current) => current?.preview.id === attempt.preview.id ? { ...current, status: "ready" } : current);
        setPreviewError("送信前の確認が残っています。内容を確認して送信してください。");
        return;
      }
      if (result.delivery.state === "failed") {
        setSendAttempt(null); setPreviewError("メールを送信できませんでした。内容を確認して再試行してください。");
        return;
      }
      if (result.delivery.state === "expired") {
        setSendAttempt(null); setPreviewError("送信前の確認が期限切れです。内容を確認して再試行してください。");
        return;
      }
      setPreviewError(unresolvedNotice); setNotice(unresolvedNotice);
    } catch {
      setPreviewError(unresolvedNotice); setNotice(unresolvedNotice);
    } finally { setBusy(false); }
  };

  const confirmSend = async () => {
    if (busy) return;
    const attempt = sendAttempt;
    if (attempt?.status === "unknown") { setPreviewing(true); setPreviewError(unresolvedNotice); return; }
    if (!attempt || draftKeyRef.current !== attempt.draftKey) {
      invalidatePreview(); setNotice("内容が変更されたため、送信前の確認をやり直してください。");
      return;
    }
    if (Date.parse(attempt.preview.expiresAt) <= Date.now()) {
      setSendAttempt(null); setPreviewError("送信前の確認が期限切れです。内容を確認し直してください。"); setNotice("");
      return;
    }
    setBusy(true); setNotice("");
    try {
      const path = attempt.replyToId ? `/messages/${attempt.replyToId}/reply` : "/messages/send";
      const result = await mailApi<{ receipt?: { status?: string } }>(path, { method: "POST", body: JSON.stringify({ previewId: attempt.preview.id, idempotencyKey: attempt.idempotencyKey }) });
      if (result.receipt?.status !== "accepted") {
        setSendAttempt((current) => current?.preview.id === attempt.preview.id ? { ...current, status: "unknown" } : current);
        setPreviewError(unresolvedNotice);
        setNotice(unresolvedNotice);
        return;
      }
      await finishAccepted("送信を受け付けました。");
    } catch (error) {
      if (error instanceof MailApiError && ["confirmation_required", "preview_already_used", "preview_expired", "preview_mismatch", "preview_not_found"].includes(error.code)) {
        setSendAttempt(null); setPreviewError(error.message); setNotice("");
      } else {
        setSendAttempt((current) => current?.preview.id === attempt.preview.id ? { ...current, status: "unknown" } : current);
        setPreviewError(unresolvedNotice);
        setNotice(unresolvedNotice);
      }
    }
    finally { setBusy(false); }
  };

  const move = async (action: "archive" | "trash" | "spam" | "inbox") => {
    if (busy || sendAttempt?.status === "unknown" || !selected) return;
    setBusy(true);
    try { await mailApi(`/messages/${selected.id}`, { method: "PATCH", body: JSON.stringify({ action }) }); setSelected(null); await refreshMessages(folder); }
    catch (error) { setNotice(error instanceof Error ? error.message : "更新できませんでした。"); }
    finally { setBusy(false); }
  };
  const saveAttachment = async (item: MailAttachment) => {
    if (!selected || item.scanStatus !== "clean") return;
    setBusy(true);
    try {
      const blob = await mailDownload(`/messages/${selected.id}/attachments/${item.id}`);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = item.filename || "attachment";
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) { setNotice(error instanceof Error ? error.message : "添付ファイルを取得できませんでした。"); }
    finally { setBusy(false); }
  };

  if (!mailbox && !busy) return (
    <section className="email-workspace email-workspace--setup" aria-labelledby="mail-setup-title">
      <h2 id="mail-setup-title">Hubメールを始める</h2>
      <p>メールは独立したMailサービスで保管され、Hub内のDMとは分離されます。</p>
      <label><span>希望するメールアドレス</span><div className="email-workspace__address"><input value={localPart} onChange={(event) => setLocalPart(event.target.value.toLowerCase())} autoComplete="off" placeholder="jkamma" /><strong>@mail.jkamma.com</strong></div></label>
      <button type="button" onClick={createMailbox} disabled={busy || localPart.length < 3}>メールアドレスを作成</button>
      {notice ? <p role="alert" className="email-workspace__error">{notice}</p> : null}
    </section>
  );

  return (
    <section className={`email-workspace${selected || composing ? " email-workspace--reader-active" : ""}`} aria-label="Hubメール">
      <aside className="email-workspace__mailboxes">
        <div><strong>メール</strong><small>{mailbox?.address}</small></div>
        <button type="button" className="email-workspace__compose" onClick={() => { if (busy) return; beginCompose(); }} disabled={busy || Boolean(mailbox?.closedAt) || sendAttempt?.status === "unknown"}>新規作成</button>
        {(Object.keys(folderLabels) as Folder[]).map((item) => <button key={item} type="button" className={folder === item ? "is-active" : ""} disabled={busy || sendAttempt?.status === "unknown"} onClick={() => { if (busy || unresolvedAttempt()) return; invalidatePreview(); setFolder(item); setSelected(null); }}>{folderLabels[item]}</button>)}
        <div className="email-workspace__settings" aria-label="メールボックスの設定">
          {mailbox?.closedAt
            ? <><p>このメールボックスは閉じています。メールは届きません。{mailbox.purgeAfter ? `${new Date(mailbox.purgeAfter).toLocaleDateString("ja-JP")}に、` : ""}メール・添付ファイル・下書きを削除します。それまでは開け直せます。</p><button type="button" onClick={() => void reopenMailbox()} disabled={busy}>メールボックスを開け直す</button></>
            : <button type="button" className="email-workspace__close-mailbox" onClick={() => setConfirmingClose(true)} disabled={busy || sendAttempt?.status === "unknown"}>メールボックスを閉じる</button>}
        </div>
      </aside>
      <div className="email-workspace__list" aria-label={`${folderLabels[folder]}メール`}>
        <header><h2>{folderLabels[folder]}</h2><button type="button" onClick={() => void (folder === "drafts" ? refreshDrafts() : refreshMessages(folder))} disabled={busy}>更新</button></header>
        {busy && (folder === "drafts" ? drafts : messages).length === 0 ? <p className="email-workspace__empty">読み込み中</p> : null}
        {!busy && folder === "drafts" && drafts.length === 0 ? <p className="email-workspace__empty">下書きはありません</p> : null}
        {!busy && folder !== "drafts" && messages.length === 0 ? <p className="email-workspace__empty">メールはありません</p> : null}
        {folder === "drafts"
          ? drafts.map((item) => <div key={item.id} className="email-workspace__draft"><button type="button" className="email-workspace__message" disabled={busy || sendAttempt?.status === "unknown"} onClick={() => openDraft(item)}><span><strong>{item.to || "宛先なし"}</strong><time>{new Date(item.updatedAt).toLocaleString("ja-JP")}</time></span><b>{item.subject || "件名なし"}</b><small>{item.text}</small></button><button type="button" className="email-workspace__draft-delete" disabled={busy || sendAttempt?.status === "unknown"} onClick={() => void deleteDraft(item.id)}>削除</button></div>)
          : messages.map((item) => <button type="button" key={item.id} className={`email-workspace__message ${!item.readAt && item.direction === "inbound" ? "is-unread" : ""}`} disabled={busy || sendAttempt?.status === "unknown"} onClick={() => void openMessage(item.id)}><span><strong>{item.direction === "inbound" ? item.sender : item.recipient}</strong><time>{new Date(item.createdAt).toLocaleDateString("ja-JP")}</time></span><b>{item.subject}</b><small>{item.textBody}</small></button>)}
      </div>
      <article className="email-workspace__reader">
        {selected ? <><header><div><span>{selected.direction === "inbound" ? selected.sender : selected.recipient}</span><h2>{selected.subject}</h2><time>{new Date(selected.createdAt).toLocaleString("ja-JP")}</time></div><div><button type="button" className="email-workspace__back" onClick={() => setSelected(null)} disabled={busy || sendAttempt?.status === "unknown"}>一覧に戻る</button><button type="button" onClick={beginReply} disabled={busy || sendAttempt?.status === "unknown"}>返信</button><button type="button" onClick={() => void move("archive")} disabled={busy || sendAttempt?.status === "unknown"}>保管</button>{selected.direction === "inbound" && selected.folder !== "spam" ? <button type="button" onClick={() => void move("spam")} disabled={busy || sendAttempt?.status === "unknown"}>迷惑メール</button> : null}{selected.folder === "spam" || selected.folder === "trash" ? <button type="button" onClick={() => void move("inbox")} disabled={busy || sendAttempt?.status === "unknown"}>受信に戻す</button> : null}<button type="button" onClick={() => void move("trash")} disabled={busy || sendAttempt?.status === "unknown"}>削除</button></div></header><p className="email-workspace__body-text">{selected.textBody}</p>{selected.attachments?.length ? <ul className="email-workspace__attachments">{selected.attachments.map((item) => <li key={item.id}><span>{item.filename || "添付ファイル"}</span><small>{item.mediaType} · {Math.max(1, Math.round(item.byteSize / 1024)).toLocaleString("ja-JP")} KB</small>{item.scanStatus === "clean" ? <button type="button" onClick={() => void saveAttachment(item)} disabled={busy}>保存</button> : <em>{item.scanStatus === "pending" ? "安全検査中のためまだ受け取れません" : "検査を通らなかったため受け取れません"}</em>}</li>)}</ul> : null}</> : null}
        {composing ? <form className="email-workspace__composer" onSubmit={(event) => { event.preventDefault(); void previewSend(); }}><h2>{replyToId ? "返信" : "新しいメール"}</h2><label><span>宛先</span><input type="email" value={to} onChange={(event) => { if (busy || unresolvedAttempt()) return; invalidatePreview(); setTo(event.target.value); }} readOnly={Boolean(replyToId) || busy || sendAttempt?.status === "unknown"} required /></label><label><span>件名</span><input value={subject} onChange={(event) => { if (busy || unresolvedAttempt()) return; invalidatePreview(); setSubject(event.target.value); }} readOnly={Boolean(replyToId) || busy || sendAttempt?.status === "unknown"} maxLength={998} required /></label><label className="email-workspace__body"><span>本文</span><textarea value={text} onChange={(event) => { if (busy || unresolvedAttempt()) return; invalidatePreview(); setText(event.target.value); }} readOnly={busy || sendAttempt?.status === "unknown"} maxLength={100000} required /></label><footer><button type="button" onClick={discardCompose} disabled={busy || sendAttempt?.status === "unknown"}>破棄</button><button type="button" onClick={() => void saveDraft()} disabled={busy || sendAttempt?.status === "unknown"}>下書き保存</button><button type="submit" disabled={busy}>送信内容を確認</button></footer></form> : null}
        {!selected && !composing ? <div className="email-workspace__empty">メールを選択するか、新規作成してください</div> : null}
      </article>
      {previewing ? <div className="email-workspace__dialog-backdrop"><section role="dialog" aria-modal="true" aria-labelledby="mail-preview-title" className="email-workspace__dialog"><h2 id="mail-preview-title">送信前の確認</h2>{sendAttempt ? <><dl><div><dt>宛先</dt><dd>{sendAttempt.preview.to}</dd></div><div><dt>件名</dt><dd>{sendAttempt.preview.subject}</dd></div></dl><p>{sendAttempt.preview.text}</p><small>有効期限: {new Date(sendAttempt.preview.expiresAt).toLocaleString("ja-JP")}。送信すると相手へ送信され、取り消せません。</small>{previewError ? <p role="status">{previewError}</p> : null}</> : <p role="alert">{previewError || "送信内容を確認できませんでした。"}</p>}<footer><button type="button" onClick={closePreview} disabled={busy}>戻る</button>{sendAttempt ? <button type="button" onClick={() => void (sendAttempt.status === "unknown" ? checkSendStatus() : confirmSend())} disabled={busy}>{sendAttempt.status === "unknown" ? "送信状況を確認" : "この内容で送信"}</button> : null}</footer></section></div> : null}
      {confirmingClose && mailbox ? <div className="email-workspace__dialog-backdrop"><section role="dialog" aria-modal="true" aria-labelledby="mail-close-title" className="email-workspace__dialog"><h2 id="mail-close-title">メールボックスを閉じる</h2><div className="email-workspace__close-notice"><p>閉じると、{mailbox.address} はすぐにメールを受け取らなくなり、送信もできなくなります。</p><p>閉じてから30日たつと、受信と送信のメール、添付ファイル、下書きをすべて削除します。削除したものは元に戻せません。30日のあいだは開け直せます。</p><p>このアドレスは、削除したあとも、ご本人を含めて誰も使えません。</p></div><footer><button type="button" onClick={() => setConfirmingClose(false)} disabled={busy}>戻る</button><button type="button" onClick={() => void closeMailbox()} disabled={busy}>閉じる</button></footer></section></div> : null}
      {notice ? <p className="email-workspace__status" role="status">{notice}</p> : null}
    </section>
  );
}
