export type BookReadingPosition = {
  chapter: string;
  scrollY: number;
  updatedAt: string;
};

export function bookReadingPositionKey(bookId: string) {
  return `hub.books.${bookId}.reading-position`;
}

export function parseBookReadingPosition(value: string | null): BookReadingPosition | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<BookReadingPosition>;
    if (typeof parsed.chapter !== "string" || !parsed.chapter || typeof parsed.scrollY !== "number" || !Number.isFinite(parsed.scrollY) || parsed.scrollY < 0 || typeof parsed.updatedAt !== "string") return null;
    return { chapter: parsed.chapter, scrollY: Math.round(parsed.scrollY), updatedAt: parsed.updatedAt };
  } catch {
    return null;
  }
}
