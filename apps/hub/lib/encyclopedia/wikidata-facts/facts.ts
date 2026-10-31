import { isLivingPerson, isSensitiveProperty } from "./sensitive";

/*
 * Wikidata entity -> compact fact list (CC0 data). Each fact has a stable short id (f1, f2, ...), a rendered Japanese line
 * ("property: value (qualifiers)") and the references Wikidata holds for the statement. Pure functions; labels are looked up
 * through a caller-supplied function so the same code works on a fixture and on a live answer.
 */

export type Snak = { snaktype?: string; property?: string; datatype?: string; datavalue?: { type?: string; value?: any } };
export type RawClaim = { mainsnak?: Snak; rank?: string; qualifiers?: Record<string, Snak[]>; references?: Array<{ snaks?: Record<string, Snak[]> }> };
export type RawEntity = {
  id?: string;
  missing?: string;
  labels?: Record<string, { value?: string }>;
  descriptions?: Record<string, { value?: string }>;
  aliases?: Record<string, Array<{ value?: string }>>;
  sitelinks?: Record<string, unknown>;
  claims?: Record<string, RawClaim[]>;
};

export type FactReference = { url?: string; statedIn?: string };
export type Fact = {
  id: string;
  pid: string;
  property: string;
  value: string;
  qualifiers: string[];
  /** The full rendered line shown to the model and used by the sentence check. */
  text: string;
  rank: "preferred" | "normal";
  references: FactReference[];
  /** Heading of the class-plan section the fact belongs to (null: lead). Set by planFacts. */
  section?: string | null;
};

export type LabelLookup = (id: string) => string | null;

export const MAX_FACTS = 36;
export const MAX_VALUES_PER_PROPERTY = 5;
export const QUALIFIER_PROPERTIES: ReadonlySet<string> = new Set(["P580", "P582", "P585", "P642", "P276", "P518"]);
/** External identifiers worth stating (CAS number). Every other external-id, media, url and bookkeeping property is skipped. */
export const USEFUL_EXTERNAL_IDS: ReadonlySet<string> = new Set(["P231"]);
export const SKIPPED_PROPERTIES: ReadonlySet<string> = new Set(["P373", "P910", "P1424", "P1343", "P143", "P4900", "P2184", "P8408", "P1889", "P460", "P1482", "P2959", "P5008", "P1196", "P1651"]);
const SKIPPED_DATATYPES = new Set(["commonsMedia", "external-id", "url", "wikibase-lexeme", "wikibase-form", "wikibase-sense", "geo-shape", "tabular-data", "math", "musical-notation", "entity-schema"]);

const ITEM_ID = /^Q\d+$/u;
const PROP_ID = /^P\d+$/u;
const WIKIMEDIA_LABEL = /^(?:Category|Template|Wikimedia|Help|Portal|Module):/u;

/** Ids that must be labelled before facts can be rendered: items used as values or qualifier values, units, and properties. */
export function collectLabelIds(entity: RawEntity): { items: Set<string>; props: Set<string> } {
  const items = new Set<string>();
  const props = new Set<string>();
  const addSnak = (snak: Snak | undefined) => {
    const value = snak?.datavalue?.value;
    if (snak?.datavalue?.type === "wikibase-entityid" && typeof value?.id === "string" && ITEM_ID.test(value.id)) items.add(value.id);
    if (snak?.datavalue?.type === "quantity" && typeof value?.unit === "string") {
      const id = /\/(Q\d+)$/u.exec(value.unit)?.[1];
      if (id) items.add(id);
    }
  };
  for (const [pid, claims] of Object.entries(entity.claims ?? {})) {
    props.add(pid);
    for (const claim of claims) {
      addSnak(claim.mainsnak);
      for (const [qpid, snaks] of Object.entries(claim.qualifiers ?? {})) {
        if (!QUALIFIER_PROPERTIES.has(qpid)) continue;
        props.add(qpid);
        for (const snak of snaks) addSnak(snak);
      }
      for (const reference of claim.references ?? []) for (const snak of reference.snaks?.P248 ?? []) addSnak(snak);
    }
  }
  return { items, props };
}

