import type { Metadata } from "next";
import Link from "next/link";

import { V2ColumnHead } from "@/components/v2/v2-columns";
import { V2DirectoryRail } from "@/components/v2/v2-directory-rail";
import { V2Empty } from "@/components/v2/v2-empty";
import { V2GamesSections } from "@/components/v2/v2-games-directory";
import { V2Shell } from "@/components/v2/v2-shell";
import { gamePlatformBadge } from "@/lib/game-store-ui";
import { getAppShellData } from "@/lib/server/app-shell-data";
import { GameStoreError, listGameLibrary, type GameLibraryEntry } from "@/lib/server/d1-game-store";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { V2LibraryColumn } from "@/components/v2/v2-library-column";
import { loadViewerLibrary } from "@/lib/server/library-column";
import { getHubLocale } from "@/lib/server/locale";
import { v2NavItems } from "@/lib/v2-nav";

import "../../v2.css";
import "../../v2-games.css";
import "@/app/v2/v2-luxe.css";
import "@/app/v2/v2-luxe-pages.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "ライブラリ | ゲーム | Hub v2", robots: { index: false, follow: false } };

const PAGE_SIZE = 24;

/*
 * ゲームのライブラリ（持っているゲーム、2026-10-18）。無料で追加したものと、Commerce の証明を Hub が確かめた購入だけを、
 * 新しい順に出す（hub_game_library の索引、続きは keyset の cursor）。Hub Desktop では、この頁（/v2/games/…）を
 * 開いている間ツールバーに「このPCで起動」が出て、このPCに登録したゲームを人が押して起動する（DRM.md の境界のまま）。
 */
export default async function V2GamesLibraryPage({ searchParams }: { searchParams: Promise<{ cursor?: string }> }) {
  const [{ cursor }, locale, shell] = await Promise.all([searchParams, getHubLocale(), getAppShellData()]);
  const japanese = locale === "ja";
  const library = await loadViewerLibrary(shell.currentProfile.id, "games", japanese);
  const items = v2NavItems(japanese, { notifications: shell.unreadIndicatorCount, messages: shell.unreadMessageCount });
  const profileId = shell.currentProfile.id;
  const database = profileId ? getOptionalHubD1() : null;
  let page: { games: GameLibraryEntry[]; nextCursor: string | null } | null = null;
  let failed = false;
  if (database && profileId) {
    try {
      page = await listGameLibrary(database, profileId, { cursor: cursor ?? null, limit: PAGE_SIZE });
    } catch (error) {
      if (!(error instanceof GameStoreError)) throw error;
      failed = true;
    }
  }
  return (
    <V2Shell skin="luxe" directoryRail={<V2DirectoryRail back={{ href: "/v2/games", label: japanese ? "ストアへ" : "Store" }} japanese={japanese} />}
      currentPath="/v2/games"
      profile={shell.currentProfile}
      items={items}
      directoryTitle={japanese ? "ゲーム" : "Games"}
      directory={<><V2GamesSections current="library" japanese={japanese} /><V2LibraryColumn data={library} signedIn={Boolean(shell.currentProfile.id)} japanese={japanese} next="/v2/games" /></>}
      japanese={japanese}
    >
      <V2ColumnHead heading title={japanese ? "ライブラリ" : "Library"} />
      {!profileId ? (
        <V2Empty
          title={japanese ? "ログインすると、持っているゲームが並びます" : "Sign in to see your games"}
          note={japanese ? "無料で追加したゲームと、購入を確認したゲームがここに出ます。" : "Free games you added and purchases Hub has verified appear here."}
          action={{ label: japanese ? "ログイン" : "Sign in", href: "/v2/auth?next=/v2/games/library" }}
        />
      ) : failed ? (
        <V2Empty
          title={japanese ? "一覧の続きを読み込めませんでした" : "Couldn't load this page"}
          note={japanese ? "最初から開き直してください。" : "Open the library from the start."}
          action={{ label: japanese ? "ライブラリを開く" : "Open library", href: "/v2/games/library" }}
        />
      ) : !page?.games.length ? (
        <V2Empty
          title={japanese ? "まだゲームがありません" : "No games yet"}
          note={japanese
            ? "ストアで無料のゲームを追加するか、購入するとここに並びます。Hub Desktop では、ツールバーの「このPCで起動」から、このPCに登録したゲームを起動できます。"
            : "Add a free game or buy one in the store. In Hub Desktop, use “Launch on this PC” in the toolbar to start games registered on this PC."}
          action={{ label: japanese ? "ストアを見る" : "Browse the store", href: "/v2/games" }}
        />
      ) : (
        <section className="v2-glib" aria-label={japanese ? "持っているゲーム" : "Your games"}>
          <p className="v2-glib__note">
            {japanese
              ? "Hub Desktop では、ツールバーの「このPCで起動」から起動します。"
              : "In Hub Desktop, launch from “Launch on this PC” in the toolbar."}
          </p>
          <ul className="v2-glib__list">
            {page.games.map((game) => (
              <li key={game.gameId} className="v2-glib__row">
                {game.imageUrl
                  ? <img className="v2-glib__image" src={game.imageUrl} alt="" loading="lazy" />
                  : <span className="v2-glib__image v2-gstore__capsule--empty" aria-hidden="true">{game.title[0]}</span>}
                <div className="v2-glib__body">
                  <Link className="v2-glib__title" href={`/v2/games/${encodeURIComponent(game.slug)}`}>{game.title}</Link>
                  {game.platforms.length ? (
                    <ul className="v2-gstore__badges" aria-label={japanese ? "対応機種" : "Platforms"}>
                      {game.platforms.map((name) => <li key={name} className="v2-gstore__badge" title={name}>{gamePlatformBadge(name)}</li>)}
                    </ul>
                  ) : null}
                </div>
                <span className="v2-glib__source">{game.source === "commerce" ? (japanese ? "購入済み" : "Purchased") : (japanese ? "無料" : "Free")}</span>
              </li>
            ))}
          </ul>
          {page.nextCursor ? (
            <p className="v2-glib__more"><Link href={`/v2/games/library?cursor=${encodeURIComponent(page.nextCursor)}`}>{japanese ? "続きを見る" : "More"}</Link></p>
          ) : null}
        </section>
      )}
    </V2Shell>
  );
}
