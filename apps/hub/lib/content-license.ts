/**
 * Content licenses for Hub works (docs/hub-copyright/PLAN.md section 7).
 * Pure module: no server-only imports, so forms, pages and the desktop client can share it.
 * apps/music keeps its own copy of the id list (it is a separate service).
 */

export const CONTENT_LICENSE_IDS = [
  "arr",
  "cc-by-4.0",
  "cc-by-sa-4.0",
  "cc-by-nc-4.0",
  "cc-by-nc-sa-4.0",
  "cc-by-nd-4.0",
  "cc-by-nc-nd-4.0",
  "cc0-1.0",
] as const;

export type ContentLicenseId = (typeof CONTENT_LICENSE_IDS)[number];

/** All rights reserved is the default for every work. */
export const DEFAULT_CONTENT_LICENSE: ContentLicenseId = "arr";

/** Targets that may carry a license row. Images belong to their post. */
export const CONTENT_LICENSE_TARGET_TYPES = ["post", "article"] as const;
export type ContentLicenseTargetType = (typeof CONTENT_LICENSE_TARGET_TYPES)[number];

type LicenseInfo = {
  /** Short label shown next to a work, e.g. "CC BY 4.0". */
  label: string;
  /** Plain Japanese name used in the picker. */
  ja: string;
  en: string;
  /** Path under https://creativecommons.org/ ; null for all rights reserved. */
  deedPath: string | null;
};

const INFO: Record<ContentLicenseId, LicenseInfo> = {
  arr: { label: "All rights reserved", ja: "全権利留保（無断転載禁止）", en: "All rights reserved", deedPath: null },
  "cc-by-4.0": { label: "CC BY 4.0", ja: "CC BY 4.0（表示）", en: "CC BY 4.0 (attribution)", deedPath: "licenses/by/4.0/" },
  "cc-by-sa-4.0": { label: "CC BY-SA 4.0", ja: "CC BY-SA 4.0（表示・継承）", en: "CC BY-SA 4.0 (attribution, share-alike)", deedPath: "licenses/by-sa/4.0/" },
  "cc-by-nc-4.0": { label: "CC BY-NC 4.0", ja: "CC BY-NC 4.0（表示・非営利）", en: "CC BY-NC 4.0 (attribution, non-commercial)", deedPath: "licenses/by-nc/4.0/" },
  "cc-by-nc-sa-4.0": { label: "CC BY-NC-SA 4.0", ja: "CC BY-NC-SA 4.0（表示・非営利・継承）", en: "CC BY-NC-SA 4.0 (attribution, non-commercial, share-alike)", deedPath: "licenses/by-nc-sa/4.0/" },
  "cc-by-nd-4.0": { label: "CC BY-ND 4.0", ja: "CC BY-ND 4.0（表示・改変禁止）", en: "CC BY-ND 4.0 (attribution, no derivatives)", deedPath: "licenses/by-nd/4.0/" },
  "cc-by-nc-nd-4.0": { label: "CC BY-NC-ND 4.0", ja: "CC BY-NC-ND 4.0（表示・非営利・改変禁止）", en: "CC BY-NC-ND 4.0 (attribution, non-commercial, no derivatives)", deedPath: "licenses/by-nc-nd/4.0/" },
  "cc0-1.0": { label: "CC0 1.0", ja: "CC0 1.0（パブリックドメイン提供）", en: "CC0 1.0 (public domain dedication)", deedPath: "publicdomain/zero/1.0/" },
};

export function isContentLicenseId(value: unknown): value is ContentLicenseId {
  return typeof value === "string" && (CONTENT_LICENSE_IDS as readonly string[]).includes(value);
}

/**
 * Normalize caller input. Missing (undefined, null, empty string) means the default;
 * anything else must be exactly one of the 8 ids. Returns null for an unknown value so the
 * caller can answer 400. Case and spacing are NOT forgiven: a typo must not silently
 * become a more permissive license.
 */
export function normalizeContentLicense(value: unknown): ContentLicenseId | null {
  if (value === undefined || value === null || value === "") return DEFAULT_CONTENT_LICENSE;
  return isContentLicenseId(value) ? value : null;
}

