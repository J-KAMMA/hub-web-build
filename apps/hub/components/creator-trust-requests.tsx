"use client";

import React, {
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import styles from "./creator-center.module.css";

type TrustRequest = {
  id: string;
  evidenceLabel: string;
  requestType: "dispute" | "correction" | "revocation";
  status: "pending" | "in_review" | "accepted" | "rejected" | "cancelled";
  resolutionNote: string;
  createdAt: string;
};

const evidenceOptions = [
  { value: "publishing:vault:Vault公開実績", label: "公開活動 · Vault公開実績" },
  { value: "publishing:hub:公開した投稿", label: "公開活動 · Hubの投稿" },
  { value: "commerce:commerce:完了した取引", label: "取引 · 完了した取引" },
  { value: "work:commerce:納品完了・相互評価", label: "仕事 · 納品完了・相互評価" },
  { value: "work:listings:公開中の依頼・サービス", label: "仕事 · 公開中の依頼・サービス" },
  { value: "community:hub:運営コミュニティ", label: "コミュニティ · 運営実績" },
  { value: "monetization:hub:収益分配", label: "収益化 · 収益分配" },
] as const;

const requestTypeLabel = {
  dispute: "判断への異議申立て",
  correction: "表示内容の訂正",
  revocation: "証明の失効依頼",
} as const;

const statusLabel: Record<TrustRequest["status"], string> = {
  pending: "受付済み",
  in_review: "確認中",
  accepted: "対応済み",
  rejected: "変更なし",
  cancelled: "取り下げ",
};

async function responseJson(response: Response) {
  return response.json().catch(() => null) as Promise<{
    requests?: TrustRequest[];
    request?: TrustRequest;
    error?: string;
  } | null>;
}

export function CreatorTrustRequests() {
  const [requests, setRequests] = useState<TrustRequest[]>([]);
  const [historyState, setHistoryState] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const mounted = useRef(false);
  const historyRequest = useRef(0);
  const historyLoading = useRef(false);
  const mutationRunning = useRef(false);
  const invalidateHistory = () => {
    historyRequest.current += 1;
    historyLoading.current = false;
  };

  const load = useCallback(async () => {
    if (!mounted.current || historyLoading.current) return false;
    historyLoading.current = true;
    const request = ++historyRequest.current;
    if (mounted.current) setHistoryState("loading");
    try {
      const response = await fetch("/api/creator/trust-requests", {
        credentials: "same-origin",
        headers: { accept: "application/json" },
      });
      if (!mounted.current || request !== historyRequest.current) return false;
      const payload = await responseJson(response);
      if (!mounted.current || request !== historyRequest.current) return false;
      if (!response.ok || !Array.isArray(payload?.requests)) throw new Error("history_unavailable");
      setRequests(payload.requests);
      setHistoryState("ready");
      return true;
    } catch {
      if (mounted.current && request === historyRequest.current) setHistoryState("error");
      return false;
    } finally {
      if (request === historyRequest.current) historyLoading.current = false;
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => { mounted.current = false; };
  }, [load]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mounted.current || busy || mutationRunning.current) return;
    const target = event.currentTarget;
    const form = new FormData(target);
    const [context, sourceService, evidenceLabel] =
      String(form.get("evidence") ?? "").split(":");
    setBusy(true);
    setMessage("");
    invalidateHistory();
    let mutationSucceeded = false;
    mutationRunning.current = true;
    try {
      const response = await fetch("/api/creator/trust-requests", {
        method: "POST",
        credentials: "same-origin",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({
          context,
          sourceService,
          evidenceLabel,
          requestType: String(form.get("requestType") ?? ""),
          message: String(form.get("reason") ?? "").trim(),
        }),
      });
      if (!mounted.current) return;
      const payload = await responseJson(response);
      if (!mounted.current) return;
      if (!response.ok) {
        throw new Error(
          payload?.error === "active_trust_request_exists"
            ? "同じ対象の確認中申請があります。"
            : "申請を受け付けられませんでした。",
        );
      }
      mutationSucceeded = true;
      target.reset();
      await load();
      if (mounted.current) setMessage("申請を受け付けました。状態はこの画面で確認できます。");
    } catch (cause) {
      if (mounted.current) setMessage(cause instanceof Error ? cause.message : "申請できませんでした。");
    } finally {
      mutationRunning.current = false;
      if (mounted.current) {
        setBusy(false);
        if (!mutationSucceeded) void load();
      }
    }
  }

  async function cancel(id: string) {
    if (!mounted.current || busy || mutationRunning.current) return;
    setBusy(true);
    setMessage("");
    invalidateHistory();
    let mutationSucceeded = false;
    mutationRunning.current = true;
    try {
      const response = await fetch("/api/creator/trust-requests", {
        method: "DELETE",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!mounted.current) return;
      if (!response.ok) throw new Error("申請を取り下げられませんでした。");
      mutationSucceeded = true;
      await load();
      if (mounted.current) setMessage("申請を取り下げました。");
    } catch (cause) {
      if (mounted.current) setMessage(cause instanceof Error ? cause.message : "申請を取り下げられませんでした。");
    } finally {
      mutationRunning.current = false;
      if (mounted.current) {
        setBusy(false);
        if (!mutationSucceeded) void load();
      }
    }
  }

  return (
    <section className={styles.trustRequests} id="trust-requests">
      <header>
        <h3>訂正・異議申立て</h3>
        <p>
          表示に誤りがある場合や証明を失効させたい場合に申請できます。
          外部サービスの契約ID、購入履歴、ウォレットはHubへ送信しないでください。
        </p>
      </header>
      <form onSubmit={submit}>
        <label>
          対象
          <select defaultValue={evidenceOptions[0].value} name="evidence" required>
            {evidenceOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label>
          申請内容
          <select defaultValue="correction" name="requestType" required>
            {Object.entries(requestTypeLabel).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <label className={styles.trustRequestReason}>
          確認してほしい内容
          <textarea
            maxLength={2000}
            minLength={20}
            name="reason"
            placeholder="誤っている表示と、正しい状態を確認できる情報を記入してください"
            required
          />
        </label>
        <button disabled={busy} type="submit">申請する</button>
      </form>
      {message ? <p aria-live="polite" className={styles.trustRequestMessage}>{message}</p> : null}
      <div className={styles.trustRequestHistory} aria-live="polite">
        <h4>申請履歴</h4>
        {historyState === "loading" ? <p role="status">申請履歴を読み込んでいます。</p> : null}
        {historyState === "error" ? <p role="alert">申請履歴を確認できませんでした。<button disabled={busy} onClick={() => void load()} type="button">再試行</button></p> : null}
        {historyState === "ready" && requests.length === 0 ? <p>申請履歴はありません。</p> : null}
        {requests.length > 0 ? (
          <div>
          {requests.map((item) => (
            <article key={item.id}>
              <div>
                <strong>{item.evidenceLabel}</strong>
                <span>{requestTypeLabel[item.requestType]}</span>
              </div>
              <small>
                {new Date(item.createdAt).toLocaleString("ja-JP")}
                {" · "}
                {statusLabel[item.status]}
              </small>
              {item.resolutionNote ? <p>{item.resolutionNote}</p> : null}
              {item.status === "pending" ? (
                <button disabled={busy} onClick={() => void cancel(item.id)} type="button">
                  取り下げる
                </button>
              ) : null}
            </article>
          ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
