"use client";

import { useState } from "react";

export function ThreadCategoryOperations({ mockCount, reportThreshold }: { mockCount: number; reportThreshold: number }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const act = async (action: "archive_mocks" | "restore_mocks") => {
    setBusy(true);
    const response = await fetch("/api/admin/moderation/thread-categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const payload = await response.json().catch(() => ({})) as { changed?: number; error?: string };
    setMessage(response.ok ? `${payload.changed ?? 0}件を更新しました。` : payload.error ?? "更新できませんでした。");
    setBusy(false);
  };
  const setThreshold = async (value: number) => {
    setBusy(true);
    const response = await fetch("/api/admin/moderation/thread-categories", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "set_report_threshold", value }) });
    setMessage(response.ok ? `自動非表示の基準を${value}件に変更しました。` : "基準を更新できませんでした。");
    setBusy(false);
  };
  return <section className="thread-category-operations">
    <h2>開発モック管理</h2>
    <p>識別可能なモックスレッドが{mockCount}件あります。実ユーザーの投稿は変更しません。</p>
    <div><button type="button" disabled={busy} onClick={() => void act("archive_mocks")}>一覧から退避</button><button type="button" disabled={busy} onClick={() => void act("restore_mocks")}>再表示</button></div>
    {message ? <p role="status">{message}</p> : null}
    <h3>通報の誤検知調整</h3>
    <p>信頼済み利用者からの通報が一定数そろった場合だけ、自動的に確認待ちへ移します。</p>
    <label>自動非表示の基準
      <select defaultValue={reportThreshold} disabled={busy} onChange={(event) => void setThreshold(Number(event.target.value))}>
        {[3, 4, 5, 6, 8, 10].map((value) => <option value={value} key={value}>{value}件</option>)}
      </select>
    </label>
  </section>;
}
