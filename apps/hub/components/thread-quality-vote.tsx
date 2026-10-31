"use client";

import { useState } from "react";

const DIMENSIONS = [
  ["helpful", "参考になる", 1],
  ["primary_source", "一次情報", 1],
  ["outdated", "古い情報", -1],
] as const;

export function ThreadQualityVote({ threadId, postId, authenticated }: { threadId: string; postId: string; authenticated: boolean }) {
  const [scores, setScores] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState("");
  const vote = async (dimension: string, value: number) => {
    if (!authenticated) {
      const next = `${location.pathname}${location.search}${location.hash}`;
      location.href = `/auth?next=${encodeURIComponent(next)}`;
      return;
    }
    setBusy(dimension);
    const response = await fetch(`/api/bbs/threads/${threadId}/knowledge-platform`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "quality_vote", postId, dimension, value }),
    });
    if (response.ok) {
      const payload = await response.json() as { scores: Array<{ dimension: string; score: number }> };
      setScores(Object.fromEntries(payload.scores.map((item) => [item.dimension, Number(item.score)])));
    }
    setBusy("");
  };
  return <div className="thread-quality-vote" aria-label="レスの品質を評価">
    {DIMENSIONS.map(([dimension, label, value]) =>
      <button type="button" disabled={Boolean(busy)} aria-pressed={Boolean(scores[dimension])} onClick={() => void vote(dimension, value)} key={dimension}>
        {label}{scores[dimension] ? <b>{scores[dimension] > 0 ? ` +${scores[dimension]}` : ` ${scores[dimension]}`}</b> : null}
      </button>,
    )}
  </div>;
}