/** A Wikidata time value in Japanese, at its stated precision. Precision finer than a day or coarser than a millennium is not rendered. */
export function renderTime(value: { time?: string; precision?: number; calendarmodel?: string } | undefined): string | null {
  const match = /^([+-])(\d+)-(\d{2})-(\d{2})T/u.exec(value?.time ?? "");
  const precision = value?.precision;
  if (!match || typeof precision !== "number") return null;
  const bce = match[1] === "-";
  const year = Number(match[2]);
  const month = Number(match[3]);
  const day = Number(match[4]);
  const julian = value?.calendarmodel?.endsWith("/Q1985786") ? "（ユリウス暦）" : "";
  const era = bce ? "紀元前" : "";
  if (precision >= 11 && month >= 1 && day >= 1) return `${era}${year}年${month}月${day}日${julian}`;
  if (precision >= 10 && month >= 1) return `${era}${year}年${month}月${julian}`;
  if (precision >= 9) return `${era}${year}年${julian}`;
  if (precision === 8) return `${era}${Math.floor(year / 10) * 10}年代`;
  if (precision === 7) return `${era}${Math.max(1, Math.ceil(year / 100))}世紀`;
  if (precision === 6) return `${era}${Math.max(1, Math.ceil(year / 1000))}千年紀`;
  return null;
}

function plainNumber(raw: string): string | null {
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/u.exec(raw.trim());
  if (!match) return null;
  const fraction = (match[3] ?? "").replace(/0+$/u, "");
  const digits = `${match[2]}${fraction ? `.${fraction}` : ""}`;
  return `${match[1] === "-" ? "-" : ""}${digits}`;
}

export function renderQuantity(value: { amount?: string; unit?: string } | undefined, lookup: LabelLookup): string | null {
  const amount = plainNumber(value?.amount ?? "");
  if (amount === null) return null;
  const unitId = /\/(Q\d+)$/u.exec(value?.unit ?? "")?.[1];
  if (!unitId) return value?.unit === "1" ? amount : null;
  const unit = lookup(unitId);
  return unit ? `${amount}${unit}` : null;
}

export function renderCoordinate(value: { latitude?: number; longitude?: number } | undefined): string | null {
  const { latitude, longitude } = value ?? {};
  if (typeof latitude !== "number" || typeof longitude !== "number") return null;
  const round = (n: number) => Number(Math.abs(n).toFixed(4));
  return `${latitude >= 0 ? "北緯" : "南緯"}${round(latitude)}度、${longitude >= 0 ? "東経" : "西経"}${round(longitude)}度`;
}

/** The value of one snak as text, or null when it cannot be stated (no value, unknown datatype, an item without a label). */
export function renderSnak(snak: Snak | undefined, lookup: LabelLookup): string | null {
  if (!snak || snak.snaktype !== "value" || !snak.datavalue) return null;
  if (snak.datatype && SKIPPED_DATATYPES.has(snak.datatype) && !USEFUL_EXTERNAL_IDS.has(snak.property ?? "")) return null;
  const { type, value } = snak.datavalue;
  switch (type) {
    case "wikibase-entityid": {
      const label = typeof value?.id === "string" ? lookup(value.id) : null;
      /* Wikimedia housekeeping items (categories, templates) are not facts about the subject. */
      return label && !WIKIMEDIA_LABEL.test(label) ? label : null;
    }
    case "time": return renderTime(value);
    case "quantity": return renderQuantity(value, lookup);
    case "globecoordinate": return renderCoordinate(value);
    case "monolingualtext": return value?.language === "ja" || value?.language === "en" ? String(value.text ?? "").trim() || null : null;
    case "string": {
      const text = String(value ?? "").trim();
      return text && text.length <= 120 ? text : null;
    }
    default: return null;
  }
}

