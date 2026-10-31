"use client";

import Link from "next/link";
import { V2DiscoveryFeedbackStatus } from "./v2-discovery-feedback";
import { useDiscoveryFeedback } from "@/lib/use-discovery-feedback";

import { rankDiscoveryItems } from "@/lib/discovery-recommendations";
import { useHubRecommendations } from "@/lib/use-hub-recommendations";
import { type PublicGameSearchResult } from "@/lib/server/public-game-guides";
import { gamePlatformBadge } from "@/lib/game-store-ui";
import { V2Icon } from "@/components/v2/v2-icons";

/*
 * ゲームのストアの一覧（2026-10-18、所有者の指示で Steam のようなストアに）。先頭の1作を大きく見せ、
 * 残りを横長の絵（カプセル）の格子に並べる。札は絵・題・対応機種・発売年だけ。題のリンクが札全体を覆う。
 * コミュニティ寄りの要素（攻略数・コミュニティ数・おすすめの調整）は札から外した。
 *
 * 価格・分類（ジャンル）・評価は、いまの API（searchPublicGames）が返さないので出さない。
 * TODO(commerce-tax-inclusive): Commerce の商品は税込みの欄 taxIncluded を返すようになった（49f1dcdd1）。
 * ゲームが Commerce の商品と結び付いたら、その欄を札の下段に
 * 「¥1,980（税込）」の形で出す。税抜きの値から画面で計算しない。無料なら「無料」。
 */
export function V2GameDiscovery({ games, locale }: { games: readonly PublicGameSearchResult[]; locale: string }) {
  const ja = locale === "ja";
  const feedback = useDiscoveryFeedback("games");
  const { interests, enabled, record } = useHubRecommendations();
  const ranked = enabled
    ? rankDiscoveryItems(games, interests, (game) => ({
      text: `${game.title} ${game.summary} ${game.platforms.join(" ")}`,
      topic: game.platforms[0],
    }))
    : [...games];
  const visible = ranked.filter((game) => !feedback.isHidden(game.id));
  const featured = visible.length >= 2 ? visible[0] : null;
  const rest = featured ? visible.slice(1) : visible;
  const href = (game: PublicGameSearchResult) => `/v2/games/${encodeURIComponent(game.slug)}`;
  const badges = (game: PublicGameSearchResult) => game.platforms.length || game.isFixture ? (
    <ul className="v2-gstore__badges" aria-label={ja ? "対応機種" : "Platforms"}>
      {game.isFixture ? <li className="v2-gstore__badge v2-gstore__badge--note">{ja ? "開発用サンプル" : "Sample"}</li> : null}
      {game.platforms.map((name) => <li key={name} className="v2-gstore__badge" title={name}>{gamePlatformBadge(name)}</li>)}
    </ul>
  ) : null;
  const capsule = (game: PublicGameSearchResult, className: string, lazy = true) => game.imageUrl
    ? <img className={className} src={game.imageUrl} alt="" loading={lazy ? "lazy" : undefined} />
    : <span className={`${className} v2-gstore__capsule--empty`} aria-hidden="true"><V2Icon name="game" /></span>;

  return (
    <>
      <V2DiscoveryFeedbackStatus feedback={feedback} japanese={ja} />
      {ranked.length === 0 ? <p className="v2-note">{ja ? "ゲームが見つかりません。" : "No games found."}</p>
        : visible.length === 0 ? <p className="v2-note">{ja ? "表示できるゲームがありません。設定で非表示をリセットできます。" : "No games to show. Reset hidden recommendations in settings."}</p> : null}
      {featured ? (
        <section className="v2-gstore__feature" aria-label={ja ? "注目" : "Featured"}>
          {capsule(featured, "v2-gstore__feature-image", false)}
          <div className="v2-gstore__feature-body">
            <p className="v2-gstore__eyebrow">{ja ? "注目" : "Featured"}</p>
            <Link className="v2-gstore__title v2-gstore__title--feature" href={href(featured)} onClick={() => record("games", featured.platforms)}>{featured.title}</Link>
            <p className="v2-gstore__feature-summary">{featured.summary}</p>
            {badges(featured)}
          </div>
        </section>
      ) : null}
      {rest.length ? (
        <ul className="v2-gstore__grid" aria-label={ja ? "すべてのゲーム" : "All games"}>
          {rest.map((game) => (
            <li key={game.id} className="v2-gstore__card">
              {capsule(game, "v2-gstore__capsule")}
              <div className="v2-gstore__body">
                <Link className="v2-gstore__title" href={href(game)} onClick={() => record("games", game.platforms)}>{game.title}</Link>
                {badges(game)}
                {game.releaseDate ? <p className="v2-gstore__meta">{game.releaseDate.slice(0, 4)}</p> : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
