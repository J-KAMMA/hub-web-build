import { hubCategorySearchTerms, hubCategorySearchText } from "@/lib/hub-taxonomy";

export const HUB_INTEREST_PROFILE_KEY = "hub.interest-profile.v1";
export const HUB_PERSONALIZATION_KEY = "hub.personalization.enabled";
export const HUB_INTEREST_PROFILE_CHANGED_EVENT = "hub:interest-profile-changed";

export type HubInterestSource = "feed" | "image" | "video" | "shopping" | "community" | "hubpedia" | "books" | "games" | "onboarding";

export type HubInterestProfile = {
  terms: Record<string, number>;
  updatedAt: string | null;
  recent?: Record<string, { source: HubInterestSource; at: string }>;
};

export const EMPTY_HUB_INTEREST_PROFILE: HubInterestProfile = { terms: {}, updatedAt: null };

function normalizeTerm(value: string) {
  const normalized = value.trim().replace(/\s+/gu, " ").slice(0, 80);
  if (/^https?:\/\//iu.test(normalized)) return "";
  if (["すべて", "その他", "おすすめ", "人気", "新着"].includes(normalized)) return "";
  return /^[\x00-\x7f]+$/u.test(normalized) ? normalized.toLocaleLowerCase("en") : normalized;
}

const DECAY_GRACE_DAYS = 7;
const DECAY_HALF_LIFE_DAYS = 45;
const REPEAT_WINDOW_MS = 5 * 60 * 1000;
const MAX_TERMS = 64;

function decayedWeight(weight: number, updatedAt: string | null, now = Date.now()) {
  if (!updatedAt) return weight;
  const ageDays = Math.max(0, now - Date.parse(updatedAt)) / 86_400_000;
  if (!Number.isFinite(ageDays) || ageDays <= DECAY_GRACE_DAYS) return weight;
  return weight * 0.5 ** ((ageDays - DECAY_GRACE_DAYS) / DECAY_HALF_LIFE_DAYS);
}

export function hubPersonalizationEnabled(storage: Pick<Storage, "getItem"> = window.localStorage) {
  return storage.getItem(HUB_PERSONALIZATION_KEY) !== "off";
}

export function readHubInterestProfile(storage: Pick<Storage, "getItem"> = window.localStorage): HubInterestProfile {
  try {
    const parsed = JSON.parse(storage.getItem(HUB_INTEREST_PROFILE_KEY) ?? "null") as Partial<HubInterestProfile> | null;
    if (!parsed || typeof parsed !== "object" || !parsed.terms || typeof parsed.terms !== "object") return EMPTY_HUB_INTEREST_PROFILE;
    const terms = Object.fromEntries(Object.entries(parsed.terms)
      .filter(([term, weight]) => Boolean(normalizeTerm(term)) && typeof weight === "number" && Number.isFinite(weight) && weight > 0)
      .map(([term, weight]) => [normalizeTerm(term), decayedWeight(Math.min(100, weight), typeof parsed.updatedAt === "string" ? parsed.updatedAt : null)] as const)
      .filter(([, weight]) => weight >= 0.15));
    const recent = parsed.recent && typeof parsed.recent === "object" ? Object.fromEntries(Object.entries(parsed.recent).filter(([, entry]) => Boolean(entry && typeof entry === "object" && typeof entry.at === "string" && typeof entry.source === "string"))) as HubInterestProfile["recent"] : undefined;
    return { terms, updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : null, recent };
  } catch {
    return EMPTY_HUB_INTEREST_PROFILE;
  }
}

export function topHubInterests(profile: HubInterestProfile, limit = 8) {
  return Object.entries(profile.terms)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "ja"))
    .slice(0, limit)
    .map(([term]) => term);
}

export function recordHubInterests(
  source: HubInterestSource,
  values: readonly string[],
  weight = 1,
  storage: Pick<Storage, "getItem" | "setItem"> = window.localStorage,
) {
  if (!hubPersonalizationEnabled(storage)) return readHubInterestProfile(storage);
  const current = readHubInterestProfile(storage);
  const terms = { ...current.terms };
  const recent = { ...current.recent };
  const now = Date.now();
  for (const raw of new Set(values)) {
    const term = normalizeTerm(raw);
    if (!term) continue;
    const previous = recent[term];
    const repeated = previous?.source === source && now - Date.parse(previous.at) < REPEAT_WINDOW_MS;
    const currentWeight = terms[term] ?? 0;
    const increment = Math.max(0.1, weight) * (repeated ? 0.2 : 1) / (1 + currentWeight / 20);
    terms[term] = Math.min(100, currentWeight + increment);
    recent[term] = { source, at: new Date(now).toISOString() };
  }
  const boundedTerms = Object.fromEntries(Object.entries(terms).sort((left, right) => right[1] - left[1]).slice(0, MAX_TERMS));
  const boundedRecent = Object.fromEntries(Object.entries(recent).filter(([term]) => term in boundedTerms));
  const next = { terms: boundedTerms, updatedAt: new Date(now).toISOString(), recent: boundedRecent } satisfies HubInterestProfile;
  storage.setItem(HUB_INTEREST_PROFILE_KEY, JSON.stringify(next));
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(HUB_INTEREST_PROFILE_CHANGED_EVENT, { detail: { profile: next, source } }));
  return next;
}

export function scoreHubInterestText(text: string, interests: readonly string[]) {
  const normalized = hubCategorySearchText(text).toLocaleLowerCase("ja");
  return interests.reduce((score, term, index) => {
    const normalizedTerm = normalizeTerm(term);
    if (!normalizedTerm) return score;
    const matches = hubCategorySearchTerms(normalizedTerm).some((candidate) => {
      const ascii = /^[a-z0-9+#.-]+$/iu.test(candidate);
      return ascii
        ? new RegExp(`(^|[^a-z0-9])${candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "iu").test(normalized)
        : normalized.includes(candidate);
    });
    const specificity = Math.min(1.5, 1 + normalizedTerm.length / 40);
    return score + (matches ? Math.max(1, 12 - index) * specificity : 0);
  }, 0);
}

export function clearHubInterestProfile(storage: Pick<Storage, "removeItem"> = window.localStorage) {
  storage.removeItem(HUB_INTEREST_PROFILE_KEY);
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(HUB_INTEREST_PROFILE_CHANGED_EVENT, { detail: { profile: EMPTY_HUB_INTEREST_PROFILE, source: "clear" } }));
}
