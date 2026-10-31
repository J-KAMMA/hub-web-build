import { HUB_CATEGORIES, type HubCategoryId } from "@/lib/hub-taxonomy";

const ONBOARDING_CATEGORY_IDS = ["governance", "technology", "science", "culture", "economy", "community", "music", "games"] as const satisfies readonly HubCategoryId[];

export const HUB_ONBOARDING_INTERESTS = ONBOARDING_CATEGORY_IDS.map((id) => {
  const category = HUB_CATEGORIES.find((item) => item.id === id)!;
  return { id, label: category.label, description: category.description };
});

export type HubOnboardingInterestId = (typeof ONBOARDING_CATEGORY_IDS)[number];

export interface HubOnboardingInput {
  interests: HubOnboardingInterestId[];
  profileIds: string[];
  communityIds: string[];
}

const interestIds = new Set<string>(HUB_ONBOARDING_INTERESTS.map((interest) => interest.id));

function uniqueStrings(value: unknown, maximum: number): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const normalized = entry.trim();
    if (!normalized || normalized.length > 128 || result.includes(normalized)) continue;
    result.push(normalized);
    if (result.length >= maximum) break;
  }
  return result;
}

export function parseHubOnboardingInput(value: unknown): HubOnboardingInput {
  if (!value || typeof value !== "object") {
    throw new Error("オンボーディングの入力内容が正しくありません。");
  }

  const input = value as Record<string, unknown>;
  const interests = uniqueStrings(input.interests, HUB_ONBOARDING_INTERESTS.length)
    .map((interest) => interest === "video-games" ? "games" : interest)
    .filter((interest): interest is HubOnboardingInterestId => interestIds.has(interest));
  const profileIds = uniqueStrings(input.profileIds, 5);
  const communityIds = uniqueStrings(input.communityIds, 5);

  if (interests.length === 0) {
    throw new Error("興味のある分野を1つ以上選んでください。");
  }

  return { interests, profileIds, communityIds };
}
