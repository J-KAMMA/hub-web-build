import React from "react";

import { aiRatioLabel, authorKindLabel } from "@/lib/hubpedia-wiki-ui";

/* 記事の頭の書き手の表示（DESIGN.md 4）。AI 比率と人の見直し範囲を出す。 */
export function HubpediaAuthorshipHeader({
  authorKind,
  aiRatio,
  humanReviewScope,
  contributorCount,
}: {
  authorKind: string;
  aiRatio: number;
  humanReviewScope: string | null;
  contributorCount: number;
}) {
  const scope = humanReviewScope?.trim() || "人の見直しはまだ記録されていません";
  return (
    <section className="hubpedia-wiki__authorship" aria-label="書き手の記録">
      <dl>
        <div><dt>この版</dt><dd>{authorKindLabel(authorKind)}</dd></div>
        <div><dt>AIが書いた割合</dt><dd>{aiRatioLabel(aiRatio)}</dd></div>
        <div><dt>人の見直し範囲</dt><dd>{scope}</dd></div>
        {contributorCount > 0 ? <div><dt>関わった人</dt><dd>{contributorCount}人</dd></div> : null}
      </dl>
    </section>
  );
}
