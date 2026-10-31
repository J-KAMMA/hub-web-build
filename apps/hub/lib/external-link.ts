import { classifyHubInternalActionUrl } from "@/lib/hub-internal-action-url";

export interface ExternalLink {
  url: string;
  hostname: string;
  displayUrl: string;
}

export interface EmbeddedMedia extends ExternalLink {
  provider: "youtube" | "vimeo" | "niconico" | "dailymotion" | "peertube" | "spotify" | "x" | "instagram" | "tiktok" | "soundcloud";
  providerLabel: string;
  mediaKind: "video" | "audio" | "post";
  embedUrl: string;
  thumbnailUrl?: string;
}

export interface ExternalImage extends ExternalLink {
  imageUrl: string;
}

export interface ImageHostingPost extends ExternalLink {
  provider: "imgur";
  providerLabel: string;
}

const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/giu;
const TRAILING_PUNCTUATION = /[.,!?;:\)\]}>\u3001\u3002\uff01\uff09\uff1a\uff1b\uff1f]+$/u;

function isJkammaHost(hostname: string): boolean {
  return hostname === "jkamma.com" || hostname.endsWith(".jkamma.com");
}

function isHost(hostname: string, allowed: readonly string[]) {
  return allowed.includes(hostname.toLowerCase());
}

