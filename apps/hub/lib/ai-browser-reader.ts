import "server-only";
import { getInstanceOrigin } from "@/lib/instance-origin";

/*
 * AIハーネスのブラウザ読み取りツール。
 * 公開ページの本文だけを取り出し、信頼されないコンテンツとして返す。
 * 実行・書き込み・決済には関与しない。
 */

export class BrowserReadError extends Error {
  constructor(
    public readonly code: "invalid_url" | "private_address" | "unsupported_type" | "fetch_failed" | "too_large" | "timeout",
    message: string,
  ) {
    super(message);
    this.name = "BrowserReadError";
  }
}

export type BrowserLink = { href: string; text: string };
export type BrowserReadResult = {
  url: string;
  title: string;
  description: string;
  text: string;
  links: BrowserLink[];
  fetchedAt: string;
  truncated: boolean;
};

const MAX_HTML_BYTES = 512 * 1024;
const MAX_TEXT_CHARACTERS = 6_000;
const MAX_LINKS = 20;
const MAX_REDIRECTS = 5;
const FETCH_TIMEOUT_MS = 8_000;

const BLOCKED_HOSTNAMES = new Set([
  "localhost", "localhost.localdomain", "broadcasthost", "metadata.google.internal",
]);

const BLOCKED_SUFFIXES = [".local", ".internal", ".localhost", ".home", ".lan", ".corp"];

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split(".");
  if (parts.length !== 4) return false;
  const octets = parts.map((part) => {
    if (!/^\d{1,3}$/.test(part)) return Number.NaN;
    return Number(part);
  });
  if (octets.some((octet) => !Number.isInteger(octet) || octet > 255)) return false;
  const [a, b] = octets;
  return a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a === 0
    || (a === 198 && (b === 18 || b === 19)) || a >= 224;
}

function isPrivateIpv6(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  // URL-normalised v4-mapped and NAT64 forms carry the embedded IPv4 as hex
  // pieces: ::ffff:7f00:1 is 127.0.0.1, 64:ff9b::7f00:1 is the same via NAT64.
  const embedded = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(normalized)
    ?? /^64:ff9b::([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(normalized);
  if (embedded) {
    const hi = Number.parseInt(embedded[1], 16), lo = Number.parseInt(embedded[2], 16);
    if (isPrivateIpv4(`${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`)) return true;
  }
  return normalized === "::1" || normalized === "::" || normalized.startsWith("fe80")
    || normalized.startsWith("fc") || normalized.startsWith("fd")
    || normalized.startsWith("::ffff:127.") || normalized.startsWith("::ffff:10.")
    || normalized.startsWith("::ffff:192.168") || /^::ffff:172\.(1[6-9]|2\d|3[01])\./.test(normalized);
}

export function isBlockedHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  if (!normalized) return true;
  if (BLOCKED_HOSTNAMES.has(normalized)) return true;
  if (BLOCKED_SUFFIXES.some((suffix) => normalized.endsWith(suffix))) return true;
  if (isPrivateIpv4(normalized) || isPrivateIpv6(normalized)) return true;
  // 数字・ドット・16進記号だけで構成されるが正規のIPv4形でないものは、
  // 127.1 / 0x7f000001 / 2130706433 / 8進表記などの回避表現として拒否する。
  if (/^[0-9a-fx.]+$/.test(normalized) && !/^\d{1,3}(\.\d{1,3}){3}$/.test(normalized)) return true;
  return false;
}

export function normalizeBrowserUrl(raw: unknown): URL {
  if (typeof raw !== "string" || !raw.trim() || raw.length > 2_048) {
    throw new BrowserReadError("invalid_url", "URLを確認してください。");
  }
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new BrowserReadError("invalid_url", "URLを確認してください。");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new BrowserReadError("invalid_url", "http または https のURLだけ開けます。");
  }
  if (url.username || url.password) {
    throw new BrowserReadError("invalid_url", "認証情報つきのURLは開けません。");
  }
  if (isBlockedHostname(url.hostname)) {
    throw new BrowserReadError("private_address", "内部アドレスは開けません。");
  }
  return url;
}

