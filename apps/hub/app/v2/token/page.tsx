import type { Metadata } from "next";
import Link from "next/link";

import { HubTokenContributionCard } from "@/components/hub-token-contribution-card";
import { TokenRankingCreateForm } from "@/components/token-ranking-create-form";
import { TokenWalletVerification } from "@/components/token-wallet-verification";
import { V2PanelPage } from "@/components/v2/v2-panel-page";
import { getTokenPageData } from "@/lib/server/token-page-data";
import { formatTokenAmountForDisplay } from "@/lib/token-amount";

import "../v2.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "トークン | Hub v2" };

/*
 * 公開残高ランキング。既存の /token から機能だけを抜いた: ランキングの選択（?ranking=）、
 * 残高・参加者・順位、貢献の札、ウォレットの確認、ランキングの作成。
 * 部品（貢献・確認・作成）は既存のまま。**オンチェーン残高はサーバー側で確かめる**。
 */
export default async function V2TokenPage({ searchParams }: { searchParams: Promise<{ ranking?: string; symbol?: string }> }) {
  const query = await searchParams;
  const rankingId = query.ranking ?? query.symbol ?? "token-ranking-wg";
  const { currentProfile, balances, ranking, profiles, selectedSymbol, selectedRanking, rankingDefinitions } = await getTokenPageData(rankingId);
  const hasRanking = Boolean(selectedRanking.id);
  const currentBalance = balances.find((entry) => entry.symbol === selectedSymbol)?.amount ?? "0";

  const directory = rankingDefinitions.length ? (
    <ul className="v2-nav__list">
      {rankingDefinitions.map((definition) => (
        <li key={definition.id}>
          <Link className="v2-nav__item" href={`/v2/token?ranking=${encodeURIComponent(definition.id)}`} aria-current={definition.id === selectedRanking.id ? "page" : undefined}>
            <span className="v2-nav__label">{definition.title}</span>
            <span className="v2-nav__count v2-nav__count--quiet">{definition.symbol}</span>
          </Link>
        </li>
      ))}
    </ul>
  ) : undefined;

  return (
    <V2PanelPage currentPath="/v2/token" title={hasRanking ? selectedRanking.title : "公開残高ランキング"} note={hasRanking ? `${selectedRanking.network} · ${selectedSymbol}` : undefined} directoryTitle="ランキング" directory={directory}>
      <HubTokenContributionCard />
      {hasRanking ? <TokenWalletVerification rankingId={selectedRanking.id} symbol={selectedSymbol} network={selectedRanking.network} /> : null}
      <p className="v2-note">{selectedRanking.description || (hasRanking ? `${selectedSymbol} の公開残高ランキングです。` : "利用できる公開残高ランキングはまだありません。")}</p>
      {selectedRanking.contractAddress ? <p className="v2-post__time"><code title={selectedRanking.contractAddress}>{selectedRanking.contractAddress}</code></p> : null}
      <TokenRankingCreateForm />
      {hasRanking ? (
        <>
          <dl className="v2-product__facts">
            <div><dt>選択中</dt><dd>{selectedSymbol}</dd></div>
            <div><dt>自分の公開残高</dt><dd>{formatTokenAmountForDisplay(currentBalance)}</dd></div>
            <div><dt>ランキング参加者</dt><dd>{ranking.length}</dd></div>
            <div><dt>確認</dt><dd>{selectedRanking.verificationStatus === "verified" ? "確認済み" : selectedRanking.verificationStatus === "failed" ? "失敗" : "確認待ち"}</dd></div>
          </dl>
          <section className="v2-msec" aria-labelledby="v2-token-holders">
            <header className="v2-msec__head"><h2 id="v2-token-holders" className="v2-column__title v2-column__title--section">{selectedSymbol} 公開残高ランキング</h2><span className="v2-msec__note">残高の多い順</span></header>
            {ranking.length ? (
              <ol className="v2-people">
                {ranking.map((entry, index) => {
                  const profile = profiles.find((candidate) => candidate.id === entry.profile.id);
                  return (
                    <li key={entry.profile.id} className="v2-person v2-person--with-action">
                      <span className="v2-badge">{index + 1}</span>
                      <Link className="v2-person__body" href={profile ? `/v2/profile/${profile.handle}` : "/v2/community"}>
                        <span className="v2-post__name">{profile?.displayName ?? entry.profile.displayName}</span>
                        {profile ? <span className="v2-post__handle">@{profile.handle}</span> : null}
                      </Link>
                      <span className="v2-wallet__amount">{formatTokenAmountForDisplay(entry.balance)} {selectedSymbol}</span>
                    </li>
                  );
                })}
              </ol>
            ) : <p className="v2-note">{selectedSymbol} の公開残高ランキングはまだありません。</p>}
          </section>
        </>
      ) : null}
      <p className="v2-post__time">オンチェーン残高はサーバー側で確認します。ウォレットとプロフィールの関連付けは、本人が公開を選んだものだけを出します。</p>
    </V2PanelPage>
  );
}
