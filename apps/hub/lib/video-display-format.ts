type DisplayVideo = {
  provider: "youtube" | "vimeo" | "twitch" | "niconico" | "tiktok" | "dailymotion" | "peertube" | "hub";
  sourceUrl: string;
  title: string;
};

export function isVerticalVideo(video: DisplayVideo) {
  if (video.provider === "tiktok") return true;
  if (video.provider !== "youtube") return false;
  return /(?:youtube\.com\/shorts\/|youtu\.be\/shorts\/)/iu.test(video.sourceUrl)
    || /(?:^|\s)#shorts(?:\s|$|[^\p{L}\p{N}_])/iu.test(video.title.normalize("NFKC"));
}