export function isCreativeCommonsLicense(id: ContentLicenseId): boolean {
  return id !== "arr";
}

/**
 * Gated content (Hub token gates, Vault) may only be all rights reserved.
 * Every CC license, CC0 included, lets anyone redistribute, which defeats a gate.
 */
export function isGateCompatibleLicense(id: ContentLicenseId): boolean {
  return id === "arr";
}

export function contentLicenseLabel(id: ContentLicenseId): string {
  return INFO[id].label;
}

export function contentLicenseName(id: ContentLicenseId, japanese = true): string {
  return japanese ? INFO[id].ja : INFO[id].en;
}

/** Official deed page, or null for all rights reserved. */
export function contentLicenseDeedUrl(id: ContentLicenseId, japanese = true): string | null {
  const path = INFO[id].deedPath;
  if (!path) return null;
  return `https://creativecommons.org/${path}${japanese ? "deed.ja" : "deed.en"}`;
}

/** Machine-readable license URL (no deed suffix), used in ActivityPub `license`. */
export function contentLicenseUrl(id: ContentLicenseId): string | null {
  const path = INFO[id].deedPath;
  return path ? `https://creativecommons.org/${path}` : null;
}

export type ContentLicenseNotice = {
  id: ContentLicenseId;
  /** One calm line. */
  text: string;
  /** Deed link, or null for all rights reserved. */
  href: string | null;
  linkLabel: string | null;
};

/** The line shown under a work: "License: CC BY 4.0" or "(c) author, all rights reserved". */
export function contentLicenseNotice(id: ContentLicenseId, authorName: string | null | undefined, japanese = true): ContentLicenseNotice {
  const author = (authorName ?? "").trim();
  if (id === "arr") {
    return {
      id,
      text: japanese ? `© ${author || "作者"}　無断転載禁止` : `© ${author || "the author"}. All rights reserved.`,
      href: null,
      linkLabel: null,
    };
  }
  return {
    id,
    text: japanese ? "ライセンス：" : "License: ",
    href: contentLicenseDeedUrl(id, japanese),
    linkLabel: INFO[id].label,
  };
}

/* ---- Hubpedia (PLAN section 7.3) ---- */

/** The license of every Hubpedia article body. One license for the whole encyclopedia, not a user choice. */
export const HUBPEDIA_ARTICLE_LICENSE: ContentLicenseId = "cc-by-sa-4.0";

/**
 * Whether a Hub user's work, used as a Hubpedia source, carries `commercialReuse.approved`.
 * Only CC BY, CC BY-SA and CC0: NC forbids commercial use and ND forbids adaptation.
 * All rights reserved may still be cited, but its text and images are not copied.
 */
export function isCommercialReuseApprovedLicense(id: ContentLicenseId): boolean {
  return id === "cc-by-4.0" || id === "cc-by-sa-4.0" || id === "cc0-1.0";
}

export type HubWorkCommercialReuse = {
  approved: boolean;
  /** SPDX-style id for the source record, e.g. "CC-BY-4.0". */
  license: string;
  licenseUrl: string | null;
};

const SPDX: Record<ContentLicenseId, string> = {
  arr: "all-rights-reserved",
  "cc-by-4.0": "CC-BY-4.0",
  "cc-by-sa-4.0": "CC-BY-SA-4.0",
  "cc-by-nc-4.0": "CC-BY-NC-4.0",
  "cc-by-nc-sa-4.0": "CC-BY-NC-SA-4.0",
  "cc-by-nd-4.0": "CC-BY-ND-4.0",
  "cc-by-nc-nd-4.0": "CC-BY-NC-ND-4.0",
  "cc0-1.0": "CC0-1.0",
};

/** The `commercialReuse` block for a Hubpedia source that points at a Hub user's work. */
export function hubWorkCommercialReuse(id: ContentLicenseId): HubWorkCommercialReuse {
  return { approved: isCommercialReuseApprovedLicense(id), license: SPDX[id], licenseUrl: contentLicenseUrl(id) };
}
