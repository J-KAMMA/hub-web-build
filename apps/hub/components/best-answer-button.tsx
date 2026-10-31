"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function BestAnswerButton({ threadId, postId, selected }: { threadId: string; postId: string; selected: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");

  const update = () => {
    setError("");
    startTransition(async () => {
      const response = await fetch(`/api/bbs/threads/${threadId}/best-answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ post_id: selected ? null : postId })
      });
      if (!response.ok) {
        setError("採用する回答を更新できませんでした。");
        return;
      }
      router.refresh();
    });
  };

  return <span className="best-answer-control">
    <button type="button" onClick={update} disabled={isPending}>{selected ? "回答の採用を解除" : "この回答を採用"}</button>
    {error && <small role="alert">{error}</small>}
  </span>;
}
