import {
  createHubTrustEvidence,
  type HubTrustEvidence,
} from "@/lib/hub-trust";
import type { CreatorActivitySummary } from "@/lib/server/d1-creator-center";
import type { CreatorRevenueSummary } from "@/lib/server/d1-creator-revenue";

export function buildCreatorTrustEvidence(
  activity: CreatorActivitySummary,
  summary: CreatorRevenueSummary,
  now = new Date(),
): HubTrustEvidence[] {
  const observedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + 5 * 60 * 1000).toISOString();
  return [
    createHubTrustEvidence({
      context: "publishing",
      sourceService: "hub",
      visibility: "public",
      derivation: "direct",
      label: "公開した投稿",
      value: `${activity.posts.toLocaleString("ja-JP")}件`,
      status: activity.posts > 0 ? "verified" : "not_available",
      description: "Hubで公開状態を確認できた本人の投稿だけです。",
      observedAt,
      expiresAt,
    }),
    createHubTrustEvidence({
      context: "commerce",
      sourceService: "commerce",
      visibility: "purpose_limited",
      derivation: "source_attested",
      label: "完了した取引",
      value: "未確認",
      status: "not_available",
      description: "Commerceから短期の取引完了証明を受け取るまで件数を推測しません。",
      observedAt,
      expiresAt,
    }),
    createHubTrustEvidence({
      context: "work",
      sourceService: "listings",
      visibility: "public",
      derivation: "direct",
      label: "公開中の依頼・サービス",
      value: `${activity.workListings.toLocaleString("ja-JP")}件`,
      status: activity.workListings > 0 ? "verified" : "not_available",
      description: "Hubの公開Listingsで確認できる依頼とサービスです。納品実績とは分けて扱います。",
      observedAt,
      expiresAt,
    }),
    createHubTrustEvidence({
      context: "community",
      sourceService: "hub",
      visibility: "public",
      derivation: "direct",
      label: "運営コミュニティ",
      value: `${activity.communities.toLocaleString("ja-JP")}件`,
      status: activity.communities > 0 ? "verified" : "not_available",
      description: "Hubで所有関係を確認できる公開コミュニティです。",
      observedAt,
      expiresAt,
    }),
    createHubTrustEvidence({
      context: "monetization",
      sourceService: "hub",
      visibility: "public",
      derivation: "direct",
      label: "収益分配",
      value: summary.participationEnabled ? "参加中" : "未参加",
      status: summary.participationEnabled ? "verified" : "not_available",
      description: "Hubが管理する公開コンテンツの収益分配設定です。",
      observedAt,
      expiresAt,
    }),
    createHubTrustEvidence({
      context: "monetization",
      sourceService: "hub",
      visibility: "purpose_limited",
      derivation: "source_attested",
      label: "確定済み集計期間",
      value: `${summary.finalizedPeriods}期間`,
      status: summary.finalizedPeriods > 0 ? "verified" : "not_available",
      description: "Hub収益台帳で確定した期間だけを表示します。",
      observedAt,
      expiresAt,
    }),
  ];
}
