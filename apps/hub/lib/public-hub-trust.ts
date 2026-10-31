import { createHubTrustEvidence, HUB_TRUST_CONTEXTS, type HubTrustContext, type HubTrustEvidence } from "@/lib/hub-trust";
import type { PublicTrustCounts } from "@/lib/server/d1-public-trust";

/*
 * 他人のプロフィールに出す文脈別実績（2026-09-04）。
 *
 * 構想（docs/HUB_SYSTEM_MAP.md 第9章）の決まりをそのまま守る:
 *   - **総合点を作らない。** 文脈をまたいで足す関数はここに置かない
 *   - 出すのは公開の行を直接数えた物（derivation: direct）だけ
 *   - 取引の明細は初期状態で非公開。Commerce から目的限定の証明を受け取るまで
 *     件数を推測しない（purpose_limited のまま「未確認」）
 *   - 数えられなかった文脈は「実績なし」と言わない（pending にする）
 *
 * 有効期限は5分。Creator Center 側（lib/creator-hub-trust.ts）と同じで、
 * 古い数字を根拠に信用させないため。
 */

const FRESH_FOR_MS = 5 * 60 * 1000;

function evidence(
  context: HubTrustContext,
  sourceService: HubTrustEvidence["sourceService"],
  label: string,
  total: number | null,
  description: string,
  observedAt: string,
  expiresAt: string,
): HubTrustEvidence {
  return createHubTrustEvidence({
    context,
    sourceService,
    visibility: "public",
    derivation: "direct",
    label,
    /* 数えられていないのに0と書かない。 */
    value: total === null ? "未確認" : `${total.toLocaleString("ja-JP")}件`,
    status: total === null ? "pending" : total > 0 ? "verified" : "not_available",
    description,
    observedAt,
    expiresAt,
  });
}

export function buildPublicTrustEvidence(counts: PublicTrustCounts, now = new Date()): HubTrustEvidence[] {
  const observedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + FRESH_FOR_MS).toISOString();
  const items: HubTrustEvidence[] = [
    evidence("publishing", "hub", "公開した投稿", counts.publicPosts,
      "誰でも見られる状態の投稿だけです。フォロワー限定と取り下げられた投稿は数えません。", observedAt, expiresAt),
    evidence("publishing", "hub", "書いた記事", counts.publicArticles,
      "公開されている記事だけです。下書きと取り下げられた記事は数えません。", observedAt, expiresAt),
    evidence("publishing", "hub", "立てたスレッド", counts.publicThreads,
      "掲示板で見られる状態のスレッドだけです。", observedAt, expiresAt),
    evidence("work", "listings", "公開中の依頼・サービス", counts.publishedWorkListings,
      "公開中のものだけです。納品の実績とは別で、引き受けた仕事の数ではありません。", observedAt, expiresAt),
    evidence("work", "listings", "公開中の掲載", counts.publishedPublicListings,
      "審査を通って公開されている掲載だけです。", observedAt, expiresAt),
    evidence("community", "hub", "運営している公開コミュニティ", counts.publicCommunities,
      "公開かつ活動中のコミュニティだけです。非公開のものは件数も出しません。", observedAt, expiresAt),
    createHubTrustEvidence({
      context: "monetization",
      sourceService: "hub",
      visibility: "public",
      derivation: "explicitly_linked",
      label: "投げ銭の受け取り",
      /* 受け取れるかどうかだけ。金額と件数は出さない。 */
      value: counts.tipsEnabled === null ? "未確認" : counts.tipsEnabled ? "受け取れます" : "受け取っていません",
      status: counts.tipsEnabled === null ? "pending" : counts.tipsEnabled ? "verified" : "not_available",
      description: "本人が署名で所有を確認し、公開設定にしたウォレットがあるかどうかだけです。金額と件数は出しません。",
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
      description: "Commerceから目的限定の取引完了証明を受け取るまで件数を推測しません。売買の明細は初期状態で非公開です。",
      observedAt,
      expiresAt,
    }),
  ];
  /* 文脈の綴りが増えたら気付けるように、既知の文脈へ収まっていることだけ確かめる。 */
  for (const item of items) {
    if (!HUB_TRUST_CONTEXTS.includes(item.context)) throw new Error("Unknown Hub Trust context.");
  }
  return items;
}

/*
 * 他人に見せてよい物だけを残す。purpose_limited は本人にだけ出す
 * （相手の同意なしに目的限定の証明を第三者へ広げない）。
 */
export function visiblePublicTrustEvidence(items: HubTrustEvidence[], viewerIsOwner: boolean): HubTrustEvidence[] {
  return items.filter((item) => item.visibility === "public" || viewerIsOwner);
}
