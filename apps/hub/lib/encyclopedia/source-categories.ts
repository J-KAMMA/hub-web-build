import { findTrustedSourceDomain, REVIEWED_AND_EXCLUDED_DOMAINS, type TrustedSourceDomain } from "./trusted-source-domains";

/*
 * Source publishers admitted by CATEGORY (owner decision 2026-10-30, docs/hubpedia-ledger.md "Source publisher categories").
 *
 * The 14 individually reviewed publishers in trusted-source-domains.ts permit commercial reuse of their text. A category
 * entry does not: it is admitted as CITATION-ONLY. A reliable publisher may support independently written facts, but its
 * prose is never copied, translated, closely paraphrased or adapted (editorial-policy.ts). Nothing here widens
 * findTrustedSourceDomain, which every other caller keeps using; only the AIL Hubpedia pipeline (task generator and
 * importer) uses findAilSourcePublisher.
 *
 * Matching is by exact host suffix on dot boundaries, on the host the URL parser produced (lower case, punycode for
 * non-ASCII names). "evil.gov.example.com", "gov.evil.com", "notgov" and "xn--" look-alikes never match, and a host
 * with a user-generated label (people.*, users.*, blogs.* ...) or a personal path (/~name) is refused.
 */

export type SourceCategoryId = "government" | "academic" | "intergovernmental" | "statistics" | "publisher";

type Rule = {
  category: SourceCategoryId;
  /** "suffix": a public-suffix-like label (gov, ac.uk): the publisher is one more label to the left. "domain": the publisher is exactly this domain. */
  kind: "suffix" | "domain";
  /** Without leading dot. */
  value: string;
};

const suffix = (category: SourceCategoryId, values: readonly string[]): Rule[] => values.map((value) => ({ category, kind: "suffix", value }));
const domain = (category: SourceCategoryId, values: readonly string[]): Rule[] => values.map((value) => ({ category, kind: "domain", value }));

export const SOURCE_CATEGORY_RULES: readonly Rule[] = [
  ...suffix("government", [
    "gov", "gov.uk", "gov.scot", "gov.wales", "gov.au", "gov.nz", "govt.nz", "gc.ca", "gouv.fr", "gouv.qc.ca", "gov.ie", "go.jp",
    "gov.cn", "go.kr", "gov.tw", "gov.sg", "gov.hk", "gov.in", "gov.br", "gob.mx", "gob.es", "gob.ar", "gob.cl", "gob.pe", "gov.it",
    "gov.pl", "gov.ru", "gov.za", "gov.il", "gov.tr", "gov.ua", "gov.my", "go.th", "go.id", "gov.ph", "gov.vn", "gov.pk", "gov.bd",
    "gov.lk", "gov.eg", "gov.ng", "go.ke", "gov.gr", "gov.pt", "gov.ro", "gov.hu", "gov.cz", "gov.sk", "gov.si", "gov.hr", "gov.rs",
    "gov.bg", "gov.lt", "gov.lv", "gv.at", "gov.sa", "gov.ae", "gov.qa", "gov.kw", "gov.jo", "gov.lb", "gov.ma", "gov.dz", "gov.tn",
    "gov.cy", "gov.mt", "gov.kz", "gov.by", "gov.az", "gov.ge", "gov.am", "gov.mn", "gov.np", "gov.mm", "gov.kh", "gov.bn", "gov.mo",
    "gov.co", "gob.ec", "gub.uy", "gob.bo", "gob.pa", "gob.gt", "gob.sv", "gob.hn", "go.cr", "gov.do", "gov.jm", "gov.tt", "gov.bb",
    "gov.gh", "gov.zm", "go.tz", "go.ug", "gov.rw", "gov.na", "gov.bw", "gov.zw", "gov.mu", "gov.fj",
  ]),
  ...domain("government", [
    "europa.eu", "canada.ca", "admin.ch", "bund.de", "bundesregierung.de", "overheid.nl", "rijksoverheid.nl", "regeringen.se",
    "regjeringen.no", "valtioneuvosto.fi", "stjornarradid.is", "riik.ee", "service-public.fr", "legifrance.gouv.fr",
  ]),
  ...suffix("academic", [
    "edu", "ac.jp", "ac.uk", "edu.au", "ac.nz", "ac.kr", "edu.cn", "edu.tw", "edu.hk", "edu.sg", "ac.in", "edu.in", "ac.il", "edu.br",
    "edu.mx", "edu.ar", "edu.co", "edu.pe", "ac.za", "edu.eg", "edu.tr", "edu.pl", "edu.my", "ac.th", "ac.id", "edu.sa", "ac.ir",
    "ac.lk", "ac.bd", "ac.ke", "ac.tz", "ac.ug", "ac.zw", "ac.at", "ac.be", "ac.cy", "ac.ae", "ac.ru", "ac.rs", "edu.ua", "edu.vn",
    "edu.ph", "edu.pk", "edu.gr", "edu.es", "ac.ir", "edu.sg",
  ]),
  ...domain("academic", [
    "ethz.ch", "epfl.ch", "mpg.de", "cern.ch", "helmholtz.de", "cnrs.fr", "inserm.fr", "kuleuven.be", "tudelft.nl", "ku.dk", "ki.se",
    "kth.se", "uu.se", "helsinki.fi", "uio.no", "riken.jp", "csiro.au",
  ]),
  ...domain("intergovernmental", [
    "un.org", "who.int", "oecd.org", "oecd-ilibrary.org", "worldbank.org", "imf.org", "unesco.org", "wto.org", "iaea.org", "unicef.org",
    "fao.org", "ilo.org", "itu.int", "wipo.int", "unep.org", "undp.org", "unhcr.org", "ifad.org", "icao.int", "imo.org", "wmo.int",
    "upu.int", "unido.org", "unwto.org", "iom.int", "nato.int", "bis.org", "coe.int", "osce.org", "oas.org", "au.int", "asean.org",
    "ebrd.com", "adb.org", "afdb.org", "iadb.org", "wcoomd.org", "cites.org", "ramsar.org", "cbd.int", "unfccc.int", "ipcc.ch",
    "icj-cij.org", "icc-cpi.int", "interpol.int", "opcw.org", "ctbto.org", "unodc.org", "unwomen.org", "unfpa.org", "wfp.org",
    "ohchr.org", "paho.org", "unaids.org", "unctad.org", "unhabitat.org", "eib.org",
  ]),
  ...domain("statistics", [
    "destatis.de", "insee.fr", "istat.it", "cbs.nl", "scb.se", "ssb.no", "dst.dk", "stat.fi", "ine.es", "ine.pt", "czso.cz", "ksh.hu",
    "hagstofa.is", "statistik.at", "statcan.gc.ca",
  ]),
  ...domain("publisher", [
    "nature.com", "springer.com", "springernature.com", "sciencedirect.com", "elsevier.com", "wiley.com", "tandfonline.com",
    "cambridge.org", "oup.com", "academic.oup.com", "jstor.org", "ncbi.nlm.nih.gov", "arxiv.org", "sagepub.com", "science.org",
    "pnas.org", "cell.com", "thelancet.com", "bmj.com", "nejm.org", "royalsocietypublishing.org", "iop.org", "aps.org", "acs.org",
    "rsc.org", "annualreviews.org", "frontiersin.org", "mdpi.com", "plos.org", "biomedcentral.com",
  ]),
];

