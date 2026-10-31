import { normalizeMusicSource, type NormalizedMusicSource } from "@/lib/music-source";
import { readMetadataText } from "./bounded-metadata-reader";
import { isRedirectResponse } from "@/lib/redirect-guard";

export interface ExternalMusicMetadata {
  sourceUrl: string;
  provider: NormalizedMusicSource["provider"];
  providerLabel: string;
  title?: string;
  artist?: string;
  thumbnailUrl?: string;
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

function metadataEndpoint(source: NormalizedMusicSource): string | null {
  if (source.provider === "youtube") return `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(source.url)}`;
  return null;
}

export async function lookupExternalMusicMetadata(
  sourceUrl: unknown,
  fetchImpl: typeof fetch = fetch
): Promise<ExternalMusicMetadata> {
  const source = normalizeMusicSource(typeof sourceUrl === "string" ? sourceUrl : "");
  const result: ExternalMusicMetadata = {
    sourceUrl: source.url,
    provider: source.provider,
    providerLabel: source.label,
  };
  const endpoint = metadataEndpoint(source);
  if (!endpoint) return result;

  try {
    const response = await fetchImpl(endpoint, {
      headers: { accept: "application/json" },
      redirect: "manual",
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok || isRedirectResponse(response)) return result;
    const text = await readMetadataText(response, MAX_RESPONSE_BYTES);
    const payload = JSON.parse(text) as OEmbedPayload;
    return {
      ...result,
      title: optionalText(payload.title, 180),
      artist: optionalText(payload.author_name, 120),
      thumbnailUrl: optionalHttpsUrl(payload.thumbnail_url),
    };
  } catch {
    return result;
  }
}
