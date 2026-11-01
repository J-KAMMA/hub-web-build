import type { Metadata } from "next";

import { Chip, ChipRow } from "@/components/v2/ui";
import { V2State } from "@/components/v2/v2-state";
import { V2ColumnHead } from "@/components/v2/v2-columns";
import { V2DirectoryRail } from "@/components/v2/v2-directory-rail";
import { V2GameDiscovery } from "@/components/v2/v2-game-discovery";
import { V2GamesSections } from "@/components/v2/v2-games-directory";
import { V2Shell } from "@/components/v2/v2-shell";
import { getAppShellData } from "@/lib/server/app-shell-data";
import { V2LibraryColumn } from "@/components/v2/v2-library-column";
import { loadViewerLibrary } from "@/lib/server/library-column";
import { getHubLocale } from "@/lib/server/locale";
import { searchPublicGames } from "@/lib/server/public-game-guides";
import { v2NavItems } from "@/lib/v2-nav";

import "../../v2.css";
import "../../v2-games.css";
import "@/app/v2/v2-luxe.css";
import "@/app/v2/v2-luxe-pages.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "ゲーム | Hub v2" };

const PLATFORMS = ["PC", "PlayStation 5", "PlayStation 4", "Xbox Series X|S", "Xbox One", "Nintendo Switch", "iOS", "Android"];

/*
 * ゲームのストア（2026-10-18、所有者の指示で Steam のようなストアに）。注目の1作と、横長の絵の格子。
 * 語と機種での絞り込み、ストアとライブラリの切り替え。右列（投稿の流れ）は置かない。
 * 攻略・ゲーム登録はコミュニティ側（/v2/community/games）へ移した（2026-10-29）。ここは店とライブラリだけ。
 */
export default async function V2GamesPage({ searchParams }: { searchParams: Promise<{ q?: string; platform?: string }> }) {
  const [params, locale, shell] = await Promise.all([searchParams, getHubLocale(), getAppShellData()]);
  const japanese = locale === "ja";
  const q = params.q?.slice(0, 80) ?? "";
  const platform = params.platform?.slice(0, 40) ?? "";
  let games: Awaited<ReturnType<typeof searchPublicGames>> = [];
  let failed = false;
  try {
    games = await searchPublicGames(q, platform, { storeOnly: true });
  } catch {
    failed = true;
  }
  const items = v2NavItems(japanese, { notifications: shell.unreadIndicatorCount, messages: shell.unreadMessageCount });
  const href = (next: { q?: string; platform?: string }) => {
    const merged = { q, platform, ...next };
    const search = new URLSearchParams();
    if (merged.q) search.set("q", merged.q);
    if (merged.platform) search.set("platform", merged.platform);
    const text = search.toString();
    return `/v2/games${text ? `?${text}` : ""}`;
  };

  const library = await loadViewerLibrary(shell.currentProfile.id, "games", japanese);
  const directory = (
    <>
      <V2GamesSections current="store" japanese={japanese} />
      {shell.currentProfile.id ? <V2LibraryColumn data={library} signedIn japanese={japanese} next="/v2/games" /> : null}
    </>
  );

  return (
    <V2Shell skin="luxe" directoryRail={<V2DirectoryRail search japanese={japanese} />}
      currentPath="/v2/games"
      profile={shell.currentProfile}
      items={items}
      directoryTitle={japanese ? "ゲーム" : "Games"}
      directory={directory}
      japanese={japanese}
    >
      <V2ColumnHead heading title={japanese ? "ゲーム" : "Games"} />
      <form className="v2-search__form" role="search" action="/v2/games" method="get">
        {platform ? <input type="hidden" name="platform" value={platform} /> : null}
        <input type="search" name="q" defaultValue={q} maxLength={80} placeholder={japanese ? "作品名で検索" : "Search titles"} aria-label={japanese ? "ゲームを検索" : "Search games"} />
        <button type="submit" className="v2-search__submit v2-gstore__submit">{japanese ? "検索" : "Search"}</button>
      </form>
      <div className="v2-gstore__filters">
        <ChipRow label={japanese ? "機種で絞る" : "Platform"}>
          <Chip href={href({ platform: "" })} selected={!platform}>{japanese ? "すべての機種" : "All platforms"}</Chip>
          {PLATFORMS.map((name) => <Chip key={name} href={href({ platform: name })} selected={platform === name}>{name}</Chip>)}
        </ChipRow>
        {failed || games.length === 0 ? null : <span className="v2-gstore__count">{japanese ? `${games.length}作品` : `${games.length} games`}</span>}
      </div>
      {failed ? (
        <V2State kind="error" japanese={japanese} title={japanese ? "ゲームを読み込めませんでした" : "Could not load games"} note={japanese ? "時間をおいて開き直してください。" : "Please try again in a moment."} action={{ label: japanese ? "再試行" : "Retry", href: href({}) }} />
      ) : games.length ? (
        <V2GameDiscovery games={games} locale={locale} />
      ) : (
        q || platform
          ? <V2State kind="empty" icon="game" japanese={japanese} title={japanese ? "該当するゲームがありません" : "No games matched"} note={japanese ? "語か機種を変えてください。" : "Try another word or platform."} action={{ label: japanese ? "絞り込みを解除" : "Clear filters", href: "/v2/games" }} />
          : <V2State kind="empty" icon="game" japanese={japanese} title={japanese ? "まだゲームがありません" : "No games yet"} note={japanese ? "公開された作品がここに並びます。" : "Published games will appear here."} />
      )}
    </V2Shell>
  );
}
