/*
 * Topic filter for the AIL "hubpedia" worker project (owner decision 2026-10-30): prefer CONCRETE items (people, places,
 * organisations, events, works, species, artefacts, specific diseases and chemicals) over abstract classes. Decided from the
 * item's Wikidata statements (wbgetentities, props=claims):
 *
 *   1. instance of (P31) must be present;
 *   2. any P31 in DROP_P31 drops the item: class, metaclass, and Wikimedia page types (disambiguation, list, category,
 *      template, portal, module), scholarly articles, versions/editions;
 *   3. at least one P31 must be in ALLOW_P31 (a sensible allowlist of concrete categories, QIDs checked against Wikidata
 *      labels on 2026-10-30); a taxon (Q16521) counts only at rank species (Q7432) or genus (Q34740, P105);
 *   4. an item that is itself a subclass (it has a subclass of / P279 statement) is a class, not a thing, and is dropped,
 *      except for the categories in SUBCLASS_OK (diseases and chemicals, whose items are usually modelled that way too).
 *      The inverse count (how many subclasses an item has) is not available from wbgetentities; P279 on the item plus the
 *      allowlist is the proxy.
 *
 * The kept items are ranked by Wikidata sitelink count (articles in other languages), most notable first.
 */

export const ALLOW_P31: ReadonlySet<string> = new Set([
  /* people */ "Q5",
  /* places */ "Q515", "Q486972", "Q532", "Q3957", "Q1549591", "Q15284", "Q6256", "Q3624078", "Q35657", "Q8502", "Q23442", "Q4022", "Q23397", "Q46831",
  "Q484170", "Q747074", "Q2074737", "Q262166", "Q3024240", "Q17343829", "Q5084", "Q1637706", "Q8072", "Q46169", "Q15324", "Q4421", "Q34442",
  /* organisations */ "Q43229", "Q4830453", "Q783794", "Q891723", "Q3918", "Q875538", "Q31855", "Q327333", "Q7278", "Q484652", "Q476028",
  "Q2385804", "Q5341295", "Q7210356", "Q4438121", "Q1530022", "Q2088357", "Q18127", "Q2467461", "Q41298", "Q11032", "Q1002697", "Q16917",
  /* events */ "Q198", "Q178561", "Q350604", "Q3839081", "Q124757", "Q13418847", "Q40231", "Q645883", "Q132241", "Q7944", "Q1057954",
  /* works */ "Q11424", "Q7725634", "Q571", "Q482994", "Q134556", "Q7889", "Q5398426", "Q15416", "Q1004", "Q21198342", "Q4502142", "Q3305213",
  "Q860861", "Q838948", "Q1344", "Q47461344", "Q2001305", "Q7397", "Q9143",
  /* species */ "Q16521",
  /* artefacts and structures */ "Q811979", "Q41176", "Q16560", "Q23413", "Q16970", "Q44539", "Q570116", "Q839954", "Q4989906", "Q12280",
  "Q1248784", "Q55488", "Q33506", "Q7075", "Q22698", "Q179700", "Q11446", "Q9259", "Q24398318", "Q2087181", "Q1076486", "Q3947", "Q34379",
  /* specific diseases, chemicals, medicines */ "Q12136", "Q929833", "Q18123741", "Q11173", "Q79529", "Q12140", "Q11344",
]);

/** Categories whose items are normally modelled with a subclass-of statement as well; the P279 rule does not drop them. */
export const SUBCLASS_OK: ReadonlySet<string> = new Set(["Q12136", "Q929833", "Q18123741", "Q11173", "Q79529", "Q12140", "Q11344"]);

export const DROP_P31: ReadonlySet<string> = new Set([
  "Q16889133", "Q19478619", "Q24017414", "Q23958852", /* class, metaclass, second-order and variable-order class */
  "Q4167410", "Q13406463", "Q4167836", "Q11266439", "Q17633526", "Q15184295", "Q4663903", "Q15474042", /* Wikimedia page types */
  "Q13442814", "Q3331189", "Q21070568", /* scholarly article, version/edition, disputed existence */
]);

const TAXON = "Q16521";
const TAXON_RANKS_OK = new Set(["Q7432", "Q34740"]);

