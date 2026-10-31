import type { CachedEntity } from "./wikidata-client";

/*
 * Which Wikidata items are not encyclopedic terms. Generic items ("occurrence", "use", "need", "type") passed the
 * gate in the first trial and got claims linked. A term is kept in the net (edges still use it) but is marked
 * not linkable, and so is never linked to nor picked as an article topic, when any of these holds. Seeds are
 * chosen by the owner and are exempt.
 */

/** Items whose instance_of / subclass_of makes the entity a Wikimedia-internal or structural page, never a topic. */
export const META_CLASS_QIDS: ReadonlySet<string> = new Set([
  "Q17442446", // Wikimedia internal item
  "Q4167410", //  Wikimedia disambiguation page
  "Q22808320", // Wikimedia human name disambiguation page
  "Q4167836", //  Wikimedia category
  "Q11266439", // Wikimedia template
  "Q13406463", // Wikimedia list article
  "Q15184295", // Wikimedia module
  "Q14204246", // Wikimedia project page
  "Q24017414", // second-order class (a class of classes, a modelling device)
  "Q23958852", // variable-order class
  "Q23958946", // individual entity (modelling device)
]);

/** Abstract/linguistic classes. Checked on instance_of only: many real topics are a subclass of "concept". */
export const ABSTRACT_INSTANCE_QIDS: ReadonlySet<string> = new Set([
  "Q151885", //  concept
  "Q1969448", // term (a word used in a field)
]);

/**
 * Upper-ontology and abstract items that are never an article topic of their own. Checked on the entity's own QID, so
 * they are rejected even when the cached copy carries no class statements. QIDs were looked up on Wikidata
 * (wbsearchentities, 2026-10-30) from the noise topics seen in the second trial. Seeds are exempt.
 */
export const GENERIC_ITEM_QIDS: ReadonlySet<string> = new Set([
  "Q1190554", //  occurrence (事象): "something that happens", the root of all event classes
  "Q67518978", // occurrent (生起性エンティティ): BFO upper-ontology class
  "Q1724915", //  use (利用): "using a resource to do something", a bare verb noun
  "Q190258", //   need (必要): what an organism needs to live, generic
  "Q190087", //   data type (reached by the alias タイプ)
  "Q4671286", //  academic major (学術専攻): a category of study programmes, not a subject
  "Q268592", //   industry (産業): economic-sector umbrella
  "Q104493", //   risk (リスク): generic management/insurance concept
  "Q42501", //    fuel (燃料): material-class umbrella
  "Q12147", //    health (健康): umbrella state concept
]);

/** Upper classes. A non-seed whose instance_of or subclass_of is one of these is a top-level abstraction. */
export const ABSTRACT_SUPERCLASS_QIDS: ReadonlySet<string> = new Set([
  "Q35120", //    entity: the root of Wikidata's class tree
  "Q16889133", // class (as a concept): a modelling device, not a topic
  "Q1190554", //  occurrence: a direct subclass is an event-class umbrella
]);

/**
 * Plain common words that name a generic Wikidata item by alias or label. The linker never matches these surfaces for
 * a non-seed term, even when the item itself passed the other checks (the surface is the noise, not the item).
 * Compared after NFKC and lower-casing.
 */
export const GENERIC_SURFACES: ReadonlySet<string> = new Set([
  "事象", "利用", "必要", "タイプ", "形式", "産業", "リスク", "燃料", "健康", "学術専攻", "生起性エンティティ",
  "type", "use", "need", "risk", "fuel", "health", "industry", "occurrence", "form",
]);

export const isGenericSurface = (surface: string) => GENERIC_SURFACES.has(surface.normalize("NFKC").trim().toLowerCase());

/** One-word labels shorter than this are too ambiguous to match (Japanese / English). */
export const MIN_ONE_WORD_LABEL = { ja: 3, en: 4 } as const;

const oneWord = (label: string) => !/\s/u.test(label.trim());

/** True when the label is a single word below the minimum length for its language. */
export function isShortOneWord(label: string | null, language: "ja" | "en"): boolean {
  if (!label) return true; // nothing to match with in this language
  const trimmed = label.trim();
  return oneWord(trimmed) && [...trimmed].length < MIN_ONE_WORD_LABEL[language];
}

export type NoiseVerdict = { encyclopedic: true } | { encyclopedic: false; reason: "no-wikipedia" | "unknown-sitelinks" | "generic-item" | "meta-class" | "abstract-class" | "short-label" };

/**
 * Seeds are always encyclopedic. Everything else fails closed: an entity cached before sitelink languages were recorded
 * (`wikis` absent) cannot show it has a Wikipedia article, so it is not linkable until the client refetches it.
 */
export function judgeEncyclopedic(entity: CachedEntity | undefined, isSeed: boolean): NoiseVerdict {
  if (isSeed) return { encyclopedic: true };
  if (!entity) return { encyclopedic: false, reason: "no-wikipedia" };
  if (!entity.wikis) return { encyclopedic: false, reason: "unknown-sitelinks" };
  if (!entity.wikis.ja && !entity.wikis.en) return { encyclopedic: false, reason: "no-wikipedia" };
  if (GENERIC_ITEM_QIDS.has(entity.qid)) return { encyclopedic: false, reason: "generic-item" };
  for (const edge of entity.out) {
    if ((edge.relation === "instance_of" || edge.relation === "subclass_of") && META_CLASS_QIDS.has(edge.to)) return { encyclopedic: false, reason: "meta-class" };
    if ((edge.relation === "instance_of" || edge.relation === "subclass_of") && ABSTRACT_SUPERCLASS_QIDS.has(edge.to)) return { encyclopedic: false, reason: "abstract-class" };
    if (edge.relation === "instance_of" && ABSTRACT_INSTANCE_QIDS.has(edge.to)) return { encyclopedic: false, reason: "abstract-class" };
  }
  if (isShortOneWord(entity.labelJa, "ja") && isShortOneWord(entity.labelEn, "en")) return { encyclopedic: false, reason: "short-label" };
  return { encyclopedic: true };
}
