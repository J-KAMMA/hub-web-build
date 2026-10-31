import type { Metadata } from "next";
import Link from "next/link";

import { V2Aside } from "@/components/v2/v2-aside";
import { V2Empty } from "@/components/v2/v2-empty";
import { V2ThreadDiscovery } from "@/components/v2/v2-thread-discovery";
import { V2ColumnHead } from "@/components/v2/v2-columns";
import { V2Shell } from "@/components/v2/v2-shell";
import { V2ThreadNew } from "@/components/v2/v2-thread-new";
import { getAppShellData } from "@/lib/server/app-shell-data";
import { getBbsDirectoryGroups, getBbsDirectoryTags } from "@/lib/server/bbs-page-data";
import { listD1ThreadPosts, listD1ThreadsPage, type D1ThreadListView } from "@/lib/server/d1-threads";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { V2LibraryColumn } from "@/components/v2/v2-library-column";
import { loadViewerLibrary } from "@/lib/server/library-column";
import { getHubLocale } from "@/lib/server/locale";
import { v2NavItems } from "@/lib/v2-nav";

import "../v2.css";
import "../redesign-sns.css";
import { redactGated } from "@/lib/server/gated-content";
import "../v2-luxe.css";
import "../v2-luxe-social.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "スレッド | Hub v2",
};

const PAGE_SIZE = 20;

const VIEWS: { id: D1ThreadListView; ja: string; en: string }[] = [
  { id: "popular", ja: "人気", en: "Popular" },
  { id: "latest", ja: "新着", en: "Latest" },
  { id: "rising", ja: "急上昇", en: "Rising" },
  { id: "unanswered", ja: "未回答", en: "Unanswered" },
  { id: "solved", ja: "解決済み", en: "Solved" },
  { id: "quality", ja: "評価順", en: "Quality" },
];

type V2BbsView = D1ThreadListView | "recommended";

const DISCOVERY_VIEWS: { id: V2BbsView; ja: string; en: string }[] = [
  { id: "recommended", ja: "おすすめ", en: "Recommended" },
  ...VIEWS,
];

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/*
 * v2 のスレッド一覧。既存の /bbs には触れない。
 * 一覧は既存の listD1ThreadsPage をそのまま使う（表示6種・タグ・全文検索・
 * 板・件数・ページ送り）。既存の公開APIは tag を受けないが、この関数は受ける。
 *
 * 抜粋は、この頁に出る分だけ先頭の投稿を1件ずつ取る（最大20問い合わせ）。
 * 既存は全スレッドの全投稿を取って抜粋を作っていた。頁の分だけにする。
 *
 * まだ無いもの: 新規スレッドの作成、300msの間を置く逐次検索、
 * 「さらに読み込む」（v2は頁送り）。
 */