/** Hosts that are never a source, whatever the category (Wikipedia is a gateway, never evidence; Wikimedia projects likewise). */
const NEVER_SOURCE: readonly string[] = ["wikipedia.org", "wikidata.org", "wikimedia.org", "wikisource.org", "wikibooks.org", "wikiquote.org", "wiktionary.org", "wikivoyage.org", "wikinews.org", "wikiversity.org", "mediawiki.org",
  /* user-upload platforms that sit under an admitted suffix */ "academia.edu"];

/** A host label that marks personal or user-generated pages on a university or government host. */
const USER_GENERATED_LABELS: ReadonlySet<string> = new Set([
  "people", "users", "user", "personal", "student", "students", "studentweb", "stud", "blogs", "blog", "sites", "pages", "homepages", "homepage", "home", "wordpress", "wp", "members", "alumni", "forum", "forums", "wiki", "mypage", "my",
]);

/** ncbi.nlm.nih.gov (PubMed abstracts, PMC articles) is cited, never adapted: it beats the public-domain nih.gov entry and the PMC exclusion. */
const CITATION_ONLY_OVERRIDES: readonly string[] = ["ncbi.nlm.nih.gov"];

const hostMatches = (host: string, domainName: string) => host === domainName || host.endsWith(`.${domainName}`);

/** A strict ASCII host: letters, digits, hyphens, dot-separated labels of 1-63 characters, none starting or ending with a hyphen. */
export function normalizeSourceHost(hostname: string): string | null {
  const host = hostname.toLowerCase();
  if (!host || host.endsWith(".") || host.length > 253) return null;
  const labels = host.split(".");
  if (labels.length < 2) return null;
  for (const label of labels) if (!/^(?:[a-z0-9]|[a-z0-9][a-z0-9-]{0,61}[a-z0-9])$/u.test(label)) return null;
  if (/^\d+(?:\.\d+)*$/u.test(host)) return null; // an IP literal is never a publisher
  return host;
}

export type UrlParts = { host: string; pathname: string };

function parts(url: string): UrlParts | null {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return null; }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  if (parsed.username || parsed.password) return null;
  const host = normalizeSourceHost(parsed.hostname);
  return host ? { host, pathname: parsed.pathname } : null;
}

