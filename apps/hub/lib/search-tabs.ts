/*
 * The kind tabs of the v2 search page (2026-10-28). A plain module, not the client component,
 * because the server page reads the list too (a value exported from a "use client" file is a
 * client reference on the server).
 * The value goes into the URL as ?group=. Old values (social, media, knowledge, market,
 * services) fall back to "all" when a link is opened.
 */
export const SEARCH_TABS = ["all", "posts", "articles", "videos", "images", "music", "threads", "hubpedia", "games", "research", "federated", "people", "tags"] as const;
export type SearchTab = typeof SEARCH_TABS[number];
