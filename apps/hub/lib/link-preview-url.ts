const MAX_URL_LENGTH = 2048;

export class LinkPreviewError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "LinkPreviewError";
  }
}

function isForbiddenIpv4(hostname: string): boolean {
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) return false;
  const parts = hostname.split(".").map(Number);
  if (parts.some((part) => part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
}

function isForbiddenIpv6(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host.includes(":")) return false;
  if (host === "::" || host === "::1") return true;
  if (host.startsWith("::ffff:")) return isForbiddenIpv4(host.slice(7));
  return /^(fc|fd|fe[89ab]|ff)/.test(host);
}

export function validatePublicPreviewUrl(rawUrl: string): URL {
  if (!rawUrl || rawUrl.length > MAX_URL_LENGTH) throw new LinkPreviewError("invalid_url", "URL is invalid.");
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new LinkPreviewError("invalid_url", "URL is invalid.");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new LinkPreviewError("unsafe_url", "Only public HTTPS URLs are allowed.");
  }
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  if (url.port === "443") url.port = "";
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") ||
      hostname === "jkamma.com" || hostname.endsWith(".jkamma.com") ||
      isForbiddenIpv4(hostname) || isForbiddenIpv6(hostname)) {
    throw new LinkPreviewError("unsafe_url", "Private and platform URLs are not allowed.");
  }
  return url;
}
