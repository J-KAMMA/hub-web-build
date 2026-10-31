/*
 * Publishers whose reuse terms have been read and recorded, so a plan can be
 * built without repeating the review for every URL. The determination is made
 * per publisher, because that is the level at which the policy is written —
 * not per page.
 *
 * Every entry here permits commercial reuse, which Hubpedia needs because its
 * article pages carry advertising. Each also restricts logos, insignia, and
 * personnel likenesses, and forbids implying that the agency endorses anything.
 * The factory satisfies those conditions by construction: it takes only facts
 * from body text and never images, marks, or names of staff. If that ever
 * changes, this table must be reviewed again before the next run.
 *
 * Adding a publisher is a human step. Read its policy, record the URL of the
 * page you read, and note what it restricts.
 */

export interface TrustedSourceDomain {
  /** Hostname or parent domain. A host matches when it equals this or ends with "." + this. */
  domain: string;
  publisher: string;
  /** SPDX-style identifier understood by source-license-policy. */
  license: string;
  /** The policy page that was read. */
  licenseUrl: string;
  /** Date the policy was read, ISO 8601. */
  reviewedAt: string;
  /** What the policy restricts, in the reviewer's words. */
  restrictions: string;
  /** Default "adaptation" (commercial reuse). "citation-only" entries come from the category rules (source-categories.ts). */
  useMode?: "adaptation" | "citation-only";
  /** Category entries carry their own source type and tier; the individually reviewed publishers leave them to the caller. */
  sourceType?: string;
  reliabilityTier?: string;
}

