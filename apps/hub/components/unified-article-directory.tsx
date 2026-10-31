"use client";

import Link from "next/link";
import { Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { ArticleContentCard } from "@/components/article-content-card";
import { TabMainSearchHeader } from "@/components/tab-main-search-header";

import { hubSurfacePath, useHubUiSurface } from "@/lib/use-hub-ui-surface";
import {
  projectMemberArticle,
  type HubArticleContent,
  type MemberArticleListItem,
} from "@/lib/article-content";

type ArticleFilter = "all" | "public";

export function UnifiedArticleDirectory({
  publicArticles,
  marketMode = false,
}: {
  publicArticles: HubArticleContent[];
  marketMode?: boolean;
}) {
  /* 見ている面の中に留まる。v2 に無い画面は既存の道のまま返る。 */
  const surface = useHubUiSurface();
  const [memberArticles, setMemberArticles] = useState<HubArticleContent[]>([]);
  const [filter, setFilter] = useState<ArticleFilter>("all");
  const [query, setQuery] = useState("");
  const [directoryOpen, setDirectoryOpen] = useState(false);

  // Hubの書き手が公開した記事。取得できなくても無料記事の一覧は出す。
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/articles", { cache: "no-store", signal: controller.signal, headers: { accept: "application/json" } })
      .then(async (response) => {
        if (!response.ok) throw new Error("member_articles_unavailable");
        const body = await response.json() as { articles?: MemberArticleListItem[] };
        setMemberArticles(Array.isArray(body.articles) ? body.articles.map(projectMemberArticle) : []);
      })
      .catch((error: unknown) => {
        // 中断は失敗ではない。ここで空にすると、後から届いた成功分まで消える。
        if (error instanceof DOMException && error.name === "AbortError") return;
        setMemberArticles([]);
      });
    return () => controller.abort();
  }, []);

  const availableArticles = useMemo(() => {
    const all = [...memberArticles, ...publicArticles];
    return marketMode ? all.filter((article) => article.commerce) : all;
  }, [marketMode, memberArticles, publicArticles]);

  const articles = useMemo(() => {
    const normalized = query.normalize("NFKC").trim().toLocaleLowerCase();
    return availableArticles.filter((article) => {
      if (filter === "public" && article.access !== "public") return false;
      if (!normalized) return true;
      return `${article.title} ${article.summary} ${article.author} ${article.tags?.join(" ") ?? ""}`
        .normalize("NFKC")
        .toLocaleLowerCase()
        .includes(normalized);
    });
  }, [availableArticles, filter, query]);

  const counts = useMemo(() => ({
    all: availableArticles.length,
    public: availableArticles.filter((article) => article.access === "public").length,
  }), [availableArticles]);

  const chooseFilter = (value: ArticleFilter) => {
    setFilter(value);
    setDirectoryOpen(false);
  };

  const clearSearch = () => setQuery("");

  return <div className="hub-articles-layout bbs-directory-layout tab-left-column-layout">
    <button type="button" className="bbs-directory-mobile-toggle" aria-controls="article-directory" aria-expanded={directoryOpen} onClick={() => setDirectoryOpen((current) => !current)}>{marketMode ? "マーケット" : "記事"}</button>
    {directoryOpen ? <button type="button" className="bbs-directory-backdrop" aria-label="記事メニューを閉じる" onClick={() => setDirectoryOpen(false)} /> : null}
    <aside id="article-directory" data-hub-page-left-column className={`hub-articles__left bbs-thread-directory tab-left-column${directoryOpen ? " bbs-thread-directory--open" : ""}`} aria-label={marketMode ? "マーケットの記事メニュー" : "記事メニュー"}>
      <header className="bbs-thread-directory__header tab-left-column__header">
        <strong>{marketMode ? "マーケット" : "記事"}</strong>
        <button type="button" aria-label="記事メニューを閉じる" onClick={() => setDirectoryOpen(false)}>×</button>
      </header>
      <nav className="bbs-thread-directory__nav hub-articles__left-nav" aria-label={marketMode ? "マーケット" : "記事の公開方法"}>
        {!marketMode ? <>
          {([["all", "すべて"], ["public", "無料"]] as const).map(([value, label]) => (
            <button type="button" key={value} className={filter === value ? "bbs-thread-directory__current" : undefined} aria-current={filter === value ? "page" : undefined} onClick={() => chooseFilter(value)}><span>{label}</span><small>{counts[value]}</small></button>
          ))}
          <span className="hub-articles__left-label">書く</span>
          <Link href={hubSurfacePath(surface, "/articles/new")}><span>記事を書く</span></Link>
          <span className="hub-articles__left-label">記事を探す</span>
          <Link href={hubSurfacePath(surface, "/market/digital?view=articles")}><span>販売中</span></Link>
        </> : <>
          <Link className="bbs-thread-directory__current" aria-current="page" href={hubSurfacePath(surface, "/market/digital?view=articles")}><span>販売中の記事</span><small>{counts.all}</small></Link>
          <Link href={hubSurfacePath(surface, "/articles")}><span>記事一覧</span></Link>
          <span className="hub-articles__left-label">出品</span>
          <Link href={hubSurfacePath(surface, "/market/digital/sell")}><span>記事を出品</span></Link>
          <Link href={hubSurfacePath(surface, "/market")}><span>マーケット</span></Link>
        </>}
      </nav>
    </aside>
    <TabMainSearchHeader ariaLabel="記事を検索">
      <label>
        <Search aria-hidden="true" />
        <span className="sr-only">記事を検索</span>
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="記事名・著者・タグを検索" autoComplete="off" />
        {query ? <button type="button" className="hub-articles__search-clear" aria-label="検索をクリア" onClick={clearSearch}>×</button> : null}
      </label>
    </TabMainSearchHeader>
    {/* main の landmark は ShellFrame が1つだけ持つ。ここで入れ子にしない。 */}
    <div className="hub-articles bbs-directory-content tab-left-column-main">
      <h1 id="article-directory-title" className="sr-only">{marketMode ? "販売中の記事" : "記事"}</h1>
      <div className="hub-articles__grid">
        {articles.map((article) => <ArticleContentCard key={article.contentId} article={article} />)}
      </div>
      {!articles.length ? <section className="hub-articles__empty">
        <h2>{query ? "記事が見つかりません" : marketMode ? "販売中の記事はまだありません" : "記事がありません"}</h2>
        <p>{query ? "別の言葉で検索するか、絞り込みを解除してください。" : marketMode ? "販売情報を設定した記事を公開すると、ここに表示されます。" : "公開されるとここに表示されます。"}</p>
        {query ? <button type="button" onClick={clearSearch}>検索をクリア</button> : marketMode ? <Link href={hubSurfacePath(surface, "/market/digital/sell")}>記事を出品</Link> : <Link href={hubSurfacePath(surface, "/articles/new")}>記事を書く</Link>}
      </section> : null}
    </div>
  </div>;
}