function decodeEntities(value: string): string {
  return value
    .replaceAll("&nbsp;", " ").replaceAll("&amp;", "&").replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&#39;", "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

function stripMarkup(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|noscript|template|svg|iframe|object|embed|form|nav|footer|header)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|tr|h[1-6]|section|article|blockquote|pre)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t　]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  );
}

function pickMeta(html: string, names: string[]): string {
  for (const name of names) {
    const match = html.match(new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*>`, "i"));
    const content = match?.[0].match(/content=["']([\s\S]*?)["']/i);
    if (content?.[1]) return decodeEntities(content[1]).slice(0, 500);
  }
  return "";
}

export function extractReadableText(html: string, baseUrl: string): Omit<BrowserReadResult, "url" | "fetchedAt"> {
  const title = decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").trim().slice(0, 300);
  const description = pickMeta(html, ["description", "og:description", "twitter:description"]);
  const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? html;
  const text = stripMarkup(body);
  const links: BrowserLink[] = [];
  for (const match of body.matchAll(/<a\s+[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = match[1];
    if (href.startsWith("javascript:") || href.startsWith("mailto:") || href.startsWith("tel:")) continue;
    try {
      const absolute = new URL(href, baseUrl);
      if (absolute.protocol !== "https:" && absolute.protocol !== "http:") continue;
      const label = stripMarkup(match[2]).slice(0, 120);
      if (!links.some((link) => link.href === absolute.href)) {
        links.push({ href: absolute.href, text: label || absolute.href });
      }
    } catch { /* 相対解決できないリンクは捨てる */ }
    if (links.length >= MAX_LINKS) break;
  }
  return { title, description, text: text.slice(0, MAX_TEXT_CHARACTERS), links, truncated: text.length > MAX_TEXT_CHARACTERS };
}

export async function readWebPage(
  rawUrl: unknown,
  fetcher: typeof fetch = fetch,
): Promise<BrowserReadResult> {
  let current = normalizeBrowserUrl(rawUrl);
  let response: Response;
  // Redirects are followed one hop at a time: every hop passes the same
  // scheme, credential and host boundary *before* a request is made to it,
  // rather than checking only where the chain happened to land.
  for (let hop = 0; ; hop += 1) {
    try {
      response = await fetcher(current.href, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { "user-agent": `HubAgentBrowser/1.0 (+${getInstanceOrigin()})`, accept: "text/html,application/xhtml+xml" },
        redirect: "manual",
      });
    } catch (cause) {
      const timeout = cause instanceof DOMException && (cause.name === "TimeoutError" || cause.name === "AbortError");
      throw new BrowserReadError(timeout ? "timeout" : "fetch_failed", "ページを取得できませんでした。");
    }
    const location = response.headers.get("location");
    if (!location || response.status < 300 || response.status >= 400) break;
    if (hop + 1 > MAX_REDIRECTS) {
      throw new BrowserReadError("fetch_failed", "リダイレクトが多すぎます。");
    }
    let next: URL;
    try {
      next = new URL(location, current.href);
    } catch {
      throw new BrowserReadError("invalid_url", "転送先のURLを確認できませんでした。");
    }
    current = normalizeBrowserUrl(next.href);
  }
  // A custom fetcher may still have followed redirects internally, so the URL
  // it reports is checked against the same boundary.
  const finalUrl = new URL(response.url || current.href);
  if (isBlockedHostname(finalUrl.hostname)) {
    throw new BrowserReadError("private_address", "内部アドレスへの転送は開けません。");
  }
  const type = response.headers.get("content-type") ?? "";
  if (!response.ok) throw new BrowserReadError("fetch_failed", `取得に失敗しました（${response.status}）。`);
  if (!type.includes("text/html") && !type.includes("application/xhtml")) {
    throw new BrowserReadError("unsupported_type", "HTMLページだけ読み取れます。");
  }
  const reader = response.body?.getReader();
  let received = 0;
  const chunks: Uint8Array[] = [];
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_HTML_BYTES) { await reader.cancel().catch(() => undefined); break; }
      chunks.push(value);
    }
  }
  const buffered = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const bytes = new Uint8Array(buffered);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const html = new TextDecoder().decode(bytes);
  const extracted = extractReadableText(html, finalUrl.href);
  return { url: finalUrl.href, fetchedAt: new Date().toISOString(), ...extracted, truncated: extracted.truncated || received > MAX_HTML_BYTES };
}
