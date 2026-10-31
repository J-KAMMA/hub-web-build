export type HubAdCreativeAnalytics = {
  creativeVersionId: string; headline: string; served: number; viewable: number; clicked: number;
  recentServed: number; recentClicked: number; previousServed: number; previousClicked: number;
  negativeFeedback: number; publicReports: number;
};

export type HubAdRecommendation = {
  creativeVersionId: string; severity: "info" | "warning"; code: string; message: string;
};

export function buildHubAdRecommendations(rows: HubAdCreativeAnalytics[]): HubAdRecommendation[] {
  const output: HubAdRecommendation[] = [];
  for (const row of rows) {
    const viewability = row.viewable / Math.max(1, row.served), ctr = row.clicked / Math.max(1, row.viewable);
    const recentCtr = (row.recentClicked + 1) / (row.recentServed + 100);
    const previousCtr = (row.previousClicked + 1) / (row.previousServed + 100);
    if (row.previousServed >= 100 && row.recentServed >= 50 && recentCtr < previousCtr * .7)
      output.push({ creativeVersionId: row.creativeVersionId, severity: "warning", code: "creative_fatigue", message: `「${row.headline}」の反応が以前より30%以上低下しています。見出しか画像を1要素だけ変えた素材を追加してください。` });
    if (row.served >= 100 && viewability < .45)
      output.push({ creativeVersionId: row.creativeVersionId, severity: "info", code: "low_viewability", message: `「${row.headline}」の視認率が低めです。最初の一文を短くし、広告主名と要点を上部に置いてください。` });
    if (row.served >= 100 && ctr < .005)
      output.push({ creativeVersionId: row.creativeVersionId, severity: "info", code: "low_ctr", message: `「${row.headline}」のCTRが0.5%未満です。CTAを具体的な行動（例: 無料で試す、詳細を見る）へ変更してください。` });
    if ((row.negativeFeedback + row.publicReports * 3) / Math.max(1, row.served) > .01)
      output.push({ creativeVersionId: row.creativeVersionId, severity: "warning", code: "negative_feedback", message: `「${row.headline}」は非表示・通報が多めです。誇張表現、リンク先との不一致、広告主名の分かりにくさを確認してください。` });
  }
  return output.slice(0, 50);
}
