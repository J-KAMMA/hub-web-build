/* Shared by the importer and the article page. No Node imports: safe for server components. */

export const WIKIPEDIA_OBJECT_PREFIX = "hubpedia-wikipedia/";
export const WIKIPEDIA_LICENSE = "CC-BY-SA-4.0";
export const WIKIPEDIA_LICENSE_URL = "https://creativecommons.org/licenses/by-sa/4.0/deed.ja";
export const DEFAULT_MIN_CHARS = 300;

export const wikipediaObjectKey = (revisionId: number) => `${WIKIPEDIA_OBJECT_PREFIX}${revisionId}.txt`;
export const wikipediaSlug = (title: string) => title.trim().replace(/[\s_]+/gu, "_");
export const wikipediaPageUrl = (title: string) => `https://ja.wikipedia.org/wiki/${encodeURIComponent(wikipediaSlug(title))}`;
export const wikipediaHistoryUrl = (title: string) => `https://ja.wikipedia.org/w/index.php?title=${encodeURIComponent(wikipediaSlug(title))}&action=history`;
