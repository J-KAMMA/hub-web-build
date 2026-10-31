export const HUB_AD_MINIMUM_DAILY_BUDGET_JPY = 100;
export const HUB_AD_DEFAULT_FREQUENCY_CAP = {
  count: 3,
  windowSeconds: 86_400,
} as const;

const PLACEMENT_CPM_JPY = {
  "home.feed.inline": 150,
  "threads.replies.inline": 100,
  "videos.discovery.inline": 200,
  "hubpedia.article.inline": 180,
} as const;

const OBJECTIVE_MULTIPLIER = {
  awareness: 1,
  website_visits: 1.1,
  product_service: 1.15,
  event: 1.05,
  sponsorship: 1.25,
} as const;

export type HubAdPricingRecommendation = {
  recommendedRateJpyMicros: number;
  recommendedDailyBudgetJpyMicros: number;
  frequencyCapCount: number;
  frequencyCapWindowSeconds: number;
};

export function recommendHubAdPricing(input: {
  objective: string;
  placementKey: string;
  totalBudgetJpyMicros: number;
  days: number;
}): HubAdPricingRecommendation {
  const days = Math.max(1, Math.min(366, Math.round(input.days)));
  const totalBudget = Math.max(0, Math.floor(input.totalBudgetJpyMicros));
  const baseCpm = PLACEMENT_CPM_JPY[input.placementKey as keyof typeof PLACEMENT_CPM_JPY] ?? 150;
  const multiplier = OBJECTIVE_MULTIPLIER[input.objective as keyof typeof OBJECTIVE_MULTIPLIER] ?? 1;
  const recommendedRateJpyMicros = Math.round(baseCpm * multiplier * 1_000_000);
  const evenDailyBudget = Math.ceil(totalBudget / days / 1_000_000) * 1_000_000;
  const recommendedDailyBudgetJpyMicros = Math.min(
    totalBudget,
    Math.max(HUB_AD_MINIMUM_DAILY_BUDGET_JPY * 1_000_000, evenDailyBudget),
  );
  return {
    recommendedRateJpyMicros,
    recommendedDailyBudgetJpyMicros,
    frequencyCapCount: HUB_AD_DEFAULT_FREQUENCY_CAP.count,
    frequencyCapWindowSeconds: HUB_AD_DEFAULT_FREQUENCY_CAP.windowSeconds,
  };
}
