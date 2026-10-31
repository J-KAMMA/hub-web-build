import type { ThreadPostRole, ThreadSource } from "@/lib/thread-knowledge";
import { explainSpotlightScore } from "@/lib/spotlight-posts";

export function ThreadSummaryReason({ post, bestAnswerPostId }: { post: { id: string; no: number; spotlightScore?: number; voteSummary?: { score: number }; engagement: { score: number }; knowledge?: { role?: ThreadPostRole; freshness?: string; sources?: ThreadSource[] } }; bestAnswerPostId?: string }) {
  const reason = explainSpotlightScore(post, bestAnswerPostId);
  return <div className="thread-summary-reason" aria-label="読み方ガイド掲載理由"><span>スコア {reason.vote}</span>{reason.sourceBonus > 0 && <span>出典あり</span>}{reason.correctionBonus > 0 && <span>訂正あり</span>}{reason.bestAnswerBonus > 0 && <span>作成者が選んだ回答</span>}{reason.freshnessPenalty < 0 && <span>情報が古い可能性</span>}</div>;
}