export type TypeInfo = { p31: string[]; subclassOf: number; rank: string[]; checkedAt: string };
export type TypeCache = Record<string, TypeInfo>;

type Claim = { mainsnak?: { datavalue?: { value?: { id?: string } } } };
type Entity = { missing?: string; claims?: Record<string, Claim[]> };

const ids = (claims: Claim[] | undefined) => (claims ?? []).map((claim) => claim.mainsnak?.datavalue?.value?.id).filter((id): id is string => typeof id === "string" && /^Q\d+$/u.test(id));

/** Entity map of a wbgetentities (props=claims) answer -> the few facts the filter needs. */
export function parseTypeResponse(json: unknown, checkedAt: string): TypeCache {
  const entities = (json as { entities?: Record<string, Entity> } | null)?.entities ?? {};
  const out: TypeCache = {};
  for (const [qid, entity] of Object.entries(entities)) {
    if (!/^Q\d+$/u.test(qid) || entity.missing !== undefined) continue;
    out[qid] = { p31: ids(entity.claims?.P31), subclassOf: (entity.claims?.P279 ?? []).length, rank: ids(entity.claims?.P105), checkedAt };
  }
  return out;
}

export type Concreteness = { keep: boolean; reason: string };

export function classifyConcrete(info: TypeInfo | undefined): Concreteness {
  if (!info) return { keep: false, reason: "no-wikidata-answer" };
  if (info.p31.length === 0) return { keep: false, reason: "no-instance-of" };
  const dropped = info.p31.find((qid) => DROP_P31.has(qid));
  if (dropped) return { keep: false, reason: `drop-p31-${dropped}` };
  const allowed = info.p31.filter((qid) => ALLOW_P31.has(qid));
  if (allowed.length === 0) return { keep: false, reason: "p31-not-allowlisted" };
  /* A taxon is concrete only at species or genus rank; the higher ranks are classes of organisms. */
  const onlyTaxon = allowed.every((qid) => qid === TAXON);
  if (onlyTaxon && !info.rank.some((qid) => TAXON_RANKS_OK.has(qid))) return { keep: false, reason: "taxon-rank-too-high" };
  if (info.subclassOf > 0 && !allowed.some((qid) => SUBCLASS_OK.has(qid))) return { keep: false, reason: "is-a-subclass" };
  return { keep: true, reason: `p31-${allowed[0]}` };
}

export const TYPE_BATCH = 25;
export const TYPE_CACHE_DAYS = 30;

export function staleTypeQids(qids: readonly string[], cache: TypeCache, now: Date): string[] {
  const limit = now.getTime() - TYPE_CACHE_DAYS * 86_400_000;
  return qids.filter((qid) => { const info = cache[qid]; return !info || !(Date.parse(info.checkedAt) >= limit); });
}

export async function fetchTypes(
  qids: readonly string[],
  options: { fetchJson?: (url: string) => Promise<unknown>; now?: Date; pauseMs?: number } = {},
): Promise<TypeCache> {
  const fetchJson = options.fetchJson ?? (async (url: string) => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await fetch(url, { headers: { "user-agent": "WorldGovernmentHub-Encyclopedia/1.0 (https://hub.jkamma.com/; type check; read-only)", accept: "application/json" } });
      if (response.status === 429 || response.status === 503) {
        await new Promise((done) => setTimeout(done, (Number(response.headers.get("retry-after")) || 20) * 1000 + attempt * 5000));
        continue;
      }
      if (!response.ok) throw new Error(`Wikidata HTTP ${response.status}`);
      return response.json();
    }
    throw new Error("Wikidata HTTP 429 (retries exhausted)");
  });
  const checkedAt = (options.now ?? new Date()).toISOString();
  const result: TypeCache = {};
  for (let at = 0; at < qids.length; at += TYPE_BATCH) {
    const batch = qids.slice(at, at + TYPE_BATCH);
    const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&props=claims&format=json&maxlag=5&ids=${batch.join("|")}`;
    Object.assign(result, parseTypeResponse(await fetchJson(url), checkedAt));
    if (options.pauseMs && at + TYPE_BATCH < qids.length) await new Promise((done) => setTimeout(done, options.pauseMs));
  }
  return result;
}
