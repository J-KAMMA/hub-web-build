import {
  normalizeAdSenseClientId,
  normalizeAdSenseSlotId,
  type HubAdPlacement,
} from "@/lib/advertising";
import { parseSponsorCampaigns } from "@/lib/sponsor-selection";

export type AdvertisingInventoryProvider = "adsense" | "direct-sponsor";
export type AdvertisingInventoryStatus = "active" | "scheduled" | "expired";

export interface AdvertisingInventoryItem {
  id: string;
  title: string;
  provider: AdvertisingInventoryProvider;
  placement: HubAdPlacement;
  status: AdvertisingInventoryStatus;
  locales: string[];
  keywords: string[];
  expectedCpmJpy?: number;
  startsAt?: number;
  endsAt?: number;
}

export interface AdvertisingInventoryFilters {
  query?: string;
  provider?: AdvertisingInventoryProvider | "all";
  placement?: HubAdPlacement | "all";
  status?: AdvertisingInventoryStatus | "all";
  locale?: string | "all";
  minimumCpmJpy?: number;
}

function campaignStatus(startsAt: number | undefined, endsAt: number | undefined, now: number): AdvertisingInventoryStatus {
  if (startsAt !== undefined && now < startsAt) return "scheduled";
  if (endsAt !== undefined && now >= endsAt) return "expired";
  return "active";
}

export function buildAdvertisingInventory(
  environment: Readonly<Record<string, string | undefined>>,
  now = new Date(),
): AdvertisingInventoryItem[] {
  const items: AdvertisingInventoryItem[] = [];
  const clientId = normalizeAdSenseClientId(environment.HUB_ADSENSE_CLIENT_ID);
  const slots: Array<[HubAdPlacement, string | undefined]> = [
    ["home", environment.HUB_ADSENSE_SLOT_HOME],
    ["hubpedia-index", environment.HUB_ADSENSE_SLOT_HUBPEDIA],
    ["hubpedia-article", environment.HUB_ADSENSE_SLOT_HUBPEDIA_ARTICLE],
    ["hubpedia-article-bottom", environment.HUB_ADSENSE_SLOT_HUBPEDIA_ARTICLE_BOTTOM],
  ];
  if (clientId) {
    for (const [placement, rawSlot] of slots) {
      const slot = normalizeAdSenseSlotId(rawSlot);
      if (!slot) continue;
      items.push({
        id: `adsense-${placement}-${slot}`,
        title: `AdSense ${placement}`,
        provider: "adsense",
        placement,
        status: "active",
        locales: [],
        keywords: [],
      });
    }
  }

  const timestamp = now.getTime();
  for (const campaign of parseSponsorCampaigns(environment.HUB_SPONSOR_CAMPAIGNS_JSON)) {
    for (const placement of campaign.placements) {
      items.push({
        id: `sponsor-${campaign.id}-${placement}`,
        title: campaign.title,
        provider: "direct-sponsor",
        placement,
        status: campaignStatus(campaign.startsAt, campaign.endsAt, timestamp),
        locales: campaign.locales,
        keywords: campaign.keywords,
        expectedCpmJpy: campaign.expectedCpmJpy,
        startsAt: campaign.startsAt,
        endsAt: campaign.endsAt,
      });
    }
  }
  return items;
}

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("ja-JP").trim();
}

export function filterAdvertisingInventory(
  items: AdvertisingInventoryItem[],
  filters: AdvertisingInventoryFilters,
): AdvertisingInventoryItem[] {
  const query = normalize(filters.query ?? "");
  const locale = normalize(filters.locale ?? "all");
  const minimumCpmJpy = Number.isFinite(filters.minimumCpmJpy) ? Math.max(0, filters.minimumCpmJpy ?? 0) : 0;
  return items.filter((item) => {
    if (filters.provider && filters.provider !== "all" && item.provider !== filters.provider) return false;
    if (filters.placement && filters.placement !== "all" && item.placement !== filters.placement) return false;
    if (filters.status && filters.status !== "all" && item.status !== filters.status) return false;
    if (locale !== "all" && item.locales.length > 0 && !item.locales.some((itemLocale) => {
      const normalizedLocale = normalize(itemLocale);
      return normalizedLocale === locale || normalizedLocale.split("-")[0] === locale.split("-")[0];
    })) return false;
    if (minimumCpmJpy > 0 && (item.expectedCpmJpy ?? 0) < minimumCpmJpy) return false;
    if (query) {
      const searchable = normalize([
        item.id,
        item.title,
        item.provider,
        item.placement,
        item.status,
        ...item.locales,
        ...item.keywords,
      ].join(" "));
      if (!searchable.includes(query)) return false;
    }
    return true;
  });
}
