import type { Metadata } from "next";
import Link from "next/link";
import { permanentRedirect } from "next/navigation";

import { Avatar } from "@/components/v2/ui/avatar";
import { Chip, ChipRow } from "@/components/v2/ui/chip";
import { Tabs } from "@/components/v2/ui/tabs";
import { V2Aside } from "@/components/v2/v2-aside";
import { V2ArticleList } from "@/components/v2/v2-article-list";
import { V2ColumnHead } from "@/components/v2/v2-columns";
import { V2Empty } from "@/components/v2/v2-empty";
import { V2GateBadge } from "@/components/v2/v2-gate-badge";
import { V2ProfileGatedButton, V2ProfileGatedWorks } from "@/components/v2/v2-profile-gated";
import { profileHasGatedContent } from "@/lib/server/profile-gated-presence";
import { listProfileGatedWorks } from "@/lib/server/profile-gated-works";
import { V2ProfileActions } from "@/components/v2/v2-profile-actions";
import { V2ProfileActivity, type V2ProfileTab } from "@/components/v2/v2-profile-activity";
import { V2ProfileEdit } from "@/components/v2/v2-profile-edit";
import { V2Shell } from "@/components/v2/v2-shell";
import { V2Trust } from "@/components/v2/v2-trust";
import type { PublicAccessGate } from "@/lib/access-gates/types";
import { getActiveAccountMove } from "@/lib/server/account-bundle";
import { getAppShellData } from "@/lib/server/app-shell-data";
import { listOwnSeries } from "@/lib/server/d1-user-article-series";
import { countUserArticlesByAuthor, decodeArticleCursor, encodeArticleCursor, listUserArticlePage } from "@/lib/server/d1-user-article-queries";
import { articleCardExtras } from "@/lib/v2-article-card-extras";
import { likeCountsForArticles } from "@/lib/server/d1-user-article-engagement";
import { memberArticleContent } from "@/lib/v2-articles";
import { getHubLocale } from "@/lib/server/locale";
import { getProfilePageData } from "@/lib/server/profile-page-data";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { getPublicWorkOffer } from "@/lib/server/d1-work";
import { listD1AuthorHubVideosPage } from "@/lib/server/d1-videos";
import { listPublicCodeRepositoriesByOwner } from "@/lib/server/code-repositories";
import { isOptionalServiceEnabled } from "@/lib/optional-services";
import { decodeWorkCursor, encodeWorkCursor, PROFILE_WORKS_PAGE } from "@/lib/server/profile-works";
import { buildPublicTrustEvidence, visiblePublicTrustEvidence } from "@/lib/public-hub-trust";
import { getD1PublicTrustCounts } from "@/lib/server/d1-public-trust";
import { v2NavItems } from "@/lib/v2-nav";

import "../../v2.css";
import "../../v2-luxe.css";
import "../../v2-luxe-social.css";

export const dynamic = "force-dynamic";

type ProfileTabId = V2ProfileTab | "articles" | "videos" | "code" | "gated";

const TABS: { id: ProfileTabId; ja: string; en: string }[] = [
  { id: "posts", ja: "投稿", en: "Posts" },
  { id: "articles", ja: "記事", en: "Articles" },
  { id: "replies", ja: "返信", en: "Replies" },
  { id: "media", ja: "メディア", en: "Media" },
  { id: "threads", ja: "スレッド", en: "Threads" },
  { id: "videos", ja: "動画", en: "Videos" },
  { id: "code", ja: "コード", en: "Code" },
  { id: "gated", ja: "鍵つきの作品", en: "Locked works" },
];

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export async function generateMetadata({ params }: { params: Promise<{ handle: string }> }): Promise<Metadata> {
  const { handle } = await params;
  const data = await getProfilePageData(handle, true);
  return { title: data.profile ? `${data.profile.displayName} | Hub v2` : "プロフィールが見つかりません | Hub v2" };
}

