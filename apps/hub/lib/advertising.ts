const ADSENSE_CLIENT_ID = /^ca-pub-\d+$/;
const ADSENSE_SLOT_ID = /^\d+$/;
const ADSENSE_FORMATS = ["auto", "rectangle", "horizontal", "vertical"] as const;

export type AdSenseFormat = (typeof ADSENSE_FORMATS)[number];
export type HubAdPlacement = "home" | "hubpedia-index" | "hubpedia-article" | "hubpedia-article-bottom" | "shopping";

export function isAdvertisingEnabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

export function normalizeAdSenseClientId(value: string | undefined): string | undefined {
  const candidate = value?.trim();
  return candidate && ADSENSE_CLIENT_ID.test(candidate) ? candidate : undefined;
}

export function normalizeAdSenseSlotId(value: string | undefined): string | undefined {
  const candidate = value?.trim();
  return candidate && ADSENSE_SLOT_ID.test(candidate) ? candidate : undefined;
}

export function normalizeAdSenseFormat(value: string | undefined): AdSenseFormat {
  const candidate = value?.trim().toLowerCase();
  return ADSENSE_FORMATS.includes(candidate as AdSenseFormat) ? candidate as AdSenseFormat : "auto";
}

export function normalizeFullWidthResponsive(value: string | undefined): boolean {
  return value?.trim().toLowerCase() !== "false";
}

export function normalizeSponsorUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}
