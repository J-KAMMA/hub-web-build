import {
  hubPersonalizationEnabled,
  readHubInterestProfile,
  topHubInterests,
} from "@/lib/hub-interest-profile";

export const HUB_AD_PERSONALIZATION_KEY = "hub.ads.personalization.enabled";
export const HUB_AD_PERSONALIZATION_CHANGED_EVENT = "hub:ad-personalization-changed";

export function hubAdPersonalizationEnabled(storage: Pick<Storage, "getItem"> = window.localStorage) {
  return hubPersonalizationEnabled(storage) && storage.getItem(HUB_AD_PERSONALIZATION_KEY) !== "off";
}

export function readHubAdInterestKeywords(storage: Pick<Storage, "getItem"> = window.localStorage) {
  if (!hubAdPersonalizationEnabled(storage)) return [];
  return topHubInterests(readHubInterestProfile(storage), 8);
}

export function setHubAdPersonalizationEnabled(
  enabled: boolean,
  storage: Pick<Storage, "setItem"> = window.localStorage,
) {
  storage.setItem(HUB_AD_PERSONALIZATION_KEY, enabled ? "on" : "off");
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(HUB_AD_PERSONALIZATION_CHANGED_EVENT));
}
