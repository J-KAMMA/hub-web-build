/*
 * Search results that sit beside the core entities (2026-10-28).
 * The core search only knows posts, people, threads, Hubpedia, videos and so on. Articles, music
 * and tags come from here, together with items that match the query only through a tag.
 * Every card is a plain JSON object; no gated body, excerpt or media ever goes into it.
 */
import type { V2PostData } from "@/components/v2/v2-post";

export type SearchArticleCard = {
  id: string;
  href: string;
  title: string;
  summary: string;
  author: string;
  authorHandle: string | null;
  thumbnailUrl: string | null;
  tags: string[];
  publishedAt: string;
};

export type SearchMusicCard = {
  id: string;
  href: string;
  title: string;
  artist: string;
  genre: string;
  artworkUrl: string | null;
  year: number | null;
};

export type SearchTagCard = {
  name: string;
  key: string;
  useCount: number;
};

export type SearchThreadCard = {
  id: string;
  href: string;
  title: string;
  boardKey: string;
  postCount: number;
};

/*
 * Hub-held kinds that have no card of their own yet (2026-10-30): market products (Commerce's public
 * listing), games, research projects and posts that another Hub announced into a joined community.
 * `score` is the shared 0..1 score (lib/search-score.ts) so "all" can interleave them with the rest.
 */
export type SearchKindName = "products" | "games" | "research" | "federated";

export type SearchKindCard = {
  kind: SearchKindName;
  id: string;
  href: string;
  title: string;
  summary: string;
  /* Federated items only: the hosting Hub's domain. */
  host?: string;
  score: number;
};

export type SearchExtras = {
  articles: SearchArticleCard[];
  music: SearchMusicCard[];
  tags: SearchTagCard[];
  /* Full timeline cards for the posts in the result list, plus posts found only through a tag. */
  posts: V2PostData[];
  /* Ids of posts that matched only through a tag (not in the core list). */
  taggedPostIds: string[];
  threads: SearchThreadCard[];
  /* Profile ids, out of the people in the result list, that the viewer follows. */
  followingProfileIds: string[];
  kinds: SearchKindCard[];
};

export const EMPTY_SEARCH_EXTRAS: SearchExtras = {
  articles: [],
  music: [],
  tags: [],
  posts: [],
  taggedPostIds: [],
  threads: [],
  followingProfileIds: [],
  kinds: [],
};
