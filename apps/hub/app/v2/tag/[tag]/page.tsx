import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { cache } from "react";
import { tagKeyFromSlug, tagSlug } from "@jkamma/content-tags";

import { V2Aside } from "@/components/v2/v2-aside";
import { V2ColumnHead } from "@/components/v2/v2-columns";
import { V2DetailSection } from "@/components/v2/v2-detail";
import { V2FeedTabs } from "@/components/v2/v2-feed-tabs";
import { V2Shell } from "@/components/v2/v2-shell";
import { V2State } from "@/components/v2/v2-state";
import { V2TagFollow } from "@/components/v2/v2-tag-follow";
import { V2TagMusicOriginals } from "@/components/v2/v2-tag-music-originals";
import { V2TagPosts } from "@/components/v2/v2-tag-posts";
import { V2VideoCard } from "@/components/v2/v2-video-card";
import { musicDisplayTitle, musicWorkArtworkUrl } from "@/lib/music-catalog";
import { getAppShellData } from "@/lib/server/app-shell-data";
import { isFollowingTag } from "@/lib/server/d1-user-article-tag-follows";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { getHubLocale } from "@/lib/server/locale";
import { searchByTag, TAG_KINDS, TAG_KIND_PAGE_SIZE, type TagKind, type TagSearchResult } from "@/lib/server/d1-tag-search";
import { canonicalTagSlug } from "@/lib/tag-href";
import { getThreadType, THREAD_TYPE_LABELS } from "@/lib/thread-type";
import { formatTagCount, parseTagView, tagViewLabel, v2TagTabs } from "@/lib/v2-tag-tabs";
import { v2NavItems } from "@/lib/v2-nav";
import { relativeTime } from "@/lib/v2-time";

import "../../v2.css";
import "@/app/v2/v2-luxe.css";
import "@/app/v2/v2-luxe-commerce.css";

export const dynamic = "force-dynamic";

