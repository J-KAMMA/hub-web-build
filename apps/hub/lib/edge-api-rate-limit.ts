import { clientIpFromRequest, keyedDailyHash } from "@/lib/ip-hash";
import type { RateLimit } from "@cloudflare/workers-types";

const HUB_SESSION_COOKIE = "hub.session";
const API_WINDOW_SECONDS = 60;

export type HubApiRateLimitRequest = {
  url: string;
  method: string;
  headers: { get(name: string): string | null };
};

export type HubApiRateLimitBindings = {
  HUB_API_READ_RATE_LIMIT: RateLimit;
  HUB_API_MUTATION_RATE_LIMIT: RateLimit;
};

function cookieValue(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName === name) return rawValue.join("=") || null;
  }
  return null;
}

async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  const bytes = new Uint8Array(digest);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function isHubApiRateLimitCandidate(request: HubApiRateLimitRequest): boolean {
  const { pathname } = new URL(request.url);
  return pathname.startsWith("/api/")
    && pathname !== "/api/health"
    && request.method !== "OPTIONS";
}

export async function hubApiRateLimitKey(request: HubApiRateLimitRequest): Promise<string> {
  const session = cookieValue(request.headers.get("cookie"), HUB_SESSION_COOKIE);
  if (session) return `session:${await sha256Base64Url(session)}`;

  // The raw address is never used as a key: only a keyed, daily-rotating hash leaves this function.
  return `anonymous:${await keyedDailyHash("edge-rate-limit", clientIpFromRequest(request.headers))}`;
}

export async function enforceHubApiRateLimit(
  request: HubApiRateLimitRequest,
  bindings: HubApiRateLimitBindings,
): Promise<Response | null> {
  if (!isHubApiRateLimitCandidate(request)) return null;

  const read = request.method === "GET" || request.method === "HEAD";
  const limiter = read
    ? bindings.HUB_API_READ_RATE_LIMIT
    : bindings.HUB_API_MUTATION_RATE_LIMIT;
  const actorKey = await hubApiRateLimitKey(request);
  const outcome = await limiter.limit({ key: `${read ? "read" : "mutation"}:${actorKey}` });
  if (outcome.success) return null;

  return Response.json(
    { error: "リクエストが多すぎます。少し待ってから再度お試しください。" },
    {
      status: 429,
      headers: {
        "Cache-Control": "no-store",
        "Retry-After": String(API_WINDOW_SECONDS),
      },
    },
  );
}
