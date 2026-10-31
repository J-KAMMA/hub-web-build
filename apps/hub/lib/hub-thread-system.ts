export const HUB_THREAD_TARGET_TYPES = ["standalone", "hubpedia_article", "video", "music_work", "community", "shopping_review", "game", "region"] as const;
export type HubThreadTargetType = (typeof HUB_THREAD_TARGET_TYPES)[number];
export interface HubThreadCapabilities { anonymous: boolean; voting: boolean; summary: boolean; bestAnswer: boolean; search: boolean; timestamp?: boolean; rating?: boolean; }
const BASE: HubThreadCapabilities = { anonymous: true, voting: true, summary: true, bestAnswer: false, search: true };
export function hubThreadCapabilities(type: HubThreadTargetType): HubThreadCapabilities {
  if (type === "video" || type === "music_work") return { ...BASE, timestamp: true };
  if (type === "shopping_review") return { ...BASE, anonymous: false, rating: true };
  if (type === "standalone") return { ...BASE, bestAnswer: true };
  return { ...BASE };
}
export function isHubThreadTargetType(value: unknown): value is HubThreadTargetType {
  return typeof value === "string" && (HUB_THREAD_TARGET_TYPES as readonly string[]).includes(value);
}
