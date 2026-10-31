/*
 * Sensitive-property filter for Wikidata fact articles (owner decision 2026-10-30). Wikidata is CC0, but a short AI article
 * must not restate personal attributes of a living person. A person without a date of death (P570) is treated as living,
 * which also covers historical figures whose death is simply not recorded: the safe side.
 */

/** religion or worldview, ethnic group, sexual orientation, medical condition, political party/membership. */
export const SENSITIVE_PROPERTIES: ReadonlySet<string> = new Set(["P140", "P172", "P91", "P1050", "P102"]);

/** Further private facts that are dropped for a living person only: residence and family links. */
export const LIVING_ONLY_PROPERTIES: ReadonlySet<string> = new Set(["P551", "P26", "P40", "P22", "P25", "P3373", "P1038", "P451"]);

type Claims = Record<string, unknown[]> | undefined;

const itemIds = (claims: Claims, pid: string): string[] =>
  (claims?.[pid] ?? []).map((claim) => (claim as { mainsnak?: { datavalue?: { value?: { id?: string } } } }).mainsnak?.datavalue?.value?.id).filter((id): id is string => typeof id === "string");

/** A human (P31 = Q5) with no date of death statement. */
export function isLivingPerson(claims: Claims): boolean {
  return itemIds(claims, "P31").includes("Q5") && !(claims?.P570?.length);
}

/** True when the property must not appear in the fact list of this item at all. */
export function isSensitiveProperty(pid: string, living: boolean): boolean {
  return living && (SENSITIVE_PROPERTIES.has(pid) || LIVING_ONLY_PROPERTIES.has(pid));
}
