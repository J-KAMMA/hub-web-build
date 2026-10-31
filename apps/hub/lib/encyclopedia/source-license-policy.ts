export const COMMERCIAL_REUSE_LICENSES = [
  "CC0-1.0",
  "CC-BY-2.0",
  "CC-BY-2.5",
  "CC-BY-3.0",
  "CC-BY-4.0",
  "PUBLIC-DOMAIN",
  "US-GOV-PUBLIC-DOMAIN",
] as const;

type SourceLicenseInput = {
  license?: string | null;
  url?: string | null;
  sourceType?: string | null;
  reliabilityTier?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type CommercialReuseDecision =
  | { allowed: true; license: string; licenseUrl: string; reviewedAt: string }
  | { allowed: false; reason: "license-missing" | "license-not-allowed" | "review-missing" | "license-url-missing" };

export type EvidenceUseDecision =
  | { allowed: true; mode: "adaptation" | "citation-only"; priority: number; reviewedAt: string }
  | { allowed: false; mode: "discovery-only" | "rejected"; reason: "wikipedia-gateway" | "fandom-license-review-required" | "fandom-non-wiki-content" | "per-asset-license-required" | "noncommercial-site" | "review-missing" | "reliability-tier-not-allowed" };

export type SourceSiteKind = "wikidata" | "wikipedia" | "wikimedia-commons" | "fandom-wiki" | "fandom-community" | "openstax" | "government-japan" | "world-bank" | "other";

const CITATION_RELIABILITY_TIERS = new Set([
  "official",
  "primary",
  "authoritative",
  "peer-reviewed",
  "scholarly",
  "trusted-secondary",
]);

const SOURCE_TYPE_PRIORITY: Record<string, number> = {
  government: 100,
  law: 100,
  statistics: 98,
  "official-record": 96,
  "peer-reviewed-paper": 94,
  paper: 90,
  university: 88,
  "research-institute": 88,
  standard: 85,
  "official-organization": 82,
  book: 72,
  news: 65,
  web: 50,
};

export function isWikipediaResearchGateway(source: { url?: string | null }) {
  if (!source.url) return false;
  try {
    const hostname = new URL(source.url).hostname.toLowerCase();
    return hostname === "wikipedia.org" || hostname.endsWith(".wikipedia.org");
  } catch {
    return false;
  }
}

export function sourceSiteKind(source: { url?: string | null }): SourceSiteKind {
  if (!source.url) return "other";
  try {
    const url = new URL(source.url), host = url.hostname.toLowerCase();
    if (host === "www.wikidata.org" || host === "wikidata.org") return "wikidata";
    if (host === "wikipedia.org" || host.endsWith(".wikipedia.org")) return "wikipedia";
    if (host === "commons.wikimedia.org") return "wikimedia-commons";
    if (host === "community.fandom.com" && /\/(?:f|wiki\/Forum|wiki\/Thread|wiki\/Message_Wall):?/iu.test(url.pathname)) return "fandom-community";
    if (host === "fandom.com" || host.endsWith(".fandom.com")) return "fandom-wiki";
    if (host === "openstax.org" || host.endsWith(".openstax.org")) return "openstax";
    if (host === "gov-online.go.jp" || host.endsWith(".gov-online.go.jp") || host.endsWith(".go.jp")) return "government-japan";
    if (host === "worldbank.org" || host.endsWith(".worldbank.org")) return "world-bank";
    return "other";
  } catch { return "other"; }
}

function reviewedObject(metadata: Record<string, unknown> | null | undefined, key: string) {
  const value = metadata?.[key];
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function normalizedLicense(value: string) {
  return value.trim().toUpperCase().replace(/[ _]+/g, "-");
}

export function assessCommercialReuse(source: SourceLicenseInput): CommercialReuseDecision {
  if (!source.license?.trim()) return { allowed: false, reason: "license-missing" };
  const license = normalizedLicense(source.license);
  if (!(COMMERCIAL_REUSE_LICENSES as readonly string[]).includes(license)) {
    return { allowed: false, reason: "license-not-allowed" };
  }

  const review = source.metadata?.commercialReuse;
  if (!review || typeof review !== "object" || Array.isArray(review)) {
    return { allowed: false, reason: "review-missing" };
  }
  const fields = review as Record<string, unknown>;
  if (fields.approved !== true || typeof fields.reviewedAt !== "string" || !Number.isFinite(Date.parse(fields.reviewedAt))) {
    return { allowed: false, reason: "review-missing" };
  }
  if (typeof fields.licenseUrl !== "string" || !fields.licenseUrl.startsWith("https://")) {
    return { allowed: false, reason: "license-url-missing" };
  }
  return { allowed: true, license, licenseUrl: fields.licenseUrl, reviewedAt: fields.reviewedAt };
}

export function isCommerciallyReusableSource(source: SourceLicenseInput) {
  return assessCommercialReuse(source).allowed;
}

export function assessEvidenceUse(source: SourceLicenseInput): EvidenceUseDecision {
  const site = sourceSiteKind(source);
  if (site === "wikipedia") {
    return { allowed: false, mode: "discovery-only", reason: "wikipedia-gateway" };
  }
  if (site === "fandom-community") return { allowed: false, mode: "rejected", reason: "fandom-non-wiki-content" };
  if (site === "openstax" && /(?:CC[- ]BY[- ]NC|NONCOMMERCIAL)/iu.test(source.license ?? "")) return { allowed: false, mode: "rejected", reason: "noncommercial-site" };
  if (site === "wikimedia-commons") {
    const asset = reviewedObject(source.metadata, "assetLicense");
    if (asset?.approved !== true || typeof asset.reviewedAt !== "string") return { allowed: false, mode: "rejected", reason: "per-asset-license-required" };
  }
  if (site === "fandom-wiki") {
    const wiki = reviewedObject(source.metadata, "fandomWikiLicense");
    if (wiki?.approved !== true || typeof wiki.reviewedAt !== "string" || !Number.isFinite(Date.parse(wiki.reviewedAt)) || !/CC[- ]BY[- ]SA[- ]3\.0/iu.test(String(wiki.license ?? source.license ?? ""))) {
      return { allowed: false, mode: "discovery-only", reason: "fandom-license-review-required" };
    }
    const tier = source.reliabilityTier?.trim().toLowerCase() ?? "";
    if (!CITATION_RELIABILITY_TIERS.has(tier)) return { allowed: false, mode: "rejected", reason: "reliability-tier-not-allowed" };
    return { allowed: true, mode: "citation-only", priority: Math.min(55, sourcePriority(source)), reviewedAt: wiki.reviewedAt };
  }
  const reusable = assessCommercialReuse(source);
  if (reusable.allowed) {
    return { allowed: true, mode: "adaptation", priority: sourcePriority(source), reviewedAt: reusable.reviewedAt };
  }
  const review = source.metadata?.citationUse;
  if (!review || typeof review !== "object" || Array.isArray(review)) {
    return { allowed: false, mode: "rejected", reason: "review-missing" };
  }
  const fields = review as Record<string, unknown>;
  if (fields.approved !== true || typeof fields.reviewedAt !== "string" || !Number.isFinite(Date.parse(fields.reviewedAt))) {
    return { allowed: false, mode: "rejected", reason: "review-missing" };
  }
  const tier = source.reliabilityTier?.trim().toLowerCase() ?? "";
  if (!CITATION_RELIABILITY_TIERS.has(tier)) {
    return { allowed: false, mode: "rejected", reason: "reliability-tier-not-allowed" };
  }
  return { allowed: true, mode: "citation-only", priority: sourcePriority(source), reviewedAt: fields.reviewedAt };
}

export function sourcePriority(source: Pick<SourceLicenseInput, "sourceType" | "reliabilityTier">) {
  const type = source.sourceType?.trim().toLowerCase() ?? "web";
  const tier = source.reliabilityTier?.trim().toLowerCase() ?? "";
  const tierBonus = tier === "official" || tier === "primary" ? 10 : tier === "peer-reviewed" ? 8 : tier === "scholarly" ? 5 : 0;
  return Math.min(100, (SOURCE_TYPE_PRIORITY[type] ?? SOURCE_TYPE_PRIORITY.web) + tierBonus);
}

export function isPublishableEvidenceSource(source: SourceLicenseInput) {
  return assessEvidenceUse(source).allowed;
}

type DisplaySource = SourceLicenseInput & { url: string; title: string };

function escapeMarkdownLabel(value: string) {
  return value.replace(/[\[\]\\]/g, "\\$&");
}

export function keepCommerciallyReusableSources<T extends DisplaySource>(sources: readonly T[]) {
  return sources.filter(isPublishableEvidenceSource);
}

/* The markers in a sourced body are claim numbers, not source numbers: the
 * factory verifies each sentence against an individually numbered claim, and
 * a rich page can yield a hundred of them. Printed beside a two-item source
 * list they read as broken references — a reader who follows [12] finds
 * nothing to follow. claimSourceUrls maps each claim to the source it quotes,
 * which lets the markers be rewritten to positions in the list actually shown.
 * Several claims from one source collapse onto one number, which is what a
 * reference mark is supposed to mean. Provenance keeps the claim-level detail;
 * only the display is renumbered. */
function renumberClaimCitations(markdown: string, claimSourceUrls: ReadonlyMap<number, string>, approvedUrls: readonly string[]) {
  const positionByUrl = new Map(approvedUrls.map((url, index) => [url, index + 1]));
  /* An escaped bracket came out of the article's own prose — a digest length,
   * a parameter list such as KECCAK-p[b, nr] — and is not a citation. Only the
   * renderer appends unescaped markers, so the preceding character decides. */
  return markdown.replace(/(?:\[\d+\])+/gu, (run) => {
    const positions = [...new Set([...run.matchAll(/\[(\d+)\]/gu)]
      .map((match) => positionByUrl.get(claimSourceUrls.get(Number(match[1])) ?? ""))
      .filter((position): position is number => position !== undefined))]
      .sort((left, right) => left - right);
    return positions.map((position) => `[${position}]`).join("");
  });
}

export function renderCommercialSourceSection(
  markdown: string,
  sources: readonly DisplaySource[],
  claimSourceUrls?: ReadonlyMap<number, string>,
) {
  const withoutSources = markdown
    .replace(/\n*##\s+(?:出典|出典候補)\s*\n[\s\S]*$/u, "")
    .trim();
  const approved = keepCommerciallyReusableSources(sources);
  if (approved.length === 0) return withoutSources.replace(/\s*(?:\[\d+\])+/gu, "");
  const body = claimSourceUrls
    ? renumberClaimCitations(withoutSources, claimSourceUrls, approved.map((source) => source.url))
    : withoutSources;
  return [
    body,
    "",
    "## 出典",
    "",
    ...approved.map((source, index) => `${index + 1}. [${escapeMarkdownLabel(source.title)}](${source.url})`),
  ].join("\n");
}
