"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ThreadWorkflowState } from "@/lib/thread-knowledge";

const STATES: Array<{ value: ThreadWorkflowState; label: string }> = [
  { value: "open", label: "受付中" },
  { value: "resolved", label: "解決済み" },
  { value: "closed", label: "終了" },
];

export function ThreadWorkflowControl({ threadId, initial }: { threadId: string; initial: ThreadWorkflowState }) {
  const router = useRouter();
  const normalized = STATES.some((item) => item.value === initial) ? initial : "open";
  const [state, setState] = useState<ThreadWorkflowState>(normalized);
  const [pending, startTransition] = useTransition();
  return <details className="thread-workflow-details">
    <summary>状態を変更</summary>
    <label className="thread-workflow-control">状態
      <select value={state} disabled={pending} onChange={(event) => {
        const next = event.target.value as ThreadWorkflowState;
        setState(next);
        startTransition(async () => {
          const response = await fetch(`/api/bbs/threads/${threadId}/workflow`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state: next }) });
          if (response.ok) router.refresh(); else setState(normalized);
        });
      }}>{STATES.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select>
    </label>
  </details>;
}