function mediaFromLink(link: ExternalLink): EmbeddedMedia | null {
  const parsed = new URL(link.url);
  const hostname = parsed.hostname.toLowerCase();

  if (isHost(hostname, ["youtu.be"])) {
    const videoId = parsed.pathname.split("/").filter(Boolean)[0];
    if (/^[A-Za-z0-9_-]{11}$/.test(videoId ?? "")) {
      return { ...link, provider: "youtube", providerLabel: "YouTube", mediaKind: "video", embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}`, thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg` };
    }
  }

  if (isHost(hostname, ["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"])) {
    const segments = parsed.pathname.split("/").filter(Boolean);
    const videoId = parsed.pathname === "/watch" ? parsed.searchParams.get("v") : (["shorts", "live", "embed"].includes(segments[0] ?? "") ? segments[1] : null);
    if (/^[A-Za-z0-9_-]{11}$/.test(videoId ?? "")) {
      return { ...link, provider: "youtube", providerLabel: "YouTube", mediaKind: "video", embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}`, thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg` };
    }
  }

  if (isHost(hostname, ["vimeo.com", "www.vimeo.com", "player.vimeo.com"])) {
    const segments = parsed.pathname.split("/").filter(Boolean);
    const videoId = hostname === "player.vimeo.com" && segments[0] === "video" ? segments[1] : segments[0];
    if (/^\d{5,12}$/.test(videoId ?? "")) {
      return { ...link, provider: "vimeo", providerLabel: "Vimeo", mediaKind: "video", embedUrl: `https://player.vimeo.com/video/${videoId}?dnt=1` };
    }
  }

  if (isHost(hostname, ["dailymotion.com", "www.dailymotion.com", "dai.ly"])) {
    const segments = parsed.pathname.split("/").filter(Boolean);
    const videoId = hostname === "dai.ly" ? segments[0] : (segments[0] === "video" ? segments[1] : null);
    if (/^[A-Za-z0-9]{5,20}$/.test(videoId ?? "")) {
      return { ...link, provider: "dailymotion", providerLabel: "Dailymotion", mediaKind: "video", embedUrl: `https://geo.dailymotion.com/player.html?video=${videoId}` };
    }
  }

  if (isHost(hostname, ["framatube.org", "video.blender.org", "tilvids.com", "diode.zone", "peertube.cpy.re"])) {
    const segments = parsed.pathname.split("/").filter(Boolean);
    const videoId = segments[0] === "w" ? segments[1] : (segments[0] === "videos" && ["watch", "embed"].includes(segments[1] ?? "") ? segments[2] : null);
    if (/^[A-Za-z0-9-]{8,64}$/.test(videoId ?? "")) {
      return { ...link, provider: "peertube", providerLabel: "PeerTube", mediaKind: "video", embedUrl: `${parsed.origin}/videos/embed/${videoId}?p2p=0` };
    }
  }

  if (isHost(hostname, ["nicovideo.jp", "www.nicovideo.jp", "nico.ms"])) {
    const segments = parsed.pathname.split("/").filter(Boolean);
    const videoId = hostname === "nico.ms" ? segments[0] : (segments[0] === "watch" ? segments[1] : null);
    if (/^(?:sm|so|nm)?\d{1,12}$/i.test(videoId ?? "")) {
      return { ...link, provider: "niconico", providerLabel: "ニコニコ動画", mediaKind: "video", embedUrl: `https://embed.nicovideo.jp/watch/${videoId}` };
    }
  }

  if (isHost(hostname, ["open.spotify.com"])) {
    const segments = parsed.pathname.split("/").filter(Boolean);
    const offset = segments[0]?.startsWith("intl-") ? 1 : 0;
    const mediaType = segments[offset];
    const mediaId = segments[offset + 1];
    if (["track", "episode", "show", "playlist", "album"].includes(mediaType ?? "") && /^[A-Za-z0-9]{10,64}$/.test(mediaId ?? "")) {
      return { ...link, provider: "spotify", providerLabel: "Spotify", mediaKind: "audio", embedUrl: `https://open.spotify.com/embed/${mediaType}/${mediaId}` };
    }
  }

  if (isHost(hostname, ["x.com", "www.x.com", "twitter.com", "www.twitter.com", "mobile.twitter.com"])) {
    const segments = parsed.pathname.split("/").filter(Boolean);
    const statusIndex = segments.indexOf("status");
    const postId = statusIndex > 0 ? segments[statusIndex + 1] : null;
    if (/^\d{1,24}$/.test(postId ?? "")) {
      return { ...link, provider: "x", providerLabel: "X", mediaKind: "post", embedUrl: `https://platform.twitter.com/embed/Tweet.html?id=${postId}&dnt=true` };
    }
  }

  if (isHost(hostname, ["instagram.com", "www.instagram.com"])) {
    const segments = parsed.pathname.split("/").filter(Boolean);
    const mediaType = segments[0];
    const shortcode = segments[1];
    if (["p", "reel", "tv"].includes(mediaType ?? "") && /^[A-Za-z0-9_-]{5,32}$/.test(shortcode ?? "")) {
      return { ...link, provider: "instagram", providerLabel: "Instagram", mediaKind: "post", embedUrl: `https://www.instagram.com/${mediaType}/${shortcode}/embed/` };
    }
  }

  if (isHost(hostname, ["tiktok.com", "www.tiktok.com", "m.tiktok.com"])) {
    const segments = parsed.pathname.split("/").filter(Boolean);
    const videoIndex = segments.indexOf("video");
    const postId = videoIndex > 0 ? segments[videoIndex + 1] : null;
    if (/^\d{10,24}$/.test(postId ?? "")) {
      return { ...link, provider: "tiktok", providerLabel: "TikTok", mediaKind: "video", embedUrl: `https://www.tiktok.com/player/v1/${postId}` };
    }
  }

  if (isHost(hostname, ["soundcloud.com", "www.soundcloud.com", "m.soundcloud.com"])) {
    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments.length >= 2) {
      const embedUrl = new URL("https://w.soundcloud.com/player/");
      embedUrl.searchParams.set("url", link.url);
      embedUrl.searchParams.set("auto_play", "false");
      embedUrl.searchParams.set("show_comments", "false");
      embedUrl.searchParams.set("show_user", "true");
      return { ...link, provider: "soundcloud", providerLabel: "SoundCloud", mediaKind: "audio", embedUrl: embedUrl.toString() };
    }
  }

  return null;
}

