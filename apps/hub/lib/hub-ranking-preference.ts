import type {
  HubRankPolicy,
  HubRankingSurface,
} from "@/lib/platform/hub-object-ranking";

export const HUB_RANKING_PREFERENCE_KEY = "hub.ranking.preference.v1";
export const HUB_RANKING_PREFERENCE_EVENT = "hub:ranking-preference-changed";

export type HubRankingPreference =
  | "balanced"
  | "personal_ai"
  | "expert"
  | "local"
  | "source";

export const HUB_RANKING_PREFERENCES: ReadonlyArray<{
  id: HubRankingPreference;
  label: string;
  description: string;
}> = [
  { id: "balanced", label: "バランス", description: "関連性・新しさ・信頼性を均等に見る" },
  { id: "personal_ai", label: "個人AI", description: "自分の関心と目的への適合を優先する" },
  { id: "expert", label: "専門性", description: "専門知識と信頼できる評価を優先する" },
  { id: "local", label: "地域", description: "地域との近さや文脈を優先する" },
  { id: "source", label: "出典", description: "出典の信頼性と安全性を優先する" },
];

export function normalizeHubRankingPreference(
  value: unknown,
): HubRankingPreference {
  return HUB_RANKING_PREFERENCES.some((item) => item.id === value)
    ? value as HubRankingPreference
    : "balanced";
}

export function readHubRankingPreference(): HubRankingPreference {
  if (typeof window === "undefined") return "balanced";
  return normalizeHubRankingPreference(
    window.localStorage.getItem(HUB_RANKING_PREFERENCE_KEY),
  );
}

export function setHubRankingPreference(value: HubRankingPreference) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(HUB_RANKING_PREFERENCE_KEY, value);
  window.dispatchEvent(new CustomEvent(HUB_RANKING_PREFERENCE_EVENT, {
    detail: { value },
  }));
}

export function hubRankPolicyForPreference(
  surface: HubRankingSurface,
  preference: HubRankingPreference,
): HubRankPolicy {
  const weights = preference === "personal_ai"
    ? { relevance: 1.35, affinity: 1.6, freshness: 0.9, trust: 1, safety: 1 }
    : preference === "expert"
      ? { relevance: 1.15, affinity: 0.8, freshness: 0.75, trust: 1.75, safety: 1.2 }
      : preference === "local"
        ? { relevance: 1.05, affinity: 1.7, freshness: 1.1, trust: 1, safety: 1 }
        : preference === "source"
          ? { relevance: 1.1, affinity: 0.65, freshness: 0.8, trust: 1.8, safety: 1.5 }
          : { relevance: 1, affinity: 1, freshness: 1, trust: 1, safety: 1 };
  return { surface, weights };
}
