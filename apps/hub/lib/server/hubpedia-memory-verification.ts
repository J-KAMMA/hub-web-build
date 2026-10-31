import "server-only";

import { findTrustedSourceDomain } from "@/lib/encyclopedia/trusted-source-domains";
import { getInstanceOrigin } from "@/lib/instance-origin";

/*
 * Machine verification for claim proposals. Auto-acceptance requires three
 * things, all fail-closed: every cited URL sits on a reviewed trusted domain
 * (excluded domains lose even under a trusted parent), the page is fetched
 * without ever following a redirect onto an untrusted host, and the submitted
 * quote appears verbatim in the extracted text. Any gap leaves the proposal
 * queued for a human — nothing here publishes.
 *
 * The Worker path cannot use the factory fetcher: source-text.ts shells out to
 * pdftotext and extract.ts pulls in jsdom. Verification only needs "does the
 * page text contain this string", so a plain fetch plus tag stripping is
 * enough. global_fetch_strictly_public keeps SSRF closed at the runtime layer.
 */

const MAX_REDIRECTS = 5;
const MAX_BODY_CHARS = 3_000_000;
const MIN_QUOTE_CHARS = 20;
const FETCH_TIMEOUT_MS = 10_000;
const USER_AGENT = `HubpediaMemoryVerification/1.0 (+${getInstanceOrigin()}/hubpedia)`;

export type ClaimEvidenceVerification =
  | { verified: true; sourceUrl: string; publisher: string; license: string }
  | { verified: false; reason: "untrusted_source_domain" | "quote_too_short" | "fetch_failed" | "quote_not_found" };

export function isSelfDomainUrl(url: string) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "jkamma.com" || host.endsWith(".jkamma.com");
  } catch {
    return false;
  }
}

export function normalizeVerificationText(value: string) {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

export function quoteAppearsInText(quote: string, pageText: string) {
  const needle = normalizeVerificationText(quote);
  if (needle.length < MIN_QUOTE_CHARS) return false;
  return normalizeVerificationText(pageText).includes(needle);
}

export interface VerificationPage { text: string; finalUrl: string }

export async function fetchVerificationPage(url: string): Promise<VerificationPage | null> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    /* Every hop must stay on a trusted domain — a trusted page redirecting to
     * an arbitrary host must not launder that host into "verified". */
    if (!findTrustedSourceDomain(current)) return null;
    const response = await fetch(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml,text/plain" },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) return null;
      const next = new URL(location, current);
      if (next.protocol !== "https:") return null;
      current = next.toString();
      continue;
    }
    if (!response.ok) return null;
    const type = response.headers.get("content-type") ?? "";
    const html = type.includes("text/html") || type.includes("application/xhtml");
    if (!html && !type.includes("text/plain")) return null;
    const body = await response.text();
    if (body.length > MAX_BODY_CHARS) return null;
    return { text: html ? htmlToText(body) : body, finalUrl: current };
  }
  return null;
}

function htmlToText(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script\s*>/gi, " ")
    .replace(/<style[\s\S]*?<\/style\s*>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript\s*>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => codePoint(hex, 16))
    .replace(/&#(\d+);/g, (_, dec) => codePoint(dec, 10))
    .replace(/&(?:nbsp|ensp|emsp|thinsp);/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&(?:apos|rsquo|lsquo);/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

function codePoint(value: string, radix: number) {
  try {
    return String.fromCodePoint(Number.parseInt(value, radix));
  } catch {
    return " ";
  }
}

export async function verifyHubpediaClaimEvidence(
  quote: string,
  sourceUrls: readonly string[],
  fetchPage: typeof fetchVerificationPage = fetchVerificationPage,
): Promise<ClaimEvidenceVerification> {
  if (!sourceUrls.length || sourceUrls.some((url) => !findTrustedSourceDomain(url))) {
    return { verified: false, reason: "untrusted_source_domain" };
  }
  if (normalizeVerificationText(quote).length < MIN_QUOTE_CHARS) {
    return { verified: false, reason: "quote_too_short" };
  }
  let fetchedAny = false;
  for (const url of sourceUrls) {
    const page = await fetchPage(url).catch(() => null);
    if (!page) continue;
    fetchedAny = true;
    if (quoteAppearsInText(quote, page.text)) {
      const entry = findTrustedSourceDomain(url)!;
      return { verified: true, sourceUrl: url, publisher: entry.publisher, license: entry.license };
    }
  }
  return { verified: false, reason: fetchedAny ? "quote_not_found" : "fetch_failed" };
}
