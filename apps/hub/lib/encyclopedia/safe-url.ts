import { isIP } from "node:net";
import { promises as dns } from "node:dns";

export class UnsafeUrlError extends Error {}

function blockedIp(ip: string): boolean {
  if (ip === "0.0.0.0" || ip === "::" || ip === "::1") return true;
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const normalized = ip.toLowerCase();
  return normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb") || normalized.startsWith("ff") || normalized.startsWith("::ffff:127.") || normalized.startsWith("::ffff:10.") || normalized.startsWith("::ffff:192.168.");
}

export async function assertSafeSourceUrl(value: string): Promise<URL> {
  let url: URL;
  try { url = new URL(value); } catch { throw new UnsafeUrlError("Invalid URL."); }
  if (url.protocol !== "https:") throw new UnsafeUrlError("Only HTTPS sources are allowed.");
  if (url.username || url.password) throw new UnsafeUrlError("Credentials in source URLs are not allowed.");
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "metadata.google.internal") throw new UnsafeUrlError("Local or metadata hosts are not allowed.");
  const addresses = isIP(hostname) ? [{ address: hostname }] : await dns.lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(({ address }) => blockedIp(address))) throw new UnsafeUrlError("The URL resolves to a restricted network.");
  url.hash = "";
  return url;
}

export function normalizeSourceUrl(url: URL): string {
  url.hostname = url.hostname.toLowerCase();
  if (url.port === "443") url.port = "";
  return url.toString();
}

