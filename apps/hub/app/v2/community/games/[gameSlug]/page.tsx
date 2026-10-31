import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { V2PanelPage } from "@/components/v2/v2-panel-page";
import { getHubLocale } from "@/lib/server/locale";
import { getPublicGameGuideHub } from "@/lib/server/public-game-guides";

import "../../../v2.css";
import "../../../v2-games.css";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ gameSlug: string }> }): Promise<Metadata> {
  const { gameSlug } = await params;
  const hub = await getPublicGameGuideHub(gameSlug);
  return { title: `${hub?.title ?? "ゲーム"} | コミュニティ | Hub v2`, robots: hub?.isFixture ? { index: false, follow: false } : undefined };
}

/*
 * 作品ごとの攻略の目次と、作品のコミュニティへの入口（2026-10-29、ゲームの店から移した）。
 * 店の作品頁（/v2/games/[slug]）には購入だけを残し、攻略はここ。
 */
export default async function V2CommunityGamePage({ params }: { params: Promise<{ gameSlug: string }> }) {
  const [{ gameSlug }, locale] = await Promise.all([params, getHubLocale()]);
  const japanese = locale === "ja";
  const hub = await getPublicGameGuideHub(gameSlug);
  if (!hub) notFound();
  const guideHref = (path: string) => `/v2/community/games/${encodeURIComponent(hub.slug)}/guides/${path}`;
  const discussion = hub.communities[0];
  return (
    <V2PanelPage
      wide
      currentPath="/v2/community"
      title={hub.title}
      note={<Link href="/v2/community/games">{japanese ? "← ゲーム一覧" : "← Games"}</Link>}
    >
      <article className="v2-article">
        {hub.summary ? <p>{hub.summary}</p> : null}
        <p>
          {discussion ? <Link href={`/v2/community?community=${encodeURIComponent(discussion.slug)}`}>{japanese ? "コミュニティ" : "Community"}</Link> : null}
          {discussion ? " · " : null}
          <Link href={`/v2/games/${encodeURIComponent(hub.slug)}`}>{japanese ? "ストアのページ" : "Store page"}</Link>
        </p>
        {hub.guides.length ? (
          <section className="v2-msec" aria-labelledby="v2-game-guides">
            <header className="v2-msec__head"><h2 id="v2-game-guides" className="v2-column__title v2-column__title--section">{japanese ? "攻略ガイド" : "Guides"}</h2><span className="v2-msec__note">{hub.guides.length}</span></header>
            <ol className="v2-toc__list">
              {hub.guides.map((guide) => (
                <li key={guide.path} className="v2-toc__item"><Link href={guideHref(guide.path)}>{guide.sectionNames.join(" › ")}</Link></li>
              ))}
            </ol>
          </section>
        ) : (
          <p>{japanese ? "攻略ガイドはまだありません。" : "No guides yet."}</p>
        )}
      </article>
    </V2PanelPage>
  );
}
