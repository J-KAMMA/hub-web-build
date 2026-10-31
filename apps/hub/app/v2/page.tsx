import type { Metadata } from "next";
import Link from "next/link";

import { V2Aside } from "@/components/v2/v2-aside";
import { V2Feed } from "@/components/v2/v2-feed";
import { V2SocialStream } from "@/components/v2/v2-social-stream";
import { contentShareReference } from '@/lib/content-share';
import { ResearchDiscovery } from '@/components/research-discovery';
import { V2ColumnHead } from "@/components/v2/v2-columns";
import { V2Shell } from "@/components/v2/v2-shell";
import { V2Empty } from "@/components/v2/v2-empty";
import { V2State } from "@/components/v2/v2-state";
import { Skeleton } from "@/components/v2/ui";
import { V2FeedTabs } from "@/components/v2/v2-feed-tabs";
import { V2MediaChips } from "@/components/v2/v2-media-chips";
import { V2MediaColumn } from "@/components/v2/v2-media-column";
import { V2ListFeed } from "@/components/v2/v2-list-feed";
import { loadV2FeedLists, loadV2MediaColumn } from "@/lib/server/v2-media-column";
import { loadV2ListFeed } from "@/lib/server/v2-list-feed";
import { buildFeedNavTree, type FeedNavActive } from "@/lib/v2-feed-nav";
import { getAppShellData, type AppShellTimelinePost } from "@/lib/server/app-shell-data";
import { listD1TimelinePosts } from "@/lib/server/d1-social-posts";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { V2LibraryColumn } from "@/components/v2/v2-library-column";
import { loadViewerLibrary } from "@/lib/server/library-column";
import { getHubLocale } from "@/lib/server/locale";
import { v2NavItems } from "@/lib/v2-nav";

import "./v2.css";
import "./redesign-sns.css";
import "./v2-luxe.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "タイムライン | Hub",
  description: "Hubの新しい画面。既存の画面はそのまま動いています。",
};

/*
 * タイムラインは「種類」のタブ（投稿/スレッド/コミュニティ）と「並び」の行の2段。
 * 種類ごとに別のストリームで、混ぜない。おすすめ/人気は投稿だけ。
 * おすすめ/人気は listD1TimelinePosts の feedScope へそのまま渡る。
 * フォロー中（と投稿以外の種類の既定）は V2SocialStream（複数Hub読み取りを含む）が受け持つ。
 */
const KINDS = [
  { kind: "post", ja: "投稿", en: "Posts" },
  { kind: "thread", ja: "スレッド", en: "Threads" },
  { kind: "community", ja: "コミュニティ", en: "Communities" },
] as const;
const ORDERS = [
  { feed: "recommended", ja: "おすすめ", en: "For you", postOnly: true },
  { feed: "following", ja: "フォロー中", en: "Following", postOnly: false },
  { feed: "popular", ja: "人気", en: "Popular", postOnly: true },
] as const;

type Kind = (typeof KINDS)[number]["kind"];
type PostFeedScope = "recommended" | "popular";

/* 投稿の既定はおすすめ（Hub Desktopと同じ）。旧 ?feed=latest もおすすめへ寄せる。 */
const homeHref = (kind: Kind, feed: string) => {
  const query = new URLSearchParams();
  if (kind !== "post") query.set("social", kind);
  if (feed !== "default" && !(kind === "post" && feed === "recommended")) query.set("feed", feed);
  const text = query.toString();
  return text ? `/v2?${text}` : "/v2";
};

const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;

