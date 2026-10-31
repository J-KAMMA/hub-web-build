import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { GameGuideArticle } from "@/components/game-guide-article";
import { V2PanelPage } from "@/components/v2/v2-panel-page";
import { getPublicGameGuide } from "@/lib/server/public-game-guides";

import "../../../../../v2.css";
import { getInstanceOrigin } from "@/lib/instance-origin";

export const dynamic = "force-dynamic";

type PageParams = { gameSlug: string; guidePath: string[] };

export async function generateMetadata({ params }: { params: Promise<PageParams> }): Promise<Metadata> {
  const value = await params;
  const result = await getPublicGameGuide(value.gameSlug, value.guidePath.join("/"));
  if (!result) return { title: "攻略ページが見つかりません | Hub v2" };
  /* canonical は外へ出ている既存の道のまま（検索の索引を1本に寄せる）。 */
  const canonical = `${getInstanceOrigin()}/games/${encodeURIComponent(result.hub.slug)}/guides/${result.guide.path.split("/").map(encodeURIComponent).join("/")}`;
  const description = result.guide.canonical.body.replace(/\s+/g, " ").slice(0, 150);
  return {
    title: `${result.guide.title} | ${result.hub.title} | Hub v2`,
    description,
    alternates: { canonical },
    robots: result.hub.isFixture ? { index: false, follow: false } : undefined,
  };
}

/*
 * ゲームの攻略（2026-10-29、ゲームの店から移した。旧 /v2/games/…/guides/… はここへ恒久転送）。
 * 本文は既存と同じ部品。
 */
export default async function V2CommunityGameGuidePage({ params }: { params: Promise<PageParams> }) {
  const value = await params;
  const result = await getPublicGameGuide(value.gameSlug, value.guidePath.join("/"));
  if (!result) notFound();
  return (
    <V2PanelPage panelOwnsHeading wide currentPath="/v2/community" title={result.guide.title}>
      <GameGuideArticle
        hub={result.hub}
        guide={result.guide}
        origin={getInstanceOrigin()}
        indexHref="/v2/community/games"
        hubHref={`/v2/community/games/${encodeURIComponent(result.hub.slug)}`}
      />
    </V2PanelPage>
  );
}
