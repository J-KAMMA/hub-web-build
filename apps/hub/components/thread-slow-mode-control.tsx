"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

const OPTIONS = [
  { value: 0, label: "オフ" },
  { value: 30, label: "30秒" },
  { value: 60, label: "1分" },
  { value: 300, label: "5分" },
  { value: 900, label: "15分" },
  { value: 3600, label: "1時間" },
];

export function ThreadSlowModeControl({ threadId, initialSeconds }: { threadId: string; initialSeconds: number }) {
  const router = useRouter();
  const [seconds, setSeconds] = useState(initialSeconds);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const update = (next: number) => {
    setError("");
    startTransition(async () => {
      const response = await fetch(`/api/bbs/threads/${threadId}/slow-mode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seconds: next }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "スローモードを更新できませんでした。");
        return;
      }
      setSeconds(next);
      router.refresh();
    });
  };

  return <div className="thread-slow-mode-control">
    <label htmlFor="thread-slow-mode">スローモード</label>
    <select id="thread-slow-mode" value={seconds} onChange={(event) => update(Number(event.target.value))} disabled={pending}>
      {OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
    </select>
    <small>{pending ? "更新中…" : seconds ? `同じ人は${OPTIONS.find((item) => item.value === seconds)?.label}ごとに返信できます` : "連投間隔の制限なし"}</small>
    {error && <span className="inline-error" role="alert">{error}</span>}
  </div>;
}