function imageHostingPostFromLink(link: ExternalLink): ImageHostingPost | null {
  const parsed = new URL(link.url);
  const hostname = parsed.hostname.toLowerCase();
  if (!isHost(hostname, ["imgur.com", "www.imgur.com", "m.imgur.com"])) return null;

  const segments = parsed.pathname.split("/").filter(Boolean);
  const reservedPaths = new Set(["about", "apps", "blog", "community", "privacy", "register", "search", "signin", "tos", "upload"]);
  const isSinglePost = segments.length === 1 && !reservedPaths.has((segments[0] ?? "").toLowerCase()) && /^[A-Za-z0-9]{5,32}$/.test(segments[0] ?? "");
  const isCollection = segments.length === 2 && ["a", "gallery"].includes(segments[0] ?? "") && /^[A-Za-z0-9]{5,32}$/.test(segments[1] ?? "");
  if (!isSinglePost && !isCollection) return null;

  return { ...link, provider: "imgur", providerLabel: "Imgur" };
}

export function extractFirstExternalLink(body: string): ExternalLink | null {
  for (const match of body.matchAll(URL_PATTERN)) {
    const candidate = match[0].replace(TRAILING_PUNCTUATION, "");
    if (!candidate || candidate.length > 2048) continue;

    try {
      const parsed = new URL(candidate);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") continue;
      if (isJkammaHost(parsed.hostname.toLowerCase()) && !classifyHubInternalActionUrl(parsed.toString())) continue;

      const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
      const path = `${parsed.pathname}${parsed.search}`;
      return {
        url: parsed.toString(),
        hostname,
        displayUrl: path === "/" ? hostname : `${hostname}${path}`
      };
    } catch {
      continue;
    }
  }

  return null;
}

export function extractFirstEmbeddedMedia(body: string): EmbeddedMedia | null {
  const link = extractFirstExternalLink(body);
  return link ? mediaFromLink(link) : null;
}

export function withoutEmbeddedVideoUrl(body: string): string {
  const media = extractFirstEmbeddedMedia(body);
  if (!media || media.mediaKind !== "video") return body;

  for (const match of body.matchAll(URL_PATTERN)) {
    const raw = match[0];
    const candidate = raw.replace(TRAILING_PUNCTUATION, "");
    try {
      if (new URL(candidate).toString() !== media.url) continue;
      const index = match.index ?? 0;
      const punctuation = raw.slice(candidate.length);
      return `${body.slice(0, index)}${punctuation}${body.slice(index + raw.length)}`
        .replace(/[ \t]{2,}/gu, " ")
        .replace(/ *\n */gu, "\n")
        .trim();
    } catch {
      continue;
    }
  }

  return body;
}

export function withoutExternalCardUrl(body: string): string {
  const link = extractFirstExternalLink(body);
  if (!link) return body;
  const media = mediaFromLink(link);
  if (
    media?.mediaKind !== "video" &&
    !classifyHubInternalActionUrl(link.url)
  ) return body;

  for (const match of body.matchAll(URL_PATTERN)) {
    const raw = match[0];
    const candidate = raw.replace(TRAILING_PUNCTUATION, "");
    try {
      if (new URL(candidate).toString() !== link.url) continue;
      const index = match.index ?? 0;
      const punctuation = raw.slice(candidate.length);
      return `${body.slice(0, index)}${punctuation}${body.slice(index + raw.length)}`
        .replace(/[ \t]{2,}/gu, " ")
        .replace(/ *\n */gu, "\n")
        .trim();
    } catch {
      continue;
    }
  }
  return body;
}

export function extractFirstExternalImage(body: string): ExternalImage | null {
  const link = extractFirstExternalLink(body);
  if (!link) return null;
  const parsed = new URL(link.url);
  if (parsed.protocol !== "https:" || !/\.(?:avif|gif|jpe?g|png|webp)$/iu.test(parsed.pathname)) return null;
  return { ...link, imageUrl: parsed.toString() };
}

export function extractFirstImageHostingPost(body: string): ImageHostingPost | null {
  const link = extractFirstExternalLink(body);
  return link ? imageHostingPostFromLink(link) : null;
}
