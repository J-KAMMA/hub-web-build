/*
 * Types and pure helpers only. The novels themselves (about 1.3 MB of JSON) are
 * static assets read on demand by lib/books/library.ts; a client component
 * imports hubBookStartHref from here, so nothing server-only may be added.
 */

export type HubBookVolume = { number: number; title: string; objectKey: string; officialDownloadUrl: string; thirdPartyRightsReviewRequired: boolean; rightsNotice?: string; thirdPartyRightsReferences?: readonly string[] };
type HubBookBase = { id: string; title: string; author: string; description: string; coverImageUrl?: string; language: "ja"; licenseName: string; licenseUrl: string; sourceSiteName: string; sourceSiteUrl: string; reportingNotice: string; distributionNotice?: string };
export type HubBookSection = { id: string; heading: string; paragraphs: readonly string[]; quote?: string };
export type HubBookChapter = { slug: string; title: string; lead: string; sections: readonly HubBookSection[] };
export type HubBookProvenance = { workCardUrl: string; sourceFileUrl: string; baseEdition: string; publisher: string; sourceEditionDate: string; proofEditionDate: string; inputBy: string; proofreadBy: string; importedAt: string };
export type HubArticleBook = HubBookBase & { readingMode: "article"; provenance: HubBookProvenance; chapters: readonly HubBookChapter[] };
export type HubFixedLayoutBook = HubBookBase & { readingMode: "fixed-layout"; volumes: readonly HubBookVolume[] };
export type HubBook = HubArticleBook | HubFixedLayoutBook;
export const DEFAULT_BOOK_READING_MODE: HubBook["readingMode"] = "article";
/** The published books, in display order. Each id names a worker-data file "book-<id>". */
export const HUB_BOOK_IDS = ["kokoro", "ginga-tetsudo-no-yoru", "hashire-melos", "rashomon"] as const;
export function hubBookStartHref(book: HubBook) {
  const entry = book.readingMode === "article" ? book.chapters[0]?.slug : book.volumes[0]?.number;
  return entry === undefined ? "/books" : `/books/${book.id}/${entry}`;
}
