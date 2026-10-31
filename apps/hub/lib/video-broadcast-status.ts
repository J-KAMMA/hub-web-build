export type VideoBroadcastStatus = "live" | "upcoming" | "archive" | "video";

export function classifyVideoBroadcastStatus(video: { title: string; topic?: string | null; publishedAt?: string | null; broadcastStatus?: VideoBroadcastStatus | null }): VideoBroadcastStatus {
  if (video.broadcastStatus && video.broadcastStatus !== "video") return video.broadcastStatus;
  const text = `${video.title} ${video.topic ?? ""}`;
  if (/配信予定|公開予定|premiere|upcoming|scheduled/i.test(text)) return "upcoming";
  if (/アーカイブ|見逃し|archive|replay/i.test(text)) return "archive";
  if (/ライブ|生放送|生配信|\blive\b/i.test(text)) {
    const publishedAt = video.publishedAt ? Date.parse(video.publishedAt) : Number.NaN;
    if (Number.isFinite(publishedAt) && publishedAt > Date.now() + 60_000) return "upcoming";
    return "live";
  }
  return "video";
}

export function videoBroadcastLabel(status: VideoBroadcastStatus) {
  if (status === "live") return "ライブ";
  if (status === "upcoming") return "配信予定";
  if (status === "archive") return "アーカイブ";
  return null;
}
