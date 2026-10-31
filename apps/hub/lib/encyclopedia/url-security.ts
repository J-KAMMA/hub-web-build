import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

export class UnsafeUrlError extends Error { constructor(message: string) { super(message); this.name = "UnsafeUrlError"; } }

function isForbiddenIp(address: string): boolean {
  if (address === "0.0.0.0" || address === "::" || address === "::1") return true;
  if (address.startsWith("::ffff:")) return isForbiddenIp(address.slice(7));
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  const normalized = address.toLowerCase();
  return normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb") || normalized.startsWith("ff");
}

export function normalizeSourceUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new UnsafeUrlError("Only HTTPS source URLs are allowed.");
  if (url.username || url.password) throw new UnsafeUrlError("URL credentials are not allowed.");
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  if (url.port === "443") url.port = "";
  return url.toString();
}

export async function assertSafeUrl(value: string, resolver = lookup): Promise<URL> {
  const url = new URL(normalizeSourceUrl(value));
  if (url.hostname === "localhost" || url.hostname.endsWith(".localhost") || url.hostname.endsWith(".local")) throw new UnsafeUrlError("Local hostnames are not allowed.");
  if (isIP(url.hostname) && isForbiddenIp(url.hostname)) throw new UnsafeUrlError("Private or reserved IP addresses are not allowed.");
  const addresses = await resolver(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isForbiddenIp(address))) throw new UnsafeUrlError("Hostname resolves to a private or reserved IP address.");
  return url;
}
