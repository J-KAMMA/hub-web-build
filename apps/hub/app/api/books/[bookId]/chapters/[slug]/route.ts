import { NextResponse } from "next/server";

import { findHubBookChapter } from "@/lib/books/library";

/** 1章分の本文。article型の本だけが章を持つ。 */
export function GET(
  _request: Request,
  { params }: { params: Promise<{ bookId: string; slug: string }> },
) {
  return params.then(async ({ bookId, slug }) => {
    const entry = await findHubBookChapter(bookId, slug);
    if (!entry) {
      return NextResponse.json({ error: "章が見つかりません。" }, { status: 404 });
    }
    const { book, chapter } = entry;
    const index = book.readingMode === "article"
      ? book.chapters.findIndex((candidate) => candidate.slug === slug)
      : -1;
    const siblings = book.readingMode === "article" ? book.chapters : [];
    return NextResponse.json({
      book: { id: book.id, title: book.title, author: book.author },
      chapter: {
        slug: chapter.slug,
        title: chapter.title,
        lead: chapter.lead,
        sections: chapter.sections,
      },
      prev: index > 0 ? { slug: siblings[index - 1].slug, title: siblings[index - 1].title } : null,
      next:
        index >= 0 && index < siblings.length - 1
          ? { slug: siblings[index + 1].slug, title: siblings[index + 1].title }
          : null,
    });
  });
}
