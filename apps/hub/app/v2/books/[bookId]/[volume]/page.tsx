import { notFound } from "next/navigation";

import { ArticleBookReader } from "@/components/article-book-reader";
import { BookReader } from "@/components/book-reader";
import { V2PanelPage } from "@/components/v2/v2-panel-page";
import { findHubBook, findHubBookChapter, findHubBookVolume } from "@/lib/books/library";

import "../../../v2.css";

export const dynamic = "force-dynamic";

/*
 * 本の巻（2026-09-04、旦那様の「古いUIを出さない」）。
 * 読み手が実際に開く画面なのに v2 に無く、一覧から押すと古いUIへ出ていた。
 * 読み器は既存のまま。作り直さない。
 */
export default async function V2BookVolumePage({ params }: { params: Promise<{ bookId: string; volume: string }> }) {
  const { bookId, volume } = await params;
  const book = await findHubBook(bookId);
  if (!book) notFound();
  const articleEntry = await findHubBookChapter(bookId, volume);
  const fixedEntry = await findHubBookVolume(bookId, volume);
  if (!articleEntry && !fixedEntry) notFound();
  return (
    <V2PanelPage panelOwnsHeading wide currentPath="/v2/books" title={book.title}>
      {articleEntry
        ? <ArticleBookReader book={articleEntry.book} chapter={articleEntry.chapter} />
        : <BookReader book={fixedEntry!.book} volumeNumber={fixedEntry!.volume.number} />}
    </V2PanelPage>
  );
}
