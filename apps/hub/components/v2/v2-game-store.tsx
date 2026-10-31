import Link from "next/link";

import { V2GameBuyBox } from "@/components/v2/v2-game-buy-box";
import { formatGameReleaseDate, gamePlatformBadge } from "@/lib/game-store-ui";

export type V2GameStoreGame = {
  slug: string;
  title: string;
  summary: string;
  imageUrl?: string;
  platforms: readonly string[];
  releaseDate: string | null;
  isFixture: boolean;
  /** 作品のコミュニティ（攻略・議論）の入口。ストアには埋め込まず、リンク1本だけを置く。 */
  communityHref?: string;
  /** ストアの出品（0272）。無ければ購入の箱は「販売情報なし」のまま。 */
  id?: string;
  storeListing?: "free" | "paid" | null;
  commerceProductId?: string | null;
  ageRating?: "all" | "12" | "15" | "18";
  screenshots?: ReadonlyArray<{ id: string; url: string }>;
  signedIn?: boolean;
};

/*
 * ストアの作品頁の頭（2026-10-18、Steam の作品頁に寄せた）。左に大きな絵とスクリーンショットの列、
 * 右に要約・発売日・対応機種、その下に購入の箱。コミュニティの要素は埋め込まず、議論への1本のリンクだけにする。
 *
 * 購入の箱: 出品（無料／Commerce の商品で有料）があれば V2GameBuyBox。価格は Commerce の taxIncluded で
 * 税込を出し、決済はブラウザから Commerce へ直接（Hub は中継しない）。出品が無ければ販売情報が無いことを書き、
 * 「購入」「ライブラリに追加」は出さない。空の項目（絵・スクリーンショット・発売日・機種）は出さない。
 * 複製対策は docs/hub-software/DRM.md のまま（起動は Hub Desktop の「このPCで起動」から人が押す）。
 */
export function V2GameStoreHead({ game, japanese }: { game: V2GameStoreGame; japanese: boolean }) {
  const release = formatGameReleaseDate(game.releaseDate, japanese);
  const listing = game.id && game.storeListing && !game.isFixture && (game.storeListing === "free" || game.commerceProductId) ? game.storeListing : null;
  return (
    <section className="v2-gstore__head" aria-label={japanese ? "作品の情報" : "About this game"}>
      <div className="v2-gstore__media">
        {game.imageUrl
          ? <img className="v2-gstore__hero" src={game.imageUrl} alt="" />
          : <span className="v2-gstore__hero v2-gstore__capsule--empty" aria-hidden="true">{game.title[0]}</span>}
        {game.screenshots?.length ? (
          <ul className="v2-gstore__shots" aria-label={japanese ? "スクリーンショット" : "Screenshots"}>
            {game.screenshots.map((shot, index) => (
              <li key={shot.id}>
                <a href={shot.url} target="_blank" rel="noopener noreferrer">
                  <img src={shot.url} alt={japanese ? `スクリーンショット ${index + 1}` : `Screenshot ${index + 1}`} loading="lazy" />
                </a>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="v2-gstore__info">
        <p className="v2-gstore__summary">{game.summary}</p>
        <dl className="v2-gstore__facts">
          {release ? <div><dt>{japanese ? "発売日" : "Release date"}</dt><dd>{release}</dd></div> : null}
          {game.platforms.length ? (
            <div>
              <dt>{japanese ? "対応機種" : "Platforms"}</dt>
              <dd>
                <ul className="v2-gstore__badges">
                  {game.platforms.map((name) => <li key={name} className="v2-gstore__badge" title={name}>{gamePlatformBadge(name)}</li>)}
                </ul>
              </dd>
            </div>
          ) : null}
        </dl>
        {listing && game.id ? (
          <V2GameBuyBox gameId={game.id} slug={game.slug} title={game.title} storeListing={listing}
            commerceProductId={game.commerceProductId ?? null} signedIn={game.signedIn ?? false}
            ageRating={game.ageRating ?? "all"} />
        ) : (
        <div className="v2-gstore__buy" aria-label={japanese ? "入手" : "Get this game"}>
          <p className="v2-gstore__buy-title">{game.title}</p>
          <p className="v2-gstore__buy-note">
            {game.isFixture
              ? (japanese ? "開発用サンプルです。販売していません。" : "Development sample. Not for sale.")
              : (japanese ? "この作品の販売情報はまだありません。" : "No store listing for this game yet.")}
          </p>
          {game.communityHref ? <p className="v2-gstore__buy-links"><Link href={game.communityHref}>{japanese ? "コミュニティ" : "Community"}</Link></p> : null}
        </div>
        )}
        {listing && game.communityHref ? <p className="v2-gstore__buy-links"><Link href={game.communityHref}>{japanese ? "コミュニティ" : "Community"}</Link></p> : null}
      </div>
    </section>
  );
}

/** 動作環境（最低・推奨）。どちらも空なら何も出さない。改行は作者の書いたまま。 */
export function V2GameRequirements({ minimum, recommended, japanese }: { minimum: string | null; recommended: string | null; japanese: boolean }) {
  if (!minimum && !recommended) return null;
  return (
    <section className="v2-msec v2-gstore__reqs" aria-labelledby="v2-game-requirements">
      <header className="v2-msec__head"><h2 id="v2-game-requirements" className="v2-column__title v2-column__title--section">{japanese ? "動作環境" : "System requirements"}</h2></header>
      <div className="v2-gstore__reqs-grid">
        {minimum ? <div><h3>{japanese ? "最低" : "Minimum"}</h3><p>{minimum}</p></div> : null}
        {recommended ? <div><h3>{japanese ? "推奨" : "Recommended"}</h3><p>{recommended}</p></div> : null}
      </div>
    </section>
  );
}