export const TRUSTED_SOURCE_DOMAINS: readonly TrustedSourceDomain[] = [
  {
    domain: "nasa.gov",
    publisher: "NASA",
    license: "US-GOV-PUBLIC-DOMAIN",
    licenseUrl: "https://www.nasa.gov/nasa-brand-center/images-and-media/",
    reviewedAt: "2026-08-28T00:00:00Z",
    restrictions: "Text is public domain and usable commercially. Logos and insignia need clearance for promotional use; content must not imply NASA endorses a product or service; third-party copyrighted images and staff likenesses are excluded.",
  },
  {
    domain: "usgs.gov",
    publisher: "U.S. Geological Survey",
    license: "US-GOV-PUBLIC-DOMAIN",
    licenseUrl: "https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits",
    reviewedAt: "2026-08-28T00:00:00Z",
    restrictions: "USGS-authored material is public domain and usable commercially; credit is requested. The USGS identifier is trademarked. Non-USGS photographs and graphics on the site are excluded.",
  },
  {
    domain: "genome.gov",
    publisher: "National Human Genome Research Institute",
    license: "US-GOV-PUBLIC-DOMAIN",
    licenseUrl: "https://www.genome.gov/about-nhgri/Policies-Guidance/Copyright",
    reviewedAt: "2026-08-28T00:00:00Z",
    restrictions: "Text is public domain unless marked otherwise; acknowledgement and a link back are requested. Material carrying a credit line did not originate at NHGRI and is excluded.",
  },
  {
    domain: "noaa.gov",
    publisher: "National Oceanic and Atmospheric Administration",
    license: "US-GOV-PUBLIC-DOMAIN",
    licenseUrl: "https://www.noaa.gov/information-technology/disclaimer",
    reviewedAt: "2026-08-28T00:00:00Z",
    restrictions: "US Government work, public domain. Agency marks are not licensed and endorsement must not be implied.",
  },
  {
    domain: "nih.gov",
    publisher: "National Institutes of Health",
    license: "US-GOV-PUBLIC-DOMAIN",
    licenseUrl: "https://www.nih.gov/web-policies-notices",
    reviewedAt: "2026-08-28T00:00:00Z",
    restrictions: "US Government work, public domain. NIH marks are not licensed, endorsement must not be implied, and third-party copyrighted material carries its own notice.",
  },
  {
    domain: "nist.gov",
    publisher: "National Institute of Standards and Technology",
    license: "US-GOV-PUBLIC-DOMAIN",
    licenseUrl: "https://www.nist.gov/oism/copyrights",
    reviewedAt: "2026-08-28T00:00:00Z",
    restrictions: "Public information that may be distributed or copied, with the stated exception of material marked as copyrighted; credits are requested. Individual pages may carry their own terms, so a page marked copyrighted is excluded.",
  },
  {
    domain: "nps.gov",
    publisher: "National Park Service",
    license: "US-GOV-PUBLIC-DOMAIN",
    licenseUrl: "https://www.nps.gov/aboutus/disclaimer.htm",
    reviewedAt: "2026-08-28T00:00:00Z",
    restrictions: "NPS-created material is public domain, and commercial republication must reference the original US Government work — the citation is required, not merely requested. Third-party copyrighted material is excluded, and the Arrowhead symbol needs written permission.",
  },
  {
    domain: "weather.gov",
    publisher: "National Weather Service",
    license: "US-GOV-PUBLIC-DOMAIN",
    licenseUrl: "https://www.weather.gov/disclaimer",
    reviewedAt: "2026-08-28T00:00:00Z",
    restrictions: "Public domain and usable for any lawful purpose. The NWS name and visual identifiers are trademarked, must not imply endorsement or affiliation, and modified content must not be presented as official.",
  },
  {
    domain: "federalreserve.gov",
    publisher: "Board of Governors of the Federal Reserve System",
    license: "US-GOV-PUBLIC-DOMAIN",
    licenseUrl: "https://www.federalreserve.gov/disclaimer.htm",
    reviewedAt: "2026-08-28T00:00:00Z",
    restrictions: "Public domain unless marked otherwise and copyable without permission, with a request to cite the Board. Board seals, logos, and official insignia are protected by federal law and need written permission. Material identified with a non-Board source is excluded.",
  },
  {
    /* CC0 for NARA's own work — the least restrictive terms in this table.
     * The caveat is about holdings rather than authorship: records NARA
     * merely holds can carry third-party copyright, so only pages NARA
     * itself wrote are used. */
    domain: "archives.gov",
    publisher: "National Archives and Records Administration",
    license: "CC0-1.0",
    licenseUrl: "https://www.archives.gov/research/still-pictures/permissions",
    reviewedAt: "2026-08-28T00:00:00Z",
    restrictions: "Works produced by NARA are public domain and offered under CC0 1.0 for worldwide reuse. Records merely held by NARA — especially special media — may carry third-party copyright, publicity rights, or deed restrictions, and NARA does not confirm the status of any item. Only NARA-authored explanatory pages are used.",
  },
  {
    domain: "bls.gov",
    publisher: "U.S. Bureau of Labor Statistics",
    license: "US-GOV-PUBLIC-DOMAIN",
    licenseUrl: "https://www.bls.gov/opub/copyright-information.htm",
    reviewedAt: "2026-08-28T00:00:00Z",
    restrictions: "Text, charts, and tables are public domain and may be reproduced without permission, with appropriate credit. Photographs are licensed from Getty and Shutterstock and are excluded — the factory takes body text only, so this does not arise.",
  },
  {
    domain: "gao.gov",
    publisher: "U.S. Government Accountability Office",
    license: "US-GOV-PUBLIC-DOMAIN",
    licenseUrl: "https://www.gao.gov/copyright",
    reviewedAt: "2026-08-28T00:00:00Z",
    restrictions: "Products are not protected by copyright and may be copied and distributed in their entirety without permission. Embedded images and other third-party material may be copyrighted separately, and photographs of recognisable people carry privacy and publicity rights — neither of which the factory touches, since it takes body text only.",
  },
  {
    domain: "irs.gov",
    publisher: "Internal Revenue Service",
    license: "US-GOV-PUBLIC-DOMAIN",
    licenseUrl: "https://www.irs.gov/about-irs/use-of-content-from-irsgov",
    reviewedAt: "2026-08-28T00:00:00Z",
    restrictions: "Content created by federal employees in the course of their duties is not subject to copyright and may be freely copied; credit is requested. Copyrighted material appearing on or linked from the site needs the holder's permission, and the IRS seal and logo have their own rules.",
  },
  {
    /* The one non-government entry, and the one whose licence has conditions
     * that bind the article rather than merely the images: CC BY requires the
     * credit to travel with the text. renderCommercialSourceSection already
     * emits a linked citation for every source, which is what satisfies it. */
    domain: "ourworldindata.org",
    publisher: "Our World in Data",
    license: "CC-BY-4.0",
    licenseUrl: "https://ourworldindata.org/faqs",
    reviewedAt: "2026-08-28T00:00:00Z",
    restrictions: "Original writing is CC BY 4.0: commercial reuse is permitted with credit and a link back. Third-party data and charts (WHO, World Bank, UN, and others) keep their providers' licences and are not covered, so take only Our World in Data's own prose. The name and logo must not imply endorsement.",
  },
  {
    /* Research articles, not reference pages: useful where a subject needs a
     * primary study rather than an overview, and unusable as a general pool
     * because a single paper is about its own finding, not about the topic. */
    domain: "plos.org",
    publisher: "PLOS",
    license: "CC-BY-4.0",
    licenseUrl: "https://plos.org/open-access/",
    reviewedAt: "2026-08-28T00:00:00Z",
    restrictions: "All research articles are CC BY: commercial reuse with attribution. Figures and third-party material inside an article may carry their own terms, so take the authors' prose only.",
  },
];

