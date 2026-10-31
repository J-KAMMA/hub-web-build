export const HUB_VIDEO_MANIFEST_TYPE = "https://hub.jkamma.com/spec/video-manifest/v1";

export type DistributedVideoStream = {
  kind: "embed" | "hls" | "dash" | "file";
  url: string;
  mimeType?: string;
  width?: number;
  height?: number;
  bitrate?: number;
};

export type DistributedVideoManifest = {
  type: typeof HUB_VIDEO_MANIFEST_TYPE;
  videoId: string;
  origin: string;
  title: string;
  description: string;
  channel: string;
  category: string;
  language?: string;
  publishedAt?: string;
  thumbnailUrl?: string;
  streams: DistributedVideoStream[];
  captions: Array<{ url: string; language: string; label?: string; kind?: "captions" | "subtitles" }>;
  mirrors: Array<{ manifestUrl: string; origin: string; priority?: number }>;
  tags: string[];
  cachePolicy: "denied" | "temporary" | "allowed";
  license: string;
  aiTraining: "denied" | "allowed" | "attribution" | "consent-required";
  embedAllowed: boolean;
  ageRating: "general" | "teen" | "adult";
  contentHash?: string;
};

export class InvalidDistributedVideoManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidDistributedVideoManifestError";
  }
}

function text(value: unknown, name: string, max: number, optional = false): string | undefined {
  if (optional && (value === undefined || value === null || value === "")) return undefined;
  if (typeof value !== "string") throw new InvalidDistributedVideoManifestError(`${name} is required.`);
  const normalized = value.normalize("NFKC").trim();
  if (!normalized || normalized.length > max || /\p{Cc}/u.test(normalized)) {
    throw new InvalidDistributedVideoManifestError(`${name} is invalid.`);
  }
  return normalized;
}

function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host === "::1") return true;
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)?.slice(1).map(Number);
  if (ipv4 && ipv4.every((part) => part >= 0 && part <= 255)) {
    const [a, b] = ipv4;
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  return host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe8") || host.startsWith("fe9")
    || host.startsWith("fea") || host.startsWith("feb");
}

export function normalizePublicVideoUrl(value: unknown, name = "url"): string {
  const raw = text(value, name, 2048) as string;
  let url: URL;
  try { url = new URL(raw); } catch { throw new InvalidDistributedVideoManifestError(`${name} must be a valid URL.`); }
  if (url.protocol !== "https:" || url.username || url.password || url.port || isBlockedHostname(url.hostname)) {
    throw new InvalidDistributedVideoManifestError(`${name} must be a public HTTPS URL.`);
  }
  url.hash = "";
  return url.toString();
}

function finiteInteger(value: unknown, min: number, max: number): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) throw new InvalidDistributedVideoManifestError("Stream dimensions are invalid.");
  return Number(value);
}

export function parseDistributedVideoManifest(input: unknown): DistributedVideoManifest {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new InvalidDistributedVideoManifestError("Manifest must be an object.");
  const value = input as Record<string, unknown>;
  if (value.type !== HUB_VIDEO_MANIFEST_TYPE) throw new InvalidDistributedVideoManifestError("Manifest type is not supported.");
  const streamsInput = Array.isArray(value.streams) ? value.streams : [];
  if (!streamsInput.length || streamsInput.length > 16) throw new InvalidDistributedVideoManifestError("At least one stream is required.");
  const streams = streamsInput.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new InvalidDistributedVideoManifestError("Stream is invalid.");
    const stream = item as Record<string, unknown>;
    if (!(["embed", "hls", "dash", "file"] as const).includes(stream.kind as never)) throw new InvalidDistributedVideoManifestError("Stream kind is invalid.");
    return {
      kind: stream.kind as DistributedVideoStream["kind"],
      url: normalizePublicVideoUrl(stream.url, "stream.url"),
      mimeType: text(stream.mimeType, "stream.mimeType", 120, true),
      width: finiteInteger(stream.width, 1, 16384),
      height: finiteInteger(stream.height, 1, 16384),
      bitrate: finiteInteger(stream.bitrate, 1, 1_000_000_000),
    };
  });
  const captions = (Array.isArray(value.captions) ? value.captions : []).slice(0, 32).map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new InvalidDistributedVideoManifestError("Caption is invalid.");
    const caption = item as Record<string, unknown>;
    return { url: normalizePublicVideoUrl(caption.url, "caption.url"), language: text(caption.language, "caption.language", 35) as string, label: text(caption.label, "caption.label", 80, true), kind: caption.kind === "captions" ? "captions" as const : "subtitles" as const };
  });
  const mirrors = (Array.isArray(value.mirrors) ? value.mirrors : []).slice(0, 16).map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new InvalidDistributedVideoManifestError("Mirror is invalid.");
    const mirror = item as Record<string, unknown>;
    return { manifestUrl: normalizePublicVideoUrl(mirror.manifestUrl, "mirror.manifestUrl"), origin: normalizePublicVideoUrl(mirror.origin, "mirror.origin"), priority: finiteInteger(mirror.priority, 0, 1000) };
  });
  const cachePolicy = ["denied", "temporary", "allowed"].includes(String(value.cachePolicy)) ? value.cachePolicy as DistributedVideoManifest["cachePolicy"] : "denied";
  const aiTraining = ["denied", "allowed", "attribution", "consent-required"].includes(String(value.aiTraining)) ? value.aiTraining as DistributedVideoManifest["aiTraining"] : "denied";
  const ageRating = ["general", "teen", "adult"].includes(String(value.ageRating)) ? value.ageRating as DistributedVideoManifest["ageRating"] : "general";
  return {
    type: HUB_VIDEO_MANIFEST_TYPE,
    videoId: normalizePublicVideoUrl(value.videoId, "videoId"),
    origin: normalizePublicVideoUrl(value.origin, "origin"),
    title: text(value.title, "title", 240) as string,
    description: text(value.description ?? "", "description", 5000, true) ?? "",
    channel: text(value.channel, "channel", 120) as string,
    category: text(value.category ?? "未分類", "category", 80) as string,
    language: text(value.language, "language", 35, true),
    publishedAt: text(value.publishedAt, "publishedAt", 40, true),
    thumbnailUrl: value.thumbnailUrl ? normalizePublicVideoUrl(value.thumbnailUrl, "thumbnailUrl") : undefined,
    streams, captions, mirrors,
    tags: (Array.isArray(value.tags) ? value.tags : []).slice(0, 32).map((tag) => text(tag, "tag", 60) as string),
    cachePolicy,
    license: text(value.license, "license", 160) as string,
    aiTraining,
    embedAllowed: value.embedAllowed !== false,
    ageRating,
    contentHash: text(value.contentHash, "contentHash", 160, true),
  };
}