/*
 * v2 のプロフィール。既存の /profile/[handle] には触れない。
 * データは既存の getProfilePageData をそのまま使う。
 * 内側左列: 区分4つ、リンク、公開している
 * コミュニティとウォレット、既存の画面への入口。
 * 本人は名前・自己紹介・リンクの編集と投稿の固定。他人はフォロー・メッセージ・
 * ミュート・ブロック・通報。凍結された相手は既存と同じく「見つかりません」。
 */
export default async function V2ProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ handle: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ handle }, query] = await Promise.all([params, searchParams]);
  const locale = await getHubLocale();
  const japanese = locale === "ja";
  const requestedTab = one(query.tab);
  const tab: ProfileTabId = TABS.some((item) => item.id === requestedTab) ? requestedTab as ProfileTabId : "posts";
  const [shell, data] = await Promise.all([getAppShellData(), getProfilePageData(handle, true)]);
  const items = v2NavItems(japanese, { notifications: shell.unreadIndicatorCount, messages: shell.unreadMessageCount });

  if (!data.profile) {
    return (
      <V2Shell skin="luxe" currentPath="/v2/profile" profile={shell.currentProfile} items={items} japanese={japanese}>
        <V2ColumnHead heading title={japanese ? "プロフィールが見つかりません" : "Profile not found"} />
        <p className="v2-note"><Link className="v2-card__link" href="/v2">{japanese ? "フィードへ戻る" : "Back to the feed"}</Link></p>
      </V2Shell>
    );
  }

  /* 移転した人のプロフィールは、移転後12か月、新しい家へ永続的に送る（本人は元のまま見える）。 */
  const movedDatabase = getOptionalHubD1();
  if (movedDatabase && !data.isCurrentUser) {
    const move = await getActiveAccountMove(movedDatabase, data.profile.id).catch(() => null);
    if (move?.newProfileUrl) permanentRedirect(move.newProfileUrl);
  }

  const { profile, isCurrentUser, isRemote, following, followerCount, followingCount, posts, threads, pinnedPostId, externalLinks, communities, wallets, profileControl } = data;

  /*
   * 文脈別実績（構想 第9章）。数えるのは公開の行だけ。
   * D1が無い環境では出さない（無いことを「実績なし」と書かない）。
   */
  const database = getOptionalHubD1();
  /* 受付中の作り手には「依頼する」を出す (jkamma 運営の Hub のみ。満員・自分・リモートには出さない)。 */
  const commissionOpen = Boolean(database && !isCurrentUser && !isRemote && isOptionalServiceEnabled("commerce") && isOptionalServiceEnabled("work-commissions")
    && await getPublicWorkOffer(database, profile.handle).then((offer) => Boolean(offer?.offer.accepting && !offer.full)).catch(() => false));
  const trust = database
    ? visiblePublicTrustEvidence(buildPublicTrustEvidence(await getD1PublicTrustCounts(database, profile.id)), isCurrentUser)
    : [];
  const base = `/v2/profile/${encodeURIComponent(profile.handle)}`;
  const joined = new Intl.DateTimeFormat(japanese ? "ja-JP" : "en-US", { year: "numeric", month: "long" }).format(new Date(profile.joinedAt));
  const hasGated = database ? await profileHasGatedContent(database, profile.id).catch(() => false) : false;
  const articleCount = database ? await countUserArticlesByAuthor(database, profile.id).catch(() => 0) : 0;
  /* 記事タブを開いたときだけ一覧を引く。続きは (created_at, id) のkeyset。 */
  const articleCursorValue = one(query.cursor);
  const articlePage = database && tab === "articles"
    ? await listUserArticlePage(database, { audience: "general", limit: 24, viewerProfileId: shell.currentProfile.id || null, authorProfileId: profile.id, before: decodeArticleCursor(articleCursorValue) }).catch(() => ({ articles: [], nextCursor: null }))
    : { articles: [], nextCursor: null };
  /* 著者の公開シリーズ（記事が1本以上見えるものだけ）。シリーズの画面は誰でも開ける。 */
  const authorSeries = database && tab === "articles"
    ? (await listOwnSeries(database, profile.id).catch(() => [])).filter((series) => series.articleCount > 0)
    : [];
  /* 動画（Hubで作った公開動画）とコード（公開リポジトリ）も、開いたタブの1ページだけ引く。件数は数えない。 */
  const worksCursor = tab === "videos" || tab === "code" || tab === "gated" ? decodeWorkCursor(one(query.cursor)) : null;
  const videoPage = database && tab === "videos"
    ? await listD1AuthorHubVideosPage(database, profile.id, { limit: PROFILE_WORKS_PAGE, before: worksCursor }).catch(() => null)
    : null;
  /* 鍵つきの作品: 投稿・記事・動画をまとめて新しい順の1本のkeyset。 */
  const gatedPage = database && tab === "gated"
    ? await listProfileGatedWorks(database, profile.id, shell.currentProfile.id || null, { before: worksCursor }).catch(() => null)
    : null;
  const codeEnabled = isOptionalServiceEnabled("code");
  const codePage = database && tab === "code" && codeEnabled
    ? await listPublicCodeRepositoriesByOwner(database, profile.id, { limit: PROFILE_WORKS_PAGE, before: worksCursor }).catch(() => null)
    : null;
  const articleLikeCounts = database && articlePage.articles.length ? await likeCountsForArticles(database, articlePage.articles.map((article) => article.id)) : undefined;
  const counts: Partial<Record<ProfileTabId, number>> = {
    articles: articleCount,
    posts: posts.filter((post) => !post.replyToPostId).length,
    replies: posts.filter((post) => Boolean(post.replyToPostId)).length,
    media: posts.filter((post) => Boolean(post.images?.length)).length,
    threads: threads.length,
  };

  const tabItems = TABS.filter((item) => item.id !== "code" || codeEnabled).map((item) => ({
    id: item.id,
    label: japanese ? item.ja : item.en,
    href: item.id === "posts" ? base : `${base}?tab=${item.id}`,
    count: counts[item.id],
  }));
  const shownCommunities = communities.filter((community) => community.published || isCurrentUser);
  const shownWallets = wallets.filter((wallet) => wallet.published);
  /* 本人だけに見える入口（保存したもの・つくる・管理する）。他人には出さない。 */
  const ownerLinks: [string, string][] = japanese
    ? [["ブックマーク", "/v2/bookmarks"], ["リスト", "/v2/lists"], ["チャンネルを管理", "/v2/studio/videos"], ["クリエイターセンター", "/v2/creator"], ["記事の下書き", "/v2/articles/drafts"], ["記事のシリーズ", "/v2/articles/series"], ["記事の統計", "/v2/articles/stats"]]
    : [["Bookmarks", "/v2/bookmarks"], ["Lists", "/v2/lists"], ["Manage channel", "/v2/studio/videos"], ["Creator Center", "/v2/creator"], ["Article drafts", "/v2/articles/drafts"], ["Article series", "/v2/articles/series"], ["Article stats", "/v2/articles/stats"]];
  const hasChips = commissionOpen || externalLinks.length > 0 || shownCommunities.length > 0 || shownWallets.length > 0 || isCurrentUser;

  return (
    <V2Shell skin="luxe"
      currentPath={base}
      profile={shell.currentProfile}
      items={items}
      aside={<V2Aside posts={shell.socialPosts} japanese={japanese} signedIn={Boolean(shell.currentProfile.id)} viewerId={shell.currentProfile.id} title={japanese ? "並べて見る" : "Alongside"} />}
      japanese={japanese}
    >
      <V2ColumnHead heading title={japanese ? "プロフィール" : "Profile"} />

      <section className="v2-profile">
        <div className="v2-profile__cover" aria-hidden="true" />
        <div className="v2-profile__card">
          <div className="v2-profile__top" data-owner={isCurrentUser ? "true" : undefined}>
            <span className="v2-profile__avatar-ring"><Avatar name={profile.displayName} src={profile.avatarUrl} size={96} priority /></span>
            {hasGated ? <V2ProfileGatedButton handle={profile.handle} japanese={japanese} /> : null}
            {isCurrentUser
              ? <V2ProfileEdit handle={profile.handle} initialCommunities={communities} initialWallets={wallets} initialDisplayName={profile.displayName} initialBio={profile.bio} initialLinks={externalLinks} locale={locale} />
              : <V2ProfileActions targetProfileId={profile.id} handle={profile.handle} initialFollowing={following} initialControl={profileControl} signedIn={Boolean(shell.currentProfile.id)} locale={locale} canMessage={!isRemote} remoteHost={isRemote ? profile.handle.split("@")[1] ?? null : null} />}
          </div>
          <div className="v2-profile__identity">
            <p className="v2-profile__name">{profile.displayName}</p>
            <p className="v2-profile__handle">@{profile.handle}</p>
            <p className={profile.bio ? "v2-profile__bio" : "v2-profile__bio v2-profile__bio--empty"}>
              {profile.bio || (isCurrentUser ? (japanese ? "自己紹介を書くと、ほかの利用者に活動が伝わります。" : "Add a bio so others know what you do.") : (japanese ? "自己紹介はまだありません。" : "No bio yet."))}
            </p>
            <p className="v2-profile__meta">
              <span>{japanese ? `${joined}から` : `Since ${joined}`}</span>
              {isCurrentUser ? <span className="v2-badge">{japanese ? "あなた" : "You"}</span> : null}
            </p>
            {/* 件数とフォロー一覧への入口は、画面幅によらずプロフィール本文に置く。 */}
            <p className="v2-profile__counts v2-profile__counts--inline">
              <span><strong>{posts.length}</strong><small>{japanese ? "ポスト" : "Posts"}</small></span>
              <Link href={`/v2/profile/${profile.handle}/followers`}><strong>{followerCount}</strong><small>{japanese ? "フォロワー" : "Followers"}</small></Link>
              <Link href={`/v2/profile/${profile.handle}/following`}><strong>{followingCount}</strong><small>{japanese ? "フォロー" : "Following"}</small></Link>
            </p>
          </div>
          {hasChips ? (
            <div className="v2-profile__chips">
              <ChipRow label={japanese ? "リンクと所属" : "Links and communities"}>
                {externalLinks.map((link) => (
                  <a key={link.url} className="ui-chip" href={link.url} target="_blank" rel="noopener noreferrer nofollow ugc">{link.label || link.url}</a>
                ))}
                {shownCommunities.map((community) => (
                  <Chip key={community.id} href={`/v2/community?community=${encodeURIComponent(community.slug)}`}>{community.name}{!community.published ? (japanese ? "（非公開）" : " (private)") : ""}</Chip>
                ))}
                {shownWallets.map((wallet) => (
                  <span key={wallet.address} className="ui-chip">{wallet.network} {wallet.address.slice(0, 6)}…{wallet.address.slice(-4)}</span>
                ))}
                {commissionOpen ? <Chip href={`/v2/commissions/new?to=${encodeURIComponent(profile.handle)}`}>{japanese ? "依頼する" : "Request work"}</Chip> : null}
                {isCurrentUser ? ownerLinks.map(([label, href]) => <Chip key={href} href={href}>{label}</Chip>) : null}
              </ChipRow>
            </div>
          ) : null}
        </div>

        {/* 活動の種類。帯の下のタブ。 */}
        <div className="v2-subtabs"><Tabs items={tabItems} value={tab} label={japanese ? "活動の種類" : "Activity"} /></div>
        {tab === "articles" && authorSeries.length ? (
          <section className="v2-profile-series" aria-labelledby="v2-profile-series-title">
            <h2 id="v2-profile-series-title" className="v2-column__title v2-column__title--section">{japanese ? "シリーズ" : "Series"}</h2>
            <ul className="v2-nav__list">
              {authorSeries.map((series) => (
                <li key={series.id}>
                  <Link className="v2-nav__item" href={`/v2/articles/series/${series.id}`}>
                    <span className="v2-nav__label">{series.title}</span>
                    <span className="v2-nav__count">{japanese ? `${series.articleCount}本` : series.articleCount}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {tab === "articles" ? (
          <V2ArticleList
            key={articleCursorValue || "first"}
            articles={articlePage.articles.map(memberArticleContent)}
            kind="authored"
            access="public"
            query=""
            sort="latest"
            locale={locale}
            extras={articleCardExtras(articlePage.articles, articleLikeCounts)}
            nextHref={articlePage.nextCursor ? `${base}?tab=articles&cursor=${encodeURIComponent(encodeArticleCursor(articlePage.nextCursor))}` : null}
            emptyAction={isCurrentUser}
          />
        ) : tab === "gated" ? (
          !gatedPage ? <V2Empty title={japanese ? "読み込めませんでした。" : "Could not load this tab."} /> : !gatedPage.items.length ? <V2Empty title={japanese ? "鍵つきの作品はまだありません。" : "No locked works yet."} /> : (
            <>
              <V2ProfileGatedWorks locale={locale} items={gatedPage.items.map((item) => item.type === "post" ? { type: "post" as const, id: item.id, post: item.post as never, gate: item.gate } : item)} />
              {gatedPage.nextCursor ? <p><Link className="v2-nav__item" href={`${base}?tab=gated&cursor=${encodeURIComponent(encodeWorkCursor(gatedPage.nextCursor))}`}>{japanese ? "もっと見る" : "Show more"}</Link></p> : null}
            </>
          )
        ) : tab === "videos" || tab === "code" ? (
          <ProfileWorksList
            japanese={japanese}
            failed={tab === "videos" ? !videoPage : !codePage}
            items={tab === "videos"
              ? (videoPage?.videos ?? []).map((video) => ({ key: video.id, href: video.href, label: video.title, meta: video.locked ? "" : video.duration ?? "", gate: video.gate }))
              : (codePage?.repositories ?? []).map((repo) => ({ key: repo.id, href: `/v2/code/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`, label: repo.name, meta: repo.description }))}
            nextHref={(() => {
              const next = tab === "videos" ? videoPage?.nextCursor : codePage?.nextCursor;
              return next ? `${base}?tab=${tab}&cursor=${encodeURIComponent(encodeWorkCursor(next))}` : null;
            })()}
            emptyTitle={tab === "videos" ? (japanese ? "公開している動画はまだありません。" : "No public videos yet.") : (japanese ? "公開しているリポジトリはまだありません。" : "No public repositories yet.")}
          />
        ) : (
          <V2ProfileActivity
            key={tab}
            handle={profile.handle}
            tab={tab}
            initialPosts={posts}
            threads={threads}
            pinnedPostId={pinnedPostId}
            isCurrentUser={isCurrentUser}
            viewerId={shell.currentProfile.id ?? ""}
            locale={locale}
          />
        )}

        {/* Hub Trust は投稿の下（SPEC 4.12）。 */}
        {trust.length ? <V2Trust evidence={trust} japanese={japanese} /> : null}
      </section>
    </V2Shell>
  );
}

/* 動画とコードのタブ。1行に題名と短い補足だけ。続きは keyset のカーソルで次のページへ。 */
function ProfileWorksList({ japanese, failed, items, nextHref, emptyTitle, hideEmpty = false }: {
  hideEmpty?: boolean;
  japanese: boolean;
  failed: boolean;
  items: { key: string; href: string; label: string; meta: string; gate?: PublicAccessGate }[];
  nextHref: string | null;
  emptyTitle: string;
}) {
  if (failed) return <V2Empty title={japanese ? "読み込めませんでした。" : "Could not load this tab."} />;
  if (!items.length) return hideEmpty ? null : <V2Empty title={emptyTitle} />;
  return (
    <section className="v2-profile-series">
      <ul className="v2-nav__list">
        {items.map((item) => (
          <li key={item.key}>
            <Link className="v2-nav__item" href={item.href}>
              <span className="v2-nav__label">{item.label}</span>
              {item.gate ? <V2GateBadge gate={item.gate} japanese={japanese} /> : null}
              {item.meta ? <span className="v2-nav__count">{item.meta}</span> : null}
            </Link>
          </li>
        ))}
      </ul>
      {nextHref ? <p><Link className="v2-nav__item" href={nextHref}>{japanese ? "さらに表示" : "Show more"}</Link></p> : null}
    </section>
  );
}
