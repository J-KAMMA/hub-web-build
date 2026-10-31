"use client";

import Link from "next/link";
import {useEffect,useState} from "react";
import {bookReadingPositionKey,parseBookReadingPosition} from "@/lib/books/reading-position";
import {useSavedBooks} from "@/lib/books/use-saved-books";
import {BookSaveButton} from "@/components/book-save-button";

import { rankDiscoveryItems } from "@/lib/discovery-recommendations";
import { V2DiscoveryOptions, V2DiscoveryFeedbackStatus } from "./v2-discovery-feedback";
import { useDiscoveryFeedback } from "@/lib/use-discovery-feedback";
import { useHubRecommendations } from "@/lib/use-hub-recommendations";
import { type HubBook, hubBookStartHref } from "@/lib/books/catalog";

export function V2BookDiscovery({ books, locale }: { books: readonly HubBook[]; locale: string }) {
  const ja = locale === "ja";
  const { interests, enabled, record } = useHubRecommendations();
  const feedback = useDiscoveryFeedback("books");
  const saved=useSavedBooks();
  const [reading,setReading]=useState<{bookId:string;title:string;chapter:string;chapterTitle:string}[]>([]);
  const [readingError,setReadingError]=useState(false);
  useEffect(()=>{
    const sync=()=>{
      try {
        const entries=books.flatMap(book=>{
          if(book.readingMode!=="article")return [];
          const position=parseBookReadingPosition(localStorage.getItem(bookReadingPositionKey(book.id)));
          const chapter=book.chapters.find(chapter=>chapter.slug===position?.chapter);
          return chapter?[{bookId:book.id,title:book.title,chapter:chapter.slug,chapterTitle:chapter.title}]:[];
        });
        setReading(entries);setReadingError(false);
      } catch {setReadingError(true);}
    };
    sync();window.addEventListener("storage",sync);window.addEventListener("pageshow",sync);
    return()=>{window.removeEventListener("storage",sync);window.removeEventListener("pageshow",sync);};
  },[books]);
  const savedBooks = books.filter(book=>saved.ids.includes(book.id));
  const text = (book: HubBook) => `${book.title} ${book.description} ${book.author} ${book.sourceSiteName} ${book.readingMode}`;
  const authorKey = (book: HubBook) => book.author.normalize("NFKC").trim().toLocaleLowerCase("ja-JP");
  const visible = enabled
    ? rankDiscoveryItems(books, interests, (book) => ({
      text: text(book),
      author: authorKey(book),
      topic: book.readingMode,
    })).sort((a, b) => Number(feedback.isAuthorReduced(authorKey(a))) - Number(feedback.isAuthorReduced(authorKey(b))))
    : [...books];

  return (
    <>
      <section className={savedBooks.length||saved.error?undefined:"v2-books-saved--empty"} aria-label={ja?"保存済みの本":"Saved books"}>
        <h2 className="v2-column__title">{ja?"保存済みの本":"Saved books"}</h2>
        <p className="v2-note">{ja?"このブラウザに保存した本です。":"Books saved in this browser."}</p>
        {saved.error?<p className="v2-error" role="status">{ja?"保存済みの本を読み込めませんでした。":"Could not load saved books."} <button type="button" className="button" onClick={saved.retry}>{ja?"再読み込み":"Retry loading"}</button></p>:null}
        {saved.ready&&!saved.error&&!savedBooks.length?<p className="v2-note">{ja?"保存した本はありません。":"No saved books yet."}</p>:null}
        <ul className="v2-tlist">{savedBooks.map(book=>{
          const position=reading.find(entry=>entry.bookId===book.id);
          return <li className="v2-tcard" key={book.id}>
            <Link className="v2-tcard__title" href={position?`/v2/books/${encodeURIComponent(book.id)}/${encodeURIComponent(position.chapter)}`:`/v2${hubBookStartHref(book)}`}>{book.title}</Link>
            <BookSaveButton bookId={book.id} japanese={ja}/>
          </li>;
        })}</ul>
      </section>
      {readingError?<p className="v2-note" role="status">{ja?"読書位置を読み込めませんでした。本は最初から開けます。":"Reading positions are unavailable. You can open books from the beginning."}</p>:null}
      {reading.length?<section aria-label={ja?"読書中":"Continue reading"}>
        <h2 className="v2-column__title">{ja?"読書中":"Continue reading"}</h2>
        <ul className="v2-tlist">{reading.map(entry=><li className="v2-tcard" key={entry.bookId}>
          <Link className="v2-tcard__title" href={`/v2/books/${encodeURIComponent(entry.bookId)}/${encodeURIComponent(entry.chapter)}`}>{entry.title} — {ja?"続きから読む":"Continue reading"}</Link>
          <p className="v2-tcard__excerpt">{entry.chapterTitle}</p>
        </li>)}</ul>
      </section>:null}
      {enabled ? <p className="v2-note"><span className="v2-badge">{ja ? "おすすめ" : "For you"}</span></p> : null}
      <V2DiscoveryFeedbackStatus feedback={feedback} japanese={ja} />
      {visible.every((book) => feedback.isHidden(book.id)) ? <p className="v2-note">{ja ? "表示できる本がありません。設定で非表示をリセットできます。" : "No books to show. Reset hidden recommendations in settings."}</p> : null}
      <ul className="v2-tlist v2-books-list">
        {visible.filter((book) => !feedback.isHidden(book.id)).map((book) => (
          <li key={book.id} className="v2-tcard v2-gcard">
            {book.coverImageUrl ? <img className="v2-gcard__image" src={book.coverImageUrl} alt="" loading="lazy" /> : <span className="v2-gcard__image v2-gcard__image--empty" aria-hidden="true"><span className="v2-gcard__spine">{book.title}</span></span>}
            <div className="v2-gcard__body">
              <Link className="v2-tcard__title" href={`/v2${hubBookStartHref(book)}`} onClick={() => record("books", [book.readingMode, book.author])}>{book.title}</Link>
              <p className="v2-tcard__excerpt">{book.description}</p>
              <p className="v2-tcard__foot">
                <span>{book.author} · {book.sourceSiteName}</span>
                <span>{book.readingMode === "article" ? (ja ? `全${book.chapters.length}章・横書き` : `${book.chapters.length} chapters`) : (ja ? `全${book.volumes.length}巻・固定レイアウト` : `${book.volumes.length} volumes, fixed layout`)}</span>
              </p>
              <V2DiscoveryOptions text={text(book)} interests={interests} japanese={ja} dismiss={() => feedback.dismiss(book.id)} fallbackReason={ja ? "公開された本のカタログと作者・読み方の情報から紹介しています。" : "Selected from the public book catalog using author and reading-format signals."} reduceAuthor={() => feedback.reduceAuthor(authorKey(book))} restoreAuthor={feedback.isAuthorReduced(authorKey(book)) ? () => feedback.restoreAuthor(authorKey(book)) : undefined} />
              <BookSaveButton bookId={book.id} japanese={ja}/>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
