import { HUB_BOOK_IDS, type HubBook } from "./catalog";
import { loadWorkerData, type WorkerDataEnv, type WorkerDataName } from "../server/worker-data";

/*
 * The published books, read from static assets on first use (see
 * lib/server/worker-data.ts) instead of being compiled into the Worker. Server
 * code only: lib/books/catalog.ts keeps the types and pure helpers that client
 * components import.
 *
 * Ids are matched against the fixed list before anything is fetched, so a
 * request path can never choose which file is read.
 */

function loadBook(id: (typeof HUB_BOOK_IDS)[number], env?: WorkerDataEnv | null): Promise<HubBook> {
  return loadWorkerData(`book-${id}` as WorkerDataName, (value) => {
    const book = value as Partial<HubBook> | null;
    if (!book || book.id !== id || (book.readingMode !== "article" && book.readingMode !== "fixed-layout")) {
      throw new Error(`The book data for "${id}" has an unexpected shape.`);
    }
    return book as HubBook;
  }, env);
}

export async function getHubBooks(env?: WorkerDataEnv | null): Promise<readonly HubBook[]> {
  return Promise.all(HUB_BOOK_IDS.map((id) => loadBook(id, env)));
}

export async function findHubBook(bookId: string, env?: WorkerDataEnv | null): Promise<HubBook | null> {
  const id = HUB_BOOK_IDS.find((candidate) => candidate === bookId);
  return id ? loadBook(id, env) : null;
}

export async function findHubBookVolume(bookId: string, rawVolume: string | number) {
  const book = await findHubBook(bookId); const volumeNumber = typeof rawVolume === "number" ? rawVolume : Number(rawVolume);
  if (!book || book.readingMode !== "fixed-layout" || !Number.isInteger(volumeNumber)) return null;
  const volume = book.volumes.find((candidate) => candidate.number === volumeNumber); return volume ? { book, volume } : null;
}

export async function findHubBookChapter(bookId: string, chapterSlug: string) {
  const book = await findHubBook(bookId); if (!book || book.readingMode !== "article") return null;
  const chapter = book.chapters.find((candidate) => candidate.slug === chapterSlug); return chapter ? { book, chapter } : null;
}
