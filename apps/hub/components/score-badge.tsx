import React from "react";

interface ScoreBadgeProps {
  score: number;
  className?: string;
}

export function ScoreBadge({ score, className = "" }: ScoreBadgeProps) {
  if (score <= 0) return null;
  const level = score >= 100 ? "hot" : score >= 20 ? "rising" : "base";
  const formatted = new Intl.NumberFormat("ja-JP", { notation: score >= 10_000 ? "compact" : "standard" }).format(score);

  return (
    <span
      className={`score-badge score-badge--${level}${className ? ` ${className}` : ""}`}
      aria-label={`スコア ${score}`}
      title="返信×3、リポスト×5、引用×6、いいね×1、ブックマーク×4"
    >
      <span className="score-badge__label" aria-hidden="true">
        <svg viewBox="0 0 20 20" fill="none">
          <path d="M3.5 14.5a6.5 6.5 0 1 1 13 0" />
          <path d="m10 11.5 3.4-3.4" />
          <circle cx="10" cy="11.5" r=".9" fill="currentColor" stroke="none" />
        </svg>
      </span>
      <strong>{formatted}</strong>
    </span>
  );
}
