import React from "react";

import { hubSurfacePath, type HubUiSurface } from "@/lib/hub-surface-path";

import { CreatorActivityExport } from "@/components/creator-activity-export";
import { CreatorCommerceTrustEvidence } from "@/components/creator-commerce-trust-evidence";
import { CreatorWorkTrustEvidence } from "@/components/creator-work-trust-evidence";
import { CreatorServiceSummaries } from "@/components/creator-service-summaries";
import { CreatorTrustRequests } from "@/components/creator-trust-requests";
import {
  resolveHubTrustEvidenceStatus,
  type HubTrustEvidence,
  type HubTrustEvidenceDisplayStatus,
} from "@/lib/hub-trust";
import { buildCreatorTrustEvidence } from "@/lib/creator-hub-trust";
import type { CreatorActivityPeriod } from "@/lib/creator-activity-period";
import type { CreatorActivitySummary } from "@/lib/server/d1-creator-center";
import type { CreatorRevenueSummary } from "@/lib/server/d1-creator-revenue";

import styles from "./creator-center.module.css";
import "@/components/v2/v2-access-gates.css";

/*
 * 行き先は既存（v1）の道で書く。v2 から見ているときに寄せるかは
 * hubSurfacePath が経路の一覧から判断する。手で「v2 に在る」と並べない——腐る。
 */
const creatorServices = [
  { href: "/market/digital/sell", title: "デジタル", description: "保護コンテンツ、公開状態、ストレージを管理" },
  { href: "/music/studio", title: "音楽スタジオ", description: "オリジナル音源のアップロードと公開を管理" },
  { href: "/market/sell", title: "ストア", description: "商品と販売条件をCommerceへ登録" },
  { href: "/work?view=manage", title: "クラウドソーシング", description: "依頼、スキル出品、問い合わせを管理" },
  { href: "/jobs?view=manage", title: "求人", description: "求人掲載と応募状況を管理" },
  { href: "/advertising/dashboard", title: "広告", description: "キャンペーンとクリエイティブを管理" },
] as const;

const statusLabel: Record<HubTrustEvidenceDisplayStatus, string> = {
  verified: "確認済み",
  pending: "確認中",
  not_available: "実績なし",
  expired: "期限切れ",
  revoked: "失効",
};

const contextLabel: Record<HubTrustEvidence["context"], string> = {
  publishing: "公開活動",
  commerce: "取引",
  work: "仕事",
  community: "コミュニティ",
  monetization: "収益化",
};

