/*
 * Keyed, daily-rotating hashes of client IP addresses for rate limiting.
 *
 * A plain SHA-256 of an IPv4/IPv6 address can be reversed by enumeration, so it is not
 * anonymisation. Here the hash is an HMAC-SHA256 under a server-side key and includes the UTC day,
 * so the same address maps to a different value every day and nothing links days together.
 *
 * Key: HUB_IP_HASH_SECRET (optional Worker secret, >= 32 chars). No existing binding is meant for this
 * purpose, so when it is unset a random key is generated once per isolate and kept only in memory.
 * That is enough for rate limiting (the key dies with the isolate; the cost is that an address's
 * counters are split across isolates) and never persists anything recoverable.
 * Raw addresses must never be logged or stored; callers pass them in and keep only the digest.
 */
let isolateKey: Promise<CryptoKey> | undefined;

function importKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", raw as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

function signingKey(): Promise<CryptoKey> {
  isolateKey ??= (async () => {
    const configured = typeof process !== "undefined" ? process.env?.HUB_IP_HASH_SECRET : undefined;
    if (configured && configured.length >= 32) return importKey(new TextEncoder().encode(configured));
    return importKey(crypto.getRandomValues(new Uint8Array(32)));
  })();
  return isolateKey;
}

/** Hex HMAC of `purpose`, the UTC day and the value. `purpose` keeps different features' hashes unrelated. */
export async function keyedDailyHash(purpose: string, value: string, now: Date = new Date()): Promise<string> {
  const day = now.toISOString().slice(0, 10);
  const mac = await crypto.subtle.sign("HMAC", await signingKey(), new TextEncoder().encode(`${purpose}\n${day}\n${value}`));
  return [...new Uint8Array(mac)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The edge-supplied client address only. `x-forwarded-for` is client-controlled and is never used. */
export function clientIpFromRequest(headers: { get(name: string): string | null }): string {
  return headers.get("cf-connecting-ip")?.trim() || "unknown";
}

/** Test seam: forget the per-isolate key. */
export function resetIpHashKeyForTests() {
  isolateKey = undefined;
}
