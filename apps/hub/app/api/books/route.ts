import { NextResponse } from "next/server";

import { getHubBooks } from "@/lib/books/library";

/**
 * 書籍カタログ。HUB_BOOKS は静的コンテンツなので公開GET。
 * 本文は配信ポリシーが別途守っているので、ここは目次情報だけ返す。
 */
export async function GET() {
  return NextResponse.json({
    books: (await getHubBooks()).map((book) => ({
      id: book.id,
      title: book.title,
      author: book.author,
      description: book.description,
      coverImageUrl: book.coverImageUrl ?? null,
      licenseName: book.licenseName,
      sourceSiteName: book.sourceSiteName,
      readingMode: book.readingMode,
      href: `/books/${book.id}`,
    })),
  });
}
