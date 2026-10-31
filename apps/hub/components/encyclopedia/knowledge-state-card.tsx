import React from "react";

import { hubSurfacePath, type HubUiSurface } from "@/lib/hub-surface-path";
import type { HubpediaArticleKnowledge } from "@/lib/server/hubpedia-research-knowledge";

export const statusLabels: Record<string, string> = {
  established: "確立",
  "partially-unresolved": "一部未解決",
  provisional: "暫定的",
  disputed: "議論中",
  unverified: "未検証",
  refuted: "反証済み",
};
const reproductionLabels: Record<string, string> = {
  unknown: "未登録",
  "not-applicable": "対象外",
  "not-attempted": "未追試",
  "partially-reproduced": "部分的に再現",
  reproduced: "再現済み",
  "failed-replication": "再現失敗の報告あり",
};
export const articleTypeLabels: Record<string, string> = {
  concept: "概念",
  paper: "論文",
  person: "人物",
  technology: "技術",
  event: "出来事",
  organism: "生物",
  place: "場所",
  culture: "文化",
  general: "一般",
};

export function KnowledgeStateCard({
  knowledge,
  articleUpdatedAt = null,
}: {
  knowledge: HubpediaArticleKnowledge;
  articleUpdatedAt?: string | Date | null;
}) {
  const benchmarkLabels = {
    "not-compared": "未比較",
    "needs-work": "不足項目あり",
    "meets-baseline": "比較基準を満たす",
    "adds-value": "追加価値を確認",
  } as const;
  const humanReview = knowledge.humanReviewScope?.trim() || "未確認";
  const updateDate = articleUpdatedAt instanceof Date
    ? articleUpdatedAt.toISOString().slice(0, 10)
    : articleUpdatedAt?.slice(0, 10) || "未記録";
  return (
    <section className="hubpedia-knowledge-card" aria-labelledby="hubpedia-knowledge-state-title">
      <h2 id="hubpedia-knowledge-state-title">知識状態</h2>
      <dl>
        <div><dt>記事種別</dt><dd>{articleTypeLabels[knowledge.articleType] ?? knowledge.articleType}</dd></div>
        <div><dt>現在の状態</dt><dd>{statusLabels[knowledge.knowledgeStatus] ?? knowledge.knowledgeStatus}</dd></div>
        <div><dt>記事更新日</dt><dd>{updateDate}</dd></div>
        <div><dt>最終統合日</dt><dd>{knowledge.lastSynthesizedAt?.slice(0, 10) ?? "未統合"}</dd></div>
        <div><dt>主要資料</dt><dd>{knowledge.works.length}件</dd></div>
        <div><dt>査読済み資料</dt><dd>{knowledge.peerReviewedCount}件</dd></div>
        <div><dt>反対資料</dt><dd>{knowledge.opposingSourceCount}件</dd></div>
        <div><dt>再現状況</dt><dd>{reproductionLabels[knowledge.reproducibility] ?? knowledge.reproducibility}</dd></div>
        <div><dt>生成・確認</dt><dd>AI {Math.round(knowledge.aiGeneratedRatio * 100)}%・人間確認 {humanReview}</dd></div>
        <div><dt>百科事典比較</dt><dd>{benchmarkLabels[knowledge.encyclopediaBenchmark.status]}</dd></div>
        {knowledge.encyclopediaBenchmark.comparedProviders.length ? <div><dt>比較対象</dt><dd>{knowledge.encyclopediaBenchmark.comparedProviders.join("、")}</dd></div> : null}
        {knowledge.encyclopediaBenchmark.checkedAt ? <div><dt>最終比較日</dt><dd>{knowledge.encyclopediaBenchmark.checkedAt.slice(0, 10)}</dd></div> : null}
      </dl>
    </section>
  );
}

/*
 * 論文の行き先は読み手の面に合わせる（2026-09-05）。/v2/hubpedia/papers/[id] は
 * 在る。静的な表なのでクライアント部品にせず、面を引数で受け取る。
 */
export function KnowledgeEvidencePanel({ knowledge, surface = "" }: {
  knowledge: HubpediaArticleKnowledge;
  surface?: HubUiSurface;
}) {
  return (
    <section className="hubpedia-evidence" aria-labelledby="hubpedia-evidence-title">
      <h2 id="hubpedia-evidence-title">証拠・根拠</h2>
      <p>本文を支える主張と一次資料を、状態・適用範囲・再現性とともに表示します。</p>
      {knowledge.claims.length ? (
        <div className="hubpedia-evidence__claims">
          {knowledge.claims.map((claim) => (
            <details key={claim.id}>
              <summary><span>{claim.statement}</span><b>{statusLabels[claim.knowledgeStatus] ?? claim.knowledgeStatus}</b></summary>
              <dl>
                <div><dt>証拠</dt><dd>{claim.evidenceCount}件（支持 {claim.supportingEvidence}・反対 {claim.opposingEvidence}）</dd></div>
                {claim.evidenceType ? <div><dt>種類</dt><dd>{claim.evidenceType}</dd></div> : null}
                {claim.scope ? <div><dt>適用範囲</dt><dd>{claim.scope}</dd></div> : null}
                <div><dt>再現性</dt><dd>{reproductionLabels[claim.reproducibility] ?? claim.reproducibility}</dd></div>
                {claim.lastCheckedAt ? <div><dt>最終確認</dt><dd>{claim.lastCheckedAt.slice(0, 10)}</dd></div> : null}
              </dl>
            </details>
          ))}
        </div>
      ) : <p className="hubpedia-evidence__empty">主張単位の照合はまだ登録されていません。</p>}
      <h3>一次資料・主要文献</h3>
      {knowledge.works.length ? (
        <ol className="hubpedia-evidence__works">
          {knowledge.works.map((work) => (
            <li key={`${work.id}:${work.role}`}>
              <a href={`${hubSurfacePath(surface, "/hubpedia/papers")}/${work.id}`}>{work.title}</a>
              {work.canonicalUrl ? (
                <a href={work.canonicalUrl} rel="noreferrer" target="_blank">原典</a>
              ) : null}
              <span>{work.workType}・{work.peerReviewState}・{work.evidenceType}</span>
              {work.authors.length ? <small>{work.authors.join(", ")}</small> : null}
              {work.note ? <p>{work.note}</p> : null}
            </li>
          ))}
        </ol>
      ) : <p className="hubpedia-evidence__empty">一次資料はまだ登録されていません。本文を確定的な研究合意として扱わないでください。</p>}
    </section>
  );
}
