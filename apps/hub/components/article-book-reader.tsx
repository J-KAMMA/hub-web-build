"use client";

import Link from "next/link";
import React from "react";
import { useEffect, useRef, useState } from "react";

import type { HubArticleBook, HubBookChapter } from "@/lib/books/catalog";
import { bookReadingPositionKey, parseBookReadingPosition } from "@/lib/books/reading-position";
import { hubSurfacePath, useHubUiSurface } from "@/lib/use-hub-ui-surface";
import {BookSaveButton} from "@/components/book-save-button";

export function ArticleBookReader({ book, chapter }: { book: HubArticleBook; chapter: HubBookChapter }) {
  /* 見ている面の中に留まる。 */
  const surface = useHubUiSurface();
  const articleRef = useRef<HTMLElement>(null);
  const [positionError,setPositionError] = useState(false);
  const chapterIndex = book.chapters.findIndex((candidate) => candidate.slug === chapter.slug);
  const previous = book.chapters[chapterIndex - 1];
  const next = book.chapters[chapterIndex + 1];

  useEffect(() => {
    const storageKey = bookReadingPositionKey(book.id);
    const main = articleRef.current?.closest<HTMLElement>(".v2__main");
    const scrollContainer = main && /auto|scroll/.test(getComputedStyle(main).overflowY) ? main : null;
    const target = scrollContainer ?? window;
    let restoring = true;
    const save = () => {
      if(restoring)return;
      try { window.localStorage.setItem(storageKey, JSON.stringify({
      chapter: chapter.slug,
      scrollY: Math.max(0, Math.round(scrollContainer ? scrollContainer.scrollTop : window.scrollY)),
      updatedAt: new Date().toISOString(),
    })); } catch { setPositionError(true); }
    };
    let position = null;
    try { position = parseBookReadingPosition(window.localStorage.getItem(storageKey)); }
    catch { setPositionError(true); }
    const savedPosition=position;
    const frame=window.requestAnimationFrame(() => {
      if(savedPosition?.chapter===chapter.slug) {
        if(scrollContainer)scrollContainer.scrollTo({top:savedPosition.scrollY,behavior:"instant"});
        else window.scrollTo({top:savedPosition.scrollY,behavior:"instant"});
      } else {
        // A chapter opened without scrolling must still become the resume target.
        if(scrollContainer)scrollContainer.scrollTo({top:0,behavior:"instant"});
        else window.scrollTo({top:0,behavior:"instant"});
      }
      restoring=false;
      if(savedPosition?.chapter!==chapter.slug)save();
    });
    target.addEventListener("scroll", save, { passive: true });
    // Navigation may already have reset the column by cleanup time. Scroll
    // events persist the reading position while the reader is still mounted.
    return () => { window.cancelAnimationFrame(frame); target.removeEventListener("scroll",save); };
  }, [book.id, chapter.slug]);

  return (
    <article ref={articleRef} className="book-article" lang={book.language}>
      <header className="book-article__header">
        <nav className="book-article__topnav" aria-label="書籍ナビゲーション"><Link href={hubSurfacePath(surface, "/books")}>← 本棚</Link><span>横書き</span></nav>
        <p className="book-article__meta">{book.title}・{book.author}・第{chapterIndex + 1}章 / 全{book.chapters.length}章</p>
        <h1>{chapter.title}</h1>
        <BookSaveButton bookId={book.id}/>
        <small>保存済みの本は、このブラウザの本棚から開けます。</small>
        <p className="book-article__lead">{chapter.lead}</p>
      </header>

      <nav className="book-article__toc" aria-label="目次">
        <strong>目次</strong>
        <ol>{book.chapters.map((candidate, index) => <li key={candidate.slug}><Link aria-current={candidate.slug === chapter.slug ? "page" : undefined} href={hubSurfacePath(surface, `/books/${book.id}/${candidate.slug}`)}>{index + 1}. {candidate.title}</Link></li>)}</ol>
      </nav>

      <div className="book-article__body">
        {chapter.sections.map((section) => <section id={section.id} key={section.id}>
          <h2>{section.heading}</h2>
          {section.quote ? <blockquote>{section.quote}</blockquote> : null}
          {section.paragraphs.map((paragraph, index) => <p key={`${section.id}-${index}`}>{paragraph}</p>)}
        </section>)}
      </div>

      <nav className="book-article__pagination" aria-label="章を移動">
        {previous ? <Link href={hubSurfacePath(surface, `/books/${book.id}/${previous.slug}`)}>← {previous.title}</Link> : <span />}
        {next ? <Link href={hubSurfacePath(surface, `/books/${book.id}/${next.slug}`)}>{next.title} →</Link> : <span />}
      </nav>
      <aside className="book-article__source" aria-label="底本と入力情報">
        <h2>底本と入力情報</h2>
        <dl>
          <div><dt>底本</dt><dd>{book.provenance.baseEdition}（{book.provenance.publisher}）</dd></div>
          <div><dt>入力</dt><dd>{book.provenance.inputBy}</dd></div>
          <div><dt>校正</dt><dd>{book.provenance.proofreadBy}</dd></div>
          <div><dt>出典</dt><dd><a href={book.provenance.workCardUrl} rel="noreferrer">{book.sourceSiteName} 作品カード</a></dd></div>
        </dl>
      </aside>
      <footer className="book-article__end"><span>END</span><small>読書位置はこの端末だけに保存されます。</small>{positionError?<p role="status">読書位置を保存・復元できませんでした。本文はそのまま読めます。</p>:null}</footer>
    </article>
  );
}
