/*
 * Term net constants (docs/hubpedia-ledger.md section 11). The values marked "owner may change" were left
 * open by the owner on 2026-10-29 and are defaults chosen by the implementer.
 */

/** Owner may change: caps on the net. Seeds are always kept even when the caps are reached. */
export const TERM_NET_CAPS = { maxTerms: 20_000, maxEdges: 100_000 } as const;

/** Owner may change: weights of the percentile blend that orders articles (centrality, demand, sitelinks). */
export const PRIORITY_WEIGHTS = { centrality: 0.5, demand: 0.3, sitelinks: 0.2 } as const;

/** Owner may change: the contact in the User-Agent. A URL only; the agent never writes a personal email address. */
export const WIKIDATA_CONTACT = "https://hub.jkamma.com";
export const WIKIDATA_USER_AGENT = `jkamma-hubpedia-term-net/1 (${WIKIDATA_CONTACT})`;

/** Fixed by the design, not by the open choices. */
export const TERM_NET_RULES = {
  forwardHops: 2,
  reverseHops: 1,
  reverseLimitPerTerm: 50,
  /** A term with more than this many direct subclasses is kept in the net but not linked to. */
  nonLinkableSubclasses: 200,
  entityBatch: 50,
  reverseBatch: 50,
  maxlag: 5,
  minIntervalMs: 1_000,
  pagerankDamping: 0.85,
  pagerankIterations: 30,
  relatedWeight: 0.5,
} as const;

export const RELATIONS = ["subclass_of", "instance_of", "part_of", "facet_of", "studies", "related"] as const;
export type Relation = (typeof RELATIONS)[number];

export type TermRecord = {
  qid: string;
  slug: string;
  labelJa: string | null;
  labelEn: string | null;
  aliasesJa: string[];
  aliasesEn: string[];
  descriptionJa: string | null;
  descriptionEn: string | null;
  sitelinks: number;
  hops: number;
  seed: boolean;
  linkable: boolean;
  /** Wikidata revision id of the entity when fetched. */
  rev: number | null;
};

export type EdgeRecord = { from: string; to: string; relation: Relation; origin: "wikidata" | "hub" };

export const qidNumber = (qid: string) => Number(qid.slice(1));
