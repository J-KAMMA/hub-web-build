"use client";

import { useState, useTransition } from "react";

export function ThreadSummaryReportButton({ threadId }: { threadId: string }) {
  const [reported, setReported] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  return <div className="thread-summary-report">
    <button type="button" disabled={pending || reported} onClick={() => {
      const details = window.prompt("読み方ガイドの誤りや不足を教えてください（任意）", "") ?? "";
      setError("");
      startTransition(async () => {
        const response = await fetch(`/api/bbs/threads/${threadId}/summary-report`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ details }),
        });
        if (response.ok) setReported(true);
        else {
          const payload = await response.json().catch(() => ({})) as { error?: string };
          setError(payload.error ?? "報告できませんでした。");
        }
      });
    }}>{reported ? "報告しました" : "ガイドの誤りを報告"}</button>
    {error && <small role="status">{error}</small>}
  </div>;
}
