"use client";

import Link from "next/link";

import { hubSurfacePath, useHubUiSurface } from "@/lib/use-hub-ui-surface";

/*
 * ゲームの手引きの本文（2026-09-04）。
 *
 * もとは app/games/[gameSlug]/guides/[...guidePath]/page.tsx に直に書いてあった。
 * v2 にも同じ画面が要るので、**複製せず部品に切り出す**。
 *
 * パンくずとコミュニティの行き先は今いる面の中へ。
 */
type Variant = { id: string; communityName: string; communitySlug: string; version: number | string };

export type GameGuideArticle = {
  hub: { slug: string; title: string; isFixture: boolean };
  guide: {
    title: string;
    path: string;
    updatedAt: string;
    sectionNames: string[];
    canonical: {
      body: string;
      verificationStatus: string;
      verificationCount: number;
      gameVersion?: string | null;
    };
    variants: Variant[];
  };
};

function statusLabel({ hub, guide }: GameGuideArticle): string {
  if (hub.isFixture) return "開発用サンプル（公開情報ではありません）";
  if (guide.canonical.verificationStatus === "verified") {
    const version = guide.canonical.gameVersion ? ` · ${guide.canonical.gameVersion}` : "";
    return `検証済み${version} · ${guide.canonical.verificationCount}件`;
  }
  return guide.canonical.verificationStatus === "recheck_required" ? "アップデート後の再検証が必要" : "未検証";
}

export function GameGuideArticle({ hub, guide, origin, indexHref, hubHref }: GameGuideArticle & { origin: string; indexHref?: string; hubHref?: string }) {
  const surface = useHubUiSurface();
  const url = `${origin}/games/${hub.slug}/guides/${guide.path}`;
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: guide.title,
    dateModified: guide.updatedAt,
    mainEntityOfPage: url,
    isPartOf: { "@type": "WebSite", name: hub.title, url: `${origin}/games/${hub.slug}` },
    author: guide.variants.map((variant) => ({ "@type": "Organization", name: variant.communityName })),
  };

  return (
    <div className="game-guide-public game-guide-article">
      {hub.isFixture ? null : (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }}
        />
      )}
      <nav className="game-guide-public__breadcrumbs" aria-label="パンくず">
        <Link href={indexHref ?? hubSurfacePath(surface, "/games")}>ゲーム攻略</Link>
        <span>›</span>
        <Link href={hubHref ?? hubSurfacePath(surface, `/games/${hub.slug}`)}>{hub.title}</Link>
        <span>›</span>
        {guide.sectionNames.map((name) => <span key={name}>{name}<i>›</i></span>)}
        <span>{guide.title}</span>
      </nav>
      <article>
        <header>
          <small>{statusLabel({ hub, guide })}</small>
          <h1>{guide.title}</h1>
          <p>最終更新 {new Intl.DateTimeFormat("ja-JP", { dateStyle: "long" }).format(new Date(guide.updatedAt))}</p>
        </header>
        <div className="game-guide-article__body">{guide.canonical.body}</div>
        <footer>
          <strong>情報提供</strong>
          <div>
            {guide.variants.map((variant) => (
              <Link href={hubSurfacePath(surface, `/community?community=${variant.communitySlug}`)} key={variant.id}>
                {variant.communityName}<small>v{variant.version}</small>
              </Link>
            ))}
          </div>
          {guide.variants.length > 1 && (
            <p>複数のコミュニティから同じ攻略テーマの情報が提供されています。最新版を本文として表示し、各情報源を保持しています。</p>
          )}
        </footer>
      </article>
    </div>
  );
}
