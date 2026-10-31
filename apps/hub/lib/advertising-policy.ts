const STANDARD_FRAME_SOURCES = [
  "'self'",
  "https://www.youtube.com",
  "https://www.youtube-nocookie.com",
  "https://player.vimeo.com",
  "https://player.twitch.tv",
  "https://embed.nicovideo.jp",
  "https://open.spotify.com",
  "https://platform.twitter.com",
  "https://www.instagram.com",
  "https://www.tiktok.com",
  "https://geo.dailymotion.com",
  "https://framatube.org",
  "https://video.blender.org",
  "https://tilvids.com",
  "https://diode.zone",
  "https://peertube.cpy.re",
  "https://w.soundcloud.com",
  "https://connect.trezor.io",
] as const;

export function isAdSensePlacementPath(pathname: string): boolean {
  return pathname === "/" || pathname === "/hubpedia" || pathname.startsWith("/hubpedia/");
}

export function buildHubContentSecurityPolicy(pathname: string, adsenseConfigured: boolean): string {
  const sources: string[] = [...STANDARD_FRAME_SOURCES];
  // AdSense does not support a fixed domain allowlist because its serving domains can change.
  // Limit the broader HTTPS frame permission to pages that actually contain an ad unit.
  if (adsenseConfigured && isAdSensePlacementPath(pathname)) sources.push("https:");
  return `frame-src ${sources.join(" ")}`;
}
