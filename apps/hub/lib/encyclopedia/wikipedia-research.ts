import { JSDOM } from "jsdom";

import { isWikipediaResearchGateway } from "./source-license-policy";

export type WikipediaReferenceCandidate = {
  url: string;
  title: string;
  discoveredFrom: string;
};

function cleanLabel(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 500);
}

export function extractWikipediaReferenceCandidates(html: string, wikipediaUrl: string): WikipediaReferenceCandidate[] {
  if (!isWikipediaResearchGateway({ url: wikipediaUrl })) throw new Error("Reference discovery requires a Wikipedia article URL.");
  const document = new JSDOM(html, { url: wikipediaUrl }).window.document;
  const candidates = new Map<string, WikipediaReferenceCandidate>();
  const selectors = [
    ".mw-parser-output ol.references a.external[href]",
    ".mw-parser-output .reflist a.external[href]",
    ".mw-parser-output cite a.external[href]",
  ];

  for (const anchor of document.querySelectorAll<HTMLAnchorElement>(selectors.join(","))) {
    try {
      const url = new URL(anchor.href);
      if (url.protocol !== "https:" || isWikipediaResearchGateway({ url: url.toString() })) continue;
      if (url.hostname === "wikimedia.org" || url.hostname.endsWith(".wikimedia.org")) continue;
      url.hash = "";
      const normalized = url.toString();
      if (candidates.has(normalized)) continue;
      const citation = anchor.closest("li, cite")?.textContent ?? anchor.textContent ?? url.hostname;
      candidates.set(normalized, {
        url: normalized,
        title: cleanLabel(citation) || url.hostname,
        discoveredFrom: wikipediaUrl,
      });
    } catch {
      // Ignore malformed external links in user-edited source pages.
    }
  }
  return [...candidates.values()];
}
