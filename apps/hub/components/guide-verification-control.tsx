"use client";

import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";

type VerificationForm = { gameVersion: string; difficulty: string; dlc: string; modEnvironment: string; sourceUrl: string; note: string };
type VerificationStatus = "unverified" | "verified" | "recheck_required";
const FORM_FIELDS: Record<keyof VerificationForm, string> = { gameVersion: "ゲームバージョン（必須）", difficulty: "難易度", dlc: "DLC", modEnvironment: "MOD環境", sourceUrl: "出典URL", note: "確認メモ" };
const emptyForm = (gameVersion = ""): VerificationForm => ({ gameVersion, difficulty: "", dlc: "", modEnvironment: "", sourceUrl: "", note: "" });

export function GuideVerificationControl({ communityId, pageId, status = "unverified", count = 0, gameVersion }: { communityId: string; pageId: string; status?: VerificationStatus; count?: number; gameVersion?: string }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<VerificationForm>(() => emptyForm(gameVersion ?? ""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState(false);
  const mounted = useRef(false); const pageEpoch = useRef(0); const requestId = useRef(0); const requestBusy = useRef(false);
  const triggerRef = useRef<HTMLButtonElement>(null); const dialogRef = useRef<HTMLElement>(null); const restoreTriggerFocus = useRef(false);
  const dialogTitleId = useId();
  const pageKey = `${communityId}/${pageId}`; const receiptPage = useRef<string | null>(null); const receiptCount = useRef(0); const incomingVersion = useRef(gameVersion ?? "");
  const incomingStatus = useRef(status);
  const receiptStatus = useRef(status);
  const receiptVersion = useRef(gameVersion ?? "");

  useEffect(() => {
    mounted.current = true; pageEpoch.current += 1; requestId.current += 1; requestBusy.current = false;
    setOpen(false); setBusy(false); setError(null); setReceipt(false); receiptPage.current = null; setForm(emptyForm(gameVersion ?? "")); incomingVersion.current = gameVersion ?? "";
    receiptCount.current = 0;
    incomingStatus.current = status;
    return () => { mounted.current = false; pageEpoch.current += 1; requestId.current += 1; };
  }, [communityId, pageId]);
  useEffect(() => {
    const next = gameVersion ?? "";
    const previous = incomingVersion.current;
    if (previous !== next) {
      incomingVersion.current = next;
      pageEpoch.current += 1;
      requestId.current += 1;
      requestBusy.current = false;
      receiptPage.current = null;
      receiptCount.current = 0;
      setReceipt(false);
      setBusy(false);
      setError(null);
      setForm((held) => held.gameVersion === previous ? { ...held, gameVersion: next } : held);
    }
  }, [gameVersion]);
  useEffect(() => {
    if (incomingStatus.current === status) return;
    incomingStatus.current = status;
    pageEpoch.current += 1;
    requestId.current += 1;
    requestBusy.current = false;
    setBusy(false);
    setError(null);
    setReceipt(false);
  }, [status]);
  useEffect(() => {
    if (open) {
      dialogRef.current?.querySelector<HTMLInputElement>("input")?.focus();
    } else if (restoreTriggerFocus.current) {
      triggerRef.current?.focus();
      restoreTriggerFocus.current = false;
    }
  }, [open]);

  const invalidate = () => { pageEpoch.current += 1; requestId.current += 1; requestBusy.current = false; setBusy(false); };
  const close = () => { invalidate(); restoreTriggerFocus.current = true; setOpen(false); };
  const handleDialogKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])") ?? [])
      .filter((element) => element.tabIndex >= 0);
    const first = focusable[0]; const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  async function verify() {
    if (requestBusy.current || !mounted.current || !form.gameVersion.trim()) return;
    const submitted = { ...form, gameVersion: form.gameVersion.trim() }; const epoch = pageEpoch.current; const id = ++requestId.current;
    const current = () => mounted.current && pageEpoch.current === epoch && requestId.current === id;
    requestBusy.current = true; setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/communities/${communityId}/guides/${pageId}/verify`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(submitted) });
      if (!current()) return;
      if (!response.ok) { setError("検証を記録できませんでした。"); return; }
      const body = await response.json().catch(() => null) as { verified?: unknown } | null;
      if (!current()) return;
      if (response.status !== 200 || body?.verified !== true) { setError("検証記録の送信結果を確認できませんでした。"); return; }
      receiptPage.current = pageKey;
      receiptStatus.current = status;
      receiptVersion.current = gameVersion ?? "";
      receiptCount.current = Math.max(count, receiptCount.current) + 1;
      setReceipt(true);
      close();
    } catch { if (current()) setError("検証記録の送信結果を確認できませんでした。"); }
    finally { if (current()) { requestBusy.current = false; setBusy(false); } }
  }
  const localSuccess = receipt && receiptPage.current === pageKey
    && receiptStatus.current === status && receiptVersion.current === (gameVersion ?? "");
  const currentStatus = localSuccess ? "verified" : status;
  const displayedCount = localSuccess ? Math.max(count, receiptCount.current) : count;
  return <div className="guide-verification-control"><button ref={triggerRef} type="button" data-status={currentStatus} onClick={() => { setError(null); setOpen(true); }}>{currentStatus === "verified" ? `検証済み ${displayedCount}` : currentStatus === "recheck_required" ? "再検証が必要" : "未検証"}</button>{open && <div className="community-modal-backdrop" role="presentation"><section ref={dialogRef} className="community-modal guide-verification-dialog" role="dialog" aria-modal="true" aria-labelledby={dialogTitleId} onKeyDown={handleDialogKeyDown}><header><div><span>VERIFY GUIDE</span><h2 id={dialogTitleId}>攻略を検証</h2></div><button type="button" aria-label="閉じる" onClick={close}>×</button></header><p>実際に確認した環境を記録します。</p>{Object.entries(FORM_FIELDS).map(([key, label]) => <label key={key}><span>{label}</span><input value={form[key as keyof VerificationForm]} onChange={(event) => setForm((held) => ({ ...held, [key]: event.target.value }))} /></label>)}{error ? <p role="alert">{error}</p> : null}<footer><button type="button" onClick={close}>キャンセル</button><button type="button" className="community-modal__primary" disabled={busy || !form.gameVersion.trim()} onClick={() => { void verify(); }}>{busy ? "検証を記録中…" : "検証を記録"}</button></footer></section></div>}</div>;
}
