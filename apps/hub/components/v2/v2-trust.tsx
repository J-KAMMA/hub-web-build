import { resolveHubTrustEvidenceStatus, type HubTrustContext, type HubTrustEvidence, type HubTrustEvidenceDisplayStatus } from "@/lib/hub-trust";

/*
 * プロフィールの文脈別実績（2026-09-04、旦那様「ハブ全体の構想から分析して足りないものを作る」）。
 *
 * 構想 第9章「Hub Trustは共通IDや単一の信用スコアではなく、Hub自身の公開活動と、
 * 各所有サービスが発行した事実証明を文脈別に表示する層である」。
 * 既に形（lib/hub-trust.ts）と本人向けの表示（Creator Center）はあったが、
 * **他人のプロフィールには無かった。** 相手を信じる材料が「投稿の数」しか無かった。
 *
 * ここは表示だけ。数を作るのは lib/server/d1-public-trust.ts、
 * 証明の形にするのは lib/public-hub-trust.ts。
 *   - 総合点は出さない。文脈をまたいで足さない
 *   - 「実績なし」と「確認できていない」を書き分ける
 *   - 確認した時刻と有効期限を必ず添える（古い数字を信用の根拠にさせない）
 */

const CONTEXT_LABELS: Record<HubTrustContext, { ja: string; en: string }> = {
  publishing: { ja: "公開活動", en: "Publishing" },
  commerce: { ja: "取引", en: "Commerce" },
  work: { ja: "仕事", en: "Work" },
  community: { ja: "コミュニティ", en: "Community" },
  monetization: { ja: "収益化", en: "Monetisation" },
};

const STATUS_LABELS: Record<HubTrustEvidenceDisplayStatus, { ja: string; en: string }> = {
  verified: { ja: "確認済み", en: "Verified" },
  pending: { ja: "確認できていません", en: "Not confirmed" },
  not_available: { ja: "実績なし", en: "None" },
  expired: { ja: "期限切れ", en: "Expired" },
  revoked: { ja: "失効", en: "Revoked" },
};

const ORDER: HubTrustContext[] = ["publishing", "work", "community", "monetization", "commerce"];

export function V2Trust({ evidence, japanese, now }: { evidence: HubTrustEvidence[]; japanese: boolean; now?: Date }) {
  const at = now ?? new Date();
  /*
   * 「いつの数字か」は面に1回だけ。札ごとに置くと同じ時刻が8回並ぶ
   * （実際に見て気付いた。2026-09-04）。証明はすべて同じ時に作られる。
   */
  const observedAt = evidence[0]?.observedAt;
  const groups = ORDER
    .map((context) => ({ context, items: evidence.filter((item) => item.context === context) }))
    .filter((group) => group.items.length);
  if (!groups.length) return null;

  return (
    <section className="v2-trust" aria-labelledby="v2-trust-title">
      <header className="v2-trust__head">
        <h2 id="v2-trust-title" className="v2-column__title v2-column__title--section">Hub Trust</h2>
        <p className="v2-trust__note">
          {japanese
            ? "総合点ではありません。確認できた公開の活動を、文脈ごとにそのまま出しています。"
            : "Not a score. Public activity we could confirm, shown per context."}
          {observedAt ? (
            <span className="v2-trust__when">
              {japanese ? "確認 " : "Checked "}
              {new Date(observedAt).toLocaleString(japanese ? "ja-JP" : "en-US", { dateStyle: "medium", timeStyle: "short" })}
            </span>
          ) : null}
        </p>
      </header>
      <div className="v2-trust__groups">
        {groups.map(({ context, items }) => (
          <section key={context} className="v2-trust__group" aria-labelledby={`v2-trust-${context}`}>
            <h3 id={`v2-trust-${context}`} className="v2-trust__group-title">
              {japanese ? CONTEXT_LABELS[context].ja : CONTEXT_LABELS[context].en}
            </h3>
            <ul className="v2-trust__list">
              {items.map((item) => {
                const status = resolveHubTrustEvidenceStatus(item, at);
                return (
                  <li key={`${item.context}:${item.label}`} className="v2-trust__item" data-status={status}>
                    <span className="v2-trust__label">{item.label}</span>
                    <strong className="v2-trust__value">{item.value}</strong>
                    <span className="v2-trust__status">{japanese ? STATUS_LABELS[status].ja : STATUS_LABELS[status].en}</span>
                    <p className="v2-trust__desc">{item.description}</p>
                    {/* 目的限定の証明は本人にだけ見えている。誰の物か分かるように書く。 */}
                    {item.visibility === "purpose_limited" ? (
                      <small className="v2-trust__scope">{japanese ? "この行は本人だけに見えています" : "Only you can see this row"}</small>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </section>
  );
}
