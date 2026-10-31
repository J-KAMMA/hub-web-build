import type { HubLocale } from "@/lib/i18n";

export const HUB_REGION_COOKIE = "hub_region";
export const HUB_REGIONS = ["jp", "na", "kr", "zh"] as const;
export type HubRegion = typeof HUB_REGIONS[number];

export function resolveHubRegion(value?: string | null): HubRegion | undefined {
  return HUB_REGIONS.find((region) => region === value);
}

export function defaultHubRegion(locale: HubLocale): HubRegion {
  if (locale === "en") return "na";
  if (locale === "ko") return "kr";
  if (locale === "zh-CN") return "zh";
  return "jp";
}