export function CreatorCenter({
  activitySummary,
  revenueSummary,
  viewerHandle,
  period,
  surface = "",
}: {
  activitySummary: CreatorActivitySummary;
  revenueSummary: CreatorRevenueSummary;
  viewerHandle: string;
  period: CreatorActivityPeriod;
  /* 見ている面。サーバーの部品なので描く側が渡す。 */
  surface?: HubUiSurface;
}) {
  const evidence = buildCreatorTrustEvidence(activitySummary, revenueSummary);
  return (
    <section className={surface === "/v2" ? `${styles.page} ${styles.pageV2}` : styles.page}>
      <header className={styles.header}>
        <h1>クリエイターセンター</h1>
        <p>公開、販売、仕事、広告と収益を、それぞれの所有サービスを保ったまま管理します。</p>
      </header>

      <nav className={styles.periodBar} aria-label="集計期間">
        <span>Hub内の活動</span>
        <div>
          {([
            ["30d", "30日"],
            ["90d", "90日"],
            ["all", "全期間"],
          ] as const).map(([value, label]) => (
            <a
              aria-current={period === value ? "page" : undefined}
              href={hubSurfacePath(surface, value === "all" ? "/creator" : `/creator?period=${value}`)}
              key={value}
            >
              {label}
            </a>
          ))}
        </div>
        <CreatorActivityExport period={period} summary={activitySummary} />
        {surface === "/v2" ? <a href="/v2/creator/gates">鍵の管理</a> : null}
      </nav>

      {surface === "/v2" ? (
        <section className="creator-sell" aria-labelledby="creator-sell-title">
          <h2 id="creator-sell-title">鍵つきで公開する</h2>
          <p>記事や投稿に「鍵」をかけると、指定したトークンを持つ人だけが本文を開けます。GohoToken はHub内で買えます。ほかのトークンは、あなたが用意した外部リンク1本から入手できます。</p>
          <div className="creator-sell__actions">
            <a className="creator-sell__button" href="/v2/creator/gates">鍵を作る</a>
            <a className="creator-sell__button" href="/v2/articles/new?gate=1">鍵つきの記事を書く</a>
            <a className="creator-sell__button" href="/v2">鍵つきの投稿を書く</a>
          </div>
        </section>
      ) : null}

      <section className={styles.overview} aria-label="Hubでの活動">
        <a href={hubSurfacePath(surface, `/profile/${encodeURIComponent(viewerHandle)}`)}>
          <strong>{activitySummary.posts.toLocaleString("ja-JP")}</strong>
          <span>投稿</span>
        </a>
        <a href={hubSurfacePath(surface, "/work?view=manage")}>
          <strong>{activitySummary.workListings.toLocaleString("ja-JP")}</strong>
          <span>依頼・サービス</span>
        </a>
        <a href={hubSurfacePath(surface, "/jobs?view=manage")}>
          <strong>{activitySummary.jobListings.toLocaleString("ja-JP")}</strong>
          <span>求人</span>
        </a>
        <a href={hubSurfacePath(surface, "/community")}>
          <strong>{activitySummary.communities.toLocaleString("ja-JP")}</strong>
          <span>運営コミュニティ</span>
        </a>
      </section>

      <section className={styles.section}>
        <header>
          <h2>投稿分析</h2>
          <p>Hub内で確認できた公開反応の累計です。保存数は本人だけに表示されます。</p>
        </header>
        <dl className={styles.metrics}>
          <div><dt>表示</dt><dd>{activitySummary.impressions.toLocaleString("ja-JP")}</dd></div>
          <div><dt>リンク遷移</dt><dd>{activitySummary.linkTransitions.toLocaleString("ja-JP")}</dd></div>
          <div><dt>返信</dt><dd>{activitySummary.replies.toLocaleString("ja-JP")}</dd></div>
          <div><dt>リポスト</dt><dd>{activitySummary.reposts.toLocaleString("ja-JP")}</dd></div>
          <div><dt>いいね</dt><dd>{activitySummary.likes.toLocaleString("ja-JP")}</dd></div>
          <div><dt>保存</dt><dd>{activitySummary.bookmarks.toLocaleString("ja-JP")}</dd></div>
        </dl>
      </section>

      <CreatorServiceSummaries />

      <nav className={styles.services} aria-label="クリエイターサービス">
        {creatorServices.map((service) => (
          <a href={hubSurfacePath(surface, service.href)} key={service.href}>
            <strong>{service.title}</strong>
            <span>{service.description}</span>
            <small>管理する →</small>
          </a>
        ))}
      </nav>

      <section className={styles.section}>
        <header><h2>収益</h2><p>Hub所有の集計だけを表示します。注文や他サービスの内部IDは複製しません。</p></header>
        <dl className={styles.metrics}>
          <div><dt>確定収益</dt><dd>¥{Math.floor(revenueSummary.finalizedAmountMicros / 1_000_000).toLocaleString("ja-JP")}</dd></div>
          <div><dt>集計中</dt><dd>¥{Math.floor(revenueSummary.draftAmountMicros / 1_000_000).toLocaleString("ja-JP")}</dd></div>
          <div><dt>確定期間</dt><dd>{revenueSummary.finalizedPeriods.toLocaleString("ja-JP")}</dd></div>
          <div><dt>適格表示単位</dt><dd>{revenueSummary.eligibleUnits.toLocaleString("ja-JP")}</dd></div>
        </dl>
        <a className={styles.sectionLink} href={hubSurfacePath(surface, "/earnings")}>収益を見る →</a>
      </section>

      <section className={styles.section}>
        <header>
          <h2>Hubの実績表示</h2>
          <p>総合点ではなく、確認元と用途が明確な実績だけを文脈別に表示します。</p>
        </header>
        <div className={styles.evidenceContexts}>
          {Object.entries(contextLabel).map(([context, label]) => (
            <section aria-labelledby={`trust-${context}`} key={context}>
              <h3 id={`trust-${context}`}>{label}</h3>
              <div className={styles.evidence}>
                {context === "commerce" ? <CreatorCommerceTrustEvidence /> : null}
                {context === "work" ? <CreatorWorkTrustEvidence /> : null}
                {evidence
                  .filter((item) => item.context === context
                    && context !== "commerce"
                    && context !== "work")
                  .map((item) => {
                    const displayStatus = resolveHubTrustEvidenceStatus(item);
                    return (
                      <article key={`${item.context}:${item.label}`}>
                        <span>{item.label}<small>{item.sourceService}</small></span>
                        <strong>{item.value}</strong>
                        <p>{item.description}</p>
                        <small>
                          確認 {new Date(item.observedAt).toLocaleString("ja-JP")}
                          {" · "}
                          有効期限 {new Date(item.expiresAt).toLocaleString("ja-JP")}
                        </small>
                        <em data-status={displayStatus}>{statusLabel[displayStatus]}</em>
                      </article>
                    );
                  })}
              </div>
            </section>
          ))}
        </div>
        <CreatorTrustRequests />
      </section>
    </section>
  );
}
