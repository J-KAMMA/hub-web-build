import { NextResponse } from "next/server";

import { findHubBook } from "@/lib/books/library";

/**
 * 書籍の詳細と目次。本文は章ごとの経路に分け、ここは
 * 書誌情報と章立てだけを返す。固定レイアウト本は巻の
 * 配信口(/api/books/[id]/volumes/[n]/file)への情報を返す。
 */
export function GET(
  _request: Request,
  { params }: { params: Promise<{ bookId: string }> },
) {
  return params.then(async ({ bookId }) => {
    const book = await findHubBook(bookId);
    if (!book) {
      return NextResponse.json({ error: "本が見つかりません。" }, { status: 404 });
    }
    return NextResponse.json({
      book: {
        id: book.id,
        title: book.title,
        author: book.author,
        description: book.description,
        coverImageUrl: book.coverImageUrl ?? null,
        language: book.language,
        licenseName: book.licenseName,
        licenseUrl: book.licenseUrl,
        sourceSiteName: book.sourceSiteName,
        sourceSiteUrl: book.sourceSiteUrl,
        reportingNotice: book.reportingNotice,
        distributionNotice: book.distributionNotice ?? null,
        readingMode: book.readingMode,
        chapters:
          book.readingMode === "article"
            ? book.chapters.map((chapter) => ({
              slug: chapter.slug,
              title: chapter.title,
              lead: chapter.lead,
            }))
            : [],
        volumes:
          book.readingMode === "fixed-layout"
            ? book.volumes.map((volume) => ({
              number: volume.number,
              title: volume.title,
              officialDownloadUrl: volume.officialDownloadUrl,
              fileUrl: `/api/books/${book.id}/volumes/${volume.number}/file`,
            }))
            : [],
      },
    });
  });
}
