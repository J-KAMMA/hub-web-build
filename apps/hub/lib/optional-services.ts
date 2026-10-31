/*
 * Optional, jkamma-operated parts of Hub (decentralization phase 3, DESIGN 5.1).
 *
 * A self-hosted Hub has no Music, Vault, Mail, AI, Commerce, Identity/Payment, GohoToken,
 * advertising or jkamma Account link. When `isJkammaServicesEnabled()` is false these parts are
 * hidden from every entry point and their Hub-side routes answer 404 (not 503): the part is
 * absent, not temporarily down. This module is the one place that lists them; navigation filters
 * and the request policy both read it.
 */
import { isJkammaServicesEnabled } from "./instance-origin";

export const OPTIONAL_SERVICE_NAMES = [
  "music",
  "vault",
  "video",
  "code",
  "mail",
  "ai",
  "commerce",
  "identity",
  "ads",
  "account-link",
  "work-commissions",
  "research-token",
] as const;

export type OptionalServiceName = (typeof OPTIONAL_SERVICE_NAMES)[number];

type Env = Record<string, string | undefined>;

/**
 * Features that are still behind their own server-side switch (default off, on only when the variable is exactly
 * "1" or "true"). Production leaves them unset until the legal and policy review is done: work commissions need
 * the authorities inquiry (docs/hub-commissions/DESIGN.md 11.10), research-funding tokens need the DeSci legal review.
 */
const EXPLICIT_FLAGS: Partial<Record<OptionalServiceName, string>> = {
  "work-commissions": "HUB_WORK_COMMISSIONS_ENABLED",
  "research-token": "HUB_RESEARCH_TOKEN_ENABLED",
};

function explicitFlagOn(value: string | undefined): boolean {
  const flag = value?.trim().toLowerCase();
  return flag === "1" || flag === "true";
}

/** Every optional part belongs to the jkamma-operated integration set, so they switch together; flagged ones also need their own flag. */
export function isOptionalServiceEnabled(name: OptionalServiceName, env: Env = process.env): boolean {
  if (!isJkammaServicesEnabled(env)) return false;
  const flagName = EXPLICIT_FLAGS[name];
  return flagName ? explicitFlagOn(env[flagName]) : true;
}

/*
 * Path prefixes (page and API) owned by each optional service. The `/v2` mirror of each page is
 * listed explicitly. Matching is by path segment, never by bare string prefix.
 */
const OPTIONAL_PATH_PREFIXES: Record<OptionalServiceName, readonly string[]> = {
  music: ["/music", "/v2/music", "/api/music", "/v2/legal/music", "/api/p2p"],
  vault: ["/vault", "/api/vault", "/api/content-files"],
  video: ["/api/videos/native", "/api/client/videos/native", "/v2/studio/videos"],
  code: ["/api/code", "/v2/code"],
  mail: ["/mail", "/v2/messages/email"],
  ai: ["/ai", "/v2/ai", "/api/ai", "/v2/legal/ai"],
  commerce: [
    "/market",
    "/v2/market",
    "/shopping",
    "/store",
    "/v2/store",
    "/api/market",
    "/api/listings",
    "/v2/legal/commerce",
    "/v2/legal/listings",
  ],
  identity: ["/account/identity", "/account/payment", "/v2/account/identity", "/v2/account/payment"],
  ads: ["/advertising", "/v2/advertising", "/ads", "/v2/ads", "/api/ads"],
  "work-commissions": ["/v2/commissions", "/api/commissions"],
  /* Dynamic paths (/api/research/projects/[id]/token, .../fund-reports) are checked in their routes. */
  "research-token": [],
  "account-link": ["/api/auth/account", "/v2/account/desktop", "/account/desktop"],
};

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** The optional service that owns this path, or null for a core Hub path. */
export function optionalServiceForPath(pathname: string, search = ""): OptionalServiceName | null {
  if (pathname === "/messages" && new URLSearchParams(search).get("channel") === "email") return "mail";
  for (const name of OPTIONAL_SERVICE_NAMES) {
    if (OPTIONAL_PATH_PREFIXES[name].some((prefix) => matchesPrefix(pathname, prefix))) return name;
  }
  return null;
}

/** True when a path belongs to an optional service that this Hub does not run. */
export function isOptionalPathDisabled(pathname: string, search = "", env: Env = process.env): boolean {
  const service = optionalServiceForPath(pathname, search);
  return service !== null && !isOptionalServiceEnabled(service, env);
}

/** Drops navigation entries whose target belongs to a disabled optional service. */
export function filterOptionalNav<T extends { href: string }>(items: readonly T[], env: Env = process.env): T[] {
  return items.filter((item) => {
    const path = item.href.split("#")[0].split("?")[0];
    const search = item.href.includes("?") ? `?${item.href.split("?")[1].split("#")[0]}` : "";
    return !isOptionalPathDisabled(path, search, env);
  });
}

/** Ids of catalogue entries (lib/hub-services.ts) whose href belongs to a disabled optional service. */
export function hiddenServiceIds(
  services: readonly { id: string; href?: string }[],
  env: Env = process.env,
): string[] {
  const visible = new Set(filterOptionalNav(services.filter((service) => service.href) as { id: string; href: string }[], env).map((service) => service.id));
  return services.filter((service) => service.href && !visible.has(service.id)).map((service) => service.id);
}
