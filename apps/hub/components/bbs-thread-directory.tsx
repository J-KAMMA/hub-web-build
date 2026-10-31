"use client";

import { type ReactNode, useMemo, useState } from "react";
import { Search } from "lucide-react";

import { TabMainSearchHeader } from "@/components/tab-main-search-header";
import type { ThreadTagSummary } from "@/lib/thread-tags";

interface Props {
  tags?: ThreadTagSummary[];
  totalCount?: number;
  currentTag?: string;
  onTagSelect?: (tag: string) => void;
  onAllSelect?: () => void;
  mainSearch?: ReactNode;
  children: ReactNode;
}

export function BbsThreadDirectory({ tags = [], totalCount = 0, currentTag = "", onTagSelect, onAllSelect, mainSearch, children }: Props) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [query, setQuery] = useState("");
  const normalizedQuery = query.normalize("NFKC").trim().toLocaleLowerCase();
  const visibleTags = useMemo(() => normalizedQuery
    ? tags.filter((tag) => tag.name.normalize("NFKC").toLocaleLowerCase().includes(normalizedQuery))
    : tags, [normalizedQuery, tags]);
  const closeMobile = () => setMobileOpen(false);

  return <div className="bbs-directory-layout tab-left-column-layout">
    <button type="button" className="bbs-directory-mobile-toggle" onClick={() => setMobileOpen((current) => !current)} aria-controls="bbs-thread-directory" aria-expanded={mobileOpen}>スレッド</button>
    {mobileOpen ? <button type="button" className="bbs-directory-backdrop" onClick={closeMobile} aria-label="タグ一覧を閉じる" /> : null}
    <aside id="bbs-thread-directory" data-hub-page-left-column className={`bbs-thread-directory tab-left-column${mobileOpen ? " bbs-thread-directory--open" : ""}`} aria-label="スレッドのタグ">
      <header className="bbs-thread-directory__header tab-left-column__header">
        <div><strong>スレッド</strong></div>
        <button type="button" onClick={closeMobile} aria-label="タグ一覧を閉じる">×</button>
      </header>
      <label className="bbs-thread-directory__search">
        <span>タグで絞り込む</span>
        <div>
          <Search aria-hidden="true" />
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="例：政治、ゲーム、旅行" aria-label="表示するタグを検索" />
          {query ? <button type="button" onClick={() => setQuery("")} aria-label="タグ検索をクリア">×</button> : null}
        </div>
      </label>
      <nav className="bbs-thread-directory__nav" aria-label="タグ一覧">
        {onAllSelect
          ? <button type="button" className={!currentTag ? "bbs-thread-directory__all bbs-thread-directory__current" : "bbs-thread-directory__all"} onClick={() => { onAllSelect(); closeMobile(); }}><span>すべて</span><small>{totalCount}</small></button>
          : <a href="/bbs" className={!currentTag ? "bbs-thread-directory__all bbs-thread-directory__current" : "bbs-thread-directory__all"} onClick={closeMobile}><span>すべて</span><small>{totalCount}</small></a>}
        <div className="bbs-thread-directory__groups bbs-thread-directory__tags">
          {visibleTags.map((tag) => {
            const current = tag.name.normalize("NFKC").toLocaleLowerCase() === currentTag.normalize("NFKC").toLocaleLowerCase();
            return <div className={current ? "bbs-thread-directory__board bbs-thread-directory__board--current" : "bbs-thread-directory__board"} key={tag.name}>
              {onTagSelect
                ? <button type="button" aria-current={current ? "page" : undefined} onClick={() => { onTagSelect(tag.name); closeMobile(); }}><span>#{tag.name}</span><small>{tag.count}</small></button>
                : <a href={`/bbs?tag=${encodeURIComponent(tag.name)}`} aria-current={current ? "page" : undefined} onClick={closeMobile}><span>#{tag.name}</span><small>{tag.count}</small></a>}
            </div>;
          })}
        </div>
        {!visibleTags.length ? <p className="bbs-thread-directory__empty">タグが見つかりません。別の言葉で検索してください。</p> : null}
      </nav>
    </aside>
    {mainSearch ?? <TabMainSearchHeader action="/bbs" ariaLabel="スレッドを検索" placeholder="タイトル・タグ・投稿内容を検索" />}
    <div className="bbs-directory-content">{children}</div>
  </div>;
}
