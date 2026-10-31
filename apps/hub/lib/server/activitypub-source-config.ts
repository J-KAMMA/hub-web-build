import { parseActivityPubQuery } from "@/lib/server/activitypub-discovery";

const DEFAULT_PUBLIC_SOURCES = [
  "@Mastodon@mastodon.social",
  "@pixelfed@mastodon.social",
] as const;

function validSource(value: string) {
  try {
    parseActivityPubQuery(value);
    return true;
  } catch {
    return false;
  }
}

export function getActivityPubPublicSources(
  configured = process.env.HUB_ACTIVITYPUB_PUBLIC_SOURCES,
  disabled = process.env.HUB_ACTIVITYPUB_PUBLIC_DISCOVERY_DISABLED,
) {
  if (disabled?.trim().toLowerCase() === "true") return [];
  const custom = (configured ?? "")
    .split(/[\s,]+/u)
    .map((value) => value.trim())
    .filter(Boolean);
  return [...new Set([...custom, ...DEFAULT_PUBLIC_SOURCES])]
    .filter(validSource)
    .slice(0, 12);
}

