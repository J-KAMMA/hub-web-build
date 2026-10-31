import type { PublicVideoEntry } from "@/components/video-discovery";

export const SHORT_PREFERENCES_KEY = "hub.video-short-preferences.v1";

export type ShortPreferenceProfile = {
  videos: Record<string, number>;
  channels: Record<string, number>;
  topics: Record<string, number>;
  categories: Record<string, number>;
};

const EMPTY_PROFILE: ShortPreferenceProfile = { videos: {}, channels: {}, topics: {}, categories: {} };

export function readShortPreferenceProfile(storage: Pick<Storage, "getItem">): ShortPreferenceProfile {
  try {
    const parsed = JSON.parse(storage.getItem(SHORT_PREFERENCES_KEY) ?? "null") as Partial<ShortPreferenceProfile> | null;
    if (!parsed) return EMPTY_PROFILE;
    return {
      videos: parsed.videos ?? {},
      channels: parsed.channels ?? {},
      topics: parsed.topics ?? {},
      categories: parsed.categories ?? {},
    };
  } catch {
    return EMPTY_PROFILE;
  }
}

function adjust(values: Record<string, number>, key: string, amount: number) {
  if (!key) return;
  values[key] = Math.max(-20, Math.min(30, (values[key] ?? 0) * 0.92 + amount));
}

export function recordShortOutcome(
  storage: Pick<Storage, "getItem" | "setItem">,
  video: PublicVideoEntry,
  outcome: "started" | "completed" | "skipped" | "notInterested",
) {
  const profile = readShortPreferenceProfile(storage);
  const next = {
    videos: { ...profile.videos }, channels: { ...profile.channels },
    topics: { ...profile.topics }, categories: { ...profile.categories },
  };
  const weight = outcome === "completed" ? 4 : outcome === "notInterested" ? -9 : outcome === "skipped" ? -3 : 0.35;
  adjust(next.videos, video.id, weight);
  adjust(next.channels, video.channel, weight * 0.7);
  adjust(next.topics, video.topic, weight);
  adjust(next.categories, video.category, weight * 0.8);
  storage.setItem(SHORT_PREFERENCES_KEY, JSON.stringify(next));
  return next;
}

export function recordShortChannelDismissal(
  storage: Pick<Storage, "getItem" | "setItem">,
  channel: string,
) {
  const profile = readShortPreferenceProfile(storage);
  const next = {
    videos: { ...profile.videos }, channels: { ...profile.channels },
    topics: { ...profile.topics }, categories: { ...profile.categories },
  };
  adjust(next.channels, channel, -12);
  storage.setItem(SHORT_PREFERENCES_KEY, JSON.stringify(next));
  return next;
}

export function recordShortTopicPreference(
  storage: Pick<Storage, "getItem" | "setItem">,
  topic: string,
  direction: "more" | "less",
) {
  const profile = readShortPreferenceProfile(storage);
  const next = {
    videos: { ...profile.videos }, channels: { ...profile.channels },
    topics: { ...profile.topics }, categories: { ...profile.categories },
  };
  adjust(next.topics, topic, direction === "more" ? 6 : -7);
  storage.setItem(SHORT_PREFERENCES_KEY, JSON.stringify(next));
  return next;
}

export function personalizeShortVideos(candidates: PublicVideoEntry[], profile: ShortPreferenceProfile) {
  return candidates.map((video, index) => ({
    video,
    score: (profile.videos[video.id] ?? 0) + (profile.channels[video.channel] ?? 0) * 1.2 +
      (profile.topics[video.topic] ?? 0) * 1.5 + (profile.categories[video.category] ?? 0) - index / 1000,
  })).sort((left, right) => right.score - left.score).map(({ video }) => video);
}

export function selectNextShortVideo(
  candidates: PublicVideoEntry[],
  current: PublicVideoEntry,
  profile: ShortPreferenceProfile,
  recentlyPlayed: readonly string[],
) {
  const recent = new Set(recentlyPlayed.slice(-8));
  const recentVideos = candidates.filter((video) => recent.has(video.id));
  const recentTopics = new Set(recentVideos.map((video) => video.topic));
  const recentCategories = new Set(recentVideos.map((video) => video.category));
  const explorationTurn = recentlyPlayed.length > 0 && recentlyPlayed.length % 5 === 0;
  return candidates
    .filter((video) => video.id !== current.id && video.availabilityStatus !== "unavailable")
    .map((video, index) => ({
      video,
      score: (profile.videos[video.id] ?? 0) + (profile.channels[video.channel] ?? 0) * 1.2 +
        (profile.topics[video.topic] ?? 0) * 1.5 + (profile.categories[video.category] ?? 0) +
        (profile.videos[video.id] === undefined ? 3 : 0) +
        (video.topic === current.topic ? 2 : 0) + (video.provider !== current.provider ? 0.6 : 0) -
        (video.channel === current.channel ? 2.5 : 0) -
        (recent.has(video.id) ? 12 : 0) +
        (recentTopics.has(video.topic) ? -1.2 : 1.4) +
        (recentCategories.has(video.category) ? -0.8 : explorationTurn ? 6 : 1) -
        index / 1000,
    }))
    .sort((left, right) => right.score - left.score)[0]?.video ?? null;
}