function referencesOf(claim: RawClaim, lookup: LabelLookup): FactReference[] {
  const out: FactReference[] = [];
  for (const reference of claim.references ?? []) {
    const url = reference.snaks?.P854?.map((snak) => snak.datavalue?.value).find((value): value is string => typeof value === "string" && /^https?:\/\//u.test(value));
    const statedId = reference.snaks?.P248?.map((snak) => snak.datavalue?.value?.id).find((id): id is string => typeof id === "string");
    const statedIn = statedId ? lookup(statedId) ?? undefined : undefined;
    if (url || statedIn) out.push({ ...(url ? { url } : {}), ...(statedIn ? { statedIn } : {}) });
  }
  return out;
}

export function entityLabel(entity: RawEntity, language: "ja" | "en"): string | null {
  return entity.labels?.[language]?.value?.trim() || null;
}

export type FactBuild = { facts: Fact[]; dropped: Record<string, number> };

/**
 * Facts of one entity. Deprecated statements are excluded, preferred rank comes first within a property, and sensitive
 * properties of a living person are removed before anything is rendered. The first fact is the description (ja, else en).
 */
export function buildFacts(entity: RawEntity, lookup: LabelLookup): FactBuild {
  const dropped: Record<string, number> = {};
  const count = (reason: string) => { dropped[reason] = (dropped[reason] ?? 0) + 1; };
  const living = isLivingPerson(entity.claims);
  const drafts: Array<Omit<Fact, "id">> = [];
  const seen = new Set<string>();
  const push = (draft: Omit<Fact, "id">) => {
    if (seen.has(draft.text)) { count("duplicate"); return; }
    seen.add(draft.text);
    drafts.push(draft);
  };
  const descriptionJa = entity.descriptions?.ja?.value?.trim();
  const descriptionEn = entity.descriptions?.en?.value?.trim();
  if (descriptionJa || descriptionEn) {
    const value = descriptionJa ?? descriptionEn!;
    const property = descriptionJa ? "説明" : "説明（英語の原文）";
    push({ pid: "description", property, value, qualifiers: [], text: `${property}: ${value}`, rank: "normal", references: [] });
  }
  for (const [pid, claims] of Object.entries(entity.claims ?? {})) {
    if (!PROP_ID.test(pid)) continue;
    if (isSensitiveProperty(pid, living)) { count("sensitive-property"); continue; }
    if (SKIPPED_PROPERTIES.has(pid)) { count("skipped-property"); continue; }
    const property = lookup(pid);
    if (!property) { count("property-without-label"); continue; }
    const ordered = claims.filter((claim) => claim.rank !== "deprecated").sort((a, b) => Number(b.rank === "preferred") - Number(a.rank === "preferred"));
    if (ordered.length < claims.length) count("deprecated");
    let kept = 0;
    for (const claim of ordered) {
      if (kept >= MAX_VALUES_PER_PROPERTY) { count("too-many-values"); break; }
      const value = renderSnak(claim.mainsnak, lookup);
      if (value === null) { count("unrenderable-value"); continue; }
      const qualifiers: string[] = [];
      for (const [qpid, snaks] of Object.entries(claim.qualifiers ?? {})) {
        if (!QUALIFIER_PROPERTIES.has(qpid)) continue;
        const qlabel = lookup(qpid);
        if (!qlabel) continue;
        for (const snak of snaks.slice(0, 2)) {
          const rendered = renderSnak(snak, lookup);
          if (rendered) qualifiers.push(`${qlabel}: ${rendered}`);
        }
      }
      push({
        pid, property, value, qualifiers,
        text: `${property}: ${value}${qualifiers.length ? `（${qualifiers.join("、")}）` : ""}`,
        rank: claim.rank === "preferred" ? "preferred" : "normal",
        references: referencesOf(claim, lookup),
      });
      kept += 1;
    }
  }
  if (drafts.length > MAX_FACTS) count("fact-cap");
  const facts = drafts.slice(0, MAX_FACTS).map((draft, index) => ({ id: `f${index + 1}`, ...draft }));
  return { facts, dropped };
}

/** Facts other than the description: what an article can actually rest on. */
export const substantiveFacts = (facts: readonly Fact[]) => facts.filter((fact) => fact.pid !== "description");