/** True when the URL points at a personal or user-generated area of an otherwise admitted host. */
export function isUserGeneratedUrl(url: string): boolean {
  const p = parts(url);
  if (!p) return true;
  if (/\/~[^/]/u.test(p.pathname) || /%7e/iu.test(p.pathname.slice(0, 40))) return true;
  const labels = p.host.split(".");
  return labels.slice(0, -1).some((label) => USER_GENERATED_LABELS.has(label));
}

/** A search-result or listing page (site search, publisher query pages): it states nothing about the topic. */
export function isSearchOrListingUrl(url: string): boolean {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return true; }
  if (/^\/(?:search|action\/|dosearch|results|find|browse)(?:[/.?]|$)/iu.test(parsed.pathname)) return true;
  return [...parsed.searchParams.keys()].some((key) => /^(?:q|query|search|searchtext|keyword|keywords|term)$/iu.test(key));
}

export type CategoryMatch = { category: SourceCategoryId; rule: string; publisherDomain: string };

/** The category rule that admits `url`, or null. Longest rule wins; user-generated areas, Wikimedia hosts and reviewed exclusions never match. */
export function matchSourceCategory(url: string): CategoryMatch | null {
  const p = parts(url);
  if (!p) return null;
  if (NEVER_SOURCE.some((entry) => hostMatches(p.host, entry))) return null;
  const override = CITATION_ONLY_OVERRIDES.find((entry) => hostMatches(p.host, entry));
  if (!override && REVIEWED_AND_EXCLUDED_DOMAINS.some((entry) => hostMatches(p.host, entry.domain))) return null;
  if (isUserGeneratedUrl(url) || isSearchOrListingUrl(url)) return null;
  const labels = p.host.split(".");
  let best: { rule: Rule; length: number } | null = null;
  for (const rule of SOURCE_CATEGORY_RULES) {
    if (!hostMatches(p.host, rule.value)) continue;
    /* A suffix rule needs a publisher label to its left ("gov.uk" itself is not a publisher). */
    if (rule.kind === "suffix" && p.host === rule.value) continue;
    if (!best || rule.value.length > best.length) best = { rule, length: rule.value.length };
  }
  if (!best) return null;
  const { rule } = best;
  const publisherDomain = rule.kind === "domain" ? rule.value : labels.slice(-(rule.value.split(".").length + 1)).join(".");
  return { category: rule.category, rule: rule.value, publisherDomain };
}

const CATEGORY_LABEL: Record<SourceCategoryId, string> = {
  government: "Government publisher",
  academic: "University or academic institution",
  intergovernmental: "Intergovernmental organisation",
  statistics: "National statistics office",
  publisher: "Academic publisher or index",
};

const CATEGORY_TIER: Record<SourceCategoryId, { sourceType: string; reliabilityTier: string }> = {
  government: { sourceType: "government", reliabilityTier: "official" },
  academic: { sourceType: "university", reliabilityTier: "scholarly" },
  intergovernmental: { sourceType: "official-organization", reliabilityTier: "official" },
  statistics: { sourceType: "statistics", reliabilityTier: "official" },
  publisher: { sourceType: "peer-reviewed-paper", reliabilityTier: "peer-reviewed" },
};

export const CATEGORY_APPROVED_AT = "2026-10-30T00:00:00Z";
export const CATEGORY_LICENSE = "CITATION-ONLY-FACTS";

/** A TrustedSourceDomain for a category match: citation-only, the review being the category approval of 2026-10-30. */
export function categoryPublisher(url: string): TrustedSourceDomain | null {
  const match = matchSourceCategory(url);
  if (!match) return null;
  const tier = CATEGORY_TIER[match.category];
  return {
    domain: match.publisherDomain,
    publisher: `${CATEGORY_LABEL[match.category]} (${match.publisherDomain})`,
    license: CATEGORY_LICENSE,
    licenseUrl: `https://${match.publisherDomain}/`,
    reviewedAt: CATEGORY_APPROVED_AT,
    restrictions: `Admitted by category (${match.category}, rule ${match.rule}) on the owner's decision of 2026-10-30. Citation only: independently written facts may rest on its pages; its prose, tables, figures and images are not copied, translated, closely paraphrased or adapted. Paywalled pages with no extractable text are skipped.`,
    useMode: "citation-only",
    sourceType: tier.sourceType,
    reliabilityTier: tier.reliabilityTier,
  };
}

/**
 * The lookup the AIL Hubpedia pipeline uses: the 14 individually reviewed publishers first (commercial reuse, unchanged),
 * then category publishers (citation only). ncbi.nlm.nih.gov is forced to citation only.
 */
export function findAilSourcePublisher(url: string): TrustedSourceDomain | null {
  const p = parts(url);
  if (!p) return null;
  if (NEVER_SOURCE.some((entry) => hostMatches(p.host, entry))) return null;
  if (CITATION_ONLY_OVERRIDES.some((entry) => hostMatches(p.host, entry))) return categoryPublisher(url);
  return findTrustedSourceDomain(url) ?? categoryPublisher(url);
}
