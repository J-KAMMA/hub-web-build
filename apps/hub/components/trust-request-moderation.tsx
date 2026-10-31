"use client";

import { useCallback, useEffect, useState } from "react";

import styles from "./moderation-workspace.module.css";

type TrustRequest = {
  id: string;
  context: string;
  sourceService: string;
  evidenceLabel: string;
  requestType: string;
  message: string;
  status: string;
  resolutionNote: string;
  createdAt: string;
};

const TYPE_LABELS: Record<string, string> = {
  dispute: "異議申立て",
  correction: "訂正",
  revocation: "失効",
};

export function TrustRequestModeration() {
  const [requests, setRequests] = useState<TrustRequest[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState("読み込み中…");

  const load = useCallback(async () => {
    const response = await fetch("/api/admin/trust-requests", { cache: "no-store" });
    const payload = await response.json().catch(() => ({})) as {
      requests?: TrustRequest[];
      error?: string;
    };
    if (!response.ok) {
      setMessage(payload.error ?? "申請を取得できませんでした。");
      return;
    }
    setRequests(payload.requests ?? []);
    setMessage(payload.requests?.length ? "" : "申請はありません。");
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function review(id: string, action: "start_review" | "accept" | "reject") {
    setBusyId(id);
    setMessage("");
    const response = await fetch("/api/admin/trust-requests", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action, note: notes[id] ?? "" }),
    });
    const payload = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) {
      setMessage(payload.error ?? "申請を処理できませんでした。");
      setBusyId("");
      return;
    }
    await load();
    setBusyId("");
  }

  return <section className={styles.shell}>
    <header className={styles.header}>
      <div>
        <h1>信頼情報の申請</h1>
        <p>証明の異議申立て、訂正、失効申請を確認します。</p>
      </div>
      <div className={styles.headerActions}>
        <a href="/admin/moderation">通報管理へ戻る</a>
      </div>
    </header>
    {message ? <div className={styles.empty} role="status">{message}</div> : null}
    <section className={styles.list}>
      {requests.map((request) => <article className={styles.card} key={request.id}>
        <div className={styles.cardHead}>
          <div>
            <span className={styles.reason}>{TYPE_LABELS[request.requestType] ?? request.requestType}</span>
            <span className={styles.status}>{request.status}</span>
          </div>
          <time>{new Date(request.createdAt).toLocaleString("ja-JP")}</time>
        </div>
        <h2>{request.evidenceLabel}</h2>
        <p>{request.context}・{request.sourceService}</p>
        <div className={styles.body}>{request.message}</div>
        {request.resolutionNote ? <div className={styles.resolution}>
          <strong>対応記録</strong><p>{request.resolutionNote}</p>
        </div> : null}
        {["pending", "in_review"].includes(request.status) ? <div className={styles.controls}>
          <label>
            対応記録
            <textarea
              value={notes[request.id] ?? ""}
              onChange={(event) => setNotes((current) => ({ ...current, [request.id]: event.target.value }))}
              maxLength={1000}
              placeholder="判断理由と必要な次の対応"
            />
          </label>
          <div>
            {request.status === "pending" ? <button disabled={busyId === request.id} onClick={() => void review(request.id, "start_review")}>審査を開始</button> : null}
            <button disabled={busyId === request.id} onClick={() => void review(request.id, "reject")}>却下</button>
            <button disabled={busyId === request.id} onClick={() => void review(request.id, "accept")}>承認</button>
          </div>
        </div> : null}
      </article>)}
    </section>
  </section>;
}