/*
 * Reviewed and deliberately excluded. Recorded so the same page is not
 * re-reviewed hopefully every few weeks, and so the reason survives.
 */
export const REVIEWED_AND_EXCLUDED_DOMAINS: ReadonlyArray<{ domain: string; reviewedAt: string; reason: string }> = [
  {
    domain: "medlineplus.gov",
    reviewedAt: "2026-08-28T00:00:00Z",
    reason: "Mixed rights on the same site. Health topic summaries are public domain, but the A.D.A.M. Medical Encyclopedia, the ASHP drug monographs, and most images are licensed from third parties and cannot be reused commercially. Nothing in the page markup tells the two apart, so a per-page determination cannot be made mechanically.",
  },
  {
    domain: "wikipedia.org",
    reviewedAt: "2026-08-28T00:00:00Z",
    reason: "CC BY-SA: commercial reuse is permitted but share-alike would place the article under the same licence. source-license-policy already treats it as a discovery gateway, never as evidence.",
  },
  {
    domain: "epa.gov",
    reviewedAt: "2026-08-28T00:00:00Z",
    reason: "Its own pages say EPA-produced data is public domain under 17 U.S.C. 105, and also that \"commercial use of the documents available from the EPA websites may be protected under the U.S. and Foreign Copyright Laws\" and that documents may be used for non-commercial purposes. Two readings of the same site, one of which forbids what these articles do. Excluded until the contradiction is resolved rather than resolved in our own favour.",
  },
  {
    domain: "openstax.org",
    reviewedAt: "2026-08-28T00:00:00Z",
    reason: "CC BY-NC-SA. Non-commercial: the articles carry advertising, so this is not usable however good the textbooks are. Commercial use needs a written request to OpenStax.",
  },
  {
    domain: "pmc.ncbi.nlm.nih.gov",
    reviewedAt: "2026-08-28T00:00:00Z",
    reason: "The Open Access Subset mixes licences per article — some CC BY or CC0, others CC BY-NC — and PMC states that licence terms vary and each article must be checked. A per-publisher determination is therefore wrong here; revisit if a machine-readable per-article licence field is confirmed, since the CC BY portion alone would be a large pool.",
  },
];

function hostMatches(host: string, domain: string) {
  return host === domain || host.endsWith(`.${domain}`);
}

/*
 * An excluded domain wins over a trusted one, so that a subdomain of a
 * trusted publisher cannot slip through on the parent's review:
 * medlineplus.gov sits under nih.gov but carries third-party licensed
 * content the parent policy does not cover.
 */
export function findTrustedSourceDomain(url: string): TrustedSourceDomain | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (REVIEWED_AND_EXCLUDED_DOMAINS.some((entry) => hostMatches(host, entry.domain))) return null;
  return TRUSTED_SOURCE_DOMAINS.find((entry) => hostMatches(host, entry.domain)) ?? null;
}

/** The source-plan metadata a reviewed publisher licence produces. */
export function trustedSourceMetadata(entry: TrustedSourceDomain, notes: string) {
  if (entry.useMode === "citation-only") {
    return {
      citationUse: { approved: true, reviewedAt: entry.reviewedAt, licenseUrl: entry.licenseUrl },
      notes: `${notes} Category publisher, citation only (${entry.reviewedAt.slice(0, 10)}): ${entry.restrictions}`,
    };
  }
  return {
    commercialReuse: { approved: true, reviewedAt: entry.reviewedAt, licenseUrl: entry.licenseUrl },
    notes: `${notes} Publisher policy read ${entry.reviewedAt.slice(0, 10)}: ${entry.restrictions} The factory takes body text only — no images, marks, or likenesses.`,
  };
}
