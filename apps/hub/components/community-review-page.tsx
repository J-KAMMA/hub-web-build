"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { UiButton, UiConfirmationDialog, UiLinkButton, UiStatePanel } from "@/components/ui/primitives";

type Review = { communityId: string; name: string; description: string; category: string; reason: string; requesterName: string; createdAt: string };
export default function CommunityReviewPage() {
  const [requests, setRequests] = useState<Review[]>([]); const [error, setError] = useState(""); const [loading, setLoading] = useState(true);
  const [accessRestricted, setAccessRestricted] = useState(false);
  const [pending, setPending] = useState<{ item: Review; decision: "approve" | "reject" } | null>(null);
  const [busy, setBusy] = useState(false);
  const reviewInFlight = useRef(false);
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError("");
    setAccessRestricted(false);
    try {
      const response = await fetch("/api/community-verification", { signal });
      const payload = await response.json().catch(() => null);
      if (response.status === 403) {
        setRequests([]);
        setPending(null);
        setAccessRestricted(true);
        return;
      }
      if (!response.ok) throw new Error(payload?.error || "審査待ちを取得できませんでした。");
      setRequests(Array.isArray(payload?.requests) ? payload.requests : []);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setError(cause instanceof Error ? cause.message : "審査待ちを取得できませんでした。");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  const review = async () => {
    if (!pending || reviewInFlight.current) return;
    reviewInFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/community-verification", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ communityId: pending.item.communityId, decision: pending.decision }),
      });
      const payload = await response.json().catch(() => null);
      if (response.status === 403) {
        setRequests([]);
        setPending(null);
        setAccessRestricted(true);
        return;
      }
      if (!response.ok) throw new Error(payload?.error || "審査結果を保存できませんでした。");
      setPending(null);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "審査結果を保存できませんでした。");
    } finally {
      reviewInFlight.current = false;
      setBusy(false);
    }
  };
  return <section className="community-review-page"><header><h1>コミュニティ認証審査</h1></header>
    {accessRestricted ? <UiStatePanel
      state="forbidden"
      title="この審査画面へのアクセスを確認できませんでした"
      description="コミュニティ認証審査はHub運営者のみ利用できます。運営者アカウントでログインし直すか、権限が反映された後に再確認してください。"
      action={<div className="ui-state-actions">
        <UiLinkButton href="/v2/auth?next=%2Fv2%2Fcommunity%2Freview" tone="primary">運営者アカウントでログイン</UiLinkButton>
        <UiButton type="button" onClick={() => void load()}>アクセスを再確認</UiButton>
        <UiLinkButton href="/v2/community">コミュニティへ戻る</UiLinkButton>
      </div>}
    /> : <>
      {error ? <UiStatePanel state="error" title="審査情報を処理できませんでした" description={error} action={<UiButton type="button" onClick={() => void load()}>再試行</UiButton>} /> : null}
      {loading && !error ? <UiStatePanel state="loading" title="審査待ちを読み込んでいます" /> : null}
      {!loading ? requests.map((item) => <article key={item.communityId}><div><strong>{item.name}</strong><small>{item.category}・申請者 {item.requesterName}</small><p>{item.description}</p><blockquote>{item.reason}</blockquote></div><span><UiButton tone="danger" onClick={() => setPending({ item, decision: "reject" })}>却下</UiButton><UiButton tone="primary" onClick={() => setPending({ item, decision: "approve" })}>認証</UiButton></span></article>) : null}
      {!loading && !error && requests.length === 0 ? <UiStatePanel state="empty" title="審査待ちはありません" description="新しい申請が届くとここに表示されます。" /> : null}
      {pending ? <UiConfirmationDialog
        title={pending.decision === "approve" ? "このコミュニティを認証しますか？" : "この申請を却下しますか？"}
        description={<p><strong>{pending.item.name}</strong>への判断は公開状態と申請者の利用可否に影響します。</p>}
        danger={pending.decision === "reject"}
        cancel={<UiButton type="button" onClick={() => setPending(null)} disabled={busy}>戻る</UiButton>}
        confirm={<UiButton type="button" tone={pending.decision === "approve" ? "primary" : "danger"} pending={busy} pendingLabel="処理中…" onClick={() => void review()}>{pending.decision === "approve" ? "認証を確定" : "却下を確定"}</UiButton>}
      /> : null}
    </>}
  </section>;
}
