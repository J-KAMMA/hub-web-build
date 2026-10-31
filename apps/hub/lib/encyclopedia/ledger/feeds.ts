import { assessEvidenceUse } from "../source-license-policy";
import { findTrustedSourceDomain, trustedSourceMetadata, type TrustedSourceDomain } from "../trusted-source-domains";

/*
 * Feed definitions for the Hubpedia ledger (docs/hubpedia-ledger.md section 2).
 *
 * A feed names a publisher, how its pages are found, and which pages it never
 * yields. It does not carry a licence: the licence is whatever the publisher
 * review in trusted-source-domains.ts says, looked up for every URL at ingest
 * time. A feed whose publisher has no review record does not run, and a URL
 * that the evidence policy does not admit is never stored.
 */

export type LedgerFeedDiscovery =
  | {
      type: "sitemap";
      url: string;
      /** A path must match one of these to be fetched. */
      include: readonly RegExp[];
      /** ...and none of these. */
      exclude: readonly RegExp[];
    }
  | { type: "urls"; urls: readonly string[] }
  | { type: "openalex"; filter: string };

export interface LedgerFeed {
  id: string;
  label: string;
  /** Host (or parent domain) every page of the feed must belong to, before and after redirects. */
  publisherDomain: string;
  sourceType: string;
  reliabilityTier: string;
  /** Days until a fetched page is due to be fetched again. */
  recheckDays: number;
  discovery: LedgerFeedDiscovery;
  /** What is taken and what is left out, in the reviewer's words. Informational. */
  takes: string;
  leavesOut: string;
  /** "awaiting-review" feeds never run until the publisher review is written and a person changes the status. */
  status: "enabled" | "awaiting-review";
}

/* Pages of ourworldindata.org that are navigation, tooling or organisation pages, not prose. */
const OWID_NON_CONTENT = /^\/(?:grapher|explorers|charts|data|data-insights|search|about|faqs|donate|jobs|team|funding|privacy-policy|latest|subscribe|feedback|youtube|podcast|teaching|owid-grapher|covid-vaccinations|coronavirus-data-explorer|energy|co2-and-greenhouse-gas-emissions-explorer|[^/]*-data-explorer)(?:\/|$)/u;

export const LEDGER_FEEDS: readonly LedgerFeed[] = [
  {
    id: "owid",
    label: "Our World in Data",
    publisherDomain: "ourworldindata.org",
    sourceType: "research-institute",
    reliabilityTier: "trusted-secondary",
    recheckDays: 90,
    discovery: {
      type: "sitemap",
      url: "https://ourworldindata.org/sitemap.xml",
      // Topic pages and explainer articles live at a single path segment.
      include: [/^\/[a-z0-9][a-z0-9-]*$/u],
      exclude: [OWID_NON_CONTENT],
    },
    takes: "Topic pages and explainer articles (CC-BY-4.0, reviewed).",
    leavesOut: "Chart data rows and notes on third-party data. /grapher/ pages are never fetched.",
    status: "enabled",
  },
  {
    id: "us-gov-statistics",
    label: "US government statistics (reviewed .gov publishers)",
    publisherDomain: "bls.gov",
    sourceType: "statistics",
    reliabilityTier: "official",
    recheckDays: 90,
    // BLS publishes no usable sitemap of explanatory pages, so the seeds are listed by hand.
    // Add a page here only when it is prose (a methods or explainer page), not a table.
    discovery: {
      type: "urls",
      urls: [
        "https://www.bls.gov/cpi/questions-and-answers.htm",
        "https://www.bls.gov/cps/cps_htgm.htm",
        "https://www.bls.gov/ces/publications/highlights.htm",
      ],
    },
    takes: "Explanatory and release text of reviewed .gov statistics publishers.",
    leavesOut: "Pages that are only tables.",
    status: "enabled",
  },
  {
    id: "openalex",
    label: "OpenAlex",
    publisherDomain: "openalex.org",
    sourceType: "paper",
    reliabilityTier: "scholarly",
    recheckDays: 365,
    discovery: { type: "openalex", filter: "open_access.is_oa:true,has_abstract:true" },
    takes: "Bibliographic metadata (CC0). The abstract only when the work's own open-access licence is CC-BY, CC0 or public domain.",
    leavesOut: "Abstracts under any other licence.",
    status: "awaiting-review",
  },
  {
    id: "jp-gov-statistics",
    label: "Japanese government statistics (e-Stat, Statistics Bureau)",
    publisherDomain: "e-stat.go.jp",
    sourceType: "statistics",
    reliabilityTier: "official",
    recheckDays: 90,
    // Seeds are set when the publisher review is written; until then the feed does not run.
    discovery: { type: "urls", urls: [] },
    takes: "Explanatory text under the Government Standard Terms of Use 2.0.",
    leavesOut: "Individual-level data and third-party figures and tables.",
    status: "awaiting-review",
  },
];

export function getLedgerFeed(id: string) {
  return LEDGER_FEEDS.find((feed) => feed.id === id) ?? null;
}

export type TrustedLookup = (url: string) => TrustedSourceDomain | null;

export type LedgerAdmission =
  | { admitted: true; trusted: TrustedSourceDomain; license: string; metadata: Record<string, unknown>; priority: number }
  | { admitted: false; reason: string };

function hostIn(url: string, domain: string) {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return host === domain || host.endsWith(`.${domain}`);
}

/**
 * Decides whether one URL of a feed may become a stored source. The publisher
 * must have a review record, and the resulting source must pass
 * assessEvidenceUse, the same test the claims gate uses. Nothing is stored for
 * a URL that fails either.
 */
export function admitLedgerUrl(
  feed: LedgerFeed,
  url: string,
  lookup: TrustedLookup = findTrustedSourceDomain,
  /** A work-level licence (OpenAlex abstracts): replaces the publisher licence for this one source. */
  workLicense?: { license: string; licenseUrl: string },
): LedgerAdmission {
  if (feed.status !== "enabled") return { admitted: false, reason: "feed-awaiting-review" };
  if (!hostIn(url, feed.publisherDomain)) return { admitted: false, reason: "outside-feed-publisher" };
  const trusted = lookup(url);
  if (!trusted) return { admitted: false, reason: "publisher-not-reviewed" };
  const base = trustedSourceMetadata(trusted, `Ledger feed ${feed.id}.`);
  const metadata = workLicense ? { ...base, commercialReuse: { ...base.commercialReuse, licenseUrl: workLicense.licenseUrl } } : base;
  const license = workLicense?.license ?? trusted.license;
  const decision = assessEvidenceUse({
    license,
    url,
    sourceType: feed.sourceType,
    reliabilityTier: feed.reliabilityTier,
    metadata,
  });
  if (!decision.allowed) return { admitted: false, reason: `evidence-use-${decision.reason}` };
  return { admitted: true, trusted, license, metadata, priority: decision.priority };
}
