import type { Metadata } from "next";
import Link from "next/link";

import { GameSellerVerificationPanel } from "@/components/game-seller-verification-panel";
import { GameStoreSettings } from "@/components/game-store-settings";
import { V2ColumnHead } from "@/components/v2/v2-columns";
import { V2DirectoryRail } from "@/components/v2/v2-directory-rail";
import { V2Empty } from "@/components/v2/v2-empty";
import { V2GamesSections } from "@/components/v2/v2-games-directory";
import { V2Shell } from "@/components/v2/v2-shell";
import { getAppShellData } from "@/lib/server/app-shell-data";
import { listManagedGames, type ManagedGame } from "@/lib/server/d1-game-store";
import { getGameSellerVerification, type GameSellerVerificationStatus } from "@/lib/server/game-seller-verification";
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
export const metadata: Metadata = { title: "出品 | ゲーム | Hub v2", robots: { index: false, follow: false } };

/*
 * ゲームの出品（2026-10-29）。作者が自分のゲームのストア掲載（機種・発売日・年齢区分・動作環境・スクリーンショット）を整え、
 * ビルドをファイルコンポーネントへ上げ、出品／出品停止を切り替える。保存・出品停止・ビルドは既存の /api/games/[gameId]/* が
 * 管理者確認つきで受ける。価格・決済・返金は Commerce が持つ（Hub は支払い記録を作らない）ので、有料は Commerce で作った
 * デジタル商品の ID を結ぶ。実行ファイルのビルドは Commerce の販売者確認（2026-10-29）を済ませた作者だけが公開でき、
 * 確認の取り込みは GameSellerVerificationPanel が行う（Hub が覚えるのは確認の時刻と期限だけ）。
 */
export default async function V2GamesSellPage({ searchParams }: { searchParams: Promise<{ game?: string }> }) {
  const [{ game: gameParam }, locale, shell] = await Promise.all([searchParams, getHubLocale(), getAppShellData()]);
  const japanese = locale === "ja";
  const library = await loadViewerLibrary(shell.currentProfile.id, "games", japanese);
  const items = v2NavItems(japanese, { notifications: shell.unreadIndicatorCount, messages: shell.unreadMessageCount });
  const profileId = shell.currentProfile.id;
  const database = profileId ? getOptionalHubD1() : null;
  let games: ManagedGame[] = [];
  let failed = false;
  if (database && profileId) {
    try {
      games = await listManagedGames(database, profileId);
    } catch {
      failed = true;
    }
  }
  // 販売者確認の状態（時刻と期限だけ）。読めないときは未確認として扱う。
  let sellerStatus: GameSellerVerificationStatus = { verified: false, verifiedAt: null, expiresAt: null };
  if (database && profileId && games.length) {
    sellerStatus = await getGameSellerVerification(database, profileId).catch(() => sellerStatus);
  }
  const selected = games.find((item) => item.id === gameParam) ?? games[0] ?? null;

  return (
    <V2Shell skin="luxe" directoryRail={<V2DirectoryRail back={{ href: "/v2/games", label: japanese ? "ストアへ" : "Store" }} japanese={japanese} />}
      currentPath="/v2/games"
      profile={shell.currentProfile}
      items={items}
      directoryTitle={japanese ? "ゲーム" : "Games"}
      directory={<><V2GamesSections current="sell" japanese={japanese} /><V2LibraryColumn data={library} signedIn={Boolean(shell.currentProfile.id)} japanese={japanese} next="/v2/games" /></>}
      japanese={japanese}
    >
      <V2ColumnHead heading title={japanese ? "出品" : "Sell"} />
      {!profileId ? (
        <V2Empty
          title={japanese ? "ログインすると、ゲームを出品できます" : "Sign in to sell a game"}
          note={japanese ? "出品できるのは、自分が管理するゲームです。" : "You can sell games you manage."}
          action={{ label: japanese ? "ログイン" : "Sign in", href: "/v2/auth?next=/v2/games/sell" }}
        />
      ) : failed ? (
        <V2Empty title={japanese ? "ゲームを読み込めませんでした" : "Could not load your games"} note={japanese ? "時間をおいて開き直してください。" : "Please try again in a moment."} action={{ label: japanese ? "読み込み直す" : "Reload", href: "/v2/games/sell" }} />
      ) : !selected ? (
        <V2Empty
          title={japanese ? "出品できるゲームがありません" : "No games to sell yet"}
          note={japanese ? "先にゲームを登録してください。登録したゲームがここに並びます。" : "Register a game first; it will appear here."}
          action={{ label: japanese ? "ゲームを登録" : "Register a game", href: "/v2/community/games/new" }}
        />
      ) : (
        <section aria-label={japanese ? "ゲームの出品" : "Sell a game"}>
          <ul className="v2-nav__list">
            {games.map((item) => (
              <li key={item.id}>
                <Link className="v2-nav__item" href={`/v2/games/sell?game=${encodeURIComponent(item.id)}`} aria-current={item.id === selected.id ? "page" : undefined}>
                  <span className="v2-nav__label">{item.title}</span>
                  <span className="v2-heading__note">{item.storeListing ? (japanese ? "出品中" : "Listed") : (japanese ? "未出品" : "Not listed")}</span>
                </Link>
              </li>
            ))}
          </ul>
          <p role="note">
            {japanese
              ? "有料にするときは、先に Commerce でデジタル商品を作り、その商品IDを下の欄に入れてください。価格・支払い・返金は Commerce が扱います。"
              : "For a paid game, create a digital product in Commerce first and enter its product ID below. Commerce handles price, payment and refunds."}{" "}
            <Link href="/v2/market/sell?type=digital">{japanese ? "Commerce で商品を作る" : "Create a product in Commerce"}</Link>
          </p>
          <GameSellerVerificationPanel initialVerified={sellerStatus.verified} initialExpiresAt={sellerStatus.expiresAt} />
          {selected.status !== "published" ? (
            <p role="alert">{japanese ? "このゲームはまだ公開されていないため、出品できません。" : "This game is not published yet, so it cannot be listed."}</p>
          ) : null}
          <GameStoreSettings key={selected.id} gameId={selected.id} />
        </section>
      )}
    </V2Shell>
  );
}
