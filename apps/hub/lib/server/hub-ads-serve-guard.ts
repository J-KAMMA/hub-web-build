// 広告の配信口は未認証で、通るたびに機会と配信の行を書く。端末ごとに回数を絞る。
// 鍵は CF-Connecting-IP を isolate ごとの塩で SHA-256 にしたもので、IP そのものは持たない。
const WINDOW_MS = 60_000;
const REQUEST_LIMIT = 60;
const buckets = new Map<string, { count: number; expiresAt: number }>();
const salt = crypto.randomUUID();

async function fingerprint(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}:${value}`));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function allowHubAdServe(headers: Headers, now = Date.now()) {
  const address = headers.get("cf-connecting-ip")?.trim();
  // Cloudflare が宛先を付けていないときは、偽れる転送ヘッダを信じず、全員で1つの枠を使う。
  const key = await fingerprint(address || "unknown-client");
  const existing = buckets.get(key);
  if (!existing || existing.expiresAt <= now) {
    buckets.set(key, { count: 1, expiresAt: now + WINDOW_MS });
    if (buckets.size > 10_000) {
      for (const [bucketKey, bucket] of buckets) if (bucket.expiresAt <= now) buckets.delete(bucketKey);
    }
    return { allowed: true, retryAfterSeconds: 0 };
  }
  existing.count += 1;
  return {
    allowed: existing.count <= REQUEST_LIMIT,
    retryAfterSeconds: Math.max(1, Math.ceil((existing.expiresAt - now) / 1_000)),
  };
}

export function resetHubAdServeRateLimitForTests() {
  buckets.clear();
}
