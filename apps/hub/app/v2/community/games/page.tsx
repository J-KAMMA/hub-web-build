import type { Metadata } from "next";
import Link from "next/link";

import { V2Empty } from "@/components/v2/v2-empty";
import { V2PanelPage } from "@/components/v2/v2-panel-page";
import { getHubLocale } from "@/lib/server/locale";
import { listPublicGameGuideHubs } from "@/lib/server/public-game-guides";

import "../../v2.css";
import "../../v2-games.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "ゲーム | コミュニティ | Hub v2" };

/*
 * コミュニティのゲーム（2026-10-29、所有者の決定）。ゲームの店（/v2/games）は購入とライブラリだけにし、
 * 攻略ガイドと作品ごとの議論の入口はここへ集める。データは従来の攻略ハブのまま。
 */
export default async function V2CommunityGamesPage() {
  const japanese = (await getHubLocale()) === "ja";
  let games: Awaited<ReturnType<typeof listPublicGameGuideHubs>> = [];
  let failed = false;
  try {
    games = await listPublicGameGuideHubs();
  } catch (error) {
    console.error("[community-games] list failed:", error instanceof Error ? error.message : "unknown");
    failed = true;
  }
  return (
    <V2PanelPage
      wide
      currentPath="/v2/community"
      title={japanese ? "ゲーム" : "Games"}
      note={<Link href="/v2/community/games/new">{japanese ? "ゲームの攻略を登録" : "Register a game"}</Link>}
    >
      {failed ? (
        <V2Empty title={japanese ? "ゲームを読み込めませんでした" : "Could not load games"} note={japanese ? "時間をおいて開き直してください。" : "Please try again in a moment."} action={{ label: japanese ? "読み込み直す" : "Reload", href: "/v2/community/games" }} />
      ) : games.length ? (
        <ul className="v2-toc__list">
          {games.map((game) => (
            <li key={game.slug} className="v2-toc__item">
              <Link href={`/v2/community/games/${encodeURIComponent(game.slug)}`}>{game.title}</Link>
              {game.summary ? <p>{game.summary}</p> : null}
            </li>
          ))}
        </ul>
      ) : (
        <V2Empty title={japanese ? "まだゲームがありません" : "No games yet"} note={japanese ? "攻略を書きたい作品を登録すると、ここに並びます。" : "Register a game to start its guides."} action={{ label: japanese ? "ゲームの攻略を登録" : "Register a game", href: "/v2/community/games/new" }} />
      )}
    </V2PanelPage>
  );
}
