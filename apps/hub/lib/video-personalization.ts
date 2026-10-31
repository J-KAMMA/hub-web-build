import type { PublicVideoEntry } from "@/components/video-discovery";
import { rankHubObjects } from "@/lib/platform/hub-object-ranking";

export const VIDEO_HISTORY_KEY = "hub.video_history";

export function readVideoHistory(storage: Pick<Storage, "getItem">): string[] {
  try {
    const value = JSON.parse(storage.getItem(VIDEO_HISTORY_KEY) ?? "[]") as unknown;
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string").slice(0, 50) : [];
  } catch {
    return [];
  }
}

export function rememberVideo(storage: Pick<Storage, "getItem" | "setItem">, videoId: string): void {
  const next = [videoId, ...readVideoHistory(storage).filter((id) => id !== videoId)].slice(0, 50);
  try { storage.setItem(VIDEO_HISTORY_KEY, JSON.stringify(next)); } catch { /* Browser storage can be disabled. */ }
}

export function personalizeVideos<T extends PublicVideoEntry>(candidates: T[], signals: PublicVideoEntry[]): T[] {
  if (!signals.length) return candidates;
  const topics = new Set(signals.map((video) => video.topic));
  const categories = new Set(signals.map((video) => video.category));
  const purposes = new Set(signals.map((video) => video.purpose));
  const providers = new Set(signals.map((video) => video.provider));
  const seen = new Set(signals.map((video) => video.id));
  return rankHubObjects(
    candidates.map((video, index) => ({
      ref: { namespace: "hub", kind: "video", id: video.id },
      value: video,
      baseScore: -index / 1000,
      relevance: (topics.has(video.topic) ? 8 : 0)
        + (categories.has(video.category) ? 4 : 0)
        + (purposes.has(video.purpose) ? 2 : 0)
        + (providers.has(video.provider) ? 1 : 0),
      affinity: seen.has(video.id) ? -6 : 0,
      stableKey: String(index).padStart(8, "0"),
      tieBreakers: [-index],
      diversityKeys: { source: video.provider, topic: video.topic },
    })),
    { surface: "media_feed" },
  ).map((entry) => entry.value);
}

export function personalizationReason(video: PublicVideoEntry, signals: PublicVideoEntry[]): string | null {
  if (signals.some((signal) => signal.topic === video.topic)) return `「${video.topic}」を見ているため`;
  if (signals.some((signal) => signal.category === video.category)) return `「${video.category}」に関心があるため`;
  if (signals.some((signal) => signal.purpose === video.purpose)) return `「${video.purpose}」に近い動画`;
  return null;
}
