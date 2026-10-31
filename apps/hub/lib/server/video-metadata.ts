import { externalVideoProviderLabel, normalizeVideoSource } from "@/lib/video-source";
import { getYouTubeDataApiKey } from "@/lib/server/youtube-api-key";
import type { VideoBroadcastStatus } from "@/lib/video-broadcast-status";
import { readMetadataText } from "./bounded-metadata-reader";
import { isRedirectResponse } from "@/lib/redirect-guard";

export interface ExternalVideoMetadata {
  sourceUrl: string;
  provider: string;
  title?: string;
  channel?: string;
  thumbnailUrl?: string;
  broadcastStatus?: VideoBroadcastStatus;
}

type OEmbedPayload = {
  title?: unknown;
  author_name?: unknown;
  thumbnail_url?: unknown;
};

const MAX_RESPONSE_BYTES = 65536;

function optionalText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.normalize("NFKC").trim();
  if (!normalized || normalized.length > maxLength || /\p{Cc}/u.test(normalized)) return undefined;
  return normalized;
}

function optionalHttpsUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 2048) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function decodeMarkupText(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function xmlElement(text: string, name: string): string | undefined {
  const match = text.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "iu"));
  return match ? decodeMarkupText(match[1].trim()) : undefined;
}

function htmlMeta(text: string, property: string): string | undefined {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const propertyFirst = text.match(new RegExp(`<meta[^>]+property=["']${escaped}["'][^>]+content=["']([^"']+)["']`, "iu"));
  const contentFirst = text.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${escaped}["']`, "iu"));
  return decodeMarkupText((propertyFirst?.[1] ?? contentFirst?.[1] ?? "").trim()) || undefined;
}

export async function lookupExternalVideoMetadata(
  sourceUrl: unknown,
  fetchImpl: typeof fetch = fetch
): Promise<ExternalVideoMetadata> {
  const source = normalizeVideoSource(typeof sourceUrl === "string" ? sourceUrl : "");
  const result: ExternalVideoMetadata = {
    sourceUrl: source.sourceUrl,
    provider: externalVideoProviderLabel(source.storedProvider),
    thumbnailUrl: source.thumbnailUrl
  };
  if (source.storedProvider === "youtube") {
    const apiKey = getYouTubeDataApiKey();
    if (apiKey) try {
      const apiResponse = await fetchImpl(`https://www.googleapis.com/youtube/v3/videos?part=snippet,liveStreamingDetails&id=${encodeURIComponent(source.externalVideoId)}&key=${encodeURIComponent(apiKey)}`, { headers: { accept: "application/json" }, redirect: "manual", signal: AbortSignal.timeout(5_000) });
      if (apiResponse.ok && !isRedirectResponse(apiResponse)) {
        const payload = JSON.parse(await readMetadataText(apiResponse, MAX_RESPONSE_BYTES)) as { items?: Array<{ snippet?: { title?: string; channelTitle?: string; liveBroadcastContent?: string; thumbnails?: { high?: { url?: string }; medium?: { url?: string } } }; liveStreamingDetails?: { actualEndTime?: string; scheduledStartTime?: string } }> };
        const item = payload.items?.[0];
        if (item) {
          const live = item.snippet?.liveBroadcastContent;
          return { ...result, title: optionalText(item.snippet?.title, 240), channel: optionalText(item.snippet?.channelTitle, 120), thumbnailUrl: optionalHttpsUrl(item.snippet?.thumbnails?.high?.url ?? item.snippet?.thumbnails?.medium?.url) ?? result.thumbnailUrl, broadcastStatus: item.liveStreamingDetails?.actualEndTime ? "archive" : live === "live" ? "live" : live === "upcoming" || item.liveStreamingDetails?.scheduledStartTime ? "upcoming" : "video" };
        }
      }
    } catch { /* fall through to oEmbed */ }
  }
  const endpoint = source.storedProvider === "youtube"
    ? `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(source.sourceUrl)}`
    : source.storedProvider === "vimeo"
      ? `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(source.sourceUrl)}`
      : source.storedProvider === "niconico"
        ? `https://ext.nicovideo.jp/api/getthumbinfo/${encodeURIComponent(source.externalVideoId)}`
        : source.storedProvider === "tiktok"
          ? `https://www.tiktok.com/oembed?url=${encodeURIComponent(source.sourceUrl)}`
          : source.storedProvider === "dailymotion"
            ? `https://www.dailymotion.com/services/oembed?format=json&url=${encodeURIComponent(source.sourceUrl)}`
            : source.storedProvider === "peertube"
              ? `${new URL(source.sourceUrl).origin}/services/oembed?url=${encodeURIComponent(source.sourceUrl)}`
          : `https://api.twitch.tv/v5/oembed?url=${encodeURIComponent(source.sourceUrl)}`;

  try {
    const response = await fetchImpl(endpoint, {
      headers: { accept: "application/json" },
      redirect: "manual",
      signal: AbortSignal.timeout(5_000)
    });
    if (!response.ok || isRedirectResponse(response)) {
      if (source.storedProvider !== "vimeo") return result;
      const page = await fetchImpl(source.sourceUrl, {
        headers: { accept: "text/html" },
        redirect: "manual",
        signal: AbortSignal.timeout(5_000)
      });
      if (!page.ok || isRedirectResponse(page)) return result;
      const html = await readMetadataText(page, MAX_RESPONSE_BYTES);
      return {
        ...result,
        title: optionalText(htmlMeta(html, "og:title"), 240),
        channel: optionalText(htmlMeta(html, "og:site_name"), 120),
        thumbnailUrl: optionalHttpsUrl(htmlMeta(html, "og:image")) ?? result.thumbnailUrl
      };
    }
    const text = await readMetadataText(response, MAX_RESPONSE_BYTES);
    if (source.storedProvider === "niconico") {
      return {
        ...result,
        title: optionalText(xmlElement(text, "title"), 240),
        channel: optionalText(xmlElement(text, "user_nickname"), 120),
        thumbnailUrl: optionalHttpsUrl(xmlElement(text, "thumbnail_url")) ?? result.thumbnailUrl
      };
    }
    const payload = JSON.parse(text) as OEmbedPayload;
    return {
      ...result,
      title: optionalText(payload.title, 240),
      channel: optionalText(payload.author_name, 120),
      thumbnailUrl: optionalHttpsUrl(payload.thumbnail_url) ?? result.thumbnailUrl
    };
  } catch {
    // Metadata enrichment is best-effort; the normalized official URL remains usable.
    return result;
  }
}
