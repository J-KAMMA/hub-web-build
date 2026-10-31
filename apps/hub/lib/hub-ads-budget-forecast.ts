export type HubAdCampaignBudget = {
  totalBudgetJpyMicros: number;
  fundedJpyMicros: number;
  spentJpyMicros: number;
  last7dSpendJpyMicros: number;
};

export type HubAdBudgetForecast = {
  remainingJpyMicros: number;
  averageDailySpendJpyMicros: number;
  projectedDaysRemaining: number | null;
};

export function forecastHubAdBudget(
  campaign: HubAdCampaignBudget,
): HubAdBudgetForecast {
  const available = Math.min(
    Math.max(0, Number(campaign.totalBudgetJpyMicros) || 0),
    Math.max(0, Number(campaign.fundedJpyMicros) || 0),
  );
  const remainingJpyMicros = Math.max(
    0,
    available - Math.max(0, Number(campaign.spentJpyMicros) || 0),
  );
  const averageDailySpendJpyMicros =
    Math.max(0, Number(campaign.last7dSpendJpyMicros) || 0) / 7;
  return {
    remainingJpyMicros,
    averageDailySpendJpyMicros,
    projectedDaysRemaining:
      averageDailySpendJpyMicros > 0
        ? remainingJpyMicros / averageDailySpendJpyMicros
        : null,
  };
}
