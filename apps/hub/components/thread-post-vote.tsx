"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import type { ThreadPostVoteKind, ThreadPostVoteSummary } from "@/lib/domain";
import { THREAD_VOTE_REASONS, type ThreadVoteReason } from "@/lib/thread-knowledge";

export function ThreadPostVote({ postId, initial, authenticated }: {
  postId: string;
  initial: ThreadPostVoteSummary;
  authenticated: boolean;
}) {
  const router = useRouter();
  const [summary, setSummary] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [reason, setReason] = useState<ThreadVoteReason | "">("");
  const [reasonOpen,setReasonOpen]=useState(false);

  const vote = (kind: ThreadPostVoteKind, reasonOverride?:ThreadVoteReason) => {
    if (!authenticated) {
      setError("評価するにはログインしてください。");
      return;
    }
    setError("");
    startTransition(async () => {
      const response = await fetch(`/api/bbs/thread-posts/${postId}/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, reason: kind === "down" ? (reasonOverride ?? reason) || undefined : undefined }),
      });
      const payload = await response.json().catch(() => ({})) as { summary?: ThreadPostVoteSummary; error?: string };
      if (!response.ok || !payload.summary) {
        setError(payload.error ?? "評価を更新できませんでした。");
        return;
      }
      setSummary(payload.summary);
      setReasonOpen(false);
      router.refresh();
    });
  };

  return <div className="thread-post-vote" aria-label="レスの評価" title="評価は正しさの保証ではなく、並び順や読み方ガイドの参考になります。規約違反はメニューから通報してください。">
    <button type="button" className={summary.viewerVote === "up" ? "thread-post-vote__active" : undefined} onClick={() => vote("up")} disabled={pending} aria-pressed={summary.viewerVote === "up"}>
      <span aria-hidden="true">↑</span> 高評価 <b>{summary.up}</b>
    </button>
    <button type="button" className={summary.viewerVote === "down" ? "thread-post-vote__active" : undefined} onClick={() => summary.viewerVote==="down"?vote("down"):setReasonOpen(true)} disabled={pending} aria-pressed={summary.viewerVote === "down"}>
      <span aria-hidden="true">↓</span> 低評価 <b>{summary.down}</b>
    </button>
    <span className="thread-post-vote__score">スコア {summary.score}</span>
    {reasonOpen&&<div className="thread-post-vote__reason" role="dialog" aria-label="低評価の理由"><strong>理由は公開されず、品質改善に使われます</strong>{THREAD_VOTE_REASONS.map(value=><button type="button" key={value} onClick={()=>{setReason(value);vote("down",value)}}>{value === "incorrect" ? "誤情報" : value === "unsupported" ? "根拠不足" : value === "off_topic" ? "話題違い" : "読みにくい"}</button>)}<button type="button" onClick={()=>vote("down")}>理由なし</button><button type="button" onClick={()=>setReasonOpen(false)}>キャンセル</button></div>}
    {error && <small role="status">{error}</small>}
  </div>;
}
