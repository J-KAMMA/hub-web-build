/*
 * Queue job names for the encyclopedia pipeline. Kept apart from pipeline.ts,
 * which imports the HTML extractor (jsdom, Readability), so that code which only
 * needs the names (the queue consumer's message check) does not load it.
 */
export const JOBS = { fetch: "encyclopedia.source.fetch", extract: "encyclopedia.source.extract", chunk: "encyclopedia.source.chunk", refresh: "encyclopedia.topic.refresh", discover: "encyclopedia.corpus.discover", wikiReview: "encyclopedia.wiki.review" } as const;
