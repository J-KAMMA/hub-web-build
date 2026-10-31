import type { HubpediaArticle } from "@/lib/hubpedia-content";
import { HUBPEDIA_RAIL_ENTRIES } from "./seed/hubpedia-rail-manifest.generated";

/* The shared shell must not import the full Hubpedia seed index. That index
 * grows with every factory batch and would make every SNS route compile the
 * whole encyclopedia. The rail is fed instead by a small dedicated manifest
 * that the batch generator rebuilds from the approved publication list —
 * 2026-09-18: the first 120 factory-rebuilt articles were approved, so the
 * rail carries them now. */
export const HUBPEDIA_RAIL_ARTICLES: HubpediaArticle[] = HUBPEDIA_RAIL_ENTRIES.map((entry) => ({
  slug: entry.slug,
  title: entry.title,
  category: entry.category,
  summary: entry.summary,
}));
