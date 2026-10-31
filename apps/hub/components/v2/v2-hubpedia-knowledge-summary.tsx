import type { ReactNode } from "react";

import { articleTypeLabels, statusLabels } from "@/components/encyclopedia/knowledge-state-card";
import type { HubpediaArticleKnowledge } from "@/lib/server/hubpedia-research-knowledge";

/*
 * 知識状態の1行の要約（SPEC 4.15）。記事種別・現在の状態・主要資料の数・AI の割合を題の下に出し、
 * 押すと従来の知識状態の表（children）が開く。表は消さない。載せる値・根拠の記録は変えない。
 */
export function V2HubpediaKnowledgeSummary({ knowledge, japanese, children }: {
  knowledge: HubpediaArticleKnowledge;
  japanese: boolean;
  children: ReactNode;
}) {
  const type = articleTypeLabels[knowledge.articleType] ?? knowledge.articleType;
  const status = statusLabels[knowledge.knowledgeStatus] ?? knowledge.knowledgeStatus;
  const ai = Math.round(knowledge.aiGeneratedRatio * 100);
  const line = [type, status, `資料${knowledge.works.length}件`, `AI ${ai}%`].join("・");
  return (
    <details className="v2-kstate">
      <summary><span className="v2-kstate__label">{japanese ? "知識状態" : "Knowledge state"}</span><span className="v2-kstate__line">{line}</span></summary>
      {children}
    </details>
  );
}
