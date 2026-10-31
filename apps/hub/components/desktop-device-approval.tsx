"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Review = { label: string; thumbprint: string; expiresAt: string; approved: boolean };
type Phase = "loading" | "ready" | "approved" | "auth" | "expired" | "error";

function shortFingerprint(value: string) {
  return value.match(/.{1,8}/g)?.join(" ") ?? value;
}

export function DesktopDeviceApproval({ requestId }: { requestId: string }) {
  const [phase, setPhase] = useState<Phase>(requestId ? "loading" : "error");
  const [review, setReview] = useState<Review | null>(null);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState(requestId ? "" : "端末登録リクエストが見つかりません。");
  const [busy, setBusy] = useState(false);
  const [reviewAttempt, setReviewAttempt] = useState(0);
  const submitting = useRef(false);
  const requestEpoch = useRef(0);
  const authHref = useMemo(() => `/auth?reauth=1&next=${encodeURIComponent(`/account/desktop?request=${requestId}`)}`, [requestId]);

  useEffect(() => {
    requestEpoch.current += 1;
    setReview(null);
    setCode("");
    setMessage(requestId ? "" : "端末登録リクエストが見つかりません。");
    setPhase(requestId ? "loading" : "error");
    if (!requestId) return;
    let active = true;
    const controller = new AbortController();
    void fetch(`/account/api/v1/desktop/device-requests/${requestId}/review`, {
      credentials: "same-origin", cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
    }).then(async (response) => {
      const body = await response.json().catch(() => null) as (Review & { error?: string }) | null;
      if (!active) return;
      if (response.status === 401) { setPhase("auth"); return; }
      if (response.status === 410) { setPhase("expired"); return; }
      if (!response.ok || !body || typeof body.label !== "string" || !body.label.trim() || [...body.label].length > 48
        || /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(body.label)
        || typeof body.thumbprint !== "string" || !/^[0-9a-f]{64}$/.test(body.thumbprint)
        || typeof body.expiresAt !== "string" || !Number.isFinite(Date.parse(body.expiresAt))
        || typeof body.approved !== "boolean") throw new Error("review_unavailable");
      if (Date.parse(body.expiresAt) <= Date.now()) { setPhase("expired"); return; }
      setReview(body);
      setPhase("ready");
      if (body.approved) setMessage("端末の登録は確認済みです。Hubへの接続を完了するには、同じ4桁のコードを入力してください。");
    }).catch(() => {
      if (active) { setMessage("端末情報を確認できませんでした。承認は行われていません。"); setPhase("error"); }
    });
    return () => { active = false; controller.abort(); requestEpoch.current += 1; };
  }, [requestId, reviewAttempt]);

  async function approve() {
    if (submitting.current || phase !== "ready" || !review || !/^\d{4}$/.test(code)) return;
    const epoch = requestEpoch.current;
    if (!window.confirm(`次の端末をAccountへ登録します。\n\n端末: ${review.label}\n鍵の指紋: ${shortFingerprint(review.thumbprint)}\n\n登録後、この端末は短時間のHub Desktop認証票を取得できます。続けますか？`)) return;
    submitting.current = true;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/account/api/v1/desktop/device-requests/${requestId}`, {
        method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
        body: JSON.stringify({ userCode: code }), signal: AbortSignal.timeout(15_000),
      });
      const body = await response.json().catch(() => null) as { error?: string; linkAssertion?: string } | null;
      if (epoch !== requestEpoch.current) return;
      if (response.status === 401 || body?.error === "recent_authentication_required") { setPhase("auth"); return; }
      if (response.status === 410) { setPhase("expired"); return; }
      if (!response.ok || typeof body?.linkAssertion !== "string") throw new Error(body?.error ?? "approval_failed");
      const linked = await fetch("/api/auth/account/desktop-link", {
        method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
        body: JSON.stringify({ assertion: body.linkAssertion }), signal: AbortSignal.timeout(15_000),
      });
      if (epoch !== requestEpoch.current) return;
      const result = await linked.json().catch(() => null) as { linked?: unknown } | null;
      if (epoch !== requestEpoch.current) return;
      if (!linked.ok || result?.linked !== true) throw new Error("hub_profile_link_failed");
      setPhase("approved");
      setCode("");
      setMessage("この端末を登録しました。Hub Desktopへ戻ると自動的に確認されます。");
    } catch (error) {
      if (epoch !== requestEpoch.current) return;
      const reason = error instanceof Error ? error.message : "approval_failed";
      setMessage(reason === "request_not_found" || reason === "invalid_user_code"
        ? "確認コードが一致しません。Desktopに表示された4桁を確認してください。"
        : reason === "request_locked"
          ? "確認コードの試行回数を超えました。Hub Desktopから新しい登録要求を作成してください。"
        : reason === "hub_link_required"
          ? "先にAccountでHubプロフィールを連携してください。端末はまだ登録されていません。"
          : reason === "hub_profile_link_failed"
            ? "Accountへの端末登録は完了しましたが、現在のHubプロフィールへの接続は完了していません。Hubへログインした状態で同じコードを再入力してください。"
            : "端末を登録できませんでした。完了状態を確認してから再試行してください。");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return <section className="hub-account__section" aria-labelledby="desktop-approval-title">
    <header><div><h2 id="desktop-approval-title">この端末からの要求を確認</h2><p>要求元と鍵の指紋を確認してから登録します。</p></div></header>
    {phase === "loading" ? <div className="settings-note" aria-busy="true"><strong>端末情報を確認中…</strong></div> : null}
    {phase === "auth" ? <div className="settings-note"><strong>もう一度ログインしてください</strong><p>端末を接続する前に、ログインして本人確認を行います。</p><a href={authHref}>ログインへ進む</a></div> : null}
    {phase === "expired" ? <div className="settings-note" role="alert"><strong>この要求は期限切れです</strong><p>Hub Desktopから新しい登録コードを作成してください。</p></div> : null}
    {phase === "error" ? <div className="settings-note" role="alert"><strong>承認できません</strong><p>{message}</p>{requestId ? <button type="button" className="button" onClick={() => setReviewAttempt(value => value + 1)}>端末情報を再確認</button> : null}</div> : null}
    {(phase === "ready" || phase === "approved") && review ? <div className="settings-note">
      <strong>{review.label}</strong>
      <p>鍵の指紋</p><code>{shortFingerprint(review.thumbprint)}</code>
      <small>有効期限: {new Date(review.expiresAt).toLocaleString("ja-JP")}</small>
      {phase === "ready" ? <>
        <label>Desktopに表示された4桁の確認コード<input inputMode="numeric" autoComplete="one-time-code" maxLength={4} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 4))} /></label>
        <button type="button" className="button" disabled={busy || !/^\d{4}$/.test(code)} onClick={() => void approve()}>{busy ? "登録中…" : "内容を確認して端末を登録"}</button>
      </> : <><strong role="status">登録済み</strong><button type="button" className="button" onClick={() => history.back()}>Hub Desktopへ戻る</button></>}
      {message ? <p role="status" aria-live="polite">{message}</p> : null}
    </div> : null}
  </section>;
}
