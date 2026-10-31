import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { V2ColumnHead } from "@/components/v2/v2-columns";
import { V2DirectoryRail } from "@/components/v2/v2-directory-rail";
import { V2GameRequirements, V2GameStoreHead } from "@/components/v2/v2-game-store";
import { V2GamesSections } from "@/components/v2/v2-games-directory";
import { V2Shell } from "@/components/v2/v2-shell";
import { getAppShellData } from "@/lib/server/app-shell-data";
import { V2LibraryColumn } from "@/components/v2/v2-library-column";
import { loadViewerLibrary } from "@/lib/server/library-column";
import { getHubLocale } from "@/lib/server/locale";
import { getPublicGameGuideHub } from "@/lib/server/public-game-guides";
import { v2NavItems } from "@/lib/v2-nav";

import "../../v2.css";
import "../../v2-games.css";
import "@/app/v2/v2-luxe.css";
import "@/app/v2/v2-luxe-pages.css";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ gameSlug: string }> }): Promise<Metadata> {
  const { gameSlug } = await params;
  const hub = await getPublicGameGuideHub(gameSlug);
  return { title: `${hub?.title ?? "ゲーム"} | ゲーム | Hub v2`, robots: hub?.isFixture ? { index: false, follow: false } : undefined };
}

/*
 * ストアの作品頁（2026-10-18、所有者の指示で Steam のようなストアに）。頭（絵・要約・発売日・対応機種・
 * 購入の箱）、動作環境。攻略ガイドはコミュニティ側（/v2/community/games/[slug]）へ移した（2026-10-29）。価格と購入は Commerce の商品（ブラウザから直接）、所有は Hub が証明を確かめて記録する。コミュニティの埋め込み（作品のトーク・右列の投稿）は外し、
 * 議論は公開コミュニティへのリンク1本にした。攻略の本文は /v2/games/[slug]/guides/… のまま。
 */
export default async function V2GameHubPage({ params }: { params: Promise<{ gameSlug: string }> }) {
  const [{ gameSlug }, locale, shell] = await Promise.all([params, getHubLocale(), getAppShellData()]);
  const japanese = locale === "ja";
  const library = await loadViewerLibrary(shell.currentProfile.id, "games", japanese);
  const hub = await getPublicGameGuideHub(gameSlug);
  if (!hub) notFound();
  const items = v2NavItems(japanese, { notifications: shell.unreadIndicatorCount, messages: shell.unreadMessageCount });

  return (
    <V2Shell skin="luxe" directoryRail={<V2DirectoryRail back={{ href: "/v2/games", label: japanese ? "ストアへ" : "Store" }} japanese={japanese} />}
      currentPath="/v2/games"
      profile={shell.currentProfile}
      items={items}
      directoryTitle={japanese ? "ゲーム" : "Games"}
      directory={<><V2GamesSections current="store" japanese={japanese} /><V2LibraryColumn data={library} signedIn={Boolean(shell.currentProfile.id)} japanese={japanese} next="/v2/games" /></>}
      japanese={japanese}
    >
      <V2ColumnHead heading title={hub.title} />
      <article className="v2-article v2-gstore">
        <V2GameStoreHead japanese={japanese} game={{
          slug: hub.slug, title: hub.title, summary: hub.summary, imageUrl: hub.imageUrl,
          platforms: hub.platforms, releaseDate: hub.releaseDate, isFixture: hub.isFixture,
          communityHref: `/v2/community/games/${encodeURIComponent(hub.slug)}`,
          id: hub.id, storeListing: hub.storeListing, commerceProductId: hub.commerceProductId, ageRating: hub.ageRating,
          screenshots: hub.screenshots, signedIn: Boolean(shell.currentProfile.id),
        }} />
        <V2GameRequirements minimum={hub.requirementsMinimum} recommended={hub.requirementsRecommended} japanese={japanese} />
      </article>
    </V2Shell>
  );
}