function decodeSlug(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

type SearchParams = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/* generateMetadata and the page ask for the same tag, so the queries run once per request. */
const loadTag = cache(async (key: string, kind: TagKind | null, cursor: string | null): Promise<TagSearchResult | null> => {
  const database = getOptionalHubD1();
  if (!database) return null;
  return searchByTag(database, key, null, { kind, cursor });
});

const totalOf = (result: TagSearchResult | null) => (result ? TAG_KINDS.reduce((sum, kind) => sum + result.counts[kind], 0) : 0);

export async function generateMetadata({ params, searchParams }: { params: Promise<{ tag: string }>; searchParams: Promise<SearchParams> }): Promise<Metadata> {
  const { tag } = await params;
  const slug = canonicalTagSlug(decodeSlug(tag));
  const key = slug ? tagKeyFromSlug(slug) : null;
  if (!slug || !key) return { title: "タグ | Hub v2", robots: { index: false } };
  const query = await searchParams;
  const result = await loadTag(key, parseTagView(first(query.kind)), first(query.cursor) ?? null).catch(() => null);
  const empty = Boolean(result) && result!.failed.length === 0 && totalOf(result) === 0;
  return {
    title: `#${result?.tag ?? key} | タグ | Hub v2`,
    alternates: { canonical: `/v2/tag/${slug}` },
    /* A tag nothing public carries is not worth indexing; a failed read is not "empty", so it stays indexable. */
    robots: empty || !result ? { index: false, follow: true } : undefined,
  };
}

/*
 * The one tag page. /v2/tag/<tagSlug(key)> is canonical; every other spelling (display form, #prefix,
 * full-width) redirects there. Lists and counts come only from visible tag links (d1-tag-search.ts).
 */
export default async function V2TagPage({ params, searchParams }: { params: Promise<{ tag: string }>; searchParams: Promise<SearchParams> }) {
  const { tag: rawTag } = await params;
  const query = await searchParams;
  const requestedKind = first(query.kind);
  const kind = parseTagView(requestedKind);
  const cursor = first(query.cursor) ?? null;

  const decoded = decodeSlug(rawTag);
  const slug = canonicalTagSlug(decoded);
  const key = slug ? tagKeyFromSlug(slug) : null;
  if (!slug || !key) notFound();
  if (decoded !== key) {
    const carry = new URLSearchParams();
    if (kind) carry.set("kind", kind);
    if (kind && cursor) carry.set("cursor", cursor);
    permanentRedirect(`/v2/tag/${slug}${carry.size ? `?${carry}` : ""}`);
  }

  const locale = await getHubLocale();
  const japanese = locale === "ja";
  const database = getOptionalHubD1();
  const [shell, result] = await Promise.all([
    getAppShellData(),
    loadTag(key, kind, kind ? cursor : null).catch(() => null),
  ]);
  const viewerProfileId = shell.currentProfile.id ?? "";
  const following = database && viewerProfileId ? await isFollowingTag(database, viewerProfileId, key).catch(() => false) : false;
  const items = v2NavItems(japanese, { notifications: shell.unreadIndicatorCount, messages: shell.unreadMessageCount });

  const display = result?.tag ?? key;
  const counts = result?.counts ?? { posts: 0, threads: 0, articles: 0, videos: 0, music: 0, market: 0 };
  const failed = new Set<TagKind>(result?.failed ?? (TAG_KINDS as readonly TagKind[]));
  const total = totalOf(result);
  const shown: readonly TagKind[] = kind ? [kind] : TAG_KINDS.filter((item) => counts[item] > 0);
  const label = (item: TagKind) => tagViewLabel(item, japanese);
  const tabs = v2TagTabs({ tag: key, selected: kind, counts, japanese });
  const base = `/v2/tag/${tagSlug(key)}`;
  const more = (item: TagKind) => {
    const next = result?.nextCursors[item];
    return next ? (
      <p className="v2-tag-more"><Link className="v2-card__link" href={`${base}?kind=${item}&cursor=${next}`}>{japanese ? "さらに表示" : "Show more"}</Link></p>
    ) : null;
  };
  const sectionNote = (item: TagKind) => (!kind && counts[item] > (result?.[item]?.length ?? 0)
    ? <Link className="v2-card__link" href={`${base}?kind=${item}`}>{japanese ? `すべて見る ${formatTagCount(counts[item])}` : `See all ${formatTagCount(counts[item])}`}</Link>
    : undefined);
  const viewerId = viewerProfileId;
  const everythingFailed = !result || (failed.size >= TAG_KINDS.length && total === 0);

  return (
    <V2Shell skin="luxe"
      currentPath="/v2/search"
      profile={shell.currentProfile}
      items={items}
      aside={<V2Aside posts={shell.socialPosts} japanese={japanese} signedIn={Boolean(viewerId)} viewerId={viewerId} title={japanese ? "並べて見る" : "Alongside"} />}
      japanese={japanese}
    >
      <V2ColumnHead heading title={`#${display}`} action={<>
        <span className="v2-heading__note">{japanese ? `${formatTagCount(total)}件` : formatTagCount(total)}</span>
        <V2TagFollow tag={key} initialFollowing={following} authenticated={Boolean(viewerId)} japanese={japanese} signInNext={base} />
      </>} />

      <V2FeedTabs label={japanese ? "タグの種類" : "Kinds"} tabs={tabs} className="v2-feed-tabs--many" />

      {everythingFailed ? (
        <V2State kind="error" japanese={japanese} note={japanese ? "タグの一覧を読み込めませんでした。時間をおいてもう一度お試しください。" : "The tag could not be loaded. Try again in a moment."} action={{ label: japanese ? "再読み込み" : "Reload", href: kind ? `${base}?kind=${kind}` : base }} />
      ) : null}

      {!everythingFailed && total === 0 && failed.size === 0 ? (
        <V2State kind="empty" japanese={japanese} title={japanese ? `#${display} の付いたものはまだありません` : `Nothing tagged #${display} yet`} action={{ label: japanese ? "検索へ" : "Search", href: `/v2/search?q=${encodeURIComponent(display)}` }} />
      ) : null}

      {kind && !everythingFailed && failed.has(kind) ? (
        <V2State kind="error" compact japanese={japanese} title={japanese ? `${label(kind)}を読み込めませんでした` : `Could not load ${label(kind)}`} action={{ label: japanese ? "再読み込み" : "Reload", href: `${base}?kind=${kind}` }} />
      ) : null}

      {kind && !everythingFailed && !failed.has(kind) && counts[kind] === 0 && total > 0 ? (
        <V2State kind="empty" compact japanese={japanese} title={japanese ? `#${display} の${label(kind)}はまだありません` : `No ${label(kind)} tagged #${display} yet`} />
      ) : null}

      {shown.includes("posts") && result?.posts.length ? (
        <V2DetailSection title={label("posts")} note={sectionNote("posts")}>
          <V2TagPosts posts={result.posts} viewerId={viewerId} locale={locale} />
          {more("posts")}
        </V2DetailSection>
      ) : null}

      {shown.includes("threads") && result?.threads.length ? (
        <V2DetailSection title={label("threads")} note={sectionNote("threads")}>
          <ul className="v2-tlist">
            {result.threads.map((thread) => (
              <li key={thread.id} className="v2-tcard">
                <p className="v2-tcard__meta">
                  <span className="v2-badge">{THREAD_TYPE_LABELS[getThreadType(thread)]}</span>
                  <span className="v2-post__time">{relativeTime(thread.updatedAt, locale)}</span>
                </p>
                <Link className="v2-tcard__title" href={`/v2/threads/${thread.id}`}>{thread.title}</Link>
                <p className="v2-tcard__foot"><span className="v2-tcard__count">{japanese ? `${thread.postCount}件の返信` : `${thread.postCount} replies`}</span></p>
              </li>
            ))}
          </ul>
          {more("threads")}
        </V2DetailSection>
      ) : null}

      {shown.includes("articles") && result?.articles.length ? (
        <V2DetailSection title={label("articles")} note={sectionNote("articles")}>
          <ul className="v2-agrid">
            {result.articles.map((article) => (
              <li key={article.contentId}>
                <Link className="v2-acard" href={article.href}>
                  <span className="v2-acard__art">
                    {article.thumbnailUrl ? <img src={article.thumbnailUrl} alt="" loading="lazy" /> : <span className="v2-acard__cover" aria-hidden="true">{article.tags?.[0] ?? (japanese ? "記事" : "Article")}</span>}
                  </span>
                  <strong className="v2-acard__title">{article.title}</strong>
                  <small className="v2-acard__meta"><span>{article.author}</span></small>
                </Link>
              </li>
            ))}
          </ul>
          {more("articles")}
        </V2DetailSection>
      ) : null}

      {shown.includes("videos") && result?.videos.length ? (
        <V2DetailSection title={label("videos")} note={sectionNote("videos")}>
          <ul className="v2-vgrid">
            {result.videos.map((video) => <li key={video.id}><V2VideoCard video={video} locale={locale} /></li>)}
          </ul>
          {more("videos")}
        </V2DetailSection>
      ) : null}

      {!kind && counts.music === 0 && !everythingFailed ? (
        <V2TagMusicOriginals slug={slug} limit={6} japanese={japanese} sectionTitle={label("music")} />
      ) : null}

      {shown.includes("music") ? (
        <V2DetailSection title={label("music")} note={sectionNote("music")}>
          {result?.music.length ? (
            <ul className="v2-mgrid">
              {result.music.map((work) => {
                const art = musicWorkArtworkUrl(work);
                return (
                  <li key={work.id} className="v2-mcard">
                    <Link className="v2-mcard__art" href={`/v2/music?q=${encodeURIComponent(work.title)}`} style={art ? undefined : { background: work.accent }}>
                      {art ? <img src={art} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <b>{work.symbol}</b>}
                    </Link>
                    <div className="v2-mcard__body">
                      <strong className="v2-mcard__title">{musicDisplayTitle(work.title)}</strong>
                      <span className="v2-mcard__artist">{work.artist}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : null}
          {more("music")}
          {/* Original tracks live in the Music Worker; the browser asks it directly and shows nothing on failure. */}
          <V2TagMusicOriginals slug={slug} limit={kind === "music" ? TAG_KIND_PAGE_SIZE : 6} japanese={japanese} />
        </V2DetailSection>
      ) : null}

      {shown.includes("market") && result?.market.length ? (
        <V2DetailSection title={label("market")} note={sectionNote("market")}>
          <ul className="v2-mgrid">
            {result.market.map((product) => (
              <li key={product.id} className="v2-mcard">
                <Link className="v2-mcard__art" href={`/shopping/search?q=${encodeURIComponent(product.title)}`} style={product.imageUrl ? undefined : { background: product.color }}>
                  {product.imageUrl ? <img src={product.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <b>{product.icon}</b>}
                </Link>
                <div className="v2-mcard__body">
                  <strong className="v2-mcard__title">{product.title}</strong>
                  <span className="v2-mcard__artist">{product.seller}</span>
                </div>
              </li>
            ))}
          </ul>
          {more("market")}
        </V2DetailSection>
      ) : null}
    </V2Shell>
  );
}
