"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function ThreadManagementPanel({ threadId, status }: { threadId: string; status: "open" | "closed" | "archived" }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const updateStatus = (nextStatus: "open" | "closed" | "archived") => startTransition(async () => {
    const response = await fetch(`/api/bbs/threads/${threadId}/status`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: nextStatus }) });
    const payload = await response.json().catch(() => ({})) as { error?: string };
    setMessage(response.ok ? "スレッド状態を更新しました。" : payload.error ?? "更新できませんでした。");
    if (response.ok) router.refresh();
  });
  return <details className="thread-management-panel">
    <summary>スレッド管理</summary>
    <div className="thread-management-panel__body">
      <div><strong>受付状態</strong><span>{status === "open" ? "返信受付中" : status === "closed" ? "受付終了" : "過去ログ"}</span></div>
      <div className="thread-management-panel__actions">
        <button type="button" onClick={() => updateStatus("open")} disabled={pending || status === "open"}>受付を再開</button>
        <button type="button" onClick={() => updateStatus("closed")} disabled={pending || status === "closed"}>受付を終了</button>
        <button type="button" onClick={() => updateStatus("archived")} disabled={pending || status === "archived"}>過去ログ化</button>
      </div>
      {message && <p role="status">{message}</p>}
    </div>
  </details>;
}