export default async function V2FeedPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const locale = await getHubLocale();
  const params = await searchParams;
  const shareHref = contentShareReference(params.share)?.href;
  /* social=thread|community はそのタブ。all などの旧URLは投稿へ寄せる。 */
  const rawSocial = first(params.social);
  const kind: Kind = rawSocial === "thread" || rawSocial === "community" ? rawSocial : "post";
  const rawFeed = first(params.feed);
  /* ?feed=list&list=<id> は本人のリストの流れ。投稿の種類とは別に、列のリストの行で選ぶ。 */
  const listId = rawFeed === "list" ? first(params.list) ?? "" : null;
  const legacyScope: PostFeedScope | null = listId !== null || kind !== "post" || rawFeed === "following" ? null : rawFeed === "popular" ? "popular" : "recommended";
  const current = legacyScope ?? (rawFeed === "following" ? "following" : "default");
  const japanese = locale === "ja";
  /* タイムラインの新しい見た目（2026-10-30 所有者承認の案）。?skin=classic で以前の見た目と見比べられる。 */
  const skin = first(params.skin) === "classic" ? undefined : "luxe" as const;
  /* ?state=loading|empty|error は、読み込み中・空・失敗の見た目を確かめるための表示（データは変えない）。 */
  const previewState = first(params.state);

  const {
    currentProfile,
    socialPosts,
    unreadIndicatorCount,
    unreadMessageCount,
  } = await getAppShellData();

  /*
   * おすすめ/人気は選ばれた並びで取得し、追加取得と同じ基準にそろえる。
   * D1が無い環境ではシェルで取得できた候補を使う。
   */
  let posts: AppShellTimelinePost[] = socialPosts;
  let rankedFallback = false;
  {
    const database = getOptionalHubD1();
    if (database && legacyScope) {
      posts = await listD1TimelinePosts(
        database,
        currentProfile.id || null,
        undefined,
        40,
        0,
        undefined,
        null,
        legacyScope,
      ) as AppShellTimelinePost[];
      /* おすすめ/人気は直近7日の候補だけを見る。空なら新しい順で出し、ログイン前でも公開投稿が見える。 */
      if (!posts.length) {
        posts = await listD1TimelinePosts(database, currentProfile.id || null, undefined, 40, 0, undefined, null, "latest") as AppShellTimelinePost[];
        rankedFallback = posts.length > 0;
      }
    }
  }

  const [column, feedLists, listFeed, library] = await Promise.all([
    loadV2MediaColumn(currentProfile.id, "feed"),
    loadV2FeedLists(currentProfile.id),
    listId !== null ? loadV2ListFeed(getOptionalHubD1(), currentProfile.id, listId) : Promise.resolve(null),
    loadViewerLibrary(currentProfile.id, "feed", japanese),
  ]);
  const items = v2NavItems(japanese, { notifications: unreadIndicatorCount, messages: unreadMessageCount });

  /*
   * 右列は「本文を見ながら別のものを見る」ための場所（旦那様の定義）。
   * 中身は切り替えられ、見ていた場所を覚える。V2Aside が持つ。
   */
  const aside = (
    <V2Aside
      posts={socialPosts}
      japanese={japanese}
      signedIn={Boolean(currentProfile.id)}
      viewerId={currentProfile.id}
      title={japanese ? "並べて見る" : "Alongside"}
    />
  );

  /* 内側の列: 投稿・スレッド・コミュニティ／マイページ（フォロー中は本文上のタブ）。並びとタグは本文の上のチップ。 */
  const following = current === "following";
  const inList = listId !== null;
  const feedActive: FeedNavActive = inList ? "list" : following ? "following" : kind === "post" ? legacyScope : null;
  const tree = buildFeedNavTree({
    japanese,
    active: feedActive,
    activeListId: listId,
    registered: feedLists,
  });
  const directory = (
    <>
    <V2MediaColumn
      kind="feed"
      japanese={japanese}
      topRows={KINDS.map((tab) => ({
        key: tab.kind,
        label: tab.kind === "post" ? (japanese ? "ホーム" : "Home") : japanese ? tab.ja : tab.en,
        icon: tab.kind === "post" ? "home" as const : tab.kind === "thread" ? "threads" as const : "people" as const,
        href: homeHref(tab.kind, "default"),
        /* 並び（おすすめ・フォロー中・人気）は本文の上のタブ。ホームはその入口で、下に本人のリストが並ぶ。 */
        selected: tab.kind === kind && !inList && (kind === "post" || !following),
        children: tab.kind === "thread" ? [] : tree[tab.kind],
      }))}
      initial={column.initial}

    />
    <V2LibraryColumn data={library} signedIn={Boolean(currentProfile.id)} japanese={japanese} next="/v2" />
    </>
  );
  /* X と同じく、投稿のタイムラインの上に並びのタブ。リストを見ているあいだは出さない。 */
  const feedTabs = kind === "post" && !inList ? ORDERS.map((tab) => ({
    key: tab.feed,
    label: japanese ? tab.ja : tab.en,
    href: homeHref("post", tab.feed),
    selected: tab.feed === "following" ? following : !following && current === tab.feed,
  })) : [];
  /* 携帯幅では左の列の子の行（本人のリスト・登録したコミュニティ）が隠れるので、本文の上に横一列で出す（2026-10-28）。 */
  const subnav = (kind === "post" ? tree.post : kind === "community" ? tree.community : []).map((row) => ({ key: row.key, label: row.label, href: row.href, selected: Boolean(row.selected) }));
  const chips = [
    ...column.followedTags.map((tag) => ({ key: `t:${tag}`, label: `#${tag}`, href: `/v2/tag/${encodeURIComponent(tag)}`, selected: false })),
  ];

  return (
    <V2Shell
      skin={skin}
      currentPath="/v2"
      profile={currentProfile}
      items={items}
      directory={directory}
      aside={aside}
      japanese={japanese}
    >
      <V2ColumnHead heading title={listFeed?.status === "ok" ? listFeed.name : japanese ? "タイムライン" : "Timeline"} />
      <V2FeedTabs label={japanese ? "並び" : "Order"} tabs={feedTabs} />
      {subnav.length ? <div className="v2-feed-subnav"><V2MediaChips label={kind === "community" ? (japanese ? "登録したコミュニティ" : "Your communities") : japanese ? "リスト" : "Lists"} chips={subnav} japanese={japanese} /></div> : null}
      <V2MediaChips label={japanese ? "フォロー中のタグ" : "Followed tags"} chips={chips} japanese={japanese} />
      {kind === "thread" ? <p className="v2-home-more"><Link href="/v2/bbs">{japanese ? "スレッドを探す・作る" : "Find or start threads"}</Link></p> : null}
      {kind === "community" ? <p className="v2-home-more"><Link href="/v2/community">{japanese ? "コミュニティを探す・参加する" : "Find or join communities"}</Link></p> : null}
      {previewState === "loading" ? <Skeleton kind="post" count={4} label={japanese ? "読み込んでいます" : "Loading"} />
      : previewState === "empty" ? <V2Empty title={japanese ? "フォローしている人の投稿はまだありません" : "Nothing from people you follow yet"} note={japanese ? "気になる人をフォローすると、ここに並びます。" : "Follow people and their posts show up here."} action={{ label: japanese ? "人を探す" : "Find people", href: "/v2/search?q=%E4%BA%BA" }} />
      : previewState === "error" ? <V2State kind="error" japanese={japanese} title={japanese ? "タイムラインを読み込めませんでした" : "Could not load the timeline"} note={japanese ? "通信を確かめて、もう一度開いてください。" : "Check your connection and try again."} action={{ label: japanese ? "再読み込み" : "Reload", href: "/v2" }} />
      : listId !== null && listFeed ? (
        <V2ListFeed
          key={listId}
          listId={listId}
          items={listFeed.status === "ok" ? listFeed.items : []}
          nextCursor={listFeed.status === "ok" ? listFeed.nextCursor : null}
          viewerId={currentProfile.id}
          locale={locale}
          missing={listFeed.status !== "ok"}
        />
      ) : legacyScope ? <>
        {legacyScope === "recommended" ? <div className="v2-feed__updates"><ResearchDiscovery/></div> : null}
        <V2Feed
          key={legacyScope}
          posts={posts}
          scope={rankedFallback ? "latest" : legacyScope}
          fallbackNote={rankedFallback}
          viewerId={currentProfile.id}
          viewerName={currentProfile.displayName}
          viewerAvatarUrl={currentProfile.avatarUrl}
          locale={locale}
          shareHref={shareHref}
        /></> : <V2SocialStream filter={kind} scope={current === "following" ? "following" : "latest"} viewerId={currentProfile.id || null} viewerName={currentProfile.displayName} viewerAvatarUrl={currentProfile.avatarUrl} locale={locale} shareHref={shareHref} />}
    </V2Shell>
  );
}
