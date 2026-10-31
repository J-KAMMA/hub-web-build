export const HUB_RESOURCE_MANIFEST_TYPE = "https://hub.jkamma.com/spec/resource-manifest/v1";

export const DISTRIBUTED_RESOURCE_KINDS = [
  "post", "thread", "community", "article", "image", "audio", "file",
  "product", "catalog", "compute", "search", "recommendation", "logistics", "storage",
] as const;

export type DistributedResourceKind = typeof DISTRIBUTED_RESOURCE_KINDS[number];
export type DistributedResourceManifest = {
  type: typeof HUB_RESOURCE_MANIFEST_TYPE;
  resourceId: string;
  kind: DistributedResourceKind;
  origin: string;
  canonicalUrl: string;
  title: string;
  summary: string;
  language?: string;
  publishedAt?: string;
  previewUrl?: string;
  license: string;
  cachePolicy: "denied" | "temporary" | "allowed";
  mirrorPolicy: "denied" | "allowed" | "required";
  aiTraining: "denied" | "allowed" | "attribution" | "consent-required";
  commerceMode: "none" | "discovery-only" | "commerce-api";
  contentHash?: string;
  tags: string[];
  capabilities: string[];
  mirrors: Array<{ manifestUrl: string; origin: string; priority?: number }>;
  metadata: Record<string, string | number | boolean | null>;
};

export class InvalidDistributedResourceManifestError extends Error {
  constructor(message: string) { super(message); this.name = "InvalidDistributedResourceManifestError"; }
}

function cleanText(value: unknown, name: string, max: number, optional = false) {
  if (optional && (value === undefined || value === null || value === "")) return undefined;
  if (typeof value !== "string") throw new InvalidDistributedResourceManifestError(`${name} is required.`);
  const result = value.normalize("NFKC").trim();
  if (!result || result.length > max || /\p{Cc}/u.test(result)) throw new InvalidDistributedResourceManifestError(`${name} is invalid.`);
  return result;
}

function blockedHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host === "::1") return true;
  const ip = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)?.slice(1).map(Number);
  if (ip && ip.every((part) => part >= 0 && part <= 255)) {
    const [a, b] = ip;
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  return /^(?:fc|fd|fe8|fe9|fea|feb)/.test(host);
}

export function normalizeDistributedPublicUrl(value: unknown, name = "url") {
  const raw = cleanText(value, name, 2048) as string;
  let url: URL;
  try { url = new URL(raw); } catch { throw new InvalidDistributedResourceManifestError(`${name} must be a valid URL.`); }
  if (url.protocol !== "https:" || url.username || url.password || url.port || blockedHost(url.hostname)) {
    throw new InvalidDistributedResourceManifestError(`${name} must be a public HTTPS URL.`);
  }
  url.hash = "";
  return url.toString();
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? value as T : fallback;
}

export function parseDistributedResourceManifest(input: unknown): DistributedResourceManifest {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new InvalidDistributedResourceManifestError("Manifest must be an object.");
  const value = input as Record<string, unknown>;
  if (value.type !== HUB_RESOURCE_MANIFEST_TYPE) throw new InvalidDistributedResourceManifestError("Manifest type is not supported.");
  const kind = enumValue(value.kind, DISTRIBUTED_RESOURCE_KINDS, "file");
  if (value.kind !== kind) throw new InvalidDistributedResourceManifestError("kind is not supported.");
  const strings = (inputValue: unknown, name: string, limit: number) => {
    if (!Array.isArray(inputValue) || inputValue.length > limit) throw new InvalidDistributedResourceManifestError(`${name} is invalid.`);
    return [...new Set(inputValue.map((item) => cleanText(item, name, 80) as string))];
  };
  const mirrors = (Array.isArray(value.mirrors) ? value.mirrors : []).slice(0, 16).map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new InvalidDistributedResourceManifestError("mirror is invalid.");
    const mirror = item as Record<string, unknown>;
    const priority = mirror.priority === undefined ? undefined : Number(mirror.priority);
    if (priority !== undefined && (!Number.isInteger(priority) || priority < 0 || priority > 1000)) throw new InvalidDistributedResourceManifestError("mirror priority is invalid.");
    return { manifestUrl: normalizeDistributedPublicUrl(mirror.manifestUrl, "mirror.manifestUrl"), origin: normalizeDistributedPublicUrl(mirror.origin, "mirror.origin"), priority };
  });
  const metadataInput = value.metadata && typeof value.metadata === "object" && !Array.isArray(value.metadata) ? value.metadata as Record<string, unknown> : {};
  const metadata: DistributedResourceManifest["metadata"] = {};
  if (Object.keys(metadataInput).length > 32) throw new InvalidDistributedResourceManifestError("metadata is too large.");
  for (const [key, item] of Object.entries(metadataInput)) {
    if (!/^[a-z][a-z0-9_.-]{0,63}$/i.test(key) || !(item === null || ["string", "number", "boolean"].includes(typeof item))) throw new InvalidDistributedResourceManifestError("metadata is invalid.");
    if (typeof item === "string" && item.length > 500) throw new InvalidDistributedResourceManifestError("metadata value is too large.");
    metadata[key] = item as string | number | boolean | null;
  }
  const commerceMode = enumValue(value.commerceMode, ["none", "discovery-only", "commerce-api"] as const, "none");
  if (["product", "catalog"].includes(kind) && commerceMode === "none") throw new InvalidDistributedResourceManifestError("Commerce resources must declare discovery-only or commerce-api mode.");
  return {
    type: HUB_RESOURCE_MANIFEST_TYPE,
    resourceId: normalizeDistributedPublicUrl(value.resourceId, "resourceId"),
    kind,
    origin: normalizeDistributedPublicUrl(value.origin, "origin"),
    canonicalUrl: normalizeDistributedPublicUrl(value.canonicalUrl, "canonicalUrl"),
    title: cleanText(value.title, "title", 240) as string,
    summary: cleanText(value.summary ?? "", "summary", 5000, true) ?? "",
    language: cleanText(value.language, "language", 35, true),
    publishedAt: cleanText(value.publishedAt, "publishedAt", 40, true),
    previewUrl: value.previewUrl ? normalizeDistributedPublicUrl(value.previewUrl, "previewUrl") : undefined,
    license: cleanText(value.license, "license", 160) as string,
    cachePolicy: enumValue(value.cachePolicy, ["denied", "temporary", "allowed"] as const, "denied"),
    mirrorPolicy: enumValue(value.mirrorPolicy, ["denied", "allowed", "required"] as const, "denied"),
    aiTraining: enumValue(value.aiTraining, ["denied", "allowed", "attribution", "consent-required"] as const, "denied"),
    commerceMode,
    contentHash: cleanText(value.contentHash, "contentHash", 160, true),
    tags: strings(value.tags ?? [], "tag", 32),
    capabilities: strings(value.capabilities ?? [], "capability", 32),
    mirrors,
    metadata,
  };
}