export default async function V2BbsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const locale = await getHubLocale();
  const japanese = locale === "ja";
  const requestedView = one(params.view);
  const view: V2BbsView = DISCOVERY_VIEWS.some((item) => item.id === requestedView) ? requestedView as V2BbsView : "recommended";
  const tag = one(params.tag).trim().slice(0, 40);
  const query = one(params.q).trim().slice(0, 100);
  const board = one(params.board).trim().slice(0, 60);
  const requestedPage = Math.max(1, /^\d+$/.test(one(params.page)) ? Number(one(params.page)) : 1);

  const database = getOptionalHubD1();
  const [{ currentProfile, socialPosts, unreadIndicatorCount, unreadMessageCount }, groups, tags, page] = await Promise.all([
    getAppShellData(),
    getBbsDirectoryGroups(),
    getBbsDirectoryTags(),
    database
      ? listD1ThreadsPage(database, {
        view: view === "recommended" ? "popular" : view,
        tags: tag ? [tag] : [],
        query,
        boardKeys: board ? [board] : [],
        limit: PAGE_SIZE,
        offset: (requestedPage - 1) * PAGE_SIZE,
      })
      : Promise.resolve({ threads: [], total: 0, limit: PAGE_SIZE, offset: 0 }),
  ]);

  const excerpts = database
    ? await Promise.all(page.threads.map(async (thread) => {
      const [first] = await redactGated(database, currentProfile.id || null, await listD1ThreadPosts(database, thread.id, 1, 0), "thread", { keyOf: (post: { threadId: string }) => post.threadId });
      return [thread.id, first?.body ?? ""] as const;
    }))
    : [];
  const excerptById = new Map(excerpts);
  const pageCount = Math.max(1, Math.ceil(page.total / PAGE_SIZE));

  const href = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    const merged = { view, tag, q: query, board, ...patch };
    if (merged.view && merged.view !== "recommended") next.set("view", merged.view);
    if (merged.tag) next.set("tag", merged.tag);
    if (merged.q) next.set("q", merged.q);
    if (merged.board) next.set("board", merged.board);
    if (patch.page && patch.page !== "1") next.set("page", patch.page);
    const search = next.toString();
    return `/v2/bbs${search ? `?${search}` : ""}`;
  };

  const items = v2NavItems(japanese, { notifications: unreadIndicatorCount, messages: unreadMessageCount });

  /* タブ行: 表示の切り替えだけ（最大7）。タグと板は本文の「絞り込み」の中。 */
  const library = await loadViewerLibrary(currentProfile.id, "feed", japanese);
  const directory = (
    <>
    <ul className="v2-nav__list">
      {DISCOVERY_VIEWS.map((item) => (
        <li key={item.id}>
          <Link className="v2-nav__item" href={href({ view: item.id, page: "1" })} aria-current={item.id === view ? "page" : undefined}>
            <span className="v2-nav__label">{japanese ? item.ja : item.en}</span>
          </Link>
        </li>
      ))}
    </ul>
    <V2LibraryColumn data={library} signedIn={Boolean(currentProfile.id)} japanese={japanese} next="/v2/bbs" />
    </>
  );

  const filters = (
    <details className="v2-filter-disclosure">
      <summary>{japanese ? "絞り込み" : "Filter"}</summary>
      <div className="v2-filter-disclosure__body">
        <p className="v2-column__title">{japanese ? "タグ" : "Tags"}</p>
        <ul className="v2-nav__list">
          {tags.slice(0, 24).map((item) => (
            <li key={item.name}>
              <Link className="v2-nav__item" href={href({ tag: item.name, page: "1" })} aria-current={item.name === tag ? "page" : undefined}>
                <span className="v2-nav__label">#{item.name}</span>
                <span className="v2-nav__count v2-nav__count--quiet">{item.count}</span>
              </Link>
            </li>
          ))}
        </ul>
        <p className="v2-column__title">{japanese ? "板" : "Boards"}</p>
        <ul className="v2-nav__list">
          {groups.flatMap((group) => group.boards.slice(0, 6).map((item) => (
            <li key={item.key}>
              <Link className="v2-nav__item" href={href({ board: item.key, page: "1" })} aria-current={item.key === board ? "page" : undefined}>
                <span className="v2-nav__label">{item.title}</span>
                <span className="v2-nav__count v2-nav__count--quiet">{item.threadCount}</span>
              </Link>
            </li>
          )))}
        </ul>
      </div>
    </details>
  );

  return (
    <V2Shell skin="luxe"
      currentPath="/v2/bbs"
      profile={currentProfile}
      items={items}
      directoryTitle={japanese ? "スレッド" : "Threads"}
      directory={directory}
      aside={
        <V2Aside
          posts={socialPosts}
          japanese={japanese}
          signedIn={Boolean(currentProfile.id)} viewerId={currentProfile.id}
          title={japanese ? "並べて見る" : "Alongside"}
        />
      }
      japanese={japanese}
    >
      <V2ColumnHead
        heading
        title={japanese ? "スレッド" : "Threads"}
        action={<span className="v2-heading__note">{japanese ? DISCOVERY_VIEWS.find((item) => item.id === view)?.ja : DISCOVERY_VIEWS.find((item) => item.id === view)?.en}{japanese ? ` · ${page.total}件` : ` · ${page.total} threads`}</span>}
      />

      <form className="v2-search__form" role="search" action="/v2/bbs" method="get">
        {view !== "recommended" ? <input type="hidden" name="view" value={view} /> : null}
        {tag ? <input type="hidden" name="tag" value={tag} /> : null}
        {board ? <input type="hidden" name="board" value={board} /> : null}
        <input
          type="search"
          name="q"
          defaultValue={query}
          maxLength={100}
          placeholder={japanese ? "題・タグ・本文を検索" : "Search titles, tags and posts"}
          aria-label={japanese ? "スレッドを検索" : "Search threads"}
        />
        <button type="submit" className="v2-search__submit">{japanese ? "検索" : "Search"}</button>
      </form>

      <div className="v2-bbs-tools">
      <V2ThreadNew
        boards={groups.flatMap((group) => group.boards.map((item) => ({ key: item.key, title: item.title })))}
        initialBoard={board || undefined}
        presetGateId={/^[A-Za-z0-9_-]{1,80}$/.test(one(params.gate)) ? one(params.gate) : undefined}
        signedIn={Boolean(currentProfile.id)}
        japanese={japanese}
      />

      {filters}
      </div>

      {tag || query || board ? (
        <p className="v2-note">
          {tag ? <span className="v2-badge">#{tag}</span> : null}
          {query ? <span className="v2-badge">{query}</span> : null}
          {board ? <span className="v2-badge">{groups.flatMap((g) => g.boards).find((b) => b.key === board)?.title ?? board}</span> : null}
          {" "}
          <Link className="v2-card__link" href="/v2/bbs">{japanese ? "絞り込みを解除" : "Clear"}</Link>
        </p>
      ) : null}

      {page.threads.length || view === "recommended" ? (
        <V2ThreadDiscovery
          key={JSON.stringify({view,tag,query,board,requestedPage})}
          threads={page.threads}
          excerpts={Object.fromEntries(excerptById)}
          locale={locale}
          recommended={view === "recommended"}
          candidateQuery={view === "recommended" ? new URLSearchParams({tag,q:query,board}).toString() : undefined}
        />
      ) : (
        <V2Empty title={japanese ? "一致するスレッドがありません" : "No threads matched"} action={{ label: japanese ? "絞り込みを解除" : "Clear filters", href: "/v2/bbs" }} />
      )}

      {view !== "recommended" && pageCount > 1 ? (
        <nav className="v2-pager" aria-label={japanese ? "ページ" : "Pages"}>
          {requestedPage > 1 ? <Link className="v2-toggle v2-toggle--text" href={href({ page: String(requestedPage - 1) })}>{japanese ? "← 前へ" : "← Previous"}</Link> : null}
          <span className="v2-pager__label">{requestedPage} / {pageCount}</span>
          {requestedPage < pageCount ? <Link className="v2-toggle v2-toggle--text" href={href({ page: String(requestedPage + 1) })}>{japanese ? "次へ →" : "Next →"}</Link> : null}
        </nav>
      ) : null}
    </V2Shell>
  );
}
