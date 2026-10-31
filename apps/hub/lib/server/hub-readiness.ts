export type HubDependencyState = "ready" | "degraded" | "unavailable";

export type HubReadinessDependency = {
  state: HubDependencyState;
  latencyMs?: number;
};

export type HubReadinessReport = {
  status: "ready" | "degraded" | "unavailable";
  service: "hub";
  checkedAt: string;
  dependencies: {
    database: HubReadinessDependency;
  };
  features: {
    socialPosting: boolean;
    search: boolean;
    tips: boolean;
    advertising: boolean;
  };
};

export function classifyHubReadiness(
  database: HubReadinessDependency,
  features: HubReadinessReport["features"],
  checkedAt = new Date().toISOString(),
): HubReadinessReport {
  const essentialFeaturesAvailable = features.socialPosting && features.search;
  const status = database.state === "unavailable"
    ? "unavailable"
    : database.state === "degraded" || !essentialFeaturesAvailable
      ? "degraded"
      : "ready";

  return {
    status,
    service: "hub",
    checkedAt,
    dependencies: { database },
    features,
  };
}

export function hubFeatureFlags(
  environment: Readonly<Record<string, string | undefined>> = process.env,
) {
  return {
    socialPosting: environment.HUB_SOCIAL_POSTING_ENABLED !== "false",
    search: environment.HUB_SEARCH_ENABLED !== "false",
    tips: environment.HUB_TIPS_ENABLED !== "false",
    advertising: environment.HUB_ADVERTISING_ENABLED === "true",
  };
}
